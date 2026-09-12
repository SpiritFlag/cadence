import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// 개발: Vite가 4747, Hono가 4748. /api는 프록시.
// 일상: vite build → web/dist, Hono가 4747에서 서빙.
export default defineConfig({
  root: "web",
  plugins: [svelte()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 4747,
    strictPort: true,
    proxy: { "/api": "http://localhost:4748" },
  },
});
