import type { GradeResult } from '../domain/types.js';
import type { ScenarioDefinition } from '../scenarios/model.js';

export type SubmittedAnswers = Record<string, string | boolean>;

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isBlank(value: string): boolean {
  return value.replace(/[\p{White_Space}\u200B-\u200D\u2060\uFEFF]/gu, '').length === 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsDelimited(candidate: string, accepted: string): boolean {
  if (accepted.length <= 4) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(accepted)}($|[^\\p{L}\\p{N}])`, 'u').test(candidate);
}

export function answerMatches(given: string | boolean, expected: string | boolean, aliases: string[] = []): boolean {
  if (typeof expected === 'boolean') return typeof given === 'boolean' && given === expected;
  if (typeof given !== 'string') return false;
  const candidate = normalize(given);
  return [expected, ...aliases].map(normalize).some((accepted) => candidate === accepted || containsDelimited(candidate, accepted));
}

export function validateSubmittedAnswers(scenario: ScenarioDefinition, answers: SubmittedAnswers): string | undefined {
  const questions = new Map(scenario.questions.map((question) => [question.id, question]));
  if (Object.keys(answers).some((id) => !questions.has(id))) return 'Submission contains an unknown question id';
  for (const question of scenario.questions) {
    if (!Object.hasOwn(answers, question.id)) return 'Complete every investigation question before submission';
    const value = answers[question.id];
    if (question.type === 'boolean' && typeof value !== 'boolean') return `Answer ${question.id} must be boolean`;
    if (question.type === 'text' && (typeof value !== 'string' || isBlank(value))) return `Answer ${question.id} must be non-empty text`;
    if (question.type === 'single') {
      if (typeof value !== 'string' || !question.options?.some((option) => normalize(option) === normalize(value))) {
        return `Answer ${question.id} must be one of its declared options`;
      }
    }
  }
  return undefined;
}

export function gradeScenarioAnswers(scenario: ScenarioDefinition, answers: SubmittedAnswers): Pick<GradeResult, 'score' | 'earned' | 'total' | 'feedback'> {
  let earned = 0;
  const feedback = scenario.questions.map((question) => {
    const key = scenario.answers[question.id];
    const correct = answerMatches(answers[question.id], key.value, key.aliases);
    if (correct) earned += question.points;
    return { questionId: question.id, correct, expected: String(key.value), explanation: key.explanation };
  });
  const total = scenario.questions.reduce((sum, question) => sum + question.points, 0);
  const score = total > 0 ? Math.min(100, Math.max(0, Math.round(earned / total * 100))) : 0;
  return { score, earned, total, feedback };
}
