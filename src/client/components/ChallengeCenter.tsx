import { useCallback, useEffect, useState } from 'react';
import { BarChart3, BookOpenCheck, ChevronRight, Clock3, FileSearch, Flag, History, Lightbulb, Play, RotateCcw, Save, ShieldCheck, Target } from 'lucide-react';
import type { ChallengeDifficulty, ChallengeHistoryItem, ChallengeIncidentView, ChallengeMode, ChallengeSession, ChallengeSource, ChallengeStats, ChallengeTruth, ProceduralTemplateSummary, Severity } from '../../domain/types';
import { api } from '../api';
import { EventTable } from './EventTable';
import { Investigation, Resolution } from './Investigation';

type Section = 'challenge' | 'history' | 'stats';
type Verdict = 'true-positive' | 'false-positive' | 'mixed';

interface Props { section: Section; templates: ProceduralTemplateSummary[]; onError: (message: string) => void; onNavigateChallenge: () => void }

function duration(ms: number): string {
  const seconds = Math.round(ms / 1_000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function splitLines(value: string): string[] { return value.split('\n').map((item) => item.trim()).filter(Boolean); }

export function ChallengeCenter({ section, templates, onError, onNavigateChallenge }: Props) {
  const [session, setSession] = useState<ChallengeSession | null>(null);
  const [view, setView] = useState<ChallengeIncidentView | null>(null);
  const [history, setHistory] = useState<ChallengeHistoryItem[]>([]);
  const [stats, setStats] = useState<ChallengeStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewingCompleted, setReviewingCompleted] = useState(false);
  const [tab, setTab] = useState<'overview' | 'evidence' | 'investigation'>('overview');
  const [notes, setNotes] = useState('');
  const [evidence, setEvidence] = useState('');
  const [actions, setActions] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [verdict, setVerdict] = useState<Verdict | ''>('');
  const [severity, setSeverity] = useState<Severity | ''>('');

  const adoptView = useCallback((next: ChallengeIncidentView) => {
    setView(next); setSession(next.session); setNotes(next.scenario.notes); setEvidence(next.evidence.join('\n'));
    setActions(next.actions.join('\n')); setAnswers(next.savedAnswers); setVerdict(next.verdict ?? ''); setSeverity(next.severityAssessment ?? '');
  }, []);

  const openIncident = useCallback(async (targetSession: ChallengeSession, incidentId: string) => {
    let next = await api.sessionIncident(targetSession.id, incidentId);
    if (next.incident.status === 'New') next = await api.startSessionIncident(targetSession.id, incidentId, next.session.revision);
    adoptView(next); setTab(next.review ? 'investigation' : 'overview');
  }, [adoptView]);

  useEffect(() => {
    if (section === 'history') void api.sessionHistory().then(setHistory).catch(() => onError('No se pudo cargar el historial de sesiones.'));
    if (section === 'stats') void api.challengeStats().then(setStats).catch(() => onError('No se pudieron calcular las estadísticas.'));
  }, [section, onError]);

  const create = async (input: Parameters<typeof api.createSession>[0]) => {
    setBusy(true);
    try {
      const created = await api.createSession(input); setSession(created);
      setReviewingCompleted(false);
      await openIncident(created, created.incidents[0].id); onError('');
    } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo crear la sesión.'); }
    finally { setBusy(false); }
  };

  const saveDraft = async (): Promise<ChallengeIncidentView> => {
    if (!view) throw new Error('No active incident');
    const saved = await api.saveSessionProgress(view.session.id, view.incident.id, {
      revision: view.session.revision, notes, answers, evidence: splitLines(evidence), actions: splitLines(actions),
      ...(verdict ? { verdict } : {}), ...(severity ? { severityAssessment: severity } : {}),
    });
    adoptView(saved); return saved;
  };

  const save = async () => {
    setBusy(true); try { await saveDraft(); onError(''); } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo guardar el progreso.'); } finally { setBusy(false); }
  };

  const hint = async () => {
    if (!view) return; setBusy(true);
    try { const saved = await saveDraft(); adoptView(await api.requestHint(saved.session.id, saved.incident.id, saved.session.revision)); onError(''); }
    catch (error) { onError(error instanceof Error ? error.message : 'No se pudo solicitar la pista.'); }
    finally { setBusy(false); }
  };

  const submit = async (submitted: Record<string, string | boolean>) => {
    if (!view) throw new Error('No active incident');
    const saved = await saveDraft();
    const next = await api.submitSessionIncident(saved.session.id, saved.incident.id, saved.session.revision, submitted);
    adoptView(next); return next.review!;
  };

  const nextIncident = async () => {
    if (!view) return;
    const next = view.session.incidents.find((incident) => incident.status !== 'Submitted');
    if (!next) return;
    setBusy(true); try { await openIncident(view.session, next.id); } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo abrir el siguiente incidente.'); } finally { setBusy(false); }
  };

  const finalize = async () => {
    if (!view) return; setBusy(true);
    try { const completed = await api.finalizeSession(view.session.id, view.session.revision); setSession(completed); setView(null); setReviewingCompleted(false); }
    catch (error) { onError(error instanceof Error ? error.message : 'No se pudo finalizar la sesión.'); }
    finally { setBusy(false); }
  };

  const repeat = async (strategy: 'exact' | 'equivalent' | 'template-new-seed' | 'retry-failed') => {
    if (!session) return; setBusy(true);
    try { const created = await api.repeatSession(session.id, strategy); setSession(created); setReviewingCompleted(false); await openIncident(created, created.incidents[0].id); }
    catch (error) { onError(error instanceof Error ? error.message : 'No se pudo repetir la sesión.'); }
    finally { setBusy(false); }
  };

  const openHistory = async (item: ChallengeHistoryItem) => {
    setBusy(true);
    try {
      const loaded = await api.session(item.id); setSession(loaded);
      setReviewingCompleted(false);
      const incident = loaded.incidents.find((entry) => entry.status !== 'Submitted') ?? loaded.incidents.at(-1)!;
      await openIncident(loaded, incident.id);
      onNavigateChallenge();
    } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo recuperar la sesión.'); }
    finally { setBusy(false); }
  };

  if (section === 'history') return <HistoryView items={history} busy={busy} onOpen={openHistory} />;
  if (section === 'stats') return <StatsView stats={stats} />;
  if (session?.status === 'completed' && !reviewingCompleted) return <SessionSummary session={session} busy={busy} onRepeat={repeat} onReview={async (incidentId) => { setBusy(true); try { await openIncident(session, incidentId); setReviewingCompleted(true); } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo abrir la revisión.'); } finally { setBusy(false); } }} onNew={() => { setSession(null); setView(null); setReviewingCompleted(false); }} />;
  if (!session || !view) return <ModeSelector templates={templates} busy={busy} onCreate={create} />;

  const allSubmitted = view.session.incidents.every((incident) => incident.status === 'Submitted');
  return (
    <div className="challenge-layout">
      <aside className="challenge-rail">
        <div className="challenge-seed"><span>Semilla de sesión</span><code>{view.session.seed}</code><small title={view.session.planHash}>{view.session.planHash.slice(0, 12)}…</small></div>
        <ol>{view.session.incidents.map((incident) => <li key={incident.id} className={incident.id === view.incident.id ? 'is-active' : ''}><button disabled={incident.position > view.session.currentIndex + 1} onClick={() => void openIncident(view.session, incident.id)}><span>{String(incident.position).padStart(2, '0')}</span><div><strong>{incident.status === 'Submitted' ? `Revisión · ${incident.score}%` : incident.status}</strong><small>{incident.difficulty} · {incident.hintsUsed} pistas</small></div></button></li>)}</ol>
        <div className="challenge-progress"><span>{view.session.incidents.filter((item) => item.status === 'Submitted').length}/{view.session.incidents.length} completados</span><progress value={view.session.incidents.filter((item) => item.status === 'Submitted').length} max={view.session.incidents.length} /></div>
      </aside>
      <main className="challenge-workspace">
        <header className="challenge-header"><div><span className="eyebrow">Challenge mode · {view.session.config.mode}</span><h1>{view.scenario.title}</h1><p>{view.scenario.briefing}</p></div><div className="challenge-clock"><Clock3 size={15} />{duration(view.session.elapsedMs)}</div></header>
        <nav className="tabs challenge-tabs" aria-label="Flujo del incidente">{([['overview', 'Investigación', Target], ['evidence', `Evidencias · ${view.scenario.events.length}`, FileSearch], ['investigation', view.review ? 'Revisión' : 'Decisión', BookOpenCheck]] as const).map(([id, label, Icon]) => <button key={id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}><Icon size={15} />{label}</button>)}</nav>
        <div className="challenge-content">
          {tab === 'overview' && <div className="challenge-form-grid"><section><span className="eyebrow">Cuaderno recuperable</span><h3>Hipótesis y evidencias</h3><label>Notas del analista<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Hipótesis, pivotes y observaciones…" /></label><label>Evidencias (una por línea)<textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Evento, campo y motivo…" /></label></section><section><span className="eyebrow">Decisión provisional</span><h3>Clasificación y acciones</h3><label>Veredicto<select value={verdict} onChange={(event) => setVerdict(event.target.value as Verdict | '')}><option value="">Sin decidir</option><option value="true-positive">Verdadero positivo</option><option value="false-positive">Falso positivo</option><option value="mixed">Mixto</option></select></label><label>Severidad<select value={severity} onChange={(event) => setSeverity(event.target.value as Severity | '')}><option value="">Sin decidir</option>{['low', 'medium', 'high', 'critical'].map((item) => <option key={item}>{item}</option>)}</select></label><label>Acciones propuestas (una por línea)<textarea value={actions} onChange={(event) => setActions(event.target.value)} placeholder="Contener, escalar, observar…" /></label><button className="primary-action" disabled={busy || Boolean(view.review)} onClick={() => void save()}><Save size={15} />Guardar progreso</button></section></div>}
          {tab === 'evidence' && <EventTable events={view.scenario.events} />}
          {tab === 'investigation' && <div className="challenge-investigation"><div className="hint-panel"><div><Lightbulb size={17} /><span><strong>Pistas progresivas</strong><small>Cada pista descuenta {3} puntos del resultado ajustado; la puntuación bruta se conserva.</small></span></div><button disabled={busy || view.availableHints === 0 || Boolean(view.review)} onClick={() => void hint()}>Solicitar pista · {view.availableHints}</button>{view.hints.map((item) => <p key={item.level}><b>{item.level}</b>{item.text}<small>−{item.penalty} pts</small></p>)}</div>{view.review ? <><Resolution result={view.review} /><div className="challenge-next">{view.session.status === 'completed' ? <button className="primary-action" onClick={() => setReviewingCompleted(false)}>Volver al resumen</button> : allSubmitted ? <button className="primary-action" disabled={busy} onClick={() => void finalize()}><Flag size={15} />Finalizar sesión</button> : <button className="primary-action" disabled={busy} onClick={() => void nextIncident()}>Siguiente incidente<ChevronRight size={15} /></button>}</div></> : <Investigation questions={view.scenario.questions} initialAnswers={view.savedAnswers} onAnswersChange={setAnswers} onSubmit={submit} />}</div>}
        </div>
      </main>
    </div>
  );
}

function ModeSelector({ templates, busy, onCreate }: { templates: ProceduralTemplateSummary[]; busy: boolean; onCreate: (input: Parameters<typeof api.createSession>[0]) => Promise<void> }) {
  const [seed, setSeed] = useState(''); const [count, setCount] = useState(4); const [difficulty, setDifficulty] = useState<ChallengeDifficulty>('mixed');
  const [source, setSource] = useState<ChallengeSource>('procedural'); const [truth, setTruth] = useState<ChallengeTruth>('any'); const [template, setTemplate] = useState(''); const [categories, setCategories] = useState('');
  const launch = (mode: ChallengeMode, extra: Partial<Parameters<typeof api.createSession>[0]> = {}) => onCreate({ mode, ...(seed ? { seed } : {}), ...extra });
  return <div className="mode-screen"><header><span className="eyebrow">Entrenamiento reproducible</span><h1>Challenge Mode</h1><p>Resuelve incidentes sin metadatos reveladores. Las soluciones aparecen únicamente después de entregar.</p><label className="seed-input">Semilla opcional<input value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="session:829173" pattern="session:[0-9]+" /></label></header><div className="mode-cards"><ModeCard icon={<Target />} title="Quick Challenge" description="Un incidente procedural aleatorio para practicar ahora." detail="1 incidente · dificultad media" disabled={busy} onClick={() => launch('quick')} /><ModeCard icon={<BookOpenCheck />} title="Training Session" description="Tres investigaciones variadas con dificultad mixta." detail="3 incidentes · progresión flexible" disabled={busy} onClick={() => launch('training')} /><ModeCard icon={<ShieldCheck />} title="SOC Shift" description="Turno de cinco casos de fácil a avanzado." detail="5 incidentes · progresión gradual" disabled={busy} onClick={() => launch('shift')} /></div><form className="custom-session" onSubmit={(event) => { event.preventDefault(); void launch('custom', { count, difficulty, source, truth, ...(categories.trim() ? { categories: splitLines(categories.replaceAll(',', '\n')) } : {}), ...(template ? { templates: [template] } : {}) }); }}><div><span className="eyebrow">Configuración avanzada</span><h2>Sesión personalizada</h2></div><label>Incidentes<input type="number" min="1" max="10" value={count} onChange={(event) => setCount(Number(event.target.value))} /></label><label>Dificultad<select value={difficulty} onChange={(event) => setDifficulty(event.target.value as ChallengeDifficulty)}>{['easy', 'medium', 'hard', 'mixed', 'progressive'].map((item) => <option key={item}>{item}</option>)}</select></label><label>Origen<select value={source} onChange={(event) => { setSource(event.target.value as ChallengeSource); if (event.target.value === 'canonical') setTemplate(''); }}>{['procedural', 'canonical', 'mixed'].map((item) => <option key={item}>{item}</option>)}</select></label><label>Balance TP/FP<select value={truth} onChange={(event) => setTruth(event.target.value as ChallengeTruth)}>{['any', 'true-positive', 'false-positive', 'mixed'].map((item) => <option key={item}>{item}</option>)}</select></label><label>Categorías<input value={categories} onChange={(event) => setCategories(event.target.value)} placeholder="Separadas por comas" /></label><label>Plantilla<select disabled={source === 'canonical'} value={template} onChange={(event) => setTemplate(event.target.value)}><option value="">Todas</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="primary-action" disabled={busy} type="submit"><Play size={15} />Crear sesión</button></form></div>;
}

function ModeCard({ icon, title, description, detail, disabled, onClick }: { icon: React.ReactNode; title: string; description: string; detail: string; disabled: boolean; onClick: () => void }) {
  return <button className="mode-card" disabled={disabled} onClick={onClick}><span>{icon}</span><strong>{title}</strong><p>{description}</p><small>{detail}</small><b>Iniciar<ChevronRight size={14} /></b></button>;
}

function HistoryView({ items, busy, onOpen }: { items: ChallengeHistoryItem[]; busy: boolean; onOpen: (item: ChallengeHistoryItem) => Promise<void> }) {
  return <div className="records-screen"><header><History /><div><span className="eyebrow">Persistencia local</span><h1>Historial de sesiones</h1></div></header>{items.length ? <div className="record-table"><div className="record-head"><span>Fecha</span><span>Modo / semilla</span><span>Progreso</span><span>Resultado</span><span>Duración</span><span /></div>{items.map((item) => <div className="record-row" key={item.id}><time>{new Date(item.createdAt).toLocaleString('es')}</time><span><strong>{item.mode}</strong><code>{item.seed}</code></span><span>{item.completed}/{item.count} · {item.status}</span><strong>{item.accuracy}%</strong><span>{duration(item.durationMs)}</span><button disabled={busy} onClick={() => void onOpen(item)}>Abrir<ChevronRight size={14} /></button></div>)}</div> : <p className="empty-records">Todavía no hay sesiones. El primer Quick Challenge aparecerá aquí.</p>}</div>;
}

function StatsView({ stats }: { stats: ChallengeStats | null }) {
  if (!stats) return <div className="loading-shell" aria-busy="true"><span /><p>Calculando métricas…</p></div>;
  return <div className="records-screen stats-screen"><header><BarChart3 /><div><span className="eyebrow">Rendimiento acumulado</span><h1>Estadísticas de entrenamiento</h1></div></header><div className="metric-strip"><Metric label="Investigaciones" value={stats.investigations} /><Metric label="Precisión media" value={`${stats.averageAccuracy}%`} /><Metric label="Veredictos" value={`${stats.verdictAccuracy}%`} /><Metric label="Tiempo medio" value={duration(stats.averageTimeMs)} /><Metric label="Pistas" value={stats.hintsUsed} /></div><div className="stats-grid"><Breakdown title="Por dificultad" items={stats.byDifficulty} /><Breakdown title="Por categoría" items={stats.byCategory} /><Breakdown title="MITRE ATT&CK" items={stats.byMitre} /><Breakdown title="Plantillas a reforzar" items={stats.weakestTemplates} /></div><section className="recommendations"><span className="eyebrow">Práctica recomendada</span>{stats.recommendations.map((item) => <p key={item}><Target size={14} />{item}</p>)}</section></div>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function Breakdown({ title, items }: { title: string; items: ChallengeStats['byDifficulty'] }) { return <section><h3>{title}</h3>{items.slice(0, 8).map((item) => <div key={item.key}><span>{item.key}</span><progress value={item.accuracy} max="100" /><strong>{item.accuracy}%</strong><small>{item.investigations}</small></div>)}{!items.length && <p>Sin datos todavía.</p>}</section>; }

function SessionSummary({ session, busy, onRepeat, onReview, onNew }: { session: ChallengeSession; busy: boolean; onRepeat: (strategy: 'exact' | 'equivalent' | 'template-new-seed' | 'retry-failed') => Promise<void>; onReview: (incidentId: string) => Promise<void>; onNew: () => void }) {
  const summary = session.summary!;
  return <div className="summary-screen"><span className="eyebrow">Sesión finalizada · {session.seed}</span><h1>Turno completado</h1><p>La precisión ajustada descuenta únicamente las pistas; la puntuación bruta de preguntas permanece visible.</p><div className="summary-score"><strong>{summary.accuracy}%</strong><span>Precisión bruta</span><small>{summary.adjustedAccuracy}% ajustada</small></div><div className="metric-strip"><Metric label="Incidentes" value={`${summary.completed}/${summary.total}`} /><Metric label="Veredictos" value={`${summary.verdictAccuracy}%`} /><Metric label="Preguntas" value={`${summary.correctQuestions}/${summary.totalQuestions}`} /><Metric label="Pistas" value={summary.hintsUsed} /><Metric label="Duración" value={duration(summary.elapsedMs)} /></div><div className="summary-details"><p><b>Balance:</b> {summary.truePositives} TP · {summary.falsePositives} FP · {summary.mixed} mixtos</p><p><b>Categorías:</b> {summary.categories.join(', ') || '—'}</p><p><b>MITRE:</b> {summary.mitre.join(', ') || '—'}</p><p><b>Preguntas falladas:</b> {summary.missedQuestionIds.join(', ') || 'ninguna'}</p><div className="review-links">{session.incidents.map((incident) => <button key={incident.id} disabled={busy} onClick={() => void onReview(incident.id)}>Revisar incidente {incident.position} · {incident.score}%</button>)}</div></div><div className="repeat-actions"><button disabled={busy} onClick={() => void onRepeat('exact')}><RotateCcw size={14} />Misma sesión exacta</button><button disabled={busy} onClick={() => void onRepeat('equivalent')}>Sesión equivalente nueva</button><button disabled={busy} onClick={() => void onRepeat('template-new-seed')}>Plantillas, semillas nuevas</button><button disabled={busy} onClick={() => void onRepeat('retry-failed')}>Reintentar fallados</button><button className="primary-action" disabled={busy} onClick={onNew}>Nueva configuración</button></div></div>;
}
