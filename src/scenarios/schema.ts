import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);
const identifier = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const eventSourceSchema = z.enum(['windows', 'sysmon', 'linux', 'dns', 'http', 'auth', 'network', 'suricata', 'firewall', 'endpoint', 'email', 'cloud']);
const detailValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);
const mitreTacticSchema = z.enum(['Reconnaissance', 'Resource Development', 'Initial Access', 'Execution', 'Persistence', 'Privilege Escalation', 'Defense Evasion', 'Credential Access', 'Discovery', 'Lateral Movement', 'Collection', 'Command and Control', 'Exfiltration', 'Impact']);

export const attackEventSchema = z.object({
  offsetMinutes: z.number().finite().nonnegative(),
  source: eventSourceSchema,
  host: nonEmpty,
  user: nonEmpty.optional(),
  sourceIp: nonEmpty.optional(),
  destinationIp: nonEmpty.optional(),
  eventCode: nonEmpty,
  action: nonEmpty,
  outcome: z.enum(['success', 'failure', 'unknown']),
  message: nonEmpty,
  tags: z.array(nonEmpty).min(1),
  details: z.record(detailValueSchema),
}).strict();

export const securityEventSchema = attackEventSchema.omit({ offsetMinutes: true }).extend({
  id: nonEmpty,
  scenarioId: identifier,
  timestamp: z.string().datetime({ offset: true }),
}).strict();

const questionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  prompt: z.string().trim().min(10),
  type: z.enum(['text', 'single', 'boolean']),
  options: z.array(nonEmpty).min(2).optional(),
  points: z.number().int().positive().max(100),
}).strict().superRefine((question, context) => {
  if (question.type === 'single' && !question.options?.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'single-choice question requires options' });
  if (question.type !== 'single' && question.options) context.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'options are only valid for single-choice questions' });
});

const evidenceSchema = z.object({
  eventRefs: z.array(nonEmpty).min(1),
  fields: z.array(nonEmpty).min(1),
  iocValues: z.array(nonEmpty).min(1).optional(),
}).strict();

const answerSchema = z.object({
  value: z.union([nonEmpty, z.boolean()]),
  aliases: z.array(nonEmpty).min(1).optional(),
  explanation: z.string().trim().min(10),
  evidenceTerms: z.array(nonEmpty).min(1).optional(),
  evidence: evidenceSchema,
}).strict();

const iocSchema = z.object({
  type: z.enum(['ip', 'domain', 'url', 'hash', 'email', 'hostname', 'user', 'filename', 'path', 'registry_key', 'process', 'other']),
  value: nonEmpty,
  context: z.string().trim().min(8),
}).strict();

const mitreSchema = z.object({
  id: z.string().regex(/^T\d{4}(?:\.\d{3})?$/),
  name: nonEmpty,
  tactic: mitreTacticSchema,
}).strict();

const metadataSchema = z.object({
  schemaVersion: z.literal(1),
  deterministic: z.literal(true),
  defaultSeed: z.number().int().nonnegative(),
  baseTimestamp: z.string().datetime({ offset: true }),
  correlation: z.enum(['single-source', 'multi-source', 'multi-stage', 'ambiguous']),
}).strict();

export const scenarioSchema = z.object({
  id: identifier,
  title: z.string().trim().min(5),
  difficulty: z.enum(['Foundation', 'Intermediate', 'Advanced']),
  category: nonEmpty,
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  description: z.string().trim().min(20),
  briefing: z.string().trim().min(20),
  businessContext: z.string().trim().min(20),
  primaryUser: nonEmpty,
  primaryHost: nonEmpty,
  users: z.array(nonEmpty).min(1),
  hosts: z.array(nonEmpty).min(1),
  alerts: z.array(nonEmpty).min(1),
  dataSources: z.array(eventSourceSchema).min(1),
  metadata: metadataSchema,
  noiseCount: z.number().int().nonnegative().max(10_000).optional(),
  noiseSources: z.array(eventSourceSchema).min(1).optional(),
  expectedVerdict: z.enum(['true-positive', 'false-positive', 'mixed']),
  attackEvents: z.array(attackEventSchema).min(1),
  questions: z.array(questionSchema).min(1),
  answers: z.record(answerSchema),
  iocs: z.array(iocSchema),
  mitre: z.array(mitreSchema).min(1),
  explanation: z.string().trim().min(20),
  reasoning: z.array(z.string().trim().min(10)).min(1),
  queries: z.object({
    kql: z.array(nonEmpty).min(1),
    spl: z.array(nonEmpty).min(1),
    sigma: nonEmpty.optional(),
  }).strict(),
  responseActions: z.array(z.string().trim().min(8)).min(1),
  remediationActions: z.array(z.string().trim().min(8)).min(1),
}).strict();

export type ScenarioSchemaInput = z.input<typeof scenarioSchema>;
