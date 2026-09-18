import { Search, SlidersHorizontal } from 'lucide-react';
import type { ScenarioSummary } from '../../domain/types';
import { SeverityMark } from './Icons';

interface Props {
  scenarios: ScenarioSummary[];
  selectedId: string;
  onSelect: (id: string) => void;
  query: string;
  setQuery: (value: string) => void;
  severity: string;
  setSeverity: (value: string) => void;
}

export function AlertQueue({ scenarios, selectedId, onSelect, query, setQuery, severity, setSeverity }: Props) {
  const filtered = scenarios.filter((item) => {
    const matchesText = `${item.title} ${item.host} ${item.user}`.toLowerCase().includes(query.toLowerCase());
    return matchesText && (severity === 'all' || item.severity === severity);
  });
  return (
    <aside className="queue-panel" aria-label="Cola de alertas">
      <div className="queue-heading">
        <div><span className="eyebrow">Turno activo</span><h2>Cola de alertas</h2></div>
        <span className="count-badge" aria-label={`${filtered.length} alertas`}>{filtered.length}</span>
      </div>
      <div className="filter-stack">
        <label className="search-field"><Search size={15} aria-hidden="true" /><span className="sr-only">Buscar alertas</span><input id="alert-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Host, usuario o alerta…" /></label>
        <label className="severity-filter"><SlidersHorizontal size={14} aria-hidden="true" /><span className="sr-only">Filtrar por severidad</span><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">Todas las severidades</option><option value="critical">Crítica</option><option value="high">Alta</option><option value="medium">Media</option><option value="low">Baja</option></select></label>
      </div>
      <div className="queue-list">
        {filtered.map((scenario) => (
          <button key={scenario.id} className={`queue-item ${selectedId === scenario.id ? 'is-active' : ''}`} onClick={() => onSelect(scenario.id)} aria-pressed={selectedId === scenario.id}>
            <span className="queue-item-top"><SeverityMark severity={scenario.severity} /><span className="event-time">{new Date(scenario.date).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span></span>
            <strong>{scenario.title}</strong>
            <span className="queue-meta"><span>{scenario.host}</span><span>{scenario.user}</span></span>
            <span className="queue-footer"><span>{scenario.category}</span><span className={`status-mini ${scenario.status === 'New' ? 'is-new' : ''}`}>{scenario.status}</span></span>
          </button>
        ))}
        {!filtered.length && <div className="empty-state">No hay alertas que coincidan. Ajusta los filtros.</div>}
      </div>
    </aside>
  );
}
