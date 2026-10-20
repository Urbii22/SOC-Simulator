// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { scenarioDefinitions } from '../src/scenarios/definitions.js';
import { generateProceduralScenario } from '../src/procedural/engine.js';

const directories: string[] = [];
function stateFile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soc-recovery-'));
  directories.push(directory);
  return path.join(directory, 'state.json');
}
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe('recoverable scenario evaluations', () => {
  it.each(['canonical', 'procedural'])('recovers the %s review after restart, without unlocking other cases', async (kind) => {
    const file = stateFile();
    const scenario = kind === 'canonical' ? scenarioDefinitions[0] : generateProceduralScenario({ template: 'password-spray', seed: 123, difficulty: 'medium' }).scenario;
    const app = createApp({ stateFile: file });
    const route = `/api/scenarios/${scenario.id}`;
    const before = await request(app).get(route).expect(200);
    expect(before.body).not.toHaveProperty('review');
    await request(app).patch(route).send({ submission: {}, progress: 100 }).expect(400);
    await request(app).post(`${route}/submit`).send({ answers: {} }).expect(400);
    expect((await request(app).get(route)).body).not.toHaveProperty('review');
    const answers = Object.fromEntries(Object.entries(scenario.answers).map(([id, value]) => [id, value.value]));
    // Persist an imperfect attempt as well: recovery must not invent a perfect score.
    answers.anchor = 'incorrect evidence';
    const submitted = await request(app).post(`${route}/submit`).send({ answers }).expect(200);
    expect(submitted.body.score).toBeLessThan(100);
    const restarted = createApp({ stateFile: file });
    const recovered = await request(restarted).get(route).expect(200);
    expect(recovered.body.review).toEqual(submitted.body);
    expect(recovered.body.mitre).toEqual(scenario.mitre);
    expect(recovered.body.visibleIocs).toEqual(scenario.iocs);
    expect(recovered.body).not.toHaveProperty('submission');
    const other = await request(restarted).get('/api/scenarios/webshell').expect(200);
    expect(other.body).not.toHaveProperty('review');
    expect(other.body.mitre).toEqual([]);
  });

  it('keeps legacy completion readable without inventing an evaluation', async () => {
    const file = stateFile();
    fs.writeFileSync(file, JSON.stringify({ 'ssh-brute-force': { status: 'Investigating', progress: 100, notes: 'legacy notes' } }));
    const result = await request(createApp({ stateFile: file })).get('/api/scenarios/ssh-brute-force').expect(200);
    expect(result.body).toMatchObject({ notes: 'legacy notes', progress: 100 });
    expect(result.body).not.toHaveProperty('review');
  });

  it('returns an actionable capacity error and preserves the previous state', async () => {
    const file = stateFile();
    const cases = Object.fromEntries(Array.from({ length: 103 }, (_, i) => [i ? `proc-random-s${i}-medium` : 'ssh-brute-force', { status: 'New', notes: 'x'.repeat(10_000), progress: 0 }]));
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, cases }, null, 2));
    const original = fs.readFileSync(file, 'utf8');
    const app = createApp({ stateFile: file });
    const failed = await request(app).patch('/api/scenarios/ssh-brute-force').send({ notes: '界'.repeat(10_000) }).expect(507);
    expect(failed.body.error).toContain('Reduce las notas');
    expect(fs.readFileSync(file, 'utf8')).toEqual(original);
    const recovered = await request(createApp({ stateFile: file })).get('/api/scenarios/ssh-brute-force').expect(200);
    expect(recovered.body.notes).toBe('x'.repeat(10_000));
  });
});
