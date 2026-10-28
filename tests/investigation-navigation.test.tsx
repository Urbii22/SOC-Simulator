import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/client/App';
import { api } from '../src/client/api';
import { ChallengeCenter } from '../src/client/components/ChallengeCenter';
import type { ChallengeIncidentView, ChallengeSession, GradeResult, ScenarioDetail } from '../src/domain/types';
import { scenarioDefinitions } from '../src/scenarios/definitions';
import { generateScenarioEvents, getAttackEvents } from '../src/scenarios/generator';
import { gradeScenarioAnswers } from '../src/server/scoring';

const definition = scenarioDefinitions[0];
const events = generateScenarioEvents(definition);
const correctAnswers = Object.fromEntries(Object.entries(definition.answers).map(([id, answer]) => [id, answer.value]));
const review: GradeResult = {
  ...gradeScenarioAnswers(definition, correctAnswers), explanation: definition.explanation, reasoning: definition.reasoning,
  timeline: getAttackEvents(definition, events), mitre: definition.mitre, iocs: definition.iocs, queries: definition.queries,
  responseActions: definition.responseActions, remediationActions: definition.remediationActions,
};
const detail: ScenarioDetail = {
  id: definition.id, title: definition.title, difficulty: definition.difficulty, category: definition.category,
  severity: definition.severity, status: 'New', date: events[0].timestamp, user: definition.primaryUser, host: definition.primaryHost,
  alertCount: definition.alerts.length, eventCount: events.length, description: definition.description, progress: 0,
  briefing: definition.briefing, businessContext: definition.businessContext, alerts: definition.alerts,
  users: definition.users, hosts: definition.hosts, events, questions: definition.questions, visibleIocs: [], mitre: [], notes: '',
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mockCases() {
  const second = { ...detail, id: 'second', title: 'Segundo caso' };
  vi.spyOn(api, 'scenarios').mockResolvedValue([detail, second]);
  vi.spyOn(api, 'detail').mockImplementation(async (id) => structuredClone(id === 'second' ? second : detail));
  vi.spyOn(api, 'proceduralTemplates').mockResolvedValue([]);
}

function fillAnswers() {
  for (const question of definition.questions) {
    const value = correctAnswers[question.id];
    if (question.type === 'text') fireEvent.change(screen.getByRole('textbox', { name: question.prompt }), { target: { value } });
    else fireEvent.click(screen.getByRole('radio', { name: typeof value === 'boolean' ? value ? 'Sí, verdadero positivo' : 'No, falso positivo' : value }));
  }
}

describe('investigation navigation', () => {
  it('preserves drafts across evidence, other cases and app areas in StrictMode', async () => {
    mockCases();
    render(<StrictMode><App /></StrictMode>);
    await screen.findByRole('heading', { name: detail.title });
    fireEvent.click(screen.getByRole('button', { name: 'Investigación' }));
    fillAnswers();
    fireEvent.click(screen.getByRole('button', { name: `Evidencias ${events.length}` }));
    expect(screen.getByRole('textbox', { name: 'Búsqueda SPL' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Investigación' }));
    expect(screen.getByRole('textbox', { name: definition.questions[0].prompt })).toHaveValue(String(correctAnswers.anchor));
    fireEvent.click(screen.getByRole('button', { name: /Segundo caso/ }));
    await screen.findByRole('heading', { name: 'Segundo caso' });
    fireEvent.click(screen.getByRole('button', { name: 'Investigación' }));
    expect(screen.getByRole('textbox', { name: definition.questions[0].prompt })).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(detail.title) }));
    await screen.findByRole('heading', { name: detail.title });
    fireEvent.click(screen.getByRole('button', { name: 'Challenge' }));
    fireEvent.click(screen.getByRole('button', { name: 'Casos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Investigación' }));
    expect(screen.getByRole('textbox', { name: definition.questions[0].prompt })).toHaveValue(String(correctAnswers.anchor));
    expect(screen.getByRole('radio', { name: 'Sí, verdadero positivo' })).toBeChecked();
  });

  it('retains and renders the complete review, with a new attempt available', async () => {
    mockCases();
    vi.spyOn(api, 'submit').mockResolvedValue(review);
    render(<App />);
    await screen.findByRole('heading', { name: detail.title });
    expect(screen.queryByRole('heading', { name: 'Cronología confirmada' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Investigación' }));
    fillAnswers();
    fireEvent.click(screen.getByRole('button', { name: 'Entregar investigación' }));
    await screen.findByRole('heading', { name: 'Caso resuelto' });
    expect(api.submit).toHaveBeenCalledWith(detail.id, correctAnswers);
    const timeline = screen.getByRole('region', { name: 'Cronología confirmada' });
    expect(within(timeline).getAllByRole('row')).toHaveLength(review.timeline.length + 1);
    expect(screen.getByRole('region', { name: 'Razonamiento de la investigación' })).toHaveTextContent(review.reasoning[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Resumen' }));
    expect(screen.getByText('Cronología disponible')).toBeVisible();
    expect(screen.queryByText('Las técnicas se revelan al completar la investigación.')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: definition.mitre[0].id })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Ver revisión completa' }));
    expect(screen.getByRole('heading', { name: 'Caso resuelto' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar investigación' }));
    expect(screen.getByRole('textbox', { name: definition.questions[0].prompt })).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox', { name: definition.questions[0].prompt }), { target: { value: 'retry draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resumen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver revisión completa' }));
    expect(screen.getByRole('heading', { name: 'Caso resuelto' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar investigación' }));
    expect(screen.getByRole('textbox', { name: definition.questions[0].prompt })).toHaveValue('retry draft');
  });

  it('does not apply a late submission to a different selected case', async () => {
    mockCases();
    let finish!: (value: GradeResult) => void;
    vi.spyOn(api, 'submit').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    await screen.findByRole('heading', { name: detail.title });
    fireEvent.click(screen.getByRole('button', { name: 'Investigación' }));
    fillAnswers();
    fireEvent.click(screen.getByRole('button', { name: 'Entregar investigación' }));
    fireEvent.click(screen.getByRole('button', { name: `Evidencias ${events.length}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Investigación' }));
    expect(screen.getByRole('button', { name: 'Entregar investigación' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Segundo caso/ }));
    await screen.findByRole('heading', { name: 'Segundo caso' });
    await act(async () => finish(review));
    fireEvent.click(screen.getByRole('button', { name: 'Investigación' }));
    expect(screen.queryByRole('heading', { name: 'Caso resuelto' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entregar investigación' })).toBeVisible();
  });

  it('shows a rejected save without clearing the draft', async () => {
    mockCases();
    vi.spyOn(api, 'submit').mockRejectedValue(new Error('Reduce las notas de otros casos y vuelve a guardar.'));
    render(<App />);
    await screen.findByRole('heading', { name: detail.title });
    fireEvent.click(screen.getByRole('button', { name: 'Investigación' }));
    fillAnswers();
    fireEvent.click(screen.getByRole('button', { name: 'Entregar investigación' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reduce las notas');
    expect(screen.getByRole('textbox', { name: definition.questions[0].prompt })).toHaveValue(String(correctAnswers.anchor));
    expect(screen.getByRole('button', { name: 'Entregar investigación' })).toBeEnabled();
  });
});

function mockChallenge() {
  const session: ChallengeSession = {
    id: 'cs-test', seed: 'session:7', planHash: 'abc', revision: 1, status: 'active',
    config: { mode: 'quick', count: 1, difficulty: 'medium', source: 'procedural' }, createdAt: detail.date,
    elapsedMs: 0, currentIndex: 0, incidents: [{ id: 'incident-01', position: 1, difficulty: 'medium', status: 'Investigating', progress: 0, hintsUsed: 0, elapsedMs: 0 }],
  };
  const view: ChallengeIncidentView = {
    session, incident: session.incidents[0], scenario: { ...detail, id: 'incident-01', title: 'Incidente 01' },
    savedAnswers: {}, evidence: [], actions: [], hints: [], availableHints: 3,
  };
  vi.spyOn(api, 'createSession').mockResolvedValue(session);
  vi.spyOn(api, 'sessionIncident').mockResolvedValue(view);
  vi.spyOn(api, 'saveSessionProgress').mockImplementation(async (_session, _incident, input) => ({ ...view, savedAnswers: input.answers ?? {}, session: { ...session, revision: 2 } }));
  return view;
}

describe('Challenge draft navigation', () => {
  it('keeps all edited answers when leaving Decision and saves that same draft', async () => {
    mockChallenge();
    render(<StrictMode><ChallengeCenter section="challenge" templates={[]} onError={vi.fn()} onNavigateChallenge={vi.fn()} /></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: /Rápido Quick Challenge/ }));
    await screen.findByRole('heading', { name: 'Incidente 01' });
    fireEvent.click(screen.getByRole('button', { name: 'Decisión' }));
    fireEvent.change(screen.getByRole('textbox', { name: definition.questions[0].prompt }), { target: { value: 'first answer' } });
    fireEvent.click(screen.getByRole('button', { name: `Evidencias · ${events.length}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Decisión' }));
    expect(screen.getByRole('textbox', { name: definition.questions[0].prompt })).toHaveValue('first answer');
    fireEvent.change(screen.getByRole('textbox', { name: definition.questions[1].prompt }), { target: { value: 'second answer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Investigación' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar progreso' }));
    await waitFor(() => expect(api.saveSessionProgress).toHaveBeenCalledWith('cs-test', 'incident-01', expect.objectContaining({ answers: { anchor: 'first answer', terminal: 'second answer' } })));
    fireEvent.click(screen.getByRole('button', { name: 'Decisión' }));
    expect(screen.getByRole('textbox', { name: definition.questions[0].prompt })).toHaveValue('first answer');
    expect(screen.getByRole('textbox', { name: definition.questions[1].prompt })).toHaveValue('second answer');
  });

  it('keeps a Challenge draft when visiting Cases and returning', async () => {
    mockCases(); mockChallenge();
    render(<App />);
    await screen.findByRole('heading', { name: detail.title });
    fireEvent.click(screen.getByRole('button', { name: 'Challenge' }));
    fireEvent.click(screen.getByRole('button', { name: /Rápido Quick Challenge/ }));
    await screen.findByRole('heading', { name: 'Incidente 01' });
    fireEvent.click(screen.getByRole('button', { name: 'Decisión' }));
    fireEvent.change(screen.getByRole('textbox', { name: definition.questions[0].prompt }), { target: { value: 'keep my draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Casos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Challenge' }));
    expect(screen.getByRole('textbox', { name: definition.questions[0].prompt })).toHaveValue('keep my draft');
    expect(api.createSession).toHaveBeenCalledTimes(1);
  });
});
