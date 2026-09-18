import fs from 'node:fs';
import path from 'node:path';
import { generateCoverageMarkdown } from '../src/scenarios/coverage.js';
import { validateScenarioCatalog } from '../src/scenarios/validation.js';

const validation = validateScenarioCatalog();
if (validation.errorCount) throw new Error(`Coverage generation refused: ${validation.errorCount} scenario validation error(s)`);

const destination = path.resolve('docs/COVERAGE_MATRIX.md');
fs.writeFileSync(destination, generateCoverageMarkdown(validation), 'utf8');
console.log(`Generated ${destination}`);
