import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * macOS's usable `sun_path` length, measured rather than guessed: binding a
 * socket at a 104-byte path succeeds, 105 fails with EINVAL (see
 * docs/research/2026-08-11-native-messaging-spike.md). Not 100, not 108 —
 * those are numbers other systems use.
 */
export const SUN_PATH_MAX = 104;

/**
 * Fails loudly, with both numbers, before the opaque EINVAL from bind()
 * does it three processes away from whoever can read this message.
 */
export function assertSocketPathFits(socketPath) {
  const length = Buffer.byteLength(socketPath, 'utf8');
  if (length > SUN_PATH_MAX) {
    throw new Error(
      `socket path is ${length} bytes but the kernel's sun_path holds at most ` +
        `${SUN_PATH_MAX}: ${socketPath}`,
    );
  }
}

/**
 * The socket carries the host's own pid in its name. Chrome hands every host
 * process byte-identical argv (measured — two connections from the same
 * profile produce two hosts with no way to tell them apart from argv alone),
 * so the pid is the only thing that keeps two live hosts from colliding. No
 * host claims a well-known name instead — that would leave "what does the
 * second host do" unanswered.
 */
export function socketPathFor(dir, pid) {
  return path.join(dir, `bridge-${pid}.sock`);
}

/** The registry entry (extension origin, start time) lives beside its socket. */
export function registryPathFor(dir, pid) {
  return path.join(dir, `${pid}.json`);
}

const BRIDGE_SOCKET_NAME = /^bridge-(\d+)\.sock$/;

/**
 * Unlinking a file that is already gone is success, not an error — this is
 * how a filesystem race between two hosts sweeping the same dead entry is
 * supposed to resolve (see `removeStaleSocket` and `removeRegistryEntry`),
 * not a state either caller should have to special-case for itself.
 */
function unlinkIfExists(targetPath) {
  try {
    unlinkSync(targetPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

/**
 * Resolves the per-user socket directory.
 *
 * `getconf DARWIN_USER_TEMP_DIR` asks the OS directly rather than trusting
 * either inherited copy of `$TMPDIR` — the host inherits Chrome's
 * environment and the CLI inherits the terminal's, so if those two ever
 * disagree the two halves would silently look in different directories with
 * nothing failing to show it.
 *
 * Falls back to `os.tmpdir()` when `getconf` is unavailable (not Darwin, or
 * the binary is missing) — that fallback IS the case where the two halves
 * can diverge, since it reads whichever `$TMPDIR` each process happened to
 * be launched with.
 */
export function socketDir() {
  let base = '';
  try {
    base = execFileSync('getconf', ['DARWIN_USER_TEMP_DIR'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // getconf missing or the key unknown — fall through to the
    // environment-inherited, divergence-prone fallback below.
  }
  if (!base) base = tmpdir();
  return path.join(base, 'headerlab');
}

/**
 * Creates the socket directory at 0700, or tightens it to 0700 if it
 * already exists with looser permissions. `mkdirSync`'s `mode` option is
 * masked by umask and is never applied to a directory that already exists,
 * so the explicit chmod is the only part of this that is not optional.
 */
export function ensureSocketDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

/**
 * Node leaves a listening unix socket world-connectable — measured: mode
 * 0755 under the ambient umask 022, and macOS enforces socket permissions on
 * connect. There is no `listen()` option for this.
 *
 * umask 077 for the duration of the call narrows that, but not all the way
 * to 0600 — measured: Node's default socket-creation mode is evidently 0777
 * (mirroring the 0755-under-022 figure above), so umask 077 leaves an extra
 * owner-execute bit and the file lands at 0700, not 0600. That is
 * functionally identical for who can connect (group and other still have
 * nothing), but it is not the number the design promises, so an explicit
 * chmod pins the exact value afterward rather than leaving it to whatever
 * the platform's socket-creation default happens to be. The umask is kept
 * anyway, as the narrower of the two during the brief window between
 * bind() creating the file and this chmod running.
 */
export function listenWithRestrictedPermissions(server, socketPath) {
  return new Promise((resolve, reject) => {
    const restoreUmask = process.umask(0o077);
    function onError(error) {
      process.umask(restoreUmask);
      server.removeListener('error', onError);
      reject(error);
    }
    server.once('error', onError);
    server.listen(socketPath, () => {
      process.umask(restoreUmask);
      server.removeListener('error', onError);
      chmodSync(socketPath, 0o600);
      resolve();
    });
  });
}

/**
 * Wires a permanent handler for 'error' events on an already-listening
 * server. `listenWithRestrictedPermissions` only guards the bind itself and
 * removes its own listener the instant that succeeds, so without this,
 * Node's default behavior for an unhandled 'error' event on an
 * EventEmitter — crashing the process outright — applies to anything that
 * goes wrong afterward (EMFILE, a socket-level fault), skipping whatever
 * cleanup the caller would otherwise run. Split out from the caller so the
 * wiring itself is a unit a real `net.Server` can exercise directly (an
 * emitted 'error' reaching the handler), rather than something only provable
 * by forcing a genuine OS-level fault into a live process from outside it.
 */
export function watchForServerErrors(server, onError) {
  server.on('error', onError);
}

/**
 * Probes whether something is listening on `socketPath` without disturbing
 * it: connect, then immediately close. Resolves `false` for both "nothing
 * there" and "the file exists but nothing answers" — exactly the state a
 * crashed host leaves behind. A socket accepts near-instantly or fails
 * near-instantly, but the short timeout is cheap insurance against a
 * pathological file hanging startup.
 */
export function isSocketAlive(socketPath) {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const settle = (alive) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(500, () => settle(false));
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
  });
}

/**
 * Removes a socket file and its registry entry, but only after confirming
 * nothing is listening on it — otherwise a third host starting up could
 * steal a live second host's socket out from under it. Returns whether
 * anything was actually removed.
 *
 * The liveness check and the unlink are not atomic, so two hosts starting
 * near-simultaneously (plausible after a crash, if Chrome spawns a burst)
 * can both see the same dead socket, both pass the check, and both reach
 * the unlink — the loser would otherwise get ENOENT for a file its own
 * check had just confirmed was there. That must not be an error here: it
 * would propagate out of `sweepStaleSockets` and kill a perfectly healthy
 * starting host over a race to clean up someone else's junk.
 */
export async function removeStaleSocket(dir, pid) {
  const socketPath = socketPathFor(dir, pid);
  if (!existsSync(socketPath)) return false;
  if (await isSocketAlive(socketPath)) return false;
  unlinkIfExists(socketPath);
  removeRegistryEntry(dir, pid);
  return true;
}

/**
 * Sweeps the socket directory at startup for sockets a previous host left
 * behind without cleaning up after itself — a crash, or a SIGKILL after the
 * two-second grace period Chrome gives a host to exit on closed stdin.
 * Confirms each one is dead before touching it, for the same reason
 * `removeStaleSocket` does. Returns the pids it removed.
 */
export async function sweepStaleSockets(dir) {
  if (!existsSync(dir)) return [];
  const removed = [];
  for (const name of readdirSync(dir)) {
    const match = BRIDGE_SOCKET_NAME.exec(name);
    if (!match) continue;
    const pid = Number(match[1]);
    if (await removeStaleSocket(dir, pid)) removed.push(pid);
  }
  return removed;
}

/**
 * Writes the registry entry a CLI enumerates to find live hosts. Mode 0600
 * for the same reason the socket itself is — it names the extension origin
 * this host is bridging for.
 */
export function writeRegistryEntry(dir, pid, { origin, startedAt }) {
  writeFileSync(registryPathFor(dir, pid), JSON.stringify({ origin, startedAt }), {
    mode: 0o600,
  });
}

/**
 * Idempotent: removing an already-absent entry is not an error. Goes
 * straight to unlinkIfExists rather than an existsSync-then-unlink pair —
 * that pair has the identical race `removeStaleSocket` documents, one level
 * down, since two hosts can call this for the same pid concurrently.
 */
export function removeRegistryEntry(dir, pid) {
  unlinkIfExists(registryPathFor(dir, pid));
}
