import { aggregate, groupRows, parseAggregations, parseFieldList, type Aggregation } from './aggregate.js';
import { compileRegex, evaluate, parseExpression, parseExpressionFrom, type EvalTrace, type Expr } from './expr.js';
import { collectFields, expandFields, getField } from './fields.js';
import { TokenStream, tokenizeExpression, tokenizeWords, type Segment, type Token } from './lexer.js';
import { matchesSearch, parseSearch } from './search.js';
import { asList, compareValues, fromList, parseDuration, SplError, toNumber, toText, type Row, type Scalar } from './values.js';

export interface CommandContext { now: number; warnings: string[]; trace: EvalTrace }
export interface CommandOutput {
  rows: Row[];
  /** Explicit column order for the statistics view. */
  columns?: string[];
  /** Lets the engine carry a column order across a rename. */
  renameColumn?: (field: string) => string;
}

export interface Command {
  name: string;
  start: number;
  end: number;
  /** Transforming commands turn events into a statistics table, as in Splunk. */
  transforming: boolean;
  run: (rows: Row[], context: CommandContext) => CommandOutput;
}

type Parser = (args: string, offset: number, name: Token) => Omit<Command, 'name' | 'start' | 'end'>;

const streaming = (run: Command['run']) => ({ transforming: false, run });
const transforming = (run: Command['run']) => ({ transforming: true, run });

function words(args: string, offset: number) { return new TokenStream(tokenizeWords(args, offset)); }

function expectEnd(stream: TokenStream) {
  if (!stream.atEnd()) {
    const token = stream.peek();
    throw new SplError(`Argumento inesperado «${token.value}».`, token.start, token.end);
  }
}

function integerOption(token: Token, name: string, min = 0): number {
  const value = Number(token.value);
  if (!Number.isInteger(value) || value < min) throw new SplError(`${name} debe ser un número entero${min ? ` mayor o igual que ${min}` : ''}.`, token.start, token.end);
  return value;
}

function booleanOption(token: Token): boolean {
  const value = token.value.toLowerCase();
  if (['t', 'true', '1'].includes(value)) return true;
  if (['f', 'false', '0'].includes(value)) return false;
  throw new SplError(`Se esperaba true o false y aparece «${token.value}».`, token.start, token.end);
}

function durationOption(token: Token, name: string): number {
  const seconds = parseDuration(token.value);
  if (seconds === null || seconds <= 0) throw new SplError(`${name} necesita una duración como 30s, 5m, 1h o 1d.`, token.start, token.end);
  return seconds;
}

/** Reads any `name=value` options in `allowed` that appear before other arguments. */
function readOptions(stream: TokenStream, allowed: string[]): Map<string, Token> {
  const options = new Map<string, Token>();
  while (stream.isWord() && stream.peek(1).type === 'op' && stream.peek(1).value === '=') {
    const name = stream.peek().value.toLowerCase();
    if (!allowed.includes(name)) {
      const token = stream.peek();
      throw new SplError(`Opción desconocida ${token.value}=.${allowed.length ? ` Opciones válidas: ${allowed.join(', ')}.` : ''}`, token.start, token.end);
    }
    const value = stream.option(name);
    if (value) options.set(name, value);
  }
  return options;
}

const evalContext = (row: Row, context: CommandContext) => ({ row, now: context.now, trace: context.trace });

function aggregateGroups(rows: Row[], aggregations: Aggregation[], by: string[]): CommandOutput {
  const output = groupRows(rows, by).map((group) => {
    const row: Row = {};
    by.forEach((field, index) => { row[field] = group.values[index]; });
    for (const aggregation of aggregations) row[aggregation.name] = aggregate(aggregation, group.rows);
    return row;
  });
  return { rows: output, columns: [...by, ...aggregations.map((aggregation) => aggregation.name)] };
}

const parsers: Record<string, Parser> = {
  search: (args, offset) => {
    const node = parseSearch(args, offset);
    return streaming((rows) => ({ rows: rows.filter((row) => matchesSearch(node, row)) }));
  },

  where: (args, offset, name) => {
    if (!args.trim()) throw new SplError('where necesita una condición, por ejemplo: where count > 5', name.start, name.end);
    const expr = parseExpression(args, offset);
    return streaming((rows, context) => ({
      rows: rows.filter((row) => {
        const result = evaluate(expr, evalContext(row, context));
        if (result !== null && typeof result !== 'boolean') throw new SplError('where necesita una condición verdadera/falsa (por ejemplo, count > 5).', offset, offset + args.length);
        return result === true;
      }),
    }));
  },

  eval: (args, offset, name) => {
    const stream = new TokenStream(tokenizeExpression(args, offset));
    const assignments: { field: string; expr: Expr }[] = [];
    while (!stream.atEnd()) {
      const target = stream.next();
      if (target.type !== 'word' && target.type !== 'field') throw new SplError('eval espera campo=expresión.', target.start, target.end);
      stream.expect('op', '«=» tras el nombre del campo', '=');
      assignments.push({ field: target.value, expr: parseExpressionFrom(stream) });
      if (!stream.atEnd()) stream.expect('comma', '«,» entre asignaciones');
    }
    if (!assignments.length) throw new SplError('eval necesita al menos una asignación: eval campo=expresión', name.start, name.end);
    return streaming((rows, context) => {
      for (const row of rows) for (const { field, expr } of assignments) {
        const value = evaluate(expr, evalContext(row, context));
        if (value === null) delete row[field];
        else row[field] = value;
      }
      return { rows };
    });
  },

  stats: (args, offset) => {
    const stream = words(args, offset);
    const aggregations = parseAggregations(stream);
    const by = stream.isWord('by') ? (stream.next(), parseFieldList(stream)) : [];
    expectEnd(stream);
    return transforming((rows) => aggregateGroups(rows, aggregations, by));
  },

  eventstats: (args, offset) => {
    const stream = words(args, offset);
    const aggregations = parseAggregations(stream);
    const by = stream.isWord('by') ? (stream.next(), parseFieldList(stream)) : [];
    expectEnd(stream);
    return streaming((rows) => {
      for (const group of groupRows(rows, by)) {
        const values = aggregations.map((aggregation) => aggregate(aggregation, group.rows));
        for (const row of group.rows) aggregations.forEach((aggregation, index) => { row[aggregation.name] = values[index]; });
      }
      return { rows };
    });
  },

  streamstats: (args, offset) => {
    const stream = words(args, offset);
    const options = readOptions(stream, ['current', 'window', 'global']);
    const current = options.has('current') ? booleanOption(options.get('current')!) : true;
    const window = options.has('window') ? integerOption(options.get('window')!, 'window') : 0;
    const aggregations = parseAggregations(stream);
    const by = stream.isWord('by') ? (stream.next(), parseFieldList(stream)) : [];
    expectEnd(stream);
    return streaming((rows) => {
      const history = new Map<string, Row[]>();
      for (const row of rows) {
        const key = JSON.stringify(by.map((field) => toText(getField(row, field) ?? null)));
        const seen = history.get(key) ?? [];
        const scope = current ? [...seen, row] : [...seen];
        const windowed = window ? scope.slice(-window) : scope;
        const values = aggregations.map((aggregation) => aggregate(aggregation, windowed));
        seen.push({ ...row });
        history.set(key, seen);
        aggregations.forEach((aggregation, index) => {
          const value = values[index];
          if (value === null || (Array.isArray(value) && !value.length)) delete row[aggregation.name];
          else row[aggregation.name] = value;
        });
      }
      return { rows };
    });
  },

  table: (args, offset, name) => {
    const fields = parseFieldList(words(args, offset));
    if (!fields.length) throw new SplError('table necesita al menos un campo: table _time host user', name.start, name.end);
    return transforming((rows) => {
      const columns = expandFields(fields, collectFields(rows));
      return { rows: rows.map((row) => Object.fromEntries(columns.filter((column) => getField(row, column) !== undefined).map((column) => [column, getField(row, column)!]))), columns };
    });
  },

  fields: (args, offset, name) => {
    const stream = words(args, offset);
    let remove = false;
    if (stream.isWord('-') || stream.isWord('+')) remove = stream.next().value === '-';
    const raw = parseFieldList(stream);
    if (raw.length && raw[0].startsWith('-') && raw[0].length > 1) { remove = true; raw[0] = raw[0].slice(1); }
    if (!raw.length) throw new SplError('fields necesita al menos un campo: fields host user o fields - _raw', name.start, name.end);
    return streaming((rows) => {
      const selected = expandFields(raw, collectFields(rows));
      // Like Splunk, `fields a b` keeps _time and _raw unless they are removed explicitly.
      const keep = (field: string) => (remove ? !selected.includes(field) : selected.includes(field) || field === '_time' || field === '_raw');
      return {
        rows: rows.map((row) => Object.fromEntries(Object.entries(row).filter(([field]) => keep(field)))),
        columns: remove ? undefined : selected,
      };
    });
  },

  rename: (args, offset, name) => {
    const stream = words(args, offset);
    const pairs: { from: string; to: string }[] = [];
    while (!stream.atEnd()) {
      if (stream.is('comma')) { stream.next(); continue; }
      const from = stream.next();
      if (!stream.isWord('as')) throw new SplError('rename espera «campo as nuevo_nombre».', from.start, stream.peek().end);
      stream.next();
      const to = stream.next();
      if ((from.type !== 'word' && from.type !== 'string') || (to.type !== 'word' && to.type !== 'string')) throw new SplError('rename espera «campo as nuevo_nombre».', from.start, to.end);
      if (from.value.split('*').length !== to.value.split('*').length) throw new SplError('Los comodines de rename deben aparecer igual en ambos lados.', from.start, to.end);
      pairs.push({ from: from.value, to: to.value });
    }
    if (!pairs.length) throw new SplError('rename necesita al menos una pareja: rename src as origen', name.start, name.end);
    const renameField = (field: string): string => {
      for (const { from, to } of pairs) {
        if (!from.includes('*')) { if (field === from) return to; continue; }
        const match = new RegExp(`^${from.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*)')}$`).exec(field);
        if (match) { let index = 0; return to.replace(/\*/g, () => match[++index] ?? ''); }
      }
      return field;
    };
    return streaming((rows) => {
      const renamed = rows.map((row) => {
        const next: Row = {};
        for (const [field, value] of Object.entries(row)) next[renameField(field)] = value;
        for (const { from, to } of pairs) if (!from.includes('*') && !(from in row) && getField(row, from) !== undefined) next[to] = getField(row, from)!;
        return next;
      });
      return { rows: renamed, renameColumn: renameField };
    });
  },

  sort: (args, offset) => {
    const stream = words(args, offset);
    let limit = 10000;
    if (stream.isWord() && /^\d+$/.test(stream.peek().value)) limit = integerOption(stream.next(), 'El límite de sort');
    const limitOption = readOptions(stream, ['limit']).get('limit');
    if (limitOption) limit = integerOption(limitOption, 'limit');
    const keys: { field: string; descending: boolean }[] = [];
    let pendingSign: string | null = null;
    while (!stream.atEnd()) {
      const token = stream.next();
      if (token.type === 'comma') continue;
      if (token.type !== 'word' && token.type !== 'string') throw new SplError(`Argumento inesperado «${token.value}» en sort.`, token.start, token.end);
      if (token.value === '-' || token.value === '+') { pendingSign = token.value; continue; }
      if (['d', 'desc'].includes(token.value.toLowerCase()) && stream.atEnd() && keys.length) { for (const key of keys) key.descending = !key.descending; break; }
      let field = token.value;
      let descending = pendingSign === '-';
      if (/^[+-]./.test(field)) { descending = field[0] === '-'; field = field.slice(1); }
      if (/^(auto|str|ip|num)$/i.test(field) && stream.is('lparen')) {
        stream.next();
        field = stream.expect('word', 'un campo').value;
        stream.expect('rparen', '«)»');
      }
      keys.push({ field, descending });
      pendingSign = null;
    }
    if (!keys.length) throw new SplError('sort necesita al menos un campo: sort - _time', offset, offset + args.length);
    return streaming((rows) => {
      const sorted = rows.map((row, index) => ({ row, index })).sort((a, b) => {
        for (const { field, descending } of keys) {
          const order = compareValues(getField(a.row, field), getField(b.row, field));
          if (order) {
            const missing = getField(a.row, field) === undefined || getField(b.row, field) === undefined;
            return descending && !missing ? -order : order;
          }
        }
        return a.index - b.index;
      });
      return { rows: (limit ? sorted.slice(0, limit) : sorted).map(({ row }) => row) };
    });
  },

  head: (args, offset) => {
    const stream = words(args, offset);
    const options = readOptions(stream, ['limit', 'count']);
    let limit = 10;
    const option = options.get('limit') ?? options.get('count');
    if (option) limit = integerOption(option, 'limit');
    else if (!stream.atEnd()) limit = integerOption(stream.next(), 'head');
    expectEnd(stream);
    return streaming((rows) => ({ rows: rows.slice(0, limit) }));
  },

  tail: (args, offset) => {
    const stream = words(args, offset);
    const limit = stream.atEnd() ? 10 : integerOption(stream.next(), 'tail');
    expectEnd(stream);
    return streaming((rows) => ({ rows: limit ? rows.slice(-limit).reverse() : [] }));
  },

  reverse: (args, offset) => {
    expectEnd(words(args, offset));
    return streaming((rows) => ({ rows: [...rows].reverse() }));
  },

  dedup: (args, offset, name) => {
    const stream = words(args, offset);
    let keep = 1;
    if (stream.isWord() && /^\d+$/.test(stream.peek().value)) keep = integerOption(stream.next(), 'dedup', 1);
    const options = readOptions(stream, ['keepempty', 'consecutive']);
    const keepEmpty = options.has('keepempty') && booleanOption(options.get('keepempty')!);
    const consecutive = options.has('consecutive') && booleanOption(options.get('consecutive')!);
    const fields = parseFieldList(stream);
    if (!fields.length) throw new SplError('dedup necesita al menos un campo: dedup user', name.start, name.end);
    return streaming((rows) => {
      const counts = new Map<string, number>();
      let previous: string | undefined;
      const result = rows.filter((row) => {
        const values = fields.map((field) => getField(row, field));
        if (values.some((value) => value === undefined || value === null)) return keepEmpty;
        const key = JSON.stringify(values);
        if (consecutive) { const duplicate = key === previous; previous = key; return !duplicate; }
        const count = counts.get(key) ?? 0;
        counts.set(key, count + 1);
        return count < keep;
      });
      return { rows: result };
    });
  },

  top: (args, offset, name) => rareOrTop(args, offset, name, true),
  rare: (args, offset, name) => rareOrTop(args, offset, name, false),

  rex: (args, offset, name) => {
    const stream = words(args, offset);
    const options = readOptions(stream, ['field', 'max_match', 'mode']);
    if (options.get('mode')?.value === 'sed') throw new SplError('rex mode=sed no está soportado en este laboratorio.', options.get('mode')!.start, options.get('mode')!.end);
    const field = options.get('field')?.value ?? '_raw';
    const maxMatch = options.has('max_match') ? integerOption(options.get('max_match')!, 'max_match') : 1;
    const patternToken = stream.next();
    if (patternToken.type !== 'string') throw new SplError('rex necesita la expresión regular entre comillas: rex field=message "(?<usuario>\\w+)"', patternToken.type === 'eof' ? name.start : patternToken.start, patternToken.end);
    expectEnd(stream);
    const regex = compileRegex(patternToken.value, 'g', patternToken.start, patternToken.end);
    if (!/\(\?<[A-Za-z_]\w*>/.test(regex.source)) throw new SplError('rex necesita al menos un grupo con nombre, por ejemplo (?<usuario>\\w+).', patternToken.start, patternToken.end);
    return streaming((rows) => {
      for (const row of rows) {
        const input = toText(getField(row, field) ?? null);
        if (input === null) continue;
        const matches = [...input.matchAll(regex)].slice(0, maxMatch === 0 ? undefined : maxMatch);
        const extracted = new Map<string, string[]>();
        for (const match of matches) for (const [group, value] of Object.entries(match.groups ?? {})) if (value !== undefined) extracted.set(group, [...(extracted.get(group) ?? []), value]);
        for (const [group, values] of extracted) row[group] = fromList(values);
      }
      return { rows };
    });
  },

  regex: (args, offset, name) => {
    const stream = words(args, offset);
    let field = '_raw';
    let negate = false;
    if (stream.isWord() && stream.peek(1).type === 'op') {
      field = stream.next().value;
      const op = stream.next();
      if (op.value !== '=' && op.value !== '!=') throw new SplError('regex solo admite = o !=.', op.start, op.end);
      negate = op.value === '!=';
    }
    const patternToken = stream.next();
    if (patternToken.type !== 'string') throw new SplError('regex necesita la expresión entre comillas: regex message="cmd\\.exe"', patternToken.type === 'eof' ? name.start : patternToken.start, patternToken.end);
    expectEnd(stream);
    const regex = compileRegex(patternToken.value, '', patternToken.start, patternToken.end);
    return streaming((rows) => ({ rows: rows.filter((row) => { const values = asList(getField(row, field)); const matched = values.some((value) => regex.test(String(value))); return negate ? !matched : matched; }) }));
  },

  bin: (args, offset) => binParser(args, offset),
  bucket: (args, offset) => binParser(args, offset),

  timechart: (args, offset) => {
    const stream = words(args, offset);
    const allowed = ['span', 'limit', 'useother', 'usenull'];
    const options = readOptions(stream, allowed);
    const aggregations = parseAggregations(stream);
    let by: string | undefined;
    if (stream.isWord('by')) { stream.next(); by = stream.expect('word', 'un campo tras by').value; }
    for (const [key, value] of readOptions(stream, allowed)) options.set(key, value);
    expectEnd(stream);
    const span = options.has('span') ? durationOption(options.get('span')!, 'span') : undefined;
    const limit = options.has('limit') ? integerOption(options.get('limit')!, 'limit') : 10;
    const useOther = options.has('useother') ? booleanOption(options.get('useother')!) : true;
    return transforming((rows) => {
      const times = rows.map((row) => toNumber(row._time ?? null)).filter((time): time is number => time !== null);
      if (!times.length) return { rows: [], columns: ['_time'] };
      const size = span ?? autoSpan(Math.min(...times), Math.max(...times));
      const bucketOf = (time: number) => Math.floor(time / size) * size;
      const rowsWithBucket = rows.filter((row) => toNumber(row._time ?? null) !== null).map((row) => ({ ...row, _time: bucketOf(toNumber(row._time ?? null)!) }));
      return pivot(rowsWithBucket, '_time', by, aggregations, limit, useOther, { from: bucketOf(Math.min(...times)), to: bucketOf(Math.max(...times)), step: size });
    });
  },

  chart: (args, offset) => {
    const stream = words(args, offset);
    const options = readOptions(stream, ['limit', 'useother']);
    const limit = options.has('limit') ? integerOption(options.get('limit')!, 'limit') : 10;
    const useOther = options.has('useother') ? booleanOption(options.get('useother')!) : true;
    const aggregations = parseAggregations(stream, ['by', 'over']);
    let row: string | undefined;
    let column: string | undefined;
    if (stream.isWord('over')) {
      stream.next();
      row = stream.expect('word', 'un campo tras over').value;
      if (stream.isWord('by')) { stream.next(); column = stream.expect('word', 'un campo tras by').value; }
    } else if (stream.isWord('by')) {
      stream.next();
      const fields = parseFieldList(stream);
      if (!fields.length || fields.length > 2) throw new SplError('chart … by admite uno o dos campos.', offset, offset + args.length);
      [row, column] = fields;
    }
    expectEnd(stream);
    if (!row) return transforming((rows) => aggregateGroups(rows, aggregations, []));
    const rowField = row;
    return transforming((rows) => pivot(rows, rowField, column, aggregations, limit, useOther));
  },

  transaction: (args, offset, name) => {
    const stream = words(args, offset);
    const fields: string[] = [];
    const options = new Map<string, Token>();
    while (!stream.atEnd()) {
      if (stream.is('comma')) { stream.next(); continue; }
      const opts = readOptions(stream, ['maxspan', 'maxpause', 'maxevents', 'keepevicted', 'mvlist']);
      for (const [key, value] of opts) options.set(key, value);
      if (stream.atEnd()) break;
      const token = stream.next();
      if (token.type !== 'word' && token.type !== 'string') throw new SplError(`Argumento inesperado «${token.value}» en transaction.`, token.start, token.end);
      fields.push(token.value);
    }
    if (!fields.length) throw new SplError('transaction necesita al menos un campo con el que agrupar: transaction user maxspan=30m', name.start, name.end);
    const maxSpan = options.has('maxspan') ? durationOption(options.get('maxspan')!, 'maxspan') : Infinity;
    const maxPause = options.has('maxpause') ? durationOption(options.get('maxpause')!, 'maxpause') : Infinity;
    const maxEvents = options.has('maxevents') ? integerOption(options.get('maxevents')!, 'maxevents', 1) : 1000;
    return streaming((rows) => {
      const ordered = rows
        .filter((row) => fields.every((field) => asList(getField(row, field)).length))
        .map((row) => ({ row, time: toNumber(row._time ?? null) ?? 0 }))
        .sort((a, b) => a.time - b.time);
      const open = new Map<string, { rows: Row[]; start: number; last: number }>();
      const closed: { rows: Row[]; start: number; last: number }[] = [];
      for (const { row, time } of ordered) {
        const key = JSON.stringify(fields.map((field) => toText(getField(row, field) ?? null)));
        const current = open.get(key);
        if (current && (time - current.start > maxSpan || time - current.last > maxPause || current.rows.length >= maxEvents)) {
          closed.push(current);
          open.delete(key);
        }
        const target = open.get(key) ?? { rows: [], start: time, last: time };
        target.rows.push(row);
        target.last = time;
        open.set(key, target);
      }
      closed.push(...open.values());
      const merged = closed.map(mergeTransaction).sort((a, b) => compareValues(b._time, a._time));
      return { rows: merged };
    });
  },

  fillnull: (args, offset) => {
    const stream = words(args, offset);
    const options = readOptions(stream, ['value']);
    const fill: Scalar = options.get('value')?.value ?? 0;
    const fields = parseFieldList(stream);
    return streaming((rows) => {
      const targets = fields.length ? fields : collectFields(rows).filter((field) => !field.startsWith('_'));
      for (const row of rows) for (const field of targets) if (row[field] === undefined || row[field] === null || row[field] === '') row[field] = fill;
      return { rows };
    });
  },

  mvexpand: (args, offset, name) => {
    const stream = words(args, offset);
    const field = stream.next();
    if (field.type !== 'word') throw new SplError('mvexpand necesita un campo: mvexpand tags', name.start, name.end);
    const limit = readOptions(stream, ['limit']).get('limit');
    const max = limit ? integerOption(limit, 'limit', 1) : Infinity;
    expectEnd(stream);
    return streaming((rows) => ({
      rows: rows.flatMap((row) => {
        const value = getField(row, field.value);
        if (!Array.isArray(value)) return [row];
        return value.slice(0, max).map((item) => ({ ...row, [field.value]: item }));
      }),
    }));
  },
};

function rareOrTop(args: string, offset: number, name: Token, top: boolean): Omit<Command, 'name' | 'start' | 'end'> {
  const stream = words(args, offset);
  const allowed = ['limit', 'countfield', 'percentfield', 'showcount', 'showperc'];
  let leadingLimit: Token | undefined;
  if (stream.isWord() && /^\d+$/.test(stream.peek().value)) leadingLimit = stream.next();
  const options = readOptions(stream, allowed);
  const fields = parseFieldList(stream, ['by'], allowed);
  const by = stream.isWord('by') ? (stream.next(), parseFieldList(stream, [], allowed)) : [];
  for (const [key, value] of readOptions(stream, allowed)) options.set(key, value);
  expectEnd(stream);
  if (leadingLimit && !options.has('limit')) options.set('limit', leadingLimit);
  const limit = options.has('limit') ? integerOption(options.get('limit')!, 'limit') : 10;
  const countField = options.get('countfield')?.value ?? 'count';
  const percentField = options.get('percentfield')?.value ?? 'percent';
  const showCount = options.has('showcount') ? booleanOption(options.get('showcount')!) : true;
  const showPercent = options.has('showperc') ? booleanOption(options.get('showperc')!) : true;
  if (!fields.length) throw new SplError(`${name.value} necesita al menos un campo: ${name.value} user`, name.start, name.end);
  return transforming((rows) => {
    const output: Row[] = [];
    for (const outer of groupRows(rows, by)) {
      const inner = groupRows(outer.rows, fields);
      const total = inner.reduce((sum, group) => sum + group.rows.length, 0);
      inner.sort((a, b) => (top ? b.rows.length - a.rows.length : a.rows.length - b.rows.length));
      for (const group of limit ? inner.slice(0, limit) : inner) {
        const row: Row = {};
        by.forEach((field, index) => { row[field] = outer.values[index]; });
        fields.forEach((field, index) => { row[field] = group.values[index]; });
        if (showCount) row[countField] = group.rows.length;
        if (showPercent) row[percentField] = total ? Math.round((group.rows.length / total) * 100 * 1e6) / 1e6 : 0;
        output.push(row);
      }
    }
    return { rows: output, columns: [...by, ...fields, ...(showCount ? [countField] : []), ...(showPercent ? [percentField] : [])] };
  });
}

function binParser(args: string, offset: number): Omit<Command, 'name' | 'start' | 'end'> {
  const stream = words(args, offset);
  let options = readOptions(stream, ['span', 'bins']);
  const field = stream.isWord() ? stream.next().value : '_time';
  let alias = field;
  if (stream.isWord('as')) { stream.next(); alias = stream.expect('word', 'un nombre tras as').value; }
  options = new Map([...options, ...readOptions(stream, ['span', 'bins'])]);
  expectEnd(stream);
  const spanToken = options.get('span');
  const bins = options.has('bins') ? integerOption(options.get('bins')!, 'bins', 1) : 100;
  return streaming((rows) => {
    const values = rows.map((row) => toNumber(getField(row, field) ?? null)).filter((value): value is number => value !== null);
    if (!values.length) return { rows };
    let size: number;
    if (spanToken) size = field === '_time' ? durationOption(spanToken, 'span') : (toNumber(spanToken.value) ?? durationOption(spanToken, 'span'));
    else size = field === '_time' ? autoSpan(Math.min(...values), Math.max(...values), bins) : niceNumber((Math.max(...values) - Math.min(...values)) / bins);
    for (const row of rows) {
      const value = toNumber(getField(row, field) ?? null);
      if (value === null) continue;
      const start = Math.floor(value / size) * size;
      row[alias] = field === '_time' ? start : `${start}-${start + size}`;
    }
    return { rows };
  });
}

function niceNumber(raw: number): number {
  if (raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((step) => step * magnitude).find((step) => step >= raw) ?? 10 * magnitude;
}

const timeSpans = [1, 5, 10, 30, 60, 300, 600, 1800, 3600, 10800, 43200, 86400, 604800];

/** Picks the smallest round span that keeps the chart under the given number of buckets. */
export function autoSpan(from: number, to: number, buckets = 100): number {
  return timeSpans.find((span) => (to - from) / span < buckets) ?? 604800;
}

function pivot(rows: Row[], rowField: string, columnField: string | undefined, aggregations: Aggregation[], limit: number, useOther: boolean, fill?: { from: number; to: number; step: number }): CommandOutput {
  const rowGroups = groupRows(rows, [rowField]);
  const isCount = (aggregation: Aggregation) => aggregation.fn === 'count' || aggregation.fn === 'c' || aggregation.fn === 'dc' || aggregation.fn === 'distinct_count';
  let series: { name: string; aggregation: Aggregation; match?: (value: Scalar) => boolean }[];
  if (!columnField) series = aggregations.map((aggregation) => ({ name: aggregation.name, aggregation }));
  else {
    const totals = groupRows(rows, [columnField]).map((group) => ({ value: group.values[0], size: group.rows.length }));
    totals.sort((a, b) => b.size - a.size || compareValues(a.value, b.value));
    // The busiest series are kept; columns are then shown in alphabetical order, as Splunk does.
    const kept = (limit ? totals.slice(0, limit) : totals).sort((a, b) => compareValues(a.value, b.value));
    const keptKeys = new Set(kept.map((entry) => String(entry.value)));
    const label = (aggregation: Aggregation, value: string) => (aggregations.length > 1 ? `${aggregation.name}: ${value}` : value);
    series = aggregations.flatMap((aggregation) => [
      ...kept.map((entry) => ({ name: label(aggregation, String(entry.value)), aggregation, match: (value: Scalar) => String(value) === String(entry.value) })),
      ...(useOther && totals.length > kept.length ? [{ name: label(aggregation, 'OTHER'), aggregation, match: (value: Scalar) => !keptKeys.has(String(value)) }] : []),
    ]);
  }
  const byKey = new Map(rowGroups.map((group) => [String(group.values[0]), group]));
  const keys: Scalar[] = fill ? [] : rowGroups.map((group) => group.values[0]);
  if (fill) for (let time = fill.from; time <= fill.to; time += fill.step) keys.push(time);
  const output = keys.map((key) => {
    const members = byKey.get(String(key))?.rows ?? [];
    const row: Row = { [rowField]: key };
    for (const { name, aggregation, match } of series) {
      const scoped = match && columnField ? members.filter((member) => asList(getField(member, columnField)).some(match)) : members;
      const value = scoped.length ? aggregate(aggregation, scoped) : isCount(aggregation) ? 0 : null;
      if (value !== null) row[name] = value;
    }
    return row;
  });
  return { rows: output, columns: [rowField, ...series.map(({ name }) => name)] };
}

function mergeTransaction(transaction: { rows: Row[]; start: number; last: number }): Row {
  const merged: Row = {};
  const ordered = [...transaction.rows];
  const fields = collectFields(ordered).filter((field) => field !== '_raw' && field !== '_time');
  for (const field of fields) {
    const values: Scalar[] = [];
    for (const row of ordered) for (const value of asList(row[field])) if (!values.some((existing) => existing === value)) values.push(value);
    merged[field] = fromList(values);
  }
  merged._time = transaction.start;
  merged._raw = ordered.map((row) => toText(row._raw ?? null) ?? '').join('\n');
  merged.duration = Math.round((transaction.last - transaction.start) * 1000) / 1000;
  merged.eventcount = ordered.length;
  return merged;
}

const unsupported = new Set(['join', 'append', 'appendcols', 'appendpipe', 'lookup', 'inputlookup', 'outputlookup', 'iplocation', 'spath', 'tstats', 'datamodel', 'map', 'foreach', 'xyseries', 'untable', 'collect', 'delete', 'makeresults', 'geostats', 'predict', 'cluster', 'kmeans', 'addtotals', 'addcoltotals', 'eventcount', 'metadata', 'rest', 'convert', 'makemv', 'nomv', 'format', 'return', 'set', 'multisearch', 'union', 'tojson', 'fieldsummary']);

export const supportedCommands = Object.keys(parsers).sort();

/** Parses one pipeline segment into a runnable command. */
export function parseCommand(segment: Segment, isFirst: boolean): Command {
  const leading = segment.text.length - segment.text.trimStart().length;
  const text = segment.text.trim();
  const start = segment.start + leading;
  const end = start + text.length;
  if (!text) {
    throw new SplError(isFirst ? 'La búsqueda no puede empezar por «|»: empieza con términos de búsqueda, por ejemplo index=soc.' : 'Hay un «|» sin comando detrás.', Math.max(0, segment.start - 1), segment.start);
  }
  if (isFirst) {
    const explicit = /^search(\s|$)/i.exec(text);
    const args = explicit ? text.slice(explicit[0].length) : text;
    const argsStart = start + (explicit ? explicit[0].length : 0);
    return { name: 'search', start, end, ...parsers.search(args, argsStart, { type: 'word', value: 'search', start, end: start + 6 }) };
  }
  const match = /^[A-Za-z_]\w*/.exec(text);
  if (!match) throw new SplError(`«${text[0]}» no es un comando. Tras «|» va el nombre de un comando (stats, where, eval…).`, start, start + 1);
  const name = match[0].toLowerCase();
  const token: Token = { type: 'word', value: match[0], start, end: start + match[0].length };
  if (unsupported.has(name)) throw new SplError(`El comando ${name} existe en Splunk pero no está soportado en este laboratorio.`, token.start, token.end);
  const parser = parsers[name];
  if (!parser) throw new SplError(`Comando desconocido: ${match[0]}. Comandos disponibles: ${supportedCommands.join(', ')}.`, token.start, token.end);
  return { name, start, end, ...parser(text.slice(match[0].length), token.end, token) };
}
