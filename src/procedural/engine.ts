import { createHash } from 'node:crypto';
import type { EventSource, SecurityEvent } from '../domain/types.js';
import { generateScenarioEvents } from '../scenarios/generator.js';
import type { AttackEvent, ScenarioDefinition } from '../scenarios/model.js';
import { validateScenarioDetailed } from '../scenarios/validation.js';
import { syntheticDomain, syntheticFilename, syntheticHostname, syntheticPools, syntheticServiceAccount, syntheticUsername } from './pools.js';
import { SeededRng } from './rng.js';
import { proceduralRequestSchema, type ProceduralDifficulty, type ProceduralRequest, type ProceduralTemplate } from './schema.js';
import { getBlueprint, proceduralTemplateById, proceduralTemplates } from './templates.js';

const allSources: EventSource[] = ['windows', 'sysmon', 'linux', 'dns', 'http', 'auth', 'network', 'suricata', 'firewall', 'endpoint', 'email', 'cloud'];
const sourceProfiles: Record<ProceduralTemplate['noise']['profile'], EventSource[]> = {
  corporate: ['auth', 'windows', 'sysmon', 'endpoint', 'dns', 'http', 'network', 'firewall', 'email', 'cloud', 'linux', 'suricata'],
  cloud: ['auth', 'cloud', 'email', 'http', 'dns', 'endpoint', 'firewall', 'network', 'windows', 'sysmon', 'linux', 'suricata'],
  datacenter: ['firewall', 'network', 'windows', 'linux', 'sysmon', 'endpoint', 'auth', 'dns', 'http', 'suricata', 'cloud', 'email'],
  mixed: [...allSources],
};
const difficultyRank: Record<ProceduralDifficulty, number> = { easy: 0, medium: 1, hard: 2 };
const outputDifficulty: Record<ProceduralDifficulty, ScenarioDefinition['difficulty']> = { easy: 'Foundation', medium: 'Intermediate', hard: 'Advanced' };
const reservedExecutables = new Set(['powershell.exe', 'pwsh.exe', 'cmd.exe', 'wscript.exe', 'cscript.exe', 'mshta.exe', 'rundll32.exe', 'regsvr32.exe', 'winword.exe', 'excel.exe', 'outlook.exe', 'explorer.exe', 'tar.exe', '7z.exe', 'net.exe']);
const numericDetailKeys = new Set(['attempts', 'targeted_users', 'count', 'queries', 'interval_seconds', 'median_interval', 'response_bytes', 'bytes', 'bytes_in', 'bytes_out', 'request_bytes', 'files', 'chunks', 'duration_minutes', 'duration_seconds']);

export class ProceduralGenerationError extends Error {
  constructor(message: string, readonly details?: unknown) { super(message); this.name = 'ProceduralGenerationError'; }
}

export interface GeneratedProceduralScenario {
  variantId: string;
  scenarioId: string;
  seed: number;
  difficulty: ProceduralDifficulty;
  mode: 'template' | 'random';
  templateId: string;
  scenario: ScenarioDefinition;
  events: SecurityEvent[];
  hash: string;
  validation: ReturnType<typeof validateScenarioDetailed>;
}

function uniqueInOrder<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function collectStrings(value: unknown, result: string[] = []): string[] {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, result);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectStrings(item, result);
  return result;
}

function replaceString(value: string, replacements: ReadonlyMap<string, string>, numericReplacements: ReadonlyMap<number, number>): string {
  let result = value;
  const entries = [...replacements.entries()].sort(([left], [right]) => right.length - left.length || (left < right ? -1 : left > right ? 1 : 0));
  for (const [from, to] of entries) result = result.split(from).join(to);
  for (const [from, to] of numericReplacements) {
    if (String(from).length < 2) continue;
    result = result.replace(new RegExp(`(?<!\\d)${from}(?!\\d)`, 'g'), String(to));
  }
  return result;
}

function rewriteStrings<T>(value: T, replacements: ReadonlyMap<string, string>, numericReplacements: ReadonlyMap<number, number>): T {
  if (typeof value === 'string') return replaceString(value, replacements, numericReplacements) as T;
  if (Array.isArray(value)) return value.map((item) => rewriteStrings(item, replacements, numericReplacements)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteStrings(item, replacements, numericReplacements)])) as T;
  }
  return value;
}

function uniqueGenerated(count: number, factory: (index: number) => string, reserved: Iterable<string> = []): string[] {
  const used = new Set(reserved);
  const result: string[] = [];
  let cursor = 0;
  while (result.length < count) {
    const candidate = factory(cursor++);
    if (used.has(candidate)) continue;
    used.add(candidate); result.push(candidate);
    if (cursor > 10_000) throw new ProceduralGenerationError('Synthetic identity pool exhausted');
  }
  return result;
}

function isPrivateIp(value: string): boolean {
  const [first, second] = value.split('.').map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function syntheticIp(rng: SeededRng, index: number, privateAddress: boolean): string {
  if (privateAddress) return `10.${rng.int(64, 95)}.${(index * 17 + rng.int(1, 220)) % 223 + 1}.${rng.int(10, 240)}`;
  const prefixes = ['192.0.2', '198.51.100', '203.0.113'];
  return `${prefixes[index % prefixes.length]}.${rng.int(10, 240)}`;
}

function makeNumericReplacements(blueprint: ScenarioDefinition, rng: SeededRng, difficulty: ProceduralDifficulty): Map<number, number> {
  const factor = [0.72, 1, 1.34][difficultyRank[difficulty]];
  const replacements = new Map<number, number>();
  for (const event of blueprint.attackEvents) for (const [key, value] of Object.entries(event.details)) {
    if (!numericDetailKeys.has(key) || typeof value !== 'number' || replacements.has(value)) continue;
    const jitter = 0.9 + rng.next() * 0.2;
    const next = Math.max(1, Math.round(value * factor * jitter));
    if (next !== value) replacements.set(value, next);
  }
  return replacements;
}

function applyNumericDetails(scenario: ScenarioDefinition, numericReplacements: ReadonlyMap<number, number>): void {
  for (const event of scenario.attackEvents) for (const [key, value] of Object.entries(event.details)) {
    if (numericDetailKeys.has(key) && typeof value === 'number' && numericReplacements.has(value)) event.details[key] = numericReplacements.get(value)!;
  }
}

function buildReplacements(blueprint: ScenarioDefinition, scenarioId: string, rng: SeededRng): Map<string, string> {
  const replacements = new Map<string, string>([[blueprint.id, scenarioId]]);
  const identityRng = rng.fork('identities');
  const usedUsers = new Set<string>();
  const users = blueprint.users.map((original, index) => {
    if (original === 'SYSTEM' || original === 'root' || original === 'administrator') { usedUsers.add(original); return original; }
    let attempt = index;
    let candidate = original.startsWith('svc.') ? syntheticServiceAccount(identityRng, attempt) : syntheticUsername(identityRng, attempt);
    while (usedUsers.has(candidate)) {
      attempt += blueprint.users.length;
      candidate = original.startsWith('svc.') ? syntheticServiceAccount(identityRng, attempt) : syntheticUsername(identityRng, attempt);
      if (attempt > 10_000) throw new ProceduralGenerationError('Synthetic user pool exhausted');
    }
    usedUsers.add(candidate); return candidate;
  });
  blueprint.users.forEach((value, index) => replacements.set(value, users[index]));

  const hostRng = rng.fork('hosts');
  const hosts = uniqueGenerated(blueprint.hosts.length, (index) => syntheticHostname(hostRng, index));
  blueprint.hosts.forEach((value, index) => replacements.set(value, hosts[index]));

  const strings = collectStrings(blueprint);
  const ipValues = uniqueInOrder(strings.flatMap((value) => value.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? []));
  const ipRng = rng.fork('ips');
  const ips = uniqueGenerated(ipValues.length, (index) => syntheticIp(ipRng, index, isPrivateIp(ipValues[index])));
  ipValues.forEach((value, index) => replacements.set(value, ips[index]));

  const domainValues = uniqueInOrder(strings.flatMap((value) => value.match(/\b[a-z0-9][a-z0-9.-]*\.example\b/gi) ?? []));
  const domainRng = rng.fork('domains');
  const domains = uniqueGenerated(domainValues.length, (index) => syntheticDomain(domainRng, index));
  domainValues.forEach((value, index) => replacements.set(value, domains[index]));

  const filenameValues = uniqueInOrder(strings.flatMap((value) => value.match(/\b[A-Za-z0-9][A-Za-z0-9._-]*\.(?:exe|ps1|zip|docm|php|aspx|jsp|dat|bak)\b/g) ?? []))
    .filter((value) => !reservedExecutables.has(value.toLowerCase()));
  const fileRng = rng.fork('files');
  const usedFiles = new Set<string>();
  for (const [index, value] of filenameValues.entries()) {
    const extension = value.split('.').at(-1)!.toLowerCase() as keyof typeof syntheticPools.filenames;
    let generated = syntheticFilename(extension, fileRng, index);
    let suffix = 1;
    while (usedFiles.has(generated)) generated = generated.replace(`.${extension}`, `-${suffix++}.${extension}`);
    usedFiles.add(generated); replacements.set(value, generated);
  }
  return replacements;
}

function varyTimeline(events: AttackEvent[], rng: SeededRng, difficulty: ProceduralDifficulty, requestedScale?: number): void {
  const scale = requestedScale ?? [0.72 + rng.next() * 0.18, 0.95 + rng.next() * 0.3, 1.35 + rng.next() * 0.55][difficultyRank[difficulty]];
  const original = events.map(({ offsetMinutes }) => offsetMinutes);
  let current = [rng.int(8, 18), rng.int(18, 34), rng.int(28, 52)][difficultyRank[difficulty]];
  for (let index = 0; index < events.length; index++) {
    if (index) {
      const originalGap = Math.max(0.5, original[index] - original[index - 1]);
      current += Math.max(0.25, originalGap * scale * (0.86 + rng.next() * 0.28));
    }
    events[index].offsetMinutes = Number(current.toFixed(3));
  }
}

function sourceSelection(template: ProceduralTemplate, scenario: ScenarioDefinition, difficulty: ProceduralDifficulty): EventSource[] {
  const relevant = uniqueInOrder(scenario.attackEvents.map(({ source }) => source));
  const target = [Math.max(4, relevant.length), Math.max(8, relevant.length), 12][difficultyRank[difficulty]];
  return uniqueInOrder([...relevant, ...sourceProfiles[template.noise.profile]]).slice(0, target);
}

function addDifficultyEntities(scenario: ScenarioDefinition, rng: SeededRng, difficulty: ProceduralDifficulty): void {
  const extras = [0, 2, 4][difficultyRank[difficulty]];
  const userRng = rng.fork('extra-users'); const hostRng = rng.fork('extra-hosts');
  scenario.users.push(...uniqueGenerated(extras, (index) => syntheticUsername(userRng, index + scenario.users.length), scenario.users));
  scenario.hosts.push(...uniqueGenerated(extras, (index) => syntheticHostname(hostRng, index + scenario.hosts.length), scenario.hosts));
}

function addHardCorrelation(scenario: ScenarioDefinition, rng: SeededRng): void {
  const present = new Set(scenario.attackEvents.map(({ source }) => source));
  const additions = sourceProfiles.mixed.filter((source) => !present.has(source)).slice(0, Math.max(0, 4 - present.size));
  let offset = scenario.attackEvents.at(-1)!.offsetMinutes;
  for (const [index, source] of additions.entries()) {
    offset += 1 + rng.next() * 2;
    scenario.attackEvents.push({
      offsetMinutes: Number(offset.toFixed(3)), source, host: scenario.primaryHost, user: scenario.primaryUser,
      sourceIp: scenario.attackEvents[0].sourceIp, destinationIp: scenario.attackEvents.at(-1)?.destinationIp,
      eventCode: `CTX-${index + 1}`, action: 'correlation_signal', outcome: 'success',
      message: `Correlated ${source} telemetry confirmed the investigated session sequence`, tags: ['private-relevant'],
      details: { correlation_id: `case-${rng.int(10_000, 99_999)}`, confidence: 'high' },
    });
  }
  if (additions.length) {
    const lastIndex = scenario.attackEvents.length - 1;
    const last = scenario.attackEvents[lastIndex];
    scenario.answers.terminal = {
      ...scenario.answers.terminal, value: last.eventCode, aliases: undefined,
      explanation: `${last.eventCode} cierra la correlación multifuente de esta variante.`, evidenceTerms: [last.eventCode, last.message],
      evidence: { eventRefs: [`${scenario.id}:timeline:${lastIndex + 1}`], fields: ['eventCode', 'message'] },
    };
    if (scenario.metadata.correlation !== 'multi-stage' && scenario.metadata.correlation !== 'ambiguous') scenario.metadata.correlation = 'multi-source';
  }
}

function addHardIocs(scenario: ScenarioDefinition): void {
  if (!scenario.iocs.some(({ value }) => value === scenario.primaryHost)) scenario.iocs.push({ type: 'hostname', value: scenario.primaryHost, context: 'Activo principal correlacionado en la variante' });
  if (!scenario.iocs.some(({ value }) => value === scenario.primaryUser)) scenario.iocs.push({ type: 'user', value: scenario.primaryUser, context: 'Identidad principal correlacionada en la variante' });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, stableValue(item)]));
  return value;
}

export function hashProceduralVariant(scenario: ScenarioDefinition, events = generateScenarioEvents(scenario)): string {
  return createHash('sha256').update(JSON.stringify(stableValue({ scenario, events }))).digest('hex');
}

function chooseTemplate(request: ReturnType<typeof proceduralRequestSchema.parse>, rng: SeededRng): ProceduralTemplate {
  if (request.random) return rng.fork('random-template').pick(proceduralTemplates);
  const template = proceduralTemplateById.get(request.template!);
  if (!template) throw new ProceduralGenerationError(`Unknown procedural template ${request.template}`);
  return template;
}

export function generateProceduralScenario(input: ProceduralRequest): GeneratedProceduralScenario {
  const request = proceduralRequestSchema.parse(input);
  const rootRng = new SeededRng(request.seed);
  const template = chooseTemplate(request, rootRng);
  const difficulty = request.difficulty ?? template.defaultDifficulty;
  if (!template.supportedDifficulties.includes(difficulty)) throw new ProceduralGenerationError(`Difficulty ${difficulty} is not supported by ${template.id}`);
  const mode = request.random ? 'random' : 'template';
  const parameterId = `${request.parameters?.noiseCount === undefined ? '' : `-n${request.parameters.noiseCount}`}${request.parameters?.timelineScale === undefined ? '' : `-t${Math.round(request.parameters.timelineScale * 1000)}`}`;
  const parameterIdentity = `${request.parameters?.noiseCount === undefined ? '' : `:noise=${request.parameters.noiseCount}`}${request.parameters?.timelineScale === undefined ? '' : `:scale=${request.parameters.timelineScale}`}`;
  const scenarioId = mode === 'random' ? `proc-random-s${request.seed}-${difficulty}${parameterId}` : `proc-${template.id}-s${request.seed}-${difficulty}${parameterId}`;
  const variantId = mode === 'random' ? `random:${request.seed}:${difficulty}${parameterIdentity}` : `${template.id}:${request.seed}:${difficulty}${parameterIdentity}`;
  const blueprint = getBlueprint(template);
  const numericReplacements = makeNumericReplacements(blueprint, rootRng.fork('attack-details'), difficulty);
  const replacements = buildReplacements(blueprint, scenarioId, rootRng);
  const scenario = rewriteStrings(structuredClone(blueprint), replacements, numericReplacements);
  applyNumericDetails(scenario, numericReplacements);

  scenario.id = scenarioId;
  scenario.difficulty = outputDifficulty[difficulty];
  scenario.metadata.defaultSeed = request.seed;
  const dateRng = rootRng.fork('base-time');
  scenario.metadata.baseTimestamp = new Date(Date.UTC(2024 + dateRng.int(0, 4), dateRng.int(0, 11), dateRng.int(1, 28), dateRng.int(0, 22), dateRng.int(0, 59))).toISOString();
  scenario.noiseCount = request.parameters?.noiseCount ?? template.noise.counts[difficulty] + rootRng.fork('noise-count').int(-8, 8);
  if (scenario.noiseCount + scenario.attackEvents.length > template.constraints.maxEvents) throw new ProceduralGenerationError(`Variant exceeds ${template.constraints.maxEvents} events`);
  varyTimeline(scenario.attackEvents, rootRng.fork('timeline'), difficulty, request.parameters?.timelineScale);
  addDifficultyEntities(scenario, rootRng, difficulty);
  scenario.noiseSources = sourceSelection(template, scenario, difficulty);
  scenario.dataSources = uniqueInOrder([...scenario.noiseSources, ...scenario.attackEvents.map(({ source }) => source)]);
  if (difficulty === 'hard') { addHardCorrelation(scenario, rootRng.fork('hard-correlation')); addHardIocs(scenario); }
  scenario.dataSources = uniqueInOrder([...scenario.noiseSources, ...scenario.attackEvents.map(({ source }) => source)]);
  if (scenario.noiseCount + scenario.attackEvents.length > template.constraints.maxEvents) throw new ProceduralGenerationError(`Variant exceeds ${template.constraints.maxEvents} events`);
  if (scenario.attackEvents.at(-1)!.offsetMinutes > template.constraints.maxDurationMinutes) throw new ProceduralGenerationError(`Variant exceeds ${template.constraints.maxDurationMinutes} minutes`);

  if (mode === 'random') {
    scenario.title = `Investigación sin clasificar · ${String(request.seed).padStart(5, '0')}`;
    scenario.category = 'Triage no clasificado';
    scenario.description = 'Conjunto de señales sintéticas pendiente de clasificación, alcance y análisis causal.';
    scenario.briefing = 'Investiga la telemetría sin asumir el tipo de incidente. Construye la timeline, valida el contexto y justifica el veredicto.';
    scenario.alerts = scenario.alerts.map((_, index) => `Señal correlacionada ${String(index + 1).padStart(2, '0')}`);
  } else {
    scenario.title = `${scenario.title} · variante ${request.seed}`;
  }

  const validation = validateScenarioDetailed(scenario, 0, { determinismRuns: 3 });
  const errors = validation.issues.filter(({ severity }) => severity === 'error');
  if (errors.length) throw new ProceduralGenerationError(`Generated variant ${variantId} failed validation`, errors);
  const events = generateScenarioEvents(scenario);
  return { variantId, scenarioId, seed: request.seed, difficulty, mode, templateId: template.id, scenario, events, hash: hashProceduralVariant(scenario, events), validation };
}

export function proceduralRequestFromScenarioId(id: string): ProceduralRequest | undefined {
  const suffix = '(?:-n(\\d+))?(?:-t(\\d+))?';
  const random = new RegExp(`^proc-random-s(\\d+)-(easy|medium|hard)${suffix}$`).exec(id);
  if (random) {
    const seed = Number(random[1]); if (seed > 0xffff_ffff) return undefined;
    return validRegenerationRequest({ random: true, seed, difficulty: random[2] as ProceduralDifficulty, ...requestParameters(random[3], random[4]) });
  }
  const known = new RegExp(`^proc-(.+)-s(\\d+)-(easy|medium|hard)${suffix}$`).exec(id);
  if (!known || !proceduralTemplateById.has(known[1])) return undefined;
  const seed = Number(known[2]); if (seed > 0xffff_ffff) return undefined;
  return validRegenerationRequest({ template: known[1], seed, difficulty: known[3] as ProceduralDifficulty, ...requestParameters(known[4], known[5]) });
}

function requestParameters(noise: string | undefined, scale: string | undefined): Pick<ProceduralRequest, 'parameters'> {
  if (noise === undefined && scale === undefined) return {};
  return { parameters: { ...(noise === undefined ? {} : { noiseCount: Number(noise) }), ...(scale === undefined ? {} : { timelineScale: Number(scale) / 1000 }) } };
}

function validRegenerationRequest(request: ProceduralRequest): ProceduralRequest | undefined {
  return proceduralRequestSchema.safeParse(request).success ? request : undefined;
}

export function regenerateProceduralScenario(id: string): GeneratedProceduralScenario | undefined {
  const request = proceduralRequestFromScenarioId(id);
  return request ? generateProceduralScenario(request) : undefined;
}
