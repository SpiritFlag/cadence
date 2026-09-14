import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../db";
import { addDep, listDeps, listRemovals, removeDep } from "./index";

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

test("다른 레포의 이슈끼리는 거부한다", () => {
  db.run("insert into repos (owner, name) values ('a', 'c')");
  db.run("insert into issues (repo_id, number, title, state, updated_at, synced_at) values (2, 1, 'x', 'open', 'x', 'x')"); // id 4
  expect(() => addDep(db, 1, 4)).toThrow("다른 레포");
  expect(listDeps(db)).toEqual([]);
});

test("레포를 주면 양 끝이 그 레포인 선만 준다", () => {
  db.run("insert into repos (owner, name) values ('a', 'c')");
  for (const n of [1, 2]) {
    db.run("insert into issues (repo_id, number, title, state, updated_at, synced_at) values (2, ?, 'x', 'open', 'x', 'x')", [n]); // id 4, 5
  }
  addDep(db, 1, 2);
  addDep(db, 4, 5);
  const pairs = (repo: number) => listDeps(db, repo).map((d) => [d.blocker_id, d.blocked_id]);
  expect(pairs(1)).toEqual([[1, 2]]);
  expect(pairs(2)).toEqual([[4, 5]]);
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

const claude = (a: number, b: number, reason = "claude 이유") =>
  db.run("insert into deps (blocker_id, blocked_id, source, reason) values (?, ?, 'claude', ?)", [a, b, reason]);
const view = () => listDeps(db).map((d) => [d.blocker_id, d.blocked_id, d.source, d.reason]);
const removed = () => listRemovals(db, 1).map((r) => [r.blocker_id, r.blocked_id]);

test("사용자가 그은 선은 사용자 선이고 이유가 비어 있다", () => {
  addDep(db, 1, 2);
  expect(view()).toEqual([[1, 2, "user", ""]]);
});

test("claude 선을 손으로 다시 그으면 사용자 선이 되고, 지운 선 기억에서도 빠진다", () => {
  claude(1, 2);
  addDep(db, 1, 2);
  expect(view()).toEqual([[1, 2, "user", ""]]);

  claude(2, 3);
  removeDep(db, 2, 3);
  expect(removed()).toEqual([[2, 3]]);
  addDep(db, 2, 3);
  expect(removed()).toEqual([]);
});

test("claude 선을 지우면 기억하고, 사용자 선을 지우면 기억하지 않는다", () => {
  claude(1, 2);
  addDep(db, 2, 3);
  expect(removeDep(db, 1, 2)).toBe(true);
  expect(removeDep(db, 2, 3)).toBe(true);
  expect(removed()).toEqual([[1, 2]]);
  expect(view()).toEqual([]);
});

test("지운 선 기억은 레포별이고, 이슈가 지워지면 같이 지워진다", () => {
  db.run("insert into repos (owner, name) values ('a', 'c')");
  for (const n of [1, 2]) {
    db.run("insert into issues (repo_id, number, title, state, updated_at, synced_at) values (2, ?, 'x', 'open', 'x', 'x')", [n]); // id 4, 5
  }
  claude(1, 2);
  claude(4, 5);
  removeDep(db, 1, 2);
  removeDep(db, 4, 5);
  expect(removed()).toEqual([[1, 2]]);
  expect(listRemovals(db, 2).map((r) => [r.blocker_id, r.blocked_id])).toEqual([[4, 5]]);
  db.run("delete from issues where id = 2");
  expect(removed()).toEqual([]);
});
