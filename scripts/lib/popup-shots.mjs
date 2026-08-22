/**
 * Photographing the built popup, shared by the two generators that do it.
 *
 * `scripts/screenshots.mjs` writes the README's images; `scripts/store-assets.mjs`
 * writes the Chrome Web Store's. They want different sizes, different framing
 * and a different set of states — but the part that is easy to get subtly wrong
 * is identical in both: proving the popup was in the state the caption claims
 * at the instant the shutter fired.
 *
 * That part lived only in screenshots.mjs, itself already a second copy of
 * `tests/support/build.ts`'s freshness guard. A third copy is the shape CLAUDE.md
 * names as this repository's most expensive defect — one predicate implemented
 * four times and then diverging — so it lives here once instead.
 *
 * Plain `.mjs` with no dependency of its own, like everything else under
 * `scripts/`: these are generators, not shipped code, and `tests/support/build.ts`
 * is TypeScript that neither can import.
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The popup's own dimensions, from entrypoints/popup/style.css. */
export const VIEWPORT = { width: 748, height: 600 };

/**
 * `tests/support/build.ts` in miniature — it is TypeScript and not importable
 * here.
 *
 * `ignore` is the caller's own output directory plus `tests/`. Without the
 * first, a second run calls the build stale on account of the images the first
 * run wrote; without the second, editing a test reports itself as staleness,
 * which is how a guard earns enough false alarms to get deleted.
 */
export function assertBuildFresh({ build, ignore, fix }) {
  if (!existsSync(build)) {
    throw new Error(`no build at ${path.relative(ROOT, build)} — ${fix}.`);
  }

  const newestSource = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
    .split('\0')
    .filter((file) => file !== '' && !ignore.some((prefix) => file.startsWith(prefix)))
    .reduce(
      (newest, file) => {
        const stat = statSync(path.join(ROOT, file), { throwIfNoEntry: false });
        return stat?.isFile() && stat.mtimeMs > newest.mtimeMs
          ? { file, mtimeMs: stat.mtimeMs }
          : newest;
      },
      { file: '', mtimeMs: 0 },
    );

  let oldestOutput = Infinity;
  for (const entry of readdirSync(build, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    oldestOutput = Math.min(
      oldestOutput,
      statSync(path.join(entry.parentPath, entry.name)).mtimeMs,
    );
  }

  if (newestSource.mtimeMs > oldestOutput) {
    throw new Error(
      `${path.relative(ROOT, build)} is stale: ${newestSource.file} was modified after it was ` +
        `built. These images would show the previous UI — ${fix}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// The stored state each shot is taken against.
// ---------------------------------------------------------------------------

export function rule(over) {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    target: 'request',
    operation: 'set',
    name: '',
    value: '',
    ...over,
  };
}

/** Built fresh per call: `rule()` mints an id, so a shared array would repeat ids. */
export const headers = (debugUserOperation = 'set') => [
  rule({ name: 'Authorization', value: 'Bearer dev-eyJhbGciOiJIUzI1NiJ9' }),
  rule({ operation: debugUserOperation, name: 'X-Debug-User', value: 'qa@example.com' }),
  rule({ target: 'response', operation: 'remove', name: 'Content-Security-Policy' }),
  // Switched off, so the readout has an "off" count to show.
  rule({
    enabled: false,
    target: 'response',
    operation: 'set',
    name: 'Cache-Control',
    value: 'no-store',
  }),
];

export function profile(domains, rows, allSites = false) {
  return {
    id: 'screenshot-profile',
    name: 'Default',
    color: 'green',
    enabled: true,
    order: 0,
    filter: {
      mode: 'structured',
      allSites,
      domains,
      excludedDomains: [],
      resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
    },
    tabLock: { enabled: false, tabId: null, tabTitle: null },
    headers: rows,
  };
}

/** WXT stores the item's version beside the value; seed both (CLAUDE.md, WXT specifics). */
export const state = (domains, rows = headers(), allSites = false) => ({
  version: 2,
  globalPause: false,
  theme: 'system',
  profiles: [profile(domains, rows, allSites)],
});

// ---------------------------------------------------------------------------
// The capture itself.
// ---------------------------------------------------------------------------

/**
 * What a shot asserts about the screen, read from the live DOM.
 *
 * Runs inside the page, so it is a plain function serialized to the browser —
 * it may not close over anything from this module.
 */
function observe() {
  return {
    sites: [...document.querySelectorAll('[data-testid="site"]')].map((row) =>
      row.getAttribute('data-state'),
    ),
    problems: document.querySelectorAll('[data-testid="rule-problem"]').length,
    // The all-sites row's glyph carries the state as its accessible name, which
    // is three-way — off, granted, awaiting — where the row's own
    // `data-granted` is only two.
    //
    // The element itself is never absent: that slot renders a blank span with
    // no label rather than vanishing, because a control appearing must not
    // resize what holds it (ScopeRail.tsx). So a *missing* element is not the
    // mode being off, it is the testid having been renamed — and folding the
    // two together with `?? 'off'` left eight of the nine shots across both
    // generators still green against a selector that matched nothing. This
    // reports it as a value no shot expects, so every shot fails and says so.
    allSites: (() => {
      const glyph = document.querySelector('[data-testid="all-sites-state"]');
      if (!glyph) return 'MISSING: no [data-testid="all-sites-state"] in the popup';
      return glyph.getAttribute('aria-label') ?? 'off';
    })(),
  };
}

const matches = (actual, want) =>
  actual.problems === want.problems &&
  actual.allSites === want.allSites &&
  actual.sites.length === want.sites.length &&
  actual.sites.every((value, i) => value === want.sites[i]);

/**
 * Loads the production build in real Chrome and writes one PNG per shot into
 * `outDir`, named by `shot.file`. Throws rather than writing a shot whose screen
 * did not match — the caller is expected to stage into a throwaway directory and
 * copy out only once every shot has survived, so a mid-run failure cannot leave
 * a half-updated set behind.
 *
 * `preGranted` is patched into the loaded copy's `host_permissions`, because
 * `permissions.request()` opens a dialog Playwright cannot click and a *granted*
 * row cannot otherwise be photographed. Whatever ships must say so beside the
 * images rather than let them imply a grant flow that did not happen.
 */
export async function capturePopupShots({
  build,
  shots,
  outDir,
  // Required, with no default. It used to default to `[]`, which both callers
  // override and which would therefore only ever be reached by a third caller
  // that had forgotten it — writing `host_permissions: []` and photographing
  // every site row in the pending state while reading as though omitting the
  // argument were a supported thing to do.
  preGranted,
  viewport = VIEWPORT,
  deviceScaleFactor = 2,
}) {
  if (!Array.isArray(preGranted)) {
    throw new TypeError('capturePopupShots needs `preGranted`: the origins to pre-grant, or [].');
  }

  // Named, not inlined: a directory whose path is only ever an argument cannot
  // be deleted afterwards. The Chrome profile was that, and leaked 71MB over 5 runs.
  const extension = mkdtempSync(path.join(tmpdir(), 'headerlab-ext-'));
  const profileDir = mkdtempSync(path.join(tmpdir(), 'headerlab-profile-'));

  try {
    cpSync(build, extension, { recursive: true });
    const manifestPath = path.join(extension, 'manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify(
        { ...JSON.parse(readFileSync(manifestPath, 'utf8')), host_permissions: preGranted },
        null,
        2,
      ),
    );

    const context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chromium',
      viewport,
      deviceScaleFactor,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });

    try {
      let [worker] = context.serviceWorkers();
      if (!worker) worker = await context.waitForEvent('serviceworker');
      const extensionId = worker.url().split('/')[2];
      const page = await context.newPage();

      for (const shot of shots) {
        await worker.evaluate(async (seed) => {
          await chrome.storage.local.set({ state: seed, state$: { v: 2 } });
        }, shot.state);

        // Before navigating: public/theme.js reads the media query at parse time.
        await page.emulateMedia({ colorScheme: shot.colorScheme });
        await page.goto(`chrome-extension://${extensionId}/popup.html`);

        // Hold, shoot, check again. Waiting for the state to be right *once*
        // passed on the optimistic first frame — `grantDiagnostics` starts
        // `[]`, so every row reads `granted` before the probe answers — while
        // the screenshot was taken later, against a different frame. Requiring
        // the same reading twenty times in a row rules that frame out; the
        // re-check after the shutter is what speaks about the frame actually
        // captured.
        //
        // The loop runs here rather than inside the page so that `observe` and
        // `matches` are used verbatim in both places. Playwright serializes a
        // function that closes over nothing, which is why they are declared at
        // module scope with no captures — the alternative was a second, inline
        // copy of the DOM reader that could drift from this one.
        const want = { sites: shot.expect, problems: shot.problems, allSites: shot.allSites };

        const deadline = Date.now() + 10_000;
        for (let held = 0; held < 20;) {
          const now = await page.evaluate(observe);
          held = matches(now, want) ? held + 1 : 0;
          if (held < 20 && Date.now() > deadline) {
            throw new Error(
              `${shot.file}: the popup never held the expected state for 20 readings — ` +
                `expected ${JSON.stringify(want)}, last read ${JSON.stringify(now)}.`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 16));
        }

        await page.screenshot({
          path: path.join(outDir, shot.file),
          clip: { x: 0, y: 0, ...viewport },
        });

        const actual = await page.evaluate(observe);
        if (!matches(actual, want)) {
          throw new Error(
            `${shot.file}: the popup changed between the wait and the shot — ` +
              `expected ${JSON.stringify(want)}, captured ${JSON.stringify(actual)}.`,
          );
        }
      }
    } finally {
      await context.close();
    }
  } finally {
    for (const dir of [extension, profileDir]) rmSync(dir, { recursive: true, force: true });
  }
}
