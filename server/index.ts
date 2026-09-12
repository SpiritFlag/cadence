import { createApp } from "./app";

const port = Number(process.env.CADENCE_PORT ?? 4747);
const app = createApp();

console.log(`cadence → http://localhost:${port}`);

export default { port, fetch: app.fetch };
