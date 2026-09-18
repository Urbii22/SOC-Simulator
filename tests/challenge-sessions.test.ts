// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';

type Body = Record<string, any>;

function answersFor(view: Body): Record<string, string | boolean> {
  return Object.fromEntries(view.scenario.questions.map((question: Body) => [question.id,
    question.type === 'boolean' ? false : question.type === 'single' ? question.options[0] : 'evidencia correlacionada',
  ]));
}

async function createAndStart(app: ReturnType<typeof createApp>, body: Body = { mode: 'quick', seed: 'session:829173' }) {
  const created = await request(app).post('/api/sessions').send(body).expect(201);
  const incidentId = created.body.incidents[0].id;
  const opened = await request(app).get(`/api/sessions/${created.body.id}/incidents/${incidentId}`).expect(200);
  const started = await request(app).post(`/api/sessions/${created.body.id}/incidents/${incidentId}/start`).send({ revision: opened.body.session.revision }).expect(200);
  return { created: created.body, view: started.body, incidentId };
}

describe('Challenge Mode sessions', () => {
  it('creates independent attempts with an exactly reproducible plan', async () => {
    const app = createApp();
    const left = await request(app).post('/api/sessions').send({ mode: 'training', seed: 'session:42' }).expect(201);
    const right = await request(app).post('/api/sessions').send({ mode: 'training', seed: 'session:42' }).expect(201);
    expect(left.body.id).not.toBe(right.body.id);
    expect(left.body.planHash).toBe(right.body.planHash);
    expect(left.body.seed).toBe('session:42');
    expect(left.body.incidents).toHaveLength(3);
    expect(left.body.incidents.map((item: Body) => item.difficulty)).toEqual(right.body.incidents.map((item: Body) => item.difficulty));
  });

  it.each([
    ['quick', 1], ['training', 3], ['shift', 5],
  ])('supports %s mode with its expected incident count', async (mode, count) => {
    const response = await request(createApp()).post('/api/sessions').send({ mode, seed: 'session:7' }).expect(201);
    expect(response.body.incidents).toHaveLength(count);
    if (mode === 'shift') expect(response.body.incidents.map((item: Body) => item.difficulty)).toEqual(['easy', 'easy', 'medium', 'hard', 'hard']);
  });

  it('supports constrained custom sessions and rejects contradictions', async () => {
    const app = createApp();
    const valid = await request(app).post('/api/sessions').send({ mode: 'custom', count: 2, source: 'procedural', difficulty: 'hard', truth: 'true-positive', seed: 99 }).expect(201);
    expect(valid.body.incidents).toHaveLength(2);
    expect(valid.body.incidents.every((item: Body) => item.difficulty === 'hard')).toBe(true);
    await request(app).post('/api/sessions').send({ mode: 'custom', count: 2, source: 'canonical', templates: ['powershell-execution'] }).expect(400);
    await request(app).post('/api/sessions').send({ mode: 'quick', count: 9 }).expect(400);
    await request(app).post('/api/sessions').send({ mode: 'custom', count: 0 }).expect(400);
  });

  it('keeps private challenge data out of pre-submission payloads', async () => {
    const { view } = await createAndStart(createApp());
    const serialized = JSON.stringify(view);
    for (const forbidden of ['expectedVerdict', 'templateId', 'definitionId', 'answers', 'answerKey', 'attackEvents', 'reasoning', 'responseActions', 'remediationActions']) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
    expect(view.scenario.category).toBe('Clasificación pendiente');
    expect(view.scenario.mitre).toEqual([]);
    expect(view.scenario.visibleIocs).toEqual([]);
    expect(view.review).toBeUndefined();
    expect(view.scenario.events.every((event: Body) => event.scenarioId === view.incident.id)).toBe(true);
    expect(new Set(view.scenario.events.map((event: Body) => event.id)).size).toBe(view.scenario.events.length);
  });

  it('saves recoverable progress and rejects stale concurrent revisions', async () => {
    const app = createApp();
    const { view, incidentId } = await createAndStart(app);
    const url = `/api/sessions/${view.session.id}/incidents/${incidentId}`;
    const saved = await request(app).patch(url).send({ revision: view.session.revision, notes: 'hipótesis uno', evidence: ['evento 10'], actions: ['aislar host'] }).expect(200);
    expect(saved.body.scenario.notes).toBe('hipótesis uno');
    expect(saved.body.evidence).toEqual(['evento 10']);
    await request(app).patch(url).send({ revision: view.session.revision, notes: 'escritura obsoleta' }).expect(409);
    const recovered = await request(app).get(url).expect(200);
    expect(recovered.body.scenario.notes).toBe('hipótesis uno');
  });

  it('issues progressive hints, applies a transparent bounded penalty, and reveals review only after submission', async () => {
    const app = createApp();
    const started = await createAndStart(app); let { view } = started; const { incidentId } = started;
    const base = `/api/sessions/${view.session.id}/incidents/${incidentId}`;
    for (let index = 0; index < 3; index++) {
      const hint = await request(app).post(`${base}/hints`).send({ revision: view.session.revision }).expect(200);
      view = hint.body;
      expect(view.hints.at(-1).level).toBe(index + 1);
      expect(view.hints.at(-1).penalty).toBe(3);
    }
    await request(app).post(`${base}/hints`).send({ revision: view.session.revision }).expect(409);
    const submitted = await request(app).post(`${base}/submit`).send({ revision: view.session.revision, answers: answersFor(view) }).expect(200);
    expect(submitted.body.review).toBeDefined();
    expect(submitted.body.review.hintPenalty).toBe(9);
    expect(submitted.body.review.adjustedScore).toBe(Math.max(0, submitted.body.review.rawScore - 9));
    expect(submitted.body.review.mitre.length).toBeGreaterThan(0);
    expect(submitted.body.review.timeline.length).toBeGreaterThan(0);
  });

  it('rejects score, timestamp, unknown answer and incomplete submission manipulation', async () => {
    const app = createApp();
    const { view, incidentId } = await createAndStart(app);
    const base = `/api/sessions/${view.session.id}/incidents/${incidentId}`;
    await request(app).patch(base).send({ revision: view.session.revision, score: 100 }).expect(400);
    await request(app).patch(base).send({ revision: view.session.revision, submittedAt: '2020-01-01T00:00:00.000Z' }).expect(400);
    await request(app).post(`${base}/submit`).send({ revision: view.session.revision, answers: {} }).expect(400);
    await request(app).patch(base).send({ revision: view.session.revision, answers: { invented: 'x' } }).expect(400);
    await request(app).post('/api/sessions').send({ mode: 'quick', seed: 'session:99999999999' }).expect(400);
    await request(app).get('/api/sessions/cs-not-valid').expect(400);
  });

  it('finalizes complete sessions and includes them in history and objective stats', async () => {
    const app = createApp();
    const started = await createAndStart(app); let { view } = started; const { incidentId } = started;
    await request(app).post(`/api/sessions/${view.session.id}/finalize`).send({ revision: view.session.revision }).expect(409);
    const submitted = await request(app).post(`/api/sessions/${view.session.id}/incidents/${incidentId}/submit`).send({ revision: view.session.revision, answers: answersFor(view) }).expect(200);
    view = submitted.body;
    const completed = await request(app).post(`/api/sessions/${view.session.id}/finalize`).send({ revision: view.session.revision }).expect(200);
    expect(completed.body.status).toBe('completed');
    expect(completed.body.summary.completed).toBe(1);
    const history = await request(app).get('/api/sessions/history').expect(200);
    expect(history.body.some((item: Body) => item.id === view.session.id && item.status === 'completed')).toBe(true);
    const stats = await request(app).get('/api/sessions/stats').expect(200);
    expect(stats.body.investigations).toBe(1);
    expect(stats.body.sessions).toBe(1);
    expect(stats.body.recommendations.length).toBeGreaterThan(0);
  });

  it('recovers an interrupted session after a server restart', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soc-challenge-'));
    const file = path.join(directory, 'sessions.json');
    try {
      const firstApp = createApp({ sessionStateFile: file });
      const { view, incidentId } = await createAndStart(firstApp, { mode: 'quick', seed: 'session:5150' });
      await request(firstApp).patch(`/api/sessions/${view.session.id}/incidents/${incidentId}`).send({ revision: view.session.revision, notes: 'persistir entre reinicios' }).expect(200);
      const restarted = createApp({ sessionStateFile: file });
      const restored = await request(restarted).get(`/api/sessions/${view.session.id}/incidents/${incidentId}`).expect(200);
      expect(restored.body.scenario.notes).toBe('persistir entre reinicios');
      expect(restored.body.session.seed).toBe('session:5150');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  it('fails explicitly on corrupted persisted session state', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soc-challenge-corrupt-'));
    const file = path.join(directory, 'sessions.json');
    try {
      fs.writeFileSync(file, '{ definitely not json', 'utf8');
      expect(() => createApp({ sessionStateFile: file })).toThrow(/Cannot load challenge sessions/);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  it('creates non-overwriting repeat attempts', async () => {
    const app = createApp();
    const created = await request(app).post('/api/sessions').send({ mode: 'training', seed: 'session:1234' }).expect(201);
    const exact = await request(app).post(`/api/sessions/${created.body.id}/repeat`).send({ strategy: 'exact' }).expect(201);
    const equivalent = await request(app).post(`/api/sessions/${created.body.id}/repeat`).send({ strategy: 'equivalent' }).expect(201);
    expect(exact.body.id).not.toBe(created.body.id);
    expect(exact.body.planHash).toBe(created.body.planHash);
    expect(equivalent.body.id).not.toBe(created.body.id);
    expect(equivalent.body.seed).not.toBe(created.body.seed);
  });
});
