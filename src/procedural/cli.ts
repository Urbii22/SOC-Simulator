import fs from 'node:fs';
import path from 'node:path';
import { generateProceduralScenario, ProceduralGenerationError } from './engine.js';
import { proceduralDifficultySchema, proceduralRequestSchema, type ProceduralRequest } from './schema.js';
import { listProceduralTemplates, proceduralTemplateById } from './templates.js';

interface CliIo { out(value: string): void; error(value: string): void }
const defaultIo: CliIo = { out: console.log, error: console.error };

interface ParsedArgs {
  list: boolean;
  json: boolean;
  random: boolean;
  template?: string;
  seed?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  output?: string;
}

function takeValue(args: string[], index: number, inline: string | undefined, flag: string): [string, number] {
  if (inline !== undefined) {
    if (!inline) throw new Error(`${flag} requires a value`);
    return [inline, index];
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = { list: false, json: false, random: false };
  for (let index = 0; index < args.length; index++) {
    const [flag, inline] = args[index].split(/=(.*)/s, 2);
    if (flag === '--list') result.list = true;
    else if (flag === '--json') result.json = true;
    else if (flag === '--random') result.random = true;
    else if (['--template', '--seed', '--difficulty', '--output'].includes(flag)) {
      const [value, nextIndex] = takeValue(args, index, inline, flag); index = nextIndex;
      if (flag === '--template') result.template = value;
      if (flag === '--output') result.output = value;
      if (flag === '--seed') {
        if (!/^\d+$/.test(value)) throw new Error('--seed must be an integer between 0 and 4294967295');
        result.seed = Number(value);
      }
      if (flag === '--difficulty') {
        const parsed = proceduralDifficultySchema.safeParse(value);
        if (!parsed.success) throw new Error('--difficulty must be easy, medium or hard');
        result.difficulty = parsed.data;
      }
    } else throw new Error(`Unknown option ${flag}`);
  }
  return result;
}

function payloadFor(request: ProceduralRequest) {
  const generated = generateProceduralScenario(request);
  return {
    variantId: generated.variantId,
    scenarioId: generated.scenarioId,
    seed: generated.seed,
    difficulty: generated.difficulty,
    mode: generated.mode,
    hash: generated.hash,
    validation: {
      errors: generated.validation.issues.filter(({ severity }) => severity === 'error').length,
      warnings: generated.validation.issues.filter(({ severity }) => severity === 'warning').length,
      metrics: generated.validation.metrics,
    },
    scenario: generated.scenario,
    events: generated.events,
  };
}

export function runProceduralCli(args: string[], io: CliIo = defaultIo): number {
  try {
    const options = parseArgs(args);
    if (options.list) {
      const templates = listProceduralTemplates();
      io.out(options.json ? JSON.stringify(templates, null, 2) : templates.map((item) => `${item.id.padEnd(24)} ${item.name} [${item.defaultDifficulty}]`).join('\n'));
      return 0;
    }
    if (options.random === Boolean(options.template)) throw new Error('Choose exactly one of --template or --random');
    if (options.seed === undefined) throw new Error('--seed is required');
    if (options.template && !proceduralTemplateById.has(options.template)) throw new Error(`Unknown template ${options.template}`);
    const request = proceduralRequestSchema.parse({ template: options.template, random: options.random, seed: options.seed, difficulty: options.difficulty });
    const payload = payloadFor(request);
    const serialized = JSON.stringify(payload, null, 2);
    if (options.output) {
      const target = path.resolve(options.output);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `${serialized}\n`, 'utf8');
      io.out(options.json ? serialized : `Generated ${payload.variantId}\nHash ${payload.hash}\nOutput ${target}`);
      return 0;
    }
    if (options.json) { io.out(serialized); return 0; }
    const target = path.resolve('output', 'procedural', `${payload.scenarioId}.json`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${serialized}\n`, 'utf8');
    io.out(`Generated ${payload.variantId}\nHash ${payload.hash}\nEvents ${payload.events.length}\nValidation 0 errors, ${payload.validation.warnings} warnings\nOutput ${target}`);
    return 0;
  } catch (error) {
    const message = error instanceof ProceduralGenerationError || error instanceof Error ? error.message : 'Unknown generation error';
    io.error(message);
    return 2;
  }
}
