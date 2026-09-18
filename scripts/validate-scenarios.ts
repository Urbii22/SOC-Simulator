import { runValidationCli } from '../src/scenarios/cli.js';

process.exitCode = runValidationCli(process.argv.slice(2));
