import type { EventSource, Ioc, InvestigationQuestion, MitreTechnique, Severity } from '../../domain/types.js';
import type { AttackEvent, ScenarioDefinition, ScenarioDraft } from '../model.js';

type DraftAnswerKey = ScenarioDraft['answers'][string];

export interface FocusQuestion {
  prompt: string;
  value: string;
  aliases?: string[];
  evidenceTerms: string[];
}

export interface ExpandedSpec {
  id: string;
  title: string;
  difficulty: ScenarioDefinition['difficulty'];
  category: string;
  severity: Severity;
  description: string;
  briefing: string;
  businessContext: string;
  host: string;
  user: string;
  sourceIp: string;
  verdict: ScenarioDefinition['expectedVerdict'];
  noiseCount: number;
  noiseSources: EventSource[];
  alerts: string[];
  events: AttackEvent[];
  techniques: MitreTechnique[];
  iocs: Ioc[];
  pivot: FocusQuestion;
  scope: FocusQuestion;
  explanation: string;
  response: string[];
  remediation: string[];
  kql: string[];
  spl: string[];
  sigmaSelection?: string;
}

export function e(
  offsetMinutes: number, source: EventSource, host: string, user: string, sourceIp: string,
  eventCode: string, action: string, outcome: AttackEvent['outcome'], message: string,
  details: AttackEvent['details'] = {}, destinationIp = '10.40.12.10',
): AttackEvent {
  return { offsetMinutes, source, host, user, sourceIp, destinationIp, eventCode, action, outcome, message, tags: ['private-relevant'], details };
}

function verdictQuestion(verdict: ExpandedSpec['verdict']): InvestigationQuestion {
  if (verdict === 'mixed') {
    return { id: 'verdict', prompt: '¿Cómo clasificarías el conjunto de alertas?', type: 'single', options: ['True Positive', 'False Positive', 'Mixed'], points: 10 };
  }
  return { id: 'verdict', prompt: '¿La alerta representa actividad maliciosa confirmada?', type: 'boolean', points: 10 };
}

function verdictAnswer(verdict: ExpandedSpec['verdict']): DraftAnswerKey {
  if (verdict === 'mixed') return { value: 'Mixed', aliases: ['mixto', 'mixed true and false positives'], explanation: 'Hay señales legítimas y maliciosas; deben clasificarse por separado.', evidenceTerms: ['approved', 'unauthorized'] };
  const isTrue = verdict === 'true-positive';
  return {
    value: isTrue,
    aliases: isTrue ? ['true', 'sí', 'si', 'verdadero positivo', 'true positive'] : ['false', 'no', 'falso positivo', 'false positive'],
    explanation: isTrue ? 'La correlación entre fuentes confirma actividad maliciosa.' : 'La evidencia de contexto y control de cambios respalda actividad legítima.',
    evidenceTerms: isTrue ? ['success'] : ['approved'],
  };
}

export function makeScenario(spec: ExpandedSpec): ScenarioDraft {
  const firstRelevant = [...spec.events].sort((left, right) => left.offsetMinutes - right.offsetMinutes)[0];
  const lastRelevant = [...spec.events].sort((left, right) => right.offsetMinutes - left.offsetMinutes)[0];
  const users = [...new Set([spec.user, ...spec.events.map((item) => item.user), 'svc.backup', 'analyst.ops'].filter((value): value is string => Boolean(value)))];
  const hosts = [...new Set([spec.host, ...spec.events.map((item) => item.host), 'dc-02', 'proxy-02'])];
  const questions: InvestigationQuestion[] = [
    { id: 'anchor', prompt: '¿Qué eventCode ancla el primer evento de la cadena relevante?', type: 'text', points: 15 },
    { id: 'terminal', prompt: '¿Qué eventCode permite cerrar o contrastar la timeline?', type: 'text', points: 10 },
    { id: 'source', prompt: '¿Cuál es el origen que permite pivotar la investigación?', type: 'text', points: 10 },
    { id: 'pivot', prompt: spec.pivot.prompt, type: 'text', points: 15 },
    { id: 'technique', prompt: '¿Qué técnica MITRE ATT&CK describe mejor el pivote principal?', type: 'single', options: [spec.techniques[0].id, 'T1055', 'T1047', 'T1087'], points: 15 },
    { id: 'scope', prompt: spec.scope.prompt, type: 'text', points: 10 },
    verdictQuestion(spec.verdict),
    { id: 'containment', prompt: '¿Cuál debe ser la primera acción de contención o validación?', type: 'text', points: 15 },
  ];
  return {
    id: spec.id, title: spec.title, difficulty: spec.difficulty, category: spec.category,
    severity: spec.severity, description: spec.description, briefing: spec.briefing,
    businessContext: spec.businessContext, primaryUser: spec.user, primaryHost: spec.host,
    users, hosts, alerts: spec.alerts, noiseCount: spec.noiseCount, noiseSources: spec.noiseSources,
    expectedVerdict: spec.verdict, attackEvents: spec.events, questions,
    answers: {
      anchor: { value: firstRelevant.eventCode, explanation: `${firstRelevant.eventCode} registra el inicio de la timeline relevante.`, evidenceTerms: [firstRelevant.eventCode, firstRelevant.message] },
      terminal: { value: lastRelevant.eventCode, explanation: `${lastRelevant.eventCode} cierra o contrasta la timeline relevante.`, evidenceTerms: [lastRelevant.eventCode, lastRelevant.message] },
      source: { value: spec.sourceIp, explanation: `${spec.sourceIp} es el origen útil para correlacionar.`, evidenceTerms: [spec.sourceIp] },
      pivot: { value: spec.pivot.value, aliases: spec.pivot.aliases, explanation: `El pivote demostrable es ${spec.pivot.value}.`, evidenceTerms: spec.pivot.evidenceTerms },
      technique: { value: spec.techniques[0].id, aliases: [spec.techniques[0].name], explanation: `${spec.techniques[0].id}: ${spec.techniques[0].name}.`, evidenceTerms: [spec.events[0].eventCode] },
      scope: { value: spec.scope.value, aliases: spec.scope.aliases, explanation: `El alcance demostrado es ${spec.scope.value}.`, evidenceTerms: spec.scope.evidenceTerms },
      verdict: verdictAnswer(spec.verdict),
      containment: { value: spec.response[0], aliases: ['aislar', 'bloquear', 'revocar', 'deshabilitar', 'validar', 'preservar'], explanation: `Primera medida: ${spec.response[0]}.`, evidenceTerms: [spec.host] },
    },
    iocs: spec.iocs, mitre: spec.techniques, explanation: spec.explanation,
    reasoning: [
      'Construir una línea temporal con todas las fuentes antes de clasificar.',
      'Comparar la actividad con el comportamiento habitual y el contexto de negocio.',
      'Pivotar por identidad, activo y sesión en lugar de depender de un único IOC.',
      'Separar alcance confirmado, hipótesis y acciones reversibles de contención.',
    ],
    queries: {
      kql: spec.kql, spl: spec.spl,
      sigma: spec.sigmaSelection ? `title: ${spec.title}\nstatus: experimental\nlogsource:\n  category: security\ndetection:\n  selection:\n    ${spec.sigmaSelection}\n  condition: selection\nfalsepositives:\n  - Validar contexto de negocio y cambio aprobado\nlevel: ${spec.severity}` : undefined,
    },
    responseActions: spec.response,
    remediationActions: spec.remediation,
  };
}
