import { describe, expect, it } from 'vitest';
import { compile } from '@/lib/compile/compile';
import { migrateToV2 } from '@/lib/model/migrate';
import { parseAppState } from '@/lib/model/schema';
import type { DnrRule } from '@/lib/model/types';

/**
 * Stores written by the build before all-sites became explicit, as literals.
 *
 * Deliberately hand-written rather than built from `createProfile()`: that
 * helper now emits the *new* shape, so deriving the fixture from it would test
 * the migration against its own output and pass no matter what the migration
 * did. These are what v1 actually put on disk.
 */
const v1Profile = (filter: Record<string, unknown>) => ({
  id: 'p1',
  name: 'Default',
  color: 'green',
  enabled: true,
  order: 0,
  filter: {
    mode: 'structured',
    excludedDomains: [],
    resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
    ...filter,
  },
  tabLock: { enabled: false, tabId: null, tabTitle: null },
  headers: [
    { id: 'h1', enabled: true, target: 'request', operation: 'set', name: 'X-Debug', value: '1' },
  ],
});

const v1State = (filter: Record<string, unknown>) => ({
  version: 1,
  globalPause: false,
  theme: 'system',
  profiles: [v1Profile(filter)],
});

/**
 * What v1 registered for a profile with an empty domain list: one rule, no
 * `requestDomains`, so DNR matched it against every site.
 *
 * Pinned as a literal for the same reason the fixtures are. The claim under
 * test is "this store goes on modifying the same headers on the same requests",
 * and only the actual rule can carry that claim — a comparison against
 * freshly-compiled output would hold just as well if both sides broke together.
 */
const V1_EVERYWHERE_RULE: DnrRule = {
  id: 1,
  priority: 1,
  condition: { resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'] },
  action: {
    type: 'modifyHeaders',
    requestHeaders: [{ header: 'X-Debug', operation: 'set', value: '1' }],
  },
};

/** The same store, scoped to one host: v1 set `requestDomains`. */
const V1_SCOPED_RULE: DnrRule = {
  id: 1,
  priority: 1,
  condition: {
    resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
    requestDomains: ['api.example.com'],
  },
  action: {
    type: 'modifyHeaders',
    requestHeaders: [{ header: 'X-Debug', operation: 'set', value: '1' }],
  },
};

/** Migrate, validate as this build would on read, then compile. */
function rulesAfterUpgrade(stored: unknown): DnrRule[] {
  return compile(parseAppState(migrateToV2(stored))).dynamic;
}

describe('upgrading a v1 store', () => {
  it('goes on modifying the same headers on every site, for a store that had no domains', () => {
    // The whole reason this migration exists. An empty domain list *was* how a
    // user said "everywhere", and it is the only way they could say it. If the
    // new field simply defaulted to off, upgrading would stop their headers
    // with no action, no warning and nothing on screen — the silent behaviour
    // change this product exists to prevent.
    //
    // Asserted on the registered rule, not on the flag: `allSites === true` is
    // satisfied by an implementation that sets the flag and then compiles
    // nothing, which is precisely the failure being guarded against.
    expect(rulesAfterUpgrade(v1State({ domains: [] }))).toEqual([V1_EVERYWHERE_RULE]);
  });

  it('leaves a scoped store scoped to exactly the host it named', () => {
    // The other half, and it must be a *different* rule. A migration that
    // turned all-sites on for everybody would also pass the case above, and
    // would silently widen every scoped user to every site — the same silent
    // change in the more dangerous direction.
    expect(rulesAfterUpgrade(v1State({ domains: ['api.example.com'] })))
      .toEqual([V1_SCOPED_RULE]);
  });

  it('turns all-sites on only for the store that had no domains', () => {
    // The flag itself, both directions, so neither a constant `true` nor a
    // constant `false` survives.
    const allSitesOf = (stored: unknown) =>
      parseAppState(migrateToV2(stored)).profiles[0]?.filter.allSites;
    expect(allSitesOf(v1State({ domains: [] }))).toBe(true);
    expect(allSitesOf(v1State({ domains: ['api.example.com'] }))).toBe(false);
  });

  it('registers nothing for a store whose every domain was unusable, exactly as v1 did', () => {
    // v1 suppressed this one, and it must stay suppressed: reading "no usable
    // domain" as "the user meant everywhere" would take a profile that was
    // applying to nothing and point it at every site on the internet.
    expect(rulesAfterUpgrade(v1State({ domains: ['a b.com'] }))).toEqual([]);
  });

  it('leaves a regex store scoped by its pattern rather than opening it up', () => {
    // An empty domain list means something different in regex mode — the
    // pattern is the condition — so it is not the "everywhere" signal being
    // migrated here.
    const stored = v1State({ mode: 'regex', regex: '^https://api\\.example\\.com/', domains: [] });
    expect(parseAppState(migrateToV2(stored)).profiles[0]?.filter.allSites).toBe(false);
    expect(rulesAfterUpgrade(stored)).toEqual([{
      id: 1,
      priority: 1,
      condition: {
        resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
        regexFilter: '^https://api\\.example\\.com/',
      },
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'X-Debug', operation: 'set', value: '1' }],
      },
    }]);
  });

  it('migrates every profile, not just the first', () => {
    // A loop that stopped at profiles[0] would pass every case above.
    const stored = {
      ...v1State({ domains: [] }),
      profiles: [
        { ...v1Profile({ domains: ['api.example.com'] }), id: 'p1', order: 0 },
        { ...v1Profile({ domains: [] }), id: 'p2', order: 1 },
      ],
    };
    expect(parseAppState(migrateToV2(stored)).profiles.map((p) => p.filter.allSites))
      .toEqual([false, true]);
  });

  it('records the new version on the state it hands back', () => {
    expect(parseAppState(migrateToV2(v1State({ domains: [] }))).version).toBe(2);
  });

  it('leaves the rest of the profile exactly as it was', () => {
    // The migration adds one field. Anything else it touched would be a change
    // nobody asked for, arriving without a way to see it.
    const before = v1State({ domains: ['api.example.com'], excludedDomains: ['cdn.example.com'] });
    const after = parseAppState(migrateToV2(before));
    const profile = after.profiles[0]!;
    expect(profile.filter.domains).toEqual(['api.example.com']);
    expect(profile.filter.excludedDomains).toEqual(['cdn.example.com']);
    expect(profile.filter.resourceTypes).toEqual(['xmlhttprequest', 'main_frame', 'sub_frame']);
    expect(profile.headers).toEqual([
      { id: 'h1', enabled: true, target: 'request', operation: 'set', name: 'X-Debug', value: '1' },
    ]);
    expect(profile.tabLock).toEqual({ enabled: false, tabId: null, tabTitle: null });
    expect(after.theme).toBe('system');
    expect(after.globalPause).toBe(false);
  });

  it('does not mutate the stored object it was handed', () => {
    // WXT hands the migration the value it read from disk. Mutating it in place
    // would make the transform unrepeatable and the original unrecoverable.
    const before = v1State({ domains: [] });
    migrateToV2(before);
    expect(before.profiles[0]!.filter).not.toHaveProperty('allSites');
  });

  it('hands back a value the schema accepts, so an upgraded store is readable', () => {
    // The migration's real job: `allSites` is required, so a v1 value that
    // skipped this transform would fail validation and the popup would show
    // "Saved rules could not be read" over rules that are perfectly fine.
    expect(() => parseAppState(v1State({ domains: [] }))).toThrow();
    expect(() => parseAppState(migrateToV2(v1State({ domains: [] })))).not.toThrow();
  });
});
