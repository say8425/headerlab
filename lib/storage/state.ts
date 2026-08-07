import { storage } from '#imports';
import { DEFAULT_STATE, STATE_VERSION } from '@/lib/model/defaults';
import { migrateToV2 } from '@/lib/model/migrate';
import { parseAppState } from '@/lib/model/schema';
import type { AppState } from '@/lib/model/types';

/**
 * The single source of truth. chrome.storage.local only — sync caps items at
 * 8KB, and this product's premise is that nothing leaves the machine.
 * Backup is explicit JSON export/import.
 *
 * Add a `migrations` entry keyed by the new version number when bumping
 * STATE_VERSION; WXT runs them automatically.
 *
 * **They run once, at module evaluation, not per read.** WXT builds the
 * migration promise here in `defineItem` and every `getValue()` awaits it, so
 * a value written to `local:state` *after* this module loaded is never
 * migrated. Nothing in the extension does that — storage is written through
 * `setState` in this build's own shape — but a test or an e2e fixture that
 * plants an older shape directly has to plant the matching `state$` version
 * too, or it will be read as-is and fail validation.
 */
export const stateItem = storage.defineItem<AppState>('local:state', {
  fallback: DEFAULT_STATE,
  version: STATE_VERSION,
  migrations: {
    // v1 stored no `allSites`, and an empty domain list was how "everywhere"
    // was spelled. lib/model/migrate.ts holds the transform and the reasoning.
    2: migrateToV2,
  },
});

export interface LoadedState {
  /** Always usable: the parsed state, or the defaults when parsing failed. */
  state: AppState;
  /**
   * False when the stored bytes failed validation and `state` is the fallback.
   *
   * The distinction exists because "empty" and "invalid" look identical once
   * both are `DEFAULT_STATE`, and they call for opposite behaviour: an empty
   * store is a fresh install that should be written to, while an invalid one
   * is somebody's work in a shape this build cannot read — and writing to it
   * destroys the bytes that could still be recovered. The popup used to mint a
   * profile onto the fallback and `patchState` then wrote it over the original,
   * so opening the popup was enough to lose the lot.
   */
  valid: boolean;
}

/**
 * Reads and validates the store, reporting *whether* it validated.
 *
 * Callers that only compile can keep using {@link getState}; callers that
 * might **write** have to know, because a write derived from the fallback
 * overwrites whatever was really there.
 */
export async function loadState(): Promise<LoadedState> {
  const value = await stateItem.getValue();
  try {
    return { state: parseAppState(value), valid: true };
  } catch (error) {
    // Whatever sits at local:state is a trust boundary — a hand-edited or
    // partially-migrated value must not flow into compile() unvalidated.
    // Not silent: surfaced so a corrupted store is diagnosable, not just
    // quietly reset. The popup says so on screen too — a console line in a
    // window that has since closed is not something anyone sees.
    console.error('[HeaderLab] stored state failed validation, falling back to defaults', error);
    return { state: DEFAULT_STATE, valid: false };
  }
}

export async function getState(): Promise<AppState> {
  return (await loadState()).state;
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
