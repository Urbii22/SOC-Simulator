import { SeededRng } from './rng.js';

export const syntheticPools = {
  givenNames: ['alba', 'bruno', 'celia', 'dario', 'elena', 'fabian', 'gala', 'hector', 'ines', 'julio', 'lara', 'marco', 'nerea', 'oscar', 'paula', 'quim', 'rocio', 'simon', 'tania', 'unai'],
  surnames: ['albor', 'bernal', 'cobos', 'duarte', 'estela', 'ferrer', 'galan', 'haro', 'ibarra', 'jorba', 'lago', 'miret', 'nadal', 'olmo', 'prats', 'rivas', 'soler', 'tello', 'uriel', 'valls'],
  departments: ['finance', 'legal', 'sales', 'research', 'people', 'support', 'operations', 'marketing', 'engineering', 'security'],
  roles: ['analyst', 'coordinator', 'engineer', 'manager', 'specialist', 'operator', 'auditor', 'planner'],
  hostRoles: ['wks', 'srv', 'app', 'db', 'jump', 'proxy', 'dns', 'mail', 'files', 'gateway', 'node', 'portal'],
  domainPrefixes: ['asset-sync', 'content-edge', 'docs-review', 'media-cache', 'service-gateway', 'status-node', 'update-cdn', 'workspace-api'],
  services: ['AssetMonitor', 'CacheRelay', 'DocumentIndex', 'HealthAgent', 'InventorySync', 'MetricsBridge', 'PolicyWorker', 'ReportQueue'],
  filenames: {
    exe: ['AssetCache.exe', 'DocumentSync.exe', 'MediaHelper.exe', 'ReportAgent.exe', 'UpdateBridge.exe'],
    ps1: ['Audit-Inventory.ps1', 'Check-Compliance.ps1', 'Refresh-Profile.ps1', 'Update-Catalog.ps1'],
    zip: ['documents-review.zip', 'meeting-pack.zip', 'project-assets.zip', 'quarterly-notes.zip'],
    docm: ['account-review.docm', 'benefits-update.docm', 'project-brief.docm', 'supplier-notice.docm'],
    php: ['cache-status.php', 'health-check.php', 'media-view.php', 'support-info.php'],
    aspx: ['cache-status.aspx', 'health-check.aspx', 'media-view.aspx', 'support-info.aspx'],
    jsp: ['cache-status.jsp', 'health-check.jsp', 'media-view.jsp', 'support-info.jsp'],
    dat: ['asset-cache.dat', 'content-index.dat', 'report-buffer.dat', 'sync-state.dat'],
    bak: ['creative-archive.bak', 'document-store.bak', 'media-library.bak', 'project-vault.bak'],
  },
} as const;

export function syntheticUsername(rng: SeededRng, index: number): string {
  const first = syntheticPools.givenNames[(rng.int(0, syntheticPools.givenNames.length - 1) + index) % syntheticPools.givenNames.length];
  const last = syntheticPools.surnames[(rng.int(0, syntheticPools.surnames.length - 1) + index * 3) % syntheticPools.surnames.length];
  return `${first}.${last}`;
}

export function syntheticServiceAccount(rng: SeededRng, index: number): string {
  const service = syntheticPools.services[(rng.int(0, syntheticPools.services.length - 1) + index) % syntheticPools.services.length];
  return `svc.${service.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^-/, '')}`;
}

export function syntheticHostname(rng: SeededRng, index: number): string {
  const department = syntheticPools.departments[(rng.int(0, syntheticPools.departments.length - 1) + index) % syntheticPools.departments.length].slice(0, 4);
  const role = syntheticPools.hostRoles[(rng.int(0, syntheticPools.hostRoles.length - 1) + index * 2) % syntheticPools.hostRoles.length];
  return `${department}-${role}-${String(rng.int(1, 89)).padStart(2, '0')}`;
}

export function syntheticDomain(rng: SeededRng, index: number): string {
  const prefix = syntheticPools.domainPrefixes[(rng.int(0, syntheticPools.domainPrefixes.length - 1) + index) % syntheticPools.domainPrefixes.length];
  return `${prefix}-${rng.int(10, 999)}.example`;
}

export function syntheticFilename(extension: keyof typeof syntheticPools.filenames, rng: SeededRng, index: number): string {
  const values = syntheticPools.filenames[extension];
  return values[(rng.int(0, values.length - 1) + index) % values.length];
}
