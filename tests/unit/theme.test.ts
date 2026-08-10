import { describe, expect, it } from 'vitest';
import { readBuildFile } from '../support/build';

// `pnpm test` runs `wxt build` first, so these read a real build artifact.
// readBuildFile refuses a missing *or* stale one: a bare `vitest run` here
// once reported three failures against a build predating theme.js, and the
// hours that cost are why the staleness half exists (tests/support/build.ts).
function read(path: string): string {
  return readBuildFile('production', path);
}

describe('theme bootstrap', () => {
  it('ships theme.js at the output root', () => {
    expect(read('theme.js')).toContain('prefers-color-scheme');
  });

  it('loads it as a plain script, not a module — a module defers past first paint', () => {
    const html = read('popup.html');
    expect(html).toContain('<script src="/theme.js"></script>');
  });

  it('loads it before the module script, so the class is set before React runs', () => {
    const html = read('popup.html');
    const theme = html.indexOf('/theme.js');
    const module = html.indexOf('type="module"');
    expect(theme).toBeGreaterThanOrEqual(0);
    expect(module).toBeGreaterThanOrEqual(0);
    expect(theme).toBeLessThan(module);
  });

  it('has no inline script — MV3 CSP blocks those outright', () => {
    // Measured: an inline script in this page logs
    // "Executing inline script violates ... 'script-src 'self''" and never runs.
    // The regex looks for a <script> with no src attribute before its closing >.
    const html = read('popup.html');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  });
});
