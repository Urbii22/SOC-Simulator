import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SplSearch } from '../src/client/components/SplSearch';
import type { SecurityEvent } from '../src/domain/types';
import { addSearchFilter } from '../src/spl';

const events: SecurityEvent[] = ['ana', 'luis', 'ana'].map((user, index) => ({
  id: `evt-${index}`, scenarioId: 'lab', timestamp: `2026-03-01T10:0${index}:00.000Z`, source: 'auth', host: 'srv-01', user,
  eventCode: '4625', action: 'login', outcome: 'failure', message: `Failed logon for ${user}`, tags: [], details: {},
}));

const search = (query: string) => {
  const box = screen.getByRole('textbox', { name: 'Búsqueda SPL' });
  fireEvent.change(box, { target: { value: query } });
  fireEvent.keyDown(box, { key: 'Enter' });
};

describe('SPL search console', () => {
  afterEach(() => { cleanup(); localStorage.clear(); });

  it('lists every event first and runs a query only on Enter', () => {
    render(<SplSearch events={events} />);
    expect(screen.getByRole('status')).toHaveTextContent('3 de 3 eventos');
    fireEvent.change(screen.getByRole('textbox', { name: 'Búsqueda SPL' }), { target: { value: 'user=ana' } });
    expect(screen.getByRole('status')).toHaveTextContent('3 de 3 eventos');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Búsqueda SPL' }), { key: 'Enter' });
    expect(screen.getByRole('status')).toHaveTextContent('2 de 3 eventos');
  });

  it('shows a statistics table after a transforming command', () => {
    render(<SplSearch events={events} />);
    search('index=soc | stats count by user');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['user', 'count']);
    expect(within(table).getAllByRole('row').slice(1).map((row) => row.textContent)).toEqual(['ana2', 'luis1']);
  });

  it('explains syntax errors and marks the offending text', () => {
    render(<SplSearch events={events} />);
    search('index=soc | statz count');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Comando desconocido: statz');
    expect(alert.querySelector('mark')).toHaveTextContent('statz');
  });

  it('narrows the search from the field sidebar', () => {
    render(<SplSearch events={events} />);
    fireEvent.click(screen.getByRole('button', { name: /^user/ }));
    fireEvent.click(screen.getByTitle('Añadir user="luis" a la búsqueda'));
    expect(screen.getByRole('textbox', { name: 'Búsqueda SPL' })).toHaveValue('index=soc user="luis"');
    expect(screen.getByRole('status')).toHaveTextContent('1 de 3 eventos');
  });

  it('inserts filters before the first pipe', () => {
    expect(addSearchFilter('index=soc | stats count by host', 'user', 'a"b')).toBe('index=soc user="a\\"b" | stats count by host');
    expect(addSearchFilter('', 'host', 'srv-01', true)).toBe('index=soc NOT host="srv-01"');
  });
});
