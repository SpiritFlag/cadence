# cadence
로컬에서 돌아가는 웹 대시보드.

## 이게 뭔가
혼자 개발하는 사용자가 자기 작업을 한 화면에서 보게 한다. 데이터는 로컬 sqlite에 둔다. gh로 GitHub과 동기화한다.

## 설치
```
bun install
```
`gh`가 로그인돼 있어야 한다.

## 사용
```
bun run start
```
브라우저에서 `localhost:4747`을 연다. 상단 입력칸에 `owner/name`을 넣고 추가하면 그 레포의 열린 이슈가 목록에 보인다. 이슈를 누르면 아래에 본문이 보인다. 새로고침은 다시 가져온다.

개발은 `bun run dev`. 검증은 `bun test` · `bun run check`.

## 구조
```
.
├── .github/
│   └── ISSUE_TEMPLATE/
├── docs/
│   ├── cycles/
│   ├── design.md
│   └── SPEC.md
├── scripts/
├── server/
│   ├── db/
│   ├── github/
│   └── sync/
├── web/
│   └── src/
├── CLAUDE.md
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

## 더 보기
- `docs/SPEC.md` — 지금 어떻게 동작하나
- `docs/design.md` — 설계 근거
- `docs/cycles/` — 사이클 문서
- `CONTRIBUTING.md` — 이슈 · 브랜치 · 사이클 규칙
- [Releases](https://github.com/SpiritFlag/cadence/releases) — 버전별 변경
