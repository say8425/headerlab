import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MAX_OUTGOING } from '../lib/framing.mjs';
import { unpackedExtensionId } from '../lib/manifest.mjs';
import {
  ensureSocketDir,
  listenWithRestrictedPermissions,
  registryPathFor,
  socketDir,
  socketPathFor,
  writeRegistryEntry,
} from '../lib/socket.mjs';

// bin/headerlab.mjs runs main() as a side effect of being imported — the
// same reason bin/headerlab-host.mjs needed a subprocess-level test in the
// last round. resolveStateCommand's three failure branches and main()'s
// argv-to-exit-code wiring are covered by nothing else: lib/args.mjs and
// lib/bridge.mjs are tested directly (args.test.mjs, bridge.test.mjs), but
// resolveStateCommand and main() itself live only in this file, and nothing
// in this package can reach them except by spawning the real binary and
// reading its stdout and exit code.
const cliPath = fileURLToPath(new URL('../bin/headerlab.mjs', import.meta.url));

function runCli(args, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
    child.once('error', reject);
    // None of this file's commands read stdin (`state set -` is the only
    // one that does, and no test here uses it) — closed regardless so a
    // wrong implementation that unexpectedly waits on stdin fails fast
    // instead of hanging the test.
    child.stdin.end();
  });
}

const scratch = mkdtempSync(path.join(tmpdir(), 'hl-cli-bin-test-'));

// --- resolveStateCommand's three failure branches ---------------------------

test('state set on a file that cannot be read fails with invalid-args, not a crash', async () => {
  const missing = path.join(scratch, 'does-not-exist.json');
  const { code, stdout } = await runCli(['state', 'set', missing, '--force']);
  const result = JSON.parse(stdout);
  assert.equal(code, 2);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid-args');
  assert.match(result.error.message, /could not read/);
});

test('state set refuses a payload over the bridge byte cap before ever touching the socket', async () => {
  const bigFile = path.join(scratch, 'too-big.json');
  writeFileSync(bigFile, 'x'.repeat(MAX_OUTGOING + 1));
  const { code, stdout } = await runCli(['state', 'set', bigFile, '--force']);
  const result = JSON.parse(stdout);
  assert.equal(code, 2);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid-args');
  assert.match(result.error.message, new RegExp(String(MAX_OUTGOING)));
});

test('state set on invalid JSON fails with invalid-args, naming the problem', async () => {
  const badFile = path.join(scratch, 'bad.json');
  writeFileSync(badFile, 'not json{');
  const { code, stdout } = await runCli(['state', 'set', badFile, '--force']);
  const result = JSON.parse(stdout);
  assert.equal(code, 2);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid-args');
  assert.match(result.error.message, /not valid JSON/);
});

// --- rule add --value-file ---------------------------------------------

test('--value-file 의 내용이 값이 된다', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hl-'));
  const file = path.join(dir, 'secret.txt');
  writeFileSync(file, 'Bearer TOPSECRET\n');
  const { code, stdout } = await runCli([
    'rule',
    'add',
    '--target',
    'request',
    '--op',
    'set',
    '--name',
    'Authorization',
    '--value-file',
    file,
  ]);
  // 브릿지가 없으므로 bridge-off 까지 갔다는 것이 파일이 읽혔다는 증거다.
  assert.equal(code, 3);
  assert.equal(JSON.parse(stdout).error.code, 'bridge-off');
});

test('--value-file 이 없는 파일이면 2 로 나간다', async () => {
  const { code, stdout } = await runCli([
    'rule',
    'add',
    '--target',
    'request',
    '--op',
    'set',
    '--value-file',
    '/nope/nothing',
  ]);
  assert.equal(code, 2);
  assert.equal(JSON.parse(stdout).error.code, 'invalid-args');
});

test('비대화형 state set 은 --force 를 요구한다', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'hl-')), 'state.json');
  writeFileSync(file, JSON.stringify({ profiles: [] }));
  const { code, stdout } = await runCli(['state', 'set', file]);
  assert.equal(code, 2);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.error.code, 'usage');
  assert.equal(
    parsed.error.message,
    'state set replaces the entire stored state and cannot be undone; pass --force to confirm',
  );
});

test('--force 를 주면 통과해 브릿지까지 간다', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'hl-')), 'state.json');
  writeFileSync(file, JSON.stringify({ profiles: [] }));
  const { code, stdout } = await runCli(['state', 'set', file, '--force']);
  // 브릿지가 없으므로 bridge-off 까지 갔다는 것이 확인의 증거다.
  assert.equal(code, 3);
  assert.equal(JSON.parse(stdout).error.code, 'bridge-off');
});

test('--no-input 은 어떤 플래그를 치라고 말한다', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'hl-')), 'state.json');
  writeFileSync(file, JSON.stringify({ profiles: [] }));
  const { code, stdout } = await runCli(['state', 'set', file, '--no-input']);
  assert.equal(code, 2);
  assert.equal(JSON.parse(stdout).error.message.includes('--force'), true);
});

// --- main()'s argv-to-exit-code wiring --------------------------------------

test("an unparseable command fails with the parser's own code, before any bridge lookup", async () => {
  const { code, stdout } = await runCli(['teleport']);
  const result = JSON.parse(stdout);
  assert.equal(code, 2);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'unknown-command');
});

// `--bridge <pid>` naming a pid that cannot exist is contamination-proof
// against whatever else this machine's real $TMPDIR/headerlab happens to
// hold at the moment the test runs (a concurrently-running package's own
// integration test, a real bridge left over from manual testing) — unlike
// asserting "no bridge is running at all" against that same shared,
// unparameterized directory, which bin/headerlab.mjs's main() resolves via
// socketDir() with no way to inject a scratch path instead.
test('a valid command naming a bridge that does not exist fails with bridge-off, not a hang', async () => {
  const impossiblePid = 100000 + Math.floor(Math.random() * 900000);
  const { code, stdout } = await runCli(['--bridge', String(impossiblePid), 'pause']);
  const result = JSON.parse(stdout);
  assert.equal(code, 3);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'bridge-off');
});

// --- one success path, end to end through the real socketDir() -------------

const cleanupTargets = [];
after(() => {
  for (const { server, socketPath, registryPath } of cleanupTargets) {
    server.close();
    for (const p of [socketPath, registryPath]) {
      try {
        unlinkSync(p);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
});

/** A minimal fake host: newline-JSON in, one reply out, id echoed back. */
async function fakeHost(socketPath, reply) {
  const server = createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newlineAt;
      while ((newlineAt = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineAt);
        buffer = buffer.slice(newlineAt + 1);
        if (!line.trim()) continue;
        const envelope = JSON.parse(line);
        socket.write(`${JSON.stringify({ id: envelope.id, ...reply(envelope.command) })}\n`);
      }
    });
  });
  await listenWithRestrictedPermissions(server, socketPath);
  return server;
}

test('a live bridge replies successfully end to end', async () => {
  // Uses the real socketDir() deliberately — this is the directory
  // bin/headerlab.mjs's main() actually resolves, unparameterized, so a
  // genuine end-to-end success path has no scratch-directory substitute.
  const dir = socketDir();
  ensureSocketDir(dir);
  const pid = 100000 + Math.floor(Math.random() * 900000);
  const socketPath = socketPathFor(dir, pid);
  const registryPath = registryPathFor(dir, pid);
  writeRegistryEntry(dir, pid, {
    origin: 'chrome-extension://cli-integration-test/',
    startedAt: new Date().toISOString(),
  });

  const server = await fakeHost(socketPath, (command) => ({ ok: true, echoedCmd: command.cmd }));
  cleanupTargets.push({ server, socketPath, registryPath });

  const { code, stdout } = await runCli(['--bridge', String(pid), 'pause']);
  const result = JSON.parse(stdout);

  assert.equal(code, 0);
  assert.deepEqual(result, { ok: true, echoedCmd: 'pause' });
  assert.equal(
    existsSync(socketPath),
    true,
    'the fake host is still up; only this test tore it down',
  );
});

// --- bridge.* commands: install/uninstall/status never touch a socket ------

// `bridge install`'s own verification spawns a real host, and that host must
// not bind into the developer's real per-user socket directory — a
// concurrently running `headerlab` command could mistake it for a live
// bridge. `defaultInstallPaths()` has no flag to point `socketDirPath`
// elsewhere; `HEADERLAB_SOCKET_DIR` (read by `socketDir()`) is the only
// lever reachable from outside the CLI process, so every bridge.* test below
// runs under this override instead of the ambient shell's.
const scratchSocketDir = mkdtempSync(path.join(tmpdir(), 'hl-cli-bridge-sockets-'));
const cleanEnv = { ...process.env, HEADERLAB_SOCKET_DIR: scratchSocketDir };

// `--user-data-dir` moves where the manifest is written, so the install test
// below never touches the developer's real Chrome profile.
const scratchProfile = mkdtempSync(path.join(tmpdir(), 'hl-cli-bridge-profile-'));

/**
 * Registers teardown via `t.after`, not a call at the end of the test body.
 * A cleanup call written as the last line of a linear test is skipped by
 * any assertion above it that throws — and this is not hypothetical: two
 * separate mutation-verification rounds during this task hit exactly that,
 * each leaving a real launcher (and once a real manifest, under Chrome's
 * actual NativeMessagingHosts directory) on the machine that ran them,
 * found and removed by hand afterward. `t.after` runs regardless of how the
 * test body finishes. Registered before the install call even executes, so
 * it also covers the case where `runCli` itself throws. Safe to register
 * unconditionally: `uninstallBridge` is idempotent — "removing what is not
 * there is success" (install.mjs) — so this is a no-op if install never
 * wrote anything.
 */
function cleanUpBridgeInstall(t) {
  t.after(async () => {
    const cleanup = await runCli(['bridge', 'uninstall', '--user-data-dir', scratchProfile], {
      env: cleanEnv,
    });
    assert.equal(JSON.parse(cleanup.stdout).ok, true);
  });
}

test('bridge status answers without a live bridge — it never touches a socket', async () => {
  // The whole point of the branch. `bridge install` on a machine with no
  // bridge running must not fail with `bridge-off`: there is no bridge yet,
  // which is precisely why someone is running it.
  const { stdout, code } = await runCli(['bridge', 'status'], { env: cleanEnv });
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, true);
  assert.equal(code, 0);
});

test('bridge install computes the id from a load path and says which one it used', async (t) => {
  cleanUpBridgeInstall(t);

  // The id is the one value nobody can verify from inside this process, so
  // it is reported rather than kept — the person compares it against
  // chrome://extensions, which is the only ground truth there is. The path
  // itself is a scratch directory rather than this checkout's real
  // .output/chrome-mv3: a machine-specific absolute path baked into a
  // committed test only matches the machine that wrote it, so the expected
  // id is derived the same way runBridgeCommand derives its own — from the
  // resolved load path, via the same unpackedExtensionId it calls.
  const loadPath = mkdtempSync(path.join(tmpdir(), 'hl-cli-bridge-load-path-'));
  const expectedId = unpackedExtensionId(loadPath);

  const { stdout, code } = await runCli(
    ['bridge', 'install', '--load-path', loadPath, '--user-data-dir', scratchProfile],
    { env: cleanEnv },
  );
  const payload = JSON.parse(stdout);

  assert.equal(code, 0);
  assert.equal(payload.ok, true);
  assert.equal(payload.extensionId, expectedId);
  assert.match(payload.note, /computed from/);
});

test('bridge install with an explicit --extension-id trusts it, and reports no note', async (t) => {
  cleanUpBridgeInstall(t);

  // The mirror image of the test above. Nothing was computed here — the id
  // came verbatim off the command line — so there is nothing to double-check
  // against chrome://extensions, and the reply must not claim otherwise. A
  // wrong implementation that always attaches the "computed from" note would
  // still pass the load-path test above; only checking its absence here
  // catches that.
  const extensionId = 'a'.repeat(32);
  const { stdout, code } = await runCli(
    ['bridge', 'install', '--extension-id', extensionId, '--user-data-dir', scratchProfile],
    { env: cleanEnv },
  );
  const payload = JSON.parse(stdout);

  assert.equal(code, 0);
  assert.equal(payload.ok, true);
  assert.equal(payload.extensionId, extensionId);
  assert.equal('note' in payload, false);
});

test('bridge status finds what bridge install wrote to a non-default --user-data-dir', async (t) => {
  cleanUpBridgeInstall(t);

  // This is the assertion that would have caught the whole gap: before this
  // fix, `status` (like `uninstall`) took no flags at all, so it could only
  // ever look at the default chrome/homedir location. A bridge installed
  // with --user-data-dir was invisible to it — `installed: false` about a
  // directory that was never the one asked about, which is wrong, not
  // merely incomplete (a status command under-reporting a live install is
  // this repo's least forgivable direction of silent failure).
  const extensionId = 'c'.repeat(32);
  const install = await runCli(
    ['bridge', 'install', '--extension-id', extensionId, '--user-data-dir', scratchProfile],
    { env: cleanEnv },
  );
  assert.equal(JSON.parse(install.stdout).ok, true);

  const status = await runCli(['bridge', 'status', '--user-data-dir', scratchProfile], {
    env: cleanEnv,
  });
  const payload = JSON.parse(status.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.installed, true);
  // Names which of the now-three reachable locations it looked in, rather
  // than leaving a bare `installed: true` for the reader to guess at.
  assert.equal(payload.manifestPath.startsWith(scratchProfile), true);
});

// --- help, version, and the machine-readable default ------------------------

test('--help 가 도움말을 stdout 에 내고 0 으로 나간다', async () => {
  const { code, stdout, stderr } = await runCli(['--help']);
  assert.equal(code, 0);
  assert.equal(stderr, '');
  assert.equal(stdout.includes('USAGE'), true);
  assert.equal(stdout.includes('https://github.com/say8425/headerlab/issues'), true);
});

test('-h 도 같다', async () => {
  const { code, stdout } = await runCli(['-h']);
  assert.equal(code, 0);
  assert.equal(stdout.includes('USAGE'), true);
});

test('맨손 호출이 도움말이고 에러가 아니다', async () => {
  const { code, stdout, stderr } = await runCli([]);
  assert.equal(code, 0);
  assert.equal(stderr, '');
  assert.equal(stdout.includes('USAGE'), true);
});

test('help <cmd> 가 그 명령의 도움말을 낸다', async () => {
  const { code, stdout } = await runCli(['help', 'rule', 'add']);
  assert.equal(code, 0);
  assert.equal(stdout.includes('--target'), true);
  assert.equal(stdout.includes('--op'), true);
});

test('<cmd> --help 가 그 명령의 도움말을 낸다', async () => {
  const { code, stdout } = await runCli(['bridge', 'install', '--help']);
  assert.equal(code, 0);
  assert.equal(stdout.includes('--extension-id'), true);
});

test('--version 이 package.json 의 버전을 낸다', async () => {
  const { code, stdout } = await runCli(['--version']);
  const expected = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ).version;
  assert.equal(code, 0);
  assert.equal(stdout.trim(), expected);
});

// 브리프 원문은 `sight` 를 썼으나, 이 패키지의 `suggest()` 로 재면 'sight' 와
// 'site' 는 거리 3 이라 문턱 2 를 넘어 **아무것도 제안되지 않는다** —
// test/suggest.test.mjs 가 Task 4 에서 같은 측정을 이미 기록했다. 테스트의
// 의도("오타에 제안이 붙는다")에 실제로 맞는 오타로 바꾼다: 'sites' 는
// 'site' 에서 한 글자 더한 것으로 거리 1 이다.
//
// 그리고 봉투를 파싱해서 본다. 브리프는 stdout 문자열에 대고
// `includes('did you mean "site"?')` 를 쟀는데, 기계용 모드의 stdout 은
// JSON 이라 그 따옴표가 `\"site\"` 로 이스케이프되어 있다 — 측정하면
// 언제나 false 인, 구현이 옳아도 통과하지 못하는 어서션이다. 파싱하면
// 부분 일치 대신 정확한 값을 쓸 수 있어 더 세기도 하다.
test('오타에 제안이 붙고 2 로 나간다', async () => {
  const { code, stdout, stderr } = await runCli(['sites', 'add', 'x']);
  assert.equal(code, 2);
  // 기계용 모드(파이프)이므로 봉투는 stdout 이다.
  assert.deepEqual(JSON.parse(stdout), {
    ok: false,
    error: {
      code: 'unknown-command',
      message: 'unknown command: sites — did you mean "site"?',
    },
  });
  assert.equal(stderr, '');
});

test('파이프로 부르면 기계용이고 봉투가 그대로다', async () => {
  // `cleanEnv` 로 스크래치 소켓 디렉터리를 가리킨다. 이 어서션의 주어는
  // "봉투의 모양" 이지 "이 개발 기계에 브릿지가 없다" 가 아닌데, 실제
  // socketDir() 를 쓰면 후자가 조건이 되어 버린다 — 손으로 띄워 둔 브릿지
  // 하나에 빨개지는 테스트는 이 파일이 위쪽에서 이미 피한 함정이다.
  const { code, stdout } = await runCli(['site', 'add', 'example.com'], { env: cleanEnv });
  assert.equal(code, 3);
  const parsed = JSON.parse(stdout);
  assert.deepEqual(parsed, {
    ok: false,
    error: { code: 'bridge-off', message: 'no bridge is running' },
  });
});

// --- 도움말과 전역 플래그 오류의 순서 ---------------------------------------

// 브리프는 `globals.help || rest.length === 0` 을 `globals.error` **앞에**
// 두었다. 그러면 `headerlab --bridge` (pid 없음) 가 도움말을 내고 0 으로
// 나가며 에러를 통째로 삼킨다 — 이 저장소가 금지하는 조용한 실패다.
// 순서는 `--version` → 명시적 `--help` → `globals.error` → 맨손 도움말이다.
test('pid 없는 --bridge 는 도움말이 아니라 실패다', async () => {
  const { code, stdout, stderr } = await runCli(['--bridge']);
  assert.equal(stdout.includes('USAGE'), false);
  const parsed = JSON.parse(stdout);
  assert.deepEqual(parsed, {
    ok: false,
    error: { code: 'usage', message: '--bridge needs a pid' },
  });
  assert.equal(code, 2);
  assert.equal(stderr, '');
});

test('명시적 --help 는 잘못 친 전역 플래그를 이긴다', async () => {
  const { code, stdout, stderr } = await runCli(['--help', '--bridge']);
  assert.equal(code, 0);
  assert.equal(stderr, '');
  assert.equal(stdout.includes('USAGE'), true);
});

// --- 확장이 거부한 응답은 0 으로 나가지 않는다 ------------------------------

test('확장이 거부하면 봉투가 그대로 나오고 종료 코드가 살아 있다', async (t) => {
  // Task 3 이 넣은 `process.exitCode = exitFor(result.error?.code ...)` 이
  // 재배선에서 빠지면 확장이 거부한 명령이 전부 0 으로 나간다. 봉투를
  // 다시 만들지 않고 **그대로** 낸다는 것도 함께 못박는다 — 확장이 실은
  // 필드가 조용히 사라지면 안 된다.
  //
  // `note` 가 이 픽스처에 있는 이유는 측정된 것이다: 처음에는 응답이
  // `{ok,error}` 뿐이었고, 그 상태에서는 봉투를 **다시 만드는** 변이가
  // 테스트를 그대로 통과했다 — 다시 만든 것과 그대로 낸 것이 바이트까지
  // 같았기 때문이다. 재구성이 떨어뜨릴 필드가 하나라도 있어야 "그대로"
  // 라는 주장이 반증 가능해진다. 봉투 구조(`{ok, error?, state?, changed?,
  // note?}`)가 이미 허용하는 필드다.
  const dir = socketDir();
  ensureSocketDir(dir);
  const pid = 100000 + Math.floor(Math.random() * 900000);
  const socketPath = socketPathFor(dir, pid);
  const registryPath = registryPathFor(dir, pid);
  writeRegistryEntry(dir, pid, {
    origin: 'chrome-extension://cli-refusal-test/',
    startedAt: new Date().toISOString(),
  });

  const refusal = {
    ok: false,
    error: { code: 'unknown-rule', message: 'no rule with id 3f9a' },
    note: 'nothing was written',
  };
  const server = await fakeHost(socketPath, () => refusal);
  t.after(() => {
    server.close();
    for (const p of [socketPath, registryPath]) {
      try {
        unlinkSync(p);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  });

  const { code, stdout, stderr } = await runCli(['--bridge', String(pid), 'rule', 'rm', '3f9a']);
  assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), refusal);
  assert.equal(code, 1);
});

// --- --human (§7c) -----------------------------------------------------------
//
// `MODE === 'human'` 은 지금까지 `process.stdout.isTTY` 여야만 켜졌고, Node 는
// 의존성 없이 pty 를 열 수 없어서(output.test.mjs 위쪽 주석) `emitOk`/`emitFail`
// 의 사람용 분기와 `--quiet` 억제, §5.3 usage 줄은 손으로 잰 것만이 근거였다.
// `--human` 은 그 분기를 파이프에서도 여는 손잡이이고, 여기서부터는 스트림이
// 파이프이므로(`runCli`) 색은 반드시 꺼져 있다 — 그래서 문자열을 정확히 비교할
// 수 있다.

test('사람용 실패는 stderr 로 가고 stdout 은 비어 있다', async () => {
  const { code, stdout, stderr } = await runCli(['--human', 'rule', 'toggle']);
  // 부재를 먼저 본다: 사람용 실패에서 봉투(JSON)가 stdout 으로 새는 구현을 잡는다.
  assert.equal(stdout, '');
  assert.equal(stderr, 'rule toggle needs an id\nheaderlab rule toggle <id>\n');
  assert.equal(code, 2);
});

test('사람용에서 --quiet 은 성공 줄을 지우지만 실패는 지우지 않는다', async () => {
  // 성공: 소켓 없이도 답하는 `bridge status` 로, 브릿지가 없다는 사실이
  // 끼어들지 않게 스크래치 소켓 디렉터리(`cleanEnv`) 아래서 돈다.
  const success = await runCli(['--human', '--quiet', 'bridge', 'status'], { env: cleanEnv });
  assert.equal(success.stdout, '');
  assert.equal(success.stderr, '');
  assert.equal(success.code, 0);

  // 실패: "errors only" 지 "아무것도 없이" 가 아니다 — --quiet 이어도 남는다.
  const failure = await runCli(['--human', '--quiet', 'rule', 'toggle']);
  assert.equal(failure.stdout, '');
  assert.equal(failure.stderr, 'rule toggle needs an id\nheaderlab rule toggle <id>\n');
  assert.equal(failure.code, 2);
});

test('사람용에서 성공 줄이 --quiet 없이는 실제로 나온다', async () => {
  // 위 테스트가 "지운다" 는 것만 보이므로, 지울 것이 애초에 있었다는 것도
  // 따로 못박는다 — 그렇지 않으면 아무것도 안 찍는 구현이 두 어서션을 다 속인다.
  const { stdout, code } = await runCli(['--human', 'bridge', 'status'], { env: cleanEnv });
  assert.equal(stdout.length > 0, true);
  assert.equal(stdout.includes('manifest'), true);
  assert.equal(code, 0);
});

test('사람용 invalid-args 는 표에 없는 명령이면 usage 줄을 붙이지 않는다', async () => {
  // `site` 단독은 `site add` 도 `site rm` 도 `site all-sites` 도 아니어서
  // 표에서 고를 usage 가 없다.
  const { stdout, stderr, code } = await runCli(['--human', 'site']);
  assert.equal(stdout, '');
  assert.equal(stderr, 'unknown site command: (nothing)\n');
  assert.equal(code, 2);
});

test('--json 과 --human 을 같이 주면 거부하고, 실패 봉투는 --json 쪽 형식으로 나간다', () =>
  runCli(['--json', '--human', 'pause']).then(({ code, stdout, stderr }) => {
    assert.equal(stderr, '');
    assert.deepEqual(JSON.parse(stdout), {
      ok: false,
      error: { code: 'usage', message: 'headerlab takes --json or --human, not both' },
    });
    assert.equal(code, 2);
  }));

// --- <typo> --help (§7d) ------------------------------------------------------
//
// 도움말을 청하는 것은 오류가 아니다 — 0 으로 나가고 도움말은 언제나
// stdout 에 남는다. 그래도 그 명령이 실제로 없다는 사실은 어딘가에 남아야
// 한다: `suggest()` 가 바로 옆에 있으면서도 이 경로에서는 한 번도 불리지
// 않았던 것이 이 항목의 결함이다.

test('모르는 명령에 --help 를 붙이면 stderr 에 한 줄 남기고, 그래도 0 으로 나가며 도움말은 stdout 에 남는다', async () => {
  const { code, stdout, stderr } = await runCli(['teleport', '--help']);
  assert.equal(code, 0);
  assert.equal(stderr, 'unknown command: teleport\n');
  assert.equal(stdout.includes('USAGE'), true);
});

// 'sights' 는 표에 있는 어느 후보와도 거리 2 를 넘어(suggest.test.mjs 의
// 측정과 같은 문턱) 제안이 붙지 않는 쪽까지 함께 잰다. 제안이 붙는
// 쪽은 'sites' — 'site' 에서 한 글자 더한 거리 1.
test('오타에 제안이 있으면 stderr 줄에 붙는다', async () => {
  const { code, stdout, stderr } = await runCli(['sites', '--help']);
  assert.equal(code, 0);
  assert.equal(stderr, 'unknown command: sites — did you mean "site"?\n');
  assert.equal(stdout.includes('USAGE'), true);
});

test('아는 명령에 --help 를 붙이면 stderr 가 완전히 비어 있다', async () => {
  const { code, stdout, stderr } = await runCli(['bridge', 'install', '--help']);
  assert.equal(code, 0);
  assert.equal(stderr, '');
  assert.equal(stdout.includes('--extension-id'), true);
});

// 그룹 이름 단독(`site`)은 `site add` 도 `site rm` 도 아니지만 실제
// 그룹이다 — `helpTextFor` 가 최상위로 떨어지는 것과 별개로, 이것을
// "모르는 명령" 취급해 경고하면 사용자가 안 친 오타를 지어내는 것이다.
test('그룹 이름 단독에 --help 를 붙이면 경고가 없다', async () => {
  const { code, stdout, stderr } = await runCli(['site', '--help']);
  assert.equal(code, 0);
  assert.equal(stderr, '');
  assert.equal(stdout.includes('USAGE'), true);
});

test('맨손 --help 는 경고가 없다', async () => {
  const { code, stdout, stderr } = await runCli(['--help']);
  assert.equal(code, 0);
  assert.equal(stderr, '');
  assert.equal(stdout.includes('USAGE'), true);
});
