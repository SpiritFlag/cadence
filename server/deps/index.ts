import type { Database } from "bun:sqlite";

/** blocker가 blocked를 막는다. */
export type Dep = { blocker_id: number; blocked_id: number; created_at: string };

export function listDeps(db: Database): Dep[] {
  return db.query<Dep, []>("select * from deps order by blocker_id, blocked_id").all();
}

/** 없으면 넣고, 있으면 그대로. 자기 자신이나 없는 이슈면 던진다. */
export function addDep(db: Database, blocker_id: number, blocked_id: number): Dep {
  if (blocker_id === blocked_id) throw new Error("이슈가 자기 자신을 막을 수 없다");
  const exists = db.query<{ n: number }, [number, number]>(
    "select count(*) as n from issues where id in (?, ?)",
  ).get(blocker_id, blocked_id)!.n;
  if (exists !== 2) throw new Error("없는 이슈다");
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
