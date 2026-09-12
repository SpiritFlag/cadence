import type { Issue, Repo } from "../../../server/sync";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${path}`);
  return data;
}

export const api = {
  repos: () => call<Repo[]>("/api/repos"),
  addRepo: (full: string) => call<Repo>("/api/repos", { method: "POST", body: JSON.stringify({ full }) }),
  sync: () => call<Record<string, number>>("/api/sync", { method: "POST" }),
  issues: () => call<Issue[]>("/api/issues?state=open"),
};
