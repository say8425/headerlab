import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planFail, planOk, resolveColor, resolveMode } from '../lib/output.mjs';

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

// --- planOk / planFail: 무엇을 어느 스트림에 쓰는가 --------------------------
//
// 이 판단은 `bin/headerlab.mjs` 의 `emitOk`/`emitFail` 안에 있었고, 사람용
// 분기에는 어떤 테스트도 닿지 못했다 — `MODE === 'human'` 은 stdout 이 TTY
// 여야 켜지는데 `node --test` 가 띄우는 자식의 stdout 은 파이프이고, Node 는
// 의존성 없이 pty 를 열 수 없다 (측정: macOS 의 `script` 는 자신의 stdin 이
// TTY 가 아니면 `tcgetattr/ioctl: Operation not supported on socket` 로 죽어,
// 리뷰가 제안한 형태를 이 저장소의 테스트 러너에서 쓸 수 없다).
//
// 그래서 pty 를 구하는 대신 판단을 여기로 옮겼다. 이 파일의 docblock 이
// 이미 "그 문자열이 어디로 어떤 모습으로 갈지는 여기가 정한다" 라고
// 적고 있었고, 정작 그 결정만 bin/ 에 남아 있었다. 이제 bin/ 에 남은 것은
// `process[plan.stream].write(plan.text)` 한 줄뿐이다.
//
// 계획은 바이트를 통째로 서술한다 — 줄바꿈까지 포함해서. 그래야 "무엇을
// 쓰는가" 가 어서션 하나로 끝나고, bin/ 이 줄바꿈을 붙이는 두 번째 규칙을
// 갖지 않는다.

const writePayload = {
  ok: true,
  changed: true,
  state: {
    globalPause: false,
    profiles: [
      { id: 'p1', enabled: true, filter: { domains: ['a.com'], allSites: false }, headers: [] },
    ],
  },
};
const siteAdd = { command: ['site', 'add'], color: false };

test('기계용 성공은 봉투를 stdout 에 그대로 낸다', () => {
  assert.deepEqual(planOk(writePayload, { mode: 'json', quiet: false, ...siteAdd }), {
    stream: 'stdout',
    text: `${JSON.stringify(writePayload)}\n`,
  });
});

test('사람용 성공은 요약을 stdout 에 낸다 — 봉투가 아니다', () => {
  const plan = planOk(writePayload, { mode: 'human', quiet: false, ...siteAdd });
  // 부재를 먼저 검사한다: 사람용에서 JSON 을 그대로 흘리는 구현을 잡는다.
  assert.equal(plan.text.includes('"profiles"'), false);
  assert.equal(plan.text.includes('"ok"'), false);
  assert.deepEqual(plan, { stream: 'stdout', text: '1 site in scope: a.com\n' });
});

// `--quiet` 를 무시하는 구현은 195 개를 전부 통과했다. 이 어서션이 그 하나다.
test('사람용에서 --quiet 은 성공을 통째로 지운다', () => {
  assert.equal(planOk(writePayload, { mode: 'human', quiet: true, ...siteAdd }), null);
});

// 봉투는 API 다. "에러만" 은 사람용 산문에 대한 요구이지 기계용 계약에
// 대한 요구가 아니다 — `--json --quiet | jq` 가 빈 입력을 받으면 안 된다.
test('기계용에서 --quiet 은 봉투를 지우지 않는다', () => {
  assert.deepEqual(planOk(writePayload, { mode: 'json', quiet: true, ...siteAdd }), {
    stream: 'stdout',
    text: `${JSON.stringify(writePayload)}\n`,
  });
});

// 명령마다 다른 렌더러가 골라진다는 것. `command` 를 흘려버리고 한 가지로만
// 그리는 구현은 위의 `site add` 하나로는 안 잡힌다.
//
// (`planOk` 의 `text.length === 0` 가지는 이 어서션이 아니라 방어선이다.
// 지금 `renderResult` 는 어느 명령에도 빈 문자열을 내지 않는다 — 처음에
// `removed: []` 가 그럴 것이라 짐작하고 이 테스트를 그렇게 썼다가,
// 재 보니 'nothing to remove' 였다. 짐작 대신 잰 값을 적는다.)
test('명령에 맞는 렌더러가 골라진다', () => {
  assert.deepEqual(
    planOk(
      { ok: true, removed: [] },
      { mode: 'human', quiet: false, command: ['bridge', 'uninstall'], color: false },
    ),
    { stream: 'stdout', text: 'nothing to remove\n' },
  );
});

const bridgeOff = { code: 'bridge-off', message: 'no bridge is running' };

test('기계용 실패는 봉투를 stdout 에 낸다 — 진단이 아니라 주 출력이다', () => {
  assert.deepEqual(planFail(bridgeOff, { mode: 'json', color: false, argv: null }), {
    stream: 'stdout',
    text: `${JSON.stringify({ ok: false, error: bridgeOff })}\n`,
  });
});

// stdout 에 쓰는 구현도 195 개를 전부 통과했다. 이 어서션이 그 둘째다.
test('사람용 실패는 stderr 로 간다', () => {
  const plan = planFail(
    { code: 'store-unreadable', message: 'boom' },
    {
      mode: 'human',
      color: false,
      argv: null,
    },
  );
  assert.deepEqual(plan, { stream: 'stderr', text: 'boom\n' });
});

test('사람용 실패는 --quiet 이어도 남는다 — "에러만" 이지 "아무것도 없이" 가 아니다', () => {
  const plan = planFail(
    { code: 'store-unreadable', message: 'boom' },
    {
      mode: 'human',
      color: false,
      argv: null,
      quiet: true,
    },
  );
  assert.deepEqual(plan, { stream: 'stderr', text: 'boom\n' });
});

test('사람용 실패의 색은 넘겨받은 대로다 — stderr 판정이 stdout 과 다를 수 있다', () => {
  const plan = planFail(
    { code: 'store-unreadable', message: 'boom' },
    {
      mode: 'human',
      color: true,
      argv: null,
    },
  );
  assert.deepEqual(plan, { stream: 'stderr', text: '\x1b[31mboom\x1b[0m\n' });
});

test('사람용 invalid-args 는 usage 줄을 메시지 아래 한 줄로 붙인다', () => {
  const plan = planFail(
    { code: 'invalid-args', message: 'rule toggle needs an id' },
    {
      mode: 'human',
      color: false,
      argv: ['rule', 'toggle'],
    },
  );
  assert.deepEqual(plan, {
    stream: 'stderr',
    text: 'rule toggle needs an id\nheaderlab rule toggle <id>\n',
  });
});

// 기계용 봉투의 `error.message` 는 첫 문장 그대로여야 한다. usage 줄이
// 봉투 안으로 새면 파싱하는 쪽이 못 보던 줄바꿈을 받는다.
test('기계용 봉투에는 usage 줄이 새지 않는다', () => {
  const plan = planFail(
    { code: 'invalid-args', message: 'rule toggle needs an id' },
    {
      mode: 'json',
      color: false,
      argv: ['rule', 'toggle'],
    },
  );
  assert.equal(plan.text.includes('headerlab rule toggle'), false);
  assert.deepEqual(plan, {
    stream: 'stdout',
    text: `${JSON.stringify({ ok: false, error: { code: 'invalid-args', message: 'rule toggle needs an id' } })}\n`,
  });
});
