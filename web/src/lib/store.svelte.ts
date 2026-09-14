import type { Issue, Milestone, Repo } from "../../../server/sync";
import type { Dep } from "../../../server/deps";
import type { Proposal, LabelChange } from "../../../server/propose";
import type { ApplyOutcome } from "../../../server/apply";
import { cycleEdges } from "../../../server/graph/cycle";
import { api } from "./api";

export const store = $state({
  repos: [] as Repo[],
  /** 고른 레포. 그래프 · 상세 · 패키지가 이 레포 것만 본다. */
  repoId: null as number | null,
  issues: [] as Issue[],
  deps: [] as Dep[],
  /** 고른 레포의 마일스톤. 번호순, 닫힌 것 포함. */
  milestones: [] as Milestone[],
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

// 고른 레포는 이 브라우저에만 둔다. 저장소가 막혀 있으면 첫 레포로 시작한다.
const REPO_KEY = "cadence.repo";

function savedRepo(): number | null {
  try {
    const v = localStorage.getItem(REPO_KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

function saveRepo(id: number | null) {
  try {
    if (id === null) localStorage.removeItem(REPO_KEY);
    else localStorage.setItem(REPO_KEY, String(id));
  } catch {
    // 저장 못 해도 이번 세션은 그대로 쓴다.
  }
}

async function reload() {
  store.repos = await api.repos();
  const want = store.repoId ?? savedRepo();
  store.repoId = store.repos.find((r) => r.id === want)?.id ?? store.repos[0]?.id ?? null;
  saveRepo(store.repoId);
  if (store.repoId === null) {
    [store.issues, store.deps, store.proposal, store.milestones] = [[], [], null, []];
  } else {
    const repo = store.repoId;
    [store.issues, store.deps, store.proposal, store.milestones] = await Promise.all([
      api.issues(repo), api.deps(repo), api.latestProposal(repo), api.milestones(repo),
    ]);
  }
  if (store.selected) store.selected = store.issues.find((i) => i.id === store.selected!.id) ?? null;
}

/** 레포를 바꾸면 그 레포에 딸린 선택 · 강조 · 승인 상태를 버린다. */
function switchRepo(id: number) {
  store.repoId = id;
  saveRepo(id);
  store.selected = null;
  store.highlight = [];
  store.rejected = {};
  store.applyResult = null;
}

/** 서버에 있는 것을 그대로 읽는다. 동기화는 안 한다. */
export function load() {
  return run(reload);
}

/** 레포를 등록하고 바로 동기화한 뒤 그 레포로 넘어간다. */
export function addRepo(full: string) {
  return run(async () => {
    const repo = await api.addRepo(full);
    await api.sync();
    switchRepo(repo.id);
    await reload();
  });
}

/** 헤더 레포 칩. */
export function selectRepo(id: number) {
  if (id === store.repoId) return;
  switchRepo(id);
  return run(reload);
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
    if (store.repoId !== null) store.deps = await api.deps(store.repoId);
  });
}

export function removeDep(blocker_id: number, blocked_id: number) {
  return run(async () => {
    await api.removeDep(blocker_id, blocked_id);
    if (store.repoId !== null) store.deps = await api.deps(store.repoId);
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

/** [제안]. 고른 레포로 claude가 돌아 몇 초 걸린다. */
export async function runPropose() {
  if (store.repoId === null) return;
  const repo = store.repoId;
  store.proposing = true;
  store.error = null;
  try {
    const proposal = await api.propose(repo);
    if (store.repoId !== repo) return; // 도는 사이 레포를 바꿨으면 그 레포 화면을 덮지 않는다
    store.proposal = proposal;
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
