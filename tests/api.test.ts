// @vitest-environment node
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { scenarioDefinitions } from '../src/scenarios/definitions.js';
import { generateProceduralScenario } from '../src/procedural/engine.js';

const app = createApp();

describe('training API', () => {
  it('reports health and lists summaries without solution data', async () => {
    const health = await request(app).get('/api/health').expect(200);
    expect(health.body).toMatchObject({ status: 'ok', scenarios: 30 });
    expect(health.headers['content-security-policy']).toContain("default-src 'self'");
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    const result = await request(app).get('/api/scenarios').expect(200);
    expect(result.body).toHaveLength(30);
    expect(result.body[0]).not.toHaveProperty('answers');
    expect(result.body[0]).not.toHaveProperty('iocs');
  });

  it('returns evidence and questions while keeping the answer key server-side', async () => {
    const result = await request(app).get('/api/scenarios/ssh-brute-force').expect(200);
    expect(result.body.events.length).toBeGreaterThan(40);
    expect(result.body.questions).toHaveLength(6);
    expect(result.body.mitre).toEqual([]);
    expect(result.body).not.toHaveProperty('answers');
    expect(JSON.stringify(result.body)).not.toContain('La correlación confirma');
    expect(JSON.stringify(result.body.events)).not.toContain('training-evidence');
  });

  it('keeps every scenario solution private until submission', async () => {
    const catalog = await request(app).get('/api/scenarios').expect(200);
    for (const summary of catalog.body) {
      const result = await request(app).get(`/api/scenarios/${summary.id}`).expect(200);
      expect(result.body).not.toHaveProperty('answers');
      expect(result.body).not.toHaveProperty('expectedVerdict');
      expect(result.body).not.toHaveProperty('explanation');
      expect(result.body).not.toHaveProperty('queries');
      expect(result.body.mitre).toEqual([]);
      expect(result.body.visibleIocs).toEqual([]);
      expect(JSON.stringify(result.body.events)).not.toContain('private-relevant');
    }
  });

  it('updates workflow state and analyst notes', async () => {
    const update = await request(app).patch('/api/scenarios/ssh-brute-force').send({ status: 'Investigating', notes: 'Pivotar por IP de origen.' }).expect(200);
    expect(update.body).toMatchObject({ status: 'Investigating', notes: 'Pivotar por IP de origen.' });
    const detail = await request(app).get('/api/scenarios/ssh-brute-force').expect(200);
    expect(detail.body.notes).toBe('Pivotar por IP de origen.');
  });

  it('grades correct answers and unlocks the explained solution', async () => {
    const result = await request(app).post('/api/scenarios/ssh-brute-force/submit').send({ answers: {
      anchor: 'sshd-01', terminal: 'execve', source: '185.220.101.34', technique: 'T1110.001', verdict: true, containment: 'Aislar bastion-01 de la red',
    } }).expect(200);
    expect(result.body.score).toBe(100);
    expect(result.body.timeline.length).toBeGreaterThanOrEqual(4);
    expect(result.body.iocs).toContainEqual(expect.objectContaining({ value: '185.220.101.34' }));
    expect(result.body.queries.kql).not.toHaveLength(0);
    expect(result.body.queries.spl).not.toHaveLength(0);
    expect(result.body.queries.sigma).toContain('condition: selection');
  });

  it('scores every complete scenario answer key and returns its demonstrable timeline', async () => {
    for (const scenario of scenarioDefinitions) {
      const answers = Object.fromEntries(scenario.questions.map((question) => [question.id, scenario.answers[question.id].value]));
      const result = await request(app).post(`/api/scenarios/${scenario.id}/submit`).send({ answers }).expect(200);
      expect(result.body.score, scenario.id).toBe(100);
      expect(result.body.timeline, scenario.id).toHaveLength(scenario.attackEvents.length);
      expect(result.body.responseActions.length, scenario.id).toBeGreaterThan(0);
      expect(result.body.remediationActions.length, scenario.id).toBeGreaterThan(0);
    }
  });

  it('does not unlock a solution for an incomplete investigation', async () => {
    const result = await request(app).post('/api/scenarios/mixed-alert-incident/submit').send({ answers: {} }).expect(400);
    expect(result.body).toEqual({ error: 'Complete every investigation question before submission' });
    expect(result.body).not.toHaveProperty('explanation');
    expect(result.body).not.toHaveProperty('timeline');
  });

  it('rejects answer type confusion, invalid choices and unknown question ids', async () => {
    const answers = {
      anchor: 'sshd-01', terminal: 'execve', source: '185.220.101.34',
      technique: 'T1110.001', verdict: true, containment: 'Aislar bastion-01 de la red',
    };
    await request(app).post('/api/scenarios/ssh-brute-force/submit')
      .send({ answers: { ...answers, verdict: 'true' } }).expect(400);
    await request(app).post('/api/scenarios/ssh-brute-force/submit')
      .send({ answers: { ...answers, technique: 'prefixT1110.001suffix' } }).expect(400);
    await request(app).post('/api/scenarios/ssh-brute-force/submit')
      .send({ answers: { ...answers, ghost: 'ignored' } }).expect(400);
  });

  it('maps malformed and oversized JSON to controlled client errors', async () => {
    const malformed = await request(app).post('/api/scenarios/ssh-brute-force/submit')
      .set('Content-Type', 'application/json').send('{bad').expect(400);
    expect(malformed.body).toEqual({ error: 'Invalid JSON body' });
    const oversized = await request(app).post('/api/scenarios/ssh-brute-force/submit')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ answers: { anchor: 'x'.repeat(140_000) } })).expect(413);
    expect(oversized.body).toEqual({ error: 'Request body too large' });
  });

  it('rejects state-changing browser requests from non-local origins', async () => {
    await request(createApp()).patch('/api/scenarios/ssh-brute-force')
      .set('Origin', 'https://untrusted.example')
      .send({ notes: 'cross-site write' }).expect(403, { error: 'Origin not allowed' });
  });

  it('keeps scores within integer bounds for adversarial complete submissions', async () => {
    const questionIds = scenarioDefinitions[0].questions.map(({ id }) => id);
    for (let run = 0; run < 25; run++) {
      const answers: Record<string, string | boolean> = Object.fromEntries(questionIds.map((id, index) => [id, `${run}-${index}-\u200b`]));
      answers.verdict = run % 2 === 0;
      answers.technique = ['T1110.001', 'T1055', 'T1047', 'T1087'][run % 4];
      const result = await request(app).post('/api/scenarios/ssh-brute-force/submit').send({ answers }).expect(200);
      expect(Number.isInteger(result.body.score)).toBe(true);
      expect(result.body.score).toBeGreaterThanOrEqual(0);
      expect(result.body.score).toBeLessThanOrEqual(100);
    }
  });

  it('rejects invalid states and unknown scenarios', async () => {
    await request(app).patch('/api/scenarios/ssh-brute-force').send({ status: 'Deleted' }).expect(400);
    await request(app).get('/api/scenarios/not-real').expect(404);
  });

  it('rejects malformed and unbounded query parameters', async () => {
    await request(app).get('/api/scenarios').query({ severity: 'urgent' }).expect(400, { error: 'Invalid query' });
    await request(app).get('/api/scenarios').query({ search: 'x'.repeat(201) }).expect(400, { error: 'Invalid query' });
    await request(app).get('/api/scenarios/ssh-brute-force/events?q=one&q=two').expect(400, { error: 'Invalid query' });
  });

  it('only grants browser CORS access to local origins', async () => {
    const local = await request(app).get('/api/health').set('Origin', 'http://localhost:5173').expect(200);
    expect(local.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const remote = await request(app).get('/api/health').set('Origin', 'https://untrusted.example').expect(200);
    expect(remote.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('lists procedural templates and generates a reproducible student-safe variant', async () => {
    const templates = await request(app).get('/api/procedural/templates').expect(200);
    expect(templates.body).toHaveLength(9);
    expect(templates.body[0]).not.toHaveProperty('investigation');
    const generated = await request(app).post('/api/procedural/generate').send({ template: 'password-spray', seed: 92817, difficulty: 'medium' }).expect(201);
    expect(generated.body).toMatchObject({ variantId: 'password-spray:92817:medium', scenario: { origin: 'procedural', variantId: 'password-spray:92817:medium' } });
    expect(generated.body.scenario).not.toHaveProperty('answers');
    expect(generated.body.scenario.mitre).toEqual([]);
    expect(generated.body.scenario.visibleIocs).toEqual([]);
    const regenerated = await request(app).get(`/api/scenarios/${generated.body.scenario.id}`).expect(200);
    expect(regenerated.body.events).toEqual(generated.body.scenario.events);
  });

  it('keeps random-mode provenance and private truth out of pre-submission responses', async () => {
    const result = await request(app).post('/api/procedural/generate').send({ random: true, seed: 82913, difficulty: 'hard' }).expect(201);
    expect(result.body.variantId).toBe('random:82913:hard');
    expect(result.body).not.toHaveProperty('templateId');
    expect(result.body.scenario).toMatchObject({ title: expect.stringContaining('Investigación sin clasificar'), category: 'Triage no clasificado', origin: 'random' });
    expect(result.body.scenario).not.toHaveProperty('expectedVerdict');
    expect(result.body.scenario).not.toHaveProperty('answers');
    expect(result.body.scenario.id).not.toContain('password-spray');
  });

  it('grades a regenerated procedural scenario with recalculated answers and evidence', async () => {
    const variant = generateProceduralScenario({ template: 'dns-beaconing', seed: 12345, difficulty: 'hard' });
    const answers = Object.fromEntries(variant.scenario.questions.map(({ id }) => [id, variant.scenario.answers[id].value]));
    const result = await request(app).post(`/api/scenarios/${variant.scenarioId}/submit`).send({ answers }).expect(200);
    expect(result.body.score).toBe(100);
    expect(result.body.timeline).toHaveLength(variant.scenario.attackEvents.length);
    expect(result.body.iocs).toEqual(variant.scenario.iocs);
  });

  it('rejects malformed procedural requests and unknown templates', async () => {
    await request(app).post('/api/procedural/generate').send({ seed: 1 }).expect(400);
    await request(app).post('/api/procedural/generate').send({ template: 'password-spray', random: true, seed: 1 }).expect(400);
    await request(app).post('/api/procedural/generate').send({ template: 'password-spray', seed: 4_294_967_296 }).expect(400);
    await request(app).post('/api/procedural/generate').send({ template: 'not-real', seed: 1 }).expect(422);
  });
});
