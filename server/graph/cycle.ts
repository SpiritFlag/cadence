// 순환 검출. 플레인 TS — 프론트도 가져다 쓴다. Bun 전용 API를 쓰지 않는다.

/** blocker가 blocked를 막는다. deps 행과 같은 모양이라 그대로 넘길 수 있다. */
export type Edge = { blocker_id: number; blocked_id: number };

export const edgeKey = (e: Edge) => `${e.blocker_id}->${e.blocked_id}`;

/**
 * 순환에 걸린 선들. 같은 강한 연결 요소(SCC) 안의 선이 곧 순환에 걸린 선이다.
 * 자기 자신을 가리키는 선도 순환이다.
 */
export function cycleEdges(edges: Edge[]): Edge[] {
  const adj = new Map<number, number[]>();
  for (const e of edges) {
    if (!adj.has(e.blocker_id)) adj.set(e.blocker_id, []);
    if (!adj.has(e.blocked_id)) adj.set(e.blocked_id, []);
    adj.get(e.blocker_id)!.push(e.blocked_id);
  }

  // Tarjan
  const index = new Map<number, number>();
  const low = new Map<number, number>();
  const onStack = new Set<number>();
  const stack: number[] = [];
  const comp = new Map<number, number>();
  let counter = 0;
  let compCount = 0;

  const visit = (v: number) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      let w: number;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.set(w, compCount);
      } while (w !== v);
      compCount++;
    }
  };
  for (const v of adj.keys()) if (!index.has(v)) visit(v);

  const compSize = new Map<number, number>();
  for (const c of comp.values()) compSize.set(c, (compSize.get(c) ?? 0) + 1);

  return edges.filter((e) => {
    if (e.blocker_id === e.blocked_id) return true;
    const c = comp.get(e.blocker_id);
    return c !== undefined && c === comp.get(e.blocked_id) && (compSize.get(c) ?? 0) > 1;
  });
}

export function hasCycle(edges: Edge[]): boolean {
  return cycleEdges(edges).length > 0;
}
