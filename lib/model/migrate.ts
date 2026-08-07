/**
 * Storage migrations.
 *
 * Pure, and separate from `lib/storage/state.ts` on purpose: WXT hands these
 * whatever it read off disk, which is by definition a value this build's types
 * do not describe yet. Keeping the transform out of the module that talks to
 * storage lets every case be asserted with a hand-written v1 literal and no
 * browser at all — and a migration is exactly the code that has to be right
 * the first time, because by the time it runs the old bytes are gone.
 *
 * `unknown` in, `unknown` out, deliberately. The input is a previous version's
 * shape and typing it as `AppState` would be a lie that the compiler then
 * enforces in the wrong direction. Validation is `parseAppState`'s job, and it
 * runs on the result.
 */

/** Narrow without asserting: `typeof null` is `'object'`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * v1 → v2: `Filter.allSites` becomes explicit.
 *
 * **An empty domain list migrates to all-sites on.** In v1 that was the only
 * way to say "apply everywhere", and it is what the compiler did with it — a
 * rule with no domain condition, which DNR matches against every site. If the
 * new field simply defaulted to off, every such user's headers would stop the
 * moment they upgraded, with no action taken, nothing to see and nothing to
 * undo. That silent change is the failure this product exists to remove, so
 * the migration preserves behaviour rather than preferring the safer-looking
 * default.
 *
 * Two v1 states look empty and are not:
 *
 * - **regex mode.** The pattern is the condition there, so an empty list never
 *   meant "everywhere" and must not become it — that would widen a profile
 *   scoped by its regex to every site.
 * - **every domain unusable.** v1 suppressed that profile (it applied to
 *   nothing at all), so reading it as "everywhere" would take a profile that
 *   was modifying no requests and point it at all of them. The list is
 *   non-empty, so the rule below already leaves it alone; this is why the test
 *   for it exists rather than a branch.
 *
 * Copies rather than mutates: WXT passes the value it read, and a migration
 * that scribbles on its input cannot be run twice or reasoned about.
 */
export function migrateToV2(stored: unknown): unknown {
  if (!isRecord(stored)) return stored;

  const profiles = Array.isArray(stored.profiles)
    ? stored.profiles.map((profile) => {
        if (!isRecord(profile) || !isRecord(profile.filter)) return profile;
        const { filter } = profile;
        const domains = Array.isArray(filter.domains) ? filter.domains : [];
        return {
          ...profile,
          filter: {
            ...filter,
            allSites: domains.length === 0 && filter.mode !== 'regex',
          },
        };
      })
    : stored.profiles;

  return { ...stored, profiles, version: 2 };
}
