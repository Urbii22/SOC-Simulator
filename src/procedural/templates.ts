import { scenarioById } from '../scenarios/definitions.js';
import type { ScenarioDefinition } from '../scenarios/model.js';
import { proceduralTemplateSchema, type ProceduralDifficulty, type ProceduralTemplate } from './schema.js';

interface TemplateSpec {
  id: string;
  name: string;
  blueprintScenarioId: string;
  defaultDifficulty: ProceduralDifficulty;
  profile: ProceduralTemplate['noise']['profile'];
  phases: Array<{ id: string; name: string; eventIndexes: number[] }>;
}

const specs: TemplateSpec[] = [
  { id: 'password-spray', name: 'Password spray corporativo', blueprintScenarioId: 'password-spraying', defaultDifficulty: 'easy', profile: 'cloud', phases: [
    { id: 'credential-access', name: 'Credential Access', eventIndexes: [0, 1, 2] },
    { id: 'initial-access', name: 'Initial Access', eventIndexes: [3] },
  ] },
  { id: 'phishing', name: 'Phishing con payload', blueprintScenarioId: 'phishing-payload', defaultDifficulty: 'medium', profile: 'corporate', phases: [
    { id: 'delivery', name: 'Initial Access', eventIndexes: [0, 1] },
    { id: 'execution', name: 'Execution', eventIndexes: [2, 3] },
  ] },
  { id: 'suspicious-powershell', name: 'PowerShell sospechoso', blueprintScenarioId: 'suspicious-powershell', defaultDifficulty: 'medium', profile: 'corporate', phases: [
    { id: 'execution', name: 'Execution', eventIndexes: [0, 1, 2] },
    { id: 'network', name: 'Command and Control', eventIndexes: [3] },
  ] },
  { id: 'dns-beaconing', name: 'Beaconing DNS', blueprintScenarioId: 'dns-beaconing', defaultDifficulty: 'medium', profile: 'corporate', phases: [
    { id: 'execution', name: 'Execution', eventIndexes: [0] },
    { id: 'beaconing', name: 'Command and Control', eventIndexes: [1, 2, 3, 4] },
    { id: 'response', name: 'Containment', eventIndexes: [5] },
  ] },
  { id: 'lateral-movement', name: 'Movimiento lateral remoto', blueprintScenarioId: 'lateral-movement-remote-services', defaultDifficulty: 'medium', profile: 'datacenter', phases: [
    { id: 'authentication', name: 'Credential Use', eventIndexes: [0, 1] },
    { id: 'remote-services', name: 'Lateral Movement', eventIndexes: [2, 3, 4] },
    { id: 'discovery', name: 'Discovery', eventIndexes: [5, 6] },
  ] },
  { id: 'persistence', name: 'Persistencia de endpoint', blueprintScenarioId: 'registry-run-keys', defaultDifficulty: 'medium', profile: 'corporate', phases: [
    { id: 'execution', name: 'Execution', eventIndexes: [0, 1] },
    { id: 'persistence', name: 'Persistence', eventIndexes: [2, 3] },
    { id: 'callback', name: 'Command and Control', eventIndexes: [4, 5] },
  ] },
  { id: 'webshell', name: 'Webshell en aplicación', blueprintScenarioId: 'webshell', defaultDifficulty: 'hard', profile: 'datacenter', phases: [
    { id: 'initial-access', name: 'Initial Access', eventIndexes: [0, 1] },
    { id: 'persistence', name: 'Persistence', eventIndexes: [2, 3] },
    { id: 'execution', name: 'Execution', eventIndexes: [4, 5] },
  ] },
  { id: 'multi-stage', name: 'Intrusión multi-stage', blueprintScenarioId: 'initial-access-execution-persistence', defaultDifficulty: 'hard', profile: 'mixed', phases: [
    { id: 'initial-access', name: 'Initial Access', eventIndexes: [0, 1] },
    { id: 'execution', name: 'Execution', eventIndexes: [2, 3] },
    { id: 'persistence', name: 'Persistence', eventIndexes: [4] },
    { id: 'discovery', name: 'Discovery', eventIndexes: [5] },
    { id: 'command-control', name: 'Command and Control', eventIndexes: [6, 7] },
    { id: 'containment', name: 'Containment', eventIndexes: [8] },
  ] },
  { id: 'ambiguous-admin', name: 'Administración ambigua', blueprintScenarioId: 'ambiguous-admin-activity', defaultDifficulty: 'hard', profile: 'datacenter', phases: [
    { id: 'authorization', name: 'Change Authorization', eventIndexes: [0] },
    { id: 'remote-admin', name: 'Remote Administration', eventIndexes: [1, 2, 3, 4] },
    { id: 'verification', name: 'Change Verification', eventIndexes: [5, 6] },
  ] },
];

function buildTemplate(spec: TemplateSpec): ProceduralTemplate {
  const blueprint = scenarioById.get(spec.blueprintScenarioId);
  if (!blueprint) throw new Error(`Missing procedural blueprint ${spec.blueprintScenarioId}`);
  const coveredIndexes = spec.phases.flatMap(({ eventIndexes }) => eventIndexes).sort((left, right) => left - right);
  const expectedIndexes = blueprint.attackEvents.map((_, index) => index);
  if (JSON.stringify(coveredIndexes) !== JSON.stringify(expectedIndexes)) throw new Error(`Template ${spec.id} does not cover every blueprint event exactly once`);

  return proceduralTemplateSchema.parse({
    schemaVersion: 1,
    id: spec.id,
    name: spec.name,
    category: blueprint.category,
    blueprintScenarioId: blueprint.id,
    defaultDifficulty: spec.defaultDifficulty,
    supportedDifficulties: ['easy', 'medium', 'hard'],
    mitre: structuredClone(blueprint.mitre),
    logSources: [...new Set(blueprint.attackEvents.map(({ source }) => source))],
    actors: [
      { id: 'primary-user', kind: 'person', role: 'Primary investigated identity', pool: 'users' },
      { id: 'supporting-identities', kind: 'service', role: 'Context and service identities', pool: 'service-accounts' },
    ],
    infrastructure: [
      { id: 'primary-host', kind: 'workstation', role: 'Primary investigated asset', pool: 'hosts' },
      { id: 'network-addresses', kind: 'network', role: 'Internal and external addressing', pool: 'documentation-ips' },
      { id: 'supporting-services', kind: 'external', role: 'Synthetic domains and services', pool: 'domains' },
    ],
    phases: spec.phases.map((phase, index) => ({ ...phase, dependsOn: index ? [spec.phases[index - 1].id] : [] })),
    constraints: { causalOrder: true, minAttackEvents: blueprint.attackEvents.length, maxEvents: 320, maxDurationMinutes: 720 },
    parameters: [
      { id: 'difficulty', kind: 'enum', affects: ['actors', 'hosts', 'timeline', 'noise', 'iocs'] },
      { id: 'base-time', kind: 'timestamp', affects: ['timeline'] },
      { id: 'timeline-scale', kind: 'ratio', affects: ['timeline'] },
      { id: 'noise-count', kind: 'integer', affects: ['noise'] },
      { id: 'attack-details', kind: 'integer', affects: ['attack-details', 'iocs'] },
    ],
    noise: { profile: spec.profile, counts: { easy: 56, medium: 104, hard: 172 }, contextual: true },
    truth: blueprint.expectedVerdict,
    investigation: {
      questions: structuredClone(blueprint.questions), answers: structuredClone(blueprint.answers), evidenceMode: 'rewrite-and-validate',
      iocs: structuredClone(blueprint.iocs), queries: structuredClone(blueprint.queries),
    },
  });
}

export const proceduralTemplates = specs.map(buildTemplate);
export const proceduralTemplateById = new Map(proceduralTemplates.map((template) => [template.id, template]));

export interface ProceduralTemplateSummary {
  id: string;
  name: string;
  category: string;
  defaultDifficulty: ProceduralDifficulty;
  supportedDifficulties: ProceduralDifficulty[];
  phaseCount: number;
}

export function listProceduralTemplates(): ProceduralTemplateSummary[] {
  return proceduralTemplates.map(({ id, name, category, defaultDifficulty, supportedDifficulties, phases }) => ({
    id, name, category, defaultDifficulty, supportedDifficulties: [...supportedDifficulties], phaseCount: phases.length,
  }));
}

export function getBlueprint(template: ProceduralTemplate): ScenarioDefinition {
  const blueprint = scenarioById.get(template.blueprintScenarioId);
  if (!blueprint) throw new Error(`Missing procedural blueprint ${template.blueprintScenarioId}`);
  return blueprint;
}
