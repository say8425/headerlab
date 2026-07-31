import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The product's central claim is zero host permissions at install. The build
// branch in wxt.config.ts and a manual check in the plan are the only things
// protecting that claim in the shipped artifact — this asserts it directly
// against the real manifest instead.
//
// Requires a production build first: `npm run build` (not `build:e2e`, which
// deliberately injects host_permissions for the loopback echo server). Skips
// with a clear message rather than failing on a fresh clone.
const MANIFEST_PATH = '.output/chrome-mv3/manifest.json';
const hasManifest = existsSync(MANIFEST_PATH);

describe('production manifest', () => {
  it.skipIf(!hasManifest)(
    'omits host_permissions — checked by key, not substring: "optional_host_permissions" contains that string',
    () => {
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
      expect(Object.prototype.hasOwnProperty.call(manifest, 'host_permissions')).toBe(false);
    },
  );

  it.skipIf(!hasManifest)('carries optional_host_permissions instead', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    expect(Object.prototype.hasOwnProperty.call(manifest, 'optional_host_permissions')).toBe(true);
  });

  if (!hasManifest) {
    // eslint-disable-next-line no-console
    console.warn(`[manifest.test.ts] skipped — run "npm run build" to produce ${MANIFEST_PATH}`);
  }
});
