<script lang="ts">
  import { untrack } from "svelte";
  import { SvelteFlow, Background, Controls, type Edge, type Connection } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import { store, select, addDep, issueById } from "../lib/store.svelte";
  import { layoutGraph, type IssueFlowNode } from "../lib/layout";
  import IssueNode from "./IssueNode.svelte";

  const nodeTypes = { issue: IssueNode };

  let nodes = $state.raw<IssueFlowNode[]>([]);
  let edges = $state.raw<Edge[]>([]);

  // 이슈 · 선이 바뀌면 다시 배치한다. 선택만 바뀌면 플래그만 바꿔 끌어놓은 위치를 지킨다.
  $effect(() => {
    const laid = layoutGraph(store.issues, store.deps, null);
    nodes = laid.nodes;
    edges = laid.edges;
  });
  $effect(() => {
    const id = store.selected ? String(store.selected.id) : null;
    const current = untrack(() => nodes);
    let changed = false;
    const next = current.map((n) => {
      const sel = n.id === id;
      if (n.selected === sel) return n;
      changed = true;
      return { ...n, selected: sel };
    });
    if (changed) nodes = next;
  });
  // 강조도 플래그만. data.highlight / data.dim.
  $effect(() => {
    const on = new Set(store.highlight.map(String));
    const active = on.size > 0;
    const current = untrack(() => nodes);
    let changed = false;
    const next = current.map((n) => {
      const hi = on.has(n.id);
      const dim = active && !hi;
      if (n.data.highlight === hi && n.data.dim === dim) return n;
      changed = true;
      return { ...n, data: { ...n.data, highlight: hi, dim } };
    });
    if (changed) nodes = next;
  });

  function onconnect(c: Connection) {
    // 위 핸들이 target, 아래 핸들이 source. 아래에서 끌어 위로 놓으면 source가 target을 막는다.
    addDep(Number(c.source), Number(c.target));
  }
</script>

<div class="graph">
  {#if store.issues.length === 0}
    <p class="empty">{store.repos.length === 0 ? "위에서 레포를 추가하면 이슈가 여기 보인다." : "열린 이슈가 없다."}</p>
  {/if}
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    fitView
    colorMode="system"
    nodesDraggable={true}
    onconnect={onconnect}
    onnodeclick={({ node }) => select(issueById(Number(node.id)) ?? null)}
    onpaneclick={() => select(null)}
  >
    <Background />
    <Controls />
  </SvelteFlow>
</div>

<style>
  .graph { position: relative; height: 100%; }
  .empty { position: absolute; inset: 0; display: grid; place-items: center; color: #888; margin: 0; pointer-events: none; z-index: 1; }
</style>
