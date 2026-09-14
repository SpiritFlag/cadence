// 직전 제안에서 이어가기. 코드가 먼저 판정하고(carryOver), claude 출력을 그 판정과 비교해 표시 · 경고를 붙인다(markPackages).
// 표시는 claude 말을 믿지 않고 여기서 정한다. claude는 유지 키와 앞지른 이유 문장만 준다.
import type { Edge } from "../graph/cycle";
import { orderable, type OrderIssue, type PackageWarning } from "../graph/order";

export type CarryIssue = OrderIssue & { title: string; body: string };

/** 제목 · 본문 해시. 라벨은 넣지 않는다 — 바뀐 이슈는 제목 · 본문이 달라진 것이다. */
export function issueHash(i: { title: string; body: string }): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(i.title);
  h.update("\0");
  h.update(i.body);
  return h.digest("hex").slice(0, 16);
}

/** 제안 때 순서에 든 이슈의 해시. 다음 제안이 새 이슈 · 바뀐 이슈를 가린다. 키는 이슈 id. */
export function snapshotOf(issues: CarryIssue[]): Record<string, string> {
  return Object.fromEntries(orderable(issues).map((i) => [String(i.id), issueHash(i)]));
}

export type PrevPackage = { rank: number; name: string; issue_ids: number[]; reason: string };
export type PrevProposal = { packages: PrevPackage[]; snapshot: Record<string, string> };

export type KeptPackage = {
  /** 이번 프롬프트에서 부르는 이름. 고친 유지 순서대로 K1, K2, … */
  key: string;
  name: string;
  reason: string;
  issue_ids: number[];
  prev_rank: number;
  /** 선 때문에 코드가 앞으로 당겼다. */
  moved_by_deps: boolean;
};

export type Carry = {
  /** 유지 패키지. 선 때문에 고친 순서. */
  kept: KeptPackage[];
  /** 직전 패키지의 이슈 중 닫혔거나 마일스톤이 붙은 것. */
  picked: number[];
  /** 일부만 뽑힌 패키지의 남은 이슈. */
  released: number[];
  /** 직전 제안 때 순서에 없던 이슈. */
  fresh: number[];
  /** 제목이나 본문이 달라진 이슈. 어디에 있든. */
  changed: number[];
  /** 유지 · 풀림 · 새 이슈가 아닌 나머지. 바뀐 이슈도 여기 들 수 있다. */
  waiting: number[];
};

/** 이슈마다 그 이슈를 거쳐서라도 막는 이슈들. */
function blockersOf(deps: Edge[]): (id: number) => Set<number> {
  const direct = new Map<number, number[]>();
  for (const d of deps) direct.set(d.blocked_id, [...(direct.get(d.blocked_id) ?? []), d.blocker_id]);
  const memo = new Map<number, Set<number>>();
  const walk = (id: number): Set<number> => {
    const hit = memo.get(id);
    if (hit) return hit;
    const out = new Set<number>();
    memo.set(id, out); // 순환이면 여기서 멈춘다. 제안은 순환이면 돌지 않는다.
    for (const b of direct.get(id) ?? []) {
      out.add(b);
      for (const x of walk(b)) out.add(x);
    }
    return out;
  };
  return walk;
}

export function carryOver(prev: PrevProposal, issues: CarryIssue[], deps: Edge[]): Carry {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const live = orderable(issues);
  const liveIds = new Set(live.map((i) => i.id));
  // 열린 목록에 없거나 닫혔거나 마일스톤이 붙었으면 뽑혔다.
  const isPicked = (id: number) => {
    const i = byId.get(id);
    return !i || i.state === "closed" || (i.milestone_number ?? null) !== null;
  };

  const picked: number[] = [];
  const released: number[] = [];
  const staying: { pkg: PrevPackage; ids: number[] }[] = [];
  for (const pkg of [...prev.packages].sort((a, b) => a.rank - b.rank)) {
    const gone = pkg.issue_ids.filter(isPicked);
    const rest = pkg.issue_ids.filter((id) => liveIds.has(id)); // hold는 조용히 빠진다
    picked.push(...gone);
    if (gone.length > 0) released.push(...rest);
    else if (rest.length > 0) staying.push({ pkg, ids: rest });
  }

  // 유지 패키지가 사슬을 어기면 막는 쪽 패키지를 앞으로 당긴다. 나머지는 직전 순서 그대로.
  const blockers = blockersOf(deps);
  const where = new Map<number, number>();
  staying.forEach((s, k) => s.ids.forEach((id) => where.set(id, k)));
  const before = staying.map((s, k) => {
    const set = new Set<number>();
    for (const id of s.ids) {
      for (const b of blockers(id)) {
        const j = where.get(b);
        if (j !== undefined && j !== k) set.add(j);
      }
    }
    return [...set].sort((a, b) => a - b);
  });
  const order: number[] = [];
  const seen = new Set<number>();
  const place = (k: number) => {
    if (seen.has(k)) return; // 놓였거나, 패키지끼리 순환이면 직전 순서로 둔다
    seen.add(k);
    for (const j of before[k]!) place(j);
    order.push(k);
  };
  staying.forEach((_, k) => place(k));
  const pos = new Map(order.map((k, p) => [k, p]));
  const kept: KeptPackage[] = order.map((k, p) => ({
    key: `K${p + 1}`,
    name: staying[k]!.pkg.name,
    reason: staying[k]!.pkg.reason,
    issue_ids: staying[k]!.ids,
    prev_rank: staying[k]!.pkg.rank,
    moved_by_deps: staying.some((_, j) => j < k && pos.get(j)! > p),
  }));

  const inKept = new Set(kept.flatMap((k) => k.issue_ids));
  const releasedIds = new Set(released);
  const fresh = live.filter((i) => !(String(i.id) in prev.snapshot)).map((i) => i.id);
  const freshIds = new Set(fresh);
  const changed = live.filter((i) => String(i.id) in prev.snapshot && prev.snapshot[String(i.id)] !== issueHash(i)).map((i) => i.id);
  const waiting = live.map((i) => i.id).filter((id) => !inKept.has(id) && !releasedIds.has(id) && !freshIds.has(id));
  return { kept, picked, released, fresh, changed, waiting };
}

export type CarriedPackage = { rank: number; issue_ids: number[]; keep: string | null; overtake_reason: string };

export type PackageMarks = {
  /** 유지한 패키지의 키. 새 패키지면 null. */
  keep: string | null;
  /** 새 · 바뀐 이슈로 유지 패키지를 앞질렀으면 claude가 준 이유. 이유가 비었으면 "". 앞지르지 않았으면 null. */
  overtake: string | null;
  /** 유지 패키지에 합류한 새 이슈. */
  joined: number[];
  /** 선 때문에 이동: 코드가 유지 순서를 고쳤거나, 막는 이슈를 끌어와 앞에 끼웠다. */
  moved_by_deps: boolean;
};

/**
 * claude 출력(순위순)을 이어가기 판정과 비교해 패키지마다 표시를, 어긋난 것마다 경고를 붙인다.
 * slots는 제안 하나의 패키지 수 상한. 칸이 다 차서 빠진 유지 패키지는 밀려난 것이라 경고하지 않는다.
 */
export function markPackages(
  packages: CarriedPackage[], carry: Carry, issues: { id: number; number: number }[], deps: Edge[], slots: number,
): { marks: PackageMarks[]; warnings: PackageWarning[] } {
  const numbers = new Map(issues.map((i) => [i.id, i.number]));
  const num = (id: number) => `#${numbers.get(id) ?? id}`;
  const warn = (rank: number | null, message: string): PackageWarning => ({ rank, kind: "carry", message });
  const warnings: PackageWarning[] = [];
  const keptIdx = new Map(carry.kept.map((k, i) => [k.key, i]));
  const fresh = new Set(carry.fresh);
  const urgent = new Set([...carry.fresh, ...carry.changed]);
  const blockers = blockersOf(deps);

  // 유지 키 풀기. 모르는 키 · 두 번 쓴 키는 유지로 치지 않는다.
  const keyAt: (string | null)[] = [];
  const posOf = new Map<string, number>();
  packages.forEach((p, pos) => {
    const key = p.keep?.trim() || null;
    if (key !== null && !keptIdx.has(key)) warnings.push(warn(p.rank, `모르는 유지 키 ${key}`));
    else if (key !== null && posOf.has(key)) warnings.push(warn(p.rank, `${key}를 두 번 유지함`));
    else if (key !== null) {
      posOf.set(key, pos);
      keyAt.push(key);
      return;
    }
    keyAt.push(null);
  });

  const full = packages.length >= slots;
  const marks = packages.map((p, pos): PackageMarks => {
    const key = keyAt[pos]!;
    const k = key === null ? null : carry.kept[keptIdx.get(key)!]!;
    const joined: number[] = [];
    if (k) {
      for (const id of k.issue_ids) if (!p.issue_ids.includes(id)) warnings.push(warn(p.rank, `${key}에서 ${num(id)}가 빠짐`));
      for (const id of p.issue_ids) {
        if (k.issue_ids.includes(id)) continue;
        if (fresh.has(id)) joined.push(id);
        else warnings.push(warn(p.rank, `${key}에 새 이슈가 아닌 ${num(id)}가 낌`));
      }
    }

    // 앞지른 유지 패키지: 직전 순서로 이 패키지보다 앞이던 것 중 뒤에 놓인 것. 새 패키지는 칸이 차서 빠진 것도 앞지른 것이다.
    const mine = k ? keptIdx.get(key!)! : carry.kept.length;
    const passed = carry.kept.filter((q, qi) => {
      if (qi >= mine) return false;
      const at = posOf.get(q.key);
      return at === undefined ? !k && full : at > pos;
    });
    let overtake: string | null = null;
    let moved = k?.moved_by_deps ?? false;
    if (passed.length > 0) {
      const names = passed.map((q) => q.key).join(" · ");
      const isUrgent = p.issue_ids.some((id) => urgent.has(id));
      const passedIds = passed.flatMap((q) => q.issue_ids);
      const blocks = p.issue_ids.some((id) => passedIds.some((x) => blockers(x).has(id)));
      if (isUrgent) {
        overtake = p.overtake_reason.trim();
        if (!overtake) warnings.push(warn(p.rank, `${names}를 앞질렀는데 이유가 없음`));
      }
      if (blocks) moved = true;
      if (!isUrgent && !blocks) {
        warnings.push(warn(p.rank, k ? `표시 없이 유지 순서가 바뀜 · ${key}가 ${names}보다 앞` : `새 · 바뀐 이슈 없이 ${names}를 앞지름`));
      }
    }
    return { keep: key, overtake, joined, moved_by_deps: moved };
  });

  if (!full) {
    for (const q of carry.kept) if (!posOf.has(q.key)) warnings.push(warn(null, `칸이 남는데 ${q.key} ${q.name}가 사라짐`));
  }
  return { marks, warnings };
}
