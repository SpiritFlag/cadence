<script lang="ts">
  let { name }: { name: string } = $props();
  const colors: Record<string, string> = { p1: "#d73a4a", p2: "#fbca04", p3: "#0e8a16", hold: "#cfd3d7" };
  const bg = $derived(colors[name] ?? "#8884");
  const fg = $derived(name === "p2" || name === "hold" ? "#222" : "#fff");
</script>

<span class="badge" style="background:{bg};color:{fg}">{name}</span>

<style>
  .badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px; font-weight: 600; line-height: 16px; }
</style>
