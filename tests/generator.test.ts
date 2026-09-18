import { describe, expect, it } from 'vitest';
import { scenarioDefinitions } from '../src/scenarios/definitions.js';
import { generateScenarioEvents, getAttackEvents } from '../src/scenarios/generator.js';

describe('scenario generator', () => {
  it('ships the thirty requested scenarios in stable order', () => {
    expect(scenarioDefinitions).toHaveLength(30);
    expect(scenarioDefinitions.map((item) => item.id)).toEqual(expect.arrayContaining([
      'ssh-brute-force', 'password-spraying', 'credential-stuffing', 'suspicious-powershell',
      'phishing-payload', 'dns-tunneling', 'malware-beaconing', 'webshell',
      'privilege-escalation', 'data-exfiltration',
      'suspicious-rdp-login', 'account-lockout', 'web-directory-bruteforce',
      'suspicious-scheduled-task', 'browser-download', 'phishing-powershell',
      'web-account-privilege-abuse', 'suspicious-smb', 'dns-beaconing',
      'credential-dumping', 'lateral-movement-remote-services', 'registry-run-keys',
      'initial-access-execution-persistence', 'spray-compromise-recon',
      'web-exploit-webshell-command', 'endpoint-c2-exfiltration',
      'phishing-credential-cloud-abuse', 'ambiguous-admin-activity',
      'possible-data-exfiltration', 'mixed-alert-incident',
    ]));
  });

  it.each(scenarioDefinitions.map((item) => [item.id, item] as const))('%s is deterministic and contains correlated noise', (_id, scenario) => {
    const first = generateScenarioEvents(scenario);
    const second = generateScenarioEvents(scenario);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThanOrEqual(45);
    expect(first.filter((event) => event.tags.includes('telemetry')).length).toBe(first.length);
    expect(getAttackEvents(scenario, first).length).toBeGreaterThanOrEqual(4);
    expect(first.some((event) => event.tags.includes('attack') || event.tags.includes('benign'))).toBe(false);
    expect(first.map((event) => event.timestamp)).toEqual([...first].map((event) => event.timestamp).sort());
  });

  it.each(scenarioDefinitions.map((item) => [item.id, item] as const))('%s places every expected IOC in its generated evidence', (_id, scenario) => {
    const evidence = generateScenarioEvents(scenario).flatMap((event) => [event.message, event.sourceIp ?? '', event.destinationIp ?? '', event.host, event.user ?? '', ...Object.values(event.details).map(String)]).join(' ').toLowerCase();
    for (const ioc of scenario.iocs) expect(evidence).toContain(ioc.value.toLowerCase());
  });

  it.each(scenarioDefinitions.map((item) => [item.id, item] as const))('%s exposes evidence for core investigation answers', (_id, scenario) => {
    const evidence = JSON.stringify(generateScenarioEvents(scenario)).toLowerCase();
    expect(evidence).toContain(scenario.primaryHost.toLowerCase());
    expect(evidence).toContain(scenario.primaryUser.toLowerCase());
    expect(evidence).toContain(String(scenario.answers.source.value).toLowerCase());
  });

  it('does not classify benign events as solution evidence merely because messages collide', () => {
    const scenario = structuredClone(scenarioDefinitions[0]);
    scenario.attackEvents[0].message = 'Query A packages.internal.example';
    const events = generateScenarioEvents(scenario);
    const timeline = getAttackEvents(scenario, events);
    expect(timeline).toHaveLength(scenario.attackEvents.length);
    expect(timeline.filter((event) => event.message === 'Query A packages.internal.example')).toHaveLength(1);
  });

  it('preserves determinism, ordering and unique ids across a range of seeds', () => {
    const scenario = scenarioDefinitions[0];
    for (let seed = 0; seed < 64; seed++) {
      const first = generateScenarioEvents(scenario, seed);
      const second = generateScenarioEvents(scenario, seed);
      expect(first).toEqual(second);
      expect(new Set(first.map(({ id }) => id)).size).toBe(first.length);
      expect(first.map(({ timestamp }) => timestamp)).toEqual([...first.map(({ timestamp }) => timestamp)].sort());
    }
  });
});
