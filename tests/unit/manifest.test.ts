import { readdirSync, readFileSync } from 'node:fs';
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
  it('carries a summary the store will accept, as a literal', () => {
    // The store reads the item's summary out of `description` and refuses an
    // upload over 132. Counted in UTF-16 units rather than code points on
    // purpose: outside the BMP `.length` is the larger of the two readings, so
    // it cannot under-report whichever way the store counts. That choice is
    // what retired the old "stays inside the BMP" guard — the ambiguity is
    // closed by the counting, not by a neighbouring assertion, so the two
    // edits had to land together.
    const description = readManifest().description;
    expect(typeof description).toBe('string');
    expect(description).not.toBe('');
    expect((description as string).length).toBeLessThanOrEqual(132);
  });

  it('keeps the name a literal — the store title is this value, not a form field', () => {
    // The item's title on the store is `manifest.name`, so changing it is a
    // version release rather than an edit to a dashboard form. Pinned so that
    // cost has to be re-argued rather than discovered.
    expect(readManifest().name).toBe('HeaderLab');
  });

  it('declares no localisation at all — no _locales, no default_locale, no __MSG_', () => {
    // The decision this guard exists for (owner's call, 2026-08-23): the
    // package used to ship `_locales/{en,ko,ja,zh_CN,es}/`, which made the
    // store dashboard report five supported languages while those five files
    // translated one string between them and the popup called `i18n` nowhere.
    //
    // Three pieces, asserted separately because they fail differently. Any one
    // of `_locales` / `default_locale` / `__MSG_` coming back alone stops
    // Chrome loading the extension outright — loud, and caught by e2e. All
    // three coming back together is the quiet one: nothing breaks, and the
    // dashboard silently re-offers four listings nobody is writing. That is
    // the case only this test sees.
    const dir = assertBuildFresh('production');
    expect(readdirSync(dir)).not.toContain('_locales');

    const manifest = readManifest();
    expect(Object.prototype.hasOwnProperty.call(manifest, 'default_locale')).toBe(false);
    expect(JSON.stringify(manifest)).not.toContain('__MSG_');
  });

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

  it('declares nativeMessaging as optional, exactly — the bridge asks for it at runtime', () => {
    // §8.1: `permissions_parser.cc` drops an optional-ineligible permission
    // from the list and leaves only an install warning, and the one
    // consistency check is a DCHECK compiled out of release builds. So a
    // Chrome change that made this permission non-optional would fail
    // *silently*: the key would still be here and the request would never
    // succeed. Pinning the exact value is what makes the e2e in Task 6 —
    // which drives a real request through a real Chrome — the thing that
    // would notice.
    expect(readManifest().optional_permissions).toEqual(['nativeMessaging']);
  });

  it('keeps the install-time permission list byte-identical after adding it', () => {
    // The whole point of the optional route. This assertion is the one that
    // fails if someone "fixes" a connect error by moving the permission into
    // `permissions` — which would work, and would silently trade away the
    // zero-permission install posture this product is built on.
    //
    // The same exact-equality catches a second leak this array must never
    // carry: bridge-e2e (tests/e2e/bridge.spec.ts's own build,
    // wxt.config.ts's `mode === 'bridge-e2e'` branch) hands out
    // nativeMessaging outright so Playwright never meets a consent dialog.
    // It is a separate mode from the shared 'e2e' build and from production
    // precisely so that grant cannot leak into either without a test
    // noticing — a production build carrying it would give away the
    // zero-permission posture without anyone noticing, since the manifest
    // would still look small. A dedicated `not.toContain('nativeMessaging')`
    // assertion was tried here and dropped: this array is already pinned
    // exactly, twice, above (lines 44 and 52), so a third exact-equality
    // check and a `not.toContain` on the same value catch identically the
    // same mutation — the extra assertion documented the reasoning but added
    // no catching power of its own. tests/e2e/bridge.spec.ts's own tests are
    // what prove the bridge-e2e manifest is right, functionally rather than
    // by reading JSON — a wrong manifest there fails to connect at all — and
    // if this permission ever leaked into the plain 'e2e' build instead,
    // tests/e2e/header-modification.spec.ts's two rail layout guards would
    // catch it: that leak is exactly what pushed the site list to 0 before
    // the bridge-e2e mode split existed.
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

/**
 * `docs/store/checklist.md` derives the zip's filename rather than globbing for
 * it, and that derivation is only correct while WXT names the archive with its
 * default template.
 *
 * The default is `{{name}}-{{packageVersion}}-{{browser}}{{modeSuffix}}.zip`, and
 * `{{packageVersion}}` is `package.json`'s version — a *different* variable from
 * `{{version}}`, which is the manifest's. The checklist reads `package.json`
 * because of that distinction; reading the manifest would have been the
 * plausible-looking wrong choice.
 *
 * So the assumption worth pinning is that nothing overrides it. A `zip` key in
 * `wxt.config.ts` would leave the checklist naming a file that does not exist —
 * and `unzip -p` answers a missing archive with exit 9 and zero bytes on stderr,
 * so the strongest claim in the submission runbook would go silent rather than
 * red. That is the failure this whole pairing exists to prevent, one level up.
 */
describe('the zip name the store checklist derives', () => {
  it('is not overridden in wxt.config.ts', () => {
    const config = readFileSync('wxt.config.ts', 'utf8');
    // Source-level on purpose: resolving WXT's config here would import the
    // build toolchain into a unit suite to learn one fact about a file.
    expect(config).not.toMatch(/^\s*zip\s*:/m);
  });
});
