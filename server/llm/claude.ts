// claude CLI를 자식 프로세스로 부른다. 인증은 Claude Code가 갖고 있다.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { comma, type Log } from "../log";

export type ProposerResult = { output: unknown; cost_usd: number };

/** 프롬프트와 JSON 스키마를 주면 스키마에 맞는 객체를 돌려준다. 진행은 log로 흘린다. 테스트는 가짜를 끼운다. */
export type Proposer = (prompt: string, schema: object, log: Log) => Promise<ProposerResult>;

export const MODEL = "opus";
export const MAX_BUDGET_USD = 1;
/** "응답 받는 중" 줄을 이 글자 수마다 하나씩 남긴다. */
const PROGRESS_CHARS = 1000;

function workDir(): string {
  // 프로젝트 밖에서 돌려 CLAUDE.md 자동 탐색을 피한다.
  const dir = process.env.CADENCE_HOME ?? join(homedir(), ".cadence");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function claudeArgs(bin: string, schema: object): string[] {
  return [
    bin, "-p",
    "--model", MODEL,
    "--tools", "",
    "--no-session-persistence",
    "--setting-sources", "user",
    "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--json-schema", JSON.stringify(schema),
    "--max-budget-usd", String(MAX_BUDGET_USD),
  ];
}

// ---- stream-json 읽기. 한 줄이 이벤트 하나다. ----

export type StreamState = {
  model: string | null;
  receiving: boolean;
  chars: number;
  reported: number;
  result: { output: unknown; cost_usd: number; is_error: boolean; message: string } | null;
};

export const newStream = (): StreamState => ({ model: null, receiving: false, chars: 0, reported: 0, result: null });

type StreamEvent = {
  type?: string;
  subtype?: string;
  model?: unknown;
  event?: { type?: string; delta?: { partial_json?: unknown; text?: unknown } };
  is_error?: unknown;
  result?: unknown;
  structured_output?: unknown;
  total_cost_usd?: unknown;
  duration_ms?: unknown;
};

const len = (v: unknown) => (typeof v === "string" ? v.length : 0);

/** 한 줄을 읽어 상태를 바꾸고, 로그로 남길 줄이 있으면 돌려준다. JSON이 아닌 줄은 건너뛴다. */
export function readStreamLine(s: StreamState, line: string): string | null {
  let e: StreamEvent;
  try {
    e = JSON.parse(line) as StreamEvent;
  } catch {
    return null;
  }
  if (!e || typeof e !== "object") return null;

  if (e.type === "system" && e.subtype === "init") {
    s.model = typeof e.model === "string" ? e.model : null;
    return `claude 시작 · 모델 ${s.model ?? "(모름)"}`;
  }
  if (e.type === "stream_event") {
    if (e.event?.type === "message_start" && !s.receiving) {
      s.receiving = true;
      return "응답 받는 중";
    }
    if (e.event?.type === "content_block_delta") {
      s.chars += len(e.event.delta?.partial_json) + len(e.event.delta?.text);
      if (s.chars - s.reported >= PROGRESS_CHARS) {
        s.reported = s.chars;
        return `응답 받는 중 · ${comma(s.chars)}자`;
      }
    }
    return null;
  }
  if (e.type === "result") {
    const cost = typeof e.total_cost_usd === "number" ? e.total_cost_usd : 0;
    const is_error = e.is_error === true;
    s.result = { output: e.structured_output, cost_usd: cost, is_error, message: typeof e.result === "string" ? e.result : "" };
    const secs = typeof e.duration_ms === "number" ? ` · ${(e.duration_ms / 1000).toFixed(1)}초` : "";
    return `응답 끝 · ${cost.toFixed(2)} USD${secs}${is_error ? " · 오류" : ""}`;
  }
  return null;
}

/** 다 읽은 뒤 결과를 꺼낸다. 결과 이벤트가 없거나 오류면 던진다. */
export function finishStream(s: StreamState): ProposerResult {
  if (!s.result) throw new Error("claude 결과 이벤트가 없다");
  if (s.result.is_error) throw new Error(`claude 오류: ${s.result.message || "(없음)"}`);
  return { output: s.result.output, cost_usd: s.result.cost_usd };
}

export const claudeProposer: Proposer = async (prompt, schema, log) => {
  const bin = process.env.CADENCE_CLAUDE ?? "claude";
  log(`claude 호출 · ${MODEL} 요청`);
  const proc = Bun.spawn(claudeArgs(bin, schema), { cwd: workDir(), stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" });
  const errText = new Response(proc.stderr).text();

  const state = newStream();
  const feed = (line: string) => {
    const note = readStreamLine(state, line);
    if (note) log(note);
  };
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of proc.stdout) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      feed(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  buf += decoder.decode();
  if (buf.trim()) feed(buf);

  const [err, code] = await Promise.all([errText, proc.exited]);
  if (code !== 0) throw new Error(`claude 실패 (${code}): ${state.result?.message || err.trim().slice(0, 300) || "(출력 없음)"}`);
  return finishStream(state);
};
