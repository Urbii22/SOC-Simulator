import path from 'node:path';
import { createApp, parseAllowedOrigins } from './app.js';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be an integer between 1 and 65535');
const stateFile = process.env.STATE_FILE ?? path.resolve('data/state.json');
const sessionStateFile = process.env.SESSION_STATE_FILE ?? path.resolve('data/sessions.json');
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
const server = createApp({ stateFile, sessionStateFile, allowedOrigins }).listen(port, host, () => {
  console.log(`SOC Training Lab API listening on http://${host.includes(':') ? `[${host}]` : host}:${port}`);
  if (!loopback && !allowedOrigins.length) console.warn('HOST is not loopback: set ALLOWED_ORIGINS to the URL used in the browser, or saving answers and notes will be rejected with 403.');
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
