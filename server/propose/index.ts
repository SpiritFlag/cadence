import type { Database } from "bun:sqlite";
import type { Proposer } from "../llm/claude";
import { comma, noLog, type Log } from "../log";
import type { Issue, Repo } from "../sync";
import type { Dep } from "../deps";
import { candidateOrder, checkPackages, orderable, PACKAGE_MAX, type Priority, type Promotion, type PackageWarning } from "../graph/order";
import type { Edge } from "../graph/cycle";
import { carryOver, markPackages, snapshotOf, type Carry, type PackageMarks, type PrevProposal } from "./carry";

export type LabelChange = { issue_id: number; from: Priority; to: Priority };
export type Package = {
  rank: number;
  name: string;
  issue_ids: number[];
  reason: string;
  label_changes: LabelChange[];
  /** 유지한 직전 패키지의 키(K1…). 새 패키지면 null. 옛 제안에는 없다. */
  keep?: string | null;
  /** 유지 패키지를 앞지른 이유. 앞지르지 않았으면 "". */
  overtake_reason?: string;
  /** 코드가 직전 제안과 비교해 붙인 표시. 이어간 제안에만 있다. */
  marks?: PackageMarks;
};

export type Proposal = {
  id: number;
  repo_id: number;
  created_at: string;
  /** ok: LLM 제안 있음. none: 두 번 다 깨져 후보 순서만. */
  status: "ok" | "none";
  packages: Package[];
  warnings: PackageWarning[];
  order: number[];
  cycles: Edge[];
  promotions: Promotion[];
  cost_usd: number;
  /** 순서에 든 이슈의 제목 · 본문 해시. 다음 제안이 이것으로 이어간다. 옛 제안에는 없다. */
  snapshot?: Record<string, string>;
  /** 이어간 직전 제안 id. 백지에서 짰으면 null. */
  carried_from?: number | null;
};

/** 제안 하나의 패키지 수 상한. 넘친 이슈는 다음 제안까지 대기다. */
export const PROPOSAL_MAX = 5;

export const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    packages: {
      type: "array",
      maxItems: PROPOSAL_MAX,
      items: {
        type: "object",
        properties: {
          rank: { type: "integer" },
          name: { type: "string" },
          issue_ids: { type: "array", items: { type: "integer" } },
          reason: { type: "string" },
          keep: { type: "string" },
          overtake_reason: { type: "string" },
          label_changes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                issue_id: { type: "integer" },
                from: { type: "string", enum: ["p1", "p2", "p3"] },
                to: { type: "string", enum: ["p1", "p2", "p3"] },
              },
              required: ["issue_id", "from", "to"],
            },
          },
        },
        required: ["rank", "name", "issue_ids", "reason", "keep", "overtake_reason", "label_changes"],
      },
    },
  },
  required: ["packages"],
} as const;

/** 이어가기 절. 유지 순서 · 풀린 · 새 · 바뀐 · 대기 이슈와 규칙. */
function carryLines(carry: Carry, issues: Issue[]): string[] {
  const num = (id: number) => `#${issues.find((i) => i.id === id)?.number ?? id}`;
  const list = (ids: number[]) => (ids.length ? ids.map((id) => `id ${id} (${num(id)})`).join(", ") : "(없음)");
  const lines = ["", "## 직전 제안에서 이어지는 것", "사용자는 직전 제안의 순위를 이미 보고 있다. 그 순서를 지키는 것이 기본이다."];
  lines.push("", "### 유지 패키지 (이 순서대로)");
  if (carry.kept.length === 0) lines.push("(없음)");
  for (const k of carry.kept) {
    lines.push(`- ${k.key} · ${k.name} · 이슈 ${list(k.issue_ids)} · 직전 이유: ${k.reason}${k.moved_by_deps ? " · 선 때문에 코드가 앞으로 옮김" : ""}`);
  }
  lines.push("", "### 풀린 이슈 (같은 패키지의 다른 이슈가 사이클에 들어가 남은 것. 다시 배치한다)", list(carry.released));
  lines.push("", "### 새 이슈 (직전 제안 뒤에 생겼거나 다시 순서에 든 것)", list(carry.fresh));
  lines.push("", "### 바뀐 이슈 (제목이나 본문이 달라진 것)", list(carry.changed));
  lines.push("", "### 대기 이슈", list(carry.waiting));
  lines.push("", "### 이어가기 규칙");
  lines.push("A. 유지 패키지를 낼 때는 keep에 그 키(K1…)를 적고 이름과 이슈를 그대로 둔다. 새 패키지는 keep이 빈 문자열이다.");
  lines.push("B. 유지 패키지끼리 순서를 바꾸지 않는다. 유지 패키지 뒤에 남는 칸을 풀린 · 새 · 대기 이슈로 채운다.");
  lines.push("C. 새 이슈나 바뀐 이슈를 담은 패키지만 정말 급할 때 유지 패키지 앞에 둔다. 그때 overtake_reason에 왜 급한지 \"-다\" 체 한 문장을 적는다. 앞지르지 않으면 빈 문자열이다.");
  lines.push(`D. 새 이슈는 크기 ${PACKAGE_MAX}를 넘지 않으면 유지 패키지에 합류할 수 있다. 새 이슈가 아닌 이슈를 유지 패키지에 넣거나 유지 패키지의 이슈를 빼지 않는다.`);
  lines.push("E. 유지 패키지의 이슈를 막는 이슈가 유지 패키지 밖에 있으면 그 이슈를 담은 패키지를 앞에 둔다.");
  lines.push(`F. 앞지름으로 ${PROPOSAL_MAX}칸이 넘치면 맨 뒤 유지 패키지가 밀려난다. 칸이 남으면 유지 패키지를 빼지 않는다.`);
  return lines;
}

export function buildPrompt(issues: Issue[], repos: Repo[], deps: Dep[], order: ReturnType<typeof candidateOrder>, carry: Carry | null = null): string {
  const repoName = new Map(repos.map((r) => [r.id, `${r.owner}/${r.name}`]));
  const ids = new Set(orderable(issues).map((i) => i.id));
  const lines: string[] = [];
  lines.push("너는 혼자 개발하는 사용자의 비서다. 열린 이슈 중 다음에 같이 처리할 묶음(패키지)을 골라 순위를 매긴다.");
  lines.push("");
  lines.push("## 규칙");
  lines.push("1. 막는 것이 앞이다. A가 B를 막으면 A는 B와 같은 패키지거나 앞 패키지에 있어야 한다. 사슬을 끊지 않는다.");
  lines.push("2. 의미가 통하는 것끼리 묶는다. 같은 화면 · 같은 층 · 같은 목적이면 한 패키지다.");
  lines.push(`3. 패키지 하나는 이슈 ${PACKAGE_MAX}개 이하다. 사슬이 길면 앞부분만 자르고 나머지는 다음 패키지다.`);
  lines.push(`4. 패키지는 ${PROPOSAL_MAX}개까지다. 급한 것부터 채우고 나머지 이슈는 넣지 않는다. 한 이슈는 많아야 한 패키지에 한 번. hold 이슈는 넣지 않는다.`);
  lines.push("5. 급한 것이 앞이다. 본문에 왜 급한지 적혀 있으면 그것을 믿는다. p1 라벨은 강한 힌트다.");
  lines.push("6. 라벨 변경 제안은 올리는 것만이다. 후보 순서의 승격 제안은 그대로 포함하고, 본문을 보고 급하다고 판단한 것만 더한다. 내리는 제안은 없다.");
  lines.push("7. 이름은 한국어 짧은 명사구. 이유는 \"-다\" 체 한 문장. 사용자를 부르지 않는다.");
  lines.push("8. keep과 overtake_reason은 아래 \"직전 제안에서 이어지는 것\" 절을 따른다. 그 절이 없으면 둘 다 빈 문자열이다.");
  lines.push("");
  lines.push("## 코드가 만든 후보 순서 (위상 정렬 · 라벨 순. 승격을 반영함)");
  lines.push(order.order.map((id) => `#${issues.find((i) => i.id === id)?.number ?? id}`).join(" → ") || "(없음)");
  if (order.promotions.length > 0) {
    lines.push("");
    lines.push("## 코드가 만든 승격 제안");
    for (const p of order.promotions) {
      const n = issues.find((i) => i.id === p.issue_id)?.number ?? p.issue_id;
      lines.push(`- 이슈 id ${p.issue_id} (#${n}): ${p.from} → ${p.to}`);
    }
  }
  if (carry) lines.push(...carryLines(carry, issues));
  lines.push("");
  lines.push("## 의존 선 (blocker가 blocked를 막는다. id 기준)");
  const visible = deps.filter((d) => ids.has(d.blocker_id) && ids.has(d.blocked_id));
  lines.push(visible.length ? visible.map((d) => `- ${d.blocker_id} → ${d.blocked_id}`).join("\n") : "(없음)");
  lines.push("");
  lines.push("## 열린 이슈 (issue_ids와 label_changes.issue_id에는 반드시 이 id를 쓴다)");
  for (const i of orderable(issues)) {
    lines.push(`### id ${i.id} · ${repoName.get(i.repo_id) ?? i.repo_id} #${i.number} · 라벨 ${i.labels.length ? i.labels.join(", ") : "(없음)"}`);
    lines.push(`제목: ${i.title}`);
    lines.push(i.body.trim() ? i.body.trim() : "(본문 없음)");
    lines.push("");
  }
  return lines.join("\n");
}

function parsePackages(output: unknown): Package[] | null {
  if (!output || typeof output !== "object") return null;
  const pk = (output as { packages?: unknown }).packages;
  if (!Array.isArray(pk)) return null;
  const packages: Package[] = [];
  for (const p of pk) {
    if (!p || typeof p !== "object") return null;
    const o = p as Record<string, unknown>;
    if (typeof o.rank !== "number" || typeof o.name !== "string" || !Array.isArray(o.issue_ids) || typeof o.reason !== "string") return null;
    const lc = Array.isArray(o.label_changes) ? o.label_changes : [];
    packages.push({
      rank: o.rank,
      name: o.name,
      issue_ids: o.issue_ids.filter((x): x is number => typeof x === "number"),
      reason: o.reason,
      keep: typeof o.keep === "string" && o.keep.trim() ? o.keep.trim() : null,
      overtake_reason: typeof o.overtake_reason === "string" ? o.overtake_reason.trim() : "",
      label_changes: lc
        .filter((c): c is LabelChange => !!c && typeof c === "object" && typeof (c as LabelChange).issue_id === "number")
        .map((c) => ({ issue_id: c.issue_id, from: c.from, to: c.to })),
    });
  }
  packages.sort((a, b) => a.rank - b.rank);
  return packages;
}

function inputHash(issues: Issue[], deps: Dep[]): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(JSON.stringify(orderable(issues).map((i) => [i.id, i.labels])));
  h.update(JSON.stringify(deps.map((d) => [d.blocker_id, d.blocked_id])));
  return h.digest("hex");
}

type ProposalBody = Omit<Proposal, "id" | "repo_id" | "created_at">;

function save(db: Database, repo_id: number, hash: string, proposal: ProposalBody): Proposal {
  const r = db.run("insert into proposals (repo_id, input_hash, output) values (?, ?, ?)", [repo_id, hash, JSON.stringify(proposal)]);
  const row = db.query<{ id: number; created_at: string }, [number]>("select id, created_at from proposals where id = ?").get(Number(r.lastInsertRowid))!;
  return { ...proposal, id: row.id, repo_id, created_at: row.created_at };
}

/** 이어갈 직전 제안: 그 레포의 마지막 ok 제안. 스냅샷이 없는 옛 제안이면 이어가지 않는다. */
function carryBase(db: Database, repo_id: number): (PrevProposal & { id: number }) | null {
  const row = db
    .query<{ id: number; output: string }, [number]>(
      "select id, output from proposals where repo_id = ? and json_extract(output, '$.status') = 'ok' order by id desc limit 1",
    )
    .get(repo_id);
  if (!row) return null;
  const body = JSON.parse(row.output) as ProposalBody;
  return body.snapshot ? { id: row.id, packages: body.packages, snapshot: body.snapshot } : null;
}

export type ProposeResult = { ok: true; proposal: Proposal } | { ok: false; reason: "cycle"; cycles: Edge[] };

/** 고른 레포의 이슈로만 후보 순서를 만들고, 순환이 없으면 LLM에 묻고, 검증해서 그 레포 제안으로 저장한다. 단계마다 log에 한 줄. */
export async function propose(
  db: Database, repo_id: number, allIssues: Issue[], repos: Repo[], allDeps: Dep[], proposer: Proposer, log: Log = noLog,
): Promise<ProposeResult> {
  const issues = allIssues.filter((i) => i.repo_id === repo_id);
  const ids = new Set(issues.map((i) => i.id));
  const deps = allDeps.filter((d) => ids.has(d.blocker_id) && ids.has(d.blocked_id));
  const repo = repos.find((r) => r.id === repo_id);
  const label = repo ? `${repo.owner}/${repo.name}` : `레포 ${repo_id}`;
  const order = candidateOrder(issues, deps);
  if (order.cycles.length > 0) {
    log(`제안 · ${label} · 순환 선 ${order.cycles.length}개라 돌지 않는다`);
    return { ok: false, reason: "cycle", cycles: order.cycles };
  }

  const prev = carryBase(db, repo_id);
  const carry = prev ? carryOver(prev, issues, deps) : null;
  const prompt = buildPrompt(issues, repos, deps, order, carry);
  const hash = inputHash(issues, deps);
  log(`제안 · ${label} · 이슈 ${orderable(issues).length}개 · 입력 ${comma(prompt.length)}자`);
  log(
    prev && carry
      ? `이어가기 · 제안 #${prev.id}에서 · 유지 ${carry.kept.length} · 뽑힘 ${carry.picked.length} · 풀림 ${carry.released.length} · 새 ${carry.fresh.length} · 바뀐 ${carry.changed.length}`
      : "이어가기 없음 · 백지에서 짠다",
  );
  let packages: Package[] | null = null;
  let cost = 0;
  for (let attempt = 0; attempt < 2 && packages === null; attempt++) {
    const next = attempt === 0 ? "다시 묻는다" : "그만 묻는다";
    try {
      const r = await proposer(prompt, PROPOSAL_SCHEMA, log);
      cost += r.cost_usd;
      packages = parsePackages(r.output);
      if (packages === null) log(`출력이 패키지 모양이 아니다 · ${next}`);
      else if (packages.length > PROPOSAL_MAX) {
        log(`패키지 ${packages.length}개 · 앞 ${PROPOSAL_MAX}개만 남긴다`);
        packages = packages.slice(0, PROPOSAL_MAX);
      }
    } catch (e) {
      log(`claude 실패 · ${(e as Error).message} · ${next}`);
    }
  }
  const base = { order: order.order, cycles: [], promotions: order.promotions, cost_usd: cost, snapshot: snapshotOf(issues), carried_from: prev?.id ?? null };
  if (packages === null) {
    const saved = save(db, repo_id, hash, { status: "none", packages: [], warnings: [], ...base });
    log(`제안 없음 · 후보 순서만 저장 · 제안 #${saved.id} · 합계 ${cost.toFixed(2)} USD`);
    return { ok: true, proposal: saved };
  }
  let final: Package[] = packages;
  const warnings = checkPackages(final, issues, deps);
  if (carry) {
    const carried = final.map((p) => ({ rank: p.rank, issue_ids: p.issue_ids, keep: p.keep ?? null, overtake_reason: p.overtake_reason ?? "" }));
    const r = markPackages(carried, carry, issues, deps, PROPOSAL_MAX);
    final = final.map((p, k) => ({ ...p, marks: r.marks[k]! }));
    warnings.push(...r.warnings);
    const m = r.marks;
    log(`이어가기 표시 · 앞지름 ${m.filter((x) => x.overtake !== null).length} · 합류 ${m.filter((x) => x.joined.length > 0).length} · 선 이동 ${m.filter((x) => x.moved_by_deps).length}`);
  }
  log(`검증 · 패키지 ${final.length} · 경고 ${warnings.length}`);
  const saved = save(db, repo_id, hash, { status: "ok", packages: final, warnings, ...base });
  log(`저장 · 제안 #${saved.id} · 합계 ${cost.toFixed(2)} USD`);
  return { ok: true, proposal: saved };
}

export function latestProposal(db: Database, repo_id: number): Proposal | null {
  const row = db
    .query<{ id: number; created_at: string; output: string }, [number]>("select id, created_at, output from proposals where repo_id = ? order by id desc limit 1")
    .get(repo_id);
  if (!row) return null;
  return { ...(JSON.parse(row.output) as ProposalBody), id: row.id, repo_id, created_at: row.created_at };
}
