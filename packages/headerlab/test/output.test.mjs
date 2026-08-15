import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planFail, planOk, planSlowReply, resolveColor, resolveMode } from '../lib/output.mjs';

const noGlobals = { json: false, human: false, quiet: false, noColor: false };
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

// `--human` 은 `--json` 의 반대 방향 — TTY 가 아니어도(파이프여도) 사람용을
// 강제한다. 이것이 §7c 가 존재하는 이유다: 사람용 분기는 지금까지 stdout 이
// TTY 여야만 켜졌고, `node --test` 가 띄우는 자식의 stdout 은 파이프라
// 실제 pty 없이는 코드로 닿을 수 없었다. `--human` 은 그 분기를 파이프에서도
// 켜는 손잡이다.
test('--human 은 파이프여도 사람용', () => {
  assert.equal(resolveMode({ ...noGlobals, human: true }, { stdout: pipe }), 'human');
});

test('--human 은 TTY 에서도 사람용 (원래도 그럴 값이지만, 강제 경로를 잰다)', () => {
  assert.equal(resolveMode({ ...noGlobals, human: true }, { stdout: tty }), 'human');
});

// 둘 다 켜진 조합은 상위(bin/headerlab.mjs)에서 `extractGlobals`가
// `globals.error`로 거부하지만, `resolveMode` 자신은 그 거부를 모르는
// 순수 함수다 — 그래도 어느 하나로는 반드시 결정되어야 하므로(멈추거나
// undefined 를 내면 안 된다) `--json` 이 앞선다는 것을 못박는다.
test('--json 과 --human 이 함께 오면(거부되기 전) json 이 앞선다', () => {
  assert.equal(resolveMode({ ...noGlobals, json: true, human: true }, { stdout: tty }), 'json');
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

/**
 * `bridgePid` 는 `argv` 와 같은 길로 들어와 `renderError` 까지 닿아야 한다.
 * 안 넘기는 구현(옵션을 받기만 하고 `renderError` 에 빼먹는 것)은 두 계획이
 * 바이트까지 같아지므로, 두 갈래를 나란히 놓고 **다름**을 어서션한다.
 */
test('planFail 이 bridgePid 를 사람용 렌더까지 넘긴다', () => {
  const named = planFail(
    { code: 'bridge-off', message: 'no live bridge with pid 7' },
    { mode: 'human', color: false, argv: null, bridgePid: 7 },
  );
  const anonymous = planFail(
    { code: 'bridge-off', message: 'no live bridge with pid 7' },
    { mode: 'human', color: false, argv: null },
  );
  assert.equal(named.text.includes('bridge install'), false);
  assert.equal(anonymous.text.includes('bridge install --extension-id <id>'), true);
  assert.equal(named.text === anonymous.text, false);
});

test('기계용 봉투는 bridgePid 를 실어 나르지 않는다 — 호출의 사실이지 실패의 사실이 아니다', () => {
  assert.deepEqual(
    planFail(
      { code: 'bridge-off', message: 'no live bridge with pid 7' },
      { mode: 'json', color: false, argv: null, bridgePid: 7 },
    ),
    {
      stream: 'stdout',
      text: `${JSON.stringify({
        ok: false,
        error: { code: 'bridge-off', message: 'no live bridge with pid 7' },
      })}\n`,
    },
  );
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

// --- planSlowReply: 답하지 않는 브릿지에 내는 한 줄 --------------------------
//
// 이 판단도 `bin/headerlab.mjs` 의 `onSlow` 클로저 안에 있었고, 같은 이유로
// (stderr 가 TTY) 어떤 테스트도 닿지 못했다. 옮겨 놓으니 조합이 표 하나가
// 된다.

const slowCtx = { mode: 'human', quiet: false, stream: tty };

test('사람용 TTY 에서 기다린다는 줄은 stderr 로 간다', () => {
  assert.deepEqual(planSlowReply(10_000, slowCtx), {
    stream: 'stderr',
    text: 'waiting for the extension to reply (10s timeout)…\n',
  });
});

// 기계용 계약은 **stdout 의** 봉투 하나다. 이 줄은 stdout 에 가지 않으므로
// 그 계약을 건드리지 않으며, 설계 §2.4 도 그렇게 적는다 — 그리고 그것이
// 모드를 보지 않는 이유다. 한동안 `mode !== 'human'` 이 맨 앞에 있었고,
// 그래서 터미널에서 `headerlab status --json` 을 치면 §1.1(e) 가 측정한
// "10초 침묵" 이 그대로 남아 있었다. 파이프로 받는 쪽은 아래 TTY 조건에서
// 이미 걸린다.
test('기계용에서도 TTY 면 낸다 — 이 줄은 stdout 이 아니다', () => {
  assert.deepEqual(planSlowReply(10_000, { ...slowCtx, mode: 'json' }), {
    stream: 'stderr',
    text: 'waiting for the extension to reply (10s timeout)…\n',
  });
});

// 위 줄이 stdout 을 건드리지 않는다는 것이 그 자체로 성질이다 — 이것이
// 깨지면 `jq` 로 받는 쪽이 봉투 앞에 산문 한 줄을 받는다.
test('어느 모드에서도 stdout 으로는 가지 않는다', () => {
  for (const mode of ['human', 'json']) {
    assert.equal(planSlowReply(10_000, { ...slowCtx, mode }).stream, 'stderr');
  }
});

test('--quiet 은 진행 상황을 지운다 — 실패와 달리 이것은 산문이다', () => {
  assert.equal(planSlowReply(10_000, { ...slowCtx, quiet: true }), null);
});

// stderr 를 파일이나 파이프로 받는 쪽에게 진행 상황은 잡음이다 (clig Output §14).
test('stderr 가 TTY 가 아니면 내지 않는다', () => {
  assert.equal(planSlowReply(10_000, { ...slowCtx, stream: pipe }), null);
  assert.equal(planSlowReply(10_000, { ...slowCtx, stream: undefined }), null);
});

// 초는 넘겨받은 `timeoutMs` 에서 나온다. 여기에 10 을 다시 적으면
// `sendCommand` 의 기본값을 바꾼 사람이 거짓말하는 줄을 얻는다.
test('초는 timeoutMs 에서 계산된다', () => {
  assert.equal(
    planSlowReply(2000, slowCtx).text,
    'waiting for the extension to reply (2s timeout)…\n',
  );
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
