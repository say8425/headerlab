import type { AppState, Profile, ProfileColor } from '@/lib/model/types';

const COLORS: ProfileColor[] = ['green', 'amber', 'red', 'blue', 'violet', 'cyan'];

export const STATE_VERSION = 1;

export function createProfile(name: string, order: number): Profile {
  return {
    id: crypto.randomUUID(),
    name,
    color: COLORS[order % COLORS.length]!,
    enabled: true,
    order,
    filter: {
      mode: 'structured',
      domains: [],
      excludedDomains: [],
      // Explicit by policy: DNR's default silently excludes main_frame.
      resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
    },
    tabLock: { enabled: false, tabId: null, tabTitle: null },
    headers: [],
  };
}

export const DEFAULT_STATE: AppState = {
  version: STATE_VERSION,
  profiles: [],
  globalPause: false,
  theme: 'system',
};
