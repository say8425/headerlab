import { useEffect, useState } from 'react';
import { getState, patchState, stateItem } from '@/lib/storage/state';
import type { AppState } from '@/lib/model/types';

export function useAppState() {
  const [state, setLocal] = useState<AppState | null>(null);

  useEffect(() => {
    getState().then(setLocal);
    return stateItem.watch((next) => setLocal(next));
  }, []);

  /**
   * Applies a patch derived from the current state. The optimistic local
   * update keeps typing responsive; `patchState` re-reads before writing, so a
   * concurrent writer's untouched keys survive and the watcher corrects any
   * drift.
   */
  const patch = (fn: (draft: AppState) => Partial<AppState>) => {
    setLocal((current) => {
      if (!current) return current;
      const delta = fn(current);
      void patchState(delta);
      return { ...current, ...delta };
    });
  };

  return { state, patch };
}
