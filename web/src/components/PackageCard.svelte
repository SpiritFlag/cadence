<script lang="ts">
  import type { Package } from "../../../server/propose";
  import type { PackageWarning } from "../../../server/graph/order";
  import { store, issueById, select, setHighlight, toggleChange, outcomeOf } from "../lib/store.svelte";
  import LabelBadge from "./LabelBadge.svelte";

  let { pkg, warnings }: { pkg: Package; warnings: PackageWarning[] } = $props();
  const issues = $derived(pkg.issue_ids.map((id) => issueById(id)).filter((i) => !!i));
  const num = (id: number) => `#${issueById(id)?.number ?? id}`;
  // 표시는 서버가 직전 제안과 비교해 붙인 것. 이어간 제안에만 있다.
  const marks = $derived(pkg.marks);
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
    {#if marks && marks.overtake !== null}<span class="mark overtake" title="새 · 바뀐 이슈로 유지 패키지를 앞질렀다">앞지름</span>{/if}
    {#if marks && marks.joined.length > 0}<span class="mark joined" title="새 이슈가 유지 패키지에 들어왔다">＋합류 {marks.joined.map(num).join(" ")}</span>{/if}
    {#if marks?.moved_by_deps}<span class="mark deps" title="의존 선 때문에 순서가 옮겨졌다">선 때문에 이동</span>{/if}
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
  {#if marks?.overtake}<p class="overtake-reason">앞지른 이유 · {marks.overtake}</p>{/if}
  {#if pkg.label_changes.length > 0}
    <ul class="changes">
      {#each pkg.label_changes as c (c.issue_id)}
        {@const i = issueById(c.issue_id)}
        {@const o = outcomeOf(c.issue_id)}
        <li class:rejected={!!store.rejected[c.issue_id]}>
          <input type="checkbox" checked={!store.rejected[c.issue_id]} onchange={() => toggleChange(c.issue_id)} disabled={store.applying} />
          ↑ #{i?.number ?? c.issue_id} <LabelBadge name={c.from} /> → <LabelBadge name={c.to} />
          {#if o}<span class="outcome {o.status}" title={o.message}>{o.status === "applied" ? "반영" : o.status === "skipped" ? "건너뜀" : "실패"} · {o.message}</span>{/if}
        </li>
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
  .head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-bottom: 6px; }
  .mark { padding: 0 7px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; }
  .mark.overtake { background: #d73a4a22; color: #d73a4a; }
  .mark.joined { background: #0e8a1622; color: #0e8a16; }
  .mark.deps { background: #8884; }
  .rank { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: #4a90e2; color: #fff; font-size: 12px; font-weight: 700; }
  .name { font-size: 13px; }
  .issues { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
  .chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 8px; border: 1px solid #8886; border-radius: 12px; background: transparent; color: inherit; font: inherit; font-size: 11px; cursor: pointer; }
  .chip:hover { background: #8882; }
  .chip.selected { border-color: #4a90e2; }
  .chip.missing { color: #d73a4a; cursor: default; }
  .reason { margin: 0 0 6px; font-size: 12px; color: #888; line-height: 1.4; }
  .overtake-reason { margin: -2px 0 6px; font-size: 12px; color: #d73a4a; line-height: 1.4; }
  .changes, .warnings { margin: 0; padding-left: 4px; list-style: none; font-size: 12px; }
  .changes li { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .changes li.rejected { opacity: 0.5; }
  .changes input { margin: 0 2px 0 0; }
  .outcome { font-size: 11px; color: #888; }
  .outcome.applied { color: #0e8a16; }
  .outcome.failed { color: #d73a4a; }
  .warnings { color: #d73a4a; }
</style>
