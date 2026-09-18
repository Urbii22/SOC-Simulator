import { scenarioDefinitions } from './definitions.js';
import { validateScenarioCatalog } from './validation.js';
import type { CatalogValidationReport, ValidationSeverity } from './validation-types.js';

interface CliOptions { scenarioId?: string; strict: boolean; json: boolean; verbose: boolean }
interface CliIo { out(message: string): void; error(message: string): void }

function parseArgs(args: string[]): { options?: CliOptions; error?: string } {
  const options: CliOptions = { strict: false, json: false, verbose: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--strict') options.strict = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--verbose') options.verbose = true;
    else if (argument === '--scenario') {
      const value = args[++index];
      if (!value || value.startsWith('--')) return { error: '--scenario requires an id' };
      options.scenarioId = value;
    } else if (argument.startsWith('--scenario=')) {
      const value = argument.slice('--scenario='.length);
      if (!value) return { error: '--scenario requires an id' };
      options.scenarioId = value;
    }
    else return { error: `unknown option ${argument}` };
  }
  return { options };
}

export function validationExitCode(report: CatalogValidationReport, strict: boolean): number {
  return report.errorCount > 0 || (strict && report.warningCount > 0) ? 1 : 0;
}

function icon(errors: number, warnings: number): string {
  return errors ? '✗' : warnings ? '⚠' : '✓';
}

function formatIssue(severity: ValidationSeverity): string {
  return severity === 'error' ? 'ERROR' : severity === 'warning' ? 'WARNING' : 'INFO';
}

export function runValidationCli(args: string[], io: CliIo = { out: console.log, error: console.error }): number {
  const parsed = parseArgs(args);
  if (!parsed.options) { io.error(parsed.error ?? 'invalid arguments'); return 2; }
  const options = parsed.options;
  const selected = options.scenarioId ? scenarioDefinitions.filter((scenario) => scenario.id === options.scenarioId) : scenarioDefinitions;
  if (!selected.length) { io.error(`Unknown scenario: ${options.scenarioId}`); return 2; }
  const report = validateScenarioCatalog(selected);
  if (options.json) {
    io.out(JSON.stringify({
      summary: { scenarios: report.results.length, errors: report.errorCount, warnings: report.warningCount, infos: report.infoCount, events: report.totalEvents },
      scenarios: report.results.map((result) => ({ scenario: result.scenarioId, title: result.title, metrics: result.metrics, checks: result.checks })),
      findings: report.findings.map(({ scenarioId, rule, severity, message, path, context }) => ({ scenario: scenarioId, rule, severity, message, path, context })),
    }, null, 2));
    return validationExitCode(report, options.strict);
  }
  for (const result of report.results) {
    io.out(`\n${result.scenarioId} — ${result.title}`);
    for (const check of result.checks) io.out(`${icon(check.errors, check.warnings)} ${check.rule}`);
    for (const finding of result.issues.filter((item) => item.severity !== 'info' || options.verbose)) {
      io.out(`  ${formatIssue(finding.severity)} [${finding.rule}] ${finding.message}${finding.path ? ` (${finding.path})` : ''}`);
    }
    if (options.verbose) io.out(`  metrics: ${result.metrics.eventCount} events, ${result.metrics.sourceCount} sources, ${(result.metrics.noiseRatio * 100).toFixed(1)}% noise`);
  }
  for (const finding of report.findings.filter((item) => item.scenarioId === 'catalog' && (item.severity !== 'info' || options.verbose))) {
    io.out(`\n${formatIssue(finding.severity)} [${finding.rule}] ${finding.message}${finding.path ? ` (${finding.path})` : ''}`);
  }
  io.out(`\nResult: ${report.results.length} scenarios | ${report.errorCount} errors | ${report.warningCount} warnings | ${report.infoCount} info | ${report.totalEvents} events`);
  return validationExitCode(report, options.strict);
}
