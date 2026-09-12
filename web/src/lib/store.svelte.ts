import type { Issue, Repo } from "../../../server/sync";
import type { Dep } from "../../../server/deps";
import { api } from "./api";

export const store = $state({
  repos: [] as Repo[],
  issues: [] as Issue[],
  deps: [] as Dep[],
  selected: null as Issue | null,
  busy: false,
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
  [store.repos, store.issues, store.deps] = await Promise.all([api.repos(), api.issues(), api.deps()]);
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
