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

/**
 * What the agent bridge is doing. Session-scoped for the same reason
 * {@link SyncStatus} is, and more sharply: a native port belongs to one
 * worker session, so a `connected: true` that survived a browser restart
 * would be a claim about a port that no longer exists.
 */
export interface BridgeStatus {
  /** True while a native port is open. */
  connected: boolean;
  /**
   * ISO timestamp of the last command the bridge actually applied, or null.
   *
   * Shown in the popup as a `title`, not as a line of its own — the rail has
   * 28px of slack and the bridge row spends all of it.
   */
  lastCommandAt: string | null;
  /**
   * Chrome's own message from the last failed connect, or null.
   *
   * Kept verbatim rather than translated. Chrome gives the *same* message
   * whether the host manifest is missing, names a different extension, or
   * points at an interpreter that cannot start (measured) — so any sentence
   * this code wrote instead would be a guess presented as a diagnosis.
   */
  lastError: string | null;
}

export const DEFAULT_BRIDGE_STATUS: BridgeStatus = {
  connected: false,
  lastCommandAt: null,
  lastError: null,
};

export const bridgeStatusItem = storage.defineItem<BridgeStatus>('session:bridgeStatus', {
  fallback: DEFAULT_BRIDGE_STATUS,
});

export async function getBridgeStatus(): Promise<BridgeStatus> {
  return (await bridgeStatusItem.getValue()) ?? DEFAULT_BRIDGE_STATUS;
}

/**
 * Merges one field into the record.
 *
 * Three separate events write to this — the port opening, a command being
 * applied, and a disconnect — and each knows only its own field. A
 * whole-record write from any of them would erase what the other two said,
 * which is how `lastCommandAt` would vanish every time the port blinked.
 */
let pending: Promise<void> = Promise.resolve();

export function patchBridgeStatus(patch: Partial<BridgeStatus>): Promise<void> {
  const result = pending.then(async () => {
    const current = await getBridgeStatus();
    await bridgeStatusItem.setValue({ ...current, ...patch });
  });
  // `pending` is the shared baton, and it must never reject — chaining the
  // next call onto a rejected promise would skip that call's own read/write
  // entirely (a `.then` with no rejection handler propagates the rejection
  // instead of running), silently stopping the bridge status from updating
  // for the rest of the session over one storage failure. `result`, handed
  // back to *this* call's caller, is left alone — it still reflects this
  // patch's own outcome.
  pending = result.catch(() => {});
  return result;
}
