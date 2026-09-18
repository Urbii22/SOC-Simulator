import { scenarioDefinitions } from './definitions.js';
import { generateScenarioEvents, getAttackEvents } from './generator.js';
import { mitreCatalog } from './mitre.js';
import type { ScenarioDefinition } from './model.js';

const eventFields = new Set(['id', 'scenarioId', 'timestamp', 'source', 'host', 'user', 'sourceIp', 'destinationIp', 'eventCode', 'action', 'outcome', 'message', 'tags']);
const techniqueEvidence: Record<string, string[]> = {
  'T1003.001': ['lsass'], 'T1021.001': ['rdp', 'logon type 10'], 'T1021.002': ['admin$'], 'T1021.006': ['winrm', 'wsmprovhost'],
  'T1041': ['upload', 'post'], 'T1053.003': ['cron'], 'T1053.005': ['scheduled task'], 'T1056.003': ['password-sized'],
  'T1059.001': ['powershell'], 'T1059.004': ['/bin/sh', '/bin/bash'], 'T1071.001': ['tls'], 'T1071.004': ['dns'],
  'T1078': ['login', 'session'], 'T1078.002': ['kerberos', 'tgt'], 'T1078.004': ['cloud login'], 'T1087.002': ['nltest', 'person,computer'],
  'T1098.003': ['role added'], 'T1105': ['download'], 'T1110.001': ['failed password', 'password guesses'],
  'T1110.003': ['password', 'distinct_users'], 'T1110.004': ['credential'], 'T1135': ['net.exe view'], 'T1189': ['browser'],
  'T1190': ['exploit', 'deserialization', 'expression'], 'T1204.002': ['user opened', 'mounted'], 'T1505.003': ['.php'],
  'T1543.003': ['service'], 'T1547.001': ['currentversion\\run'], 'T1560.001': ['archive', 'tar.exe'],
  'T1566.001': ['.docm'], 'T1566.002': ['link'], 'T1567.002': ['upload'], 'T1595.003': ['server-status', 'distinct_paths'],
};

function evidenceText(scenario: ScenarioDefinition): string {
  return generateScenarioEvents(scenario)
    .flatMap((event) => [
      event.timestamp,
      event.source,
      event.host,
      event.user ?? '',
      event.sourceIp ?? '',
      event.destinationIp ?? '',
      event.eventCode,
      event.action,
      event.outcome,
      event.message,
      ...Object.entries(event.details).flatMap(([key, value]) => [key, String(value)])
    ])
    .join(' ')
    .toLowerCase();
}

function queryFields(query: string): string[] {
  const withoutValues = query.replace(/"[^"]*"/g, '""');
  return [...withoutValues.matchAll(/([A-Za-z][\w.]*)(?=:)/g)].map((match) => match[1]);
}

function availableFields(scenario: ScenarioDefinition): Set<string> {
  const fields = new Set(eventFields);
  for (const event of generateScenarioEvents(scenario)) {
    for (const key of Object.keys(event.details)) fields.add(`details.${key}`);
  }
  return fields;
}

export function validateScenario(scenario: ScenarioDefinition, index: number): string[] {
  const issues: string[] = [];
  const events = generateScenarioEvents(scenario);
  const repeated = generateScenarioEvents(scenario);
  const evidence = evidenceText(scenario);
  const timeline = getAttackEvents(scenario, events);
  const fields = availableFields(scenario);
  const isNew = index >= 10;
  const prefix = scenario.id;
  const add = (message: string) => issues.push(`${prefix}: ${message}`);

  if (JSON.stringify(events) !== JSON.stringify(repeated)) add('dataset is not deterministic');
  if (!scenario.businessContext.trim()) add('missing business context');
  if (!scenario.responseActions.length || !scenario.remediationActions.length) add('containment or remediation is empty');
  if (new Set(events.map((event) => event.id)).size !== events.length) add('event ids are not unique');
  if (events.some((event) => Number.isNaN(Date.parse(event.timestamp)))) add('invalid timestamp');
  if (events.some((event, position) => position > 0 && event.timestamp < events[position - 1].timestamp)) add('timeline is not sorted');
  if (timeline.length !== scenario.attackEvents.length) add('solution timeline cannot be reconstructed exactly');
  if (timeline.some((event, position) => position > 0 && event.timestamp < timeline[position - 1].timestamp)) add('solution timeline is not coherent');
  if (events.some((event) => event.tags.some((tag) => ['attack', 'benign', 'private-relevant', 'training-evidence'].includes(tag)))) add('private classification tag leaked');
  if (scenario.questions.reduce((sum, question) => sum + question.points, 0) !== 100) add('questions do not total 100 points');
  for (const question of scenario.questions) if (!scenario.answers[question.id]) add(`missing answer for ${question.id}`);
  for (const [id, answer] of Object.entries(scenario.answers)) {
    for (const term of answer.evidenceTerms ?? []) if (!evidence.includes(term.toLowerCase())) add(`answer ${id} lacks evidence term ${term}`);
  }
  for (const ioc of scenario.iocs) if (!evidence.includes(ioc.value.toLowerCase())) add(`IOC not present: ${ioc.value}`);
  for (const host of scenario.hosts) if (!events.some((event) => event.host === host)) add(`declared host absent: ${host}`);
  for (const user of scenario.users) if (!events.some((event) => event.user === user)) add(`declared user absent: ${user}`);
  for (const item of scenario.mitre) {
    if (!mitreCatalog[item.id]) add(`unknown MITRE technique ${item.id}`);
    const keywords = techniqueEvidence[item.id] ?? [];
    if (keywords.length && !keywords.some((keyword) => evidence.includes(keyword))) add(`MITRE ${item.id} lacks supporting event evidence`);
  }
  for (const query of scenario.queries.kql) {
    for (const field of queryFields(query)) if (!fields.has(field)) add(`KQL uses unavailable field ${field}`);
  }
  if (scenario.queries.kql.length < 2 || scenario.queries.spl.length < 2) add('needs at least two KQL and SPL investigation queries');
  for (const query of scenario.queries.spl) {
    const splOptions = new Set(['index', 'current', 'maxspan']);
    const referenced = [...query.matchAll(/\b([A-Za-z][\w.]*)(?=\s*=|\s+IN\b)/g)].map((match) => match[1]).filter((field) => !splOptions.has(field));
    if (!referenced.length) add('SPL query has no dataset field');
    for (const field of referenced) if (!fields.has(field)) add(`SPL uses unavailable field ${field}`);
  }
  if (scenario.queries.sigma) {
    if (!/title:[\s\S]+logsource:[\s\S]+detection:[\s\S]+condition:/.test(scenario.queries.sigma)) add('Sigma structure is incomplete');
    if (/^\s+[\w.|]+:\s*"[^"\n]*\\"$/m.test(scenario.queries.sigma)) add('Sigma contains an invalid quoted trailing backslash');
    const selection = scenario.queries.sigma.match(/\n {2}selection:\n([\s\S]*?)\n {2}condition:/)?.[1] ?? '';
    const sigmaFields = [...selection.matchAll(/^\s{4}([\w.]+)(?:\|[\w]+)?:/gm)].map((match) => match[1]);
    if (!sigmaFields.length) add('Sigma selection has no fields');
    for (const field of sigmaFields) if (!fields.has(field)) add(`Sigma uses unavailable field ${field}`);
  }

  if (isNew) {
    const [minimum, maximum] = scenario.difficulty === 'Foundation' ? [40, 80] : scenario.difficulty === 'Intermediate' ? [80, 150] : [150, 300];
    if (events.length < minimum || events.length > maximum) add(`event count ${events.length} outside ${minimum}-${maximum}`);
    const sourceCount = new Set(events.map((event) => event.source)).size;
    if (sourceCount < 2 || (scenario.difficulty === 'Advanced' && sourceCount < 4)) add(`insufficient source diversity (${sourceCount})`);
    if (scenario.questions.length < 8) add('new scenario needs chained investigation questions');
  }
  return issues;
}

export function validateScenarioCatalog(): { issues: string[]; totalEvents: number } {
  const issues = scenarioDefinitions.flatMap(validateScenario);
  const ids = scenarioDefinitions.map((scenario) => scenario.id);
  if (scenarioDefinitions.length !== 30) issues.unshift(`catalog: expected 30 scenarios, got ${scenarioDefinitions.length}`);
  if (new Set(ids).size !== ids.length) issues.unshift('catalog: duplicate scenario ids');
  return { issues, totalEvents: scenarioDefinitions.reduce((sum, scenario) => sum + generateScenarioEvents(scenario).length, 0) };
}
