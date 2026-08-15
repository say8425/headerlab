import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { codeForThrown, ERROR_CODES, EXIT, exitFor } from '../lib/exit.mjs';

test('각 코드가 정해진 종료 코드로 간다', () => {
  assert.equal(exitFor('usage'), 2);
  assert.equal(exitFor('unknown-command'), 2);
  assert.equal(exitFor('invalid-args'), 2);
  assert.equal(exitFor('bridge-off'), 3);
  assert.equal(exitFor('multiple-bridges'), 3);
  assert.equal(exitFor('timeout'), 4);
  assert.equal(exitFor('bridge-error'), 4);
  assert.equal(exitFor('bridge-closed'), 4);
  assert.equal(exitFor('invalid-command'), 1);
  assert.equal(exitFor('store-unreadable'), 1);
  assert.equal(exitFor('unsupported'), 1);
  assert.equal(exitFor('install-failed'), 1);
});

test('모르는 코드는 1 이다', () => {
  assert.equal(exitFor('something-nobody-declared'), 1);
});

// `codeForThrown` 은 소켓이 던진 것을 봉투의 코드로 옮기는 유일한 곳이다.
// 통과와 접기를 한 테스트에서 같이 재야 의미가 있다 — 전부 통과시키는
// 구현과 전부 접는 구현이 각각 한쪽만으로는 통과하기 때문이다.
test('던져진 에러는 표에 있는 코드만 그대로 나가고 나머지는 bridge-error 다', () => {
  // 표에 있는 것: 그대로. 이것이 없으면 timeout·bridge-closed 가 전부
  // 한 코드로 뭉개져 호출자가 구분할 것을 잃는다.
  assert.equal(codeForThrown({ code: 'timeout' }), 'timeout');
  assert.equal(codeForThrown({ code: 'bridge-closed' }), 'bridge-closed');
  assert.equal(codeForThrown({ code: 'multiple-bridges' }), 'multiple-bridges');
  // errno: 봉투의 계약이 아니다. 측정된 실제 값 둘.
  assert.equal(codeForThrown({ code: 'EPIPE' }), 'bridge-error');
  assert.equal(codeForThrown({ code: 'ECONNREFUSED' }), 'bridge-error');
  // 코드가 아예 없거나 코드가 아닌 것.
  assert.equal(codeForThrown(new Error('nothing at all')), 'bridge-error');
  assert.equal(codeForThrown({ code: 7 }), 'bridge-error');
  assert.equal(codeForThrown(undefined), 'bridge-error');
});

// 위 테스트가 지키는 성질을 한 줄로: 이 함수가 무엇을 받든 그 결과는
// 항상 종료 코드가 정해진 코드다. errno 를 그대로 흘리는 구현은 여기서
// 빨개진다 — `EPIPE` 는 `ERROR_CODES` 에 없다.
test('codeForThrown 의 결과는 언제나 ERROR_CODES 안에 있다', () => {
  for (const thrown of [
    { code: 'EPIPE' },
    { code: 'ECONNRESET' },
    { code: 'ENOENT' },
    { code: 'timeout' },
    new Error('no code'),
  ]) {
    assert.equal(ERROR_CODES.includes(codeForThrown(thrown)), true, String(thrown.code));
  }
});

test('EXIT.OK 은 0 이고 다른 어떤 것도 0 이 아니다', () => {
  assert.equal(EXIT.OK, 0);
  const nonZero = Object.entries(EXIT).filter(([name]) => name !== 'OK');
  assert.deepEqual(
    nonZero.filter(([, value]) => value === 0),
    [],
  );
});

// 이 테스트가 이 파일의 존재 이유다. 코드를 새로 만들고 종료 코드를 안
// 정하는 것이 이 설계에서 가장 쉬운 퇴행이라, 소스에서 실제로 쓰이는
// 코드 문자열을 긁어 목록과 맞춘다.
test('소스가 내는 모든 코드가 ERROR_CODES 에 있다', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = [
    ...readdirSync(path.join(root, 'lib')).map((n) => path.join(root, 'lib', n)),
    ...readdirSync(path.join(root, 'bin')).map((n) => path.join(root, 'bin', n)),
  ].filter((p) => p.endsWith('.mjs'));

  const found = new Set();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/code:\s*'([a-z-]+)'/g)) found.add(match[1]);
    // Trailing comma is allowed before the closing paren — lib/bridge.mjs's
    // multi-line multiple-bridges call has one, and a regex that requires
    // its absence silently stops seeing that call site.
    for (const match of source.matchAll(/withCode\([^,]+,\s*'([a-z-]+)'\s*,?\s*\)/g)) {
      found.add(match[1]);
    }
    // lib/install.mjs and bin/headerlab.mjs each mint codes through their own
    // local `fail(code, message)` helper — a shape neither of the two
    // patterns above recognizes at all.
    for (const match of source.matchAll(/\bfail\(\s*'([a-z-]+)'/g)) found.add(match[1]);
  }

  const unmapped = [...found].filter((code) => !ERROR_CODES.includes(code));
  assert.deepEqual(unmapped, []);
});
