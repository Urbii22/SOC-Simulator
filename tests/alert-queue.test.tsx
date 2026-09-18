import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AlertQueue } from '../src/client/components/AlertQueue';
import type { ScenarioSummary } from '../src/domain/types';

const scenario: ScenarioSummary = {
  id: 'dns-tunneling', title: 'Túnel DNS', difficulty: 'Advanced', category: 'Command and Control',
  severity: 'high', status: 'New', date: '2026-09-06T08:04:00.000Z', user: 'n.ortega', host: 'rnd-wks-03',
  alertCount: 2, eventCount: 46, description: 'Test', progress: 0,
};

describe('AlertQueue', () => {
  it('renders operational metadata and selects an alert', () => {
    const select = vi.fn();
    render(<AlertQueue scenarios={[scenario]} selectedId="" onSelect={select} query="" setQuery={() => {}} severity="all" setSeverity={() => {}} />);
    expect(screen.getByText('Túnel DNS')).toBeInTheDocument();
    expect(screen.getByText('rnd-wks-03')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Túnel DNS/ }));
    expect(select).toHaveBeenCalledWith('dns-tunneling');
  });

  it('shows a helpful empty state when filtering removes every alert', () => {
    render(<AlertQueue scenarios={[scenario]} selectedId="" onSelect={() => {}} query="powershell" setQuery={() => {}} severity="all" setSeverity={() => {}} />);
    expect(screen.getByText(/No hay alertas/)).toBeInTheDocument();
  });
});
