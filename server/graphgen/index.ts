// [그래프 생성]. claude가 열린 이슈를 읽고 선을 긋는다. 사용자 선은 판정만 받아 제안으로 올린다.
import type { Database } from "bun:sqlite";
import type { Proposer } from "../llm/claude";
import { comma, noLog, type Log } from "../log";
import type { Issue, Repo } from "../sync";
import { listDeps, listRemovals } from "../deps";
import { edgeKey, type Edge } from "../graph/cycle";

export type SuggestionKind = "remove" | "reverse" | "redraw";
/** 승인을 기다리는 선 제안. remove · reverse는 사용자 선, redraw는 사용자가 지운 claude 선. */
export type DepSuggestion = { id: number; repo_id: number; kind: SuggestionKind; blocker_id: number; blocked_id: number; reason: string };
export type GraphWarning = { kind: "cycle" | "unknown"; message: string };

export type GraphRun = {
  id: number;
  repo_id: number;
  created_at: string;
  /** ok: 선을 갈아끼웠다. none: 두 번 다 깨져 선 · 제안을 그대로 뒀다. */
  status: "ok" | "none";
  /** 그은 claude 선 수. */
  added: number;
  warnings: GraphWarning[];
  /** 올린 제안 수. */
  suggestions: number;
  cost_usd: number;
};

export const GRAPH_SCHEMA = {
  type: "object",
  properties: {
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: { blocker_id: { type: "integer" }, blocked_id: { type: "integer" }, reason: { type: "string" } },
        required: ["blocker_id", "blocked_id", "reason"],
      },
    },
    user_edges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          blocker_id: { type: "integer" },
          blocked_id: { type: "integer" },
          verdict: { type: "string", enum: ["keep", "remove", "reverse"] },
          reason: { type: "string" },
        },
        required: ["blocker_id", "blocked_id", "verdict", "reason"],
      },
    },
  },
  required: ["edges", "user_edges"],
} as const;

const edgeLines = (edges: Edge[]) => (edges.length ? edges.map((d) => `- ${d.blocker_id} → ${d.blocked_id}`) : ["(없음)"]);

export function buildGraphPrompt(issues: Issue[], label: string, userDeps: Edge[], removals: Edge[]): string {
  const lines: string[] = [];
  lines.push(`너는 혼자 개발하는 사용자의 비서다. ${label} 레포의 열린 이슈를 읽고 이슈 사이의 의존 선을 긋는다.`);
  lines.push("");
  lines.push("## 규칙");
  lines.push("1. 선은 blocker가 끝나야 blocked를 제대로 할 수 있을 때만 긋는다. 같은 화면 · 같은 영역 · 비슷한 주제라는 것만으로는 선이 아니다.");
  lines.push("2. 본문에 적힌 선행 조건과 이슈 참조(#번호)를 가장 믿는다. 본문에 없으면 층의 선후(데이터 → 서버 → 화면)가 분명할 때만 긋는다.");
  lines.push("3. 확실하지 않으면 긋지 않는다. 선이 많다고 좋은 것이 아니다.");
  lines.push("4. 순환을 만들지 않는다. 사용자 선과 합쳐도 순환이 없어야 한다.");
  lines.push("5. edges에는 네가 긋는 선만 넣는다. 아래 사용자 선과 같은 선은 넣지 않는다.");
  lines.push("6. user_edges에는 사용자 선마다 판정을 하나씩 넣는다. keep(맞다) · remove(필요 없는 선이다) · reverse(방향이 반대다). 사용자가 그은 선이니 확실히 틀렸을 때만 remove나 reverse다.");
  lines.push("7. 사용자가 지운 선은 다시 긋지 않는 것이 기본이다. 이슈 내용으로 보아 꼭 필요하면 edges에 넣고 reason에 왜 다시 필요한지 적는다.");
  lines.push("8. reason은 \"-다\" 체 한 문장. 사용자를 부르지 않는다. 이슈는 반드시 아래 id로 가리킨다.");
  lines.push("");
  lines.push("## 사용자 선 (blocker → blocked. id 기준)");
  lines.push(...edgeLines(userDeps));
  lines.push("");
  lines.push("## 사용자가 지운 선 (blocker → blocked. id 기준)");
  lines.push(...edgeLines(removals));
  lines.push("");
  lines.push("## 열린 이슈");
  for (const i of issues) {
    const ms = i.milestone_number !== null ? " · 진행 중(마일스톤 있음)" : "";
    lines.push(`### id ${i.id} · #${i.number} · 라벨 ${i.labels.length ? i.labels.join(", ") : "(없음)"}${ms}`);
    lines.push(`제목: ${i.title}`);
    lines.push(i.body.trim() ? i.body.trim() : "(본문 없음)");
    lines.push("");
  }
  return lines.join("\n");
}

type OutEdge = Edge & { reason: string };
type Verdict = OutEdge & { verdict: "keep" | "remove" | "reverse" };
type Output = { edges: OutEdge[]; verdicts: Verdict[] };

const isEdge = (x: unknown): x is OutEdge => {
  const o = x as Record<string, unknown>;
  return !!o && typeof o === "object" && typeof o.blocker_id === "number" && typeof o.blocked_id === "number";
};
const reasonOf = (x: OutEdge) => (typeof x.reason === "string" ? x.reason.trim() : "");

function parseOutput(output: unknown): Output | null {
  if (!output || typeof output !== "object") return null;
  const o = output as { edges?: unknown; user_edges?: unknown };
  if (!Array.isArray(o.edges)) return null;
  const edges = o.edges.filter(isEdge).map((e) => ({ blocker_id: e.blocker_id, blocked_id: e.blocked_id, reason: reasonOf(e) }));
  const verdicts = (Array.isArray(o.user_edges) ? o.user_edges : [])
    .filter((v): v is Verdict => isEdge(v) && ["keep", "remove", "reverse"].includes((v as Verdict).verdict))
    .map((v) => ({ blocker_id: v.blocker_id, blocked_id: v.blocked_id, verdict: v.verdict, reason: reasonOf(v) }));
  return { edges, verdicts };
}

type Sorted = { add: OutEdge[]; suggestions: Omit<DepSuggestion, "id" | "repo_id">[]; warnings: GraphWarning[] };

/** 선을 하나씩 넣을 때 blocked에서 blocker로 가는 길이 이미 있으면 순환이다. */
function reaches(adj: Map<number, number[]>, from: number, to: number): boolean {
  const seen = new Set<number>();
  const stack = [from];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n === to) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(adj.get(n) ?? []));
  }
  return false;
}

/**
 * claude 출력을 거른다. 열린 이슈가 아니거나 자기 자신이면 경고, 사용자 선과 같거나 겹치면 조용히 뺀다.
 * 사용자가 지운 선은 긋지 않고 다시 긋자 제안. 사용자 선 · 이미 넣은 선과 순환이면 경고.
 * 사용자 선 판정은 remove · reverse만 제안으로, 사용자 선이 아닌 판정은 버린다.
 */
export function sortOutput(issues: Issue[], userDeps: Edge[], removals: Edge[], out: Output): Sorted {
  const num = new Map(issues.map((i) => [i.id, i.number]));
  const name = (e: Edge) => `#${num.get(e.blocker_id)} → #${num.get(e.blocked_id)}`;
  const user = new Set(userDeps.map(edgeKey));
  const removed = new Set(removals.map(edgeKey));
  const adj = new Map<number, number[]>();
  const link = (e: Edge) => adj.set(e.blocker_id, [...(adj.get(e.blocker_id) ?? []), e.blocked_id]);
  userDeps.forEach(link);

  const r: Sorted = { add: [], suggestions: [], warnings: [] };
  const seen = new Set<string>();
  for (const e of out.edges) {
    const key = edgeKey(e);
    if (!num.has(e.blocker_id) || !num.has(e.blocked_id)) {
      r.warnings.push({ kind: "unknown", message: `id ${e.blocker_id} → ${e.blocked_id} · 열린 이슈가 아니라 안 그음` });
      continue;
    }
    if (e.blocker_id === e.blocked_id) {
      r.warnings.push({ kind: "unknown", message: `${name(e)} · 자기 자신이라 안 그음` });
      continue;
    }
    if (user.has(key) || seen.has(key)) continue;
    seen.add(key);
    if (reaches(adj, e.blocked_id, e.blocker_id)) {
      r.warnings.push({ kind: "cycle", message: `${name(e)} · 순환이라 안 그음` });
      continue;
    }
    if (removed.has(key)) {
      r.suggestions.push({ kind: "redraw", blocker_id: e.blocker_id, blocked_id: e.blocked_id, reason: e.reason });
      continue;
    }
    link(e);
    r.add.push(e);
  }

  const judged = new Set<string>();
  for (const v of out.verdicts) {
    const key = edgeKey(v);
    if (!user.has(key) || judged.has(key)) continue;
    judged.add(key);
    if (v.verdict !== "keep") r.suggestions.push({ kind: v.verdict, blocker_id: v.blocker_id, blocked_id: v.blocked_id, reason: v.reason });
  }
  return r;
}

type RunBody = Omit<GraphRun, "id" | "repo_id" | "created_at">;

function saveRun(db: Database, repo_id: number, body: RunBody): GraphRun {
  const r = db.run("insert into graph_runs (repo_id, output) values (?, ?)", [repo_id, JSON.stringify(body)]);
  const row = db.query<{ id: number; created_at: string }, [number]>("select id, created_at from graph_runs where id = ?").get(Number(r.lastInsertRowid))!;
  return { ...body, id: row.id, repo_id, created_at: row.created_at };
}

/** 고른 레포의 열린 이슈로 claude에게 선을 받아 그 레포의 claude 선 · 제안을 갈아끼운다. 단계마다 log에 한 줄. */
export async function generateGraph(
  db: Database, repo_id: number, allIssues: Issue[], repos: Repo[], proposer: Proposer, log: Log = noLog,
): Promise<GraphRun> {
  const issues = allIssues.filter((i) => i.repo_id === repo_id && i.state === "open");
  const open = new Set(issues.map((i) => i.id));
  const inside = (e: Edge) => open.has(e.blocker_id) && open.has(e.blocked_id);
  const userDeps = listDeps(db, repo_id).filter((d) => d.source === "user" && inside(d));
  const removals = listRemovals(db, repo_id).filter(inside);
  const repo = repos.find((r) => r.id === repo_id);
  const label = repo ? `${repo.owner}/${repo.name}` : `레포 ${repo_id}`;
  const prompt = buildGraphPrompt(issues, label, userDeps, removals);
  log(`그래프 생성 · ${label} · 이슈 ${issues.length}개 · 사용자 선 ${userDeps.length} · 지운 선 ${removals.length} · 입력 ${comma(prompt.length)}자`);

  let out: Output | null = null;
  let cost = 0;
  for (let attempt = 0; attempt < 2 && out === null; attempt++) {
    const next = attempt === 0 ? "다시 묻는다" : "그만 묻는다";
    try {
      const r = await proposer(prompt, GRAPH_SCHEMA, log);
      cost += r.cost_usd;
      out = parseOutput(r.output);
      if (out === null) log(`출력이 선 모양이 아니다 · ${next}`);
    } catch (e) {
      log(`claude 실패 · ${(e as Error).message} · ${next}`);
    }
  }
  if (out === null) {
    const saved = saveRun(db, repo_id, { status: "none", added: 0, warnings: [], suggestions: 0, cost_usd: cost });
    log(`생성 없음 · 선 · 제안은 그대로 · 생성 #${saved.id} · 합계 ${cost.toFixed(2)} USD`);
    return saved;
  }

  const s = sortOutput(issues, userDeps, removals, out);
  const count = (k: SuggestionKind) => s.suggestions.filter((x) => x.kind === k).length;
  log(
    `거르기 · claude 선 ${s.add.length} · 순환 버림 ${s.warnings.filter((w) => w.kind === "cycle").length} · 모르는 선 ${s.warnings.filter((w) => w.kind === "unknown").length}` +
      ` · 지우자 ${count("remove")} · 뒤집자 ${count("reverse")} · 다시 긋자 ${count("redraw")}`,
  );
  const saved = db.transaction(() => {
    // 닫힌 이슈에 걸린 것까지 그 레포의 claude 선은 전부 갈아끼운다.
    db.run("delete from deps where source = 'claude' and blocker_id in (select id from issues where repo_id = ?)", [repo_id]);
    for (const e of s.add) {
      db.run(
        "insert into deps (blocker_id, blocked_id, source, reason) values (?, ?, 'claude', ?) on conflict (blocker_id, blocked_id) do nothing",
        [e.blocker_id, e.blocked_id, e.reason],
      );
    }
    db.run("delete from dep_suggestions where repo_id = ?", [repo_id]);
    for (const x of s.suggestions) {
      db.run("insert into dep_suggestions (repo_id, kind, blocker_id, blocked_id, reason) values (?, ?, ?, ?, ?)", [repo_id, x.kind, x.blocker_id, x.blocked_id, x.reason]);
    }
    return saveRun(db, repo_id, { status: "ok", added: s.add.length, warnings: s.warnings, suggestions: s.suggestions.length, cost_usd: cost });
  })();
  log(`저장 · 생성 #${saved.id} · 합계 ${cost.toFixed(2)} USD`);
  return saved;
}

export function latestGraphRun(db: Database, repo_id: number): GraphRun | null {
  const row = db
    .query<{ id: number; created_at: string; output: string }, [number]>("select id, created_at, output from graph_runs where repo_id = ? order by id desc limit 1")
    .get(repo_id);
  if (!row) return null;
  return { ...(JSON.parse(row.output) as RunBody), id: row.id, repo_id, created_at: row.created_at };
}

export function listSuggestions(db: Database, repo_id: number): DepSuggestion[] {
  return db.query<DepSuggestion, [number]>("select * from dep_suggestions where repo_id = ? order by id").all(repo_id);
}
