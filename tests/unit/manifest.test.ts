import { readdirSync } from 'node:fs';
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
  it('omits host_permissions — checked by key, not substring: "optional_host_permissions" contains that string', () => {
    const manifest = readManifest();
    expect(Object.prototype.hasOwnProperty.call(manifest, 'host_permissions')).toBe(false);
  });

  it('carries optional_host_permissions instead', () => {
    const manifest = readManifest();
    expect(Object.prototype.hasOwnProperty.call(manifest, 'optional_host_permissions')).toBe(true);
  });

  it('lists <all_urls> among them, which is what all-sites mode requests at runtime', () => {
    // `permissions.request()` rejects any origin the manifest did not declare
    // as optional. The key merely existing is not enough — it was asserted
    // that way while the only runtime request was a per-host pattern, and
    // all-sites now asks for this exact string (lib/permissions/probe.ts).
    // Dropping it would leave the switch flipping into a mode whose grant can
    // never be obtained, with nothing failing until someone clicked it.
    expect(readManifest().optional_host_permissions).toEqual(['<all_urls>']);
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
    // Chromium holds the action icon in the browser process, so a *browser*
    // restart drops back to exactly this — measured. Pinning that the default
    // is the *active* set is what makes the reconcile-time re-apply a
    // requirement rather than a nicety: without it a paused extension shows
    // colour again after a restart.
    const action = readManifest().action as Record<string, Record<string, string>>;
    expect(Object.values(action.default_icon!).every((p) => p.includes('active'))).toBe(true);
  });

  it('ships every file both the manifest and setIcon name, and nothing else', () => {
    // A manifest entry pointing at a file that is not in the build is a broken
    // icon that no unit test of the manifest alone would notice.
    //
    // The two lists differ on purpose: `icons` shows only the active mark, at
    // all four sizes, while `setIcon` swaps 16 and 32. Asserting the directory
    // *exactly* rather than just "these exist" is what stops a paused 48 and
    // 128 being generated and shipped again for nobody — a test that only
    // checked presence would have held those 2.8KB in place.
    const dir = assertBuildFresh('production');
    const wanted = [
      ...[16, 32, 48, 128].map((size) => `active-${size}.png`),
      ...[16, 32].map((size) => `paused-${size}.png`),
    ].sort();
    expect(readdirSync(path.join(dir, 'icon')).sort()).toEqual(wanted);
  });
});
