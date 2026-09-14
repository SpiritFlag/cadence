// 서버 안 로그 버스. 줄을 터미널에 찍고, 구독자에게 뿌리고, 최근 줄을 든다.

export type LogLine = { at: string; text: string };
export type Log = (text: string) => void;
export type LogBus = {
  log: Log;
  recent: () => LogLine[];
  /** 돌려받은 함수를 부르면 구독이 끝난다. */
  subscribe: (fn: (line: LogLine) => void) => () => void;
};

export const LOG_KEEP = 200;

export const noLog: Log = () => {};

/** 시각은 UTC ISO로 들고, 터미널에는 로컬 시:분:초로 찍는다. */
export function createLogBus(opts: { keep?: number; print?: (line: LogLine) => void; now?: () => Date } = {}): LogBus {
  const keep = opts.keep ?? LOG_KEEP;
  const print = opts.print ?? ((l: LogLine) => console.log(`${clock(l.at)} ${l.text}`));
  const now = opts.now ?? (() => new Date());
  const lines: LogLine[] = [];
  const subs = new Set<(line: LogLine) => void>();
  return {
    log(text) {
      const line = { at: now().toISOString(), text };
      lines.push(line);
      if (lines.length > keep) lines.splice(0, lines.length - keep);
      print(line);
      for (const fn of subs) fn(line);
    },
    recent: () => [...lines],
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}

/** ISO 시각 → 로컬 "HH:MM:SS". */
export function clock(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

/** 1234567 → "1,234,567". 로케일에 기대지 않는다. */
export function comma(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
