<script lang="ts">
  import { onMount } from "svelte";
  import { load } from "./lib/store.svelte";
  import Header from "./components/Header.svelte";
  import Graph from "./components/Graph.svelte";
  import IssueDetail from "./components/IssueDetail.svelte";
  import Packages from "./components/Packages.svelte";
  import Logs from "./components/Logs.svelte";

  // 화면은 하나다: 좌(그래프) · 우(패키지) · 하(상세 · 로그).
  onMount(load);
</script>

<div class="layout">
  <div class="header"><Header /></div>
  <main class="left"><Graph /></main>
  <aside class="right"><Packages /></aside>
  <section class="bottom"><IssueDetail /></section>
  <section class="logs"><Logs /></section>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 1fr 360px;
    grid-template-rows: 44px 1fr 220px;
    grid-template-areas:
      "header header"
      "left right"
      "bottom logs";
    height: 100vh;
  }
  .header { grid-area: header; border-bottom: 1px solid #8884; }
  .left { grid-area: left; min-height: 0; }
  .right { grid-area: right; border-left: 1px solid #8884; min-height: 0; }
  .bottom { grid-area: bottom; border-top: 1px solid #8884; min-height: 0; }
  .logs { grid-area: logs; border-top: 1px solid #8884; border-left: 1px solid #8884; min-height: 0; }
</style>
