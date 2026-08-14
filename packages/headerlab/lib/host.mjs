import { unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { decode, encode } from './framing.mjs';
import {
  assertSocketPathFits,
  ensureSocketDir,
  listenWithRestrictedPermissions,
  removeRegistryEntry,
  socketPathFor,
  sweepStaleSockets,
  watchForServerErrors,
  writeRegistryEntry,
} from './socket.mjs';

/**
 * Assembles the whole native host: binds the socket, relays stdio ↔ socket
 * clients, and wires the two ways this process is meant to end — closed
 * stdin, and a post-bind server fault — to the same cleanup.
 *
 * Every I/O dependency is a parameter rather than this module reaching for
 * `process.*` itself, the same reason `packages/headerlab/lib/bridge.mjs` takes a
 * directory rather than calling `socketDir()`: `bin/headerlab-host.mjs` runs
 * this as a side effect of being imported (it has to — Chrome execs it
 * directly), so nothing inside a bin file is ever reachable from
 * `node:test`. Everything worth testing has to live here instead, callable
 * with fake streams and a fake `exit` that records a call instead of ending
 * the test process.
 *
 * This split exists specifically because a review found the opposite gap:
 * `bin/headerlab-host.mjs` used to wire `watchForServerErrors` inline, and a
 * mutation that deleted that one line left the whole suite green — nothing
 * proved the binary actually called it, only that the helper worked in
 * isolation when a test called it directly. Returning `{ server, cleanup }`
 * is what lets a test close that gap: emit a synthetic 'error' on the real
 * `server` this function wired up, and assert the injected `exit` fired.
 */
export async function startHost({ dir, extensionOrigin, pid, stdin, stdout, log, exit }) {
  ensureSocketDir(dir);
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
   * Relays one JSON line from a socket client to the extension as one
   * framed native-messaging message on stdout. This file relays bytes and
   * does not itself know about individual commands or request/response
   * pairing — that is the CLI and protocol layer's job. A malformed line
   * gets an error written straight back to the client that sent it, rather
   * than only a server-side log line, since the client is what can act on
   * it.
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
      stdout.write(encode(message));
    } catch (error) {
      socket.write(JSON.stringify({ ok: false, error: { message: error.message } }) + '\n');
    }
  }

  // The extension writes framed messages on stdin. Each decoded message is
  // broadcast to every connected socket client as one JSON line.
  let stdinBuffer = Buffer.alloc(0);
  stdin.on('data', (chunk) => {
    stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
    let messages, rest;
    try {
      ({ messages, rest } = decode(stdinBuffer));
    } catch (error) {
      // A malformed frame — corrupt JSON inside an otherwise well-framed
      // message, or a declared length over framing.mjs's MAX_INCOMING —
      // must not reach an uncaught exception here. `decode()` runs inside
      // this 'data' handler with no promise or callback between it and
      // Node's event loop, so an uncaught throw here crashes the whole
      // process before `cleanup()` ever runs, orphaning the socket and
      // registry entry exactly like the gap this module's own docblock
      // describes for a post-bind server fault. `relayLineToExtension`
      // already treats the outbound direction's JSON.parse failure this
      // way; this is the same discipline for the inbound one. The buffered
      // bytes are dropped rather than salvaged, since a boundary `decode()`
      // itself rejected is not one this handler can trust either.
      log('malformed frame from stdin:', error.message);
      stdinBuffer = Buffer.alloc(0);
      return;
    }
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
    exit(exitCode);
  }

  // Closed stdin is the shutdown signal (measured against Chromium's
  // source: macOS waits up to two seconds for the host to exit on its own
  // before SIGKILL). SIGTERM is never sent, so there is deliberately no
  // handler for it here — one that never fires is not a safety net, it is a
  // place a reviewer looks for shutdown logic and does not find it. Cleanup
  // above is synchronous fs calls plus closing a local server, which
  // finishes well under that two-second budget.
  stdin.once('end', () => cleanup(0));
  stdin.once('error', () => cleanup(1));

  try {
    // Removes sockets a previous host left behind without cleaning up
    // after itself (a crash, or a SIGKILL past the budget above) —
    // confirming each one is dead first, so a live second host's socket
    // can't be stolen out from under it by a third host starting up.
    await sweepStaleSockets(dir);
    await listenWithRestrictedPermissions(server, socketPath);
  } catch (error) {
    log('failed to start:', error.message);
    cleanup(1);
    return { server, cleanup };
  }

  // A later host's startup sweep would eventually recover a socket and
  // registry entry orphaned by an unhandled post-bind error, but this
  // process's whole job is disciplined lifecycle handling — it should not
  // depend on someone else noticing the mess it left.
  watchForServerErrors(server, (error) => {
    log('socket error:', error.message);
    cleanup(1);
  });

  writeRegistryEntry(dir, pid, { origin: extensionOrigin, startedAt: new Date().toISOString() });

  return { server, cleanup };
}
