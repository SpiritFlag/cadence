-- 마일스톤과 이슈에 붙은 마일스톤. 이슈는 레포 안 마일스톤 번호로 가리킨다.
create table milestones (
  id         integer primary key,
  repo_id    integer not null references repos(id) on delete cascade,
  number     integer not null,
  title      text not null,
  state      text not null,   -- open | closed
  created_at text not null,
  closed_at  text,
  synced_at  text not null,
  unique (repo_id, number)
);

alter table issues add column milestone_number integer;
