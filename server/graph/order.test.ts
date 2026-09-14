import { test, expect } from "bun:test";
import type { Edge } from "./cycle";
import { candidateOrder, checkPackages, priorityOf, type OrderIssue } from "./order";

const is = (id: number, labels: string[] = [], state: "open" | "closed" = "open"): OrderIssue => ({ id, number: id, labels, state });
const e = (a: number, b: number): Edge => ({ blocker_id: a, blocked_id: b });

test("가장 높은 p 라벨. 없으면 p3, 둘 이상이면 높은 것", () => {
  expect(priorityOf([])).toBe("p3");
  expect(priorityOf(["bug"])).toBe("p3");
  expect(priorityOf(["p2"])).toBe("p2");
  expect(priorityOf(["p3", "p1", "hold"])).toBe("p1");
});

test("막는 것이 앞이다", () => {
  const r = candidateOrder([is(1, ["p3"]), is(2, ["p1"]), is(3, ["p2"])], [e(1, 2), e(2, 3)]);
  expect(r.order).toEqual([1, 2, 3]);
});

test("같은 층은 라벨 순, 같으면 번호 순", () => {
  const r = candidateOrder([is(1, ["p3"]), is(2, ["p1"]), is(3, ["p2"]), is(4, ["p1"])], []);
  expect(r.order).toEqual([2, 4, 3, 1]);
});

test("hold와 닫힌 이슈는 순서에 없다", () => {
  const r = candidateOrder([is(1, ["p1", "hold"]), is(2, ["p1"]), is(3, ["p1"], "closed")], [e(1, 2)]);
  expect(r.order).toEqual([2]);
  expect(r.promotions).toEqual([]);
});

test("마일스톤이 붙은 열린 이슈는 진행 중이라 순서 · 승격 · 패키지 검사에서 빠진다", () => {
  const issues = [is(1, ["p3"]), { ...is(2, ["p1"]), milestone_number: 5 }, is(3, ["p2"])];
  const r = candidateOrder(issues, [e(1, 2)]);
  expect(r.order).toEqual([3, 1]);
  expect(r.promotions).toEqual([]);
  expect(checkPackages([{ rank: 1, issue_ids: [2] }], issues, []).map((w) => w.kind)).toEqual(["unknown"]);
});

test("순환이 있으면 순서가 없고 순환 선이 온다", () => {
  const r = candidateOrder([is(1), is(2)], [e(1, 2), e(2, 1)]);
  expect(r.order).toEqual([]);
  expect(r.cycles).toHaveLength(2);
});

test("막히는 쪽이 높으면 막는 쪽을 올리자고 한다. 사슬을 따라 전파한다", () => {
  const r = candidateOrder([is(1, ["p3"]), is(2, ["p2"]), is(3, ["p1"])], [e(1, 2), e(2, 3)]);
  expect(r.promotions).toEqual([
    { issue_id: 1, from: "p3", to: "p1" },
    { issue_id: 2, from: "p2", to: "p1" },
  ]);
  expect(r.effective).toEqual({ 1: "p1", 2: "p1", 3: "p1" });
});

test("내리는 제안은 없다", () => {
  const r = candidateOrder([is(1, ["p1"]), is(2, ["p3"])], [e(1, 2)]);
  expect(r.promotions).toEqual([]);
});

test("승격된 우선순위로 순서를 매긴다", () => {
  // 3(p1)을 막는 1(p3)이 p1로 올라가 4(p2)보다 앞에 온다
  const r = candidateOrder([is(1, ["p3"]), is(3, ["p1"]), is(4, ["p2"])], [e(1, 3)]);
  expect(r.order).toEqual([1, 3, 4]);
});

test("패키지 검사: 크기 · 사슬 · 중복 · 모르는 이슈", () => {
  const issues = [is(1), is(2), is(3), is(4), is(5), is(6), is(7), is(8, ["hold"])];
  const deps = [e(1, 2)];
  const w = checkPackages(
    [
      { rank: 1, issue_ids: [2, 3, 4, 5, 6, 7] }, // 6개 · 2가 1보다 앞
      { rank: 2, issue_ids: [1, 3, 99] }, // 3 중복 · 99 모름
    ],
    issues,
    deps,
  );
  expect(w.map((x) => x.kind).sort()).toEqual(["chain", "duplicate", "size", "unknown"]);
  expect(w.find((x) => x.kind === "chain")?.rank).toBe(1);
  expect(w.find((x) => x.kind === "size")?.rank).toBe(1);
});

test("패키지 검사: 패키지에 안 든 이슈는 대기라 경고가 없다", () => {
  const w = checkPackages([{ rank: 1, issue_ids: [1] }], [is(1), is(2), is(3, ["hold"])], []);
  expect(w).toEqual([]);
});

test("패키지 검사: 막는 이슈가 어느 패키지에도 없으면 사슬 경고. hold · 닫힌 막는 쪽은 빼고 본다", () => {
  const issues = [is(1), is(2), is(3, ["hold"]), is(4, [], "closed"), is(5)];
  const w = checkPackages([{ rank: 1, issue_ids: [2, 5] }], issues, [e(1, 2), e(3, 5), e(4, 5)]);
  expect(w).toEqual([{ rank: 1, kind: "chain", message: "#2를 막는 #1가 어느 패키지에도 없음" }]);
});

test("패키지 검사: 제대로면 경고가 없다", () => {
  const w = checkPackages([{ rank: 1, issue_ids: [1, 2] }, { rank: 2, issue_ids: [3] }], [is(1), is(2), is(3)], [e(1, 2), e(2, 3)]);
  expect(w).toEqual([]);
});
