import type { Issue, Repo } from "../../../server/sync";
import type { Dep } from "../../../server/deps";
import type { Proposal } from "../../../server/propose";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  if (res.status === 204) return undefined as T;
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${path}`);
  return data;
}

export const api = {
  repos: () => call<Repo[]>("/api/repos"),
  addRepo: (full: string) => call<Repo>("/api/repos", { method: "POST", body: JSON.stringify({ full }) }),
  sync: () => call<Record<string, number>>("/api/sync", { method: "POST" }),
  issues: () => call<Issue[]>("/api/issues?state=open"),
  deps: () => call<Dep[]>("/api/deps"),
  addDep: (blocker_id: number, blocked_id: number) =>
    call<Dep>("/api/deps", { method: "POST", body: JSON.stringify({ blocker_id, blocked_id }) }),
  removeDep: (blocker_id: number, blocked_id: number) =>
    call<void>(`/api/deps/${blocker_id}/${blocked_id}`, { method: "DELETE" }),
  latestProposal: () => call<Proposal | null>("/api/proposals/latest"),
  propose: () => call<Proposal>("/api/propose", { method: "POST" }),
};
