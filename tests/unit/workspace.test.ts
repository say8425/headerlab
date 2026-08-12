import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

// Root vitest only sees `tests/unit/**/*.test.{ts,tsx}` (vitest.config.ts),
// and `packages/*/test/*.mjs` runs under `node:test`, outside that glob and
// outside every job `ci.yml` had before this describe block existed. Nothing
// ran the 89 tests those packages wrote — the socket, framing, lifecycle,
// argv grammar and id-correlation suites all merged green whether they
// passed or not, because nothing ever executed them.
describe('the CI workflow', () => {
  it('runs pnpm test:packages as its own job', () => {
    const ciYml = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ciYml).toContain('pnpm test:packages');
  });

  // The next check treats "declared in the workspace" as equivalent to
  // "actually executed by CI" — that equivalence only holds while this
  // script stays a recursive `-r` run.
  it('test:packages recurses across the workspace', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<
      string,
      string
    >;
    expect(scripts['test:packages']).toBe('pnpm -r test');
  });

  // The regression this closes: a package added under packages/ with its own
  // `test` script, but never added to pnpm-workspace.yaml's `packages:` list.
  // `pnpm -r test` silently skips anything the workspace does not declare, so
  // that package's tests would never run anywhere — not in this job, not in
  // `pnpm check`, not in `check:all`. Naming it here is what turns that gap
  // into a failing assertion instead of silence.
  it('every package with a test script is declared in the workspace', () => {
    const declared = new Set(declaredPackages());
    for (const name of readdirSync('packages')) {
      const dir = `packages/${name}`;
      const pkgJsonPath = `${dir}/package.json`;
      if (!existsSync(pkgJsonPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      if (typeof pkg.scripts?.test !== 'string') continue;
      expect(
        declared.has(dir),
        `${dir} declares a test script but is absent from pnpm-workspace.yaml`,
      ).toBe(true);
    }
  });
});

describe('the release configuration', () => {
  const config = JSON.parse(readFileSync('release-please-config.json', 'utf8'));
  const manifest = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'));

  // Nothing validates this file at runtime. extractReleaserConfig reads a
  // fixed list of known keys and discards the rest without a log line, so a
  // per-package typo is invisible in the editor AND at runtime — the plugin
  // version would silently stop tracking and the first symptom is a report.
  it('configures exactly the packages that exist', () => {
    expect(Object.keys(config.packages)).toEqual(['.', 'packages/cli']);
    for (const path of Object.keys(config.packages)) {
      expect(existsSync(path === '.' ? 'package.json' : `${path}/package.json`)).toBe(true);
    }
  });

  // include-component-in-tag defaults to TRUE in manifest mode — the opposite
  // of the action input's default. Exactly one package may hold the bare
  // v<version> namespace, and v1.0.0 already belongs to the extension.
  it('leaves the bare tag namespace to the extension', () => {
    expect(config.packages['.']['include-component-in-tag']).toBe(false);
    expect(config.packages['packages/cli']['include-component-in-tag']).toBeUndefined();
  });

  // A never-released package must be seeded exactly "0.0.0" or the backfill
  // makes its first changelog cover the entire history.
  it('seeds the unreleased package at exactly 0.0.0', () => {
    expect(manifest['.']).toBe('1.0.0');
    expect(manifest['packages/cli']).toBe('0.0.0');
  });

  // All eleven extraFileUpdates sites set createIfMissing: false. A wrong
  // path produces no error and no diff — the version just stops tracking.
  it('points extra-files at manifests that exist', () => {
    for (const entry of config.packages['packages/cli']['extra-files']) {
      const path = typeof entry === 'string' ? entry : entry.path;
      expect(existsSync(path.replace(/^\//, ''))).toBe(true);
    }
  });

  // The workflow reads unprefixed outputs, which only exist while the
  // extension sits at `.`.
  it('keeps the workflow reading output names its packages can produce', () => {
    const workflow = readFileSync('.github/workflows/release-please.yml', 'utf8');
    expect(workflow).toContain('steps.release.outputs.release_created');
    expect(workflow).not.toContain('release-type: node');
  });

  // The absence assertion above passes against a step that is malformed in
  // other ways — removing `release-type: node` once left an empty `with:`
  // behind, which parses to null and supplies no inputs at all. Assert the
  // shape, not just what is missing from it.
  //
  // A flat `/^\s*with:\s*$/m` is not that assertion: YAML puts a mapping's
  // children on following, more-indented lines, so the same pattern matches
  // the checkout step's `with:` two lines above just as readily — that block
  // is populated (`persist-credentials: false` sits under it), and the flat
  // regex cannot see that because it never looks past the `with:` line
  // itself. Measured: it does fire on this file's correctly-formed
  // `with:` at actions/checkout, which is the false positive a stronger
  // check has to rule out. `with:` is empty only when the next non-blank
  // line is NOT indented past it — end of file, a blank line then a
  // same-or-lesser-indented line, or another line right away all count.
  // No YAML parser exists in this dependency tree (confirmed: no `yaml` or
  // `js-yaml` in package.json or node_modules, and CLAUDE.md forbids adding
  // one), so this walks lines by hand rather than reaching for one.
  it('leaves the release step well-formed after losing its only input', () => {
    const lines = readFileSync('.github/workflows/release-please.yml', 'utf8').split('\n');
    const emptyWithLines = lines.filter((line, i) => {
      const withMatch = /^(\s*)with:\s*$/.exec(line);
      if (!withMatch) return false;
      const indent = withMatch[1]!.length;
      let next = i + 1;
      while (next < lines.length && lines[next]!.trim() === '') next++;
      const nextIndent = next < lines.length ? /^(\s*)/.exec(lines[next]!)![1]!.length : -1;
      return nextIndent <= indent;
    });
    expect(emptyWithLines).toEqual([]);
  });
});
