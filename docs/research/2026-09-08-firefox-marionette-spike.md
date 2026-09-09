# Firefox 스파이크 — 의존성 없이 확장을 올리고 헤더를 wire 에서 읽기

2026-09-08, macOS 15.5, Firefox Developer Edition 156.0b3, Node 24.16.0. 질문은 하나였다:
**새 의존성 없이 진짜 Firefox 에 이 확장을 설치하고, 상태를 심고, 에코 서버에서 수정된
헤더를 읽어낼 수 있는가.** 답은 예 — 단, 처음 짚은 프로토콜이 아니라 두 번째 것으로.

스크립트는 버렸다. 여기 남긴 것은 잰 값과, 하네스가 될 최소 코드다. 설계는
`docs/superpowers/specs/2026-09-08-firefox-support-design.md`.

## 결과 한 줄

```
installed { value: 'headerlab@say8425.github.io' }
permissions.contains(127.0.0.1): true
seed: ok
dynamic rules: 1
popup mounted: true
probe headers: { …, "x-headerlab-test": "applied", … }
RESULT x-headerlab-test = applied PASS
x-headerlab-disabled = undefined
```

Chrome 의 `tests/e2e/header-modification.spec.ts` 첫 테스트와 같은 픽스처, 같은 판정.

## 막힌 순서대로

1. **WXT 는 `-b firefox` 를 MV2 로 빌드한다.** `wxt build -b firefox --mode e2e` →
   `.output/firefox-mv2-e2e`. `--mv3` 를 붙여야 `firefox-mv3-e2e` 가 나오고, 그 매니페스트는
   `background: { scripts: ['background.js'] }` 를 갖는다 (`service_worker` 없음). 설정에
   `manifestVersion: 3` 을 두면 플래그가 필요 없다.
2. **WebDriver BiDi 는 `moz-extension://` 내비게이션을 거부한다.** Node 24 의 내장
   `WebSocket` 으로 `ws://127.0.0.1:<port>/session` 에 붙어 `session.new` →
   `webExtension.install { extensionData: { type: 'path', path } }` 까지는 됐다
   (`{ extension: 'headerlab@say8425.github.io' }`). `browsingContext.navigate` 는
   `unsupported operation: Navigation to "moz-extension://…/popup.html" is not allowed in this
   context`.
3. **Marionette 도 같은 문장으로 거부한다 — 플래그 전까지.** `WebDriver:Navigate` 가 같은
   메시지. chrome 컨텍스트로 우회하려 하자 `System access is required. Start Firefox with
   "-remote-allow-system-access" to enable it.` 이 플래그를 켜니 **직접 내비게이션이
   통과했다.** 플래그는 Firefox 138 부터 (Bugzilla 1944565; Debian #1105817 이 138 에서
   깨진 도구를 보고했다).
4. **Marionette 와 BiDi 를 한 세션으로 묶는 것은 geckodriver 의 일이다.** Marionette
   `WebDriver:NewSession` 에 `webSocketUrl: true` 를 줘도 응답 capabilities 에 `webSocketUrl`
   이 없다. Firefox 는 WebDriver 세션을 하나만 허용하므로 둘을 따로 열 수도 없다. 그래서
   Marionette 만 썼고, 필요한 명령은 전부 거기 있었다.
5. **Firefox 의 보조 프로세스가 파이프를 쥔다.** 부모에 SIGKILL 을 보내도 crashhelper 와
   plugin-container 가 상속한 stdout 파이프를 쥔 채 남아, `| tail` 이 EOF 를 영원히
   기다렸다. `spawn(…, { detached: true })` 후 `process.kill(-pid, 'SIGKILL')` 로 그룹을
   죽여야 한다.
6. **표현식 안의 정규식 이스케이프.** `ExecuteAsyncScript` 에 넘긴 문자열이 문법 오류면
   콜백이 영영 불리지 않고 명령은 조용히 멈춘다. 클라이언트의 `send` 에 명령 이름을 실은
   타임아웃이 필요한 이유다.

## Firefox 의 DNR 이 받는 것과 거부하는 것

팝업 페이지 컨텍스트에서 `updateDynamicRules` 를 직접 불렀다. 기준 룰은
`{ requestDomains: ['127.0.0.1'], resourceTypes: ['main_frame'] }` 에 `modifyHeaders`.

| 시도 | 결과 |
| --- | --- |
| `resourceTypes: ['webbundle']` | **REJECTED** — `Invalid enumeration value "webbundle"`, 배치 전체 |
| `resourceTypes: ['webtransport']` | **REJECTED** — 같은 문장 |
| 요청 헤더 `X-Custom` `append` | ACCEPTED (Chrome 은 21개 허용목록 밖이라 거부) |
| 요청 헤더 `accept-language` `append` | ACCEPTED |
| 응답 헤더 `X-Custom` `append` | ACCEPTED |
| `tabIds` 를 dynamic 룰에 | REJECTED — `tabIds and excludedTabIds can only be specified in session rules` (Chrome 과 같음) |
| 헤더 이름 `X A` (공백) | ACCEPTED — Chrome 은 거부. `HEADER_TOKEN` 검사는 양쪽에 남긴다: 유효한 HTTP 가 아니다 |

`isRegexSupported` 는 있다 (`{isSupported: true}`). `MAX_NUMBER_OF_DYNAMIC_RULES` 5000,
`MAX_NUMBER_OF_SESSION_RULES` 5000. 등록된 룰을 `getDynamicRules` 로 읽으면 Firefox 는
지정하지 않은 필드를 `null` 로 채워 돌려준다 — 같은 룰을 Chrome 은 키를 생략해 돌려주므로,
룰 객체를 `toEqual` 로 비교하는 테스트는 브라우저를 가려 써야 한다.

## `permissions.contains` — 사다리는 여기서도 필요하다

e2e 매니페스트가 `host_permissions: ['http://127.0.0.1/*']` 를 갖고, 프리퍼런스
`extensions.originControls.grantByDefault = true` 로 임시 설치 시 부여됐다.

| 물음 | 답 |
| --- | --- |
| `http://127.0.0.1/*` | true |
| `https://127.0.0.1/*` | false |
| `*://127.0.0.1/*` | false |
| `<all_urls>` | false |
| `{ permissions: ['nativeMessaging'] }` | false (선언하지 않은 optional 권한) |
| `https://example.com:8080/*` (포트 든 패턴) | **false, throw 하지 않음** — Chrome 은 throw |

즉 `originCandidates` 의 여섯 단은 Firefox 에서도 그대로 필요하고, `probe.ts` 의 catch 는
Firefox 에서는 한 번도 타지 않지만 있어서 나쁠 것이 없다.

## 매니페스트와 팝업

- `browser.runtime.getManifest().background` →
  `{"scripts":["moz-extension://<uuid>/background.js"], "service_worker": null, …}`.
- 팝업은 헤드리스 탭(1366×683)에서 748×600 으로 그려졌다. 레일·룰 패널·리드아웃
  `1 of 2 live · 1 off` 모두 정상. **브릿지 행이 "Agent bridge off" 로 보였다** — 스펙이
  Firefox 에서 그 행을 없애는 이유의 그림.
- **실제 툴바 팝업 패널 안에서 재었다 (2026-09-09,** macOS 15.5, Firefox Developer Edition
  156.0b3, 프로덕션 빌드 `.output/firefox-mv3`, 화면 1992×1290 @2x, 창 1280×1040 **).**
  `.webextension-popup-browser` 의 `getBoundingClientRect()` 가 **748×600** — 잘리지 않는다.
  패널 자체는 750×602 (테두리 1px 씩), `panelId` 는 `customizationui-widget-panel`,
  `state: "open"`. Firefox 의 상한 800×600 안에 그대로 들어가므로 이 디자인은 Chrome 과
  Firefox 에서 같은 크기로 선다. 브릿지 행은 없다 — 팝업 DOM 의 `[data-testid="bridgestate"]`
  가 0 이고, 패널 캡처로도 확인했다.
- **툴바 버튼을 스크립트로 누르는 법은 세 번 틀린 뒤에 나왔다.** 위젯 노드
  (`headerlab_say8425_github_io-browser-action`) 는 `toolbaritem` **래퍼**라 거기에 건
  `click()` 도 `doCommand()` 도 아무 일도 하지 않는다 — 조용히, 오류 없이. 열리는 것은 안쪽
  `toolbarbutton.unified-extensions-item-action-button` 을 눌렀을 때다. 곁들여: chrome
  컨텍스트의 `window.windowUtils` 에 `sendMouseEvent` 가 **없고**,
  `resource:///modules/CustomizableUI.sys.mjs` 는 156 에서 사라졌다 (`CustomizableUI` 는 창
  전역으로 잡힌다). 위젯을 nav-bar 에 고정하는 것은 `CustomizableUI.addWidgetToArea` 로 된다.
- **Grant 는 진짜 doorhanger 를 띄우고, 허용하면 행이 바뀐다 (2026-09-09, 같은 빌드).**
  `originControls.grantByDefault: false` + `webextOptionalPermissionPrompts: true` 로 두고
  Grant 를 **신뢰된 클릭**(`WebDriver:ElementClick`) 으로 눌렀다 — 스크립트가 만든 클릭은
  사용자 활성화가 아니라서 `permissions.request()` 가 아무 것도 띄우지 않는다. 전:
  `permissions.getAll().origins` 가 `[]`, 두 행 모두 `Grant`, 리드아웃
  `0 of 3 live · 1 off · 2 blocked · 2 sites need access`. doorhanger 는
  `addon-webext-permissions-notification`, 기본 버튼 `허용`, 문안은 "api.example.com 도메인
  사이트에 대한 사용자 데이터에 접근" 한 줄. 후: `origins: ["*://*.api.example.com/*"]`,
  그 행만 `Access granted`, `localhost` 는 `Grant` 그대로, 리드아웃
  `2 of 3 live · 1 off · 1 site needs access`. 한 사이트만 바뀌는 것이 요점이다 — 권한은
  오리진별이고 화면이 그렇게 읽힌다.
- **드롭된 타입 노트는 두 문장 다 잘린다 (2026-09-09, 같은 헤디드 팝업, 팝업 탭에서).**
  `[data-testid="type-note"]` 는 `truncate` 라 `scrollWidth > clientWidth` 가 잘림의 판정이고,
  텍스트가 실제로 받는 폭은 **199px** 이다 (레일 224 − `px-3` 24; 부모 223.x). 스펙 §6 의
  예산 200px 과 같은 값으로 읽으면 된다.

  | 문장 | scrollWidth | 판정 |
  | --- | --- | --- |
  | error `Not supported in Firefox: webbundle, webtransport.` | 284 | 잘림 (+85) |
  | warning `Not supported in Firefox: webbundle.` | 203 | 잘림 (+4) |
  | 후보 `Skipped in Firefox: webbundle, webtransport.` | 248.9 | **여전히 잘림 (+50)** |
  | 후보 `Skipped in Firefox: webbundle.` | 168.4 | 들어감 |

  표의 후보 두 줄은 실제로 렌더된 노트가 아니라, 같은 팝업·같은 폰트(11px/600)에서 숨긴
  `<span>` 으로 잰 값이다. 그 방법이 맞는지는 처음 두 줄로 검증했다 — 같은 프로브가
  283.42 와 202.87 을 냈고 실제 노트의 `scrollWidth` 는 284 와 203 이었다.
  **따라서 스펙 §6 이 제안한 축약은 warning 을 고치고 error 는 고치지 못한다.** 199px 에
  이름 둘은 들어가지 않는다. 그것은 카피가 아니라 설계의 문제이고 소유자의 결정이므로,
  카피는 건드리지 않았다. 지금 잃는 것은 없다 — `title` 이 전체 문장을 싣는다. 드롭될 수
  있는 타입은 Firefox 에서 `webbundle` 과 `webtransport` 둘뿐이므로 위 error 행이 최악이다.

## 하네스의 씨앗

버린 스크립트에서 다시 쓸 부분만. 의존성은 `node:net`, `node:child_process`, `node:fs` 뿐.

**아래 프레이밍에는 버그가 있다. 고쳐서 쓰거나 `tests/support/marionette.ts` 를 쓰라
(2026-09-09 에 이것으로 한 번 깨졌다).** 프레임 길이는 **바이트**인데 아래 코드는
`setEncoding('utf8')` 뒤 문자열을 이어 붙이고 `buf.length`·`slice` 로 **문자**를 센다.
ASCII payload 에서는 둘이 같아서 스파이크 내내 멀쩡했고, 리드아웃 텍스트의 `·`(U+00B7,
UTF-8 로 2바이트) 가 처음 지나가는 순간 스트림이 어긋나 `JSON.parse` 가
`Unexpected non-whitespace character after JSON` 으로 죽는다. 다음 프레임의 길이 접두사를
payload 안으로 끌고 들어가기 때문이다. `tests/support/marionette.ts` 의 `parseFrames` 는
Buffer 위에서 `subarray` 로 자르므로 이 문제가 없다 — 이 파일이 남긴 씨앗이 아니라 그쪽이
지금의 정본이다.

```js
// Marionette: TCP 위 "<len>:<json>". 서버가 먼저 hello 를 보낸다.
// 명령 [0, id, name, params] → 응답 [1, id, error, result].
async function marionette(port) {
  const sock = await new Promise((resolve) => {
    const attempt = () => {
      const s = connect({ host: '127.0.0.1', port }, () => resolve(s));
      s.once('error', () => setTimeout(attempt, 200)); // Firefox 가 뜰 때까지
    };
    attempt();
  });
  let buf = '';
  let hello = null;
  const pending = new Map();
  sock.setEncoding('utf8');
  sock.on('data', (chunk) => {
    buf += chunk;
    for (;;) {
      const colon = buf.indexOf(':');
      if (colon === -1) return;
      const len = Number(buf.slice(0, colon));
      if (buf.length < colon + 1 + len) return;
      const msg = JSON.parse(buf.slice(colon + 1, colon + 1 + len));
      buf = buf.slice(colon + 1 + len);
      if (hello === null && !Array.isArray(msg)) { hello = msg; continue; }
      const [, id, error, result] = msg;
      const p = pending.get(id);
      if (!p) continue;
      pending.delete(id);
      error ? p.reject(new Error(`${error.error}: ${error.message}`)) : p.resolve(result);
    }
  });
  let next = 1;
  const send = (name, params = {}, timeoutMs = 20_000) =>
    new Promise((resolve, reject) => {
      const id = next++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${name} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      const body = JSON.stringify([0, id, name, params]);
      sock.write(`${body.length}:${body}`);
    });
  while (hello === null) await new Promise((r) => setTimeout(r, 20));
  return { send, close: () => sock.end() };
}
```

```js
// 실행. 프로필은 /tmp 가 아닌 곳에 (snap Firefox 는 /tmp 를 못 읽는다).
const prefs = {
  'extensions.webextensions.uuids': JSON.stringify({ [GECKO_ID]: UUID }), // moz-extension://<UUID>/ 를 고정
  'extensions.originControls.grantByDefault': true,      // MV3 host_permissions 를 설치 시 부여
  'extensions.webextOptionalPermissionPrompts': false,   // permissions.request 가 dialog 없이 답함
  'marionette.port': marionettePort,
  'xpinstall.signatures.required': false,
  'browser.shell.checkDefaultBrowser': false,
  'datareporting.policy.dataSubmissionPolicyBypassNotification': true,
  'toolkit.telemetry.reportingpolicy.firstRun': false,
  'browser.startup.page': 0,
  'browser.aboutwelcome.enabled': false,
};
writeFileSync(join(profile, 'user.js'),
  Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n') + '\n');

const fx = spawn(FIREFOX_BIN,
  ['--headless', '--profile', profile, '-no-remote', '--marionette', '--remote-allow-system-access'],
  { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
// 종료: process.kill(-fx.pid, 'SIGKILL') — 그룹째. 부모만 죽이면 보조 프로세스가 파이프를 쥔다.
```

```js
// 세션 → 임시 설치 → 팝업 → 평가 → 새 탭.
const mar = await marionette(marionettePort);
await mar.send('WebDriver:NewSession', { capabilities: { alwaysMatch: {} } });
await mar.send('Addon:Install', { path: EXT_DIR, temporary: true }); // { value: 'headerlab@…' }
await mar.send('WebDriver:Navigate', { url: `moz-extension://${UUID}/popup.html` });
const evaluate = async (expression) =>
  (await mar.send('WebDriver:ExecuteAsyncScript', {
    script: `const done = arguments[0]; Promise.resolve().then(() => (${expression})).then(done, (e) => done('ERR:' + e));`,
    args: [],
  })).value;
await evaluate(`browser.storage.local.set({ state: ${JSON.stringify(state)}, state$: { v: 2 } }).then(() => 'ok')`);
// … getDynamicRules().length === 1 을 polling …
const tab = await mar.send('WebDriver:NewWindow', { type: 'tab' });
await mar.send('WebDriver:SwitchToWindow', { handle: tab.handle });
await mar.send('WebDriver:Navigate', { url: `${echoOrigin}/probe` }); // 에코 서버가 헤더를 기록
```

## 재지 않은 것

- 네이티브 포트가 Firefox 이벤트 페이지를 살려두는지. MDN 은 일반 포트에 대해 "닫힌다"
  고 하고, 네이티브 메시징의 예외 여부는 문서로 확정되지 않는다. 브릿지 스펙(D)의 첫 과제.
  재려면 `~/Library/Application Support/Mozilla/NativeMessagingHosts/` 에 파일을 써야 한다 —
  Firefox 는 프로필별 경로를 두지 않는다.
  **2026-09-09 의 헤디드 확인도 이것을 재지 않았고, 재려 하지도 않았다.** 그 확인은 프로덕션
  빌드로 했고 프로덕션 Firefox 매니페스트에는 `nativeMessaging` 이 없다 — 그러니 헤디드로
  봤다는 사실이 이 항목을 조금도 좁히지 못한다. 여전히 브릿지 스펙의 첫 과제다.
- ~~헤디드 툴바 팝업 안의 실제 크기.~~ **재었다 (2026-09-09) — `## 매니페스트와 팝업` 참조.**
  748×600 이 잘리지 않는다.
- Firefox 의 정규식 한계 (`regexFilter` 는 브라우저마다 다르다 — WECG #344).
- Playwright 가 설치하는 Firefox 빌드(juggler 패치)에서 Marionette 가 같은가. CI 는 러너의
  apt Firefox 를 쓰므로 필요 없었다.
