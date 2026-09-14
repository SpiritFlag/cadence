import { test, expect } from "bun:test";
import { openDb } from "../db";
import type { GhIssue, GhMilestone, IssueSource, MilestoneSource } from "../github/gh";
import { addRepo, listIssues, listMilestones, listRepos, parseFullName, syncAll, syncRepo } from "./index";

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

const ms = (n: number, over: Partial<GhMilestone> = {}): GhMilestone => ({
  number: n,
  title: `v0.${n}.0`,
  state: "closed",
  created_at: `2026-09-1${n}T00:00:00Z`,
  closed_at: `2026-09-1${n}T01:00:00Z`,
  ...over,
});
const on = (n: number) => ({ number: n, title: `v0.${n}.0` });

test("마일스톤을 upsert하고 붙은 이슈 번호를 모은다. 원천에서 사라진 마일스톤은 지운다", async () => {
  const db = openDb(":memory:");
  const repo = addRepo(db, "a/b");
  const other = addRepo(db, "a/c");

  let issues: GhIssue[] = [
    issue(1, { milestone: on(1), state: "CLOSED", closedAt: "2026-09-11T00:30:00Z" }),
    issue(2, { milestone: on(1) }),
    issue(3, { milestone: on(2) }),
    issue(4, { milestone: null }),
  ];
  let milestones: GhMilestone[] = [ms(1), ms(2, { state: "open", closed_at: null })];
  const source: IssueSource = async (_o, name) => (name === "b" ? issues : [issue(1)]);
  const msSource: MilestoneSource = async (_o, name) => (name === "b" ? milestones : []);

  await syncAll(db, source, msSource);
  expect(listIssues(db, { repo_id: repo.id }).map((i) => i.milestone_number)).toEqual([1, 1, 2, null]);
  expect(listMilestones(db, repo.id).map((m) => [m.number, m.title, m.state, m.closed_at, m.issues])).toEqual([
    [1, "v0.1.0", "closed", "2026-09-11T01:00:00Z", [1, 2]],
    [2, "v0.2.0", "open", null, [3]],
  ]);
  expect(listMilestones(db, other.id)).toEqual([]);

  // 1이 지워지고 2가 닫히고, 이슈 3의 마일스톤이 빠진다
  issues = [issue(1), issue(2), issue(3, { milestone: null }), issue(4)];
  milestones = [ms(2)];
  await syncAll(db, source, msSource);
  expect(listIssues(db, { repo_id: repo.id }).map((i) => i.milestone_number)).toEqual([null, null, null, null]);
  expect(listMilestones(db, repo.id).map((m) => [m.number, m.state, m.issues])).toEqual([[2, "closed", []]]);
});

test("마일스톤 원천을 안 주면 마일스톤 목록은 그대로다", async () => {
  const db = openDb(":memory:");
  const repo = addRepo(db, "a/b");
  await syncRepo(db, repo, async () => [issue(1, { milestone: on(1) })], async () => [ms(1)]);
  await syncRepo(db, repo, async () => [issue(1, { milestone: on(1) })]);
  expect(listMilestones(db, repo.id).map((m) => [m.number, m.issues])).toEqual([[1, [1]]]);
});
