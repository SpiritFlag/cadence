import type { Issue, Repo } from "../../../server/sync";
import type { Dep } from "../../../server/deps";
import type { Proposal, LabelChange } from "../../../server/propose";
import type { ApplyOutcome } from "../../../server/apply";
import { cycleEdges } from "../../../server/graph/cycle";
import { api } from "./api";

export const store = $state({
  repos: [] as Repo[],
  issues: [] as Issue[],
  deps: [] as Dep[],
  selected: null as Issue | null,
  proposal: null as Proposal | null,
  /** 패키지 카드에 마우스를 올렸을 때 강조할 이슈 id */
  highlight: [] as number[],
  /** 체크를 푼 라벨 변경. 키는 issue_id. 없으면 승인. */
  rejected: {} as Record<number, boolean>,
  applyResult: null as ApplyOutcome[] | null,
  busy: false,
  proposing: false,
  applying: false,
  error: null as string | null,
});

async function run(work: () => Promise<void>) {
  store.busy = true;
  store.error = null;
  try {
    await work();
  } catch (e) {
    store.error = (e as Error).message;
  } finally {
    store.busy = false;
  }
}

async function reload() {
  [store.repos, store.issues, store.deps, store.proposal] = await Promise.all([api.repos(), api.issues(), api.deps(), api.latestProposal()]);
  if (store.selected) store.selected = store.issues.find((i) => i.id === store.selected!.id) ?? null;
}

/** 서버에 있는 것을 그대로 읽는다. 동기화는 안 한다. */
export function load() {
  return run(reload);
}

/** 레포를 등록하고 바로 동기화한다. */
export function addRepo(full: string) {
  return run(async () => {
    await api.addRepo(full);
    await api.sync();
    await reload();
  });
}

/** 새로고침: 동기화 뒤 다시 읽는다. */
export function refresh() {
  return run(async () => {
    await api.sync();
    await reload();
  });
}

export function select(issue: Issue | null) {
  store.selected = issue;
}

/** blocker가 blocked를 막는다. */
export function addDep(blocker_id: number, blocked_id: number) {
  return run(async () => {
    await api.addDep(blocker_id, blocked_id);
    store.deps = await api.deps();
  });
}

export function removeDep(blocker_id: number, blocked_id: number) {
  return run(async () => {
    await api.removeDep(blocker_id, blocked_id);
    store.deps = await api.deps();
  });
}

export function repoName(repoId: number): string {
  const r = store.repos.find((x) => x.id === repoId);
  return r ? `${r.owner}/${r.name}` : `#${repoId}`;
}

export function issueById(id: number): Issue | undefined {
  return store.issues.find((i) => i.id === id);
}

/** 이 이슈를 막는 이슈들. */
export function blockersOf(id: number): Issue[] {
  return store.deps.filter((d) => d.blocked_id === id).map((d) => issueById(d.blocker_id)).filter((i): i is Issue => !!i);
}

/** 이 이슈가 막는 이슈들. */
export function blockedBy(id: number): Issue[] {
  return store.deps.filter((d) => d.blocker_id === id).map((d) => issueById(d.blocked_id)).filter((i): i is Issue => !!i);
}

/** 열린 이슈 사이의 순환 선 수. 0이 아니면 제안을 돌리지 않는다. */
export function cycleCount(): number {
  const ids = new Set(store.issues.map((i) => i.id));
  return cycleEdges(store.deps.filter((d) => ids.has(d.blocker_id) && ids.has(d.blocked_id))).length;
}

/** [제안]. claude가 돌아 몇 초 걸린다. */
export async function runPropose() {
  store.proposing = true;
  store.error = null;
  try {
    store.proposal = await api.propose();
    store.rejected = {};
    store.applyResult = null;
  } catch (e) {
    store.error = (e as Error).message;
  } finally {
    store.proposing = false;
  }
}

export function setHighlight(ids: number[]) {
  store.highlight = ids;
}

/** 제안 전체의 라벨 변경. 같은 이슈는 앞 패키지 것만. */
export function allChanges(): LabelChange[] {
  const seen = new Set<number>();
  const out: LabelChange[] = [];
  for (const p of store.proposal?.packages ?? []) {
    for (const c of p.label_changes) {
      if (seen.has(c.issue_id)) continue;
      seen.add(c.issue_id);
      out.push(c);
    }
  }
  return out;
}

export function approvedChanges(): LabelChange[] {
  return allChanges().filter((c) => !store.rejected[c.issue_id]);
}

export function toggleChange(issue_id: number) {
  store.rejected[issue_id] = !store.rejected[issue_id];
}

/** [승인한 라벨 변경 반영]. 서버가 건마다 gh를 부르고, 성공한 건이 있으면 다시 가져온다. */
export async function runApply() {
  const changes = approvedChanges();
  if (changes.length === 0) return;
  store.applying = true;
  store.error = null;
  try {
    const r = await api.apply(changes);
    store.applyResult = r.outcomes;
    if (r.synced) await reload();
  } catch (e) {
    store.error = (e as Error).message;
  } finally {
    store.applying = false;
  }
}

export function outcomeOf(issue_id: number): ApplyOutcome | undefined {
  return store.applyResult?.find((o) => o.issue_id === issue_id);
}
