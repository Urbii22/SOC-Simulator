import type { GeneratedVariantResponse, GradeResult, IncidentStatus, ProceduralTemplateSummary, ScenarioDetail, ScenarioSummary } from '../domain/types';

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
};
