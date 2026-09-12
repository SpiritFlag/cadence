import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../db";
import { addRepo, syncRepo } from "../sync";
import type { GhIssue, GhLabels } from "../github/gh";
import { applyChanges } from "./index";

let db: Database;
let remote: Record<number, string[]>;
let writes: { number: number; add: string[]; remove: string[] }[];
let failOn: Set<number>;

const gh: GhLabels = {
  async read(_o, _n, number) {
    if (failOn.has(number)) throw new Error("gh 죽음");
    return remote[number] ?? [];
  },
  async write(_o, _n, number, add, remove) {
    writes.push({ number, add, remove });
    remote[number] = [...(remote[number] ?? []).filter((l) => !remove.includes(l)), ...add];
  },
};
const ghi = (n: number, labels: string[]): GhIssue => ({ number: n, title: `이슈 ${n}`, body: "", state: "OPEN", labels: labels.map((name) => ({ name })), updatedAt: "x", closedAt: null });

beforeEach(async () => {
  db = openDb(":memory:");
  const repo = addRepo(db, "a/b");
  // id 1 = #1(p3), id 2 = #2(p2 bug), id 3 = #3(p2), id 4 = #4(p2)
  await syncRepo(db, repo, async () => [ghi(1, ["p3"]), ghi(2, ["p2", "bug"]), ghi(3, ["p2"]), ghi(4, ["p2"])]);
  remote = { 1: ["p3"], 2: ["p2", "bug"], 3: ["p1"], 4: ["p2"] }; // #3은 GitHub에서 이미 p1로 바뀜
  writes = [];
  failOn = new Set();
});

test("정상 건은 반영되고 다른 p 라벨만 뺀다. bug 같은 라벨은 건드리지 않는다", async () => {
  const out = await applyChanges(db, [{ issue_id: 2, from: "p2", to: "p1" }], gh);
  expect(out).toEqual([{ issue_id: 2, status: "applied", message: "p2 → p1" }]);
  expect(writes).toEqual([{ number: 2, add: ["p1"], remove: ["p2"] }]);
  expect(remote[2]!.sort()).toEqual(["bug", "p1"]);
});

test("제안 당시와 지금이 다르면 건너뛴다", async () => {
  const out = await applyChanges(db, [{ issue_id: 3, from: "p2", to: "p1" }], gh);
  expect(out[0]!.status).toBe("skipped");
  expect(writes).toEqual([]);
});

test("이미 그 라벨이면 건너뛴다", async () => {
  remote[1] = ["p1", "p3"];
  const out = await applyChanges(db, [{ issue_id: 1, from: "p3", to: "p1" }], gh);
  expect(out[0]!.status).toBe("skipped");
  expect(writes).toEqual([]);
});

test("한 건이 실패해도 나머지는 계속한다", async () => {
  failOn.add(1);
  const out = await applyChanges(db, [
    { issue_id: 1, from: "p3", to: "p1" },
    { issue_id: 4, from: "p2", to: "p1" },
  ], gh);
  expect(out.map((o) => o.status)).toEqual(["failed", "applied"]);
  expect(writes.map((w) => w.number)).toEqual([4]);
});

test("없는 이슈 · 넷 밖 라벨은 실패, 같은 이슈 두 번은 한 번", async () => {
  const out = await applyChanges(db, [
    { issue_id: 99, from: "p2", to: "p1" },
    { issue_id: 4, from: "p2", to: "urgent" as "p1" },
    { issue_id: 2, from: "p2", to: "p1" },
    { issue_id: 2, from: "p2", to: "p1" },
  ], gh);
  expect(out.map((o) => [o.issue_id, o.status])).toEqual([[99, "failed"], [4, "failed"], [2, "applied"]]);
  expect(writes).toHaveLength(1);
});
