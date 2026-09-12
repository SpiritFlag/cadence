<script lang="ts">
  // 화면은 하나다: 좌(그래프 자리) · 우(패키지 자리) · 하(상세). 이번 배치는 뼈대만.
</script>

<div class="layout">
  <header class="header">
    <strong>cadence</strong>
  </header>
  <main class="left"></main>
  <aside class="right"></aside>
  <section class="bottom"></section>
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
  .header { grid-area: header; display: flex; align-items: center; padding: 0 16px; border-bottom: 1px solid #8884; }
  .left { grid-area: left; }
  .right { grid-area: right; border-left: 1px solid #8884; }
  .bottom { grid-area: bottom; border-top: 1px solid #8884; }
</style>
