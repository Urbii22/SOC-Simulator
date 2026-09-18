import type { ChallengeDifficulty, ChallengeHistoryItem, ChallengeIncidentView, ChallengeMode, ChallengeSession, ChallengeSource, ChallengeStats, ChallengeTruth, GeneratedVariantResponse, GradeResult, IncidentStatus, ProceduralTemplateSummary, ScenarioDetail, ScenarioSummary, Severity } from '../domain/types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...options?.headers }, ...options });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export const api = {
  scenarios: () => request<ScenarioSummary[]>('/api/scenarios'),
  detail: (id: string) => request<ScenarioDetail>(`/api/scenarios/${id}`),
  update: (id: string, update: { status?: IncidentStatus; notes?: string }) => request(`/api/scenarios/${id}`, { method: 'PATCH', body: JSON.stringify(update) }),
  submit: (id: string, answers: Record<string, string | boolean>) => request<GradeResult>(`/api/scenarios/${id}/submit`, { method: 'POST', body: JSON.stringify({ answers }) }),
  proceduralTemplates: () => request<ProceduralTemplateSummary[]>('/api/procedural/templates'),
  generateScenario: (input: { template?: string; random?: boolean; seed: number; difficulty: 'easy' | 'medium' | 'hard' }) => request<GeneratedVariantResponse>('/api/procedural/generate', { method: 'POST', body: JSON.stringify(input) }),
  createSession: (input: { mode: ChallengeMode; seed?: string; count?: number; difficulty?: ChallengeDifficulty; source?: ChallengeSource; truth?: ChallengeTruth; categories?: string[]; templates?: string[] }) => request<ChallengeSession>('/api/sessions', { method: 'POST', body: JSON.stringify(input) }),
  session: (id: string) => request<ChallengeSession>(`/api/sessions/${id}`),
  sessionIncident: (sessionId: string, incidentId: string) => request<ChallengeIncidentView>(`/api/sessions/${sessionId}/incidents/${incidentId}`),
  startSessionIncident: (sessionId: string, incidentId: string, revision: number) => request<ChallengeIncidentView>(`/api/sessions/${sessionId}/incidents/${incidentId}/start`, { method: 'POST', body: JSON.stringify({ revision }) }),
  saveSessionProgress: (sessionId: string, incidentId: string, input: { revision: number; notes?: string; answers?: Record<string, string | boolean>; evidence?: string[]; verdict?: 'true-positive' | 'false-positive' | 'mixed'; severityAssessment?: Severity; actions?: string[] }) => request<ChallengeIncidentView>(`/api/sessions/${sessionId}/incidents/${incidentId}`, { method: 'PATCH', body: JSON.stringify(input) }),
  requestHint: (sessionId: string, incidentId: string, revision: number) => request<ChallengeIncidentView>(`/api/sessions/${sessionId}/incidents/${incidentId}/hints`, { method: 'POST', body: JSON.stringify({ revision }) }),
  submitSessionIncident: (sessionId: string, incidentId: string, revision: number, answers: Record<string, string | boolean>) => request<ChallengeIncidentView>(`/api/sessions/${sessionId}/incidents/${incidentId}/submit`, { method: 'POST', body: JSON.stringify({ revision, answers }) }),
  finalizeSession: (id: string, revision: number) => request<ChallengeSession>(`/api/sessions/${id}/finalize`, { method: 'POST', body: JSON.stringify({ revision }) }),
  repeatSession: (id: string, strategy: 'exact' | 'equivalent' | 'template-new-seed' | 'retry-failed') => request<ChallengeSession>(`/api/sessions/${id}/repeat`, { method: 'POST', body: JSON.stringify({ strategy }) }),
  sessionHistory: () => request<ChallengeHistoryItem[]>('/api/sessions/history'),
  challengeStats: () => request<ChallengeStats>('/api/sessions/stats'),
};
