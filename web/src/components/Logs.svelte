<script lang="ts">
  import { onMount, tick } from "svelte";
  import { clock, LOG_KEEP, type LogLine } from "../../../server/log";

  let lines = $state<LogLine[]>([]);
  let status = $state<"연결 중" | "연결됨" | "끊김 · 다시 붙는 중">("연결 중");
  let box: HTMLDivElement;

  onMount(() => {
    const es = new EventSource("/api/logs");
    // 다시 붙으면 서버가 최근 줄을 처음부터 다시 주므로 비우고 받는다.
    es.onopen = () => {
      status = "연결됨";
      lines = [];
    };
    es.onerror = () => {
      status = "끊김 · 다시 붙는 중";
    };
    es.addEventListener("line", async (e) => {
      const line = JSON.parse((e as MessageEvent<string>).data) as LogLine;
      // 맨 아래를 보고 있을 때만 따라 내려간다. 위로 올려 읽는 중이면 그대로 둔다.
      const follow = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
      lines = [...lines, line].slice(-LOG_KEEP);
      if (follow) {
        await tick();
        box.scrollTop = box.scrollHeight;
      }
    });
    return () => es.close();
  });
</script>

<div class="logs">
  <div class="title">로그 <span class="status" class:ok={status === "연결됨"}>{status}</span></div>
  <div class="lines" bind:this={box}>
    {#if lines.length === 0}
      <p class="empty">claude를 부르면 여기 한 줄씩 흐른다.</p>
    {/if}
    {#each lines as l, k (k)}
      <div class="line"><span class="at">{clock(l.at)}</span> {l.text}</div>
    {/each}
  </div>
</div>

<style>
  .logs { display: flex; flex-direction: column; height: 100%; padding: 8px 12px; box-sizing: border-box; }
  .title { font-size: 12px; color: #888; margin-bottom: 6px; }
  .status { margin-left: 6px; color: #d73a4a; }
  .status.ok { color: #0e8a16; }
  .lines { flex: 1; min-height: 0; overflow-y: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.5; }
  .line { white-space: pre-wrap; word-break: break-all; }
  .at { color: #888; }
  .empty { color: #888; margin: 8px 0; font-family: inherit; }
</style>
