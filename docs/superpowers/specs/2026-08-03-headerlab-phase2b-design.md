# HeaderLab Phase 2b 설계 — Data Grid UI

작성일: 2026-08-03
전제: [`2026-08-02-phase2a-handoff.md`](2026-08-02-phase2a-handoff.md) ·
설계 원본 §8: [`2026-07-31-headerlab-design.md`](2026-07-31-headerlab-design.md) ·
목업: [`../../design/popup-dark.html`](../../design/popup-dark.html) · [`../../design/popup-light.html`](../../design/popup-light.html)

---

## 1. 이 단계가 하는 일

**이 프로젝트가 시작된 이유가 이 단계다.** 원본 도구의 기능은 훌륭했고 UI 가 낡아서 새로 만드는 것이었으며, 지금 팝업은 사슬이 동작함을 보이려고 만든 최소 구현이다.

Phase 2a 가 진단 9종과 권한 감사 데이터를 만들었다. 2b 는 그것을 **확정된 Data Grid 목업대로 렌더한다.** 새 도메인 로직은 만들지 않는다 — 뷰모델과 컴포넌트, 그리고 그것들이 옳다는 증거뿐이다.

---

## 2. 범위

목업의 컨트롤을 백엔드 상태로 분류한 결과, 2b 는 **뒷받침이 있는 것만** 그린다.

| 컨트롤 | 뒷받침 | 2b |
|---|---|---|
| 프로필 탭 · 추가 · 이름 · 색 · 삭제 · 순서 | `AppState.profiles` | **포함** |
| Match 패턴 · Types 칩 | `Filter` · `compile()` | **포함** |
| 헤더 행 (On · Op · Name · Value) | `HeaderRule` | **포함** |
| 진단 9종 | `CompileResult.diagnostics` | **포함** |
| 권한 배지와 Grant | `audit.ts` · `probe.ts` | **포함** |
| Pause all | `AppState.globalPause` — `compile()` 이 이미 존중 | **포함** |
| 상태 줄 | `compile()` + `getSyncStatus()` | **포함** |
| **Tab lock** | 컴파일만 있고 탭을 잡는 경로도 §6.3 생명주기도 없음 | **제외 → 2c** |
| **⋯ 메뉴** (Export · Import · Settings) | 없음 | **제외 → 2c** |

**동작하지 않는 컨트롤을 그리지 않는다.** 비활성 상태로 그려두면 "곧 됩니다"라고 말하는 것인데, 2b 안에서는 끝내 되지 않는다. 목업의 두 번째 필터 행에서 Tab lock 이 빠지고 톱바에서 ⋯ 가 빠진다 — 승인된 레이아웃과 달라지는 두 곳이며, 의도된 차이다.

**테마 토글도 ⋯ 와 함께 빠진다.** 2b 는 `prefers-color-scheme` 만 따른다. `AppState.theme` 은 존재하지만 읽지 않으며, 토글과 저장값 보정은 2c 가 ⋯ 메뉴와 함께 넣는다(§6.3).

---

## 3. 컴포넌트 구조

### 3.1 `--cols` 는 한 곳에만 있다

```css
--cols: 38px 64px 186px 1fr 26px;
```

**`HeaderGrid.tsx` 가 소유한다.** 이 변수 하나가 스티키 컬럼 헤더, 두 그룹 구분선, 모든 데이터 행, 진단 서브행, 추가 행을 함께 구동한다. 설계 §8.1 이 이 방향을 고른 이유가 그것이고, 복제되는 순간 그 이점이 사라진다.

Phase 2a 가 같은 실패를 두 번 겪었다 — `HEADER_TOKEN` 정규식과 "프로필이 살아 있는가" 술어. 두 번 다 값이 복제됐다가 갈라졌다. **한 개념은 한 곳에.**

### 3.2 파일

```
entrypoints/popup/App.tsx        조립과 상태 배선
entrypoints/popup/index.html     동기 테마 스크립트
lib/view/grid.ts                 뷰모델 (순수)
components/
  TopBar.tsx                     브랜드 · Running/Pause all
  ProfileBar.tsx                 탭 · 추가 · 룰 수 · 재클릭 감지 · 상태 표식
  ProfileEditStrip.tsx           이름 · 색 5개 · 삭제              (조건부)
  FilterBlock.tsx                Match 패턴 · Types 칩
  DiagnosticBand.tsx             프로필 단위 진단 + Grant          (조건부)
  HeaderGrid.tsx                 --cols 소유 · 컬럼 헤더 · 그룹 · 추가 행
  HeaderRow.tsx                  한 행
  ValueCell.tsx                  읽기 / 확장 / 편집
  DiagnosticRow.tsx              행 단위 진단 서브행                (조건부)
  StatusFoot.tsx                 상태 줄
```

`lib/view/grid.ts` 는 **순수 층**이다. `tests/unit/purity.test.ts` 에 `lib/view/` 를 **자동 발견 대상으로** 추가한다 — `lib/compile/` 과 같은 방식이다.

가드가 `lib/permissions/` 만 명시 목록으로 두는 이유는 그 디렉터리에 어댑터(`probe.ts`)가 섞여 있어서 디렉터리 모양의 규칙이 성립하지 않기 때문이다. `lib/view/` 에는 순수 뷰모델만 들어가고 컴포넌트는 `components/*.tsx` 로 분리되므로, 자동 발견이 옳고 **새 파일이 공짜로 지켜진다.** 명시 목록에 넣으면 다음 사람이 잊을 자리를 하나 더 만드는 셈이다.

같은 파일의 `AUTO_DISCOVERED` 단언(현재 `lib/compile/` 8개를 이름으로 확인)도 함께 넓힌다.

### 3.3 수직 예산

팝업 상한은 800×600 이고 목업은 560×600 이다(설계 §8.4). 크롬은 §8.2 가 153px 로 줄여 둔 상태이며, Tab lock 을 뺐어도 필터는 여전히 2행(Match, Types)이라 그 예산이 유지된다.

조건부 세 개 — `ProfileEditStrip` · `DiagnosticBand` · `DiagnosticRow` — 는 **할 말이 있을 때만** 자리를 쓴다. 평상시 크롬은 목업 그대로이고 문제가 있을 때만 자란다.

---

## 4. 데이터 흐름

### 4.1 팝업이 직접 컴파일한다

```
useAppState()  ─→ state ─→ compile(state) ─→ diagnostics (동기 8종)
                              └──────────→ dynamic · session · requiredOrigins
                       ─→ domainsToAudit(profiles)
                              └→ probeGrants → auditDiagnostics → permission-missing
getSyncStatus()  ─→ lastError · ruleCount
```

`compile()` 은 순수 함수라 I/O 도 캐시도 없다. 백그라운드가 `reconcile()` 에서 돌리는 것과 **같은 상태에 같은 함수**이므로 화면과 실제 등록된 룰이 어긋날 수 없다. 진단을 저장소에 캐시했다면 그 일치를 따로 지켜야 했을 것이다.

`permission-missing` 만 비동기다 — `probeGrants` 가 브라우저를 부른다. 도착 전에는 그 진단만 없는 상태로 렌더하고, 도착하면 합류시킨다.

### 4.2 진단 라우팅은 데이터에서 나온다

```
diagnostic.headerRuleId 있음  → 그 행 밑 DiagnosticRow
diagnostic.headerRuleId 없음  → 필터 아래 DiagnosticBand
```

| 행 단위 | 프로필 단위 |
|---|---|
| `invalid-header-name` | `permission-missing` |
| `append-not-allowed` | `empty-filter` |
| `duplicate-header` | `invalid-domain` |
| `profile-conflict` | `port-ignored` |
| | `regex-unsupported` |

**종류별 하드코딩 표를 두지 않는다.** 필드 유무로 분기하므로 2c 가 11번째 종류를 추가해도 제자리를 찾는다. Phase 2a 가 `DiagnosticKind` 를 8종에서 10종으로 넓히면서 아무 소비자도 깨지 않은 것과 같은 성질이다.

### 4.3 error 를 입력에서 막지 않는다

설계 §7.1 은 "error 는 입력 단계에서 막는다"고 썼다. 그런데 2a 의 진단은 **입력 이벤트가 아니라 상태에서 계산**된다. 막으려면 별도 검증 경로가 필요하고, 붙여넣기 중간 상태가 거부되어 거슬린다.

**타이핑을 막지 않고 행에 표시한다.** 근거는 두 가지다:

- `compile()` 이 이미 그 행을 드롭하므로 잘못된 룰은 나가지 않는다 — 막지 않아도 안전하다
- 계산 모델과 표시 모델이 같아진다. 다르면 "화면은 빨간데 룰은 나갔다" 또는 그 반대가 생긴다

### 4.4 비활성 프로필의 문제는 탭이 알린다

`compile()` 은 **모든** 프로필의 진단을 낸다. 팝업은 한 번에 한 프로필만 보여준다. 푸터와 프로필바는 목업대로 활성 프로필 기준이므로, 그대로 두면 다른 프로필의 오류가 화면에서 사라진다 — 이 단계가 없애려는 조용한 실패와 같은 형태다.

**프로필 탭이 표식을 단다.** 설계 §8.3 의 다섯 색 중 "권한 필요"와 "제거"가 이미 있으므로 새 색을 만들지 않는다:

| 그 프로필의 상태 | 표식 |
|---|---|
| error 등급 진단 있음 | 제거 색 |
| `permission-missing` 만 있음 | 권한 필요 색 |
| 없음 | 없음 (정체성 점만) |

정체성 점은 §8.3 대로 프로필 색을 흐리게 재사용하고 활성일 때만 채도를 올린다. 표식은 그 옆에 별도로 붙어 **정체성과 상태를 섞지 않는다.**

---

## 5. 상호작용

### 5.1 오버레이를 쓰지 않는다

설계 §8.4 는 Popover·DropdownMenu 가 팝업 자신의 `document.body` 로 포털되어 동작은 하지만 **600px 천장에서 잘림 위험**이 있다고 기록했다. 다섯 군데(값 편집·Match 편집·Types 확장·행 메뉴·프로필 관리)에서 각각 그 위험을 검증하느니, 구조적으로 없앤다.

**전부 제자리에서 편집한다.** 그리드 안에 머무르므로 잘릴 자리가 없다.

### 5.2 `ValueCell` 만 3상태다

```
쉼    두 줄로 감긴 읽기          — 설계 §8.2, 값이 기본 상태에서 읽힌다
클릭  확장: 읽기 전용 · max-height 캡 · Copy · Edit · 글자 수
Edit  같은 자리 textarea · 같은 캡
```

§8.2 가 편집 패널을 없앤 이유가 "2KB 붙여넣기에 1056px 로 늘어남"이었다. 캡이 그 답이고, 읽기와 편집 모두에 걸린다.

나머지는 직접 편집이다 — 이름은 짧아 길이 문제가 없고, On 은 스위치, Op 는 3분기 컨트롤, Types 는 칩 토글(`+N` 을 누르면 칩 줄이 제자리에서 펼쳐짐), Match 는 연필을 누르면 그 자리가 입력이 된다.

행 끝 `⋮` 는 **삭제 하나**다. v1 범위(설계 §10)에 복제도 이동도 없다.

### 5.3 커밋은 편집당 한 번

**키 입력마다 쓰지 않는다.** 저장소가 바뀔 때마다 `reconcile()` 이 돌므로 `updateDynamicRules` 가 타이핑 속도로 요동친다. 그리고 인수인계 §4.5 가 기록한 **같은 기록자 경쟁** — 왕복 완료 전 두 번째 `patch` 가 앞선 델타를 버리는 — 이 키 입력마다 발생한다. 그 결함이 오늘 잠잠한 이유가 "핸들러당 한 번"인데 그 전제를 정면으로 깬다.

```
편집 중  컴포넌트 로컬 상태
Enter    커밋
blur     커밋
Escape   취소
```

편집 한 번에 쓰기 한 번이고, 알려진 경쟁을 건드리지 않는다. 2c 가 큐를 넣어 그 경쟁을 닫기 전까지 유효한 회피책이다.

### 5.4 프로필 관리

**활성 탭을 다시 누르면** 프로필바 아래 편집 스트립이 열린다 — 이름 입력 · 색 5개 · 삭제. 순서는 탭 드래그.

비활성 탭을 누르면 전환이고, 활성 탭을 누르면 편집이다. 오버레이 없이 관리 표면을 얻는 가장 짧은 경로다.

삭제는 되돌릴 수 없으므로 **한 번 더 확인한다** — 스트립 안에서 "Delete" 가 "Really delete?" 로 바뀌는 2단계. 별도 다이얼로그를 띄우지 않는다.

---

## 6. 테마

### 6.1 첫 페인트에 번쩍이면 안 된다

설계 §8.3 이 정한 그대로다. `theme` 은 `local:state` 에 있고 `storage.getItem` 은 비동기라, React effect 로 붙이면 잘못된 테마로 그려졌다가 고쳐진다. 하루에 수십 번 여는 표면에서 그 깜빡임은 정확히 잘못된 첫인상이고, 이 프로젝트가 존재하는 이유와 어긋난다.

**`index.html` 에 동기 인라인 스크립트**로 문서 파싱 시점에 `prefers-color-scheme` 을 읽어 `document.documentElement` 에 클래스를 단다.

### 6.2 클래스는 루트에 붙인다

shadcn 이 생성하는 다크 배리언트 `&:is(.dark *)` 는 `.dark` 를 단 요소 **자신에게는 적용되지 않고** 자손에만 적용된다. 팝업 안쪽 컨테이너에 달면 그 컨테이너의 배경이 빠져 어긋난다. 루트에 달면 shadcn 기본값을 그대로 쓸 수 있다(설계 §8.3).

### 6.3 저장값 보정은 2c

2b 는 `prefers-color-scheme` 만 읽는다. `AppState.theme` 이 `system` 이 아닌 경우의 비동기 보정은 **토글이 생기는 2c 에서 함께** 넣는다 — 값을 바꿀 방법이 없는데 읽기만 구현하면 도달 불가능한 코드가 된다.

### 6.4 라이트는 다크의 반전이 아니다

두 팔레트는 별도로 도출됐고 WCAG 대비 감사를 거쳤다(블로커 2건 포함 18건 수정). 목업 두 파일이 그 결과이며, **다크 값에서 계산해 라이트를 만들지 않는다.**

---

## 7. 색상 법칙

설계 §8.3 이 정한 다섯 색, 하나당 의미 하나:

```
포커스 · 적용 중 · 탭 잠금 · 권한 필요 · 제거
```

**흔한 경우인 `set` 은 색을 쓰지 않는다.** 무채색 평문 + 고정폭 기호 슬롯이다(§8.2 가 "`set` 을 파란 알약으로 표시"를 지적으로 받아 고친 결과).

탭 잠금 색은 2b 에서 쓰이지 않는다 — 기능이 2c 다. 팔레트에는 남겨 두고 사용처만 비운다.

---

## 8. 테스트

로직은 이미 순수 층이 덮고 있다. 2b 가 더하는 것은 뷰모델과 상호작용이다.

| 층 | 도구 | 무엇을 |
|---|---|---|
| 순수 | vitest | `lib/view/grid.ts` — 행 그룹화, 진단 라우팅, 카운트 |
| 컴포넌트 | RTL + jsdom | blur 커밋, `ValueCell` 3상태, 탭 재클릭, Escape 취소 |
| E2E | Playwright | 실제 확장에 상태를 주입하고 그리드가 렌더되는지 |

### 8.1 뷰모델을 먼저 뽑는다

컴포넌트 테스트는 느리고 깨지기 쉽다. **DOM 없이 답할 수 있는 질문은 순수 함수로 뺀다:**

```ts
export function groupRows(profile: Profile): { request: HeaderRule[]; response: HeaderRule[] };
export function routeDiagnostics(diagnostics: readonly Diagnostic[]): {
  byRow: Map<string, Diagnostic[]>;
  profileLevel: Diagnostic[];
};
export function profileMarker(diagnostics: readonly Diagnostic[], profileId: string):
  'error' | 'permission' | null;
export function applyingCounts(profile: Profile, diagnostics: readonly Diagnostic[]):
  { applying: number; total: number; off: number };
```

그러면 RTL 이 맡는 것은 **상호작용뿐**이다.

### 8.2 단언 강도 — 2a 의 반복 결함

Phase 2a 에서 "위반해도 통과하는 테스트"가 여섯 번 나왔고 전부 계획이 쓴 테스트였다. 매번 정확한 값을 쓸 수 있는 자리에 `toContain` 을 썼다.

**2b 의 기본값은 `toEqual` / `toHaveLength` 다.** `toContain` 은 정말 부분만 검사해야 할 때만 쓰고, 그 이유를 주석으로 남긴다.

그리고 **이전에 없던 UI 를 배선하는 태스크에는 "이 단언이 실제로 실패할 수 있는지 확인" 스텝을 명시한다** — 배선 전에는 "이 요소가 없다" 류 단언이 구조상 전부 공허하게 통과한다.

### 8.3 E2E 를 약화시키지 않는다

`tests/e2e/header-modification.spec.ts` 의 헤더 변경 단언이 "헤더가 실제로 바뀐다"에 답하는 유일한 층이다. 2b 는 그 두 테스트를 건드리지 않는다.

세 번째 테스트(`the popup renders in the real extension`)는 지금 `'Create profile'` 버튼을 찾는다. 새 UI 가 그 버튼을 대체하므로 **이 테스트만** 갱신하고, 갱신 방향은 약화가 아니라 강화다 — 상태를 주입하고 그리드 행이 실제로 뜨는지 본다.

### 8.4 새 의존성

`@testing-library/react` · `@testing-library/user-event` · `@testing-library/dom` · `jsdom`.

넷 다 npm 격리 창(`before` = 발행일 기준 72시간 전) 밖이라 설치된다. **격리를 우회하지 않는다** — 프로젝트 `.npmrc` 로 덮지 않고, `--force` 를 쓰지 않고, 레지스트리를 바꾸지 않는다.

---

## 9. 하지 않는 것

- **Tab lock** — 컴파일 경로는 있으나 탭 획득과 §6.3 생명주기가 없다. 인수인계 §4.5 의 단일 기록자 충돌을 먼저 풀어야 한다. → 2c
- **JSON export/import** — regex·pathPattern 표면을 도달 가능하게 만들므로 그 검증 뒤에 와야 한다. → 2c
- **테마 토글** — ⋯ 메뉴와 함께. → 2c
- **행 복제·이동** — v1 범위에 없다
- **가상 스크롤** — 프로필당 헤더 수가 그럴 규모가 아니다
- **`empty-filter` 를 두 종류로 쪼개기** — 인수인계 §4.3 이 지적한 대로 한 종류가 정반대 두 상태를 덮고 있다. 고치는 것이 옳지만 진단 층의 변경이라 UI 단계에 섞지 않는다

---

## 10. 알려진 제약

설계를 막지 않지만 구현 중 부딪힐 수 있다.

- **`requiredOrigins` 는 sound 하지만 minimal 하지 않다**(인수인계 §4.2). 억제된 프로필도 기여하고, 전부 무효인 프로필은 `<all_urls>` 로 넓힌다. 부여 UI 가 "필요한 최소 권한"을 주장하면 안 된다.
- **부여는 호스트 단위로 한다**(§4.1). `requiredOrigins` 를 배열째 `permissions.request()` 에 넘기면 항목 하나가 호출 전체를 죽인다. `probe.ts` 의 `requestHost(host)` 를 쓴다 — 사용자 제스처 요구 때문에 어차피 버튼당 한 호스트다.
- **`ruleCount` 는 dynamic + session 합산**이다. "항상 켜짐 N / 탭 고정 M" 을 보이려면 `SyncStatus` 를 넓혀야 하고, 그건 탭 잠금이 생기는 2c 의 일이다.
- **한 프로필 안 두 행이 같은 헤더를 건드리면 행마다 `profile-conflict` 이 나온다.** 프로필 단위가 아니다 — 서브행이 둘 뜬다.
- **`useAppState` 층에 테스트가 없다.** 2b 가 이 훅 위에 그리드 전체를 올리므로, 훅을 확장한다면 그 공백을 먼저 메운다.
