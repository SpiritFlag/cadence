import { createApp } from "./app";

const port = Number(process.env.CADENCE_PORT ?? 4747);
const app = createApp();

console.log(`cadence → http://localhost:${port}`);

// 제안은 claude가 수십 초 걸린다. Bun 기본 idleTimeout(10초)이면 응답 전에 끊긴다.
export default { port, fetch: app.fetch, idleTimeout: 240 };
