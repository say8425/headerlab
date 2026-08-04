import { describe, expect, it } from 'vitest';
import { readBuildFile } from '../support/build';

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
});
