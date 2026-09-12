// Vite 개발 서버(4747)와 Hono(4748)를 함께 띄운다. Ctrl+C 한 번에 둘 다 끝난다.
export {};

const server = Bun.spawn(["bun", "--watch", "server/index.ts"], {
  env: { ...process.env, CADENCE_PORT: "4748" },
  stdout: "inherit",
  stderr: "inherit",
});
const vite = Bun.spawn(["bunx", "vite"], { stdout: "inherit", stderr: "inherit" });

const shutdown = () => {
  server.kill();
  vite.kill();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
await Promise.race([server.exited, vite.exited]);
shutdown();
