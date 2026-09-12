import { Hono } from "hono";
import { serveStatic } from "hono/bun";

export function createApp() {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true, name: "cadence" }));

  // 빌드된 프론트. dev에서는 Vite가 대신 서빙하므로 여기 안 온다.
  app.use("/*", serveStatic({ root: "./web/dist" }));
  app.get("/*", serveStatic({ path: "./web/dist/index.html" }));

  return app;
}
