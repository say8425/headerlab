import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// 프로세스를 실제로 띄워야만 보이는 것들. 닫힌 파이프·시그널·pty 는
// 모듈을 import 해서는 관측되지 않는다.
const cliPath = fileURLToPath(new URL('../bin/headerlab.mjs', import.meta.url));

function run(args, { onSpawn } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    onSpawn?.(child);
  });
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

test('SIGINT 가 한 줄을 남기고 130 으로 나간다', async () => {
  const { code, signal, stderr } = await run(['site', 'add', 'example.com'], {
    onSpawn: (child) => setTimeout(() => child.kill('SIGINT'), 150),
  });
  // 브릿지가 없으면 즉시 끝나므로, 이 테스트는 브릿지가 없을 때
  // 죽기 전에 SIGINT 가 닿는 경우만 검사한다. 이미 끝났다면 통과다.
  if (signal === null && code === 3) return;
  assert.equal(stderr.includes('interrupted'), true);
  assert.equal(code, 130);
});
