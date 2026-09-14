<script lang="ts">
  import type { NodeProps } from "@xyflow/svelte";
  import type { PackageFlowNode } from "../lib/layout";

  let { data, width, height }: NodeProps<PackageFlowNode> = $props();
</script>

<div class="box" style="width:{width}px;height:{height}px">
  <span class="head"><span class="rank">{data.pkg.rank}</span>{data.pkg.name}</span>
</div>

<style>
  .box { box-sizing: border-box; border: 1.5px solid #4a90e2; border-radius: 10px; background: #4a90e20d; }
  .head { display: flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; overflow: hidden; color: #4a90e2; font-size: 11px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
  .rank { display: inline-grid; place-items: center; flex: none; width: 15px; height: 15px; border-radius: 50%; background: #4a90e2; color: #fff; font-size: 10px; }
</style>
