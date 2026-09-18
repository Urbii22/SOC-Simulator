import { describe, expect, it } from 'vitest';
import { generateCoverageMarkdown } from '../src/scenarios/coverage.js';
import { runValidationCli, validationExitCode } from '../src/scenarios/cli.js';
import { scenarioById, scenarioDefinitions } from '../src/scenarios/definitions.js';
import { generateScenarioEvents } from '../src/scenarios/generator.js';
import type { ScenarioDefinition } from '../src/scenarios/model.js';
import { validateScenarioCatalog, validateScenarioDetailed } from '../src/scenarios/validation.js';

function clone(id = 'suspicious-rdp-login'): ScenarioDefinition {
  return structuredClone(scenarioById.get(id)!);
}

function has(result: ReturnType<typeof validateScenarioDetailed>, rule: string, text: string, severity = 'error') {
  return result.issues.some((finding) => finding.rule === rule && finding.severity === severity && finding.message.includes(text));
}

describe('strict scenario validation engine', () => {
  it('rejects missing, mistyped and unknown schema fields', () => {
    const missing = clone() as unknown as Record<string, unknown>;
    delete missing.title;
    expect(has(validateScenarioDetailed(missing), 'schema', 'Required')).toBe(true);

    const wrong = clone() as unknown as Record<string, unknown>;
    wrong.noiseCount = 'many';
    expect(has(validateScenarioDetailed(wrong), 'schema', 'Expected number')).toBe(true);

    const extra = clone() as unknown as Record<string, unknown>;
    extra.solution = 'leak';
    expect(has(validateScenarioDetailed(extra), 'schema', 'Unrecognized key')).toBe(true);

    const invalidTactic = clone();
    invalidTactic.mitre[0].tactic = 'Stealth' as never;
    expect(has(validateScenarioDetailed(invalidTactic), 'schema', 'Invalid enum value')).toBe(true);
  });

  it('detects duplicate catalog ids', () => {
    const scenario = clone();
    const report = validateScenarioCatalog([scenario, structuredClone(scenario)]);
    expect(report.findings).toContainEqual(expect.objectContaining({ rule: 'catalog', severity: 'error', message: expect.stringContaining('duplicate scenario id') }));
  });

  it('detects broken entities, sources and evidence references', () => {
    const scenario = clone();
    scenario.hosts = scenario.hosts.filter((host) => host !== scenario.primaryHost);
    scenario.dataSources = scenario.dataSources.filter((source) => source !== 'windows');
    scenario.answers.anchor.evidence.eventRefs = ['missing:event'];
    const result = validateScenarioDetailed(scenario);
    expect(has(result, 'semantics', 'primaryHost is not present')).toBe(true);
    expect(has(result, 'semantics', 'source windows is not declared')).toBe(true);
    expect(has(result, 'semantics', 'unknown evidence')).toBe(true);
  });

  it('detects duplicate entities and contradictory scenario metadata', () => {
    const scenario = clone();
    scenario.hosts.push(scenario.hosts[0]);
    scenario.dataSources.push(scenario.dataSources[0]);
    scenario.questions.find(({ type }) => type === 'single')!.options!.push(scenario.questions.find(({ type }) => type === 'single')!.options![0]);
    scenario.expectedVerdict = 'false-positive';
    scenario.metadata.correlation = 'single-source';
    const result = validateScenarioDetailed(scenario);
    expect(has(result, 'semantics', 'duplicate host')).toBe(true);
    expect(has(result, 'semantics', 'duplicate data source')).toBe(true);
    expect(has(result, 'semantics', 'duplicate option')).toBe(true);
    expect(has(result, 'semantics', 'contradicts expectedVerdict')).toBe(true);
    expect(has(result, 'semantics', 'single-source correlation')).toBe(true);

    const nondeterministic = clone() as unknown as { metadata: Record<string, unknown> };
    nondeterministic.metadata.deterministic = false;
    expect(has(validateScenarioDetailed(nondeterministic), 'schema', 'Invalid literal value')).toBe(true);
  });

  it('detects contradictory answer evidence and answer types', () => {
    const scenario = clone();
    scenario.answers.anchor.evidenceTerms = ['not-present-anywhere'];
    scenario.answers.anchor.evidence.eventRefs = ['suspicious-rdp-login:timeline:2'];
    scenario.answers.verdict.value = 'yes';
    delete scenario.answers.terminal;
    const result = validateScenarioDetailed(scenario);
    expect(has(result, 'semantics', 'does not contain required term')).toBe(true);
    expect(has(result, 'semantics', 'is not demonstrated by referenced field eventCode')).toBe(true);
    expect(has(result, 'semantics', 'must be boolean')).toBe(true);
    expect(has(result, 'semantics', 'has no answer')).toBe(true);
  });

  it('requires declared evidence fields to exist on the referenced events', () => {
    const scenario = clone();
    scenario.answers.anchor.evidence.fields = ['details.process'];
    scenario.answers.anchor.evidence.eventRefs = ['suspicious-rdp-login:timeline:1'];
    delete scenario.answers.anchor.evidenceTerms;
    expect(has(validateScenarioDetailed(scenario), 'semantics', 'is absent from referenced evidence')).toBe(true);
  });

  it('detects invalid timestamps and causal ordering', () => {
    const invalidTimestamp = clone();
    invalidTimestamp.metadata.baseTimestamp = 'yesterday';
    expect(has(validateScenarioDetailed(invalidTimestamp), 'schema', 'Invalid datetime')).toBe(true);

    const scheduled = clone('suspicious-scheduled-task');
    const start = scheduled.attackEvents.find((event) => event.action === 'scheduled_task_start')!;
    start.offsetMinutes = 1;
    const result = validateScenarioDetailed(scheduled);
    expect(has(result, 'timeline', 'out of causal order')).toBe(true);
    expect(has(result, 'timeline', 'starts before')).toBe(true);

    const equalOffsets = clone();
    equalOffsets.attackEvents[1].offsetMinutes = equalOffsets.attackEvents[0].offsetMinutes;
    expect(has(validateScenarioDetailed(equalOffsets), 'timeline', 'equal offsets')).toBe(true);
  });

  it('proves fixed-seed stability and alternate-seed variation', () => {
    for (const scenario of scenarioDefinitions) {
      expect(generateScenarioEvents(scenario, 44)).toEqual(generateScenarioEvents(scenario, 44));
      expect(generateScenarioEvents(scenario, 44)).not.toEqual(generateScenarioEvents(scenario, 45));
    }
  });

  it('detects malformed, duplicated and unevidenced IOC', () => {
    const scenario = clone();
    scenario.iocs.push({ type: 'ip', value: scenario.iocs[0].value, context: 'Duplicated value for negative test' });
    scenario.iocs[0].value = '999.400.1.2';
    scenario.iocs[1].value = '999.400.1.2';
    scenario.iocs.push({ type: 'url', value: 'file:///tmp/evidence', context: 'Invalid URL protocol for negative test' });
    scenario.iocs.push({ type: 'email', value: 'invalid-at-example', context: 'Invalid email for negative test' });
    scenario.iocs.push({ type: 'hostname', value: '-invalid-host', context: 'Invalid hostname for negative test' });
    const result = validateScenarioDetailed(scenario);
    expect(has(result, 'ioc', 'duplicate IOC')).toBe(true);
    expect(has(result, 'ioc', 'invalid IPv4')).toBe(true);
    expect(has(result, 'ioc', 'absent from student-visible evidence')).toBe(true);
    expect(has(result, 'ioc', 'invalid URL')).toBe(true);
    expect(has(result, 'ioc', 'invalid email')).toBe(true);
    expect(has(result, 'ioc', 'invalid hostname')).toBe(true);
  });

  it('detects unknown, duplicated and unsupported MITRE mappings', () => {
    const scenario = clone();
    scenario.mitre[0] = { id: 'T1003.001', name: 'LSASS Memory', tactic: 'Credential Access' };
    scenario.mitre.push(structuredClone(scenario.mitre[1]));
    scenario.mitre.push({ id: 'T9999', name: 'Not Real', tactic: 'Initial Access' });
    const result = validateScenarioDetailed(scenario);
    expect(has(result, 'mitre', 'duplicate technique')).toBe(true);
    expect(has(result, 'mitre', 'unknown ATT&CK')).toBe(true);
    expect(has(result, 'mitre', 'human review required', 'warning')).toBe(true);
  });

  it('detects unusable and duplicate KQL/SPL queries', () => {
    const scenario = clone();
    scenario.queries.kql = ['ghost.field:"nothing-here"', 'ghost.field:"nothing-here"', 'source:"email" and host:"rd-gw-01"'];
    scenario.queries.spl = ['index=soc ghostField=never-seen'];
    const result = validateScenarioDetailed(scenario);
    expect(has(result, 'queries', 'unavailable field ghost.field')).toBe(true);
    expect(has(result, 'queries', 'duplicate KQL')).toBe(true);
    expect(has(result, 'queries', 'no literal that can match')).toBe(true);
    expect(has(result, 'queries', 'requires undeclared source email')).toBe(true);

    const impossibleConjunction = clone();
    impossibleConjunction.queries.kql = ['host:"rd-gw-01" and eventCode:"NEVER"'];
    expect(has(validateScenarioDetailed(impossibleConjunction), 'queries', 'conjunction matches no generated event')).toBe(true);
  });

  it('parses Sigma YAML and detects broken selectors, fields and event matches', () => {
    const malformed = clone();
    malformed.queries.sigma = 'title: [unterminated';
    expect(has(validateScenarioDetailed(malformed), 'sigma', 'invalid YAML')).toBe(true);

    const wrongRoot = clone();
    wrongRoot.queries.sigma = '- not-a-mapping';
    expect(has(validateScenarioDetailed(wrongRoot), 'sigma', 'root must be a mapping')).toBe(true);

    const broken = clone();
    broken.queries.sigma = 'title: Broken\nstatus: test\nlogsource:\n  category: security\ndetection:\n  selection:\n    ghost.field: impossible\n  condition: missing\nlevel: high';
    const result = validateScenarioDetailed(broken);
    expect(has(result, 'sigma', 'unknown selector missing')).toBe(true);
    expect(has(result, 'sigma', 'unavailable field ghost.field')).toBe(true);
    expect(has(result, 'sigma', 'matches no generated event')).toBe(true);

    const impossibleCondition = clone();
    impossibleCondition.queries.sigma = 'title: Impossible conjunction\nstatus: test\nlogsource:\n  category: security\ndetection:\n  first:\n    eventCode: ALLOW-3389\n  second:\n    eventCode: 4624\n  condition: first and second\nlevel: high';
    expect(has(validateScenarioDetailed(impossibleCondition), 'sigma', 'condition matches no generated event')).toBe(true);
  });

  it('emits transparent quality metrics and triviality warnings', () => {
    const scenario = clone();
    const singleRef = scenario.answers.anchor.evidence.eventRefs[0];
    for (const answer of Object.values(scenario.answers)) answer.evidence.eventRefs = [singleRef];
    scenario.answers.scope.value = scenario.primaryHost;
    const result = validateScenarioDetailed(scenario);
    expect(result.metrics.eventCount).toBeGreaterThan(40);
    expect(result.metrics.noiseRatio).toBeGreaterThan(0.8);
    expect(result.metrics.durationMinutes).toBeGreaterThan(0);
    expect(has(result, 'quality', 'one event supports', 'warning')).toBe(true);
    expect(has(result, 'spoilers', 'appears literally in public scenario context', 'warning')).toBe(true);
  });

  it('supports CLI filtering, JSON output, strict mode and exit codes', () => {
    const output: string[] = []; const errors: string[] = [];
    expect(runValidationCli(['--scenario', 'mixed-alert-incident', '--json'], { out: (value) => output.push(value), error: (value) => errors.push(value) })).toBe(0);
    expect(JSON.parse(output.join('\n'))).toMatchObject({ summary: { scenarios: 1, errors: 0, events: 229 } });
    expect(runValidationCli(['--scenario', 'dns-tunneling', '--strict'], { out: () => undefined, error: () => undefined })).toBe(0);
    expect(runValidationCli(['--scenario', 'does-not-exist'], { out: () => undefined, error: (value) => errors.push(value) })).toBe(2);
    expect(runValidationCli(['--scenario='], { out: () => undefined, error: (value) => errors.push(value) })).toBe(2);
    expect(runValidationCli(['--scenario', '--strict'], { out: () => undefined, error: (value) => errors.push(value) })).toBe(2);
    const clean = validateScenarioCatalog([clone('mixed-alert-incident')]);
    expect(validationExitCode(clean, false)).toBe(0);
  });

  it('regenerates a complete coverage matrix', () => {
    const markdown = generateCoverageMarkdown();
    expect(markdown).toContain('Generada automáticamente');
    expect(markdown.match(/^\| \d+ \|/gm)).toHaveLength(30);
    expect(markdown).toContain('mixed-alert-incident');
  });
});
