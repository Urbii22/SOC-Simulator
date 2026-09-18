import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScenarioDetail, ScenarioSummary } from '../src/domain/types';
import { App } from '../src/client/App';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function summary(id: string, title: string): ScenarioSummary {
  return {
    id, title, difficulty: 'Foundation', category: 'Test', severity: 'low', status: 'New',
    date: '2026-09-01T08:00:00.000Z', user: 'analyst', host: `${id}-host`, alertCount: 1,
    eventCount: 1, description: `${title} description`, progress: 0,
  };
}

function detail(item: ScenarioSummary): ScenarioDetail {
  return {
    ...item, briefing: `${item.title} briefing`, businessContext: 'Business context for concurrency testing.',
    alerts: ['Synthetic alert'], users: [item.user], hosts: [item.host], events: [], questions: [],
    visibleIocs: [], mitre: [], notes: '',
  };
}

afterEach(() => vi.restoreAllMocks());

describe('App request ordering', () => {
  it('does not let a slow previous scenario response replace the current selection', async () => {
    const first = summary('first', 'First scenario');
    const second = summary('second', 'Second scenario');
    const firstRequest = deferred<Response>();
    const secondRequest = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/scenarios') return Promise.resolve(response([first, second]));
      if (url === '/api/scenarios/first') return firstRequest.promise;
      if (url === '/api/scenarios/second') return secondRequest.promise;
      throw new Error(`Unexpected request ${url}`);
    }));

    render(<App />);
    const secondButton = await screen.findByRole('button', { name: /Second scenario/ });
    fireEvent.click(secondButton);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/scenarios/second', expect.anything()));
    await act(async () => secondRequest.resolve(response(detail(second))));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Second scenario');
    await act(async () => firstRequest.resolve(response(detail(first))));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Second scenario');
  });
});
