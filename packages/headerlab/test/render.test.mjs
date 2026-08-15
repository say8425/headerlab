import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderError, renderResult } from '../lib/render.mjs';

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
    state: { globalPause: false, profiles: [{ id: 'p1', enabled: true, filter: { domains: ['a.com'], allSites: false }, headers: [] }] },
  };
  const text = renderResult(payload, { command: ['site', 'add'], ...plain });
  assert.equal(text, 'nothing changed — 1 site in scope: a.com');
});

test('all-sites 모드는 도메인 목록 대신 모드를 말한다', () => {
  const payload = {
    ok: true,
    changed: true,
    state: { globalPause: false, profiles: [{ id: 'p1', enabled: true, filter: { domains: ['a.com'], allSites: true }, headers: [] }] },
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
