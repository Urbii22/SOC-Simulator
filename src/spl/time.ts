const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (value: number, size = 2) => String(value).padStart(size, '0');

/** strftime over UTC: the lab's telemetry is recorded in UTC and the console shows it that way. */
export function formatTime(epochSeconds: number, format: string): string {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const tokens: Record<string, () => string> = {
    Y: () => String(date.getUTCFullYear()),
    y: () => pad(date.getUTCFullYear() % 100),
    m: () => pad(date.getUTCMonth() + 1),
    d: () => pad(date.getUTCDate()),
    e: () => String(date.getUTCDate()).padStart(2, ' '),
    H: () => pad(date.getUTCHours()),
    I: () => pad(date.getUTCHours() % 12 || 12),
    p: () => (date.getUTCHours() < 12 ? 'AM' : 'PM'),
    M: () => pad(date.getUTCMinutes()),
    S: () => pad(date.getUTCSeconds()),
    b: () => monthNames[date.getUTCMonth()],
    B: () => date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }),
    a: () => dayNames[date.getUTCDay()],
    A: () => date.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' }),
    j: () => pad(Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86400000) + 1, 3),
    w: () => String(date.getUTCDay()),
    s: () => String(Math.floor(epochSeconds)),
    F: () => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    T: () => `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
    z: () => '+0000',
    Z: () => 'UTC',
    '%': () => '%',
  };
  return format.replace(/%(\d?N|[A-Za-z%])/g, (match, token: string) => {
    if (token.endsWith('N')) {
      const digits = Number(token.slice(0, -1) || 9);
      return pad(date.getUTCMilliseconds(), 3).padEnd(9, '0').slice(0, digits);
    }
    return tokens[token]?.() ?? match;
  });
}

/** Inverse of formatTime for the common numeric directives; returns epoch seconds or null. */
export function parseTime(input: string, format: string): number | null {
  const parts = { Y: 1970, m: 1, d: 1, H: 0, M: 0, S: 0, ms: 0 };
  let pattern = '';
  const order: string[] = [];
  for (let index = 0; index < format.length; index += 1) {
    const char = format[index];
    if (char !== '%') { pattern += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    const token = format[index + 1];
    index += 1;
    if (token === 'Y') { pattern += '(\\d{4})'; order.push('Y'); }
    else if (['m', 'd', 'H', 'M', 'S'].includes(token)) { pattern += '(\\d{1,2})'; order.push(token); }
    else if (token === 'y') { pattern += '(\\d{2})'; order.push('y'); }
    else if (token === 'b') { pattern += '([A-Za-z]{3})'; order.push('b'); }
    else if (token === 'T') { pattern += '(\\d{1,2}):(\\d{1,2}):(\\d{1,2})'; order.push('H', 'M', 'S'); }
    else if (token === 'F') { pattern += '(\\d{4})-(\\d{1,2})-(\\d{1,2})'; order.push('Y', 'm', 'd'); }
    else if (/^\d?N$/.test(format.slice(index, index + 2)) || token === 'N') {
      if (token !== 'N') index += 1;
      pattern += '(\\d+)';
      order.push('N');
    } else if (token === 'z' || token === 'Z') pattern += '(?:Z|UTC|[+-]\\d{2}:?\\d{2})';
    else if (token === '%') pattern += '%';
    else return null;
  }
  const match = new RegExp(`^${pattern}$`, 'i').exec(input.trim());
  if (!match) return null;
  order.forEach((token, index) => {
    const raw = match[index + 1];
    if (token === 'y') parts.Y = 2000 + Number(raw);
    else if (token === 'b') parts.m = monthNames.findIndex((name) => name.toLowerCase() === raw.toLowerCase()) + 1;
    else if (token === 'N') parts.ms = Number(raw.padEnd(3, '0').slice(0, 3));
    else parts[token as 'Y' | 'm' | 'd' | 'H' | 'M' | 'S'] = Number(raw);
  });
  if (parts.m < 1) return null;
  return Date.UTC(parts.Y, parts.m - 1, parts.d, parts.H, parts.M, parts.S, parts.ms) / 1000;
}
