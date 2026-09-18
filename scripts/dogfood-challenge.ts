// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { generateProceduralScenario } from '../src/procedural/engine.js';
import { scenarioById } from '../src/scenarios/definitions.js';
import type { ScenarioDefinition } from '../src/scenarios/model.js';
import { createApp } from '../src/server/app.js';
import { answerMatches } from '../src/server/scoring.js';
import { sessionDocumentSchema, type IncidentPlan } from '../src/server/session-model.js';

function definitionFor(plan: IncidentPlan): ScenarioDefinition {
  if (plan.source === 'canonical') {
    const definition = scenarioById.get(plan.definitionId!);
    if (!definition) throw new Error(`Missing canonical definition ${plan.definitionId}`);
    return definition;
  }
  return generateProceduralScenario({ template: plan.templateId!, seed: plan.seed, difficulty: plan.difficulty }).scenario;
}

function answersFor(definition: ScenarioDefinition, correct: boolean): Record<string, string | boolean> {
  return Object.fromEntries(definition.questions.map((question) => {
    const expected = definition.answers[question.id];
    if (correct) return [question.id, expected.value];
    if (question.type === 'boolean') return [question.id, !expected.value];
    if (question.type === 'single') return [question.id, question.options!.find((option) => !answerMatches(option, expected.value, expected.aliases)) ?? question.options![0]];
    return [question.id, '__respuesta_deliberadamente_incorrecta__'];
  }));
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soc-challenge-dogfood-'));
const sessionStateFile = path.join(directory, 'sessions.json');
const configurations = [
  { mode: 'quick', difficulty: 'easy', seed: 'session:1101' },
  { mode: 'quick', difficulty: 'medium', seed: 'session:1102' },
  { mode: 'quick', difficulty: 'hard', seed: 'session:1103' },
  { mode: 'training', seed: 'session:2201' },
  { mode: 'training', source: 'canonical', seed: 'session:2202' },
  { mode: 'shift', seed: 'session:3301' },
  { mode: 'custom', count: 2, source: 'procedural', truth: 'true-positive', difficulty: 'mixed', seed: 'session:4401' },
  { mode: 'custom', count: 2, source: 'procedural', truth: 'false-positive', difficulty: 'hard', seed: 'session:4402' },
  { mode: 'custom', count: 1, source: 'canonical', truth: 'mixed', difficulty: 'mixed', seed: 'session:4403' },
] as const;

let app = createApp({ sessionStateFile });
let investigations = 0; let correctAttempts = 0; let wrongAttempts = 0; let hints = 0;
let maxCreateMs = 0; let maxSaveMs = 0;

try {
  for (const [sessionIndex, configuration] of configurations.entries()) {
    const createStarted = performance.now();
    const created = await request(app).post('/api/sessions').send(configuration).expect(201);
    maxCreateMs = Math.max(maxCreateMs, performance.now() - createStarted);
    for (const [incidentIndex, incident] of created.body.incidents.entries()) {
      let opened = await request(app).get(`/api/sessions/${created.body.id}/incidents/${incident.id}`).expect(200);
      opened = await request(app).post(`/api/sessions/${created.body.id}/incidents/${incident.id}/start`).send({ revision: opened.body.session.revision }).expect(200);
      const saveStarted = performance.now();
      opened = await request(app).patch(`/api/sessions/${created.body.id}/incidents/${incident.id}`).send({
        revision: opened.body.session.revision, notes: `dogfood ${sessionIndex}/${incidentIndex}`,
        evidence: ['evento correlacionado'], actions: ['validar alcance'], verdict: incidentIndex % 2 ? 'false-positive' : 'true-positive', severityAssessment: 'medium',
      }).expect(200);
      maxSaveMs = Math.max(maxSaveMs, performance.now() - saveStarted);
      if ((sessionIndex + incidentIndex) % 3 === 0) {
        opened = await request(app).post(`/api/sessions/${created.body.id}/incidents/${incident.id}/hints`).send({ revision: opened.body.session.revision }).expect(200); hints++;
      }
      if (sessionIndex === 3 && incidentIndex === 1) app = createApp({ sessionStateFile });
      const stored = sessionDocumentSchema.parse(JSON.parse(fs.readFileSync(sessionStateFile, 'utf8'))).sessions[created.body.id];
      const shouldBeCorrect = (sessionIndex + incidentIndex) % 2 === 0;
      const definition = definitionFor(stored.incidents[incidentIndex].plan);
      const submitted = await request(app).post(`/api/sessions/${created.body.id}/incidents/${incident.id}/submit`).send({ revision: opened.body.session.revision, answers: answersFor(definition, shouldBeCorrect) }).expect(200);
      if (shouldBeCorrect) {
        if (submitted.body.review.rawScore !== 100) throw new Error(`Expected perfect score, received ${submitted.body.review.rawScore}`);
        correctAttempts++;
      } else {
        if (submitted.body.review.rawScore >= 100) throw new Error('Expected a deliberately imperfect score');
        wrongAttempts++;
      }
      investigations++;
    }
    const latest = await request(app).get(`/api/sessions/${created.body.id}`).expect(200);
    await request(app).post(`/api/sessions/${created.body.id}/finalize`).send({ revision: latest.body.revision }).expect(200);
  }
  const statsStarted = performance.now();
  const stats = await request(app).get('/api/sessions/stats').expect(200);
  const statsMs = performance.now() - statsStarted;
  const history = await request(app).get('/api/sessions/history').expect(200);
  if (stats.body.investigations !== investigations || history.body.length !== configurations.length) throw new Error('Aggregated Challenge metrics do not match completed workflows');
  if (maxCreateMs > 2_000 || maxSaveMs > 2_000 || statsMs > 2_000) throw new Error('Challenge workflow exceeded the 2 second local performance budget');
  console.log(`Challenge dogfood: ${configurations.length} sessions, ${investigations} incidents, ${correctAttempts} perfect, ${wrongAttempts} imperfect, ${hints} hints`);
  console.log(`Performance max: create ${maxCreateMs.toFixed(1)} ms, save ${maxSaveMs.toFixed(1)} ms, stats ${statsMs.toFixed(1)} ms`);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
