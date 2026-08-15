import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveColor, resolveMode } from '../lib/output.mjs';

const noGlobals = { json: false, quiet: false, noColor: false };
const tty = { isTTY: true };
const pipe = { isTTY: false };

test('TTY 면 사람용', () => {
  assert.equal(resolveMode(noGlobals, { stdout: tty }), 'human');
});

test('파이프면 기계용', () => {
  assert.equal(resolveMode(noGlobals, { stdout: pipe }), 'json');
});

test('--json 은 TTY 여도 기계용', () => {
  assert.equal(resolveMode({ ...noGlobals, json: true }, { stdout: tty }), 'json');
});

test('모드는 stdout 만 본다 — stderr 는 관계없다', () => {
  assert.equal(resolveMode(noGlobals, { stdout: tty, stderr: pipe }), 'human');
  assert.equal(resolveMode(noGlobals, { stdout: pipe, stderr: tty }), 'json');
});

test('TTY 면 색이 켜진다', () => {
  assert.equal(resolveColor(noGlobals, {}, tty), true);
});

test('파이프면 색이 꺼진다', () => {
  assert.equal(resolveColor(noGlobals, {}, pipe), false);
});

test('NO_COLOR 는 값과 무관하게 끈다', () => {
  assert.equal(resolveColor(noGlobals, { NO_COLOR: '' }, tty), false);
  assert.equal(resolveColor(noGlobals, { NO_COLOR: '0' }, tty), false);
});

test('TERM=dumb 는 끈다', () => {
  assert.equal(resolveColor(noGlobals, { TERM: 'dumb' }, tty), false);
});

test('--no-color 와 HEADERLAB_NO_COLOR 는 끈다', () => {
  assert.equal(resolveColor({ ...noGlobals, noColor: true }, {}, tty), false);
  assert.equal(resolveColor(noGlobals, { HEADERLAB_NO_COLOR: '1' }, tty), false);
});

test('FORCE_COLOR 는 비TTY 도 되켠다', () => {
  assert.equal(resolveColor(noGlobals, { FORCE_COLOR: '1' }, pipe), true);
});

// 이 하나가 스펙 §6 의 스트림별 판정이다. stdout 을 파일로 돌리고 에러를
// 화면에서 읽는 것은 흔한 사용이며, 그때 에러는 색을 가져야 한다.
test('판정은 스트림마다 따로다', () => {
  assert.equal(resolveColor(noGlobals, {}, pipe), false);
  assert.equal(resolveColor(noGlobals, {}, tty), true);
});
