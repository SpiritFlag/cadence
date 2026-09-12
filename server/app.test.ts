import { test, expect } from "bun:test";
import { createApp } from "./app";

test("GET /api/health가 ok를 준다", async () => {
  const app = createApp();
  const res = await app.request("/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, name: "cadence" });
});
