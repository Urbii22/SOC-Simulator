import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Command, History, RadioTower, RefreshCw, Shield, Target } from 'lucide-react';
import type { GradeResult, IncidentStatus, ProceduralTemplateSummary, ScenarioDetail, ScenarioSummary } from '../domain/types';
import { api } from './api';
import { AlertQueue } from './components/AlertQueue';
import { IncidentWorkspace } from './components/IncidentWorkspace';
import { ChallengeCenter } from './components/ChallengeCenter';

type AppView = 'cases' | 'challenge' | 'history' | 'stats';

export function App() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<ScenarioDetail | null>(null);
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<ProceduralTemplateSummary[]>([]);
  const [appView, setAppView] = useState<AppView>('cases');
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const loadList = useCallback(async () => {
    const items = await api.scenarios();
    setScenarios((current) => [...current.filter(({ origin }) => origin === 'procedural' || origin === 'random'), ...items]); setError('');
    setSelectedId((current) => current || items[0]?.id || '');
  }, []);
  useEffect(() => {
    void api.proceduralTemplates().then(setTemplates).catch(() => setTemplates([]));
    loadList().catch(() => setError('No se pudo conectar con la API del laboratorio.')).finally(() => setLoading(false));
  }, [loadList]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setDetail(null);
    api.detail(selectedId)
      .then((item) => { if (active) { setDetail(item); setError(''); } })
      .catch(() => { if (active) setError('No se pudo cargar el incidente.'); });
    return () => { active = false; };
  }, [selectedId]);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.getElementById('alert-search')?.focus(); }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);
  const update = async (change: { status?: IncidentStatus; notes?: string }) => {
    if (!selectedId) return;
    const id = selectedId;
    try {
      await api.update(id, change);
      const [, fresh] = await Promise.all([loadList(), api.detail(id)]);
      if (selectedIdRef.current === id) setDetail(fresh);
    } catch { setError('No se pudo guardar el estado del incidente.'); }
  };
  const submit = async (answers: Record<string, string | boolean>): Promise<GradeResult> => { const result = await api.submit(selectedId, answers); await loadList(); return result; };
  const generate = async (input: { template?: string; random?: boolean; seed: number; difficulty: 'easy' | 'medium' | 'hard' }) => {
    try {
      const generated = await api.generateScenario(input);
      setScenarios((current) => [generated.scenario, ...current.filter(({ id }) => id !== generated.scenario.id)]);
      setSelectedId(generated.scenario.id); setError('');
    } catch { setError('No se pudo generar una variante válida con esos parámetros.'); }
  };
  const statusText = useMemo(() => `${scenarios.filter((item) => item.progress === 100).length}/${scenarios.length} casos completados`, [scenarios]);

  return (
    <div className="app-shell">
      <header className="topbar"><div className="brand-mark"><Shield size={20} aria-hidden="true" /><span>WATCHFLOOR</span><small>// 07</small></div><nav className="app-nav" aria-label="Áreas del laboratorio"><button className={appView === 'cases' ? 'is-active' : ''} onClick={() => setAppView('cases')}><RadioTower size={14} />Casos</button><button className={appView === 'challenge' ? 'is-active' : ''} onClick={() => setAppView('challenge')}><Target size={14} />Challenge</button><button className={appView === 'history' ? 'is-active' : ''} onClick={() => setAppView('history')}><History size={14} />Historial</button><button className={appView === 'stats' ? 'is-active' : ''} onClick={() => setAppView('stats')}><BarChart3 size={14} />Estadísticas</button></nav><div className="operator"><div><span>Turno de entrenamiento</span><strong>{statusText}</strong></div><kbd><Command size={11} /> K</kbd></div></header>
      {error && <div className="global-error" role="alert">{error}<button onClick={() => location.reload()}><RefreshCw size={14} />Reintentar</button></div>}
      {loading ? <div className="loading-shell" aria-busy="true"><span /><p>Preparando el turno…</p></div> : appView === 'cases' ? <div className="operations-grid"><AlertQueue scenarios={scenarios} selectedId={selectedId} onSelect={setSelectedId} query={query} setQuery={setQuery} severity={severity} setSeverity={setSeverity} templates={templates} onGenerate={generate} />{detail ? <IncidentWorkspace scenario={detail} onUpdate={update} onSubmit={submit} /> : <div className="empty-workspace">Selecciona una alerta para comenzar.</div>}</div> : <ChallengeCenter section={appView} templates={templates} onError={setError} onNavigateChallenge={() => setAppView('challenge')} />}
    </div>
  );
}
