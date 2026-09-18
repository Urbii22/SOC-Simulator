import { describe, expect, it } from 'vitest';
import { runProceduralCli } from '../src/procedural/cli.js';
import { generateProceduralScenario, proceduralRequestFromScenarioId, regenerateProceduralScenario } from '../src/procedural/engine.js';
import { SeededRng } from '../src/procedural/rng.js';
import { proceduralRequestSchema, proceduralTemplateSchema } from '../src/procedural/schema.js';
import { proceduralTemplates } from '../src/procedural/templates.js';
import { scenarioDefinitions } from '../src/scenarios/definitions.js';
import { gradeScenarioAnswers } from '../src/server/scoring.js';

function issueCounts(variant: ReturnType<typeof generateProceduralScenario>) {
  return {
    errors: variant.validation.issues.filter(({ severity }) => severity === 'error').length,
    warnings: variant.validation.issues.filter(({ severity }) => severity === 'warning').length,
  };
}

describe('procedural scenario engine', () => {
  it('validates nine reusable templates without changing the canonical catalog', () => {
    const before = JSON.stringify(scenarioDefinitions);
    expect(proceduralTemplates).toHaveLength(9);
    for (const template of proceduralTemplates) expect(proceduralTemplateSchema.parse(template)).toEqual(template);
    for (const template of proceduralTemplates) generateProceduralScenario({ template: template.id, seed: 92817 });
    expect(scenarioDefinitions).toHaveLength(30);
    expect(JSON.stringify(scenarioDefinitions)).toBe(before);
  });

  it.each(proceduralTemplates.map(({ id }) => id))('%s is byte-stable for a repeated seed and regenerates from its id', (template) => {
    const first = generateProceduralScenario({ template, seed: 92817, difficulty: 'medium' });
    const second = generateProceduralScenario({ template, seed: 92817, difficulty: 'medium' });
    const regenerated = regenerateProceduralScenario(first.scenarioId)!;
    expect(second.hash).toBe(first.hash);
    expect(second.scenario).toEqual(first.scenario);
    expect(regenerated.hash).toBe(first.hash);
    expect(proceduralRequestFromScenarioId(first.scenarioId)).toEqual({ template, seed: 92817, difficulty: 'medium' });
  });

  it.each(proceduralTemplates.map(({ id }) => id))('%s produces meaningful diversity across adjacent seeds', (template) => {
    const variants = [1, 2, 3].map((seed) => generateProceduralScenario({ template, seed, difficulty: 'hard' }));
    const dimensions = [
      variants.map(({ scenario }) => scenario.metadata.baseTimestamp),
      variants.map(({ scenario }) => scenario.noiseCount),
      variants.map(({ scenario }) => scenario.hosts.join('|')),
      variants.map(({ scenario }) => scenario.users.join('|')),
      variants.map(({ scenario }) => scenario.iocs.map(({ value }) => value).join('|')),
      variants.map(({ scenario }) => scenario.attackEvents.map(({ offsetMinutes }) => offsetMinutes).join('|')),
      variants.map(({ hash }) => hash),
    ];
    expect(dimensions.filter((values) => new Set<unknown>(values).size > 1).length).toBeGreaterThanOrEqual(6);
  });

  it('dogfoods every template over representative seeds with zero errors and warnings', () => {
    const seeds = [0, 1, 2, 17, 255, 65_535, 92_817, 0x7fff_ffff, 0xffff_ffff];
    for (const template of proceduralTemplates) for (const seed of seeds) {
      const variant = generateProceduralScenario({ template: template.id, seed });
      expect(issueCounts(variant), `${template.id}:${seed}`).toEqual({ errors: 0, warnings: 0 });
      expect(new Set(variant.scenario.users).size).toBe(variant.scenario.users.length);
      expect(new Set(variant.scenario.hosts).size).toBe(variant.scenario.hosts.length);
      expect(new Set(variant.scenario.iocs.map(({ value }) => value)).size).toBe(variant.scenario.iocs.length);
      const answers = Object.fromEntries(variant.scenario.questions.map(({ id }) => [id, variant.scenario.answers[id].value]));
      expect(gradeScenarioAnswers(variant.scenario, answers).score).toBe(100);
      expect(regenerateProceduralScenario(variant.scenarioId)?.hash).toBe(variant.hash);
    }
  });

  it('keeps all difficulty profiles valid and changes more than event volume', () => {
    for (const template of proceduralTemplates) {
      const variants = (['easy', 'medium', 'hard'] as const).map((difficulty) => generateProceduralScenario({ template: template.id, seed: 44, difficulty }));
      expect(variants.map(({ scenario }) => scenario.difficulty)).toEqual(['Foundation', 'Intermediate', 'Advanced']);
      expect(variants[0].scenario.noiseCount).toBeLessThan(variants[1].scenario.noiseCount!);
      expect(variants[1].scenario.noiseCount).toBeLessThan(variants[2].scenario.noiseCount!);
      expect(variants[0].scenario.users.length).toBeLessThan(variants[2].scenario.users.length);
      expect(variants[0].validation.metrics.durationMinutes).not.toBe(variants[2].validation.metrics.durationMinutes);
      expect(issueCounts(variants[2])).toEqual({ errors: 0, warnings: 0 });
    }
  });

  it('uses documentation ranges and reserved synthetic domains', () => {
    const variant = generateProceduralScenario({ template: 'multi-stage', seed: 101, difficulty: 'hard' });
    const publicIps = variant.scenario.attackEvents.flatMap(({ sourceIp, destinationIp }) => [sourceIp, destinationIp]).filter((value): value is string => typeof value === 'string' && !value.startsWith('10.'));
    expect(publicIps.every((value) => /^(192\.0\.2|198\.51\.100|203\.0\.113)\./.test(value))).toBe(true);
    expect(JSON.stringify(variant.scenario).match(/[a-z0-9.-]+\.example/gi)?.every((domain) => domain.endsWith('.example'))).toBe(true);
  });

  it('supports deterministic random mode without encoding its selected template', () => {
    const first = generateProceduralScenario({ random: true, seed: 82913, difficulty: 'hard' });
    const second = generateProceduralScenario({ random: true, seed: 82913, difficulty: 'hard' });
    expect(first.hash).toBe(second.hash);
    expect(first.variantId).toBe('random:82913:hard');
    expect(first.scenarioId).toBe('proc-random-s82913-hard');
    expect(first.scenario.title).toContain('Investigación sin clasificar');
    expect(first.scenario.category).toBe('Triage no clasificado');
    expect(first.scenarioId).not.toContain(first.templateId);
  });

  it('encodes safe optional parameters in the reproducible identity', () => {
    const variant = generateProceduralScenario({ template: 'password-spray', seed: 77, difficulty: 'medium', parameters: { noiseCount: 88, timelineScale: 1.375 } });
    expect(variant.variantId).toBe('password-spray:77:medium:noise=88:scale=1.375');
    expect(variant.scenarioId).toBe('proc-password-spray-s77-medium-n88-t1375');
    expect(variant.events.length).toBe(88 + variant.scenario.attackEvents.length);
    expect(regenerateProceduralScenario(variant.scenarioId)?.hash).toBe(variant.hash);
  });

  it('rejects invalid, contradictory and unbounded requests', () => {
    const invalid = [
      {}, { template: 'password-spray', random: true, seed: 1 }, { seed: 1 },
      { template: 'password-spray', seed: -1 }, { template: 'password-spray', seed: 0x1_0000_0000 },
      { template: 'password-spray', seed: 1.2 }, { template: 'password-spray', seed: 1, difficulty: 'extreme' },
      { template: 'password-spray', seed: 1, parameters: { noiseCount: 1 } },
      { template: 'password-spray', seed: 1, parameters: { timelineScale: 20 } },
      { template: 'password-spray', seed: 1, parameters: { timelineScale: 1.2345 } },
    ];
    for (const request of invalid) expect(proceduralRequestSchema.safeParse(request).success, JSON.stringify(request)).toBe(false);
    expect(() => generateProceduralScenario({ template: 'not-real', seed: 1 })).toThrow('Unknown procedural template');
    expect(regenerateProceduralScenario('proc-password-spray-s1-medium-n999')).toBeUndefined();
    expect(regenerateProceduralScenario('proc-password-spray-s1-medium-t1')).toBeUndefined();
  });

  it('provides deterministic RNG primitives without Math.random', () => {
    const left = new SeededRng(0xffff_ffff); const right = new SeededRng(0xffff_ffff);
    expect(Array.from({ length: 32 }, () => left.next())).toEqual(Array.from({ length: 32 }, () => right.next()));
    expect(new SeededRng(1).shuffle([1, 2, 3, 4, 5])).toEqual(new SeededRng(1).shuffle([1, 2, 3, 4, 5]));
    expect(new SeededRng(1).fork('hosts').next()).not.toBe(new SeededRng(1).fork('users').next());
  });

  it('offers a strict CLI for listing, JSON output and adversarial flags', () => {
    const output: string[] = []; const errors: string[] = [];
    expect(runProceduralCli(['--list'], { out: (value) => output.push(value), error: (value) => errors.push(value) })).toBe(0);
    expect(output.join('\n')).toContain('password-spray');
    output.length = 0;
    expect(runProceduralCli(['--random', '--seed', '82913', '--difficulty', 'hard', '--json'], { out: (value) => output.push(value), error: (value) => errors.push(value) })).toBe(0);
    expect(JSON.parse(output.join('\n'))).toMatchObject({ variantId: 'random:82913:hard', validation: { errors: 0, warnings: 0 } });
    expect(runProceduralCli(['--template', 'password-spray', '--seed', '-1'], { out: () => undefined, error: (value) => errors.push(value) })).toBe(2);
    expect(runProceduralCli(['--template', 'password-spray', '--seed', '1', '--wat'], { out: () => undefined, error: (value) => errors.push(value) })).toBe(2);
  });
});
