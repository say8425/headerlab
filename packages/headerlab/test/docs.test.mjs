import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMANDS, pathKey } from '../lib/commands.mjs';
import { ERROR_CODES } from '../lib/exit.mjs';
import { ISSUES_URL } from '../lib/help.mjs';

/**
 * 문서가 만들어진 것을 서술하는지 검사한다. 이 저장소가 제일 비싸게 치른
 * 결함은 한 술어를 네 번 적고 갈라뜨린 것이고, 산문은 그 갈라짐이 아무것도
 * 빨갛게 만들지 않는 자리다 — `topHelp` 가 존재하지 않는 `status`·`state get`
 * 을 광고하던 것이 바로 그것이었고, 그때 그것을 잡은 것도 주석이 아니라
 * 테스트였다.
 *
 * 여기서 읽는 파일은 전부 저장소 루트 기준이다. `test/` 는 `files` 에 없어
 * npm 타르볼에 들어가지 않으므로(재측정: `cd packages/headerlab && npm pack
 * --dry-run` → **21 파일**, `bin/`·`lib/` 에 npm 이 `files` 와 무관하게 늘
 * 넣는 셋(package.json·README.md·LICENSE)뿐이고 `test/` 는 디스크에만 있다),
 * 이 결합이 설치된 패키지를 깨뜨릴 길은 없다. 13 이라고 적혀 있었는데 그
 * 수는 두 가지로 틀렸다 — CLAUDE.md 의 같은 항목이 그 내력을 적고 있다.
 * 수를 믿지 말고 명령을 다시 돌려라. CLI 는 움직인다.
 */
const root = (name) => fileURLToPath(new URL(`../../../${name}`, import.meta.url));

const read = (name) => readFileSync(root(name), 'utf8');

const READMES = [
  'README.md',
  'docs/README.ko.md',
  'docs/README.ja.md',
  'docs/README.zh.md',
  'docs/README.es.md',
];

/**
 * `## Agent bridge` 는 README 의 아홉 절 중 157 줄 — 36% — 이었고, 이제
 * `docs/agent-bridge*.md` 로 나가고 README 에는 요약과 링크만 남았다.
 * **명령도 함께 나갔다는 것이 이 파일의 위험이다.** 다섯 README 안에서
 * `headerlab ` 으로 시작하는 실행 가능한 줄은 전부 그 절 안에 있었으므로,
 * 아래 비교를 그대로 두면 다섯 개의 빈 목록을 서로 견주게 된다 — 빈 목록
 * 다섯은 자명하게 동일하고, 그것이 이 저장소가 되풀이하는 결함인 "실패할
 * 수 없는 단언"이다. 그래서 두 가지를 한다: 목록이 비지 않았음을 단언하고,
 * 옮겨간 문서 다섯 벌에도 같은 비교를 건다.
 *
 * 두 집합이 서로 다른 것은 정상이다. README 는 요약이 데려갈 만큼만 들고
 * 문서가 전부를 든다. 각 집합이 **자기 안에서** 바이트 동일하면 된다.
 */
const BRIDGE_DOCS = [
  'docs/agent-bridge.md',
  'docs/agent-bridge.ko.md',
  'docs/agent-bridge.ja.md',
  'docs/agent-bridge.zh.md',
  'docs/agent-bridge.es.md',
];

/**
 * 다섯 README 의 ```bash 블록 안에서 `headerlab ` 으로 시작하는 줄.
 *
 * **줄 수를 세는 것이 아니라 줄 자체를 뽑는다.** 앞선 초안은
 * `grep -c 'headerlab '` 로 다섯 파일의 개수가 같은지를 보라고 적었는데,
 * 그것은 산문에 박힌 언급까지 세고 번역본은 산문을 다르게 쓰므로 애초에
 * 성립하지 않는 성질이다 — 측정하면 네 번역본이 서로 다른 수를 낸다.
 * 성립하는 성질은 **실행 가능한 명령이 바이트 동일**하다는 것이다.
 *
 * `lang === 'bash'` 로 좁히는 것이 필요한 이유도 측정으로 알았다: 스페인어
 * README 의 architecture 블록(언어 없음)에 `headerlab (la CLI más…` 라는
 * 줄이 있어서, 좁히지 않으면 그 산문 한 줄이 명령으로 잡힌다.
 * 들여쓰기를 떼는 것도 마찬가지다 — `bridge install` 예제는 번호 목록
 * 안이라 세 칸 들여써 있고, 떼지 않으면 그 블록이 통째로 안 보인다.
 */
function runnableCommands(text) {
  const found = [];
  let lang = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      lang = lang === null ? line.slice(3).trim() : null;
      continue;
    }
    if (lang === 'bash' && line.startsWith('headerlab ')) found.push(line);
  }
  return found;
}

// 다섯 파일이 서로 같은지만 보면 다섯이 함께 틀렸을 때 초록이다. 그래서
// 기대값을 적어 두고 다섯을 각각 그것에 맞춘다 — 산문은 번역되고 명령은
// 번역되지 않는다는 규칙이, 다섯 개의 비교가 아니라 하나의 값이 된다.
const EXPECTED_README_COMMANDS = [
  'headerlab site add staging.example.com',
  'headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"',
];

const EXPECTED_BRIDGE_DOC_COMMANDS = [
  'headerlab site add staging.example.com',
  'headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"',
  'headerlab status',
  'headerlab state get --json | jq .state | headerlab state set - --force',
  'headerlab bridge install --extension-id <id>',
];

// 기대값이 비어 있으면 아래 비교는 다섯 개의 빈 목록을 견주는 것이 되어
// 무엇을 지우든 초록이다. 기대값 자체를 먼저 막아 둔다 — 다섯 파일에서
// 명령이 사라지는 것과 기대값에서 사라지는 것이 함께 일어나야만 통과하는
// 상태를, 이 두 줄이 불가능하게 만든다.
test('명령 기대값이 비어 있지 않다', () => {
  assert.ok(EXPECTED_README_COMMANDS.length > 0, 'README 기대값이 비었다');
  assert.ok(EXPECTED_BRIDGE_DOC_COMMANDS.length > 0, 'agent-bridge 기대값이 비었다');
});

test('다섯 README 의 실행 가능한 명령이 바이트 동일하다', () => {
  for (const name of READMES) {
    const found = runnableCommands(read(name));
    assert.notEqual(found.length, 0, `${name} 에 실행 가능한 명령이 하나도 없다`);
    assert.deepEqual(found, EXPECTED_README_COMMANDS, name);
  }
});

test('다섯 agent-bridge 문서의 실행 가능한 명령이 바이트 동일하다', () => {
  for (const name of BRIDGE_DOCS) {
    const found = runnableCommands(read(name));
    assert.notEqual(found.length, 0, `${name} 에 실행 가능한 명령이 하나도 없다`);
    assert.deepEqual(found, EXPECTED_BRIDGE_DOC_COMMANDS, name);
  }
});

/**
 * "켜는 법" 목록에서 설치가 1 번이고 스위치가 2 번이다 — 여섯 문서 모두.
 *
 * **바로 위의 순서 있는 `deepEqual` 이 이것을 못 잡는다는 것이 이 테스트가
 * 있는 이유다.** `bridge install` 은 두 순서 중 어느 쪽에서든 그 문서의 마지막
 * `headerlab ` 줄이라, 다섯 중 넷만 순서를 바꾸는 드리프트가 초록으로 통과한다.
 * 측정해서 확인했다: 문서 하나만 옛 순서로 되돌려도 이 파일의 다른 테스트는
 * 전부 초록이었다.
 *
 * 산문을 읽지 않고 검사할 수 있는 이유는 두 앵커가 번역되지 않기 때문이다 —
 * `headerlab bridge install` 은 명령이고 `Agent bridge` 는 팝업이 실제로 그리는
 * 글자다. 다섯 언어가 공유하는 것이 정확히 그 둘이고, #61 을 발견하게 한 것도
 * 같은 사실이다.
 *
 * 왜 설치가 먼저여야 하는지는 #61 에 있다. 요약하면: 권한이 먼저 도착하면 아직
 * 쓰이지 않은 매니페스트를 향해 세 번 시도하고 예산이 소진되며, 그것을 다시
 * 채우는 트리거 중 팝업을 여는 것은 없다.
 */
const TURNING_ON_DOCS = [...BRIDGE_DOCS, 'packages/headerlab/README.md'];

/**
 * 목록의 1 번과 2 번 항목을 통째로 잘라 온다.
 *
 * 마커가 문서마다 하나뿐이라는 것을 여기서 함께 단언한다. 그것이 이 함수의
 * 전제이고, 전제가 조용히 깨지면 `findIndex` 는 엉뚱한 목록의 1 번을 집어
 * 오면서도 초록일 수 있다 — 검사할 수 없는 주장을 만드는 쪽이다.
 */
function turningOnSteps(text, name) {
  const lines = text.split('\n');
  const rows = (n) => lines.filter((l) => l.startsWith(`${n}. `)).length;
  for (const n of [1, 2, 3]) {
    assert.equal(rows(n), 1, `${name}: ${n} 번 항목이 하나가 아니다 (${rows(n)})`);
  }
  const at = (n) => lines.findIndex((l) => l.startsWith(`${n}. `));
  const [one, two, three] = [at(1), at(2), at(3)];
  assert.ok(one < two && two < three, `${name}: 켜는 법 목록이 1/2/3 순서가 아니다`);
  return { one: lines.slice(one, two).join('\n'), two: lines.slice(two, three).join('\n') };
}

test('여섯 문서 모두 설치가 1 번, 스위치가 2 번이다', () => {
  for (const name of TURNING_ON_DOCS) {
    const { one, two } = turningOnSteps(read(name), name);
    assert.ok(one.includes('headerlab bridge install'), `${name}: 1 번이 설치가 아니다`);
    // 부재를 먼저 본다. 1 번이 스위치도 함께 말하고 있으면 순서를 바꾼 것이
    // 아니라 두 단계를 뭉갠 것이고, 그것은 이 가드가 잡아야 할 쪽이다.
    assert.equal(one.includes('Agent bridge'), false, `${name}: 1 번이 스위치를 가리킨다`);
    assert.ok(two.includes('Agent bridge'), `${name}: 2 번이 스위치가 아니다`);
  }
});

/**
 * SKILL.md 의 명령표가 표의 명령을 하나도 빠뜨리지 않는다. 스킬은 모델이
 * 읽는 유일한 레퍼런스이므로, 표에만 있고 스킬에 없는 명령은 존재하되
 * 아무도 부를 수 없는 명령이다.
 */
test('에이전트 스킬이 표의 모든 명령을 이름으로 담는다', () => {
  const skill = read('packages/plugin/skills/headerlab/SKILL.md');
  const missing = COMMANDS.map((c) => `headerlab ${pathKey(c.path)}`).filter(
    (name) => !skill.includes(name),
  );
  assert.deepEqual(missing, []);
});

/**
 * 같은 결합의 나머지 절반. 명령은 위에서 묶여 있었는데 에러 코드는 묶여
 * 있지 않았고, 갈라진 것은 이쪽이었다: 계약이 열여섯으로 자라는 동안 스킬은
 * "and four more" 라고 적혀 있었다. 이름조차 없던 셋(`invalid-state`,
 * `unknown-rule`, `unknown-domain`)은 드문 것도 아니다 — 없는 id 로
 * `rule rm`, 목록에 없는 도메인으로 `site rm` 이면 나온다. 스킬은 모델에게
 * `error.code` 로 분기하라고 가르치므로, 이름이 적혀 있지 않은 코드를 받은
 * 모델에게는 분기할 것이 없다.
 *
 * 백틱까지 요구한다. 코드 이름은 전부 평범한 영어 단어의 조합이라
 * (`unknown-rule`, `invalid-state`) 산문에 우연히 섞여도 맨 `includes` 는
 * 참이 되고, 그러면 이 가드는 "적혀 있다" 가 아니라 "그 글자가 어딘가 있다"
 * 를 검사하게 된다. 그 대가는 알고 있어야 한다: 코드를 펜스 친 JSON 예시
 * 안에만 넣는 것(`{"error":{"code":"unknown-rule"}}`)은 이 가드를 만족시키지
 * 못한다. 의도한 제약이다 — 예시는 모양을 보여 줄 뿐 그 코드가 무엇인지는
 * 말하지 않으므로, 설명을 대신할 수 없다.
 *
 * **이 가드가 묶는 것은 이름이지 주장이 아니다.** 열여섯 개를 전부 백틱으로
 * 나열해 놓고 설명을 통째로 거짓으로 적어도 초록이다 — 실제로 그렇게
 * 변이시켜 확인했다. 그래서 이 절의 산문에서 손으로 센 숫자("and four
 * more", "Seven come from…")를 지웠다: 가드가 못 보는 자리에 숫자를 두면
 * 그것이 다음번에 갈라지는 자리가 된다.
 */
test('에이전트 스킬이 계약의 모든 에러 코드를 이름으로 담는다', () => {
  const skill = read('packages/plugin/skills/headerlab/SKILL.md');
  const missing = ERROR_CODES.filter((code) => !skill.includes(`\`${code}\``));
  assert.deepEqual(missing, []);
});

// 없어진 것을 먼저 본다. 읽기 명령이 생겼는데 "읽기 전용 명령은 없다" 는
// 문장이 남아 있으면, 스킬을 읽는 모델은 쓰기로 상태를 알아내려 한다 —
// 있는 것을 추가하는 것보다 없어진 주장을 지우는 쪽이 잊기 쉽다.
test('스킬이 읽기 전용 명령이 없다고 더 이상 말하지 않는다', () => {
  const skill = read('packages/plugin/skills/headerlab/SKILL.md');
  assert.equal(skill.includes('no dedicated read-only command'), false);
  assert.equal(skill.includes('There is no read-only command'), false);
  assert.equal(skill.includes('headerlab state get --json | jq .state'), true);
});

/**
 * `bugs` 는 npm 이 `npm bugs headerlab` 과 패키지 페이지에서 쓰는 필드이고,
 * `ISSUES_URL` 은 CLI 가 크래시했을 때와 도움말 끝에 찍는 줄이다. 같은 곳을
 * 가리켜야 하는 두 값이 서로를 모르는 상태로 있었다.
 */
test('package.json 의 bugs 가 CLI 가 찍는 제보 경로와 같다', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.bugs, ISSUES_URL);
});
