import { splitPipeline } from './lexer.js';

/** Adds `field="value"` to the base search, before the first pipe, like clicking a value in Splunk. */
export function addSearchFilter(query: string, field: string, value: string, exclude = false): string {
  const term = `${exclude ? 'NOT ' : ''}${field}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  let segments;
  try { segments = splitPipeline(query); } catch { return `${query} ${term}`; }
  const base = segments[0].text.trim() || 'index=soc';
  const rest = query.slice(segments[0].text.length + segments[0].start);
  return `${base} ${term}${rest ? ` ${rest.trimStart()}` : ''}`;
}
