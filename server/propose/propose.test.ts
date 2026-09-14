import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../db";
import { addRepo, listIssues, listRepos, syncRepo } from "../sync";
import { addDep, listDeps } from "../deps";
import type { GhIssue } from "../github/gh";
import type { Proposer } from "../llm/claude";
import { propose, latestProposal, buildPrompt, PROPOSAL_SCHEMA } from "./index";
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
  expect(p).toContain("패키지는 5개까지다");
  expect(PROPOSAL_SCHEMA.properties.packages.maxItems).toBe(5);
});

test("패키지가 5개를 넘으면 순위 앞 5개만 저장하고 로그에 남긴다", async () => {
  const lines: string[] = [];
  const many = [7, 6, 5, 4, 3, 2, 1].map((rank) => ({ rank, name: `p${rank}`, issue_ids: rank <= 3 ? [rank] : [], reason: "r", label_changes: [] }));
  const r = await propose(db, 1, ...ctx(), async () => ({ output: { packages: many }, cost_usd: 0 }), (t) => lines.push(t));
  if (!r.ok) throw new Error();
  expect(r.proposal.packages.map((p) => p.name)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  expect(lines).toContain("패키지 7개 · 앞 5개만 남긴다");
});

test("패키지에 안 든 이슈는 경고가 없고, 막는 이슈가 밖이면 사슬 경고다", async () => {
  const only = (ids: number[]) => async () => ({ output: { packages: [{ rank: 1, name: "하나", issue_ids: ids, reason: "r", label_changes: [] }] }, cost_usd: 0 });
  const waiting = await propose(db, 1, ...ctx(), only([3]));
  if (!waiting.ok) throw new Error();
  expect(waiting.proposal.warnings).toEqual([]);
  const cut = await propose(db, 1, ...ctx(), only([2])); // 2를 막는 1이 밖
  if (!cut.ok) throw new Error();
  expect(cut.proposal.warnings).toEqual([{ rank: 1, kind: "chain", message: "#2를 막는 #1가 어느 패키지에도 없음" }]);
});

test("제안을 받아 검증하고 저장한다. 어기면 경고가 붙는다", async () => {
  const proposer: Proposer = async () => ({
    output: { packages: [
      { rank: 1, name: "둘", issue_ids: [2], reason: "급함", label_changes: [] },
      { rank: 2, name: "나머지", issue_ids: [1, 3], reason: "그 다음", label_changes: [{ issue_id: 1, from: "p3", to: "p1" }] },
    ] },
    cost_usd: 0.1,
  });
  const r = await propose(db, 1, ...ctx(), proposer);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.proposal.status).toBe("ok");
  expect(r.proposal.packages.map((p) => p.name)).toEqual(["둘", "나머지"]);
  expect(r.proposal.warnings.map((w) => w.kind)).toEqual(["chain"]); // 2를 막는 1이 뒤 패키지
  expect(r.proposal.cost_usd).toBe(0.1);
  expect(latestProposal(db, 1)?.id).toBe(r.proposal.id);
});

test("깨진 출력은 한 번 재시도하고, 또 깨지면 none으로 후보 순서만 남긴다", async () => {
  let calls = 0;
  const proposer: Proposer = async () => { calls++; return { output: { nope: true }, cost_usd: 0.05 }; };
  const r = await propose(db, 1, ...ctx(), proposer);
  expect(calls).toBe(2);
  if (!r.ok) throw new Error();
  expect(r.proposal.status).toBe("none");
  expect(r.proposal.packages).toEqual([]);
  expect(r.proposal.order).toEqual([1, 2, 3]);
  expect(r.proposal.cost_usd).toBeCloseTo(0.1);
});

test("proposer가 던져도 재시도 뒤 none", async () => {
  const proposer: Proposer = async () => { throw new Error("claude 실패"); };
  const r = await propose(db, 1, ...ctx(), proposer);
  if (!r.ok) throw new Error();
  expect(r.proposal.status).toBe("none");
});

test("고른 레포의 이슈만 프롬프트에 들어가고, 최근 제안은 레포마다다", async () => {
  const other = addRepo(db, "a/c");
  await syncRepo(db, other, async () => [gh(1, ["p1"], "다른 레포 본문")]);
  let prompt = "";
  const proposer: Proposer = async (p) => {
    prompt = p;
    return { output: { packages: [{ rank: 1, name: "전부", issue_ids: [1, 2, 3], reason: "r", label_changes: [] }] }, cost_usd: 0 };
  };
  const r = await propose(db, 1, ...ctx(), proposer);
  expect(prompt).not.toContain("다른 레포 본문");
  expect(prompt).not.toContain("a/c");
  if (!r.ok) throw new Error();
  expect(r.proposal.repo_id).toBe(1);
  expect(r.proposal.warnings).toEqual([]); // 다른 레포 이슈가 "빠짐"으로 잡히지 않는다
  expect(latestProposal(db, 1)?.id).toBe(r.proposal.id);
  expect(latestProposal(db, other.id)).toBeNull();
});

const onePackage = { packages: [{ rank: 1, name: "전부", issue_ids: [1, 2, 3], reason: "r", label_changes: [] }] };

test("제안 한 번에 로그가 입력 → 시작 → 응답 끝 → 검증 → 저장 순서로 쌓인다", async () => {
  const lines: string[] = [];
  const proposer: Proposer = async (_p, _s, log) => {
    log("claude 시작 · 모델 claude-opus-5");
    log("응답 끝 · 0.10 USD · 3.0초");
    return { output: onePackage, cost_usd: 0.1 };
  };
  const r = await propose(db, 1, ...ctx(), proposer, (t) => lines.push(t));
  if (!r.ok) throw new Error();
  expect(lines.map((l) => l.split(" · ")[0])).toEqual(["제안", "claude 시작", "응답 끝", "검증", "저장"]);
  expect(lines[0]).toContain("a/b · 이슈 3개 · 입력");
  expect(lines[4]).toBe(`저장 · 제안 #${r.proposal.id} · 합계 0.10 USD`);
});

test("재시도하면 실패 줄이 남는다", async () => {
  const lines: string[] = [];
  let calls = 0;
  const proposer: Proposer = async () => {
    if (++calls === 1) throw new Error("터짐");
    return { output: onePackage, cost_usd: 0 };
  };
  await propose(db, 1, ...ctx(), proposer, (t) => lines.push(t));
  expect(lines).toContain("claude 실패 · 터짐 · 다시 묻는다");
  expect(lines.at(-1)).toStartWith("저장");
});

test("순환이 있으면 proposer를 부르지 않는다", async () => {
  addDep(db, 2, 1);
  let calls = 0;
  const r = await propose(db, 1, ...ctx(), async () => { calls++; return { output: {}, cost_usd: 0 }; });
  expect(calls).toBe(0);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.cycles).toHaveLength(2);
  expect(latestProposal(db, 1)).toBeNull();
});
