import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { REPO_ROOT } from './build';
import { connectMarionette, type MarionetteClient } from './marionette';

/**
 * The id the Firefox manifest declares (`browser_specific_settings.gecko.id`).
 * Spelled once here and once in wxt.config.ts; tests/unit/manifest.test.ts
 * binds the two. Email-shaped as MDN recommends — not a mailbox, a namespace.
 */
export const GECKO_ID = 'headerlab@say8425.github.io';

/**
 * The internal UUID the e2e profile pins for that id
 * (`extensions.webextensions.uuids`), so `moz-extension://<uuid>/popup.html`
 * is a known address. Firefox otherwise mints one per profile.
 */
export const EXTENSION_UUID = '5f0c2f3e-1111-4222-8333-444455556666';

/**
 * Where Firefox is. `FIREFOX_BIN` first, then the two macOS bundles, then a
 * `firefox` on PATH (which is what the CI runner has — apt, from the Mozilla
 * team PPA, so not a snap, and Firefox 154 there against a floor of 138 for
 * `-remote-allow-system-access`).
 *
 * Throws, never skips: a Firefox suite that reported green because no Firefox
 * was found is the silent failure this repository exists to rule out.
 */
export function findFirefox(): string {
  const candidates = [
    process.env.FIREFOX_BIN,
    '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
    '/Applications/Firefox.app/Contents/MacOS/firefox',
    ...(process.env.PATH ?? '').split(path.delimiter).map((dir) => path.join(dir, 'firefox')),
  ].filter((c): c is string => typeof c === 'string' && c.length > 0);
  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    throw new Error(
      'no Firefox found — set FIREFOX_BIN, or install Firefox Developer Edition; looked at: ' +
        candidates.slice(0, 3).join(', ') +
        ' and every directory on PATH',
    );
  }
  return found;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const address = s.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('could not pick a free port'));
        return;
      }
      s.close(() => resolve(address.port));
    });
  });

export interface FirefoxSession {
  /** `moz-extension://<EXTENSION_UUID>/popup.html`. */
  popupUrl: string;
  /**
   * Evaluates an expression in the current tab and returns its value.
   *
   * The expression may return a promise (`browser.*` does); it is awaited.
   * A thrown error is rethrown here with its message, so a test never reads
   * `undefined` where an exception happened.
   */
  evaluate<T = unknown>(expression: string): Promise<T>;
  navigate(url: string): Promise<void>;
  /** Opens a tab, switches to it, navigates, and returns its handle. */
  newTab(url: string): Promise<string>;
  switchTo(handle: string): Promise<void>;
  screenshot(): Promise<Buffer>;
  close(): Promise<void>;
}

/**
 * Launches a headless Firefox with a fresh profile, installs the build at
 * `extensionDir` temporarily, and navigates the first tab to the popup.
 *
 * Every preference below was needed, and each is named for why:
 *
 * - `extensions.webextensions.uuids` pins the internal UUID so the popup has
 *   a known address.
 * - `extensions.originControls.grantByDefault` grants the e2e manifest's
 *   `host_permissions` at install; Firefox MV3 treats them as optional
 *   otherwise, and nothing here can click a doorhanger.
 * - `extensions.webextOptionalPermissionPrompts: false` lets a future
 *   `permissions.request()` resolve without one.
 * - The rest silence first-run pages and the default-browser check.
 *
 * The profile lives under `test-results/` — gitignored, so it is outside the
 * build-freshness source set, and inside the workspace, which a snap-confined
 * Firefox can read where `/tmp` it cannot. The process is spawned detached so
 * `close()` can kill the whole group: Firefox's crashhelper and
 * plugin-container hold the stdio pipes open otherwise (measured — a `| tail`
 * on the spike waited forever).
 */
export async function launchFirefox(extensionDir: string): Promise<FirefoxSession> {
  const binary = findFirefox();
  const marionettePort = await freePort();
  const profile = path.join(REPO_ROOT, 'test-results', 'firefox-profiles', randomUUID());
  mkdirSync(profile, { recursive: true });

  const prefs: Record<string, string | number | boolean> = {
    'extensions.webextensions.uuids': JSON.stringify({ [GECKO_ID]: EXTENSION_UUID }),
    'extensions.originControls.grantByDefault': true,
    'extensions.webextOptionalPermissionPrompts': false,
    'marionette.port': marionettePort,
    'xpinstall.signatures.required': false,
    'browser.shell.checkDefaultBrowser': false,
    'datareporting.policy.dataSubmissionPolicyBypassNotification': true,
    'toolkit.telemetry.reportingpolicy.firstRun': false,
    'browser.startup.homepage_override.mstone': 'ignore',
    'browser.startup.page': 0,
    'browser.aboutwelcome.enabled': false,
  };
  writeFileSync(
    path.join(profile, 'user.js'),
    `${Object.entries(prefs)
      .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
      .join('\n')}\n`,
  );

  const child: ChildProcess = spawn(
    binary,
    [
      '--headless',
      '--profile',
      profile,
      '-no-remote',
      '--marionette',
      '--remote-allow-system-access',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  let stderr = '';
  child.stderr?.on('data', (c: Buffer) => {
    stderr += c.toString('utf8');
  });
  child.stdout?.on('data', (c: Buffer) => {
    stderr += c.toString('utf8');
  });

  const killGroup = () => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  };

  let client: MarionetteClient;
  try {
    client = await connectMarionette(marionettePort);
  } catch (error) {
    killGroup();
    rmSync(profile, { recursive: true, force: true });
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nfirefox said:\n${stderr}`,
    );
  }

  await client.send('WebDriver:NewSession', { capabilities: { alwaysMatch: {} } });
  const installed = await client.send<{ value: string }>('Addon:Install', {
    path: extensionDir,
    temporary: true,
  });
  if (installed.value !== GECKO_ID) {
    killGroup();
    throw new Error(`Firefox installed the build as ${installed.value}, expected ${GECKO_ID}`);
  }

  const popupUrl = `moz-extension://${EXTENSION_UUID}/popup.html`;

  const evaluate = async <T>(expression: string): Promise<T> => {
    const r = await client.send<{ value: unknown }>('WebDriver:ExecuteAsyncScript', {
      script:
        `const done = arguments[0];\n` +
        `Promise.resolve().then(() => (${expression})).then(` +
        `(v) => done({ ok: true, value: v }), (e) => done({ ok: false, message: String(e && e.message || e) }));`,
      args: [],
    });
    const outcome = r.value as { ok: true; value: T } | { ok: false; message: string };
    if (!outcome.ok) throw new Error(`evaluate failed: ${outcome.message}\n  in: ${expression}`);
    return outcome.value;
  };

  const navigate = async (url: string) => {
    await client.send('WebDriver:Navigate', { url });
  };

  await navigate(popupUrl);

  return {
    popupUrl,
    evaluate,
    navigate,
    async newTab(url) {
      const win = await client.send<{ handle: string }>('WebDriver:NewWindow', { type: 'tab' });
      await client.send('WebDriver:SwitchToWindow', { handle: win.handle });
      await navigate(url);
      return win.handle;
    },
    async switchTo(handle) {
      await client.send('WebDriver:SwitchToWindow', { handle });
    },
    async screenshot() {
      const shot = await client.send<{ value: string }>('WebDriver:TakeScreenshot', {
        full: false,
      });
      return Buffer.from(shot.value, 'base64');
    },
    async close() {
      try {
        await client.send('WebDriver:DeleteSession', {}, 5_000);
      } catch {
        /* the kill below is the real teardown */
      }
      client.close();
      killGroup();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
