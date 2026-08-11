import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The extension bundle's guard bans every network primitive. This one cannot:
 * a unix socket IS `node:net`. So it bans the ones that leave the machine and
 * pins `net` to its path form.
 */
const FORBIDDEN = [
  /require\(['"]node:https?['"]\)|from\s+['"]node:https?['"]/,
  /from\s+['"]node:dgram['"]/,
  /\bfetch\s*\(/,
  /\bnew\s+WebSocket\b/,
  /\bnew\s+EventSource\b/,
  // `net.connect(port)` / `createServer().listen(port)` — the argument shape
  // that reaches the network rather than the filesystem.
  /\.(connect|listen)\s*\(\s*\d/,
];

const SOURCES = globSync('packages/{cli,host}/**/*.mjs');

describe('nothing under packages/ can leave this machine', () => {
  it('finds sources to check — an empty glob would pass vacuously', () => {
    expect(SOURCES.length).toBeGreaterThan(0);
  });

  it.each(SOURCES)('%s uses no outbound primitive', (path) => {
    const source = readFileSync(path, 'utf8');
    for (const pattern of FORBIDDEN) {
      expect(source, `${path} matched ${pattern}`).not.toMatch(pattern);
    }
  });

  // The guard has to be able to fail. These are the forms it must catch.
  it.each([
    `import https from 'node:https';`,
    `const r = await fetch('https://example.com');`,
    `const s = new WebSocket('wss://example.com');`,
    `server.listen(8080);`,
  ])('catches %s', (planted) => {
    expect(FORBIDDEN.some((p) => p.test(planted))).toBe(true);
  });

  // And it must not catch the unix socket forms this design is built on.
  it.each([`server.listen(socketPath);`, `net.connect(socketPath);`])('permits %s', (benign) => {
    expect(FORBIDDEN.some((p) => p.test(benign))).toBe(false);
  });
});
