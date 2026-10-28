import { SplError } from './values.js';

export type TokenType = 'word' | 'string' | 'number' | 'field' | 'op' | 'lparen' | 'rparen' | 'comma' | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

export interface Segment {
  text: string;
  start: number;
}

/** Splits a query on top-level pipes, leaving pipes inside quotes untouched. */
export function splitPipeline(query: string): Segment[] {
  const segments: Segment[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
    } else if (char === '"') quote = char;
    else if (char === '|') {
      segments.push({ text: query.slice(start, index), start });
      start = index + 1;
    }
  }
  if (quote) throw new SplError('Falta cerrar unas comillas.', query.lastIndexOf(quote), query.length);
  segments.push({ text: query.slice(start), start });
  return segments;
}

function readQuoted(text: string, index: number, offset: number, quote: string): { value: string; end: number } {
  let value = '';
  let cursor = index + 1;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '\\' && (text[cursor + 1] === quote || text[cursor + 1] === '\\')) {
      value += text[cursor + 1];
      cursor += 2;
      continue;
    }
    if (char === quote) return { value, end: cursor + 1 };
    value += char;
    cursor += 1;
  }
  throw new SplError('Falta cerrar unas comillas.', offset + index, offset + text.length);
}

const wordBreak = /[\s"(),=<>]/;

/** Tokenizer for search terms and command arguments, where `/`, `*`, `-` and `.` belong to words. */
export function tokenizeWords(text: string, offset: number): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const start = offset + index;
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === '"') {
      const { value, end } = readQuoted(text, index, offset, '"');
      tokens.push({ type: 'string', value, start, end: offset + end });
      index = end;
      continue;
    }
    if (char === '(') { tokens.push({ type: 'lparen', value: char, start, end: start + 1 }); index += 1; continue; }
    if (char === ')') { tokens.push({ type: 'rparen', value: char, start, end: start + 1 }); index += 1; continue; }
    if (char === ',') { tokens.push({ type: 'comma', value: char, start, end: start + 1 }); index += 1; continue; }
    const two = text.slice(index, index + 2);
    if (two === '!=' || two === '<=' || two === '>=' || two === '==') { tokens.push({ type: 'op', value: two === '==' ? '=' : two, start, end: start + 2 }); index += 2; continue; }
    if (char === '=' || char === '<' || char === '>') { tokens.push({ type: 'op', value: char, start, end: start + 1 }); index += 1; continue; }
    let end = index;
    while (end < text.length && !wordBreak.test(text[end]) && text.slice(end, end + 2) !== '!=') end += 1;
    tokens.push({ type: 'word', value: text.slice(index, end), start, end: offset + end });
    index = end;
  }
  tokens.push({ type: 'eof', value: '', start: offset + text.length, end: offset + text.length });
  return tokens;
}

const exprOperators = ['==', '!=', '<=', '>=', '=', '<', '>', '+', '-', '*', '/', '%', '.'];

/** Tokenizer for eval/where expressions, where arithmetic operators are significant. */
export function tokenizeExpression(text: string, offset: number): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const start = offset + index;
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === '"' || char === "'") {
      const { value, end } = readQuoted(text, index, offset, char);
      tokens.push({ type: char === '"' ? 'string' : 'field', value, start, end: offset + end });
      index = end;
      continue;
    }
    if (char === '(') { tokens.push({ type: 'lparen', value: char, start, end: start + 1 }); index += 1; continue; }
    if (char === ')') { tokens.push({ type: 'rparen', value: char, start, end: start + 1 }); index += 1; continue; }
    if (char === ',') { tokens.push({ type: 'comma', value: char, start, end: start + 1 }); index += 1; continue; }
    const number = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(text.slice(index));
    if (number) {
      tokens.push({ type: 'number', value: number[0], start, end: start + number[0].length });
      index += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_@$][\w@$]*(\.[\w@$]+)*/.exec(text.slice(index));
    if (identifier) {
      tokens.push({ type: 'word', value: identifier[0], start, end: start + identifier[0].length });
      index += identifier[0].length;
      continue;
    }
    const operator = exprOperators.find((candidate) => text.startsWith(candidate, index));
    if (!operator) throw new SplError(`Carácter inesperado «${char}» en la expresión.`, start, start + 1);
    tokens.push({ type: 'op', value: operator === '==' ? '=' : operator, start, end: start + operator.length });
    index += operator.length;
  }
  tokens.push({ type: 'eof', value: '', start: offset + text.length, end: offset + text.length });
  return tokens;
}

/** Cursor over a token list with the small helpers every parser here needs. */
export class TokenStream {
  index = 0;
  constructor(readonly tokens: Token[]) {}

  peek(ahead = 0): Token { return this.tokens[Math.min(this.index + ahead, this.tokens.length - 1)]; }
  next(): Token { const token = this.peek(); if (token.type !== 'eof') this.index += 1; return token; }
  atEnd(): boolean { return this.peek().type === 'eof'; }

  isWord(value?: string, caseSensitive = false): boolean {
    const token = this.peek();
    if (token.type !== 'word') return false;
    if (value === undefined) return true;
    return caseSensitive ? token.value === value : token.value.toLowerCase() === value.toLowerCase();
  }

  is(type: TokenType, value?: string): boolean {
    const token = this.peek();
    return token.type === type && (value === undefined || token.value === value);
  }

  expect(type: TokenType, description: string, value?: string): Token {
    if (!this.is(type, value)) {
      const token = this.peek();
      throw new SplError(token.type === 'eof' ? `Falta ${description} al final.` : `Se esperaba ${description} y aparece «${token.value}».`, token.start, token.end);
    }
    return this.next();
  }

  /** Reads `name=value` when the next tokens are exactly that option. */
  option(name: string): Token | undefined {
    if (!this.isWord(name) || !(this.peek(1).type === 'op' && this.peek(1).value === '=')) return undefined;
    this.next();
    this.next();
    const value = this.next();
    if (value.type !== 'word' && value.type !== 'string') throw new SplError(`Falta el valor de ${name}=.`, value.start, value.end);
    return value;
  }
}
