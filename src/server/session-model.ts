import { z } from 'zod';

export const sessionIdSchema = z.string().regex(/^cs-[0-9a-f]{32}$/);
export const incidentIdSchema = z.string().regex(/^incident-[0-9]{2}$/);
export const sessionSeedSchema = z.union([
  z.number().int().min(0).max(0xffff_ffff),
  z.string().regex(/^session:(?:0|[1-9][0-9]{0,9})$/),
]).transform((value) => typeof value === 'number' ? value : Number(value.slice(8)))
  .refine((value) => value <= 0xffff_ffff, 'Session seed is outside the uint32 range');

const modeSchema = z.enum(['quick', 'training', 'shift', 'custom']);
const difficultySchema = z.enum(['easy', 'medium', 'hard', 'mixed', 'progressive']);
const sourceSchema = z.enum(['procedural', 'canonical', 'mixed']);
const truthSchema = z.enum(['any', 'true-positive', 'false-positive', 'mixed']);
const identifier = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const createSessionSchema = z.object({
  mode: modeSchema,
  seed: sessionSeedSchema.optional(),
  count: z.number().int().min(1).max(10).optional(),
  difficulty: difficultySchema.optional(),
  source: sourceSchema.optional(),
  truth: truthSchema.optional(),
  categories: z.array(z.string().trim().min(2).max(80)).max(20).optional(),
  templates: z.array(identifier).max(9).optional(),
}).strict().superRefine((input, context) => {
  if (input.mode !== 'custom' && (input.count !== undefined || input.categories || input.templates || input.truth !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Advanced filters are only valid in custom mode' });
  }
  if (input.mode === 'custom' && input.count === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['count'], message: 'Custom mode requires an incident count' });
  }
  if (input.source === 'canonical' && input.templates?.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['templates'], message: 'Template filters cannot be used with canonical-only sessions' });
  }
  if (input.source === 'procedural' && input.categories?.length && input.templates?.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose category filters or template filters, not both' });
  }
});

export const revisionSchema = z.object({ revision: z.number().int().nonnegative() }).strict();
const answerValueSchema = z.union([z.string().max(2_000), z.boolean()]);
export const progressSchema = z.object({
  revision: z.number().int().nonnegative(),
  notes: z.string().max(10_000).optional(),
  answers: z.record(z.string().regex(/^[a-z][a-z0-9_-]*$/), answerValueSchema).optional(),
  evidence: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  verdict: z.enum(['true-positive', 'false-positive', 'mixed']).optional(),
  severityAssessment: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  actions: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
}).strict().refine((input) => Object.keys(input).some((key) => key !== 'revision'), 'No progress fields supplied');
export const submissionSchema = z.object({
  revision: z.number().int().nonnegative(),
  answers: z.record(z.string().regex(/^[a-z][a-z0-9_-]*$/), answerValueSchema),
}).strict();
export const repeatSchema = z.object({
  strategy: z.enum(['exact', 'equivalent', 'template-new-seed', 'retry-failed']),
}).strict();

const isoDate = z.string().datetime({ offset: true });
const difficultyLevel = z.enum(['easy', 'medium', 'hard']);
const storedConfigSchema = z.object({
  mode: modeSchema, count: z.number().int().min(1).max(10), difficulty: difficultySchema,
  source: sourceSchema, truth: truthSchema,
  categories: z.array(z.string().max(80)).max(20), templates: z.array(identifier).max(9),
}).strict();
const planSchema = z.object({
  source: z.enum(['procedural', 'canonical']), definitionId: identifier.optional(), templateId: identifier.optional(),
  seed: z.number().int().min(0).max(0xffff_ffff), difficulty: difficultyLevel,
}).strict().superRefine((plan, context) => {
  if (plan.source === 'canonical' && !plan.definitionId) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Canonical plans require definitionId' });
  if (plan.source === 'procedural' && !plan.templateId) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Procedural plans require templateId' });
});
const feedbackSchema = z.object({ questionId: identifier, correct: z.boolean(), expected: z.string().max(2_000), explanation: z.string().max(10_000) }).strict();
const storedResultSchema = z.object({
  score: z.number().int().min(0).max(100), earned: z.number().nonnegative(), total: z.number().positive(),
  adjustedScore: z.number().int().min(0).max(100), hintPenalty: z.number().int().min(0).max(20),
  feedback: z.array(feedbackSchema).max(30), verdictCorrect: z.boolean().nullable(),
}).strict();
const hintSchema = z.object({ level: z.number().int().min(1).max(4), text: z.string().min(1).max(2_000), requestedAt: isoDate, penalty: z.number().int().min(0).max(10) }).strict();
const incidentSchema = z.object({
  id: incidentIdSchema, position: z.number().int().min(1).max(10), plan: planSchema,
  status: z.enum(['New', 'Investigating', 'Submitted']), progress: z.number().int().min(0).max(100),
  notes: z.string().max(10_000), answers: z.record(answerValueSchema), evidence: z.array(z.string().max(500)).max(50),
  verdict: z.enum(['true-positive', 'false-positive', 'mixed']).optional(), severityAssessment: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  actions: z.array(z.string().max(500)).max(30), hints: z.array(hintSchema).max(4),
  startedAt: isoDate.optional(), firstInteractionAt: isoDate.optional(), submittedAt: isoDate.optional(), elapsedMs: z.number().int().nonnegative(),
  result: storedResultSchema.optional(),
}).strict();
export const storedSessionSchema = z.object({
  id: sessionIdSchema, sessionSeed: z.number().int().min(0).max(0xffff_ffff), planHash: z.string().regex(/^[0-9a-f]{64}$/),
  revision: z.number().int().nonnegative(), status: z.enum(['created', 'active', 'completed']), config: storedConfigSchema,
  createdAt: isoDate, startedAt: isoDate.optional(), firstInteractionAt: isoDate.optional(), completedAt: isoDate.optional(),
  elapsedMs: z.number().int().nonnegative(), currentIndex: z.number().int().min(0).max(9), incidents: z.array(incidentSchema).min(1).max(10),
}).strict();
export const sessionDocumentSchema = z.object({
  schemaVersion: z.literal(1), sessions: z.record(sessionIdSchema, storedSessionSchema),
}).strict();

export type CreateSessionInput = z.output<typeof createSessionSchema>;
export type StoredSession = z.infer<typeof storedSessionSchema>;
export type StoredIncident = StoredSession['incidents'][number];
export type StoredConfig = StoredSession['config'];
export type IncidentPlan = StoredIncident['plan'];
export type ProgressInput = z.infer<typeof progressSchema>;
