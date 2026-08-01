import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The product's central claim is zero host permissions at install, plus a
// minimal, exactly-pinned permission surface. The "test" script in
// package.json is `wxt build && vitest run` — the build always runs first,
// so this suite always runs against a real manifest instead of skipping when
// the build hasn't happened yet. (Not a "pretest" lifecycle hook: those are
// silently skipped by `ignore-scripts=true`, a common local/CI npm setting —
// chaining into the script body itself is not.)
const MANIFEST_PATH = '.output/chrome-mv3/manifest.json';

function readManifest(): Record<string, unknown> {
  if (!existsSync(MANIFEST_PATH)) {
    // A red test naming the cause beats a green skip: if this fires, vitest
    // was invoked directly (e.g. `npx vitest run`) instead of `npm test`.
    throw new Error(
      `${MANIFEST_PATH} is missing. Run "npm test" (which builds first) or "npm run build" directly.`,
    );
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
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
