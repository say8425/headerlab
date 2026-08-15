import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMANDS, pathKey } from '../lib/commands.mjs';
import { ISSUES_URL } from '../lib/help.mjs';

/**
 * 문서가 만들어진 것을 서술하는지 검사한다. 이 저장소가 제일 비싸게 치른
 * 결함은 한 술어를 네 번 적고 갈라뜨린 것이고, 산문은 그 갈라짐이 아무것도
 * 빨갛게 만들지 않는 자리다 — `topHelp` 가 존재하지 않는 `status`·`state get`
 * 을 광고하던 것이 바로 그것이었고, 그때 그것을 잡은 것도 주석이 아니라
 * 테스트였다.
 *
 * 여기서 읽는 파일은 전부 저장소 루트 기준이다. `test/` 는 `files` 에 없어
 * npm 타르볼에 들어가지 않으므로(측정: `npm pack --dry-run` 13 파일), 이
 * 결합이 설치된 패키지를 깨뜨릴 길은 없다.
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
  'headerlab status',
  'headerlab state get --json | jq .state | headerlab state set - --force',
  'headerlab bridge install --extension-id <id>',
];

test('다섯 README 의 실행 가능한 명령이 바이트 동일하다', () => {
  for (const name of READMES) {
    assert.deepEqual(runnableCommands(read(name)), EXPECTED_README_COMMANDS, name);
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
