import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_FILE_NAME,
  hostManifest,
  launcherScript,
  nativeMessagingDir,
} from '../../host/lib/manifest.mjs';
import { findLiveBridges } from './bridge.mjs';
import { isSocketAlive, socketDir, socketPathFor } from '../../host/lib/socket.mjs';

/**
 * Installs, removes and reports on the native messaging host manifest.
 *
 * Every path is a parameter rather than something this module resolves for
 * itself — the same discipline `lib/bridge.mjs` follows — because the e2e
 * suite has to install into Playwright's throwaway profile and the tests have
 * to install into a scratch directory. `defaultInstallPaths()` is where the
 * real locations are decided, and it is called by `bin/headerlab.mjs`.
 *
 * Uses `node:child_process` deliberately — `tests/unit/outbound.test.ts` does
 * not ban it and should not: spawning the host to verify it actually starts
 * is this file's job, not a network primitive the "no fetch in the bundle"
 * guard is watching for.
 */

const LAUNCHER_NAME = 'headerlab-host';

/** How long the verification host gets to bind its socket. */
const VERIFY_TIMEOUT_MS = 5000;
const VERIFY_POLL_MS = 50;

export function defaultInstallPaths({ userDataDir = null, browser = 'chrome' } = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return {
    manifestDir: nativeMessagingDir({
      platform: process.platform,
      home: homedir(),
      userDataDir,
      browser,
    }),
    // Our own directory, not Chrome's. Chrome's holds manifests; a launcher
    // sitting among them is a file nobody expects and uninstall has to reason
    // about separately.
    launcherDir: path.join(homedir(), '.headerlab', 'bin'),
    entryPath: path.resolve(here, '../../host/bin/headerlab-host.mjs'),
    nodePath: process.execPath,
    socketDirPath: socketDir(),
  };
}

function launcherPathIn(launcherDir) {
  return path.join(launcherDir, LAUNCHER_NAME);
}

function manifestPathIn(manifestDir) {
  return path.join(manifestDir, MANIFEST_FILE_NAME);
}

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * Writes the launcher and the manifest, then **runs the launcher** and waits
 * for it to bind a socket.
 *
 * Running it is not belt-and-braces. Chrome reports a rejected manifest, an
 * origin mismatch and an unstartable interpreter with byte-identical messages
 * (measured), and the extension can see none of the three — so an installer
 * that only wrote files would be asking Chrome to diagnose it, which is this
 * repository's definition of a silent failure.
 *
 * A failed verification removes both files. Leaving them would be strictly
 * worse than not installing: Chrome would find a manifest, fail on it, and
 * report the same message as for no manifest at all.
 */
export async function installBridge({
  manifestDir,
  launcherDir,
  entryPath,
  nodePath,
  extensionId,
  socketDirPath,
}) {
  if (!existsSync(entryPath)) {
    return fail('install-failed', `the host entry does not exist: ${entryPath}`);
  }

  let script;
  try {
    script = launcherScript({ nodePath, entryPath });
  } catch (error) {
    return fail('install-failed', error.message);
  }

  const launcherPath = launcherPathIn(launcherDir);
  const manifestPath = manifestPathIn(manifestDir);

  mkdirSync(launcherDir, { recursive: true, mode: 0o700 });
  writeFileSync(launcherPath, script, { mode: 0o700 });
  chmodSync(launcherPath, 0o700);

  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    manifestPath,
    `${JSON.stringify(hostManifest({ launcherPath, extensionId }), null, 2)}\n`,
    { mode: 0o600 },
  );

  const verification = await verifyLauncher(launcherPath, extensionId, socketDirPath);
  if (!verification.ok) {
    rmSync(launcherPath, { force: true });
    rmSync(manifestPath, { force: true });
    return fail('install-failed', verification.message);
  }

  return { ok: true, manifestPath, launcherPath, extensionId, verified: true };
}

/**
 * Starts the launcher exactly the way Chrome would — one argv entry, the
 * extension origin — and waits for the socket that proves it got as far as
 * binding. Then closes its stdin, which is the documented shutdown signal, and
 * waits for it to go.
 *
 * `HEADERLAB_SOCKET_DIR` is set on the child's environment only, not argv:
 * Chrome invokes the launcher with exactly the one origin argument, and this
 * spawn call must exercise that same real path. `packages/host/lib/socket.mjs`'s
 * `socketDir()` reads the variable, which is what keeps this verification run
 * from binding into the developer's own per-user socket directory — Chrome
 * itself never sets it, so production is unaffected.
 */
async function verifyLauncher(launcherPath, extensionId, socketDirPath) {
  let child;
  try {
    child = spawn(launcherPath, [`chrome-extension://${extensionId}/`], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HEADERLAB_SOCKET_DIR: socketDirPath },
    });
  } catch (error) {
    return { ok: false, message: `could not run ${launcherPath}: ${error.message}` };
  }

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  const exited = new Promise((resolve) => {
    child.once('exit', (code) => resolve(code));
    child.once('error', (error) => resolve(error));
  });

  const socketPath = socketPathFor(socketDirPath, child.pid);
  const deadline = Date.now() + VERIFY_TIMEOUT_MS;
  let bound = false;
  while (Date.now() < deadline) {
    if (await isSocketAlive(socketPath)) {
      bound = true;
      break;
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, VERIFY_POLL_MS));
  }

  child.stdin.end();
  child.kill('SIGKILL');
  await exited;

  if (!bound) {
    const detail = stderr.trim() === '' ? '' : ` — it said: ${stderr.trim()}`;
    return {
      ok: false,
      message:
        `the host at ${launcherPath} did not start${detail}. ` +
        'Chrome gives no more detail than this either — it reports the same message for a ' +
        'rejected manifest, a mismatched extension id and an interpreter it cannot run.',
    };
  }
  return { ok: true };
}

/** Idempotent: removing what is not there is success, not an error. */
export async function uninstallBridge({ manifestDir, launcherDir }) {
  const removed = [];
  for (const target of [manifestPathIn(manifestDir), launcherPathIn(launcherDir)]) {
    if (!existsSync(target)) continue;
    rmSync(target, { force: true });
    removed.push(target);
  }
  return { ok: true, removed };
}

/**
 * What is on disk and what is live. Reports facts rather than a verdict — the
 * three facts that go wrong independently are whether the manifest is there,
 * which origin it names, and whether the file its launcher points at still
 * exists (moving the repository breaks exactly that one, and nothing else in
 * the system would ever mention it).
 */
export async function bridgeStatus({ manifestDir, launcherDir, socketDirPath }) {
  const manifestPath = manifestPathIn(manifestDir);
  const launcherPath = launcherPathIn(launcherDir);
  const live = await findLiveBridges(socketDirPath);
  const base = {
    ok: true,
    manifestPath,
    launcherPath,
    installed: false,
    allowedOrigins: null,
    launcherMissing: !existsSync(launcherPath),
    entryMissing: false,
    liveBridges: live.map(({ pid, origin }) => ({ pid, origin })),
  };

  if (!existsSync(manifestPath)) return base;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { ...base, installed: true, unreadableManifest: error.message };
  }

  let entryMissing = false;
  if (!base.launcherMissing) {
    const match = /^exec '([^']+)' '([^']+)'/m.exec(readFileSync(launcherPath, 'utf8'));
    entryMissing = match === null || !existsSync(match[2]);
  }

  return {
    ...base,
    installed: true,
    allowedOrigins: manifest.allowed_origins ?? null,
    entryMissing,
  };
}
