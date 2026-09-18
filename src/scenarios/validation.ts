import { parseDocument } from 'yaml';
import { scenarioDefinitions } from './definitions.js';
import { attackEventText, timelineRef } from './finalize.js';
import { generateScenarioEvents, getAttackEvents } from './generator.js';
import { mitreCatalog, mitreEvidenceHints } from './mitre.js';
import type { ScenarioDefinition } from './model.js';
import { scenarioSchema, securityEventSchema } from './schema.js';
import type { CatalogValidationReport, ScenarioMetrics, ScenarioValidationResult, ValidationContext, ValidationIssue, ValidationOptions, ValidationRule, ValidationSeverity } from './validation-types.js';

const baseEventFields = new Set(['id', 'scenarioId', 'timestamp', 'source', 'host', 'user', 'sourceIp', 'destinationIp', 'eventCode', 'action', 'outcome', 'message', 'tags']);
const suspiciousSpoilerWords = /\b(malicious|attacker|compromised|private-relevant|training-evidence)\b/i;

function issue(scenarioId: string, rule: string, severity: ValidationSeverity, message: string, path?: string, context?: ValidationIssue['context']): ValidationIssue {
  return { scenarioId, rule, severity, message, ...(path ? { path } : {}), ...(context ? { context } : {}) };
}

function eventText(event: ValidationContext['events'][number]): string {
  return [event.timestamp, event.source, event.host, event.user ?? '', event.sourceIp ?? '', event.destinationIp ?? '', event.eventCode,
    event.action, event.outcome, event.message, ...Object.entries(event.details).flatMap(([key, value]) => [key, String(value)])]
    .join(' ').toLowerCase();
}

function getField(event: ValidationContext['events'][number], field: string): unknown {
  if (field.startsWith('details.')) return event.details[field.slice('details.'.length)];
  return event[field as keyof typeof event];
}

function availableFields(events: ValidationContext['events']): Set<string> {
  const fields = new Set(baseEventFields);
  for (const event of events) for (const key of Object.keys(event.details)) fields.add(`details.${key}`);
  return fields;
}

function metricsFor(context: ValidationContext): ScenarioMetrics {
  const timestamps = context.events.map((event) => Date.parse(event.timestamp)).filter(Number.isFinite);
  const relevantIds = new Set(context.timeline.map((event) => event.id));
  const evidenceRefs = Object.values(context.scenario.answers).flatMap((answer) => answer.evidence.eventRefs);
  const evidenceSources = new Set(context.scenario.attackEvents.flatMap((event, index) => evidenceRefs.includes(timelineRef(context.scenario.id, index)) ? [event.source] : []));
  const noiseEventCount = context.events.filter((event) => !relevantIds.has(event.id)).length;
  return {
    eventCount: context.events.length,
    relevantEventCount: context.timeline.length,
    noiseEventCount,
    noiseRatio: context.events.length ? Number((noiseEventCount / context.events.length).toFixed(3)) : 0,
    sourceCount: new Set(context.events.map((event) => event.source)).size,
    relevantSourceCount: new Set(context.timeline.map((event) => event.source)).size,
    hostCount: new Set(context.events.map((event) => event.host)).size,
    userCount: new Set(context.events.flatMap((event) => event.user ? [event.user] : [])).size,
    iocCount: context.scenario.iocs.length,
    techniqueCount: context.scenario.mitre.length,
    durationMinutes: timestamps.length ? Number(((Math.max(...timestamps) - Math.min(...timestamps)) / 60_000).toFixed(2)) : 0,
    questionCount: context.scenario.questions.length,
    evidenceReferenceCount: new Set(evidenceRefs).size,
    evidenceSourceCount: evidenceSources.size,
    correlation: context.scenario.metadata.correlation,
  };
}

function emptyMetrics(): ScenarioMetrics {
  return { eventCount: 0, relevantEventCount: 0, noiseEventCount: 0, noiseRatio: 0, sourceCount: 0, relevantSourceCount: 0,
    hostCount: 0, userCount: 0, iocCount: 0, techniqueCount: 0, durationMinutes: 0, questionCount: 0,
    evidenceReferenceCount: 0, evidenceSourceCount: 0, correlation: 'single-source' };
}

const determinismRule = (runs: number): ValidationRule => ({
  id: 'determinism', description: 'Stable output for a fixed seed and meaningful variation for another seed',
  validate({ scenario }) {
    const findings: ValidationIssue[] = [];
    const baseline = JSON.stringify(generateScenarioEvents(scenario, scenario.metadata.defaultSeed));
    for (let run = 1; run < runs; run++) {
      if (JSON.stringify(generateScenarioEvents(scenario, scenario.metadata.defaultSeed)) !== baseline) {
        findings.push(issue(scenario.id, 'determinism', 'error', `dataset changed between same-seed generation runs 1 and ${run + 1}`));
        break;
      }
    }
    if (scenario.metadata.deterministic && (scenario.noiseCount ?? 42) > 0) {
      const alternate = JSON.stringify(generateScenarioEvents(scenario, scenario.metadata.defaultSeed + 1));
      if (alternate === baseline) findings.push(issue(scenario.id, 'determinism', 'error', 'different seeds did not vary the generated noise'));
    }
    return findings;
  },
});

const timelineRule: ValidationRule = {
  id: 'timeline', description: 'Timestamp, range and causal ordering checks',
  validate({ scenario, events, timeline }) {
    const findings: ValidationIssue[] = [];
    const base = Date.parse(scenario.metadata.baseTimestamp);
    if (events.some((event) => !Number.isFinite(Date.parse(event.timestamp)))) findings.push(issue(scenario.id, 'timeline', 'error', 'generated dataset contains an invalid timestamp', 'events'));
    if (events.some((event, index) => index > 0 && event.timestamp < events[index - 1].timestamp)) findings.push(issue(scenario.id, 'timeline', 'error', 'generated events are not chronologically sorted', 'events'));
    if (scenario.attackEvents.some((event, index) => index > 0 && event.offsetMinutes < scenario.attackEvents[index - 1].offsetMinutes)) findings.push(issue(scenario.id, 'timeline', 'error', 'declared solution timeline is out of causal order', 'attackEvents'));
    const maximumOffset = Math.max((scenario.noiseCount ?? 42) * 1.5, ...scenario.attackEvents.map((event) => event.offsetMinutes)) + 5;
    if (events.some((event) => Date.parse(event.timestamp) < base || Date.parse(event.timestamp) > base + maximumOffset * 60_000)) findings.push(issue(scenario.id, 'timeline', 'error', 'event falls outside the scenario time range', 'events'));
    if (timeline.length !== scenario.attackEvents.length) findings.push(issue(scenario.id, 'timeline', 'error', 'solution timeline cannot be reconstructed exactly; check duplicate messages', 'attackEvents'));

    for (const [index, event] of scenario.attackEvents.entries()) {
      const prior = scenario.attackEvents.slice(0, index);
      if (event.action === 'scheduled_task_start' && !scenario.attackEvents.some((candidate) => candidate.action === 'scheduled_task_create' && candidate.host === event.host && candidate.offsetMinutes <= event.offsetMinutes)) {
        findings.push(issue(scenario.id, 'timeline', 'error', 'scheduled task starts before a corresponding creation event', `attackEvents.${index}`));
      }
      if (event.action === 'service_start' && !prior.some((candidate) => ['service_change', 'service_create'].includes(candidate.action) && candidate.host === event.host)) {
        findings.push(issue(scenario.id, 'timeline', 'warning', 'service starts without an earlier service change/create in the investigated timeline', `attackEvents.${index}`));
      }
      if (['upload', 'bulk_upload'].includes(event.action)) {
        const preparation = scenario.attackEvents.filter((candidate) => ['archive_create', 'file_access', 'bulk_read'].includes(candidate.action));
        if (preparation.length && preparation.every((candidate) => candidate.offsetMinutes > event.offsetMinutes)) findings.push(issue(scenario.id, 'timeline', 'error', 'exfiltration precedes every declared collection/preparation event', `attackEvents.${index}`));
        const initialAccess = scenario.attackEvents.filter((candidate) => ['login', 'cloud_login', 'vpn_login', 'download', 'file_upload', 'exploit_attempt'].includes(candidate.action));
        if (initialAccess.length && initialAccess.every((candidate) => candidate.offsetMinutes > event.offsetMinutes)) findings.push(issue(scenario.id, 'timeline', 'error', 'exfiltration precedes every declared initial-access event', `attackEvents.${index}`));
      }
      if (['share_access', 'winrm_shell', 'directory_query', 'mail_read', 'bulk_download', 'role_change'].includes(event.action) && event.user) {
        const authentication = scenario.attackEvents.filter((candidate) => candidate.user === event.user && ['login', 'cloud_login', 'vpn_login', 'ticket_request', 'session_resume'].includes(candidate.action) && candidate.outcome === 'success');
        if (authentication.length && authentication.every((candidate) => candidate.offsetMinutes > event.offsetMinutes)) findings.push(issue(scenario.id, 'timeline', 'warning', `${event.action} occurs before the only successful authentication for ${event.user}`, `attackEvents.${index}`));
      }
      if (['share_access', 'winrm_shell'].includes(event.action) && event.sourceIp) {
        const connections = scenario.attackEvents.filter((candidate) => candidate.sourceIp === event.sourceIp && candidate.action === 'connection_allowed');
        if (connections.length && connections.every((candidate) => candidate.offsetMinutes > event.offsetMinutes)) findings.push(issue(scenario.id, 'timeline', 'warning', `${event.action} precedes its related allowed connection`, `attackEvents.${index}`));
      }
      const parent = typeof event.details.parent === 'string' ? event.details.parent.toLowerCase() : '';
      if (parent && !prior.some((candidate) => attackEventText(candidate).includes(parent))) findings.push(issue(scenario.id, 'timeline', 'info', `parent process ${event.details.parent} is not separately observed earlier; plausible telemetry gap`, `attackEvents.${index}.details.parent`));
    }
    return findings;
  },
};

const semanticsRule: ValidationRule = {
  id: 'semantics', description: 'Cross-field references, declared entities and answer evidence',
  validate({ scenario, events, eventFields }) {
    const findings: ValidationIssue[] = [];
    const outOfScopeHosts = new Set<string>();
    const outOfScopeUsers = new Set<string>();
    for (const [index, event] of events.entries()) {
      const parsed = securityEventSchema.safeParse(event);
      if (!parsed.success) {
        for (const schemaIssue of parsed.error.issues) findings.push(issue(scenario.id, 'semantics', 'error', `generated event schema: ${schemaIssue.message}`, `events.${index}.${schemaIssue.path.join('.')}`));
      }
      if (!scenario.hosts.includes(event.host) && !outOfScopeHosts.has(event.host)) {
        outOfScopeHosts.add(event.host);
        findings.push(issue(scenario.id, 'semantics', 'info', `event host ${event.host} is infrastructure outside the declared investigation scope`, `events.${index}.host`));
      }
      if (event.user && !scenario.users.includes(event.user) && !outOfScopeUsers.has(event.user)) {
        outOfScopeUsers.add(event.user);
        findings.push(issue(scenario.id, 'semantics', 'info', `event user ${event.user} is a technical or out-of-scope identity`, `events.${index}.user`));
      }
      if (event.sourceIp && !isIpv4(event.sourceIp)) findings.push(issue(scenario.id, 'semantics', 'error', `event source IP ${event.sourceIp} is invalid`, `events.${index}.sourceIp`));
      if (event.destinationIp && !isIpv4(event.destinationIp)) findings.push(issue(scenario.id, 'semantics', 'error', `event destination IP ${event.destinationIp} is invalid`, `events.${index}.destinationIp`));
    }
    const sources = new Set(events.map((event) => event.source));
    for (const source of sources) if (!scenario.dataSources.includes(source)) findings.push(issue(scenario.id, 'semantics', 'error', `event source ${source} is not declared`, 'dataSources'));
    for (const source of scenario.dataSources) if (!sources.has(source)) findings.push(issue(scenario.id, 'semantics', 'warning', `declared source ${source} produced no events`, 'dataSources'));
    for (const host of scenario.hosts) if (!events.some((event) => event.host === host)) findings.push(issue(scenario.id, 'semantics', 'error', `declared host ${host} is absent from the dataset`, 'hosts'));
    for (const user of scenario.users) if (!events.some((event) => event.user === user)) findings.push(issue(scenario.id, 'semantics', 'error', `declared user ${user} is absent from the dataset`, 'users'));
    if (!scenario.hosts.includes(scenario.primaryHost)) findings.push(issue(scenario.id, 'semantics', 'error', 'primaryHost is not present in hosts', 'primaryHost'));
    if (!scenario.users.includes(scenario.primaryUser)) findings.push(issue(scenario.id, 'semantics', 'error', 'primaryUser is not present in users', 'primaryUser'));
    const questionIds = scenario.questions.map((question) => question.id);
    for (const id of new Set(questionIds.filter((id, index) => questionIds.indexOf(id) !== index))) findings.push(issue(scenario.id, 'semantics', 'error', `duplicate question id ${id}`, 'questions'));
    for (const question of scenario.questions) {
      const answer = scenario.answers[question.id];
      if (!answer) { findings.push(issue(scenario.id, 'semantics', 'error', `question ${question.id} has no answer`, `answers.${question.id}`)); continue; }
      if (question.type === 'boolean' && typeof answer.value !== 'boolean') findings.push(issue(scenario.id, 'semantics', 'error', `answer ${question.id} must be boolean`, `answers.${question.id}.value`));
      if (question.type === 'single' && (typeof answer.value !== 'string' || !question.options?.includes(answer.value))) findings.push(issue(scenario.id, 'semantics', 'error', `answer ${question.id} is not one of the question options`, `answers.${question.id}.value`));
      const validRefs = new Set(scenario.attackEvents.map((_, index) => timelineRef(scenario.id, index)));
      for (const ref of answer.evidence.eventRefs) if (!validRefs.has(ref)) findings.push(issue(scenario.id, 'semantics', 'error', `answer ${question.id} references unknown evidence ${ref}`, `answers.${question.id}.evidence.eventRefs`));
      for (const field of answer.evidence.fields) if (field !== 'details.*' && !eventFields.has(field)) findings.push(issue(scenario.id, 'semantics', 'error', `answer ${question.id} references unavailable field ${field}`, `answers.${question.id}.evidence.fields`));
      for (const value of answer.evidence.iocValues ?? []) if (!scenario.iocs.some((ioc) => ioc.value === value)) findings.push(issue(scenario.id, 'semantics', 'error', `answer ${question.id} references unknown IOC ${value}`, `answers.${question.id}.evidence.iocValues`));
      const referenced = scenario.attackEvents.filter((_, index) => answer.evidence.eventRefs.includes(timelineRef(scenario.id, index)));
      const proof = referenced.map(attackEventText).join(' ');
      for (const term of answer.evidenceTerms ?? []) if (!proof.includes(term.toLowerCase())) findings.push(issue(scenario.id, 'semantics', 'error', `answer ${question.id} evidence does not contain required term ${term}`, `answers.${question.id}.evidence`));
      if (typeof answer.value === 'string') {
        const directFields = answer.evidence.fields.filter((field) => ['host', 'user', 'sourceIp', 'destinationIp', 'eventCode'].includes(field));
        for (const field of directFields) {
          const value = answer.value.toLowerCase();
          const fieldValue = (event: ScenarioDefinition['attackEvents'][number]) => String(event[field as keyof typeof event] ?? '').toLowerCase();
          if (scenario.attackEvents.some((event) => fieldValue(event) === value) && !referenced.some((event) => fieldValue(event) === value)) {
            findings.push(issue(scenario.id, 'semantics', 'error', `answer ${question.id} value ${answer.value} is not demonstrated by referenced field ${field}`, `answers.${question.id}.evidence.fields`));
          }
        }
      }
    }
    for (const id of Object.keys(scenario.answers)) if (!questionIds.includes(id)) findings.push(issue(scenario.id, 'semantics', 'error', `answer ${id} has no corresponding question`, `answers.${id}`));
    if (scenario.questions.reduce((sum, question) => sum + question.points, 0) !== 100) findings.push(issue(scenario.id, 'semantics', 'error', 'question points do not total 100', 'questions'));
    return findings;
  },
};

function isIpv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

const iocRule: ValidationRule = {
  id: 'ioc', description: 'IOC format, uniqueness and evidence integrity',
  validate({ scenario, evidenceText }) {
    const findings: ValidationIssue[] = [];
    const seen = new Set<string>();
    const relevant = scenario.attackEvents.map(attackEventText).join(' ');
    for (const [index, ioc] of scenario.iocs.entries()) {
      const path = `iocs.${index}`;
      const key = `${ioc.type}:${ioc.value.toLowerCase()}`;
      if (seen.has(key)) findings.push(issue(scenario.id, 'ioc', 'error', `duplicate IOC ${ioc.value}`, path));
      seen.add(key);
      if (!evidenceText.includes(ioc.value.toLowerCase())) findings.push(issue(scenario.id, 'ioc', 'error', `IOC ${ioc.value} is absent from student-visible evidence`, path));
      if (!relevant.includes(ioc.value.toLowerCase())) findings.push(issue(scenario.id, 'ioc', 'error', `IOC ${ioc.value} appears only in noise, not the solution timeline`, path));
      if (ioc.type === 'ip' && !isIpv4(ioc.value)) findings.push(issue(scenario.id, 'ioc', 'error', `invalid IPv4 IOC ${ioc.value}`, `${path}.value`));
      if (ioc.type === 'domain' && (!/^[a-z0-9.-]+$/i.test(ioc.value) || !ioc.value.includes('.'))) findings.push(issue(scenario.id, 'ioc', 'error', `invalid domain IOC ${ioc.value}`, `${path}.value`));
      if (ioc.type === 'hostname' && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(ioc.value)) findings.push(issue(scenario.id, 'ioc', 'error', `invalid hostname IOC ${ioc.value}`, `${path}.value`));
      if (ioc.type === 'url') {
        try { const url = new URL(ioc.value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol'); }
        catch { findings.push(issue(scenario.id, 'ioc', 'error', `invalid URL IOC ${ioc.value}`, `${path}.value`)); }
      }
      if (ioc.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ioc.value)) findings.push(issue(scenario.id, 'ioc', 'error', `invalid email IOC ${ioc.value}`, `${path}.value`));
      if (ioc.type === 'hash' && !/^[a-f0-9]{8,128}(?:-synthetic)?$/i.test(ioc.value)) findings.push(issue(scenario.id, 'ioc', 'error', `invalid synthetic hash IOC ${ioc.value}`, `${path}.value`));
      if (ioc.type === 'user' && !scenario.users.includes(ioc.value)) findings.push(issue(scenario.id, 'ioc', 'error', `user IOC ${ioc.value} is not declared`, path));
      if (['path', 'registry_key'].includes(ioc.type) && !/[\\/]/.test(ioc.value)) findings.push(issue(scenario.id, 'ioc', 'error', `${ioc.type} IOC lacks a path separator`, `${path}.value`));
    }
    return findings;
  },
};

const mitreRule: ValidationRule = {
  id: 'mitre', description: 'Local ATT&CK catalog and event support',
  validate({ scenario }) {
    const findings: ValidationIssue[] = [];
    const relevant = scenario.attackEvents.map(attackEventText).join(' ');
    const seen = new Set<string>();
    for (const [index, technique] of scenario.mitre.entries()) {
      const path = `mitre.${index}`;
      if (seen.has(technique.id)) findings.push(issue(scenario.id, 'mitre', 'error', `duplicate technique ${technique.id}`, path));
      seen.add(technique.id);
      if (!/^T\d{4}(?:\.\d{3})?$/.test(technique.id)) findings.push(issue(scenario.id, 'mitre', 'error', `invalid ATT&CK id ${technique.id}`, `${path}.id`));
      const catalog = mitreCatalog[technique.id];
      if (!catalog) { findings.push(issue(scenario.id, 'mitre', 'error', `unknown ATT&CK technique ${technique.id}`, path)); continue; }
      if (catalog.name !== technique.name || catalog.tactic !== technique.tactic) findings.push(issue(scenario.id, 'mitre', 'error', `${technique.id} metadata differs from the local catalog`, path));
      const hints = mitreEvidenceHints[technique.id] ?? [];
      if (hints.length && !hints.some((hint) => relevant.includes(hint))) findings.push(issue(scenario.id, 'mitre', 'warning', `${technique.id} has no automated evidence hint match; human review required`, path));
    }
    return findings;
  },
};

function queryFields(query: string): string[] {
  const withoutValues = query.replace(/"[^"]*"/g, '""');
  return [...withoutValues.matchAll(/([A-Za-z][\w.]*)(?=\s*:|\s*=|\s+IN\b)/g)].map((match) => match[1]).filter((field) => !['index', 'current', 'maxspan'].includes(field));
}

function queryLiterals(query: string): string[] {
  const quoted = [...query.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const bare = [...query.matchAll(/(?:[:=]|\bIN\s*\()\s*([A-Za-z0-9_./$-]+)/gi)].map((match) => match[1]);
  return [...new Set([...quoted, ...bare].flatMap((value) => value.split(/\s+or\s+|,/i)).map((value) => {
    let normalized = value.replaceAll('*', '').replace(/[()]/g, '').trim().toLowerCase();
    while (normalized.includes('\\\\')) normalized = normalized.replaceAll('\\\\', '\\');
    return normalized;
  }).filter((value) => value.length >= 3 && !['soc', 'true', 'false'].includes(value)))];
}

const queryRule: ValidationRule = {
  id: 'queries', description: 'KQL/SPL fields, duplication, sources and evidence reachability',
  validate({ scenario, eventFields, evidenceText }) {
    const findings: ValidationIssue[] = [];
    for (const [language, queries] of [['kql', scenario.queries.kql], ['spl', scenario.queries.spl]] as const) {
      const seen = new Set<string>();
      for (const [index, query] of queries.entries()) {
        const path = `queries.${language}.${index}`;
        const normalized = query.trim().toLowerCase();
        if (seen.has(normalized)) findings.push(issue(scenario.id, 'queries', 'error', `duplicate ${language.toUpperCase()} query`, path));
        seen.add(normalized);
        const fields = queryFields(query);
        if (!fields.length) findings.push(issue(scenario.id, 'queries', 'error', `${language.toUpperCase()} query references no dataset field`, path));
        for (const field of fields) if (!eventFields.has(field)) findings.push(issue(scenario.id, 'queries', 'error', `${language.toUpperCase()} query uses unavailable field ${field}`, path));
        const sourceValues = [...query.matchAll(/source\s*[:=]\s*"?([a-z]+)"?/gi)].map((match) => match[1]);
        for (const source of sourceValues) if (!scenario.dataSources.includes(source as ScenarioDefinition['dataSources'][number])) findings.push(issue(scenario.id, 'queries', 'error', `${language.toUpperCase()} query requires undeclared source ${source}`, path));
        const literals = queryLiterals(query);
        if (literals.length && !literals.some((literal) => evidenceText.includes(literal))) findings.push(issue(scenario.id, 'queries', 'error', `${language.toUpperCase()} query has no literal that can match this dataset`, path, { literals }));
      }
    }
    return findings;
  },
};

function sigmaMatches(event: ValidationContext['events'][number], selection: Record<string, unknown>): boolean {
  return Object.entries(selection).every(([rawField, expected]) => {
    const [field, modifier] = rawField.split('|');
    const actual = getField(event, field);
    const candidates = Array.isArray(expected) ? expected : [expected];
    return candidates.some((candidate) => {
      const left = String(actual ?? '').toLowerCase();
      const right = String(candidate).toLowerCase();
      if (modifier === 'contains') return left.includes(right);
      if (modifier === 'endswith') return left.endsWith(right);
      if (modifier === 'startswith') return left.startsWith(right);
      if (modifier === 'gte') return Number(actual) >= Number(candidate);
      return left === right;
    });
  });
}

const sigmaRule: ValidationRule = {
  id: 'sigma', description: 'YAML, Sigma structure, selectors, fields and event match',
  validate({ scenario, events, eventFields }) {
    if (!scenario.queries.sigma) return [];
    const findings: ValidationIssue[] = [];
    const document = parseDocument(scenario.queries.sigma);
    for (const error of document.errors) findings.push(issue(scenario.id, 'sigma', 'error', `invalid YAML: ${error.message}`, 'queries.sigma'));
    if (document.errors.length) return findings;
    const parsedRule = document.toJS() as unknown;
    if (!parsedRule || typeof parsedRule !== 'object' || Array.isArray(parsedRule)) return [...findings, issue(scenario.id, 'sigma', 'error', 'Sigma document root must be a mapping', 'queries.sigma')];
    const rule = parsedRule as Record<string, unknown>;
    for (const key of ['title', 'status', 'logsource', 'detection', 'level']) if (!(key in rule)) findings.push(issue(scenario.id, 'sigma', 'error', `Sigma rule misses required key ${key}`, 'queries.sigma'));
    const detection = rule.detection as Record<string, unknown> | undefined;
    if (!detection || typeof detection !== 'object' || Array.isArray(detection)) return [...findings, issue(scenario.id, 'sigma', 'error', 'Sigma detection must be a mapping', 'queries.sigma')];
    const condition = detection.condition;
    if (typeof condition !== 'string' || !condition.trim()) findings.push(issue(scenario.id, 'sigma', 'error', 'Sigma condition is missing or empty', 'queries.sigma'));
    const selectors = Object.entries(detection).filter(([key, value]) => key !== 'condition' && key !== 'timeframe' && value && typeof value === 'object');
    if (!selectors.length) findings.push(issue(scenario.id, 'sigma', 'error', 'Sigma detection has no selector', 'queries.sigma'));
    const selectorNames = new Set(selectors.map(([name]) => name));
    if (typeof condition === 'string') {
      const names = condition.match(/[A-Za-z_][\w-]*/g)?.filter((name) => !['and', 'or', 'not', 'of', 'all', 'them'].includes(name.toLowerCase())) ?? [];
      for (const name of names) if (!selectorNames.has(name)) findings.push(issue(scenario.id, 'sigma', 'error', `Sigma condition references unknown selector ${name}`, 'queries.sigma'));
    }
    for (const [name, value] of selectors) {
      if (Array.isArray(value)) { findings.push(issue(scenario.id, 'sigma', 'error', `Sigma selector ${name} must be a mapping`, 'queries.sigma')); continue; }
      const selection = value as Record<string, unknown>;
      for (const rawField of Object.keys(selection)) {
        const field = rawField.split('|')[0];
        if (!eventFields.has(field)) findings.push(issue(scenario.id, 'sigma', 'error', `Sigma selector ${name} uses unavailable field ${field}`, 'queries.sigma'));
      }
      if (!events.some((event) => sigmaMatches(event, selection))) findings.push(issue(scenario.id, 'sigma', 'error', `Sigma selector ${name} matches no generated event`, 'queries.sigma'));
    }
    return findings;
  },
};

const spoilerRule: ValidationRule = {
  id: 'spoilers', description: 'Private solution boundary and accidental answer leakage heuristics',
  validate({ scenario, events }) {
    const findings: ValidationIssue[] = [];
    if (events.some((event) => event.tags.some((tag) => ['attack', 'benign', 'private-relevant', 'training-evidence'].includes(tag)))) findings.push(issue(scenario.id, 'spoilers', 'error', 'generated public events contain private classification tags', 'events'));
    const publicText = [scenario.title, scenario.description, scenario.briefing, scenario.businessContext, scenario.primaryHost, scenario.primaryUser, ...scenario.alerts].join(' ').toLowerCase();
    for (const question of scenario.questions) {
      const answer = scenario.answers[question.id];
      if (!answer) continue;
      if (question.type !== 'single' && typeof answer.value === 'string' && answer.value.length >= 4 && publicText.includes(answer.value.toLowerCase())) findings.push(issue(scenario.id, 'spoilers', 'warning', `answer to ${question.id} appears literally in public scenario context`, `answers.${question.id}.value`));
    }
    for (const [index, event] of events.entries()) if (suspiciousSpoilerWords.test(event.message) || event.tags.some((tag) => suspiciousSpoilerWords.test(tag))) findings.push(issue(scenario.id, 'spoilers', 'error', 'student-visible event contains an explicit solution label', `events.${index}`));
    return findings;
  },
};

const qualityRule: ValidationRule = {
  id: 'quality', description: 'Non-blocking heuristics for trivial or low-correlation scenarios',
  validate(context) {
    const { scenario, events, timeline } = context;
    const findings: ValidationIssue[] = [];
    const metrics = metricsFor(context);
    if (metrics.noiseRatio < 0.75) findings.push(issue(scenario.id, 'quality', 'warning', `noise ratio ${metrics.noiseRatio} is low for an investigation exercise`, 'attackEvents'));
    if (scenario.difficulty === 'Advanced' && metrics.relevantSourceCount < 4) findings.push(issue(scenario.id, 'quality', 'warning', `advanced scenario uses only ${metrics.relevantSourceCount} relevant sources`, 'attackEvents'));
    const referenceCounts = new Map<string, number>();
    for (const answer of Object.values(scenario.answers)) {
      if (answer.evidence.eventRefs.length > 2) continue;
      for (const ref of answer.evidence.eventRefs) referenceCounts.set(ref, (referenceCounts.get(ref) ?? 0) + 1);
    }
    const maximumAnswers = Math.max(0, ...referenceCounts.values());
    if (maximumAnswers >= Math.max(4, Math.ceil(scenario.questions.length * 0.7))) findings.push(issue(scenario.id, 'quality', 'warning', `one event supports ${maximumAnswers}/${scenario.questions.length} answers`, 'answers'));
    const relevantIps = new Set(scenario.attackEvents.flatMap((event) => [event.sourceIp, event.destinationIp].filter((value): value is string => Boolean(value))));
    if (relevantIps.size === 1) findings.push(issue(scenario.id, 'quality', 'info', 'all relevant events use a single IP; verify that correlation is not reducible to one indicator', 'attackEvents'));
    for (const ioc of scenario.iocs) {
      const inRelevant = timeline.filter((event) => eventText(event).includes(ioc.value.toLowerCase())).length;
      const inNoise = events.filter((event) => !timeline.some((candidate) => candidate.id === event.id) && eventText(event).includes(ioc.value.toLowerCase())).length;
      if (inRelevant && !inNoise) findings.push(issue(scenario.id, 'quality', 'info', `IOC ${ioc.value} has no benign lookalike/noise occurrence`, 'iocs'));
    }
    return findings;
  },
};

function rules(options: ValidationOptions): ValidationRule[] {
  return [determinismRule(Math.max(2, options.determinismRuns ?? 3)), timelineRule, semanticsRule, iocRule, mitreRule, queryRule, sigmaRule, spoilerRule, qualityRule];
}

export function validateScenarioDetailed(input: unknown, index = 0, options: ValidationOptions = {}): ScenarioValidationResult {
  void index; // Kept for compatibility with the original catalog validator signature.
  const parsed = scenarioSchema.safeParse(input);
  if (!parsed.success) {
    const scenarioId = typeof input === 'object' && input && 'id' in input ? String((input as { id: unknown }).id) : '<unknown>';
    const findings = parsed.error.issues.map((problem) => issue(scenarioId, 'schema', 'error', problem.message, problem.path.join('.')));
    return { scenarioId, title: scenarioId, issues: findings, checks: [{ rule: 'schema', errors: findings.length, warnings: 0, infos: 0 }], metrics: emptyMetrics() };
  }
  const scenario = parsed.data as ScenarioDefinition;
  const events = generateScenarioEvents(scenario);
  const timeline = getAttackEvents(scenario, events);
  const context: ValidationContext = { scenario, events, timeline, eventFields: availableFields(events), evidenceText: events.map(eventText).join(' ') };
  const allRules = rules(options);
  const findings = allRules.flatMap((rule) => rule.validate(context));
  const checks = allRules.map((rule) => ({
    rule: rule.id,
    errors: findings.filter((finding) => finding.rule === rule.id && finding.severity === 'error').length,
    warnings: findings.filter((finding) => finding.rule === rule.id && finding.severity === 'warning').length,
    infos: findings.filter((finding) => finding.rule === rule.id && finding.severity === 'info').length,
  }));
  return { scenarioId: scenario.id, title: scenario.title, issues: findings, checks: [{ rule: 'schema', errors: 0, warnings: 0, infos: 0 }, ...checks], metrics: metricsFor(context) };
}

export function validateScenario(scenario: ScenarioDefinition, index: number): string[] {
  return validateScenarioDetailed(scenario, index).issues.filter((finding) => finding.severity === 'error').map((finding) => `${finding.scenarioId}: ${finding.message}`);
}

export function validateScenarioCatalog(definitions: ScenarioDefinition[] = scenarioDefinitions, options: ValidationOptions = {}): CatalogValidationReport {
  const results = definitions.map((scenario, index) => validateScenarioDetailed(scenario, index, options));
  const catalogFindings: ValidationIssue[] = [];
  const ids = definitions.map((scenario) => scenario.id);
  for (const id of new Set(ids.filter((value, index) => ids.indexOf(value) !== index))) catalogFindings.push(issue(id, 'catalog', 'error', `duplicate scenario id ${id}`, 'id'));
  const sourceUse = new Map<string, number>();
  const techniqueUse = new Map<string, number>();
  for (const scenario of definitions) {
    for (const source of scenario.dataSources) sourceUse.set(source, (sourceUse.get(source) ?? 0) + 1);
    for (const technique of scenario.mitre) techniqueUse.set(technique.id, (techniqueUse.get(technique.id) ?? 0) + 1);
  }
  if (definitions.length > 5) {
    for (const [source, count] of sourceUse) if (count < 2) catalogFindings.push(issue('catalog', 'coverage', 'warning', `log source ${source} is used by only ${count} scenario`, 'dataSources'));
    const repetitionLimit = Math.ceil(definitions.length * 0.25);
    for (const [technique, count] of techniqueUse) if (count > repetitionLimit) catalogFindings.push(issue('catalog', 'coverage', 'warning', `MITRE technique ${technique} appears in ${count}/${definitions.length} scenarios`, 'mitre'));
    for (let left = 0; left < definitions.length; left++) for (let right = left + 1; right < definitions.length; right++) {
      const first = definitions[left]; const second = definitions[right];
      const firstSignature = new Set([...first.attackEvents.map((event) => `source:${event.source}`), ...first.mitre.map((item) => `mitre:${item.id}`)]);
      const secondSignature = new Set([...second.attackEvents.map((event) => `source:${event.source}`), ...second.mitre.map((item) => `mitre:${item.id}`)]);
      const union = new Set([...firstSignature, ...secondSignature]);
      const overlap = [...firstSignature].filter((item) => secondSignature.has(item)).length / union.size;
      if (overlap >= 0.9 && first.category === second.category) catalogFindings.push(issue('catalog', 'coverage', 'warning', `${first.id} and ${second.id} have highly similar source/technique coverage`, 'attackEvents'));
    }
  }
  const findings = [...catalogFindings, ...results.flatMap((result) => result.issues)];
  const errors = findings.filter((finding) => finding.severity === 'error');
  return {
    results, findings, issues: errors.map((finding) => `${finding.scenarioId}: ${finding.message}`),
    totalEvents: results.reduce((sum, result) => sum + result.metrics.eventCount, 0),
    errorCount: errors.length,
    warningCount: findings.filter((finding) => finding.severity === 'warning').length,
    infoCount: findings.filter((finding) => finding.severity === 'info').length,
  };
}
