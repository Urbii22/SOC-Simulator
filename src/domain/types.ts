export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type IncidentStatus = 'New' | 'Investigating' | 'Escalated' | 'Closed - True Positive' | 'Closed - False Positive';
export type Difficulty = 'Foundation' | 'Intermediate' | 'Advanced';
export type EventSource = 'windows' | 'sysmon' | 'linux' | 'dns' | 'http' | 'auth' | 'network' | 'suricata' | 'firewall' | 'endpoint' | 'email' | 'cloud';
export type MitreTactic = 'Reconnaissance' | 'Resource Development' | 'Initial Access' | 'Execution' | 'Persistence' | 'Privilege Escalation' | 'Defense Evasion' | 'Credential Access' | 'Discovery' | 'Lateral Movement' | 'Collection' | 'Command and Control' | 'Exfiltration' | 'Impact';

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

export interface MitreTechnique { id: string; name: string; tactic: MitreTactic }
export type IocType = 'ip' | 'domain' | 'url' | 'hash' | 'email' | 'hostname' | 'user' | 'filename' | 'path' | 'registry_key' | 'process' | 'other';
export interface Ioc { type: IocType; value: string; context: string }

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
  origin?: 'canonical' | 'procedural' | 'random';
  variantId?: string;
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

export interface ProceduralTemplateSummary {
  id: string;
  name: string;
  category: string;
  defaultDifficulty: 'easy' | 'medium' | 'hard';
  supportedDifficulties: Array<'easy' | 'medium' | 'hard'>;
  phaseCount: number;
}

export interface GeneratedVariantResponse {
  variantId: string;
  hash: string;
  scenario: ScenarioDetail;
}

export type ChallengeMode = 'quick' | 'training' | 'shift' | 'custom';
export type ChallengeDifficulty = 'easy' | 'medium' | 'hard' | 'mixed' | 'progressive';
export type ChallengeSource = 'procedural' | 'canonical' | 'mixed';
export type ChallengeTruth = 'any' | 'true-positive' | 'false-positive' | 'mixed';
export type ChallengeSessionStatus = 'created' | 'active' | 'completed';
export type ChallengeIncidentStatus = 'New' | 'Investigating' | 'Submitted';

export interface ChallengePublicConfig {
  mode: ChallengeMode;
  count: number;
  difficulty: ChallengeDifficulty;
  source: ChallengeSource;
}

export interface ChallengeIncidentSummary {
  id: string;
  position: number;
  difficulty: 'easy' | 'medium' | 'hard';
  status: ChallengeIncidentStatus;
  progress: number;
  hintsUsed: number;
  startedAt?: string;
  submittedAt?: string;
  elapsedMs: number;
  score?: number;
  adjustedScore?: number;
}

export interface ChallengeSession {
  id: string;
  seed: string;
  planHash: string;
  revision: number;
  status: ChallengeSessionStatus;
  config: ChallengePublicConfig;
  createdAt: string;
  startedAt?: string;
  firstInteractionAt?: string;
  completedAt?: string;
  elapsedMs: number;
  currentIndex: number;
  incidents: ChallengeIncidentSummary[];
  summary?: ChallengeSessionSummary;
}

export interface ChallengeIncidentView {
  session: ChallengeSession;
  incident: ChallengeIncidentSummary;
  scenario: ScenarioDetail;
  savedAnswers: Record<string, string | boolean>;
  evidence: string[];
  actions: string[];
  verdict?: 'true-positive' | 'false-positive' | 'mixed';
  severityAssessment?: Severity;
  availableHints: number;
  hints: Array<{ level: number; text: string; requestedAt: string; penalty: number }>;
  review?: ChallengeReview;
}

export interface ChallengeReview extends GradeResult {
  rawScore: number;
  adjustedScore: number;
  hintPenalty: number;
  verdictCorrect: boolean | null;
  category: string;
}

export interface ChallengeSessionSummary {
  completed: number;
  total: number;
  accuracy: number;
  adjustedAccuracy: number;
  verdictAccuracy: number;
  correctQuestions: number;
  totalQuestions: number;
  hintsUsed: number;
  elapsedMs: number;
  truePositives: number;
  falsePositives: number;
  mixed: number;
  missedQuestionIds: string[];
  categories: string[];
  mitre: string[];
}

export interface ChallengeHistoryItem {
  id: string;
  createdAt: string;
  mode: ChallengeMode;
  seed: string;
  difficulty: ChallengeDifficulty;
  count: number;
  completed: number;
  accuracy: number;
  durationMs: number;
  status: ChallengeSessionStatus;
}

export interface ChallengeMetricBreakdown { key: string; investigations: number; accuracy: number }
export interface ChallengeStats {
  investigations: number;
  sessions: number;
  completedSessions: number;
  averageAccuracy: number;
  verdictAccuracy: number;
  averageTimeMs: number;
  hintsUsed: number;
  byDifficulty: ChallengeMetricBreakdown[];
  byCategory: ChallengeMetricBreakdown[];
  byMitre: ChallengeMetricBreakdown[];
  missedQuestions: Array<{ questionId: string; misses: number }>;
  weakestTemplates: ChallengeMetricBreakdown[];
  recommendations: string[];
}
