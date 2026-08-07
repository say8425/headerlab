import { MAX_PROFILES, type Profile } from '@/lib/model/types';

export const DYNAMIC_ID_BASE = 1;
export const SESSION_ID_BASE = 10_000;

export interface Allocation {
  profileId: string;
  ruleId: number;
  priority: number;
  scope: 'dynamic' | 'session';
}

/**
 * Assigns each enabled profile a rule id and a priority.
 *
 * Priorities are unique because the tie-break between two equal-priority
 * modifyHeaders rules is undocumented. The dynamic and session id spaces are
 * disjoint because whether an id may be reused across rulesets is likewise
 * undocumented. Both narrow the design away from unspecified behaviour.
 */
export function allocate(profiles: Profile[]): Allocation[] {
  if (profiles.length > MAX_PROFILES) {
    throw new RangeError(`profile count ${profiles.length} exceeds MAX_PROFILES (${MAX_PROFILES})`);
  }

  const active = profiles.filter((p) => p.enabled).sort((a, b) => a.order - b.order);

  let dynamicId = DYNAMIC_ID_BASE;
  let sessionId = SESSION_ID_BASE;

  return active.map((profile, index) => {
    const locked = profile.tabLock.enabled && typeof profile.tabLock.tabId === 'number';
    const scope = locked ? 'session' : 'dynamic';
    return {
      profileId: profile.id,
      ruleId: locked ? sessionId++ : dynamicId++,
      priority: active.length - index,
      scope,
    };
  });
}
