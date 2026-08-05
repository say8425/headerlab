import type { Profile } from '@/lib/model/types';

export interface SingleProfileResolution {
  /**
   * The one rule set the popup shows, or `null` when storage holds none and
   * the caller has to make one.
   */
  profile: Profile | null;
  /**
   * Rule sets that exist in storage and cannot be shown.
   *
   * The caller must **remove these from storage**, not merely decline to
   * render them. compile() reads storage, not this popup, so a rule set left
   * behind goes on modifying headers with nothing anywhere able to show it,
   * switch it off, or explain where the change came from — the silent failure
   * this product exists to remove, in its purest form.
   */
  dropped: readonly Profile[];
}

/**
 * Reduces whatever storage holds to the single implicit rule set this UI can
 * show.
 *
 * There is exactly one rule set and no way to make a second, so more than one
 * can only be legacy state written by an earlier build. The first is kept
 * because it is the one the previous UI opened on by default (its profile bar
 * fell back to `profiles[0]`), so a user who upgrades keeps looking at the
 * rule set they were already looking at.
 *
 * Pure, and deliberately so: it neither mints an id for the empty case nor
 * writes the truncation it asks for. Both are effects, both belong to the
 * caller, and keeping them out is what lets every case here be asserted
 * without a browser.
 */
export function resolveSingleProfile(
  profiles: readonly Profile[],
): SingleProfileResolution {
  const [first, ...rest] = profiles;
  if (!first) return { profile: null, dropped: [] };
  return { profile: first, dropped: rest };
}
