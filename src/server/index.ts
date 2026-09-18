import path from 'node:path';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be an integer between 1 and 65535');
const stateFile = process.env.STATE_FILE ?? path.resolve('data/state.json');
const server = createApp({ stateFile }).listen(port, () => {
  console.log(`SOC Training Lab API listening on http://localhost:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  console.log(`Received ${signal}; closing the HTTP server`);
  const deadline = setTimeout(() => {
    console.error('Graceful shutdown timed out');
    process.exit(1);
  }, 10_000);
  deadline.unref();
  server.close((error) => {
    clearTimeout(deadline);
    if (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  });
});
