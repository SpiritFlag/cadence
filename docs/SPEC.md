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

## 화면

- 화면은 하나. 왼쪽 열린 이슈 목록, 오른쪽 패키지 자리(비어 있음), 아래 선택한 이슈 상세.
- 목록 행은 `#번호 · 제목 · 라벨 뱃지`. 레포가 둘 이상이면 레포 이름도.
- 라벨 색: `p1` #d73a4a · `p2` #fbca04 · `p3` #0e8a16 · `hold` #cfd3d7. 그 밖은 회색.
- 상세는 제목 · 라벨 · 본문(텍스트 그대로).
