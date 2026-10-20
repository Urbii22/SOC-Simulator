import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Command, History, RadioTower, RefreshCw, Shield, Target, X } from 'lucide-react';
import type { GradeResult, IncidentStatus, ProceduralTemplateSummary, ScenarioDetail, ScenarioSummary } from '../domain/types';
import { api } from './api';
import { AlertQueue } from './components/AlertQueue';
import { IncidentWorkspace, type NotesSaveState } from './components/IncidentWorkspace';
import { ChallengeCenter } from './components/ChallengeCenter';
import { emptyWorkspace, loadWorkspaces, saveWorkspaces, type Answers, type CaseWorkspace, type WorkspaceTab } from './workspace';

type AppView = 'cases' | 'challenge' | 'history' | 'stats';
interface AppError { message: string; retry?: () => void }
const NOTES_AUTOSAVE_MS = 1_200;
const views: readonly (readonly [AppView, string, typeof RadioTower])[] = [['cases', 'Casos', RadioTower], ['challenge', 'Challenge', Target], ['history', 'Historial', History], ['stats', 'Estadísticas', BarChart3]];

export function App() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<ScenarioDetail | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('all');
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<ProceduralTemplateSummary[]>([]);
  const [appView, setAppView] = useState<AppView>('cases');
  const [workspaces, setWorkspaces] = useState<Record<string, CaseWorkspace>>(loadWorkspaces);
  const [notesState, setNotesState] = useState<Record<string, NotesSaveState>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const pendingSubmissions = useRef(new Set<string>());
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  // Scroll offsets change too often to live in React state; they are merged in when persisting.
  const scrollRef = useRef<Record<string, CaseWorkspace['scroll']>>(Object.fromEntries(Object.entries(workspaces).map(([id, item]) => [id, item.scroll])));
  const persistTimer = useRef<number | undefined>(undefined);
  const notesTimers = useRef(new Map<string, number>());

  const persist = useCallback(() => {
    window.clearTimeout(persistTimer.current);
    const ids = new Set([...Object.keys(workspacesRef.current), ...Object.keys(scrollRef.current)]);
    saveWorkspaces(Object.fromEntries([...ids].map((id) => [id, { ...(workspacesRef.current[id] ?? emptyWorkspace()), scroll: scrollRef.current[id] ?? {} }])));
  }, []);
  useEffect(() => { persist(); }, [workspaces, persist]);
  useEffect(() => {
    window.addEventListener('pagehide', persist);
    return () => window.removeEventListener('pagehide', persist);
  }, [persist]);

  const updateWorkspace = useCallback((id: string, patch: Partial<CaseWorkspace>) => {
    setWorkspaces((current) => ({ ...current, [id]: { ...(current[id] ?? emptyWorkspace()), ...patch } }));
  }, []);
  const recordScroll = useCallback((id: string, tab: WorkspaceTab, offset: number) => {
    scrollRef.current = { ...scrollRef.current, [id]: { ...scrollRef.current[id], [tab]: Math.round(offset) } };
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(persist, 400);
  }, [persist]);

  const saveNotes = useCallback(async (id: string) => {
    window.clearTimeout(notesTimers.current.get(id));
    notesTimers.current.delete(id);
    const notes = workspacesRef.current[id]?.notes;
    if (notes === undefined) return;
    setNotesState((current) => ({ ...current, [id]: { status: 'saving' } }));
    try {
      await api.update(id, { notes });
      setDetail((current) => current?.id === id ? { ...current, notes } : current);
      const unchanged = workspacesRef.current[id]?.notes === notes;
      if (unchanged) setWorkspaces((current) => {
        if (current[id]?.notes !== notes) return current;
        const rest = { ...current[id] };
        delete rest.notes;
        return { ...current, [id]: rest };
      });
      setNotesState((current) => ({ ...current, [id]: { status: unchanged ? 'saved' : 'pending' } }));
    } catch (failure) {
      setNotesState((current) => ({ ...current, [id]: { status: 'error', message: failure instanceof Error ? failure.message : 'No se pudieron guardar las notas.' } }));
    }
  }, []);
  const scheduleNotesSave = useCallback((id: string, delay = NOTES_AUTOSAVE_MS) => {
    window.clearTimeout(notesTimers.current.get(id));
    notesTimers.current.set(id, window.setTimeout(() => { void saveNotes(id); }, delay));
  }, [saveNotes]);
  const changeNotes = (id: string, notes: string) => {
    updateWorkspace(id, { notes });
    setNotesState((current) => ({ ...current, [id]: { status: 'pending' } }));
    scheduleNotesSave(id);
  };
  useEffect(() => {
    // Drafts restored from a previous visit are resent once the app starts.
    const restored = Object.entries(workspacesRef.current).filter(([, item]) => item.notes !== undefined).map(([id]) => id);
    setNotesState((current) => ({ ...current, ...Object.fromEntries(restored.map((id) => [id, { status: 'pending' as const }])) }));
    for (const id of restored) scheduleNotesSave(id, 0);
    const timers = notesTimers.current;
    return () => { for (const timer of timers.values()) window.clearTimeout(timer); };
  }, [scheduleNotesSave]);

  const loadList = useCallback(async () => {
    const items = await api.scenarios();
    setScenarios((current) => [...current.filter(({ origin }) => origin === 'procedural' || origin === 'random'), ...items]);
    setSelectedId((current) => current || items[0]?.id || '');
  }, []);
  const loadInitial = useCallback(() => {
    setLoading(true);
    void api.proceduralTemplates().then(setTemplates).catch(() => setTemplates([]));
    loadList().then(() => setError(null))
      .catch(() => setError({ message: 'No se pudo conectar con la API del laboratorio.', retry: loadInitial }))
      .finally(() => setLoading(false));
  }, [loadList]);
  useEffect(() => { loadInitial(); }, [loadInitial]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setDetail(null); setDetailFailed(false);
    api.detail(selectedId)
      .then((item) => { if (active) setDetail(item); })
      .catch(() => { if (active) setDetailFailed(true); });
    return () => { active = false; };
  }, [selectedId, detailAttempt]);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setAppView('cases'); document.getElementById('alert-search')?.focus(); }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);
  const updateStatus = async (status: IncidentStatus) => {
    if (!selectedId) return;
    const id = selectedId;
    try {
      await api.update(id, { status });
      const [, fresh] = await Promise.all([loadList(), api.detail(id)]);
      if (selectedIdRef.current === id) setDetail(fresh);
      setError(null);
    } catch (failure) {
      setError({ message: failure instanceof Error ? failure.message : 'No se pudo guardar el estado del incidente.', retry: () => { void updateStatus(status); } });
    }
  };
  const submit = async (answers: Answers): Promise<GradeResult> => {
    const id = selectedId;
    if (pendingSubmissions.current.has(id)) throw new Error('La investigación ya se está evaluando.');
    pendingSubmissions.current.add(id);
    setSubmitting((current) => ({ ...current, [id]: true }));
    try {
      const result = await api.submit(id, answers);
      setDetail((current) => current?.id === id ? { ...current, progress: 100, review: result, mitre: result.mitre, visibleIocs: result.iocs } : current);
      setScenarios((current) => current.map((item) => item.id === id ? { ...item, progress: 100 } : item));
      updateWorkspace(id, { answers: {} });
      return result;
    } finally {
      pendingSubmissions.current.delete(id);
      setSubmitting((current) => ({ ...current, [id]: false }));
    }
  };
  const generate = async (input: { template?: string; random?: boolean; seed: number; difficulty: 'easy' | 'medium' | 'hard' }) => {
    try {
      const generated = await api.generateScenario(input);
      setScenarios((current) => [generated.scenario, ...current.filter(({ id }) => id !== generated.scenario.id)]);
      setSelectedId(generated.scenario.id); setError(null); setAppView('cases');
    } catch { setError({ message: 'No se pudo generar una variante válida con esos parámetros.', retry: () => { void generate(input); } }); }
  };
  const challengeError = useCallback((message: string) => setError(message ? { message } : null), []);
  const statusText = useMemo(() => `${scenarios.filter((item) => item.progress === 100).length}/${scenarios.length} casos completados`, [scenarios]);
  const workspace = detail ? workspaces[detail.id] ?? emptyWorkspace() : undefined;

  return (
    <div className="app-shell">
      <header className="topbar"><div className="brand-mark"><Shield size={20} aria-hidden="true" /><div className="brand-copy"><span>watchfloor</span><small>Security operations lab</small></div></div><nav className="app-nav" aria-label="Áreas del laboratorio">{views.map(([id, label, Icon]) => <button key={id} aria-current={appView === id ? 'page' : undefined} className={appView === id ? 'is-active' : ''} onClick={() => setAppView(id)}><Icon size={14} />{label}</button>)}</nav><div className="operator"><span className="operator-avatar">SOC</span><div><span>Turno de entrenamiento</span><strong>{statusText}</strong></div><kbd title="Buscar casos"><Command size={11} /> K</kbd></div></header>
      {error && <div className="global-error" role="alert">{error.message}{error.retry && <button onClick={() => { const { retry } = error; setError(null); retry?.(); }}><RefreshCw size={14} />Reintentar</button>}<button aria-label="Cerrar aviso" onClick={() => setError(null)}><X size={14} /></button></div>}
      {loading ? <div className="loading-shell" aria-busy="true"><span /><p>Preparando el turno…</p></div> : <div className="operations-grid"><AlertQueue scenarios={scenarios} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setAppView('cases'); }} query={query} setQuery={setQuery} severity={severity} setSeverity={setSeverity} templates={templates} onGenerate={generate} /><div className="main-surface">{appView === 'cases' ? detail && workspace ? <IncidentWorkspace submitting={submitting[detail.id] ?? false} key={detail.id} scenario={detail} workspace={workspace} notesState={notesState[detail.id] ?? { status: 'saved' }} onStatusChange={updateStatus} onSubmit={submit} onWorkspaceChange={(patch) => updateWorkspace(detail.id, patch)} onNotesChange={(notes) => changeNotes(detail.id, notes)} onSaveNotes={() => { void saveNotes(detail.id); }} onScroll={(tab, offset) => recordScroll(detail.id, tab, offset)} initialScroll={scrollRef.current[detail.id] ?? {}} /> : detailFailed ? <div className="empty-workspace" role="alert">No se pudo cargar el incidente.<button className="secondary-action" onClick={() => setDetailAttempt((value) => value + 1)}><RefreshCw size={14} />Reintentar</button></div> : <div className="empty-workspace">{selectedId ? 'Cargando incidente…' : 'Selecciona una alerta para comenzar.'}</div> : null}<div className="view-surface" hidden={appView === 'cases'}><ChallengeCenter section={appView === 'cases' ? 'challenge' : appView} templates={templates} onError={challengeError} onNavigateChallenge={() => setAppView('challenge')} /></div></div></div>}
    </div>
  );
}
