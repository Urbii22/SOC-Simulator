import { performance } from 'node:perf_hooks';
import { generateProceduralScenario, regenerateProceduralScenario } from '../src/procedural/engine.js';
import { proceduralTemplates } from '../src/procedural/templates.js';
import { gradeScenarioAnswers } from '../src/server/scoring.js';

const seeds = [0, 1, 2, 3, 17, 42, 255, 1_024, 65_535, 92_817, 0x7fff_ffff, 0xffff_ffff];
const difficulties = ['easy', 'medium', 'hard'] as const;
const timings: number[] = [];
const sizes: number[] = [];
const failures: string[] = [];
const heapStart = process.memoryUsage().heapUsed;
let peakHeap = heapStart;
let variants = 0;

for (const template of proceduralTemplates) {
  const templateHashes = new Set<string>();
  const templateSignatures = new Set<string>();
  for (const difficulty of difficulties) for (const seed of seeds) {
    const started = performance.now();
    try {
      const generated = generateProceduralScenario({ template: template.id, seed, difficulty });
      timings.push(performance.now() - started); variants++;
      templateHashes.add(generated.hash);
      templateSignatures.add(JSON.stringify({
        base: generated.scenario.metadata.baseTimestamp, noise: generated.scenario.noiseCount,
        hosts: generated.scenario.hosts, users: generated.scenario.users,
        offsets: generated.scenario.attackEvents.map(({ offsetMinutes }) => offsetMinutes),
        iocs: generated.scenario.iocs.map(({ value }) => value),
      }));
      sizes.push(Buffer.byteLength(JSON.stringify(generated.events)));
      const repeated = regenerateProceduralScenario(generated.scenarioId);
      if (!repeated || repeated.hash !== generated.hash) failures.push(`${generated.variantId}: regeneration hash mismatch`);
      const blocking = generated.validation.issues.filter(({ severity }) => severity === 'error' || severity === 'warning');
      if (blocking.length) failures.push(`${generated.variantId}: ${blocking.length} validation findings`);
      const answers = Object.fromEntries(generated.scenario.questions.map(({ id }) => [id, generated.scenario.answers[id].value]));
      if (gradeScenarioAnswers(generated.scenario, answers).score !== 100) failures.push(`${generated.variantId}: recalculated answer key did not score 100`);
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    } catch (error) { failures.push(`${template.id}:${seed}:${difficulty}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (templateHashes.size < seeds.length * difficulties.length * 0.95) failures.push(`${template.id}: insufficient hash diversity (${templateHashes.size})`);
  if (templateSignatures.size < seeds.length * difficulties.length * 0.9) failures.push(`${template.id}: insufficient structural diversity (${templateSignatures.size})`);
}

timings.sort((left, right) => left - right);
const percentile = (ratio: number) => timings[Math.min(timings.length - 1, Math.floor(timings.length * ratio))] ?? 0;
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const report = {
  templates: proceduralTemplates.length,
  seeds: seeds.length,
  difficulties: difficulties.length,
  variants,
  validationErrors: failures.length,
  generationMs: { average: Number(average(timings).toFixed(2)), p95: Number(percentile(0.95).toFixed(2)), max: Number((timings.at(-1) ?? 0).toFixed(2)) },
  datasetKb: { average: Number((average(sizes) / 1024).toFixed(2)), max: Number((Math.max(...sizes) / 1024).toFixed(2)) },
  peakHeapDeltaMb: Number(((peakHeap - heapStart) / 1024 / 1024).toFixed(2)),
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
}
