import { useLayoutEffect, useRef, useState } from 'react';
import { Activity, BookOpen, Check, ChevronRight, CircleAlert, Clock3, Download, FileSearch, LoaderCircle, LockKeyhole, Network, RefreshCw, Save, ShieldAlert, UserRound } from 'lucide-react';
import type { GradeResult, IncidentStatus, ScenarioDetail } from '../../domain/types';
import type { Answers, CaseWorkspace, WorkspaceTab } from '../workspace';
import { EventTable } from './EventTable';
import { Investigation, Resolution } from './Investigation';
import { SeverityMark } from './Icons';
import { LabArtwork } from './LabArtwork';
import { SignalMap } from './SignalMap';

const statuses: IncidentStatus[] = ['New', 'Investigating', 'Escalated', 'Closed - True Positive', 'Closed - False Positive'];

export interface NotesSaveState { status: 'pending' | 'saving' | 'saved' | 'error'; message?: string }

interface Props {
  scenario: ScenarioDetail;
  workspace: CaseWorkspace;
  notesState: NotesSaveState;
  initialScroll: CaseWorkspace['scroll'];
  onStatusChange: (status: IncidentStatus) => Promise<void>;
  onSubmit: (answers: Answers) => Promise<GradeResult>;
  onWorkspaceChange: (patch: Partial<CaseWorkspace>) => void;
  onNotesChange: (notes: string) => void;
  onSaveNotes: () => void;
  onScroll: (tab: WorkspaceTab, offset: number) => void;
  submitting: boolean;
}

export function IncidentWorkspace({ scenario, workspace, notesState, initialScroll, onStatusChange, onSubmit, onWorkspaceChange, onNotesChange, onSaveNotes, onScroll, submitting }: Props) {
  const { tab } = workspace;
  const setTab = (next: WorkspaceTab) => onWorkspaceChange({ tab: next });
  const [retrying, setRetrying] = useState(false);
  const scrollArea = useRef<HTMLDivElement>(null);
  const scrollMemory = useRef(initialScroll);
  useLayoutEffect(() => { if (scrollArea.current) scrollArea.current.scrollTop = scrollMemory.current[tab] ?? 0; }, [tab]);
  const submit = async (submitted: Answers) => {
    const result = await onSubmit(submitted);
    setRetrying(false);
    return result;
  };
  const notes = workspace.notes ?? scenario.notes;
  return (
    <main className="workspace">
      <header className="incident-header"><LabArtwork variant="terminal" />
        <div className="breadcrumb"><span>Investigaciones</span><ChevronRight size={13} /><span>{scenario.id.toUpperCase()}</span></div>
        <div className="incident-title-row"><div><div className="incident-kicker"><SeverityMark severity={scenario.severity} /><span>{scenario.category}</span><span>·</span><span>{scenario.difficulty}</span></div><h1>{scenario.title}</h1></div><div className="incident-actions"><a className="secondary-action" href={`/api/scenarios/${scenario.id}/export`}><Download size={15} /> NDJSON</a><label className="status-select"><span className="sr-only">Estado del incidente</span><select value={scenario.status} onChange={(event) => { void onStatusChange(event.target.value as IncidentStatus); }}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label></div></div>
        <p className="briefing">{scenario.briefing}</p>
        <nav className="tabs" aria-label="Secciones del incidente">{([['overview', 'Resumen', Activity], ['evidence', 'Evidencias', FileSearch], ['investigation', 'Investigación', BookOpen]] as const).map(([id, label, Icon]) => <button key={id} aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}><Icon size={15} />{label}{id === 'evidence' && <span>{scenario.events.length}</span>}</button>)}</nav>
      </header>

      <div key={tab} ref={scrollArea} className="workspace-scroll" onScroll={(event) => { const offset = event.currentTarget.scrollTop; scrollMemory.current = { ...scrollMemory.current, [tab]: offset }; onScroll(tab, offset); }}>
        {tab === 'overview' && <Overview onReview={() => { setRetrying(false); setTab('investigation'); }} onExplore={() => setTab('evidence')} scenario={scenario} notes={notes} notesState={notesState} setNotes={onNotesChange} saveNotes={onSaveNotes} />}
        {tab === 'evidence' && <EventTable events={scenario.events} query={workspace.evidenceQuery} onQueryChange={(evidenceQuery) => onWorkspaceChange({ evidenceQuery })} />}
        {tab === 'investigation' && (scenario.review && !retrying ? <Resolution result={scenario.review} onRetry={() => setRetrying(true)} /> : <><p className="draft-notice">Las respuestas se conservan en este navegador aunque cambies de caso o recargues. Entrega la investigación para guardar la evaluación.</p><Investigation disabled={submitting} questions={scenario.questions} onSubmit={submit} answers={workspace.answers} onAnswersChange={(answers) => onWorkspaceChange({ answers })} /></>)}
      </div>
    </main>
  );
}

function Overview({ scenario, notes, notesState, setNotes, saveNotes, onExplore, onReview }: { onExplore: () => void; onReview: () => void; scenario: ScenarioDetail; notes: string; notesState: NotesSaveState; setNotes: (value: string) => void; saveNotes: () => void }) {
  return (
    <div className="overview-layout">
      <section className="overview-main">
        <SignalMap key={scenario.id} events={scenario.events} onExplore={onExplore} />
        <div className="case-facts"><div><Network /><span>Host afectado</span><strong>{scenario.host}</strong></div><div><UserRound /><span>Usuario objetivo</span><strong>{scenario.user}</strong></div><div><FileSearch /><span>Eventos totales</span><strong>{scenario.events.length}</strong></div><div><Clock3 /><span>Primer evento</span><strong>{scenario.events.length ? new Date(scenario.events[0].timestamp).toLocaleTimeString('es') : '—'}</strong></div></div>
        <div className="case-context-grid"><div className="context-card">
        <div className="section-heading"><div><span className="eyebrow">Contexto operativo</span><h3>Contexto del caso</h3></div><Clock3 size={18} /></div>
        <p className="overview-description">{scenario.description}</p>
        <div className="business-context"><span className="eyebrow">Contexto de negocio</span><p>{scenario.businessContext}</p></div>
        <div className="alerts-block"><span className="eyebrow">Señales disparadas</span>{scenario.alerts.map((alert) => <div key={alert} className="alert-line"><span aria-hidden="true">!</span>{alert}</div>)}</div>
        </div><section className="mitre-card"><h3><ShieldAlert size={19} />Técnicas MITRE ATT&CK</h3>{scenario.mitre.length ? scenario.mitre.map((technique) => <div key={technique.id}><a href={`https://attack.mitre.org/techniques/${technique.id.replace('.', '/')}/`} target="_blank" rel="noreferrer">{technique.id}</a><span>{technique.name}</span><small>{technique.tactic}</small></div>) : <p>{scenario.review ? "No se atribuyen técnicas maliciosas a este caso." : "Las técnicas se revelan al completar la investigación."}</p>}</section></div><div className="notes-block"><div className="section-heading compact"><div><span className="eyebrow">Privado para este caso</span><h3>Notas del analista</h3></div><div className="notes-actions"><NotesIndicator state={notesState} onRetry={saveNotes} />{notesState.status === 'pending' && <button className="icon-action" onClick={saveNotes}><Save size={15} />Guardar ahora</button>}</div></div><textarea maxLength={10000} aria-label="Notas del analista" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Registra hipótesis, pivotes y hallazgos…" /></div>
      </section>
      <aside className="signal-ribbon" aria-label="Cinta de señales"><div className="signal-ribbon-head"><span className="live-pulse" />SEÑALES DETECTADAS</div><h2>Señales de entrada</h2><p className="ribbon-intro">Observaciones iniciales. La conclusión es tuya.</p><ol>{scenario.alerts.map((alert, index) => <li key={alert}><div className="signal-index">{String(index + 1).padStart(2, '0')}</div><div><strong>Señal correlacionada</strong><p>{alert}</p><span>REGLA · TELEMETRÍA MIXTA</span></div></li>)}<li><div className="signal-index">{String(scenario.alerts.length + 1).padStart(2, '0')}</div><div><time>—</time><strong>Dataset preparado</strong><p>{scenario.events.length} eventos esperan análisis y correlación.</p><span>LAB · EVIDENCIA LOCAL</span></div></li></ol><div className="locked-solution"><span><LockKeyhole size={17} /></span><div><strong>{scenario.review ? "Cronología disponible" : "Cronología bloqueada"}</strong>{scenario.review ? <button className="secondary-action" onClick={onReview}>Ver revisión completa</button> : <p>{scenario.progress === 100 ? "Este caso se completó antes de guardar evaluaciones. Vuelve a entregarlo para recuperar la revisión." : "Entrega tu investigación para revelar la cadena maliciosa real."}</p>}</div></div></aside>
    </div>
  );
}

function NotesIndicator({ state, onRetry }: { state: NotesSaveState; onRetry: () => void }) {
  if (state.status === 'error') return <span className="save-indicator is-error" role="alert"><CircleAlert size={14} />{state.message ?? 'No se pudieron guardar las notas.'}<button onClick={onRetry}><RefreshCw size={13} />Reintentar</button></span>;
  if (state.status === 'saving') return <span className="save-indicator" role="status"><LoaderCircle size={14} />Guardando…</span>;
  if (state.status === 'pending') return <span className="save-indicator is-pending" role="status">Pendiente</span>;
  return <span className="save-indicator is-saved" role="status"><Check size={14} />Guardado</span>;
}
