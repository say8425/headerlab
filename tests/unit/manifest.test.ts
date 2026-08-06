import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertBuildFresh, readBuildFile } from '../support/build';

// The product's central claim is zero host permissions at install, plus a
// minimal, exactly-pinned permission surface. The "test" script in
// package.json is `wxt build && vitest run` — the build always runs first,
// so this suite always runs against a real manifest instead of skipping when
// the build hasn't happened yet. (Not a "pretest" lifecycle hook: those are
// silently skipped by `ignore-scripts=true`, a common local/CI npm setting —
// chaining into the script body itself is not.)
//
// A red test naming the cause beats a green skip, and beats a green *pass*
// against yesterday's manifest just as much: readBuildFile rejects a stale
// build as well as a missing one (tests/support/build.ts).
function readManifest(): Record<string, unknown> {
  return JSON.parse(readBuildFile('production', 'manifest.json'));
}

describe('production manifest', () => {
  it(
    'omits host_permissions — checked by key, not substring: "optional_host_permissions" contains that string',
    () => {
      const manifest = readManifest();
      expect(Object.prototype.hasOwnProperty.call(manifest, 'host_permissions')).toBe(false);
    },
  );

  it('carries optional_host_permissions instead', () => {
    const manifest = readManifest();
    expect(Object.prototype.hasOwnProperty.call(manifest, 'optional_host_permissions')).toBe(true);
  });

  it('declares exactly the two permissions actually used — nothing extra to explain away', () => {
    const manifest = readManifest();
    expect(manifest.permissions).toEqual(['storage', 'declarativeNetRequestWithHostAccess']);
  });

  it('still declares exactly the two permissions after adding icons', () => {
    // Icons declare files, they do not ask for a capability — so the product's
    // central claim is untouched by them. Confirmed rather than assumed: this
    // is the assertion that would catch an icon change that quietly dragged a
    // permission along with it.
    expect(readManifest().permissions).toEqual(['storage', 'declarativeNetRequestWithHostAccess']);
  });
});

describe('the toolbar icon', () => {
  it('declares every size Chrome asks for', () => {
    // 16 is the toolbar and favicon, 32 its 2x and what Windows reaches for,
    // 48 the extensions page, 128 install and the Web Store.
    expect(readManifest().icons).toEqual({
      16: 'icon/active-16.png',
      32: 'icon/active-32.png',
      48: 'icon/active-48.png',
      128: 'icon/active-128.png',
    });
  });

  it('gives the action the two densities the toolbar actually draws', () => {
    const action = readManifest().action as Record<string, unknown>;
    expect(action.default_icon).toEqual({
      16: 'icon/active-16.png',
      32: 'icon/active-32.png',
    });
  });

  it('defaults to the colour icon, which is why paused must be re-applied on wake', () => {
    // `setIcon` does not persist across a service worker restart — Chrome falls
    // back to exactly this. Pinning that the default is the *active* set is
    // what makes the reconcile-time re-apply a requirement rather than a
    // nicety: without it a paused extension shows colour again after an idle
    // period.
    const action = readManifest().action as Record<string, Record<string, string>>;
    expect(Object.values(action.default_icon!).every((p) => p.includes('active'))).toBe(true);
  });

  it('ships every file both the manifest and setIcon name', () => {
    // A manifest entry pointing at a file that is not in the build is a broken
    // icon that no unit test of the manifest alone would notice.
    const dir = assertBuildFresh('production');
    const missing = ['active', 'paused']
      .flatMap((state) => [16, 32, 48, 128].map((size) => `icon/${state}-${size}.png`))
      .filter((rel) => !existsSync(path.join(dir, rel)));
    expect(missing).toEqual([]);
  });
});
