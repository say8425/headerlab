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

test('bridge-off 는 다음에 칠 명령을 붙인다', () => {
  const text = renderError({ code: 'bridge-off', message: 'no bridge is running' }, plain);
  assert.equal(
    text,
    [
      'no bridge is running.',
      '  headerlab bridge status                        see what is installed',
      '  headerlab bridge install --extension-id <id>   if the manifest is missing',
      'Then open the HeaderLab popup and press Enable on the bridge row — the CLI',
      'cannot do that step.',
    ].join('\n'),
  );
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
