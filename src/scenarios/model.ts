import type { Difficulty, Ioc, InvestigationQuestion, MitreTechnique, SecurityEvent, Severity } from '../domain/types.js';

export interface AttackEvent extends Omit<SecurityEvent, 'id' | 'scenarioId' | 'timestamp'> { offsetMinutes: number }
export interface AnswerKey { value: string | boolean; aliases?: string[]; explanation: string }

export interface ScenarioDefinition {
  id: string;
  title: string;
  difficulty: Difficulty;
  category: string;
  severity: Severity;
  description: string;
  briefing: string;
  primaryUser: string;
  primaryHost: string;
  users: string[];
  hosts: string[];
  alerts: string[];
  attackEvents: AttackEvent[];
  questions: InvestigationQuestion[];
  answers: Record<string, AnswerKey>;
  iocs: Ioc[];
  mitre: MitreTechnique[];
  explanation: string;
  reasoning: string[];
  queries: { kql: string[]; spl: string[]; sigma: string };
  responseActions: string[];
}
