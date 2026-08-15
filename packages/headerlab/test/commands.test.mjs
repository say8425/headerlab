import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMANDS, GROUPS, commandPaths, findCommand } from '../lib/commands.mjs';

// 지금 파서가 아는 아홉 가지. lib/args.mjs 의 switch 와
// lib/bridge/protocol.ts 의 commandSchema 에서 손으로 옮긴 것이며,
// 아래 두 테스트가 이 목록과 표를 양방향으로 묶는다.
const PARSER_KNOWS = [
  'site add',
  'site rm',
  'site all-sites',
  'rule add',
  'rule rm',
  'rule toggle',
  'pause',
  'resume',
  'state set',
  'bridge install',
  'bridge uninstall',
  'bridge status',
];

test('표가 파서가 아는 모든 명령을 담는다', () => {
  assert.deepEqual(commandPaths().sort(), [...PARSER_KNOWS].sort());
});

test('표에 파서가 모르는 명령이 없다', () => {
  // 위 deepEqual 이 이미 양방향이지만, 실패했을 때 어느 쪽이 남는지
  // 읽히도록 차집합을 따로 낸다.
  const extra = commandPaths().filter((p) => !PARSER_KNOWS.includes(p));
  assert.deepEqual(extra, []);
});

test('findCommand 가 가장 긴 일치를 고른다', () => {
  assert.deepEqual(findCommand(['site', 'add', 'example.com']).path, ['site', 'add']);
  assert.deepEqual(findCommand(['pause']).path, ['pause']);
});

test('findCommand 는 모르는 것에 null 을 준다', () => {
  assert.equal(findCommand(['sight', 'add']), null);
  assert.equal(findCommand([]), null);
});

test('모든 항목이 한 줄 요약을 갖는다', () => {
  const missing = COMMANDS.filter((c) => typeof c.summary !== 'string' || c.summary.length === 0);
  assert.deepEqual(missing, []);
});

test('GROUPS 가 실제 그룹 이름들이다', () => {
  assert.deepEqual([...GROUPS].sort(), ['bridge', 'pause', 'resume', 'rule', 'site', 'state']);
});
