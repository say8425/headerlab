import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ensureSocketDir,
  listenWithRestrictedPermissions,
  registryPathFor,
  socketPathFor,
  writeRegistryEntry,
} from '../lib/socket.mjs';

// 프로세스를 실제로 띄워야만 보이는 것들. 닫힌 파이프·시그널·터미널
// 분기는 모듈을 import 해서는 관측되지 않는다.
const cliPath = fileURLToPath(new URL('../bin/headerlab.mjs', import.meta.url));

/**
 * `process.stdin.isTTY` 를 켠 채로 같은 CLI 를 돌리는 얇은 껍데기. 왜 pty 가
 * 아니라 이것인지는 그 파일의 docblock 에 있다.
 */
const ttyHarness = fileURLToPath(new URL('../test-support/tty-harness.mjs', import.meta.url));

/**
 * `keepStdinOpen` 이 중요하다. 파이프를 닫으면 stdin 은 `'end'` 를 내고
 * 스스로 unref 되므로, 흐름 모드로 열어 둔 stdin 이 이벤트 루프를 붙잡는
 * 결함이 **닫는 하네스에서는 재현되지 않는다** — 실제 터미널의 stdin 은
 * 답을 친 뒤에도 열려 있다. 측정: 이 옵션 없이는 `pause()` 를 빼는 변이가
 * 열 테스트를 전부 초록으로 통과했다.
 */
function run(
  args,
  { onSpawn, entry = cliPath, env = process.env, stdin = null, keepStdinOpen = false } = {},
) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entry, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    if (keepStdinOpen) child.stdin.write(stdin ?? '');
    else if (stdin === null) child.stdin.end();
    else child.stdin.end(stdin);
    onSpawn?.(child);
  });
}

/**
 * 연결은 받고 **절대 답하지 않는** 가짜 브릿지. `headerlab.test.mjs` 의
 * `bridgeAt` 과 같은 모양이며, 여기 다시 있는 이유는 이 파일이 필요로 하는
 * 것이 그 파일의 것보다 좁기 때문이다: 명령이 소켓에 닿은 **뒤** 프로세스가
 * 매달려 있는 순간이 필요하고, 그 순간이 SIGINT 를 검사할 수 있는 유일한
 * 창이다.
 */
async function silentBridge(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hl-sigint-'));
  ensureSocketDir(dir);
  const pid = 100000 + Math.floor(Math.random() * 900000);
  const socketPath = socketPathFor(dir, pid);
  const connected = [];
  const server = createServer((socket) => {
    // 읽되 답하지 않는다. 명령의 바이트가 도착했다는 사실만 기록한다.
    socket.once('data', () => connected.push(true));
  });
  writeRegistryEntry(dir, pid, { origin: 'test', startedAt: new Date().toISOString() });
  await listenWithRestrictedPermissions(server, socketPath);
  t.after(() => {
    server.close();
    for (const p of [socketPath, registryPathFor(dir, pid)]) {
      try {
        unlinkSync(p);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  });
  return { dir, pid, env: { ...process.env, HEADERLAB_SOCKET_DIR: dir }, connected };
}

test('stdout 파이프가 먼저 닫혀도 스택 트레이스를 쏟지 않는다', async () => {
  const { code, stderr } = await new Promise((resolve) => {
    const child = spawn('sh', ['-c', `"${process.execPath}" "${cliPath}" bridge status | true`], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderrText = '';
    child.stderr.on('data', (c) => (stderrText += c));
    child.on('close', (exitCode) => resolve({ code: exitCode, stderr: stderrText }));
  });
  // 부재를 먼저: 이 결함은 1106바이트의 존재로 드러났다.
  assert.equal(stderr.includes('Unhandled'), false);
  assert.equal(stderr.includes('EPIPE'), false);
  assert.equal(stderr, '');
  assert.equal(code, 0);
});

/**
 * 이 테스트는 자기 탈출구로 늘 빠져나가고 있었다. `site add` 를 브릿지 없이
 * 돌리면 36ms 만에 exit 3 으로 끝나는데 SIGINT 는 150ms 뒤에 갔으므로,
 * `if (signal === null && code === 3) return;` 이 이 기계에서도 CI 에서도
 * (CI 에는 브릿지가 있을 수 없다) **매번** 걸렸다 — 설계 §10 이 이 파일의
 * 세 존재 이유 중 하나로 꼽는 핸들러에 자동 검사가 하나도 없었다는 뜻이다.
 *
 * 그래서 실제로 **매달리는** 명령에 보낸다: 답하지 않는 가짜 브릿지에
 * `--bridge <pid>` 로 붙고, 명령의 바이트가 소켓에 닿은 것을 확인한 뒤에
 * 죽인다. 탈출구는 없다 — 전제가 안 서면 이 테스트는 통과가 아니라 실패다.
 */
test('SIGINT 가 한 줄을 남기고 130 으로 나간다', async (t) => {
  const bridge = await silentBridge(t);
  const { code, stderr } = await run(['--bridge', String(bridge.pid), 'site', 'add', 'a.com'], {
    env: bridge.env,
    onSpawn: (child) => {
      const timer = setInterval(() => {
        if (bridge.connected.length > 0) {
          clearInterval(timer);
          child.kill('SIGINT');
        }
      }, 20);
      t.after(() => clearInterval(timer));
    },
  });
  assert.equal(bridge.connected.length, 1);
  assert.equal(code, 130);
  assert.equal(stderr.includes('interrupted'), true);
});

/**
 * 그리고 그 한 줄이 **참**이어야 한다. 문장은 두 가지이고, 어느 쪽인지는
 * 명령이 소켓에 나갔는지가 정한다. 조건 없이 "no command was delivered" 를
 * 찍던 동안 위 테스트의 상황 — 이미 보내 놓고 답을 기다리는 중 — 에서 그
 * 문장은 거짓이었고, 그것을 읽은 사람은 `site add` 를 다시 친다.
 * `state set --force` 였다면 되돌릴 수 없는 덮어쓰기가 안 일어났다고 듣는다.
 */
test('이미 보낸 뒤의 SIGINT 는 안 보냈다고 말하지 않는다', async (t) => {
  const bridge = await silentBridge(t);
  const { stderr } = await run(['--bridge', String(bridge.pid), 'site', 'add', 'a.com'], {
    env: bridge.env,
    onSpawn: (child) => {
      const timer = setInterval(() => {
        if (bridge.connected.length > 0) {
          clearInterval(timer);
          child.kill('SIGINT');
        }
      }, 20);
      t.after(() => clearInterval(timer));
    },
  });
  // 부재를 먼저: 거짓인 쪽이 나오지 않았다.
  assert.equal(stderr.includes('no command was delivered'), false);
  assert.equal(
    stderr,
    'interrupted after the command was sent — it may already have been applied\n',
  );
});

test('아직 아무것도 안 보냈으면 안 보냈다고 말한다', async () => {
  // 두 문장이 실제로 갈리는지를 이 짝이 지킨다 — 한 문장만 찍는 구현은 이
  // 테스트와 위 테스트 중 정확히 하나를 빨갛게 만든다.
  //
  // 매달릴 자리는 stdin 이다. 브릿지 없는 `site add` 로는 이 사실을 잴 수
  // 없다: 그쪽은 36ms 만에 exit 3 으로 끝나고, 그보다 일찍 SIGINT 를 보내면
  // 핸들러가 등록되기도 전이라 기본 처분으로 죽는다(code null). `state set -`
  // 은 파이프를 안 닫는 한 영원히 기다리므로 경주가 없고, 소켓에는 한
  // 바이트도 나가지 않은 상태다.
  const { code, stderr } = await new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, 'state', 'set', '-', '--force'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderrText = '';
    child.stderr.on('data', (c) => (stderrText += c));
    child.on('close', (exitCode) => resolve({ code: exitCode, stderr: stderrText }));
    setTimeout(() => child.kill('SIGINT'), 300);
  });
  assert.equal(stderr, 'interrupted — no command was delivered\n');
  assert.equal(code, 130);
});

// --- 터미널 분기. 껍데기가 isTTY 를 켠다 -----------------------------------

/**
 * 설계 §1.1(c) 가 잰 결함: 실제 pty 에서 `state set -` 은 5초 뒤에도 실행
 * 중이고 두 스트림 다 0바이트다. 앞선 판본은 이것을 `stdio:['pipe',…]` 로
 * 검사했는데, 그러면 자식의 `isTTY` 가 false 라 가드가 있는 갈래에 **들어가지
 * 않는다** — 닫힌 파이프가 그냥 끝난다는 것만 증명했다. 그 테스트의 주석은
 * "TTY 경로는 아래 손 확인" 이라고 적혀 있었고 아래에는 아무것도 없었다.
 */
test('state set - 은 터미널에서 멈추지 않고 무엇을 하라고 말한다', async () => {
  const { code, stdout } = await run(['state', 'set', '-', '--force'], { entry: ttyHarness });
  const result = JSON.parse(stdout);
  assert.equal(code, 2);
  assert.equal(result.error.code, 'usage');
  assert.match(result.error.message, /pipe it in or pass a file path/);
});

test('--value-file - 도 터미널에서 같은 가드에 걸린다', async () => {
  const { code, stdout } = await run(
    ['rule', 'add', '--target', 'request', '--op', 'set', '--name', 'X', '--value-file', '-'],
    { entry: ttyHarness },
  );
  const result = JSON.parse(stdout);
  assert.equal(code, 2);
  assert.equal(result.error.code, 'usage');
  assert.match(result.error.message, /--value-file - reads the header value from stdin/);
});

/**
 * `state set` 의 확인 프롬프트. 세 갈래 전부 여기서만 검사된다 — 이 분기는
 * `process.stdin.isTTY` 가 참이어야 켜지고, 프롬프트가 생긴 이래 자동 검사가
 * 하나도 없었다 (`Continue?` 를 온 스위트에서 grep 하면 아무것도 안 나왔다).
 */
test('프롬프트에서 n 은 취소이고 exit 2 다', async () => {
  const { code, stdout, stderr } = await run(['state', 'set', stateFile()], {
    entry: ttyHarness,
    stdin: 'n\n',
  });
  assert.match(stderr, /Continue\? \[y\/N\] $/);
  assert.equal(JSON.parse(stdout).error.message, 'cancelled');
  assert.equal(code, 2);
});

/**
 * EOF 는 거절이다. `'data'` 만 달려 있던 동안 프롬프트에서 Ctrl-D 를 누르면
 * promise 가 영원히 안 풀렸고, Node 는 "unsettled top-level await" 경고와
 * 함께 **13** 으로 나갔다 — §2.3 표에 없는 종료 코드에, 봉투도 사람이 읽을
 * 문장도 없이. 설계가 없애려던 §1.1(c) 와 같은 모양이 프롬프트에서 다시
 * 태어난 것이다.
 */
test('프롬프트에서 EOF(Ctrl-D)는 거절이지 무한 대기가 아니다', async () => {
  const { code, stdout, stderr } = await run(['state', 'set', stateFile()], {
    entry: ttyHarness,
    stdin: '',
  });
  // 부재를 먼저: 13 도, 미해결 await 경고도 없다.
  assert.equal(code === 13, false);
  assert.equal(stderr.includes('unsettled top-level await'), false);
  assert.equal(JSON.parse(stdout).error.message, 'cancelled');
  assert.equal(code, 2);
});

/**
 * y 를 치면 진행하고 — 그리고 **끝난다**. 끝난다는 것이 이 테스트의 절반이다:
 * `once('data')` 는 핸들러만 떼고 스트림을 멈추지 않으므로, 리스너를 달며
 * 흐름 모드로 들어간 TTY stdin 이 ref 된 채 남아 `main()` 이 답을 찍은 뒤에도
 * 프로세스가 영원히 살아 있었다 — 100%, 이 CLI 에서 가장 파괴적인 명령에서.
 * 여기서 그것은 통과가 아니라 이 테스트의 타임아웃이 된다.
 */
test('프롬프트에서 y 는 진행하고 프로세스는 끝난다', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hl-confirm-'));
  const { code, stdout } = await run(['state', 'set', stateFile()], {
    entry: ttyHarness,
    stdin: 'y\n',
    // 답을 친 뒤에도 stdin 은 열려 있다 — 터미널이 그렇기 때문이다. 이것이
    // 이 테스트의 절반을 감당한다: 닫아 버리면 매달림이 재현되지 않는다.
    keepStdinOpen: true,
    env: { ...process.env, HEADERLAB_SOCKET_DIR: dir },
  });
  // 브릿지가 없으므로 여기까지가 이 테스트가 볼 수 있는 끝이다 — 확인을
  // 통과했다는 것은 `cancelled` 가 **아니라** 전송 단계의 실패라는 사실로
  // 드러난다.
  const result = JSON.parse(stdout);
  assert.equal(result.error.code, 'bridge-off');
  assert.equal(code, 3);
});

/** 확인 프롬프트가 셀 것이 있는 상태 파일. */
function stateFile() {
  const dir = mkdtempSync(path.join(tmpdir(), 'hl-state-'));
  const file = path.join(dir, 'state.json');
  writeFileSync(
    file,
    JSON.stringify({
      version: 2,
      globalPause: false,
      theme: 'system',
      profiles: [
        {
          id: 'p1',
          name: 'Default',
          color: 'blue',
          enabled: true,
          filter: { mode: 'domains', domains: ['a.com', 'b.com'], allSites: false, types: [] },
          headers: [
            { id: 'r1', enabled: true, target: 'request', operation: 'set', name: 'A', value: '1' },
            { id: 'r2', enabled: true, target: 'request', operation: 'set', name: 'B', value: '2' },
            { id: 'r3', enabled: true, target: 'request', operation: 'set', name: 'C', value: '3' },
          ],
        },
      ],
    }),
  );
  return file;
}

/**
 * 프롬프트가 **세어서** 말한다 (설계 §7.1). 숫자가 없는 문장은 모든 실행에서
 * 참이라 아무 신호도 싣지 않는다 — 빈 상태로 채워진 파일을 가리켰다는 것을
 * 사람이 알아채는 자리가 여기다.
 */
test('프롬프트가 무엇을 덮어쓰는지 세어서 말한다', async () => {
  const { stderr } = await run(['state', 'set', stateFile()], {
    entry: ttyHarness,
    stdin: 'n\n',
  });
  assert.equal(
    stderr,
    'This replaces the entire stored state with 3 rules and 2 sites, and cannot be undone.\n' +
      'Continue? [y/N] ',
  );
});
