import fs from 'node:fs';
import path from 'node:path';
import type { IncidentStatus } from '../domain/types.js';

interface CaseState { status: IncidentStatus; notes: string; progress: number }
type StoredState = Record<string, CaseState>;

export class LabStore {
  private state: StoredState = {};
  constructor(private readonly file?: string) {
    if (file && fs.existsSync(file)) {
      try { this.state = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredState; } catch { this.state = {}; }
    }
  }
  get(id: string): CaseState { return this.state[id] ?? { status: 'New', notes: '', progress: 0 }; }
  update(id: string, patch: Partial<CaseState>): CaseState {
    this.state[id] = { ...this.get(id), ...patch };
    this.persist();
    return this.state[id];
  }
  reset(): void { this.state = {}; this.persist(); }
  private persist(): void {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }
}
