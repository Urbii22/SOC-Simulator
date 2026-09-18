// @vitest-environment node
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { scenarioDefinitions } from '../src/scenarios/definitions.js';

const app = createApp();

describe('training API', () => {
  it('reports health and lists summaries without solution data', async () => {
    const health = await request(app).get('/api/health').expect(200);
    expect(health.body).toMatchObject({ status: 'ok', scenarios: 30 });
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
      host: 'bastion-01', user: 'deploy', source: '185.220.101.34', technique: 'T1110.001', verdict: true, containment: 'Aislar bastion-01 de la red',
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

  it('rejects invalid states and unknown scenarios', async () => {
    await request(app).patch('/api/scenarios/ssh-brute-force').send({ status: 'Deleted' }).expect(400);
    await request(app).get('/api/scenarios/not-real').expect(404);
  });

  it('only grants browser CORS access to local origins', async () => {
    const local = await request(app).get('/api/health').set('Origin', 'http://localhost:5173').expect(200);
    expect(local.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const remote = await request(app).get('/api/health').set('Origin', 'https://untrusted.example').expect(200);
    expect(remote.headers['access-control-allow-origin']).toBeUndefined();
  });
});
