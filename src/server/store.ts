import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { IncidentStatus } from '../domain/types.js';

const statuses = ['New', 'Investigating', 'Escalated', 'Closed - True Positive', 'Closed - False Positive'] as const;
const caseStateSchema = z.object({
  status: z.enum(statuses),
  notes: z.string().max(10_000),
  progress: z.number().int().min(0).max(100),
}).strict();
const storedStateSchema = z.record(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), caseStateSchema);
const stateDocumentSchema = z.object({ schemaVersion: z.literal(1), cases: storedStateSchema }).strict();

interface CaseState { status: IncidentStatus; notes: string; progress: number }
type StoredState = Record<string, CaseState>;

const emptyCase = (): CaseState => ({ status: 'New', notes: '', progress: 0 });

export class LabStore {
  private state: StoredState = {};

  constructor(private readonly file?: string) {
    if (!file) return;
    try {
      if (fs.statSync(file).size > 1_048_576) throw new Error('state file exceeds 1 MiB');
      const contents = fs.readFileSync(file, 'utf8');
      const decoded: unknown = JSON.parse(contents);
      const versioned = stateDocumentSchema.safeParse(decoded);
      if (versioned.success) this.state = versioned.data.cases;
      else this.state = storedStateSchema.parse(decoded);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new Error(`Cannot load lab state from ${file}`, { cause: error });
    }
  }

  get(id: string): CaseState { return { ...(this.state[id] ?? emptyCase()) }; }

  update(id: string, patch: Partial<CaseState>): CaseState {
    const updated = caseStateSchema.parse({ ...this.get(id), ...patch });
    const next = { ...this.state, [id]: updated };
    this.persist(next);
    this.state = next;
    return { ...updated };
  }

  reset(): void {
    this.persist({});
    this.state = {};
  }

  private persist(state: StoredState): void {
    if (!this.file) return;
    const directory = path.dirname(this.file);
    const temporary = path.join(directory, `.${path.basename(this.file)}.${process.pid}.tmp`);
    fs.mkdirSync(directory, { recursive: true });
    try {
      fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, cases: state }, null, 2), 'utf8');
      fs.renameSync(temporary, this.file);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch { /* The temporary file may not have been created. */ }
      throw error;
    }
  }
}
