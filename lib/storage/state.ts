import { storage } from '#imports';
import { DEFAULT_STATE, STATE_VERSION } from '@/lib/model/defaults';
import { parseAppState } from '@/lib/model/schema';
import type { AppState } from '@/lib/model/types';

/**
 * The single source of truth. chrome.storage.local only — sync caps items at
 * 8KB, and this product's premise is that nothing leaves the machine.
 * Backup is explicit JSON export/import.
 *
 * Add a `migrations` entry keyed by the new version number when bumping
 * STATE_VERSION; WXT runs them automatically.
 */
export const stateItem = storage.defineItem<AppState>('local:state', {
  fallback: DEFAULT_STATE,
  version: STATE_VERSION,
});

export async function getState(): Promise<AppState> {
  const value = await stateItem.getValue();
  try {
    return parseAppState(value);
  } catch (error) {
    // Whatever sits at local:state is a trust boundary — a hand-edited or
    // partially-migrated value must not flow into compile() unvalidated.
    // Not silent: surfaced so a corrupted store is diagnosable, not just
    // quietly reset.
    console.error('[HeaderLab] stored state failed validation, falling back to defaults', error);
    return DEFAULT_STATE;
  }
}

export async function setState(next: AppState): Promise<void> {
  await stateItem.setValue(next);
}

/**
 * Merges a patch into the stored state, re-reading immediately before the
 * write.
 *
 * The popup used to replace the whole AppState. That made the last writer win
 * over keys it never touched — and design §6.3 has the background worker
 * writing state too (releasing a tab lock whose tab is gone). It also made the
 * unknown-key stripping in `parseAppState` permanent: a key written by a newer
 * version, read and stripped by an older one, was gone on the next edit.
 *
 * Top-level merge only. Concurrent edits to `profiles` itself are Phase 2c,
 * where tab lock actually starts writing.
 */
export async function patchState(patch: Partial<AppState>): Promise<AppState> {
  const current = await getState();
  const next: AppState = { ...current, ...patch };
  await setState(next);
  return next;
}
