<script lang="ts">
  import { store } from "../lib/store.svelte";

  // 그래프 칸 위의 마지막 생성 결과 한 줄과 경고.
  const run = $derived(store.graph?.run ?? null);
  const count = (kind: "cycle" | "unknown") => run?.warnings.filter((w) => w.kind === kind).length ?? 0;
</script>

{#if store.generating || run}
  <div class="bar">
    {#if store.generating}
      <span>claude가 선을 긋는 중…</span>
    {:else if run}
      <div>
        {#if run.status === "none"}
          <strong class="fail">생성 실패</strong> · 출력이 두 번 다 깨져 선은 그대로
        {:else}
          <strong>claude 선 {run.added}</strong> · 순환이라 버림 {count("cycle")}{#if count("unknown") > 0} · 모르는 선 {count("unknown")}{/if}
        {/if}
        <span class="meta"> · {run.cost_usd.toFixed(2)} USD · {run.created_at}</span>
      </div>
      {#if run.warnings.length > 0}
        <ul class="warnings">{#each run.warnings as w, k (k)}<li>⚠ {w.message}</li>{/each}</ul>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .bar { position: absolute; top: 8px; left: 8px; z-index: 5; max-width: 60%; padding: 6px 10px; border: 1px solid #8886; border-radius: 8px; background: Canvas; color: CanvasText; font-size: 12px; }
  .fail { color: #d73a4a; }
  .meta { color: #888; }
  .warnings { margin: 4px 0 0; padding: 0; list-style: none; color: #d73a4a; }
</style>
