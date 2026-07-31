# Phase 1 인수인계 — 걷는 뼈대

작성일: 2026-08-01
브랜치: `phase1-walking-skeleton` (34 커밋)
설계: [`2026-07-31-headerlab-design.md`](2026-07-31-headerlab-design.md) ·
계획: [`../plans/2026-07-31-headerlab-phase1-walking-skeleton.md`](../plans/2026-07-31-headerlab-phase1-walking-skeleton.md)

---

## 1. 무엇이 증명됐는가

| 주장 | 증거 |
|---|---|
| 헤더가 네트워크로 나가기 전에 실제로 바뀐다 | 로컬 에코 서버가 기록한 `req.headers`. 양성 대조군 포함 |
| 비활성 룰은 나가지 않는다 | 같은 요청에서 해당 헤더 부재 |
| `remove` 룰이 페이지가 보낸 헤더를 제거한다 | 서버에 도달하지 않음 |
| 설치 시 호스트 권한 0 | 배포 매니페스트에 `host_permissions` 키 부재 — 자동 단언으로 강제 |
| 네트워크 호출 0 · 외부 리소스 0 · 콘텐트 스크립트 0 | 빌드 산출물 스캔 |
| 정확성이 브라우저 없이 검증된다 | 순수 층 97개 테스트 + 순수성 가드(위반 주입 시 실패 실증) |

**최종 상태:** 단위 97/97(9파일) · E2E 3/3 · `tsc` 통과 · 빌드 통과 · Apache-2.0.

**오라클에 대해.** E2E 만이 "헤더가 바뀌었다"에 답한다. `getMatchedRules` 와
`testMatchOutcome` 은 룰 *매칭* 오라클이라 반환 타입에 헤더가 없고, Playwright 의
`request.headers()` 는 보안 관련 헤더를 의도적으로 누락한다. 서버가 받은 바이트만이
변경 이후 시점의 관측이다. **이 테스트를 약화시키지 말 것.**

---

## 2. Phase 2 로 이월된 것

최종 브랜치 리뷰가 분류했고, 병합 전 필수는 없다.

### 2.1 코드

| 항목 | 위치 | 성격 |
|---|---|---|
| `excludedRequestDomains` 가 정규화·검증을 안 거침 | `lib/compile/conditions.ts` | `requestDomains` 는 닫혔으나 이 표면은 열려 있음. 같은 트랜잭셔널 실패 경로 |
| 도메인 내부 공백이 `isValidDomain` 을 통과 | `lib/permissions/origins.ts` | 기존 갭. 등록은 되나 매칭되지 않는 조용한 실패 |
| 억제된 프로필도 `originsForFilter` 가 오리진을 반환 | `lib/permissions/origins.ts` | 과다 요청 방향이라 프라이버시 후퇴는 아님 |
| `reconcile` 테스트가 `await` 이전에 단언 | `tests/unit/ruleSync.test.ts` | 단언 실패 시 모듈 스코프 `inFlight` 가 pending 으로 남아 다음 테스트 오염 가능 |
| 실패 전파 테스트가 `updateDynamicRules` 만 커버 | `tests/unit/ruleSync.test.ts` | 완결성 문제이지 커버리지 공백은 아님 |
| 재조정 실패가 콘솔에만 남음 | `entrypoints/background.ts` | 설계 §6.2 는 사용자 도달을 규정. UI 가 Phase 2 |
| 팝업 도메인 입력이 타이핑 중 쉼표를 삼킴 | `entrypoints/popup/App.tsx` | Phase 2 의 실제 UI 가 이 입력을 대체 |
| `@types/chrome` 이 타입 프로그램에 없어 미사용 | `package.json` | 제거하거나 tsconfig 에 편입 결정 |
| shadcn 전이 의존성 6개가 캐럿 부동 | `package.json` | lockfile 로 재현성 확보됨. CI 의 `npm ci` 강제가 정답 |
| `author`·`keywords` 가 npm-init 잔여 | `package.json` | `private: true` 라 배포 메타데이터 아님 |

### 2.2 단일 기록자 가정이 설계상 깨진다

Phase 1 에서는 성립한다 — 상태를 쓰는 곳은 팝업의 `useAppState` 하나뿐이고 백그라운드는
읽기만 한다.

그러나 **설계 §6.3 자체가 이를 깬다.** 서비스워커 기동 시 잠긴 탭이 사라졌으면 잠금을
해제하도록 규정하는데, 그것이 곧 백그라운드의 상태 쓰기다. 동시에 팝업의 `update` 는
`AppState` 전체를 덮어쓰므로 last-write-wins 다. 팝업이 열린 채 백그라운드가 잠금을 해제하면
팝업의 다음 편집이 그것을 되돌린다.

**탭 잠금을 구현하기 전에 이 충돌을 먼저 설계할 것.**

---

## 3. 이 단계에서 비싸게 배운 것

### 3.1 트랜잭셔널 갱신은 양날이다

`updateDynamicRules` 는 트랜잭셔널이라 실패해도 직전 룰이 남는다 — 조사 단계에서는 장점으로
기록했다. 실제로는 **잘못된 행 하나가 배치 전체를 무효로** 만든다. 정상 사용 경로에서 두 번
발생했다:

- 팝업이 만드는 빈 이름 행 (`name: ''`)
- 문서에서 복사한 헤더명의 뒤 공백 (`"X-Api-Key "`)

**원칙:** 순수 층은 브라우저가 거부할 룰을 방출하지 않는다. Chrome 의 거부 경계는 정확히
"RFC 7230 토큰이 아닌 것"이므로 술어 하나가 경계와 1:1 로 맞는다.

### 3.2 fail-closed 와 fail-open 은 층마다 다르다

같은 "유효하지 않으면 건너뛴다"가 두 층에서 정반대 결과를 낸다.

- **헤더** — 유일한 헤더를 건너뛰면 `compileHeaders` 가 `{}` 를 반환하고 프로필이 드롭된다.
  fail-closed. 안전.
- **도메인** — 유일한 도메인을 건너뛰면 `requestDomains` 없는 룰이 되고, DNR 에서 도메인
  조건 없는 룰은 **모든 사이트에 매칭**된다. fail-open. 한 호스트로 좁혀둔 프로필이 조용히
  전 사이트에서 헤더를 바꾼다.

도메인은 프로필 단위로 억제해야 한다. **이 비대칭을 잊고 대칭 수정을 하지 말 것.**

### 3.3 멱등성은 직렬화를 함의하지 않는다

`reconcile()` 이 멱등이라는 사실이 겹친 실행을 안전하게 만들지 않는다. read-then-write 이므로
먼저 시작해 늦게 끝난 쪽이 낡은 룰 집합을 최종 상태로 남긴다. in-flight 래치가 필요하다.

### 3.4 검증 방법 자체가 틀릴 수 있다

- 웹폰트를 CDN `@import` 로만 찾으면 **자체 호스팅 패키지**를 놓친다(76KB 가 실릴 뻔했다).
- `host_permissions` 를 문자열 검색으로 확인하면 `"optional_host_permissions"` 가 부분
  문자열을 포함해 **거짓 통과**한다. 키 존재로 확인할 것.
- 순수성 가드를 소스 전체에 걸면 **제약을 문서화한 주석**이 걸린다. 주석을 제거하고 검사할 것.

### 3.5 계획 오류 10건은 전부 같은 종류였다

임포트 경로, 타입 프로그램 구성, 빌드 출력 디렉터리, `noUncheckedIndexedAccess` 상호작용 —
전부 "실제 환경에서 코드가 컴파일·실행되는가"였다. **설계 판단에서는 하나도 나오지 않았다.**

문서를 1차 출처로 확인해도 이 프로젝트의 tsconfig 상속 관계와 모드별 빌드 동작까지는 알 수
없었다. Phase 2 를 계획할 때는 **작은 조각을 먼저 실행해 환경을 확인하고 그 위에 계획을
세울 것.**

---

## 4. Phase 2 의 출발점

**이 프로젝트의 원래 동기가 Phase 2 다.** 원본의 기능은 훌륭했고 UI 가 낡아서 새로 만드는
것이었으며, 현재 팝업은 사슬이 동작함을 보이기 위한 최소 구현이다.

디자인은 이미 확정돼 커밋돼 있다:

- [`docs/design/popup-dark.html`](../../design/popup-dark.html)
- [`docs/design/popup-light.html`](../../design/popup-light.html)

방향은 Data Grid — CSS 변수 하나가 스티키 컬럼 헤더·그룹 구분선·모든 데이터 행·권한
서브행·추가 행을 함께 구동한다. 라이트 팔레트는 다크의 반전이 아니라 별도로 도출했고 WCAG
대비 감사를 거쳤다(블로커 2건 포함 18건 수정).

**Phase 2 범위:** 진단 8종과 인라인 UI · 권한 감사(설계 §5.4 의 후보 순서 규칙)와 부여
플로우 · 두 테마 Data Grid · 탭 잠금(§2.2 의 충돌을 먼저 해결) · 전체 일시정지 ·
JSON export/import · `lib/compile/validate.ts`(append 허용목록 21개, Phase 1 에서 이관).

**Phase 3:** `testMatchOutcome` 통합 테스트 · `check-no-network.ts` CI 가드 ·
설계 §11.7·§11.8 의 미해결 질문 해소 · Edge 에서 E2E 실행.
