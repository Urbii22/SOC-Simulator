import { useMemo, useState } from 'react';
import { Search, TerminalSquare } from 'lucide-react';
import type { SecurityEvent } from '../../domain/types';

export function EventTable({ events }: { events: SecurityEvent[] }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const text = query.toLowerCase().trim();
    if (!text) return events;
    return events.filter((event) => JSON.stringify(event).toLowerCase().includes(text));
  }, [events, query]);
  return (
    <section className="evidence-section" aria-labelledby="evidence-title">
      <div className="section-heading evidence-heading">
        <div><span className="eyebrow">Dataset local</span><h3 id="evidence-title">Explorador de eventos</h3></div>
        <span className="result-count">{filtered.length} / {events.length} eventos</span>
      </div>
      <label className="query-bar"><TerminalSquare size={16} aria-hidden="true" /><span className="query-prefix">search</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder='Prueba: powershell, sourceIp o eventCode' aria-label="Filtrar eventos" /><Search size={15} aria-hidden="true" /></label>
      <div className="table-wrap" tabIndex={0} aria-label="Tabla de eventos desplazable">
        <table>
          <thead><tr><th>Hora</th><th>Fuente</th><th>Host / usuario</th><th>Evento</th><th>Resultado</th></tr></thead>
          <tbody>{filtered.map((event) => (
            <tr key={event.id}>
              <td className="mono time-cell">{new Date(event.timestamp).toLocaleTimeString('es')}</td>
              <td><span className={`source-tag source-${event.source}`}>{event.source}</span></td>
              <td><strong>{event.host}</strong><small>{event.user ?? '—'}</small></td>
              <td><span className="event-message">{event.message}</span><small className="mono">{event.eventCode} · {event.sourceIp}</small></td>
              <td><span className={`outcome outcome-${event.outcome}`}>{event.outcome}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
