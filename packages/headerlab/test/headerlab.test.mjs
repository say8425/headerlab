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

function runCli(args, { env = process.env, nodeArgs = [], onStderr = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...nodeArgs, cliPath, ...args], {
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
      // 자식이 **끝나기 전에** stderr 를 읽어야 하는 테스트가 하나 있다:
      // 기다린다는 줄은 명령이 아직 매달려 있는 동안 나오는 것이 전부이므로,
      // 그것을 본 뒤에 매달림을 풀어 주어야 10초를 기다리지 않는다.
      onStderr?.(stderr);
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
function replyHandler(reply) {
  return (socket) => {
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
  };
}

async function fakeHost(socketPath, reply) {
  const server = createServer(replyHandler(reply));
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

// `previewInstall`'s own docblock names the `--load-path` id-mismatch trap as
// its reason for existing, but until now only the real install path attached
// the note that explains it — the dry run showed the computed id with none
// of the warning that makes checking it necessary. Two tests, absence first:
// a wrong implementation that always attaches the note would still pass the
// load-path one below; only checking absence under --extension-id catches it.
test('bridge install --dry-run with an explicit --extension-id reports no note', async () => {
  const extensionId = 'b'.repeat(32);
  const { stdout, code } = await runCli([
    'bridge',
    'install',
    '--extension-id',
    extensionId,
    '--dry-run',
    '--user-data-dir',
    scratchProfile,
  ]);
  const payload = JSON.parse(stdout);

  assert.equal(code, 0);
  assert.equal(payload.ok, true);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.extensionId, extensionId);
  assert.equal('note' in payload, false);
});

test('bridge install --dry-run with a --load-path carries the same computed-id note the real install gives', async () => {
  const loadPath = mkdtempSync(path.join(tmpdir(), 'hl-cli-bridge-dryrun-load-path-'));
  const expectedId = unpackedExtensionId(loadPath);

  const { stdout, code } = await runCli([
    'bridge',
    'install',
    '--load-path',
    loadPath,
    '--dry-run',
    '--user-data-dir',
    scratchProfile,
  ]);
  const payload = JSON.parse(stdout);

  assert.equal(code, 0);
  assert.equal(payload.ok, true);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.extensionId, expectedId);
  assert.match(payload.note, /computed from/);
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

// 그룹은 맞는데 그 아래 서브커맨드가 없는 경우(`headerlab site bogus`)는
// `warnIfUnknown` 이 `GROUPS.includes(argv[0])` 에서 곧장 멈추던 예전
// 구현에서 조용히 최상위 도움말로 떨어졌다 — 셋째 갈래를 두 방향에서 잰다:
// 제안이 없는 경우와, `suggest()` 가 그 그룹 소속 서브커맨드 안에서 찾아
// 붙이는 경우.
test('실제 그룹 아래 모르는 서브커맨드에 --help 를 붙이면 stderr 에 한 줄 남긴다', async () => {
  const { code, stdout, stderr } = await runCli(['site', 'bogus', '--help']);
  assert.equal(code, 0);
  assert.equal(stderr, 'unknown site command: bogus\n');
  assert.equal(stdout.includes('USAGE'), true);
});

test('그 서브커맨드 오타에 제안이 있으면 stderr 줄에 붙고, 후보는 그 그룹 소속뿐이다', async () => {
  // 'ad' 는 site 소속 네 후보(ls·add·rm·all-sites) 안에서 'add' 와 거리 1 —
  // 최상위 오타 제안(GROUPS·allPaths)이 대신 끼어들면 다른 답이 나온다.
  const { code, stdout, stderr } = await runCli(['site', 'ad', '--help']);
  assert.equal(code, 0);
  assert.equal(stderr, 'unknown site command: ad — did you mean "add"?\n');
  assert.equal(stdout.includes('USAGE'), true);
});

test('맨손 --help 는 경고가 없다', async () => {
  const { code, stdout, stderr } = await runCli(['--help']);
  assert.equal(code, 0);
  assert.equal(stderr, '');
  assert.equal(stdout.includes('USAGE'), true);
});

// --- 읽기 명령 넷: 종료 코드 표의 의도적 예외 하나 --------------------------

test('status 는 브릿지가 없어도 0 으로 나가고 사실을 보고한다', async () => {
  // `git status` 가 커밋 없는 저장소에서 그렇게 하듯이. 다른 어떤 명령도
  // 이 예외를 갖지 않는다 — 바로 아래 테스트가 그 경계를 지킨다.
  const { code, stdout, stderr } = await runCli(['status'], { env: cleanEnv });
  assert.equal(stderr, '');
  assert.equal(code, 0);
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.live, false);
  // 브릿지가 없으니 확장의 상태는 오지 않는다. 있는 척하는 필드가 봉투에
  // 섞이면 `jq .state` 가 조용히 `null` 을 받는다.
  assert.equal('state' in payload, false);
  // 소켓 없이도 아는 절반 — 매니페스트가 어디에 있고 설치돼 있는지 — 은
  // 그대로 실려 있다. `installed` 의 **값**은 이 기계에 무엇이 깔려 있는지에
  // 달렸으므로 재지 않는다: 브릿지를 실제로 설치해 둔 개발자에게만 빨개지는
  // 어서션은 이 파일이 위쪽에서 이미 피한 함정이다.
  assert.equal(typeof payload.manifestPath, 'string');
  assert.equal(typeof payload.launcherPath, 'string');
  assert.equal(typeof payload.installed, 'boolean');
});

// 예외는 `status` 하나다. 나머지 셋은 브릿지가 없으면 3 으로 나간다 —
// `cmd` 만 보고 분기하는 구현(넷이 다 `{cmd:'status'}` 다)은 여기서
// 빨개진다.
test('나머지 읽기 셋은 브릿지가 없으면 여전히 bridge-off 다', async () => {
  for (const argv of [
    ['rule', 'ls'],
    ['site', 'ls'],
    ['state', 'get'],
  ]) {
    const { code, stdout } = await runCli(argv, { env: cleanEnv });
    assert.deepEqual(
      JSON.parse(stdout),
      { ok: false, error: { code: 'bridge-off', message: 'no bridge is running' } },
      argv.join(' '),
    );
    assert.equal(code, 3, argv.join(' '));
  }
});

test('사람용 status 는 브릿지 줄을 내고 나머지를 지어내지 않는다', async () => {
  const { code, stdout, stderr } = await runCli(['--human', 'status'], { env: cleanEnv });
  assert.equal(stderr, '');
  assert.equal(code, 0);
  assert.equal(stdout.includes('bridge    not running'), true);
  assert.equal(stdout.includes('headers   '), false);
});

/**
 * 살아 있는 브릿지가 답하는 status payload. `lib/bridge/query.ts` 의
 * `StatusPayload` 모양 그대로다.
 */
const fakeStatus = {
  ok: true,
  state: { version: 2, globalPause: false, profiles: [] },
  profile: {
    id: 'p1',
    filter: { domains: ['a.com'], allSites: false },
    headers: [
      { id: 'r1', enabled: true, target: 'request', operation: 'set', name: 'A', value: '1' },
    ],
  },
  diagnostics: { byRow: [], byHost: [], scope: [] },
  tally: { total: 1, live: 1, off: 0, unfinished: 0, blocked: 0 },
  scopingHosts: ['a.com'],
  suppression: null,
  requiredOrigins: ['https://a.com/*'],
  globalPause: false,
};

const BRIDGE_ORIGIN = 'chrome-extension://cli-read-test/';

/**
 * 소켓·레지스트리를 `dir` 에 띄우고 pid 를 돌려준다. 정리는 `t.after` 에
 * 건다 — 어서션이 중간에 실패하면 그 뒤의 정리 호출은 실행되지 않으므로
 * (CLAUDE.md, 설치기 변이 테스트 항목).
 *
 * 연결 핸들러를 인자로 받는 이유는 답하는 브릿지만이 검사 대상이 아니기
 * 때문이다: 연결은 받고 답하지 않는 브릿지도, 둘이 동시에 떠 있는 것도
 * `status` 가 구분해야 하는 서로 다른 사실이다.
 */
async function bridgeAt(t, dir, onConnection) {
  ensureSocketDir(dir);
  const pid = 100000 + Math.floor(Math.random() * 900000);
  const socketPath = socketPathFor(dir, pid);
  const registryPath = registryPathFor(dir, pid);
  writeRegistryEntry(dir, pid, {
    origin: BRIDGE_ORIGIN,
    startedAt: new Date().toISOString(),
  });
  const server = createServer(onConnection);
  await listenWithRestrictedPermissions(server, socketPath);
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
  return pid;
}

/** 진짜 socketDir() 에 뜨는, 답하는 브릿지. */
function liveFakeBridge(t, reply) {
  return bridgeAt(t, socketDir(), replyHandler(reply));
}

/** 이 파일의 다른 브릿지 테스트와 섞이지 않는 빈 소켓 디렉터리 하나. */
function freshSocketEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), 'hl-cli-status-sockets-'));
  return { dir, env: { ...process.env, HEADERLAB_SOCKET_DIR: dir } };
}

// 넷이 같은 `{cmd:'status'}` 를 보내고 **렌더만 다르다** 는 주장은 여기서만
// 끝까지 검사된다: 명령 경로가 `findCommand` 에서 나와 `renderResult` 까지
// 이어지는 배선은 프로세스 밖에서 볼 수 없다.
test('살아 있는 브릿지에서 읽기 셋이 같은 쿼리를 보내고 서로 다르게 그린다', async (t) => {
  const sent = [];
  const pid = await liveFakeBridge(t, (command) => {
    sent.push(command);
    return fakeStatus;
  });

  const rules = await runCli(['--human', '--bridge', String(pid), 'rule', 'ls']);
  assert.equal(rules.code, 0);
  assert.equal(rules.stdout, 'r1  on   request  set  A → 1\n');

  const sites = await runCli(['--human', '--bridge', String(pid), 'site', 'ls']);
  assert.equal(sites.stdout, 'a.com\n');

  const state = await runCli(['--human', '--bridge', String(pid), 'state', 'get']);
  assert.equal(state.stdout, `${JSON.stringify(fakeStatus.state, null, 2)}\n`);

  const status = await runCli(['--human', '--bridge', String(pid), 'status']);
  assert.equal(status.stdout.includes('bridge    live'), true);
  assert.equal(status.stdout.includes('rules     1 total, 1 on'), true);

  assert.deepEqual(sent, [
    { cmd: 'status' },
    { cmd: 'status' },
    { cmd: 'status' },
    { cmd: 'status' },
  ]);
});

// 브릿지가 **답했는데 거부한** 것은 "브릿지가 없다" 와 다른 사실이다.
// exit 0 예외를 `status` 전체에 두면 읽을 수 없는 저장소가 "not running"
// 으로 조용히 번역된다 — 이 저장소가 금지하는 그 모양이다.
test('status 는 브릿지가 거부한 응답을 삼키지 않는다', async (t) => {
  const refusal = {
    ok: false,
    error: { code: 'store-unreadable', message: 'the stored state does not match' },
  };
  const pid = await liveFakeBridge(t, () => refusal);

  const { code, stdout, stderr } = await runCli(['--bridge', String(pid), 'status']);
  assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), refusal);
  assert.equal(code, 1);
});

// 거부한 응답과 같은 이유로, **던져진** 실패도 삼키지 않는다. `catch {}` 는
// `bridge-off` 만이 아니라 `resolveTarget`/`sendCommand` 가 내는 코드 전부를
// "not running" 으로 번역하고, 그 봉투는 스스로 모순된다 — `liveBridges` 가
// 세고 있는 브릿지를 같은 줄에서 `live:false` 라고 부른다. 아래 셋이 그
// 갈래 하나씩이며, `catch {}` 로 되돌리면 셋 다 빨개진다.
//
// `timeout` 은 여기서 재지 않는다. 그 코드는 `bridge.test.mjs` 가 짧은
// `timeoutMs` 로, 그 코드의 종료 코드 4 는 `exit.test.mjs` 가 이미 못박고
// 있고, CLI 밖에서 그 타이머를 줄일 방법이 없어 이 파일에 넣으면 실제로
// 10초를 기다린다 (측정: 이 패키지의 전체 스위트가 7.9초다). 갈래는
// `bridge-closed` 가 같은 `catch` 의 같은 줄로 지나가며 즉시 증명한다.
test('status 는 답하지 않는 브릿지를 not running 이라 부르지 않는다', async (t) => {
  const { dir, env } = freshSocketEnv();
  // 명령을 **받고** 나서 끊는다 — `isSocketAlive` 에는 살아 있고, 쓰기는
  // 성공하고, 답 없이 닫히므로 `sendCommand` 에게는 `bridge-closed` 다.
  // (받기 전에 끊으면 쓰기가 EPIPE 로 죽는다 — 바로 아래 테스트가 그쪽이다.)
  const pid = await bridgeAt(t, dir, (socket) => socket.once('data', () => socket.destroy()));

  const { code, stdout, stderr } = await runCli(['--bridge', String(pid), 'status'], { env });
  assert.equal(stderr, '');
  const payload = JSON.parse(stdout);
  // 부재 먼저: 성공 봉투의 필드가 하나도 실려 나가지 않는다.
  assert.equal('live' in payload, false);
  assert.equal('liveBridges' in payload, false);
  assert.deepEqual(payload, {
    ok: false,
    error: {
      code: 'bridge-closed',
      message: 'the bridge closed the connection before replying',
    },
  });
  assert.equal(code, 4);
});

// 소켓이 **날것의 errno** 를 던지는 갈래. 측정: 연결하자마자 끊는 호스트에
// 명령을 쓰면 5/5 로 `EPIPE` 다. 그 문자열이 그대로 봉투에 실리면 `error.code`
// 가 `ERROR_CODES` 밖의 값이 되고 — 읽는 쪽이 분기할 것이 없다 — 종료 코드는
// 기본값 1, 즉 "목적지가 요청을 거부했다" 가 된다. 목적지에 닿은 적이 없는데도.
test('status 는 소켓 errno 를 봉투에 그대로 흘리지 않는다', async (t) => {
  const { dir, env } = freshSocketEnv();
  const pid = await bridgeAt(t, dir, (socket) => socket.destroy());

  const { code, stdout, stderr } = await runCli(['--bridge', String(pid), 'status'], { env });
  assert.equal(stderr, '');
  const payload = JSON.parse(stdout);
  assert.equal('live' in payload, false);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'bridge-error');
  assert.equal(code, 4);
  // 메시지는 errno 의 것 그대로 나간다 — 어느 errno 였는지는 사람이 여전히
  // 읽을 수 있어야 한다. 정확한 문자열은 커널이 정하므로(`write EPIPE`,
  // `read ECONNRESET`) 값이 아니라 비어 있지 않음을 잰다.
  assert.equal(typeof payload.error.message, 'string');
  assert.equal(payload.error.message.length > 0, true);
});

// errno 를 접는 것은 `status` 만의 규칙이 아니다. 같은 소켓 실패가 명령마다
// 다른 코드로 나가면 — `status` 는 `bridge-error`(4), `pause` 는 `EPIPE`(1) —
// 봉투를 읽는 쪽은 명령별 표를 갖고 있어야 한다. 두 자리가 같은 함수를 쓰는지
// 검사하는 것은 여기뿐이다.
test('소켓 errno 를 접는 규칙은 status 만의 것이 아니다', async (t) => {
  const { dir, env } = freshSocketEnv();
  const pid = await bridgeAt(t, dir, (socket) => socket.destroy());

  const { code, stdout } = await runCli(['--bridge', String(pid), 'pause'], { env });
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'bridge-error');
  assert.equal(code, 4);
});

test('status 는 브릿지가 둘이면 하나를 고르지도, 없다고 하지도 않는다', async (t) => {
  const { dir, env } = freshSocketEnv();
  const first = await bridgeAt(
    t,
    dir,
    replyHandler(() => fakeStatus),
  );
  const second = await bridgeAt(
    t,
    dir,
    replyHandler(() => fakeStatus),
  );

  const { code, stdout, stderr } = await runCli(['status'], { env });
  assert.equal(stderr, '');
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'multiple-bridges');

  // 두 pid 를 **둘 다** 댄다. 디렉터리 열거 순서는 정해져 있지 않으므로
  // 줄을 정렬해 비교한다 — `includes` 로 느슨하게 재면 한쪽만 대는 구현이
  // 통과한다.
  const [head, ...rows] = payload.error.message.split('\n');
  assert.equal(head, 'more than one bridge is running — pick one with --bridge <pid>:');
  assert.deepEqual(
    rows.sort(),
    [first, second].map((pid) => `  pid ${pid} (${BRIDGE_ORIGIN})`).sort(),
  );
  assert.equal(code, 3);
});

// 리포트의 concern #2 를 결정으로 바꾼다. `--bridge <pid>` 는 "이 브릿지에
// 말하라" 는 지목이므로, 그 브릿지가 없는 것은 "브릿지가 하나도 없다" 와
// 다른 사실이다 — 특히 다른 브릿지가 살아 있을 때 exit 0 으로 "not running"
// 이라 답하면 같은 봉투의 `liveBridges` 가 그것을 세고 있는 채로 지목이
// 무시된 것처럼 보인다. exit 0 예외는 아무것도 지목하지 않은 경우까지다.
test('status 는 지목한 pid 가 없으면 지목을 무시하지 않는다', async (t) => {
  const { dir, env } = freshSocketEnv();
  const alive = await bridgeAt(
    t,
    dir,
    replyHandler(() => fakeStatus),
  );

  const { code, stdout, stderr } = await runCli(['--bridge', String(alive + 1), 'status'], { env });
  assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), {
    ok: false,
    error: { code: 'bridge-off', message: `no live bridge with pid ${alive + 1}` },
  });
  assert.equal(code, 3);
});

// 답하지 않는 브릿지 앞에서 `status` 는 10초 동안 어느 스트림에도 한 바이트도
// 내지 않았다. `sendCommand` 의 `onSlow` — 그 침묵을 재서 만든 안전장치 — 가
// `main` 의 send 자리에만 달려 있었고 `runStatus` 는 옵션 없이 불렀기 때문이다.
// 같은 상황에서 `pause` 는 1초 뒤 줄을 내는데, 사람이 가장 많이 치는 명령만
// 조용했다. 이제 두 자리가 하나(`send`)이므로 갈라질 자리가 없다.
//
// pty 없이 사람용 stderr 분기를 켜는 방법: 자식의 `process.stderr.isTTY` 를
// preload 한 줄로 켠다. 진짜 pty 는 이 러너에서 열 수 없고(output.test.mjs
// 의 `script` 측정), 그 플래그 하나 말고는 전부 진짜다 — 진짜 소켓, 진짜
// `resolveTarget`, 진짜 `sendCommand`, 진짜 1초 타이머.
test('답하지 않는 브릿지에서 status 도 기다린다는 줄을 낸다', async (t) => {
  const { dir, env } = freshSocketEnv();
  // 연결은 받고 **답하지 않는다**. `isSocketAlive` 의 탐색 연결도 여기로
  // 오므로 마지막 것(명령을 실은 연결)만 들고 있는다.
  let held = null;
  const pid = await bridgeAt(t, dir, (socket) => {
    held = socket;
  });

  const notice = 'waiting for the extension to reply (10s timeout)…';
  const { code, stdout, stderr } = await runCli(
    ['--human', '--no-color', '--bridge', String(pid), 'status'],
    {
      env,
      nodeArgs: ['--import', 'data:text/javascript,process.stderr.isTTY=true'],
      // 줄이 나오면 매달림을 푼다. 이 테스트가 재는 것은 1초 타이머이지
      // 10초 타임아웃이 아니다 — 끊으면 같은 catch 를 `bridge-closed` 로
      // 즉시 지나간다. (줄이 안 나오는 구현은 여기서 10초를 다 기다린 뒤
      // 아래 어서션에서 빨개진다.)
      onStderr: (all) => {
        if (all.includes(notice)) held?.destroy();
      },
    },
  );

  // 부재 먼저: 진행 상황은 stdout 을 어느 모드에서도 건드리지 않는다.
  assert.equal(stdout, '');
  // 첫 줄이어야 한다 — 뒤에 실패 렌더가 붙으므로 `includes` 로 재면
  // "끝나고 나서 한 번에 쏟아내는" 구현도 통과한다.
  assert.equal(stderr.split('\n')[0], notice);
  assert.equal(code, 4);
});

// `resolveTarget` 을 감싸는 catch 의 `?? 'bridge-off'` 는 코드가 **없는**
// 에러만 걸렀다. `findLiveBridges` 는 ENOENT 아닌 `readdir` 실패를 다시
// 던지므로 그 errno 가 그대로 봉투의 `error.code` 로 나가고, 표에 없는
// 코드는 `exitFor` 의 기본값을 타고 1("목적지가 요청을 거부했다")이 된다 —
// 목적지에 닿은 적이 없는데도. 같은 실패가 `status` 에서는 이미
// `bridge-error`(4) 였으므로, 한 실패가 명령에 따라 다른 코드로 나갔다.
//
// 재현은 권한 없는 디렉터리(EACCES)가 아니라 **평범한 파일**로 한다:
// EACCES 는 root 로 도는 러너에서 나지 않지만 ENOTDIR 은 사용자와 무관하다.
test('소켓 디렉터리를 열 수 없는 실패는 bridge-off 로 위장하지 않는다', async () => {
  const notADir = path.join(scratch, 'socket-dir-that-is-a-file');
  writeFileSync(notADir, '');
  const { code, stdout } = await runCli(['pause'], {
    env: { ...process.env, HEADERLAB_SOCKET_DIR: notADir },
  });
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'bridge-error');
  assert.equal(code, 4);
});

// 같은 입력 아래 `status` 가 하던 일은 리뷰의 예상(`bridge-error`/4)과 달랐다 —
// 손으로 재 보니 **크래시 핸들러**였다. `bridgeStatus` 도 자기 `findLiveBridges`
// 를 돌리는데 그 호출이 `runStatus` 의 try 밖이라, "headerlab crashed … 이건
// 버그다, 신고하라" 를 내고 1 로 나갔다. 읽을 수 없는 디렉터리는 이 CLI 의
// 버그가 아니다.
test('status 도 소켓 디렉터리를 열 수 없을 때 크래시로 가지 않는다', async () => {
  const notADir = path.join(scratch, 'socket-dir-that-is-a-file');
  writeFileSync(notADir, '');
  const { code, stdout, stderr } = await runCli(['status'], {
    env: { ...process.env, HEADERLAB_SOCKET_DIR: notADir },
  });
  // 부재 먼저: 크래시 리포트도, 신고 URL 도 없다.
  assert.equal(stderr.includes('crashed'), false);
  assert.equal(stderr.includes('issues/new'), false);
  assert.deepEqual(JSON.parse(stdout).ok, false);
  assert.equal(JSON.parse(stdout).error.code, 'bridge-error');
  assert.equal(code, 4);
});

// 그리고 그것이 기본값을 바꾸지 않았다는 것. 리포트가 이 자리를 고치지 않고
// 남긴 이유가 "모든 명령의 bridge-off 기본값을 건드린다" 였는데, 측정하면
// 아니다: 없는 브릿지에 대해 `resolveTarget` 이 던지는 것은 `code:'bridge-off'`
// 이고 그것은 `BY_CODE` 에 있으므로 `codeForThrown` 이 그대로 통과시킨다.
test('없는 브릿지는 여전히 bridge-off 3 이다', async () => {
  const { env } = freshSocketEnv();
  const { code, stdout } = await runCli(['pause'], { env });
  assert.deepEqual(JSON.parse(stdout), {
    ok: false,
    error: { code: 'bridge-off', message: 'no bridge is running' },
  });
  assert.equal(code, 3);
});
