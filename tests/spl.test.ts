import { describe, expect, it } from 'vitest';
import type { SecurityEvent } from '../src/domain/types.js';
import { generateProceduralScenario } from '../src/procedural/engine.js';
import { proceduralTemplates } from '../src/procedural/templates.js';
import { scenarioDefinitions } from '../src/scenarios/definitions.js';
import { generateScenarioEvents } from '../src/scenarios/generator.js';
import { formatTime, runSpl, SplError, summarizeFields } from '../src/spl/index.js';

const base = Date.parse('2026-03-01T10:00:00Z');

function event(minute: number, fields: Partial<SecurityEvent> & { details?: SecurityEvent['details'] }): SecurityEvent {
  return {
    id: `evt-${minute}`, scenarioId: 'lab', timestamp: new Date(base + minute * 60_000).toISOString(), source: 'auth', host: 'srv-01',
    eventCode: '4625', action: 'login', outcome: 'failure', message: 'Failed logon', tags: ['auth'], details: {}, ...fields,
  };
}

const events: SecurityEvent[] = [
  event(0, { user: 'ana', sourceIp: '203.0.113.5', details: { attempts: 3 } }),
  event(1, { user: 'luis', sourceIp: '203.0.113.5', details: { attempts: 5 } }),
  event(2, { user: 'marta', sourceIp: '203.0.113.5', details: { attempts: 1 } }),
  event(3, { user: 'marta', sourceIp: '203.0.113.5', eventCode: '4624', outcome: 'success', message: 'Successful logon', details: { logon_type: 10 } }),
  event(20, { source: 'sysmon', host: 'wks-07', user: 'marta', eventCode: '1', action: 'process_start', outcome: 'success', message: 'powershell.exe -enc SQBFAFgA', tags: ['process', 'suspicious'], details: { process: 'powershell.exe', parent: 'WINWORD.EXE' } }),
  event(45, { source: 'dns', host: 'wks-07', user: 'marta', sourceIp: '10.0.0.7', eventCode: 'DNS-Q', action: 'dns_query', outcome: 'success', message: 'Query TXT a1.exfil-cache.example', details: { qtype: 'TXT', domain: 'exfil-cache.example' } }),
];

const run = (query: string) => runSpl(query, events, { now: base / 1000 });
const users = (query: string) => run(query).rows.map((row) => row.user);

describe('SPL search', () => {
  it('returns every event newest first for an empty query or index=soc', () => {
    expect(run('').rows).toHaveLength(6);
    const result = run('index=soc');
    expect(result.kind).toBe('events');
    expect(result.rows.map((row) => row.id)).toEqual(['evt-45', 'evt-20', 'evt-3', 'evt-2', 'evt-1', 'evt-0']);
    expect(run('index=main').rows).toHaveLength(0);
  });

  it('matches field values case-insensitively, with wildcards and numeric equality', () => {
    expect(users('user=MARTA outcome=success')).toEqual(['marta', 'marta', 'marta']);
    expect(run('message="*.exe -enc*"').rows).toHaveLength(1);
    expect(run('details.attempts=5').rows).toHaveLength(1);
    expect(run('attempts>=3').rows).toHaveLength(2);
    expect(run('process=powershell.exe').rows).toHaveLength(1);
    expect(run('sourcetype=sysmon').rows).toHaveLength(1);
  });

  it('binds OR tighter than the implicit AND, like Splunk', () => {
    expect(users('outcome=failure user=ana OR user=luis')).toEqual(['luis', 'ana']);
    expect(users('(user=ana OR user=luis) NOT eventCode=4624')).toEqual(['luis', 'ana']);
    expect(run('user=marta AND NOT source=auth').rows).toHaveLength(2);
  });

  it('supports IN lists and keeps != away from events without the field', () => {
    expect(run('eventCode IN (4624, "1")').rows).toHaveLength(2);
    expect(run('sourceIp!=203.0.113.5').rows).toHaveLength(1);
    expect(run('NOT sourceIp=203.0.113.5').rows).toHaveLength(2);
  });

  it('matches free text as whole terms of the raw event', () => {
    expect(run('powershell').rows).toHaveLength(1);
    expect(run('power').rows).toHaveLength(0);
    expect(run('power*').rows).toHaveLength(1);
    expect(run('"Successful logon"').rows).toHaveLength(1);
  });
});

describe('SPL commands', () => {
  it('aggregates with stats, aliases and by clauses', () => {
    const result = run('index=soc outcome=failure | stats count dc(user) as usuarios values(user) by sourceIp');
    expect(result.kind).toBe('table');
    expect(result.columns).toEqual(['sourceIp', 'count', 'usuarios', 'values(user)']);
    expect(result.rows).toEqual([{ sourceIp: '203.0.113.5', count: 3, usuarios: 3, 'values(user)': ['ana', 'luis', 'marta'] }]);
    expect(run('index=soc | stats avg(attempts) as media max(attempts) sum(attempts)').rows[0]).toEqual({ media: 3, 'max(attempts)': 5, 'sum(attempts)': 9 });
  });

  it('filters and computes with where and eval', () => {
    const result = run('index=soc | eval peso=attempts*2, etiqueta=upper(user) . "@" . host | where peso > 5 | table etiqueta peso');
    expect(result.rows).toEqual([{ etiqueta: 'LUIS@srv-01', peso: 10 }, { etiqueta: 'ANA@srv-01', peso: 6 }]);
    expect(run('index=soc | where like(message, "%logon%") AND isnotnull(sourceIp)').rows).toHaveLength(4);
    expect(run('index=soc | where cidrmatch("10.0.0.0/8", sourceIp)').rows).toHaveLength(1);
    expect(run('index=soc | eval nivel=case(attempts>=5, "alto", attempts>=3, "medio", true(), "bajo") | stats count by nivel').rows).toEqual([
      { nivel: 'alto', count: 1 }, { nivel: 'bajo', count: 4 }, { nivel: 'medio', count: 1 },
    ]);
  });

  it('warns when a bare word in where is read as a field name', () => {
    const result = run('index=soc | where user=marta');
    expect(result.rows).toHaveLength(0);
    expect(result.warnings[0]).toContain('«marta» se interpreta como nombre de campo');
    expect(run('index=soc | where user="marta"').rows).toHaveLength(4);
  });

  it('sorts, limits, dedups and renames', () => {
    expect(users('index=soc | sort user, -_time | dedup user | table user')).toEqual(['ana', 'luis', 'marta']);
    expect(run('index=soc | head 2').rows.map((row) => row.id)).toEqual(['evt-45', 'evt-20']);
    expect(run('index=soc | sort 0 _time | tail 1').rows[0].id).toBe('evt-45');
    expect(run('index=soc | rename details.* as * | where isnotnull(process) | table process').rows).toEqual([{ process: 'powershell.exe' }]);
    expect(run('index=soc | stats count by user | rename user as cuenta').columns).toEqual(['cuenta', 'count']);
  });

  it('ranks values with top and rare', () => {
    expect(run('index=soc | top limit=1 user').rows).toEqual([{ user: 'marta', count: 4, percent: 66.666667 }]);
    expect(run('index=soc | rare user showperc=f').rows.at(-1)).toEqual({ user: 'marta', count: 4 });
  });

  it('extracts fields with rex and filters with regex', () => {
    const result = run('index=soc source=dns | rex field=message "Query (?<qtipo>\\w+) (?<sub>[^.]+)\\." | table qtipo sub');
    expect(result.rows).toEqual([{ qtipo: 'TXT', sub: 'a1' }]);
    expect(run('index=soc | regex message="-enc\\s"').rows).toHaveLength(1);
    expect(run('index=soc | regex message!="logon"').rows).toHaveLength(2);
    expect(run('index=soc | regex message="(?i)FAILED"').rows).toHaveLength(3);
    expect(run('index=soc | where match(message, "(?i)^query txt")').rows).toHaveLength(1);
  });

  it('computes running values with streamstats and group stats with eventstats', () => {
    const result = run('index=soc user=marta | sort _time | streamstats current=f last(_time) as previo | eval delta=_time-previo | table delta');
    expect(result.rows).toEqual([{}, { delta: 60 }, { delta: 1020 }, { delta: 1500 }]);
    expect(run('index=soc | eventstats count as total by user | where total > 1 | stats count').rows[0].count).toBe(4);
  });

  it('groups related events with transaction', () => {
    const result = run('index=soc user=marta | transaction user maxspan=30m');
    expect(result.kind).toBe('events');
    expect(result.rows.map((row) => [row.eventcount, row.duration])).toEqual([[1, 0], [3, 1080]]);
    expect(result.rows[1].source).toEqual(['auth', 'sysmon']);
  });

  it('buckets time with bin, timechart and chart', () => {
    const chart = run('index=soc | timechart span=15m count by outcome');
    expect(chart.columns).toEqual(['_time', 'failure', 'success']);
    expect(chart.rows.map((row) => [formatTime(Number(row._time), '%H:%M'), row.success, row.failure])).toEqual([
      ['10:00', 1, 3], ['10:15', 1, 0], ['10:30', 0, 0], ['10:45', 1, 0],
    ]);
    expect(run('index=soc | bin _time span=1h | stats count by _time').rows).toEqual([{ _time: base / 1000, count: 6 }]);
    expect(run('index=soc | chart count over source by outcome').rows[0]).toEqual({ source: 'auth', failure: 3, success: 1 });
  });

  it('expands multivalue fields and fills nulls', () => {
    expect(run('index=soc process=* | mvexpand tags | table tags').rows).toEqual([{ tags: 'process' }, { tags: 'suspicious' }]);
    expect(run('index=soc | fillnull value=N/A user | stats count by details.qtype').rows).toEqual([{ 'details.qtype': 'TXT', count: 1 }]);
  });
});

describe('SPL errors', () => {
  const error = (query: string) => {
    try { run(query); } catch (caught) { return caught as SplError; }
    throw new Error(`Expected «${query}» to fail`);
  };

  it('points at the offending part of the query', () => {
    const unknown = error('index=soc | statz count');
    expect(unknown).toBeInstanceOf(SplError);
    expect(unknown.message).toContain('Comando desconocido: statz');
    expect([unknown.start, unknown.end]).toEqual([12, 17]);
    expect(error('index=soc | join user').message).toContain('no está soportado');
    expect(error('message="sin cerrar').message).toContain('comillas');
    expect(error('| stats count').message).toContain('no puede empezar por «|»');
    expect(error('index=soc | stats').message).toContain('agregación');
    expect(error('index=soc | eval x=nope(1)').message).toContain('nope()');
    expect(error('index=soc | where 1 + 1').message).toContain('verdadera/falsa');
    expect(error('index=soc | rex "sin grupos"').message).toContain('grupo con nombre');
    expect(error('index=soc | transaction user maxspan=mucho').message).toContain('duración');
  });
});

describe('field summary', () => {
  it('lists fields with coverage and top values for the sidebar', () => {
    const summary = summarizeFields(run('index=soc').rows);
    const user = summary.find(({ field }) => field === 'user');
    expect(user).toMatchObject({ distinct: 3, coverage: 1, top: [{ value: 'marta', count: 4 }, { value: 'ana', count: 1 }, { value: 'luis', count: 1 }] });
    expect(summary.some(({ field }) => field === '_raw')).toBe(false);
  });
});

describe('scenario reference queries', () => {
  it('runs every SPL reference query of the catalog and finds evidence', () => {
    for (const scenario of scenarioDefinitions) {
      const scenarioEvents = generateScenarioEvents(scenario);
      for (const query of scenario.queries.spl) {
        const result = runSpl(query, scenarioEvents);
        expect({ scenario: scenario.id, query, rows: result.rows.length > 0, warnings: result.warnings }).toEqual({ scenario: scenario.id, query, rows: true, warnings: [] });
      }
    }
  });

  it('runs the rewritten SPL of procedural variants', () => {
    for (const template of proceduralTemplates) {
      const variant = generateProceduralScenario({ template: template.id, seed: 4242, difficulty: 'hard' });
      for (const query of variant.scenario.queries.spl) expect({ template: template.id, query, rows: runSpl(query, variant.events).rows.length > 0 }).toEqual({ template: template.id, query, rows: true });
    }
  });
});
