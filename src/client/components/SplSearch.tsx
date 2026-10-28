import { Fragment, useMemo, useState, type KeyboardEvent } from 'react';
import { BookOpen, ChevronDown, ChevronRight, History, Play, Plus, TerminalSquare, TriangleAlert } from 'lucide-react';
import type { SecurityEvent } from '../../domain/types';
import { addSearchFilter, formatTime, runSpl, SplError, summarizeFields, supportedCommands, toText, type Row, type SplResult, type Value } from '../../spl';

const HISTORY_KEY = 'watchfloor.spl.history.v1';
const PAGE = 100;

const examples: { label: string; query: string }[] = [
  { label: 'Volumen por fuente', query: 'index=soc | stats count by source | sort - count' },
  { label: 'Fallos por IP de origen', query: 'index=soc outcome=failure | stats count dc(user) as usuarios values(user) as cuentas by sourceIp | sort - count' },
  { label: 'Línea temporal', query: 'index=soc | timechart span=5m count by source' },
  { label: 'Hosts más activos', query: 'index=soc | top limit=5 host' },
  { label: 'Tabla de trabajo', query: 'index=soc | eval hora=strftime(_time, "%H:%M:%S") | table hora host user action message' },
  { label: 'Sesiones por usuario', query: 'index=soc | transaction user maxspan=30m | where eventcount > 3 | table _time user duration eventcount' },
  { label: 'Extraer con rex', query: 'index=soc source=dns | rex field=message "Query (?<tipo>\\w+) (?<dominio>\\S+)" | stats count by tipo dominio' },
];

function loadHistory(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 15) : [];
  } catch { return []; }
}

function saveHistory(history: string[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* History is a convenience; ignore storage failures. */ }
}

const formatTimestamp = (value: Value | undefined) => {
  const seconds = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(seconds) ? formatTime(seconds, '%Y-%m-%d %H:%M:%S') : toText(value ?? null) ?? '';
};

function formatValue(field: string, value: Value | undefined): string {
  if (value === undefined || value === null) return '';
  if (field === '_time') return formatTimestamp(value);
  if (Array.isArray(value)) return value.map((item) => formatValue(field, item)).join('\n');
  if (typeof value === 'number' && !Number.isInteger(value)) return String(Math.round(value * 10000) / 10000);
  return String(value);
}

type Outcome = { result: SplResult; error?: undefined } | { result?: undefined; error: SplError };

interface Props {
  events: SecurityEvent[];
  query?: string;
  onQueryChange?: (query: string) => void;
}

export function SplSearch({ events, query: controlledQuery, onQueryChange }: Props) {
  const [localQuery, setLocalQuery] = useState('');
  const draft = controlledQuery ?? localQuery;
  const setDraft = onQueryChange ?? setLocalQuery;
  const [executed, setExecuted] = useState(() => draft);
  const [history, setHistory] = useState(loadHistory);
  const [visible, setVisible] = useState(PAGE);

  const outcome = useMemo<Outcome>(() => {
    try { return { result: runSpl(executed, events) }; } catch (error) {
      if (error instanceof SplError) return { error };
      return { error: new SplError(error instanceof Error ? error.message : 'Error inesperado al ejecutar la búsqueda.') };
    }
  }, [executed, events]);

  const run = (next = draft) => {
    if (next !== draft) setDraft(next);
    setExecuted(next);
    setVisible(PAGE);
    const trimmed = next.trim();
    if (trimmed) {
      const updated = [trimmed, ...history.filter((item) => item !== trimmed)].slice(0, 15);
      setHistory(updated);
      saveHistory(updated);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      run();
    }
  };

  const filter = (field: string, value: string, exclude = false) => run(addSearchFilter(executed, field, value, exclude));
  const result = outcome.result;

  return (
    <section className="evidence-section spl-search" aria-labelledby="evidence-title">
      <div className="section-heading evidence-heading">
        <div><span className="eyebrow">index=soc · {events.length} eventos</span><h3 id="evidence-title">Búsqueda SPL</h3></div>
        <span className="result-count" role="status">{result ? (result.kind === 'events' ? `${result.rows.length} de ${result.scanned} eventos` : `${result.rows.length} resultados`) : 'Error'}</span>
      </div>
      <form className="spl-bar" onSubmit={(event) => { event.preventDefault(); run(); }}>
        <TerminalSquare size={16} aria-hidden="true" />
        <textarea
          value={draft}
          rows={Math.min(6, Math.max(1, draft.split('\n').length))}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="index=soc | stats count by source"
          aria-label="Búsqueda SPL"
          aria-describedby="spl-help"
          aria-invalid={!!outcome.error}
        />
        <button type="submit" className="primary-action spl-run"><Play size={14} aria-hidden="true" />Buscar</button>
      </form>
      <p id="spl-help" className="spl-hint">Intro ejecuta · Mayús+Intro añade una línea · Horas en UTC · Motor SPL del laboratorio (subconjunto de Splunk)</p>
      <div className="spl-tools">
        <details>
          <summary><BookOpen size={14} aria-hidden="true" />Chuleta SPL</summary>
          <div className="spl-cheatsheet">
            <ul>{examples.map((example) => <li key={example.query}><button type="button" onClick={() => run(example.query)}><strong>{example.label}</strong><code>{example.query}</code></button></li>)}</ul>
            <p><strong>Búsqueda:</strong> <code>campo=valor</code>, <code>campo!=valor</code>, comodines <code>*</code>, <code>AND</code>/<code>OR</code>/<code>NOT</code> (en mayúsculas), <code>campo IN (a,b)</code>, <code>&gt; &lt;</code> y texto libre. Los campos de <code>details</code> se pueden escribir con o sin el prefijo <code>details.</code></p>
            <p><strong>Comandos:</strong> {supportedCommands.join(', ')}.</p>
            <p><strong>Ojo:</strong> en <code>where</code> y <code>eval</code> los textos van entre comillas dobles; sin ellas, una palabra es un nombre de campo.</p>
          </div>
        </details>
        {history.length > 0 && (
          <details>
            <summary><History size={14} aria-hidden="true" />Historial</summary>
            <ul className="spl-history">{history.map((item) => <li key={item}><button type="button" onClick={() => run(item)}><code>{item}</code></button></li>)}</ul>
          </details>
        )}
      </div>
      {outcome.error && <SplErrorPanel query={executed} error={outcome.error} />}
      {result?.warnings.map((warning) => <p key={warning} className="spl-warning"><TriangleAlert size={14} aria-hidden="true" />{warning}</p>)}
      {result && (result.kind === 'events'
        ? <EventResults result={result} visible={visible} onMore={() => setVisible((count) => count + PAGE)} onFilter={filter} />
        : <TableResults result={result} visible={visible} onMore={() => setVisible((count) => count + PAGE)} />)}
    </section>
  );
}

function SplErrorPanel({ query, error }: { query: string; error: SplError }) {
  const start = Math.min(error.start, query.length);
  const end = Math.max(start, Math.min(error.end, query.length));
  return (
    <div className="spl-error" role="alert">
      <strong><TriangleAlert size={15} aria-hidden="true" />Error en la búsqueda</strong>
      <p>{error.message}</p>
      {query && <pre>{query.slice(0, start)}<mark>{query.slice(start, end) || ' '}</mark>{query.slice(end)}</pre>}
    </div>
  );
}

function FieldSidebar({ rows, onFilter }: { rows: Row[]; onFilter: (field: string, value: string, exclude?: boolean) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const summary = useMemo(() => summarizeFields(rows), [rows]);
  const selected = ['host', 'source', 'sourcetype'];
  const ordered = [...summary.filter(({ field }) => selected.includes(field)), ...summary.filter(({ field }) => !selected.includes(field) && field !== '_time').sort((a, b) => a.field.localeCompare(b.field))];
  return (
    <aside className="spl-fields" aria-label="Campos">
      <span className="eyebrow">Campos</span>
      <ul>{ordered.map(({ field, distinct, coverage, top }) => (
        <li key={field}>
          <button type="button" aria-expanded={open === field} onClick={() => setOpen(open === field ? null : field)}>
            <span className="mono">{field}</span><small>{distinct}{coverage < 1 ? ` · ${Math.round(coverage * 100)}%` : ''}</small>
          </button>
          {open === field && <ul className="spl-field-values">{top.map(({ value, count }) => (
            <li key={value}>
              <button type="button" title={`Añadir ${field}="${value}" a la búsqueda`} onClick={() => onFilter(field, value)}><span>{value}</span><small>{count}</small></button>
              <button type="button" className="spl-exclude" aria-label={`Excluir ${field}="${value}"`} title="Excluir" onClick={() => onFilter(field, value, true)}>≠</button>
            </li>
          ))}</ul>}
        </li>
      ))}</ul>
    </aside>
  );
}

const headlineFields = ['host', 'source', 'sourcetype', 'user', 'sourceIp', 'destinationIp', 'eventCode', 'action', 'outcome'];

function EventResults({ result, visible, onMore, onFilter }: { result: SplResult; visible: number; onMore: () => void; onFilter: (field: string, value: string, exclude?: boolean) => void }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  if (!result.rows.length) return <p className="spl-empty">Ningún evento coincide con la búsqueda.</p>;
  return (
    <div className="spl-results">
      <FieldSidebar rows={result.rows} onFilter={onFilter} />
      <div className="table-wrap" tabIndex={0} aria-label="Eventos encontrados">
        <table className="spl-events">
          <thead><tr><th aria-label="Detalle" /><th>Hora (UTC)</th><th>Evento</th></tr></thead>
          <tbody>{result.rows.slice(0, visible).map((row, index) => (
            <Fragment key={`${toText(row.id ?? null) ?? ''}-${index}`}>
              <tr>
                <td><button type="button" className="spl-expand" aria-expanded={expanded === index} aria-label="Ver todos los campos" onClick={() => setExpanded(expanded === index ? null : index)}>{expanded === index ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></td>
                <td className="mono time-cell">{formatTimestamp(row._time)}</td>
                <td>
                  <span className="event-message">{formatValue('message', row.message) || formatValue('_raw', row._raw)}</span>
                  <small className="spl-headline">
                    {typeof row.eventcount === 'number' && <span className="spl-badge">{row.eventcount} eventos · {row.duration}s</span>}
                    {headlineFields.filter((field) => row[field] !== undefined).map((field) => <span key={field}>{field}=<b>{formatValue(field, row[field]).replace(/\n/g, ', ')}</b></span>)}
                  </small>
                </td>
              </tr>
              {expanded === index && (
                <tr className="spl-detail"><td /><td colSpan={2}>
                  <dl>{Object.keys(row).filter((field) => field !== '_raw').map((field) => (
                    <div key={field}><dt className="mono">{field}</dt><dd>
                      <span>{formatValue(field, row[field])}</span>
                      {field !== '_time' && !Array.isArray(row[field]) && <button type="button" aria-label={`Añadir ${field} a la búsqueda`} title="Añadir a la búsqueda" onClick={() => onFilter(field, String(row[field]))}><Plus size={12} /></button>}
                    </dd></div>
                  ))}</dl>
                </td></tr>
              )}
            </Fragment>
          ))}</tbody>
        </table>
        {result.rows.length > visible && <button type="button" className="secondary-action spl-more" onClick={onMore}>Mostrar más ({result.rows.length - visible} restantes)</button>}
      </div>
    </div>
  );
}

function TableResults({ result, visible, onMore }: { result: SplResult; visible: number; onMore: () => void }) {
  if (!result.rows.length) return <p className="spl-empty">La búsqueda no produjo resultados.</p>;
  return (
    <div className="table-wrap" tabIndex={0} aria-label="Estadísticas">
      <table className="spl-table">
        <thead><tr>{result.columns.map((column) => <th key={column} className="mono">{column}</th>)}</tr></thead>
        <tbody>{result.rows.slice(0, visible).map((row, index) => (
          <tr key={index}>{result.columns.map((column) => {
            const value = row[column];
            return <td key={column} className={typeof value === 'number' ? 'mono is-number' : 'mono'}>{formatValue(column, value)}</td>;
          })}</tr>
        ))}</tbody>
      </table>
      {result.rows.length > visible && <button type="button" className="secondary-action spl-more" onClick={onMore}>Mostrar más ({result.rows.length - visible} restantes)</button>}
    </div>
  );
}
