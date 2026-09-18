import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleDot, Command, RadioTower, RefreshCw, Shield } from 'lucide-react';
import type { GradeResult, IncidentStatus, ScenarioDetail, ScenarioSummary } from '../domain/types';
import { api } from './api';
import { AlertQueue } from './components/AlertQueue';
import { IncidentWorkspace } from './components/IncidentWorkspace';

export function App() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<ScenarioDetail | null>(null);
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadList = useCallback(async () => {
    const items = await api.scenarios(); setScenarios(items);
    setSelectedId((current) => current || items[0]?.id || '');
  }, []);
  useEffect(() => { loadList().catch(() => setError('No se pudo conectar con la API del laboratorio.')).finally(() => setLoading(false)); }, [loadList]);
  useEffect(() => { if (selectedId) api.detail(selectedId).then(setDetail).catch(() => setError('No se pudo cargar el incidente.')); }, [selectedId]);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.getElementById('alert-search')?.focus(); }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);
  const update = async (change: { status?: IncidentStatus; notes?: string }) => { if (!selectedId) return; await api.update(selectedId, change); await Promise.all([loadList(), api.detail(selectedId).then(setDetail)]); };
  const submit = async (answers: Record<string, string | boolean>): Promise<GradeResult> => { const result = await api.submit(selectedId, answers); await loadList(); return result; };
  const statusText = useMemo(() => `${scenarios.filter((item) => item.progress === 100).length}/${scenarios.length} casos completados`, [scenarios]);

  return (
    <div className="app-shell">
      <header className="topbar"><div className="brand-mark"><Shield size={20} aria-hidden="true" /><span>WATCHFLOOR</span><small>// 07</small></div><div className="topbar-center"><RadioTower size={15} /><span>Entorno local</span><span className="topbar-separator" /><CircleDot size={13} /><span>{scenarios.length} escenarios activos</span></div><div className="operator"><div><span>Turno de entrenamiento</span><strong>{statusText}</strong></div><kbd><Command size={11} /> K</kbd></div></header>
      {error && <div className="global-error" role="alert">{error}<button onClick={() => location.reload()}><RefreshCw size={14} />Reintentar</button></div>}
      {loading ? <div className="loading-shell" aria-busy="true"><span /><p>Preparando el turno…</p></div> : <div className="operations-grid"><AlertQueue scenarios={scenarios} selectedId={selectedId} onSelect={setSelectedId} query={query} setQuery={setQuery} severity={severity} setSeverity={setSeverity} />{detail ? <IncidentWorkspace scenario={detail} onUpdate={update} onSubmit={submit} /> : <div className="empty-workspace">Selecciona una alerta para comenzar.</div>}</div>}
    </div>
  );
}
