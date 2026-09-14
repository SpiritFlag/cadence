<script lang="ts">
  import { store, addRepo, refresh, runPropose, runGenerate, cycleCount, selectRepo } from "../lib/store.svelte";

  const cycles = $derived(cycleCount());
  /** 동기화 · 제안 · 생성 중에는 서로 막는다. */
  const locked = $derived(store.busy || store.proposing || store.generating);

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
      <button
        class="chip"
        class:on={r.id === store.repoId}
        onclick={() => selectRepo(r.id)}
        disabled={locked}
        title="이 레포만 본다"
      >{r.owner}/{r.name}</button>
    {/each}
    <form onsubmit={submit}>
      <input placeholder="owner/name" bind:value={full} disabled={store.busy} />
      <button type="submit" disabled={store.busy || !full.trim()}>추가</button>
    </form>
  </div>
  <div class="actions">
    {#if store.error}<span class="error">{store.error}</span>{/if}
    <button onclick={refresh} disabled={locked}>{store.busy ? "…" : "새로고침"}</button>
    <button
      onclick={runGenerate}
      disabled={locked || store.issues.length === 0}
      title="claude가 열린 이슈를 읽고 선을 긋는다. 사용자 선은 지우지 않는다. 30초쯤 걸린다"
    >{store.generating ? "생성 중…" : "그래프 생성"}</button>
    <button
      class="primary"
      onclick={runPropose}
      disabled={locked || store.issues.length === 0 || cycles > 0}
      title={cycles > 0 ? `순환에 걸린 선이 ${cycles}개 있어 제안하지 않는다` : "claude가 패키지를 제안한다. 몇 초 걸린다"}
    >{store.proposing ? "제안 중…" : "제안"}</button>
  </div>
</header>

<style>
  .header { display: flex; align-items: center; gap: 16px; height: 100%; padding: 0 16px; }
  .brand { font-size: 16px; }
  .repos { display: flex; align-items: center; gap: 8px; flex: 1; }
  .chip { padding: 2px 10px; border: 1px solid #8886; border-radius: 12px; font-size: 12px; }
  .chip.on { border-color: #4a90e2; color: #4a90e2; font-weight: 600; background: #4a90e21a; }
  form { display: flex; gap: 4px; }
  input { width: 180px; padding: 3px 8px; border: 1px solid #8886; border-radius: 6px; font: inherit; background: transparent; color: inherit; }
  button { padding: 3px 10px; border: 1px solid #8886; border-radius: 6px; font: inherit; background: transparent; color: inherit; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  .actions { display: flex; align-items: center; gap: 12px; }
  .error { color: #d73a4a; font-size: 12px; }
  .primary { border-color: #4a90e2; color: #4a90e2; font-weight: 600; }
</style>
