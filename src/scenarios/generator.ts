import type { EventSource, SecurityEvent } from '../domain/types.js';
import type { ScenarioDefinition } from './model.js';

function seeded(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6d2b79f5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

const benignTemplates: Array<{ source: EventSource; code: string; action: string; message: string; details: Record<string, string | number | boolean> }> = [
  { source: 'dns' as const, code: 'DNS-Q', action: 'dns_query', message: 'Query A packages.internal.example', details: { qtype: 'A' } },
  { source: 'http' as const, code: '200', action: 'web_request', message: 'GET https://intranet.example/health', details: { bytes: 8421 } },
  { source: 'auth' as const, code: 'LOGIN', action: 'login', message: 'Interactive login from managed device', details: { mfa: true } },
  { source: 'network' as const, code: 'FLOW', action: 'network_flow', message: 'TLS connection to approved update service', details: { port: 443 } },
  { source: 'windows' as const, code: '4624', action: 'login', message: 'Successful network logon type 3', details: { logon_type: 3 } },
  { source: 'linux' as const, code: 'CRON', action: 'scheduled_job', message: 'Hourly log rotation completed', details: { process: 'logrotate' } },
];

export function generateScenarioEvents(definition: ScenarioDefinition, seed = 20260918): SecurityEvent[] {
  const random = seeded(seed + definition.id.length * 97);
  const day = scenarioDefinitionsIndex(definition.id) + 1;
  const base = new Date(`2026-09-${String(day).padStart(2, '0')}T08:00:00.000Z`);
  const noise: SecurityEvent[] = Array.from({ length: 42 }, (_, index) => {
    const template = benignTemplates[Math.floor(random() * benignTemplates.length)];
    const host = definition.hosts[Math.floor(random() * definition.hosts.length)];
    const user = definition.users[Math.floor(random() * definition.users.length)];
    const timestamp = new Date(base.getTime() + (index * 1.35 + random()) * 60_000).toISOString();
    return {
      id: `${definition.id}-n-${index}`, scenarioId: definition.id, timestamp,
      source: template.source, host, user, sourceIp: `10.40.${10 + Math.floor(random() * 20)}.${10 + Math.floor(random() * 200)}`,
      destinationIp: '10.40.10.20', eventCode: template.code, action: template.action,
      outcome: 'success', message: template.message, tags: ['telemetry', template.source], details: template.details,
    };
  });
  const attacks = definition.attackEvents.map((item, index): SecurityEvent => {
    const { offsetMinutes, ...rest } = item;
    return { ...rest, tags: ['telemetry', rest.source], id: `${definition.id}-x-${index}`, scenarioId: definition.id, timestamp: new Date(base.getTime() + offsetMinutes * 60_000).toISOString() };
  });
  return [...noise, ...attacks]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((item, index) => ({ ...item, id: `${definition.id}-evt-${String(index + 1).padStart(3, '0')}` }));
}

export function getAttackEvents(definition: ScenarioDefinition, events = generateScenarioEvents(definition)): SecurityEvent[] {
  const messages = new Set(definition.attackEvents.map((item) => item.message));
  return events.filter((item) => messages.has(item.message));
}

function scenarioDefinitionsIndex(id: string): number {
  const ids = ['ssh-brute-force', 'password-spraying', 'credential-stuffing', 'suspicious-powershell', 'phishing-payload', 'dns-tunneling', 'malware-beaconing', 'webshell', 'privilege-escalation', 'data-exfiltration'];
  return Math.max(0, ids.indexOf(id));
}
