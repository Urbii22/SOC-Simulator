export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type IncidentStatus = 'New' | 'Investigating' | 'Escalated' | 'Closed - True Positive' | 'Closed - False Positive';
export type Difficulty = 'Foundation' | 'Intermediate' | 'Advanced';
export type EventSource = 'windows' | 'sysmon' | 'linux' | 'dns' | 'http' | 'auth' | 'network' | 'suricata' | 'firewall' | 'endpoint' | 'email' | 'cloud';

export interface SecurityEvent {
  id: string;
  scenarioId: string;
  timestamp: string;
  source: EventSource;
  host: string;
  user?: string;
  sourceIp?: string;
  destinationIp?: string;
  eventCode: string;
  action: string;
  outcome: 'success' | 'failure' | 'unknown';
  message: string;
  tags: string[];
  details: Record<string, string | number | boolean>;
}

export interface InvestigationQuestion {
  id: string;
  prompt: string;
  type: 'text' | 'single' | 'boolean';
  options?: string[];
  points: number;
}

export interface MitreTechnique { id: string; name: string; tactic: string }
export interface Ioc { type: 'ip' | 'domain' | 'hash' | 'path' | 'user' | 'process'; value: string; context: string }

export interface ScenarioSummary {
  id: string;
  title: string;
  difficulty: Difficulty;
  category: string;
  severity: Severity;
  status: IncidentStatus;
  date: string;
  user: string;
  host: string;
  alertCount: number;
  eventCount: number;
  description: string;
  progress: number;
}

export interface ScenarioDetail extends ScenarioSummary {
  briefing: string;
  businessContext: string;
  alerts: string[];
  users: string[];
  hosts: string[];
  events: SecurityEvent[];
  questions: InvestigationQuestion[];
  visibleIocs: Ioc[];
  mitre: MitreTechnique[];
  notes: string;
}

export interface GradeResult {
  score: number;
  earned: number;
  total: number;
  feedback: Array<{ questionId: string; correct: boolean; expected: string; explanation: string }>;
  explanation: string;
  reasoning: string[];
  timeline: SecurityEvent[];
  iocs: Ioc[];
  mitre: MitreTechnique[];
  queries: { kql: string[]; spl: string[]; sigma?: string };
  responseActions: string[];
  remediationActions: string[];
}
