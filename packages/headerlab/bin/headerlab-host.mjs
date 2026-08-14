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
// bin/headerlab-host.mjs`, `node --test packages/headerlab`, and CI on every
// machine but the one that wrote it. The `env` form stays for those; only
// the copy Chrome actually invokes needs the rewrite.

import process from 'node:process';
import { startHost } from '../lib/host.mjs';
import { socketDir } from '../lib/socket.mjs';

// stdout is the native messaging protocol — anything diagnostic goes to
// stderr, or it corrupts the framing Chrome is trying to read on the other
// end of stdout.
function log(...args) {
  console.error('[headerlab-host]', ...args);
}

// Chrome gives the host exactly one argument: the requesting extension's
// origin (measured — no profile or window identifier, and two connections
// from the same profile produce byte-identical argv, which is why the
// socket path startHost() derives is keyed on this process's own pid
// instead).
const extensionOrigin = process.argv[2] ?? null;

// This file has nothing left to test on its own — it is exactly the real
// I/O `lib/host.mjs` was built to take as parameters instead of reaching
// for. See that file's docblock for why the split exists.
await startHost({
  dir: socketDir(),
  extensionOrigin,
  pid: process.pid,
  stdin: process.stdin,
  stdout: process.stdout,
  log,
  exit: (code) => process.exit(code),
});
