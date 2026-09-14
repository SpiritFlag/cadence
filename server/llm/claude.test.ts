import { test, expect } from "bun:test";
import { claudeArgs, finishStream, newStream, readStreamLine } from "./claude";

// opus 실호출(2026-09-14)의 이벤트 순서에서 읽는 필드만 남겼다.
const REAL = [
  { type: "system", subtype: "init", model: "claude-opus-5" },
  { type: "system", subtype: "status" },
  { type: "rate_limit_event" },
  { type: "stream_event", event: { type: "message_start" } },
  { type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "StructuredOutput" } } },
  { type: "stream_event", event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"nums":' } } },
  { type: "stream_event", event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "[1,2,3]}" } } },
  { type: "assistant", message: { content: [{ type: "tool_use", name: "StructuredOutput", input: { nums: [1, 2, 3] } }] } },
  { type: "stream_event", event: { type: "content_block_stop" } },
  { type: "user" },
  { type: "stream_event", event: { type: "message_stop" } },
  { type: "result", subtype: "success", is_error: false, duration_ms: 2704, total_cost_usd: 0.065197, result: '{"nums":[1,2,3]}', structured_output: { nums: [1, 2, 3] } },
].map((e) => JSON.stringify(e));

function read(lines: string[]) {
  const s = newStream();
  const notes = lines.map((l) => readStreamLine(s, l)).filter((n): n is string => n !== null);
  return { s, notes };
}

test("실호출 이벤트에서 모델 · 구조화 출력 · 비용을 뽑고 진행 줄을 낸다", () => {
  const { s, notes } = read(REAL);
  expect(notes).toEqual(["claude 시작 · 모델 claude-opus-5", "응답 받는 중", "응답 끝 · 0.07 USD · 2.7초"]);
  expect(s.model).toBe("claude-opus-5");
  expect(finishStream(s)).toEqual({ output: { nums: [1, 2, 3] }, cost_usd: 0.065197 });
});

test("깨진 줄이 섞여도 결과 이벤트를 찾는다", () => {
  const mixed = ["", "{깨짐", ...REAL.slice(0, 5), "Warning: 뭔가", "null", ...REAL.slice(5)];
  const { s } = read(mixed);
  expect(finishStream(s).output).toEqual({ nums: [1, 2, 3] });
});

test("응답이 길면 1000자마다 받는 중 줄을 낸다", () => {
  const delta = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { partial_json: "x".repeat(500) } } });
  const { notes } = read([REAL[3]!, delta, delta, delta, delta, delta]);
  expect(notes).toEqual(["응답 받는 중", "응답 받는 중 · 1,000자", "응답 받는 중 · 2,000자"]);
});

test("결과가 오류이거나 없으면 던진다", () => {
  const err = JSON.stringify({ type: "result", is_error: true, result: "예산 초과", total_cost_usd: 1 });
  expect(() => finishStream(read([err]).s)).toThrow("예산 초과");
  expect(() => finishStream(read(REAL.slice(0, 4)).s)).toThrow("결과 이벤트가 없다");
});

test("opus로 stream-json을 요청한다", () => {
  const args = claudeArgs("claude", {});
  expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual(["--model", "opus"]);
  expect(args).toContain("stream-json");
  expect(args).toContain("--verbose");
});
