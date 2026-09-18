import { describe, expect, it } from 'vitest';
import { scenarioDefinitions } from '../src/scenarios/definitions.js';
import { generateScenarioEvents } from '../src/scenarios/generator.js';
import { validateScenarioCatalog } from '../src/scenarios/validation.js';

const newScenarioIds = [
  'suspicious-rdp-login', 'account-lockout', 'web-directory-bruteforce',
  'suspicious-scheduled-task', 'browser-download', 'phishing-powershell',
  'web-account-privilege-abuse', 'suspicious-smb', 'dns-beaconing',
  'credential-dumping', 'lateral-movement-remote-services', 'registry-run-keys',
  'initial-access-execution-persistence', 'spray-compromise-recon',
  'web-exploit-webshell-command', 'endpoint-c2-exfiltration',
  'phishing-credential-cloud-abuse', 'ambiguous-admin-activity',
  'possible-data-exfiltration', 'mixed-alert-incident',
];

describe('scenario quality gates', () => {
  it('passes the complete catalog validation', () => {
    const result = validateScenarioCatalog();
    expect(result.issues).toEqual([]);
    expect(result.totalEvents).toBe(2946);
  });

  it('adds exactly twenty distinct scenarios', () => {
    expect(scenarioDefinitions.slice(10).map(({ id }) => id)).toEqual(newScenarioIds);
    expect(new Set(scenarioDefinitions.map(({ id }) => id)).size).toBe(30);
  });

  it('contains true-positive, false-positive and mixed investigations', () => {
    const verdicts = scenarioDefinitions.slice(10).map(({ expectedVerdict }) => expectedVerdict);
    expect(verdicts).toContain('true-positive');
    expect(verdicts).toContain('false-positive');
    expect(verdicts).toContain('mixed');
  });

  it('requires broader telemetry as difficulty increases', () => {
    for (const scenario of scenarioDefinitions.slice(10)) {
      const sources = new Set(generateScenarioEvents(scenario).map(({ source }) => source));
      expect(sources.size).toBeGreaterThanOrEqual(scenario.difficulty === 'Advanced' ? 4 : 2);
    }
  });
});
