import { runProceduralCli } from '../src/procedural/cli.js';

process.exitCode = runProceduralCli(process.argv.slice(2));
