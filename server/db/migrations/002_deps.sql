-- 의존 선. blocker가 blocked를 막는다. docs/design.md "의존 관계는 로컬에만 둔다".
create table deps (
  blocker_id integer not null references issues(id) on delete cascade,
  blocked_id integer not null references issues(id) on delete cascade,
  created_at text not null default (datetime('now')),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index deps_blocked on deps (blocked_id);
