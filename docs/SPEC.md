# SPEC

## 실행

- 일상은 `bun run start`, 브라우저는 `localhost:4747`. 개발은 `bun run dev`(Vite 4747 · Hono 4748, `/api`는 프록시).
- sqlite 파일은 `$CADENCE_HOME/cadence.sqlite`, 기본 `~/.cadence/`. WAL, foreign_keys on.
- 마이그레이션은 SQL 파일 이름순. 적용 이력은 `_migrations`. 두 번 돌려도 같다.
- 시각은 전부 UTC ISO 문자열.

## 동기화

- 레포는 `owner/name`. 같은 이름은 하나다.
- 가져오기는 `gh issue list --state all --limit 1000 --json`. 인증은 gh가 갖는다. 쓰기는 없다.
- 이슈는 `(repo_id, number)`가 유일. 재가져오기는 제목 · 본문 · 상태 · 라벨을 덮어쓴다. 닫힌 이슈는 `state=closed`로 남는다.
- `state`는 `open` | `closed` 소문자. `labels`는 라벨 이름 배열.
- 레포 추가는 곧바로 그 레포를 동기화한다. 새로고침은 모든 레포를 동기화한 뒤 다시 읽는다.
- API: `GET · POST /api/repos` · `POST /api/sync` · `GET /api/issues?state=open|closed`.

## 의존 선

- 선은 blocker → blocked, "blocker가 blocked를 막는다". 로컬 sqlite에만 있다. GitHub에 쓰지 않는다.
- 같은 선은 하나다. 자기 자신을 막을 수 없다. 없는 이슈를 가리킬 수 없다. 이슈가 지워지면 선도 지워진다.
- 레포를 넘나드는 선을 허용한다.
- 순환은 강한 연결 요소로 잡는다. 같은 요소 안의 선이 순환에 걸린 선이다.
- API: `GET · POST /api/deps` · `DELETE /api/deps/{blocker}/{blocked}`.

## 화면

- 화면은 하나. 왼쪽 그래프, 오른쪽 패키지 자리(비어 있음), 아래 선택한 이슈 상세.
- 그래프의 노드는 열린 이슈 카드(`#번호 · 라벨 뱃지 · 제목`). 선은 화살표. 양 끝이 다 열린 이슈인 선만 그린다.
- 배치는 막는 쪽이 위. 이슈나 선이 바뀔 때만 다시 배치한다. 선택은 배치를 바꾸지 않는다.
- 순환에 걸린 선은 빨강, 나머지는 회색.
- 노드 클릭이 선택, 빈 곳 클릭이 해제. 아래 핸들에서 끌어 위 핸들에 놓으면 끈 쪽이 막는 쪽으로 선이 생긴다.
- 상세는 제목 · 라벨 · "이 이슈를 막는 것"(추가 · 삭제) · "이 이슈가 막는 것"(표시) · 본문(텍스트 그대로). 칩의 이슈를 누르면 그 이슈가 선택된다.
- 라벨 색: `p1` #d73a4a · `p2` #fbca04 · `p3` #0e8a16 · `hold` #cfd3d7. 그 밖은 회색.
