<script lang="ts">
  import { store, select, repoName } from "../lib/store.svelte";
  import LabelBadge from "./LabelBadge.svelte";
</script>

<div class="list">
  {#if store.issues.length === 0}
    <p class="empty">{store.repos.length === 0 ? "위에서 레포를 추가하면 이슈가 여기 보인다." : "열린 이슈가 없다."}</p>
  {/if}
  {#each store.issues as issue (issue.id)}
    <button class="row" class:selected={store.selected?.id === issue.id} onclick={() => select(issue)}>
      <span class="num">#{issue.number}</span>
      <span class="title">{issue.title}</span>
      <span class="labels">
        {#each issue.labels as l (l)}<LabelBadge name={l} />{/each}
      </span>
      {#if store.repos.length > 1}<span class="repo">{repoName(issue.repo_id)}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .list { height: 100%; overflow-y: auto; padding: 8px; }
  .empty { color: #888; padding: 24px; text-align: center; }
  .row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .row:hover { background: #8882; }
  .row.selected { background: #4a90e233; }
  .num { color: #888; min-width: 40px; }
  .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .labels { display: flex; gap: 4px; }
  .repo { color: #888; font-size: 11px; }
</style>
