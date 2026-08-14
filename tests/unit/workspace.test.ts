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

/**
 * The lockfile's own list of importers — text, not YAML, for the same reason
 * `declaredPackages()` above is: no parser is in this dependency tree and
 * CLAUDE.md forbids adding one. Importer directory keys sit at exactly
 * 2-space indent (`  packages/headerlab:` or `  .:`); their `dependencies:`/
 * `devDependencies:` children sit deeper, at 4 spaces or more, where `\S+`
 * cannot start matching because the two required literal spaces leave it
 * looking at a third space, not a name. That is what keeps this from
 * grabbing those instead of the importer keys themselves.
 */
function lockfileImporters(): string[] {
  const lock = readFileSync('pnpm-lock.yaml', 'utf8');
  const block = /^importers:\s*$([\s\S]*?)^packages:/m.exec(lock);
  if (!block) throw new Error('pnpm-lock.yaml declares no `importers:` key');
  return [...block[1]!.matchAll(/^ {2}(\S+):/gm)].map((m) => m[1]!);
}

describe('the workspace', () => {
  it('declares the two packages', () => {
    expect(declaredPackages()).toEqual(['packages/headerlab', 'packages/plugin']);
  });

  // A glob would let a directory be added without anyone noticing it joined
  // the release surface. Naming them is what makes that a diff.
  it('names them rather than globbing', () => {
    expect(declaredPackages().some((p) => p.includes('*'))).toBe(false);
  });

  it.each(['packages/headerlab', 'packages/plugin'])('%s exists and has a package.json', (dir) => {
    expect(existsSync(`${dir}/package.json`)).toBe(true);
  });

  // `private: true`'s absence on packages/headerlab is the whole safety switch
  // that lets `npm publish` succeed there — without it npm rejects an
  // accidental publish with EPRIVATE. Nothing previously asserted the other
  // two packages still carry that flag. It bites harder than usual here
  // because the root package and the CLI package share the npm name
  // `headerlab`: the root has no `files` field and no `.npmignore` (so a
  // publish would fall back to `.gitignore` and pack most of the working
  // tree), and the root's `1.0.0` outranks the CLI's `0.0.0`, so it would
  // become `latest` on the very name the CLI is meant to own.
  //
  // All three directions are asserted, not just the two `private: true`
  // packages — a test that checks only those passes if `packages/headerlab`
  // silently becomes private again and quietly stops publishing.
  it('keeps private: true on the root and the plugin, and no private key on the CLI', () => {
    const root = JSON.parse(readFileSync('package.json', 'utf8'));
    const plugin = JSON.parse(readFileSync('packages/plugin/package.json', 'utf8'));
    const cli = JSON.parse(readFileSync('packages/headerlab/package.json', 'utf8'));
    expect(root.private).toBe(true);
    expect(plugin.private).toBe(true);
    expect('private' in cli).toBe(false);
  });

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
   * **Measured on pnpm 10.33.0, which is what runs here. CI pins 11.20.0 and
   * this has never been reproduced there** — the caveat is in `6220afe`'s
   * commit message and was dropped when the reasoning was copied into this
   * file. Lockfile-validation strictness is exactly the kind of thing that
   * changes between majors, so the honest claim is narrower than it reads: on
   * 11, neither outcome has been observed. `.github/actions/setup` therefore
   * runs `git diff --exit-code pnpm-lock.yaml` after installing, which is
   * correct whichever way that resolves.
   *
   * The same prediction was made twice, two days apart, by two different
   * reviews — and both times the answer was already in this repository. If a
   * third one arrives, read `6220afe` before acting on it.
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

  /**
   * The test above only checks containment — every declared package has AN
   * entry — which passes just as well if the lockfile also carries an entry
   * nothing declares. That is exactly the shape Task 1's merge left behind
   * for a moment: pnpm-workspace.yaml said packages/headerlab, the lockfile
   * still said packages/cli AND packages/host, and every local check
   * (pnpm check:all, pnpm test:e2e) stayed green regardless, because CI's
   * `pnpm install --frozen-lockfile` — the step that actually validates the
   * importer set against the declared packages — never runs here. Set
   * equality catches that: an extra importer fails this exactly as loudly
   * as a missing one.
   *
   * Normalised by DROPPING `.` from the lockfile's side rather than adding a
   * synthetic root entry to declaredPackages(): the workspace root is always
   * an implicit importer and pnpm-workspace.yaml never lists it, so treating
   * `.` as a package the workspace "declares" would be modelling something
   * that isn't actually a workspace package.
   */
  it('agrees with pnpm-lock.yaml on exactly which packages exist', () => {
    const fromLockfile = lockfileImporters().filter((importer) => importer !== '.');
    expect(fromLockfile.sort()).toEqual([...declaredPackages()].sort());
  });
});

// Root vitest only sees `tests/unit/**/*.test.{ts,tsx}` (vitest.config.ts),
// and `packages/*/test/*.mjs` runs under `node:test`, outside that glob and
// outside every job `ci.yml` had before this describe block existed. Nothing
// ran the 89 tests those packages wrote — the socket, framing, lifecycle,
// argv grammar and id-correlation suites all merged green whether they
// passed or not, because nothing ever executed them.
describe('the CI workflow', () => {
  // The obvious form of this — `toContain('pnpm test:packages')` — passes
  // against a commented-out step, because the phrase is still in the file.
  // That is the defect this whole guard exists to prevent, one level up: a
  // check that reports the suites are covered when nothing runs them. The
  // pattern requires an active `- run:` line, so `# - run: …` fails it.
  it('runs pnpm test:packages as its own job', () => {
    const ciYml = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ciYml).toMatch(/^\s*-\s+run:\s+pnpm test:packages\s*$/m);
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
  // `component` is asserted by name and not just by existing: a
  // `"componant": "cli"` typo used to pass this test silently, dropping the
  // CLI's component. That used to collide with the extension's bare namespace;
  // since 2026-08-14 the extension names itself too, so the failure is quieter
  // and worse — the component falls back to the package name, and both
  // packages would answer to `headerlab`.
  it('configures exactly the packages that exist', () => {
    expect(Object.keys(config.packages)).toEqual(['.', 'packages/headerlab']);
    expect(config.packages['packages/headerlab'].component).toBe('cli');
    for (const path of Object.keys(config.packages)) {
      expect(existsSync(path === '.' ? 'package.json' : `${path}/package.json`)).toBe(true);
    }
  });

  // Both packages name themselves, in the tag and therefore in the GitHub
  // release title — release-please builds that title as `<component>: v<x.y.z>`,
  // and the component reaches it only by being in the tag. Measured on a
  // sibling repository using the same action: tag `diffdeck-v1.3.2`, release
  // titled `diffdeck: v1.3.2`.
  //
  // The extension used to hold the bare `v<version>` namespace via
  // `include-component-in-tag: false`, and `v1.0.0`/`v1.1.0` were tagged under
  // that shape. They no longer exist: on 2026-08-15 both releases were moved
  // onto `extension-v1.0.0`/`extension-v1.1.0` and the bare tags deleted, so
  // every tag in this repository now names its package. Moving a release
  // rather than deleting and re-creating it is what kept the two
  // `headerlab-<version>-chrome.zip` assets and their download counts —
  // `PATCH /releases/{id}` accepts `tag_name`, and the release object survives
  // the change. Nothing here is derived from those tags, so this file only
  // records what happened; the live evidence is `gh release list`.
  //
  // `component` is asserted by value, not just presence: without it the
  // default comes from the package name, and the root's is `headerlab` — so a
  // dropped key produces `headerlab: v1.1.1` beside `cli: v0.1.1`, which reads
  // as though the extension were the CLI.
  it('makes both packages name themselves in their tags', () => {
    expect(config.packages['.'].component).toBe('extension');
    expect(config.packages['packages/headerlab'].component).toBe('cli');
    // Manifest mode defaults this to TRUE — the opposite of the action input's
    // default — so leaving it unset is what keeps the component in the tag.
    // An explicit `false` on either package would silently drop it.
    const packages = config.packages as Record<string, Record<string, unknown>>;
    for (const [path, pkg] of Object.entries(packages)) {
      expect(pkg['include-component-in-tag'], `${path} drops its component`).not.toBe(false);
    }
  });

  /**
   * The old form of this test pinned `manifest['.']` to `'1.0.0'` and
   * `manifest['packages/cli']` to `'0.0.0'` — true only of the manifest's
   * *initial* seed. `.release-please-manifest.json` IS release-please's
   * state: merging the first release PR writes the bumped versions straight
   * into this file. On that push `pnpm check` runs, this pin would go red,
   * and the job dies BEFORE `pnpm zip` and `gh release upload` — after the
   * tag and GitHub release already exist, in the one job holding
   * `contents: write`. A published release with no artifact, and a red
   * `main`, from a guard that was only ever true once.
   *
   * What is durably true instead: every manifest entry is strict semver and
   * matches exactly the packages release-please-config.json configures, plus
   * — for the CLI specifically — its manifest entry tracks its own
   * package.json, which is the invariant release-please actually maintains
   * (mirrors `tests/unit/plugin.test.ts`'s "carries one version across both
   * manifests"). The next person to touch this file will be tempted to
   * re-pin it after a release changes the numbers; don't — re-pinning is
   * exactly what breaks on the release after that one.
   */
  it('keeps the manifest in strict semver, one entry per configured package', () => {
    expect(Object.keys(manifest).sort()).toEqual(Object.keys(config.packages).sort());
    for (const version of Object.values(manifest)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("tracks the CLI package's own version", () => {
    const cliPackage = JSON.parse(readFileSync('packages/headerlab/package.json', 'utf8'));
    expect(manifest['packages/headerlab']).toBe(cliPackage.version);
  });

  // All eleven extraFileUpdates sites set createIfMissing: false. A wrong
  // path produces no error and no diff — the version just stops tracking.
  // `toEqual` on the exact two paths rather than iterating whatever the array
  // holds: iterating passes if one of the two entries is simply deleted, and
  // passes if either is repointed at a manifest that exists but nothing
  // reads — /packages/plugin/package.json, for instance, which would be
  // bumped and would track nothing.
  it('points extra-files at manifests that exist', () => {
    const entries = config.packages['packages/headerlab']['extra-files'].map((entry: unknown) =>
      typeof entry === 'string' ? entry : (entry as { path: string }).path,
    );
    expect(entries).toEqual([
      '/packages/plugin/.claude-plugin/plugin.json',
      '/packages/plugin/.codex-plugin/plugin.json',
    ]);
    for (const path of entries) {
      expect(existsSync(path.replace(/^\//, ''))).toBe(true);
    }
  });

  /**
   * The root package's path is the whole repository, so without this every
   * CLI commit also lands in the extension's changelog.
   *
   * **Measured, and the measurement is the honest part: this changes nothing
   * about the history that already exists.** The schema's own wording is
   * "if all files from commit belong to one of the paths it will be skipped",
   * so a commit is dropped only when it touches nothing outside the excluded
   * paths — and all 14 commits between `extension-v1.0.0` and
   * `extension-v1.1.2` touch something outside `packages/`. The two that read
   * as CLI-only in the changelog (#23, #26) each also edited a root file —
   * README.md and CLAUDE.md — so they belong in the extension's changelog and
   * stay there. What this buys is the commit that has not happened yet: a fix
   * living entirely under `packages/headerlab/`, which is the ordinary shape
   * of CLI work once its docs settle.
   *
   * Derived from the configured packages rather than pinned to the literal
   * `['packages/headerlab']`, so a third released package added without being
   * excluded fails here instead of quietly widening the extension's changelog.
   *
   * `packages/plugin` is deliberately NOT excluded, and it is the one path
   * where the obvious tidy answer is wrong. It is not a release-please package
   * — it is version-bumped through the CLI's `extra-files` — so nothing else
   * would pick its commits up. Excluding it would make a skill-only change
   * appear in no changelog at all, which is worse than appearing in a
   * debatable one.
   */
  it("keeps the extension's changelog off the other packages' own commits", () => {
    const siblings = Object.keys(config.packages).filter((path) => path !== '.');
    expect(config.packages['.']['exclude-paths']).toEqual(siblings);
  });

  // The setting that delivers the independent releases the owner asked for.
  // Deleting it merges the extension's and the CLI's release PRs into one,
  // with nothing else in this file failing.
  it('delivers independent releases per package', () => {
    expect(config['separate-pull-requests']).toBe(true);
  });

  // The workflow now reads three different output shapes, not one: the
  // root-only singular `release_created` (still correct for the extension's
  // own `pnpm zip`/`gh release upload` — the root component, path `.`, is
  // the extension), the plural `releases_created` (deliberately widened so
  // `./.github/actions/setup` and `pnpm check` still run on a CLI-only
  // release, where the root output is unset), and the CLI's own prefixed
  // `packages/headerlab--release_created` (the npm publish step and the
  // setup-node step ahead of it). This assertion pins only the first of
  // those, because it's the one a careless refactor is likeliest to delete
  // outright rather than merely misname. The publish step's prefixed gate is
  // pinned on its own below, tied to the step itself.
  it('keeps the workflow reading output names its packages can produce', () => {
    const workflow = readFileSync('.github/workflows/release-please.yml', 'utf8');
    expect(workflow).toContain('steps.release.outputs.release_created');
    expect(workflow).not.toContain('release-type: node');
  });

  // Tied to the publish step itself, not "does this string appear anywhere
  // in the file" — a bare `toContain` on the whole file would pass just as
  // well with the right-looking string sitting in a comment, or attached to
  // a different step's `if:`. The bare `release_created` this replaced is
  // the root component's own output (the extension, path `.`); gating the
  // CLI's publish on it fails in two directions — a CLI-only release leaves
  // it unset and publishes nothing, an extension-only release leaves it true
  // and publishes the CLI unchanged at whatever version its package.json
  // still holds, claiming that version on npm for the 72-hour unpublish
  // window and permanently after.
  it("gates the npm publish step on the CLI package's own release output", () => {
    const lines = readFileSync('.github/workflows/release-please.yml', 'utf8').split('\n');
    const publishIndex = lines.findIndex((line) => line.includes('npm publish --provenance'));
    expect(publishIndex).toBeGreaterThan(-1);
    expect(lines[publishIndex + 1]).toContain(
      "steps.release.outputs['packages/headerlab--release_created']",
    );
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
