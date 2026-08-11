#!/usr/bin/env node
// The installer (a later task, "headerlab bridge install") rewrites this
// line to an absolute, resolved interpreter path in the copy it points a
// NativeMessagingHosts manifest at, and runs that copy once to confirm it
// actually starts before declaring the install done (design doc §8.3's
// self-verification requirement). `#!/usr/bin/env node` never resolves
// under Chrome: Chrome launches native messaging hosts in its own
// environment, which carries neither nvm nor homebrew, so `env` cannot find
// `node` and this script never executes its first line — measured, and the
// only symptom the extension ever sees is
// `{"message":"Native host has exited."}`, with an empty host log
// (docs/research/2026-08-11-native-messaging-spike.md). A machine-specific
// absolute path is not hardcoded here instead: that would break `node
// bin/headerlab-host.mjs`, `node --test packages/host`, and CI on every
// machine but the one that wrote it. The `env` form stays for those; only
// the copy Chrome actually invokes needs the rewrite.

import { unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import process from 'node:process';
import { decode, encode } from '../lib/framing.mjs';
import {
  assertSocketPathFits,
  ensureSocketDir,
  listenWithRestrictedPermissions,
  removeRegistryEntry,
  socketDir,
  socketPathFor,
  sweepStaleSockets,
  watchForServerErrors,
  writeRegistryEntry,
} from '../lib/socket.mjs';

// stdout is the native messaging protocol — anything diagnostic goes to
// stderr, or it corrupts the framing Chrome is trying to read on the other
// end of stdout.
function log(...args) {
  console.error('[headerlab-host]', ...args);
}

// Chrome gives the host exactly one argument: the requesting extension's
// origin (measured — no profile or window identifier, and two connections
// from the same profile produce byte-identical argv, which is why the
// socket path below is keyed on this process's own pid instead).
const extensionOrigin = process.argv[2] ?? null;

// All of this is synchronous and fast, and deliberately runs before any
// `await` below: cleanup() (registered further down) closes over `dir`,
// `pid` and `socketPath`, and must be safe to call the instant stdin closes
// — even if that happens while sweepStaleSockets() or the socket bind is
// still in flight.
const dir = socketDir();
ensureSocketDir(dir);
const pid = process.pid;
const socketPath = socketPathFor(dir, pid);
assertSocketPathFits(socketPath);

const clients = new Set();

const server = createServer((socket) => {
  clients.add(socket);
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let newlineAt;
    // The CLI writes one JSON command per line — newline-delimited JSON is
    // this side of the host's wire format, per the design.
    while ((newlineAt = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineAt);
      buffer = buffer.slice(newlineAt + 1);
      if (line.trim() === '') continue;
      relayLineToExtension(socket, line);
    }
  });
  socket.once('close', () => clients.delete(socket));
  socket.once('error', () => clients.delete(socket));
});

/**
 * Relays one JSON line from a socket client to the extension as one framed
 * native-messaging message on stdout. This file relays bytes and does not
 * itself know about individual commands or request/response pairing — that
 * is the CLI and protocol layer's job. A malformed line gets an error
 * written straight back to the client that sent it, rather than only a
 * server-side log line, since the client is what can act on it.
 */
function relayLineToExtension(socket, line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    socket.write(
      JSON.stringify({ ok: false, error: { message: `invalid JSON: ${error.message}` } }) + '\n',
    );
    return;
  }
  try {
    process.stdout.write(encode(message));
  } catch (error) {
    socket.write(JSON.stringify({ ok: false, error: { message: error.message } }) + '\n');
  }
}

// The extension writes framed messages on stdin. Each decoded message is
// broadcast to every connected socket client as one JSON line.
let stdinBuffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
  const { messages, rest } = decode(stdinBuffer);
  stdinBuffer = rest;
  for (const message of messages) {
    const line = `${JSON.stringify(message)}\n`;
    for (const client of clients) client.write(line);
  }
});

let cleaningUp = false;
function cleanup(exitCode) {
  if (cleaningUp) return;
  cleaningUp = true;
  server.close();
  for (const client of clients) client.destroy();
  try {
    unlinkSync(socketPath);
  } catch (error) {
    if (error.code !== 'ENOENT') log('failed to remove the socket on shutdown:', error.message);
  }
  removeRegistryEntry(dir, pid);
  process.exit(exitCode);
}

// Closed stdin is the shutdown signal (measured against Chromium's source:
// macOS waits up to two seconds for the host to exit on its own before
// SIGKILL). SIGTERM is never sent, so there is deliberately no handler for
// it here — one that never fires is not a safety net, it is a place a
// reviewer looks for shutdown logic and does not find it. Cleanup above is
// synchronous fs calls plus closing a local server, which finishes well
// under that two-second budget.
process.stdin.once('end', () => cleanup(0));
process.stdin.once('error', () => cleanup(1));

try {
  // Removes sockets a previous host left behind without cleaning up after
  // itself (a crash, or a SIGKILL past the budget above) — confirming each
  // one is dead first, so a live second host's socket can't be stolen out
  // from under it by a third host starting up.
  await sweepStaleSockets(dir);
  await listenWithRestrictedPermissions(server, socketPath);
} catch (error) {
  log('failed to start:', error.message);
  cleanup(1);
}

// A later host's startup sweep would eventually recover a socket and
// registry entry orphaned by an unhandled post-bind error, but this file's
// whole job is disciplined lifecycle handling — it should not depend on
// someone else noticing the mess it left.
watchForServerErrors(server, (error) => {
  log('socket error:', error.message);
  cleanup(1);
});

writeRegistryEntry(dir, pid, { origin: extensionOrigin, startedAt: new Date().toISOString() });
