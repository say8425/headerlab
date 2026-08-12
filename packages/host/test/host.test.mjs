import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { after, test } from 'node:test';
import { decode, encode } from '../lib/framing.mjs';
import { startHost } from '../lib/host.mjs';
import { ensureSocketDir, socketPathFor } from '../lib/socket.mjs';

// This file exists because a review found the gap `bin/headerlab-host.mjs`
// itself cannot close by being tested: a mutation that deleted its
// `watchForServerErrors(server, ...)` call left the whole suite green,
// because nothing proved the BINARY wires that call — only that the helper
// works when a test calls it directly (socket.test.mjs's own
// watchForServerErrors tests). `startHost()` is what `bin/headerlab-host.mjs`
// now delegates its entire setup to, taking every I/O dependency as a
// parameter, so a test can drive it with fake streams and a fake `exit` that
// records a call instead of ending the test process — the composed thing,
// not a line in a script that node:test cannot see.

const scratch = mkdtempSync(path.join(tmpdir(), 'hl-host-test-'));
let nextId = 0;
function freshDir() {
  const dir = path.join(scratch, String(nextId++));
  return dir;
}

let nextPid = 80000;
function freshPid() {
  return nextPid++;
}

function fakeStreams() {
  return { stdin: new PassThrough(), stdout: new PassThrough() };
}

function spyLog() {
  const calls = [];
  const log = (...args) => calls.push(args);
  return { log, calls };
}

function spyExit() {
  const calls = [];
  const exit = (code) => calls.push(code);
  return { exit, calls };
}

function connectClient(socketPath) {
  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath);
    client.once('connect', () => resolve(client));
    client.once('error', reject);
  });
}

const liveServers = [];
const liveClients = [];
after(() => {
  for (const server of liveServers) server.close();
  for (const client of liveClients) client.destroy();
});

test('a post-bind server error runs cleanup and calls the injected exit — the actual wiring gap', async () => {
  const dir = freshDir();
  ensureSocketDir(dir);
  const pid = freshPid();
  const { stdin, stdout } = fakeStreams();
  const { log } = spyLog();
  const { exit, calls: exitCalls } = spyExit();

  const { server } = await startHost({
    dir,
    extensionOrigin: 'chrome-extension://host-error-test/',
    pid,
    stdin,
    stdout,
    log,
    exit,
  });
  liveServers.push(server);

  // A wrong implementation that forgot to call watchForServerErrors (or
  // that called it but with the wrong handler) would leave `exitCalls`
  // empty here — this is what a mutation deleting that one line in the
  // old bin/headerlab-host.mjs would have caught, and did not, because
  // nothing exercised the composed startup before this test existed.
  server.emit('error', new Error('simulated post-bind socket fault'));

  assert.deepEqual(exitCalls, [1]);
  assert.equal(existsSync(socketPathFor(dir, pid)), false, 'cleanup must have run, not just exit');
});

test('closed stdin runs cleanup and calls the injected exit with code 0', async () => {
  const dir = freshDir();
  ensureSocketDir(dir);
  const pid = freshPid();
  const { stdin, stdout } = fakeStreams();
  const { log } = spyLog();
  const { exit, calls: exitCalls } = spyExit();

  const { server } = await startHost({
    dir,
    extensionOrigin: 'chrome-extension://host-stdin-test/',
    pid,
    stdin,
    stdout,
    log,
    exit,
  });
  liveServers.push(server);

  stdin.end();
  // stdin is a real PassThrough, so 'end' fires asynchronously — give the
  // event loop one turn rather than asserting synchronously.
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(exitCalls, [0]);
  assert.equal(existsSync(socketPathFor(dir, pid)), false);
});

test('exit is called at most once even if a server error follows closed stdin', async () => {
  // cleanup()'s own `cleaningUp` guard is what this exercises — two
  // shutdown triggers firing in quick succession must not double-report,
  // which would be a second call the CLI or an installer could misread as
  // two separate lifecycle events.
  const dir = freshDir();
  ensureSocketDir(dir);
  const pid = freshPid();
  const { stdin, stdout } = fakeStreams();
  const { log } = spyLog();
  const { exit, calls: exitCalls } = spyExit();

  const { server } = await startHost({
    dir,
    extensionOrigin: 'chrome-extension://host-double-test/',
    pid,
    stdin,
    stdout,
    log,
    exit,
  });
  liveServers.push(server);

  stdin.end();
  await new Promise((resolve) => setImmediate(resolve));
  server.emit('error', new Error('fires after shutdown already started'));

  assert.deepEqual(exitCalls, [0]);
});

// --- data paths: the host's actual reason to exist -------------------------
//
// The three tests above cover every lifecycle path and none of the data
// paths — nothing proved a JSON line arriving on the socket becomes a framed
// message on stdout, or that a framed message on stdin reaches connected
// socket clients. Deleting the body of `relayLineToExtension`, or the
// broadcast loop it feeds on the stdin side, leaves the lifecycle suite
// above green; these are what catch it instead.

test('one JSON line from a socket client becomes one framed message on stdout', async () => {
  const dir = freshDir();
  ensureSocketDir(dir);
  const pid = freshPid();
  const { stdin, stdout } = fakeStreams();
  const { log } = spyLog();
  const { exit } = spyExit();

  const { server } = await startHost({
    dir,
    extensionOrigin: 'chrome-extension://host-relay-out-test/',
    pid,
    stdin,
    stdout,
    log,
    exit,
  });
  liveServers.push(server);

  const stdoutChunks = [];
  stdout.on('data', (chunk) => stdoutChunks.push(chunk));

  const client = await connectClient(socketPathFor(dir, pid));
  liveClients.push(client);

  client.write(`${JSON.stringify({ cmd: 'status' })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const { messages } = decode(Buffer.concat(stdoutChunks));
  assert.deepEqual(messages, [{ cmd: 'status' }]);
});

test('a framed message on stdin reaches every connected socket client as one JSON line', async () => {
  const dir = freshDir();
  ensureSocketDir(dir);
  const pid = freshPid();
  const { stdin, stdout } = fakeStreams();
  const { log } = spyLog();
  const { exit } = spyExit();

  const { server } = await startHost({
    dir,
    extensionOrigin: 'chrome-extension://host-relay-in-test/',
    pid,
    stdin,
    stdout,
    log,
    exit,
  });
  liveServers.push(server);

  const clientA = await connectClient(socketPathFor(dir, pid));
  const clientB = await connectClient(socketPathFor(dir, pid));
  liveClients.push(clientA, clientB);

  const receivedA = [];
  const receivedB = [];
  clientA.on('data', (chunk) => receivedA.push(chunk.toString('utf8')));
  clientB.on('data', (chunk) => receivedB.push(chunk.toString('utf8')));

  stdin.write(encode({ cmd: 'diagnostics' }));
  await new Promise((resolve) => setTimeout(resolve, 20));

  const expected = [`${JSON.stringify({ cmd: 'diagnostics' })}\n`];
  assert.deepEqual(receivedA, expected);
  assert.deepEqual(receivedB, expected);
});
