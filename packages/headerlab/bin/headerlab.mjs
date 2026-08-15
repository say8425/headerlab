#!/usr/bin/env node
// Unlike headerlab-host.mjs (this file's sibling in bin/), this shebang never needs
// rewriting: Chrome never launches this file — a person's shell does, and
// the shell's own PATH already has node on it (nvm, homebrew, or whatever
// put `pnpm`/`node` there in the first place). The env-resolution trap
// documented on the host's shebang is specific to being launched by Chrome.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parse } from '../lib/args.mjs';
import { extractGlobals, resolveTarget, sendCommand } from '../lib/bridge.mjs';
import {
  bridgeStatus,
  defaultInstallPaths,
  installBridge,
  uninstallBridge,
} from '../lib/install.mjs';
import { socketDir } from '../lib/socket.mjs';
import { MAX_OUTGOING } from '../lib/framing.mjs';
import { unpackedExtensionId } from '../lib/manifest.mjs';
import { exitFor } from '../lib/exit.mjs';

// Output is always one JSON object on stdout, success or failure — a human
// prose default would get parsed by whatever calls this CLI, and the moment
// that happens the prose is the API. Diagnostics never belong here; use
// stderr if this file ever needs to say something to a human directly.
function printResult(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function fail(code, message) {
  printResult({ ok: false, error: { code, message } });
  process.exitCode = exitFor(code);
}

/**
 * Resolves `state.set`'s `{ source }` placeholder (see args.mjs's docblock)
 * into the real payload by reading the named file or, for `-`, stdin. This
 * is the one place in the CLI allowed to do that I/O — args.mjs is pure by
 * contract, and lib/bridge.mjs is about talking to the socket, not the
 * filesystem the command's content comes from.
 *
 * The 1 MB check happens on the raw bytes, before JSON.parse and before the
 * command goes anywhere near the socket — CLAUDE.md's "no silent failures"
 * extended to this boundary: the design doc says explicitly the CLI must
 * refuse an oversized payload up front rather than let it get cut and fail
 * zod validation three processes away, where the size that mattered is no
 * longer visible. `MAX_OUTGOING` is imported from the host's framing
 * module rather than restated here, since 1 MB is that module's number
 * (host → extension) and this command travels exactly that direction.
 *
 * 이 세 실패는 `invalid-args` 다. `invalid-command` 였으나, 그 코드는
 * 확장의 `port.ts` 가 `parseCommand` 실패에 쓰는 것이기도 해서 한 코드에
 * 뜻이 둘이었다 — 하나는 "당신이 나쁜 파일을 가리켰다"(사용자 입력),
 * 다른 하나는 "확장이 명령 모양을 거부했다"(버전 어긋남). 종료 코드가
 * 달라야 하므로(2 대 1) 코드도 달라야 한다.
 */
async function resolveStateCommand(command) {
  const { source } = command.state;
  let raw;
  if (source === '-') {
    raw = await readStdin();
  } else {
    try {
      raw = readFileSync(source);
    } catch (error) {
      const wrapped = new Error(`could not read ${source}: ${error.message}`);
      wrapped.code = 'invalid-args';
      throw wrapped;
    }
  }
  if (raw.byteLength > MAX_OUTGOING) {
    const wrapped = new Error(
      `state is ${raw.byteLength} bytes, over the ${MAX_OUTGOING}-byte bridge limit`,
    );
    wrapped.code = 'invalid-args';
    throw wrapped;
  }
  let state;
  try {
    state = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    const wrapped = new Error(`state is not valid JSON: ${error.message}`);
    wrapped.code = 'invalid-args';
    throw wrapped;
  }
  return { ...command, state };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
    process.stdin.on('error', reject);
  });
}

/**
 * Handles the `bridge.*` commands, which never reach a socket — installing,
 * uninstalling and reporting on the native messaging host manifest is what
 * makes a socket possible in the first place, not something that needs one.
 */
async function runBridgeCommand(command) {
  const paths = defaultInstallPaths({
    userDataDir: command.userDataDir ?? null,
    browser: command.browser ?? 'chrome',
  });

  if (command.cmd === 'bridge.uninstall') {
    printResult(await uninstallBridge(paths));
    return;
  }
  if (command.cmd === 'bridge.status') {
    printResult(await bridgeStatus(paths));
    return;
  }

  // Resolved here rather than in args.mjs, which is pure: turning a typed path
  // into an id means resolving it against process.cwd() and hashing the bytes
  // of the result.
  const extensionId = command.extensionId ?? unpackedExtensionId(path.resolve(command.loadPath));

  const result = await installBridge({ ...paths, extensionId });
  if (!result.ok) {
    fail(result.error.code, result.error.message);
    return;
  }
  printResult({
    ...result,
    // Reported, never assumed. A symlink, a trailing slash, or a differently
    // spelled path to the same directory each yield a different id, and
    // `allowed_origins` takes no wildcard — so a mismatch is a bridge that
    // installs cleanly and never connects, with Chrome giving the same
    // message it gives for a manifest that is not there at all.
    ...(command.extensionId === null
      ? {
          note:
            `computed from ${path.resolve(command.loadPath)} — check it against the id on ` +
            'chrome://extensions before assuming this worked',
        }
      : {}),
  });
}

async function main() {
  const { globals, rest } = extractGlobals(process.argv.slice(2));
  if (globals.error !== null) {
    fail('usage', globals.error);
    return;
  }
  const bridgePid = globals.bridgePid;

  const parsed = parse(rest);
  if (!parsed.ok) {
    fail(parsed.error.code, parsed.error.message);
    return;
  }

  let command = parsed.command;
  if (command.cmd === 'state.set') {
    try {
      command = await resolveStateCommand(command);
    } catch (error) {
      fail(error.code ?? 'invalid-args', error.message);
      return;
    }
  }

  // Never reaches a socket, and must not. "No bridge is running" is the normal
  // state for someone typing `bridge install` — routing it through
  // resolveTarget would fail with `bridge-off` on exactly the machine the
  // command exists to fix.
  if (command.cmd.startsWith('bridge.')) {
    await runBridgeCommand(command);
    return;
  }

  let target;
  try {
    target = await resolveTarget(socketDir(), bridgePid);
  } catch (error) {
    fail(error.code ?? 'bridge-off', error.message);
    return;
  }

  try {
    const result = await sendCommand(target.socketPath, command);
    printResult(result);
    if (result.ok === false) process.exitCode = exitFor(result.error?.code ?? 'bridge-error');
  } catch (error) {
    fail(error.code ?? 'bridge-error', error.message);
  }
}

await main();
