import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../db";
import { addRepo, listIssues, listRepos, syncRepo } from "../sync";
import { addDep, listDeps, listRemovals, removeDep } from "../deps";
import type { GhIssue } from "../github/gh";
import type { Proposer } from "../llm/claude";
import { approveSuggestion, buildGraphPrompt, generateGraph, GRAPH_SCHEMA, latestGraphRun, listSuggestions, rejectSuggestion } from "./index";

let db: Database;
const gh = (n: number, over: Partial<GhIssue> = {}): GhIssue => ({
  number: n, title: `이슈 ${n}`, body: `본문 ${n}`, state: "OPEN", labels: [{ name: "p2" }], updatedAt: "x", closedAt: null, ...over,
});

// a/b: 열린 1~5 (id 1~5), 닫힌 6 (id 6). a/c: 열린 1 · 2 (id 7 · 8).
beforeEach(async () => {
  db = openDb(":memory:");
  await syncRepo(db, addRepo(db, "a/b"), async () => [1, 2, 3, 4, 5].map((n) => gh(n)).concat(gh(6, { title: "닫힌 이슈", state: "CLOSED" })));
  await syncRepo(db, addRepo(db, "a/c"), async () => [gh(1), gh(2)]);
});

const e = (blocker_id: number, blocked_id: number, reason = "r") => ({ blocker_id, blocked_id, reason });
const v = (blocker_id: number, blocked_id: number, verdict: string, reason = "r") => ({ blocker_id, blocked_id, verdict, reason });
const answer = (edges: object[], user_edges: object[] = []): Proposer => async () => ({ output: { edges, user_edges }, cost_usd: 0.1 });
const gen = (p: Proposer, lines: string[] = [], repo = 1) =>
  generateGraph(db, repo, listIssues(db, { state: "open" }), listRepos(db), p, (t) => lines.push(t));
const claude = (a: number, b: number) => db.run("insert into deps (blocker_id, blocked_id, source, reason) values (?, ?, 'claude', 'r')", [a, b]);
const deps = (repo = 1) => listDeps(db, repo).map((d) => [d.blocker_id, d.blocked_id, d.source, d.reason]);
const suggestions = () => listSuggestions(db, 1).map((s) => [s.kind, s.blocker_id, s.blocked_id, s.reason]);
const messages = (w: { message: string }[]) => w.map((x) => x.message);

test("프롬프트에 규칙 · 사용자 선 · 지운 선 · 열린 이슈 본문이 들어가고 닫힌 이슈는 없다", () => {
  const issues = listIssues(db, { state: "open", repo_id: 1 });
  const p = buildGraphPrompt(issues, "a/b", [e(1, 2)], [e(3, 4)]);
  expect(p).toContain("순환을 만들지 않는다");
  expect(p).toContain("이슈를 가리킬 때는 id가 아니라 #번호를 쓴다");
  expect(p).toContain("## 사용자 선 (blocker → blocked. id 기준)\n- 1 → 2");
  expect(p).toContain("## 사용자가 지운 선 (blocker → blocked. id 기준)\n- 3 → 4");
  expect(p).toContain("### id 5 · #5 · 라벨 p2");
  expect(p).toContain("본문 5");
  expect(p).not.toContain("닫힌 이슈");
  expect(GRAPH_SCHEMA.required).toEqual(["edges", "user_edges"]);
  expect(GRAPH_SCHEMA.properties.user_edges.items.properties.verdict.enum).toEqual(["keep", "remove", "reverse"]);
});

test("claude 선을 이유와 함께 긋고 사용자 선은 그대로 둔다. 결과를 저장하고 단계를 남긴다", async () => {
  addDep(db, 1, 2);
  const lines: string[] = [];
  const run = await gen(answer([e(2, 3, "2가 먼저다"), e(3, 4)]), lines);
  expect(deps()).toEqual([[1, 2, "user", ""], [2, 3, "claude", "2가 먼저다"], [3, 4, "claude", "r"]]);
  expect(run).toMatchObject({ status: "ok", added: 2, warnings: [], suggestions: 0, cost_usd: 0.1 });
  expect(latestGraphRun(db, 1)).toEqual(run);
  expect(latestGraphRun(db, 2)).toBeNull();
  expect(lines.map((l) => l.split(" · ")[0])).toEqual(["그래프 생성", "거르기", "저장"]);
  expect(lines[0]).toContain("이슈 5개 · 사용자 선 1 · 지운 선 0");
});

test("다시 생성하면 그 레포의 claude 선만 갈아끼운다. 닫힌 이슈에 걸린 claude 선도 지우고, 다른 레포는 안 건드린다", async () => {
  addDep(db, 1, 2);
  claude(5, 6);
  claude(7, 8);
  await gen(answer([e(2, 3), e(3, 4)]));
  await gen(answer([e(4, 5)]));
  expect(deps()).toEqual([[1, 2, "user", ""], [4, 5, "claude", "r"]]);
  expect(deps(2)).toEqual([[7, 8, "claude", "r"]]);
});

test("사용자 선과 같거나 겹친 선은 조용히 빼고, 자기 자신 · 열린 이슈가 아닌 선은 경고한다", async () => {
  addDep(db, 1, 2);
  const run = await gen(answer([e(1, 2), e(3, 3), e(3, 99), e(3, 6), e(2, 3), e(2, 3)]));
  expect(deps()).toEqual([[1, 2, "user", ""], [2, 3, "claude", "r"]]);
  expect(run.warnings).toEqual([
    { kind: "unknown", message: "#3 → #3 · 자기 자신이라 안 그음" },
    { kind: "unknown", message: "id 3 → 99 · 열린 이슈가 아니라 안 그음" },
    { kind: "unknown", message: "id 3 → 6 · 열린 이슈가 아니라 안 그음" },
  ]);
});

test("사용자 선이나 먼저 넣은 claude 선과 순환을 만드는 선은 저장하지 않고 경고한다", async () => {
  addDep(db, 1, 2);
  const run = await gen(answer([e(2, 1), e(3, 4), e(4, 5), e(5, 3)]));
  expect(deps()).toEqual([[1, 2, "user", ""], [3, 4, "claude", "r"], [4, 5, "claude", "r"]]);
  expect(run.warnings).toEqual([
    { kind: "cycle", message: "#2 → #1 · 순환이라 안 그음" },
    { kind: "cycle", message: "#5 → #3 · 순환이라 안 그음" },
  ]);
});

test("사용자 선 판정은 지움 · 뒤집음만 제안이고 선은 안 지운다. 사용자 선이 아닌 판정은 버리고, 다시 생성하면 제안이 바뀐다", async () => {
  addDep(db, 1, 2);
  addDep(db, 2, 3);
  addDep(db, 3, 4);
  const run = await gen(answer([], [v(1, 2, "keep"), v(2, 3, "remove", "필요 없다"), v(3, 4, "reverse", "반대다"), v(4, 5, "remove"), v(2, 3, "reverse")]));
  expect(suggestions()).toEqual([["remove", 2, 3, "필요 없다"], ["reverse", 3, 4, "반대다"]]);
  expect(run.suggestions).toBe(2);
  expect(deps().map((d) => d[2])).toEqual(["user", "user", "user"]);

  await gen(answer([], [v(1, 2, "remove", "x")]));
  expect(suggestions()).toEqual([["remove", 1, 2, "x"]]);
});

test("사용자가 지운 claude 선을 claude가 다시 내면 긋지 않고 다시 긋자 제안. 순환이면 제안 대신 경고", async () => {
  claude(1, 3);
  claude(4, 5);
  removeDep(db, 1, 3);
  removeDep(db, 4, 5);
  addDep(db, 5, 4);
  const lines: string[] = [];
  const run = await gen(answer([e(1, 3, "다시 필요하다"), e(4, 5)]), lines);
  expect(deps()).toEqual([[5, 4, "user", ""]]);
  expect(suggestions()).toEqual([["redraw", 1, 3, "다시 필요하다"]]);
  expect(messages(run.warnings)).toEqual(["#4 → #5 · 순환이라 안 그음"]);
  expect(listRemovals(db, 1).map((r) => [r.blocker_id, r.blocked_id])).toEqual([[1, 3], [4, 5]]);
  expect(lines[0]).toContain("지운 선 2");
  expect(lines[1]).toBe("거르기 · claude 선 0 · 순환 버림 1 · 모르는 선 0 · 지우자 0 · 뒤집자 0 · 다시 긋자 1");
});

test("두 번 다 깨지면 선 · 제안을 그대로 두고 none으로 남긴다", async () => {
  addDep(db, 1, 2);
  await gen(answer([e(2, 3)], [v(1, 2, "remove")]));
  let calls = 0;
  const lines: string[] = [];
  const broken: Proposer = async () => {
    calls++;
    if (calls === 1) return { output: {}, cost_usd: 0.2 };
    throw new Error("펑");
  };
  const run = await gen(broken, lines);
  expect(run).toMatchObject({ status: "none", added: 0, cost_usd: 0.2 });
  expect(deps()).toEqual([[1, 2, "user", ""], [2, 3, "claude", "r"]]);
  expect(suggestions()).toEqual([["remove", 1, 2, "r"]]);
  expect(lines.slice(1)).toEqual(["출력이 선 모양이 아니다 · 다시 묻는다", "claude 실패 · 펑 · 그만 묻는다", `생성 없음 · 선 · 제안은 그대로 · 생성 #${run.id} · 합계 0.20 USD`]);
});

const approve = (kind: string) => approveSuggestion(db, listSuggestions(db, 1).find((s) => s.kind === kind)!.id);

test("승인: 지움은 사용자 선을 지우고, 뒤집음은 반대 선을 사용자 선으로 긋고, 다시 긋자는 사용자 선으로 긋고 기억에서 뺀다", async () => {
  addDep(db, 1, 2);
  addDep(db, 2, 3);
  claude(4, 5);
  removeDep(db, 4, 5);
  await gen(answer([e(4, 5, "필요하다")], [v(1, 2, "remove"), v(2, 3, "reverse")]));
  expect(approve("remove")).toBe("applied");
  expect(approve("reverse")).toBe("applied");
  expect(approve("redraw")).toBe("applied");
  expect(deps()).toEqual([[3, 2, "user", ""], [4, 5, "user", ""]]);
  expect(listRemovals(db, 1)).toEqual([]);
  expect(suggestions()).toEqual([]);
});

test("거절은 제안만 지운다. 대상이 이미 바뀐 제안은 승인해도 아무 일 없이 사라지고, 없는 제안은 null", async () => {
  addDep(db, 1, 2);
  addDep(db, 2, 3);
  claude(4, 5);
  removeDep(db, 4, 5);
  await gen(answer([e(4, 5)], [v(1, 2, "remove"), v(2, 3, "reverse")]));
  const rejected = listSuggestions(db, 1).find((s) => s.kind === "remove")!.id;
  expect(rejectSuggestion(db, rejected)).toBe(true);
  expect(rejectSuggestion(db, rejected)).toBe(false);

  removeDep(db, 2, 3); // 사용자가 먼저 지웠다
  addDep(db, 4, 5); // 사용자가 먼저 그었다
  expect(approve("reverse")).toBe("stale");
  expect(approve("redraw")).toBe("stale");
  expect(deps()).toEqual([[1, 2, "user", ""], [4, 5, "user", ""]]);
  expect(suggestions()).toEqual([]);
  expect(approveSuggestion(db, 999)).toBeNull();
});
