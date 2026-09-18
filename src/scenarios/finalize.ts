import type { EventSource } from '../domain/types.js';
import { mitreEvidenceHints } from './mitre.js';
import type { AnswerEvidence, AttackEvent, ScenarioDefinition, ScenarioDraft } from './model.js';

const legacyNoiseSources: EventSource[] = ['dns', 'http', 'auth', 'network', 'windows', 'linux'];

export function timelineRef(scenarioId: string, index: number): string {
  return `${scenarioId}:timeline:${index + 1}`;
}

export function attackEventText(event: AttackEvent): string {
  return [event.source, event.host, event.user ?? '', event.sourceIp ?? '', event.destinationIp ?? '', event.eventCode,
    event.action, event.outcome, event.message, ...Object.entries(event.details).flatMap(([key, value]) => [key, String(value)])]
    .join(' ').toLowerCase();
}

function answerEvidence(scenario: ScenarioDraft, questionId: string): AnswerEvidence {
  const answer = scenario.answers[questionId];
  if (answer.evidence) return answer.evidence;
  const value = typeof answer.value === 'string' ? answer.value.toLowerCase() : '';
  const techniqueHints = questionId === 'technique' ? mitreEvidenceHints[value.toUpperCase()] ?? [] : [];
  const terms = [...(answer.evidenceTerms ?? []), ...techniqueHints].map((term) => term.toLowerCase()).filter(Boolean);
  let indexes = scenario.attackEvents.flatMap((event, index) => {
    const text = attackEventText(event);
    return terms.some((term) => text.includes(term)) ? [index] : [];
  });
  if (!indexes.length && value && !/^t\d{4}/i.test(value)) {
    indexes = scenario.attackEvents.flatMap((event, index) => attackEventText(event).includes(value) ? [index] : []);
  }
  if (!indexes.length && ['technique', 'verdict', 'containment'].includes(questionId)) indexes = scenario.attackEvents.map((_, index) => index);
  const fieldsByQuestion: Record<string, string[]> = {
    anchor: ['eventCode', 'message'], terminal: ['eventCode', 'message'], source: ['sourceIp'], technique: ['action', 'message'],
    verdict: ['outcome', 'message', 'details.*'], containment: ['host', 'action'],
  };
  const iocValues = scenario.iocs.filter((ioc) => value.includes(ioc.value.toLowerCase()) || terms.includes(ioc.value.toLowerCase())).map((ioc) => ioc.value);
  return {
    eventRefs: [...new Set(indexes.map((index) => timelineRef(scenario.id, index)))],
    fields: fieldsByQuestion[questionId] ?? ['message', 'details.*'],
    ...(iocValues.length ? { iocValues } : {}),
  };
}

export function finalizeScenario(draft: ScenarioDraft, index: number): ScenarioDefinition {
  const attackSources = draft.attackEvents.map((event) => event.source);
  const dataSources = [...new Set([...(draft.noiseSources ?? legacyNoiseSources), ...attackSources])];
  const relevantSources = new Set(attackSources).size;
  const correlation = draft.expectedVerdict !== 'true-positive' ? 'ambiguous'
    : /multi-stage|→/i.test(draft.category) ? 'multi-stage'
      : relevantSources >= 2 ? 'multi-source' : 'single-source';
  const answers = Object.fromEntries(Object.entries(draft.answers).map(([id, answer]) => [id, { ...answer, evidence: answerEvidence(draft, id) }]));
  return {
    ...draft,
    answers,
    dataSources,
    metadata: {
      schemaVersion: 1,
      deterministic: true,
      defaultSeed: 20260918,
      baseTimestamp: new Date(Date.UTC(2026, 8, index + 1, 8)).toISOString(),
      correlation,
    },
  };
}
