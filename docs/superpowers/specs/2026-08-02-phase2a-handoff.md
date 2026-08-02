# Phase 2a 인수인계 — 진단과 권한 감사

작성일: 2026-08-02
브랜치: `phase2a-diagnostics-and-audit` (27 커밋)
계획: [`../plans/2026-08-01-headerlab-phase2a-diagnostics-and-audit.md`](../plans/2026-08-01-headerlab-phase2a-diagnostics-and-audit.md) ·
실측: [`../../research/2026-08-01-permission-audit-spike.md`](../../research/2026-08-01-permission-audit-spike.md) ·
이전 단계: [`2026-08-01-phase1-handoff.md`](2026-08-01-phase1-handoff.md)

---

## 1. 무엇이 만들어졌는가

**Phase 2b 가 렌더할 데이터와, 그 데이터가 옳다는 증거.** UI 는 한 줄도 만들지 않았다.

| 산출물 | 위치 | 성격 |
|---|---|---|
| 진단 9종 | `lib/compile/{validate,filterDiagnostics,conflicts}.ts` | 순수 |
| 억제 술어 | `lib/compile/suppression.ts` | 순수 · **네 모듈의 유일한 기준** |
| 권한 감사 판정 | `lib/permissions/audit.ts` | 순수 |
| 권한 조회 | `lib/permissions/probe.ts` | 어댑터 · `browser.permissions` 를 부르는 유일한 파일 |
| 재조정 상태 기록 | `lib/storage/session.ts` | 어댑터 · 세션 영역 |
| 부분 상태 갱신 | `lib/storage/state.ts` 의 `patchState` | 어댑터 |

**최종 상태:** 단위 228/228(17파일) · E2E 3/3 · `tsc` 통과 · 빌드 통과.

`DiagnosticKind` 는 설계 §7.1 의 8종에서 **10종**이 됐다. 추가분은 `port-ignored`(포트를 벗겨냈음)와 `invalid-domain`(일부/전부 무효로 프로필이 억제됨)이다. 둘 다 의도된 개정이고 근거는 아래 §3 에 있다.

---

## 2. 설계를 정정한 것

### 2.1 권한 후보 사다리는 4단이 아니라 6단이다

설계 §5.4 는 `https://D/*` · `https://*.D/*` · `*://D/*` · `*://*.D/*` 네 단을 규정했다. **실측 결과 `http://` 전용 부여를 볼 수 있는 단이 하나도 없다** — `contains()` 는 부분집합 검사이고 `*://` 는 두 스킴을 모두 요구하므로, `http://127.0.0.1/*` 만 부여된 상태에서 네 후보가 전부 false 다.

이 도구 사용자가 가장 흔히 넣는 대상이 `localhost`·사내 http 서비스이고, 이 저장소의 e2e 빌드 자신이 그 설정이다. §5.4 가 사다리를 도입한 이유("배지가 한 번이라도 거짓 양성을 내면 사용자는 배지를 무시한다")가 정확히 그 지점에서 빗나가 있었다.

정정된 순서는 `origins.ts` 의 `originCandidates` 에 있다. 요청은 그대로 `*://*.D/*` 하나다 — **감사는 관대하게, 요청은 넉넉하게.**

### 2.2 `permissions.contains()` 는 던지고, 한 항목이 호출 전체를 오염시킨다

포트·스킴·빈 호스트가 든 패턴에 예외를 던진다. 반환값이 false 가 아니다. 그리고 유효한 항목과 함께 배치하면 **호출 전체가 죽는다.**

`probe.ts` 가 후보를 한 번에 하나씩, 각각 개별 `catch` 로 검사하는 이유다. Task 1 의 정규화가 잘못된 패턴을 만들기 어렵게 하지만, 이 함수가 마지막 방어선이다.

### 2.3 포트는 거부가 아니라 정규화한다

DNR 의 `requestDomains` 는 호스트 전용이라 포트를 표현할 수 없고, 호스트가 맞으면 포트와 무관하게 매칭된다. `localhost:3000` 을 거부하면 이 도구의 가장 흔한 입력이 막힌다. 벗겨내되 `port-ignored` 로 알린다.

DNR 은 포트가 붙은 항목을 **조용히 받아들이고 영원히 매칭하지 않는다**(실측 §4). 트랜잭션 실패가 아니라 죽은 룰이 된다.

---

## 3. 이 단계에서 비싸게 배운 것

### 3.1 "프로필이 살아 있는가"에 대한 답이 네 개였다

**이 단계 최악의 결함이고, 태스크별 리뷰가 구조적으로 볼 수 없던 것이다.**

같은 `filter.domains` 배열에 네 모듈이 다른 술어를 썼다 — `every(isValidDomain)` / `some(a => a.valid)` / 항목별 스킵 / `length > 0`. Phase 1 에서는 `isValidDomain` 이 느슨해서(비어 있지 않고 ASCII) 넷이 사실상 같은 답을 냈다. **Phase 2a 가 그것을 조이면서 처음으로 갈라졌다.**

결과는 침묵하는 실패였다:

```
domains: ['api.example.com', 'https://staging.example.com']
  compile.ts       every(isValidDomain) = false → 프로필 억제
  filterDiagnostics  some(valid) = true         → empty-filter 없음
  → diagnostics === []
```

프로필은 켜져 있고, 헤더 행은 정상이고, 경고는 없고, **헤더는 바뀌지 않는다.** 침묵하는 실패를 없애는 것이 존재 이유인 단계가 새 침묵하는 실패를 만들었다. 게다가 Phase 1 에서는 그 프로필이 유효한 도메인에서 동작했으므로 회귀였다. 도메인 칸에 URL 을 붙여넣는 흔한 행동으로 도달한다.

같은 뿌리에서 세 가지가 더 나왔다 — 이웃 프로필에게 "존재하지 않는 룰에 졌다"고 하고, 억제된 프로필에 "룰은 등록됐다"고 하고, `requiredOrigins` 에 던지는 패턴을 넣었다.

**해법은 네 곳을 각각 기우는 것이 아니라 술어를 한 번 추출하는 것이었다.** `lib/compile/suppression.ts` 의 `isSuppressed` 가 유일한 정의이고 네 모듈이 그것을 쓴다.

> **원칙:** 한 개념에 대한 술어가 여러 곳에 있으면 언젠가 갈라진다. 갈라진 진단은 없는 진단보다 나쁘다 — 사용자를 엉뚱한 곳으로 보내기 때문이다.

이 교훈은 이 단계 안에서 두 번 나왔다. `HEADER_TOKEN` 정규식도 두 파일에 복제돼 있다가 같은 이유로 공유로 바뀌었다.

### 3.2 억제는 모드를 보지 않는데 진단은 봤다

`compile.ts` 의 억제는 `filter.mode` 를 보지 않고, `conditions.ts` 는 regex 룰에도 `requestDomains` 를 세팅한다. 그런데 `filterDiagnostics` 는 regex 모드에서 조기 반환한다 — 그래서 regex 프로필도 같은 방식으로 조용히 죽었다.

**최종 수정 조건:** `isSuppressed(profile) && (mode === 'regex' || anyValid)`. 여섯 경우(모드 2 × 도메인 목록 3)를 표로 대조해 침묵도 이중 보고도 없음을 확인했다.

### 3.3 `toContain` 이 계획의 테스트를 여섯 번 무력화했다

이 단계에서 "위반해도 통과하는 테스트"가 여섯 번 나왔고 **전부 계획이 쓴 테스트**였다:

| 무엇을 지킨다고 했는가 | 실제로는 |
|---|---|
| 쓸 수 없는 도메인에 항목별 진단 없음 | 진단을 더 얹어도 통과 |
| 서브도메인 겹침 | `endsWith` 두 절을 지워도 통과 |
| `detectConflicts` 단일 호출 | 프로필마다 불러 중복이 나도 통과 |
| 호스트 단위 중복 제거 | 원본 항목 단위여도 통과 |
| `!a.valid` 가드 | 가드를 지워도 통과 |
| `session:` 영역 | `local:` 로 바꿔도 통과 |

**Phase 2b 계획에 반영할 것:** 기본값을 `toEqual`/`toHaveLength` 로 쓰고, `toContain` 은 정말 부분만 검사해야 할 때만. 그리고 **이전에 죽어 있던 코드를 배선하는 태스크**에는 "이 단언이 실제로 실패할 수 있는지 확인" 스텝을 명시적으로 넣을 것 — 배선 전에는 부정 단언이 구조상 전부 공허하게 통과한다.

### 3.4 계획 오류의 성격이 Phase 1 과 달랐다

Phase 1 의 계획 오류 10건은 전부 "이 환경에서 컴파일·실행되는가"였다. Phase 2a 는 **설계 판단 자체의 오류**였다 — 승자를 배열 순서로 정하기, 폐기된 프로필과 비교하기, 술어를 네 개 두기.

환경 오류는 실행하면 즉시 드러나지만 판단 오류는 초록불 아래 숨는다. 리뷰 층이 그래서 있다.

---

## 4. Phase 2b 가 물려받는 것

**늦게 알면 곤란한 것부터.**

### 4.1 `requiredOrigins` 를 배열째 `permissions.request()` 에 넘기지 말 것

실측이 기록한 "한 항목이 호출 전체를 오염시킨다"는 이 API 의 성질이지 이 필드의 성질이 아니다. `probe.ts` 가 세운 "한 번에 하나 + 개별 `catch`" 규율을 부여 경로에도 적용하거나, `requestHost(host)` 단위로만 부여할 것. 후자는 사용자 제스처 요구 때문에 어차피 버튼당 한 호스트다.

### 4.2 `requiredOrigins` 는 sound 하지만 minimal 하지 않다

억제된 프로필도 계속 기여한다(`compile.ts` 에서 억제 검사보다 앞에 있다). 일부 무효면 유효한 호스트를, 전부 무효면 `<all_urls>` 를 보탠다 — **도메인 칸에 URL 하나를 붙여넣은 것만으로 부여 프롬프트가 전 사이트로 커진다.**

회귀는 아니다. 수정 전에는 같은 프로필이 던지는 패턴을 넣어 호출 전체를 죽였으므로 지금이 엄격히 낫다. 다만 2b 가 "필요한 최소 권한"을 표시하려면 이 필드만으로는 부족하다.

### 4.3 `empty-filter` 한 종류가 정반대 두 상태를 덮는다

| 도메인 | 룰 | 의미 |
|---|---|---|
| 빈 배열 | **나간다** | 모든 사이트에 적용 — 위험 |
| 전부 무효 | **안 나간다** | 프로필이 죽음 |

지금은 메시지 문자열로만 구별된다. 2b 가 `kind` 나 `severity` 로 그룹핑하면 두 상태가 한 통에 들어간다. 같은 이유로 severity 도 갈린다 — structured 전부 무효는 `empty-filter`(warning), 같은 목록이 regex 모드면 `invalid-domain`(error)인데 둘 다 룰이 안 나간다.

닫으려면 `empty-filter` 를 `domains.length === 0` 기준으로 좁히고 나머지를 `invalid-domain` 으로 보내면 된다. 2a 에서 하지 않은 이유는 병합 직전 변경 범위를 넓히지 않기 위해서다.

### 4.4 `activeTab` 은 첫 소비자와 함께 재도입한다

Phase 1 이 미사용이라 제거했고 2a 도 쓰지 않는다 — 감사는 `filter.domains` 만 본다. 현재 탭 오리진을 읽는 것(설계 §5.3 의 두 번째 줄, 사용자가 스스로 알아낼 수 없는 부분)이 첫 소비자다.

**같은 태스크에서 매니페스트 단언을 집합 동등성 + 길이로 바꿀 것.** 지금은 배열 순서 동등성이라 빌드 도구의 직렬화 순서에 묶여 있다. 단언 문구가 "실제로 쓰는 권한만"이므로, 소비자 없이 넣으면 단언은 초록인 채 내용이 거짓이 된다.

### 4.5 `useAppState` 층에는 테스트가 없다

`state.test.ts` 의 신선도 테스트는 `patchState` **모듈 수준**만 못박는다. 훅 수준 정확성은 아무것도 보장되지 않는데 2b 가 이 훅 위에 Data Grid 전체를 올린다.

같은 기록자가 왕복 완료 전에 `patch` 를 두 번 부르면 나중 쓰기가 앞선 델타를 버린다. 오늘 호출부는 전부 핸들러당 한 번이라 발현하지 않는다. 해법은 큐이고, **백그라운드를 두 번째 기록자로 만드는 2c 의 탭 잠금과 함께** 가는 것이 맞다.

### 4.6 그 밖에

- `Diagnostic` 은 포함 도메인과 제외 도메인을 구분할 수 없다. 포트가 붙은 **제외** 도메인은 조용히 호스트 전체로 넓어지고 `port-ignored` 는 `filter.domains` 만 본다. 2b 가 제외 도메인 UI 를 만들면 이 침묵이 보이는 자리가 생긴다.
- `SyncStatus.ruleCount` 는 dynamic + session 합산이다. "항상 켜짐 N / 탭 고정 M" 을 보이려면 넓혀야 한다 — 가산적 변경이지만 세션 저장소 형태를 바꾸므로 UI 를 쓰기 전에 정하는 편이 싸다.
- 한 프로필 안에서 두 행이 같은 헤더를 건드리면 **행마다** `profile-conflict` 이 나온다. 프로필 단위가 아니다.
- 순수성 가드는 `lib/compile/` 만 자동 발견한다. `lib/permissions/` 와 `lib/model/` 은 명시 목록이고, `lib/model/{schema,defaults}.ts` 는 순수한데 지금도 덮이지 않는다.

---

## 5. Phase 2c 로 미룬 것

탭 잠금(§4.5 의 충돌을 먼저 해결) · 전체 일시정지 UI · JSON export/import · `filter.regex`/`pathPattern` 의 RE2 검증(`isRegexSupported()`, 어댑터 층).

**JSON import 가 regex·pathPattern 표면을 실제로 도달 가능하게 만든다.** 그 검증이 2c 안에서 import 보다 앞서야 한다.

## 6. Phase 3

`testMatchOutcome` 통합 테스트 · `scripts/check-no-network.ts` CI 가드 · Edge 에서 E2E 실행 · 설계 §11.7·§11.8 의 미해결 질문.

CI 가드는 이제 예외 없는 단순 검사다. Vite 의 modulepreload 폴리필이 배포 번들에 `fetch(` 리터럴을 남기고 있었는데(죽은 코드였다) `build.modulePreload: false` 로 제거했다 — **"네트워크 호출 0" 은 예외 목록을 달지 않고 산출물을 읽어 확인된다.**
