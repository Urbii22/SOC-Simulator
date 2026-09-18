import { scenarioDefinitions } from './definitions.js';
import { validateScenarioCatalog } from './validation.js';
import type { CatalogValidationReport } from './validation-types.js';

function cell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function generateCoverageMarkdown(report: CatalogValidationReport = validateScenarioCatalog()): string {
  const rows = report.results.map((result, index) => {
    const scenario = scenarioDefinitions[index];
    return `| ${index + 1} | ${scenario.id} — ${cell(scenario.title)} | ${scenario.difficulty} | ${cell(scenario.category)} | ${scenario.dataSources.join(', ')} | ${result.metrics.eventCount} | ${result.metrics.hostCount} | ${result.metrics.userCount} | ${result.metrics.iocCount} | ${scenario.mitre.map((item) => `${item.id} (${item.tactic})`).join(', ')} | ${scenario.expectedVerdict} | ${result.metrics.relevantSourceCount} fuentes / ${result.metrics.evidenceReferenceCount} evidencias |`;
  });
  const techniqueCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  for (const scenario of scenarioDefinitions) {
    for (const technique of scenario.mitre) techniqueCounts.set(technique.id, (techniqueCounts.get(technique.id) ?? 0) + 1);
    for (const source of scenario.dataSources) sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  }
  const techniqueSummary = [...techniqueCounts].sort((left, right) => right[1] - left[1]).map(([id, count]) => `${id}: ${count}`).join(', ');
  const sourceSummary = [...sourceCounts].sort((left, right) => right[1] - left[1]).map(([source, count]) => `${source}: ${count}`).join(', ');
  return `# Matriz de cobertura\n\n> Generada automáticamente con \`npm run generate:coverage\`. No editar manualmente.\n\n| ID | Escenario | Dificultad | Categoría | Fuentes declaradas | Eventos | Hosts | Usuarios | IOC | MITRE (táctica) | Resultado | Correlación |\n|---:|---|---|---|---|---:|---:|---:|---:|---|---|---|\n${rows.join('\n')}\n\n## Distribución\n\n- Técnicas: ${techniqueSummary}.\n- Fuentes: ${sourceSummary}.\n- Validación: ${report.errorCount} errores, ${report.warningCount} warnings, ${report.infoCount} observaciones; ${report.totalEvents} eventos.\n`;
}
