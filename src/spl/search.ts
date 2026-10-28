import { getField } from './fields.js';
import { TokenStream, tokenizeWords, type Token } from './lexer.js';
import { asList, compareValues, SplError, termRegex, toNumber, wildcardRegex, type Row, type Scalar } from './values.js';

export type SearchNode =
  | { type: 'all' }
  | { type: 'and' | 'or'; nodes: SearchNode[] }
  | { type: 'not'; node: SearchNode }
  | { type: 'compare'; field: string; op: string; value: string }
  | { type: 'in'; field: string; values: string[] }
  | { type: 'term'; value: string };

const isKeyword = (stream: TokenStream, keyword: string) => stream.isWord(keyword, true);

/**
 * Parses the search language. As in Splunk, OR binds tighter than the implicit AND:
 * `a b OR c` means `a AND (b OR c)`. Boolean keywords must be uppercase.
 */
export function parseSearch(text: string, offset: number): SearchNode {
  const stream = new TokenStream(tokenizeWords(text, offset));
  if (stream.atEnd()) return { type: 'all' };
  const node = parseAnd(stream);
  if (!stream.atEnd()) {
    const token = stream.peek();
    throw new SplError(`No se esperaba «${token.value}» aquí.`, token.start, token.end);
  }
  return node;
}

function parseAnd(stream: TokenStream): SearchNode {
  const nodes = [parseOr(stream)];
  while (!stream.atEnd() && !stream.is('rparen')) {
    if (isKeyword(stream, 'AND')) stream.next();
    nodes.push(parseOr(stream));
  }
  return nodes.length === 1 ? nodes[0] : { type: 'and', nodes };
}

function parseOr(stream: TokenStream): SearchNode {
  const nodes = [parseNot(stream)];
  while (isKeyword(stream, 'OR')) {
    stream.next();
    nodes.push(parseNot(stream));
  }
  return nodes.length === 1 ? nodes[0] : { type: 'or', nodes };
}

function parseNot(stream: TokenStream): SearchNode {
  if (isKeyword(stream, 'NOT')) {
    stream.next();
    return { type: 'not', node: parseNot(stream) };
  }
  return parsePrimary(stream);
}

function parsePrimary(stream: TokenStream): SearchNode {
  const token = stream.peek();
  if (token.type === 'lparen') {
    stream.next();
    const node = parseAnd(stream);
    stream.expect('rparen', '«)»');
    return node;
  }
  if (token.type === 'string') {
    stream.next();
    return { type: 'term', value: token.value };
  }
  if (token.type !== 'word') {
    throw new SplError(token.type === 'eof' ? 'La búsqueda termina de forma incompleta.' : `No se esperaba «${token.value}» aquí.`, token.start, token.end);
  }
  if (['AND', 'OR'].includes(token.value)) throw new SplError(`Falta un término antes de ${token.value}.`, token.start, token.end);
  stream.next();
  const following = stream.peek();
  if (following.type === 'op') {
    stream.next();
    const value = stream.next();
    if (value.type !== 'word' && value.type !== 'string') throw new SplError(`Falta el valor tras ${token.value}${following.value}.`, value.start, value.end);
    return { type: 'compare', field: token.value, op: following.value, value: value.value };
  }
  if (following.type === 'word' && following.value.toUpperCase() === 'IN' && stream.peek(1).type === 'lparen') {
    stream.next();
    stream.next();
    return { type: 'in', field: token.value, values: readValueList(stream) };
  }
  return { type: 'term', value: token.value };
}

function readValueList(stream: TokenStream): string[] {
  const values: string[] = [];
  while (!stream.is('rparen')) {
    const token: Token = stream.next();
    if (token.type === 'comma') continue;
    if (token.type !== 'word' && token.type !== 'string') throw new SplError(token.type === 'eof' ? 'Falta «)» al cerrar IN (…).' : `Valor no válido en IN: «${token.value}».`, token.start, token.end);
    values.push(token.value);
  }
  stream.next();
  if (!values.length) throw new SplError('IN (…) necesita al menos un valor.');
  return values;
}

/** Splunk's field=value: case-insensitive, `*` wildcards, numeric when both sides are numbers. */
export function valueEquals(actual: Scalar, expected: string): boolean {
  if (actual === null) return false;
  if (expected.includes('*')) return wildcardRegex(expected).test(String(actual));
  const actualNumber = toNumber(actual);
  const expectedNumber = toNumber(expected);
  if (actualNumber !== null && expectedNumber !== null) return actualNumber === expectedNumber;
  return String(actual).toLowerCase() === expected.toLowerCase();
}

function fieldValues(row: Row, field: string): Scalar[] | undefined {
  if (!field.includes('*')) {
    const value = getField(row, field);
    return value === undefined || value === null ? undefined : asList(value);
  }
  const regex = wildcardRegex(field, '');
  const values = Object.keys(row).filter((key) => regex.test(key)).flatMap((key) => asList(row[key]));
  return values.length ? values : undefined;
}

export function matchesSearch(node: SearchNode, row: Row): boolean {
  switch (node.type) {
    case 'all': return true;
    case 'and': return node.nodes.every((child) => matchesSearch(child, row));
    case 'or': return node.nodes.some((child) => matchesSearch(child, row));
    case 'not': return !matchesSearch(node.node, row);
    case 'term': return termRegex(node.value).test(String(row._raw ?? ''));
    case 'in': {
      const values = fieldValues(row, node.field);
      return !!values && values.some((value) => node.values.some((expected) => valueEquals(value, expected)));
    }
    case 'compare': {
      const values = fieldValues(row, node.field);
      // Like Splunk, field!=value only matches events that actually have the field.
      if (!values) return false;
      if (node.op === '=') return values.some((value) => valueEquals(value, node.value));
      if (node.op === '!=') return !values.some((value) => valueEquals(value, node.value));
      return values.some((value) => {
        const order = compareValues(value, node.value);
        if (node.op === '<') return order < 0;
        if (node.op === '<=') return order <= 0;
        if (node.op === '>') return order > 0;
        return order >= 0;
      });
    }
  }
}
