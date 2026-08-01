# 권한 감사 실측 — 설계 §5.4 검증

작성일: 2026-08-01 · 대상: 설계 [§5.4](../superpowers/specs/2026-07-31-headerlab-design.md) ·
미해결 항목 §11.7 · 방법: 실제 Chromium 에 언팩 확장 4종을 로드해
`chrome.permissions.contains()` 를 서비스워커에서 직접 호출

설계 §5.4 는 스스로 이 검증을 요구했다 — "이 규칙은 §4.3 이 구조화 필터를 채택한 이유의
전제이므로, 구현 초기에 실제 확장에서 `contains()` 동작을 확인해 규칙이 맞는지 검증한다."
Phase 1 인수인계 §3.5 역시 "작은 조각을 먼저 실행해 환경을 확인하고 그 위에 계획을 세울 것"을
지시했다.

재현 스크립트: 스크래치패드 `spike-perms/`(run.mjs · run3.mjs · run4.mjs · run5.mjs).
확장 4종은 각각 다른 `host_permissions` 를 선언해 부여 상태를 만든다.

---

## 1. 확인된 것 — 사다리의 전제는 옳다

부여: `https://api.example.com/*` 하나.

| 후보 | 결과 |
|---|---|
| `https://api.example.com/*` | **true** |
| `https://*.api.example.com/*` | false |
| `*://api.example.com/*` | false |
| `*://*.api.example.com/*` | false |

설계가 예측한 그대로다. 도메인에서 순진하게 유도한 `*://*.D/*` **하나만** 검사하면
false 가 나오고, 실제로는 잘 동작하는 설정에 "권한 필요" 배지가 뜬다. 좁은 것부터 검사해
하나라도 통과하면 부여로 보는 규칙이 이 거짓 양성을 막는다.

부여하지 않은 `example.com`·`other.example.com` 은 네 후보 전부 false — 과다 보고도 없다.

`<all_urls>` 를 부여하면 모든 도메인의 모든 후보가 true 다. 온보딩 1차 경로(§5.3)는
의도대로 동작한다.

대소문자는 Chrome 이 접어준다(`https://API.EXAMPLE.COM/*` → true). `normalizeDomain` 이
이미 소문자화하므로 추가 조치 없음.

`*://*.D/*` 는 IP 리터럴에도 유효하며 베어 IP 를 포함한다 — `*://*.127.0.0.1/*` 를 부여한
상태에서 `http://127.0.0.1/*` 가 true 다. `requestPattern` 은 IP 에서도 그대로 옳다.

---

## 2. 결함 — 사다리에 `http://` 단이 없다

부여: `http://127.0.0.1/*`.

| 후보 | 결과 |
|---|---|
| `https://127.0.0.1/*` | false |
| `https://*.127.0.0.1/*` | false |
| `*://127.0.0.1/*` | false |
| `*://*.127.0.0.1/*` | false |

**네 후보 전부 false 다.** `localhost` 도 같다.

`contains()` 는 부분집합 검사이므로 `*://` 는 http 와 https 를 **둘 다** 요구한다. http 만
부여된 상태는 그 상위집합이 아니다. 사다리가 https 로만 좁혀 들어가 http 전용 부여를 볼 수
있는 단이 하나도 없다.

이것은 이 도구의 **핵심 사용 사례에서 거짓 양성**이다. 헤더 도구를 쓰는 개발자가 가장 흔히
넣는 대상이 `localhost`·`127.0.0.1`·사내 http 서비스다. 그리고 이 저장소의 e2e 빌드 자신이
`http://127.0.0.1/*` 를 부여한다(`wxt.config.ts`).

§5.4 가 사다리를 도입한 이유가 "배지가 한 번이라도 거짓 양성을 내면 사용자는 배지를 무시하기
시작하고, 그러면 이 기능의 존재 이유가 사라진다"이므로, 현행 사다리는 자신의 목적을 정확히
그 지점에서 놓친다.

**정정된 사다리** (좁은 것 → 넓은 것):

```
1. https://D/*        4. http://*.D/*
2. http://D/*         5. *://D/*
3. https://*.D/*      6. *://*.D/*
```

요청은 그대로 `*://*.D/*` 하나다 — 감사는 관대하게, 요청은 넉넉하게.

---

## 3. 결함 — `contains()` 는 던지고, 한 항목이 호출 전체를 오염시킨다

`contains()` 는 유효하지 않은 매치 패턴에 **예외를 던진다.** 반환값이 false 가 아니다.

| 패턴 | 결과 |
|---|---|
| `*://*.example.com:8080/*` | THREW — Invalid port |
| `*://*./*` | THREW — Host can not be empty |
| `*://*.https://x.com/*` | THREW — Invalid port |
| `https://api.example.com` (경로 없음) | THREW — Empty path |
| `*://*.a b.com/*` (내부 공백) | false (던지지 않음) |
| `*://*.도메인.kr/*` | false (던지지 않음) |
| `*://*.example.com./*` (끝점) | false (던지지 않음) |

그리고 **배치가 오염된다**:

```
contains({origins: ['https://api.example.com/*', '*://*.example.com:8080/*']})
  → THREW: Invalid port
```

유효한 항목이 함께 있어도 호출 전체가 죽는다.

### 도달 경로가 실재한다

`isValidDomain` 은 정규화 후 "비어 있지 않고 ASCII" 만 본다. **포트가 그대로 통과한다.**

```
사용자가 "localhost:3000" 입력
  → isValidDomain 통과
  → originCandidates → "*://*.localhost:3000/*"
  → contains() 예외
  → 권한 감사 전체가 죽음 (그 행 하나가 아니라)
```

`localhost:3000` 은 이 도구 사용자가 가장 자연스럽게 입력할 문자열 중 하나다.

### 이것은 이미 두 번 본 실패 형태다

인수인계 §3.1 이 기록한 트랜잭셔널 실패와 **같은 종류의 세 번째 사례**다. 잘못된 항목
하나가 자기 행이 아니라 배치 전체를 무효로 만든다.

**대응 세 가지, 전부 필요하다:**

1. 감사는 후보를 **한 번에 하나씩** 검사한다. 절대 배치하지 않는다.
2. 각 검사를 개별적으로 `catch` 한다 — 던진 후보는 "미부여"로 취급하고 다음 후보로 넘어간다.
3. `isValidDomain` 이 포트를 거부한다. DNR 의 `requestDomains` 도 호스트 전용이므로 같은
   문자열이 두 소비자 모두에서 틀린다.

3번은 인수인계 §2.1 이 이미 기록한 "도메인 내부 공백이 통과" 갭과 같은 자리다. 다만
**공백은 조용한 미매칭이고 포트는 예외**라 결과의 무게가 다르다.

`isValidDomain` 을 조일 때 §3.2 의 비대칭을 잊지 말 것 — 도메인은 프로필 단위로 억제한다.
포트가 붙은 도메인 하나 때문에 프로필의 유일한 도메인이 사라지면 조건 없는 룰이 되어
**모든 사이트에 매칭**된다.

---

## 4. 비대칭 — DNR 은 받아들이고 `contains()` 는 던진다

같은 도메인 문자열을 두 소비자에 각각 먹여 봤다. `updateDynamicRules` 로 실제 등록을 시도한
결과:

| `requestDomains` 항목 | DNR 등록 | `contains()` |
|---|---|---|
| `example.com` | OK | 정상 |
| `example.com:8080` | **OK** | **THREW** |
| `a b.com` (내부 공백) | **OK** | false |
| `https://example.com` (스킴 포함) | **OK** | **THREW** |
| `example.com.` (끝점) | **OK** | false |
| `EXAMPLE.COM` | **OK** | true (Chrome 이 접음) |

포트가 붙은 룰을 정상 룰과 **함께** 등록해도 둘 다 등록된다 — 트랜잭션이 깨지지 않는다.

**따라서 도메인 검증의 목적은 트랜잭션 보호가 아니다.** DNR 은 이들을 조용히 받아들이고
영원히 매칭되지 않는 룰을 만든다. 진짜 위험은 두 가지다:

1. 사용자는 룰이 등록됐다고 보지만 아무 일도 일어나지 않는다 (조용한 실패)
2. 같은 문자열이 권한 감사에서 **예외를 던져 감사 전체를 죽인다**

**결론 — 거부가 아니라 정규화가 맞다.** DNR 의 `requestDomains` 는 호스트 전용이라 포트를
표현할 수 없고, 호스트가 매칭되면 포트와 무관하게 매칭된다. 따라서 `localhost:3000` 은
`localhost` 로 정규화하는 것이 **사용자 의도에 가장 가깝다** — 거부하면 이 도구의 가장 흔한
입력이 통째로 막힌다. 정규화하고 진단으로 "포트는 무시되며 이 호스트의 모든 포트에
적용됩니다"를 알린다.

이 결정에는 §3.2 의 fail-open 비대칭이 걸려 있다. 포트 때문에 프로필의 유일한 도메인을
**드롭하면** 조건 없는 룰이 되어 모든 사이트에 매칭된다. 정규화는 이 함정 자체를 없앤다.

### append 는 네 번째 사례다

조사 문서 §1.4 에 따르면 21개 허용목록 밖 요청 헤더에 `append` 를 걸면 **룰 등록 시점에**
`ERROR_APPEND_INVALID_REQUEST_HEADER` 로 실패한다. 이것은 트랜잭셔널 실패다 — 인수인계
§3.1 이 기록한 형태의 네 번째 사례이며, `lib/compile/validate.ts` 가 존재해야 하는 이유다.

블라스트 반경을 갖는 표면 정리:

| 표면 | 잘못된 항목 하나의 결과 |
|---|---|
| `updateDynamicRules` — 헤더명 RFC 토큰 위반 | 배치 전체 무효 (Phase 1 에서 두 번 발생) |
| `updateDynamicRules` — 허용목록 밖 요청 헤더 append | 배치 전체 무효 |
| `permissions.contains()` — 유효하지 않은 매치 패턴 | 호출 전체 예외 |
| `updateDynamicRules` — 이상한 `requestDomains` | **없음** — 조용히 등록되고 미매칭 |

---

## 5. 그 밖에 확인한 환경 사실

`shadcn add select tooltip` 은 `components/ui/` 에 정확히 안착한다(한 단계 위가 아니다).
`tsc --noEmit` 통과. 새 Radix 전이 의존성이 필요 없어 npm 72시간 격리에 걸리지 않는다.

E2E 픽스처는 팝업 DOM 을 건드리지 않고 `chrome.storage.local` 에 직접 주입한다. 헤더 변경을
증명하는 두 테스트는 팝업 재작성에 영향받지 않는다. `header-modification.spec.ts:139` 의
"팝업이 렌더된다" 테스트만 새 빈 상태 문구로 갱신하면 된다.

**`@webext-core/fake-browser` 는 `permissions.*` 를 던지는 스텁으로 정의한다** — DNR 과
정확히 같다. `contains` · `getAll` · `request` 모두 "not implemented: mock the function
yourself" 로 던진다. 따라서 Phase 1 이 DNR 때문에 강제당한 아키텍처가 권한에도 그대로
적용된다: 결정 로직은 순수 층에, 브라우저 호출은 얇은 어댑터 하나에 두고 어댑터는 손으로
심은 스파이로 테스트한다.

순수성 가드(`tests/unit/purity.test.ts`)는 `lib/compile/*.ts` 를 `readdirSync` 로 자동
발견하지만 `lib/permissions/` 아래는 `origins.ts` 만 **명시 목록**으로 덮는다. 새 순수
파일을 `lib/permissions/` 에 추가하면 목록에 넣지 않는 한 가드가 조용히 비껴간다.

기준선: 단위 100/100 · `tsc` 통과 · 빌드 통과.
