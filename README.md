# cadence
로컬에서 돌아가는 웹 대시보드.

## 이게 뭔가
혼자 개발하는 사용자가 자기 작업을 한 화면에서 보게 한다. 데이터는 로컬 sqlite에 둔다. gh로 GitHub과 동기화한다.

## 설치
```
bun install
```
`gh`와 `claude`(Claude Code CLI)가 로그인돼 있어야 한다.

## 사용
```
bun run start
```
브라우저에서 `localhost:4747`을 연다. 상단 입력칸에 `owner/name`을 넣고 추가하면 그 레포의 열린 이슈가 그래프에 카드로 보인다. 레포가 여럿이면 상단 레포 칩을 눌러 볼 레포를 고른다. 카드 아래 점을 끌어 다른 카드 위 점에 놓으면 "막는다" 선이 생긴다. 서로 막는 선은 빨갛다. [그래프 생성]을 누르면 claude가 이슈 본문을 읽고 순서가 있는 이슈 사이에 점선을 긋는다. 손으로 그은 선을 지우거나 뒤집자는 제안, 사용자가 지운 점선을 다시 긋자는 제안은 [승인]해야 반영된다.

[제안]을 누르면 claude가 다음에 같이 할 묶음을 5순위까지 골라 올릴 라벨과 함께 제안한다. 다시 누르면 아직 안 뽑힌 순위는 지키고, 끼어들거나 합류한 묶음에는 표시가 붙는다. 묶음 위에는 지나간 마일스톤이 순서대로 보인다. 도는 동안 오른쪽 아래 로그 칸에 진행이 한 줄씩 흐른다. 체크를 남긴 것만 [승인한 라벨 변경 반영]으로 GitHub 라벨이 바뀐다. cadence가 GitHub에 쓰는 것은 `p1` `p2` `p3` `hold` 라벨뿐이다.

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
│   ├── apply/
│   ├── db/
│   ├── deps/
│   ├── github/
│   ├── graph/
│   ├── graphgen/
│   ├── llm/
│   ├── log/
│   ├── propose/
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
