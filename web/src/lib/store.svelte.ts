import type { Issue, Repo } from "../../../server/sync";
import { api } from "./api";

export const store = $state({
  repos: [] as Repo[],
  issues: [] as Issue[],
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

/** 서버에 있는 것을 그대로 읽는다. 동기화는 안 한다. */
export function load() {
  return run(async () => {
    [store.repos, store.issues] = await Promise.all([api.repos(), api.issues()]);
    if (store.selected) store.selected = store.issues.find((i) => i.id === store.selected!.id) ?? null;
  });
}

/** 레포를 등록하고 바로 동기화한다. */
export function addRepo(full: string) {
  return run(async () => {
    await api.addRepo(full);
    await api.sync();
    [store.repos, store.issues] = await Promise.all([api.repos(), api.issues()]);
  });
}

/** 새로고침: 동기화 뒤 다시 읽는다. */
export function refresh() {
  return run(async () => {
    await api.sync();
    [store.repos, store.issues] = await Promise.all([api.repos(), api.issues()]);
    if (store.selected) store.selected = store.issues.find((i) => i.id === store.selected!.id) ?? null;
  });
}

export function select(issue: Issue | null) {
  store.selected = issue;
}

export function repoName(repoId: number): string {
  const r = store.repos.find((x) => x.id === repoId);
  return r ? `${r.owner}/${r.name}` : `#${repoId}`;
}
