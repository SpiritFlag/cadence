<script lang="ts">
  import { store, addRepo, refresh } from "../lib/store.svelte";

  let full = $state("");

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const v = full.trim();
    if (!v) return;
    await addRepo(v);
    if (!store.error) full = "";
  }
</script>

<header class="header">
  <strong class="brand">cadence</strong>
  <div class="repos">
    {#each store.repos as r (r.id)}
      <span class="chip">{r.owner}/{r.name}</span>
    {/each}
    <form onsubmit={submit}>
      <input placeholder="owner/name" bind:value={full} disabled={store.busy} />
      <button type="submit" disabled={store.busy || !full.trim()}>추가</button>
    </form>
  </div>
  <div class="actions">
    {#if store.error}<span class="error">{store.error}</span>{/if}
    <button onclick={refresh} disabled={store.busy}>{store.busy ? "…" : "새로고침"}</button>
  </div>
</header>

<style>
  .header { display: flex; align-items: center; gap: 16px; height: 100%; padding: 0 16px; }
  .brand { font-size: 16px; }
  .repos { display: flex; align-items: center; gap: 8px; flex: 1; }
  .chip { padding: 2px 10px; border: 1px solid #8886; border-radius: 12px; font-size: 12px; }
  form { display: flex; gap: 4px; }
  input { width: 180px; padding: 3px 8px; border: 1px solid #8886; border-radius: 6px; font: inherit; background: transparent; color: inherit; }
  button { padding: 3px 10px; border: 1px solid #8886; border-radius: 6px; font: inherit; background: transparent; color: inherit; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  .actions { display: flex; align-items: center; gap: 12px; }
  .error { color: #d73a4a; font-size: 12px; }
</style>
