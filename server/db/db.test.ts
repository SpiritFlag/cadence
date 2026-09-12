import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate, openDb, tableNames } from "./index";

test("빈 DB에 마이그레이션을 적용하면 테이블이 생긴다", () => {
  const db = openDb(":memory:");
  expect(tableNames(db)).toEqual(["_migrations", "deps", "issues", "repos"]);
});

test("두 번 적용해도 같다", () => {
  const db = new Database(":memory:");
  const first = migrate(db);
  const second = migrate(db);
  expect(first).toEqual(["001_init.sql", "002_deps.sql"]);
  expect(second).toEqual([]);
  expect(tableNames(db)).toEqual(["_migrations", "deps", "issues", "repos"]);
  const rows = db.query<{ n: number }, []>("select count(*) as n from _migrations").get();
  expect(rows?.n).toBe(2);
});

test("같은 레포의 같은 번호는 두 번 못 넣는다", () => {
  const db = openDb(":memory:");
  db.run("insert into repos (owner, name) values ('a', 'b')");
  const insert = () =>
    db.run(
      "insert into issues (repo_id, number, title, state, updated_at, synced_at) values (1, 7, 't', 'open', 'x', 'x')",
    );
  insert();
  expect(insert).toThrow();
});
