import { useEffect, useState } from 'react';
import { Activity, BookOpen, ChevronRight, Clock3, Download, FileSearch, Network, Save, ShieldAlert, UserRound } from 'lucide-react';
import type { GradeResult, IncidentStatus, ScenarioDetail } from '../../domain/types';
import { EventTable } from './EventTable';
import { Investigation } from './Investigation';
import { SeverityMark } from './Icons';

type Tab = 'overview' | 'evidence' | 'investigation';
const statuses: IncidentStatus[] = ['New', 'Investigating', 'Escalated', 'Closed - True Positive', 'Closed - False Positive'];

interface Props {
  scenario: ScenarioDetail;
  onUpdate: (update: { status?: IncidentStatus; notes?: string }) => Promise<void>;
  onSubmit: (answers: Record<string, string | boolean>) => Promise<GradeResult>;
}

export function IncidentWorkspace({ scenario, onUpdate, onSubmit }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [notes, setNotes] = useState(scenario.notes);
  useEffect(() => { setNotes(scenario.notes); setTab('overview'); }, [scenario.id, scenario.notes]);
  return (
    <main className="workspace">
      <header className="incident-header">
        <div className="breadcrumb"><span>INCIDENTES</span><ChevronRight size={13} /><span>{scenario.id.toUpperCase()}</span></div>
        <div className="incident-title-row"><div><div className="incident-kicker"><SeverityMark severity={scenario.severity} /><span>{scenario.category}</span><span>·</span><span>{scenario.difficulty}</span></div><h1>{scenario.title}</h1></div><div className="incident-actions"><a className="secondary-action" href={`/api/scenarios/${scenario.id}/export`}><Download size={15} /> NDJSON</a><label className="status-select"><span className="sr-only">Estado del incidente</span><select value={scenario.status} onChange={(event) => onUpdate({ status: event.target.value as IncidentStatus })}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label></div></div>
        <p className="briefing">{scenario.briefing}</p>
        <nav className="tabs" aria-label="Secciones del incidente">{([['overview', 'Resumen', Activity], ['evidence', 'Evidencias', FileSearch], ['investigation', 'Investigación', BookOpen]] as const).map(([id, label, Icon]) => <button key={id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}><Icon size={15} />{label}{id === 'evidence' && <span>{scenario.events.length}</span>}</button>)}</nav>
      </header>

      <div className="workspace-scroll">
        {tab === 'overview' && <Overview scenario={scenario} notes={notes} setNotes={setNotes} saveNotes={() => onUpdate({ notes })} />}
        {tab === 'evidence' && <EventTable events={scenario.events} />}
        {tab === 'investigation' && <Investigation questions={scenario.questions} onSubmit={onSubmit} />}
      </div>
    </main>
  );
}

function Overview({ scenario, notes, setNotes, saveNotes }: { scenario: ScenarioDetail; notes: string; setNotes: (value: string) => void; saveNotes: () => void }) {
  return (
    <div className="overview-layout">
      <section className="overview-main">
        <div className="section-heading"><div><span className="eyebrow">Contexto operativo</span><h3>Lo que sabemos</h3></div><Clock3 size={18} /></div>
        <p className="overview-description">{scenario.description}</p>
        <div className="fact-strip"><div><UserRound size={16} /><span>Usuario</span><strong>{scenario.user}</strong></div><div><Network size={16} /><span>Activo</span><strong>{scenario.host}</strong></div><div><ShieldAlert size={16} /><span>Alertas</span><strong>{scenario.alertCount}</strong></div></div>
        <div className="alerts-block"><span className="eyebrow">Señales disparadas</span>{scenario.alerts.map((alert) => <div key={alert} className="alert-line"><span aria-hidden="true">!</span>{alert}</div>)}</div>
        <div className="notes-block"><div className="section-heading compact"><div><span className="eyebrow">Privado para este caso</span><h3>Notas del analista</h3></div><button className="icon-action" onClick={saveNotes}><Save size={15} />Guardar</button></div><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Registra hipótesis, pivotes y hallazgos…" /></div>
      </section>
      <aside className="signal-ribbon" aria-label="Cinta de señales"><div className="signal-ribbon-head"><span className="live-pulse" />SEÑALES DE ENTRADA</div><ol>{scenario.alerts.map((alert, index) => <li key={alert}><div className="signal-index">{String(index + 1).padStart(2, '0')}</div><div><time>{new Date(new Date(scenario.date).getTime() + index * 60_000).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</time><strong>Alerta correlacionada</strong><p>{alert}</p><span>REGLA · TELEMETRÍA MIXTA</span></div></li>)}<li><div className="signal-index">{String(scenario.alerts.length + 1).padStart(2, '0')}</div><div><time>—</time><strong>Dataset preparado</strong><p>{scenario.events.length} eventos esperan análisis y correlación.</p><span>LAB · EVIDENCIA LOCAL</span></div></li></ol><div className="locked-solution"><span>?</span><div><strong>Cronología bloqueada</strong><p>Entrega tu investigación para revelar la cadena maliciosa real.</p></div></div></aside>
    </div>
  );
}
