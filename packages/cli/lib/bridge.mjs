import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { isSocketAlive, registryPathFor, socketPathFor } from '../../host/lib/socket.mjs';

/**
 * Everything in this file touches the filesystem or a socket, which is why
 * it is split out of `args.mjs` (pure) rather than living there. It is
 * split out of `bin/headerlab.mjs` for the opposite reason: that file runs
 * `main()` as a side effect of being imported, so nothing inside it is
 * reachable from `node:test` without actually invoking the CLI as a
 * subprocess. This module has no top-level side effects and every function
 * takes its I/O dependencies (a directory, a socket path) as arguments
 * rather than reaching for `socketDir()` itself, so tests can point it at a
 * scratch directory instead of the real `$TMPDIR/headerlab` — the same
 * reason `packages/host/lib/socket.mjs` takes `dir` as a parameter.
 */

export function withCode(error, code) {
  error.code = code;
  return error;
}

/**
 * `--bridge <pid>` is a global flag, not part of any single command's
 * grammar — it picks which live bridge to talk to, which is orthogonal to
 * what the command does. So it is pulled out of argv before the rest ever
 * reaches `args.mjs`'s `parse()`, which only knows the nine command shapes.
 */
export function extractBridgeFlag(argv) {
  const index = argv.indexOf('--bridge');
  if (index === -1) return { bridgePid: null, rest: argv };
  const value = argv[index + 1];
  if (value === undefined) throw new Error('--bridge needs a pid');
  const bridgePid = Number(value);
  if (!Number.isInteger(bridgePid) || bridgePid <= 0) {
    throw new Error(`--bridge needs a numeric pid, got: ${value}`);
  }
  return { bridgePid, rest: [...argv.slice(0, index), ...argv.slice(index + 2)] };
}

const REGISTRY_FILE = /^(\d+)\.json$/;

/**
 * Enumerates the registry directory `packages/host/lib/socket.mjs` writes
 * (`<pid>.json` beside `bridge-<pid>.sock`) and returns only the entries
 * whose socket actually answers — a registry file can outlive its host if
 * the process was SIGKILLed past its two-second cleanup budget (see that
 * file's `sweepStaleSockets`, which this CLI deliberately does not call:
 * cleaning up a dead host's files is the *next* host's job at startup, not
 * a reader's job at query time).
 */
export async function findLiveBridges(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const live = [];
  for (const name of names) {
    const match = REGISTRY_FILE.exec(name);
    if (!match) continue;
    const pid = Number(match[1]);
    const socketPath = socketPathFor(dir, pid);
    if (!(await isSocketAlive(socketPath))) continue;
    let origin = null;
    try {
      origin = JSON.parse(readFileSync(registryPathFor(dir, pid), 'utf8')).origin ?? null;
    } catch {
      // The socket answered regardless of whether its registry entry is
      // readable — still a live bridge, just reported with no origin.
    }
    live.push({ pid, socketPath, origin });
  }
  return live;
}

/**
 * Resolves which bridge to talk to. No socket directory, or a directory
 * with nothing live in it, is `bridge-off` — a state, not a retry loop: the
 * design is explicit that the host cannot be started from outside, so
 * waiting for one to appear accomplishes nothing (design doc §1).
 *
 * More than one live bridge is also refused rather than picked for the
 * caller — the design is explicit that nobody loses silently — so this
 * lists every candidate with its pid and origin and points at
 * `--bridge <pid>` rather than guessing.
 */
export async function resolveTarget(dir, bridgePid) {
  const live = await findLiveBridges(dir);

  if (bridgePid !== null) {
    const match = live.find((bridge) => bridge.pid === bridgePid);
    if (!match) {
      throw withCode(new Error(`no live bridge with pid ${bridgePid}`), 'bridge-off');
    }
    return match;
  }

  if (live.length === 0) {
    throw withCode(new Error('no bridge is running'), 'bridge-off');
  }
  if (live.length > 1) {
    const list = live
      .map((bridge) => `  pid ${bridge.pid}${bridge.origin ? ` (${bridge.origin})` : ''}`)
      .join('\n');
    throw withCode(
      new Error(`more than one bridge is running — pick one with --bridge <pid>:\n${list}`),
      'multiple-bridges',
    );
  }
  return live[0];
}

// How long to wait for the extension to answer once a command has actually
// been written to a live socket. This default is a guess, not a
// measurement — there is no live host or extension adapter in this
// environment to time a real round trip against (the extension adapter
// that would reply doesn't exist yet; it's a later task). It exists so a
// dead SW or a bridge stuck mid-handshake fails loudly instead of hanging
// the CLI forever. Callers may override it — the test suite does, to keep
// its timeout case fast.
export const DEFAULT_REPLY_TIMEOUT_MS = 10_000;

/**
 * Sends one command over an already-confirmed-live socket and waits for its
 * reply, correlated by request id.
 *
 * The host is a dumb relay: it broadcasts every extension reply to every
 * connected socket client with no request/response pairing of its own (by
 * design — see packages/host's task report, "no correlation" was flagged
 * there deliberately rather than solved there). Two concurrent `headerlab`
 * invocations against the same bridge would otherwise each read the
 * other's reply. Solving it here, with a per-command `id`, keeps the host a
 * protocol-agnostic relay: it cannot correlate anything without the
 * extension echoing an id back regardless, and pushing correlation into a
 * relay would make it a protocol participant instead of a pipe.
 *
 * CONTRACT WITH THE EXTENSION ADAPTER (a later plan, not written yet): the
 * adapter must echo the `id` field of the envelope it receives back
 * unchanged on its reply. Nothing on this side can enforce that — it is
 * invisible from this file alone, which is exactly why it is written down
 * here rather than assumed.
 */
export function sendCommand(socketPath, command, { timeoutMs = DEFAULT_REPLY_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const socket = createConnection(socketPath);
    let buffer = '';
    let settled = false;

    function settle(action, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      action(value);
    }

    const timer = setTimeout(() => {
      settle(
        reject,
        withCode(new Error('the bridge accepted the connection but never replied'), 'timeout'),
      );
    }, timeoutMs);

    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id, command })}\n`);
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newlineAt;
      while ((newlineAt = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineAt);
        buffer = buffer.slice(newlineAt + 1);
        if (line.trim() === '') continue;
        let reply;
        try {
          reply = JSON.parse(line);
        } catch {
          continue; // Not JSON — not a reply this CLI can act on. Keep reading.
        }
        if (reply.id !== id) continue; // Someone else's reply, broadcast past us.
        const { id: _replyId, ...result } = reply;
        settle(resolve, result);
        return;
      }
    });

    // A connection that closes before delivering a matching reply is its
    // own case, distinct from "no socket file at all" — flagged in
    // packages/host's task report as something this file would need to
    // handle once it existed.
    socket.on('close', () => {
      settle(
        reject,
        withCode(new Error('the bridge closed the connection before replying'), 'bridge-closed'),
      );
    });
    socket.on('error', (error) => settle(reject, error));
  });
}
