import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../db";
import { addRepo, listIssues, listRepos, syncRepo } from "../sync";
import { addDep, listDeps } from "../deps";
import type { GhIssue } from "../github/gh";
import type { Proposer } from "../llm/claude";
import { propose, latestProposal, buildPrompt } from "./index";
import { candidateOrder } from "../graph/order";

let db: Database;
const gh = (n: number, labels: string[], body = ""): GhIssue => ({
  number: n, title: `이슈 ${n}`, body, state: "OPEN", labels: labels.map((name) => ({ name })), updatedAt: "x", closedAt: null,
});

beforeEach(async () => {
  db = openDb(":memory:");
  const repo = addRepo(db, "a/b");
  await syncRepo(db, repo, async () => [gh(1, ["p3"]), gh(2, ["p1"], "급하다"), gh(3, ["p2"]), gh(4, ["hold"])]);
  addDep(db, 1, 2); // 1(p3)이 2(p1)를 막는다 → 1 승격 제안
});

const ctx = () => [listIssues(db, { state: "open" }), listRepos(db), listDeps(db)] as const;

test("프롬프트에 규칙 · 후보 순서 · 승격 · 선 · 이슈 본문이 들어간다", () => {
  const [issues, repos, deps] = ctx();
  const p = buildPrompt(issues, repos, deps, candidateOrder(issues, deps));
  expect(p).toContain("막는 것이 앞이다");
  expect(p).toContain("#1 → #2 → #3");
  expect(p).toContain("p3 → p1");
  expect(p).toContain("1 → 2");
  expect(p).toContain("급하다");
  expect(p).not.toContain("#4"); // hold는 없다
});

test("제안을 받아 검증하고 저장한다. 어기면 경고가 붙는다", async () => {
  const proposer: Proposer = async () => ({
    output: { packages: [
      { rank: 1, name: "둘", issue_ids: [2], reason: "급함", label_changes: [] },
      { rank: 2, name: "나머지", issue_ids: [1, 3], reason: "그 다음", label_changes: [{ issue_id: 1, from: "p3", to: "p1" }] },
    ] },
    cost_usd: 0.1,
  });
  const r = await propose(db, ...ctx(), proposer);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.proposal.status).toBe("ok");
  expect(r.proposal.packages.map((p) => p.name)).toEqual(["둘", "나머지"]);
  expect(r.proposal.warnings.map((w) => w.kind)).toEqual(["chain"]); // 2를 막는 1이 뒤 패키지
  expect(r.proposal.cost_usd).toBe(0.1);
  expect(latestProposal(db)?.id).toBe(r.proposal.id);
});

test("깨진 출력은 한 번 재시도하고, 또 깨지면 none으로 후보 순서만 남긴다", async () => {
  let calls = 0;
  const proposer: Proposer = async () => { calls++; return { output: { nope: true }, cost_usd: 0.05 }; };
  const r = await propose(db, ...ctx(), proposer);
  expect(calls).toBe(2);
  if (!r.ok) throw new Error();
  expect(r.proposal.status).toBe("none");
  expect(r.proposal.packages).toEqual([]);
  expect(r.proposal.order).toEqual([1, 2, 3]);
  expect(r.proposal.cost_usd).toBeCloseTo(0.1);
});

test("proposer가 던져도 재시도 뒤 none", async () => {
  const proposer: Proposer = async () => { throw new Error("claude 실패"); };
  const r = await propose(db, ...ctx(), proposer);
  if (!r.ok) throw new Error();
  expect(r.proposal.status).toBe("none");
});

test("순환이 있으면 proposer를 부르지 않는다", async () => {
  addDep(db, 2, 1);
  let calls = 0;
  const r = await propose(db, ...ctx(), async () => { calls++; return { output: {}, cost_usd: 0 }; });
  expect(calls).toBe(0);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.cycles).toHaveLength(2);
  expect(latestProposal(db)).toBeNull();
});
