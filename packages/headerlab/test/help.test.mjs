import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMANDS, findCommand, pathKey } from '../lib/commands.mjs';
import { ISSUES_URL, commandHelp, topHelp, usageLine } from '../lib/help.mjs';
import { parse } from '../lib/args.mjs';

test('최상위 도움말이 모든 그룹을 이름으로 담는다', () => {
  const text = topHelp();
  const missing = ['status', 'site', 'rule', 'pause', 'resume', 'state', 'bridge'].filter(
    (group) => !text.includes(group),
  );
  assert.deepEqual(missing, []);
});

test('최상위 도움말이 제보 경로를 담는다', () => {
  assert.equal(topHelp().includes(ISSUES_URL), true);
  assert.equal(ISSUES_URL, 'https://github.com/say8425/headerlab/issues');
});

test('최상위 도움말이 예제를 먼저 놓는다', () => {
  const text = topHelp();
  assert.equal(text.indexOf('EXAMPLES') < text.indexOf('COMMANDS'), true);
});

// 도움말의 예제가 실제로 파싱되는지가 이 파일의 핵심이다. 예제가
// 문서로만 맞고 파서에서 틀리면, 그게 이 표를 만든 이유가 무너진 것이다.
test('표의 모든 예제가 실제로 파싱된다', () => {
  const broken = [];
  for (const command of COMMANDS) {
    for (const example of command.examples ?? []) {
      const argv = example.split(' ').slice(1); // 'headerlab' 을 뗀다
      const result = parse(argv);
      if (!result.ok) broken.push(`${example} → ${result.error.message}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('명령별 도움말이 그 명령의 플래그를 전부 담는다', () => {
  const entry = findCommand(['rule', 'add']);
  const text = commandHelp(entry);
  const missing = entry.flags.filter((flag) => !text.includes(flag.name));
  assert.deepEqual(missing, []);
});

test('usageLine 이 인자와 플래그를 담는다', () => {
  assert.equal(usageLine(findCommand(['site', 'add'])), 'headerlab site add <domain>...');
  assert.equal(usageLine(findCommand(['pause'])), 'headerlab pause');
});

test('모든 항목에 도움말이 만들어진다 — 던지는 것이 없다', () => {
  for (const command of COMMANDS) {
    const text = commandHelp(command);
    assert.equal(typeof text, 'string');
    assert.equal(text.includes(pathKey(command.path)), true);
  }
});
