<script lang="ts">
  import { Handle, Position, type NodeProps } from "@xyflow/svelte";
  import type { IssueFlowNode } from "../lib/layout";
  import LabelBadge from "./LabelBadge.svelte";

  let { data, selected }: NodeProps<IssueFlowNode> = $props();
  const issue = $derived(data.issue);
</script>

<div class="card" class:selected class:highlight={!!data.highlight} class:dim={!!data.dim}>
  <Handle type="target" position={Position.Top} />
  <div class="top">
    <span class="num">#{issue.number}</span>
    <span class="labels">{#each issue.labels as l (l)}<LabelBadge name={l} />{/each}</span>
  </div>
  <div class="title">{issue.title}</div>
  <Handle type="source" position={Position.Bottom} />
</div>

<style>
  .card { width: 240px; height: 64px; padding: 8px 10px; border: 1px solid #8886; border-radius: 8px; background: Canvas; color: CanvasText; font-size: 12px; overflow: hidden; }
  .card.selected { border-color: #4a90e2; box-shadow: 0 0 0 2px #4a90e244; }
  .card.highlight { border-color: #fbca04; box-shadow: 0 0 0 3px #fbca0466; }
  .card.dim { opacity: 0.35; }
  .top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  .num { color: #888; }
  .labels { display: flex; gap: 3px; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
