import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';
import {
  SUN_PATH_MAX,
  assertSocketPathFits,
  ensureSocketDir,
  isSocketAlive,
  listenWithRestrictedPermissions,
  registryPathFor,
  removeRegistryEntry,
  removeStaleSocket,
  socketDir,
  socketPathFor,
  sweepStaleSockets,
  watchForServerErrors,
  writeRegistryEntry,
} from '../lib/socket.mjs';

// One scratch directory per run, cleaned up implicitly by the OS — nothing
// here needs a temp-file cleanup step of its own, only short paths, since
// every socket bind is bounded by SUN_PATH_MAX.
const scratch = mkdtempSync(path.join(tmpdir(), 'hl-socket-test-'));
let nextId = 0;
function freshDir() {
  const dir = path.join(scratch, String(nextId++));
  return dir;
}

// Real pids are numeric, and the sweep's directory scan matches
// `bridge-<digits>.sock` specifically — a string-suffixed fixture id would
// silently miss that regex and pass for the wrong reason. One counter here
// stands in for "the next pid", unique across the whole file.
let nextPid = 90000;
function freshPid() {
  return nextPid++;
}

const liveServers = [];
after(() => {
  for (const server of liveServers) server.close();
});

async function listeningServer(socketPath) {
  const server = createServer();
  liveServers.push(server);
  await listenWithRestrictedPermissions(server, socketPath);
  return server;
}

// --- pure: sun_path length ------------------------------------------------

test('the sun_path limit is the measured 104, not a guess', () => {
  assert.equal(SUN_PATH_MAX, 104);
});

test('a path at the limit is accepted', () => {
  assertSocketPathFits('/'.padEnd(SUN_PATH_MAX, 'a'));
});

// EINVAL from bind() is opaque. Failing with the number is what makes it
// diagnosable three processes away.
test('a path over the limit fails with both numbers', () => {
  const tooLong = '/'.padEnd(SUN_PATH_MAX + 1, 'a');
  assert.throws(
    () => assertSocketPathFits(tooLong),
    (error) => {
      assert.match(error.message, new RegExp(String(SUN_PATH_MAX)));
      assert.match(error.message, new RegExp(String(tooLong.length)));
      return true;
    },
  );
});

// --- pure: path assembly ---------------------------------------------------

test('the socket path carries the pid, so two hosts never collide', () => {
  assert.notEqual(socketPathFor('/tmp/hl', 111), socketPathFor('/tmp/hl', 222));
  assert.match(socketPathFor('/tmp/hl', 111), /111/);
});

test('the socket name is exactly bridge-<pid>.sock, per the design decision', () => {
  assert.equal(socketPathFor('/tmp/hl', 42), '/tmp/hl/bridge-42.sock');
});

test('the registry entry sits beside the socket as <pid>.json', () => {
  assert.equal(registryPathFor('/tmp/hl', 42), '/tmp/hl/42.json');
  assert.notEqual(registryPathFor('/tmp/hl', 1), registryPathFor('/tmp/hl', 2));
});

// --- filesystem: directory resolution and permissions -----------------------

test('socketDir returns an absolute path under a headerlab subdirectory', () => {
  const dir = socketDir();
  assert.ok(path.isAbsolute(dir));
  assert.equal(path.basename(dir), 'headerlab');
});

test('socketDir is stable across calls (same process, same answer)', () => {
  assert.equal(socketDir(), socketDir());
});

// The installer's self-verification (packages/headerlab/lib/install.mjs) spawns a
// real host and must not let it bind into the developer's own per-user
// directory, where a concurrent `headerlab` command would find it and
// mistake it for a live bridge. This is what makes that isolation possible —
// and it must fail an "always return the override" implementation just as
// surely as it fails an "ignore the override" one, so this and the test
// below are paired.
test('HEADERLAB_SOCKET_DIR overrides socketDir(), returned exactly as given', () => {
  const previous = process.env.HEADERLAB_SOCKET_DIR;
  process.env.HEADERLAB_SOCKET_DIR = '/scratch/wherever';
  try {
    // Not joined with 'headerlab' — the caller already named the full
    // directory, and joining would silently relocate it one level down.
    assert.equal(socketDir(), '/scratch/wherever');
  } finally {
    if (previous === undefined) delete process.env.HEADERLAB_SOCKET_DIR;
    else process.env.HEADERLAB_SOCKET_DIR = previous;
  }
});

// Absence must leave the ordinary computed path intact. An implementation
// that always returns the override — regardless of whether it was set —
// would pass the test above and fail only this one.
test('without HEADERLAB_SOCKET_DIR, socketDir() falls back to its normal computed path', () => {
  const previous = process.env.HEADERLAB_SOCKET_DIR;
  delete process.env.HEADERLAB_SOCKET_DIR;
  try {
    const dir = socketDir();
    assert.ok(path.isAbsolute(dir));
    assert.equal(path.basename(dir), 'headerlab');
  } finally {
    if (previous !== undefined) process.env.HEADERLAB_SOCKET_DIR = previous;
  }
});

test('ensureSocketDir creates a fresh directory at exactly 0700', () => {
  const dir = freshDir();
  ensureSocketDir(dir);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
});

// What a wrong implementation would let through: forgetting the chmod and
// relying on mkdirSync's `mode`, which is masked by umask and, per Node's
// own docs, is silently skipped entirely on a directory that already
// exists. This plants that exact failure mode before calling ensureSocketDir.
test('ensureSocketDir tightens an already-existing directory to 0700', () => {
  const dir = freshDir();
  mkdirSyncLoose(dir);
  assert.notEqual(statSync(dir).mode & 0o777, 0o700, 'the fixture must start looser than 0700');
  ensureSocketDir(dir);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
});

function mkdirSyncLoose(dir) {
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, 0o755);
}

test('listening restricts the socket to 0600, not the 0755 Node leaves by default', async () => {
  const dir = freshDir();
  ensureSocketDir(dir);
  const socketPath = socketPathFor(dir, freshPid());
  await listeningServer(socketPath);
  assert.equal(statSync(socketPath).mode & 0o777, 0o600);
});

// --- error wiring -------------------------------------------------------

// listenWithRestrictedPermissions removes its own error listener the moment
// the bind succeeds, so nothing protects the process from an unhandled
// 'error' event afterward without this. A genuine post-bind fault (EMFILE,
// a socket-level error) is impractical to force into a live process from
// outside it, so this exercises the wiring directly: a real net.Server, a
// real emitted 'error' event, and an assertion that the handler this
// function installs actually receives it — the part that is provable
// without an OS-level fault, and the part the review found missing.
test('watchForServerErrors routes a post-bind server error to the given handler', async () => {
  const dir = freshDir();
  ensureSocketDir(dir);
  const socketPath = socketPathFor(dir, freshPid());
  const server = await listeningServer(socketPath);

  const received = [];
  watchForServerErrors(server, (error) => received.push(error));

  const fault = new Error('simulated post-bind socket fault');
  server.emit('error', fault);

  assert.deepEqual(received, [fault]);
});

// What a wrong implementation would let through: reacting to the FIRST
// error only, or wiring a `.once` instead of `.on` — this is meant to be a
// permanent handler, since the process must survive for as long as the
// host runs, not just past the first fault.
test('watchForServerErrors keeps handling errors after the first one', async () => {
  const dir = freshDir();
  ensureSocketDir(dir);
  const socketPath = socketPathFor(dir, freshPid());
  const server = await listeningServer(socketPath);

  const received = [];
  watchForServerErrors(server, (error) => received.push(error));

  server.emit('error', new Error('first'));
  server.emit('error', new Error('second'));

  assert.deepEqual(
    received.map((e) => e.message),
    ['first', 'second'],
  );
});

// --- filesystem: liveness probing -------------------------------------------

test('isSocketAlive is true while a server is listening', async () => {
  const dir = freshDir();
  ensureSocketDir(dir);
  const socketPath = socketPathFor(dir, freshPid());
  await listeningServer(socketPath);
  assert.equal(await isSocketAlive(socketPath), true);
});

test('isSocketAlive is false when nothing is at the path', async () => {
  const dir = freshDir();
  ensureSocketDir(dir);
  const socketPath = socketPathFor(dir, freshPid());
  assert.equal(await isSocketAlive(socketPath), false);
});

test('isSocketAlive is false for a leftover file nothing is listening on', async () => {
  // Simulates what a crashed host leaves behind: a filesystem entry at the
  // socket path with no process answering on it.
  const dir = freshDir();
  ensureSocketDir(dir);
  const socketPath = socketPathFor(dir, freshPid());
  writeFileSync(socketPath, '');
  assert.equal(await isSocketAlive(socketPath), false);
});

// --- filesystem: stale socket removal ---------------------------------------

test('removeStaleSocket removes a dead socket and its registry entry', async () => {
  const dir = freshDir();
  ensureSocketDir(dir);
  const pid = freshPid();
  writeFileSync(socketPathFor(dir, pid), '');
  writeRegistryEntry(dir, pid, { origin: 'chrome-extension://x/', startedAt: 'now' });

  const removed = await removeStaleSocket(dir, pid);

  assert.equal(removed, true);
  assert.equal(existsSync(socketPathFor(dir, pid)), false);
  assert.equal(existsSync(registryPathFor(dir, pid)), false);
});

// The one case this whole function exists to prevent: a live second host's
// socket must survive a third host's startup sweep.
test('removeStaleSocket leaves a live socket alone', async () => {
  const dir = freshDir();
  ensureSocketDir(dir);
  const pid = freshPid();
  const socketPath = socketPathFor(dir, pid);
  await listeningServer(socketPath);

  const removed = await removeStaleSocket(dir, pid);

  assert.equal(removed, false);
  assert.equal(existsSync(socketPath), true);
});

test('removeStaleSocket is a no-op when nothing is there', async () => {
  const dir = freshDir();
  ensureSocketDir(dir);
  assert.equal(await removeStaleSocket(dir, freshPid()), false);
});

// The race the review found: two hosts starting near-simultaneously (a
// crash burst is a plausible trigger) can both pass the liveness check on
// the same dead socket and both reach the unlink. Calling removeStaleSocket
// twice concurrently on one dead socket reproduces exactly that — one call
// wins the unlink, the other's own existsSync() had already returned true,
// so without ENOENT-tolerance its unlink throws. The no-op test above does
// NOT cover this: it calls removeStaleSocket where nothing was ever there,
// which returns at the earlier `!existsSync` guard and never reaches the
// unlink line this test is actually about — mutation-verified: reverting
// the fix to a bare unlinkSync leaves that test green and only this one
// catches it.
test('removeStaleSocket does not throw when two calls race to remove the same dead socket', async () => {
  const dir = freshDir();
  ensureSocketDir(dir);
  const pid = freshPid();
  writeFileSync(socketPathFor(dir, pid), '');

  const results = await Promise.all([removeStaleSocket(dir, pid), removeStaleSocket(dir, pid)]);

  assert.equal(existsSync(socketPathFor(dir, pid)), false);
  // Both calls report `true`, not just "at least one" — removeStaleSocket
  // does not distinguish "I actually removed it" from "it was already gone
  // by the time I got past the liveness check", so the loser also reaches
  // its own unlinkIfExists/removeRegistryEntry calls and returns `true`
  // same as the winner. `deepEqual([true, true])` says what is actually
  // guaranteed here; `results.includes(true)` would also pass if a bug made
  // the loser wrongly report `false`.
  assert.deepEqual(results, [true, true]);
});

test('sweepStaleSockets removes only the dead entries, and reports their pids', async () => {
  const dir = freshDir();
  ensureSocketDir(dir);

  const deadPid = freshPid();
  writeFileSync(socketPathFor(dir, deadPid), '');
  writeRegistryEntry(dir, deadPid, { origin: 'chrome-extension://x/', startedAt: 'now' });

  const livePid = freshPid();
  const liveSocketPath = socketPathFor(dir, livePid);
  await listeningServer(liveSocketPath);

  // A file that is not a bridge socket at all must never be touched.
  writeFileSync(path.join(dir, 'not-a-bridge-socket.txt'), 'hello');

  const removed = await sweepStaleSockets(dir);

  assert.deepEqual(removed, [deadPid]);
  assert.equal(existsSync(socketPathFor(dir, deadPid)), false);
  assert.equal(existsSync(liveSocketPath), true);
  assert.equal(existsSync(path.join(dir, 'not-a-bridge-socket.txt')), true);
});

test('sweepStaleSockets on a directory that does not exist yet returns nothing', async () => {
  const dir = freshDir(); // never created
  assert.deepEqual(await sweepStaleSockets(dir), []);
});

// --- filesystem: registry ----------------------------------------------------

test('writeRegistryEntry writes the origin and start time at mode 0600', () => {
  const dir = freshDir();
  ensureSocketDir(dir);
  const pid = freshPid();
  writeRegistryEntry(dir, pid, {
    origin: 'chrome-extension://abc/',
    startedAt: '2026-08-12T00:00:00.000Z',
  });

  const registryPath = registryPathFor(dir, pid);
  assert.equal(statSync(registryPath).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(registryPath, 'utf8')), {
    origin: 'chrome-extension://abc/',
    startedAt: '2026-08-12T00:00:00.000Z',
  });
});

test('removeRegistryEntry deletes an existing entry', () => {
  const dir = freshDir();
  ensureSocketDir(dir);
  const pid = freshPid();
  writeRegistryEntry(dir, pid, { origin: 'chrome-extension://x/', startedAt: 'now' });
  removeRegistryEntry(dir, pid);
  assert.equal(existsSync(registryPathFor(dir, pid)), false);
});

test('removeRegistryEntry is idempotent when there is nothing to remove', () => {
  const dir = freshDir();
  ensureSocketDir(dir);
  assert.doesNotThrow(() => removeRegistryEntry(dir, freshPid()));
});
