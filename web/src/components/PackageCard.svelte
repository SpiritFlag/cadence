<script lang="ts">
  import type { Package } from "../../../server/propose";
  import type { PackageWarning } from "../../../server/graph/order";
  import { store, issueById, select, setHighlight } from "../lib/store.svelte";
  import LabelBadge from "./LabelBadge.svelte";

  let { pkg, warnings }: { pkg: Package; warnings: PackageWarning[] } = $props();
  const issues = $derived(pkg.issue_ids.map((id) => issueById(id)).filter((i) => !!i));
</script>

<div
  class="card"
  role="group"
  onmouseenter={() => setHighlight(pkg.issue_ids)}
  onmouseleave={() => setHighlight([])}
>
  <div class="head">
    <span class="rank">{pkg.rank}</span>
    <strong class="name">{pkg.name}</strong>
  </div>
  <div class="issues">
    {#each issues as i (i.id)}
      <button class="chip" class:selected={store.selected?.id === i.id} onclick={() => select(i)}>
        #{i.number} {i.title}
      </button>
    {/each}
    {#each pkg.issue_ids.filter((id) => !issueById(id)) as id (id)}
      <span class="chip missing">id {id} (열린 이슈 아님)</span>
    {/each}
  </div>
  <p class="reason">{pkg.reason}</p>
  {#if pkg.label_changes.length > 0}
    <ul class="changes">
      {#each pkg.label_changes as c (c.issue_id)}
        {@const i = issueById(c.issue_id)}
        <li>↑ #{i?.number ?? c.issue_id} <LabelBadge name={c.from} /> → <LabelBadge name={c.to} /></li>
      {/each}
    </ul>
  {/if}
  {#if warnings.length > 0}
    <ul class="warnings">
      {#each warnings as w, k (k)}<li>⚠ {w.message}</li>{/each}
    </ul>
  {/if}
</div>

<style>
  .card { padding: 10px 12px; border: 1px solid #8886; border-radius: 8px; margin-bottom: 8px; }
  .card:hover { border-color: #fbca04; }
  .head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .rank { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: #4a90e2; color: #fff; font-size: 12px; font-weight: 700; }
  .name { font-size: 13px; }
  .issues { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
  .chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 8px; border: 1px solid #8886; border-radius: 12px; background: transparent; color: inherit; font: inherit; font-size: 11px; cursor: pointer; }
  .chip:hover { background: #8882; }
  .chip.selected { border-color: #4a90e2; }
  .chip.missing { color: #d73a4a; cursor: default; }
  .reason { margin: 0 0 6px; font-size: 12px; color: #888; line-height: 1.4; }
  .changes, .warnings { margin: 0; padding-left: 4px; list-style: none; font-size: 12px; }
  .changes li { display: flex; align-items: center; gap: 4px; }
  .warnings { color: #d73a4a; }
</style>
