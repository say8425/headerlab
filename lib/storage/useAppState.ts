import { useEffect, useState } from 'react';
import { loadState, patchState, stateItem } from '@/lib/storage/state';
import type { AppState } from '@/lib/model/types';

export function useAppState() {
  const [state, setLocal] = useState<AppState | null>(null);
  // Starts true so the first render is "loading", not "broken".
  const [valid, setValid] = useState(true);

  useEffect(() => {
    loadState().then((loaded) => {
      setLocal(loaded.state);
      setValid(loaded.valid);
    });
    return stateItem.watch((next) => setLocal(next));
  }, []);

  /**
   * Applies a patch derived from the current state. The optimistic local
   * update keeps typing responsive; `patchState` re-reads before writing, so
   * another writer's untouched top-level keys survive.
   *
   * The watcher re-syncs local state to whatever landed in storage. It does
   * not reconcile two in-flight patches with each other: if `patch` is called
   * twice before the first read-then-write round-trip finishes, both reads see
   * the same prior value and the later write drops the earlier delta — and the
   * watcher then propagates that loss rather than repairing it. No call site
   * does this today (every handler in the popup fires once), and the fix is a
   * queue, which belongs with the tab-lock work in Phase 2c that makes the
   * background a second writer.
   */
  const patch = (fn: (draft: AppState) => Partial<AppState>) => {
    setLocal((current) => {
      if (!current) return current;
      const delta = fn(current);
      void patchState(delta);
      return { ...current, ...delta };
    });
  };

  return { state, valid, patch };
}
