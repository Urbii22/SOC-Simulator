import type { Difficulty, EventSource, Ioc, InvestigationQuestion, MitreTechnique, SecurityEvent, Severity } from '../domain/types.js';

export interface AttackEvent extends Omit<SecurityEvent, 'id' | 'scenarioId' | 'timestamp'> { offsetMinutes: number }
export interface AnswerEvidence {
  eventRefs: string[];
  fields: string[];
  iocValues?: string[];
}
export interface AnswerKey { value: string | boolean; aliases?: string[]; explanation: string; evidenceTerms?: string[]; evidence: AnswerEvidence }
export interface ScenarioMetadata {
  schemaVersion: 1;
  deterministic: boolean;
  defaultSeed: number;
  baseTimestamp: string;
  correlation: 'single-source' | 'multi-source' | 'multi-stage' | 'ambiguous';
}

export interface ScenarioDefinition {
  id: string;
  title: string;
  difficulty: Difficulty;
  category: string;
  severity: Severity;
  description: string;
  briefing: string;
  businessContext: string;
  primaryUser: string;
  primaryHost: string;
  users: string[];
  hosts: string[];
  alerts: string[];
  dataSources: EventSource[];
  metadata: ScenarioMetadata;
  noiseCount?: number;
  noiseSources?: EventSource[];
  expectedVerdict: 'true-positive' | 'false-positive' | 'mixed';
  attackEvents: AttackEvent[];
  questions: InvestigationQuestion[];
  answers: Record<string, AnswerKey>;
  iocs: Ioc[];
  mitre: MitreTechnique[];
  explanation: string;
  reasoning: string[];
  queries: { kql: string[]; spl: string[]; sigma?: string };
  responseActions: string[];
  remediationActions: string[];
}

export type ScenarioDraft = Omit<ScenarioDefinition, 'answers' | 'dataSources' | 'metadata'> & {
  answers: Record<string, Omit<AnswerKey, 'evidence'> & { evidence?: AnswerEvidence }>;
};
