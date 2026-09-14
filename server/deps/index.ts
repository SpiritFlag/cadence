import type { Database } from "bun:sqlite";

/** blocker가 blocked를 막는다. */
export type Dep = { blocker_id: number; blocked_id: number; created_at: string };

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

/** 없으면 넣고, 있으면 그대로. 자기 자신 · 없는 이슈 · 다른 레포 이슈면 던진다. */
export function addDep(db: Database, blocker_id: number, blocked_id: number): Dep {
  if (blocker_id === blocked_id) throw new Error("이슈가 자기 자신을 막을 수 없다");
  const rows = db.query<{ repo_id: number }, [number, number]>(
    "select repo_id from issues where id in (?, ?)",
  ).all(blocker_id, blocked_id);
  if (rows.length !== 2) throw new Error("없는 이슈다");
  if (rows[0]!.repo_id !== rows[1]!.repo_id) throw new Error("다른 레포의 이슈끼리는 선을 그을 수 없다");
  db.run("insert or ignore into deps (blocker_id, blocked_id) values (?, ?)", [blocker_id, blocked_id]);
  return db
    .query<Dep, [number, number]>("select * from deps where blocker_id = ? and blocked_id = ?")
    .get(blocker_id, blocked_id)!;
}

/** 지웠으면 true, 없었으면 false. */
export function removeDep(db: Database, blocker_id: number, blocked_id: number): boolean {
  const r = db.run("delete from deps where blocker_id = ? and blocked_id = ?", [blocker_id, blocked_id]);
  return r.changes > 0;
}
