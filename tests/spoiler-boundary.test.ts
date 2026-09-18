// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { scenarioDefinitions } from '../src/scenarios/definitions.js';
import { createApp } from '../src/server/app.js';

const app = createApp();
const forbiddenKeys = new Set(['answers', 'expectedVerdict', 'explanation', 'reasoning', 'queries', 'responseActions', 'remediationActions', 'iocs', 'metadata', 'attackEvents']);
const allowedEventDetailCollisions = new Set(['queries']);

function findForbidden(value: unknown, trail = 'root'): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => findForbidden(item, `${trail}.${index}`));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    ...(forbiddenKeys.has(key) && !(trail.includes('.details') && allowedEventDetailCollisions.has(key)) ? [`${trail}.${key}`] : []),
    ...findForbidden(child, `${trail}.${key}`),
  ]);
}

describe('solution boundary', () => {
  it('exposes no private solution field through pre-submission JSON endpoints', async () => {
    const list = await request(app).get('/api/scenarios').expect(200);
    expect(findForbidden(list.body)).toEqual([]);
    for (const scenario of scenarioDefinitions) {
      const detail = await request(app).get(`/api/scenarios/${scenario.id}`).expect(200);
      const events = await request(app).get(`/api/scenarios/${scenario.id}/events`).expect(200);
      expect(findForbidden(detail.body), scenario.id).toEqual([]);
      expect(findForbidden(events.body), scenario.id).toEqual([]);
      expect(detail.body.mitre, scenario.id).toEqual([]);
      expect(detail.body.visibleIocs, scenario.id).toEqual([]);
      expect(JSON.stringify(detail.body), scenario.id).not.toContain(scenario.explanation);
      expect(JSON.stringify(detail.body.events), scenario.id).not.toMatch(/private-relevant|training-evidence|"attack"|"benign"/);
    }
  });

  it('exports evidence only and keeps internal labels out of NDJSON', async () => {
    const response = await request(app).get('/api/scenarios/mixed-alert-incident/export').expect(200);
    const body = response.text ?? (Buffer.isBuffer(response.body) ? response.body.toString('utf8') : String(response.body));
    const events = body.trim().split('\n').map((line) => JSON.parse(line));
    expect(events).toHaveLength(229);
    expect(findForbidden(events)).toEqual([]);
    expect(body).not.toMatch(/private-relevant|training-evidence/);
  });

  it('does not bundle server scenario definitions into client source imports', () => {
    const root = path.resolve('src/client');
    const files = fs.readdirSync(root, { recursive: true }).filter((entry) => /\.(ts|tsx)$/.test(String(entry)));
    for (const entry of files) {
      const contents = fs.readFileSync(path.join(root, String(entry)), 'utf8');
      expect(contents, String(entry)).not.toMatch(/from\s+['"][^'"]*(?:scenarios|server)[^'"]*['"]/);
    }
  });

  it('returns generic errors without scenario internals', async () => {
    const missing = await request(app).get('/api/scenarios/not-real').expect(404);
    expect(missing.body).toEqual({ error: 'Scenario not found' });
    const incomplete = await request(app).post('/api/scenarios/mixed-alert-incident/submit').send({ answers: {} }).expect(400);
    expect(findForbidden(incomplete.body)).toEqual([]);
    expect(incomplete.body).not.toHaveProperty('timeline');
  });
});
