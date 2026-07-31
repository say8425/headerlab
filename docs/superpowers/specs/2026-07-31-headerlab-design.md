# HeaderLab — 설계 문서

작성일: 2026-07-31
상태: 승인됨
기술 근거: [`docs/research/2026-07-31-technical-constraints.md`](../../research/2026-07-31-technical-constraints.md)

---

## 1. 배경과 목표

ModHeader 는 2026년 7월 3일 Chrome 웹스토어와 Edge 애드온에서 제거됐다. 빌드 7.0.18 에
날짜 라이브러리로 위장한 모듈이 들어 있었고, 방문 도메인을 수집해 하루 한 번 외부
수집기로 암호화 전송할 준비가 되어 있었다. 조사자들은 테스트 빌드에서 수집기가 휴면
상태였고 실제 유출 증거는 확인하지 못했다고 밝혔지만, 향후 업데이트가 사용자 동의 없이
이를 활성화할 수 있다고 경고했다. 설치 기반은 두 스토어 합쳐 약 160만이었다.

HeaderLab 은 그 자리를 대체한다. 다만 기능만 옮기는 것이 목표가 아니다.

**목표 1 — 신뢰를 구조로 증명한다.** "추적하지 않습니다"는 말로는 부족하다. 설치 시
호스트 권한을 요구하지 않고, 콘텐트 스크립트를 두지 않고, 네트워크 호출을 하지 않으며,
그 사실을 CI 검사로 강제한다.

**목표 2 — 디자인을 제대로 한다.** 원본의 기능은 훌륭했지만 UI 가 낡았다. 이 프로젝트가
존재하는 두 번째 이유가 이것이다.

**비목표.** 기능 패리티 자체는 목표가 아니다. v1 범위는 §10 에 명시한다.

---

## 2. 확정된 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 대상 브라우저 | Chrome + Edge | 동일 Chromium DNR 구현 → 룰 컴파일러 하나 |
| v1 범위 | 코어 + 탭 잠금 | §10 |
| UI 위치 | 팝업 중심 | 익숙한 워크플로우 유지 |
| 권한 모델 | 하이브리드 (선택 권한 + 원클릭 전체 허용) | §5 |
| 필터 모델 | 구조화 기본 + 고급 정규식 | §4.3 |
| 디자인 방향 | Data Grid | §8 |
| 테마 | 라이트 + 다크 | §8.3 |
| UI 언어 | 영어 | 헤더 이름이 영문이라 혼용이 적음 |
| shadcn 베이스 | Radix (`--base radix`) | 생태계 성숙도. 2026-07 부터 CLI 기본값은 Base UI |
| 프로젝트명 | HeaderLab | |

---

## 3. 아키텍처

### 3.1 원칙

정확성의 전부를 `chrome.*` 를 모르는 순수 함수 층에 몰아넣고, 브라우저와 닿는 지점을 얇게
격리한다.

이것은 미학적 선택이 아니라 **테스트 제약이 강제한 것**이다. `@webext-core/fake-browser`
2.0.1 은 `declarativeNetRequest` 를 구현하지 않는다. 네임스페이스와 상수·enum 은 노출하지만
모든 메서드가 `MockNotImplementedError` 를 던진다(2026-07-31 실행으로 확인). 즉 브라우저를
흉내 내며 룰 생성 로직을 테스트하는 길이 막혀 있다.

그래서 반대로 간다. 판단이 필요한 모든 것을 순수 함수에 넣으면 입력을 주고 출력 룰 객체를
단언하는 것만으로 검증된다. 브라우저도, 목도, 비동기도 필요 없다.

### 3.2 모듈 경계

```
lib/
  model/       타입 · zod 스키마 · 기본값
  compile/     ★ 순수. chrome.* 를 임포트하지 않는다
    compile.ts       AppState → { dynamic, session, diagnostics, requiredOrigins }
    conditions.ts    Filter → RuleCondition
    headers.ts       HeaderRule[] → ModifyHeaderInfo[]
    priority.ts      프로필 순서 → priority + 룰 ID 배정
    validate.ts      append 허용목록 · 헤더명 RFC 토큰 · 값 검사
    conflicts.ts     프로필 간 헤더 충돌 탐지
  permissions/
    origins.ts       ★ 순수. Filter → 오리진 패턴
    audit.ts         permissions.contains 로 부여 상태 대조
    request.ts       권한 요청 플로우
  sync/
    ruleSync.ts      ★ chrome.declarativeNetRequest 를 호출하는 유일한 파일
    tabLock.ts       탭 생명주기 → 세션 룰 재구축
  storage/
    state.ts         WXT defineItem('local:state') + 마이그레이션
```

`ruleSync.ts` 는 "원하는 룰 배열을 받아 통째로 교체한다" 외에 아무 판단도 하지 않는다.
어떤 룰이 나와야 하는지에 대한 결정은 전부 `compile/` 안에 있다.

### 3.3 검토했으나 채택하지 않은 대안

**증분 diff + 안정 룰 ID.** 헤더마다 안정적인 룰 ID 를 부여하고 변경분만 갱신한다. 룰이
수천 개이거나 쿼터가 빡빡할 때 의미가 있는데, §4.4 에서 보듯 우리 룰 수는 한 자릿수다.
ID 안정성 관리 비용만 남으므로 채택하지 않는다.

**DNR 을 진실의 원천으로.** 등록된 룰을 읽어와 UI 를 그린다. 별도 저장소가 필요 없어
보이지만 DNR 이 표현하지 못하는 것이 되돌릴 수 없이 손실된다 — 비활성 행, 주석, 프로필
이름과 색, 행 순서. 탈락.

---

## 4. 데이터 모델과 컴파일

### 4.1 상태

```ts
type Operation = 'set' | 'append' | 'remove'
type HeaderTarget = 'request' | 'response'

interface HeaderRule {
  id: string                 // 편집해도 유지되는 안정 ID
  enabled: boolean
  target: HeaderTarget
  operation: Operation
  name: string
  value: string              // remove 일 때 빈 문자열. 컴파일 시 필드 자체를 제거
  comment?: string
}

interface Filter {
  mode: 'structured' | 'regex'
  domains: string[]               // → condition.requestDomains
  excludedDomains: string[]       // → condition.excludedRequestDomains
  pathPattern?: string            // → condition.urlFilter 로 접힘
  regex?: string                  // mode === 'regex' 일 때만
  resourceTypes: ResourceType[]   // 항상 명시 (§4.5)
  requestMethods?: RequestMethod[]
}

interface TabLock {
  enabled: boolean
  tabId: number | null
  tabTitle: string | null         // 표시용. 낡을 수 있음
}

interface Profile {
  id: string
  name: string
  color: ProfileColor
  enabled: boolean
  order: number                   // → priority
  filter: Filter
  tabLock: TabLock
  headers: HeaderRule[]
}

interface AppState {
  version: number                 // 마이그레이션용
  profiles: Profile[]
  globalPause: boolean
  theme: 'system' | 'light' | 'dark'
}
```

모든 경계 입력은 zod 스키마로 검증한다. 특히 JSON import 는 신뢰할 수 없는 입력이다.

### 4.2 컴파일 인터페이스

```ts
function compile(state: AppState): CompileResult

interface CompileResult {
  dynamic: Rule[]            // 탭 잠금 없는 활성 프로필
  session: Rule[]            // 탭 잠금 있는 활성 프로필
  diagnostics: Diagnostic[]  // 사용자에게 보여줄 문제
  requiredOrigins: string[]  // 권한 감사에 넘길 오리진 패턴
}
```

순수 함수다. 같은 입력에 항상 같은 출력을 낸다.

**dynamic 과 session 이 갈리는 이유:** `condition.tabIds` 는 세션 스코프 룰에서만 지원된다.
탭 잠금이 켜진 프로필은 세션 룰로 갈 수밖에 없고, 세션 룰은 서비스 워커가 죽거나 브라우저를
재시작하면 사라진다. 따라서 재구축이 예외가 아니라 정상 경로다(§6.3).

### 4.3 필터 모델 — 구조화 기본, 정규식은 고급

두 사실이 얽혀 이 결정을 만든다.

첫째, `urlFilter` 는 host_permissions 가 쓰는 match pattern 과 **문법이 다르고**, 특수문자
(`*`, `|`, `^`)의 이스케이프 방법이 문서화되어 있지 않다. 따라서 필터 문자열에서 오리진을
역산하는 것은 일반적으로 불가능하다.

둘째, 호스트 권한이 없으면 룰은 등록은 되지만 요청 시점에 **조용히 적용되지 않는다**.
우리가 미리 감지해 알려주지 않으면 사용자는 "설정은 맞는데 왜 안 되지"로 시간을 태운다.

`condition.requestDomains` 를 쓰면 이 문제가 사라진다. 도메인 목록은 `*://*.domain/*` 오리진
패턴으로 정확히 변환되므로 `permissions.contains()` 검사가 신뢰할 수 있다.

- **기본(`structured`)** — 도메인 목록 + 경로 패턴. `requestDomains` 로 컴파일. 권한 감지 정확.
- **고급(`regex`)** — `regexFilter` 사용. 권한 감지가 best-effort 로 내려가며, UI 가 이를
  명시한다. 등록 전 `chrome.declarativeNetRequest.isRegexSupported()` 로 검사한다
  (RE2 문법, ASCII 전용, 컴파일 후 2KB 미만, 룰셋 타입별 1,000개 상한).

### 4.4 프로필 하나 = 룰 하나

`action.requestHeaders` 와 `action.responseHeaders` 는 **배열**이고, 한 룰이 둘 다 가질 수
있다. 프로필 하나는 조건 하나를 갖는다(URL 필터 + 리소스 타입 + 탭 잠금). 따라서 한 프로필의
모든 헤더는 **한 룰**에 들어간다. 헤더가 20개든 50개든 룰은 하나다.

이 배칭이 쿼터 문제를 없앤다. `modifyHeaders` 는 "unsafe" 액션이라 동적 룰 상한이 30,000 이
아니라 `MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES` = **5,000** 인데, 활성 프로필이 한 자릿수인
이상 근처에도 가지 않는다. 반대로 헤더 하나당 룰 하나로 컴파일했다면 이 상한이 실제
제약이 됐을 것이다.

### 4.5 `resourceTypes` 는 항상 명시한다

DNR 은 `resourceTypes` 와 `excludedResourceTypes` 를 모두 생략하면 **`main_frame` 을 제외한
모든 타입**에 매칭한다. 사용자가 예측할 수 없는 기본값이고, E2E 테스트에서 가장 흔한
함정이기도 하다(`page.goto()` 는 `main_frame` 이라 안 걸리고 `fetch()` 는 걸린다).

UI 에서 항상 선택하게 하고 상태에 저장한다. 빈 배열은 DNR 이 거부하므로 모델 차원에서
최소 하나를 강제한다.

### 4.6 priority 와 룰 ID

**priority 는 프로필 순서에서 유일하게 배정한다** — `priority = profiles.length - index`
(최소 1). 목록 위쪽 프로필이 이긴다.

유일하게 배정하는 이유는 명확하다. priority 가 같은 두 `modifyHeaders` 룰의 타이브레이크가
**문서화되어 있지 않다**. Chromium 소스는 리스트 처리 순서로 해소하지만 그것은 보장이
아니다. 유일하게 배정하면 그 상황 자체가 생기지 않는다.

**룰 ID 공간도 분리한다** — dynamic 은 `1..9999`, session 은 `10000..`. dynamic 룰셋과
session 룰셋에서 같은 ID 를 동시에 써도 되는지가 문서에 명시돼 있지 않다. 겹치지 않게 두면
확인할 필요가 없다.

프로필 수에 **상한 200 을 둔다.** 두 가지를 한꺼번에 막는다 — ID 공간이 겹칠 가능성과,
`priority` 상한이 문서화되지 않은 문제(§11.4)다. 현실적인 사용에서 걸릴 수 없는 값이고,
상한을 두지 않으면 두 미지수에 동시에 노출된다.

두 결정 모두 원칙이 같다: **문서화되지 않은 동작에 의존하지 않도록 설계를 좁힌다.**

### 4.7 헤더 연산 컴파일

`ModifyHeaderInfo` 는 `{ header, operation, value? }` 이고, `value` 는 set/append 에 필수이며
**remove 에는 없어야 한다**. 컴파일러가 `remove` 일 때 필드 자체를 제거한다.

**`append` 는 요청 헤더 21개에만 허용된다.** Chromium 의 허용 목록은
`accept`, `accept-encoding`, `accept-language`, `access-control-request-headers`,
`cache-control`, `connection`, `content-language`, `cookie`, `forwarded`, `if-match`,
`if-none-match`, `keep-alive`, `range`, `te`, `trailer`, `transfer-encoding`, `upgrade`,
`user-agent`, `via`, `want-digest`, `x-forwarded-for` 이다. 각 헤더마다 결합 구분자가
정해져 있다(대부분 `, `, 쿠키는 `; `, user-agent 는 공백, trailer 는 없음).

목록 밖 헤더에 append 를 걸면 **룰 등록 시점에** 실패하고 그 에러는 사용자에게 도달하지
않는다. 따라서 UI 의 연산 드롭다운에서 해당 헤더명일 때 append 를 **비활성화**하고 이유를
툴팁으로 단다.

**응답 헤더는 허용 목록이 없어** 아무 헤더나 append 할 수 있다. 동작도 다르다 — 요청
append 는 기존 값에 구분자로 이어 붙여 한 줄로 만들고, 응답 append 는 헤더 줄을 하나 더
추가한다.

수정이 금지된 헤더는 **없다**. Chromium 검증기는 RFC 토큰 문법, append 허용 목록, 값 유효성
세 가지만 본다. `Host`, `Origin`, `Referer`, `Sec-*`, `Set-Cookie` 모두 인덱서를 통과한다.
다만 인덱스 시점의 수용이 네트워크 스택 통과를 보장하지는 않는다(§11).

---

## 5. 권한

### 5.1 매니페스트 — 설치 경고 0개

```jsonc
{
  "permissions": ["storage", "declarativeNetRequestWithHostAccess", "activeTab"],
  "optional_host_permissions": ["<all_urls>"]
  // host_permissions 없음 — 이것이 경고를 없애는 핵심
}
```

`declarativeNetRequestWithHostAccess` 는 설치 경고를 띄우지 않는다. 단 **필수
`host_permissions` 를 하나도 선언하지 않을 때만** 성립한다.

`activeTab` 이 두 번째 열쇠다. 탭 잠금에는 현재 탭의 제목과 URL 이 필요한데 `tabs` 권한을
쓰면 "검색 기록 읽기" 경고가 붙는다. `activeTab` 은 사용자가 확장 아이콘을 클릭한 그
순간 해당 탭에 한해 접근을 주고 경고가 없다. 탭 잠금은 어차피 팝업에서 시작되므로 딱
맞는다. 탭이 닫히는 것은 `tabs.onRemoved` 로 탭 ID 만 받으면 되고 권한 없이 동작한다.

ModHeader 와 VibeHeader 는 설치 시 `<all_urls>` 를 요구한다. HeaderLab 은 요구하지 않는다.

### 5.2 initiator 요구 — 문서에 없는 규칙

**`modifyHeaders` 는 요청 URL 과 그 요청을 시작한 initiator 양쪽 모두에 호스트 권한을
요구한다.** 예외는 내비게이션 요청(`main_frame`, `sub_frame`)으로 이때는 요청 URL 만
필요하다.

이 사실은 developer.chrome.com 어디에도 문서화되어 있지 않다(렌더된 MV3 페이지, MV2 페이지,
문서 저장소 마크다운 세 곳에서 부재를 확인했다). 근거는 Chromium 소스다 —
`ruleset_manager.cc` 가 `REQUIRE_HOST_PERMISSION_FOR_URL_AND_INITIATOR` 로 접근을 검사하고,
같은 파일 442 행 주석이 이를 명시한다.

해소 표에서 중요한 줄은 이것이다: **initiator 보류 + 요청 URL 허용 → 보류.** API 오리진만
허용하면 아무 일도 일어나지 않는다.

### 5.3 UI 로 푸는 법

필터에서 페이지 오리진은 알 수 없다 — 사용자가 지금 어디에 있는지에 달렸다. 그런데
팝업은 안다. `activeTab` 덕분에 현재 탭의 오리진을 읽을 수 있다.

```
compile()  → requiredOrigins    필터 도메인에서 유도. 정확함
activeTab  → currentOrigin      지금 보고 있는 페이지

audit: permissions.contains() 로 둘 다 대조
  ├ 필터 오리진 미부여 → "api.example.com 접근 권한이 필요합니다"        [Grant]
  └ 현재 탭 오리진 미부여 → "이 페이지가 보내는 요청에는
                            app.example.com 권한도 필요합니다"          [Grant]
```

두 번째 줄이 사용자가 스스로 알아낼 수 없는 부분이다.

**온보딩은 전체 허용을 1차 경로로 제시한다.** initiator 요구 때문에 도메인별 허용은
사용자 직관대로 동작하지 않으므로, "모든 사이트 허용" 버튼 하나로 ModHeader 와 동일한
편안함을 주고, 도메인별 허용은 위 규칙을 UI 가 설명해 주는 고급 옵션으로 둔다.

`permissions.request()` 는 호출 시점의 유저 제스처를 요구하지만 특정 컨텍스트를 요구하지는
않는다. Grant 버튼 클릭이 곧 제스처이므로 팝업에서 바로 호출한다.

서비스 워커가 실행 중 권한 부족을 발견한 경우에는 `chrome.permissions.addHostAccessRequest()`
(Chrome 133+) 를 쓴다. 제스처 없이 Chrome UI 에 권한 필요 신호를 띄우는 프리미티브다.

---

## 6. 동기화와 생명주기

### 6.1 단일 재조정 루프

동기화를 트리거하는 모든 사건이 한 함수로 모인다.

| 트리거 | 수단 |
|---|---|
| 저장소 변경 | WXT `storage.watch` |
| SW 기동 | `onStartup` · `onInstalled` · 웨이크업 |
| 권한 부여/회수 | `permissions.onAdded` / `onRemoved` |
| 탭 닫힘 | `tabs.onRemoved` |

전부 `reconcile()` → 상태를 처음부터 다시 컴파일 → 룰 통째로 교체. 멱등이고 진입점이
하나라 상태 드리프트가 생길 자리가 없다.

### 6.2 갱신의 안전성

`updateDynamicRules` / `updateSessionRules` 는 단일 옵션 객체를 받고, **제거를 먼저 하고
추가를 나중에** 하며, 완전히 트랜잭셔널하다. 하나라도 실패하면 전부 롤백되므로 부분 적용
상태가 존재하지 않는다.

실패 시 직전 룰이 그대로 남는다. 에러 메시지를 세션 저장소에 기록해 팝업이 실제 문구를
보여준다.

### 6.3 탭 잠금 생명주기

세션 룰은 서비스 워커가 죽거나 브라우저를 재시작하면 사라진다. 재구축이 정상 경로다.

```
SW 기동
  → 저장소에서 상태 읽기
  → 탭 잠금 프로필마다 tabs.get(id) 으로 탭 생존 확인
      ├ 살아있음 → 세션 룰 재등록
      └ 사라짐   → 잠금 해제 + tab-lock-stale 진단
  → reconcile()
```

---

## 7. 진단 — 조용한 실패를 없앤다

### 7.1 목록

```ts
type Diagnostic =
  | { kind: 'append-not-allowed';  severity: 'error' }   // 21개 목록 밖 요청 헤더에 append
  | { kind: 'invalid-header-name'; severity: 'error' }   // RFC 토큰 위반
  | { kind: 'duplicate-header';    severity: 'error' }   // 한 프로필 안 중복
  | { kind: 'regex-unsupported';   severity: 'error' }   // isRegexSupported 실패
  | { kind: 'profile-conflict';    severity: 'warning' } // 다른 프로필이 덮어씀
  | { kind: 'permission-missing';  severity: 'warning' } // 룰은 등록되나 적용 안 됨
  | { kind: 'tab-lock-stale';      severity: 'warning' } // 잠근 탭이 사라짐
  | { kind: 'empty-filter';        severity: 'warning' } // 모든 사이트에 적용됨
```

`error` 는 룰이 등록조차 안 되거나 확실히 동작하지 않는 것으로, **입력 단계에서 막는다**.
`warning` 은 동작은 하지만 놀랄 만한 것이다.

`permission-missing` 만 비동기다 — 순수 컴파일러는 `requiredOrigins` 를 내보내고,
`permissions/audit.ts` 가 이를 실제 부여 상태와 대조한다.

### 7.2 충돌 탐지

두 프로필이 같은 헤더를 건드리면 Chromium 의 매트릭스에 따라 선착순으로 해소되고
**패자는 에러 없이 폐기된다.**

| 먼저 적용된 연산 | 이후 허용되는 것 |
|---|---|
| `append` | append 만 |
| `set` | 같은 확장의 append 만 |
| `remove` | 없음 |

조건이 실제로 겹치는지 판정하는 것은 일반적으로 불가능하므로 **보수적으로** 본다 —
도메인 집합이 교집합을 갖거나 어느 한쪽이 정규식 모드면 잠재 충돌로 간주한다. 거짓
양성이 거짓 음성보다 낫다. 조용한 실패를 없애는 것이 목적이다.

경고에는 **누가 이기는지** 쓴다. 예: "Staging 의 `Authorization` 이 Local 을 덮어씁니다."

추가로, `modifyHeaders` 룰은 매칭되는 `allow` / `allowAllRequests` 룰보다 priority 가
엄격히 높아야 실행된다. HeaderLab 은 그런 룰을 만들지 않으므로 해당 사항이 없지만,
향후 차단 기능을 넣는다면 이 조항이 살아난다.

---

## 8. UI

### 8.1 방향 — Data Grid

네 가지 디자인 방향(고밀도 커맨드 표면 / 여백 중심 에디토리얼 / 데이터 그리드 / DevTools
인스펙터)을 각각 만들고 세 관점(작업 속도 · 시각적 완성도 · 구현 리스크)으로 심사한 뒤
피드백을 반영해 다듬었다. 사용자가 Data Grid 를 선택했다.

**정의하는 것:** CSS 변수 `--cols` 하나가 스티키 컬럼 헤더, 두 그룹 구분선, 모든 데이터 행,
권한 서브행, 추가 행을 함께 구동한다. 열 체계 변경은 한 곳만 고치면 되고 Tailwind 의 임의
그리드 템플릿으로 그대로 옮겨진다. Value 열은 헤더부터 마지막 행까지 자체 음영이 끊기지
않고 흘러, 목록을 파싱하는 대신 열을 따라 훑게 된다.

`HeaderGrid.tsx` 가 `--cols` 를 소유한다. 디자인의 구현상 장점이 곧 코드 구조가 된다.

### 8.2 심사에서 반영된 것

| 지적 | 반영 |
|---|---|
| 컬럼 헤더가 스크롤 영역 밖이라 세로 괘선이 9px 어긋남 | 헤더를 스크롤 영역 안으로 옮겨 sticky 처리 |
| 긴 값이 편집 상태에서만 읽힘 | 값이 기본 상태에서 두 줄로 감김 |
| 편집 패널이 2KB 붙여넣기에 1056px 로 늘어남 | 읽기 전용 + `max-height` 캡 + Copy, 편집은 명시적 버튼 |
| `user-select: none` 이 루트에 걸려 값 복사 불가 | 크롬 영역만 비선택, 데이터는 선택 가능 |
| 6개 색상에 의미 충돌 2건 | 5개 색상, 하나당 의미 하나 |
| 상시 선택 컬럼 + 벌크 바가 213px 잠식 | 제거. 크롬 153px 로 축소 |
| `set` 을 파란 알약으로 표시 | 무채색 평문 + 고정폭 기호 슬롯 |

### 8.3 색상 법칙과 테마

다섯 색상, 하나당 의미 하나: 포커스 / 적용 중 / 탭 잠금 / 권한 필요 / 제거.
프로필 정체성 점은 정체성 색을 흐리게 재사용하고 활성일 때만 채도를 올린다.
**흔한 경우인 `set` 은 색을 쓰지 않는다.**

라이트와 다크 모두 지원한다. 라이트는 다크의 단순 반전이 아니라 별도로 도출한다 — 반전은
탁한 회색과 형광 강조색을 만든다. 밝은 배경에서는 같은 의미를 전달하는 데 더 어둡고 채도
높은 색이 필요하다.

**테마 전환 구현 주의점:** shadcn 이 기본 생성하는 다크 배리언트 `&:is(.dark *)` 는
`.dark` 클래스를 단 요소 **자신에게는 적용되지 않고** 자손에만 적용된다. 팝업 루트
컨테이너에 `.dark` 를 달아 제어하려면 Tailwind 문서 형태인 `&:where(.dark, .dark *)` 로
바꿔야 한다. 부수 효과로 `:where()` 는 명시도가 0 이라 오버라이드도 쉬워진다.
대안은 `document.documentElement` 에 `.dark` 를 다는 것이다.

### 8.4 팝업 제약

Chrome 팝업은 콘텐츠에 맞춰 자동 크기 조정되며 **800×600 이 하드 상한**이다. 목업은
560×600 으로 높이 상한에 걸쳐 있다. Popover / DropdownMenu / Tooltip 은 팝업 자신의
`document.body` 로 포털되므로 동작은 하지만 600px 천장에서 잘림 위험이 있다.

Tailwind 의 rem 스케일링 문제는 shadow root 안의 콘텐트 스크립트에만 해당하며 팝업에는
해당되지 않는다. 관련 보일러플레이트의 우회 코드는 넣지 않는다.

---

## 9. 프로젝트 구조와 테스트

### 9.1 디렉터리

```
headerlab/
  wxt.config.ts              manifest · Tailwind v4 플러그인 · @wxt-dev/module-react
  vite.config.ts             빈 스텁 — shadcn CLI 감지용. WXT 는 읽지 않음
  tsconfig.json              paths 직접 선언, baseUrl 없음
  components.json            shadcn (Radix)
  entrypoints/
    background.ts            reconcile() 루프. 유일한 SW
    popup/  index.html · main.tsx · style.css · App.tsx
  lib/                       §3.2
  components/
    ui/                      shadcn 생성물
    HeaderGrid.tsx           --cols 소유
    ProfileBar.tsx · FilterBlock.tsx · DiagnosticRow.tsx · ValueCell.tsx
  tests/
    unit/ · integration/ · e2e/ · echo-server.ts
  scripts/
    check-no-network.ts      빌드 산출물 스캔. 실패 시 CI 중단
```

### 9.2 셋업 순서

순서가 중요하다. 3번과 4번이 반드시 7번보다 앞서야 한다 — `shadcn init` 의 별칭 검증이
여기 의존한다.

1. `wxt` · `@wxt-dev/module-react` · `react` · `react-dom` · `tailwindcss` · `@tailwindcss/vite` 설치
2. `wxt.config.ts` — `modules: ['@wxt-dev/module-react']`, `vite: () => ({ plugins: [tailwindcss()] })`
3. 루트 `tsconfig.json` 에 `paths: { "@": ["./"], "@/*": ["./*"] }` — **`baseUrl` 없음**
4. `wxt prepare`
5. 스텁 `vite.config.ts` 생성
6. `entrypoints/popup/style.css` 에 `@import "tailwindcss"`
7. `shadcn init --yes --base radix --preset nova`
8. `shadcn add ...`
9. `wxt build`

`--preset` 은 생략할 수 없다. `shadcn init` 은 `--yes` 를 줘도 프리셋을 **대화형으로 묻기**
때문에, 스크립트나 CI 에서 돌리면 그 자리에서 멈춘다. `--base radix` 도 명시해야 한다 —
2026년 7월부터 CLI 기본값이 Base UI 로 바뀌었다.

3번이 없으면 `shadcn add` 가 **에러 없이 프로젝트 밖**(`../components/ui/`)에 파일을 쓴다.
`wxt prepare` 가 생성하는 `.wxt/tsconfig.json` 의 `paths` 가 `.wxt/` 기준 상대 경로인데
shadcn 이 쓰는 `tsconfig-paths` 는 `absoluteBaseUrl` 을 루트로 잡아 한 단계 위로 해석하기
때문이다. 5번이 없으면 `init` 이 프레임워크 감지 실패로 중단된다.

TypeScript 7 을 쓰므로 shadcn 문서가 시키는 `baseUrl: "."` 는 하드 에러다. 3번의 방식이
선택지가 아니라 유일한 길이다.

`shadcn init` 이 CSS 에 써넣는 **웹폰트 `@import` 는 제거한다**(§9.5).

### 9.3 의존성

2026-07-31 npm 레지스트리 실측 기준 전부 최신이다.

`wxt` 0.21.2 · `@wxt-dev/module-react` 1.2.2 · `react`/`react-dom` 19.2.8 ·
`typescript` 7.0.2 · `vite` 8.2.0 · `tailwindcss`/`@tailwindcss/vite` 4.3.3 ·
`shadcn` 4.16.0 · `vitest` 4.1.10 · `@playwright/test` 1.62.1 ·
`@webext-core/fake-browser` 2.0.1 · `zod` 4.4.3

WXT 스토리지 임포트 경로는 `wxt/utils/storage` 또는 `#imports` 다. `wxt/storage` 는
0.21.x 에서 컴파일되지 않는다. 모든 키에 영역 접두어가 필요하다(`local:`).

### 9.4 테스트 3층

**1층 — 단위 (vitest + WxtVitest, 브라우저 없음).** `lib/compile/**` 와
`permissions/origins.ts` 에 대한 테이블 기반 테스트. 입력 상태를 주고 나오는 룰 객체를
그대로 단언한다. 여기가 정확성의 전부이므로 커버리지 목표를 가장 높게 잡는다.

`fake-browser` 는 DNR 메서드를 던지지만 **상수와 enum 은 노출한다**. 쿼터 값을 하드코딩하지
않고 가져다 쓴다.

**2층 — 통합 (playwright + `testMatchOutcome`, 네트워크 없음).**
`serviceWorker.evaluate()` 안에서 `chrome.declarativeNetRequest.testMatchOutcome()` 을
호출해 가상 요청 매트릭스(URL 패턴 × 리소스 타입 × initiator × 메서드)에 어떤 룰이
매칭되는지 단언한다.

`testMatchOutcome` 은 언팩 확장 전용인데 Playwright 가 마침 `--load-extension` 으로 언팩
로드를 하므로 사용할 수 있다. 네트워크도 쿼터도 없이 매칭 로직 전체를 훑는다.

**3층 — E2E (로컬 에코 서버).** 헤더가 실제로 바뀌었음을 증명하는 유일한 층이다.

`getMatchedRules` 도 `testMatchOutcome` 도 헤더 변경을 확인해 주지 못한다. 둘 다 룰 매칭
오라클이고 반환 타입에 헤더 데이터가 없다. Playwright 의 `request.headers()` 도 보안 관련
헤더를 의도적으로 누락하므로 오라클이 아니다.

`node:http` 서버를 `listen(0)` 으로 띄워 받은 `req.headers` 를 기록하고 그 기록에 대해
단언한다. Chrome 문서가 "요청 헤더를 서버로 보내기 전에 매칭된 룰로 갱신한다"고 명시하므로
서버 측 관측이 곧 정답이다. 외부 의존(httpbin 등)은 쓰지 않는다. 케이스는 소수만 둔다.

**Playwright 설정.** `launchPersistentContext` + `channel: 'chromium'`. 확장은 persistent
context 에서만 동작한다. Chrome 과 Edge 는 확장 사이드로딩 플래그를 제거해서
`channel: 'chrome'` / `'msedge'` 로는 로드되지 않는다. 기본 헤드리스 빌드인
`chromium-headless-shell` 도 별개 빌드이므로 쓰지 않는다. `channel: 'chromium'` 이면
헤드리스에서도 동작한다.

WXT 공식 예제는 `headless: false` 를 강제하고 channel 을 쓰지 않는데, Playwright 문서와
상충하며 WXT 쪽이 channel 접근법보다 앞선 것으로 보인다. CI 는 Playwright 쪽을 따른다.

### 9.5 신뢰 태세를 CI 로 강제

이 제품은 멀웨어로 내려간 확장의 대체품이다. "추적하지 않습니다"는 **검증 가능해야** 한다.

- 네트워크 호출 0 — 애널리틱스 · 텔레메트리 · 원격 설정 · 업데이트 핑 전부 없음
- 콘텐트 스크립트 0 — 페이지에 아무것도 주입하지 않음
- 설치 시 필수 호스트 권한 0
- 외부 리소스 0 — `shadcn init` 이 넣는 웹폰트 `@import` 제거

`scripts/check-no-network.ts` 가 빌드 산출물을 스캔해 `fetch` / `XMLHttpRequest` /
`WebSocket` / 외부 URL 이 나오면 CI 를 실패시킨다. 주장이 검사가 되는 지점이고, 이 확장을
감사하려는 사람이 저장소에서 가장 먼저 볼 파일이다.

### 9.6 빌드와 배포

`wxt build` → `wxt zip`. **Edge 는 Chrome ZIP 을 그대로 재사용**하므로 별도 빌드가 없다.
`wxt submit` 으로 스토어 제출을 자동화할 수 있다(`.env.submit` 설정).

---

## 10. v1 범위

**포함:** 요청/응답 헤더 set·append·remove · 구조화 필터(도메인 + 경로) 및 고급 정규식 ·
리소스 타입 필터 · 다중 프로필(색 · 이름 · 개별 on/off · 순서) · 전체 일시정지 ·
탭 한정 적용 · JSON export/import · 진단(§7) · 하이브리드 권한(§5) · 라이트/다크 테마

**제외:** URL 리다이렉트 · 쿠키 전용 에디터 · CSP 헬퍼 · 공유 링크 · 클라우드 동기화 ·
사이드 패널 · Firefox

데이터 모델은 나중에 얹을 수 있게 열어 두되 지금 만들지 않는다. 특히 리다이렉트는
`action.type` 이 배타적이라 별도 룰로 컴파일해야 하므로, 추가 시 컴파일러가 프로필당
여러 룰을 낼 수 있어야 한다. 현재 구조는 이를 수용한다.

---

## 11. 알려진 미해결 사항

설계를 막지 않지만 구현 중 부딪힐 수 있다.

1. **DNR 이 넣은 요청 헤더가 네트워크 스택 후속 단계에서 살아남는지** — 특히 `Host`,
   `Content-Length`, `Sec-Fetch-*` — Chrome 은 아무 약속도 하지 않는다. 3층 에코 서버
   테스트로 경험적으로 확인하고, 살아남지 못하는 헤더가 나오면 UI 에서 표시한다.

2. **패키징된 확장에서 권한 보류로 룰이 스킵될 때 관측 가능한 신호가 있는지** 불명확하다.
   아이콘 배지 외에는 없을 가능성이 높다. 이것이 `permissions.contains()` 로 **선제
   감지**하는 설계를 택한 이유다.

3. **`urlFilter` 특수문자 이스케이프 방법이 없다.** URL 에 리터럴 `*` / `|` / `^` 가
   필요하면 정규식 모드로 폴백해야 한다. UI 가 이를 안내한다.

4. **`priority` 상한이 문서화되어 있지 않다.** 타입은 int32, 하한만 1 이다. §4.6 의 프로필
   상한 200 이 이를 막는다.

5. **Edge 가 initiator 권한 강제에서 Chrome 과 다른지** 불명확하다. Edge 문서는 동작 차이를
   명시하지 않는다. Edge 에서 3층 테스트를 한 번 돌려 확인한다.

6. **`ModifyHeaderInfo` 의 `regexFilter` / `regexSubstitution` / `regexOptions`** 가 webidl 에
   `[nodoc]` 으로 존재한다(헤더 값의 정규식 치환). 공개 문서가 없으므로 의존하지 않지만,
   향후 기능의 실마리다.
