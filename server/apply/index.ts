import type { Database } from "bun:sqlite";
import type { GhLabels } from "../github/gh";
import { priorityOf, type Priority } from "../graph/order";

/** cadence가 GitHub에 쓰는 라벨은 이 넷뿐이다. */
export const PRIORITY_LABELS = ["p1", "p2", "p3", "hold"] as const;
const P_LABELS: readonly string[] = ["p1", "p2", "p3"];

export type ApplyChange = { issue_id: number; from: Priority; to: Priority };
export type ApplyOutcome = { issue_id: number; status: "applied" | "skipped" | "failed"; message: string };

type Target = { owner: string; name: string; number: number };

function target(db: Database, issue_id: number): Target | null {
  return db
    .query<Target, [number]>(
      "select r.owner, r.name, i.number from issues i join repos r on r.id = i.repo_id where i.id = ?",
    )
    .get(issue_id);
}

/**
 * 승인한 라벨 변경을 건마다 반영한다. 건마다 지금 라벨을 다시 읽어 제안 당시와 다르면 건너뛴다.
 * 한 건이 실패해도 나머지는 계속한다.
 */
export async function applyChanges(db: Database, changes: ApplyChange[], gh: GhLabels): Promise<ApplyOutcome[]> {
  const outcomes: ApplyOutcome[] = [];
  const seen = new Set<number>();
  for (const c of changes) {
    if (seen.has(c.issue_id)) continue;
    seen.add(c.issue_id);
    if (!(PRIORITY_LABELS as readonly string[]).includes(c.to)) {
      outcomes.push({ issue_id: c.issue_id, status: "failed", message: `쓸 수 없는 라벨: ${c.to}` });
      continue;
    }
    const t = target(db, c.issue_id);
    if (!t) {
      outcomes.push({ issue_id: c.issue_id, status: "failed", message: "없는 이슈" });
      continue;
    }
    try {
      const current = await gh.read(t.owner, t.name, t.number);
      if (current.includes(c.to)) {
        outcomes.push({ issue_id: c.issue_id, status: "skipped", message: `이미 ${c.to}` });
        continue;
      }
      const now = priorityOf(current);
      if (now !== c.from) {
        outcomes.push({ issue_id: c.issue_id, status: "skipped", message: `제안 때는 ${c.from}, 지금은 ${now}` });
        continue;
      }
      const remove = current.filter((l) => P_LABELS.includes(l) && l !== c.to);
      await gh.write(t.owner, t.name, t.number, [c.to], remove);
      outcomes.push({ issue_id: c.issue_id, status: "applied", message: `${c.from} → ${c.to}` });
    } catch (e) {
      outcomes.push({ issue_id: c.issue_id, status: "failed", message: (e as Error).message });
    }
  }
  return outcomes;
}
