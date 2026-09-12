<script lang="ts">
  import { store, issueById, approvedChanges, allChanges, runApply } from "../lib/store.svelte";
  import PackageCard from "./PackageCard.svelte";

  const SHOW = 5;
  const p = $derived(store.proposal);
  const top = $derived(p?.packages.slice(0, SHOW) ?? []);
  const rest = $derived(p?.packages.slice(SHOW) ?? []);
  const orphan = $derived(p?.warnings.filter((w) => w.rank === null) ?? []);
  const forRank = (rank: number) => p?.warnings.filter((w) => w.rank === rank) ?? [];
  const num = (id: number) => `#${issueById(id)?.number ?? id}`;
  const approved = $derived(approvedChanges().length);
  const total = $derived(allChanges().length);
</script>

<div class="packages">
  <div class="title">다음 패키지</div>
  {#if !p}
    <p class="empty">{store.proposing ? "claude가 생각하는 중…" : "위의 [제안]을 누르면 여기 패키지가 보인다."}</p>
  {:else}
    {#if p.status === "none"}
      <div class="none">
        <strong>제안 없음</strong>
        <p>claude 출력이 두 번 다 깨졌다. 코드가 만든 후보 순서만 보인다.</p>
        <p class="order">{p.order.map(num).join(" → ") || "(없음)"}</p>
      </div>
    {:else}
      {#each top as pkg (pkg.rank)}
        <PackageCard {pkg} warnings={forRank(pkg.rank)} />
      {/each}
      {#if rest.length > 0}
        <details class="rest">
          <summary>그 외 {rest.length}개</summary>
          {#each rest as pkg (pkg.rank)}
            <PackageCard {pkg} warnings={forRank(pkg.rank)} />
          {/each}
        </details>
      {/if}
    {/if}
    {#if orphan.length > 0}
      <ul class="orphan">{#each orphan as w, k (k)}<li>⚠ {w.message}</li>{/each}</ul>
    {/if}
    {#if total > 0}
      <div class="apply">
        <button onclick={runApply} disabled={store.applying || store.busy || approved === 0}>
          {store.applying ? "반영 중…" : `승인한 라벨 변경 반영 (${approved}/${total})`}
        </button>
        {#if store.applyResult}
          <span class="summary">
            반영 {store.applyResult.filter((o) => o.status === "applied").length} ·
            건너뜀 {store.applyResult.filter((o) => o.status === "skipped").length} ·
            실패 {store.applyResult.filter((o) => o.status === "failed").length}
          </span>
        {/if}
      </div>
    {/if}
    <p class="meta">{p.created_at} · {p.cost_usd.toFixed(2)} USD</p>
  {/if}
</div>

<style>
  .packages { height: 100%; overflow-y: auto; padding: 10px 12px; }
  .title { font-size: 12px; color: #888; margin-bottom: 8px; }
  .empty, .meta { color: #888; font-size: 12px; }
  .empty { text-align: center; padding: 24px 8px; }
  .none { padding: 10px 12px; border: 1px dashed #8886; border-radius: 8px; font-size: 12px; }
  .none p { margin: 4px 0 0; color: #888; }
  .order { word-break: break-all; }
  .rest summary { cursor: pointer; color: #888; font-size: 12px; margin: 4px 0 8px; }
  .apply { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 8px; }
  .apply button { padding: 6px 10px; border: 1px solid #4a90e2; border-radius: 6px; background: transparent; color: #4a90e2; font: inherit; font-weight: 600; cursor: pointer; }
  .apply button:disabled { opacity: 0.5; cursor: default; }
  .summary { font-size: 12px; color: #888; }
  .orphan { margin: 0 0 8px; padding-left: 4px; list-style: none; font-size: 12px; color: #d73a4a; }
</style>
