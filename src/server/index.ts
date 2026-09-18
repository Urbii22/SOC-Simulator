import path from 'node:path';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3001);
const stateFile = process.env.STATE_FILE ?? path.resolve('data/state.json');
createApp({ stateFile }).listen(port, () => {
  console.log(`SOC Training Lab API listening on http://localhost:${port}`);
});
