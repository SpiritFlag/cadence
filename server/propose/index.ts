import type { Database } from "bun:sqlite";
import type { Proposer } from "../llm/claude";
import type { Issue, Repo } from "../sync";
import type { Dep } from "../deps";
import { candidateOrder, checkPackages, orderable, PACKAGE_MAX, type Priority, type Promotion, type PackageWarning } from "../graph/order";
import type { Edge } from "../graph/cycle";

export type LabelChange = { issue_id: number; from: Priority; to: Priority };
export type Package = { rank: number; name: string; issue_ids: number[]; reason: string; label_changes: LabelChange[] };

export type Proposal = {
  id: number;
  created_at: string;
  /** ok: LLM 제안 있음. none: 두 번 다 깨져 후보 순서만. */
  status: "ok" | "none";
  packages: Package[];
  warnings: PackageWarning[];
  order: number[];
  cycles: Edge[];
  promotions: Promotion[];
  cost_usd: number;
};

export const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    packages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rank: { type: "integer" },
          name: { type: "string" },
          issue_ids: { type: "array", items: { type: "integer" } },
          reason: { type: "string" },
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
        required: ["rank", "name", "issue_ids", "reason", "label_changes"],
      },
    },
  },
  required: ["packages"],
} as const;

export function buildPrompt(issues: Issue[], repos: Repo[], deps: Dep[], order: ReturnType<typeof candidateOrder>): string {
  const repoName = new Map(repos.map((r) => [r.id, `${r.owner}/${r.name}`]));
  const ids = new Set(orderable(issues).map((i) => i.id));
  const lines: string[] = [];
  lines.push("너는 혼자 개발하는 사용자의 비서다. 열린 이슈를 같이 처리할 묶음(패키지)으로 나누고 순위를 매긴다.");
  lines.push("");
  lines.push("## 규칙");
  lines.push("1. 막는 것이 앞이다. A가 B를 막으면 A는 B와 같은 패키지거나 앞 패키지에 있어야 한다. 사슬을 끊지 않는다.");
  lines.push("2. 의미가 통하는 것끼리 묶는다. 같은 화면 · 같은 층 · 같은 목적이면 한 패키지다.");
  lines.push(`3. 패키지 하나는 이슈 ${PACKAGE_MAX}개 이하다. 사슬이 길면 앞부분만 자르고 나머지는 다음 패키지다.`);
  lines.push("4. 순서에 드는 이슈는 전부 어느 한 패키지에 정확히 한 번 들어간다. hold 이슈는 넣지 않는다.");
  lines.push("5. 급한 것이 앞이다. 본문에 왜 급한지 적혀 있으면 그것을 믿는다. p1 라벨은 강한 힌트다.");
  lines.push("6. 라벨 변경 제안은 올리는 것만이다. 후보 순서의 승격 제안은 그대로 포함하고, 본문을 보고 급하다고 판단한 것만 더한다. 내리는 제안은 없다.");
  lines.push("7. 이름은 한국어 짧은 명사구. 이유는 \"-다\" 체 한 문장. 사용자를 부르지 않는다.");
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

function save(db: Database, hash: string, proposal: Omit<Proposal, "id" | "created_at">): Proposal {
  const r = db.run("insert into proposals (input_hash, output) values (?, ?)", [hash, JSON.stringify(proposal)]);
  const row = db.query<{ id: number; created_at: string }, [number]>("select id, created_at from proposals where id = ?").get(Number(r.lastInsertRowid))!;
  return { ...proposal, id: row.id, created_at: row.created_at };
}

export type ProposeResult = { ok: true; proposal: Proposal } | { ok: false; reason: "cycle"; cycles: Edge[] };

/** 후보 순서를 만들고, 순환이 없으면 LLM에 묻고, 검증해서 저장한다. */
export async function propose(db: Database, issues: Issue[], repos: Repo[], deps: Dep[], proposer: Proposer): Promise<ProposeResult> {
  const order = candidateOrder(issues, deps);
  if (order.cycles.length > 0) return { ok: false, reason: "cycle", cycles: order.cycles };

  const prompt = buildPrompt(issues, repos, deps, order);
  const hash = inputHash(issues, deps);
  let packages: Package[] | null = null;
  let cost = 0;
  for (let attempt = 0; attempt < 2 && packages === null; attempt++) {
    try {
      const r = await proposer(prompt, PROPOSAL_SCHEMA);
      cost += r.cost_usd;
      packages = parsePackages(r.output);
    } catch {
      packages = null;
    }
  }
  const base = { order: order.order, cycles: [], promotions: order.promotions, cost_usd: cost };
  if (packages === null) {
    return { ok: true, proposal: save(db, hash, { status: "none", packages: [], warnings: [], ...base }) };
  }
  const warnings = checkPackages(packages, issues, deps);
  return { ok: true, proposal: save(db, hash, { status: "ok", packages, warnings, ...base }) };
}

export function latestProposal(db: Database): Proposal | null {
  const row = db.query<{ id: number; created_at: string; output: string }, []>("select id, created_at, output from proposals order by id desc limit 1").get();
  if (!row) return null;
  return { ...(JSON.parse(row.output) as Omit<Proposal, "id" | "created_at">), id: row.id, created_at: row.created_at };
}
