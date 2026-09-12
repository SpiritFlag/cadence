import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { Database } from "bun:sqlite";
import { openDb } from "./db";
import { ghListIssues, type IssueSource } from "./github/gh";
import { addRepo, listIssues, listRepos, syncAll } from "./sync";

export type AppDeps = { db?: Database; source?: IssueSource };

export function createApp(deps: AppDeps = {}) {
  const db = deps.db ?? openDb();
  const source = deps.source ?? ghListIssues;
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

  // 빌드된 프론트. dev에서는 Vite가 대신 서빙하므로 여기 안 온다.
  app.use("/*", serveStatic({ root: "./web/dist" }));
  app.get("/*", serveStatic({ path: "./web/dist/index.html" }));

  return app;
}
