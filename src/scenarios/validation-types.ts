import type { SecurityEvent } from '../domain/types.js';
import type { ScenarioDefinition } from './model.js';

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  scenarioId: string;
  rule: string;
  severity: ValidationSeverity;
  message: string;
  path?: string;
  context?: Record<string, string | number | boolean | string[]>;
}

export interface ScenarioMetrics {
  eventCount: number;
  relevantEventCount: number;
  noiseEventCount: number;
  noiseRatio: number;
  sourceCount: number;
  relevantSourceCount: number;
  hostCount: number;
  userCount: number;
  iocCount: number;
  techniqueCount: number;
  durationMinutes: number;
  questionCount: number;
  evidenceReferenceCount: number;
  evidenceSourceCount: number;
  correlation: ScenarioDefinition['metadata']['correlation'];
}

export interface ValidationCheck {
  rule: string;
  errors: number;
  warnings: number;
  infos: number;
}

export interface ScenarioValidationResult {
  scenarioId: string;
  title: string;
  issues: ValidationIssue[];
  checks: ValidationCheck[];
  metrics: ScenarioMetrics;
}

export interface CatalogValidationReport {
  results: ScenarioValidationResult[];
  findings: ValidationIssue[];
  issues: string[];
  totalEvents: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export interface ValidationContext {
  scenario: ScenarioDefinition;
  events: SecurityEvent[];
  timeline: SecurityEvent[];
  eventFields: Set<string>;
  evidenceText: string;
}

export interface ValidationRule {
  id: string;
  description: string;
  validate(context: ValidationContext): ValidationIssue[];
}

export interface ValidationOptions {
  determinismRuns?: number;
}
