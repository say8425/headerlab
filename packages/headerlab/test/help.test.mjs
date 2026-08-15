import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMANDS, GLOBAL_FLAGS, findCommand, pathKey } from '../lib/commands.mjs';
import {
  ISSUES_URL,
  WHY_BRIDGE_PATH,
  commandHelp,
  groupHelp,
  topHelp,
  usageLine,
} from '../lib/help.mjs';
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
      if (example.includes('|')) continue; // 파이프라인 예제는 argv 하나가 아니다
      const argv = example.split(' ').slice(1); // 'headerlab' 을 뗀다
      const result = parse(argv);
      if (!result.ok) broken.push(`${example} → ${result.error.message}`);
    }
  }
  assert.deepEqual(broken, []);
});

/**
 * 줄 하나를 통째로 고정한다. 이 파일은 `includes()` 와 `indexOf` 순서만
 * 봤고, 그래서 최상위 도움말이 `      --bridge <pid>pick a bridge when…` 을
 * 찍는 동안 — 이름과 설명이 공백 없이 들러붙은 채로 — 전부 초록이었다.
 * `'    --bridge <pid>'` 가 정확히 18자이고 폭이 리터럴 18 이었기 때문이며,
 * `render.mjs` 의 `would install` 이 이미 한 번 똑같이 겪은 함정이다.
 *
 * 이제 폭은 가장 긴 이름에서 파생되므로, 이 어서션은 앞으로 더 긴 플래그가
 * 들어와도 살아남는다 — 대신 어떤 이름이든 설명과 최소 두 칸 떨어져 있어야
 * 한다는 것을 아래에서 전수로 지킨다.
 */
test('최상위 도움말의 플래그 줄이 이름과 설명 사이를 띄운다', () => {
  const lines = topHelp().split('\n');
  const bridgeLine = lines.find((line) => line.includes('--bridge <pid>'));
  assert.equal(bridgeLine, '      --bridge <pid>  pick a bridge when more than one is running');
});

test('어떤 전역 플래그도 자기 설명과 들러붙지 않는다', () => {
  const lines = topHelp().split('\n');
  const stuck = [];
  for (const flag of GLOBAL_FLAGS) {
    const long = flag.names.at(-1);
    const line = lines.find((l) => l.trimStart().startsWith(long) || l.includes(` ${long} `));
    const label = flag.arg ? `${long} ${flag.arg}` : long;
    if (!line?.includes(`${label}  `)) stuck.push(long);
  }
  assert.deepEqual(stuck, []);
});

/**
 * 최상위 도움말의 마지막 줄은 검사 가능한 주장이다. 가리키는 명령의
 * 도움말에 그 이유가 실제로 있어야 한다 — 예전에는 `headerlab help bridge
 * install` 이 usage·flags·예제만 찍고 CLI 가 왜 브릿지를 못 켜는지는 한
 * 줄도 말하지 않았다. (설계 §5.1 의 원문은 `headerlab help bridge` 였고,
 * 그쪽은 더 나빴다: 표에 그룹 단독 항목이 없어 최상위 도움말로 떨어졌다.)
 */
test('도움말이 가리키는 설명이 실제로 그 자리에 있다', () => {
  assert.equal(topHelp().includes(`headerlab help ${WHY_BRIDGE_PATH}`), true);
  const entry = findCommand(WHY_BRIDGE_PATH.split(' '));
  assert.notEqual(entry, null);
  const text = commandHelp(entry);
  assert.equal(text.includes('press Enable'), true);
  assert.equal(text.includes('cannot'), true);
});

/**
 * 그룹 이름 하나(`headerlab help bridge`)는 그 그룹의 목록을 낸다. 예전에는
 * 방금 읽던 최상위 도움말이 그대로 다시 나왔고, 그 그룹에 서브커맨드가
 * 있다는 것도 그것이 무엇인지도 말하지 않았다.
 */
test('그룹 도움말이 그 그룹의 서브커맨드만 담는다', () => {
  const text = groupHelp('bridge');
  assert.equal(text.includes('install'), true);
  assert.equal(text.includes('uninstall'), true);
  assert.equal(text.includes('status'), true);
  // 부재를 먼저 세운 짝: 남의 그룹이 새어 들어오면 그것은 최상위 도움말이다.
  assert.equal(text.includes('all-sites'), false);
  assert.equal(text.includes('EXAMPLES'), false);
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
