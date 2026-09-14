<script lang="ts">
  import type { Milestone } from "../../../server/sync";
  import { store, select } from "../lib/store.svelte";

  // 위가 오래된 것. 기본은 진행 중 전부와 최근에 닫힌 것 1개, [더보기]마다 더 오래된 닫힌 것 5개.
  // 레포를 바꾸면 Packages가 {#key}로 다시 만들어 extra가 0으로 돌아간다.
  const MORE = 5;
  let extra = $state(0);

  const byClosed = (a: Milestone, b: Milestone) => (a.closed_at ?? "").localeCompare(b.closed_at ?? "") || a.number - b.number;
  const closed = $derived(store.milestones.filter((m) => m.state === "closed").sort(byClosed));
  const open = $derived(store.milestones.filter((m) => m.state === "open"));
  const shown = $derived(closed.slice(Math.max(0, closed.length - 1 - extra)));
  const hidden = $derived(closed.length - shown.length);
  const rows = $derived([...shown, ...open]);

  /** 열린 이슈만 그래프에 있어 누를 수 있다. */
  const openIssue = (n: number) => store.issues.find((i) => i.number === n);

  function day(iso: string): string {
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
</script>

{#if rows.length > 0}
  <div class="milestones">
    <div class="title">마일스톤</div>
    {#if hidden > 0}
      <button class="more" onclick={() => (extra += MORE)}>더보기 · {hidden}개 더 있음</button>
    {/if}
    <ul>
      {#each rows as m (m.id)}
        <li class:open={m.state === "open"}>
          <strong>{m.title}</strong>
          <span class="meta">· {m.state === "open" ? "진행 중" : "닫힘"}{#if m.closed_at} · {day(m.closed_at)}{/if}</span>
          {#if m.issues.length > 0}
            <span class="meta">·</span>
            {#each m.issues as n (n)}
              {@const i = openIssue(n)}
              {#if i}
                <button class="num" class:selected={store.selected?.id === i.id} onclick={() => select(i)}>#{n}</button>
              {:else}
                <span class="num closed">#{n}</span>
              {/if}
            {/each}
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .milestones { margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px dashed #8886; }
  .title { font-size: 12px; color: #888; margin-bottom: 6px; }
  .more { display: block; margin: 0 0 4px; padding: 0; border: none; background: transparent; color: #4a90e2; font: inherit; font-size: 12px; cursor: pointer; }
  ul { margin: 0; padding: 0; list-style: none; }
  li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 2px 0; font-size: 12px; }
  li.open strong { color: #4a90e2; }
  .meta { color: #888; }
  .num { padding: 0 6px; border: 1px solid #8886; border-radius: 10px; background: transparent; color: inherit; font: inherit; font-size: 11px; cursor: pointer; }
  .num:hover { background: #8882; }
  .num.selected { border-color: #4a90e2; }
  .num.closed { border-color: transparent; color: #888; cursor: default; }
</style>
