#!/usr/bin/env node
// Unlike packages/host/bin/headerlab-host.mjs, this shebang never needs
// rewriting: Chrome never launches this file — a person's shell does, and
// the shell's own PATH already has node on it (nvm, homebrew, or whatever
// put `pnpm`/`node` there in the first place). The env-resolution trap
// documented on the host's shebang is specific to being launched by Chrome.

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { parse } from '../lib/args.mjs';
import { extractBridgeFlag, resolveTarget, sendCommand } from '../lib/bridge.mjs';
import { socketDir } from '../../host/lib/socket.mjs';
import { MAX_OUTGOING } from '../../host/lib/framing.mjs';

// Output is always one JSON object on stdout, success or failure — a human
// prose default would get parsed by whatever calls this CLI, and the moment
// that happens the prose is the API. Diagnostics never belong here; use
// stderr if this file ever needs to say something to a human directly.
function printResult(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function fail(code, message) {
  printResult({ ok: false, error: { code, message } });
  process.exitCode = 1;
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
      wrapped.code = 'invalid-command';
      throw wrapped;
    }
  }
  if (raw.byteLength > MAX_OUTGOING) {
    const wrapped = new Error(
      `state is ${raw.byteLength} bytes, over the ${MAX_OUTGOING}-byte bridge limit`,
    );
    wrapped.code = 'invalid-command';
    throw wrapped;
  }
  let state;
  try {
    state = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    const wrapped = new Error(`state is not valid JSON: ${error.message}`);
    wrapped.code = 'invalid-command';
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

async function main() {
  let bridgePid;
  let rest;
  try {
    ({ bridgePid, rest } = extractBridgeFlag(process.argv.slice(2)));
  } catch (error) {
    fail('usage', error.message);
    return;
  }

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
      fail(error.code ?? 'invalid-command', error.message);
      return;
    }
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
    if (result.ok === false) process.exitCode = 1;
  } catch (error) {
    fail(error.code ?? 'bridge-error', error.message);
  }
}

await main();
