# HeaderLab — 검증된 기술 제약

조사일: 2026-07-31. 에이전트 15개 · 툴 호출 431회 · 1차 출처(Chrome 공식 문서, Chromium 소스,
MDN, wxt.dev, ui.shadcn.com, playwright.dev) 기준. 확신도가 낮은 주장은 별도 에이전트가 반박을
시도했고, 반박에 실패해 살아남은 것만 아래에 싣는다. 미해결 질문은 마지막 절에 모았다.

---

## 1. declarativeNetRequest 룰 의미론

### 1.1 룰 형태

```jsonc
{
  "id": 1,                 // 필수, >= 1, 룰셋 내 유일
  "priority": 1,           // 선택, 기본값 1, >= 1 (상한은 문서화되어 있지 않음, 타입은 int32)
  "condition": { /* RuleCondition */ },
  "action": {
    "type": "modifyHeaders",
    "requestHeaders":  [{ "header": "x-debug", "operation": "set",    "value": "1" }],
    "responseHeaders": [{ "header": "cache-control", "operation": "remove" }]
  }
}
```

`ModifyHeaderInfo` 는 `{ header, operation, value? }`. `operation` 은 `"set" | "append" | "remove"`.
`value` 는 set/append 에 필수이며 **remove 에는 없어야 한다**.

### 1.2 조건 필드와 가용 버전

| 필드 | 최소 Chrome | 비고 |
|---|---|---|
| `urlFilter`, `regexFilter`, `isUrlFilterCaseSensitive`, `resourceTypes`, `excludedResourceTypes`, `domainType` | 84 | |
| `requestMethods`, `excludedRequestMethods` | 91 | |
| `tabIds`, `excludedTabIds` | 92 | **세션 룰 전용** |
| `initiatorDomains`, `requestDomains` (+ excluded*) | 101 | `domains`/`excludedDomains` 는 이때 deprecated |
| `responseHeaders`, `excludedResponseHeaders` | 128 | 정적·동적·세션 모두 가능 |
| `topDomains`, `excludedTopDomains` | 145 | |

- `urlFilter` 와 `regexFilter` 는 상호 배타적이다.
- `resourceTypes` 를 생략하면 **`main_frame` 을 제외한 모든 타입**에 매칭된다. 이 기본값이
  테스트에서 가장 흔한 함정이다.
- 빈 배열은 거부된다. `excludedX` 는 항상 `X` 보다 우선한다.

### 1.3 urlFilter 문법

Adblock Plus 계열 패턴이며, **match pattern 과 다른 문법이다**. 이 구분이 중요한 이유는
host_permissions 는 match pattern 을 쓰고 룰 조건은 urlFilter 를 쓰기 때문이다 — 서로 변환되지 않는다.

| 토큰 | 의미 |
|---|---|
| `*` | 임의 개수의 문자 |
| `\|` | 양 끝에 쓰면 URL 의 시작/끝 앵커 |
| `\|\|` | 앞에 쓰면 (서브)도메인 시작 앵커 |
| `^` | 구분자 — 문자·숫자·`_`·`-`·`.`·`%` 를 제외한 모든 것, URL 끝에도 매칭 |

- ASCII 만 허용. 호스트는 punycode, 나머지 비 ASCII 는 UTF-8 퍼센트 인코딩된 URL 에 대해 매칭된다.
- `||*` 로 시작하는 패턴은 금지. 빈 문자열도 금지.
- **이스케이프 메커니즘이 문서화되어 있지 않다.** URL 안의 리터럴 `*`, `|`, `^` 를 매칭하려면
  `regexFilter` 를 써야 한다.
- `isUrlFilterCaseSensitive` 기본값은 `false` (Chrome 118 에서 `true` → `false` 로 변경됨).

`regexFilter` 는 RE2 문법, ASCII 전용, 컴파일 후 2KB 미만. 등록 전에
`chrome.declarativeNetRequest.isRegexSupported()` 로 검사할 수 있다.

### 1.4 append 허용 헤더 — 요청과 응답이 다르다

**요청 헤더**는 정확히 21개만 append 가능하다. Chromium `kDNRRequestHeaderAppendAllowList`
기준이며, 각 헤더마다 결합 구분자가 정해져 있다:

`accept`, `accept-encoding`, `accept-language`, `access-control-request-headers`,
`cache-control`, `connection`, `content-language`, `cookie`(`; `), `forwarded`, `if-match`,
`if-none-match`, `keep-alive`, `range`, `te`, `trailer`(구분자 없음), `transfer-encoding`,
`upgrade`, `user-agent`(공백 하나), `via`, `want-digest`, `x-forwarded-for` — 명시하지 않은
것은 모두 `, ` 로 결합된다.

목록에 없는 헤더에 append 를 걸면 **룰 등록 시점에** `ERROR_APPEND_INVALID_REQUEST_HEADER`
로 실패한다. `x-` 로 시작하는 커스텀 헤더는 append 불가 — set/remove 만 된다.

**응답 헤더는 허용 목록 자체가 없어서 아무 헤더나 append 할 수 있다.** 동작도 다르다:
요청 append 는 기존 값에 구분자로 이어 붙여 한 줄로 만들고, 응답 append 는 헤더 줄을
하나 더 추가한다(`Set-Cookie` 다중 값이 이렇게 동작한다).

> **설계 반영:** UI 는 요청 헤더에서 append 를 고를 때 21개 목록에 없는 이름이면 즉시
> 막아야 한다. 등록 시점 에러는 사용자에게 도달하지 않기 때문이다.

### 1.5 수정 불가 헤더는 없다

Chromium `ValidateHeadersForModification` 은 이름에 대해 세 가지만 검사한다 — RFC 토큰
문법 유효성, (요청 헤더 한정) append 허용 목록, 값의 존재와 유효성. **금지 헤더 집합은
존재하지 않는다.** `Host`, `Origin`, `Referer`, `Sec-*`, `Set-Cookie` 모두 인덱서를 통과한다.

다만 인덱스 시점의 수용이 네트워크 스택 통과를 보장하지는 않는다. 확장 단계 이후에
네트워크 서비스가 다시 쓰는 헤더는 덮어써질 수 있고, Chrome 문서는 이에 대해 아무 약속도
하지 않는다. → 미해결 질문 참조.

### 1.6 충돌 해소 — 헤더별 선착순, 패자는 조용히 버려진다

Chromium `DNRHeaderAction::ConflictsWithSubsequentAction` 의 정확한 매트릭스:

| 먼저 적용된 연산 | 이후 허용되는 것 |
|---|---|
| `append` | append 만 (다른 확장 포함) |
| `set` | **같은 확장의** append 만 |
| `remove` | 없음 — 아무도 그 헤더를 더 못 건드린다 |

헤더별 누적 결과는 항상 `[remove]`, `[append+]`, `[set, append*]` 중 하나다.
충돌하는 후속 액션은 `continue` 로 **조용히 폐기된다 — 에러도 없고 `lastError` 도 없다.**

같은 확장 안에서:
- 두 룰이 같은 헤더를 `set` → 높은 priority 가 이기고 낮은 쪽은 버려진다.
- `set`(높음) → `append`(낮음) 순서일 때만 append 가 set 값에 이어 붙는다. 반대 순서면 set 이 버려진다.
- `remove` 와 `set` 은 priority 가 높은 쪽이 이긴다.

수집 순서는 "더 최근에 설치된 확장이 먼저, 같은 확장 안에서는 높은 priority 가 먼저"다.

추가로 놓치기 쉬운 조항: **modifyHeaders 룰은 매칭되는 `allow`/`allowAllRequests` 룰보다
priority 가 엄격히 높아야 실행된다.**

> **설계 반영:** priority 를 프로필 순서에서 결정론적으로 유도하고, 두 활성 프로필이 같은
> 헤더를 건드리면 UI 에서 미리 경고해야 한다. 브라우저는 알려주지 않는다.

### 1.7 쿼터 — modifyHeaders 는 "unsafe" 액션이다

| 상수 | 값 |
|---|---|
| `GUARANTEED_MINIMUM_STATIC_RULES` | 30,000 |
| `MAX_NUMBER_OF_DYNAMIC_RULES` | 30,000 |
| `MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES` | **5,000** |
| `MAX_NUMBER_OF_SESSION_RULES` | 5,000 |
| `MAX_NUMBER_OF_UNSAFE_SESSION_RULES` | 5,000 |
| `MAX_NUMBER_OF_REGEX_RULES` | 1,000 |
| `MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL` | 20 / 10분 |

"safe" 룰은 `block`, `allow`, `allowAllRequests`, `upgradeScheme` 뿐이다. **modifyHeaders 는
unsafe 이므로 동적 룰 상한은 30,000 이 아니라 5,000 이다.** 세션 룰은 두 상한이 같아
unsafe 제약이 실질적으로 걸리지 않는다.

`MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES` 는 deprecated 이며 "더 이상 합산 상한이 없다".

> **설계 반영:** 5,000 은 넉넉해 보이지만 헤더 하나당 룰 하나로 컴파일하면 금방 닿는다.
> **같은 조건을 공유하는 헤더들은 한 룰의 `requestHeaders[]` 배열로 묶어야 한다.**

### 1.8 룰 갱신 API

`updateDynamicRules({ removeRuleIds, addRules })` / `updateSessionRules(...)` — 단일
옵션 객체를 받고, **제거를 먼저 하고 추가를 나중에** 하며, 완전히 트랜잭셔널하다(하나라도
실패하면 전부 롤백).

| | 브라우저 재시작 | 확장 업데이트 |
|---|---|---|
| dynamic | 유지 | 유지 |
| session | 소실 | 소실 |

룰셋 ID 는 `"_dynamic"`, `"_session"`.

### 1.9 디버깅 API 의 가용성

| API | 제약 |
|---|---|
| `onRuleMatchedDebug` | **언팩 확장 전용** (Chromium feature 파일이 강제) |
| `testMatchOutcome` | **언팩 확장 전용**, Chrome 103+ |
| `getMatchedRules` | 언팩 제약 **없음** — `declarativeNetRequestFeedback` 를 선언하면 스토어 배포본도 호출 가능 |

`getMatchedRules` 도 `testMatchOutcome` 도 **헤더가 실제로 바뀌었는지는 알려주지 않는다.**
둘 다 "어떤 룰이 매칭됐는가"를 답하는 API 이고 반환 타입에 헤더 데이터가 없다.

---

## 2. 권한 모델

### 2.1 매니페스트 키와 설치 경고

- `declarativeNetRequest` — 설치 시 경고가 뜨고, `allow`/`allowAllRequests`/`block` 룰에
  대해서만 암묵적 접근권을 준다. **modifyHeaders 에는 아무 도움이 안 된다.**
  또한 이 권한은 optional 로 선언할 수 없다.
- `declarativeNetRequestWithHostAccess` — **설치 경고 없음.** 단, 필수 `host_permissions`
  를 하나도 선언하지 않을 때만 성립한다. optional 선언 금지 목록에는 없다.
- `declarativeNetRequestFeedback` — `getMatchedRules` / `onRuleMatchedDebug` 용.

### 2.2 가장 중요한 발견 — initiator 권한 요구

**modifyHeaders 는 요청 URL 과 그 요청을 시작한 initiator 양쪽 모두에 host permission 을
요구한다.** 예외는 내비게이션 요청(`main_frame`, `sub_frame`)으로, 이때는 요청 URL 만 필요하다.

이 사실은 **developer.chrome.com 어디에도 문서화되어 있지 않다.** 렌더된 MV3 DNR 페이지,
MV2 페이지, 문서 저장소 마크다운 세 곳 모두에서 "initiator" 와 권한 요구가 함께 등장하는
곳이 없음을 확인했다. 근거는 Chromium 소스다:

`extensions/browser/api/declarative_net_request/ruleset_manager.cc` 가
`REQUIRE_HOST_PERMISSION_FOR_URL_AND_INITIATOR` 로 `CanExtensionAccessURL` 을 호출하고,
같은 파일 442 행 주석이 "요청 URL 과 initiator 양쪽에 host permission 이 있을 때에만
modifyHeaders 룰을 평가한다"고 적고 있다. 해소 표
(`web_request_permissions.cc:133-176`):

| initiator | 요청 URL | 결과 |
|---|---|---|
| Withheld | Withheld | Withheld |
| Withheld | Allowed | **Withheld** |
| Allowed | Withheld | Allowed |
| Allowed | Allowed | Allowed |
| Denied | 무관 | Denied |

> **설계에 미치는 영향 — 이게 제품 결정을 바꾼다.**
> `app.example.com` 페이지가 `api.example.com` 으로 보내는 XHR 의 헤더를 고치려면
> **두 오리진 모두** 권한이 필요하다. API 오리진만 허용하면 아무 일도 일어나지 않는다.
> 즉 "도메인별로만 허용" 모델은 사용자가 직관적으로 기대하는 대로 동작하지 않는다.
> 온보딩에서 전체 허용을 1차 경로로 제시하고, 도메인별 허용은 이 규칙을 UI 에서
> 설명해 주는 고급 옵션으로 두어야 한다.

### 2.3 권한 부족의 관측 가능한 증상

**룰 등록은 정상적으로 성공한다.** 호스트 권한은 등록 시점 제약이 아니다(문서의 에러 조건
목록에 전혀 없음). 권한은 언제든 부여·회수될 수 있으므로 등록 시 검증하는 것 자체가
말이 안 된다. 강제는 요청 시점에 일어난다.

- `kWithheld` (아직 허용 안 했지만 허용 가능) → 액션이 적용되지 않고, Chrome 이 확장
  아이콘에 배지를 띄워 접근을 원한다는 신호를 준다. 완전히 조용하지는 않다.
- `kDenied` (`chrome://`, 웹스토어 등 제한 URL) → 룰셋 자체가 건너뛰어지고 완전히 조용하며
  어떤 허용으로도 고칠 수 없다.

예외도, 기본 콘솔 에러도, 등록 실패도 없다.

### 2.4 권한 API

- `chrome.permissions.request()` 는 **호출 시점의 유저 제스처**를 요구한다. 특정 컨텍스트를
  요구하는 것이 아니라 — 핸들러 안에서 동기적으로 호출되기만 하면 **서비스 워커에서도
  호출 가능하다**. (초기 조사에서 "팝업/옵션 페이지에서만 가능"이라고 나왔던 주장은
  반박되어 폐기됐다.)
- `optional_host_permissions` 에 선언한 광범위 오리진(`<all_urls>` 포함)을 요청할 수 있고,
  선언한 패턴의 부분집합도 요청 가능하며, 경로는 무시된다.
- `chrome.permissions.addHostAccessRequest()` (Chrome 133+) — 제스처 없이 권한 필요 신호를
  Chrome UI 에 띄운다. `tabId` 또는 `documentId` 중 하나가 필요하고 `pattern` 으로 대상
  URL 을 제한한다. 교차 오리진 내비게이션에서 리셋되며, 수락 시 해당 사이트 최상위
  오리진에 영구 접근권을 준다. **서비스 워커가 실행 중 권한 부족을 발견했을 때 쓸 올바른
  프리미티브다.**
- `permissions.contains()` 가 오리진별 접근 확인의 공식 수단이지만, **DNR 의
  `urlFilter`/`requestDomains` 조건을 오리진 패턴으로 변환하는 것은 손실이 있고 일반적으로
  신뢰할 수 없다** (§1.3 의 문법 차이 때문). 사용자에게 무엇을 허용해야 하는지 물을 때는
  조건에서 자동 유도하기보다 명시적인 오리진 목록을 함께 받는 편이 안전하다.
- Chrome 의 사이트 접근 3단계 모델(클릭 시 / 특정 사이트 / 모든 사이트)에서 **사용자가 어느
  모드를 골랐는지 읽는 API 는 없다.** 실효 오리진별 부여 상태만 알 수 있다.

Edge 는 MV2/MV3 모두에서 DNR 과 `chrome.permissions` 를 지원한다고 명시하며, 문서화된
동작 차이는 없다.

---

## 3. WXT

- 현재 안정 버전 **0.21.2**. 스캐폴딩은 `npx wxt@latest init`, React+TS 템플릿 id 는 `react`.
- React 템플릿은 Vite 플러그인을 직접 넣지 않고 `@wxt-dev/module-react` 모듈을 쓴다.
- 스토리지 임포트 경로는 **`wxt/utils/storage` 또는 `#imports`** 다. `wxt/storage` 는
  0.21.x 에서 컴파일되지 않는다.
- **모든 스토리지 키에 영역 접두어가 필요하다** — 기본 영역이 없다. `local:`, `session:`,
  `sync:`, `managed:`. 키 메타데이터는 `key + "$"` 에 나란히 저장된다.
- `defineItem` 의 `version` + `migrations` 로 마이그레이션이 자동 실행된다.
- 경로 별칭 4종을 기본 제공: `~~`/`@@` → 루트, `~`/`@` → srcDir.
- 엔트리포인트는 단일 파일 형태와 디렉터리(`index.*`) 형태를 모두 지원한다.
- 런타임 코드는 반드시 `main()` 안에 있어야 한다 — 빌드 중 Node 에서 가짜 브라우저로
  엔트리포인트 파일을 임포트하기 때문이다.
- 개발 모드에서 진짜 HMR 은 UI/HTML 엔트리포인트에만 적용된다. 백그라운드와 콘텐트
  스크립트는 빠른 *재로드*이지 HMR 이 아니다.
- 단위 테스트는 Vitest 만, `WxtVitest` 플러그인으로 문서화되어 있다. E2E 는 Playwright 만
  언급하고 Playwright 자체 가이드로 넘긴다.
- Edge 는 별도 빌드가 필요 없다 — Chrome ZIP 을 그대로 재사용한다.
- `browser` 객체는 기본적으로 webextension-polyfill 이 아니라 globalThis 폴백이다.

---

## 4. shadcn/ui + Tailwind v4 를 WXT 에 얹기

이 조합은 **shadcn 도 WXT 도 공식 문서화하지 않는다.** 아래는 실제로 빌드까지 확인한 경로다.

### 4.1 두 가지 함정

**함정 1 — `shadcn init` 이 아예 실패한다.** WXT 에는 `vite.config.ts` 가 없어서(Vite 를
`wxt.config.ts` 로 설정한다) shadcn 의 프레임워크 감지가 실패하고 "We could not detect a
supported framework" 로 중단된다. 해결: 루트에 빈 스텁 `vite.config.ts` 를 둔다. WXT 는
이 파일을 읽지 않으므로 빌드에 무해하다.

**함정 2 — 컴포넌트가 프로젝트 밖에 쓰인다.** `wxt prepare` 가 만드는 `.wxt/tsconfig.json`
은 `.wxt/` 기준 상대 경로(`../*`)를 `paths` 에 넣고 `baseUrl` 은 두지 않는다. shadcn CLI 가
쓰는 `tsconfig-paths` 는 `absoluteBaseUrl` 을 루트로 잡으므로 모든 경로가 **한 단계 위로**
해석된다. `shadcn add button --dry-run` 이 `../components/ui/button.tsx` 를 만들겠다고
답한다 — **에러 없이 조용히 프로젝트 밖에 쓴다.**

해결은 루트 `tsconfig.json` 에 `paths` 를 직접 선언하되 **`baseUrl` 은 넣지 않는 것**이다.
shadcn 의 Vite 안내는 `baseUrl: "."` 를 시키는데 이는 TypeScript 7 에서 하드 에러다.

### 4.2 확인된 순서

1. `npm i -D wxt @wxt-dev/module-react` / `npm i react react-dom` / `npm i tailwindcss @tailwindcss/vite`
2. `wxt.config.ts` — `modules: ['@wxt-dev/module-react']` + `vite: () => ({ plugins: [tailwindcss()] })`
3. 루트 `tsconfig.json` — `{"extends":"./.wxt/tsconfig.json","compilerOptions":{"jsx":"react-jsx","paths":{"@":["./"],"@/*":["./*"]}}}` ← baseUrl 없음
4. `npx wxt prepare`
5. 스텁 `vite.config.ts` 추가
6. `entrypoints/popup/style.css` 에 `@import "tailwindcss";`, `main.tsx` 에서 임포트
7. `npx shadcn@latest init --yes --base radix --preset nova`
8. `npx shadcn@latest add ...`
9. `npx wxt build`

3번과 4번이 반드시 7번보다 먼저여야 한다. init 의 "Validating import alias" 검사가 여기 의존한다.

### 4.3 그 외

- **2026년 7월 기준 `shadcn init` 의 기본 베이스는 Radix 가 아니라 Base UI 다.** Radix 를
  쓰려면 `-b radix`, React Aria 는 `--base aria`.
- `--yes` 를 줘도 프리셋은 대화형으로 묻는다. 스크립트화하려면 `--preset <name>`.
- init 이 쓰는 CSS 에는 기본적으로 **웹폰트 @import 가 포함된다.** 확장 프로그램은 외부
  리소스를 받지 않는 편이 낫고 CSP 문제도 있으므로 제거 대상이다.
- **shadcn 의 다크 배리언트 `&:is(.dark *)` 는 `.dark` 클래스를 단 요소 자신에는 적용되지
  않는다** — 자손에만 적용된다. 팝업 루트 컨테이너에 `.dark` 를 달아 테마를 제어하려면
  Tailwind 문서 형태인 `&:where(.dark, .dark *)` 로 바꿔야 한다. 부수 효과로 `:where()`
  는 명시도가 0 이라 오버라이드도 쉬워진다. 대안은 shadcn ThemeProvider 처럼
  `document.documentElement` 에 `.dark` 를 다는 것.
- Tailwind 의 rem 스케일링 문제는 **shadow root 안의 콘텐트 스크립트에만 해당**하며
  팝업에는 해당되지 않는다. 관련 보일러플레이트의 우회 코드는 불필요하다.
- Chrome 팝업은 콘텐츠에 맞춰 자동 크기 조정되고 **800×600 이 하드 상한**(최소 25×25)이다.
  560×600 은 높이 상한에 정확히 걸쳐 있다.
- Popover/DropdownMenu/Tooltip 은 팝업 자신의 `document.body` 로 포털된다 — 동작은 하지만
  600px 천장에서 잘림/레이아웃 위험이 있다.

---

## 5. 테스트

### 5.1 단위

`@webext-core/fake-browser` 가 현재 유일하게 살아 있는 선택지다. sinon-chrome 은 2019년
이후 릴리스가 없고, webextension-polyfill 은 애초에 테스트 도구가 아닌 데다 **2026-07-30 에
아카이브됐다** (Chrome 148 이 `browser` 네임스페이스를 네이티브로 추가하면서 no-op 이 됐다).

**fake-browser 는 `declarativeNetRequest` 를 구현하지 않는다.** 중요한 건 undefined 가
아니라 **던지는 스텁이 정의돼 있다**는 점이다 — `MockNotImplementedError` 를 던진다. 따라서
옵셔널 체이닝이나 덕 타이핑으로 우회할 수 없고, 명시적으로 spy 를 씌워야 한다.
`fakeBrowser.reset()` 은 `resetState()` 를 가진 네임스페이스만 초기화하므로 손으로 만든
DNR 목은 `vi.restoreAllMocks()` 로 따로 정리해야 한다.

> **설계 반영:** 이 제약이 아키텍처를 정한다. 룰 컴파일러는 `chrome.*` 를 전혀 만지지 않는
> **순수 함수**여야 하고, 브라우저 없이 테스트되어야 한다. DNR 호출은 얇은 어댑터 하나로
> 격리한다.

### 5.2 E2E

Playwright 공식 방식은 `launchPersistentContext` + `--load-extension` 이고, 확장 ID 는
서비스 워커 URL 에서 뽑는다. 확인된 주의사항:

- 확장은 **persistent context 에서만** 동작한다.
- Chrome 과 Edge 는 확장 사이드로딩용 커맨드라인 플래그를 제거했다 → `channel: 'chrome'`
  이나 `'msedge'` 로는 언팩 확장이 로드되지 않는다. Playwright 번들 Chromium 을 써야 한다.
- `channel: 'chromium'` 을 쓰면 **헤드리스에서도 확장이 동작한다.** 기본 헤드리스 빌드인
  `chromium-headless-shell` 은 별개 빌드이므로 확장 테스트에 쓰면 안 된다.
- WXT 공식 예제는 `headless: false` 를 강제하고 channel 을 쓰지 않는다 — Playwright 문서와
  상충하며, WXT 쪽이 channel 접근법보다 앞선 것으로 보인다. CI 는 Playwright 쪽을 따르는 편이 낫다.
- MV3 서비스 워커는 ~30초 후 정지하지만 Playwright 는 Worker 객체를 유지하므로 캐시된
  핸들을 계속 쓸 수 있다.

### 5.3 헤더가 실제로 바뀌었는지 검증하는 방법

- **`getMatchedRules` 도 `testMatchOutcome` 도 답이 아니다.** 둘 다 룰 매칭 오라클이고
  반환 타입에 헤더가 없다.
- **Playwright 의 `request.headers()` 도 답이 아니다.** 보안 관련 헤더를 명시적으로 누락한다.
- **유일하게 신뢰할 수 있는 오라클은 로컬 에코 서버다.** Chrome 문서가 "요청 헤더를 서버로
  보내기 전에 매칭된 modifyHeaders 룰에 따라 갱신한다"고 명시하므로, 서버 측 관측은
  변경 이후 시점이며 곧 정답이다. `server.listen(0)` 으로 임의 포트에 바인딩하고 `req.headers`
  를 기록한 뒤 그 기록에 대해 단언한다. httpbin.org 같은 외부 의존은 CI 에서 쓰면 안 된다.
- `testMatchOutcome` 은 언팩 전용이지만 **Playwright 가 언팩으로 로드하므로 E2E 에서 쓸 수
  있다.** `serviceWorker.evaluate()` 안에서 호출하면 네트워크 없이 룰 매칭 매트릭스를
  빠르고 결정론적으로 검증할 수 있다.

### 5.4 권장 테스트 피라미드

1. **단위** — vitest + WxtVitest. 컴파일러가 만들어 내는 **룰 객체 자체**를 단언한다. 브라우저 불필요.
2. **통합** — Playwright + `serviceWorker.evaluate()` + `testMatchOutcome`. 가상 요청 매트릭스에
   대해 **어떤 룰이 매칭되는지**를 단언한다. 네트워크 없음, 쿼터 없음.
3. **E2E** — 로컬 에코 서버로 **실제 바이트**를 단언한다. 소수의 케이스만. 헤더가 정말
   바뀌었음을 증명하는 유일한 층.

E2E 의 최대 함정은 `resourceTypes` 다. 생략하면 `main_frame` 이 빠지므로
`page.goto()` 로 가는 요청에는 룰이 걸리지 않는다. `page.evaluate(() => fetch(...))` 는
`xmlhttprequest` 라 걸린다. 테스트에서는 `resourceTypes` 를 항상 명시해야 한다.

---

## 6. 미해결 질문

스펙을 막지는 않지만 구현 중 부딪힐 수 있는 것들:

1. **priority 가 같은 두 modifyHeaders 룰의 타이브레이크가 문서화되어 있지 않다.** 소스는
   리스트 처리 순서로 해소한다. → 컴파일러가 priority 를 **유일하게** 배정해서 이 상황
   자체를 만들지 않는 편이 안전하다.
2. dynamic 룰셋과 session 룰셋에서 **같은 id 를 동시에 써도 되는지** 한 문장으로 명시된 곳이
   없다. → id 공간을 분리해서 회피한다.
3. `urlFilter` 의 특수문자 이스케이프 방법이 없다. URL 에 리터럴 `*`/`|`/`^` 가 필요하면
   regexFilter 로 폴백해야 한다.
4. **priority 상한이 문서화되어 있지 않다.** 타입은 int32, 하한만 1 로 정의돼 있다.
5. dNR 이 넣은 요청 헤더가 네트워크 스택 후속 단계에서 살아남는지 — 특히 `Host`,
   `Content-Length`, `Sec-Fetch-*` — Chrome 은 아무 약속도 하지 않는다. → E2E 에코 서버로
   경험적으로 확인해야 한다.
6. 패키징된 확장에서 **권한 보류로 룰이 스킵될 때 관측 가능한 신호가 있는지** 불명.
   아이콘 배지 외에는 없을 가능성이 높다.
7. 내비게이션 예외에 `main_frame`/`sub_frame` 외에 무엇이 더 들어가는지 — Chromium 에
   미해결 TODO 가 있다.
8. `[nodoc]` 인 `ModifyHeaderInfo.regexFilter`/`regexSubstitution`/`regexOptions` 가 webidl 에
   존재한다(헤더 값의 정규식 치환). 공개 문서가 없으므로 의존하면 안 되지만, 향후 기능의 실마리다.
9. `declarativeNetRequestWithHostAccess` 를 `optional_permissions` 에 넣는 것이 실제로
   허용되고 정상 동작하는지 — 금지 목록에는 없지만 명시적 확인은 못 했다.
10. Edge 가 initiator 권한 강제에서 Chrome 과 다른지 불명.
