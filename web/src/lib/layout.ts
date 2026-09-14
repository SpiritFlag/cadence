import dagre from "@dagrejs/dagre";
import { MarkerType, type Edge as FlowEdge, type Node as FlowNode } from "@xyflow/svelte";
import type { Issue } from "../../../server/sync";
import type { Dep } from "../../../server/deps";
import type { Package } from "../../../server/propose";
import { cycleEdges, edgeKey } from "../../../server/graph/cycle";

export const NODE_W = 240;
export const NODE_H = 64;
/** claude가 그은 선 색. 상세 칩과 같다. */
export const CLAUDE_COLOR = "#8250df";
/** 패키지 박스 · 순위 선 색. 카드 순위 원과 같다. */
export const PACKAGE_COLOR = "#4a90e2";

export type IssueNodeData = { issue: Issue; [k: string]: unknown };
export type IssueFlowNode = FlowNode<IssueNodeData, "issue">;
export type PackageNodeData = { pkg: Package; [k: string]: unknown };
export type PackageFlowNode = FlowNode<PackageNodeData, "package">;
export type GraphNode = IssueFlowNode | PackageFlowNode;

const boxId = (rank: number) => `pkg-${rank}`;
const GAP = 24;

/**
 * 선도 박스도 없는 이슈 → 좌표. 그래프 오른쪽에 번호순으로 위에서 아래, 다음 열.
 * 줄 수는 그래프 높이에 맞추고, 그래프가 낮거나 없으면 정사각형에 가깝게.
 */
function looseGrid(loose: Issue[], graph: { width?: number; height?: number } | null) {
  const out = new Map<number, { x: number; y: number }>();
  const left = graph ? (graph.width ?? 0) + GAP * 2 : 0;
  const fit = graph ? Math.floor(((graph.height ?? 0) + GAP) / (NODE_H + GAP)) : 0;
  const rows = Math.max(fit, Math.ceil(Math.sqrt(loose.length)), 1);
  loose.forEach((issue, k) => {
    out.set(issue.id, { x: left + Math.floor(k / rows) * (NODE_W + GAP), y: (k % rows) * (NODE_H + GAP) });
  });
  return out;
}

/**
 * 패키지 → 박스에 들 열린 이슈 id. 순위순. 열린 이슈가 없는 패키지는 빠진다.
 * 한 이슈가 두 패키지에 있으면 앞 패키지 것만.
 */
function packageMembers(issues: Issue[], packages: Package[]) {
  const open = new Set(issues.map((i) => i.id));
  const seen = new Set<number>();
  const out: { pkg: Package; ids: number[] }[] = [];
  for (const pkg of [...packages].sort((a, b) => a.rank - b.rank)) {
    const ids = pkg.issue_ids.filter((id) => open.has(id) && !seen.has(id));
    ids.forEach((id) => seen.add(id));
    if (ids.length > 0) out.push({ pkg, ids });
  }
  return out;
}

/**
 * 열린 이슈 · 의존 선 · 제안 패키지 → xyflow 노드 · 엣지. 좌표는 dagre가 위에서 아래로.
 * 패키지는 박스 노드이고 그 이슈 노드는 박스의 자식이다. 박스가 자식보다 앞에 온다.
 * 이어지는 박스끼리 순위 선을 긋는다. 표시용이라 막음 선이 아니다.
 * 양 끝이 다 열린 이슈인 선만 그린다. 순환에 걸린 선은 data.cycle = true.
 */
export function layoutGraph(issues: Issue[], deps: Dep[], packages: Package[]) {
  const ids = new Set(issues.map((i) => i.id));
  const visible = deps.filter((d) => ids.has(d.blocker_id) && ids.has(d.blocked_id));
  const inCycle = new Set(cycleEdges(visible).map(edgeKey));
  const boxes = packageMembers(issues, packages);
  // 선도 박스도 없는 이슈는 dagre에 넣지 않는다. 한 층에 옆으로 늘어서 가로만 길어진다.
  const linked = new Set<number>([...visible.flatMap((d) => [d.blocker_id, d.blocked_id]), ...boxes.flatMap((b) => b.ids)]);
  const loose = issues.filter((i) => !linked.has(i.id)).sort((a, b) => a.number - b.number);

  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({ rankdir: "TB", nodesep: GAP, ranksep: 48 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const i of issues) if (linked.has(i.id)) g.setNode(String(i.id), { width: NODE_W, height: NODE_H });
  for (const b of boxes) {
    g.setNode(boxId(b.pkg.rank), {});
    for (const id of b.ids) g.setParent(String(id), boxId(b.pkg.rank));
  }
  for (const d of visible) g.setEdge(String(d.blocker_id), String(d.blocked_id));
  // 박스 노드끼리는 선을 걸지 않는다. dagre compound가 배치 중 예외를 낸다.
  // 대신 앞 박스 이슈 → 뒤 박스 이슈 숨은 선으로 뒤 박스를 아래 층에 놓는다.
  for (let k = 1; k < boxes.length; k++) {
    for (const a of boxes[k - 1].ids) {
      for (const b of boxes[k].ids) if (!g.hasEdge(String(a), String(b))) g.setEdge(String(a), String(b));
    }
  }
  dagre.layout(g);
  const grid = looseGrid(loose, linked.size > 0 ? g.graph() : null);

  // 자식 좌표는 박스 왼쪽 위 기준.
  const parentOf = new Map<number, { id: string; x: number; y: number }>();
  const boxNodes: PackageFlowNode[] = boxes.map(({ pkg, ids: members }) => {
    const p = g.node(boxId(pkg.rank));
    const origin = { x: p.x - p.width / 2, y: p.y - p.height / 2 };
    for (const id of members) parentOf.set(id, { id: boxId(pkg.rank), ...origin });
    return {
      id: boxId(pkg.rank),
      type: "package",
      position: origin,
      width: p.width,
      height: p.height,
      selectable: false,
      connectable: false,
      data: { pkg },
    };
  });

  const issueNodes: IssueFlowNode[] = issues.map((issue) => {
    const cell = grid.get(issue.id);
    if (cell) return { id: String(issue.id), type: "issue", position: cell, width: NODE_W, height: NODE_H, data: { issue } };
    const p = g.node(String(issue.id));
    const parent = parentOf.get(issue.id);
    const x = p.x - NODE_W / 2;
    const y = p.y - NODE_H / 2;
    return {
      id: String(issue.id),
      type: "issue",
      position: parent ? { x: x - parent.x, y: y - parent.y } : { x, y },
      ...(parent ? { parentId: parent.id } : {}),
      width: NODE_W,
      height: NODE_H,
      data: { issue },
    };
  });

  // 사용자 선은 회색 실선, claude 선은 보라 점선. 순환이면 빨강이 이긴다.
  const depEdges: FlowEdge[] = visible.map((d) => {
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

  // 순위 선은 파랑 굵은 실선. 고르거나 지울 수 없다.
  const rankEdges: FlowEdge[] = boxes.slice(1).map((b, k) => ({
    id: `rank-${boxes[k].pkg.rank}-${b.pkg.rank}`,
    source: boxId(boxes[k].pkg.rank),
    target: boxId(b.pkg.rank),
    selectable: false,
    deletable: false,
    markerEnd: { type: MarkerType.ArrowClosed, color: PACKAGE_COLOR },
    style: `stroke:${PACKAGE_COLOR};stroke-width:2`,
    data: { rank: true },
  }));

  const nodes: GraphNode[] = [...boxNodes, ...issueNodes];
  return { nodes, edges: [...rankEdges, ...depEdges] };
}
