/** Field values as SPL sees them: scalars or multivalue lists. */
export type Scalar = string | number | boolean | null;
export type Value = Scalar | Scalar[];
export type Row = Record<string, Value>;

/** A syntax or runtime error, with the character range of the query that caused it. */
export class SplError extends Error {
  constructor(message: string, public readonly start = 0, public readonly end = start) {
    super(message);
    this.name = 'SplError';
  }
}

export const isMulti = (value: Value | undefined): value is Scalar[] => Array.isArray(value);

export function asList(value: Value | undefined): Scalar[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.filter((item) => item !== null) : [value];
}

/** Collapses a list back into the most natural value: null, a scalar or a multivalue. */
export function fromList(values: Scalar[]): Value {
  if (!values.length) return null;
  return values.length === 1 ? values[0] : values;
}

export function toNumber(value: Value | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return null;
    return Number(trimmed);
  }
  return null;
}

export function toText(value: Value | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map((item) => toText(item) ?? '').join('\n');
  return String(value);
}

/** SPL "auto" ordering: numbers numerically, everything else lexicographically, nulls last. */
export function compareValues(a: Value | undefined, b: Value | undefined): number {
  const left = Array.isArray(a) ? a[0] : a;
  const right = Array.isArray(b) ? b[0] : b;
  const leftMissing = left === undefined || left === null;
  const rightMissing = right === undefined || right === null;
  if (leftMissing || rightMissing) return leftMissing === rightMissing ? 0 : leftMissing ? 1 : -1;
  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Converts an SPL wildcard pattern (`*` matches anything) into an anchored, case-insensitive regex. */
export function wildcardRegex(pattern: string, flags = 'i'): RegExp {
  return new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`, flags);
}

/** Matches a free-text term the way Splunk's segmenter does: bounded by punctuation or whitespace, never inside a word. */
export function termRegex(term: string): RegExp {
  const body = term.split('*').map(escapeRegex).join('[^\\s"]*');
  return new RegExp(`(^|[^A-Za-z0-9])${body}($|[^A-Za-z0-9])`, 'i');
}

const durationUnits: Record<string, number> = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  d: 86400, day: 86400, days: 86400,
  w: 604800, week: 604800, weeks: 604800,
};

/** Parses `30s`, `5m`, `1h`, `2d`… into seconds. */
export function parseDuration(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?)([a-z]*)$/i.exec(text.trim());
  if (!match) return null;
  const unit = match[2].toLowerCase() || 's';
  const factor = durationUnits[unit];
  return factor === undefined ? null : Number(match[1]) * factor;
}

export function formatDuration(seconds: number): string {
  const units: [number, string][] = [[86400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']];
  for (const [size, unit] of units) if (seconds >= size && seconds % size === 0) return `${seconds / size}${unit}`;
  return `${seconds}s`;
}
