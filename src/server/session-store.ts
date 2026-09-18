import fs from 'node:fs';
import path from 'node:path';
import { sessionDocumentSchema, storedSessionSchema, type StoredSession } from './session-model.js';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SESSIONS = 1_000;

export class SessionConflictError extends Error {}
export class SessionNotFoundError extends Error {}

function clone<T>(value: T): T { return structuredClone(value); }

export class SessionStore {
  private sessions: Record<string, StoredSession> = {};

  constructor(private readonly file?: string) {
    if (!file) return;
    try {
      if (fs.statSync(file).size > MAX_BYTES) throw new Error('session state file exceeds 20 MiB');
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.sessions = sessionDocumentSchema.parse(parsed).sessions;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new Error(`Cannot load challenge sessions from ${file}`, { cause: error });
    }
  }

  list(): StoredSession[] { return Object.values(this.sessions).map(clone); }

  get(id: string): StoredSession {
    const session = this.sessions[id];
    if (!session) throw new SessionNotFoundError('Challenge session not found');
    return clone(session);
  }

  create(session: StoredSession): StoredSession {
    const parsed = storedSessionSchema.parse(session);
    if (this.sessions[parsed.id]) throw new SessionConflictError('Challenge session id already exists');
    if (Object.keys(this.sessions).length >= MAX_SESSIONS) throw new Error('Challenge session limit reached');
    const next = { ...this.sessions, [parsed.id]: parsed };
    this.persist(next); this.sessions = next;
    return clone(parsed);
  }

  mutate(id: string, expectedRevision: number, mutation: (draft: StoredSession) => void): StoredSession {
    const current = this.sessions[id];
    if (!current) throw new SessionNotFoundError('Challenge session not found');
    if (current.revision !== expectedRevision) throw new SessionConflictError(`Stale session revision; current revision is ${current.revision}`);
    const draft = clone(current);
    mutation(draft);
    draft.revision += 1;
    const parsed = storedSessionSchema.parse(draft);
    const next = { ...this.sessions, [id]: parsed };
    this.persist(next); this.sessions = next;
    return clone(parsed);
  }

  private persist(sessions: Record<string, StoredSession>): void {
    if (!this.file) return;
    const contents = JSON.stringify({ schemaVersion: 1, sessions }, null, 2);
    if (Buffer.byteLength(contents) > MAX_BYTES) throw new Error('Challenge session state would exceed 20 MiB');
    const directory = path.dirname(this.file);
    const temporary = path.join(directory, `.${path.basename(this.file)}.${process.pid}.tmp`);
    fs.mkdirSync(directory, { recursive: true });
    try {
      fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch { /* no temporary file to clean */ }
      throw error;
    }
  }
}
