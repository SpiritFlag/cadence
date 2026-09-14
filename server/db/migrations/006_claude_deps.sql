-- claude가 긋는 선. 기존 선은 사용자 선이다.
alter table deps add column source text not null default 'user' check (source in ('user', 'claude'));
alter table deps add column reason text not null default '';

-- 사용자가 지운 claude 선. 다음 생성에서 claude가 다시 내면 긋지 않고 제안으로 올린다.
create table dep_removals (
  blocker_id integer not null references issues(id) on delete cascade,
  blocked_id integer not null references issues(id) on delete cascade,
  created_at text not null default (datetime('now')),
  primary key (blocker_id, blocked_id)
);

-- 그래프 생성 결과. 레포마다 마지막 것이 화면에 뜬다.
create table graph_runs (
  id         integer primary key,
  repo_id    integer not null references repos(id) on delete cascade,
  created_at text not null default (datetime('now')),
  output     text not null
);

create index graph_runs_repo on graph_runs (repo_id, id);

-- 승인을 기다리는 선 제안. 다시 생성하면 그 레포 것을 갈아끼운다.
create table dep_suggestions (
  id         integer primary key,
  repo_id    integer not null references repos(id) on delete cascade,
  kind       text not null check (kind in ('remove', 'reverse', 'redraw')),
  blocker_id integer not null references issues(id) on delete cascade,
  blocked_id integer not null references issues(id) on delete cascade,
  reason     text not null
);
