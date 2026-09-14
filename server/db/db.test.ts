import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrate, openDb, tableNames } from "./index";

test("빈 DB에 마이그레이션을 적용하면 테이블이 생긴다", () => {
  const db = openDb(":memory:");
  expect(tableNames(db)).toEqual(["_migrations", "dep_removals", "dep_suggestions", "deps", "graph_runs", "issues", "milestones", "proposals", "repos"]);
});

test("두 번 적용해도 같다", () => {
  const db = new Database(":memory:");
  const first = migrate(db);
  const second = migrate(db);
  expect(first).toEqual(["001_init.sql", "002_deps.sql", "003_proposals.sql", "004_proposal_repo.sql", "005_milestones.sql", "006_claude_deps.sql"]);
  expect(second).toEqual([]);
  expect(tableNames(db)).toEqual(["_migrations", "dep_removals", "dep_suggestions", "deps", "graph_runs", "issues", "milestones", "proposals", "repos"]);
  const rows = db.query<{ n: number }, []>("select count(*) as n from _migrations").get();
  expect(rows?.n).toBe(6);
});

test("004는 기존 제안을 담긴 이슈의 레포로 채운다", () => {
  const db = new Database(":memory:");
  db.run("create table _migrations (name text primary key, applied_at text not null default (datetime('now')))");
  for (const f of ["001_init.sql", "002_deps.sql", "003_proposals.sql"]) {
    db.run(readFileSync(join(import.meta.dir, "migrations", f), "utf8"));
    db.run("insert into _migrations (name) values (?)", [f]);
  }
  db.run("insert into repos (owner, name) values ('a', 'b'), ('a', 'c')");
  db.run("insert into issues (repo_id, number, title, state, updated_at, synced_at) values (2, 1, 't', 'open', 'x', 'x')");
  db.run("insert into proposals (input_hash, output) values ('h', ?)", [JSON.stringify({ order: [1], packages: [] })]);
  expect(migrate(db)).toEqual(["004_proposal_repo.sql", "005_milestones.sql", "006_claude_deps.sql"]);
  expect(db.query<{ repo_id: number }, []>("select repo_id from proposals").get()?.repo_id).toBe(2);
});

test("005는 기존 이슈에 마일스톤 번호 열을 null로 더한다", () => {
  const db = new Database(":memory:");
  db.run("create table _migrations (name text primary key, applied_at text not null default (datetime('now')))");
  for (const f of ["001_init.sql", "002_deps.sql", "003_proposals.sql", "004_proposal_repo.sql"]) {
    db.run(readFileSync(join(import.meta.dir, "migrations", f), "utf8"));
    db.run("insert into _migrations (name) values (?)", [f]);
  }
  db.run("insert into repos (owner, name) values ('a', 'b')");
  db.run("insert into issues (repo_id, number, title, state, updated_at, synced_at) values (1, 1, 't', 'open', 'x', 'x')");
  expect(migrate(db)).toEqual(["005_milestones.sql", "006_claude_deps.sql"]);
  expect(db.query<{ m: number | null }, []>("select milestone_number as m from issues").get()).toEqual({ m: null });
});

test("006은 기존 선을 이유 없는 사용자 선으로 둔다", () => {
  const db = new Database(":memory:");
  db.run("create table _migrations (name text primary key, applied_at text not null default (datetime('now')))");
  for (const f of ["001_init.sql", "002_deps.sql", "003_proposals.sql", "004_proposal_repo.sql", "005_milestones.sql"]) {
    db.run(readFileSync(join(import.meta.dir, "migrations", f), "utf8"));
    db.run("insert into _migrations (name) values (?)", [f]);
  }
  db.run("insert into repos (owner, name) values ('a', 'b')");
  db.run("insert into issues (repo_id, number, title, state, updated_at, synced_at) values (1, 1, 't', 'open', 'x', 'x'), (1, 2, 't', 'open', 'x', 'x')");
  db.run("insert into deps (blocker_id, blocked_id) values (1, 2)");
  expect(migrate(db)).toEqual(["006_claude_deps.sql"]);
  expect(db.query("select source, reason from deps").get()).toEqual({ source: "user", reason: "" });
  expect(() => db.run("update deps set source = 'bot'")).toThrow();
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
