import type { SecurityEvent } from '../domain/types.js';
import { parseCommand, type Command } from './commands.js';
import { collectFields, eventToRow } from './fields.js';
import { splitPipeline } from './lexer.js';
import { asList, compareValues, SplError, type Row, type Scalar } from './values.js';

export interface SplResult {
  /** `events` while the pipeline only filters/enriches; `table` after a transforming command such as stats. */
  kind: 'events' | 'table';
  rows: Row[];
  columns: string[];
  warnings: string[];
  /** Events read by the initial search. */
  scanned: number;
  commands: string[];
}

export interface SplOptions { now?: number }

/** Parses the whole pipeline up front so syntax errors surface before anything runs. */
export function parseQuery(query: string): Command[] {
  return splitPipeline(query).map((segment, index) => parseCommand(segment, index === 0));
}

/** Runs an SPL query over the lab events, in memory. Throws SplError for invalid queries. */
export function runSpl(query: string, events: SecurityEvent[], options: SplOptions = {}): SplResult {
  if (query.length > 4000) throw new SplError('La búsqueda es demasiado larga (máximo 4000 caracteres).', 4000, query.length);
  const commands = parseQuery(query.trim() ? query : 'index=soc');
  let rows = events.map(eventToRow).sort((a, b) => compareValues(b._time, a._time));
  const scanned = rows.length;
  const warnings: string[] = [];
  let kind: SplResult['kind'] = 'events';
  let columns: string[] | undefined;
  for (const command of commands) {
    const before = rows.length;
    const trace = { referenced: new Map(), found: new Set<string>() };
    const output = command.run(rows, { now: options.now ?? Date.now() / 1000, warnings, trace });
    rows = output.rows;
    if (command.transforming) kind = 'table';
    if (output.columns) columns = output.columns;
    else if (output.renameColumn && columns) columns = columns.map(output.renameColumn);
    if (kind === 'table' && columns && rows.length) {
      const present = collectFields(rows);
      columns = [...columns.filter((column) => present.includes(column)), ...present.filter((field) => !columns!.includes(field) && field !== '_raw')];
    }
    if (before) {
      for (const [field] of trace.referenced) {
        if (!trace.found.has(field)) warnings.push(`En ${command.name}, «${field}» se interpreta como nombre de campo y no existe en ningún resultado. Si es un texto, ponlo entre comillas dobles: "${field}".`);
      }
    }
  }
  return {
    kind,
    rows,
    columns: kind === 'table' ? columns ?? collectFields(rows) : collectFields(rows),
    warnings,
    scanned,
    commands: commands.map((command) => command.name),
  };
}

export interface FieldSummary { field: string; distinct: number; coverage: number; top: { value: string; count: number }[] }

const hiddenFields = new Set(['_raw', 'id', 'scenarioId']);

/** Splunk-style field sidebar: how often each field appears and its most common values. */
export function summarizeFields(rows: Row[], topValues = 5): FieldSummary[] {
  if (!rows.length) return [];
  return collectFields(rows)
    .filter((field) => !hiddenFields.has(field))
    .map((field) => {
      const counts = new Map<string, number>();
      let present = 0;
      for (const row of rows) {
        const values = asList(row[field]);
        if (values.length) present += 1;
        for (const value of new Set(values.map((item: Scalar) => String(item)))) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      const top = [...counts].sort((a, b) => b[1] - a[1] || compareValues(a[0], b[0])).slice(0, topValues).map(([value, count]) => ({ value, count }));
      return { field, distinct: counts.size, coverage: present / rows.length, top };
    })
    .filter((summary) => summary.distinct > 0);
}
