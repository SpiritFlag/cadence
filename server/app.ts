import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { streamSSE } from "hono/streaming";
import type { Database } from "bun:sqlite";
import { openDb } from "./db";
import { ghListIssues, ghLabels, type GhLabels, type IssueSource } from "./github/gh";
import { applyChanges, type ApplyChange } from "./apply";
import { addRepo, listIssues, listRepos, syncAll } from "./sync";
import { addDep, listDeps, removeDep } from "./deps";
import { claudeProposer, type Proposer } from "./llm/claude";
import { latestProposal, propose } from "./propose";
import { createLogBus, type LogBus, type LogLine } from "./log";

/** 로그 SSE 핑 간격. 서버 유휴 제한(240초)보다 짧아야 연결이 안 끊긴다. */
const LOG_PING_MS = 30_000;

export type AppDeps = { db?: Database; source?: IssueSource; proposer?: Proposer; labels?: GhLabels; logs?: LogBus };

export function createApp(deps: AppDeps = {}) {
  const db = deps.db ?? openDb();
  const source = deps.source ?? ghListIssues;
  const proposer = deps.proposer ?? claudeProposer;
  const labels = deps.labels ?? ghLabels;
  const logs = deps.logs ?? createLogBus();
  const app = new Hono();

  /** 등록된 레포 id면 그 레포, 아니면 null. */
  const findRepo = (v: unknown) => listRepos(db).find((r) => r.id === Number(v)) ?? null;
  const NO_REPO = { error: "repo가 필요하다 (등록된 레포 id)" };

  app.get("/api/health", (c) => c.json({ ok: true, name: "cadence" }));

  app.get("/api/repos", (c) => c.json(listRepos(db)));
  app.post("/api/repos", async (c) => {
    const { full } = (await c.req.json()) as { full?: string };
    if (!full) return c.json({ error: "full이 필요하다 (owner/name)" }, 400);
    try {
      return c.json(addRepo(db, full), 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.post("/api/sync", async (c) => {
    try {
      return c.json(await syncAll(db, source));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  app.get("/api/issues", (c) => {
    const state = c.req.query("state");
    const opts: { state?: "open" | "closed"; repo_id?: number } = {};
    if (state === "open" || state === "closed") opts.state = state;
    const repo = c.req.query("repo");
    if (repo !== undefined) {
      const r = findRepo(repo);
      if (!r) return c.json(NO_REPO, 400);
      opts.repo_id = r.id;
    }
    return c.json(listIssues(db, opts));
  });

  app.get("/api/deps", (c) => {
    const repo = c.req.query("repo");
    if (repo === undefined) return c.json(listDeps(db));
    const r = findRepo(repo);
    return r ? c.json(listDeps(db, r.id)) : c.json(NO_REPO, 400);
  });
  app.post("/api/deps", async (c) => {
    const { blocker_id, blocked_id } = (await c.req.json()) as { blocker_id?: number; blocked_id?: number };
    if (typeof blocker_id !== "number" || typeof blocked_id !== "number") {
      return c.json({ error: "blocker_id · blocked_id가 필요하다" }, 400);
    }
    try {
      return c.json(addDep(db, blocker_id, blocked_id), 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
  app.delete("/api/deps/:blocker/:blocked", (c) => {
    const ok = removeDep(db, Number(c.req.param("blocker")), Number(c.req.param("blocked")));
    return ok ? c.body(null, 204) : c.json({ error: "없는 선이다" }, 404);
  });

  app.get("/api/proposals/latest", (c) => {
    const r = findRepo(c.req.query("repo"));
    return r ? c.json(latestProposal(db, r.id)) : c.json(NO_REPO, 400);
  });
  app.post("/api/propose", async (c) => {
    const { repo_id } = (await c.req.json().catch(() => ({}))) as { repo_id?: number };
    const repo = findRepo(repo_id);
    if (!repo) return c.json(NO_REPO, 400);
    const r = await propose(db, repo.id, listIssues(db, { state: "open", repo_id: repo.id }), listRepos(db), listDeps(db, repo.id), proposer, logs.log);
    if (!r.ok) return c.json({ error: "순환이 있어 제안하지 않는다", cycles: r.cycles }, 409);
    return c.json(r.proposal);
  });

  // 로그 줄을 SSE로 흘린다. 열면 최근 줄부터 주고, 이후 줄은 생기는 대로.
  app.get("/api/logs", (c) =>
    streamSSE(c, async (stream) => {
      const send = (line: LogLine) => void stream.writeSSE({ event: "line", data: JSON.stringify(line) });
      // 본문이 한 조각도 없으면 Vite 프록시가 헤더를 붙잡아 연결이 안 열린다. 핑부터 보낸다.
      void stream.writeSSE({ event: "ping", data: "" });
      // 최근 줄 보내기와 구독은 같은 틱이라 그 사이에 줄이 끼지 않는다.
      for (const line of logs.recent()) send(line);
      const stop = logs.subscribe(send);
      stream.onAbort(stop);
      while (!stream.aborted) {
        await stream.sleep(LOG_PING_MS);
        if (!stream.aborted) await stream.writeSSE({ event: "ping", data: "" });
      }
      stop();
    }),
  );

  app.post("/api/apply", async (c) => {
    const { changes } = (await c.req.json()) as { changes?: ApplyChange[] };
    if (!Array.isArray(changes)) return c.json({ error: "changes가 필요하다" }, 400);
    const outcomes = await applyChanges(db, changes, labels);
    // 성공한 건이 있으면 다시 가져와 로컬 라벨을 맞춘다.
    const synced = outcomes.some((o) => o.status === "applied") ? await syncAll(db, source) : null;
    return c.json({ outcomes, synced });
  });

  // 빌드된 프론트. dev에서는 Vite가 대신 서빙하므로 여기 안 온다.
  app.use("/*", serveStatic({ root: "./web/dist" }));
  app.get("/*", serveStatic({ path: "./web/dist/index.html" }));

  return app;
}
