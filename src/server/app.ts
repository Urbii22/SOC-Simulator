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
import { gradeScenarioAnswers, validateSubmittedAnswers } from './scoring.js';
import { generateProceduralScenario, ProceduralGenerationError, regenerateProceduralScenario, type GeneratedProceduralScenario } from '../procedural/engine.js';
import { proceduralRequestSchema } from '../procedural/schema.js';
import { listProceduralTemplates, proceduralTemplates } from '../procedural/templates.js';
import type { ScenarioDefinition } from '../scenarios/model.js';

const statuses = ['New', 'Investigating', 'Escalated', 'Closed - True Positive', 'Closed - False Positive'] as const;
const updateSchema = z.object({ status: z.enum(statuses).optional(), notes: z.string().max(10_000).optional() }).strict()
  .refine((value) => value.status || value.notes !== undefined);
const submitSchema = z.object({ answers: z.record(z.string().regex(/^[a-z][a-z0-9_-]*$/), z.union([z.string().max(2_000), z.boolean()])) }).strict();
const listQuerySchema = z.object({ severity: z.enum(['all', 'critical', 'high', 'medium', 'low']).default('all'), search: z.string().max(200).default('') }).strict();
const eventQuerySchema = z.object({ q: z.string().max(2_000).default('') }).strict();
const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

interface ResolvedScenario { definition: ScenarioDefinition; events: SecurityEvent[]; generated?: GeneratedProceduralScenario }

function toSummary(resolved: ResolvedScenario, store: LabStore): ScenarioSummary {
  const { definition, events, generated } = resolved;
  const state = store.get(definition.id);
  return {
    id: definition.id, title: definition.title, difficulty: definition.difficulty, category: definition.category,
    severity: definition.severity, status: state.status, date: getAttackEvents(definition, events)[0].timestamp,
    user: definition.primaryUser, host: definition.primaryHost, alertCount: definition.alerts.length,
    eventCount: events.length, description: definition.description, progress: state.progress,
    ...(generated ? { origin: generated.mode === 'template' ? 'procedural' as const : 'random' as const, variantId: generated.variantId } : {}),
  };
}

function toDetail(resolved: ResolvedScenario, store: LabStore): ScenarioDetail {
  const { definition, events } = resolved;
  const state = store.get(definition.id);
  return {
    ...toSummary(resolved, store), briefing: definition.briefing, alerts: definition.alerts,
    businessContext: definition.businessContext, users: definition.users, hosts: definition.hosts, events,
    questions: definition.questions, visibleIocs: [], mitre: [], notes: state.notes,
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
  const proceduralCache = new Map<string, GeneratedProceduralScenario>();
  const cacheGenerated = (generated: GeneratedProceduralScenario) => {
    proceduralCache.delete(generated.scenarioId);
    proceduralCache.set(generated.scenarioId, generated);
    if (proceduralCache.size > 32) proceduralCache.delete(proceduralCache.keys().next().value!);
  };
  const resolveScenario = (id: string): ResolvedScenario | undefined => {
    const canonical = scenarioById.get(id);
    if (canonical) return { definition: canonical, events: generateScenarioEvents(canonical) };
    let generated = proceduralCache.get(id);
    if (generated) cacheGenerated(generated);
    if (!generated) {
      generated = regenerateProceduralScenario(id);
      if (!generated) return undefined;
      cacheGenerated(generated);
    }
    return { definition: generated.scenario, events: generated.events, generated };
  };
  let elasticSyncInProgress = false;
  app.disable('x-powered-by');
  app.use(cors({ origin(origin, callback) {
    callback(null, origin === undefined || localOrigin.test(origin));
  } }));
  app.use((request, response, next) => {
    const origin = request.headers.origin;
    if (origin && !localOrigin.test(origin) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      return response.status(403).json({ error: 'Origin not allowed' });
    }
    next();
  });
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'");
    next();
  });
  app.use(express.json({ limit: '128kb' }));

  app.get('/api/health', (_request, response) => response.json({ status: 'ok', scenarios: scenarioDefinitions.length, proceduralTemplates: proceduralTemplates.length, elasticsearchConfigured: Boolean(process.env.ELASTICSEARCH_URL) }));
  app.get('/api/stats', (_request, response) => {
    const summaries = scenarioDefinitions.map((definition) => toSummary({ definition, events: generateScenarioEvents(definition) }, store));
    response.json({ total: summaries.length, open: summaries.filter((item) => !item.status.startsWith('Closed')).length, critical: summaries.filter((item) => item.severity === 'critical').length, completed: summaries.filter((item) => item.progress === 100).length });
  });
  app.get('/api/scenarios', (request, response) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return response.status(400).json({ error: 'Invalid query' });
    let result = scenarioDefinitions.map((definition) => toSummary({ definition, events: generateScenarioEvents(definition) }, store));
    const { severity } = query.data;
    const search = query.data.search.toLowerCase();
    if (severity !== 'all') result = result.filter((item) => item.severity === severity);
    if (search) result = result.filter((item) => `${item.title} ${item.host} ${item.user} ${item.category}`.toLowerCase().includes(search));
    response.json(result);
  });
  app.get('/api/procedural/templates', (_request, response) => response.json(listProceduralTemplates()));
  app.post('/api/procedural/generate', (request, response) => {
    const parsed = proceduralRequestSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Invalid procedural generation request', details: parsed.error.flatten() });
    try {
      const generated = generateProceduralScenario(parsed.data);
      cacheGenerated(generated);
      response.status(201).json({ variantId: generated.variantId, hash: generated.hash, scenario: toDetail({ definition: generated.scenario, events: generated.events, generated }, store) });
    } catch (error) {
      if (error instanceof ProceduralGenerationError) return response.status(422).json({ error: error.message });
      throw error;
    }
  });
  app.get('/api/scenarios/:id', (request, response) => {
    const resolved = resolveScenario(request.params.id);
    if (!resolved) return response.status(404).json({ error: 'Scenario not found' });
    response.json(toDetail(resolved, store));
  });
  app.get('/api/scenarios/:id/events', (request, response) => {
    const resolved = resolveScenario(request.params.id);
    if (!resolved) return response.status(404).json({ error: 'Scenario not found' });
    const query = eventQuerySchema.safeParse(request.query);
    if (!query.success) return response.status(400).json({ error: 'Invalid query' });
    response.json(filterEvents(resolved.events, query.data.q));
  });
  app.patch('/api/scenarios/:id', (request, response) => {
    if (!resolveScenario(request.params.id)) return response.status(404).json({ error: 'Scenario not found' });
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Invalid update', details: parsed.error.flatten() });
    response.json(store.update(request.params.id, parsed.data));
  });
  app.post('/api/scenarios/:id/submit', (request, response) => {
    const resolved = resolveScenario(request.params.id);
    if (!resolved) return response.status(404).json({ error: 'Scenario not found' });
    const { definition } = resolved;
    const parsed = submitSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Invalid submission', details: parsed.error.flatten() });
    const submissionError = validateSubmittedAnswers(definition, parsed.data.answers);
    if (submissionError) return response.status(400).json({ error: submissionError });
    const grade = gradeScenarioAnswers(definition, parsed.data.answers);
    const result: GradeResult = {
      ...grade,
      explanation: definition.explanation, reasoning: definition.reasoning,
      timeline: getAttackEvents(definition, resolved.events),
      iocs: definition.iocs, mitre: definition.mitre, queries: definition.queries, responseActions: definition.responseActions,
      remediationActions: definition.remediationActions,
    };
    store.update(definition.id, { progress: 100 });
    response.json(result);
  });
  app.get('/api/scenarios/:id/export', (request, response) => {
    const resolved = resolveScenario(request.params.id);
    if (!resolved) return response.status(404).json({ error: 'Scenario not found' });
    const body = resolved.events.map((item) => JSON.stringify(item)).join('\n');
    response.type('application/x-ndjson').attachment(`${resolved.definition.id}.ndjson`).send(body);
  });
  app.post('/api/elastic/sync', async (_request, response, next) => {
    const endpoint = process.env.ELASTICSEARCH_URL;
    if (!endpoint) return response.status(503).json({ error: 'ELASTICSEARCH_URL is not configured' });
    if (elasticSyncInProgress) return response.status(409).json({ error: 'Elasticsearch sync already in progress' });
    elasticSyncInProgress = true;
    try {
      const events = scenarioDefinitions.flatMap((definition) => generateScenarioEvents(definition));
      response.json({ indexed: await syncEventsToElastic(events, endpoint), index: 'soc-training-events' });
    } catch (error) { next(error); }
    finally { elasticSyncInProgress = false; }
  });

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const clientDir = path.resolve(currentDir, '../../client');
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.use((request, response, next) => request.path.startsWith('/api/') ? next() : response.sendFile(path.join(clientDir, 'index.html')));
  }
  app.use((error: Error & { status?: number; type?: string }, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    void next;
    if (error.status === 400 && error.type === 'entity.parse.failed') return response.status(400).json({ error: 'Invalid JSON body' });
    if (error.status === 413 || error.type === 'entity.too.large') return response.status(413).json({ error: 'Request body too large' });
    console.error(error.message);
    response.status(500).json({ error: 'Unexpected server error' });
  });
  return app;
}
