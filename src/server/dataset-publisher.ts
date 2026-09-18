import type { SecurityEvent } from '../domain/types.js';

/** Boundary for a future per-session SIEM publisher. Implementations must never receive solution data. */
export interface TrainingDatasetPublisher {
  publish(namespace: string, events: readonly SecurityEvent[]): Promise<number>;
  cleanup(namespace: string): Promise<boolean>;
}

export function challengeDatasetNamespace(sessionId: string, incidentId: string): string {
  if (!/^cs-[0-9a-f]{32}$/.test(sessionId) || !/^incident-[0-9]{2}$/.test(incidentId)) throw new Error('Invalid challenge dataset identity');
  return `soc-training-session-${sessionId}-${incidentId}`;
}
