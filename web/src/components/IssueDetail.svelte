<script lang="ts">
  import { store, repoName, blockersOf, blockedBy, addDep, removeDep, select, issueById, depOf } from "../lib/store.svelte";
  import LabelBadge from "./LabelBadge.svelte";

  let pick = $state<number | "">("");

  const blockers = $derived(store.selected ? blockersOf(store.selected.id) : []);
  const blocked = $derived(store.selected ? blockedBy(store.selected.id) : []);
  const candidates = $derived(
    store.selected
      ? store.issues.filter((i) => i.id !== store.selected!.id && !blockers.some((b) => b.id === i.id))
      : [],
  );
  /** 생성 중에는 claude 선이 갈아끼워지므로 손으로 긋고 지우지 않는다. */
  const locked = $derived(store.busy || store.generating);

  async function add() {
    if (!store.selected || pick === "") return;
    await addDep(Number(pick), store.selected.id);
    pick = "";
  }
</script>

<div class="detail">
  {#if store.selected}
    {@const i = store.selected}
    <div class="head">
      <span class="num">{repoName(i.repo_id)} #{i.number}</span>
      <strong class="title">{i.title}</strong>
      <span class="labels">{#each i.labels as l (l)}<LabelBadge name={l} />{/each}</span>
    </div>

    <div class="deps">
      <div class="deprow">
        <span class="deplabel">이 이슈를 막는 것</span>
        {#each blockers as b (b.id)}
          {@const d = depOf(b.id, i.id)}
          <span class="chip" class:claude={d?.source === "claude"} title={d?.source === "claude" ? `claude · ${d.reason}` : undefined}>
            {#if d?.source === "claude"}<span class="src">claude</span>{/if}
            <button class="link" onclick={() => select(issueById(b.id) ?? null)}>#{b.number} {b.title}</button>
            <button
              class="x"
              title={d?.source === "claude" ? "선 지우기 · claude가 다시 긋지 않는다" : "선 지우기"}
              onclick={() => removeDep(b.id, i.id)}
              disabled={locked}
            >×</button>
          </span>
        {/each}
        <select bind:value={pick} disabled={locked || candidates.length === 0}>
          <option value="">막는 이슈 추가…</option>
          {#each candidates as c (c.id)}
            <option value={c.id}>#{c.number} {c.title}</option>
          {/each}
        </select>
        <button onclick={add} disabled={locked || pick === ""}>추가</button>
      </div>
      {#if blocked.length > 0}
        <div class="deprow">
          <span class="deplabel">이 이슈가 막는 것</span>
          {#each blocked as b (b.id)}
            {@const d = depOf(i.id, b.id)}
            <span class="chip" class:claude={d?.source === "claude"} title={d?.source === "claude" ? `claude · ${d.reason}` : undefined}>
              {#if d?.source === "claude"}<span class="src">claude</span>{/if}
              <button class="link" onclick={() => select(issueById(b.id) ?? null)}>#{b.number} {b.title}</button>
            </span>
          {/each}
        </div>
      {/if}
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
  .deps { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
  .deprow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .deplabel { color: #888; font-size: 12px; min-width: 110px; }
  .chip { display: inline-flex; align-items: center; gap: 2px; padding: 1px 4px 1px 8px; border: 1px solid #8886; border-radius: 12px; font-size: 12px; }
  .chip.claude { border: 1px dashed #8250df; }
  .src { color: #8250df; font-size: 10px; font-weight: 600; margin-right: 2px; }
  .link { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 0; }
  .link:hover { text-decoration: underline; }
  .x { border: 0; background: transparent; color: #888; font: inherit; cursor: pointer; padding: 0 4px; }
  .x:hover { color: #d73a4a; }
  select, button:not(.link):not(.x) { padding: 2px 8px; border: 1px solid #8886; border-radius: 6px; font: inherit; font-size: 12px; background: transparent; color: inherit; cursor: pointer; }
  select:disabled, button:disabled { opacity: 0.5; cursor: default; }
  .body { margin: 0; white-space: pre-wrap; font: inherit; line-height: 1.5; }
  .empty { color: #888; text-align: center; padding: 24px; }
</style>
