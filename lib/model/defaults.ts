import type { AppState, Profile, ProfileColor } from '@/lib/model/types';

/**
 * The identity colours a profile can be given — by the picker and by the
 * default rotation alike.
 *
 * `ProfileColor` allows a sixth, cyan, and keeps allowing it: cyan is the tab
 * marker's "needs permission" colour (design §4.4, reusing the semantic
 * five-colour palette of §8.3 — a different set from this identity palette).
 * It is spoken for, so nothing may hand it out as an *identity*: a profile
 * wearing cyan puts its own dot next to an unrelated marker in the same
 * colour, right beside it on the same tab.
 *
 * One list, two consumers. This was two lists — `createProfile`'s rotation
 * here and the picker's in ProfileEditStrip — and they had already diverged by
 * exactly this element, so the picker refused cyan while the rotation handed
 * it to every sixth profile. Same shape as HEADER_TOKEN and the suppression
 * predicate before it (Phase 2a handoff §3.1): a second statement of one fact
 * eventually disagrees with the first. Add a third consumer by importing this,
 * not by writing the names again.
 */
export const SELECTABLE_COLORS: readonly ProfileColor[] =
  ['green', 'amber', 'red', 'blue', 'violet'];

/**
 * Bumped to 2 when `Filter.allSites` became explicit. Every bump needs a
 * matching entry in `stateItem`'s `migrations` — see lib/storage/state.ts.
 */
export const STATE_VERSION = 2;

export function createProfile(name: string, order: number): Profile {
  return {
    id: crypto.randomUUID(),
    name,
    color: SELECTABLE_COLORS[order % SELECTABLE_COLORS.length]!,
    enabled: true,
    order,
    filter: {
      mode: 'structured',
      // A new rule set is *unscoped*, not global. v1 had no way to say that —
      // an empty list compiled to a rule matching every site — so a fresh
      // install started out pointed at the whole internet and warned about it.
      // Off means nothing is applied until the user says where, which is the
      // only default that matches a product whose claim is zero host access at
      // install.
      allSites: false,
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
