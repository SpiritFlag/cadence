import { test, expect } from "bun:test";
import { openDb } from "../db";
import type { GhIssue, IssueSource } from "../github/gh";
import { addRepo, listIssues, listRepos, parseFullName, syncAll, syncRepo } from "./index";

const issue = (n: number, over: Partial<GhIssue> = {}): GhIssue => ({
  number: n,
  title: `이슈 ${n}`,
  body: `본문 ${n}`,
  state: "OPEN",
  labels: [{ name: "p2" }],
  updatedAt: "2026-09-13T00:00:00Z",
  closedAt: null,
  ...over,
});

test("owner/name을 가른다. 아니면 던진다", () => {
  expect(parseFullName(" SpiritFlag/cadence ")).toEqual({ owner: "SpiritFlag", name: "cadence" });
  expect(() => parseFullName("cadence")).toThrow();
});

test("레포는 두 번 넣어도 하나다", () => {
  const db = openDb(":memory:");
  const a = addRepo(db, "a/b");
  const b = addRepo(db, "a/b");
  expect(a.id).toBe(b.id);
  expect(listRepos(db)).toHaveLength(1);
});

test("가져오기 → upsert → 재가져오기(하나 닫힘)", async () => {
  const db = openDb(":memory:");
  const repo = addRepo(db, "a/b");

  let batch: GhIssue[] = [issue(1), issue(2), issue(3, { labels: [{ name: "p1" }, { name: "hold" }] })];
  const source: IssueSource = async () => batch;

  expect(await syncRepo(db, repo, source)).toBe(3);
  let rows = listIssues(db);
  expect(rows.map((r) => r.number)).toEqual([1, 2, 3]);
  expect(rows[2]!.labels).toEqual(["p1", "hold"]);
  expect(rows.every((r) => r.state === "open")).toBe(true);

  batch = [
    issue(1, { title: "바뀐 제목" }),
    issue(2, { state: "CLOSED", closedAt: "2026-09-13T01:00:00Z" }),
    issue(3),
  ];
  expect(await syncAll(db, source)).toEqual({ "a/b": 3 });
  rows = listIssues(db);
  expect(rows).toHaveLength(3);
  expect(rows[0]!.title).toBe("바뀐 제목");
  expect(rows[1]!.state).toBe("closed");
  expect(rows[1]!.closed_at).toBe("2026-09-13T01:00:00Z");
  expect(listIssues(db, { state: "open" }).map((r) => r.number)).toEqual([1, 3]);
});
