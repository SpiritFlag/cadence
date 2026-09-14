<script lang="ts">
  import type { DepSuggestion } from "../../../server/graphgen";
  import { store, issueById, setHighlight, resolveSuggestion } from "../lib/store.svelte";

  // 그래프 칸 위의 마지막 생성 결과 한 줄 · 경고 · 승인을 기다리는 선 제안.
  const run = $derived(store.graph?.run ?? null);
  const suggestions = $derived(store.graph?.suggestions ?? []);
  const count = (kind: "cycle" | "unknown") => run?.warnings.filter((w) => w.kind === kind).length ?? 0;
  const locked = $derived(store.busy || store.proposing || store.generating);

  const num = (id: number) => {
    const i = issueById(id);
    return i ? `#${i.number}` : `id ${id}`;
  };
  function what(s: DepSuggestion): string {
    const line = `${num(s.blocker_id)} → ${num(s.blocked_id)}`;
    if (s.kind === "remove") return `${line} 지우자`;
    if (s.kind === "reverse") return `${line} 지우고 ${num(s.blocked_id)} → ${num(s.blocker_id)} 긋자`;
    return `${line} 다시 긋자`;
  }
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
      {#if suggestions.length > 0}
        <div class="suggestions">
          {#each suggestions as s (s.id)}
            <div
              class="suggestion"
              role="group"
              onmouseenter={() => setHighlight([s.blocker_id, s.blocked_id])}
              onmouseleave={() => setHighlight([])}
            >
              <div class="row">
                <strong>{what(s)}</strong>
                <button class="ok" onclick={() => resolveSuggestion(s.id, true)} disabled={locked}>승인</button>
                <button onclick={() => resolveSuggestion(s.id, false)} disabled={locked}>거절</button>
              </div>
              <p class="reason">{s.reason}</p>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .bar { position: absolute; top: 8px; left: 8px; z-index: 5; max-width: 60%; max-height: 45%; overflow-y: auto; padding: 6px 10px; border: 1px solid #8886; border-radius: 8px; background: Canvas; color: CanvasText; font-size: 12px; }
  .fail { color: #d73a4a; }
  .meta { color: #888; }
  .warnings { margin: 4px 0 0; padding: 0; list-style: none; color: #d73a4a; }
  .suggestions { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #8886; }
  .suggestion { padding: 4px 6px; border-radius: 6px; }
  .suggestion:hover { background: #8882; }
  .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .reason { margin: 2px 0 0; color: #888; }
  button { padding: 1px 8px; border: 1px solid #8886; border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
  button.ok { border-color: #4a90e2; color: #4a90e2; font-weight: 600; }
  button:disabled { opacity: 0.5; cursor: default; }
</style>
