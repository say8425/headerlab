import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../support/build';

/**
 * Guards the lockfile against being regenerated on a machine that cannot see the
 * whole registry.
 *
 * This is not hypothetical and it is not cheap. The pnpm migration ran
 * `pnpm import` on a mac behind this office's proxy, whose packument for
 * `@oxfmt/binding-linux-x64-gnu` stops at 0.58.0 while `package.json` pins oxfmt
 * 0.60.0. Platform bindings are *optional* dependencies, so pnpm dropped the 18
 * it could not resolve and said nothing — the resulting lockfile carried 19
 * `@oxlint/binding-*` entries (whose packument did reach the pinned version) and
 * exactly one `@oxfmt/*`, this machine's own. Nothing failed locally, because
 * macOS never needs the others. Four of five CI jobs passed. `format` died with
 * `Cannot find module '@oxfmt/binding-linux-x64-gnu'`.
 *
 * The invariant asserted here is the one that actually failed: **a lockfile
 * written on one platform must not have forgotten the platform CI runs on.** It
 * is deliberately not "19 of each" — that number belongs to the tools and moves
 * when they add a target, and a guard that has to be edited on someone else's
 * release is a guard that gets edited without being read. Pairing the platforms
 * instead is self-maintaining, and it names the failure rather than a symptom of
 * it: whatever `darwin-arm64` was resolved for, `linux-x64-gnu` must have been
 * resolved for too. The three scopes in the tree today make the case for
 * pairing on their own — oxfmt and oxlint carry 19 platforms each, `@rolldown`
 * carries 15, so there is no single right number to assert.
 *
 * When this fails, do not hand-edit the lockfile. Regenerate it where the whole
 * registry is visible — CI — as recorded in CLAUDE.md.
 */

const LOCKFILE = readFileSync(path.join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');

/** Scope (`@oxfmt`) → the platforms it declares a binding package for. */
function bindingPlatforms(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const [, scope, platform] of LOCKFILE.matchAll(
    /'(@[a-z0-9-]+)\/binding-([a-z0-9-]+)@[0-9]/g,
  )) {
    const platforms = found.get(scope!) ?? new Set<string>();
    platforms.add(platform!);
    found.set(scope!, platforms);
  }
  return found;
}

describe('the lockfile', () => {
  it('declares platform bindings to check, so an empty match cannot satisfy the check below', () => {
    // Both halves matter. Without this, a regex that stopped matching anything
    // — a lockfile format change, a rename — would make every assertion below
    // vacuously true; and a lockfile that had lost one tool's bindings
    // *entirely* would pass too, because a scope with no `darwin-arm64` has
    // nothing left to pair.
    //
    // Named rather than counted, and the naming earns its keep twice: a fourth
    // scope appearing means a dependency that ships a compiled binary per
    // platform arrived, in a repo whose first rule is that dependencies do not
    // arrive. That is worth a red test rather than a silent pass.
    const found = bindingPlatforms();
    expect([...found.keys()].sort()).toEqual(['@oxfmt', '@oxlint', '@rolldown']);
  });

  it('has a linux-x64-gnu binding everywhere it has a darwin-arm64 one', () => {
    // The exact failure, stated as a set difference rather than a count: this
    // repo is developed on darwin-arm64 and CI runs linux-x64-gnu, so the pair
    // is what a lockfile written on one and consumed by the other must hold.
    const missing = [...bindingPlatforms()]
      .filter(([, platforms]) => platforms.has('darwin-arm64'))
      .filter(([, platforms]) => !platforms.has('linux-x64-gnu'))
      .map(([scope]) => scope);

    expect(missing).toEqual([]);
  });
});

// A third assertion was written here and removed before it shipped: the
// npm-era form of this defect, where the proxy's stale metadata produced
// lockfile entries with no version at all and `npm ci` died on the stub rather
// than on the cause. It cannot fail under pnpm, and not by luck — npm keyed
// entries by install path and carried `version` as a separate field, so an
// empty one was expressible; a pnpm key *is* `name@version`. The subject went
// with `package-lock.json`, which is the only reason deleting the guard is the
// right move rather than the lazy one.
