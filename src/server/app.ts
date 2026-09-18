import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { scenarioById, scenarioDefinitions } from '../scenarios/definitions.js';
import { generateScenarioEvents, getAttackEvents } from '../scenarios/generator.js';
import type { GradeResult, ScenarioDetail, ScenarioSummary, SecurityEvent } from '../domain/types.js';
import { LabStore } from './store.js';
import { syncEventsToElastic } from './elastic.js';

const statuses = ['New', 'Investigating', 'Escalated', 'Closed - True Positive', 'Closed - False Positive'] as const;
const updateSchema = z.object({ status: z.enum(statuses).optional(), notes: z.string().max(10_000).optional() }).refine((value) => value.status || value.notes !== undefined);
const submitSchema = z.object({ answers: z.record(z.union([z.string().max(2_000), z.boolean()])) });

function normalize(value: unknown): string {
  return String(value).trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function answerMatches(given: unknown, expected: string | boolean, aliases: string[] = []): boolean {
  const candidate = normalize(given);
  const accepted = [expected, ...aliases].map(normalize);
  return accepted.some((value) => candidate === value || (value.length > 4 && candidate.includes(value)));
}

function toSummary(id: string, store: LabStore): ScenarioSummary {
  const definition = scenarioById.get(id)!;
  const events = generateScenarioEvents(definition);
  const state = store.get(id);
  return {
    id, title: definition.title, difficulty: definition.difficulty, category: definition.category,
    severity: definition.severity, status: state.status, date: getAttackEvents(definition, events)[0].timestamp,
    user: definition.primaryUser, host: definition.primaryHost, alertCount: definition.alerts.length,
    eventCount: events.length, description: definition.description, progress: state.progress,
  };
}

function filterEvents(events: SecurityEvent[], query: string): SecurityEvent[] {
  const value = query.trim().toLowerCase();
  if (!value) return events;
  const pairs = [...value.matchAll(/([\w.]+):"?([^"\s]+)"?/g)];
  if (!pairs.length) return events.filter((event) => JSON.stringify(event).toLowerCase().includes(value));
  return events.filter((event) => pairs.every(([, field, sought]) => {
    const aliases: Record<string, keyof SecurityEvent> = { 'host.name': 'host', 'user.name': 'user', 'source.ip': 'sourceIp', 'event.code': 'eventCode', 'event.action': 'action' };
    const key = aliases[field] ?? field as keyof SecurityEvent;
    return String(event[key] ?? '').toLowerCase().includes(sought.replaceAll('*', ''));
  }));
}

export function createApp(options: { stateFile?: string } = {}) {
  const app = express();
  const store = new LabStore(options.stateFile);
  app.disable('x-powered-by');
  app.use(cors({ origin(origin, callback) {
    const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
    callback(null, origin === undefined || localOrigin.test(origin));
  } }));
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use(express.json({ limit: '128kb' }));

  app.get('/api/health', (_request, response) => response.json({ status: 'ok', scenarios: scenarioDefinitions.length, elasticsearchConfigured: Boolean(process.env.ELASTICSEARCH_URL) }));
  app.get('/api/stats', (_request, response) => {
    const summaries = scenarioDefinitions.map(({ id }) => toSummary(id, store));
    response.json({ total: summaries.length, open: summaries.filter((item) => !item.status.startsWith('Closed')).length, critical: summaries.filter((item) => item.severity === 'critical').length, completed: summaries.filter((item) => item.progress === 100).length });
  });
  app.get('/api/scenarios', (request, response) => {
    let result = scenarioDefinitions.map(({ id }) => toSummary(id, store));
    const severity = String(request.query.severity ?? 'all');
    const search = String(request.query.search ?? '').toLowerCase();
    if (severity !== 'all') result = result.filter((item) => item.severity === severity);
    if (search) result = result.filter((item) => `${item.title} ${item.host} ${item.user} ${item.category}`.toLowerCase().includes(search));
    response.json(result);
  });
  app.get('/api/scenarios/:id', (request, response) => {
    const definition = scenarioById.get(request.params.id);
    if (!definition) return response.status(404).json({ error: 'Scenario not found' });
    const state = store.get(definition.id);
    const detail: ScenarioDetail = {
      ...toSummary(definition.id, store), briefing: definition.briefing, alerts: definition.alerts,
      businessContext: definition.businessContext,
      users: definition.users, hosts: definition.hosts, events: generateScenarioEvents(definition),
      questions: definition.questions, visibleIocs: [], mitre: [], notes: state.notes,
    };
    response.json(detail);
  });
  app.get('/api/scenarios/:id/events', (request, response) => {
    const definition = scenarioById.get(request.params.id);
    if (!definition) return response.status(404).json({ error: 'Scenario not found' });
    response.json(filterEvents(generateScenarioEvents(definition), String(request.query.q ?? '')));
  });
  app.patch('/api/scenarios/:id', (request, response) => {
    if (!scenarioById.has(request.params.id)) return response.status(404).json({ error: 'Scenario not found' });
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Invalid update', details: parsed.error.flatten() });
    response.json(store.update(request.params.id, parsed.data));
  });
  app.post('/api/scenarios/:id/submit', (request, response) => {
    const definition = scenarioById.get(request.params.id);
    if (!definition) return response.status(404).json({ error: 'Scenario not found' });
    const parsed = submitSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Invalid submission', details: parsed.error.flatten() });
    const incomplete = definition.questions.some((question) => {
      if (!Object.hasOwn(parsed.data.answers, question.id)) return true;
      const value = parsed.data.answers[question.id];
      return typeof value === 'string' && value.trim().length === 0;
    });
    if (incomplete) return response.status(400).json({ error: 'Complete every investigation question before submission' });
    let earned = 0;
    const feedback = definition.questions.map((question) => {
      const key = definition.answers[question.id];
      const correct = answerMatches(parsed.data.answers[question.id], key.value, key.aliases);
      if (correct) earned += question.points;
      return { questionId: question.id, correct, expected: String(key.value), explanation: key.explanation };
    });
    const total = definition.questions.reduce((sum, question) => sum + question.points, 0);
    const result: GradeResult = {
      score: Math.round(earned / total * 100), earned, total, feedback,
      explanation: definition.explanation, reasoning: definition.reasoning,
      timeline: getAttackEvents(definition),
      iocs: definition.iocs, mitre: definition.mitre, queries: definition.queries, responseActions: definition.responseActions,
      remediationActions: definition.remediationActions,
    };
    store.update(definition.id, { progress: 100 });
    response.json(result);
  });
  app.get('/api/scenarios/:id/export', (request, response) => {
    const definition = scenarioById.get(request.params.id);
    if (!definition) return response.status(404).json({ error: 'Scenario not found' });
    const body = generateScenarioEvents(definition).map((item) => JSON.stringify(item)).join('\n');
    response.type('application/x-ndjson').attachment(`${definition.id}.ndjson`).send(body);
  });
  app.post('/api/elastic/sync', async (_request, response, next) => {
    const endpoint = process.env.ELASTICSEARCH_URL;
    if (!endpoint) return response.status(503).json({ error: 'ELASTICSEARCH_URL is not configured' });
    try {
      const events = scenarioDefinitions.flatMap((definition) => generateScenarioEvents(definition));
      response.json({ indexed: await syncEventsToElastic(events, endpoint), index: 'soc-training-events' });
    } catch (error) { next(error); }
  });

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const clientDir = path.resolve(currentDir, '../../client');
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.use((request, response, next) => request.path.startsWith('/api/') ? next() : response.sendFile(path.join(clientDir, 'index.html')));
  }
  app.use((error: Error, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    void next;
    console.error(error.message);
    response.status(500).json({ error: 'Unexpected server error' });
  });
  return app;
}
