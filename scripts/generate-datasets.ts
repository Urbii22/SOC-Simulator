import fs from 'node:fs';
import path from 'node:path';
import { scenarioDefinitions } from '../src/scenarios/definitions.js';
import { generateScenarioEvents } from '../src/scenarios/generator.js';
import { validateScenarioCatalog } from '../src/scenarios/validation.js';

const validation = validateScenarioCatalog();
if (validation.errorCount) {
  for (const finding of validation.findings.filter((item) => item.severity === 'error')) console.error(`${finding.scenarioId} [${finding.rule}] ${finding.message}`);
  throw new Error(`Dataset generation refused: ${validation.errorCount} scenario validation error(s)`);
}

const output = path.resolve('datasets');
fs.mkdirSync(output, { recursive: true });
for (const scenario of scenarioDefinitions) {
  const body = generateScenarioEvents(scenario).map((event) => JSON.stringify(event)).join('\n');
  fs.writeFileSync(path.join(output, `${scenario.id}.ndjson`), `${body}\n`);
}
console.log(`Generated ${scenarioDefinitions.length} reproducible datasets in ${output}`);
