import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/client/App';
import { api } from '../src/client/api';
import type { ScenarioDetail } from '../src/domain/types';
import { scenarioDefinitions } from '../src/scenarios/definitions';
import { generateScenarioEvents } from '../src/scenarios/generator';

const definition = scenarioDefinitions[0];
const events = generateScenarioEvents(definition);
const detail: ScenarioDetail = {
  id: definition.id, title: definition.title, difficulty: definition.difficulty, category: definition.category,
  severity: definition.severity, status: 'New', date: events[0].timestamp, user: definition.primaryUser, host: definition.primaryHost,
  alertCount: definition.alerts.length, eventCount: events.length, description: definition.description, progress: 0,
  briefing: definition.briefing, businessContext: definition.businessContext, alerts: definition.alerts,
  users: definition.users, hosts: definition.hosts, events, questions: definition.questions, visibleIocs: [], mitre: [], notes: '',
};
const second = { ...detail, id: 'second', title: 'Segundo caso' };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mockCases() {
  vi.spyOn(api, 'scenarios').mockResolvedValue([detail, second]);
  vi.spyOn(api, 'detail').mockImplementation(async (id) => structuredClone(id === 'second' ? second : detail));
  vi.spyOn(api, 'proceduralTemplates').mockResolvedValue([]);
}

const evidenceTab = () => screen.getByRole('button', { name: `Evidencias ${events.length}` });

describe('workspace continuity', () => {
  it('restores tab and evidence search per case, also after a reload', async () => {
    mockCases();
    const { unmount } = render(<App />);
    await screen.findByRole('heading', { name: detail.title });
    fireEvent.click(evidenceTab());
    fireEvent.change(screen.getByRole('textbox', { name: 'Búsqueda SPL' }), { target: { value: events[0].host } });
    fireEvent.click(screen.getByRole('button', { name: /Segundo caso/ }));
    await screen.findByRole('heading', { name: 'Segundo caso' });
    expect(screen.queryByRole('textbox', { name: 'Búsqueda SPL' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(detail.title) }));
    await screen.findByRole('heading', { name: detail.title });
    expect(screen.getByRole('textbox', { name: 'Búsqueda SPL' })).toHaveValue(events[0].host);
    unmount();
    render(<App />);
    await screen.findByRole('heading', { name: detail.title });
    expect(screen.getByRole('textbox', { name: 'Búsqueda SPL' })).toHaveValue(events[0].host);
  });

  it('autosaves notes, reports failures beside them and retries only that save', async () => {
    mockCases();
    const update = vi.spyOn(api, 'update').mockRejectedValueOnce(new Error('El almacenamiento del laboratorio ha alcanzado 1 MiB.')).mockResolvedValue({});
    render(<App />);
    await screen.findByRole('heading', { name: detail.title });
    expect(screen.getByText('Guardado')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Notas del analista' }), { target: { value: 'Pivot desde sshd' } });
    expect(screen.getByText('Pendiente')).toBeVisible();
    const notesBlock = screen.getByRole('textbox', { name: 'Notas del analista' }).closest('.notes-block') as HTMLElement;
    await within(notesBlock).findByText(/ha alcanzado 1 MiB/, {}, { timeout: 3_000 });
    expect(update).toHaveBeenCalledWith(detail.id, { notes: 'Pivot desde sshd' });
    expect(screen.getByRole('textbox', { name: 'Notas del analista' })).toHaveValue('Pivot desde sshd');
    fireEvent.click(within(notesBlock).getByRole('button', { name: 'Reintentar' }));
    await within(notesBlock).findByText('Guardado');
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('keeps unsaved notes when switching cases before the autosave runs', async () => {
    mockCases();
    vi.spyOn(api, 'update').mockResolvedValue({});
    render(<App />);
    await screen.findByRole('heading', { name: detail.title });
    fireEvent.change(screen.getByRole('textbox', { name: 'Notas del analista' }), { target: { value: 'Borrador' } });
    fireEvent.click(screen.getByRole('button', { name: /Segundo caso/ }));
    await screen.findByRole('heading', { name: 'Segundo caso' });
    expect(screen.getByRole('textbox', { name: 'Notas del analista' })).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(detail.title) }));
    await screen.findByRole('heading', { name: detail.title });
    expect(screen.getByRole('textbox', { name: 'Notas del analista' })).toHaveValue('Borrador');
  });

  it('retries a failed case load in place instead of reloading the page', async () => {
    mockCases();
    vi.mocked(api.detail).mockRejectedValueOnce(new Error('offline'));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('heading', { name: detail.title });
    expect(api.detail).toHaveBeenCalledTimes(2);
  });

  it('retries only the failed status change from the global notice', async () => {
    mockCases();
    const update = vi.spyOn(api, 'update').mockRejectedValueOnce(new Error('Sin conexión')).mockResolvedValue({});
    render(<App />);
    await screen.findByRole('heading', { name: detail.title });
    fireEvent.change(screen.getByRole('combobox', { name: 'Estado del incidente' }), { target: { value: 'Escalated' } });
    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent('Sin conexión');
    fireEvent.click(within(notice).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenLastCalledWith(detail.id, { status: 'Escalated' });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('offers a single navigation and a single case search', async () => {
    mockCases();
    render(<App />);
    await screen.findByRole('heading', { name: detail.title });
    expect(screen.getAllByRole('navigation', { name: /Áreas|Centro de operaciones/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Mis investigaciones' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('textbox', { name: 'Buscar casos' })).toHaveLength(1);
  });
});
