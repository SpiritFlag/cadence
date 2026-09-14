import type { Database } from "bun:sqlite";

export type DepSource = "user" | "claude";

/** blocker가 blocked를 막는다. claude 선은 이유가 있고, 사용자 선의 이유는 "". */
export type Dep = { blocker_id: number; blocked_id: number; created_at: string; source: DepSource; reason: string };

/** 사용자가 지운 claude 선. */
export type Removal = { blocker_id: number; blocked_id: number; created_at: string };

/** 레포를 주면 양 끝이 다 그 레포 이슈인 선만. */
export function listDeps(db: Database, repo_id?: number): Dep[] {
  if (repo_id === undefined) return db.query<Dep, []>("select * from deps order by blocker_id, blocked_id").all();
  return db
    .query<Dep, [number, number]>(
      `select d.* from deps d
       join issues a on a.id = d.blocker_id
       join issues b on b.id = d.blocked_id
       where a.repo_id = ? and b.repo_id = ?
       order by d.blocker_id, d.blocked_id`,
    )
    .all(repo_id, repo_id);
}

/**
 * 사용자가 긋는다. 없으면 넣고, claude 선이 있으면 사용자 선으로 바꾼다. 지운 선 기억에서도 뺀다.
 * 자기 자신 · 없는 이슈 · 다른 레포 이슈면 던진다.
 */
export function addDep(db: Database, blocker_id: number, blocked_id: number): Dep {
  if (blocker_id === blocked_id) throw new Error("이슈가 자기 자신을 막을 수 없다");
  const rows = db.query<{ repo_id: number }, [number, number]>(
    "select repo_id from issues where id in (?, ?)",
  ).all(blocker_id, blocked_id);
  if (rows.length !== 2) throw new Error("없는 이슈다");
  if (rows[0]!.repo_id !== rows[1]!.repo_id) throw new Error("다른 레포의 이슈끼리는 선을 그을 수 없다");
  db.transaction(() => {
    db.run(
      `insert into deps (blocker_id, blocked_id) values (?, ?)
       on conflict (blocker_id, blocked_id) do update set source = 'user', reason = ''`,
      [blocker_id, blocked_id],
    );
    db.run("delete from dep_removals where blocker_id = ? and blocked_id = ?", [blocker_id, blocked_id]);
  })();
  return db
    .query<Dep, [number, number]>("select * from deps where blocker_id = ? and blocked_id = ?")
    .get(blocker_id, blocked_id)!;
}

/** 사용자가 지운다. 지웠으면 true, 없었으면 false. claude 선이면 기억한다. */
export function removeDep(db: Database, blocker_id: number, blocked_id: number): boolean {
  return db.transaction(() => {
    const row = db
      .query<{ source: DepSource }, [number, number]>("select source from deps where blocker_id = ? and blocked_id = ?")
      .get(blocker_id, blocked_id);
    if (!row) return false;
    db.run("delete from deps where blocker_id = ? and blocked_id = ?", [blocker_id, blocked_id]);
    if (row.source === "claude") {
      db.run("insert or ignore into dep_removals (blocker_id, blocked_id) values (?, ?)", [blocker_id, blocked_id]);
    }
    return true;
  })();
}

/** 그 레포에서 사용자가 지운 claude 선. */
export function listRemovals(db: Database, repo_id: number): Removal[] {
  return db
    .query<Removal, [number]>(
      `select r.* from dep_removals r
       join issues a on a.id = r.blocker_id
       where a.repo_id = ?
       order by r.blocker_id, r.blocked_id`,
    )
    .all(repo_id);
}
