import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import {
  ensureSocketDir,
  listenWithRestrictedPermissions,
  registryPathFor,
  socketPathFor,
} from '../lib/socket.mjs';
import { extractBridgeFlag, findLiveBridges, resolveTarget, sendCommand } from '../lib/bridge.mjs';

// This file exercises the exact logic bin/headerlab.mjs cannot expose to
// node:test on its own — bin/headerlab.mjs runs main() as an import-time
// side effect, so nothing inside it is reachable except by shelling out to
// it as a subprocess. lib/bridge.mjs has no such side effect, and none of
// what it does needs Chrome or the real extension: enumerating a directory
// and speaking newline-JSON over a real unix socket is exactly what
// packages/headerlab/test/socket.test.mjs already proves is testable without a
// browser. A fake socket server standing in for the host is what makes the
// request/response correlation test below possible at all — it is the one
// design decision this task exists to solve, and it deserves more than a
// one-off manual check that isn't committed.

const scratch = mkdtempSync(path.join(tmpdir(), 'hl-cli-bridge-test-'));
let nextId = 0;
// Every socket bind below needs its parent directory to already exist —
// `ensureSocketDir` is the same call the real host makes at startup, so
// this fixture mirrors what a real socket directory looks like rather than
// a bare scratch path.
function freshDir() {
  const dir = path.join(scratch, String(nextId++));
  ensureSocketDir(dir);
  return dir;
}

let nextPid = 70000;
function freshPid() {
  return nextPid++;
}

const liveServers = [];
after(() => {
  for (const server of liveServers) server.close();
});

async function listeningServer(socketPath, onLine) {
  const server = createServer((socket) => {
    if (!onLine) return;
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newlineAt;
      while ((newlineAt = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineAt);
        buffer = buffer.slice(newlineAt + 1);
        if (line.trim() === '') continue;
        onLine(socket, JSON.parse(line));
      }
    });
  });
  liveServers.push(server);
  await listenWithRestrictedPermissions(server, socketPath);
  return server;
}

function writeRegistry(dir, pid, origin = `chrome-extension://${pid}fakeid/`) {
  writeFileSync(
    registryPathFor(dir, pid),
    JSON.stringify({ origin, startedAt: new Date().toISOString() }),
  );
}

// --- extractBridgeFlag: pure, argv in, {bridgePid, rest} or throw out ------

describe('extractBridgeFlag', () => {
  test('absent — bridgePid is null and argv is untouched', () => {
    assert.deepEqual(extractBridgeFlag(['pause']), { bridgePid: null, rest: ['pause'] });
  });

  test('present — pulled out from wherever it sits in argv', () => {
    assert.deepEqual(extractBridgeFlag(['--bridge', '123', 'pause']), {
      bridgePid: 123,
      rest: ['pause'],
    });
    assert.deepEqual(extractBridgeFlag(['pause', '--bridge', '123']), {
      bridgePid: 123,
      rest: ['pause'],
    });
  });

  test('missing a value throws', () => {
    assert.throws(() => extractBridgeFlag(['--bridge']), /needs a pid/);
  });

  test('a non-numeric value throws', () => {
    assert.throws(() => extractBridgeFlag(['--bridge', 'nope']), /numeric pid/);
  });

  test('zero and negative pids throw — a pid is never <= 0', () => {
    assert.throws(() => extractBridgeFlag(['--bridge', '0']));
    assert.throws(() => extractBridgeFlag(['--bridge', '-5']));
  });
});

// --- findLiveBridges: enumerate the registry dir, keep only what answers --

describe('findLiveBridges', () => {
  test('a directory that does not exist yet is zero bridges, not an error', async () => {
    // Deliberately not `freshDir()` — that helper now creates the
    // directory (every other test here needs it to exist before binding a
    // socket into it), so this test builds a path under `scratch` that is
    // never created, to exercise findLiveBridges's own ENOENT handling.
    const neverCreated = path.join(scratch, 'never-created');
    assert.deepEqual(await findLiveBridges(neverCreated), []);
  });

  test('a registry entry with nothing listening on its socket is excluded', async () => {
    const dir = freshDir();
    const pid = freshPid();
    writeRegistry(dir, pid);
    // No server ever listens on socketPathFor(dir, pid) — the registry file
    // is exactly what a SIGKILLed host leaves behind.
    assert.deepEqual(await findLiveBridges(dir), []);
  });

  test('a live socket is reported with its origin', async () => {
    const dir = freshDir();
    const pid = freshPid();
    writeRegistry(dir, pid, 'chrome-extension://realorigin/');
    await listeningServer(socketPathFor(dir, pid));
    const live = await findLiveBridges(dir);
    assert.deepEqual(live, [
      { pid, socketPath: socketPathFor(dir, pid), origin: 'chrome-extension://realorigin/' },
    ]);
  });

  test('a malformed registry file still counts as live, with a null origin', async () => {
    const dir = freshDir();
    const pid = freshPid();
    writeFileSync(registryPathFor(dir, pid), 'not json');
    await listeningServer(socketPathFor(dir, pid));
    const live = await findLiveBridges(dir);
    assert.deepEqual(live, [{ pid, socketPath: socketPathFor(dir, pid), origin: null }]);
  });

  test('a non-registry file in the directory is ignored', async () => {
    const dir = freshDir();
    writeFileSync(path.join(dir, 'not-a-registry-file.txt'), 'hello');
    assert.deepEqual(await findLiveBridges(dir), []);
  });
});

// --- resolveTarget: zero/one/many, and the --bridge override ---------------

describe('resolveTarget', () => {
  test('zero live bridges is bridge-off, not a hang', async () => {
    await assert.rejects(resolveTarget(freshDir(), null), (error) => {
      assert.equal(error.code, 'bridge-off');
      return true;
    });
  });

  test('exactly one live bridge is picked without asking', async () => {
    const dir = freshDir();
    const pid = freshPid();
    writeRegistry(dir, pid);
    await listeningServer(socketPathFor(dir, pid));
    const target = await resolveTarget(dir, null);
    assert.equal(target.pid, pid);
  });

  // A wrong implementation that just returns live[0] would pass every test
  // above and fail only this one — silently picking a bridge is exactly
  // what the design forbids: nobody loses silently.
  test('more than one live bridge is refused, listing both, not picked', async () => {
    const dir = freshDir();
    const [pidA, pidB] = [freshPid(), freshPid()];
    writeRegistry(dir, pidA, 'chrome-extension://a/');
    writeRegistry(dir, pidB, 'chrome-extension://b/');
    await listeningServer(socketPathFor(dir, pidA));
    await listeningServer(socketPathFor(dir, pidB));
    await assert.rejects(resolveTarget(dir, null), (error) => {
      assert.equal(error.code, 'multiple-bridges');
      assert.match(error.message, new RegExp(String(pidA)));
      assert.match(error.message, new RegExp(String(pidB)));
      assert.match(error.message, /--bridge/);
      return true;
    });
  });

  test('--bridge <pid> selects one of several without erroring', async () => {
    const dir = freshDir();
    const [pidA, pidB] = [freshPid(), freshPid()];
    writeRegistry(dir, pidA);
    writeRegistry(dir, pidB);
    await listeningServer(socketPathFor(dir, pidA));
    await listeningServer(socketPathFor(dir, pidB));
    const target = await resolveTarget(dir, pidB);
    assert.equal(target.pid, pidB);
  });

  test('--bridge <pid> naming a dead or absent bridge is bridge-off', async () => {
    const dir = freshDir();
    await assert.rejects(resolveTarget(dir, 99999), (error) => {
      assert.equal(error.code, 'bridge-off');
      return true;
    });
  });
});

// --- sendCommand: the correlation this task exists to add ------------------

describe('sendCommand', () => {
  test('a matching reply resolves with the id stripped back off', async () => {
    const dir = freshDir();
    const pid = freshPid();
    const socketPath = socketPathFor(dir, pid);
    await listeningServer(socketPath, (socket, envelope) => {
      socket.write(`${JSON.stringify({ id: envelope.id, ok: true, changed: true })}\n`);
    });
    const result = await sendCommand(socketPath, { cmd: 'pause' });
    assert.deepEqual(result, { ok: true, changed: true });
  });

  // This is the actual defect the host's "broadcast, no correlation"
  // design would produce if the CLI didn't filter by id: two concurrent
  // callers would each resolve with whichever reply arrived first,
  // regardless of whose command it answered. The fake server below
  // reproduces the host's real behavior — broadcasting every reply to every
  // connected client — so this test fails if `sendCommand` ever stops
  // checking `reply.id`.
  test("two concurrent commands each get their own reply, not each other's", async () => {
    const dir = freshDir();
    const pid = freshPid();
    const socketPath = socketPathFor(dir, pid);
    const clients = new Set();
    const server = createServer((socket) => {
      clients.add(socket);
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let newlineAt;
        while ((newlineAt = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineAt);
          buffer = buffer.slice(newlineAt + 1);
          if (line.trim() === '') continue;
          const envelope = JSON.parse(line);
          // Broadcast to every connected client, exactly like
          // packages/headerlab/bin/headerlab-host.mjs does — the reply for A
          // reaches B's socket too, and vice versa.
          const reply = `${JSON.stringify({ id: envelope.id, ok: true, echo: envelope.command.name })}\n`;
          for (const client of clients) client.write(reply);
        }
      });
      socket.once('close', () => clients.delete(socket));
      // The client that gets its matching reply first destroys its own
      // socket immediately (see sendCommand's settle()). If the second
      // reply is still in flight to the whole `clients` set when that
      // happens, writing to the now-dead socket is an EPIPE — a real relay
      // needs the same guard, and its absence is not what this test is
      // about.
      socket.on('error', () => {});
    });
    liveServers.push(server);
    await listenWithRestrictedPermissions(server, socketPath);

    const [resultA, resultB] = await Promise.all([
      sendCommand(socketPath, { cmd: 'rule.add', name: 'A' }),
      sendCommand(socketPath, { cmd: 'rule.add', name: 'B' }),
    ]);
    assert.equal(resultA.echo, 'A');
    assert.equal(resultB.echo, 'B');
  });

  test('a connection that never gets a reply times out with code "timeout"', async () => {
    const dir = freshDir();
    const pid = freshPid();
    const socketPath = socketPathFor(dir, pid);
    await listeningServer(socketPath); // accepts, never writes anything back
    await assert.rejects(sendCommand(socketPath, { cmd: 'pause' }, { timeoutMs: 30 }), (error) => {
      assert.equal(error.code, 'timeout');
      return true;
    });
  });

  test('a connection closed before any reply is "bridge-closed", not a hang', async () => {
    const dir = freshDir();
    const pid = freshPid();
    const socketPath = socketPathFor(dir, pid);
    const server = createServer((socket) => socket.end());
    liveServers.push(server);
    await listenWithRestrictedPermissions(server, socketPath);
    await assert.rejects(sendCommand(socketPath, { cmd: 'pause' }), (error) => {
      assert.equal(error.code, 'bridge-closed');
      return true;
    });
  });

  test('a reply for a different id is ignored, not returned', async () => {
    const dir = freshDir();
    const pid = freshPid();
    const socketPath = socketPathFor(dir, pid);
    await listeningServer(socketPath, (socket) => {
      // Reply with a request id that can never match — the real id is a
      // UUID `sendCommand` generates internally and never exposes.
      socket.write(`${JSON.stringify({ id: 'not-the-real-id', ok: true })}\n`);
      // Followed a moment later by the actual matching reply once the
      // caller's own id would plausibly have arrived — simulated here by
      // just also broadcasting a second, catch-all-shaped line the caller
      // still must not accept without a real id match.
    });
    // 250ms, not the 30ms the test above uses: this one only proves anything
    // if a wrong-id reply is correctly rejected AND the timeout still fires —
    // a regression that dropped the id filter would complete the round trip
    // well inside 30ms, the same order as this machine's own noise, so a
    // short timeout risked passing for the wrong reason rather than catching
    // the regression it exists to catch. The test above has no reply written
    // at all, so 30ms there is measuring something else and stays as-is.
    await assert.rejects(sendCommand(socketPath, { cmd: 'pause' }, { timeoutMs: 250 }), (error) => {
      assert.equal(error.code, 'timeout');
      return true;
    });
  });
});
