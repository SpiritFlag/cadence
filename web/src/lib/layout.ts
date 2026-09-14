import dagre from "@dagrejs/dagre";
import { MarkerType, type Edge as FlowEdge, type Node as FlowNode } from "@xyflow/svelte";
import type { Issue } from "../../../server/sync";
import type { Dep } from "../../../server/deps";
import { cycleEdges, edgeKey } from "../../../server/graph/cycle";

export const NODE_W = 240;
export const NODE_H = 64;
/** claude가 그은 선 색. 상세 칩과 같다. */
export const CLAUDE_COLOR = "#8250df";

export type IssueNodeData = { issue: Issue; [k: string]: unknown };
export type IssueFlowNode = FlowNode<IssueNodeData, "issue">;

/**
 * 열린 이슈와 의존 선 → xyflow 노드 · 엣지. 좌표는 dagre가 위에서 아래로.
 * 양 끝이 다 열린 이슈인 선만 그린다. 순환에 걸린 선은 data.cycle = true.
 */
export function layoutGraph(issues: Issue[], deps: Dep[], selectedId: number | null) {
  const ids = new Set(issues.map((i) => i.id));
  const visible = deps.filter((d) => ids.has(d.blocker_id) && ids.has(d.blocked_id));
  const inCycle = new Set(cycleEdges(visible).map(edgeKey));

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 24, ranksep: 48 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const i of issues) g.setNode(String(i.id), { width: NODE_W, height: NODE_H });
  for (const d of visible) g.setEdge(String(d.blocker_id), String(d.blocked_id));
  dagre.layout(g);

  const nodes: IssueFlowNode[] = issues.map((issue) => {
    const p = g.node(String(issue.id));
    return {
      id: String(issue.id),
      type: "issue",
      position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 },
      width: NODE_W,
      height: NODE_H,
      selected: issue.id === selectedId,
      data: { issue },
    };
  });

  // 사용자 선은 회색 실선, claude 선은 보라 점선. 순환이면 빨강이 이긴다.
  const edges: FlowEdge[] = visible.map((d) => {
    const cycle = inCycle.has(edgeKey(d));
    const claude = d.source === "claude";
    const color = cycle ? "#d73a4a" : claude ? CLAUDE_COLOR : "#888";
    return {
      id: edgeKey(d),
      source: String(d.blocker_id),
      target: String(d.blocked_id),
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: `stroke:${color}${cycle ? ";stroke-width:2" : ""}${claude ? ";stroke-dasharray:6 4" : ""}`,
      data: { cycle, claude },
    };
  });

  return { nodes, edges };
}
