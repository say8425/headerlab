import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  COMMANDS,
  GLOBAL_FLAGS,
  GROUPS,
  commandPaths,
  findCommand,
  subcommandsOf,
} from '../lib/commands.mjs';
import { EXAMPLES, topHelp } from '../lib/help.mjs';
import { extractGlobals } from '../lib/bridge.mjs';
import { parse } from '../lib/args.mjs';

/**
 * 파서가 아는 명령을 **파서에게 물어서** 만든다.
 *
 * 예전에는 이 자리에 `PARSER_KNOWS` 라는 손으로 옮겨 적은 세 번째 목록이
 * 있었고, 그래서 이 파일이 묶는 것은 표↔파서가 아니라 표↔그 사본이었다.
 * `lib/args.mjs` 에만 있고 표에 없는 명령은 CLI 에서 완전히 실행되면서
 * 도움말도 usage 줄도 오타 제안 후보도 갖지 못하는데, 그 방향이 이 파일의
 * 어느 테스트에도 안 보였다 — 표가 존재하는 이유가 정확히 그 방향이다
 * (설계 §5).
 *
 * 후보는 `args.mjs` 소스에서 뽑는다: `case 'x':` 가 그룹, `sub === 'x'` 가
 * 서브커맨드. 그러면 파서에 새 갈래를 넣는 순간 후보에 들어오므로 목록을
 * 손으로 맞출 일이 없다. 후보 하나가 "파서가 아는 것" 인지는 실제로
 * `parse()` 를 돌려서 정한다 — 성공이거나, 실패해도 그 문장이 `unknown ` 으로
 * 시작하지 않으면(= 인자를 트집 잡았으면) 파서는 그 이름을 아는 것이다.
 */
const ARGS_SOURCE = readFileSync(
  fileURLToPath(new URL('../lib/args.mjs', import.meta.url)),
  'utf8',
);

const parserGroups = [...ARGS_SOURCE.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]);
const parserSubs = [...ARGS_SOURCE.matchAll(/sub === '([a-z-]+)'/g)].map((m) => m[1]);

function parserKnows(argv) {
  const result = parse(argv);
  return result.ok || !result.error.message.startsWith('unknown ');
}

function parserPaths() {
  // 표가 아는 이름도 후보에 넣는다: 표에만 있고 파서에 없는 명령은 소스
  // 스캔으로는 절대 후보가 되지 않으므로, 넣지 않으면 그 방향이 사라진다.
  const groups = [...new Set([...parserGroups, ...GROUPS])];
  const subs = [...new Set([...parserSubs, ...COMMANDS.flatMap((c) => c.path.slice(1))])];

  const known = [];
  for (const group of groups) {
    // 그룹 이름 하나로 파싱되면 그것은 단항 명령이고 서브커맨드 이름
    // 공간이 없다 — `pause ls` 는 "pause 는 인자를 안 받는다" 로 거절되는데,
    // 그것은 `ls` 를 아는 것이 아니라 아무 토큰이나 거절하는 것이다.
    // 아래 두 번째 assert 가 그 성질을 직접 지킨다.
    if (parserKnows([group])) {
      known.push(group);
      continue;
    }
    for (const sub of subs) {
      if (parserKnows([group, sub])) known.push(`${group} ${sub}`);
    }
  }
  return known;
}

/** 단항으로 파싱되는 그룹 — `status`·`pause`·`resume`. */
const nullaryGroups = [...new Set([...parserGroups, ...GROUPS])].filter((g) => parse([g]).ok);

test('표와 파서가 정확히 같은 명령을 안다', () => {
  assert.deepEqual(parserPaths().sort(), commandPaths().sort());
});

test('표에 파서가 모르는 명령이 없다', () => {
  // 위 deepEqual 이 이미 양방향이지만, 실패했을 때 어느 쪽이 남는지
  // 읽히도록 차집합을 양쪽으로 따로 낸다.
  const parser = parserPaths();
  assert.deepEqual(
    commandPaths().filter((p) => !parser.includes(p)),
    [],
  );
});

test('파서에 표가 모르는 명령이 없다', () => {
  const table = commandPaths();
  assert.deepEqual(
    parserPaths().filter((p) => !table.includes(p)),
    [],
  );
});

// 후보를 소스에서 뽑는 것이 실제로 파서를 보는지 — 스캔이 아무것도 못 찾고
// 조용히 빈 목록을 내면 위 세 테스트가 전부 "차집합이 없다" 로 초록이 된다.
test('파서 스캔이 실제로 무언가를 찾는다', () => {
  assert.deepEqual([...parserGroups].sort(), [
    'bridge',
    'pause',
    'resume',
    'rule',
    'site',
    'state',
    'status',
  ]);
  assert.equal(parserSubs.length > 0, true);
});

// `parserPaths` 가 단항 그룹의 서브커맨드를 아예 안 세는 근거. 이 성질이
// 깨지면(단항 그룹이 서브커맨드도 받게 되면) 그 서브커맨드는 표에 없어도
// 위 세 테스트가 못 본다 — 그러니 성질 자체를 지킨다.
test('단항 그룹은 어떤 서브커맨드도 받지 않는다', () => {
  const subs = [...new Set([...parserSubs, ...COMMANDS.flatMap((c) => c.path.slice(1))])];
  const accepted = [];
  for (const group of nullaryGroups) {
    for (const sub of subs) {
      if (parse([group, sub]).ok) accepted.push(`${group} ${sub}`);
    }
  }
  assert.deepEqual(accepted, []);
  assert.deepEqual([...nullaryGroups].sort(), ['pause', 'resume', 'status']);
});

/**
 * 전역 플래그도 명령과 같은 약속 아래 있다 — 도움말과 파서가 어긋날 수
 * 없다(설계 §5). 어긋난 적이 있고, 그것이 이 세 테스트의 이유다:
 * `--no-input` 은 파서가 알고 `--help` 가 모르는 플래그였다. 스킬이
 * 에이전트에게 쓰라고 알려주는 플래그를 사람은 찾을 길이 없었다는 뜻이며,
 * `-f`/`--force` 도 최상위 목록에서 빠져 있었다.
 */
test('파서가 표의 전역 플래그를 전부 실제로 먹는다', () => {
  const unparsed = [];
  for (const flag of GLOBAL_FLAGS) {
    for (const name of flag.names) {
      const argv = flag.arg ? [name, '1234'] : [name];
      const { globals, rest } = extractGlobals([...argv, 'pause']);
      // 남는 것은 명령뿐이어야 한다 — argv 에 그대로 남았다면 파서가
      // 그 이름을 전역 플래그로 보지 않은 것이다.
      if (rest.length !== 1 || globals.error !== null) unparsed.push(name);
      // 그리고 표가 말하는 자리에 값이 들어가야 한다.
      const value = globals[flag.key];
      if (flag.arg ? value !== 1234 : value !== true) unparsed.push(`${name} → ${flag.key}`);
    }
  }
  assert.deepEqual(unparsed, []);
});

test('최상위 도움말이 표의 전역 플래그를 전부 이름으로 담는다', () => {
  const text = topHelp();
  const missing = GLOBAL_FLAGS.flatMap((f) => f.names).filter((name) => !text.includes(name));
  assert.deepEqual(missing, []);
});

test('파서가 아는 전역 플래그 이름이 표 밖에 없다', () => {
  // 반대 방향. 표에 없는 이름을 파서가 먹으면 그것도 문서 없는 플래그다.
  const declared = new Set(GLOBAL_FLAGS.flatMap((f) => f.names));
  const source = readFileSync(fileURLToPath(new URL('../lib/bridge.mjs', import.meta.url)), 'utf8');
  const literal = [...source.matchAll(/token === '(--?[a-z-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    literal.filter((name) => !declared.has(name)),
    [],
  );
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

test('subcommandsOf 가 한 그룹 소속 서브커맨드의 두 번째 토큰만 준다', () => {
  assert.deepEqual([...subcommandsOf('site')].sort(), ['add', 'all-sites', 'ls', 'rm']);
});

test('subcommandsOf 는 서브커맨드가 없는 그룹(단항 명령)에 빈 배열을 준다', () => {
  assert.deepEqual(subcommandsOf('pause'), []);
});

test('subcommandsOf 는 모르는 그룹에도 빈 배열을 준다', () => {
  assert.deepEqual(subcommandsOf('teleport'), []);
});

test('GROUPS 가 실제 그룹 이름들이다', () => {
  assert.deepEqual([...GROUPS].sort(), [
    'bridge',
    'pause',
    'resume',
    'rule',
    'site',
    'state',
    'status',
  ]);
});

// help.mjs 리뷰가 잡은 결함: 최상위 도움말의 EXAMPLES 는 COMMANDS 안의
// 예제와 별개로 손으로 고른 배열이라, 위 '표의 모든 예제가 실제로
// 파싱된다' 테스트는 이 배열을 보지 못한다. 실제로 이 틈으로
// `headerlab status`, `headerlab state get --json | jq .state` 처럼
// 파서가 모르는 명령이 최상위 도움말 예제로 살아 있었다 — 직접 파서에
// 먹여서 잡는다.
test('최상위 도움말의 EXAMPLES 도 실제로 파싱된다', () => {
  const broken = [];
  for (const [cmd] of EXAMPLES) {
    const argv = cmd.split(' ').slice(1); // 'headerlab' 을 뗀다
    const result = parse(argv);
    if (!result.ok) broken.push(`${cmd} → ${result.error.message}`);
  }
  assert.deepEqual(broken, []);
});
