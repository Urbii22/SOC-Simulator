import { useEffect, useState } from 'react';
import { Check, CircleAlert, Send, ShieldCheck, X } from 'lucide-react';
import type { GradeResult, InvestigationQuestion } from '../../domain/types';

interface Props {
  questions: InvestigationQuestion[];
  onSubmit: (answers: Record<string, string | boolean>) => Promise<GradeResult>;
  initialAnswers?: Record<string, string | boolean>;
  onAnswersChange?: (answers: Record<string, string | boolean>) => void;
}

const emptyAnswers: Record<string, string | boolean> = {};

export function Investigation({ questions, onSubmit, initialAnswers = emptyAnswers, onAnswersChange }: Props) {
  const [answers, setAnswers] = useState<Record<string, string | boolean>>(initialAnswers);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setAnswers(initialAnswers); setResult(null); }, [questions, initialAnswers]);
  const answer = (id: string, value: string | boolean) => setAnswers((current) => { const next = { ...current, [id]: value }; onAnswersChange?.(next); return next; });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { setResult(await onSubmit(answers)); } catch { setError('No se pudo evaluar el ejercicio. Comprueba que la API está disponible.'); } finally { setBusy(false); }
  };
  if (result) return <Resolution result={result} />;
  return (
    <form className="investigation-form" onSubmit={submit}>
      <div className="section-heading"><div><span className="eyebrow">Cuaderno del analista</span><h3>Hipótesis y clasificación</h3></div><span className="points">100 pts</span></div>
      <p className="section-lede">Responde usando únicamente la telemetría del caso. La solución se desbloquea al entregar.</p>
      <div className="question-list">{questions.map((question, index) => (
        <fieldset key={question.id} className="question-block">
          <legend><span>{String(index + 1).padStart(2, '0')}</span>{question.prompt}<small>{question.points} pts</small></legend>
          {question.type === 'single' && <div className="option-grid">{question.options?.map((option) => <label key={option} className="radio-option"><input required type="radio" name={question.id} checked={answers[question.id] === option} onChange={() => answer(question.id, option)} /><span>{option}</span></label>)}</div>}
          {question.type === 'boolean' && <div className="option-grid two"><label className="radio-option"><input required type="radio" name={question.id} checked={answers[question.id] === true} onChange={() => answer(question.id, true)} /><span>Sí, verdadero positivo</span></label><label className="radio-option"><input required type="radio" name={question.id} checked={answers[question.id] === false} onChange={() => answer(question.id, false)} /><span>No, falso positivo</span></label></div>}
          {question.type === 'text' && <input required className="answer-input" value={String(answers[question.id] ?? '')} onChange={(event) => answer(question.id, event.target.value)} placeholder="Escribe una respuesta precisa" />}
        </fieldset>
      ))}</div>
      {error && <div className="error-banner" role="alert"><CircleAlert size={16} />{error}</div>}
      <button className="primary-action" disabled={busy} type="submit"><Send size={16} />{busy ? 'Evaluando…' : 'Entregar investigación'}</button>
    </form>
  );
}

export function Resolution({ result }: { result: GradeResult }) {
  return (
    <section className="resolution" aria-labelledby="score-title">
      <div className="score-panel"><div className="score-ring" style={{ '--score': `${result.score * 3.6}deg` } as React.CSSProperties}><span><strong>{result.score}</strong><small>/ 100</small></span></div><div><span className="eyebrow">Investigación evaluada</span><h3 id="score-title">{result.score >= 80 ? 'Caso resuelto' : 'Revisa la cadena de evidencias'}</h3><p>{result.explanation}</p></div></div>
      <div className="feedback-list">{result.feedback.map((item) => <div key={item.questionId} className={`feedback-row ${item.correct ? 'is-correct' : 'is-wrong'}`}>{item.correct ? <Check size={17} /> : <X size={17} />}<div><strong>{item.correct ? 'Respuesta correcta' : `Respuesta esperada: ${item.expected}`}</strong><p>{item.explanation}</p></div></div>)}</div>
      <div className="resolution-grid">
        <div><span className="eyebrow">IOC confirmados</span><ul className="plain-list">{result.iocs.map((ioc) => <li key={ioc.value}><code>{ioc.value}</code><span>{ioc.context}</span></li>)}</ul></div>
        <div><span className="eyebrow">Contención</span><ol className="action-list">{result.responseActions.map((action) => <li key={action}>{action}</li>)}</ol></div>
      </div>
      <div className="remediation-block"><span className="eyebrow">Remediación</span><ol className="action-list">{result.remediationActions.map((action) => <li key={action}>{action}</li>)}</ol></div>
      <div className="query-reference"><span className="eyebrow">Consultas de referencia</span><h4>KQL</h4>{result.queries.kql.map((query) => <code key={query}>{query}</code>)}<h4>SPL</h4>{result.queries.spl.map((query) => <code key={query}>{query}</code>)}{result.queries.sigma && <details><summary><ShieldCheck size={15} /> Regla Sigma</summary><pre>{result.queries.sigma}</pre></details>}</div>
    </section>
  );
}
