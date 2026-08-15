import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ERROR_CODES, EXIT, exitFor } from '../lib/exit.mjs';

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
