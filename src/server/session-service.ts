import { createHash, randomBytes } from 'node:crypto';
import type {
  ChallengeHistoryItem, ChallengeIncidentSummary, ChallengeIncidentView, ChallengeMetricBreakdown, ChallengeReview,
  ChallengeSession, ChallengeSessionSummary, ChallengeStats, Difficulty, GradeResult, ScenarioDetail, SecurityEvent,
} from '../domain/types.js';
import { generateProceduralScenario } from '../procedural/engine.js';
import { SeededRng } from '../procedural/rng.js';
import { proceduralTemplateById, proceduralTemplates } from '../procedural/templates.js';
import { scenarioById, scenarioDefinitions } from '../scenarios/definitions.js';
import { generateScenarioEvents, getAttackEvents } from '../scenarios/generator.js';
import type { ScenarioDefinition } from '../scenarios/model.js';
import { gradeScenarioAnswers, validateSubmittedAnswers, type SubmittedAnswers } from './scoring.js';
import type { CreateSessionInput, IncidentPlan, ProgressInput, StoredConfig, StoredIncident, StoredSession } from './session-model.js';
import { SessionStore } from './session-store.js';

const levelToDifficulty: Record<IncidentPlan['difficulty'], Difficulty> = { easy: 'Foundation', medium: 'Intermediate', hard: 'Advanced' };
const difficultyToLevel: Record<Difficulty, IncidentPlan['difficulty']> = { Foundation: 'easy', Intermediate: 'medium', Advanced: 'hard' };
const MAX_HINTS = 3;
const HINT_PENALTY = 3;

export class ChallengeSessionError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ChallengeSessionError'; }
}

interface ResolvedPlan { definition: ScenarioDefinition; events: SecurityEvent[] }

function mean(values: number[]): number { return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0; }
function nowIso(now: () => number): string { return new Date(now()).toISOString(); }
function elapsed(start: string | undefined, end: number): number { return start ? Math.max(0, end - Date.parse(start)) : 0; }
function createId(): string { return `cs-${randomBytes(16).toString('hex')}`; }
function stableHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function freshSeed(): number { return randomBytes(4).readUInt32BE(0); }

function normalizeConfig(input: CreateSessionInput): StoredConfig {
  if (input.mode === 'quick') return { mode: 'quick', count: 1, difficulty: input.difficulty ?? 'medium', source: input.source ?? 'procedural', truth: 'any', categories: [], templates: [] };
  if (input.mode === 'training') return { mode: 'training', count: 3, difficulty: input.difficulty ?? 'mixed', source: input.source ?? 'procedural', truth: 'any', categories: [], templates: [] };
  if (input.mode === 'shift') return { mode: 'shift', count: 5, difficulty: input.difficulty ?? 'progressive', source: input.source ?? 'procedural', truth: 'any', categories: [], templates: [] };
  return {
    mode: 'custom', count: input.count!, difficulty: input.difficulty ?? 'mixed', source: input.source ?? 'procedural',
    truth: input.truth ?? 'any', categories: [...new Set(input.categories ?? [])], templates: [...new Set(input.templates ?? [])],
  };
}

function levelAt(config: StoredConfig, rng: SeededRng, index: number): IncidentPlan['difficulty'] {
  if (config.difficulty === 'easy' || config.difficulty === 'medium' || config.difficulty === 'hard') return config.difficulty;
  if (config.difficulty === 'progressive') {
    const ratio = config.count === 1 ? 0.5 : index / (config.count - 1);
    return ratio < 0.34 ? 'easy' : ratio < 0.67 ? 'medium' : 'hard';
  }
  return rng.fork(`difficulty-${index}`).pick(['easy', 'medium', 'hard'] as const);
}

function planSession(config: StoredConfig, sessionSeed: number): IncidentPlan[] {
  const rng = new SeededRng(sessionSeed);
  let templates = proceduralTemplates.filter((template) =>
    (!config.templates.length || config.templates.includes(template.id))
    && (!config.categories.length || config.categories.includes(template.category))
    && (config.truth === 'any' || template.truth === config.truth));
  let canonicals = scenarioDefinitions.filter((definition) =>
    (!config.categories.length || config.categories.includes(definition.category))
    && (config.truth === 'any' || definition.expectedVerdict === config.truth));
  if (config.templates.some((id) => !proceduralTemplateById.has(id))) throw new ChallengeSessionError('Custom session references an unknown procedural template', 422);
  templates = rng.fork('template-order').shuffle(templates);
  canonicals = rng.fork('canonical-order').shuffle(canonicals);
  if (config.source !== 'canonical' && !templates.length) throw new ChallengeSessionError('No procedural templates match the requested filters', 422);
  if (config.source !== 'procedural' && !canonicals.length) throw new ChallengeSessionError('No canonical scenarios match the requested filters', 422);

  const plans: IncidentPlan[] = [];
  let templateCursor = 0; let canonicalCursor = 0;
  for (let index = 0; index < config.count; index++) {
    const desired = config.source === 'mixed' ? rng.fork(`source-${index}`).pick(['procedural', 'canonical'] as const) : config.source;
    const level = levelAt(config, rng, index);
    if (desired === 'canonical') {
      const matching = canonicals.filter((definition) => difficultyToLevel[definition.difficulty] === level);
      if (!matching.length && (config.difficulty === 'easy' || config.difficulty === 'medium' || config.difficulty === 'hard')) {
        throw new ChallengeSessionError(`No canonical scenarios match difficulty ${config.difficulty} and the requested filters`, 422);
      }
      const pool = matching.length ? matching : canonicals;
      const definition = pool[canonicalCursor++ % pool.length];
      plans.push({ source: 'canonical', definitionId: definition.id, seed: definition.metadata.defaultSeed, difficulty: difficultyToLevel[definition.difficulty] });
    } else {
      const matching = templates.filter((template) => template.supportedDifficulties.includes(level));
      const pool = matching.length ? matching : templates;
      const template = pool[templateCursor++ % pool.length];
      plans.push({ source: 'procedural', templateId: template.id, seed: rng.fork(`incident-seed-${index}`).int(0, 0xffff_ffff), difficulty: level });
    }
  }
  return plans;
}

function resolvePlan(plan: IncidentPlan): ResolvedPlan {
  if (plan.source === 'canonical') {
    const definition = scenarioById.get(plan.definitionId!);
    if (!definition) throw new Error('Stored canonical scenario is no longer available');
    return { definition, events: generateScenarioEvents(definition) };
  }
  const generated = generateProceduralScenario({ template: plan.templateId!, seed: plan.seed, difficulty: plan.difficulty });
  return { definition: generated.scenario, events: generated.events };
}

function scrubEvents(events: SecurityEvent[], incidentId: string): SecurityEvent[] {
  return events.map((event, index) => ({
    ...event, id: `${incidentId}-event-${String(index + 1).padStart(4, '0')}`, scenarioId: incidentId, tags: event.tags.filter((tag) => !/attack|private|answer|truth/i.test(tag)),
    details: Object.fromEntries(Object.entries(event.details).filter(([key]) => !/answer|verdict|ground.?truth|private/i.test(key))),
  }));
}

function publicScenario(incident: StoredIncident, resolved: ResolvedPlan): ScenarioDetail {
  const { definition } = resolved;
  const events = scrubEvents(resolved.events, incident.id);
  return {
    id: incident.id, title: `Incidente ${String(incident.position).padStart(2, '0')}`, difficulty: levelToDifficulty[incident.plan.difficulty],
    category: 'Clasificación pendiente', severity: 'medium', status: incident.status === 'Submitted'
      ? definition.expectedVerdict === 'true-positive' ? 'Closed - True Positive' : definition.expectedVerdict === 'false-positive' ? 'Closed - False Positive' : 'Escalated'
      : incident.status,
    date: events[0]?.timestamp ?? definition.metadata.baseTimestamp, user: definition.primaryUser, host: definition.primaryHost,
    alertCount: definition.alerts.length, eventCount: events.length,
    description: 'Investiga la telemetría, documenta evidencias y determina la clasificación con una justificación reproducible.',
    progress: incident.progress, briefing: 'La solución, la familia del caso, los IOC privados y el mapeo MITRE permanecerán bloqueados hasta la entrega.',
    businessContext: 'Ejercicio aislado de entrenamiento. Basa la decisión exclusivamente en las señales y eventos disponibles.',
    alerts: [`${definition.alerts.length} señales correlacionadas requieren validación`], users: [...definition.users], hosts: [...definition.hosts],
    events, questions: structuredClone(definition.questions), visibleIocs: [], mitre: [], notes: incident.notes,
  };
}

function incidentSummary(incident: StoredIncident): ChallengeIncidentSummary {
  return {
    id: incident.id, position: incident.position, difficulty: incident.plan.difficulty, status: incident.status, progress: incident.progress,
    hintsUsed: incident.hints.length, ...(incident.startedAt ? { startedAt: incident.startedAt } : {}),
    ...(incident.submittedAt ? { submittedAt: incident.submittedAt } : {}), elapsedMs: incident.elapsedMs,
    ...(incident.result ? { score: incident.result.score, adjustedScore: incident.result.adjustedScore } : {}),
  };
}

function summarize(session: StoredSession): ChallengeSessionSummary {
  const submitted = session.incidents.filter((incident) => incident.result);
  const feedback = submitted.flatMap((incident) => incident.result!.feedback);
  const resolved = submitted.map((incident) => ({ incident, definition: resolvePlan(incident.plan).definition }));
  const verdicts = submitted.map((incident) => incident.result!.verdictCorrect).filter((value): value is boolean => value !== null);
  return {
    completed: submitted.length, total: session.incidents.length, accuracy: mean(submitted.map((incident) => incident.result!.score)),
    adjustedAccuracy: mean(submitted.map((incident) => incident.result!.adjustedScore)), verdictAccuracy: verdicts.length ? Math.round(verdicts.filter(Boolean).length / verdicts.length * 100) : 0,
    correctQuestions: feedback.filter((item) => item.correct).length, totalQuestions: feedback.length,
    hintsUsed: submitted.reduce((sum, incident) => sum + incident.hints.length, 0), elapsedMs: session.elapsedMs,
    truePositives: resolved.filter(({ definition }) => definition.expectedVerdict === 'true-positive').length,
    falsePositives: resolved.filter(({ definition }) => definition.expectedVerdict === 'false-positive').length,
    mixed: resolved.filter(({ definition }) => definition.expectedVerdict === 'mixed').length,
    missedQuestionIds: [...new Set(feedback.filter((item) => !item.correct).map((item) => item.questionId))].sort(),
    categories: [...new Set(resolved.map(({ definition }) => definition.category))].sort(),
    mitre: [...new Set(resolved.flatMap(({ definition }) => definition.mitre.map(({ id }) => id)))].sort(),
  };
}

function publicSession(session: StoredSession, currentTime: number): ChallengeSession {
  const elapsedMs = session.status === 'active' ? elapsed(session.startedAt, currentTime) : session.elapsedMs;
  return {
    id: session.id, seed: `session:${session.sessionSeed}`, planHash: session.planHash, revision: session.revision, status: session.status,
    config: { mode: session.config.mode, count: session.config.count, difficulty: session.config.difficulty, source: session.config.source },
    createdAt: session.createdAt, ...(session.startedAt ? { startedAt: session.startedAt } : {}),
    ...(session.firstInteractionAt ? { firstInteractionAt: session.firstInteractionAt } : {}),
    ...(session.completedAt ? { completedAt: session.completedAt } : {}), elapsedMs, currentIndex: session.currentIndex,
    incidents: session.incidents.map(incidentSummary), ...(session.status === 'completed' ? { summary: summarize({ ...session, elapsedMs }) } : {}),
  };
}

function buildReview(incident: StoredIncident, resolved: ResolvedPlan): ChallengeReview {
  if (!incident.result) throw new Error('Incident has not been submitted');
  const { definition } = resolved;
  const base: GradeResult = {
    score: incident.result.score, earned: incident.result.earned, total: incident.result.total, feedback: structuredClone(incident.result.feedback),
    explanation: definition.explanation, reasoning: [...definition.reasoning], timeline: scrubEvents(getAttackEvents(definition, resolved.events), incident.id),
    iocs: structuredClone(definition.iocs), mitre: structuredClone(definition.mitre), queries: structuredClone(definition.queries),
    responseActions: [...definition.responseActions], remediationActions: [...definition.remediationActions],
  };
  return { ...base, rawScore: incident.result.score, adjustedScore: incident.result.adjustedScore, hintPenalty: incident.result.hintPenalty, verdictCorrect: incident.result.verdictCorrect, category: definition.category };
}

function hintFor(definition: ScenarioDefinition, incident: StoredIncident, level: number): string {
  if (level === 1) return `Ordena los ${definition.attackEvents.length + (definition.noiseCount ?? 0)} eventos por tiempo y separa actividad rutinaria de cambios de contexto.`;
  if (level === 2) return `Correlaciona al menos dos fuentes entre ${definition.dataSources.slice(0, 4).join(', ')} usando usuario, host, IP y proximidad temporal.`;
  return 'Contrasta tu hipótesis con una explicación benigna alternativa y cita los eventos terminales que inclinan el veredicto.';
}

function markInteraction(session: StoredSession, incident: StoredIncident, timestamp: string): void {
  if (!session.startedAt) session.startedAt = timestamp;
  if (!session.firstInteractionAt) session.firstInteractionAt = timestamp;
  if (!incident.startedAt) incident.startedAt = timestamp;
  if (!incident.firstInteractionAt) incident.firstInteractionAt = timestamp;
  session.status = 'active'; incident.status = 'Investigating';
}

function validatePartial(definition: ScenarioDefinition, answers: SubmittedAnswers): void {
  const questions = new Map(definition.questions.map((question) => [question.id, question]));
  for (const [id, answer] of Object.entries(answers)) {
    const question = questions.get(id);
    if (!question) throw new ChallengeSessionError('Progress contains an unknown question id', 400);
    if (question.type === 'boolean' && typeof answer !== 'boolean') throw new ChallengeSessionError(`Answer ${id} must be boolean`, 400);
    if (question.type !== 'boolean' && typeof answer !== 'string') throw new ChallengeSessionError(`Answer ${id} must be text`, 400);
    if (question.type === 'single' && !question.options?.some((option) => option.toLocaleLowerCase('es') === String(answer).trim().toLocaleLowerCase('es'))) throw new ChallengeSessionError(`Answer ${id} is not an allowed option`, 400);
  }
}

function groupMetrics(entries: Array<{ key: string; score: number }>): ChallengeMetricBreakdown[] {
  const groups = new Map<string, number[]>();
  for (const entry of entries) groups.set(entry.key, [...(groups.get(entry.key) ?? []), entry.score]);
  return [...groups].map(([key, scores]) => ({ key, investigations: scores.length, accuracy: mean(scores) }))
    .sort((left, right) => left.accuracy - right.accuracy || left.key.localeCompare(right.key));
}

export class ChallengeSessionService {
  constructor(private readonly store: SessionStore, private readonly now: () => number = Date.now) {}

  create(input: CreateSessionInput): ChallengeSession {
    const config = normalizeConfig(input);
    let sessionSeed = input.seed ?? freshSeed();
    if (input.seed === undefined) {
      const recent = new Set(this.store.list().slice(-100).map((session) => session.sessionSeed));
      for (let attempt = 0; recent.has(sessionSeed) && attempt < 10; attempt++) sessionSeed = freshSeed();
    }
    return publicSession(this.createStored(config, sessionSeed, planSession(config, sessionSeed)), this.now());
  }

  private createStored(config: StoredConfig, sessionSeed: number, plans: IncidentPlan[]): StoredSession {
    const createdAt = nowIso(this.now);
    return this.store.create({
      id: createId(), sessionSeed, planHash: stableHash({ sessionSeed, config, plans }), revision: 0, status: 'created', config: { ...config, count: plans.length },
      createdAt, elapsedMs: 0, currentIndex: 0,
      incidents: plans.map((plan, index) => ({ id: `incident-${String(index + 1).padStart(2, '0')}`, position: index + 1, plan, status: 'New', progress: 0, notes: '', answers: {}, evidence: [], actions: [], hints: [], elapsedMs: 0 })),
    });
  }

  get(id: string): ChallengeSession { return publicSession(this.store.get(id), this.now()); }

  getIncident(sessionId: string, incidentId: string): ChallengeIncidentView {
    const session = this.store.get(sessionId);
    const incident = session.incidents.find((item) => item.id === incidentId);
    if (!incident) throw new ChallengeSessionError('Incident not found in challenge session', 404);
    if (incident.position > session.currentIndex + 1) throw new ChallengeSessionError('Complete the current incident before opening this one', 409);
    const resolved = resolvePlan(incident.plan);
    return {
      session: publicSession(session, this.now()), incident: incidentSummary(incident), scenario: publicScenario(incident, resolved),
      savedAnswers: structuredClone(incident.answers), evidence: [...incident.evidence], actions: [...incident.actions],
      ...(incident.verdict ? { verdict: incident.verdict } : {}), ...(incident.severityAssessment ? { severityAssessment: incident.severityAssessment } : {}),
      availableHints: MAX_HINTS - incident.hints.length, hints: structuredClone(incident.hints),
      ...(incident.result ? { review: buildReview(incident, resolved) } : {}),
    };
  }

  start(sessionId: string, incidentId: string, revision: number): ChallengeIncidentView {
    const timestamp = nowIso(this.now);
    this.store.mutate(sessionId, revision, (session) => {
      const incident = this.currentIncident(session, incidentId);
      if (incident.result) throw new ChallengeSessionError('Submitted incidents cannot be restarted', 409);
      markInteraction(session, incident, timestamp);
    });
    return this.getIncident(sessionId, incidentId);
  }

  save(sessionId: string, incidentId: string, input: ProgressInput): ChallengeIncidentView {
    const timestamp = nowIso(this.now);
    this.store.mutate(sessionId, input.revision, (session) => {
      const incident = this.currentIncident(session, incidentId);
      if (incident.result) throw new ChallengeSessionError('Submitted incidents are read-only', 409);
      const { definition } = resolvePlan(incident.plan);
      if (input.answers) validatePartial(definition, input.answers);
      markInteraction(session, incident, timestamp);
      if (input.notes !== undefined) incident.notes = input.notes;
      if (input.answers) incident.answers = { ...incident.answers, ...input.answers };
      if (input.evidence) incident.evidence = [...new Set(input.evidence)];
      if (input.actions) incident.actions = [...new Set(input.actions)];
      if (input.verdict) incident.verdict = input.verdict;
      if (input.severityAssessment) incident.severityAssessment = input.severityAssessment;
      const answered = Object.keys(incident.answers).length / definition.questions.length * 70;
      incident.progress = Math.min(95, Math.round(answered + (incident.notes ? 10 : 0) + (incident.evidence.length ? 10 : 0) + (incident.actions.length ? 10 : 0)));
      incident.elapsedMs = elapsed(incident.startedAt, this.now());
      session.elapsedMs = elapsed(session.startedAt, this.now());
    });
    return this.getIncident(sessionId, incidentId);
  }

  hint(sessionId: string, incidentId: string, revision: number): ChallengeIncidentView {
    const timestamp = nowIso(this.now);
    this.store.mutate(sessionId, revision, (session) => {
      const incident = this.currentIncident(session, incidentId);
      if (incident.result) throw new ChallengeSessionError('Hints are unavailable after submission', 409);
      if (incident.hints.length >= MAX_HINTS) throw new ChallengeSessionError('No more hints are available for this incident', 409);
      const { definition } = resolvePlan(incident.plan);
      markInteraction(session, incident, timestamp);
      const level = incident.hints.length + 1;
      incident.hints.push({ level, text: hintFor(definition, incident, level), requestedAt: timestamp, penalty: HINT_PENALTY });
      incident.elapsedMs = elapsed(incident.startedAt, this.now());
      session.elapsedMs = elapsed(session.startedAt, this.now());
    });
    return this.getIncident(sessionId, incidentId);
  }

  submit(sessionId: string, incidentId: string, revision: number, answers: SubmittedAnswers): ChallengeIncidentView {
    const timestampMs = this.now(); const timestamp = new Date(timestampMs).toISOString();
    this.store.mutate(sessionId, revision, (session) => {
      const incident = this.currentIncident(session, incidentId);
      if (incident.result) throw new ChallengeSessionError('Incident has already been submitted', 409);
      const { definition } = resolvePlan(incident.plan);
      const merged = { ...incident.answers, ...answers };
      const submissionError = validateSubmittedAnswers(definition, merged);
      if (submissionError) throw new ChallengeSessionError(submissionError, 400);
      markInteraction(session, incident, timestamp);
      const grade = gradeScenarioAnswers(definition, merged);
      const verdictFeedback = grade.feedback.find((item) => item.questionId.toLowerCase().includes('verdict'));
      const explicitVerdictCorrect = incident.verdict ? incident.verdict === definition.expectedVerdict : null;
      const hintPenalty = incident.hints.reduce((sum, hint) => sum + hint.penalty, 0);
      incident.answers = merged; incident.status = 'Submitted'; incident.progress = 100; incident.submittedAt = timestamp;
      incident.elapsedMs = elapsed(incident.startedAt, timestampMs);
      incident.result = { ...grade, adjustedScore: Math.max(0, grade.score - hintPenalty), hintPenalty, verdictCorrect: explicitVerdictCorrect ?? verdictFeedback?.correct ?? null };
      session.currentIndex = Math.min(session.incidents.length - 1, session.currentIndex + 1);
      session.elapsedMs = elapsed(session.startedAt, timestampMs);
    });
    return this.getIncident(sessionId, incidentId);
  }

  finalize(sessionId: string, revision: number): ChallengeSession {
    const timestampMs = this.now(); const timestamp = new Date(timestampMs).toISOString();
    const session = this.store.mutate(sessionId, revision, (draft) => {
      if (draft.incidents.some((incident) => !incident.result)) throw new ChallengeSessionError('Complete every incident before finalizing the session', 409);
      if (draft.status === 'completed') throw new ChallengeSessionError('Session is already finalized', 409);
      draft.status = 'completed'; draft.completedAt = timestamp; draft.elapsedMs = elapsed(draft.startedAt, timestampMs);
    });
    return publicSession(session, timestampMs);
  }

  history(): ChallengeHistoryItem[] {
    return this.store.list().map((session) => {
      const summary = summarize(session);
      return { id: session.id, createdAt: session.createdAt, mode: session.config.mode, seed: `session:${session.sessionSeed}`, difficulty: session.config.difficulty, count: session.incidents.length, completed: summary.completed, accuracy: summary.accuracy, durationMs: session.status === 'active' ? elapsed(session.startedAt, this.now()) : session.elapsedMs, status: session.status };
    }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  stats(): ChallengeStats {
    const sessions = this.store.list();
    const entries = sessions.flatMap((session) => session.incidents.filter((incident) => incident.result).map((incident) => ({ incident, definition: resolvePlan(incident.plan).definition })));
    const verdicts = entries.map(({ incident }) => incident.result!.verdictCorrect).filter((value): value is boolean => value !== null);
    const misses = new Map<string, number>();
    for (const { incident } of entries) for (const feedback of incident.result!.feedback) if (!feedback.correct) misses.set(feedback.questionId, (misses.get(feedback.questionId) ?? 0) + 1);
    const byDifficulty = groupMetrics(entries.map(({ incident }) => ({ key: incident.plan.difficulty, score: incident.result!.score })));
    const byCategory = groupMetrics(entries.map(({ incident, definition }) => ({ key: definition.category, score: incident.result!.score })));
    const byMitre = groupMetrics(entries.flatMap(({ incident, definition }) => definition.mitre.map(({ id }) => ({ key: id, score: incident.result!.score }))));
    const weakestTemplates = groupMetrics(entries.filter(({ incident }) => incident.plan.templateId).map(({ incident }) => ({ key: incident.plan.templateId!, score: incident.result!.score })));
    const missedQuestions = [...misses].map(([questionId, count]) => ({ questionId, misses: count })).sort((left, right) => right.misses - left.misses || left.questionId.localeCompare(right.questionId));
    const recommendations: string[] = [];
    if (!entries.length) recommendations.push('Completa un Quick Challenge para establecer una línea base.');
    if (byDifficulty[0]) recommendations.push(`Practica dificultad ${byDifficulty[0].key}: es tu menor precisión (${byDifficulty[0].accuracy}%).`);
    if (byCategory[0]) recommendations.push(`Refuerza ${byCategory[0].key} con una variante procedural nueva.`);
    if (missedQuestions[0]) recommendations.push(`Revisa el criterio de la pregunta “${missedQuestions[0].questionId}”, fallada ${missedQuestions[0].misses} veces.`);
    return {
      investigations: entries.length, sessions: sessions.length, completedSessions: sessions.filter(({ status }) => status === 'completed').length,
      averageAccuracy: mean(entries.map(({ incident }) => incident.result!.score)), verdictAccuracy: verdicts.length ? Math.round(verdicts.filter(Boolean).length / verdicts.length * 100) : 0,
      averageTimeMs: mean(entries.map(({ incident }) => incident.elapsedMs)), hintsUsed: entries.reduce((sum, { incident }) => sum + incident.hints.length, 0),
      byDifficulty, byCategory, byMitre, missedQuestions, weakestTemplates, recommendations,
    };
  }

  repeat(sessionId: string, strategy: 'exact' | 'equivalent' | 'template-new-seed' | 'retry-failed'): ChallengeSession {
    const original = this.store.get(sessionId);
    if (strategy === 'exact') return publicSession(this.createStored(original.config, original.sessionSeed, planSession(original.config, original.sessionSeed)), this.now());
    const sessionSeed = freshSeed();
    if (strategy === 'equivalent') return publicSession(this.createStored(original.config, sessionSeed, planSession(original.config, sessionSeed)), this.now());
    if (strategy === 'template-new-seed') {
      const templates = [...new Set(original.incidents.map(({ plan }) => plan.templateId).filter((id): id is string => Boolean(id)))];
      if (!templates.length) throw new ChallengeSessionError('This session has no procedural templates to repeat', 409);
      const config: StoredConfig = { ...original.config, mode: 'custom', source: 'procedural', templates, categories: [], count: original.incidents.length };
      return publicSession(this.createStored(config, sessionSeed, planSession(config, sessionSeed)), this.now());
    }
    const failed = original.incidents.filter((incident) => incident.result && incident.result.score < 80);
    if (!failed.length) throw new ChallengeSessionError('This session has no failed incidents to retry', 409);
    const rng = new SeededRng(sessionSeed);
    const plans = failed.map((incident, index): IncidentPlan => incident.plan.source === 'procedural'
      ? { ...incident.plan, seed: rng.fork(`retry-${index}`).int(0, 0xffff_ffff) }
      : { ...incident.plan });
    const source = plans.every((plan) => plan.source === 'procedural') ? 'procedural' : plans.every((plan) => plan.source === 'canonical') ? 'canonical' : 'mixed';
    const config: StoredConfig = { ...original.config, mode: 'custom', source, count: plans.length };
    return publicSession(this.createStored(config, sessionSeed, plans), this.now());
  }

  private currentIncident(session: StoredSession, incidentId: string): StoredIncident {
    if (session.status === 'completed') throw new ChallengeSessionError('Completed sessions are read-only', 409);
    const incident = session.incidents.find((item) => item.id === incidentId);
    if (!incident) throw new ChallengeSessionError('Incident not found in challenge session', 404);
    if (incident.position !== session.currentIndex + 1 && !incident.result) throw new ChallengeSessionError('Only the current incident can be updated', 409);
    return incident;
  }
}
