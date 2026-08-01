import { useEffect, useState } from 'react';
import { getState, setState, stateItem } from '@/lib/storage/state';
import type { AppState } from '@/lib/model/types';

export function useAppState() {
  const [state, setLocal] = useState<AppState | null>(null);

  useEffect(() => {
    getState().then(setLocal);
    return stateItem.watch((next) => setLocal(next));
  }, []);

  const update = (fn: (draft: AppState) => AppState) => {
    setLocal((current) => {
      if (!current) return current;
      const next = fn(current);
      void setState(next);
      return next;
    });
  };

  return { state, update };
}
