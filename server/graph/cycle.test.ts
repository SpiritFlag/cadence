import { test, expect } from "bun:test";
import { cycleEdges, hasCycle, edgeKey, type Edge } from "./cycle";

const e = (a: number, b: number): Edge => ({ blocker_id: a, blocked_id: b });
const keys = (edges: Edge[]) => edges.map(edgeKey).sort();

test("선이 없거나 사슬뿐이면 순환이 없다", () => {
  expect(cycleEdges([])).toEqual([]);
  expect(hasCycle([e(1, 2), e(2, 3), e(3, 4)])).toBe(false);
});

test("둘이 서로 막으면 두 선 다 순환이다", () => {
  expect(keys(cycleEdges([e(1, 2), e(2, 1)]))).toEqual(["1->2", "2->1"]);
});

test("셋이 돌면 세 선 다 순환이다", () => {
  expect(keys(cycleEdges([e(1, 2), e(2, 3), e(3, 1)]))).toEqual(["1->2", "2->3", "3->1"]);
});

test("다이아몬드는 순환이 아니다", () => {
  expect(hasCycle([e(1, 2), e(1, 3), e(2, 4), e(3, 4)])).toBe(false);
});

test("순환에 붙은 꼬리는 순환이 아니다", () => {
  const edges = [e(1, 2), e(2, 3), e(3, 1), e(3, 4), e(0, 1)];
  expect(keys(cycleEdges(edges))).toEqual(["1->2", "2->3", "3->1"]);
});

test("자기 자신을 가리키는 선은 순환이다", () => {
  expect(keys(cycleEdges([e(5, 5), e(5, 6)]))).toEqual(["5->5"]);
});
