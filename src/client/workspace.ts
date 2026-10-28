export type WorkspaceTab = 'overview' | 'evidence' | 'investigation';
export type Answers = Record<string, string | boolean>;

/** Per-case working state kept across navigation and reloads (browser-local only). */
export interface CaseWorkspace {
  tab: WorkspaceTab;
  evidenceQuery: string;
  answers: Answers;
  /** Unsaved notes draft; undefined when the server copy is current. */
  notes?: string;
  scroll: Partial<Record<WorkspaceTab, number>>;
}

const STORAGE_KEY = 'watchfloor.workspace.v1';
const tabs: readonly WorkspaceTab[] = ['overview', 'evidence', 'investigation'];

export const emptyWorkspace = (): CaseWorkspace => ({ tab: 'overview', evidenceQuery: '', answers: {}, scroll: {} });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function parseWorkspace(value: unknown): CaseWorkspace | undefined {
  if (!isRecord(value)) return undefined;
  const workspace = emptyWorkspace();
  if (tabs.includes(value.tab as WorkspaceTab)) workspace.tab = value.tab as WorkspaceTab;
  if (typeof value.evidenceQuery === 'string') workspace.evidenceQuery = value.evidenceQuery.slice(0, 4000);
  if (typeof value.notes === 'string') workspace.notes = value.notes.slice(0, 10_000);
  if (isRecord(value.answers)) {
    for (const [id, answer] of Object.entries(value.answers)) if (typeof answer === 'string' || typeof answer === 'boolean') workspace.answers[id] = answer;
  }
  if (isRecord(value.scroll)) {
    for (const tab of tabs) if (typeof value.scroll[tab] === 'number' && Number.isFinite(value.scroll[tab])) workspace.scroll[tab] = value.scroll[tab];
  }
  return workspace;
}

export function loadWorkspaces(): Record<string, CaseWorkspace> {
  try {
    const decoded: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!isRecord(decoded)) return {};
    const result: Record<string, CaseWorkspace> = {};
    for (const [id, value] of Object.entries(decoded)) {
      const workspace = parseWorkspace(value);
      if (workspace) result[id] = workspace;
    }
    return result;
  } catch { return {}; }
}

export function saveWorkspaces(workspaces: Record<string, CaseWorkspace>): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces)); } catch { /* Storage may be unavailable or full; state stays in memory. */ }
}
