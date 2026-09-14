-- 제안은 레포마다 따로 둔다. 기존 제안은 담긴 이슈의 레포로 채운다.
alter table proposals add column repo_id integer references repos(id) on delete cascade;

update proposals set repo_id = (
  select i.repo_id from issues i
  where i.id = coalesce(json_extract(output, '$.order[0]'), json_extract(output, '$.packages[0].issue_ids[0]'))
);

create index proposals_repo on proposals (repo_id, id);
