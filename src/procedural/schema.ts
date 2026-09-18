import { z } from 'zod';
import { answerSchema, eventSourceSchema, iocSchema, mitreSchema, questionSchema } from '../scenarios/schema.js';

export const proceduralDifficultySchema = z.enum(['easy', 'medium', 'hard']);
export type ProceduralDifficulty = z.infer<typeof proceduralDifficultySchema>;

const identifier = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const boundedCount = z.number().int().nonnegative().max(500);

const phaseSchema = z.object({
  id: identifier,
  name: z.string().trim().min(3),
  eventIndexes: z.array(z.number().int().nonnegative().max(200)).min(1),
  dependsOn: z.array(identifier),
}).strict();

export const proceduralTemplateSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  name: z.string().trim().min(5),
  category: z.string().trim().min(3),
  blueprintScenarioId: identifier,
  defaultDifficulty: proceduralDifficultySchema,
  supportedDifficulties: z.array(proceduralDifficultySchema).min(1).refine((values) => new Set(values).size === values.length, 'Duplicate difficulty'),
  mitre: z.array(mitreSchema).min(1),
  logSources: z.array(eventSourceSchema).min(1).refine((values) => new Set(values).size === values.length, 'Duplicate log source'),
  actors: z.array(z.object({
    id: identifier,
    kind: z.enum(['person', 'service', 'system', 'external']),
    role: z.string().trim().min(3),
    pool: z.enum(['users', 'service-accounts', 'system-principals', 'external-identities']),
  }).strict()).min(1),
  infrastructure: z.array(z.object({
    id: identifier,
    kind: z.enum(['workstation', 'server', 'network', 'identity', 'cloud', 'external']),
    role: z.string().trim().min(3),
    pool: z.enum(['hosts', 'private-ips', 'documentation-ips', 'domains', 'services', 'files']),
  }).strict()).min(1),
  phases: z.array(phaseSchema).min(1),
  constraints: z.object({
    causalOrder: z.literal(true),
    minAttackEvents: z.number().int().positive().max(200),
    maxEvents: z.number().int().positive().max(500),
    maxDurationMinutes: z.number().int().positive().max(10_080),
  }).strict(),
  parameters: z.array(z.object({
    id: identifier,
    kind: z.enum(['integer', 'enum', 'timestamp', 'ratio']),
    affects: z.array(z.enum(['actors', 'hosts', 'network', 'timeline', 'noise', 'iocs', 'attack-details'])).min(1),
  }).strict()).min(1),
  noise: z.object({
    profile: z.enum(['corporate', 'cloud', 'datacenter', 'mixed']),
    counts: z.object({ easy: boundedCount, medium: boundedCount, hard: boundedCount }).strict(),
    contextual: z.literal(true),
  }).strict(),
  truth: z.enum(['true-positive', 'false-positive', 'mixed']),
  investigation: z.object({
    questions: z.array(questionSchema).min(1),
    answers: z.record(answerSchema),
    evidenceMode: z.literal('rewrite-and-validate'),
    iocs: z.array(iocSchema),
    queries: z.object({ kql: z.array(z.string().min(1)).min(1), spl: z.array(z.string().min(1)).min(1), sigma: z.string().min(1).optional() }).strict(),
  }).strict(),
}).strict().superRefine((template, context) => {
  const phaseIds = new Set(template.phases.map(({ id }) => id));
  const indexes = template.phases.flatMap(({ eventIndexes }) => eventIndexes);
  if (new Set(indexes).size !== indexes.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['phases'], message: 'Attack event indexes must belong to exactly one phase' });
  for (const [index, phase] of template.phases.entries()) {
    for (const dependency of phase.dependsOn) if (!phaseIds.has(dependency)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['phases', index, 'dependsOn'], message: `Unknown phase dependency ${dependency}` });
    if (phase.dependsOn.includes(phase.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['phases', index, 'dependsOn'], message: 'A phase cannot depend on itself' });
  }
});

export const proceduralRequestSchema = z.object({
  template: identifier.optional(),
  random: z.boolean().optional().default(false),
  seed: z.number().int().min(0).max(0xffff_ffff),
  difficulty: proceduralDifficultySchema.optional(),
  parameters: z.object({
    noiseCount: z.number().int().min(20).max(300).optional(),
    timelineScale: z.number().min(0.5).max(2.5).multipleOf(0.001).optional(),
  }).strict().optional(),
}).strict().superRefine((request, context) => {
  if (request.random === Boolean(request.template)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['template'], message: 'Choose exactly one of template or random' });
});

export type ProceduralTemplate = z.infer<typeof proceduralTemplateSchema>;
export type ProceduralRequest = z.input<typeof proceduralRequestSchema>;
