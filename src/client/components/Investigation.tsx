import { useState } from 'react';
import { Check, CircleAlert, Play, Send, ShieldCheck, X } from 'lucide-react';
import type { GradeResult, InvestigationQuestion } from '../../domain/types';
import { EventTable } from './EventTable';

interface Props {
  questions: InvestigationQuestion[];
  onSubmit: (answers: Record<string, string | boolean>) => Promise<GradeResult>;
  answers: Record<string, string | boolean>;
  onAnswersChange: (answers: Record<string, string | boolean>) => void;
  disabled?: boolean;
}

export function Investigation({ questions, onSubmit, answers, onAnswersChange, disabled = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const answer = (id: string, value: string | boolean) => onAnswersChange({ ...answers, [id]: value });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || disabled) return;
    setBusy(true); setError('');
    try { await onSubmit(answers); } catch (error) { setError(error instanceof Error ? error.message : 'No se pudo evaluar el ejercicio. Inténtalo de nuevo.'); } finally { setBusy(false); }
  };
  return (
    <form className="investigation-form" onSubmit={submit}>
      <div className="section-heading"><div><span className="eyebrow">Cuaderno del analista</span><h3>Hipótesis y clasificación</h3></div><span className="points">100 pts</span></div>
      <p className="section-lede">Responde usando únicamente la telemetría del caso. La solución se desbloquea al entregar.</p>
      <div className="question-list">{questions.map((question, index) => (
        <fieldset key={question.id} className="question-block" disabled={busy || disabled}>
          <legend><span className="question-number">{String(index + 1).padStart(2, '0')}</span><span className="question-prompt">{question.prompt}</span><small>{question.points} pts</small></legend>
          {question.type === 'single' && <div className="option-grid">{question.options?.map((option) => <label key={option} className="radio-option"><input required type="radio" name={question.id} checked={answers[question.id] === option} onChange={() => answer(question.id, option)} /><span>{option}</span></label>)}</div>}
          {question.type === 'boolean' && <div className="option-grid two"><label className="radio-option"><input required type="radio" name={question.id} checked={answers[question.id] === true} onChange={() => answer(question.id, true)} /><span>Sí, verdadero positivo</span></label><label className="radio-option"><input required type="radio" name={question.id} checked={answers[question.id] === false} onChange={() => answer(question.id, false)} /><span>No, falso positivo</span></label></div>}
          {question.type === 'text' && <input required maxLength={2000} aria-label={question.prompt} className="answer-input" value={String(answers[question.id] ?? '')} onChange={(event) => answer(question.id, event.target.value)} placeholder="Escribe una respuesta precisa" />}
        </fieldset>
      ))}</div>
      {error && <div className="error-banner" role="alert"><CircleAlert size={16} />{error}</div>}
      <button className="primary-action" disabled={busy || disabled} type="submit"><Send size={16} />{busy ? 'Evaluando…' : 'Entregar investigación'}</button>
    </form>
  );
}

export function Resolution({ result, onRetry, onRunQuery }: { result: GradeResult; onRetry?: () => void; onRunQuery?: (query: string) => void }) {
  return (
    <section className="resolution" aria-labelledby="score-title">
      <div className="score-panel"><div className="score-ring" style={{ '--score': `${result.score * 3.6}deg` } as React.CSSProperties}><span><strong>{result.score}</strong><small>/ 100</small></span></div><div><span className="eyebrow">Investigación evaluada</span><h3 id="score-title">{result.score >= 80 ? 'Caso resuelto' : 'Revisa la cadena de evidencias'}</h3><p>{result.explanation}</p></div></div>
      <div className="feedback-list">{result.feedback.map((item) => <div key={item.questionId} className={`feedback-row ${item.correct ? 'is-correct' : 'is-wrong'}`}>{item.correct ? <Check size={17} /> : <X size={17} />}<div><strong>{item.correct ? 'Respuesta correcta' : `Respuesta esperada: ${item.expected}`}</strong><p>{item.explanation}</p></div></div>)}</div>
      <section className="review-section" aria-label="Razonamiento de la investigación"><h3>Razonamiento de la investigación</h3><ol className="action-list">{result.reasoning.map((step, index) => <li key={index}>{step}</li>)}</ol></section>
      <section className="review-section" aria-label="Técnicas MITRE ATT&CK"><h3>Técnicas MITRE ATT&CK</h3><ul className="plain-list">{result.mitre.map((technique) => <li key={technique.id}><a href={`https://attack.mitre.org/techniques/${technique.id.replace('.', '/')}/`} target="_blank" rel="noreferrer">{technique.id} · {technique.name}</a><span>{technique.tactic}</span></li>)}</ul>{!result.mitre.length && <p>No se atribuyen técnicas maliciosas a este caso.</p>}</section>
      <section className="review-section" aria-label="Cronología confirmada"><h3>Cronología confirmada</h3><p>Eventos que fundamentan la resolución, en orden temporal.</p><EventTable events={result.timeline} /></section>
      <div className="resolution-grid">
        <div><span className="eyebrow">IOC confirmados</span><ul className="plain-list">{result.iocs.map((ioc) => <li key={ioc.value}><code>{ioc.value}</code><span>{ioc.context}</span></li>)}</ul></div>
        <div><span className="eyebrow">Contención</span><ol className="action-list">{result.responseActions.map((action) => <li key={action}>{action}</li>)}</ol></div>
      </div>
      <div className="remediation-block"><span className="eyebrow">Remediación</span><ol className="action-list">{result.remediationActions.map((action) => <li key={action}>{action}</li>)}</ol></div>
      <div className="query-reference"><span className="eyebrow">Consultas de referencia</span><h4>KQL</h4>{result.queries.kql.map((query) => <code key={query}>{query}</code>)}<h4>SPL</h4>{result.queries.spl.map((query) => onRunQuery ? <div key={query} className="runnable-query"><code>{query}</code><button type="button" className="secondary-action" onClick={() => onRunQuery(query)}><Play size={13} />Ejecutar</button></div> : <code key={query}>{query}</code>)}{result.queries.sigma && <details><summary><ShieldCheck size={15} /> Regla Sigma</summary><pre>{result.queries.sigma}</pre></details>}</div>
      {onRetry && <button className="secondary-action" onClick={onRetry}>Reintentar investigación</button>}
    </section>
  );
}
