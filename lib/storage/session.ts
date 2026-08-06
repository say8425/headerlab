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
  /**
   * Set when the rules registered but the toolbar icon could not be updated.
   *
   * Separate from `lastError` because the two say opposite things about
   * whether headers are being modified, and the popup states each of them
   * outright. Folding an icon failure into `lastError` would put it under
   * "Rules not registered" — which would be false, and the wrong falsehood:
   * it under-reports that the extension *is* active.
   *
   * Required rather than optional so a caller cannot omit it and have that
   * read as "no error".
   */
  iconError: string | null;
}

const DEFAULT_STATUS: SyncStatus = { lastError: null, ruleCount: 0, iconError: null };

export const syncStatusItem = storage.defineItem<SyncStatus>('session:syncStatus', {
  fallback: DEFAULT_STATUS,
});

export async function getSyncStatus(): Promise<SyncStatus> {
  return (await syncStatusItem.getValue()) ?? DEFAULT_STATUS;
}

export async function setSyncStatus(status: SyncStatus): Promise<void> {
  await syncStatusItem.setValue(status);
}
