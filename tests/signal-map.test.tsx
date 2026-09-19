import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignalMap } from '../src/client/components/SignalMap';
import type { SecurityEvent } from '../src/domain/types';

afterEach(cleanup);

function event(id: string, timestamp: string, source: SecurityEvent['source']): SecurityEvent {
  return { id, scenarioId: 'test', timestamp, source, host: 'lab-host', eventCode: 'TEST', action: 'test', outcome: 'unknown', message: `Telemetry ${id}`, tags: [], details: {} };
}

describe('SignalMap', () => {
  it('includes both time boundaries without changing the source event order', () => {
    const events = [event('last', '2026-09-01T08:40:00Z', 'dns'), event('first', '2026-09-01T08:00:00Z', 'auth')];
    render(<SignalMap events={events} onExplore={vi.fn()} />);
    const buckets = screen.getAllByRole('button', { name: /: 1 evento$/ });
    expect(buckets).toHaveLength(2);
    fireEvent.click(buckets[0]);
    expect(screen.getByText('Telemetry first')).toBeVisible();
    fireEvent.click(buckets[1]);
    expect(screen.getByText('Telemetry last')).toBeVisible();
    expect(screen.queryByText('Telemetry first')).not.toBeInTheDocument();
    expect(events.map(({ id }) => id)).toEqual(['last', 'first']);
  });

  it('groups simultaneous events and clears selection when filtering by source', () => {
    const timestamp = '2026-09-01T08:00:00Z';
    render(<SignalMap events={[event('a', timestamp, 'auth'), event('b', timestamp, 'dns')]} onExplore={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /: 2 eventos$/ }));
    expect(screen.getByText('Telemetry a')).toBeVisible();
    expect(screen.getByText('Telemetry b')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'dns' }));
    expect(screen.queryByText('Telemetry a')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'dns' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /: 1 evento$/ }));
    expect(screen.getByText('Telemetry b')).toBeVisible();
    expect(screen.queryByText('Telemetry a')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar detalle' }));
    expect(screen.queryByText('Telemetry b')).not.toBeInTheDocument();
  });

  it('shows an empty state and still opens the evidence view', () => {
    const open = vi.fn();
    render(<SignalMap events={[]} onExplore={open} />);
    expect(screen.getByText('No hay eventos disponibles para este caso.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /eventos$/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir evidencias' }));
    expect(open).toHaveBeenCalledOnce();
  });
});
