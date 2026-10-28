import { getField } from './fields.js';
import { TokenStream, tokenizeExpression, type Token } from './lexer.js';
import { formatTime, parseTime } from './time.js';
import { asList, fromList, isMulti, SplError, toNumber, toText, type Row, type Scalar, type Value } from './values.js';

export type Expr =
  | { type: 'literal'; value: Scalar }
  | { type: 'field'; name: string; start: number; end: number }
  | { type: 'unary'; op: string; operand: Expr }
  | { type: 'binary'; op: string; left: Expr; right: Expr }
  | { type: 'in'; operand: Expr; values: Expr[] }
  | { type: 'call'; name: string; args: Expr[]; start: number; end: number };

/** Field references seen while evaluating, so the engine can warn about bare words that name no field. */
export interface EvalTrace { referenced: Map<string, Token>; found: Set<string> }

export function parseExpression(text: string, offset: number): Expr {
  const stream = new TokenStream(tokenizeExpression(text, offset));
  const expr = parseExpressionFrom(stream);
  if (!stream.atEnd()) {
    const token = stream.peek();
    throw new SplError(`No se esperaba «${token.value}» en la expresión.`, token.start, token.end);
  }
  return expr;
}

export function parseExpressionFrom(stream: TokenStream): Expr {
  if (stream.atEnd()) {
    const token = stream.peek();
    throw new SplError('Falta una expresión.', token.start, token.end);
  }
  return parseOr(stream);
}

const keyword = (stream: TokenStream, word: string) => stream.isWord(word) && stream.peek(1).type !== 'lparen';

function parseOr(stream: TokenStream): Expr {
  let left = parseXor(stream);
  while (stream.isWord('OR')) { stream.next(); left = { type: 'binary', op: 'OR', left, right: parseXor(stream) }; }
  return left;
}

function parseXor(stream: TokenStream): Expr {
  let left = parseAnd(stream);
  while (stream.isWord('XOR')) { stream.next(); left = { type: 'binary', op: 'XOR', left, right: parseAnd(stream) }; }
  return left;
}

function parseAnd(stream: TokenStream): Expr {
  let left = parseNot(stream);
  while (stream.isWord('AND')) { stream.next(); left = { type: 'binary', op: 'AND', left, right: parseNot(stream) }; }
  return left;
}

function parseNot(stream: TokenStream): Expr {
  if (stream.isWord('NOT')) { stream.next(); return { type: 'unary', op: 'NOT', operand: parseNot(stream) }; }
  return parseComparison(stream);
}

function parseComparison(stream: TokenStream): Expr {
  const left = parseAdditive(stream);
  const token = stream.peek();
  if (token.type === 'op' && ['=', '!=', '<', '<=', '>', '>='].includes(token.value)) {
    stream.next();
    return { type: 'binary', op: token.value, left, right: parseAdditive(stream) };
  }
  if (keyword(stream, 'LIKE')) {
    stream.next();
    return { type: 'binary', op: 'LIKE', left, right: parseAdditive(stream) };
  }
  if (stream.isWord('IN') && stream.peek(1).type === 'lparen') {
    stream.next();
    stream.next();
    const values: Expr[] = [];
    while (!stream.is('rparen')) {
      values.push(parseAdditive(stream));
      if (!stream.is('rparen')) stream.expect('comma', '«,» o «)»');
    }
    stream.next();
    return { type: 'in', operand: left, values };
  }
  return left;
}

function parseAdditive(stream: TokenStream): Expr {
  let left = parseMultiplicative(stream);
  while (stream.is('op', '+') || stream.is('op', '-') || stream.is('op', '.')) {
    const op = stream.next().value;
    left = { type: 'binary', op, left, right: parseMultiplicative(stream) };
  }
  return left;
}

function parseMultiplicative(stream: TokenStream): Expr {
  let left = parseUnary(stream);
  while (stream.is('op', '*') || stream.is('op', '/') || stream.is('op', '%')) {
    const op = stream.next().value;
    left = { type: 'binary', op, left, right: parseUnary(stream) };
  }
  return left;
}

function parseUnary(stream: TokenStream): Expr {
  if (stream.is('op', '-')) { stream.next(); return { type: 'unary', op: '-', operand: parseUnary(stream) }; }
  if (stream.is('op', '+')) { stream.next(); return parseUnary(stream); }
  return parsePrimary(stream);
}

function parsePrimary(stream: TokenStream): Expr {
  const token = stream.next();
  if (token.type === 'number') return { type: 'literal', value: Number(token.value) };
  if (token.type === 'string') return { type: 'literal', value: token.value };
  if (token.type === 'field') return { type: 'field', name: token.value, start: token.start, end: token.end };
  if (token.type === 'lparen') {
    const expr = parseOr(stream);
    stream.expect('rparen', '«)»');
    return expr;
  }
  if (token.type === 'word') {
    if (stream.is('lparen')) {
      const name = token.value.toLowerCase();
      if (!(name in functions)) throw new SplError(`La función ${token.value}() no existe o no está soportada.`, token.start, token.end);
      stream.next();
      const args: Expr[] = [];
      while (!stream.is('rparen')) {
        args.push(parseOr(stream));
        if (!stream.is('rparen')) stream.expect('comma', '«,» o «)»');
      }
      const close = stream.next();
      const [min, max] = functions[name].arity;
      if (args.length < min || args.length > max) {
        const expected = min === max ? `${min}` : max === Infinity ? `al menos ${min}` : `entre ${min} y ${max}`;
        throw new SplError(`${token.value}() necesita ${expected} argumento(s).`, token.start, close.end);
      }
      return { type: 'call', name, args, start: token.start, end: close.end };
    }
    return { type: 'field', name: token.value, start: token.start, end: token.end };
  }
  throw new SplError(token.type === 'eof' ? 'La expresión termina de forma incompleta.' : `No se esperaba «${token.value}» en la expresión.`, token.start, token.end);
}

export interface EvalContext { row: Row; now: number; trace?: EvalTrace }

const first = (value: Value): Scalar => (isMulti(value) ? value[0] ?? null : value);

function looseEquals(left: Scalar, right: Scalar): boolean {
  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber === rightNumber;
  return String(left) === String(right);
}

function order(left: Scalar, right: Scalar): number {
  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function likeRegex(pattern: string): RegExp {
  const body = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${body}$`, 's');
}

/** Compiles a PCRE-style pattern: accepts Python-style `(?P<name>…)` groups and a leading `(?i)`. */
export function compileRegex(pattern: string, flags = '', start = 0, end = start): RegExp {
  let source = pattern.replace(/\(\?P</g, '(?<');
  if (source.startsWith('(?i)')) {
    source = source.slice(4);
    if (!flags.includes('i')) flags += 'i';
  }
  try {
    return new RegExp(source, flags);
  } catch (error) {
    throw new SplError(`Expresión regular no válida: ${(error as Error).message}`, start, end);
  }
}

export function evaluate(expr: Expr, context: EvalContext): Value {
  switch (expr.type) {
    case 'literal': return expr.value;
    case 'field': {
      const value = getField(context.row, expr.name);
      if (context.trace) {
        if (!context.trace.referenced.has(expr.name)) context.trace.referenced.set(expr.name, { type: 'word', value: expr.name, start: expr.start, end: expr.end });
        if (value !== undefined) context.trace.found.add(expr.name);
      }
      return value ?? null;
    }
    case 'unary': {
      const value = first(evaluate(expr.operand, context));
      if (expr.op === 'NOT') return value === null ? null : !truthy(value);
      const number = toNumber(value);
      return number === null ? null : -number;
    }
    case 'in': {
      const value = first(evaluate(expr.operand, context));
      if (value === null) return false;
      return expr.values.some((candidate) => asList(evaluate(candidate, context)).some((item) => looseEquals(value, item)));
    }
    case 'call': return functions[expr.name].run(expr.args, context);
    case 'binary': return evaluateBinary(expr, context);
  }
}

function truthy(value: Value): boolean {
  if (isMulti(value)) return value.length > 0;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value !== null && value !== '';
}

function evaluateBinary(expr: Extract<Expr, { type: 'binary' }>, context: EvalContext): Value {
  if (expr.op === 'AND' || expr.op === 'OR' || expr.op === 'XOR') {
    const left = truthy(evaluate(expr.left, context));
    if (expr.op === 'AND' && !left) return false;
    if (expr.op === 'OR' && left) return true;
    const right = truthy(evaluate(expr.right, context));
    return expr.op === 'XOR' ? left !== right : right;
  }
  const leftValue = evaluate(expr.left, context);
  const rightValue = evaluate(expr.right, context);
  if (['=', '!=', '<', '<=', '>', '>='].includes(expr.op)) {
    // Multivalue fields match when any of their values satisfies the comparison.
    const lefts = asList(leftValue);
    const right = first(rightValue);
    if (!lefts.length || right === null) return false;
    return lefts.some((left) => {
      if (expr.op === '=') return looseEquals(left, right);
      if (expr.op === '!=') return !looseEquals(left, right);
      const result = order(left, right);
      return expr.op === '<' ? result < 0 : expr.op === '<=' ? result <= 0 : expr.op === '>' ? result > 0 : result >= 0;
    });
  }
  const left = first(leftValue);
  const right = first(rightValue);
  if (left === null || right === null) return null;
  if (expr.op === 'LIKE') return likeRegex(String(right)).test(String(left));
  if (expr.op === '.') return `${left}${right}`;
  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);
  if (expr.op === '+' && (leftNumber === null || rightNumber === null)) return `${left}${right}`;
  if (leftNumber === null || rightNumber === null) throw new SplError(`El operador ${expr.op} necesita números y recibe «${left}» y «${right}».`);
  switch (expr.op) {
    case '+': return leftNumber + rightNumber;
    case '-': return leftNumber - rightNumber;
    case '*': return leftNumber * rightNumber;
    case '/': return rightNumber === 0 ? null : leftNumber / rightNumber;
    default: return rightNumber === 0 ? null : leftNumber % rightNumber;
  }
}

interface FunctionSpec { arity: [number, number]; run: (args: Expr[], context: EvalContext) => Value }

const value = (args: Expr[], index: number, context: EvalContext): Value => (index < args.length ? evaluate(args[index], context) : null);
const scalar = (args: Expr[], index: number, context: EvalContext): Scalar => first(value(args, index, context));
const text = (args: Expr[], index: number, context: EvalContext): string | null => toText(scalar(args, index, context));
const number = (args: Expr[], index: number, context: EvalContext): number | null => toNumber(scalar(args, index, context));

function numeric(fn: (input: number, args: Expr[], context: EvalContext) => number | null, arity: [number, number] = [1, 1]): FunctionSpec {
  return { arity, run: (args, context) => { const input = number(args, 0, context); return input === null ? null : fn(input, args, context); } };
}

function textual(fn: (input: string, args: Expr[], context: EvalContext) => Value, arity: [number, number] = [1, 1]): FunctionSpec {
  return { arity, run: (args, context) => { const input = text(args, 0, context); return input === null ? null : fn(input, args, context); } };
}

function trimChars(input: string, chars: string | null, side: 'both' | 'left' | 'right'): string {
  const set = chars ?? ' \t\n\r';
  let start = 0;
  let end = input.length;
  if (side !== 'right') while (start < end && set.includes(input[start])) start += 1;
  if (side !== 'left') while (end > start && set.includes(input[end - 1])) end -= 1;
  return input.slice(start, end);
}

function ipToNumber(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((total, part) => total * 256 + Number(part), 0);
}

export function cidrMatch(cidr: string, ip: string): boolean {
  const [network, bitsText = '32'] = cidr.split('/');
  const base = ipToNumber(network);
  const address = ipToNumber(ip);
  const bits = Number(bitsText);
  if (base === null || address === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const size = 2 ** (32 - bits);
  return Math.floor(address / size) === Math.floor(base / size);
}

const functions: Record<string, FunctionSpec> = {
  if: { arity: [3, 3], run: (args, context) => (truthy(value(args, 0, context)) ? value(args, 1, context) : value(args, 2, context)) },
  case: {
    arity: [2, Infinity],
    run: (args, context) => {
      if (args.length % 2) throw new SplError('case() necesita pares condición, valor.');
      for (let index = 0; index < args.length; index += 2) if (truthy(value(args, index, context))) return value(args, index + 1, context);
      return null;
    },
  },
  coalesce: { arity: [1, Infinity], run: (args, context) => { for (let index = 0; index < args.length; index += 1) { const result = value(args, index, context); if (result !== null && !(isMulti(result) && !result.length)) return result; } return null; } },
  nullif: { arity: [2, 2], run: (args, context) => { const left = scalar(args, 0, context); const right = scalar(args, 1, context); return left !== null && right !== null && looseEquals(left, right) ? null : left; } },
  null: { arity: [0, 0], run: () => null },
  true: { arity: [0, 0], run: () => true },
  false: { arity: [0, 0], run: () => false },
  isnull: { arity: [1, 1], run: (args, context) => scalar(args, 0, context) === null },
  isnotnull: { arity: [1, 1], run: (args, context) => scalar(args, 0, context) !== null },
  isnum: { arity: [1, 1], run: (args, context) => toNumber(scalar(args, 0, context)) !== null },
  isstr: { arity: [1, 1], run: (args, context) => typeof scalar(args, 0, context) === 'string' },
  typeof: { arity: [1, 1], run: (args, context) => { const input = scalar(args, 0, context); return input === null ? 'Invalid' : typeof input === 'number' ? 'Number' : typeof input === 'boolean' ? 'Boolean' : 'String'; } },
  in: { arity: [2, Infinity], run: (args, context) => { const input = scalar(args, 0, context); return input !== null && args.slice(1).some((_, index) => asList(value(args, index + 1, context)).some((item) => looseEquals(input, item))); } },
  like: { arity: [2, 2], run: (args, context) => { const input = text(args, 0, context); const pattern = text(args, 1, context); return input !== null && pattern !== null && likeRegex(pattern).test(input); } },
  match: { arity: [2, 2], run: (args, context) => { const input = text(args, 0, context); const pattern = text(args, 1, context); return input !== null && pattern !== null && compileRegex(pattern).test(input); } },
  cidrmatch: { arity: [2, 2], run: (args, context) => { const cidr = text(args, 0, context); const ip = text(args, 1, context); return cidr !== null && ip !== null && cidrMatch(cidr, ip); } },
  len: textual((input) => input.length),
  lower: textual((input) => input.toLowerCase()),
  upper: textual((input) => input.toUpperCase()),
  trim: textual((input, args, context) => trimChars(input, text(args, 1, context), 'both'), [1, 2]),
  ltrim: textual((input, args, context) => trimChars(input, text(args, 1, context), 'left'), [1, 2]),
  rtrim: textual((input, args, context) => trimChars(input, text(args, 1, context), 'right'), [1, 2]),
  substr: textual((input, args, context) => {
    const start = number(args, 1, context) ?? 1;
    const length = number(args, 2, context);
    const from = start > 0 ? start - 1 : Math.max(0, input.length + start);
    return length === null ? input.slice(from) : input.slice(from, from + length);
  }, [2, 3]),
  replace: textual((input, args, context) => {
    const pattern = text(args, 1, context);
    const replacement = text(args, 2, context);
    if (pattern === null || replacement === null) return null;
    return input.replace(compileRegex(pattern, 'g'), replacement.replace(/\\(\d)/g, '$$$1'));
  }, [3, 3]),
  split: textual((input, args, context) => { const delimiter = text(args, 1, context) ?? ''; return fromList(input.split(delimiter)); }, [2, 2]),
  urldecode: textual((input) => { try { return decodeURIComponent(input.replace(/\+/g, ' ')); } catch { return input; } }),
  tostring: {
    arity: [1, 2],
    run: (args, context) => {
      const input = scalar(args, 0, context);
      if (input === null) return null;
      const format = text(args, 1, context);
      const asNumber = toNumber(input);
      if (format === 'hex' && asNumber !== null) return `0x${Math.trunc(asNumber).toString(16).toUpperCase()}`;
      if (format === 'commas' && asNumber !== null) return asNumber.toLocaleString('en-US', { maximumFractionDigits: 2 });
      if (format === 'duration' && asNumber !== null) {
        const total = Math.trunc(asNumber);
        const pad = (part: number) => String(part).padStart(2, '0');
        const days = Math.floor(total / 86400);
        const clock = `${pad(Math.floor((total % 86400) / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
        return days ? `${days}+${clock}` : clock;
      }
      return String(input);
    },
  },
  tonumber: {
    arity: [1, 2],
    run: (args, context) => {
      const input = text(args, 0, context);
      if (input === null) return null;
      const base = number(args, 1, context) ?? 10;
      if (base === 10) return toNumber(input);
      const parsed = parseInt(input.replace(/^0x/i, ''), base);
      return Number.isNaN(parsed) ? null : parsed;
    },
  },
  abs: numeric(Math.abs),
  ceil: numeric(Math.ceil),
  ceiling: numeric(Math.ceil),
  floor: numeric(Math.floor),
  sqrt: numeric((input) => (input < 0 ? null : Math.sqrt(input))),
  exp: numeric(Math.exp),
  ln: numeric((input) => (input <= 0 ? null : Math.log(input))),
  log: numeric((input, args, context) => { const base = number(args, 1, context) ?? 10; return input <= 0 ? null : Math.log(input) / Math.log(base); }, [1, 2]),
  pow: numeric((input, args, context) => { const exponent = number(args, 1, context); return exponent === null ? null : input ** exponent; }, [2, 2]),
  round: numeric((input, args, context) => { const digits = number(args, 1, context) ?? 0; const factor = 10 ** digits; return Math.round(input * factor) / factor; }, [1, 2]),
  min: { arity: [1, Infinity], run: (args, context) => extreme(args, context, -1) },
  max: { arity: [1, Infinity], run: (args, context) => extreme(args, context, 1) },
  mvcount: { arity: [1, 1], run: (args, context) => { const input = value(args, 0, context); return input === null ? null : asList(input).length; } },
  mvindex: {
    arity: [2, 3],
    run: (args, context) => {
      const list = asList(value(args, 0, context));
      const resolve = (index: number) => (index < 0 ? list.length + index : index);
      const start = number(args, 1, context);
      if (start === null) return null;
      const end = number(args, 2, context);
      if (end === null) return list[resolve(start)] ?? null;
      return fromList(list.slice(resolve(start), resolve(end) + 1));
    },
  },
  mvjoin: { arity: [2, 2], run: (args, context) => { const list = asList(value(args, 0, context)); return list.length ? list.join(text(args, 1, context) ?? '') : null; } },
  mvappend: { arity: [1, Infinity], run: (args, context) => fromList(args.flatMap((_, index) => asList(value(args, index, context)))) },
  mvdedup: { arity: [1, 1], run: (args, context) => fromList([...new Set(asList(value(args, 0, context)))]) },
  mvsort: { arity: [1, 1], run: (args, context) => fromList(asList(value(args, 0, context)).map(String).sort()) },
  now: { arity: [0, 0], run: (_, context) => context.now },
  time: { arity: [0, 0], run: () => Date.now() / 1000 },
  strftime: { arity: [2, 2], run: (args, context) => { const time = number(args, 0, context); const format = text(args, 1, context); return time === null || format === null ? null : formatTime(time, format); } },
  strptime: { arity: [2, 2], run: (args, context) => { const input = text(args, 0, context); const format = text(args, 1, context); return input === null || format === null ? null : parseTime(input, format); } },
};

function extreme(args: Expr[], context: EvalContext, direction: 1 | -1): Value {
  let best: Scalar = null;
  for (let index = 0; index < args.length; index += 1) {
    for (const item of asList(value(args, index, context))) {
      if (best === null || order(item, best) * direction > 0) best = item;
    }
  }
  return best;
}

export const supportedFunctions = Object.keys(functions).sort();
