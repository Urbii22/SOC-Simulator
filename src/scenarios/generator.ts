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
  { source: 'firewall', code: 'ALLOW', action: 'connection_allowed', message: 'Approved outbound TLS session', details: { destination_port: 443, policy: 'corp-egress' } },
  { source: 'endpoint', code: 'PROC-START', action: 'process_start', message: 'Signed inventory agent completed health check', details: { process: 'inventory-agent.exe', signed: true } },
  { source: 'email', code: 'MSG-DELIVERED', action: 'mail_deliver', message: 'Internal notification delivered after policy checks', details: { attachment_count: 0 } },
  { source: 'cloud', code: 'AUDIT-SUCCESS', action: 'cloud_api', message: 'Approved SaaS API request from managed session', details: { mfa: true } },
  { source: 'windows', code: '4688', action: 'process_start', message: 'Signed corporate updater started', details: { process: 'corp-update.exe', signed: true } },
  { source: 'sysmon', code: '3', action: 'network_connection', message: 'Browser connected to corporate SaaS', details: { process: 'msedge.exe', destination_port: 443 } },
  { source: 'dns', code: 'DNS-Q', action: 'dns_query', message: 'Query A time.windows.example', details: { qtype: 'A' } },
];

const proceduralSuricataTemplate = { source: 'suricata' as const, code: 'ET-INFO', action: 'network_observation', message: 'Routine TLS flow matched an informational policy signature', details: { destination_port: 443, signature_severity: 3 } };

export function generateScenarioEvents(definition: ScenarioDefinition, seed = definition.metadata.defaultSeed): SecurityEvent[] {
  const random = seeded(seed + definition.id.length * 97);
  const procedural = definition.id.startsWith('proc-');
  const base = new Date(definition.metadata.baseTimestamp);
  const availableTemplates = procedural ? [...benignTemplates, proceduralSuricataTemplate] : benignTemplates;
  const selectedTemplates = definition.noiseSources?.length
    ? availableTemplates.filter((template) => definition.noiseSources!.includes(template.source))
    : availableTemplates.slice(0, 6);
  const templates = selectedTemplates.length ? selectedTemplates : availableTemplates;
  const noise: SecurityEvent[] = Array.from({ length: definition.noiseCount ?? 42 }, (_, index) => {
    const template = procedural && index < templates.length ? templates[index] : templates[Math.floor(random() * templates.length)];
    const host = procedural && index < definition.hosts.length ? definition.hosts[index] : definition.hosts[Math.floor(random() * definition.hosts.length)];
    const user = procedural && index < definition.users.length ? definition.users[index] : definition.users[Math.floor(random() * definition.users.length)];
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
    .sort((a, b) => a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0)
    .map((item, index) => ({ ...item, id: `${definition.id}-evt-${String(index + 1).padStart(3, '0')}` }));
}

function detailsEqual(left: SecurityEvent['details'], right: ScenarioDefinition['attackEvents'][number]['details']): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return leftEntries.length === rightEntries.length && leftEntries.every(([key, value]) => Object.is(value, right[key]));
}

function matchesAttackEvent(definition: ScenarioDefinition, event: SecurityEvent, attack: ScenarioDefinition['attackEvents'][number]): boolean {
  const timestamp = new Date(Date.parse(definition.metadata.baseTimestamp) + attack.offsetMinutes * 60_000).toISOString();
  return event.timestamp === timestamp
    && event.source === attack.source
    && event.host === attack.host
    && event.user === attack.user
    && event.sourceIp === attack.sourceIp
    && event.destinationIp === attack.destinationIp
    && event.eventCode === attack.eventCode
    && event.action === attack.action
    && event.outcome === attack.outcome
    && event.message === attack.message
    && detailsEqual(event.details, attack.details);
}

export function getAttackEvents(definition: ScenarioDefinition, events = generateScenarioEvents(definition)): SecurityEvent[] {
  const remaining = [...events];
  return definition.attackEvents.flatMap((attack) => {
    const index = remaining.findIndex((event) => matchesAttackEvent(definition, event, attack));
    if (index < 0) return [];
    return remaining.splice(index, 1);
  });
}
