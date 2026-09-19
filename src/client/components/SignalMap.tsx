import { useMemo, useState } from 'react';
import { ArrowUpRight, ScanLine } from 'lucide-react';
import type { SecurityEvent } from '../../domain/types';

const formatTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const bucketCount = 40;

export function SignalMap({ events, onExplore }: { events: SecurityEvent[]; onExplore: () => void }) {
  const [selectedBucket, setSelectedBucket] = useState<number | null>(null);
  const [selectedSource, setSelectedSource] = useState('all');
  const model = useMemo(() => {
    const sorted = events.filter((event) => Number.isFinite(Date.parse(event.timestamp)))
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const start = sorted.length ? Date.parse(sorted[0].timestamp) : 0;
    const end = sorted.length ? Date.parse(sorted[sorted.length - 1].timestamp) : 0;
    const sources = [...new Set(sorted.map((event) => event.source))];
    const buckets: SecurityEvent[][] = Array.from({ length: bucketCount }, () => []);
    for (const event of sorted) {
      if (selectedSource !== 'all' && event.source !== selectedSource) continue;
      const index = Math.min(bucketCount - 1, Math.floor((Date.parse(event.timestamp) - start) / Math.max(1, end - start) * bucketCount));
      buckets[index].push(event);
    }
    return { start, end, sources, buckets, count: buckets.reduce((sum, bucket) => sum + bucket.length, 0) };
  }, [events, selectedSource]);
  const peak = Math.max(1, ...model.buckets.map((bucket) => bucket.length));
  const selected = selectedBucket === null ? [] : model.buckets[selectedBucket];

  return (
    <section className="signal-map" aria-label="Mapa temporal de telemetría">
      <header className="signal-map-heading">
        <div><span className="instrument-label"><ScanLine size={14} /> Actividad del caso</span><h2>Mapa de actividad</h2></div>
        <div className="signal-total"><strong>{model.count.toString().padStart(2, '0')}</strong><span>eventos visibles</span></div>
      </header>
      <div className="signal-source-filters" aria-label="Fuentes de telemetría">
        {['all', ...model.sources].map((source) => <button key={source} aria-pressed={selectedSource === source} onClick={() => { setSelectedSource(source); setSelectedBucket(null); }}>{source === 'all' ? 'Todas las fuentes' : source}</button>)}
      </div>
      {events.length ? <>
        <div className="signal-chart" aria-label="Intervalos de eventos">
          {model.buckets.map((bucket, index) => <button
            key={index}
            className={`signal-bin ${selectedBucket === index ? 'is-selected' : ''}`}
            disabled={!bucket.length}
            aria-pressed={selectedBucket === index}
            aria-label={`${formatTime(model.start + index / bucketCount * (model.end - model.start))}: ${bucket.length} ${bucket.length === 1 ? 'evento' : 'eventos'}`}
            onClick={() => setSelectedBucket(selectedBucket === index ? null : index)}
          ><span style={{ height: `${Math.max(2, bucket.length / peak * 100)}%` }} /><small>{bucket.length || ''}</small></button>)}
        </div>
        <div className="signal-axis"><time>{formatTime(model.start)}</time><span>Selecciona una barra para inspeccionar</span><time>{formatTime(model.end)}</time></div>
      </> : <p className="signal-empty">No hay eventos disponibles para este caso.</p>}
      {selectedBucket !== null && <div className="signal-selection" aria-live="polite">
        <div><strong>{selected.length} {selected.length === 1 ? 'evento' : 'eventos'} en este intervalo</strong><button onClick={() => setSelectedBucket(null)}>Cerrar detalle</button></div>
        <ul>{selected.map((event) => <li key={event.id}><time>{formatTime(Date.parse(event.timestamp))}</time><code>{event.source}</code><p>{event.message}</p><span>{event.host}</span></li>)}</ul>
      </div>}
      <footer><span><i />Datos del caso · sin clasificación de amenaza</span><button onClick={onExplore}>Abrir evidencias <ArrowUpRight size={16} /></button></footer>
    </section>
  );
}
