// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LabStateCapacityError, LabStore } from '../src/server/store.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soc-store-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('LabStore persistence boundary', () => {
  it('rejects a write over the UTF-8 byte limit without changing recoverable state', () => {
    const file = path.join(temporaryDirectory(), 'state.json');
    const cases = Object.fromEntries(Array.from({ length: 103 }, (_, i) => [`proc-random-s${i}-medium`, { status: 'New', notes: 'x'.repeat(10_000), progress: 0 }]));
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, cases }, null, 2));
    const store = new LabStore(file);
    const original = fs.readFileSync(file);
    expect(() => store.update('ssh-brute-force', { notes: '界'.repeat(10_000) })).toThrow(LabStateCapacityError);
    expect(fs.readFileSync(file)).toEqual(original);
    expect(store.get('ssh-brute-force').notes).toBe('');
    expect(new LabStore(file).get('proc-random-s0-medium').notes).toHaveLength(10_000);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['state.json']);
    for (let i = 0; i < 4; i++) store.update(`proc-random-s${i}-medium`, { notes: '' });
    store.update('ssh-brute-force', { notes: '界'.repeat(10_000) });
    expect(new LabStore(file).get('ssh-brute-force').notes).toBe('界'.repeat(10_000));
  });

  it('persists submitted answers without allowing references to mutate stored state', () => {
    const file = path.join(temporaryDirectory(), 'state.json');
    const store = new LabStore(file);
    const submission = { anchor: 'sshd-01', verdict: false };
    const saved = store.update('ssh-brute-force', { progress: 100, submission });
    submission.anchor = 'changed';
    saved.submission!.anchor = 'changed again';
    store.get('ssh-brute-force').submission!.anchor = 'changed through get';
    expect(store.get('ssh-brute-force').submission).toEqual({ anchor: 'sshd-01', verdict: false });
    expect(new LabStore(file).get('ssh-brute-force').submission).toEqual({ anchor: 'sshd-01', verdict: false });
  });

  it.each([
    ['truncated JSON', '{"ssh-brute-force":'],
    ['invalid case state', JSON.stringify({ 'ssh-brute-force': { status: 'Pwned', notes: 42, progress: 999 } })],
  ])('fails startup for %s instead of silently resetting progress', (_label, contents) => {
    const file = path.join(temporaryDirectory(), 'state.json');
    fs.writeFileSync(file, contents);
    expect(() => new LabStore(file)).toThrow(/Cannot load lab state/);
  });

  it('rejects an oversized state file before reading it into memory', () => {
    const file = path.join(temporaryDirectory(), 'state.json');
    fs.writeFileSync(file, 'x'.repeat(1_048_577));
    try {
      new LabStore(file);
      throw new Error('expected the oversized state file to be rejected');
    } catch (error) {
      expect(error).toMatchObject({
        message: expect.stringContaining('Cannot load lab state'),
        cause: expect.objectContaining({ message: 'state file exceeds 1 MiB' }),
      });
    }
  });

  it('loads the legacy state shape and persists a versioned document atomically', () => {
    const file = path.join(temporaryDirectory(), 'state.json');
    fs.writeFileSync(file, JSON.stringify({ 'ssh-brute-force': { status: 'Investigating', notes: 'legacy', progress: 0 } }));
    const store = new LabStore(file);
    expect(store.get('ssh-brute-force')).toMatchObject({ status: 'Investigating', notes: 'legacy', progress: 0 });
    store.update('ssh-brute-force', { progress: 100 });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      cases: { 'ssh-brute-force': { status: 'Investigating', notes: 'legacy', progress: 100 } },
    });
    expect(fs.readdirSync(path.dirname(file)).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('does not mutate in-memory state when persistence fails', () => {
    const directory = temporaryDirectory();
    const blocker = path.join(directory, 'not-a-directory');
    const store = new LabStore(path.join(blocker, 'state.json'));
    // Introduce the failure after loading: Linux rejects ENOTDIR during startup.
    fs.writeFileSync(blocker, 'block');
    expect(() => store.update('ssh-brute-force', { notes: 'must not stick' })).toThrow();
    expect(store.get('ssh-brute-force')).toEqual({ status: 'New', notes: '', progress: 0 });
  });
});
