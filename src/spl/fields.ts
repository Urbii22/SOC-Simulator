import type { SecurityEvent } from '../domain/types.js';
import type { Row, Value } from './values.js';
import { wildcardRegex } from './values.js';

export const INDEX_NAME = 'soc';

/**
 * Turns a lab event into a Splunk-style result: the event's own fields, `details.*`
 * flattened as JSON extraction would, plus the default fields `_time`, `_raw`,
 * `index` and `sourcetype`.
 */
export function eventToRow(event: SecurityEvent): Row {
  const row: Row = {
    _time: Date.parse(event.timestamp) / 1000,
    _raw: JSON.stringify(event),
    index: INDEX_NAME,
    sourcetype: event.source,
  };
  for (const [key, value] of Object.entries(event)) {
    if (key === 'details' || value === undefined) continue;
    row[key] = Array.isArray(value) ? [...value] : value as Value;
  }
  for (const [key, value] of Object.entries(event.details)) row[`details.${key}`] = value;
  return row;
}

/** Reads a field; `process` falls back to `details.process` so either spelling works. */
export function getField(row: Row, name: string): Value | undefined {
  if (name in row) return row[name];
  const nested = `details.${name}`;
  return nested in row ? row[nested] : undefined;
}

/** Field names present across rows, in first-seen order. */
export function collectFields(rows: Row[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

/** Expands field patterns such as `details.*` against the available field names. */
export function expandFields(patterns: string[], available: string[]): string[] {
  const result: string[] = [];
  for (const pattern of patterns) {
    if (!pattern.includes('*')) {
      if (!result.includes(pattern)) result.push(pattern);
      continue;
    }
    const regex = wildcardRegex(pattern, '');
    for (const field of available) if (regex.test(field) && !result.includes(field)) result.push(field);
  }
  return result;
}
