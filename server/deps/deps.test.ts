import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../db";
import { addDep, listDeps, removeDep } from "./index";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
  db.run("insert into repos (owner, name) values ('a', 'b')");
  for (const n of [1, 2, 3]) {
    db.run(
      "insert into issues (repo_id, number, title, state, updated_at, synced_at) values (1, ?, ?, 'open', 'x', 'x')",
      [n, `이슈 ${n}`],
    );
  }
});

test("추가하면 목록에 있고, 같은 선 두 번은 하나다", () => {
  addDep(db, 1, 2);
  addDep(db, 1, 2);
  addDep(db, 2, 3);
  expect(listDeps(db).map((d) => [d.blocker_id, d.blocked_id])).toEqual([[1, 2], [2, 3]]);
});

test("자기 자신은 거부한다", () => {
  expect(() => addDep(db, 1, 1)).toThrow("자기 자신");
  expect(listDeps(db)).toEqual([]);
});

test("없는 이슈는 거부한다", () => {
  expect(() => addDep(db, 1, 99)).toThrow("없는 이슈");
});

test("지우면 사라지고, 없는 것을 지우면 false", () => {
  addDep(db, 1, 2);
  expect(removeDep(db, 1, 2)).toBe(true);
  expect(removeDep(db, 1, 2)).toBe(false);
  expect(listDeps(db)).toEqual([]);
});

test("이슈가 지워지면 선도 지워진다", () => {
  addDep(db, 1, 2);
  db.run("delete from issues where id = 2");
  expect(listDeps(db)).toEqual([]);
});
