import { test, expect } from "bun:test";
import { createApp } from "./app";
import { openDb } from "./db";
import type { GhIssue } from "./github/gh";

const fake: GhIssue[] = [
  { number: 1, title: "t1", body: "", state: "OPEN", labels: [{ name: "p1" }], updatedAt: "x", closedAt: null },
];

test("GET /api/health가 ok를 준다", async () => {
  const app = createApp({ db: openDb(":memory:"), source: async () => [] });
  const res = await app.request("/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, name: "cadence" });
});

test("레포 등록 → sync → 이슈 목록", async () => {
  const app = createApp({ db: openDb(":memory:"), source: async () => fake });
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  expect((await post("/api/repos", { full: "nope" })).status).toBe(400);
  expect((await post("/api/repos", { full: "a/b" })).status).toBe(201);
  expect(await (await post("/api/sync", {})).json()).toEqual({ "a/b": 1 });
  const issues = (await (await app.request("/api/issues?state=open")).json()) as { number: number; labels: string[] }[];
  expect(issues).toHaveLength(1);
  expect(issues[0]!.labels).toEqual(["p1"]);
});

test("deps 추가 → 목록 → 삭제", async () => {
  const app = createApp({ db: openDb(":memory:"), source: async () => [fake[0]!, { ...fake[0]!, number: 2 }] });
  const json = (path: string, method: string, body?: unknown) =>
    app.request(path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

  await json("/api/repos", "POST", { full: "a/b" });
  await json("/api/sync", "POST");
  expect((await json("/api/deps", "POST", { blocker_id: 1, blocked_id: 1 })).status).toBe(400);
  expect((await json("/api/deps", "POST", { blocker_id: 1, blocked_id: 2 })).status).toBe(201);
  expect(await (await app.request("/api/deps")).json()).toMatchObject([{ blocker_id: 1, blocked_id: 2 }]);
  expect((await app.request("/api/deps/1/2", { method: "DELETE" })).status).toBe(204);
  expect((await app.request("/api/deps/1/2", { method: "DELETE" })).status).toBe(404);
});

test("apply: 반영된 건이 있으면 다시 가져온다", async () => {
  let synced = 0;
  const app = createApp({
    db: openDb(":memory:"),
    source: async () => { synced++; return [{ ...fake[0]!, labels: [{ name: "p2" }] }]; },
    labels: { read: async () => ["p2"], write: async () => {} },
  });
  const json = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await json("/api/repos", { full: "a/b" });
  await json("/api/sync", {});
  const before = synced;
  const r = (await (await json("/api/apply", { changes: [{ issue_id: 1, from: "p2", to: "p1" }] })).json()) as { outcomes: { status: string }[]; synced: unknown };
  expect(r.outcomes[0]!.status).toBe("applied");
  expect(synced).toBe(before + 1);
  expect(r.synced).toEqual({ "a/b": 1 });
});
