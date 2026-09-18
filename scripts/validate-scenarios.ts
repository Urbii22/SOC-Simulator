import { scenarioDefinitions } from '../src/scenarios/definitions.js';
import { generateScenarioEvents } from '../src/scenarios/generator.js';
import { validateScenarioCatalog } from '../src/scenarios/validation.js';

const result = validateScenarioCatalog();
if (result.issues.length) {
  console.error(result.issues.join('\n'));
  process.exitCode = 1;
} else {
  const sources = new Set(scenarioDefinitions.flatMap((scenario) => generateScenarioEvents(scenario).map((event) => event.source)));
  const techniques = new Set(scenarioDefinitions.flatMap((scenario) => scenario.mitre.map((item) => item.id)));
  console.log(`Validated ${scenarioDefinitions.length} scenarios, ${result.totalEvents} events, ${techniques.size} MITRE techniques and ${sources.size} log sources.`);
}
