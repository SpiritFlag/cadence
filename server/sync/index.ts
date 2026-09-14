import type { Database } from "bun:sqlite";
import type { IssueSource, MilestoneSource } from "../github/gh";

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
  /** 붙은 마일스톤의 레포 안 번호. 없으면 null. */
  milestone_number: number | null;
};

export type Milestone = {
  id: number;
  repo_id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  created_at: string;
  closed_at: string | null;
  synced_at: string;
  /** 붙은 이슈 번호. 닫힌 이슈도 든다. */
  issues: number[];
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

/**
 * 한 레포의 이슈를 원천에서 받아 upsert한다. 돌아오는 수는 받은 이슈 수.
 * 마일스톤 원천을 주면 마일스톤도 upsert하고 원천에 없는 것은 지운다. 안 주면 마일스톤 목록은 그대로다.
 */
export async function syncRepo(db: Database, repo: Repo, source: IssueSource, milestones?: MilestoneSource): Promise<number> {
  const [issues, ms] = await Promise.all([source(repo.owner, repo.name), milestones?.(repo.owner, repo.name)]);
  const now = new Date().toISOString();
  const upsert = db.query(
    `insert into issues (repo_id, number, title, body, state, labels, updated_at, closed_at, synced_at, milestone_number)
     values ($repo_id, $number, $title, $body, $state, $labels, $updated_at, $closed_at, $synced_at, $milestone_number)
     on conflict (repo_id, number) do update set
       title = excluded.title, body = excluded.body, state = excluded.state, labels = excluded.labels,
       updated_at = excluded.updated_at, closed_at = excluded.closed_at, synced_at = excluded.synced_at,
       milestone_number = excluded.milestone_number`,
  );
  const upsertMilestone = db.query(
    `insert into milestones (repo_id, number, title, state, created_at, closed_at, synced_at)
     values ($repo_id, $number, $title, $state, $created_at, $closed_at, $synced_at)
     on conflict (repo_id, number) do update set
       title = excluded.title, state = excluded.state, created_at = excluded.created_at,
       closed_at = excluded.closed_at, synced_at = excluded.synced_at`,
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
        milestone_number: i.milestone?.number ?? null,
      });
    }
    if (ms) {
      for (const m of ms) {
        upsertMilestone.run({
          repo_id: repo.id,
          number: m.number,
          title: m.title,
          state: m.state.toLowerCase(),
          created_at: m.created_at,
          closed_at: m.closed_at,
          synced_at: now,
        });
      }
      db.run("delete from milestones where repo_id = ? and synced_at <> ?", [repo.id, now]);
    }
  })();
  return issues.length;
}

export async function syncAll(db: Database, source: IssueSource, milestones?: MilestoneSource): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const repo of listRepos(db)) {
    result[`${repo.owner}/${repo.name}`] = await syncRepo(db, repo, source, milestones);
  }
  return result;
}

/** 한 레포의 마일스톤을 번호순으로. 마일스톤마다 붙은 이슈 번호를 모은다. */
export function listMilestones(db: Database, repo_id: number): Milestone[] {
  const rows = db
    .query<Omit<Milestone, "issues">, [number]>("select * from milestones where repo_id = ? order by number")
    .all(repo_id);
  const attached = db
    .query<{ milestone_number: number; number: number }, [number]>(
      "select milestone_number, number from issues where repo_id = ? and milestone_number is not null order by number",
    )
    .all(repo_id);
  return rows.map((m) => ({ ...m, issues: attached.filter((a) => a.milestone_number === m.number).map((a) => a.number) }));
}

export function listIssues(db: Database, opts: { state?: "open" | "closed"; repo_id?: number } = {}): Issue[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.state) {
    where.push("state = ?");
    params.push(opts.state);
  }
  if (opts.repo_id !== undefined) {
    where.push("repo_id = ?");
    params.push(opts.repo_id);
  }
  const sql = `select * from issues${where.length ? ` where ${where.join(" and ")}` : ""} order by repo_id, number`;
  const rows = db.query<IssueRow, (string | number)[]>(sql).all(...params);
  return rows.map((r) => ({ ...r, labels: JSON.parse(r.labels) as string[] }));
}
