import type { Database } from "bun:sqlite";
import type { IssueSource } from "../github/gh";

export type Repo = { id: number; owner: string; name: string; added_at: string };
export type Issue = {
  id: number;
  repo_id: number;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  updated_at: string;
  closed_at: string | null;
  synced_at: string;
};

type IssueRow = Omit<Issue, "labels"> & { labels: string };

export function parseFullName(full: string): { owner: string; name: string } {
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(full.trim());
  if (!m) throw new Error(`레포 이름은 owner/name 꼴이어야 한다: ${full}`);
  return { owner: m[1]!, name: m[2]! };
}

/** 없으면 넣고, 있으면 그대로. 어느 쪽이든 행을 돌려준다. */
export function addRepo(db: Database, full: string): Repo {
  const { owner, name } = parseFullName(full);
  db.run("insert or ignore into repos (owner, name) values (?, ?)", [owner, name]);
  return db
    .query<Repo, [string, string]>("select * from repos where owner = ? and name = ?")
    .get(owner, name)!;
}

export function listRepos(db: Database): Repo[] {
  return db.query<Repo, []>("select * from repos order by id").all();
}

/** 한 레포의 이슈를 원천에서 받아 upsert한다. 돌아오는 수는 받은 이슈 수. */
export async function syncRepo(db: Database, repo: Repo, source: IssueSource): Promise<number> {
  const issues = await source(repo.owner, repo.name);
  const now = new Date().toISOString();
  const upsert = db.query(
    `insert into issues (repo_id, number, title, body, state, labels, updated_at, closed_at, synced_at)
     values ($repo_id, $number, $title, $body, $state, $labels, $updated_at, $closed_at, $synced_at)
     on conflict (repo_id, number) do update set
       title = excluded.title, body = excluded.body, state = excluded.state, labels = excluded.labels,
       updated_at = excluded.updated_at, closed_at = excluded.closed_at, synced_at = excluded.synced_at`,
  );
  db.transaction(() => {
    for (const i of issues) {
      upsert.run({
        repo_id: repo.id,
        number: i.number,
        title: i.title,
        body: i.body ?? "",
        state: i.state.toLowerCase(),
        labels: JSON.stringify(i.labels.map((l) => l.name)),
        updated_at: i.updatedAt,
        closed_at: i.closedAt,
        synced_at: now,
      });
    }
  })();
  return issues.length;
}

export async function syncAll(db: Database, source: IssueSource): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const repo of listRepos(db)) {
    result[`${repo.owner}/${repo.name}`] = await syncRepo(db, repo, source);
  }
  return result;
}

export function listIssues(db: Database, opts: { state?: "open" | "closed" } = {}): Issue[] {
  const rows = opts.state
    ? db.query<IssueRow, [string]>("select * from issues where state = ? order by repo_id, number").all(opts.state)
    : db.query<IssueRow, []>("select * from issues order by repo_id, number").all();
  return rows.map((r) => ({ ...r, labels: JSON.parse(r.labels) as string[] }));
}
