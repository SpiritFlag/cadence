// 후보 순서 · 승격 제안 · 패키지 검사. 플레인 TS — 프론트도 가져다 쓴다.
import { cycleEdges, type Edge } from "./cycle";

export type Priority = "p1" | "p2" | "p3";
export const PRIORITIES: Priority[] = ["p1", "p2", "p3"];
const RANK: Record<Priority, number> = { p1: 1, p2: 2, p3: 3 };

/** 순서에 필요한 최소 이슈 모양. sync의 Issue가 그대로 맞는다. */
export type OrderIssue = { id: number; number: number; labels: string[]; state: "open" | "closed" };

export type Promotion = { issue_id: number; from: Priority; to: Priority };

export type CandidateOrder = {
  /** 이슈 id. 순환이 있으면 비어 있다. */
  order: number[];
  cycles: Edge[];
  promotions: Promotion[];
  /** 승격을 반영한 우선순위. 순서를 매길 때 쓴 값. */
  effective: Record<number, Priority>;
};

/** 가장 높은 p 라벨. 없으면 p3. */
export function priorityOf(labels: string[]): Priority {
  let best: Priority = "p3";
  for (const l of labels) if (l in RANK && RANK[l as Priority] < RANK[best]) best = l as Priority;
  return best;
}

export const isHold = (labels: string[]) => labels.includes("hold");

/** 순서에 드는 이슈: 열려 있고 hold가 아닌 것. */
export function orderable<T extends OrderIssue>(issues: T[]): T[] {
  return issues.filter((i) => i.state === "open" && !isHold(i.labels));
}

export function candidateOrder(issues: OrderIssue[], deps: Edge[]): CandidateOrder {
  const nodes = orderable(issues);
  const ids = new Set(nodes.map((i) => i.id));
  const edges = deps.filter((d) => ids.has(d.blocker_id) && ids.has(d.blocked_id));

  const effective: Record<number, Priority> = {};
  for (const i of nodes) effective[i.id] = priorityOf(i.labels);

  const cycles = cycleEdges(edges);
  if (cycles.length > 0) return { order: [], cycles, promotions: [], effective };

  // 승격 전파: 막히는 쪽이 높으면 막는 쪽도 그만큼. 고정점까지.
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of edges) {
      const a = effective[e.blocker_id]!;
      const b = effective[e.blocked_id]!;
      if (RANK[b] < RANK[a]) {
        effective[e.blocker_id] = b;
        changed = true;
      }
    }
  }
  const promotions: Promotion[] = nodes
    .filter((i) => effective[i.id] !== priorityOf(i.labels))
    .map((i) => ({ issue_id: i.id, from: priorityOf(i.labels), to: effective[i.id]! }));

  // Kahn. 준비된 것 중 우선순위 높은 것, 같으면 번호 작은 것.
  const indeg = new Map<number, number>();
  const out = new Map<number, number[]>();
  for (const i of nodes) {
    indeg.set(i.id, 0);
    out.set(i.id, []);
  }
  for (const e of edges) {
    indeg.set(e.blocked_id, indeg.get(e.blocked_id)! + 1);
    out.get(e.blocker_id)!.push(e.blocked_id);
  }
  const byId = new Map(nodes.map((i) => [i.id, i]));
  const pick = (a: number, b: number) => {
    const ra = RANK[effective[a]!];
    const rb = RANK[effective[b]!];
    if (ra !== rb) return ra - rb;
    return byId.get(a)!.number - byId.get(b)!.number;
  };
  const ready = nodes.filter((i) => indeg.get(i.id) === 0).map((i) => i.id);
  const order: number[] = [];
  while (ready.length > 0) {
    ready.sort(pick);
    const v = ready.shift()!;
    order.push(v);
    for (const w of out.get(v)!) {
      indeg.set(w, indeg.get(w)! - 1);
      if (indeg.get(w) === 0) ready.push(w);
    }
  }
  return { order, cycles, promotions, effective };
}

// ---- 패키지 검사 ----

export const PACKAGE_MAX = 5;

export type PackageLike = { rank: number; issue_ids: number[] };

export type PackageWarning = {
  /** 어느 패키지에 붙는 경고인가. */
  rank: number;
  kind: "size" | "chain" | "duplicate" | "unknown";
  message: string;
};

/** 사슬 보존 · 크기 상한 · 중복 · 모르는 이슈를 검사한다. 패키지에 안 든 이슈는 대기라 경고하지 않는다. LLM 출력을 믿지 않는다. */
export function checkPackages(packages: PackageLike[], issues: OrderIssue[], deps: Edge[]): PackageWarning[] {
  const warnings: PackageWarning[] = [];
  const expected = new Set(orderable(issues).map((i) => i.id));
  const byNumber = new Map(issues.map((i) => [i.id, i.number]));
  const num = (id: number) => `#${byNumber.get(id) ?? id}`;

  const where = new Map<number, number>(); // issue_id → rank
  for (const p of packages) {
    if (p.issue_ids.length > PACKAGE_MAX) {
      warnings.push({ rank: p.rank, kind: "size", message: `이슈 ${p.issue_ids.length}개. 상한은 ${PACKAGE_MAX}` });
    }
    for (const id of p.issue_ids) {
      if (!expected.has(id)) {
        warnings.push({ rank: p.rank, kind: "unknown", message: `${num(id)}는 순서에 들지 않는 이슈` });
        continue;
      }
      if (where.has(id)) {
        warnings.push({ rank: p.rank, kind: "duplicate", message: `${num(id)}가 ${where.get(id)}순위에도 있음` });
        continue;
      }
      where.set(id, p.rank);
    }
  }
  for (const e of deps) {
    const a = where.get(e.blocker_id);
    const b = where.get(e.blocked_id);
    if (b === undefined) continue;
    // 막는 쪽이 순서에 드는데 어느 패키지에도 없으면 사슬이 끊긴 것이다. 닫힌 · hold 막는 쪽은 순서에 없다.
    if (a === undefined && expected.has(e.blocker_id)) {
      warnings.push({ rank: b, kind: "chain", message: `${num(e.blocked_id)}를 막는 ${num(e.blocker_id)}가 어느 패키지에도 없음` });
    } else if (a !== undefined && a > b) {
      warnings.push({ rank: b, kind: "chain", message: `${num(e.blocked_id)}를 막는 ${num(e.blocker_id)}가 ${a}순위에 있음` });
    }
  }
  return warnings;
}
