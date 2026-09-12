import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

/** sqlite 파일 위치. CADENCE_HOME이 있으면 그 아래, 없으면 ~/.cadence. */
export function defaultDbPath(): string {
  const home = process.env.CADENCE_HOME ?? join(homedir(), ".cadence");
  mkdirSync(home, { recursive: true });
  return join(home, "cadence.sqlite");
}

/** DB를 열고 마이그레이션을 적용한다. 테스트는 ":memory:"를 준다. */
export function openDb(path: string = defaultDbPath()): Database {
  const db = new Database(path, { create: true, strict: true });
  db.run("pragma journal_mode = wal");
  db.run("pragma foreign_keys = on");
  migrate(db);
  return db;
}

/** migrations/*.sql을 이름순으로, 아직 안 적용된 것만 적용한다. 두 번 돌려도 같다. */
export function migrate(db: Database): string[] {
  db.run(
    "create table if not exists _migrations (name text primary key, applied_at text not null default (datetime('now')))",
  );
  const applied = new Set(
    db.query<{ name: string }, []>("select name from _migrations").all().map((r) => r.name),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    db.transaction(() => {
      db.run(sql);
      db.run("insert into _migrations (name) values (?)", [file]);
    })();
    newlyApplied.push(file);
  }
  return newlyApplied;
}

/** 테이블 이름 목록. 테스트용. */
export function tableNames(db: Database): string[] {
  return db
    .query<{ name: string }, []>(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name",
    )
    .all()
    .map((r) => r.name);
}
