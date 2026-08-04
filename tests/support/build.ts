import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Freshness guard for the suites that assert against **built output** rather
 * than source: tests/unit/theme.test.ts, tests/unit/manifest.test.ts and the
 * whole E2E suite. Their `package.json` scripts build first, but `npx vitest
 * run` and `npx playwright test` do not, and until this module existed nothing
 * noticed. Both directions of that had already cost real time:
 *
 *  - A reviewer deleted `width: 100%` from style.css to mutation-check the
 *    layout guard, ran `npx playwright test`, and got 4/4 green. The change
 *    never reached the build, so the one assertion operating at the resolved
 *    layout level was silently switched off by the choice of command.
 *  - A `npx vitest run` on freshly-merged main reported three theme failures
 *    against a build predating theme.js — a false red, diagnosed as a
 *    regression that did not exist.
 *
 * **Detect and fail, rather than build inside the harness.** A `globalSetup`
 * that builds is evaluated once per process, so `vitest --watch` (the `test:watch`
 * script) would pin itself to the build taken at watch start and go quietly
 * stale for the rest of the session — the original bug with a longer fuse. This
 * check runs at the point the artifact is *consumed*, so it is re-evaluated
 * every time an assertion depends on it. It also keeps `npm test` from building
 * twice (measured: ~1.4s build against a ~1.5s suite) and gives an error that
 * names the command to run, the way fixtures.ts already did for absence.
 */

// Derived from this module's own location rather than `process.cwd()`: vitest
// and playwright are launched from different directories, and a source set that
// silently resolved against the wrong root would be empty — fresh, always.
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * WXT suffixes the output directory with the mode unless it is `development` or
 * `production` (see `resolve-config.mjs`'s `modeSuffix` table), so `wxt build
 * --mode e2e` lands in `chrome-mv3-e2e`, not `chrome-mv3`.
 */
const BUILDS = {
  production: {
    dir: '.output/chrome-mv3',
    fix: 'run `npm test`, which builds first — not a bare `npx vitest run`',
  },
  e2e: {
    dir: '.output/chrome-mv3-e2e',
    fix:
      'run `npm run test:e2e` (or `npm run build:e2e` before `playwright test`) — ' +
      'not a bare `npx playwright test`, and not a plain `npm run build`',
  },
} as const;

export type BuildMode = keyof typeof BUILDS;

export interface SourceFile {
  /** Repo-relative path: a file, or a directory (trailing `/`) whose entries moved. */
  file: string;
  mtimeMs: number;
  /**
   * Set when the timestamp came from a directory rather than a file's contents,
   * so the error can say *why* a directory has anything to do with staleness.
   */
  kind?: 'directory';
}

/**
 * Every file that can change what `wxt build` emits, relative to the repo root.
 *
 * The source set is "the working tree, minus what git ignores" — `--cached` for
 * tracked files, `--others --exclude-standard` for new ones that are not
 * ignored yet, since a component written five minutes ago and not staged is
 * exactly the kind of change that goes missing. It is deliberately *not* a
 * hand-written list of source directories: that list is this same bug one layer
 * down, because adding `lib/newthing/` would silently stop the guard covering
 * it and the failure would be a false green. `.gitignore` already names every
 * build output (`.output/`, `.wxt/`, `test-results/`, ...) and has to stay
 * accurate or `git status` becomes unusable, so it is the one inventory in the
 * repo that cannot rot unnoticed.
 *
 * `tests/` is the single carve-out. Nothing under it can reach a build — the
 * module graph starts at `entrypoints/` — and including it would mean editing
 * these very tests reported itself as staleness, which is how a guard earns
 * enough false alarms to get deleted. buildFreshness.test.ts asserts both
 * halves of that: that the set still covers the whole build graph, and that no
 * shipped file imports from `tests/`.
 *
 * If git is unavailable the `execFileSync` throws, which is the intended
 * direction: unable to determine the source set is a loud failure, never a
 * silent pass.
 *
 * `root` defaults to the repo and is only ever passed by buildFreshness.test.ts,
 * which points the same command at a throwaway git repo. Deleting a source or
 * dropping an untracked one into *this* tree to test the flags would make every
 * other suite that reads the build report it stale, in parallel, for as long as
 * the test ran.
 */
export function sourceFiles(root: string = REPO_ROOT): string[] {
  const listing = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return listing.split('\0').filter((file) => file !== '' && !file.startsWith('tests/'));
}

/** The closest ancestor of `dir` that still exists — `.` at worst. */
function nearestExistingDir(root: string, dir: string): string {
  let current = dir;
  while (
    current !== '.' &&
    !statSync(path.join(root, current), { throwIfNoEntry: false })?.isDirectory()
  ) {
    current = path.dirname(current);
  }
  return current;
}

/**
 * The newest timestamp anything in {@link sourceFiles} can produce.
 *
 * **Files alone are not enough.** A file's mtime moves only when its contents
 * are rewritten, so the two ordinary edits that *remove* a source leave nothing
 * newer than the build anywhere: `--cached` still lists a deleted path and
 * `statSync` finds nothing to stat, and `rename(2)` carries the old mtime to the
 * new path. Both were measured reporting a stale build fresh — `rm
 * public/theme.js` followed by a bare `npx vitest run` gave 4/4 green on
 * assertions about a file whose source was gone.
 *
 * What both do move is the **containing directory's** mtime: adding or removing
 * a name is a write to the directory itself. So the maximum folds in, for every
 * listed path, every directory above it and below the repo root — and for a path
 * git lists but the working tree does not have, the nearest ancestor that still
 * exists, which is what catches a whole directory being removed.
 *
 * Reading directories has one cost worth knowing before editing `.gitignore`: a
 * file this set never lists still moves the mtime of the directory holding it.
 * An untracked `components/.DS_Store` is a false red naming the file today; add
 * `.DS_Store` to `.gitignore` and it becomes a false red naming `components/`
 * instead, which is harder to diagnose rather than gone. Patterns with no
 * leading slash match at any depth, so this is reachable by any of them.
 *
 * **The repo root is not folded in on its own account.** Every artifact
 * `.gitignore` names sits directly under it (`.output/`, `test-results/`,
 * `playwright-report/`, `node_modules`), so the root's mtime moves for reasons
 * that are not source at all: measured here, the root was 31s newer than the
 * build it had just produced, because playwright had written `test-results/` in
 * between — every spec after the first would have called that build stale. The
 * root is read only as the last ancestor of a path that has actually gone
 * missing, which is a source change by construction.
 *
 * What that exclusion costs, stated as the class it is rather than the one
 * example of it: **a staged removal or rename of any top-level file is
 * invisible.** `git rm vite.config.ts`, `git mv wxt.config.ts wxt.config.mts`,
 * `git rm public/theme.js` when it was the last file in `public/` — in each the
 * path leaves the index, so nothing is listed as missing, the branch that would
 * read the root as a last ancestor never runs, and the only mtime that moved is
 * the root's. That is all 11 tracked top-level files here, `wxt.config.ts`,
 * `vite.config.ts`, `package.json`, `package-lock.json`, `tsconfig.json`,
 * `vitest.config.ts`, `components.json` and `playwright.config.ts` among them.
 * The *unstaged* forms — `rm` or `mv` without git, which is what a person
 * typing in a terminal usually produces — are caught, because they leave a
 * listed path with nothing to stat and its last existing ancestor is the root.
 * Closing the staged case needs the source list recorded into the build and
 * compared as a set, which is a build-side change rather than a test-side one.
 */
export function newestSource(root: string = REPO_ROOT): SourceFile | undefined {
  let newest: SourceFile | undefined;
  const fold = (candidate: SourceFile) => {
    if (!newest || candidate.mtimeMs > newest.mtimeMs) newest = candidate;
  };

  const directories = new Set<string>();
  for (const file of sourceFiles(root)) {
    // `--cached` also lists files deleted from the working tree but not yet
    // staged, so a missing path here is expected rather than an error — it is
    // the deletion signal, not an absence of one.
    const stat = statSync(path.join(root, file), { throwIfNoEntry: false });
    if (stat?.isFile()) fold({ file, mtimeMs: stat.mtimeMs });

    if (stat) {
      // Every ancestor, not just the immediate dirname: a directory that holds
      // only subdirectories is no listed path's dirname, so `git mv lib/view/grid
      // lib/view/table` writes to `lib/view` with nothing watching it — the
      // renamed directory carries its own mtime along, exactly like a file. This
      // costs no extra false alarms, because a directory's mtime moves only when
      // an entry directly inside *it* is added, removed or renamed: an ancestor
      // never sees a write that its descendants absorbed. The loop stops before
      // the repo root, which `path.dirname` gives as `.`.
      for (let dir = path.dirname(file); dir !== '.'; dir = path.dirname(dir)) {
        directories.add(dir);
      }
    } else {
      // `rm -rf lib/permissions` takes the dirname itself with it; the write
      // landed on the closest directory that survived.
      directories.add(nearestExistingDir(root, path.dirname(file)));
    }
  }

  for (const dir of directories) {
    const stat = statSync(path.join(root, dir), { throwIfNoEntry: false });
    if (!stat?.isDirectory()) continue;
    fold({ file: `${dir}/`, mtimeMs: stat.mtimeMs, kind: 'directory' });
  }

  return newest;
}

/**
 * The build's timestamp, taken as its **oldest** file rather than its newest.
 *
 * The question being asked is whether every emitted file postdates every
 * source, so the weakest link decides. Measured on this project: `wxt build`
 * rewrites the whole directory, and even `public/theme.js` — copied rather than
 * generated — lands with the build's own mtime instead of the source's, so both
 * readings are identical today. Oldest is the one that stays correct if that
 * ever changes: a bundler that began skipping unchanged files would make this
 * over-report, which is loud, where newest would make it under-report, which is
 * the silence the guard exists to remove.
 *
 * Returns `Infinity` for a directory with no files, which the caller treats the
 * same as no build at all.
 */
export function oldestOutputMtime(dir: string): number {
  if (!existsSync(dir)) return Infinity;
  let oldest = Infinity;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const { mtimeMs } = statSync(path.join(entry.parentPath, entry.name));
    if (mtimeMs < oldest) oldest = mtimeMs;
  }
  return oldest;
}

/**
 * Equal timestamps count as fresh. A source and an output written in the same
 * millisecond can only mean the build was reading that source as it ran, and
 * treating the tie as stale would turn every build into a coin flip on
 * filesystems with coarse timestamps.
 */
export function isStale(oldestOutputMs: number, source: SourceFile | undefined): boolean {
  return source !== undefined && source.mtimeMs > oldestOutputMs;
}

/** Human-readable gap, so "1d" in the error says at a glance how stale. */
function describeGap(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 36 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/**
 * Throws unless `mode`'s build exists and postdates every source file *and*
 * every directory holding one — the second half being what makes a source
 * deleted or renamed since the build visible, since neither leaves a newer file
 * behind. Returns the absolute output directory so callers do not re-derive it.
 */
export function assertBuildFresh(mode: BuildMode): string {
  const { dir, fix } = BUILDS[mode];
  const full = path.join(REPO_ROOT, dir);

  const built = oldestOutputMtime(full);
  if (built === Infinity) {
    throw new Error(`extension build not found at ${dir} — ${fix}.`);
  }

  const source = newestSource();
  if (isStale(built, source)) {
    const what =
      source?.kind === 'directory'
        ? `${source.file} gained, lost or renamed an entry`
        : `${source?.file} was modified`;
    throw new Error(
      `${dir} is stale: ${what} ${describeGap((source?.mtimeMs ?? 0) - built)} ` +
      `after the build. This suite asserts against built output, so anything it reports now ` +
      `describes the previous sources — ${fix}.`,
    );
  }

  return full;
}

/** Reads a file out of `mode`'s build, refusing to read a stale one. */
export function readBuildFile(mode: BuildMode, relative: string): string {
  const full = path.join(assertBuildFresh(mode), relative);
  if (!existsSync(full)) {
    throw new Error(
      `${BUILDS[mode].dir}/${relative} is missing from an otherwise up-to-date build.`,
    );
  }
  return readFileSync(full, 'utf8');
}
