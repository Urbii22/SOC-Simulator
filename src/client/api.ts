import type { GradeResult, IncidentStatus, ScenarioDetail, ScenarioSummary, SecurityEvent } from '../domain/types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...options?.headers }, ...options });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export const api = {
  scenarios: () => request<ScenarioSummary[]>('/api/scenarios'),
  detail: (id: string) => request<ScenarioDetail>(`/api/scenarios/${id}`),
  events: (id: string, query: string) => request<SecurityEvent[]>(`/api/scenarios/${id}/events?q=${encodeURIComponent(query)}`),
  update: (id: string, update: { status?: IncidentStatus; notes?: string }) => request(`/api/scenarios/${id}`, { method: 'PATCH', body: JSON.stringify(update) }),
  submit: (id: string, answers: Record<string, string | boolean>) => request<GradeResult>(`/api/scenarios/${id}/submit`, { method: 'POST', body: JSON.stringify({ answers }) }),
};
