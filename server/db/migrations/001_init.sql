-- 레포와 이슈. docs/design.md 데이터 모델.
create table repos (
  id        integer primary key,
  owner     text not null,
  name      text not null,
  added_at  text not null default (datetime('now')),
  unique (owner, name)
);

create table issues (
  id         integer primary key,
  repo_id    integer not null references repos(id) on delete cascade,
  number     integer not null,
  title      text not null,
  body       text not null default '',
  state      text not null,                -- open | closed
  labels     text not null default '[]',   -- 라벨 이름 배열 JSON
  updated_at text not null,
  closed_at  text,
  synced_at  text not null,
  unique (repo_id, number)
);

create index issues_repo_state on issues (repo_id, state);
