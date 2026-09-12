// claude CLI를 자식 프로세스로 부른다. 인증은 Claude Code가 갖고 있다.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ProposerResult = { output: unknown; cost_usd: number };

/** 프롬프트와 JSON 스키마를 주면 스키마에 맞는 객체를 돌려준다. 테스트는 가짜를 끼운다. */
export type Proposer = (prompt: string, schema: object) => Promise<ProposerResult>;

export const MAX_BUDGET_USD = 1;

function workDir(): string {
  // 프로젝트 밖에서 돌려 CLAUDE.md 자동 탐색을 피한다.
  const dir = process.env.CADENCE_HOME ?? join(homedir(), ".cadence");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const claudeProposer: Proposer = async (prompt, schema) => {
  const bin = process.env.CADENCE_CLAUDE ?? "claude";
  const proc = Bun.spawn(
    [
      bin, "-p",
      "--tools", "",
      "--no-session-persistence",
      "--setting-sources", "user",
      "--output-format", "json",
      "--json-schema", JSON.stringify(schema),
      "--max-budget-usd", String(MAX_BUDGET_USD),
    ],
    { cwd: workDir(), stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`claude 실패 (${code}): ${err.trim() || out.trim().slice(0, 300)}`);
  let envelope: { is_error?: boolean; result?: string; structured_output?: unknown; total_cost_usd?: number };
  try {
    envelope = JSON.parse(out);
  } catch {
    throw new Error(`claude 출력이 JSON이 아니다: ${out.slice(0, 300)}`);
  }
  if (envelope.is_error) throw new Error(`claude 오류: ${envelope.result ?? "(없음)"}`);
  return { output: envelope.structured_output, cost_usd: envelope.total_cost_usd ?? 0 };
};
