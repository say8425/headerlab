import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { GLOBAL_FLAGS } from './commands.mjs';
import { isSocketAlive, registryPathFor, socketPathFor } from './socket.mjs';

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
 * reason `packages/headerlab/lib/socket.mjs` takes `dir` as a parameter.
 */

export function withCode(error, code) {
  error.code = code;
  return error;
}

/**
 * 전역 플래그는 어느 한 명령의 문법이 아니라 CLI 전체의 것이므로 argv 어디에
 * 있어도 되고, `args.mjs` 의 `parse()` 가 보기 전에 걷힌다. `--bridge` 가
 * 원래 이렇게 동작했고, 나머지가 같은 취급을 받는다.
 *
 * 던지지 않는다. 이 함수가 던지면 `--help` 를 처리하기도 전에 죽는 경로가
 * 생기는데, 도움말은 문제가 있을 때 가장 필요한 것이다. 문제는 `error` 로
 * 실어 보내고 호출부가 도움말을 낼지 실패할지 정한다.
 */
// 표(`commands.mjs` 의 `GLOBAL_FLAGS`)에서 만든다. 손으로 적힌 사본이던
// 동안 도움말 쪽 사본과 갈라졌고 — `--no-input` 과 `--force` 가 파서에만
// 있었다 — 갈라진 것을 아무것도 빨갛게 만들지 않았다.
const BOOLEAN_GLOBALS = new Map(
  GLOBAL_FLAGS.filter((flag) => flag.arg === undefined).flatMap((flag) =>
    flag.names.map((name) => [name, flag.key]),
  ),
);

export function extractGlobals(argv) {
  const globals = {
    bridgePid: null,
    json: false,
    human: false,
    quiet: false,
    noColor: false,
    noInput: false,
    force: false,
    help: false,
    version: false,
    error: null,
  };
  const rest = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const boolean = BOOLEAN_GLOBALS.get(token);
    if (boolean !== undefined) {
      globals[boolean] = true;
      continue;
    }
    if (token === '--bridge') {
      const value = argv[i + 1];
      // 다음 토큰이 플래그면 **먹지 않는다**. 먹으면 `extractGlobals` 가
      // `rest` 에서도 지우므로 그 플래그는 통째로 사라진다 — 측정:
      // `headerlab --bridge --help` 가 도움말을 내지 않고 "needs a numeric
      // pid, got: --help" 로 2 를 냈다. 바로 아래 `main()` 의 주석은 그
      // 반대 방향(맨손 `--bridge` 의 에러가 도움말에 삼켜지는 것)만
      // 따졌었다.
      if (value === undefined || value.startsWith('-')) {
        globals.error ??= '--bridge needs a pid';
        continue;
      }
      i += 1;
      const pid = Number(value);
      if (!Number.isInteger(pid) || pid <= 0) {
        globals.error ??= `--bridge needs a numeric pid, got: ${value}`;
        continue;
      }
      globals.bridgePid = pid;
      continue;
    }
    rest.push(token);
  }

  // `bridge install` 이 `--extension-id` 와 `--load-path` 를 함께 주면 하나를
  // 골라 이기게 하지 않고 거부하는 것과 같은 모양이다(args.mjs) — 둘 다
  // "출력 형식을 정하는" 플래그이므로 하나를 조용히 이기게 두면 사용자가
  // 치지 않은 모드로 나갈 수 있다.
  if (globals.json && globals.human) {
    globals.error ??= 'headerlab takes --json or --human, not both';
  }

  return { globals, rest };
}

const REGISTRY_FILE = /^(\d+)\.json$/;

/**
 * Enumerates the registry directory `packages/headerlab/lib/socket.mjs` writes
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
// been written to a live socket. This default is still a guess rather than
// a measurement, but it is no longer an *unmeasurable* one: the extension
// adapter this comment used to say did not exist (lib/bridge/port.ts) is
// written, and tests/e2e/bridge.spec.ts's "a CLI command reaches storage
// through the bridge" drives a real round trip through a real host into a
// real Chrome. Nobody has pinned a latency number from it yet — that test
// proves correctness, not speed — so 10s stays a guess, just a checkable
// one now rather than an unfalsifiable one. It exists so a dead SW or a
// bridge stuck mid-handshake fails loudly instead of hanging the CLI
// forever. Callers may override it — the test suite does, to keep its
// timeout case fast.
export const DEFAULT_REPLY_TIMEOUT_MS = 10_000;

/**
 * Sends one command over an already-confirmed-live socket and waits for its
 * reply, correlated by request id.
 *
 * The host is a dumb relay: it broadcasts every extension reply to every
 * connected socket client with no request/response pairing of its own (by
 * design — see the host's task report, "no correlation" was flagged
 * there deliberately rather than solved there). Two concurrent `headerlab`
 * invocations against the same bridge would otherwise each read the
 * other's reply. Solving it here, with a per-command `id`, keeps the host a
 * protocol-agnostic relay: it cannot correlate anything without the
 * extension echoing an id back regardless, and pushing correlation into a
 * relay would make it a protocol participant instead of a pipe.
 *
 * CONTRACT WITH THE EXTENSION ADAPTER, `lib/bridge/port.ts`: the adapter
 * must echo the `id` field of the envelope it receives back unchanged on
 * its reply — `reply()` there does exactly that (`{id, ...result}`), and
 * `handleMessage` drops any message with no string id rather than replying
 * to nobody who could match it. Nothing on *this* side can enforce that the
 * other file honours the contract — the two live in different processes and
 * different languages, and this file still cannot see across that boundary
 * to check it directly — but it is no longer merely asserted, either:
 * tests/e2e/bridge.spec.ts drives a real `headerlab --bridge <pid> site add`
 * through a real host into a real Chrome and only gets back a reply that
 * correlates because the id actually round-trips. That is the contract
 * enforced end to end, from outside both files rather than from within
 * either one.
 *
 * `onSent` fires the moment the command's bytes have been handed to the
 * socket. Nothing here needs it — the caller does: `bin/headerlab.mjs` 의
 * SIGINT 핸들러가 "아무것도 전달되지 않았다" 를 조건 없이 찍고 있었고, 그
 * 문장은 명령이 이미 나간 뒤 Ctrl-C 를 눌렀을 때 거짓이었다. 그 사실을 아는
 * 유일한 자리가 여기이므로 여기서 알린다.
 */
export function sendCommand(
  socketPath,
  command,
  { timeoutMs = DEFAULT_REPLY_TIMEOUT_MS, slowAfterMs = 1000, onSlow, onSent } = {},
) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const socket = createConnection(socketPath);
    let buffer = '';
    let settled = false;

    function settle(action, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(slowTimer);
      socket.destroy();
      action(value);
    }

    // 측정된 결함: 브릿지가 연결을 받고 답하지 않으면 10초 동안 어느
    // 스트림에도 한 바이트도 나오지 않는다. 그 사이 유일한 신호는
    // 터미널이 안 돌아온다는 것뿐이다 (clig Robustness §2).
    const slowTimer = setTimeout(() => onSlow?.(timeoutMs), slowAfterMs);

    const timer = setTimeout(() => {
      settle(
        reject,
        withCode(new Error('the bridge accepted the connection but never replied'), 'timeout'),
      );
    }, timeoutMs);

    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id, command })}\n`);
      onSent?.();
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
    // the host's task report as something this file would need to
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
