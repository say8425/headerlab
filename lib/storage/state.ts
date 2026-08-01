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
