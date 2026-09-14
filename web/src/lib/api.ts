import type { Issue, Milestone, Repo } from "../../../server/sync";
import type { Dep } from "../../../server/deps";
import type { Proposal } from "../../../server/propose";
import type { ApplyChange, ApplyOutcome } from "../../../server/apply";
import type { GraphState } from "../../../server/graphgen";

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
  issues: (repo: number) => call<Issue[]>(`/api/issues?state=open&repo=${repo}`),
  deps: (repo: number) => call<Dep[]>(`/api/deps?repo=${repo}`),
  milestones: (repo: number) => call<Milestone[]>(`/api/milestones?repo=${repo}`),
  addDep: (blocker_id: number, blocked_id: number) =>
    call<Dep>("/api/deps", { method: "POST", body: JSON.stringify({ blocker_id, blocked_id }) }),
  removeDep: (blocker_id: number, blocked_id: number) =>
    call<void>(`/api/deps/${blocker_id}/${blocked_id}`, { method: "DELETE" }),
  latestProposal: (repo: number) => call<Proposal | null>(`/api/proposals/latest?repo=${repo}`),
  propose: (repo_id: number) => call<Proposal>("/api/propose", { method: "POST", body: JSON.stringify({ repo_id }) }),
  graph: (repo: number) => call<GraphState>(`/api/graph/latest?repo=${repo}`),
  generateGraph: (repo_id: number) => call<GraphState>("/api/graph/generate", { method: "POST", body: JSON.stringify({ repo_id }) }),
  approveSuggestion: (id: number) => call<{ result: "applied" | "stale" }>(`/api/graph/suggestions/${id}/approve`, { method: "POST" }),
  rejectSuggestion: (id: number) => call<void>(`/api/graph/suggestions/${id}/reject`, { method: "POST" }),
  apply: (changes: ApplyChange[]) =>
    call<{ outcomes: ApplyOutcome[]; synced: Record<string, number> | null }>("/api/apply", { method: "POST", body: JSON.stringify({ changes }) }),
};
