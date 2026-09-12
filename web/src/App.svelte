<script lang="ts">
  import { onMount } from "svelte";
  import { load } from "./lib/store.svelte";
  import Header from "./components/Header.svelte";
  import IssueList from "./components/IssueList.svelte";
  import IssueDetail from "./components/IssueDetail.svelte";

  // 화면은 하나다: 좌(지금은 목록, 나중에 그래프) · 우(패키지 자리) · 하(상세).
  onMount(load);
</script>

<div class="layout">
  <div class="header"><Header /></div>
  <main class="left"><IssueList /></main>
  <aside class="right"><p class="placeholder">패키지</p></aside>
  <section class="bottom"><IssueDetail /></section>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 1fr 360px;
    grid-template-rows: 44px 1fr 220px;
    grid-template-areas:
      "header header"
      "left right"
      "bottom bottom";
    height: 100vh;
  }
  .header { grid-area: header; border-bottom: 1px solid #8884; }
  .left { grid-area: left; min-height: 0; }
  .right { grid-area: right; border-left: 1px solid #8884; }
  .bottom { grid-area: bottom; border-top: 1px solid #8884; min-height: 0; }
  .placeholder { color: #888; text-align: center; padding: 24px; }
</style>
