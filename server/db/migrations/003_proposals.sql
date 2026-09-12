-- 마지막 제안의 캐시. 다시 켜도 LLM을 돌리지 않고 마지막 제안이 보인다.
create table proposals (
  id         integer primary key,
  created_at text not null default (datetime('now')),
  input_hash text not null,
  output     text not null   -- Proposal JSON
);
