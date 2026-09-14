import { test, expect } from "bun:test";
import { comma, createLogBus, type LogLine } from "./index";

test("찍고, 구독자에게 뿌리고, 최근 줄만 든다", () => {
  const printed: string[] = [];
  const bus = createLogBus({ keep: 2, print: (l) => printed.push(l.text), now: () => new Date("2026-09-14T11:00:00Z") });
  const got: LogLine[] = [];
  const stop = bus.subscribe((l) => got.push(l));
  bus.log("하나");
  bus.log("둘");
  stop();
  bus.log("셋");
  expect(printed).toEqual(["하나", "둘", "셋"]);
  expect(got.map((l) => l.text)).toEqual(["하나", "둘"]);
  expect(bus.recent()).toEqual([
    { at: "2026-09-14T11:00:00.000Z", text: "둘" },
    { at: "2026-09-14T11:00:00.000Z", text: "셋" },
  ]);
});

test("천 단위 쉼표", () => {
  expect(comma(7)).toBe("7");
  expect(comma(18240)).toBe("18,240");
  expect(comma(1234567)).toBe("1,234,567");
});
