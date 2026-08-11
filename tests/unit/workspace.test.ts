import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Everything `pnpm-workspace.yaml` declares must actually be there. */
function declaredPackages(): string[] {
  const yaml = readFileSync('pnpm-workspace.yaml', 'utf8');
  // `\Z` is not a JS regex metacharacter — it parses as the literal letter "Z",
  // not "end of string" as in Perl/Python/.NET. Since the `packages:` block
  // sits at the end of the file, that made the original lookahead unsatisfiable
  // and `exec` returned null even against a correct file. `(?![\s\S])` is the
  // real end-of-string assertion: it fails only when a character remains.
  const block = /^packages:\s*$([\s\S]*?)(?=^\S|(?![\s\S]))/m.exec(yaml);
  if (!block) throw new Error('pnpm-workspace.yaml declares no `packages:` key');
  return [...block[1]!.matchAll(/^\s*-\s*(.+?)\s*$/gm)].map((m) => m[1]!);
}

describe('the workspace', () => {
  it('declares the three packages', () => {
    expect(declaredPackages()).toEqual(['packages/cli', 'packages/host', 'packages/plugin']);
  });

  // A glob would let a directory be added without anyone noticing it joined
  // the release surface. Naming them is what makes that a diff.
  it('names them rather than globbing', () => {
    expect(declaredPackages().some((p) => p.includes('*'))).toBe(false);
  });

  it.each(['packages/cli', 'packages/host', 'packages/plugin'])(
    '%s exists and has a package.json',
    (dir) => {
      expect(existsSync(`${dir}/package.json`)).toBe(true);
    },
  );

  // Measured: `allowBuilds` is pnpm 11's spelling and pnpm 10 ignores it in
  // silence. Adding `packages:` must not disturb the answer already recorded
  // for spawn-sync, which is what keeps `pnpm install` from failing.
  it('keeps the build answer that lets installs succeed', () => {
    expect(readFileSync('pnpm-workspace.yaml', 'utf8')).toContain('spawn-sync: false');
  });

  // Measured: a root script that re-runs `pnpm -r` with the workspace root
  // included runs every child script TWICE. The e2e echo server binds
  // loopback, so that is a port collision rather than merely a doubled bill.
  it('never fans out with the workspace root included', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<
      string,
      string
    >;
    for (const [name, body] of Object.entries(scripts)) {
      expect(body, `${name} must not pass --include-workspace-root`).not.toContain(
        '--include-workspace-root',
      );
    }
  });

  // CLAUDE.md, measured: without `wxt prepare` oxlint resolves no `@/…` alias
  // and exits 0 having checked nothing across 141 imports. A root `lint` that
  // skips it reads as passing and is not.
  // `startsWith`, not `toContain`. The point is that `wxt prepare` runs FIRST —
  // a script rewritten as `oxlint --deny-warnings && wxt prepare` still
  // contains the string while defeating the guard entirely, and oxlint would
  // once again exit 0 having resolved no `@/…` alias at all.
  it('keeps wxt prepare in front of lint and typecheck', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<
      string,
      string
    >;
    expect(scripts.lint?.startsWith('wxt prepare')).toBe(true);
    expect(scripts.typecheck?.startsWith('wxt prepare')).toBe(true);
  });

  /**
   * Measured, because a review predicted the opposite and the prediction was
   * worth settling rather than arguing: `pnpm install --frozen-lockfile` does
   * NOT fail when a declared workspace project is missing from `importers:`.
   * It succeeds — and writes the missing entries into the lockfile, despite
   * the flag. So the failure this guards is not a red CI job; it is CI
   * quietly modifying a committed file, which is worse for being silent.
   *
   * The entries are empty (`{}`) because these packages have no dependencies,
   * so adding them re-resolves nothing. That is what makes this safe to write
   * by hand here, unlike the `pnpm import` loop CLAUDE.md warns about.
   */
  it('gives every declared package an entry in the lockfile', () => {
    const lock = readFileSync('pnpm-lock.yaml', 'utf8');
    const importers = /^importers:\s*$([\s\S]*?)^packages:/m.exec(lock);
    expect(importers, 'pnpm-lock.yaml has no importers block').not.toBeNull();
    for (const pkg of declaredPackages()) {
      expect(importers![1], `${pkg} is declared but absent from importers`).toContain(`${pkg}:`);
    }
  });
});
