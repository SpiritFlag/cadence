import { test, expect } from "bun:test";
import type { Edge } from "../graph/cycle";
import { carryOver, markPackages, snapshotOf, type Carry, type CarriedPackage, type CarryIssue, type PrevPackage } from "./carry";

const is = (id: number, over: Partial<CarryIssue> = {}): CarryIssue => ({
  id, number: id, labels: [], state: "open", milestone_number: null, title: `제목 ${id}`, body: `본문 ${id}`, ...over,
});
const e = (a: number, b: number): Edge => ({ blocker_id: a, blocked_id: b });
const pkg = (rank: number, issue_ids: number[]): PrevPackage => ({ rank, name: `P${rank}`, issue_ids, reason: `이유 ${rank}` });
const range = (n: number) => Array.from({ length: n }, (_, k) => is(k + 1));
const keptView = (c: Carry) => c.kept.map((k) => [k.key, k.name, k.issue_ids, k.moved_by_deps]);

// ---- carryOver ----

test("1순위가 마일스톤에 들어가면 뽑혔고, 나머지 유지 패키지가 순서대로 당겨진다", () => {
  const before = range(5);
  const prev = { packages: [1, 2, 3, 4, 5].map((r) => pkg(r, [r])), snapshot: snapshotOf(before) };
  const now = before.map((i) => (i.id === 1 ? { ...i, milestone_number: 5 } : i));
  const c = carryOver(prev, now, []);
  expect(keptView(c)).toEqual([["K1", "P2", [2], false], ["K2", "P3", [3], false], ["K3", "P4", [4], false], ["K4", "P5", [5], false]]);
  expect([c.picked, c.released, c.fresh, c.changed, c.waiting]).toEqual([[1], [], [], [], []]);
});

test("일부만 뽑힌 패키지는 풀리고, 닫힘 · 목록에서 사라짐도 뽑힘이고, hold는 조용히 빠진다", () => {
  const prev = { packages: [pkg(1, [1, 2]), pkg(2, [3, 4]), pkg(3, [5]), pkg(4, [6])], snapshot: snapshotOf(range(6)) };
  const now = [is(1, { state: "closed" }), is(2), is(3), is(4, { labels: ["hold"] }), is(5)]; // 6은 목록에 없다
  const c = carryOver(prev, now, []);
  expect(keptView(c)).toEqual([["K1", "P2", [3], false], ["K2", "P3", [5], false]]);
  expect(c.picked).toEqual([1, 6]);
  expect(c.released).toEqual([2]);
  expect(c.waiting).toEqual([]);
});

test("새 이슈 · 제목이나 본문이 바뀐 이슈 · 대기를 가린다. 라벨만 바뀐 것은 바뀐 이슈가 아니다", () => {
  const prev = { packages: [pkg(1, [1])], snapshot: snapshotOf(range(3)) };
  const now = [is(1), is(2, { body: "급하다" }), is(3, { labels: ["p1"] }), is(4)];
  const c = carryOver(prev, now, []);
  expect(c.fresh).toEqual([4]);
  expect(c.changed).toEqual([2]);
  expect(c.waiting).toEqual([2, 3]);
});

test("선이 유지 순서를 어기면 막는 쪽 패키지를 앞으로 당기고 표시한다. 대기 이슈를 거친 사슬도 본다", () => {
  const prev = { packages: [pkg(1, [1]), pkg(2, [2]), pkg(3, [3])], snapshot: snapshotOf(range(4)) };
  const c = carryOver(prev, range(4), [e(3, 4), e(4, 1)]); // 3 → 4(대기) → 1
  expect(keptView(c)).toEqual([["K1", "P3", [3], true], ["K2", "P1", [1], false], ["K3", "P2", [2], false]]);
});

// ---- markPackages ----

// 직전: P1[1] P2[2], 순서에 1 2 3. 지금 기본: 3은 대기, 4는 새 이슈.
const base = (now: CarryIssue[] = [is(1), is(2), is(3), is(4)], deps: Edge[] = []) =>
  carryOver({ packages: [pkg(1, [1]), pkg(2, [2])], snapshot: snapshotOf(range(3)) }, now, deps);
const out = (rank: number, issue_ids: number[], keep: string | null = null, overtake_reason = ""): CarriedPackage => ({ rank, issue_ids, keep, overtake_reason });
const nums = range(4).map((i) => ({ id: i.id, number: i.number }));
const view = (r: ReturnType<typeof markPackages>) => r.marks.map((m) => [m.keep, m.overtake, m.joined, m.moved_by_deps]);
const messages = (r: ReturnType<typeof markPackages>) => r.warnings.map((w) => w.message);

test("유지 순서대로 두고 뒤 칸을 채우면 표시도 경고도 없다", () => {
  const r = markPackages([out(1, [1], "K1"), out(2, [2], "K2"), out(3, [3, 4])], base(), nums, [], 5);
  expect(view(r)).toEqual([["K1", null, [], false], ["K2", null, [], false], [null, null, [], false]]);
  expect(r.warnings).toEqual([]);
});

test("새 이슈가 급해 앞지르면 앞지름과 이유가 붙는다. 이유가 없거나, 새 · 바뀐 이슈 없이 앞지르면 경고", () => {
  const urgent = markPackages([out(1, [4], null, "장애라 급하다"), out(2, [1], "K1"), out(3, [2], "K2")], base(), nums, [], 5);
  expect(view(urgent)[0]).toEqual([null, "장애라 급하다", [], false]);
  expect(urgent.warnings).toEqual([]);

  const silent = markPackages([out(1, [4]), out(2, [1], "K1"), out(3, [2], "K2")], base(), nums, [], 5);
  expect(view(silent)[0]).toEqual([null, "", [], false]);
  expect(messages(silent)).toEqual(["K1 · K2를 앞질렀는데 이유가 없음"]);

  const plain = markPackages([out(1, [3]), out(2, [1], "K1"), out(3, [2], "K2")], base(), nums, [], 5);
  expect(view(plain)[0]).toEqual([null, null, [], false]);
  expect(plain.warnings).toEqual([{ rank: 1, kind: "carry", message: "새 · 바뀐 이슈 없이 K1 · K2를 앞지름" }]);
});

test("바뀐 이슈를 담은 유지 패키지는 패키지째 앞지른다. 바뀐 것 없이 유지 순서를 바꾸면 경고", () => {
  const changed = base([is(1), is(2, { body: "급한 이유가 생겼다" }), is(3), is(4)]);
  const r = markPackages([out(1, [2], "K2", "본문에 급한 이유가 생겼다"), out(2, [1], "K1")], changed, nums, [], 5);
  expect(view(r)).toEqual([["K2", "본문에 급한 이유가 생겼다", [], false], ["K1", null, [], false]]);
  expect(r.warnings).toEqual([]);

  const swapped = markPackages([out(1, [2], "K2"), out(2, [1], "K1")], base(), nums, [], 5);
  expect(swapped.warnings).toEqual([{ rank: 1, kind: "carry", message: "표시 없이 유지 순서가 바뀜 · K2가 K1보다 앞" }]);
});

test("새 이슈가 유지 패키지에 들어가면 ＋합류. 새 이슈 아닌 것이 끼거나 유지 이슈가 빠지면 경고", () => {
  const r = markPackages([out(1, [1, 4], "K1"), out(2, [2, 3], "K2")], base(), nums, [], 5);
  expect(view(r)).toEqual([["K1", null, [4], false], ["K2", null, [], false]]);
  expect(r.warnings).toEqual([{ rank: 2, kind: "carry", message: "K2에 새 이슈가 아닌 #3가 낌" }]);

  const dropped = markPackages([out(1, [], "K1"), out(2, [2], "K2"), out(3, [1])], base(), nums, [], 5);
  expect(messages(dropped)).toEqual(["K1에서 #1가 빠짐"]);
});

test("막는 이슈를 대기에서 끌어와 앞에 끼우면 선 때문에 이동. 코드가 고친 유지 순서도 그 표시를 든다", () => {
  const deps = [e(3, 1)];
  const r = markPackages([out(1, [3]), out(2, [1], "K1"), out(3, [2], "K2")], base(undefined, deps), nums, deps, 5);
  expect(view(r)[0]).toEqual([null, null, [], true]);
  expect(r.warnings).toEqual([]);

  const deps4 = [e(3, 4), e(4, 1)];
  const c = carryOver({ packages: [pkg(1, [1]), pkg(2, [2]), pkg(3, [3])], snapshot: snapshotOf(range(4)) }, range(4), deps4);
  const kept = markPackages([out(1, [3], "K1"), out(2, [1, 4], "K2"), out(3, [2], "K3")], c, nums, deps4, 5);
  expect(kept.marks.map((m) => m.moved_by_deps)).toEqual([true, false, false]);
});

test("칸이 남는데 유지 패키지가 사라지면 경고. 칸이 다 차서 밀려난 것은 경고가 없다", () => {
  const gone = markPackages([out(1, [2], "K2")], base(), nums, [], 5);
  expect(gone.warnings).toEqual([{ rank: null, kind: "carry", message: "칸이 남는데 K1 P1가 사라짐" }]);

  const pushed = markPackages([out(1, [4], null, "급함"), out(2, [1], "K1")], base(), nums, [], 2); // K2가 밀려남
  expect(view(pushed)).toEqual([[null, "급함", [], false], ["K1", null, [], false]]);
  expect(pushed.warnings).toEqual([]);
});

test("모르는 유지 키 · 두 번 쓴 유지 키는 유지로 치지 않고 경고", () => {
  const r = markPackages([out(1, [1], "K1"), out(2, [2], "K9"), out(3, [3], "K1")], base(), nums, [], 5);
  expect(view(r).map((v) => v[0])).toEqual(["K1", null, null]);
  expect(messages(r)).toEqual(["모르는 유지 키 K9", "K1를 두 번 유지함", "칸이 남는데 K2 P2가 사라짐"]);
});
