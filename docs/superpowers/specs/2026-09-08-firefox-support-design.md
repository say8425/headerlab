# Firefox 지원 1차 — 빌드 타깃과 e2e 하네스

2026-09-08. 소유자 결정 세 가지가 이 문서의 뼈대다: 1차 범위는 **빌드 타깃 + Firefox e2e**(A+B),
e2e는 **새 의존성 없이** Firefox의 자체 자동화 프로토콜로, gecko id는
**`headerlab@say8425.github.io`**. 여기에 같은 날 스파이크로 잰 사실이 붙는다
(`docs/research/2026-09-08-firefox-marionette-spike.md`). 이 문서가 스파이크와 다르면 스파이크가
맞다.

## 왜

README 는 처음부터 "Chrome only for now. Firefox and Safari are planned." 이라고 말해 왔고,
v1 설계(`2026-07-31-headerlab-design.md` §10)는 Firefox 를 명시적으로 제외했다. 이 확장이
존재하는 이유 — 신뢰하던 확장이 트래커를 숨기고 있었다 — 는 브라우저를 가리지 않는다.
Firefox 사용자에게도 같은 것을 준다: 설치 시 호스트 권한 0, 네트워크 호출 0, 실패는 화면에서
말한다.

## 결정된 것

- **범위는 A+B.** 빌드 타깃·매니페스트·어댑터·빌드 산출물 가드·문서(A)와 Firefox e2e
  하네스(B). AMO 서명·리스팅·릴리스 첨부(C)와 Firefox 에서의 에이전트 브릿지(D)는 각각
  별도 스펙이다. §10.
- **접근법 A: 타깃은 순수 계층의 매개변수다.** `lib/target.ts` 한 파일만
  `import.meta.env.BROWSER` 를 읽고, 어댑터와 팝업이 그 값을 `compile()` 에 넘긴다.
  순수 함수는 빌드에 독립적이고, Firefox 동작은 브라우저 없이 vitest 로 검증한다.
  `import.meta.env` 분기를 순수 파일 안에 두는 안(B)은 순수 계층을 둔 이유와 충돌해서,
  런타임 감지(`runtime.getBrowserInfo`)는 매니페스트가 어차피 빌드 시점에 갈려야 해서
  버렸다.
- **Firefox 매니페스트는 `optional_permissions` 를 선언하지 않는다.** 브릿지가 현재 설계로는
  Firefox 에서 동작할 수 없으므로(§9), 요청할 길이 없는 권한을 나열하지 않는다. 브릿지
  스펙(D)이 동작을 입증하면 그때 한 줄 추가한다 — optional 권한은 업데이트로 추가돼도
  재동의를 요구하지 않으므로 지금 빼는 비용은 0 이다.
- **릴리스 워크플로와 `pnpm zip` 은 손대지 않는다.** 서명 없는 Firefox zip 은 릴리스
  Firefox 에 설치되지 않으므로, 배포는 서명과 함께 스펙 C 의 일이다. 1차의 README 는
  "직접 빌드해 `about:debugging` 으로 임시 로드" 만 안내한다.
- **gecko id 는 `headerlab@say8425.github.io`.** MDN 권장 이메일형. 실제 메일 주소일 필요는
  없고, 소유자의 GitHub Pages 도메인을 빌려 유일성을 확보한다. 한 번 배포되면 영구적이다.
- **`strict_min_version` 은 `128.0`.** `optional_host_permissions` 가 128 에서 들어왔고
  (BCD), 그 아래에서는 all-sites 스위치가 절대 얻을 수 없는 승인으로 들어간다.
- **`data_collection_permissions: { required: ['none'] }`.** 2025-11-03 부터 AMO 신규
  제출 필수이며, 이 제품의 전제 그 자체다.

## 1. 측정된 사실 — 설계가 기대는 것

스파이크 문서에 전부 있다. 설계 결정에 직접 닿는 것만 옮긴다.

| 사실 | 출처 | 설계에 닿는 곳 |
| --- | --- | --- |
| WXT 는 `-b firefox` 를 기본 **MV2** 로 빌드한다 | `wxt build -b firefox` 가 `firefox-mv2` 를 냄 | §2 `manifestVersion: 3` |
| Firefox MV3 는 `background.service_worker` 를 지원하지 않고, WXT 가 `background.scripts` 를 자동으로 낸다 | MDN · 빌드 산출물 | §2, §6 매니페스트 가드 |
| `requestDomains`·`excludedRequestDomains`·`tabIds`·`requestMethods`·`modifyHeaders` 모두 Firefox 113+ | BCD | 컴파일러 변경 없음 |
| `resourceTypes` 에 `webbundle`/`webtransport` 를 실으면 `updateDynamicRules` 가 **배치 전체를** "Invalid enumeration value" 로 거부 | 측정 | §4 능력표, §5 필터링 |
| 요청 헤더 `append` 는 Firefox 에서 **어느 이름이든** 허용 (Chrome 은 21개 허용목록) | 측정 | §4 능력표 |
| 공백 든 헤더 이름을 Firefox 는 받는다 | 측정 | `HEADER_TOKEN` 검사는 양쪽 유지 — 유효한 HTTP 가 아니다 |
| `permissions.contains` 는 `http://h/*` 승인을 `*://h/*`·`https://h/*` 로 답하지 않는다 | 측정 | 여섯 단 사다리 유지 |
| 잘못된 패턴에 `contains` 가 throw 하지 않고 false 를 준다 | 측정 | `probe.ts` 의 catch 가 그대로 맞음 |
| 이벤트 페이지가 유휴 상태가 되면 포트가 닫힌다 — 네이티브 포트 포함 여부는 **미측정** | MDN | §9 브릿지 제외 |
| Marionette 로 `moz-extension://` 페이지에 가려면 `-remote-allow-system-access` (Firefox 138+) | 측정 · Bugzilla | §7 하네스 |
| MV3 `host_permissions` 는 설치 시 부여되지 않지만 `extensions.originControls.grantByDefault` 로 부여된다 | 측정 | §7 프리퍼런스 |
| CI 러너(ubuntu-24.04)에 Firefox 154 가 apt 로 설치돼 있다 (snap 아님) | runner-images | §8 CI |

## 2. 빌드 타깃과 매니페스트

`wxt.config.ts`:

- `manifestVersion: 3` 을 명시한다. `wxt build -b firefox` 가 `--mv3` 없이 MV3 를 내고,
  `firefox-mv2*` 디렉터리는 다시는 생기지 않는다.
- `manifest` 함수는 이미 `{ browser, mode }` 를 받는다. `browser === 'firefox'` 일 때만:

  ```ts
  browser_specific_settings: {
    gecko: {
      id: 'headerlab@say8425.github.io',
      strict_min_version: '128.0',
      data_collection_permissions: { required: ['none'] },
    },
  },
  ```

  그리고 `optional_permissions` 를 **넣지 않는다.** 그 외 — `name`, `description`, `permissions`
  두 개, `optional_host_permissions: ['<all_urls>']`, `icons`, `action` — 는 Chrome 과 바이트
  단위로 같다. `background` 는 WXT 가 낸다.
- `mode === 'e2e'` 의 `host_permissions: ['http://127.0.0.1/*']` 는 브라우저를 가리지 않고
  붙는다. `bridge-e2e` 모드는 Chrome 전용이다 — Firefox 에는 브릿지가 없으므로 그 모드를
  Firefox 로 빌드할 이유가 없고, 빌드하지도 않는다.
- 산출물: `.output/firefox-mv3`, `.output/firefox-mv3-e2e`. zip 은 만들지 않는다 (결정된 것).

`import.meta.env.BROWSER` 는 WXT 가 빌드 시점에 정의한다. vitest(`WxtVitest`) 아래에서의 값은
플랜 작성 시 측정하고, `lib/target.ts` 는 정의되지 않은 값을 `'chrome'` 으로 읽는다.

## 3. 타깃 상수 — `lib/target.ts`

```ts
import type { Target } from '@/lib/model/types';
export const TARGET: Target = import.meta.env.BROWSER === 'firefox' ? 'firefox' : 'chrome';
```

`Target` 자체(`'chrome' | 'firefox'`)는 `lib/model/types.ts` 에 산다 — §4 참조.

이 파일을 import 하는 곳은 어댑터와 팝업뿐이다: `lib/sync/ruleSync.ts`, `lib/bridge/port.ts`,
`entrypoints/popup/App.tsx`. `lib/compile/`, `lib/view/`, `lib/permissions/audit.ts`,
`lib/bridge/query.ts` 는 **타깃을 인자로 받는다**. 순수 가드(`tests/unit/purity.test.ts`)의
금지 패턴에 `import.meta.env` 는 없지만, 규칙으로 못 박는다: 순수 파일은 `lib/target.ts` 를
import 하지 않는다. 가드에 `from '@/lib/target'` 패턴을 추가해 규칙을 기계로 만든다.

## 4. 능력표 — `lib/compile/capabilities.ts`

순수, `lib/compile/` 이라 자동 가드. 타깃별로 다른 사실을 **한 곳에** 둔다. "One predicate, one
definition" 의 타깃판이다.

```ts
export const SUPPORTED_RESOURCE_TYPES: Record<Target, ReadonlySet<ResourceType>>;
//   chrome: 스키마의 15개 전부
//   firefox: 15개 − { 'webbundle', 'webtransport' }   (BCD: version_added false)
export function supportedResourceTypes(target, types): ResourceType[]; // 순서 보존 필터
export function isAppendAllowed(target, headerTarget, name): boolean;
//   response: 항상 true
//   request : chrome 이면 APPEND_ALLOWED_REQUEST_HEADERS (지금 validate.ts 의 21개, 이 파일로 이사)
//             firefox 면 true (측정)
export function hasBridge(target): boolean; // chrome: true, firefox: false
```

`ResourceType` 은 `lib/model/types.ts` 의 기존 타입. `Target` 은 `lib/model/types.ts` 에 두고
`lib/target.ts` 가 그것을 import 한다 — 반대 방향이면 순수 파일이 어댑터 상수 파일을 알게 된다.

## 5. 컴파일러

시그니처에 `target: Target` 이 들어간다. 기본값은 두지 않는다 — 기본값은 Chrome 을 전제하는
호출을 조용히 살려두는 자리다.

- `compile(state, target)`.
- `filterToCondition(filter, target, tabId?)`: `resourceTypes` 를
  `supportedResourceTypes(target, …)` 로 거른다. 빈 배열은 만들지 않는다 — 그 경우는 아래
  억제가 먼저 잡는다.
- `suppressionReason(profile, target)` 에 사유 하나 추가: **`'no-resource-type'`** — 지원되는
  리소스 타입이 하나도 남지 않았다. 순서: **맨 앞**, `allSites` 조기 반환보다 먼저 — all-sites
  는 도메인 조건을 비우는 것이지 리소스 타입 조건을 비우는 것이 아니므로, all-sites 프로필도
  타입이 하나도 남지 않으면 억제된다. 이 사유는 구조화·정규식 모드를 가리지 않는다 — DNR 은
  빈 `resourceTypes` 를 거부하고, 키를 빼면 기본값(main_frame 제외 전부)으로 **넓어진다.**
  실패는 닫힌 쪽으로.
  `isSuppressed(profile, target)` 도 같이. 네 호출자 — `compile.ts`, `audit.ts`,
  `filterDiagnostics.ts`, `conflicts.ts` — 와 `lib/bridge/query.ts` 가 타깃을 넘긴다.
- `validateFilter(profile, target)` 이 진단 **`unsupported-resource-type`** 을 낸다
  (`DiagnosticKind` 추가). 걸러진 타입이 있고 남은 타입도 있으면 `warning`, 남은 타입이
  없으면 `error` (그때 `suppressionReason` 은 `'no-resource-type'`). 메시지는 걸러진
  이름을 나열한다: `Not supported in Firefox: webbundle, webtransport.` — 브라우저 이름은
  타깃에서 나온다. `host` 없음, `headerRuleId` 없음 — 프로필 수준.
- `validateHeaders(profile, target)`: `append-not-allowed` 는 `isAppendAllowed(target, …)` 에
  묻는다. Firefox 에서는 절대 나지 않으므로 그 메시지의 "Chrome" 은 그대로 둔다.
- `detectConflicts(profiles, target)`: `isSuppressed` 에 타깃을 넘기기 위해서만.
- 브라우저 이름이 박힌 양쪽 공통 카피 셋을 중립으로 고친다 (`filterDiagnostics.ts`):
  `Chrome only accepts ASCII characters in a regex filter.` → `Only ASCII characters are accepted in a regex filter.`,
  `This regex is too large. Chrome caps a compiled pattern at 2KB.` → `This regex is too large. A compiled pattern is capped at 2KB.`,
  `Chrome only accepts ASCII characters in a path pattern.` → `Only ASCII characters are accepted in a path pattern.`
  Firefox 의 정규식 한계는 별도로 측정하지 않았다 — RE2 계열이 아니어서 다를 수 있고
  (WECG #344), 정규식 UI 는 여전히 없으므로 이 진단이 닿는 길은 CLI 뿐이며 CLI 는 Firefox
  에 없다. 카피만 고치고 한계값은 그대로 둔다.

**`'no-resource-type'` 이 닿는 곳.** `lib/bridge/query.ts` 가 `StatusPayload.suppression` 으로
CLI 에 실어 보내므로 `packages/headerlab/lib/render.mjs` 의 사유→문장 표에 한 줄이 필요하다
(`'no-resource-type': 'no request type this browser supports is selected'`). CLI 를 만졌으니
Conventions 규칙대로 `SKILL.md` 를 다시 읽는다 — 억제 슬러그는 스킬에 없으므로(측정: grep 0건)
바뀔 문장은 없다.

**스키마는 손대지 않는다.** `resourceType` enum 은 15개 그대로다. 저장된 상태는 Chrome 빌드가
썼거나 CLI 가 썼거나 손으로 편집한 것일 수 있고, 신뢰 경계에서 타깃별로 거부하면 저장소
전체가 무효가 되어 아무것도 컴파일되지 않는다 — "닿을 수 없는 것을 보여주지 않는다" 의
가장 나쁜 형태다. 거르고 말하는 쪽이 맞다.

**1차에서 이 경로는 사실상 손 편집으로만 닿는다.** 팝업의 체크리스트는 8개만 내놓고 그 8개는
Firefox 가 다 지원하며, CLI 는 Firefox 에 없다. 그래도 컴파일러는 배치를 깨뜨리는 대신 닫힌
쪽으로 실패해야 하고, 그것을 말해야 한다.

## 6. 어댑터와 팝업

- `lib/sync/ruleSync.ts`: `compile(state, TARGET)`. 나머지 무변경.
- `lib/permissions/probe.ts`: 무변경. 사다리는 Firefox 에서도 필요하고, 잘못된 패턴이 false 로
  오든 throw 로 오든 같은 답이 된다.
- `lib/sync/icon.ts`, `entrypoints/background.ts`: 무변경. `action.setIcon({path:{16,32}})` 는
  Firefox MV3 에 있다 (BCD). e2e 에서 검증하지는 않는다 — 아이콘 픽셀을 읽는 API 가 없다.
- `lib/bridge/port.ts`: `status(loaded.state, TARGET)`. `port.error` 는 스펙 D.
- `entrypoints/popup/App.tsx`: `compile`·`auditPermissions`·`detectConflicts` 호출에 `TARGET`.
  `hasBridge(TARGET)` 이 false 면 `probeNativeMessaging` 을 부르지 않고 `bridge` prop 을
  `'unavailable'` 로 넘긴다. `ScopeRail` 은 `'unavailable'` 에서 브릿지 행을 **렌더하지
  않는다** — 닿을 수 없는 스위치를 그리지 않는다. 행이 사라지면 레일에 21px 이 돌아오는데,
  이 스펙은 그것을 쓰지 않고 남겨 둔다.
- `components/TypeChecklist.tsx`: `note?: string` prop. `unsupported-resource-type` 진단이
  있으면 그 메시지를 제목 줄 아래 **한 줄**로 — Interface 의 "상태 의존 줄은 한 줄" 규칙
  그대로 `truncate` + `title`. 색은 심각도를 따른다: `warning` 은 pending 팔레트(amber),
  `error` 는 destructive(red) — 사이트 행이 쓰는 그 둘. 나타나는 노트라 레일을 움직이지만(Interface 의 carve-out 2 와
  같은 꼴), 한 줄로 묶이고 1차에서 닿는 길이 손 편집뿐이라 예약 대신 이 비용을 택한다.
  플랜은 그 줄의 너비를 빌드된 팝업에서 잰다.
- `bridge === 'unavailable'` 은 `ScopeRailProps['bridge']` 의 다섯 번째 값이다. 기존 넷의
  뜻은 그대로.

## 7. Firefox e2e 하네스 — 의존성 0

Playwright 는 Firefox 확장을 로드하지 못한다. Firefox 자체의 자동화 프로토콜은 둘인데,
WebDriver BiDi 는 `moz-extension://` 내비게이션을 거부하고 Marionette 는
`-remote-allow-system-access` 아래에서 허용한다 (측정). 그래서 **Marionette 만** 쓴다.
프로토콜은 TCP 위 길이 접두 JSON 이라 `node:net` 으로 끝난다.

**러너는 `@playwright/test` 그대로다.** 픽스처·`expect.poll`·리포터·`--list` 집계를 Chrome
스펙과 공유한다. Playwright 의 브라우저를 쓰지 않을 뿐이다.

파일:

- `tests/support/marionette.ts` — 클라이언트. `connect(port)` 는 hello 가 올 때까지 200ms
  간격으로 재시도한다 (Firefox 가 뜨는 시간을 로그 파싱 없이 기다리는 방법). `send(name,
  params, timeoutMs = 20_000)` 는 시간 초과를 **명령 이름으로** 거절한다 — 스파이크에서
  묵묵히 멈춘 것은 이름 없는 대기였다. 필요한 명령: `WebDriver:NewSession`,
  `Addon:Install {path, temporary: true}`, `WebDriver:Navigate`, `WebDriver:GetCurrentURL`,
  `WebDriver:ExecuteAsyncScript`, `WebDriver:NewWindow`, `WebDriver:SwitchToWindow`,
  `WebDriver:GetWindowHandle(s)`, `WebDriver:TakeScreenshot`, `WebDriver:DeleteSession`.
- `tests/support/firefox.ts` — 실행기. 바이너리는 `FIREFOX_BIN` → macOS 의
  `Firefox Developer Edition.app`/`Firefox.app` → PATH 의 `firefox` 순으로 찾고, 못 찾으면
  **세 후보를 나열한 메시지로 throw** 한다 (건너뛰지 않는다 — 초록 스킵은 이 저장소가
  금지하는 그것이다). 프로필은 `test-results/firefox-profile-<random>/` 아래 — `/tmp` 가
  아닌 이유는 snap Firefox 가 `/tmp` 를 못 읽기 때문이고, `test-results/` 는 gitignore 라
  빌드 신선도 소스 집합에 들어가지 않는다. `user.js`:

  ```
  extensions.webextensions.uuids            {"headerlab@say8425.github.io":"<고정 UUID>"}
  extensions.originControls.grantByDefault  true   — e2e 매니페스트의 host_permissions 부여
  extensions.webextOptionalPermissionPrompts false — permissions.request 가 dialog 없이 답함
  marionette.port                            <빈 포트>
  xpinstall.signatures.required              false
  browser.shell.checkDefaultBrowser · datareporting.policy.dataSubmissionPolicyBypassNotification ·
  toolkit.telemetry.reportingpolicy.firstRun · browser.startup.page 0 · browser.aboutwelcome.enabled false
  ```

  인자: `--headless --profile <dir> -no-remote --marionette --remote-allow-system-access`.
  스폰은 `detached: true` 로 하고 종료는 **프로세스 그룹**에 SIGKILL — Firefox 의
  crashhelper·plugin-container 가 stdout 파이프를 쥔 채 남아 부모를 기다리게 만드는 것을
  스파이크에서 겪었다. 프로필 디렉터리는 종료 후 지운다.
- `tests/e2e/firefox-fixtures.ts` — `firefox` 픽스처 `{ evaluate(expr), navigate(url),
  newTab(url), screenshot(), popupUrl }`. 빌드는 `assertBuildFresh('firefox-e2e')`. `evaluate`
  는 표현식을 `Promise.resolve().then(() => (expr))` 로 감싸 `ExecuteAsyncScript` 의 콜백에
  넘긴다 — 확장 페이지에서 `browser.*` 가 프로미스를 돌려주므로.
- `tests/e2e/firefox.spec.ts` — 세 테스트:
  1. **set 룰이 wire 에 도달한다.** 스토리지를 심고 `getDynamicRules().length === 1` 을
     polling 한 뒤 새 탭으로 에코 서버에 가서 `x-headerlab-test: applied` 를 읽고
     `x-headerlab-disabled` 부재를 확인한다. Chrome 의 같은 테스트와 픽스처가 같다.
  2. **remove 룰이 헤더를 벗긴다.** Chrome 의 같은 테스트를 옮긴다.
  3. **저장 상태로 팝업이 렌더되고 브릿지 행이 없다.** 부재를 먼저 — `[data-bridge]` 가
     0개 — 그 다음 존재: 사이트 행 하나, 룰 행 둘, 리드아웃 `1 of 2 live`. 브릿지 행의
     부재는 이 스펙이 Firefox 팝업에 요구하는 유일한 레이아웃 사실이다.

  Chrome 의 레이아웃 가드 아홉은 옮기지 않는다. 그것들은 headed/headless 와 폰트에 묶여
  있고 Chrome 에서 잰 수치로 쓰여 있다.

`pnpm exec playwright test --list` 는 `Total: 21 tests in 4 files` 가 된다 (지금 18/3).
CLAUDE.md 의 그 문단을 같이 고친다.

## 8. 스크립트와 CI

`package.json`:

| 스크립트 | 지금 | 이후 |
| --- | --- | --- |
| `build` | `wxt build` | `wxt build && wxt build -b firefox` |
| `test` | `wxt build && vitest run` | `wxt build && wxt build -b firefox && vitest run` |
| `build:firefox` | — | `wxt build -b firefox` |
| `build:firefox-e2e` | — | `wxt build -b firefox --mode e2e` |
| `test:e2e` | 두 모드 빌드 후 `playwright test` | 세 모드 (+ `wxt build -b firefox --mode e2e`) |
| `dev:firefox` | — | `wxt -b firefox` |

`zip`, `crx`, `screenshots`, `store:*` 는 그대로다. `pnpm-workspace.yaml` 의 `spawn-sync`
거부도 그대로다 — `wxt -b firefox` 가 web-ext-run 을 부르지만 `spawn-sync` 의 빌드
스크립트는 Node 0.12 이전용 폴리필이라 없어도 동작한다. `dev:firefox` 를 처음 실행할 때
그 사실을 측정하고 CLAUDE.md 의 해당 문단을 "Chrome-only ... never invokes it" 에서 고친다.

`ci.yml` 의 e2e 잡: 러너의 Firefox 를 그대로 쓴다. 설치 단계 없음. `firefox --version` 을
찍는 단계 하나를 앞에 둔다 — 실패했을 때 로그가 어떤 Firefox 였는지 말하게. `xvfb-run` 은
Chrome 이 헤디드라 이미 있고 Firefox 는 `--headless` 라 상관없다.

## 9. 브릿지는 왜 빠지는가

MDN 의 이벤트 페이지 문서: "Message ports cannot prevent an event page from shutting down.
If an extension uses message passing, the ports are closed when the event page idles." 네이티브
포트가 닫히면 Firefox 는 호스트에 SIGTERM 을 보낸다. 현재 설계 — 호스트가 살아서 소켓을
쥐고, CLI 가 그 소켓으로 명령을 밀어 넣는다 — 는 호스트가 30초 뒤에 죽으면 성립하지 않는다.
Chrome 은 반대였다 (`2026-08-11-agent-bridge-design.md` §8.4: 포트가 워커를 7분 살려둠).

열릴 수 있는 길과 그 비용은 스펙 D 의 첫 과제다: (1) 네이티브 포트에 예외가 있는지 **측정**
— MDN 문장은 일반 포트에 대한 것이다; (2) 없다면 `alarms` keep-alive 와 그 권한; (3) 어느
쪽이든 필요한 것 — Firefox 의 호스트 매니페스트(`~/Library/Application Support/Mozilla/
NativeMessagingHosts/`, `allowed_extensions: [gecko id]`), CLI `--browser firefox`
(id 가 고정이라 `--load-path` 유도가 사라진다), Firefox 가 호스트에 넘기는 argv
(매니페스트 경로, 확장 id) 를 `host.mjs` 가 받는 것, `port.error`.

1차에서 브릿지가 보이지 않는 것은 그래서 결함이 아니라 규칙이다: 닿을 수 없는 것을
보여주지 않는다.

## 10. 범위 밖과 후속

- **스펙 C — AMO.** `wxt zip -b firefox` (sources zip 포함), `wxt submit` (이미 wxt 의 의존성인
  `publish-browser-extension`), listed/unlisted 채널 결정, 릴리스 첨부, AMO 리스팅 문서
  (`docs/store/` 의 Firefox 판), README 의 Install 세 경로. 릴리스 워크플로는 그때 바뀐다.
  README 태그라인(`README.md` 5번째 줄 안팎의 "in Chrome" 과 네 개 번역판의 대응 문구)과
  `PRIVACY.md` 의 "in Chrome" 도 여전히 브라우저 하나만 이름한다 — 서명된 배포와 함께
  바뀐다.
- **스펙 D — Firefox 브릿지.** §9.
- Firefox 스크린샷 (`pnpm screenshots` 는 Chrome 만).
- Firefox 레이아웃 가드.
- 실제 툴바 팝업 패널 안에서 748×600 이 어떻게 잘리는지 — 헤드리스 탭에서만 렌더했다.
  플랜의 마지막 과제는 Developer Edition 을 헤디드로 띄워 눈으로 보는 것이고, 그 결과는
  스파이크 문서에 덧붙인다. Firefox 의 팝업 상한은 800×600 이다.

## 11. 테스트 — 단위와 가드

- `tests/support/build.ts` BUILDS 에 `firefox` (`.output/firefox-mv3`, fix: `pnpm test`) 와
  `firefox-e2e` (`.output/firefox-mv3-e2e`, fix: `pnpm test:e2e`) 추가.
- `tests/unit/manifest.test.ts` 에 `firefox manifest` describe: `browser_specific_settings`
  를 **객체 전체로** `toEqual` (id·strict_min_version·data_collection_permissions),
  `background.scripts` 가 `['background.js']` 이고 `service_worker` 키 부재, `permissions`
  두 개 정확히, `optional_host_permissions` `['<all_urls>']`, **`optional_permissions` 키
  부재**, `host_permissions` 키 부재, `icons`·`action` 이 Chrome 매니페스트와 `toEqual`.
  그리고 Chrome 매니페스트에 `browser_specific_settings` 키가 **없는지** — 있으면 Chrome 이
  경고를 찍는다.
- `tests/unit/bundle.test.ts`: `bundleFiles(mode)` 로 두 프로덕션 빌드를 모두 스캔한다.
  `it.each` 를 빌드 × 패턴으로. Firefox 번들에도 `fetch(` 등이 없어야 한다 — 같은 소스지만
  WXT 가 타깃별로 다른 폴리필을 넣을 수 있으므로 읽는 것은 빌드다.
- `tests/unit/capabilities.test.ts`: 두 타깃의 집합 차이가 정확히 `{webbundle, webtransport}`
  인지, `isAppendAllowed` 가 Chrome 에서 21개·Firefox 에서 전부인지, `hasBridge`.
- `tests/unit/compile.test.ts`·`conditions.test.ts`·`suppression`·`filterDiagnostics` 테스트:
  Firefox 타깃에서 `webbundle` 만 든 프로필이 억제되고 `error` 진단이 나는지, 섞인 프로필은
  걸러진 룰과 `warning` 이 나는지, Chrome 타깃에서는 둘 다 통과하는지. 기존 테스트는
  `'chrome'` 을 명시해서 통과한다.
- `tests/unit/purity.test.ts`: `lib/compile/capabilities.ts` 자동 발견 확인 목록에 추가,
  금지 패턴에 `from '@/lib/target'` 추가.
- `packages/headerlab/test/render.test.mjs`: 새 사유 문장.
- 뮤테이션 확인 대상 셋: (a) `supportedResourceTypes` 가 거르지 않게 → Firefox 컴파일
  테스트 빨강, (b) Firefox 매니페스트에서 gecko 블록 제거 → manifest 테스트 빨강, (c) 팝업이
  `unavailable` 에서도 브릿지 행을 그리게 → e2e 3번 빨강. 커밋한 뒤에 한다.

## 12. 문서

- README(5개): Install 에 Firefox 항목 — "지금은 직접 빌드해 `about:debugging` → This Firefox
  → Load Temporary Add-on → `.output/firefox-mv3/manifest.json`. 서명된 배포는 예정."
  Limitations 표에 행 추가: `Agent bridge | ✓ | ✓ | **none** — event pages close native ports on idle | **none**`.
  `readmeLiterals.test.ts` 는 리드아웃 문자열만 고정하므로 영향 없다.
- `CLAUDE.md`: Commands 표 (`build:firefox`, `dev:firefox`), Architecture 에 `lib/target.ts`
  와 `capabilities.ts`, Non-negotiables 에 Firefox 매니페스트 문단 (gecko 블록,
  `optional_permissions` 부재와 이유), Testing 의 테스트 수 문단 (21/4), Platform traps 에
  Firefox 절 — 이 문서 §1 의 표를 산문으로. `spawn-sync` 문단은 §8 대로 고친다.
- `docs/research/2026-09-08-firefox-marionette-spike.md`: 측정치와 하네스의 씨앗 코드.
- `docs/superpowers/specs/2026-07-31-headerlab-design.md` §10 은 원문을 지키고, 그 옆에
  "2026-09-08 Firefox 1차 스펙으로 제외가 풀렸다" 한 줄을 붙인다.

## 13. 단계

플랜(`writing-plans`)이 과제로 쪼갠다. 순서는 의존 관계다:

1. 타입·능력표·`lib/target.ts` — 순수, 테스트 먼저.
2. 컴파일러에 타깃 주입 (§5) — 기존 테스트에 `'chrome'` 명시, Firefox 케이스 추가.
3. 어댑터·팝업 (§6) — `unavailable` 브릿지 상태, `TypeChecklist` 노트.
4. `wxt.config.ts` 와 스크립트 (§2, §8) — `build.ts` BUILDS, 매니페스트·번들 가드.
5. Marionette 클라이언트와 Firefox 실행기 (§7) — 스파이크 스크립트에서 옮기되 테스트가
   먼저.
6. Firefox e2e 세 테스트, `--list` 21 확인, CI 단계.
7. 문서 (§12), 뮤테이션 확인 (§11), 헤디드 눈 확인 (§10 마지막).
