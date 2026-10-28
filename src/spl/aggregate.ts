import { getField } from './fields.js';
import { TokenStream } from './lexer.js';
import { asList, compareValues, SplError, toNumber, type Row, type Scalar, type Value } from './values.js';

export interface Aggregation { fn: string; field?: string; name: string; percentile?: number }

const fieldFunctions = new Set(['count', 'c', 'dc', 'distinct_count', 'values', 'list', 'min', 'max', 'avg', 'mean', 'sum', 'range', 'median', 'stdev', 'var', 'mode', 'earliest', 'latest', 'first', 'last', 'earliest_time', 'latest_time']);
const needsField = new Set([...fieldFunctions].filter((fn) => fn !== 'count' && fn !== 'c'));

export const supportedAggregations = [...fieldFunctions, 'percN', 'pN'].sort();

/** Reads `count`, `dc(user)`, `values(action) as acciones`… separated by commas or spaces, until `by`/`over` or the end. */
export function parseAggregations(stream: TokenStream, stopWords: string[] = ['by']): Aggregation[] {
  const aggregations: Aggregation[] = [];
  while (!stream.atEnd() && !stopWords.some((word) => stream.isWord(word))) {
    if (stream.is('comma')) { stream.next(); continue; }
    const token = stream.expect('word', 'una función de agregación (count, dc, values…)');
    const fn = token.value.toLowerCase();
    const percentile = /^(?:perc|p|exactperc|upperperc)(\d{1,2}(?:\.\d+)?)$/.exec(fn);
    if (!fieldFunctions.has(fn) && !percentile) throw new SplError(`La función de agregación ${token.value} no existe o no está soportada.`, token.start, token.end);
    let field: string | undefined;
    if (stream.is('lparen')) {
      stream.next();
      const argument = stream.next();
      if (argument.type === 'word' && argument.value.toLowerCase() === 'eval') throw new SplError('count(eval(…)) no está soportado: usa eval para crear un campo y luego cuéntalo.', argument.start, argument.end);
      if (argument.type !== 'word' && argument.type !== 'string') throw new SplError(`Falta el campo dentro de ${token.value}(…).`, argument.start, argument.end);
      field = argument.value;
      stream.expect('rparen', '«)»');
    } else if (needsField.has(fn) || percentile) throw new SplError(`${token.value} necesita un campo: ${token.value}(campo).`, token.start, token.end);
    let name = field ? `${fn}(${field})` : 'count';
    if (stream.isWord('as')) {
      stream.next();
      const alias = stream.next();
      if (alias.type !== 'word' && alias.type !== 'string') throw new SplError('Falta el nombre tras «as».', alias.start, alias.end);
      name = alias.value;
    }
    aggregations.push({ fn: percentile ? 'perc' : fn, field, name, percentile: percentile ? Number(percentile[1]) : undefined });
  }
  if (!aggregations.length) {
    const token = stream.peek();
    throw new SplError('Falta al menos una función de agregación (por ejemplo, count).', token.start, token.end);
  }
  return aggregations;
}

/** Reads field names separated by spaces or commas until a stop word or the end. */
export function parseFieldList(stream: TokenStream, stopWords: string[] = [], stopOptions: string[] = []): string[] {
  const fields: string[] = [];
  const atOption = () => stream.isWord() && stream.peek(1).type === 'op' && stream.peek(1).value === '=' && stopOptions.includes(stream.peek().value.toLowerCase());
  while (!stream.atEnd() && !stopWords.some((word) => stream.isWord(word)) && !atOption()) {
    const token = stream.next();
    if (token.type === 'comma') continue;
    if (token.type !== 'word' && token.type !== 'string') throw new SplError(`Se esperaba un nombre de campo y aparece «${token.value}».`, token.start, token.end);
    fields.push(token.value);
  }
  return fields;
}

const numbers = (values: Scalar[]) => values.map(toNumber).filter((value): value is number => value !== null);

function percentile(sorted: number[], percent: number): number | null {
  if (!sorted.length) return null;
  const rank = (percent / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

function variance(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1);
}

/** Computes one aggregation over rows in their current order. */
export function aggregate(aggregation: Aggregation, rows: Row[]): Value {
  const { fn, field } = aggregation;
  if (!field) return rows.length;
  const values = rows.flatMap((row) => asList(getField(row, field)));
  switch (fn) {
    case 'count': case 'c': return values.length;
    case 'dc': case 'distinct_count': return new Set(values.map(String)).size;
    case 'values': return [...new Set(values.map(String))].sort();
    case 'list': return values.slice(0, 100);
    case 'first': return values[0] ?? null;
    case 'last': return values.at(-1) ?? null;
    case 'min': case 'max': {
      if (!values.length) return null;
      const numeric = numbers(values);
      if (numeric.length === values.length) return fn === 'min' ? Math.min(...numeric) : Math.max(...numeric);
      const sorted = [...values].sort(compareValues);
      return (fn === 'min' ? sorted[0] : sorted.at(-1)) ?? null;
    }
    case 'sum': { const numeric = numbers(values); return numeric.length ? numeric.reduce((total, value) => total + value, 0) : null; }
    case 'avg': case 'mean': { const numeric = numbers(values); return numeric.length ? numeric.reduce((total, value) => total + value, 0) / numeric.length : null; }
    case 'range': { const numeric = numbers(values); return numeric.length ? Math.max(...numeric) - Math.min(...numeric) : null; }
    case 'median': return percentile(numbers(values).sort((a, b) => a - b), 50);
    case 'perc': return percentile(numbers(values).sort((a, b) => a - b), aggregation.percentile ?? 50);
    case 'var': return variance(numbers(values));
    case 'stdev': { const result = variance(numbers(values)); return result === null ? null : Math.sqrt(result); }
    case 'mode': {
      const counts = new Map<string, { value: Scalar; count: number }>();
      for (const value of values) {
        const entry = counts.get(String(value)) ?? { value, count: 0 };
        entry.count += 1;
        counts.set(String(value), entry);
      }
      let best: { value: Scalar; count: number } | undefined;
      for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry;
      return best?.value ?? null;
    }
    default: {
      // earliest/latest (and their _time variants) pick by event time rather than result order.
      const timed = rows
        .map((row) => ({ time: toNumber(row._time ?? null), value: asList(getField(row, field))[0] ?? null }))
        .filter((entry) => entry.value !== null);
      if (!timed.length) return null;
      timed.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
      const chosen = fn.startsWith('earliest') ? timed[0] : timed[timed.length - 1];
      return fn.endsWith('_time') ? chosen.time : chosen.value;
    }
  }
}

export interface Group { key: string; values: Scalar[]; rows: Row[] }

/** Groups rows by the given fields; a multivalue field puts the row in one group per value, missing fields drop it. */
export function groupRows(rows: Row[], fields: string[]): Group[] {
  if (!fields.length) return [{ key: '', values: [], rows }];
  const groups = new Map<string, Group>();
  for (const row of rows) {
    let combinations: Scalar[][] = [[]];
    for (const field of fields) {
      const values = asList(getField(row, field));
      if (!values.length) { combinations = []; break; }
      combinations = combinations.flatMap((prefix) => [...new Set(values)].map((value) => [...prefix, value]));
    }
    for (const values of combinations) {
      const key = JSON.stringify(values);
      const group = groups.get(key) ?? { key, values, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort((a, b) => {
    for (let index = 0; index < fields.length; index += 1) {
      const order = compareValues(a.values[index], b.values[index]);
      if (order) return order;
    }
    return 0;
  });
}
