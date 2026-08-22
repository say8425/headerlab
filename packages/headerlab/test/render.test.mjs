import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderError, renderResult, usageFor } from '../lib/render.mjs';

const plain = { color: false };

test('site add 가 전체 상태가 아니라 요약을 그린다', () => {
  const payload = {
    ok: true,
    changed: true,
    state: {
      globalPause: false,
      profiles: [
        {
          id: 'p1',
          enabled: true,
          filter: { domains: ['a.com', 'b.com'], allSites: false },
          headers: [],
        },
      ],
    },
  };
  const text = renderResult(payload, { command: ['site', 'add'], ...plain });
  // 부재를 먼저 검사한다: AppState 를 통째로 찍는 구현이 이 파일의 결함이었다.
  assert.equal(text.includes('"profiles"'), false);
  assert.equal(text.includes('p1'), false);
  assert.equal(text, '2 sites in scope: a.com, b.com');
});

test('changed:false 는 아무것도 안 바뀌었다고 말한다', () => {
  const payload = {
    ok: true,
    changed: false,
    state: {
      globalPause: false,
      profiles: [
        { id: 'p1', enabled: true, filter: { domains: ['a.com'], allSites: false }, headers: [] },
      ],
    },
  };
  const text = renderResult(payload, { command: ['site', 'add'], ...plain });
  assert.equal(text, 'nothing changed — 1 site in scope: a.com');
});

test('all-sites 모드는 도메인 목록 대신 모드를 말한다', () => {
  const payload = {
    ok: true,
    changed: true,
    state: {
      globalPause: false,
      profiles: [
        { id: 'p1', enabled: true, filter: { domains: ['a.com'], allSites: true }, headers: [] },
      ],
    },
  };
  assert.equal(
    renderResult(payload, { command: ['site', 'all-sites'], ...plain }),
    'applying to all sites',
  );
});

/**
 * `renderWrite` 의 나머지 세 갈래. `site` 하나만 검사되던 동안 `rule`·
 * `pause`/`resume`·`state set` 의 사람용 출력은 스위트 어디에서도 실행되지
 * 않았고, 갈래를 고르는 삼항이 틀려도 아무것도 빨개지지 않았다.
 */
const withRules = (rules, extra = {}) => ({
  ok: true,
  changed: true,
  state: {
    globalPause: false,
    profiles: [
      {
        id: 'p1',
        enabled: true,
        filter: { domains: ['a.com'], allSites: false },
        headers: rules,
      },
    ],
    ...extra,
  },
});

const rule = (id, enabled) => ({
  id,
  enabled,
  target: 'request',
  operation: 'set',
  name: 'X',
  value: '1',
});

test('rule add 는 규칙 수와 켜진 수를 말한다', () => {
  const text = renderResult(withRules([rule('r1', true), rule('r2', false)]), {
    command: ['rule', 'add'],
    ...plain,
  });
  assert.equal(text.includes('"headers"'), false);
  assert.equal(text, '2 rules, 1 on');
});

test('규칙 하나는 단수로 센다', () => {
  assert.equal(
    renderResult(withRules([rule('r1', true)]), { command: ['rule', 'toggle'], ...plain }),
    '1 rule, 1 on',
  );
});

test('pause 와 resume 는 서로 다른 문장을 낸다', () => {
  const paused = withRules([], { globalPause: true });
  const running = withRules([]);
  assert.equal(
    renderResult(paused, { command: ['pause'], ...plain }),
    'paused — no headers are being modified',
  );
  assert.equal(renderResult(running, { command: ['resume'], ...plain }), 'running');
});

/**
 * `state set` 은 갈래가 없어 else 로 떨어졌고, 그래서 되돌릴 수 없는 전체
 * 덮어쓰기를 확인까지 하고 실행한 사람이 보는 것은 `running` 한 단어였다 —
 * 아무 일도 안 일어났을 때와 바이트가 같다. 설계 §2.7 의 "무엇이 바뀌었는지
 * 말한다" 를 그 명령 하나만 안 지키고 있었다.
 */
test('state set 은 무엇으로 바뀌었는지 말한다 — pause 상태가 아니라', () => {
  const text = renderResult(withRules([rule('r1', true), rule('r2', true)]), {
    command: ['state', 'set'],
    ...plain,
  });
  // 부재를 먼저: 예전 출력이 그대로 나오면 이 테스트는 의미가 없다.
  assert.equal(text === 'running', false);
  assert.equal(text, 'replaced — 2 rules, 2 on, 1 site in scope: a.com');
});

test('bridge status 를 표로 그린다', () => {
  const payload = {
    ok: true,
    installed: true,
    manifestPath: '/m/com.headerlab.bridge.json',
    launcherPath: '/l/headerlab-host',
    launcherMissing: false,
    entryMissing: false,
    allowedOrigins: ['chrome-extension://abc/'],
    liveBridges: [],
  };
  assert.equal(
    renderResult(payload, { command: ['bridge', 'status'], ...plain }),
    [
      'manifest  installed      /m/com.headerlab.bridge.json',
      'launcher  ok             /l/headerlab-host',
      'bridge    not running',
    ].join('\n'),
  );
});

test('bridge status 가 entryMissing 을 그대로 말한다', () => {
  const payload = {
    ok: true,
    installed: true,
    manifestPath: '/m/x.json',
    launcherPath: '/l/headerlab-host',
    launcherMissing: false,
    entryMissing: true,
    allowedOrigins: [],
    liveBridges: [{ pid: 9, origin: null }],
  };
  const text = renderResult(payload, { command: ['bridge', 'status'], ...plain });
  assert.equal(text.includes('entry missing'), true);
  assert.equal(text.includes('1 live (pid 9)'), true);
});

test('bridge install 을 표로 그린다', () => {
  const payload = {
    ok: true,
    manifestPath: '/m/com.headerlab.bridge.json',
    launcherPath: '/l/headerlab-host',
    extensionId: 'a'.repeat(32),
    verified: true,
  };
  assert.equal(
    renderResult(payload, { command: ['bridge', 'install'], ...plain }),
    [
      'installed  /m/com.headerlab.bridge.json',
      'launcher   /l/headerlab-host',
      `extension  ${'a'.repeat(32)}`,
    ].join('\n'),
  );
});

// 손 확인에서 잡힌 결함: 브리프가 준 폭 11 은 'installed'(9자)에는
// 맞았지만 'would install'(13자)에는 짧아서, pad() 가 아무 것도 못
// 붙이고 verb 와 경로가 그대로 들러붙었다 — 'would install/m/...'.
// 아래는 그 사이에 최소 한 칸이 있는지를 직접 잰다.
test('bridge install --dry-run 은 매니페스트를 보여주고, verb 가 길어져도 경로와 들러붙지 않는다', () => {
  const payload = {
    ok: true,
    dryRun: true,
    manifestPath: '/m/com.headerlab.bridge.json',
    launcherPath: '/l/headerlab-host',
    extensionId: 'a'.repeat(32),
    manifest: {
      name: 'com.headerlab.bridge',
      path: '/l/headerlab-host',
      type: 'stdio',
      allowed_origins: [`chrome-extension://${'a'.repeat(32)}/`],
    },
  };
  const text = renderResult(payload, { command: ['bridge', 'install'], ...plain });
  const lines = text.split('\n');

  assert.equal(lines[0].startsWith('would install '), true);
  assert.equal(lines[0].includes('would install/m/'), false);
  assert.equal(lines[0].endsWith('/m/com.headerlab.bridge.json'), true);
  assert.equal(text.includes(JSON.stringify(payload.manifest, null, 2)), true);
  assert.equal(text.endsWith('Nothing was written.'), true);
});

// pad(launcher, 15) 가 이미 `paint()` 를 거친 문자열에 적용되면 ANSI
// 바이트가 너비에 끼어들어 색이 켜졌을 때는 패딩이 하나도 안 붙는다 —
// 측정: 색 꺼짐 'missing        /l/headerlab-host', 색 켜짐
// 'missing/l/headerlab-host' (ESC 바이트까지 15자를 채워 공백이 안 남음).
// ANSI 를 벗겨낸 "켜짐" 이 "꺼짐" 과 바이트까지 같아야 한다는 것이 이
// 어서션이다 — 너비가 칠하기 전 텍스트로 계산되지 않으면 정렬이 어긋난다.
// ESC(0x1b) 를 실제로 매치하려는 패턴이다 — ASCII 범위 검사가 아니지만,
// 이 규칙이 못 보는 것은 같다: "제어 문자를 매치하려는 의도" 그 자체가
// 여기서는 결함이 아니라 목적이다.
// oxlint-disable-next-line no-control-regex
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');

test('bridge status 의 launcher 열은 색을 켜도 켜지지 않은 것과 같은 자리에 정렬된다', () => {
  const payload = {
    ok: true,
    installed: true,
    manifestPath: '/m/x.json',
    launcherPath: '/l/headerlab-host',
    launcherMissing: true,
    entryMissing: false,
    allowedOrigins: [],
    liveBridges: [],
  };
  const off = renderResult(payload, { command: ['bridge', 'status'], color: false });
  const on = renderResult(payload, { command: ['bridge', 'status'], color: true });
  assert.equal(stripAnsi(on), off);
  // 부재가 아니라 실제로 정렬이 벌어진 채였다는 것도 함께 못박는다: 색을
  // 켰을 때 'missing' 바로 뒤에 붙던 것이 고쳐지면 공백을 사이에 둔다.
  assert.equal(off.includes('missing        /l/headerlab-host'), true);
});

test('에러는 메시지 한 줄이다', () => {
  assert.equal(
    renderError({ code: 'store-unreadable', message: 'the stored state does not match' }, plain),
    'the stored state does not match',
  );
});

/**
 * 이 fixture 의 메시지는 예전에 `'no bridge is running'` 이었다 — 이 갈래가
 * **박아 넣고 있던 바로 그 문장**이라, 메시지를 통째로 버리는 구현이 여기서
 * 보이지 않았다. 유일하게 안 빨개지는 문자열을 골라 먹인 셈이다. 지금은
 * 렌더가 지어낼 수 없는 문장을 먹여서, 버리는 구현이 첫 줄에서 걸리게 한다.
 */
test('bridge-off 는 받은 메시지로 시작하고 다음에 칠 명령을 붙인다', () => {
  const text = renderError({ code: 'bridge-off', message: 'the socket directory is empty' }, plain);
  assert.equal(
    text,
    [
      'the socket directory is empty.',
      '  headerlab bridge status                        see what is installed',
      '  headerlab bridge install --extension-id <id>   if the manifest is missing',
      'Then open the HeaderLab popup and turn on the switch on its Agent bridge',
      'row — the CLI cannot do that step.',
    ].join('\n'),
  );
});

// 실제 문장(`lib/bridge.mjs` 의 `resolveTarget` 이 던지는 것)으로 같은 갈래를
// 한 번 더 못박는다 — 위 테스트가 합성 문장을 쓰므로, 사람이 실제로 보는
// 바이트를 아무것도 재지 않게 되는 것을 막는다.
test('아무것도 안 떠 있을 때의 실제 문장은 예전 출력과 바이트가 같다', () => {
  const text = renderError({ code: 'bridge-off', message: 'no bridge is running' }, plain);
  assert.equal(text.split('\n')[0], 'no bridge is running.');
});

/**
 * `--bridge <pid>` 가 없는 pid 를 지목한 실패. 박아 넣은 문장은 여기서
 * **거짓**이었다 — 다른 브릿지가 살아 있을 수 있고, 그게 `--bridge` 가
 * 존재하는 유일한 이유다 — 그리고 이미 설치된 매니페스트를 다시 설치하라고
 * 시켰다. 부재를 먼저 못박는 이유가 그것이다: `bridge install` 이 남아 있는
 * 구현은 메시지만 앞에 붙여도 아래 어서션을 통과한다.
 */
test('지목한 pid 가 없으면 그 문장을 그대로 내고, 설치가 아니라 pid 목록을 가리킨다', () => {
  const text = renderError(
    { code: 'bridge-off', message: 'no live bridge with pid 999999' },
    { color: false, bridgePid: 999999 },
  );
  assert.equal(text.includes('no bridge is running'), false);
  assert.equal(text.includes('bridge install'), false);
  assert.equal(text.includes('switch'), false);
  assert.equal(
    text,
    [
      'no live bridge with pid 999999.',
      '  headerlab bridge status   list the bridges that are live',
      'Re-run with a pid from that list, or drop --bridge when only one is live.',
    ].join('\n'),
  );
});

// 갈래를 고르는 것은 메시지가 아니라 `bridgePid` 다. 문장을 다시 알아보는
// 구현(`message.startsWith('no live bridge')`)은 이 두 어서션에서 갈린다:
// 같은 메시지가 pid 없이 오면 설치 안내가 나와야 하고, 다른 메시지가 pid 와
// 함께 오면 pid 안내가 나와야 한다.
test('갈래는 메시지가 아니라 bridgePid 가 고른다', () => {
  const noPid = renderError(
    { code: 'bridge-off', message: 'no live bridge with pid 7' },
    { color: false, bridgePid: null },
  );
  assert.equal(noPid.includes('bridge install --extension-id <id>'), true);

  const withPid = renderError(
    { code: 'bridge-off', message: 'no bridge is running' },
    { color: false, bridgePid: 7 },
  );
  assert.equal(withPid.includes('bridge install'), false);
  assert.equal(withPid.includes('list the bridges that are live'), true);
});

test('색이 켜지면 진짜 ESC 바이트(0x1b)를 낸다 — 대괄호 문자만으로는 안 속는다', () => {
  const on = renderError({ code: 'store-unreadable', message: 'boom' }, { color: true });
  const off = renderError({ code: 'store-unreadable', message: 'boom' }, { color: false });
  assert.equal(off.includes('\x1b'), false);
  assert.equal(on.includes('\x1b'), true);
  assert.equal(on, '\x1b[31mboom\x1b[0m');
  // 리터럴 대괄호로 시작하는 오탐(예: '[31m')을 잡기 위해 이스케이프 바이트를 직접 확인한다.
  assert.equal(on.charCodeAt(0), 0x1b);
});

// --- usageFor: 설계 §5.3 의 usage 줄 -----------------------------------------
//
// 이 함수는 `bin/headerlab.mjs` 안에 있었고, 그래서 어떤 테스트도 닿지
// 못했다 — 사람용 분기는 stdout 이 TTY 일 때만 도는데 `node --test` 가
// 띄우는 자식의 stdout 은 파이프다. 코드가 순수 `(code, argv) → string|null`
// 인데도 프로세스 안에 갇혀 있었던 것이 결함이었다. 여기로 옮겼으니
// 프로세스를 띄우지 않고 네 갈래를 전부 잰다.

test('invalid-args 이고 표에 있는 명령이면 그 명령의 usage 줄을 낸다', () => {
  assert.equal(usageFor('invalid-args', ['rule', 'toggle']), 'headerlab rule toggle <id>');
});

test('args 가 없는 명령이면 usage 줄도 인자 없이 끝난다', () => {
  assert.equal(
    usageFor('invalid-args', ['rule', 'add', '--target', 'bogus']),
    'headerlab rule add',
  );
});

// 부재를 먼저 못박는다. `headerlab site` 는 `site add` 도 `site rm` 도 아니어서
// 고를 usage 가 없고, 하나를 골라 보여 주는 것은 사용자가 치려던 것을 지어내는
// 일이다. 언제나 무언가를 붙이는 구현은 여기서만 빨개진다.
test('표에 맞는 명령이 없으면 아무것도 붙이지 않는다', () => {
  assert.equal(usageFor('invalid-args', ['site']), null);
  assert.equal(usageFor('invalid-args', ['teleport', 'now']), null);
  assert.equal(usageFor('invalid-args', []), null);
});

// 코드마다 붙이는 구현을 잡는다. argv 는 위 첫 테스트와 같아서 — 표에는
// 분명히 있다 — 오직 코드만이 차이다.
test('invalid-args 가 아니면 표에 있는 명령이어도 붙이지 않는다', () => {
  assert.equal(usageFor('unknown-command', ['rule', 'toggle']), null);
  assert.equal(usageFor('bridge-off', ['rule', 'toggle']), null);
  assert.equal(usageFor('usage', ['rule', 'toggle']), null);
});

test('argv 가 없으면 null 이다 — 확장이 거부한 응답에는 argv 가 없다', () => {
  assert.equal(usageFor('invalid-args', null), null);
  assert.equal(usageFor('invalid-args', undefined), null);
});

// 가장 긴 일치. `site all-sites on` 이 `site` 로 잡히면 usage 줄이 다른
// 명령의 것이 된다 — 표에 `site` 단독 항목이 없으니 그때는 null 이 나오고,
// 이 어서션이 그 회귀를 잡는다.
test('가장 긴 일치를 고른다', () => {
  assert.equal(
    usageFor('invalid-args', ['site', 'all-sites', 'maybe']),
    'headerlab site all-sites on|off',
  );
});

// --- 읽기 명령 넷: 같은 payload, 네 가지 그림 --------------------------------
//
// `lib/bridge/query.ts` 의 `StatusPayload` 를 그대로 옮긴 fixture 다 —
// 필드 이름이 어긋나면 여기가 아니라 실제 소켓 너머에서 조용히 undefined 가
// 되므로, 이름은 그 파일에서 손으로 베낀 것이다.
const statusPayload = {
  ok: true,
  globalPause: false,
  scopingHosts: ['a.com'],
  suppression: null,
  tally: { total: 2, live: 1, off: 1, unfinished: 0, blocked: 0 },
  profile: {
    id: 'p1',
    filter: { domains: ['a.com'], allSites: false },
    headers: [
      { id: 'r1', enabled: true, target: 'request', operation: 'set', name: 'A', value: '1' },
      { id: 'r2', enabled: false, target: 'response', operation: 'remove', name: 'B', value: '' },
    ],
  },
  diagnostics: { byRow: [], byHost: [], scope: [] },
  state: { version: 2, globalPause: false, profiles: [] },
};

test('rule ls 가 규칙마다 한 줄을 그린다', () => {
  const text = renderResult(statusPayload, { command: ['rule', 'ls'], ...plain });
  const lines = text.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'r1  on   request   set     A → 1');
  assert.equal(lines[1], 'r2  off  response  remove  B');
});

test('rule ls 가 규칙이 하나도 없으면 그렇게 말한다', () => {
  const payload = { ...statusPayload, profile: { ...statusPayload.profile, headers: [] } };
  assert.equal(renderResult(payload, { command: ['rule', 'ls'], ...plain }), 'no rules yet');
});

// `byRow` 의 키는 `rowKey(profileId, headerRuleId)` = `'p1 r1'` 이다
// (lib/compile/validate.ts). 키를 `endsWith(rule.id)` 로 찾는 구현은 `r1`
// 이 `xr1` 의 접미사이므로 **다른 줄의 문제를 뒤집어쓴다** — 위 테스트들은
// 전부 통과한 채로. 정확한 키를 짓는 구현만 여기서 살아남는다.
test('rule ls 의 진단은 그 진단이 이름 댄 줄에만 붙는다', () => {
  const payload = {
    ...statusPayload,
    profile: {
      ...statusPayload.profile,
      headers: [
        { id: 'r1', enabled: true, target: 'request', operation: 'set', name: 'A', value: '1' },
        { id: 'xr1', enabled: true, target: 'request', operation: 'set', name: 'B', value: '2' },
      ],
    },
    diagnostics: {
      byRow: [['p1 xr1', [{ severity: 'error', message: 'not a valid header name' }]]],
      byHost: [],
      scope: [],
    },
  };
  const lines = renderResult(payload, { command: ['rule', 'ls'], ...plain }).split('\n');
  assert.equal(lines[0].includes('not a valid header name'), false);
  assert.equal(lines[1].includes('not a valid header name'), true);
});

test('site ls 가 도메인마다 한 줄을 그린다', () => {
  assert.equal(renderResult(statusPayload, { command: ['site', 'ls'], ...plain }), 'a.com');
});

test('site ls 가 all-sites 를 모드로 말한다', () => {
  const payload = {
    ...statusPayload,
    scopingHosts: [],
    profile: { ...statusPayload.profile, filter: { domains: ['a.com'], allSites: true } },
  };
  assert.equal(
    renderResult(payload, { command: ['site', 'ls'], ...plain }),
    'all sites (1 saved site is not scoping anything while this mode is on)',
  );
});

test('site ls 가 all-sites 에서 저장된 사이트 수를 복수로도 센다', () => {
  const payload = {
    ...statusPayload,
    scopingHosts: [],
    profile: { ...statusPayload.profile, filter: { domains: ['a.com', 'b.com'], allSites: true } },
  };
  assert.equal(
    renderResult(payload, { command: ['site', 'ls'], ...plain }),
    'all sites (2 saved sites are not scoping anything while this mode is on)',
  );
});

test('site ls 가 빈 스코프를 조용히 빈 줄로 내지 않는다', () => {
  const payload = { ...statusPayload, scopingHosts: [] };
  assert.equal(renderResult(payload, { command: ['site', 'ls'], ...plain }), 'nothing in scope');
});

test('state get 이 상태를 보기 좋게 찍는다', () => {
  const text = renderResult(statusPayload, { command: ['state', 'get'], ...plain });
  assert.equal(text, JSON.stringify(statusPayload.state, null, 2));
});

test('status 가 요약 넷을 그린다', () => {
  const text = renderResult({ ...statusPayload, live: true }, { command: ['status'], ...plain });
  assert.equal(text.includes('rules     2 total, 1 on'), true);
  assert.equal(text.includes('scope     a.com'), true);
  assert.equal(text.includes('headers   running'), true);
  assert.equal(text.includes('bridge    live'), true);
});

test('status 가 일시정지를 running 이라 부르지 않는다', () => {
  const text = renderResult(
    { ...statusPayload, live: true, globalPause: true },
    { command: ['status'], ...plain },
  );
  assert.equal(text.includes('headers   running'), false);
  assert.equal(text.includes('headers   paused'), true);
});

// 브릿지가 없으면 상태를 **모른다**. 세 줄을 기본값으로 채우는 구현은
// "헤더가 돌고 있고 규칙이 없고 스코프가 비었다" 고 단언하는데, 셋 다
// 확인된 적이 없다 — 이 저장소가 금지하는 조용한 거짓말이다.
// 기본값으로 채우는 구현은 정확히 이 세 줄을 낸다 — 라벨과 패딩까지
// 그대로다. 산문에 'rules' 라는 낱말이 들어가는 것과는 다르므로, 낱말이
// 아니라 그 줄 모양을 잰다.
test('status 는 브릿지가 없으면 모르는 것을 지어내지 않는다', () => {
  const text = renderResult({ ok: true, live: false }, { command: ['status'], ...plain });
  assert.equal(text.includes('headers   '), false);
  assert.equal(text.includes('rules     '), false);
  assert.equal(text.includes('scope     '), false);
  assert.equal(text.includes('not running'), true);
  assert.equal(text.includes('bridge status'), true);
});

test('status 가 프로필이 없는 상태를 none yet 으로 말한다', () => {
  const text = renderResult(
    { ...statusPayload, live: true, tally: null, profile: null, scopingHosts: [] },
    { command: ['status'], ...plain },
  );
  assert.equal(text.includes('rules     none yet'), true);
  assert.equal(text.includes('scope     nothing in scope'), true);
});

test('status 가 all-sites 를 모드로 말한다', () => {
  const text = renderResult(
    {
      ...statusPayload,
      live: true,
      scopingHosts: [],
      profile: { ...statusPayload.profile, filter: { domains: ['a.com'], allSites: true } },
    },
    { command: ['status'], ...plain },
  );
  assert.equal(text.includes('scope     all sites'), true);
});

// 억눌린 프로필은 규칙이 멀쩡해 보이면서 아무것도 내보내지 않는다. 그
// 사실이 화면에 닿아야 한다는 것이 이 저장소의 규칙이고, 닿는 문장은
// 슬러그(`no-scope`)가 아니라 사람의 말이어야 한다.
test('status 가 억눌린 이유를 사람 말로 말한다', () => {
  const noScope = renderResult(
    { ...statusPayload, live: true, suppression: 'no-scope' },
    { command: ['status'], ...plain },
  );
  assert.equal(noScope.includes('no-scope'), false);
  assert.equal(noScope.includes('not applying — no site is set'), true);

  const unusable = renderResult(
    { ...statusPayload, live: true, suppression: 'unusable-site' },
    { command: ['status'], ...plain },
  );
  assert.equal(unusable.includes('unusable-site'), false);
  assert.equal(unusable.includes('not applying — a listed site cannot be used'), true);
});

// 이유가 하나 늘고 여기 말이 안 늘면, 표를 못 찾은 구현은 조용히 아무것도
// 안 찍을 수 있다. 모르는 이유는 슬러그 그대로라도 화면에 닿는다.
test('status 가 모르는 억눌림 이유도 삼키지 않는다', () => {
  const text = renderResult(
    { ...statusPayload, live: true, suppression: 'brand-new-reason' },
    { command: ['status'], ...plain },
  );
  assert.equal(text.includes('brand-new-reason'), true);
});

test('status 는 색을 켜도 벗기면 끈 것과 같다', () => {
  const on = renderResult(
    { ...statusPayload, live: true, suppression: 'no-scope' },
    { command: ['status'], color: true },
  );
  const off = renderResult(
    { ...statusPayload, live: true, suppression: 'no-scope' },
    { command: ['status'], color: false },
  );
  assert.equal(stripAnsi(on), off);
  assert.equal(on.includes('\x1b'), true);
});
