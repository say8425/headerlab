import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MAX_OUTGOING } from '../../host/lib/framing.mjs';
import {
  ensureSocketDir,
  listenWithRestrictedPermissions,
  registryPathFor,
  socketDir,
  socketPathFor,
  writeRegistryEntry,
} from '../../host/lib/socket.mjs';

// bin/headerlab.mjs runs main() as a side effect of being imported — the
// same reason bin/headerlab-host.mjs needed a subprocess-level test in the
// last round. resolveStateCommand's three failure branches and main()'s
// argv-to-exit-code wiring are covered by nothing else: lib/args.mjs and
// lib/bridge.mjs are tested directly (args.test.mjs, bridge.test.mjs), but
// resolveStateCommand and main() itself live only in this file, and nothing
// in this package can reach them except by spawning the real binary and
// reading its stdout and exit code.
const cliPath = fileURLToPath(new URL('../bin/headerlab.mjs', import.meta.url));

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
    child.once('error', reject);
    // None of this file's commands read stdin (`state set -` is the only
    // one that does, and no test here uses it) — closed regardless so a
    // wrong implementation that unexpectedly waits on stdin fails fast
    // instead of hanging the test.
    child.stdin.end();
  });
}

const scratch = mkdtempSync(path.join(tmpdir(), 'hl-cli-bin-test-'));

// --- resolveStateCommand's three failure branches ---------------------------

test('state set on a file that cannot be read fails with invalid-command, not a crash', async () => {
  const missing = path.join(scratch, 'does-not-exist.json');
  const { code, stdout } = await runCli(['state', 'set', missing]);
  const result = JSON.parse(stdout);
  assert.equal(code, 1);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid-command');
  assert.match(result.error.message, /could not read/);
});

test('state set refuses a payload over the bridge byte cap before ever touching the socket', async () => {
  const bigFile = path.join(scratch, 'too-big.json');
  writeFileSync(bigFile, 'x'.repeat(MAX_OUTGOING + 1));
  const { code, stdout } = await runCli(['state', 'set', bigFile]);
  const result = JSON.parse(stdout);
  assert.equal(code, 1);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid-command');
  assert.match(result.error.message, new RegExp(String(MAX_OUTGOING)));
});

test('state set on invalid JSON fails with invalid-command, naming the problem', async () => {
  const badFile = path.join(scratch, 'bad.json');
  writeFileSync(badFile, 'not json{');
  const { code, stdout } = await runCli(['state', 'set', badFile]);
  const result = JSON.parse(stdout);
  assert.equal(code, 1);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid-command');
  assert.match(result.error.message, /not valid JSON/);
});

// --- main()'s argv-to-exit-code wiring --------------------------------------

test("an unparseable command fails with the parser's own code, before any bridge lookup", async () => {
  const { code, stdout } = await runCli(['teleport']);
  const result = JSON.parse(stdout);
  assert.equal(code, 1);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'unknown-command');
});

// `--bridge <pid>` naming a pid that cannot exist is contamination-proof
// against whatever else this machine's real $TMPDIR/headerlab happens to
// hold at the moment the test runs (a concurrently-running package's own
// integration test, a real bridge left over from manual testing) — unlike
// asserting "no bridge is running at all" against that same shared,
// unparameterized directory, which bin/headerlab.mjs's main() resolves via
// socketDir() with no way to inject a scratch path instead.
test('a valid command naming a bridge that does not exist fails with bridge-off, not a hang', async () => {
  const impossiblePid = 100000 + Math.floor(Math.random() * 900000);
  const { code, stdout } = await runCli(['--bridge', String(impossiblePid), 'pause']);
  const result = JSON.parse(stdout);
  assert.equal(code, 1);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'bridge-off');
});

// --- one success path, end to end through the real socketDir() -------------

const cleanupTargets = [];
after(() => {
  for (const { server, socketPath, registryPath } of cleanupTargets) {
    server.close();
    for (const p of [socketPath, registryPath]) {
      try {
        unlinkSync(p);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
});

/** A minimal fake host: newline-JSON in, one reply out, id echoed back. */
async function fakeHost(socketPath, reply) {
  const server = createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newlineAt;
      while ((newlineAt = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineAt);
        buffer = buffer.slice(newlineAt + 1);
        if (!line.trim()) continue;
        const envelope = JSON.parse(line);
        socket.write(`${JSON.stringify({ id: envelope.id, ...reply(envelope.command) })}\n`);
      }
    });
  });
  await listenWithRestrictedPermissions(server, socketPath);
  return server;
}

test('a live bridge replies successfully end to end', async () => {
  // Uses the real socketDir() deliberately — this is the directory
  // bin/headerlab.mjs's main() actually resolves, unparameterized, so a
  // genuine end-to-end success path has no scratch-directory substitute.
  const dir = socketDir();
  ensureSocketDir(dir);
  const pid = 100000 + Math.floor(Math.random() * 900000);
  const socketPath = socketPathFor(dir, pid);
  const registryPath = registryPathFor(dir, pid);
  writeRegistryEntry(dir, pid, {
    origin: 'chrome-extension://cli-integration-test/',
    startedAt: new Date().toISOString(),
  });

  const server = await fakeHost(socketPath, (command) => ({ ok: true, echoedCmd: command.cmd }));
  cleanupTargets.push({ server, socketPath, registryPath });

  const { code, stdout } = await runCli(['--bridge', String(pid), 'pause']);
  const result = JSON.parse(stdout);

  assert.equal(code, 0);
  assert.deepEqual(result, { ok: true, echoedCmd: 'pause' });
  assert.equal(
    existsSync(socketPath),
    true,
    'the fake host is still up; only this test tore it down',
  );
});
