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
  previewInstall,
  uninstallBridge,
} from '../lib/install.mjs';
import { socketDir } from '../lib/socket.mjs';
import { MAX_OUTGOING } from '../lib/framing.mjs';
import { unpackedExtensionId } from '../lib/manifest.mjs';
import { findCommand, GROUPS } from '../lib/commands.mjs';
import { allPaths, commandHelp, ISSUES_URL, topHelp } from '../lib/help.mjs';
import { planFail, planOk, resolveColor, resolveMode } from '../lib/output.mjs';
import { suggest } from '../lib/suggest.mjs';
import { EXIT, exitFor } from '../lib/exit.mjs';

// 모드는 한 번만 정하고 프로세스 수명 동안 유지한다. 명령마다 다시
// 정하면 같은 실행 안에서 두 형식이 섞일 수 있고, 그건 파싱하는 쪽에
// 최악이다.
let MODE = 'json';
let COLOR_OUT = false;
let COLOR_ERR = false;
let GLOBALS;

/**
 * 무엇을 어느 스트림에 쓸지는 `lib/output.mjs` 가 정하고, 여기는 그 계획을
 * 실행하기만 한다. 그 분리가 이 파일에 남아 있던 유일한 미검사 분기를
 * 없앤다 — 사람용 출력은 stdout 이 TTY 여야 켜지는데 `node --test` 가
 * 띄우는 자식의 stdout 은 파이프이고, Node 는 의존성 없이 pty 를 열 수
 * 없어서 그 분기는 프로세스 밖에서만 검사할 수 있다.
 */
function write(plan) {
  if (plan === null) return;
  process[plan.stream].write(plan.text);
}

function emitOk(payload, command) {
  write(planOk(payload, { mode: MODE, quiet: GLOBALS.quiet, command, color: COLOR_OUT }));
}

function emitFail(code, message, argv = null) {
  write(planFail({ code, message }, { mode: MODE, color: COLOR_ERR, argv }));
  process.exitCode = exitFor(code);
}

function emitPlain(text) {
  process.stdout.write(`${text}\n`);
}

const STATE_SET_CONFIRM =
  'state set replaces the entire stored state and cannot be undone; pass --force to confirm';

/**
 * `state set` 은 되돌릴 수 없는 전체 덮어쓰기다 (clig Arguments §10).
 *
 * 비대화형에서 조용히 진행하지 않고 `--force` 를 요구하는 쪽을 택했다.
 * 반대쪽 — 파이프면 그냥 진행 — 은 확인이 사람에게만 걸리고 스크립트에는
 * 안 걸린다는 뜻이고, 스크립트가 훨씬 더 많은 상태를 훨씬 더 빨리 지운다.
 * clig Interactivity §2 가 "물어볼 수 없으면 어떤 플래그를 치라고 알려주며
 * 실패하라" 고 말하는 것이 정확히 이 경우다.
 */
async function confirmStateSet(source) {
  if (GLOBALS.force) return true;
  if (GLOBALS.noInput) {
    emitFail('usage', STATE_SET_CONFIRM);
    return false;
  }
  // 소스가 `-` 이면 stdin 은 payload 이므로 물어볼 데가 없다.
  if (source === '-' || !process.stdin.isTTY) {
    emitFail('usage', STATE_SET_CONFIRM);
    return false;
  }

  process.stderr.write('This replaces the entire stored state and cannot be undone.\n');
  process.stderr.write('Continue? [y/N] ');
  const answer = await new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (chunk) => resolve(chunk.trim().toLowerCase()));
  });
  if (answer === 'y' || answer === 'yes') return true;
  emitFail('usage', 'cancelled');
  return false;
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

/**
 * `--value-file` 을 읽는다. 이 플래그가 있는 이유는 측정된 노출이다:
 * `--value 'Bearer TOPSECRET123'` 이 `ps -ax -o pid,command` 에 그대로
 * 찍힌다. 헤더 값은 Authorization·Cookie·X-Api-Key 가 사는 곳이고,
 * 숨은 트래커 때문에 존재하는 프로젝트가 사용자 토큰을 같은 머신의 모든
 * 계정에 노출할 수는 없다 (clig Arguments §14).
 *
 * 끝의 개행 하나만 떼는 것은 `echo 'x' > f` 가 흔하기 때문이고, 그 이상
 * 다듬지 않는 것은 헤더 값에 공백이 의미를 가질 수 있기 때문이다.
 */
function readValueFile(source) {
  let raw;
  try {
    raw = readFileSync(source, 'utf8');
  } catch (error) {
    throw new Error(`could not read ${source}: ${error.message}`);
  }
  return raw.replace(/\n$/, '');
}

function readStdin() {
  // 측정된 결함: 가드가 없으면 실제 pty 에서 영원히 멈춘다. 5초 뒤에도
  // 실행 중이고 stdout·stderr 둘 다 0바이트라, 사용자는 뭘 기다리는지
  // 알 방법 없이 커서만 본다. clig Help §11.
  if (process.stdin.isTTY) {
    const error = new Error('state set - reads JSON from stdin; pipe it in or pass a file path');
    error.code = 'usage';
    return Promise.reject(error);
  }
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
async function runBridgeCommand(command, commandPath) {
  const paths = defaultInstallPaths({
    userDataDir: command.userDataDir ?? null,
    browser: command.browser ?? 'chrome',
  });

  if (command.cmd === 'bridge.uninstall') {
    emitOk(await uninstallBridge(paths), commandPath);
    return;
  }
  if (command.cmd === 'bridge.status') {
    emitOk(await bridgeStatus(paths), commandPath);
    return;
  }

  // Resolved here rather than in args.mjs, which is pure: turning a typed path
  // into an id means resolving it against process.cwd() and hashing the bytes
  // of the result.
  const extensionId = command.extensionId ?? unpackedExtensionId(path.resolve(command.loadPath));

  if (command.dryRun) {
    emitOk(await previewInstall({ ...paths, extensionId }), ['bridge', 'install']);
    return;
  }

  const result = await installBridge({ ...paths, extensionId });
  if (!result.ok) {
    emitFail(result.error.code, result.error.message);
    return;
  }
  emitOk(
    {
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
    },
    commandPath,
  );
}

async function main() {
  const { globals, rest } = extractGlobals(process.argv.slice(2));
  GLOBALS = globals;
  MODE = resolveMode(globals, process);
  COLOR_OUT = resolveColor(globals, process.env, process.stdout);
  COLOR_ERR = resolveColor(globals, process.env, process.stderr);

  // 도움말과 버전이 전역 플래그 오류보다 먼저다 — 단, **명시적으로 청한**
  // 도움말만이다. 브리프는 맨손 호출(`rest.length === 0`)까지 이 앞에
  // 두었는데, 그러면 `headerlab --bridge` (pid 없음) 가 도움말을 내고 0 으로
  // 나가며 에러를 통째로 삼킨다. `--help` 를 친 사람에게는 도움말이 그가
  // 청한 것이고, 치지 않은 사람에게는 삼켜진 에러다.
  if (globals.version) {
    emitPlain(readPackageVersion());
    return;
  }
  if (globals.help) {
    warnIfUnknown(rest);
    emitPlain(helpTextFor(rest));
    return;
  }
  if (rest[0] === 'help') {
    warnIfUnknown(rest.slice(1));
    emitPlain(helpTextFor(rest.slice(1)));
    return;
  }
  if (globals.error !== null) {
    emitFail('usage', globals.error);
    return;
  }
  if (rest.length === 0) {
    emitPlain(topHelp());
    return;
  }

  const bridgePid = globals.bridgePid;

  // 사람용 출력이 필요로 하는 명령 경로. `parsed.command.cmd` (`site.add`)
  // 대신 표에서 뽑는 이유는 `render.mjs` 가 `['site','add']` 모양을 받기
  // 때문이고, 파싱이 실패한 뒤에도 usage 줄을 붙이려면 argv 로부터 직접
  // 찾을 수 있어야 하기 때문이다.
  const entry = findCommand(rest);
  const commandPath = entry === null ? [rest[0]] : entry.path;

  const parsed = parse(rest);
  if (!parsed.ok) {
    emitFail(parsed.error.code, withSuggestion(parsed.error, rest), rest);
    return;
  }

  let command = parsed.command;
  if (command.cmd === 'state.set') {
    if (!(await confirmStateSet(command.state.source))) return;
    try {
      command = await resolveStateCommand(command);
    } catch (error) {
      emitFail(error.code ?? 'invalid-args', error.message);
      return;
    }
  }

  if (command.cmd === 'rule.add' && typeof command.value === 'object') {
    try {
      command = { ...command, value: readValueFile(command.value.source) };
    } catch (error) {
      emitFail('invalid-args', error.message);
      return;
    }
  }

  // Never reaches a socket, and must not. "No bridge is running" is the normal
  // state for someone typing `bridge install` — routing it through
  // resolveTarget would fail with `bridge-off` on exactly the machine the
  // command exists to fix.
  if (command.cmd.startsWith('bridge.')) {
    await runBridgeCommand(command, commandPath);
    return;
  }

  let target;
  try {
    target = await resolveTarget(socketDir(), bridgePid);
  } catch (error) {
    emitFail(error.code ?? 'bridge-off', error.message);
    return;
  }

  try {
    const result = await sendCommand(target.socketPath, command, {
      onSlow: (timeoutMs) => {
        // 사람용일 때만. 파이프로 받는 쪽에 없던 줄을 흘리지 않는다
        // (clig Output §14). stdout 은 어느 모드에서도 손대지 않는다.
        if (MODE === 'human' && !GLOBALS.quiet && process.stderr.isTTY) {
          process.stderr.write(
            `waiting for the extension to reply (${timeoutMs / 1000}s timeout)…\n`,
          );
        }
      },
    });
    if (result.ok === false) {
      emitRefusal(result);
      return;
    }
    emitOk(result, commandPath);
  } catch (error) {
    emitFail(error.code ?? 'bridge-error', error.message);
  }
}

/**
 * 목적지가 거부한 응답. 기계용에서는 확장이 보낸 봉투를 **그대로** 낸다 —
 * `{ok:false, error:{code,message}}` 를 여기서 다시 만들면 확장이 덧붙인
 * 필드가 조용히 사라진다. 종료 코드는 그 코드에서 나온다: 이 한 줄이
 * 빠지면 확장이 거부한 명령이 전부 0 으로 나간다 (Task 3 이 넣은 줄이다).
 */
function emitRefusal(result) {
  const code = result.error?.code ?? 'bridge-error';
  if (MODE === 'json') {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = exitFor(code);
    return;
  }
  emitFail(code, result.error?.message ?? 'the bridge refused the command');
}

function readPackageVersion() {
  const url = new URL('../package.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')).version;
}

/** 인자가 없으면 최상위, 알려진 명령이면 그 명령, 모르면 최상위. */
function helpTextFor(argv) {
  if (argv.length === 0) return topHelp();
  const entry = findCommand(argv);
  return entry === null ? topHelp() : commandHelp(entry);
}

/**
 * `headerlab teleport --help` 는 종료 0 으로 도움말을 낸다 — 도움말을
 * 청하는 것은 오류가 아니고, `headerlab teleport --help | less` 가 계속
 * 되어야 한다. 그래도 `teleport` 가 명령이 아니라는 사실 자체는 어디에도
 * 안 남았었다: 도움말은 최상위로 조용히 떨어지고, 오타 제안기(`suggest`)는
 * 바로 옆에 있으면서도 이 경로에서는 한 번도 불리지 않았다.
 *
 * 그래서 도움말을 찍기 **전에** stderr 에 한 줄만 남긴다. `helpTextFor`
 * 가 하는 것과 같은 판정(표에 있는 전체 경로, 또는 `GROUPS` 의 그룹
 * 이름 하나)을 "실제 명령" 으로 치므로 — `headerlab site --help` 는
 * `site add` 도 `site rm` 도 아니지만 실제 그룹이라 조용하다. argv 가
 * 비어 있어도(맨손 `--help`) 조용하다.
 */
function warnIfUnknown(argv) {
  if (argv.length === 0) return;
  if (findCommand(argv) !== null) return;
  if (GROUPS.includes(argv[0])) return;
  const hint = suggest(argv[0] ?? '', GROUPS) ?? suggest(argv.join(' '), allPaths());
  const base = `unknown command: ${argv[0]}`;
  process.stderr.write(`${hint === null ? base : `${base} — did you mean "${hint}"?`}\n`);
}

/**
 * 오타 제안을 에러 메시지에 붙인다. 그룹 이름과 전체 경로 양쪽을
 * 후보로 삼는다 — 사람은 `sites add` 도 치고 `site addd` 도 친다.
 */
function withSuggestion(error, argv) {
  if (error.code !== 'unknown-command') return error.message;
  const hint = suggest(argv[0] ?? '', GROUPS) ?? suggest(argv.join(' '), allPaths());
  return hint === null ? error.message : `${error.message} — did you mean "${hint}"?`;
}

/**
 * 닫힌 파이프는 오류가 아니라 정상 종료다. `headerlab state get --json | head`
 * 처럼 앞부분만 읽고 그만두는 것은 정당한 사용인데, 핸들러가 없으면 Node 의
 * 기본 경로가 25줄 1106바이트짜리 스택 트레이스를 stderr 로 쏟는다 — 측정치다.
 * clig Output §17 과 Errors §4 를 동시에 어긴다.
 */
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(EXIT.OK);
  throw error;
});

/**
 * Ctrl-C 는 한 줄을 남기고 나간다. 이전에는 exit 130 은 맞았지만 stdout·
 * stderr 둘 다 0바이트였다 — 이 CLI 가 스스로 약속한 "모든 결과는 봉투
 * 하나" 조차 안 나왔다. 두 번째 Ctrl-C 는 정리를 건너뛰고 즉시 나간다.
 */
let interrupting = false;
process.on('SIGINT', () => {
  if (interrupting) process.exit(130);
  interrupting = true;
  process.stderr.write('interrupted — no command was delivered\n');
  process.exit(130);
});

/**
 * 여기 오는 것은 이 CLI 가 의도해서 낸 실패가 아니라 버그다. 의도된
 * 실패 열일곱 가지는 이미 사람이 읽을 문장으로 다시 쓰여 `emitFail` 로
 * 나가므로, 버그 신고를 권할 대상이 아니다 (clig Errors §1 대 §4).
 */
process.on('uncaughtException', (error) => {
  const title = encodeURIComponent(`crash: ${error.message}`);
  const body = encodeURIComponent(
    [
      `headerlab ${readPackageVersion()}`,
      `node ${process.version} · ${process.platform} ${process.arch}`,
      `argv: ${process.argv.slice(2).join(' ')}`,
      '',
      '```',
      error.stack ?? String(error),
      '```',
    ].join('\n'),
  );
  process.stderr.write(
    [
      `headerlab crashed: ${error.message}`,
      'This is a bug — nothing was left half-done that the next run cannot redo.',
      `Report it: ${ISSUES_URL}/new?title=${title}&body=${body}`,
      '',
    ].join('\n'),
  );
  process.exit(EXIT.FAILED);
});

await main();
