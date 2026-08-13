import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { registryPathFor, socketDir, socketPathFor } from '../lib/socket.mjs';

// Integration coverage for the two claims socket.test.mjs cannot make on its
// own, because they are about the assembled binary's process lifecycle
// rather than about any one function: "closed stdin is the shutdown signal"
// and "cleanup completes well under two seconds." Everything below drives
// the real, unmodified bin/headerlab-host.mjs as a child process — nothing
// here is a stub standing in for it.
const hostPath = fileURLToPath(new URL('../bin/headerlab-host.mjs', import.meta.url));

// This is the real, machine-wide directory the binary itself resolves via
// socketDir() — reused rather than duplicated so the test can't drift from
// what the binary actually does.
const dir = socketDir();

const liveChildren = new Set();
after(() => {
  // Belt-and-suspenders: if an assertion above throws mid-test, the child
  // must not be left running or orphaning a socket for a later test run.
  for (const child of liveChildren) child.kill('SIGKILL');
});

function spawnHost(extensionOrigin) {
  const child = spawn(process.execPath, [hostPath, extensionOrigin], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  liveChildren.add(child);
  child.once('exit', () => liveChildren.delete(child));
  return child;
}

/** Polls for the socket file rather than sleeping a fixed guess. */
async function waitForSocket(socketPath, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(socketPath)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`socket never appeared at ${socketPath} within ${timeoutMs}ms`);
}

test(
  'closed stdin shuts the host down, well under the two-second SIGKILL budget, with everything cleaned up',
  { timeout: 10_000 },
  async () => {
    const origin = 'chrome-extension://integration-test-origin/';
    const child = spawnHost(origin);

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    const socketPath = socketPathFor(dir, child.pid);
    const registryPath = registryPathFor(dir, child.pid);

    await waitForSocket(socketPath);

    // The registry entry is the other half of startup — written only after
    // the bind succeeds, so its presence here is itself evidence the host
    // reached a fully-started state rather than just having created the
    // socket file mid-bind.
    assert.equal(existsSync(registryPath), true);
    assert.equal(JSON.parse(readFileSync(registryPath, 'utf8')).origin, origin);

    // The shutdown signal. Chrome never sends SIGTERM (see the comment in
    // bin/headerlab-host.mjs) — this is the only mechanism that exists.
    const closedStdinAt = Date.now();
    child.stdin.end();

    const exitCode = await new Promise((resolve, reject) => {
      child.once('exit', (code) => resolve(code));
      child.once('error', reject);
    });
    const elapsedMs = Date.now() - closedStdinAt;

    assert.equal(exitCode, 0);
    // Chromium waits up to 2000ms before SIGKILL. A wrong implementation
    // that never wires up the 'end' handler would hang until this test's
    // own 10s timeout instead of exiting here at all, and one that does
    // something slow on the way out (a blocking write, a retry loop) would
    // land close to the 2000ms ceiling rather than comfortably under it.
    assert.ok(
      elapsedMs < 1500,
      `cleanup took ${elapsedMs}ms, expected well under the 2000ms SIGKILL budget`,
    );

    assert.equal(existsSync(socketPath), false, 'the socket file must be gone after shutdown');
    assert.equal(existsSync(registryPath), false, 'the registry entry must be gone after shutdown');
    assert.equal(stderr, '', `expected no stderr on a clean shutdown, got: ${stderr}`);
  },
);

// The other lifecycle claim from this fix round — a post-bind server error
// must still reach cleanup() rather than crashing the process outright — is
// NOT re-tested here. Forcing a genuine post-bind fault (EMFILE, a real
// socket-level error) into this child process from outside it is not
// practical, and a test that merely closes stdin again and asserts the same
// clean exit as the test above would pass identically whether or not the
// permanent error handler exists — an assertion that cannot fail is worse
// than no assertion, so it is not here. That wiring is unit-tested instead,
// where a real net.Server can be handed a genuinely emitted 'error' event:
// see 'watchForServerErrors routes a post-bind server error to the given
// handler' in socket.test.mjs.
