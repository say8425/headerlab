import { storage } from '#imports';

/**
 * What the last reconcile did. Session-scoped on purpose: a failure message
 * from a previous browser session describes rules that no longer exist.
 *
 * WXT requires an area prefix on every key.
 */
export interface SyncStatus {
  /** Null when the last reconcile succeeded. */
  lastError: string | null;
  /** Rules registered by the last successful reconcile. */
  ruleCount: number;
}

const DEFAULT_STATUS: SyncStatus = { lastError: null, ruleCount: 0 };

export const syncStatusItem = storage.defineItem<SyncStatus>('session:syncStatus', {
  fallback: DEFAULT_STATUS,
});

export async function getSyncStatus(): Promise<SyncStatus> {
  return (await syncStatusItem.getValue()) ?? DEFAULT_STATUS;
}

export async function setSyncStatus(status: SyncStatus): Promise<void> {
  await syncStatusItem.setValue(status);
}
