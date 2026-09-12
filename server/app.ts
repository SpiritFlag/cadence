import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { Database } from "bun:sqlite";
import { openDb } from "./db";
import { ghListIssues, type IssueSource } from "./github/gh";
import { addRepo, listIssues, listRepos, syncAll } from "./sync";
import { addDep, listDeps, removeDep } from "./deps";
import { claudeProposer, type Proposer } from "./llm/claude";
import { latestProposal, propose } from "./propose";

export type AppDeps = { db?: Database; source?: IssueSource; proposer?: Proposer };

export function createApp(deps: AppDeps = {}) {
  const db = deps.db ?? openDb();
  const source = deps.source ?? ghListIssues;
  const proposer = deps.proposer ?? claudeProposer;
  const app = new Hono();

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
    const opts: { state?: "open" | "closed" } = {};
    if (state === "open" || state === "closed") opts.state = state;
    return c.json(listIssues(db, opts));
  });

  app.get("/api/deps", (c) => c.json(listDeps(db)));
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

  app.get("/api/proposals/latest", (c) => c.json(latestProposal(db)));
  app.post("/api/propose", async (c) => {
    const r = await propose(db, listIssues(db, { state: "open" }), listRepos(db), listDeps(db), proposer);
    if (!r.ok) return c.json({ error: "순환이 있어 제안하지 않는다", cycles: r.cycles }, 409);
    return c.json(r.proposal);
  });

  // 빌드된 프론트. dev에서는 Vite가 대신 서빙하므로 여기 안 온다.
  app.use("/*", serveStatic({ root: "./web/dist" }));
  app.get("/*", serveStatic({ path: "./web/dist/index.html" }));

  return app;
}
