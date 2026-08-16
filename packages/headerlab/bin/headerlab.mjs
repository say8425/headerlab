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
import { commandPaths, findCommand, GROUPS, pathKey, subcommandsOf } from '../lib/commands.mjs';
import { commandHelp, groupHelp, ISSUES_URL, topHelp } from '../lib/help.mjs';
import { planFail, planOk, planSlowReply, resolveColor, resolveMode } from '../lib/output.mjs';
import { suggest } from '../lib/suggest.mjs';
import { codeForThrown, EXIT, exitFor } from '../lib/exit.mjs';

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
  // `bridgePid` 는 `MODE`·`COLOR_ERR` 과 같은 자리에서 온다 — 실행 전체에
  // 걸린 호출의 사실이지 이 실패의 사실이 아니다. 사람용 `bridge-off` 렌더
  // 하나가 그것을 읽는다(`lib/render.mjs` 의 docblock 참조): pid 를 지목한
  // 실패와 아무것도 안 떠 있는 실패는 다음에 칠 명령이 다르다.
  const bridgePid = GLOBALS?.bridgePid ?? null;
  write(planFail({ code, message }, { mode: MODE, color: COLOR_ERR, argv, bridgePid }));
  process.exitCode = exitFor(code);
}

function emitPlain(text) {
  process.stdout.write(`${text}\n`);
}

/**
 * 소켓으로 명령을 보내는 **유일한 자리**. `runStatus` 와 `main` 이 각자
 * `sendCommand` 를 부르던 동안 `onSlow` 는 한쪽에만 달려 있었고, 그래서
 * 답하지 않는 브릿지에 `pause` 를 보내면 1초 뒤 기다린다는 줄이 나오는데
 * `status` 를 보내면 10초 동안 한 바이트도 나오지 않았다 — 사람이 가장
 * 많이 치는 명령이 하필 그 결함을 다시 가진 쪽이었다. 두 자리가 다시
 * 갈라지지 않는 방법은 자리를 하나로 만드는 것이다.
 */
function send(socketPath, command) {
  return sendCommand(socketPath, command, {
    onSlow: slowReplyNotice,
    onSent: () => {
      DELIVERED = true;
    },
  });
}

/**
 * 명령의 바이트가 소켓으로 나갔는가. SIGINT 핸들러 하나만 읽는다 — 그
 * 핸들러가 "아무 명령도 전달되지 않았다" 를 **조건 없이** 찍고 있었고,
 * `state set --force` 처럼 되돌릴 수 없는 것을 이미 보낸 뒤에도 같은 문장을
 * 냈다. 다시 실행하라고 등을 떠미는 거짓말이며, 조용한 실패를 없애려고
 * 존재하는 CLI 가 낼 수 있는 가장 나쁜 문장이다.
 */
let DELIVERED = false;

/**
 * `sendCommand` 의 느린 응답 통보. 무엇을 어디에 쓸지는 `planSlowReply` 가
 * 정하고 (`emitOk`/`emitFail` 과 같은 이유로 — 그 판단은 pty 없이 닿을 수
 * 없는 분기가 되므로 lib/ 에서 표로 잰다), 여기 남는 것은 쓰는 한 줄이다.
 */
function slowReplyNotice(timeoutMs) {
  write(planSlowReply(timeoutMs, { mode: MODE, quiet: GLOBALS.quiet, stream: process.stderr }));
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
function stateSetGate(source) {
  if (GLOBALS.force) return 'go';
  if (GLOBALS.noInput) return 'refuse';
  // 소스가 `-` 이면 stdin 은 payload 이므로 물어볼 데가 없다.
  if (source === '-' || !process.stdin.isTTY) return 'refuse';
  return 'ask';
}

/**
 * 무엇을 덮어쓰는지 세어서 묻는다 (설계 §7.1). 세는 대상은 **들어올**
 * payload 다 — 지금 저장된 것을 알려면 브릿지에 한 번 더 다녀와야 하고,
 * 이 확인은 그보다 앞이다. 문장이 방향을 말하는 이유가 그것이다.
 *
 * 숫자가 없으면 이 줄은 모든 실행에서 참이라 아무 신호도 싣지 않는다. 빈
 * 상태로 채워진 파일을 가리켰다는 것을 사람이 알아채는 자리가 여기다.
 */
function replacementSummary(state) {
  const profile = state?.profiles?.[0] ?? null;
  const rules = Array.isArray(profile?.headers) ? profile.headers.length : 0;
  const sites = Array.isArray(profile?.filter?.domains) ? profile.filter.domains.length : 0;
  return `${rules} ${rules === 1 ? 'rule' : 'rules'} and ${sites} ${sites === 1 ? 'site' : 'sites'}`;
}

async function confirmStateSet(state) {
  process.stderr.write(
    `This replaces the entire stored state with ${replacementSummary(state)}, and cannot be undone.\n`,
  );
  process.stderr.write('Continue? [y/N] ');
  const answer = await new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    // 세 갈래 전부를 정한다. `'data'` 만 달려 있던 동안 프롬프트에서
    // Ctrl-D 를 누르면 — 흔한 키다 — 이 promise 가 영원히 안 풀리고 Node 가
    // "unsettled top-level await" 경고와 함께 **13** 으로 나갔다. 13 은 §2.3
    // 표에 없는 종료 코드이고, 봉투도 사람이 읽을 문장도 없다. EOF 는 거절과
    // 같은 뜻으로 접는다.
    const answerWith = (value) => {
      // `once` 는 핸들러만 떼고 스트림을 멈추지는 않는다. 리스너를 달면서
      // 흐름 모드로 들어간 stdin 은 ref 된 핸들이라, 이걸 안 놓으면
      // `main()` 이 끝난 뒤에도 이벤트 루프가 살아 CLI 가 결과를 찍고
      // 영원히 멈춰 있다 — 100% 재현, 가장 파괴적인 명령에서.
      //
      // `pause()` 만으로는 부족하다. **측정**: pty 에서는 그것으로 나가지만
      // 파이프인 stdin 은 `pause()` 뒤에도 루프를 붙잡는다. 이 확인이 파이프
      // 위에서 이뤄지므로(테스트 하네스가 `isTTY` 만 켠다) `unref()` 까지
      // 해야 두 경우가 같아지고, 그래야 이 결함이 검사 가능해진다.
      process.stdin.pause();
      process.stdin.unref();
      resolve(value);
    };
    process.stdin.once('data', (chunk) => answerWith(chunk.trim().toLowerCase()));
    process.stdin.once('end', () => answerWith(''));
    process.stdin.once('error', () => answerWith(''));
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
 *
 * `-` 는 stdin 이다. SKILL.md·설계 §3.2·§7.4 가 전부 `<path|->` 라고 적어
 * 왔는데 구현은 그 토큰을 `readFileSync` 에 그대로 넘겼고 — `-` 라는 이름의
 * 파일을 찾는다 — 스킬을 따르는 에이전트는 영문 모를 ENOENT 를 받았다.
 * 거기서 손이 가는 복구는 `--value` 이고, 그것이 바로 이 플래그가 막으려던
 * 노출이다. `state set -` 이 쓰는 `readStdin()` 을 그대로 쓴다(TTY 가드
 * 포함): 파이프가 없는 터미널에서 멈추는 것도 같은 결함이다.
 */
async function readValueSource(source) {
  if (source === '-') {
    const raw = await readStdin('--value-file - reads the header value from stdin');
    return raw.toString('utf8').replace(/\n$/, '');
  }
  let raw;
  try {
    raw = readFileSync(source, 'utf8');
  } catch (error) {
    throw new Error(`could not read ${source}: ${error.message}`);
  }
  return raw.replace(/\n$/, '');
}

function readStdin(what = 'state set - reads JSON from stdin') {
  // 측정된 결함: 가드가 없으면 실제 pty 에서 영원히 멈춘다. 5초 뒤에도
  // 실행 중이고 stdout·stderr 둘 다 0바이트라, 사용자는 뭘 기다리는지
  // 알 방법 없이 커서만 본다. clig Help §11.
  if (process.stdin.isTTY) {
    const error = new Error(`${what}; pipe it in or pass a file path`);
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
 * A symlink, a trailing slash, or a differently spelled path to the same
 * directory each hash to a different id, and `allowed_origins` takes no
 * wildcard — so a mismatch is a bridge that installs cleanly and never
 * connects, with Chrome giving the same message it gives for a manifest that
 * is not there at all. Reported, never assumed: this is the one text both
 * `runBridgeCommand`'s real install and its `--dry-run` preview attach, under
 * the same condition (`--extension-id` was not given, so the id was
 * computed). `previewInstall`'s own docblock in `lib/install.mjs` names this
 * exact trap as its reason for existing — a dry run that omitted the note
 * would show the id without the warning that makes checking it necessary.
 */
function computedIdNote(loadPath) {
  return (
    `computed from ${loadPath} — check it against the id on ` +
    'chrome://extensions before assuming this worked'
  );
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
  const note =
    command.extensionId === null ? { note: computedIdNote(path.resolve(command.loadPath)) } : {};

  if (command.dryRun) {
    const preview = await previewInstall({ ...paths, extensionId });
    if (!preview.ok) {
      emitFail(preview.error.code, preview.error.message);
      return;
    }
    emitOk({ ...preview, ...note }, ['bridge', 'install']);
    return;
  }

  const result = await installBridge({ ...paths, extensionId });
  if (!result.ok) {
    emitFail(result.error.code, result.error.message);
    return;
  }
  emitOk({ ...result, ...note }, commandPath);
}

/**
 * `headerlab status` 는 종료 코드 표의 의도적 예외다. 브릿지가 없다는 것은
 * 이 명령에게 에러가 아니라 **보고할 사실**이므로, 커밋 없는 저장소의
 * `git status` 처럼 exit 0 으로 그것을 그린다. 다른 어떤 명령도 이 예외를
 * 갖지 않으며 — `rule ls`·`site ls`·`state get` 은 같은 `{cmd:'status'}` 를
 * 보내면서도 여전히 `bridge-off` 로 3 을 내고 나간다 — 그래서 이 갈래는
 * `command.cmd` 가 아니라 **사람이 친 이름**(`commandPath`)으로 갈린다.
 *
 * 예외는 "브릿지가 하나도 없다" 까지이며, 그 경계는 **응답만이 아니라
 * 던져진 실패에도** 걸린다. 브릿지가 답했는데 거부했다면 그것은 다른
 * 사실이고, 다른 명령과 똑같이 봉투 그대로 나가며 종료 코드도 산다 —
 * 읽을 수 없는 저장소를 "not running" 으로 번역하는 것은 이 저장소가
 * 금지하는 조용한 실패다. 던져지는 쪽도 마찬가지다: `resolveTarget` 과
 * `sendCommand` 는 `bridge-off` 말고도 `multiple-bridges`(3),
 * `timeout`·`bridge-closed`(4), 그리고 소켓이 날것으로 내는 errno 를
 * 던지고, 그 전부를 삼키면 봉투가 스스로 모순된다 — `bridgeStatus` 는
 * 자기 `findLiveBridges` 를 돌리므로 `liveBridges` 가 두 pid 를 세고 있는
 * 채로 `live:false` 가 0 으로 나간다. 열 초 매달린 확장과 아무것도 설치되지
 * 않은 기계를 종료 코드로 구분할 수 없게 되는 것이 그 대가다.
 *
 * `--bridge <pid>` 로 하나를 지목했는데 그것이 없는 것도 예외가 아니다.
 * 지목은 "이 브릿지에 말하라" 이므로, 다른 브릿지가 살아 있는데 exit 0 으로
 * "not running" 이라 답하면 지목이 조용히 무시된 것처럼 보인다. 예외는
 * 아무것도 지목하지 않았고 아무것도 뜨지 않은 경우까지다.
 */
async function runStatus(command, commandPath, bridgePid) {
  const paths = defaultInstallPaths({ userDataDir: null, browser: 'chrome' });

  // 측정해서 알게 된 것: `bridgeStatus` 도 자기 `findLiveBridges` 를 돌리므로
  // 소켓 디렉터리를 열 수 없으면(그 자리에 파일이 있으면 ENOTDIR, 권한이
  // 없으면 EACCES) **여기서** 던진다 — 아래 try 밖이라, 같은 입력에 대해
  // 다른 명령이 `bridge-error`(4) 를 낼 때 `status` 만 크래시 핸들러로 가서
  // "headerlab crashed … 이건 버그다, 신고하라" 를 내고 1 로 나갔다. 읽을 수
  // 없는 디렉터리는 이 CLI 의 버그가 아니라 보고할 사실이다.
  let local;
  try {
    local = await bridgeStatus(paths);
  } catch (error) {
    emitFail(codeForThrown(error), error.message);
    return;
  }

  let remote = null;
  try {
    const target = await resolveTarget(socketDir(), bridgePid);
    remote = await send(target.socketPath, command);
  } catch (error) {
    const code = codeForThrown(error);
    if (code !== 'bridge-off' || bridgePid !== null) {
      emitFail(code, error.message);
      return;
    }
    // 브릿지가 하나도 없다. local 만으로 답한다.
  }

  if (remote !== null && remote.ok !== true) {
    emitRefusal(remote);
    return;
  }
  emitOk({ ...local, ...remote, live: remote !== null }, commandPath);
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
    // 물어볼 수 있는지를 **먼저** 정하고(파일을 읽기 전이라 "--force 를
    // 치라" 가 "그 파일이 없다" 보다 앞선다), 물어볼 payload 는 읽은 뒤에
    // 만든다 — 세어서 말하려면 내용이 있어야 한다.
    const gate = stateSetGate(command.state.source);
    if (gate === 'refuse') {
      emitFail('usage', STATE_SET_CONFIRM);
      return;
    }
    try {
      command = await resolveStateCommand(command);
    } catch (error) {
      emitFail(error.code ?? 'invalid-args', error.message);
      return;
    }
    if (gate === 'ask' && !(await confirmStateSet(command.state))) return;
  }

  if (command.cmd === 'rule.add' && typeof command.value === 'object') {
    try {
      command = { ...command, value: await readValueSource(command.value.source) };
    } catch (error) {
      emitFail(error.code ?? 'invalid-args', error.message);
      return;
    }
  }

  // Never reaches a socket, and must not. "No bridge is running" is the normal
  // state for someone typing `bridge install` — routing it through
  // resolveTarget would fail with `bridge-off` on exactly the machine the
  // command exists to fix.
  if (command.cmd.startsWith('bridge.')) {
    // `runStatus` 와 **같은 가드**다. 그 함수의 docblock 이 이유를 이미
    // 적어 두었다 — "읽을 수 없는 디렉터리는 이 CLI 의 버그가 아니라 보고할
    // 사실이다" — 그런데 가드는 `runStatus` 에만 달렸고, 같은 `bridgeStatus`
    // 를 부르는 이 형제는 맨몸이었다. 소켓 디렉터리 자리에 파일이 있으면
    // (ENOTDIR) `headerlab bridge status` 는 크래시 핸들러로 가서 "이건
    // 버그다, 이 URL 로 신고하라" 를 내고 1 로 나갔고, 같은 조건에서
    // `headerlab status` 는 제대로 보고했다. 같은 실패에 두 명령이 다른
    // 말을 하는 것이 여기서 가장 나쁘다.
    try {
      await runBridgeCommand(command, commandPath);
    } catch (error) {
      emitFail(codeForThrown(error), error.message);
    }
    return;
  }

  if (pathKey(commandPath) === 'status') {
    await runStatus(command, commandPath, bridgePid);
    return;
  }

  let target;
  try {
    // `?? 'bridge-off'` 가 아닌 이유는 `runStatus` 의 같은 자리와 같다:
    // `findLiveBridges` 는 ENOENT 아닌 `readdir` 실패를 **다시 던지므로**
    // (소켓 디렉터리 자리에 파일이 있으면 ENOTDIR, 권한이 없으면 EACCES)
    // errno 가 그대로 봉투의 `error.code` 로 나가고, 표에 없는 코드는
    // `exitFor` 의 기본값을 타고 1("목적지가 요청을 거부했다")이 된다 —
    // 목적지에 닿은 적이 없는데도. 측정: 없는 브릿지에 대해 `resolveTarget`
    // 이 던지는 것은 `code:'bridge-off'` 이고 그것은 `BY_CODE` 에 있으므로
    // `codeForThrown` 이 그대로 통과시킨다. 즉 이 교체는 모든 명령의
    // bridge-off 기본값을 건드리지 않고, errno 만 접는다.
    target = await resolveTarget(socketDir(), bridgePid);
  } catch (error) {
    emitFail(codeForThrown(error), error.message);
    return;
  }

  try {
    const result = await send(target.socketPath, command);
    if (result.ok === false) {
      emitRefusal(result);
      return;
    }
    emitOk(result, commandPath);
  } catch (error) {
    // `runStatus` 의 같은 자리와 **같은 함수**를 쓴다. 소켓이 던진 EPIPE 를
    // 한쪽은 `bridge-error` 로, 다른 쪽은 `EPIPE` 로 부르면 같은 실패가
    // 명령마다 다른 코드로 나간다. 위의 `resolveTarget` 도 같은 함수다.
    emitFail(codeForThrown(error), error.message);
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

/**
 * 인자가 없으면 최상위, 알려진 명령이면 그 명령, 그룹 이름 하나면 그
 * 그룹의 목록, 모르면 최상위.
 *
 * 그룹 갈래가 없던 동안 `headerlab help bridge` 는 방금 읽던 최상위
 * 도움말을 그대로 다시 냈다 — 표에 그룹 단독 항목이 없어 `findCommand` 가
 * null 을 주기 때문이며, 그 사실은 어디에도 안 나왔다.
 */
function helpTextFor(argv) {
  if (argv.length === 0) return topHelp();
  const entry = findCommand(argv);
  if (entry !== null) return commandHelp(entry);
  if (argv.length === 1 && subcommandsOf(argv[0]).length > 0) return groupHelp(argv[0]);
  return topHelp();
}

/**
 * 최상위 오타 제안의 두 단계 표현. 그룹 이름과 전체 경로 양쪽을 후보로
 * 삼는다 — 사람은 `sites add` 도 치고 `site addd` 도 친다.
 *
 * `warnIfUnknown` 과 `withSuggestion` 이 이 표현을 나란히 복제하고
 * 있었다 — 후보 집합이 한쪽만 바뀌면 다른 쪽은 조용히 남는다. 이름
 * 붙여 한 곳에 두어 그 갈라짐을 없앤다.
 */
function suggestionFor(argv) {
  return suggest(argv[0] ?? '', GROUPS) ?? suggest(argv.join(' '), commandPaths());
}

/** `hint` 가 있으면 붙이고 없으면 `base` 그대로. 세 갈래(최상위, 그룹 안 서브커맨드, 파싱 실패)가 같은 문장 모양을 쓴다. */
function withHint(base, hint) {
  return hint === null ? base : `${base} — did you mean "${hint}"?`;
}

/**
 * `headerlab site bogus --help` 처럼, 그룹은 맞았는데 그 아래 서브커맨드가
 * 없는 경우. `warnIfUnknown` 이 예전에는 `GROUPS.includes(argv[0])` 에서
 * 바로 멈췄다 — 토큰 하나짜리 미확인 명령에만 경고했고, 실제 그룹 아래의
 * 미확인 서브커맨드는 조용히 최상위 도움말로 떨어졌다.
 *
 * 제안 후보는 `suggestionFor` 가 쓰는 최상위 두 단계(전체 GROUPS, 전체
 * 경로)가 아니라 **이 그룹 소속 서브커맨드만**이다 — `site bogus` 에
 * `rule add` 를 제안하는 것은 사람이 안 친 오타를 지어내는 것과 같다.
 */
function warnUnknownSubcommand(argv) {
  const [group, sub] = argv;
  const hint = suggest(sub ?? '', subcommandsOf(group));
  process.stderr.write(`${withHint(`unknown ${group} command: ${sub ?? '(nothing)'}`, hint)}\n`);
}

/**
 * `findCommand` 는 **앞머리 일치**다 — `findCommand(['status','bogus'])` 는
 * `status` 항목을 돌려준다. 그래서 `warnIfUnknown` 이 "표에 있으면 조용히"
 * 로 끝나던 동안 `headerlab status bogus --help` 는 `bogus` 에 대해 아무
 * 말도 없이 `status` 의 도움말을 냈고, 형제인 `headerlab site bogus --help`
 * 는 경고했다 — 같은 오타에 두 명령이 다른 말을 하는 것이 이 파일이
 * 되풀이해 고치는 결함이다.
 *
 * **토큰 수만으로는 못 가른다.** `entry.path.length < argv.length` 를 그대로
 * 미확인 취급하면 멀쩡한 호출 셋이 함께 경고를 받는다 — 측정: `site add
 * example.com --help`(위치 인자), `rule add --target request --help`(플래그와
 * 그 값), `rule toggle 3f9a --help`. 그래서 두 가지를 더 본다: 표가 위치
 * 인자를 선언한 명령(`entry.args`)은 남는 토큰이 그 인자이므로 조용하고,
 * 남는 첫 토큰이 `-` 로 시작하면 그것은 서브커맨드가 아니라 플래그다
 * (그 뒤는 파서가 판정한다 — 여기는 도움말 경로이지 파서가 아니다).
 *
 * 남는 것은 위치 인자를 받지 않는 명령 뒤에 붙은 맨 토큰뿐이고, 그때만
 * 한 줄을 남긴다. 제안은 붙이지 않는다: `status` 아래에는 후보 집합이 없고,
 * 그룹 아래 서브커맨드 오타는 `warnUnknownSubcommand` 가 이미 다룬다.
 */
function warnIfTrailing(entry, argv) {
  const extra = argv[entry.path.length];
  if (extra === undefined || entry.args !== undefined || extra.startsWith('-')) return;
  process.stderr.write(`unknown ${pathKey(entry.path)} argument: ${extra}\n`);
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
 *
 * 그룹은 맞는데 서브커맨드가 안 맞는 경우(`headerlab site bogus --help`)는
 * 셋째 갈래다 — 그룹 이름 단독과 달리 실제로 안 친 토큰이 있으므로
 * `warnUnknownSubcommand` 로 넘긴다.
 */
function warnIfUnknown(argv) {
  if (argv.length === 0) return;
  const entry = findCommand(argv);
  if (entry !== null) {
    warnIfTrailing(entry, argv);
    return;
  }
  if (GROUPS.includes(argv[0])) {
    if (argv.length > 1) warnUnknownSubcommand(argv);
    return;
  }
  const base = `unknown command: ${argv[0]}`;
  process.stderr.write(`${withHint(base, suggestionFor(argv))}\n`);
}

/**
 * 오타 제안을 에러 메시지에 붙인다.
 *
 * 갈래가 둘인 이유는 파서가 두 자리에서 다른 코드를 내기 때문이다.
 * 최상위 오타(`headerlab sight add`)는 `unknown-command` 로 오고, 그룹
 * 아래 서브커맨드 오타(`headerlab site addd x`)는 `invalid-args` 로 온다 —
 * 그래서 `unknown-command` 만 보던 동안 후자에는 제안이 한 번도 붙지 않았다.
 * 같은 줄에 `--help` 를 덧붙이면 `warnUnknownSubcommand` 가 제대로 제안하고
 * 안 붙이면 안 하는, 설명할 수 없는 차이였다. 제안 후보는 그쪽과 같은
 * **그 그룹 소속 서브커맨드만**이다.
 */
function withSuggestion(error, argv) {
  if (error.code === 'unknown-command') {
    return withHint(error.message, suggestionFor(argv));
  }
  if (error.code === 'invalid-args' && findCommand(argv) === null && GROUPS.includes(argv[0])) {
    return withHint(error.message, suggest(argv[1] ?? '', subcommandsOf(argv[0])));
  }
  return error.message;
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
 *
 * **두 문장 중 어느 것이 참인지는 `DELIVERED` 만 안다.** 한 문장을 조건
 * 없이 찍는 동안 그것은 절반의 경우 거짓이었고, 하필 거짓인 쪽이 위험한
 * 쪽이다: 이미 나간 `site add` 를 안 나갔다고 들은 사람은 다시 친다.
 * `state set --force` 라면 되돌릴 수 없는 덮어쓰기가 안 일어났다고 듣는다.
 */
let interrupting = false;
process.on('SIGINT', () => {
  if (interrupting) process.exit(130);
  interrupting = true;
  process.stderr.write(
    DELIVERED
      ? 'interrupted after the command was sent — it may already have been applied\n'
      : 'interrupted — no command was delivered\n',
  );
  process.exit(130);
});

/**
 * 여기 오는 것은 이 CLI 가 의도해서 낸 실패가 아니라 버그다. 의도된
 * 실패 — `lib/exit.mjs` 의 `ERROR_CODES` 열여섯 가지 — 는 이미 사람이 읽을
 * 문장으로 다시 쓰여 `emitFail` 로 나가므로, 버그 신고를 권할 대상이
 * 아니다 (clig Errors §1 대 §4). 세지 말고 그 목록을 보라: 여기 적힌 수는
 * 열일곱이었고 표에는 열여섯이 있었다.
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
