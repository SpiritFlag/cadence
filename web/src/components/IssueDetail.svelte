<script lang="ts">
  import { store, repoName } from "../lib/store.svelte";
  import LabelBadge from "./LabelBadge.svelte";
</script>

<div class="detail">
  {#if store.selected}
    {@const i = store.selected}
    <div class="head">
      <span class="num">{repoName(i.repo_id)} #{i.number}</span>
      <strong class="title">{i.title}</strong>
      <span class="labels">{#each i.labels as l (l)}<LabelBadge name={l} />{/each}</span>
    </div>
    <pre class="body">{i.body || "(본문 없음)"}</pre>
  {:else}
    <p class="empty">이슈를 고르면 여기 보인다.</p>
  {/if}
</div>

<style>
  .detail { height: 100%; overflow-y: auto; padding: 12px 16px; }
  .head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .num { color: #888; }
  .title { font-size: 15px; }
  .labels { display: flex; gap: 4px; }
  .body { margin: 0; white-space: pre-wrap; font: inherit; line-height: 1.5; }
  .empty { color: #888; text-align: center; padding: 24px; }
</style>
