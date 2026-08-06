# HeaderLab Phase 2c 구현 계획 — 단일 기록자와 탭 잠금

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배경을 유일한 기록자로 만들고(직렬화된 쓰기 큐 + 메시지 왕복), 그 위에 첫 소비자로 탭 잠금을 올린다.

**Architecture:** 팝업은 `chrome.storage` 에 쓰지 않는다 — 델타를 배경에 보내고 배경이 모듈 수준 프로미스 체인 위에서 순차 적용한다. 결정 로직은 순수 층(`lib/storage/writer.ts`, `lib/tabs/lockLifecycle.ts`, `lib/view/staleLocks.ts`)에 두고 브라우저 호출은 얇은 어댑터 하나씩(`lib/messaging/client.ts`, `lib/tabs/tabProbe.ts`)에 가둔다. 탭 잠금 해제는 배경의 쓰기이므로 같은 큐를 지난다 — 그래서 큐가 먼저다.

**Tech Stack:** WXT 0.21 · React 19 · vitest 4 + @webext-core/fake-browser · React Testing Library + jsdom · Playwright 1.62

**근거 문서:**
- 스펙: [`../specs/2026-08-05-headerlab-phase2c-design.md`](../specs/2026-08-05-headerlab-phase2c-design.md)
- 인수인계: [`../specs/2026-08-02-phase2a-handoff.md`](../specs/2026-08-02-phase2a-handoff.md) §4.5 · §4.6 · §5
- 2b 설계: [`../specs/2026-08-03-headerlab-phase2b-design.md`](../specs/2026-08-03-headerlab-phase2b-design.md)
- 설계 원본 §6: [`../specs/2026-07-31-headerlab-design.md`](../specs/2026-07-31-headerlab-design.md)

**기준선(측정함, `8c2ee24`):** `npm test` → 26파일 377개 통과 · `npm run test:e2e` → 4개 통과 · `npx tsc --noEmit` → 0

---

## Global Constraints

이 절은 모든 태스크의 요구사항에 암묵적으로 포함된다.

### 설치 시 호스트 권한 0개

`tests/unit/manifest.test.ts` 는 권한 목록을 **정확히** 단언한다:

```ts
expect(manifest.permissions).toEqual(['storage', 'declarativeNetRequestWithHostAccess']);
```

`activeTab` 을 넣으면 이 단언이 붉어진다. 고치는 것은 **Task 7 뿐이고**, 정당한 이유는 Task 7 이 실제로 `activeTab` 을 소비하기 때문이다(팝업이 현재 탭의 `title` 을 읽는다). Phase 2a 가 `activeTab` 을 일부러 넣지 않은 이유가 "소비자가 없는데 넣으면 단언이 형식만 남고 내용은 거짓이 된다"였다(인수인계 §4.4). **소비자 없이 권한을 먼저 넣지 않는다.**

`host_permissions` 는 프로덕션 빌드에 절대 들어가지 않는다. `tabs` 권한은 설치 경고를 만들므로 **어떤 태스크도 추가하지 않는다.**

### 범위 — 이 단계가 만들지 않는 것

**만든다:** 단일 기록자 전환 · 탭 잠금(획득 · 생명주기 · UI) · `activeTab` 도입 · `ruleCount` 분리 · 프로필 on/off 토글 · `empty-filter` 분할 · `useAppState` 테스트.

**만들지 않는다 — 2d 로 간다:** JSON export/import · `filter.regex`/`pathPattern` 의 RE2 검증(`isRegexSupported()`) · 테마 토글과 ⋯ 메뉴. 2d 를 가르는 기준은 성격이다 — 이 단계는 **동시성**이고 2d 는 **신뢰 경계**(외부에서 들어온 입력의 검증)다. 인수인계 §5 가 "JSON import 가 regex·pathPattern 표면을 실제로 도달 가능하게 만든다"고 적었으므로 그 검증은 import 와 같은 단계에 있어야 한다.

**만들지 않는다 — 기각됨:** 잠금 시점 origin 기록(스펙 §4.1) · 탭 잠금의 창(window) 단위 확장 · `Diagnostic` 의 포함/제외 도메인 구분(인수인계 §4.6).

### 탭 잠금은 `tabId` 에만 묶인다

스펙 §4.1 의 결정이다. 잠근 탭이 다른 사이트로 이동해도 잠금은 유지되고, **어디에 적용되는지는 도메인 필터가 정한다.** 잠금 시점 origin 을 함께 기록해 이동 시 적용을 멈추는 안은 기각됐다 — SPA 라우팅과 리다이렉트에서 잡음이 되고, "이 탭"이라는 사용자의 기대와 어긋난다. `TabLock` 에 origin 필드를 더하지 않는다.

한 탭에 두 프로필을 잠그는 것도 막지 않는다. `priority.ts:36` 이 이미 순서를 정하므로 새 규칙이 필요 없다 — Task 6 의 `releaseLocksForTab` 이 "찾은 하나"가 아니라 전부를 해제하는 이유가 이것이다.

### 네트워크 원시 함수 0개

배포 번들에 `fetch` · `XMLHttpRequest` · `WebSocket` · `sendBeacon` 이 들어가지 않는다. 이 단계가 추가하는 코드에 그중 무엇도 없다 — 메시지 왕복은 `browser.runtime.sendMessage` 이지 네트워크가 아니다.

### npm 의존성을 추가하지 않는다

레지스트리에 3일 롤링 격리가 걸려 있어 최근 발행 패키지는 `ETARGET` 이고, `.npmrc` 의 `ignore-scripts=true` 때문에 lifecycle 훅이 아예 돌지 않는다. **우회 금지** — `--force` 도, 레지스트리 교체도, `npm audit fix` 도 하지 않는다. 이 계획은 새 의존성을 하나도 요구하지 않는다.

### 커밋 형식

`<type>: <description>` — type 은 feat · fix · refactor · docs · test · chore · perf · ci. **제목은 한국어.** `git log --oneline` 의 기존 형태를 그대로 따른다:

```
feat: 그리드를 조립하고 권한 부여를 붙인다
fix: Escape 가 편집을 취소하고 뒤따르는 blur 가 커밋하지 않는다
test: 색 스와치 단언이 클릭된 색을 실제로 구분하게 한다
```

### 단언 강도 — 이 단계가 재현하면 안 되는 실패

Phase 2b 에서 결함 9건이 나왔고 **전부 계획에서 비롯됐다.** 반복된 모양은 **실패할 수 없는 단언**이었다 — 정확한 값을 쓸 수 있는 자리의 `toContain`, 두 조건 중 하나만 만족시켜 변이가 보이지 않는 픽스처, 3단계 동작에 클릭 한 번짜리 테스트. 전체 브랜치 리뷰가 찾은 4건은 약한 단언이 아니라 **아예 없는** 단언이었다.

따라서 이 계획의 모든 테스트는:

1. **`toEqual` / `toHaveLength` 가 기본값이다.** `toContain` 은 부분 일치가 진짜 의도일 때만 쓰고 이유를 주석으로 남긴다.
2. **"어떤 잘못된 구현이 이 테스트를 통과하는가"를 묻는다.** 그럴듯한 답이 있으면 단언이 약한 것이다.
3. **여러 단계·여러 갈래를 가진 동작은 전부 단언한다.** 세 전이 중 하나만 확인하는 순환 테스트가 실제로 출하된 모양이다.
4. **각 태스크에 "새 단언이 실제로 실패할 수 있는지 확인" 스텝이 있다** — 구현을 깨고, 빨개지는 것을 보고, 되돌린다.

### 환경 사실 (이 계획을 쓰면서 실측함)

- **`@webext-core/fake-browser` 는 `declarativeNetRequest`·`permissions.*` 를 던지는 스텁으로 둔다.** `runtime.sendMessage` 는 리스너가 없으면 `No listeners available` 로 던지고, 리스너가 있어도 **반환값을 전달하지 않는다**(`undefined` 가 돌아온다). 따라서 왕복은 fake-browser 로 시뮬레이션할 수 없고 **손으로 심은 스파이**로 테스트한다. `wxt/testing/fake-browser` 와 `wxt/browser` 는 같은 객체이므로(`browser === fakeBrowser` 가 `true`) `vi.spyOn(browser.runtime, 'sendMessage')` 가 그대로 동작한다 — 확인함.
- **`browser.tabs` 는 존재한다.** `tabs.get(1)` 은 fake-browser 에서 **`undefined` 를 반환**하고(실제 Chrome 은 거부한다), `tabs.query({...})` 는 `[]` 를 반환한다. `vi.spyOn(browser.tabs, 'get').mockRejectedValue(...)` 로 실제 동작을 심을 수 있다 — 확인함. `tabs.onRemoved.addListener` 도 존재한다.
- **`entrypoints/background.ts` 는 단위 테스트에서 import 할 수 있다.** WxtVitest 플러그인이 `defineBackground` 를 자동 임포트로 넣어주며, **`defineBackground` 의 콜백은 import 시점에 실행되지 않는다** — 확인함. 따라서 `export async function handlePatch(...)` 같은 이름 붙은 export 를 background 에서 직접 꺼내 테스트할 수 있다.
- **jsdom 은 파일마다 `// @vitest-environment jsdom` 독블록이 필요하다.** 전역 environment 는 `node` 다.
- **`@testing-library/jest-dom` 은 설치돼 있지 않다.** `toBeInTheDocument` 를 쓰지 않는다 — 평범한 vitest matcher 만 쓴다(`toBeTruthy` · `toHaveProperty('value', ...)` · `getAttribute(...)`).
- **`@testing-library/react` 의 `renderHook` 과 `act` 는 사용 가능하다** — 확인함.
- **빌드 산출물을 읽는 테스트는 `tests/support/build.ts` 를 지난다** (`assertBuildFresh` / `readBuildFile`). `.output/` 을 건드리는 테스트를 계획하기 전에 그 모듈을 읽는다. 출력 디렉터리는 모드 접미사가 붙는다(`chrome-mv3-e2e`).
- **순수성 가드**(`tests/unit/purity.test.ts`)는 `lib/compile/*.ts` 와 `lib/view/*.ts` 를 `readdirSync` 로 자동 발견하고, `lib/permissions/` 는 **명시 목록**으로 덮는다. 다른 위치의 새 순수 파일은 목록에 넣지 않는 한 덮이지 않는다.
- **WXT**: 스토리지는 `#imports` 에서 임포트한다(`wxt/storage` 아님). 키에 영역 접두사가 필수다(`local:` · `session:`). `public/` 은 산출물 루트로 복사된다.
- **`noUncheckedIndexedAccess: true`** — 인덱스 접근은 전부 `T | undefined`.
- **E2E** 는 서비스 워커에서 `chrome.storage.local` 을 직접 시드하며 **동반 버전 키를 함께 써야 한다**: `chrome.storage.local.set({ state, state$: { v: 1 } })`.

### 이 단계가 지켜야 할 세 문장

- **Task 6 의 해제 경로는 배경의 쓰기이므로 Task 2 의 큐를 지난다.** 큐가 먼저인 이유가 이것이다(인수인계 §4.5).
- **스펙 §3.3 은 왕복이 침묵을 *없앨* 것을 요구한다.** 오늘 `void patchState(delta)` 는 거부된 쓰기를 삼킨다. 실패를 표면화하지 않는 왕복은 왕복만 추가한 것이다.
- **스펙 §9 첫 제약:** 저장된 탭 제목은 잠글 때 그 탭이 무엇이었는지의 **기록**이지 현재 상태가 아니다. UI 문구가 현재 상태라고 주장하면 안 된다.

---

## File Structure

### 새로 만드는 파일

| 파일 | 책임 | 층 | 태스크 |
|---|---|---|---|
| `docs/research/2026-08-05-activetab-spike.md` | `activeTab` 실측 기록 | 문서 | 1 |
| `lib/storage/writer.ts` | 직렬화 쓰기 큐 팩토리. 저장소를 주입받는다 | **순수** | 2 |
| `lib/storage/backgroundWriter.ts` | 그 팩토리로 만든 **모듈 수준 단일 체인** | 어댑터 | 2 |
| `lib/messaging/protocol.ts` | `PatchRequest`/`PatchResponse` · 타입 가드 · `messageOf` | **순수** | 3 |
| `lib/messaging/client.ts` | 팝업 → 배경 전송 + SW 기동 경합 재시도 | 어댑터 | 4 |
| `lib/tabs/lockLifecycle.ts` | 어느 잠금이 죽었는가 · 해제된 프로필 배열 | **순수** | 6 |
| `lib/tabs/tabProbe.ts` | `browser.tabs` 를 부르는 유일한 파일 | 어댑터 | 6·7 |
| `lib/view/staleLocks.ts` | 세션 기록 → `tab-lock-stale` 진단 | **순수**(자동 발견) | 6 |
| `tests/unit/writer.test.ts` | 큐의 동시성 계약 | 테스트 | 2 |
| `tests/unit/protocol.test.ts` | 메시지 타입 가드 | 테스트 | 3 |
| `tests/unit/backgroundPatch.test.ts` | `handlePatch` + 단일 체인 | 테스트 | 3 |
| `tests/unit/writePath.test.ts` | 팝업이 저장소에 쓰지 않는다는 가드 | 테스트 | 4 |
| `tests/unit/messagingClient.test.ts` | 재시도 · 실패 변환 | 테스트 | 4 |
| `tests/unit/useAppState.test.tsx` | 훅 수준 정확성 | 테스트 | 4 |
| `tests/unit/lockLifecycle.test.ts` | 순수 생명주기 판정 | 테스트 | 6 |
| `tests/unit/tabProbe.test.ts` | 어댑터 | 테스트 | 6 |
| `tests/unit/backgroundTabLock.test.ts` | 기동 스윕 · `onRemoved` | 테스트 | 6 |
| `tests/unit/staleLocks.test.ts` | 진단 변환 | 테스트 | 6 |
| `tests/unit/TabLock.test.tsx` | `FilterBlock` 의 잠금 UI | 테스트 | 7 |
| `tests/e2e/tab-lock.spec.ts` | 잠긴 탭에서만 헤더가 바뀐다 | E2E | 10 |

### 고치는 파일

| 파일 | 무엇을 | 태스크 |
|---|---|---|
| `entrypoints/background.ts` | `handlePatch` export · `onMessage` 등록 · 기동 스윕 · `tabs.onRemoved` | 3·6 |
| `lib/storage/useAppState.ts` | 왕복 전환 · 낙관적 갱신 유지 · `ok:false` 되돌림 · `writeError` | 4 |
| `lib/storage/session.ts` | `ruleCount` 를 `{always,tabLocked}` 로 · `staleLocksItem` 추가 | 5·6 |
| `lib/sync/ruleSync.ts` | 분리된 `ruleCount` 기록 | 5 |
| `lib/model/types.ts` | `StaleLock` · `no-usable-domain` | 6·9 |
| `entrypoints/popup/App.tsx` | `writeError` · `ruleCount` · stale 진단 · 잠금 토글 · 프로필 토글 · `inertReason` | 4·5·6·7·8 |
| `components/StatusFoot.tsx` | `writeError` · `ruleCount` · `reason` | 4·5·8 |
| `components/FilterBlock.tsx` | 탭 잠금 컨트롤 | 7 |
| `components/ProfileEditStrip.tsx` | 프로필 on/off 토글 | 8 |
| `components/ProfileBar.tsx` | `isSuppressed` 인자 제거 | 9 |
| `lib/view/grid.ts` | `inertReason` 추가 · `profileMarker` 의 2b 우회 제거 | 8·9 |
| `lib/compile/filterDiagnostics.ts` | `empty-filter` 분할 | 9 |
| `entrypoints/popup/style.css` | 잠금 · 토글 · 상태 줄 스타일 | 7·8 |
| `wxt.config.ts` | `activeTab` | 7 |
| `tests/unit/purity.test.ts` | 새 순수 파일 등록 | 2·3·6 |
| `tests/unit/manifest.test.ts` | 권한 목록 | 7 |
| `tests/unit/session.test.ts` · `ruleSync.test.ts` | `ruleCount` 형태 | 5 |
| `tests/unit/grid.test.ts` · `ProfileBar.test.tsx` · `filterDiagnostics.test.ts` · `compile.test.ts` | 분할과 우회 제거 반영 | 9 |

### 경계 규칙 두 개

1. **`lib/storage/writer.ts` 는 순수하다.** `lib/storage/` 에는 어댑터(`state.ts`·`session.ts`)가 섞여 있어 디렉터리 모양의 규칙이 성립하지 않으므로, `lib/permissions/` 와 **같은 방식으로 `purity.test.ts` 의 `EXPLICIT` 명시 목록**에 넣는다(Task 2 에서). `lib/messaging/protocol.ts` 와 `lib/tabs/lockLifecycle.ts` 도 같은 이유로 명시 목록이다. `lib/view/staleLocks.ts` 만 자동 발견으로 공짜로 덮인다.
2. **팝업은 `chrome.storage` 에 쓰지 않는다**(스펙 §3.2·§3.5). Task 4 가 이것을 텍스트 가드로 못 박는다.

---

## Task 1: `activeTab` 실측 스파이크

**Files:**
- Create: `docs/research/2026-08-05-activetab-spike.md`
- Scratch (커밋하지 않음): 스크래치패드 아래 `spike-activetab/`

**Interfaces:**
- Consumes: 없음
- Produces: 문서. Task 6·7 이 이 문서의 §1~§4 를 근거로 인용한다. **프로덕션 코드를 만들지 않는다.**

이 태스크의 산출물은 **연구 문서 하나**다. `docs/research/2026-08-01-permission-audit-spike.md` 의 모양을 따른다 — 그 스파이크는 설계를 뒤집었고, 그렇게 할 수 있었던 이유가 그 구조다: **부여 상태 → 후보 → 결과 표 → 결론**. 표에 실제로 관측한 값만 적는다.

### 멈춤 규칙 — 먼저 읽는다

스펙 §4.2 의 네 질문 중 아래 답이 나오면 **거기서 멈추고 보고한다. 가정 위에서 진행하지 않는다.**

| 관측 | 무엇이 무너지는가 | 조치 |
|---|---|---|
| `activeTab` 만으로 팝업의 `tabs.query` 가 `title` 을 채우지 않는다 | §4.4 의 "잠긴 탭 제목" 표시가 근거를 잃는다 | **멈춤.** Task 7 시작 금지 |
| 살아 있는 탭인데 `activeTab` 만료 후 `tabs.get(id)` 이 거부한다 | §4.3 의 생존 확인이 살아 있는 잠금을 해제한다 — 조용한 범위 축소가 아니라 **조용한 범위 확대** | **멈춤.** Task 6 시작 금지 |
| `tabs.get(id)` 이 아무 권한 없이도 거부한다 | Task 6 이 `tabs` 권한을 요구하게 되고, 그것은 설치 경고를 만들어 이 프로젝트의 존재 이유와 충돌한다 | **멈춤.** 설계 재검토 |

Task 2~5 는 이 네 질문에 의존하지 않으므로 보고 후 지시에 따라 계속할 수 있다. **기본값은 멈춤이다.**

- [ ] **Step 1: 스파이크 확장을 만든다**

스크래치패드에 `spike-activetab/` 를 만들고 아래 세 파일을 넣는다. **`activeTab` 하나만 선언한다 — `tabs` 도, `host_permissions` 도 넣지 않는다.** 그것이 측정하려는 조건이기 때문이다.

`manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "activeTab spike",
  "version": "1.0",
  "permissions": ["activeTab"],
  "background": { "service_worker": "sw.js" },
  "action": { "default_popup": "popup.html" }
}
```

`popup.html`:

```html
<!doctype html><meta charset="utf-8"><title>spike</title>
<body><pre id="out">…</pre><script src="popup.js"></script></body>
```

`popup.js`:

```js
(async () => {
  const record = { at: Date.now() };
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    record.query = tabs.map((t) => ({
      id: t.id,
      hasTitle: Object.prototype.hasOwnProperty.call(t, 'title'),
      title: t.title ?? null,
      url: t.url ?? null,
    }));
  } catch (e) {
    record.queryThrew = String(e);
  }
  document.getElementById('out').textContent = JSON.stringify(record, null, 2);
  // Hand the tab id to the SW so §4.2's second and fourth questions can be
  // asked from the other context, and again after the popup has closed.
  await chrome.runtime.sendMessage({ type: 'spike', record });
})();
```

`sw.js`:

```js
const log = [];
const note = (label, value) => { log.push({ label, value }); console.log('[spike]', label, JSON.stringify(value)); };

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'spike') return;
  note('popup.query', message.record);
  const id = message.record.query?.[0]?.id;
  if (typeof id !== 'number') return;

  // Q2: does the background have the same access, right now?
  chrome.tabs.query({ active: true, currentWindow: true })
    .then((t) => note('sw.query.immediate', t.map((x) => ({ id: x.id, title: x.title ?? null, url: x.url ?? null }))))
    .catch((e) => note('sw.query.immediate.threw', String(e)));

  // Q4: what does tabs.get say for a *live* tab once activeTab has expired?
  // 30s is well past the popup closing.
  setTimeout(() => {
    chrome.tabs.get(id)
      .then((t) => note('sw.tabs.get.after30s', { id: t.id, title: t.title ?? null, url: t.url ?? null }))
      .catch((e) => note('sw.tabs.get.after30s.threw', String(e)));
  }, 30_000);
});

// Q4b: tabs.get for an id that is certainly gone.
chrome.tabs.get(999_999)
  .then((t) => note('sw.tabs.get.missing', t))
  .catch((e) => note('sw.tabs.get.missing.threw', String(e)));

globalThis.spikeLog = () => log;
```

- [ ] **Step 2: 네 질문을 측정한다**

`activeTab` 은 **사용자가 확장을 실제로 호출할 때만** 부여된다. 툴바 아이콘 클릭이 그 호출이고, Playwright 는 그 아이콘을 클릭할 수 없다 — `chrome-extension://ID/popup.html` 을 탭으로 여는 것은 호출이 **아니다.** 그래서 이 측정은 손으로 한다. Playwright 로 자동화하려 시도하지 말 것: 부여되지 않은 상태를 부여된 상태로 오독하게 되고, 그것이 이 스파이크가 막으려는 오류다.

절차:

1. Chrome 에서 `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램을 로드합니다" → `spike-activetab/`.
2. 일반 웹페이지(예: `https://example.com/`)를 연다.
3. 확장의 서비스 워커 콘솔을 연다(확장 카드의 "서비스 워커" 링크).
4. **툴바에서 확장 아이콘을 클릭한다.** 팝업의 `<pre>` 내용을 그대로 복사한다 → **Q1** 의 답.
5. SW 콘솔의 `sw.query.immediate` 줄을 복사한다 → **Q2** 의 답.
6. 팝업을 닫는다. 30초 뒤 `sw.tabs.get.after30s` 줄을 복사한다 → **Q4** 의 답.
7. `chrome://extensions` 탭으로 이동한 뒤 아이콘을 다시 클릭한다. 팝업의 내용을 복사한다 → **Q3** 의 답.
8. `sw.tabs.get.missing.threw` 줄을 복사한다 → 사라진 탭의 정확한 실패 모양.

- [ ] **Step 3: 문서를 쓴다**

`docs/research/2026-08-05-activetab-spike.md` 를 만든다. 권한 감사 스파이크와 같은 구조: 제목 · 작성일 · 대상 스펙 절 · 방법 한 줄 · 재현 경로. 본문은 아래 다섯 절이고, **각 절이 관측 표로 시작한다.**

```markdown
# activeTab 실측 — 스펙 §4.2 검증

작성일: 2026-08-05 · 대상: [Phase 2c 설계 §4.2](../superpowers/specs/2026-08-05-headerlab-phase2c-design.md) ·
방법: `activeTab` 만 선언한 언팩 확장을 실제 Chrome 에 로드하고 툴바 아이콘을 눌러 팝업과
서비스 워커에서 각각 `chrome.tabs` 를 호출

재현: 스크래치패드 `spike-activetab/`(manifest.json · popup.html · popup.js · sw.js).
**자동화하지 않았다** — `activeTab` 은 사용자의 확장 호출에만 부여되며 툴바 아이콘 클릭이
그 호출이고, Playwright 는 그것을 누를 수 없다. `popup.html` 을 탭으로 여는 것은 호출이
아니므로 자동화하면 부여되지 않은 상태를 측정하게 된다.

---

## 1. Q1 — 팝업의 `tabs.query` 가 `title` 을 채우는가

<관측한 JSON 을 그대로>

| 필드 | 값 | 판정 |
|---|---|---|
| `id` | | |
| `title` | | |
| `url` | | |

<결론 한 문단: §4.4 의 "잠긴 탭 제목" 표시가 성립하는가>

## 2. Q2 — 배경도 같은 접근을 갖는가

<관측>

<결론: 팝업이 읽어 배경에 넘겨야 하는가, 배경이 스스로 읽어도 되는가.
Task 7 의 데이터 흐름이 여기서 결정된다>

## 3. Q3 — `chrome://` 페이지에서 무엇이 오는가

<관측>

<결론: `title`/`url` 이 비어 오는가, 예외인가, 탭 자체가 안 오는가.
Task 7 의 "제목을 못 읽었으면 탭 번호로 대체" 분기가 실제로 도달 가능한지가 여기서 정해진다>

## 4. Q4 — `activeTab` 만료 후 `tabs.get(id)`

| 대상 | 결과 |
|---|---|
| 살아 있는 탭, 팝업 닫힌 뒤 30초 | |
| 존재하지 않는 id (999999) | |

<결론: §4.3 의 생존 확인이 성립하는가. 살아 있는 탭에 대해 거부가 나오면 설계가 무너진다>

## 5. 설계에 대한 판정

| 스펙의 전제 | 실측 | 조치 |
|---|---|---|
| `activeTab` 으로 팝업이 탭 제목을 읽는다 (§4.2) | | |
| `tabs.get` 으로 잠금 생존을 확인한다 (§4.3) | | |
| `tabs` 권한이 필요 없다 (§4.2) | | |

<설계와 다르면 여기에 정정안을 쓰고 멈춘다. 이 프로젝트에서 실측이 설계를 뒤집은 것이
이번이 세 번째가 된다 — 권한 사다리 4단→6단, MV3 CSP 와 인라인 스크립트>
```

- [ ] **Step 4: 멈춤 규칙을 적용한다**

§5 의 판정 표를 채운 뒤, 이 태스크 서두의 멈춤 표와 대조한다. 한 줄이라도 걸리면 **여기서 멈추고 계획 소유자에게 보고한다.** 설계가 고쳐지기 전에는 Task 6·7 을 시작하지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add docs/research/2026-08-05-activetab-spike.md
git commit -m "docs: activeTab 이 팝업과 배경에 무엇을 주는지 실측한다"
```

---

## Task 2: 쓰기 큐

**Files:**
- Create: `lib/storage/writer.ts`
- Create: `lib/storage/backgroundWriter.ts`
- Create: `tests/unit/writer.test.ts`
- Modify: `tests/unit/purity.test.ts:18-21` (EXPLICIT 목록), `:66-73` (그 목록의 단언)

**Interfaces:**
- Consumes: `AppState` (`@/lib/model/types`), `getState`/`setState` (`@/lib/storage/state`)
- Produces:
  - `interface StateStore { read(): Promise<AppState>; write(next: AppState): Promise<void> }`
  - `type WriteQueue = (fn: (current: AppState) => Partial<AppState>) => Promise<AppState>`
  - `function createWriteQueue(store: StateStore): WriteQueue`
  - `const enqueueWrite: WriteQueue` (`@/lib/storage/backgroundWriter`) — **배경의 모든 쓰기가 지나는 단일 체인.** Task 3 의 `handlePatch` 와 Task 6 의 잠금 해제가 둘 다 이것을 쓴다.

계약 세 줄:

1. `fn` 은 **자기 차례가 왔을 때 새로 읽은** 상태를 받는다. 큐에 넣을 때의 스냅샷이 아니다.
2. 진입 순서대로 실행되고, 앞 항목의 쓰기가 끝나기 전에 뒤 항목의 읽기가 시작되지 않는다.
3. 한 항목이 던져도 **그 호출자에게만** 전파되고 뒤 항목은 계속된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/writer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createWriteQueue, type StateStore } from '@/lib/storage/writer';
import { DEFAULT_STATE } from '@/lib/model/defaults';
import type { AppState, Profile } from '@/lib/model/types';

function stub(name: string): Profile {
  return {
    id: name, name, color: 'green', enabled: true, order: 0,
    filter: { mode: 'structured', domains: [], excludedDomains: [], resourceTypes: ['xmlhttprequest'] },
    tabLock: { enabled: false, tabId: null, tabTitle: null },
    headers: [],
  };
}

/** An in-memory store that also records the order its two methods were entered. */
function recordingStore() {
  let value: AppState = { ...DEFAULT_STATE };
  const log: string[] = [];
  const store: StateStore = {
    async read() { log.push('read'); await Promise.resolve(); return value; },
    async write(next) { log.push('write'); await Promise.resolve(); value = next; },
  };
  return { store, log, current: () => value };
}

describe('createWriteQueue', () => {
  it('lands every one of five concurrent writes, in the order they were enqueued', async () => {
    // Five, not two: a queue that silently drops one entry still produces the
    // right *final* value with two calls if the survivor happens to be the
    // last. Asserting the whole resulting array, and each caller's own
    // resolved value, leaves nowhere for a dropped entry to hide.
    const { store, current } = recordingStore();
    const enqueue = createWriteQueue(store);
    const names = ['a', 'b', 'c', 'd', 'e'];

    const results = await Promise.all(
      names.map((n) => enqueue((s) => ({ profiles: [...s.profiles, stub(n)] }))),
    );

    expect(current().profiles.map((p) => p.id)).toEqual(names);
    expect(results.map((r) => r.profiles.map((p) => p.id))).toEqual([
      ['a'],
      ['a', 'b'],
      ['a', 'b', 'c'],
      ['a', 'b', 'c', 'd'],
      ['a', 'b', 'c', 'd', 'e'],
    ]);
  });

  it('serializes read-then-write, never interleaving two entries', async () => {
    // The count of reads and writes alone cannot tell a serialized queue from
    // three parallel round-trips — both do three of each. Only the *order*
    // does: parallel execution produces read,read,read,write,write,write.
    const { store, log } = recordingStore();
    const enqueue = createWriteQueue(store);

    await Promise.all([
      enqueue(() => ({ globalPause: true })),
      enqueue(() => ({ globalPause: false })),
      enqueue(() => ({ theme: 'dark' })),
    ]);

    expect(log).toEqual(['read', 'write', 'read', 'write', 'read', 'write']);
  });

  it('hands each entry the state the previous entry wrote', async () => {
    // The whole point of the queue: `fn` must see the result of the entry
    // before it, not the snapshot that existed when it was enqueued. Without
    // this, three appends produce a one-profile state and the interleave test
    // above still passes.
    const { store } = recordingStore();
    const enqueue = createWriteQueue(store);
    const seen: number[] = [];

    await Promise.all(['a', 'b', 'c'].map((n) => enqueue((s) => {
      seen.push(s.profiles.length);
      return { profiles: [...s.profiles, stub(n)] };
    })));

    expect(seen).toEqual([0, 1, 2]);
  });

  it('keeps running the rest of the queue when one entry throws', async () => {
    const { store, current } = recordingStore();
    const enqueue = createWriteQueue(store);

    const a = enqueue((s) => ({ profiles: [...s.profiles, stub('a')] }));
    const b = enqueue(() => { throw new Error('boom'); });
    const c = enqueue((s) => ({ profiles: [...s.profiles, stub('c')] }));

    await expect(a).resolves.toBeDefined();
    await expect(b).rejects.toThrow('boom');
    await expect(c).resolves.toBeDefined();
    // c must have seen a's write — a poisoned chain would leave c never run,
    // and a chain that swallowed the throw silently would leave c's `fn`
    // reading a state that never got b's (absent) contribution anyway. The
    // exact array is what separates the two.
    expect(current().profiles.map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('surfaces a failing store write to that caller only', async () => {
    let value: AppState = { ...DEFAULT_STATE };
    let writes = 0;
    const store: StateStore = {
      async read() { return value; },
      async write(next) {
        writes += 1;
        if (writes === 1) throw new Error('storage full');
        value = next;
      },
    };
    const enqueue = createWriteQueue(store);

    const first = enqueue(() => ({ theme: 'dark' }));
    const second = enqueue(() => ({ theme: 'light' }));

    await expect(first).rejects.toThrow('storage full');
    await expect(second).resolves.toMatchObject({ theme: 'light' });
    expect(value.theme).toBe('light');
  });

  it('gives each queue its own chain', async () => {
    // The chain is module-level in backgroundWriter.ts, not in the factory —
    // pinning that here means a future "optimisation" that hoists the chain
    // into module scope turns red instead of silently coupling two stores.
    const one = recordingStore();
    const two = recordingStore();

    await Promise.all([
      createWriteQueue(one.store)(() => ({ theme: 'dark' })),
      createWriteQueue(two.store)(() => ({ theme: 'light' })),
    ]);

    expect(one.current().theme).toBe('dark');
    expect(two.current().theme).toBe('light');
  });
});

describe('the background chain', () => {
  it('is one shared chain, so two concurrent background writes both land', async () => {
    const { fakeBrowser } = await import('wxt/testing/fake-browser');
    fakeBrowser.reset();
    const { enqueueWrite } = await import('@/lib/storage/backgroundWriter');
    const { getState } = await import('@/lib/storage/state');

    await Promise.all([
      enqueueWrite((s) => ({ profiles: [...s.profiles, stub('one')] })),
      enqueueWrite((s) => ({ profiles: [...s.profiles, stub('two')] })),
    ]);

    expect((await getState()).profiles.map((p) => p.id)).toEqual(['one', 'two']);
  });
});
```

- [ ] **Step 2: 붉은지 확인한다**

```bash
npx vitest run tests/unit/writer.test.ts
```

기대: `Failed to resolve import "@/lib/storage/writer"`.

- [ ] **Step 3: 순수 층을 구현한다**

`lib/storage/writer.ts`:

```ts
import type { AppState } from '@/lib/model/types';

/**
 * The storage this queue serializes against, injected so the queue itself
 * imports no browser API and can be tested without one.
 */
export interface StateStore {
  read(): Promise<AppState>;
  write(next: AppState): Promise<void>;
}

export type WriteQueue = (fn: (current: AppState) => Partial<AppState>) => Promise<AppState>;

/**
 * A serialized write path: one entry reads, merges and writes before the next
 * one reads.
 *
 * `chrome.storage` has no atomic compare-and-swap, so a generation number plus
 * a retry still leaves a window between the check and the write. Serializing
 * inside one context still leaves the popup-versus-background race. Both are
 * partial. With exactly one writer running exactly one entry at a time, delta
 * loss does not narrow — it disappears (spec §3.1).
 *
 * `fn` receives the state read at *its* turn, never the snapshot that existed
 * when it was enqueued. That is the property the popup's second-patch-before-
 * the-first-lands case needed (Phase 2a handoff §4.5).
 *
 * An entry that throws rejects only its own caller: `tail` follows the
 * *caught* promise, so a failure cannot poison the chain and strand every
 * write after it — including the tab-lock release, which is a safety-relevant
 * write (spec §4.3).
 */
export function createWriteQueue(store: StateStore): WriteQueue {
  let tail: Promise<unknown> = Promise.resolve();

  return (fn) => {
    const run = tail.then(async () => {
      const current = await store.read();
      const next: AppState = { ...current, ...fn(current) };
      await store.write(next);
      return next;
    });
    tail = run.catch(() => undefined);
    return run;
  };
}
```

- [ ] **Step 4: 배경의 단일 체인을 만든다**

`lib/storage/backgroundWriter.ts`:

```ts
import { createWriteQueue, type WriteQueue } from '@/lib/storage/writer';
import { getState, setState } from '@/lib/storage/state';

/**
 * The background's one and only write path (spec §3.2). The popup's patches
 * and the tab-lock release are the same queue — that is what makes the
 * background a single writer rather than merely the *last* one.
 *
 * Module-level on purpose: a per-caller queue would serialize each caller
 * against itself and nothing else, which is the state of affairs this file
 * exists to end.
 */
export const enqueueWrite: WriteQueue = createWriteQueue({ read: getState, write: setState });
```

- [ ] **Step 5: 초록인지 확인한다**

```bash
npx vitest run tests/unit/writer.test.ts
```

기대: 7 passed.

- [ ] **Step 6: 순수성 가드에 등록한다**

`tests/unit/purity.test.ts` 의 `EXPLICIT` 를 고친다:

```ts
/**
 * Hand-listed, because `lib/permissions/`, `lib/storage/`, `lib/messaging/`
 * and `lib/tabs/` each hold an adapter alongside a pure file — `probe.ts`,
 * `state.ts`/`session.ts`/`backgroundWriter.ts`, `client.ts`, `tabProbe.ts` —
 * so there is no directory-shaped rule to auto-discover. A new pure file in
 * any of them is guarded only if someone remembers to add it.
 *
 * That is why the entries are asserted by name below rather than by count.
 */
const EXPLICIT = [
  'lib/permissions/origins.ts',
  'lib/permissions/audit.ts',
  'lib/storage/writer.ts',
];
```

그리고 그 목록의 단언을 함께 넓힌다:

```ts
  it('still guards every hand-listed pure file', () => {
    // These are the ones a refactor can silently drop — nothing rediscovers
    // them. `toEqual` on the exact list means removing one turns this red.
    expect(EXPLICIT).toEqual([
      'lib/permissions/origins.ts',
      'lib/permissions/audit.ts',
      'lib/storage/writer.ts',
    ]);
  });
```

그리고 어댑터가 가드되지 않음을 못 박는 단언을 하나 더 넣는다 — `probe.ts` 옆 자리다:

```ts
  it('does not guard the storage adapters — they import the browser by design', () => {
    expect(PURE_FILES).not.toContain('lib/storage/state.ts');
    expect(PURE_FILES).not.toContain('lib/storage/backgroundWriter.ts');
  });
```

- [ ] **Step 7: 새 단언이 실제로 실패할 수 있는지 확인한다**

세 번 깨고, 빨개지는 것을 보고, 되돌린다.

1. `writer.ts` 에서 체인을 지운다 — `return (fn) => { ... }` 를 `tail` 없이 즉시 실행하는 async 함수로 바꾼다.
   기대: `lands every one of five…` · `serializes read-then-write…` · `hands each entry…` · `keeps running the rest…` **4건 red**.
2. `tail = run.catch(() => undefined)` 를 `tail = run` 으로 바꾼다.
   기대: `keeps running the rest…` · `surfaces a failing store write…` **2건 red**.
3. `writer.ts` 맨 위에 `import { storage } from '#imports';` 를 넣는다.
   기대: `lib/storage/writer.ts has no browser dependency` **red**.

세 경우 모두 확인한 뒤 원복하고 `npx vitest run tests/unit/writer.test.ts tests/unit/purity.test.ts` 가 초록인지 본다.

- [ ] **Step 8: 전체 검사와 커밋**

```bash
npm test && npx tsc --noEmit
git add lib/storage/writer.ts lib/storage/backgroundWriter.ts tests/unit/writer.test.ts tests/unit/purity.test.ts
git commit -m "feat: 배경의 모든 쓰기가 직렬화된 큐 하나를 지난다"
```

---

## Task 3: 메시지 프로토콜과 배경 핸들러

**Files:**
- Create: `lib/messaging/protocol.ts`
- Create: `tests/unit/protocol.test.ts`
- Create: `tests/unit/backgroundPatch.test.ts`
- Modify: `entrypoints/background.ts` (전체 재작성 — 아래 Step 4 에 최종 형태)
- Modify: `tests/unit/purity.test.ts` (EXPLICIT 목록)

**Interfaces:**
- Consumes: `enqueueWrite` (`@/lib/storage/backgroundWriter`, Task 2)
- Produces:
  - `interface PatchRequest { type: 'patch'; delta: Partial<AppState> }`
  - `type PatchResponse = { ok: true; state: AppState } | { ok: false; error: string }`
  - `function isPatchRequest(value: unknown): value is PatchRequest`
  - `function messageOf(error: unknown): string`
  - `async function handlePatch(message: unknown): Promise<PatchResponse>` — `entrypoints/background.ts` 의 이름 붙은 export. **절대 거부하지 않는다.** Task 4 의 클라이언트가 이 계약에 기댄다.

`handlePatch` 는 `enqueueWrite(() => message.delta)` 로 부른다 — `current` 를 쓰지 않는다. 팝업의 델타는 팝업 자신의 낙관적 스냅샷에서 나온 완성된 top-level 값이므로 여기서 다시 계산할 것이 없다. `fn(current)` 서명은 **배경 자신의 쓰기**(Task 6 의 잠금 해제)를 위한 것이다. 스펙 §9 가 "`patchState` 의 top-level 병합은 그대로다"라고 적은 자리가 정확히 여기다. 여기서 영리해지지 말 것.

- [ ] **Step 1: 프로토콜의 실패하는 테스트를 쓴다**

`tests/unit/protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isPatchRequest, messageOf } from '@/lib/messaging/protocol';

describe('isPatchRequest', () => {
  it('accepts a well-formed patch', () => {
    expect(isPatchRequest({ type: 'patch', delta: { globalPause: true } })).toBe(true);
  });

  it('accepts an empty delta — a no-op patch is still a patch, not a malformed one', () => {
    expect(isPatchRequest({ type: 'patch', delta: {} })).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'patch'],
    ['a number', 7],
    ['an array', [{ type: 'patch', delta: {} }]],
    ['the wrong type tag', { type: 'reconcile', delta: {} }],
    ['a missing delta', { type: 'patch' }],
    ['a null delta', { type: 'patch', delta: null }],
    ['an array delta — Partial<AppState> is an object, and an array would merge as indices',
      { type: 'patch', delta: ['globalPause'] }],
    ['a string delta', { type: 'patch', delta: 'globalPause' }],
  ])('rejects %s', (_label, value) => {
    expect(isPatchRequest(value)).toBe(false);
  });
});

describe('messageOf', () => {
  it('takes an Error apart to its message, not its stringification', () => {
    // `String(new Error('boom'))` is "Error: boom" — the prefix would end up
    // in the popup's status line, so the two paths are genuinely different.
    expect(messageOf(new Error('boom'))).toBe('boom');
  });

  it('stringifies a non-Error rejection — extension APIs reject with plain values', () => {
    expect(messageOf('Could not establish connection.')).toBe('Could not establish connection.');
  });

  it('never returns undefined for a thrown undefined', () => {
    expect(messageOf(undefined)).toBe('undefined');
  });
});
```

- [ ] **Step 2: 붉은지 확인한다**

```bash
npx vitest run tests/unit/protocol.test.ts
```

기대: `Failed to resolve import "@/lib/messaging/protocol"`.

- [ ] **Step 3: 프로토콜을 구현한다**

`lib/messaging/protocol.ts`:

```ts
import type { AppState } from '@/lib/model/types';

/**
 * The popup-to-background write protocol (spec §3.2). Shared by both sides so
 * the shape has exactly one definition — the Phase 2a lesson about a predicate
 * stated in four places applies to a wire format just as well.
 */
export interface PatchRequest {
  type: 'patch';
  delta: Partial<AppState>;
}

export type PatchResponse =
  | { ok: true; state: AppState }
  | { ok: false; error: string };

/**
 * Whether an arbitrary message is a patch request.
 *
 * `runtime.onMessage` is a trust boundary: any extension page, and any other
 * extension the user has installed, can put an arbitrary value here. The
 * delta is spread into AppState, so an array would merge as numeric keys and
 * a string as character indices — hence both are rejected explicitly rather
 * than falling through `typeof === 'object'`.
 */
export function isPatchRequest(value: unknown): value is PatchRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { type?: unknown; delta?: unknown };
  return (
    candidate.type === 'patch' &&
    typeof candidate.delta === 'object' &&
    candidate.delta !== null &&
    !Array.isArray(candidate.delta)
  );
}

/** Extension APIs reject with plain strings as often as with Errors. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: 배경 핸들러의 실패하는 테스트를 쓴다**

`tests/unit/backgroundPatch.test.ts`:

```ts
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePatch } from '@/entrypoints/background';
import { getState } from '@/lib/storage/state';
import * as stateModule from '@/lib/storage/state';
import { DEFAULT_STATE, createProfile } from '@/lib/model/defaults';

beforeEach(() => { fakeBrowser.reset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('handlePatch', () => {
  it('applies the delta and answers with the state that actually landed', async () => {
    const response = await handlePatch({ type: 'patch', delta: { theme: 'dark' } });

    expect(response).toEqual({ ok: true, state: { ...DEFAULT_STATE, theme: 'dark' } });
    expect(await getState()).toEqual({ ...DEFAULT_STATE, theme: 'dark' });
  });

  it('leaves top-level keys the delta does not name alone', async () => {
    await handlePatch({ type: 'patch', delta: { globalPause: true } });
    await handlePatch({ type: 'patch', delta: { theme: 'light' } });

    expect(await getState()).toEqual({ ...DEFAULT_STATE, globalPause: true, theme: 'light' });
  });

  it('serializes two patches that arrive together — both land, in arrival order', async () => {
    // The defect the queue exists to close (Phase 2a handoff §4.5), expressed
    // at the layer the popup actually reaches. Without the queue the second
    // read sees the pre-first-write state and the first profile is lost.
    const a = createProfile('A', 0);
    const b = createProfile('B', 1);

    const [first, second] = await Promise.all([
      handlePatch({ type: 'patch', delta: { profiles: [a] } }),
      handlePatch({ type: 'patch', delta: { globalPause: true } }),
    ]);

    expect(first).toEqual({ ok: true, state: { ...DEFAULT_STATE, profiles: [a] } });
    expect(second).toEqual({
      ok: true,
      state: { ...DEFAULT_STATE, profiles: [a], globalPause: true },
    });
    const stored = await getState();
    expect(stored.profiles).toEqual([a]);
    expect(stored.globalPause).toBe(true);
    expect(b.id).not.toBe(a.id); // the fixture really is two distinct profiles
  });

  it('answers ok:false rather than rejecting when the write fails', async () => {
    // Spec §3.3: the round trip exists to *remove* a silence. A handler that
    // rejected here would put the failure back where `void patchState(delta)`
    // had it — nowhere the popup can see.
    vi.spyOn(stateModule, 'setState').mockRejectedValue(new Error('storage full'));

    await expect(handlePatch({ type: 'patch', delta: { theme: 'dark' } }))
      .resolves.toEqual({ ok: false, error: 'storage full' });
  });

  it('answers ok:false for a message that is not a patch, without writing', async () => {
    const before = await getState();

    const response = await handlePatch({ type: 'something-else' });

    expect(response.ok).toBe(false);
    expect(await getState()).toEqual(before);
  });

  it('completes the write before it builds the response, so a popup that closed mid-flight still gets its edit saved', async () => {
    // Spec §3.3, second row: the write is the background's, so it lands; only
    // the place to put the answer is gone. fake-browser cannot simulate a
    // closed message port, so the testable half is the ordering — discarding
    // the response promise entirely must not discard the write.
    void handlePatch({ type: 'patch', delta: { theme: 'dark' } });

    // Give the queue a turn without holding the promise the caller dropped.
    await vi.waitFor(async () => {
      expect((await getState()).theme).toBe('dark');
    });
  });
});
```

- [ ] **Step 5: 붉은지 확인한다**

```bash
npx vitest run tests/unit/backgroundPatch.test.ts
```

기대: `handlePatch is not a function` 계열의 실패.

- [ ] **Step 6: 배경을 고친다**

`entrypoints/background.ts` 전체를 아래로 바꾼다:

```ts
import { browser } from 'wxt/browser';
import { stateItem } from '@/lib/storage/state';
import { enqueueWrite } from '@/lib/storage/backgroundWriter';
import { isPatchRequest, messageOf, type PatchResponse } from '@/lib/messaging/protocol';
import { reconcile } from '@/lib/sync/ruleSync';

/**
 * The background is the only writer (spec §3.1), so every popup edit arrives
 * here as a delta and goes through the same queue the background's own writes
 * use.
 *
 * **Never rejects.** It answers `ok: false` instead, because a rejection here
 * is a silence: it reaches the popup as an opaque transport failure with no
 * message to show, which is where `void patchState(delta)` already had it.
 *
 * The delta is applied as written rather than recomputed from `current` — see
 * spec §9's third constraint. The popup derived it from its own optimistic
 * snapshot; recomputing it here would need a merge strategy the model does not
 * have.
 */
export async function handlePatch(message: unknown): Promise<PatchResponse> {
  if (!isPatchRequest(message)) {
    return { ok: false, error: `unrecognised message: ${JSON.stringify(message)}` };
  }
  try {
    return { ok: true, state: await enqueueWrite(() => message.delta) };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

export default defineBackground(() => {
  const run = () => {
    reconcile().catch((error) => {
      console.error('[HeaderLab] reconcile failed', error);
    });
  };

  // Returning the promise is the MV3 contract for an async response. Because
  // handlePatch never rejects, a popup that closed mid-flight leaves a
  // resolved promise with nowhere to go — which the browser discards — rather
  // than an unhandled rejection in the worker.
  browser.runtime.onMessage.addListener((message) => handlePatch(message));

  // Every trigger funnels into the same idempotent reconcile.
  run();
  browser.runtime.onStartup.addListener(run);
  browser.runtime.onInstalled.addListener(run);
  browser.permissions.onAdded.addListener(run);
  browser.permissions.onRemoved.addListener(run);
  stateItem.watch(run);
});
```

- [ ] **Step 7: 초록인지 확인한다**

```bash
npx vitest run tests/unit/protocol.test.ts tests/unit/backgroundPatch.test.ts
```

기대: 두 파일 모두 통과 (13 + 6 = 19 passed).

- [ ] **Step 8: 순수성 가드에 프로토콜을 등록한다**

`tests/unit/purity.test.ts` 의 `EXPLICIT` 와 그 단언 양쪽에 `'lib/messaging/protocol.ts'` 를 추가한다 (Task 2 가 만든 세 항목 뒤에):

```ts
const EXPLICIT = [
  'lib/permissions/origins.ts',
  'lib/permissions/audit.ts',
  'lib/storage/writer.ts',
  'lib/messaging/protocol.ts',
];
```

```ts
    expect(EXPLICIT).toEqual([
      'lib/permissions/origins.ts',
      'lib/permissions/audit.ts',
      'lib/storage/writer.ts',
      'lib/messaging/protocol.ts',
    ]);
```

- [ ] **Step 9: 새 단언이 실제로 실패할 수 있는지 확인한다**

1. `handlePatch` 의 `catch` 를 지우고 `throw` 하게 만든다 → `answers ok:false rather than rejecting…` **red**.
2. `isPatchRequest` 에서 `!Array.isArray(candidate.delta)` 를 지운다 → `rejects an array delta` **red**.
3. `handlePatch` 의 `await` 를 지워 `enqueueWrite(...)` 를 기다리지 않게 한다 → `completes the write before it builds the response…` 가 아니라 `applies the delta and answers with the state that actually landed` 가 **red** (응답의 `state` 가 Promise 가 되어 타입부터 깨진다). `tsc --noEmit` 도 붉어지는지 함께 확인한다.
4. `messageOf` 를 `String(error)` 만으로 바꾼다 → `takes an Error apart to its message` **red**.

전부 확인 후 원복.

- [ ] **Step 10: 전체 검사와 커밋**

```bash
npm test && npx tsc --noEmit
git add lib/messaging/protocol.ts entrypoints/background.ts tests/unit/protocol.test.ts tests/unit/backgroundPatch.test.ts tests/unit/purity.test.ts
git commit -m "feat: 팝업의 패치가 메시지로 배경에 도착해 큐를 지난다"
```

---

## Task 4: `useAppState` 왕복 전환과 훅의 첫 테스트

**Files:**
- Create: `lib/messaging/client.ts`
- Create: `tests/unit/messagingClient.test.ts`
- Create: `tests/unit/useAppState.test.tsx`
- Create: `tests/unit/writePath.test.ts`
- Modify: `lib/storage/useAppState.ts` (전체 재작성)
- Modify: `components/StatusFoot.tsx`, `entrypoints/popup/App.tsx`

**Interfaces:**
- Consumes: `sendPatch` 가 쓰는 `PatchRequest`/`PatchResponse`/`messageOf` (Task 3), `handlePatch` 의 "절대 거부하지 않는다" 계약 (Task 3)
- Produces:
  - `async function sendPatch(delta: Partial<AppState>): Promise<PatchResponse>` (`@/lib/messaging/client`)
  - `interface AppStateHook { state: AppState | null; patch: (fn: (draft: AppState) => Partial<AppState>) => void; writeError: string | null }`
  - `function useAppState(): AppStateHook` — `patch` 의 서명은 바뀌지 않으므로 App.tsx 의 기존 호출부 전부 그대로 동작한다
  - `StatusFootProps` 에 `writeError: string | null` 추가

- [ ] **Step 1: 클라이언트의 실패하는 테스트를 쓴다**

`tests/unit/messagingClient.test.ts`:

```ts
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { browser } from 'wxt/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendPatch } from '@/lib/messaging/client';
import { DEFAULT_STATE } from '@/lib/model/defaults';

// `runtime.sendMessage` is a stub that throws with no listener, and does not
// carry a listener's return value back even with one — measured. So the round
// trip is exercised with a hand-planted spy, the same discipline Phase 2a used
// for DNR and permissions.
beforeEach(() => { fakeBrowser.reset(); });
afterEach(() => { vi.restoreAllMocks(); });

const OK = { ok: true as const, state: DEFAULT_STATE };

describe('sendPatch', () => {
  it('sends exactly one message carrying the delta, and returns the answer', async () => {
    const send = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(OK as never);

    await expect(sendPatch({ theme: 'dark' })).resolves.toEqual(OK);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'patch', delta: { theme: 'dark' } });
  });

  it('retries once when the service worker was asleep, and the retry carries the same delta', async () => {
    // Spec §3.3, first row. Chrome's wording for losing the startup race.
    const send = vi.spyOn(browser.runtime, 'sendMessage')
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockResolvedValueOnce(OK as never);

    await expect(sendPatch({ theme: 'dark' })).resolves.toEqual(OK);

    // Both halves: it retried, and it retried with the *same* request. A
    // retry that dropped the delta would satisfy "resolves ok" on its own.
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls).toEqual([
      [{ type: 'patch', delta: { theme: 'dark' } }],
      [{ type: 'patch', delta: { theme: 'dark' } }],
    ]);
  });

  it('retries exactly once, not forever', async () => {
    const send = vi.spyOn(browser.runtime, 'sendMessage')
      .mockRejectedValue(new Error('Could not establish connection.'));

    await expect(sendPatch({ theme: 'dark' }))
      .resolves.toEqual({ ok: false, error: 'Could not establish connection.' });

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failure that is not the wake race', async () => {
    // The assertion that makes the wake-race detection non-vacuous: a client
    // that retried everything would pass the two tests above and this one is
    // the only place it shows.
    const send = vi.spyOn(browser.runtime, 'sendMessage')
      .mockRejectedValue(new Error('Extension context invalidated.'));

    await expect(sendPatch({ theme: 'dark' }))
      .resolves.toEqual({ ok: false, error: 'Extension context invalidated.' });

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('turns a missing response into ok:false rather than handing undefined upward', async () => {
    // MV3 resolves with `undefined` when no listener answered. Passing that on
    // would make `response.ok` read as undefined and the popup would treat a
    // lost write as a successful one.
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(undefined as never);

    const response = await sendPatch({ theme: 'dark' });

    expect(response.ok).toBe(false);
  });

  it('never rejects, whatever the transport does', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockRejectedValue('a bare string rejection');

    await expect(sendPatch({ theme: 'dark' }))
      .resolves.toEqual({ ok: false, error: 'a bare string rejection' });
  });
});
```

- [ ] **Step 2: 붉은지 확인한다**

```bash
npx vitest run tests/unit/messagingClient.test.ts
```

기대: `Failed to resolve import "@/lib/messaging/client"`.

- [ ] **Step 3: 클라이언트를 구현한다**

`lib/messaging/client.ts`:

```ts
import { browser } from 'wxt/browser';
import { messageOf, type PatchRequest, type PatchResponse } from '@/lib/messaging/protocol';
import type { AppState } from '@/lib/model/types';

/**
 * Chrome's wording when `sendMessage` loses the race against the service
 * worker starting up. Matched on the message rather than an error class
 * because the extension APIs reject with plain strings as often as Errors.
 */
const WAKE_RACE = /could not establish connection|receiving end does not exist/i;

async function send(request: PatchRequest): Promise<PatchResponse> {
  const response = (await browser.runtime.sendMessage(request)) as PatchResponse | undefined;
  // MV3 resolves with `undefined` when nothing answered. Handing that upward
  // would let `response.ok` read as undefined and a lost write look successful.
  if (response === undefined) throw new Error('the background did not answer');
  return response;
}

/**
 * Delivers one patch to the background and returns its answer (spec §3.2).
 *
 * **Never rejects.** Every failure comes back as `{ ok: false }` with a real
 * message, because the whole point of the round trip is that a rejected write
 * stops being silent (spec §3.3). A thrown transport error would put the
 * silence back.
 *
 * `sendMessage` wakes a sleeping worker on its own; only the startup race
 * needs a retry, and exactly one — a wake that did not take on the second
 * attempt is a real failure, and retrying past that turns a broken worker into
 * an unbounded loop with a stuck UI.
 */
export async function sendPatch(delta: Partial<AppState>): Promise<PatchResponse> {
  const request: PatchRequest = { type: 'patch', delta };
  try {
    return await send(request);
  } catch (error) {
    if (!WAKE_RACE.test(messageOf(error))) return { ok: false, error: messageOf(error) };
    try {
      return await send(request);
    } catch (retryError) {
      return { ok: false, error: messageOf(retryError) };
    }
  }
}
```

- [ ] **Step 4: 초록인지 확인한다**

```bash
npx vitest run tests/unit/messagingClient.test.ts
```

기대: 6 passed.

- [ ] **Step 5: 훅의 실패하는 테스트를 쓴다**

`tests/unit/useAppState.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppState } from '@/lib/storage/useAppState';
import * as client from '@/lib/messaging/client';
import * as stateModule from '@/lib/storage/state';
import { DEFAULT_STATE, createProfile } from '@/lib/model/defaults';
import type { AppState } from '@/lib/model/types';

function seeded(): AppState {
  return { ...DEFAULT_STATE, profiles: [{ ...createProfile('Local', 0), id: 'p1' }] };
}

async function seed(state: AppState) {
  await fakeBrowser.storage.local.set({ state, state$: { v: 1 } });
}

beforeEach(() => { fakeBrowser.reset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('useAppState', () => {
  it('loads the stored state on mount', async () => {
    const state = seeded();
    await seed(state);

    const { result } = renderHook(() => useAppState());

    await waitFor(() => expect(result.current.state).toEqual(state));
  });

  it('shows the patched value immediately, before the round trip resolves', async () => {
    // Typing responsiveness is a requirement of this UI (2b §5.3). The
    // optimistic update is what makes it, so it is pinned separately from the
    // round trip: `sendPatch` here never settles.
    await seed(seeded());
    vi.spyOn(client, 'sendPatch').mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAppState());
    await waitFor(() => expect(result.current.state).not.toBeNull());

    act(() => { result.current.patch(() => ({ theme: 'dark' })); });

    expect(result.current.state?.theme).toBe('dark');
    expect(result.current.writeError).toBeNull();
  });

  it('sends the delta, not the whole state', async () => {
    // A hook that sent `{...current, ...delta}` would still land the right
    // value and pass every other test here. The wire shape matters: the
    // background merges what it is given at the top level, so a whole-state
    // message would clobber a key another writer had just changed.
    await seed(seeded());
    const sendPatch = vi.spyOn(client, 'sendPatch').mockResolvedValue({ ok: true, state: seeded() });
    const { result } = renderHook(() => useAppState());
    await waitFor(() => expect(result.current.state).not.toBeNull());

    act(() => { result.current.patch(() => ({ theme: 'dark' })); });

    await waitFor(() => expect(sendPatch).toHaveBeenCalledTimes(1));
    expect(sendPatch).toHaveBeenCalledWith({ theme: 'dark' });
  });

  it('gives the second patch the first patch\'s optimistic value, not the pre-patch one', async () => {
    // Two handlers can fire before a render lands. Reading React state through
    // a closure would hand the second patch the state as of the first render
    // and lose the first delta — the defect Phase 2a handoff §4.5 recorded,
    // now on the popup side of the wire.
    await seed(seeded());
    const sendPatch = vi.spyOn(client, 'sendPatch').mockResolvedValue({ ok: true, state: seeded() });
    const { result } = renderHook(() => useAppState());
    await waitFor(() => expect(result.current.state).not.toBeNull());

    act(() => {
      result.current.patch((s) => ({ profiles: [...s.profiles, { ...createProfile('B', 1), id: 'p2' }] }));
      result.current.patch((s) => ({ profiles: [...s.profiles, { ...createProfile('C', 2), id: 'p3' }] }));
    });

    expect(result.current.state?.profiles.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(sendPatch.mock.calls.map(([delta]) => (delta.profiles ?? []).map((p) => p.id))).toEqual([
      ['p1', 'p2'],
      ['p1', 'p2', 'p3'],
    ]);
  });

  it('reverts the optimistic value to what is stored, and says why, when the write is refused', async () => {
    // Spec §3.3: this is the silence the round trip exists to remove. Both
    // halves are asserted — a hook that only set writeError would leave the
    // wrong value on screen under a correct-looking message.
    const stored = seeded();
    await seed(stored);
    vi.spyOn(client, 'sendPatch').mockResolvedValue({ ok: false, error: 'storage full' });
    const { result } = renderHook(() => useAppState());
    await waitFor(() => expect(result.current.state).not.toBeNull());

    act(() => { result.current.patch(() => ({ theme: 'dark' })); });
    expect(result.current.state?.theme).toBe('dark'); // optimistic, briefly

    await waitFor(() => expect(result.current.writeError).toBe('storage full'));
    expect(result.current.state).toEqual(stored);
  });

  it('clears a previous write error once a later write succeeds', async () => {
    await seed(seeded());
    const sendPatch = vi.spyOn(client, 'sendPatch').mockResolvedValue({ ok: false, error: 'storage full' });
    const { result } = renderHook(() => useAppState());
    await waitFor(() => expect(result.current.state).not.toBeNull());

    act(() => { result.current.patch(() => ({ theme: 'dark' })); });
    await waitFor(() => expect(result.current.writeError).toBe('storage full'));

    sendPatch.mockResolvedValue({ ok: true, state: seeded() });
    act(() => { result.current.patch(() => ({ theme: 'light' })); });

    await waitFor(() => expect(result.current.writeError).toBeNull());
  });

  it('propagates a write the background made on its own', async () => {
    // The watcher stays, so the tab-lock release the background performs
    // reaches the popup without the popup asking (spec §3.4).
    await seed(seeded());
    const { result } = renderHook(() => useAppState());
    await waitFor(() => expect(result.current.state).not.toBeNull());

    const released = { ...seeded(), globalPause: true };
    await act(async () => { await seed(released); });

    await waitFor(() => expect(result.current.state?.globalPause).toBe(true));
  });

  it('does nothing at all once the popup has closed mid-round-trip', async () => {
    // Spec §3.3, second row. The write is the background's, so it lands
    // either way — this pins that the *popup* side gives up cleanly rather
    // than reaching back into storage for a component that is gone.
    await seed(seeded());
    let refuse: (r: { ok: false; error: string }) => void = () => {};
    vi.spyOn(client, 'sendPatch').mockReturnValue(
      new Promise((resolve) => { refuse = resolve as typeof refuse; }),
    );
    const getState = vi.spyOn(stateModule, 'getState');
    const { result, unmount } = renderHook(() => useAppState());
    await waitFor(() => expect(result.current.state).not.toBeNull());

    act(() => { result.current.patch(() => ({ theme: 'dark' })); });
    const readsBeforeUnmount = getState.mock.calls.length;
    unmount();
    refuse({ ok: false, error: 'storage full' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The revert path re-reads storage; after unmount it must not run at all.
    expect(getState).toHaveBeenCalledTimes(readsBeforeUnmount);
  });
});
```

- [ ] **Step 6: 붉은지 확인한다**

```bash
npx vitest run tests/unit/useAppState.test.tsx
```

기대: `writeError` 가 없어 여러 건 실패.

- [ ] **Step 7: 훅을 다시 쓴다**

`lib/storage/useAppState.ts` 전체를 아래로 바꾼다:

```ts
import { useEffect, useRef, useState } from 'react';
import { getState, stateItem } from '@/lib/storage/state';
import { sendPatch } from '@/lib/messaging/client';
import type { AppState } from '@/lib/model/types';

export interface AppStateHook {
  state: AppState | null;
  patch: (fn: (draft: AppState) => Partial<AppState>) => void;
  /** The last refused write's real message, or null. */
  writeError: string | null;
}

/**
 * The popup's view of application state.
 *
 * **The popup does not write storage.** It sends the delta to the background,
 * which applies it on a serialized queue (spec §3.1). `patch` keeps the
 * optimistic local update — typing responsiveness is a requirement of this UI
 * (2b §5.3) — and the round trip's answer either confirms it or takes it back.
 *
 * `stateItem.watch` stays, so a write the background made on its own (a tab
 * lock released because its tab closed) reaches the popup unasked.
 */
export function useAppState(): AppStateHook {
  const [state, setLocal] = useState<AppState | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  // Two reasons this is a ref and not just React state. Two handlers can fire
  // before a render lands, and the second must build its delta on the first
  // one's optimistic value — reading `state` through a closure would hand it
  // the pre-patch value and drop the first delta, which is exactly the loss
  // Phase 2a handoff §4.5 recorded. And the send must not sit inside a
  // setState updater: React invokes those twice under StrictMode, which
  // entrypoints/popup/main.tsx turns on, and the patch would be sent twice.
  const stateRef = useRef<AppState | null>(null);
  const mountedRef = useRef(true);

  const adopt = (next: AppState) => {
    stateRef.current = next;
    setLocal(next);
  };

  useEffect(() => {
    mountedRef.current = true;
    getState().then((stored) => { if (mountedRef.current) adopt(stored); });
    const unwatch = stateItem.watch((next) => { if (mountedRef.current) adopt(next); });
    return () => {
      mountedRef.current = false;
      unwatch();
    };
  }, []);

  const deliver = async (delta: Partial<AppState>) => {
    const response = await sendPatch(delta);
    // The popup can close mid-round-trip. The write belongs to the background
    // and lands either way; only the place to put the answer is gone.
    if (!mountedRef.current) return;
    if (response.ok) {
      setWriteError(null);
      return;
    }
    // Reverted to what is *stored*, not to the pre-patch snapshot: by the time
    // a refusal comes back the background may have written something else, and
    // restoring a stale snapshot would replace one wrong value with another.
    setWriteError(response.error);
    const stored = await getState();
    if (mountedRef.current) adopt(stored);
  };

  const patch = (fn: (draft: AppState) => Partial<AppState>) => {
    const current = stateRef.current;
    if (!current) return;
    const delta = fn(current);
    adopt({ ...current, ...delta });
    void deliver(delta);
  };

  return { state, patch, writeError };
}
```

- [ ] **Step 8: 초록인지 확인한다**

```bash
npx vitest run tests/unit/useAppState.test.tsx
```

기대: 8 passed.

- [ ] **Step 9: 실패를 화면에 띄운다**

`components/StatusFoot.tsx`:

```tsx
export interface StatusFootProps {
  applying: number;
  total: number;
  off: number;
  needsAccess: number;
  /** The real text of the last failed reconcile, from session storage. */
  lastError: string | null;
  /** The real text of the last save this popup could not complete. */
  writeError: string | null;
}

export function StatusFoot({ applying, total, off, needsAccess, lastError, writeError }: StatusFootProps) {
  // The popup's own refused write wins the slot: it is about the edit the user
  // just made, where a reconcile failure is about the background's last pass.
  // Showing the older one over the newer would be the same silence spec §3.3
  // set out to remove, one layer up.
  const error = writeError ?? lastError;
  return (
    <div className="hl-foot" data-testid="foot">
      {error !== null ? (
        <span className="hl-footerr">{error}</span>
      ) : (
        <>
          <span className="hl-fdot" />
          <span>
            <b>{applying}</b> of {total} rules applying
          </span>
          <span className="hl-sep">·</span>
          <span>{off} off</span>
        </>
      )}
      {needsAccess > 0 && (
        <span className="hl-pendtag" data-testid="needs-access">
          {needsAccess} need access
        </span>
      )}
    </div>
  );
}
```

`entrypoints/popup/App.tsx` 에서:

```tsx
  const { state, patch, writeError } = useAppState();
```

그리고 `<StatusFoot ... />` 에 `writeError={writeError}` 를 넘긴다.

- [ ] **Step 9b: `App.test.tsx` 를 왕복 위에 다시 세운다**

**이 스텝을 건너뛰면 기존 6개 상호작용 테스트가 전부 붉어진다.** `App.test.tsx` 는 클릭한 결과가 저장소에 도달하는지를 보는데, 팝업은 이제 쓰지 않는다 — 그리고 fake-browser 의 `runtime.sendMessage` 는 리스너가 없으면 `No listeners available` 로 **던진다**(측정함). 그러면 `sendPatch` 가 `ok:false` 를 돌려주고 훅이 낙관적 값을 **되돌려** 클릭이 아무 일도 하지 않은 것처럼 보인다.

전송 계층만 짧게 잇는다. `handlePatch` 는 진짜 큐를 지나 진짜 저장소에 쓰므로, 이 다리는 테스트를 약화시키지 않고 fake-browser 가 흉내내지 못하는 한 조각만 대신한다.

`tests/unit/App.test.tsx` 의 임포트에 더한다:

```tsx
import * as client from '@/lib/messaging/client';
import { handlePatch } from '@/entrypoints/background';
```

`beforeEach` 를 넓힌다:

```tsx
beforeEach(() => {
  fakeBrowser.reset();
  // permissions.* are throwing stubs in fake-browser; the popup probes on mount.
  vi.spyOn(probe, 'probeGrants').mockResolvedValue([{ domain: 'api.example.com', granted: true }]);
  // fake-browser's runtime.sendMessage throws without a listener and drops a
  // listener's return value even with one, so the round trip cannot be
  // simulated through it (measured). Only the transport is short-circuited:
  // handlePatch is the real handler, running the real queue against real
  // storage, so every assertion below still describes the shipped path.
  vi.spyOn(client, 'sendPatch').mockImplementation((delta) => handlePatch({ type: 'patch', delta }));
});
```

`writes the toggle through to storage` 테스트는 한 글자도 바뀌지 않고 계속 통과해야 한다 — 그것이 이 다리가 옳다는 증거다. 통과하지 않으면 다리가 아니라 구현이 틀린 것이다.

- [ ] **Step 10: 팝업이 저장소에 쓰지 않는다는 가드를 만든다**

`tests/unit/writePath.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every file that runs in the popup. Directories are walked rather than
 * listed, so a new component is covered for free — the same reasoning
 * purity.test.ts gives for auto-discovering `lib/compile/`.
 *
 * `lib/storage/useAppState.ts` is listed by hand: it lives beside the very
 * adapters it must not call, so no directory rule reaches it.
 */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const POPUP_FILES = [
  ...walk('entrypoints/popup'),
  ...walk('components'),
  'lib/storage/useAppState.ts',
];

/**
 * The write functions the popup must reach only through the background
 * (spec §3.2 and §3.5). Reads are untouched: `getState`, `stateItem` and
 * `getSyncStatus` are how the popup learns anything at all.
 *
 * These are bare names, so a local binding that happens to be called
 * `setState` or `setSyncStatus` — a useState setter, say — trips the guard
 * too. That is a false positive with a one-word fix (useAppState.ts already
 * calls its own setter `setLocal`), and it is the right trade: matching the
 * import statement instead would miss a re-export, and this file is the only
 * thing standing between the popup and a second writer.
 */
const FORBIDDEN = [
  /\bsetState\b/,
  /\bpatchState\b/,
  /\bsetSyncStatus\b/,
  /from\s+['"]@\/lib\/storage\/writer['"]/,
  /from\s+['"]@\/lib\/storage\/backgroundWriter['"]/,
];

describe('the popup is not a writer', () => {
  it('found the popup files it claims to guard', () => {
    // A walk that silently returned nothing would make every assertion below
    // vacuous, which is precisely the shape Phase 2b kept shipping.
    expect(POPUP_FILES).toEqual(expect.arrayContaining([
      'entrypoints/popup/App.tsx',
      'components/FilterBlock.tsx',
      'components/StatusFoot.tsx',
      'lib/storage/useAppState.ts',
    ]));
  });

  it.each(POPUP_FILES)('%s does not write storage directly', (path) => {
    const source = readFileSync(path, 'utf8');
    for (const pattern of FORBIDDEN) {
      expect(source, `${path} matched ${pattern}`).not.toMatch(pattern);
    }
  });

  it('still allows the reads the popup depends on', () => {
    // The guard would be trivially satisfiable by a popup that read nothing.
    const hook = readFileSync('lib/storage/useAppState.ts', 'utf8');
    expect(hook).toMatch(/\bgetState\b/);
    expect(hook).toMatch(/\bstateItem\b/);
  });
});
```

- [ ] **Step 11: 초록인지 확인한다**

```bash
npx vitest run tests/unit/writePath.test.ts
```

기대: 전부 통과. 만약 `App.tsx` 가 아직 `patchState` 를 임포트하고 있으면 여기서 잡힌다 — 그것이 이 가드의 목적이다.

- [ ] **Step 12: 새 단언이 실제로 실패할 수 있는지 확인한다**

1. `useAppState.ts` 의 `deliver` 에서 `setWriteError(response.error)` 와 `adopt(stored)` 를 지운다 → `reverts the optimistic value…` **red**.
2. `adopt(stored)` 만 지운다 → 같은 테스트가 여전히 **red** (두 반쪽을 각각 단언했으므로).
3. `patch` 를 `const current = state;` 로 바꾼다(ref 대신 렌더 클로저) → `gives the second patch the first patch's optimistic value…` **red**.
4. `deliver` 의 `if (!mountedRef.current) return;` 를 지운다 → `does nothing at all once the popup has closed…` **red**.
5. `App.tsx` 에 `import { patchState } from '@/lib/storage/state';` 를 한 줄 넣는다 → `entrypoints/popup/App.tsx does not write storage directly` **red**.
6. `writePath.test.ts` 의 `walk('components')` 를 `[]` 로 바꾼다 → `found the popup files it claims to guard` **red**.

전부 확인 후 원복.

- [ ] **Step 13: 전체 검사와 커밋**

```bash
npm test && npx tsc --noEmit
git add lib/messaging/client.ts lib/storage/useAppState.ts components/StatusFoot.tsx entrypoints/popup/App.tsx tests/unit/messagingClient.test.ts tests/unit/useAppState.test.tsx tests/unit/writePath.test.ts
git commit -m "feat: 거부된 쓰기가 낙관적 값을 되돌리고 이유를 말한다"
```

---

## Task 5: `ruleCount` 분리

**Files:**
- Modify: `lib/storage/session.ts`
- Modify: `lib/sync/ruleSync.ts:80-91`
- Modify: `components/StatusFoot.tsx`, `entrypoints/popup/App.tsx`
- Modify: `tests/unit/session.test.ts`, `tests/unit/ruleSync.test.ts`

**Interfaces:**
- Consumes: `StatusFootProps` (Task 4 가 `writeError` 를 더한 상태)
- Produces:
  - `interface RuleCount { always: number; tabLocked: number }`
  - `interface SyncStatus { lastError: string | null; ruleCount: RuleCount }`
  - `StatusFootProps` 에 `ruleCount: RuleCount` 추가

UI 를 쓰기 전에 세션 저장소의 형태를 먼저 바꾼다(스펙 §5.3). `always` 는 dynamic 룰셋, `tabLocked` 는 session 룰셋이다 — `allocate()` 가 잠긴 프로필만 session 으로 보내므로(`priority.ts:36`) 그 대응은 정의상 정확하다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/session.test.ts` 를 아래로 바꾼다:

```ts
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { getSyncStatus, setSyncStatus } from '@/lib/storage/session';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('sync status', () => {
  it('starts clean, with both counts at zero', () => {
    return expect(getSyncStatus()).resolves.toEqual({
      lastError: null,
      ruleCount: { always: 0, tabLocked: 0 },
    });
  });

  it('round-trips a failure message', async () => {
    await setSyncStatus({ lastError: 'Rule 3 is invalid', ruleCount: { always: 0, tabLocked: 0 } });
    expect((await getSyncStatus()).lastError).toBe('Rule 3 is invalid');
  });

  it('keeps the two counts apart', async () => {
    // Distinct values, not 1 and 1: a status that stored one number and
    // mirrored it into both fields would pass an equal-valued fixture.
    await setSyncStatus({ lastError: null, ruleCount: { always: 4, tabLocked: 2 } });
    expect(await getSyncStatus()).toEqual({
      lastError: null,
      ruleCount: { always: 4, tabLocked: 2 },
    });
  });

  it('clears the message on a later success', async () => {
    await setSyncStatus({ lastError: 'boom', ruleCount: { always: 0, tabLocked: 0 } });
    await setSyncStatus({ lastError: null, ruleCount: { always: 4, tabLocked: 0 } });
    expect(await getSyncStatus()).toEqual({
      lastError: null,
      ruleCount: { always: 4, tabLocked: 0 },
    });
  });

  it('reads a pre-split numeric ruleCount as zeroes instead of leaking it to the UI', async () => {
    // Session storage survives an extension update inside one browser session,
    // so the previous shape is genuinely reachable. `{applying} of {total}` is
    // built from compile(), but the foot renders ruleCount.always directly —
    // an unnormalized number would render as "Always on undefined".
    await fakeBrowser.storage.session.set({ syncStatus: { lastError: 'boom', ruleCount: 7 } });

    expect(await getSyncStatus()).toEqual({
      lastError: 'boom',
      ruleCount: { always: 0, tabLocked: 0 },
    });
  });

  it('writes to the session area, not local — that choice is why this module exists', async () => {
    // Every other test here round-trips through this module's own functions, so
    // they pass identically whether the key is `session:` or `local:`. Only
    // reading the areas directly can tell them apart.
    //
    // The area is load-bearing: a failure message describes rules that no longer
    // exist after a browser restart, so persisting it would show the user a stale
    // error about a rule set that was rebuilt from scratch. fake-browser cannot
    // simulate that clearing, but it does route by area — which is the part a
    // regression would break.
    await setSyncStatus({ lastError: 'boom', ruleCount: { always: 0, tabLocked: 0 } });

    expect(await fakeBrowser.storage.session.get(null)).toEqual({
      syncStatus: { lastError: 'boom', ruleCount: { always: 0, tabLocked: 0 } },
    });
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });
});
```

- [ ] **Step 2: 붉은지 확인한다**

```bash
npx vitest run tests/unit/session.test.ts
```

기대: `keeps the two counts apart` 와 `reads a pre-split numeric ruleCount…` 를 포함해 여러 건 red, `tsc` 도 붉다.

- [ ] **Step 3: 세션 모듈을 고친다**

`lib/storage/session.ts`:

```ts
import { storage } from '#imports';

/**
 * Rules the last successful reconcile registered, split by what the user has
 * to know about them (spec §5.3). `always` is the dynamic ruleset and
 * `tabLocked` the session one; lib/compile/priority.ts routes a profile to the
 * session ruleset exactly when its tab lock is live, so the correspondence is
 * definitional rather than a convention two files have to keep.
 */
export interface RuleCount {
  always: number;
  tabLocked: number;
}

/**
 * What the last reconcile did. Session-scoped on purpose: a failure message
 * from a previous browser session describes rules that no longer exist.
 *
 * WXT requires an area prefix on every key.
 */
export interface SyncStatus {
  /** Null when the last reconcile succeeded. */
  lastError: string | null;
  ruleCount: RuleCount;
}

const DEFAULT_STATUS: SyncStatus = {
  lastError: null,
  ruleCount: { always: 0, tabLocked: 0 },
};

export const syncStatusItem = storage.defineItem<SyncStatus>('session:syncStatus', {
  fallback: DEFAULT_STATUS,
});

/**
 * Session storage outlives an extension update within one browser session, so
 * a value written by the pre-split build is reachable. `ruleCount` used to be
 * a plain number and the foot now reads two fields off it — an unnormalized
 * value renders as "Always on undefined", which is the class of silent
 * nonsense getState() already refuses for local storage.
 */
function normalizeRuleCount(value: unknown): RuleCount {
  if (typeof value !== 'object' || value === null) return { always: 0, tabLocked: 0 };
  const candidate = value as { always?: unknown; tabLocked?: unknown };
  return {
    always: typeof candidate.always === 'number' ? candidate.always : 0,
    tabLocked: typeof candidate.tabLocked === 'number' ? candidate.tabLocked : 0,
  };
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const stored = await syncStatusItem.getValue();
  if (!stored) return DEFAULT_STATUS;
  return { lastError: stored.lastError ?? null, ruleCount: normalizeRuleCount(stored.ruleCount) };
}

export async function setSyncStatus(status: SyncStatus): Promise<void> {
  await syncStatusItem.setValue(status);
}
```

- [ ] **Step 4: `ruleSync` 를 고친다**

`lib/sync/ruleSync.ts` 의 `reconcile()` 안 두 `recordStatus` 호출을 바꾼다:

```ts
        } catch (error) {
          await recordStatus({
            lastError: error instanceof Error ? error.message : String(error),
            ruleCount: { always: 0, tabLocked: 0 },
          });
          // Recording is a side record — the failure still propagates
          // exactly as before, console log and all (see background.ts).
          throw error;
        }
        await recordStatus({
          lastError: null,
          // Split at the source rather than summed and split later: `dynamic`
          // and `session` are already the two things the user is being told
          // apart, because priority.ts routes a live tab lock to `session`.
          ruleCount: { always: result.dynamic.length, tabLocked: result.session.length },
        });
```

- [ ] **Step 5: `ruleSync` 테스트를 고친다**

`tests/unit/ruleSync.test.ts` 에서 두 곳을 바꾼다.

`records the failure message where the popup can read it` 의 마지막 단언:

```ts
    // A failed reconcile registered nothing; the previous rule count (if
    // any) must not linger and be mistaken for a successful sync.
    expect(status.ruleCount).toEqual({ always: 0, tabLocked: 0 });
```

`clears a previous failure once a reconcile succeeds…` 의 준비와 단언:

```ts
    await sessionModule.setSyncStatus({ lastError: 'boom', ruleCount: { always: 0, tabLocked: 0 } });

    await reconcile();

    const status = await sessionModule.getSyncStatus();
    expect(status.lastError).toBeNull();
    // Pinned to the fixture's actual output (1 enabled, unlocked profile => 1
    // dynamic rule and 0 session rules), not just "truthy". Both halves: a
    // recorder that put the total in `always` would pass on the first field
    // alone as long as nothing was locked.
    expect(status.ruleCount).toEqual({
      always: compile(state).dynamic.length,
      tabLocked: compile(state).session.length,
    });
    expect(status.ruleCount).toEqual({ always: 1, tabLocked: 0 });
```

그리고 **잠긴 프로필이 `tabLocked` 로 세어지는지**를 보는 테스트를 `reconcile` describe 블록 끝에 새로 넣는다 — 이것이 없으면 위 단언은 `tabLocked` 가 항상 0 인 구현으로도 통과한다:

```ts
  it('counts a tab-locked profile under tabLocked, not always', async () => {
    // The `always: 1, tabLocked: 0` assertion above passes against a recorder
    // that hardcodes tabLocked to 0. Only a fixture that actually produces a
    // session rule can tell them apart.
    const locked = appState('X-Locked');
    locked.profiles[0]!.tabLock = { enabled: true, tabId: 42, tabTitle: 'Echo' };
    vi.spyOn(stateModule, 'getState').mockResolvedValue(locked);

    await reconcile();

    expect((await sessionModule.getSyncStatus()).ruleCount).toEqual({ always: 0, tabLocked: 1 });
  });
```

- [ ] **Step 6: 상태 줄에 두 수를 보인다**

`components/StatusFoot.tsx`:

```tsx
import type { RuleCount } from '@/lib/storage/session';

export interface StatusFootProps {
  applying: number;
  total: number;
  off: number;
  needsAccess: number;
  /** The real text of the last failed reconcile, from session storage. */
  lastError: string | null;
  /** The real text of the last save this popup could not complete. */
  writeError: string | null;
  /** Rules the background actually has registered, split by scope. */
  ruleCount: RuleCount;
}

export function StatusFoot({
  applying, total, off, needsAccess, lastError, writeError, ruleCount,
}: StatusFootProps) {
  // The popup's own refused write wins the slot: it is about the edit the user
  // just made, where a reconcile failure is about the background's last pass.
  const error = writeError ?? lastError;
  return (
    <div className="hl-foot" data-testid="foot">
      {error !== null ? (
        <span className="hl-footerr">{error}</span>
      ) : (
        <>
          <span className="hl-fdot" />
          <span>
            <b>{applying}</b> of {total} rules applying
          </span>
          <span className="hl-sep">·</span>
          <span>{off} off</span>
          <span className="hl-sep">·</span>
          {/* Registered rules, which is a different question from the one on
              the left: that count is this profile's rows, this one is every
              profile's compiled output. Split because a tab-locked rule
              applies somewhere the user cannot see from here. */}
          <span data-testid="scope-counts">
            Always on {ruleCount.always} · Tab-locked {ruleCount.tabLocked}
          </span>
        </>
      )}
      {needsAccess > 0 && (
        <span className="hl-pendtag" data-testid="needs-access">
          {needsAccess} need access
        </span>
      )}
    </div>
  );
}
```

`entrypoints/popup/App.tsx` 에서 `lastError` 상태를 `syncStatus` 전체로 넓힌다:

```tsx
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    lastError: null,
    ruleCount: { always: 0, tabLocked: 0 },
  });
```

기존 효과를 바꾼다:

```tsx
  useEffect(() => {
    getSyncStatus()
      .then(setSyncStatus)
      .catch(() => setSyncStatus({ lastError: null, ruleCount: { always: 0, tabLocked: 0 } }));
  }, [state]);
```

임포트에 `import { getSyncStatus, type SyncStatus } from '@/lib/storage/session';` 를 쓰고, `<StatusFoot ... lastError={syncStatus.lastError} ruleCount={syncStatus.ruleCount} />` 로 넘긴다. **로컬 setter 이름이 임포트한 `setSyncStatus` 와 충돌하지 않는지 확인한다** — `writePath.test.ts` 의 `/\bsetSyncStatus\b/` 가드가 App.tsx 에서 그 이름을 잡으므로, 로컬 setter 는 반드시 다른 이름이어야 한다. 위처럼 `useState` 의 두 번째 요소를 `setSyncStatus` 로 이름 붙이면 **가드가 붉어진다.** 아래 이름을 쓴다:

```tsx
  const [syncStatus, setStatus] = useState<SyncStatus>({
    lastError: null,
    ruleCount: { always: 0, tabLocked: 0 },
  });

  useEffect(() => {
    getSyncStatus()
      .then(setStatus)
      .catch(() => setStatus({ lastError: null, ruleCount: { always: 0, tabLocked: 0 } }));
  }, [state]);
```

- [ ] **Step 7: 초록인지 확인한다**

```bash
npx vitest run tests/unit/session.test.ts tests/unit/ruleSync.test.ts tests/unit/writePath.test.ts && npx tsc --noEmit
```

기대: 전부 통과, `tsc` 0.

- [ ] **Step 8: App 층에 두 수가 실제로 뜨는지 못 박는다**

`tests/unit/App.test.tsx` 의 `describe('App')` 끝에 넣는다:

```tsx
  it('shows the registered rule counts split by scope, from session storage', async () => {
    // Distinct values so a foot that rendered one number twice, or read the
    // wrong field, cannot pass. Seeded through the session area directly —
    // the popup is not allowed to write it (spec §3.5).
    await fakeBrowser.storage.session.set({
      syncStatus: { lastError: null, ruleCount: { always: 3, tabLocked: 1 } },
    });
    await seed(stateWith());
    render(<App />);

    const counts = await screen.findByTestId('scope-counts');
    expect(counts.textContent).toBe('Always on 3 · Tab-locked 1');
  });
```

- [ ] **Step 9: 새 단언이 실제로 실패할 수 있는지 확인한다**

1. `ruleSync.ts` 의 기록을 `{ always: result.dynamic.length + result.session.length, tabLocked: 0 }` 로 바꾼다 → `counts a tab-locked profile under tabLocked, not always` **red**.
2. `normalizeRuleCount` 을 지우고 `stored.ruleCount` 를 그대로 반환한다 → `reads a pre-split numeric ruleCount as zeroes…` **red**.
3. `StatusFoot` 에서 `Tab-locked {ruleCount.tabLocked}` 를 `Tab-locked {ruleCount.always}` 로 바꾼다 → `shows the registered rule counts split by scope…` **red**.

전부 확인 후 원복.

- [ ] **Step 10: 전체 검사와 커밋**

```bash
npm test && npx tsc --noEmit
git add lib/storage/session.ts lib/sync/ruleSync.ts components/StatusFoot.tsx entrypoints/popup/App.tsx tests/unit/session.test.ts tests/unit/ruleSync.test.ts tests/unit/App.test.tsx
git commit -m "feat: 상태 줄이 항상 켜짐과 탭 고정을 따로 센다"
```

---

## Task 6: 탭 잠금 생명주기

**Files:**
- Create: `lib/tabs/lockLifecycle.ts`, `lib/tabs/tabProbe.ts`, `lib/view/staleLocks.ts`
- Create: `tests/unit/lockLifecycle.test.ts`, `tests/unit/tabProbe.test.ts`, `tests/unit/staleLocks.test.ts`, `tests/unit/backgroundTabLock.test.ts`
- Modify: `lib/model/types.ts` (`StaleLock` 추가)
- Modify: `lib/storage/session.ts` (`staleLocksItem` 추가)
- Modify: `entrypoints/background.ts`, `entrypoints/popup/App.tsx`
- Modify: `tests/unit/purity.test.ts`

**Interfaces:**
- Consumes: `enqueueWrite` (Task 2), `getSyncStatus` 를 읽는 App 의 효과 (Task 5)
- Produces:
  - `interface StaleLock { profileId: string; tabTitle: string | null }` (`@/lib/model/types`)
  - `interface StaleLockRelease extends StaleLock { tabId: number }` (`@/lib/tabs/lockLifecycle`)
  - `function staleLocks(profiles: readonly Profile[], liveTabIds: ReadonlySet<number>): StaleLockRelease[]`
  - `function releaseLocks(profiles: readonly Profile[], profileIds: ReadonlySet<string>): Profile[]`
  - `async function isTabAlive(tabId: number): Promise<boolean>` (`@/lib/tabs/tabProbe`)
  - `function staleLockDiagnostics(locks: readonly StaleLock[], profiles: readonly Profile[]): Diagnostic[]` (`@/lib/view/staleLocks`)
  - `async function sweepTabLocks(): Promise<void>` · `async function releaseLocksForTab(closedTabId: number): Promise<void>` — `entrypoints/background.ts` 의 이름 붙은 export
  - `getStaleLocks` · `recordStaleLocks` (`@/lib/storage/session`)

### 이 태스크가 내리는 설계 판단 두 개

**1. 해제는 세션에 흔적을 남긴다.** `tab-lock-stale` 은 `compile()` 이 만들 수 없다 — 스윕이 잠금을 해제하고 나면 `AppState` 에는 알릴 것이 남지 않기 때문이다. `tabLock.enabled` 를 켠 채 `tabId` 만 비우는 안은 채택하지 않는다: `priority.ts:36` 이 그것을 "잠기지 않음"으로 읽어 dynamic 룰로 내보내고, 한 탭에만 적용되던 프로필이 **모든 매칭 사이트로 조용히 넓어진다.** 조용한 범위 축소보다 나쁜, 조용한 범위 확대다. 그래서 해제 사실은 `session:staleTabLocks` 에 기록하고 팝업이 그것을 진단으로 그린다. 세션 영역인 이유는 `syncStatus` 와 같다 — 브라우저를 다시 켜면 사라져야 할 사실이다.

**2. 팝업은 그 기록을 지우지 않는다.** 사용자가 잠금을 다시 켜면 진단이 사라져야 하는데, 팝업이 세션 저장소를 쓰면 스펙 §3.5 가 막은 두 번째 기록자가 다시 생긴다. 대신 `staleLockDiagnostics` 가 **`tabLock.enabled` 가 다시 켜진 프로필을 건너뛴다** — 표시가 저장된 것이 아니라 파생된 것이므로 지울 필요 자체가 없다.

**알려진 한계(닫지 않는다):** `recordStaleLocks` 는 읽고-쓰는 배경 전용 함수이고 큐를 지나지 않는다. `onRemoved` 두 개가 겹치면 알림 하나가 유실될 수 있다. **해제 자체는 큐를 지나므로 유실되지 않는다** — 잃는 것은 안전과 무관한 알림 한 줄이다. 상태를 바꾸는 절반만 직렬화하는 것이 이 비용에 맞다.

**권한:** 이 태스크는 권한을 추가하지 않는다. `tabs.get(id)` 은 권한 없이도 탭의 존재 여부를 답한다(`title`·`url` 만 비어 온다) — Task 1 §4 가 확인한 사실이다. `activeTab` 이 필요한 것은 제목을 읽는 Task 7 뿐이다.

- [ ] **Step 1: 모델과 세션 저장소를 넓힌다**

`lib/model/types.ts` 의 `TabLock` 바로 아래에 넣는다:

```ts
/**
 * A tab lock the background released because its tab was gone.
 *
 * Recorded in session storage rather than in AppState: once the lock is
 * released there is nothing left in the state to diagnose, and leaving the
 * lock half-on to carry the signal would make priority.ts route the profile to
 * the dynamic ruleset — silently widening it from one tab to every matching
 * site (spec §4.3).
 *
 * `tabTitle` is what the tab was called *when it was locked*, carried over
 * from TabLock. Spec §9: a record, not a claim about anything current.
 */
export interface StaleLock {
  profileId: string;
  tabTitle: string | null;
}
```

`lib/storage/session.ts` 의 **맨 위 임포트에** 한 줄 더한다 (`import { storage } from '#imports';` 아래):

```ts
import type { StaleLock } from '@/lib/model/types';
```

그리고 파일 **끝에** 추가한다:

```ts
/**
 * Locks released this browser session because their tab had gone (spec §4.3).
 * Session-scoped for the same reason `syncStatus` is: after a restart the tab
 * ids it describes mean nothing.
 */
export const staleLocksItem = storage.defineItem<StaleLock[]>('session:staleTabLocks', {
  fallback: [],
});

export async function getStaleLocks(): Promise<StaleLock[]> {
  const stored = await staleLocksItem.getValue();
  return Array.isArray(stored) ? stored : [];
}

/**
 * Merges new releases in, keyed by profile — a profile can lose a lock, be
 * locked again and lose that one too, and the second notice must replace the
 * first rather than sit beside it.
 *
 * Background-only, like setSyncStatus, and deliberately not on the write queue:
 * the queue serializes AppState, and the release *that changes AppState* does
 * go through it. Two overlapping onRemoved handlers can drop one notice here;
 * what they cannot drop is the release itself.
 */
export async function recordStaleLocks(locks: readonly StaleLock[]): Promise<void> {
  if (locks.length === 0) return;
  const merged = new Map((await getStaleLocks()).map((lock) => [lock.profileId, lock]));
  for (const lock of locks) merged.set(lock.profileId, lock);
  await staleLocksItem.setValue([...merged.values()]);
}
```

- [ ] **Step 2: 순수 생명주기의 실패하는 테스트를 쓴다**

`tests/unit/lockLifecycle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { staleLocks, releaseLocks } from '@/lib/tabs/lockLifecycle';
import { createProfile } from '@/lib/model/defaults';
import type { Profile, TabLock } from '@/lib/model/types';

function locked(id: string, tabLock: Partial<TabLock>): Profile {
  return {
    ...createProfile(id, 0),
    id,
    tabLock: { enabled: true, tabId: 1, tabTitle: null, ...tabLock },
  };
}

describe('staleLocks', () => {
  it('names every lock whose tab is not live, and nothing else', () => {
    const profiles = [
      locked('alive', { tabId: 7, tabTitle: 'Echo' }),
      locked('dead', { tabId: 8, tabTitle: 'Gone' }),
      locked('alsoDead', { tabId: 9, tabTitle: null }),
    ];

    expect(staleLocks(profiles, new Set([7]))).toEqual([
      { profileId: 'dead', tabId: 8, tabTitle: 'Gone' },
      { profileId: 'alsoDead', tabId: 9, tabTitle: null },
    ]);
  });

  it('ignores a profile whose lock is switched off, dangling tab id or not', () => {
    // A lock the user turned off is not stale — it is off. Reporting it would
    // put a notice on screen for something nobody is waiting on.
    const profiles = [locked('off', { enabled: false, tabId: 8, tabTitle: 'Gone' })];
    expect(staleLocks(profiles, new Set())).toEqual([]);
  });

  it('ignores a lock that never named a tab', () => {
    const profiles = [locked('never', { enabled: true, tabId: null })];
    expect(staleLocks(profiles, new Set())).toEqual([]);
  });

  it('returns nothing when every locked tab is live', () => {
    const profiles = [locked('a', { tabId: 7 }), locked('b', { tabId: 8 })];
    expect(staleLocks(profiles, new Set([7, 8]))).toEqual([]);
  });

  it('carries the title recorded at lock time, verbatim', () => {
    // The message the popup renders quotes this. A function that rebuilt the
    // title, or dropped it to null, would still pass every count-shaped
    // assertion above.
    const profiles = [locked('p', { tabId: 8, tabTitle: 'localhost:3000 — app' })];
    expect(staleLocks(profiles, new Set())).toEqual([
      { profileId: 'p', tabId: 8, tabTitle: 'localhost:3000 — app' },
    ]);
  });
});

describe('releaseLocks', () => {
  it('clears all three fields of the named profiles and leaves the others identical', () => {
    const a = locked('a', { tabId: 7, tabTitle: 'Keep' });
    const b = locked('b', { tabId: 8, tabTitle: 'Drop' });

    const after = releaseLocks([a, b], new Set(['b']));

    expect(after).toEqual([
      a,
      { ...b, tabLock: { enabled: false, tabId: null, tabTitle: null } },
    ]);
  });

  it('clears the title too — a released lock must not go on naming a tab', () => {
    // The stale record carries the title for the message; leaving it on the
    // profile would let the UI keep showing a lock target that no longer
    // exists, which is what spec §9's copy constraint is about.
    const after = releaseLocks([locked('a', { tabId: 8, tabTitle: 'Gone' })], new Set(['a']));
    expect(after[0]?.tabLock).toEqual({ enabled: false, tabId: null, tabTitle: null });
  });

  it('does not mutate the profiles it is given', () => {
    const a = locked('a', { tabId: 8, tabTitle: 'Gone' });
    const before = structuredClone(a);

    releaseLocks([a], new Set(['a']));

    expect(a).toEqual(before);
  });

  it('leaves every profile alone when the id set is empty', () => {
    const profiles = [locked('a', { tabId: 7 }), locked('b', { tabId: 8 })];
    expect(releaseLocks(profiles, new Set())).toEqual(profiles);
  });

  it('preserves order and every non-lock field', () => {
    // A rebuild-from-scratch implementation would pass the assertions above
    // and quietly drop headers or reorder the array.
    const a = { ...locked('a', { tabId: 7 }), name: 'Alpha', order: 3 };
    const b = { ...locked('b', { tabId: 8 }), name: 'Beta', order: 1 };

    const after = releaseLocks([a, b], new Set(['a']));

    expect(after.map((p) => [p.id, p.name, p.order])).toEqual([
      ['a', 'Alpha', 3],
      ['b', 'Beta', 1],
    ]);
  });
});
```

- [ ] **Step 3: 붉은지 확인한다**

```bash
npx vitest run tests/unit/lockLifecycle.test.ts
```

기대: `Failed to resolve import "@/lib/tabs/lockLifecycle"`.

- [ ] **Step 4: 순수 생명주기를 구현한다**

`lib/tabs/lockLifecycle.ts`:

```ts
import type { Profile, StaleLock } from '@/lib/model/types';

/** A stale lock plus the tab id it named, which the caller needs for logging. */
export interface StaleLockRelease extends StaleLock {
  tabId: number;
}

/**
 * Locks that name a tab which is no longer live.
 *
 * Takes the live set as a parameter rather than asking the browser: the
 * decision is pure and testable here, and the one call that touches
 * `browser.tabs` lives in lib/tabs/tabProbe.ts. Same split as
 * lib/permissions/{origins,probe}.ts, and for the same reason — fake-browser
 * cannot answer for the real API, so the judgement has to be reachable
 * without it.
 */
export function staleLocks(
  profiles: readonly Profile[],
  liveTabIds: ReadonlySet<number>,
): StaleLockRelease[] {
  const stale: StaleLockRelease[] = [];
  for (const profile of profiles) {
    const { enabled, tabId, tabTitle } = profile.tabLock;
    // A lock the user switched off is not stale, it is off — and a lock that
    // never named a tab has nothing to go stale.
    if (!enabled || typeof tabId !== 'number') continue;
    if (liveTabIds.has(tabId)) continue;
    stale.push({ profileId: profile.id, tabId, tabTitle });
  }
  return stale;
}

/**
 * The profiles array with the named locks fully released.
 *
 * All three fields go, `tabTitle` included: the message the user reads is
 * built from the session record, so a title left on the profile could only
 * make the UI go on naming a tab that no longer exists (spec §9).
 */
export function releaseLocks(
  profiles: readonly Profile[],
  profileIds: ReadonlySet<string>,
): Profile[] {
  return profiles.map((profile) =>
    profileIds.has(profile.id)
      ? { ...profile, tabLock: { enabled: false, tabId: null, tabTitle: null } }
      : profile,
  );
}
```

- [ ] **Step 5: 초록인지 확인하고 어댑터의 테스트를 쓴다**

```bash
npx vitest run tests/unit/lockLifecycle.test.ts
```

기대: 9 passed.

`tests/unit/tabProbe.test.ts`:

```ts
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { browser } from 'wxt/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTabAlive } from '@/lib/tabs/tabProbe';

beforeEach(() => { fakeBrowser.reset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('isTabAlive', () => {
  it('asks about exactly the tab it was given', async () => {
    const get = vi.spyOn(browser.tabs, 'get').mockResolvedValue({ id: 7 } as never);

    await isTabAlive(7);

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(7);
  });

  it('is true when the browser returns a tab', async () => {
    vi.spyOn(browser.tabs, 'get').mockResolvedValue({ id: 7 } as never);
    expect(await isTabAlive(7)).toBe(true);
  });

  it('is false when the browser rejects — that is how Chrome says the tab is gone', async () => {
    // Measured wording. A rejection is the real answer for a closed tab, so
    // it must not escape as an exception and abort the whole sweep: one dead
    // tab would then leave every other lock unswept.
    vi.spyOn(browser.tabs, 'get').mockRejectedValue(new Error('No tab with id: 7.'));
    expect(await isTabAlive(7)).toBe(false);
  });

  it('is false when the browser resolves with nothing', async () => {
    // fake-browser resolves `undefined` here, so without this branch every
    // sweep test in this repo would report every tab dead — and a truthiness
    // bug would be invisible under a mock that always returns an object.
    vi.spyOn(browser.tabs, 'get').mockResolvedValue(undefined as never);
    expect(await isTabAlive(7)).toBe(false);
  });
});
```

- [ ] **Step 6: 어댑터를 구현한다**

`lib/tabs/tabProbe.ts`:

```ts
import { browser } from 'wxt/browser';

/**
 * The only module permitted to call `chrome.tabs`.
 *
 * Same shape as lib/permissions/probe.ts, for the same measured reason:
 * `@webext-core/fake-browser` cannot stand in for the real API here (its
 * `tabs.get` resolves `undefined` where Chrome rejects), so the decision layer
 * has to be reachable without it and this file is what the tests spy on.
 */

/**
 * Whether a tab id still refers to an open tab.
 *
 * Needs no permission at all: `tabs.get` answers for any tab, and merely
 * withholds `title`/`url` without host access — which is why the liveness
 * sweep (spec §4.3) costs nothing at install time. Chrome rejects for an id
 * that is gone, and that rejection is the answer, not an error: letting it
 * escape would abort the sweep at the first dead lock and leave every later
 * one unswept.
 */
export async function isTabAlive(tabId: number): Promise<boolean> {
  try {
    const tab = await browser.tabs.get(tabId);
    return tab !== undefined && tab !== null;
  } catch {
    return false;
  }
}
```

- [ ] **Step 7: 진단 변환의 실패하는 테스트를 쓰고 구현한다**

```bash
npx vitest run tests/unit/tabProbe.test.ts
```

기대: 4 passed.

`tests/unit/staleLocks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { staleLockDiagnostics } from '@/lib/view/staleLocks';
import { createProfile } from '@/lib/model/defaults';
import type { Profile, TabLock } from '@/lib/model/types';

function profile(id: string, tabLock: Partial<TabLock> = {}): Profile {
  return {
    ...createProfile(id, 0),
    id,
    tabLock: { enabled: false, tabId: null, tabTitle: null, ...tabLock },
  };
}

describe('staleLockDiagnostics', () => {
  it('reports one warning per released lock, naming the profile', () => {
    const out = staleLockDiagnostics(
      [{ profileId: 'p1', tabTitle: 'Echo' }],
      [profile('p1')],
    );

    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('tab-lock-stale');
    expect(out[0]?.severity).toBe('warning');
    expect(out[0]?.profileId).toBe('p1');
    expect(out[0]?.headerRuleId).toBeUndefined(); // profile-level, so it lands in the band
  });

  it('says the title was what the tab was called at lock time, not what it is now', () => {
    // Spec §9's first constraint is a copy constraint, so it is asserted on
    // the copy. `activeTab` expires when the popup closes, so nothing ever
    // refreshes this string — a message reading "the tab titled X" would be a
    // claim the extension cannot support.
    const out = staleLockDiagnostics([{ profileId: 'p1', tabTitle: 'Echo' }], [profile('p1')]);

    expect(out[0]?.message).toBe(
      'The locked tab ("Echo" when it was locked) was closed, so this profile is no longer limited to one tab.',
    );
  });

  it('falls back to a title-free sentence when no title was recorded', () => {
    const out = staleLockDiagnostics([{ profileId: 'p1', tabTitle: null }], [profile('p1')]);

    expect(out[0]?.message).toBe(
      'The locked tab was closed, so this profile is no longer limited to one tab.',
    );
  });

  it('goes quiet for a profile that has been locked again since', () => {
    // This is how the record is "cleared" without the popup ever writing
    // session storage — spec §3.5 forbids a second writer, and a derived
    // display has nothing to clear.
    const out = staleLockDiagnostics(
      [{ profileId: 'p1', tabTitle: 'Echo' }],
      [profile('p1', { enabled: true, tabId: 12, tabTitle: 'New' })],
    );

    expect(out).toEqual([]);
  });

  it('goes quiet for a profile that no longer exists', () => {
    expect(staleLockDiagnostics([{ profileId: 'gone', tabTitle: 'Echo' }], [])).toEqual([]);
  });

  it('reports each of several released locks, in record order', () => {
    // Two, so an implementation that returned only the first — or only the
    // last — is visible. One-element fixtures hide both.
    const out = staleLockDiagnostics(
      [{ profileId: 'p1', tabTitle: 'One' }, { profileId: 'p2', tabTitle: 'Two' }],
      [profile('p1'), profile('p2')],
    );

    expect(out.map((d) => d.profileId)).toEqual(['p1', 'p2']);
  });
});
```

`lib/view/staleLocks.ts`:

```ts
import type { Diagnostic, Profile, StaleLock } from '@/lib/model/types';

/**
 * Turns the background's record of released tab locks into diagnostics the
 * band can show (spec §4.3, §4.4).
 *
 * `tab-lock-stale` cannot come out of `compile()`: by the time the popup
 * opens, the lock has been released and AppState holds nothing to diagnose.
 * The record lives in session storage instead, and this function is the only
 * place it becomes user-visible.
 *
 * **A profile locked again since is skipped.** That is what stands in for
 * clearing the record: the popup is not a writer (spec §3.5), so the display
 * is derived rather than stored and there is nothing to clear.
 *
 * The message quotes the title as a past fact. `activeTab` expires with the
 * popup, so nothing refreshes it — spec §9's first constraint is that the copy
 * must not pretend otherwise.
 */
export function staleLockDiagnostics(
  locks: readonly StaleLock[],
  profiles: readonly Profile[],
): Diagnostic[] {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const diagnostics: Diagnostic[] = [];

  for (const lock of locks) {
    const profile = byId.get(lock.profileId);
    if (!profile || profile.tabLock.enabled) continue;
    diagnostics.push({
      kind: 'tab-lock-stale',
      severity: 'warning',
      profileId: lock.profileId,
      message:
        lock.tabTitle === null
          ? 'The locked tab was closed, so this profile is no longer limited to one tab.'
          : `The locked tab ("${lock.tabTitle}" when it was locked) was closed, ` +
            'so this profile is no longer limited to one tab.',
    });
  }

  return diagnostics;
}
```

- [ ] **Step 8: 초록인지 확인한다**

```bash
npx vitest run tests/unit/staleLocks.test.ts
```

기대: 6 passed. `lib/view/` 는 순수성 가드가 자동 발견하므로 이 파일은 공짜로 덮인다 — `purity.test.ts` 의 `AUTO_DISCOVERED` 단언에 이름을 더한다:

```ts
    expect(AUTO_DISCOVERED).toEqual(
      expect.arrayContaining([
        'lib/compile/compile.ts',
        'lib/compile/conditions.ts',
        'lib/compile/conflicts.ts',
        'lib/compile/filterDiagnostics.ts',
        'lib/compile/headers.ts',
        'lib/compile/priority.ts',
        'lib/compile/suppression.ts',
        'lib/compile/validate.ts',
        'lib/view/grid.ts',
        'lib/view/staleLocks.ts',
      ]),
    );
```

그리고 `EXPLICIT` 와 그 단언 양쪽에 `'lib/tabs/lockLifecycle.ts'` 를 더하고, 어댑터 제외 단언을 하나 더 붙인다:

```ts
const EXPLICIT = [
  'lib/permissions/origins.ts',
  'lib/permissions/audit.ts',
  'lib/storage/writer.ts',
  'lib/messaging/protocol.ts',
  'lib/tabs/lockLifecycle.ts',
];
```

```ts
  it('does not guard the tabs adapter — it imports the browser by design', () => {
    expect(PURE_FILES).not.toContain('lib/tabs/tabProbe.ts');
  });
```

- [ ] **Step 9: 배경 스윕의 실패하는 테스트를 쓴다**

`tests/unit/backgroundTabLock.test.ts`:

```ts
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { browser } from 'wxt/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sweepTabLocks, releaseLocksForTab } from '@/entrypoints/background';
import { enqueueWrite } from '@/lib/storage/backgroundWriter';
import { getState, setState } from '@/lib/storage/state';
import { getStaleLocks } from '@/lib/storage/session';
import { DEFAULT_STATE, createProfile } from '@/lib/model/defaults';
import type { AppState, Profile, TabLock } from '@/lib/model/types';

function locked(id: string, tabLock: Partial<TabLock>): Profile {
  return {
    ...createProfile(id, 0),
    id,
    tabLock: { enabled: true, tabId: 1, tabTitle: null, ...tabLock },
  };
}

function stateWith(profiles: Profile[]): AppState {
  return { ...DEFAULT_STATE, profiles };
}

/** Only the ids in `alive` resolve; every other id rejects the way Chrome does. */
function tabsAlive(alive: readonly number[]) {
  return vi.spyOn(browser.tabs, 'get').mockImplementation(async (tabId: number) => {
    if (alive.includes(tabId)) return { id: tabId } as never;
    throw new Error(`No tab with id: ${tabId}.`);
  });
}

beforeEach(() => { fakeBrowser.reset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('sweepTabLocks', () => {
  it('releases only the locks whose tab is gone, and records exactly those', async () => {
    const alive = locked('alive', { tabId: 7, tabTitle: 'Echo' });
    const dead = locked('dead', { tabId: 8, tabTitle: 'Gone' });
    await setState(stateWith([alive, dead]));
    const get = tabsAlive([7]);

    await sweepTabLocks();

    // All three legs. A sweep that released everything would pass the second
    // assertion alone; one that released nothing would pass the first.
    expect(get.mock.calls.map(([id]) => id).sort()).toEqual([7, 8]);
    expect((await getState()).profiles).toEqual([
      alive,
      { ...dead, tabLock: { enabled: false, tabId: null, tabTitle: null } },
    ]);
    expect(await getStaleLocks()).toEqual([{ profileId: 'dead', tabTitle: 'Gone' }]);
  });

  it('writes nothing at all when every locked tab is alive', async () => {
    const before = stateWith([locked('a', { tabId: 7 })]);
    await setState(before);
    tabsAlive([7]);
    const write = vi.spyOn(fakeBrowser.storage.local, 'set');

    await sweepTabLocks();

    expect(write).not.toHaveBeenCalled();
    expect(await getStaleLocks()).toEqual([]);
  });

  it('does not ask about a profile that has no live lock', async () => {
    // tabs.get on an unlocked profile would be harmless but wrong, and a
    // sweep that asked about everything would report every unlocked profile
    // stale the moment the id happened to be null.
    await setState(stateWith([
      { ...createProfile('unlocked', 0), id: 'unlocked' },
      locked('off', { enabled: false, tabId: 8 }),
    ]));
    const get = tabsAlive([]);

    await sweepTabLocks();

    expect(get).not.toHaveBeenCalled();
    expect(await getStaleLocks()).toEqual([]);
  });

  it('goes through the write queue, so a popup patch landing at the same moment is not lost', async () => {
    // The ordering the whole phase is built on (handoff §4.5): the release is
    // a background write and must share the popup's chain. Without the queue
    // one of these two reads the pre-other state and drops its delta.
    await setState(stateWith([locked('dead', { tabId: 8, tabTitle: 'Gone' })]));
    tabsAlive([]);

    await Promise.all([
      sweepTabLocks(),
      enqueueWrite(() => ({ globalPause: true })),
    ]);

    const after = await getState();
    expect(after.globalPause).toBe(true);
    expect(after.profiles[0]?.tabLock).toEqual({ enabled: false, tabId: null, tabTitle: null });
  });
});

describe('releaseLocksForTab', () => {
  it('releases the profiles locked to the closed tab and leaves the rest locked', async () => {
    const other = locked('other', { tabId: 7, tabTitle: 'Still here' });
    const closed = locked('closed', { tabId: 8, tabTitle: 'Closed' });
    const alsoClosed = locked('alsoClosed', { tabId: 8, tabTitle: 'Closed too' });
    await setState(stateWith([other, closed, alsoClosed]));

    await releaseLocksForTab(8);

    expect((await getState()).profiles).toEqual([
      other,
      { ...closed, tabLock: { enabled: false, tabId: null, tabTitle: null } },
      { ...alsoClosed, tabLock: { enabled: false, tabId: null, tabTitle: null } },
    ]);
    expect(await getStaleLocks()).toEqual([
      { profileId: 'closed', tabTitle: 'Closed' },
      { profileId: 'alsoClosed', tabTitle: 'Closed too' },
    ]);
  });

  it('does not consult the browser — onRemoved already answered the question', async () => {
    await setState(stateWith([locked('closed', { tabId: 8 })]));
    const get = tabsAlive([]);

    await releaseLocksForTab(8);

    expect(get).not.toHaveBeenCalled();
  });

  it('does nothing when the closed tab held no lock', async () => {
    const before = stateWith([locked('other', { tabId: 7 })]);
    await setState(before);
    const write = vi.spyOn(fakeBrowser.storage.local, 'set');

    await releaseLocksForTab(8);

    expect(write).not.toHaveBeenCalled();
    expect(await getStaleLocks()).toEqual([]);
  });

  it('replaces an earlier notice for the same profile rather than stacking one on top', async () => {
    await setState(stateWith([locked('p', { tabId: 8, tabTitle: 'First' })]));
    await releaseLocksForTab(8);

    await setState(stateWith([locked('p', { tabId: 9, tabTitle: 'Second' })]));
    await releaseLocksForTab(9);

    expect(await getStaleLocks()).toEqual([{ profileId: 'p', tabTitle: 'Second' }]);
  });
});
```

- [ ] **Step 10: 붉은지 확인한다**

```bash
npx vitest run tests/unit/backgroundTabLock.test.ts
```

기대: `sweepTabLocks is not a function` 계열.

- [ ] **Step 11: 배경을 배선한다**

`entrypoints/background.ts` 에 임포트를 더한다:

```ts
import { getState } from '@/lib/storage/state';
import { recordStaleLocks } from '@/lib/storage/session';
import { staleLocks, releaseLocks } from '@/lib/tabs/lockLifecycle';
import { isTabAlive } from '@/lib/tabs/tabProbe';
import type { Profile } from '@/lib/model/types';
```

`handlePatch` 아래에 세 함수를 넣는다:

```ts
/**
 * Releases the named locks and leaves a record the popup can render.
 *
 * The state change goes through the write queue — this is the background's
 * second writer, and the reason the queue had to come first (handoff §4.5).
 * The session record does not: it is a notice, and the write that matters for
 * safety is the one above it.
 */
async function releaseStale(profiles: readonly Profile[], live: ReadonlySet<number>): Promise<void> {
  const stale = staleLocks(profiles, live);
  if (stale.length === 0) return;

  const ids = new Set(stale.map((lock) => lock.profileId));
  await enqueueWrite((current) => ({ profiles: releaseLocks(current.profiles, ids) }));
  await recordStaleLocks(stale.map(({ profileId, tabTitle }) => ({ profileId, tabTitle })));
}

/**
 * Design §6.3 / spec §4.3: session rules die with the service worker, so on
 * every startup each locked profile's tab is checked and the dead ones are
 * released before the rules are rebuilt.
 *
 * Only profiles with a live lock are asked about, so an install with no tab
 * locks costs zero `tabs.get` calls.
 */
export async function sweepTabLocks(): Promise<void> {
  const state = await getState();
  const live = new Set<number>();

  for (const profile of state.profiles) {
    const { enabled, tabId } = profile.tabLock;
    if (!enabled || typeof tabId !== 'number' || live.has(tabId)) continue;
    if (await isTabAlive(tabId)) live.add(tabId);
  }

  await releaseStale(state.profiles, live);
}

/**
 * `tabs.onRemoved` already answered "is this tab gone", so this asks the
 * browser nothing: every other locked tab is treated as live and only the
 * closed one is released. Two profiles can be locked to the same tab
 * (priority.ts orders them), so this is not a find-one operation.
 */
export async function releaseLocksForTab(closedTabId: number): Promise<void> {
  const state = await getState();
  const live = new Set<number>();

  for (const profile of state.profiles) {
    const { enabled, tabId } = profile.tabLock;
    if (enabled && typeof tabId === 'number' && tabId !== closedTabId) live.add(tabId);
  }

  await releaseStale(state.profiles, live);
}
```

그리고 `defineBackground` 의 본문을 바꾼다 — 기동 시 `run()` 을 스윕 뒤로 옮기고 `tabs.onRemoved` 를 배선한다:

```ts
export default defineBackground(() => {
  const run = () => {
    reconcile().catch((error) => {
      console.error('[HeaderLab] reconcile failed', error);
    });
  };

  browser.runtime.onMessage.addListener((message) => handlePatch(message));

  // Every trigger funnels into the same idempotent reconcile. `tabs.onRemoved`
  // is design §6.1's fourth row, wired here for the first time: the release
  // must land before the rules are rebuilt, and `finally` means a failed
  // release still leaves the rule set reconciled rather than frozen.
  browser.runtime.onStartup.addListener(run);
  browser.runtime.onInstalled.addListener(run);
  browser.permissions.onAdded.addListener(run);
  browser.permissions.onRemoved.addListener(run);
  browser.tabs.onRemoved.addListener((tabId) => {
    releaseLocksForTab(tabId)
      .catch((error) => console.error('[HeaderLab] tab lock release failed', error))
      .finally(run);
  });
  stateItem.watch(run);

  // Spec §4.3's diagram, in order: read state, check each locked tab, release
  // the dead ones, then reconcile.
  sweepTabLocks()
    .catch((error) => console.error('[HeaderLab] tab lock sweep failed', error))
    .finally(run);
});
```

- [ ] **Step 12: 초록인지 확인한다**

```bash
npx vitest run tests/unit/backgroundTabLock.test.ts && npx tsc --noEmit
```

기대: 8 passed, `tsc` 0.

- [ ] **Step 13: 팝업이 그 진단을 그리게 한다**

`entrypoints/popup/App.tsx`:

임포트에 더한다:

```tsx
import { getSyncStatus, getStaleLocks, type SyncStatus } from '@/lib/storage/session';
import { staleLockDiagnostics } from '@/lib/view/staleLocks';
import type { StaleLock } from '@/lib/model/types';
```

세션을 읽는 효과를 넓힌다:

```tsx
  const [staleLockRecords, setStaleLockRecords] = useState<StaleLock[]>([]);

  useEffect(() => {
    getSyncStatus()
      .then(setStatus)
      .catch(() => setStatus({ lastError: null, ruleCount: { always: 0, tabLocked: 0 } }));
    getStaleLocks().then(setStaleLockRecords).catch(() => setStaleLockRecords([]));
  }, [state]);
```

`allDiagnostics` 를 넓힌다:

```tsx
  // Three sources, one list. `tab-lock-stale` cannot come from compile() —
  // the lock is already released by the time the popup opens — so it arrives
  // from the session record instead (lib/view/staleLocks.ts). Routing is
  // unchanged: it carries no headerRuleId, so it lands in the band.
  const allDiagnostics = [
    ...compiled.diagnostics,
    ...grantDiagnostics,
    ...staleLockDiagnostics(staleLockRecords, profiles),
  ];
```

- [ ] **Step 14: App 층에서 띠에 뜨는지 못 박는다**

`tests/unit/App.test.tsx` 의 `describe('App')` 끝에 넣는다:

```tsx
  it('shows a released tab lock in the band, and stops once the profile is locked again', async () => {
    // The first assertion is the diagnostic's first ever appearance — spec §6
    // records that 2a declared `tab-lock-stale` and never emitted it. The
    // second is what stands in for clearing the record, and without it a band
    // that ignored `tabLock.enabled` entirely would pass on the first alone.
    await fakeBrowser.storage.session.set({
      staleTabLocks: [{ profileId: 'p1', tabTitle: 'Echo' }],
    });
    await seed(stateWith());
    const { unmount } = render(<App />);

    const lines = await screen.findAllByTestId('band-line');
    expect(lines.map((l) => l.textContent)).toEqual([
      'The locked tab ("Echo" when it was locked) was closed, so this profile is no longer limited to one tab.',
    ]);

    unmount();
    const relocked = stateWith();
    relocked.profiles[0]!.tabLock = { enabled: true, tabId: 12, tabTitle: 'New' };
    await seed(relocked);
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('foot')).toBeTruthy());
    expect(screen.queryAllByTestId('band-line')).toEqual([]);
  });
```

- [ ] **Step 15: 새 단언이 실제로 실패할 수 있는지 확인한다**

1. `staleLocks` 에서 `if (!enabled || typeof tabId !== 'number') continue;` 를 지운다 → `ignores a profile whose lock is switched off…` · `ignores a lock that never named a tab` **2건 red**.
2. `releaseLocks` 에서 `tabTitle: null` 을 `tabTitle: profile.tabLock.tabTitle` 로 바꾼다 → `clears the title too…` · `clears all three fields…` **2건 red**.
3. `releaseStale` 의 `enqueueWrite(...)` 를 `setState({ ...current, profiles: ... })` 직접 호출로 바꾼다 → `goes through the write queue…` **red**.
4. `sweepTabLocks` 의 `if (!enabled || ...) continue;` 를 지운다 → `does not ask about a profile that has no live lock` **red**.
5. `staleLockDiagnostics` 에서 `|| profile.tabLock.enabled` 를 지운다 → `goes quiet for a profile that has been locked again since` · App 의 `…stops once the profile is locked again` **2건 red**.
6. `releaseLocksForTab` 에서 `tabId !== closedTabId` 를 `false` 로 바꾼다(즉 전부 해제) → `releases the profiles locked to the closed tab and leaves the rest locked` **red**.

전부 확인 후 원복.

- [ ] **Step 16: 전체 검사와 커밋**

```bash
npm test && npx tsc --noEmit
git add lib/tabs lib/view/staleLocks.ts lib/model/types.ts lib/storage/session.ts entrypoints/background.ts entrypoints/popup/App.tsx tests/unit/lockLifecycle.test.ts tests/unit/tabProbe.test.ts tests/unit/staleLocks.test.ts tests/unit/backgroundTabLock.test.ts tests/unit/App.test.tsx tests/unit/purity.test.ts
git commit -m "feat: 사라진 탭의 잠금을 배경이 해제하고 이유를 남긴다"
```

---

## Task 7: 탭 잠금 UI

**Files:**
- Modify: `components/FilterBlock.tsx`, `entrypoints/popup/App.tsx`, `entrypoints/popup/style.css`
- Modify: `lib/tabs/tabProbe.ts` (`getActiveTab` 추가)
- Modify: `wxt.config.ts`, `tests/unit/manifest.test.ts`
- Create: `tests/unit/TabLock.test.tsx`
- Modify: `tests/unit/tabProbe.test.ts`

**Interfaces:**
- Consumes: `TabLock` (`@/lib/model/types`), Task 1 의 §1·§2·§3 판정
- Produces:
  - `interface ActiveTab { id: number; title: string | null }` · `async function getActiveTab(): Promise<ActiveTab | null>` (`@/lib/tabs/tabProbe`)
  - `FilterBlockProps` 에 `tabLock: TabLock` · `activeTab: ActiveTab | null` · `onToggleTabLock: (next: boolean) => void` 추가

**시작 전 확인:** Task 1 의 문서 §5 판정 표가 "설계대로"인지 다시 본다. Q1 이 `title` 을 주지 않았거나 Q2 가 "배경이 스스로 읽을 수 없다"와 다르게 나왔으면 **여기서 멈춘다.**

컨트롤은 도메인·리소스 타입 옆, `FilterBlock` 안에 둔다(스펙 §4.4). 프로필 편집 스트립에 두지 않는 이유는 그 스트립이 활성 탭 재클릭으로만 열려서 **켜둔 잠금이 평소에 보이지 않기** 때문이다 — 적용 범위를 조용히 좁히는 상태가 화면에 없는 것은 이 프로젝트가 없애온 침묵이다.

표시(스펙 §4.4 의 표 그대로):

| 상태 | 보이는 것 |
|---|---|
| 꺼짐 | `Apply to this tab only` 토글 |
| 켜짐 | 토글 + `Locked to tab {id} — "{title}" at lock time`, 제목이 없으면 `Locked to tab {id}` |
| 잠근 탭이 사라짐 | Task 6 이 띠에 띄운다. 토글은 꺼진 상태로 돌아간다 |

문구가 `at lock time` 을 달고 다니는 것은 장식이 아니다. `activeTab` 은 팝업이 닫히면 만료되므로 제목은 절대 갱신되지 않는다 — 현재 상태인 척하는 문구는 확장이 뒷받침할 수 없는 주장이다(스펙 §9).

- [ ] **Step 1: 현재 탭 어댑터의 실패하는 테스트를 쓴다**

`tests/unit/tabProbe.test.ts` 끝에 붙인다:

```ts
describe('getActiveTab', () => {
  it('asks for the active tab of the current window only', async () => {
    const query = vi.spyOn(browser.tabs, 'query').mockResolvedValue([{ id: 7, title: 'Echo' }] as never);

    await getActiveTab();

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
  });

  it('returns the id and the title', async () => {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([{ id: 7, title: 'Echo' }] as never);
    expect(await getActiveTab()).toEqual({ id: 7, title: 'Echo' });
  });

  it('returns a null title rather than dropping the tab when the title is withheld', async () => {
    // Spec §4.2's third question: a chrome:// page the extension cannot read.
    // The id is still usable, so the lock still works — only the label falls
    // back to the tab number.
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([{ id: 7 }] as never);
    expect(await getActiveTab()).toEqual({ id: 7, title: null });
  });

  it('is null when there is no active tab', async () => {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([] as never);
    expect(await getActiveTab()).toBeNull();
  });

  it('is null when the tab has no id — a lock with no tab id would widen to every site', async () => {
    // priority.ts routes `enabled && typeof tabId === 'number'` to the session
    // ruleset. A lock stored with a null id is read as *unlocked*, so the rule
    // goes out as a dynamic one matching every site the filter allows. Refusing
    // here is what keeps that unreachable.
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([{ title: 'Echo' }] as never);
    expect(await getActiveTab()).toBeNull();
  });

  it('is null rather than throwing when the query is refused', async () => {
    vi.spyOn(browser.tabs, 'query').mockRejectedValue(new Error('no activeTab'));
    expect(await getActiveTab()).toBeNull();
  });
});
```

`import { getActiveTab, isTabAlive } from '@/lib/tabs/tabProbe';` 로 임포트를 넓힌다.

- [ ] **Step 2: 붉은지 확인하고 구현한다**

```bash
npx vitest run tests/unit/tabProbe.test.ts
```

기대: `getActiveTab is not a function`.

`lib/tabs/tabProbe.ts` 에 추가한다:

```ts
/** What the popup could learn about the tab the user was looking at. */
export interface ActiveTab {
  id: number;
  title: string | null;
}

/**
 * The tab the popup was opened over.
 *
 * `title` is only populated because of `activeTab`, which the user grants
 * implicitly by clicking the extension — and which **expires when the popup
 * closes** (spec §9). Whatever is read here is a record of that moment, never
 * a live value, and the UI copy has to say so.
 *
 * Returns null rather than a partial tab when there is no id. priority.ts
 * treats a lock with a null id as *unlocked* and routes the profile to the
 * dynamic ruleset, so storing one would silently widen a one-tab profile to
 * every site its filter matches.
 */
export async function getActiveTab(): Promise<ActiveTab | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id !== 'number') return null;
    return { id: tab.id, title: tab.title ?? null };
  } catch {
    return null;
  }
}
```

```bash
npx vitest run tests/unit/tabProbe.test.ts
```

기대: 10 passed.

- [ ] **Step 3: 컴포넌트의 실패하는 테스트를 쓴다**

`tests/unit/TabLock.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterBlock } from '@/components/FilterBlock';
import type { Filter, TabLock } from '@/lib/model/types';

const filter: Filter = {
  mode: 'structured',
  domains: ['api.example.com'],
  excludedDomains: [],
  resourceTypes: ['xmlhttprequest'],
};

function renderBlock(over: {
  tabLock?: Partial<TabLock>;
  activeTab?: { id: number; title: string | null } | null;
} = {}) {
  const onToggleTabLock = vi.fn();
  render(
    <FilterBlock
      filter={filter}
      tabLock={{ enabled: false, tabId: null, tabTitle: null, ...over.tabLock }}
      activeTab={over.activeTab === undefined ? { id: 42, title: 'Echo' } : over.activeTab}
      onPatch={vi.fn()}
      onToggleTabLock={onToggleTabLock}
    />,
  );
  return { onToggleTabLock };
}

describe('tab lock control', () => {
  it('sits inside the filter block, where the rest of "what does this apply to" lives', () => {
    // Spec §4.4: not in the profile edit strip, which only opens on a
    // re-click — a lock left on would be invisible in normal use, which is the
    // silence this control exists to prevent.
    const { container } = renderBlock();
    const toggle = screen.getByRole('button', { name: 'Apply to this tab only' });
    expect(container.querySelector('.hl-filters')?.contains(toggle)).toBe(true);
  });

  it('reads as off, and says nothing about a tab, when the lock is off', () => {
    renderBlock();
    expect(screen.getByRole('button', { name: 'Apply to this tab only' }).getAttribute('aria-pressed'))
      .toBe('false');
    expect(screen.queryByTestId('lock-target')).toBeNull();
  });

  it('asks to turn the lock on when clicked while off', async () => {
    const { onToggleTabLock } = renderBlock();

    await userEvent.click(screen.getByRole('button', { name: 'Apply to this tab only' }));

    expect(onToggleTabLock).toHaveBeenCalledTimes(1);
    expect(onToggleTabLock).toHaveBeenCalledWith(true);
  });

  it('asks to turn the lock off when clicked while on — both directions, not just the first', async () => {
    // A handler hardcoded to `true` passes the test above. This is the leg
    // that catches it.
    const { onToggleTabLock } = renderBlock({
      tabLock: { enabled: true, tabId: 42, tabTitle: 'Echo' },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Apply to this tab only' }));

    expect(onToggleTabLock).toHaveBeenCalledTimes(1);
    expect(onToggleTabLock).toHaveBeenCalledWith(false);
  });

  it('names the tab it is locked to, and says the title is from lock time', () => {
    // Spec §9: activeTab expires with the popup, so this title is never
    // refreshed. Copy that implied otherwise would be a claim the extension
    // cannot support — asserted on the exact string for that reason.
    renderBlock({ tabLock: { enabled: true, tabId: 42, tabTitle: 'Echo server' } });

    expect(screen.getByRole('button', { name: 'Apply to this tab only' }).getAttribute('aria-pressed'))
      .toBe('true');
    expect(screen.getByTestId('lock-target').textContent)
      .toBe('Locked to tab 42 — "Echo server" at lock time');
  });

  it('falls back to the tab number when no title was readable', () => {
    // Spec §4.4's second row. Reachable through a chrome:// page, per the
    // activeTab spike §3.
    renderBlock({ tabLock: { enabled: true, tabId: 42, tabTitle: null } });
    expect(screen.getByTestId('lock-target').textContent).toBe('Locked to tab 42');
  });

  it('shows the stored tab, not the tab the popup is over now', () => {
    // The two differ as soon as the user switches tabs and reopens the popup.
    // Rendering `activeTab` here would make the control claim the lock had
    // followed them.
    renderBlock({
      tabLock: { enabled: true, tabId: 42, tabTitle: 'Echo server' },
      activeTab: { id: 99, title: 'Somewhere else' },
    });

    expect(screen.getByTestId('lock-target').textContent)
      .toBe('Locked to tab 42 — "Echo server" at lock time');
  });

  it('cannot be switched on when there is no tab to lock, and says why', async () => {
    // Storing a lock with a null tab id reads as *unlocked* in priority.ts and
    // widens the profile to every matching site. A disabled control with a
    // reason beats a control that silently does the wrong thing.
    const { onToggleTabLock } = renderBlock({ activeTab: null });
    const toggle = screen.getByRole('button', { name: 'Apply to this tab only' });

    expect(toggle).toHaveProperty('disabled', true);
    expect(screen.getByTestId('lock-target').textContent).toBe('No tab available to lock');

    await userEvent.click(toggle);
    expect(onToggleTabLock).not.toHaveBeenCalled();
  });

  it('can still be switched off when there is no readable tab', async () => {
    // Turning a lock *off* needs no tab — and a control disabled in both
    // directions would trap the user with a lock they cannot release.
    const { onToggleTabLock } = renderBlock({
      tabLock: { enabled: true, tabId: 42, tabTitle: 'Echo' },
      activeTab: null,
    });
    const toggle = screen.getByRole('button', { name: 'Apply to this tab only' });

    expect(toggle).toHaveProperty('disabled', false);
    await userEvent.click(toggle);

    expect(onToggleTabLock).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 4: 붉은지 확인한다**

```bash
npx vitest run tests/unit/TabLock.test.tsx
```

기대: `tabLock` prop 이 없어 `tsc` 와 런타임 모두 실패.

- [ ] **Step 5: `FilterBlock` 을 고친다**

props 와 임포트를 넓힌다:

```tsx
import type { ActiveTab } from '@/lib/tabs/tabProbe';
import type { Filter, ResourceType, TabLock } from '@/lib/model/types';

export interface FilterBlockProps {
  filter: Filter;
  /** The profile's stored lock — a record of the tab it was locked to. */
  tabLock: TabLock;
  /** The tab the popup is over right now, or null if none could be read. */
  activeTab: ActiveTab | null;
  onPatch: (patch: Partial<Filter>) => void;
  onToggleTabLock: (next: boolean) => void;
}
```

서명과 본문을 고친다:

```tsx
export function FilterBlock({ filter, tabLock, activeTab, onPatch, onToggleTabLock }: FilterBlockProps) {
```

`toggleType` 아래에 넣는다:

```tsx
  // A lock stored with a null tab id is read as *unlocked* by priority.ts and
  // the profile goes out as a dynamic rule matching every site its filter
  // allows — so switching on without a readable tab is refused rather than
  // stored. Switching *off* stays available either way: a control disabled in
  // both directions would trap the user with a lock they cannot release.
  const canLock = tabLock.enabled || activeTab !== null;

  const lockTarget = tabLock.enabled
    ? tabLock.tabTitle === null
      // §4.4: the tab number stands in when the title could not be read.
      ? `Locked to tab ${tabLock.tabId}`
      // "at lock time" is load-bearing, not decoration. activeTab expires when
      // the popup closes, so this title is never refreshed (spec §9) — copy
      // that read as current would be a claim we cannot support.
      : `Locked to tab ${tabLock.tabId} — "${tabLock.tabTitle}" at lock time`
    : activeTab === null
      ? 'No tab available to lock'
      : null;
```

`Types` 행 아래, 닫는 `</div>` 앞에 잠금 행을 넣는다:

```tsx
      <div className="hl-frow">
        <span className="hl-flabel">Tab</span>
        <button
          className="hl-chip"
          aria-label="Apply to this tab only"
          aria-pressed={tabLock.enabled}
          disabled={!canLock}
          onClick={() => onToggleTabLock(!tabLock.enabled)}
        >
          Apply to this tab only
        </button>
        {lockTarget !== null && (
          <span className="hl-locktarget" data-testid="lock-target">{lockTarget}</span>
        )}
      </div>
```

`entrypoints/popup/style.css` 의 `.hl-chip` 규칙 아래에 넣는다:

```css
.hl-chip:disabled { opacity: .45; }
.hl-locktarget { color: var(--hl-amb); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

`--hl-amb` 는 2b 가 "탭 잠금"용으로 잡아두고 쓰지 않은 색이다.

- [ ] **Step 6: 초록인지 확인하고 기존 `FilterBlock` 테스트를 맞춘다**

```bash
npx vitest run tests/unit/TabLock.test.tsx
```

기대: 10 passed.

**`tests/unit/Chrome.test.tsx` 의 `describe('FilterBlock')` 이 세 개의 새 필수 prop 없이 렌더하므로 `tsc` 가 붉어진다.** 그 파일의 `filter()` 헬퍼 옆에 렌더 헬퍼를 하나 두고, 블록 안의 `render(<FilterBlock ... />)` 호출을 전부 그것으로 바꾼다 — 잠금과 무관한 기존 단언들이 잠금 픽스처를 매번 되풀이하지 않게 하기 위해서다:

```tsx
/**
 * The domain/type assertions in this block predate the tab lock and say
 * nothing about it, so the lock is held in one place at its off default
 * rather than repeated into every call.
 */
function renderFilter(props: { filter: Filter; onPatch: (patch: Partial<Filter>) => void }) {
  return render(
    <FilterBlock
      {...props}
      tabLock={{ enabled: false, tabId: null, tabTitle: null }}
      activeTab={{ id: 1, title: 'Test tab' }}
      onToggleTabLock={vi.fn()}
    />,
  );
}
```

예: 첫 테스트는 아래가 된다.

```tsx
    renderFilter({ filter: filter({ domains: ['a.com', 'b.com'] }), onPatch: vi.fn() });
```

```bash
npx vitest run tests/unit/Chrome.test.tsx && npx tsc --noEmit
```

기대: 기존 단언이 하나도 바뀌지 않은 채 전부 통과, `tsc` 0.

- [ ] **Step 7: App 에 배선한다**

`entrypoints/popup/App.tsx`:

```tsx
import { getActiveTab, type ActiveTab } from '@/lib/tabs/tabProbe';
```

```tsx
  // Read once on mount, not per render: `activeTab` is granted for the click
  // that opened this popup, and the answer cannot change while it is open.
  const [activeTab, setActiveTab] = useState<ActiveTab | null>(null);
  useEffect(() => {
    let cancelled = false;
    getActiveTab().then((tab) => { if (!cancelled) setActiveTab(tab); });
    return () => { cancelled = true; };
  }, []);
```

`<FilterBlock />` 을 넓힌다:

```tsx
      <FilterBlock
        key={`filter-${active.id}`}
        filter={active.filter}
        tabLock={active.tabLock}
        activeTab={activeTab}
        onPatch={(delta: Partial<Filter>) =>
          patchProfile(active.id, { filter: { ...active.filter, ...delta } })
        }
        onToggleTabLock={(next) => {
          // Off is unconditional. On requires a tab — FilterBlock disables the
          // control without one, and this guard is the second door to the same
          // rule (a lock with a null id reads as unlocked and widens the rule).
          if (!next) {
            patchProfile(active.id, { tabLock: { enabled: false, tabId: null, tabTitle: null } });
            return;
          }
          if (!activeTab) return;
          patchProfile(active.id, {
            tabLock: { enabled: true, tabId: activeTab.id, tabTitle: activeTab.title },
          });
        }}
      />
```

- [ ] **Step 8: 매니페스트에 `activeTab` 을 넣는다**

**이 단계에서만, 그리고 위 Step 7 이 실제로 소비하기 때문에 정당하다.** `wxt.config.ts`:

```ts
    // activeTab, not `tabs`: it gives the popup the current tab's title for the
    // click that opened it and **makes no install warning**, where `tabs` does.
    // Added here, in the phase whose tab-lock UI actually reads that title —
    // Phase 2a left it out on purpose, because a permission with no consumer
    // makes the manifest test's claim formally true and substantively false
    // (handoff §4.4).
    permissions: ['storage', 'declarativeNetRequestWithHostAccess', 'activeTab'],
```

`tests/unit/manifest.test.ts` 의 단언을 고친다:

```ts
  it('declares exactly the three permissions actually used — nothing extra to explain away', () => {
    const manifest = readManifest();
    // Exact, and still exact: each of the three has a named consumer.
    //   storage                              — lib/storage/*
    //   declarativeNetRequestWithHostAccess  — lib/sync/ruleSync.ts
    //   activeTab                            — lib/tabs/tabProbe.ts's getActiveTab,
    //                                          read by the tab lock control
    // None of the three produces an install warning; `tabs` would, which is
    // why the tab lock reads the title through activeTab instead.
    expect(manifest.permissions).toEqual([
      'storage', 'declarativeNetRequestWithHostAccess', 'activeTab',
    ]);
  });
```

그리고 **설치 경고 0개라는 주장이 여전히 참인지**를 못 박는 단언을 같은 파일에 더한다:

```ts
  it('adds no warning-bearing permission alongside it', () => {
    // `activeTab` is warning-free; `tabs` is not, and it is the permission a
    // future "just read the title" change would reach for. The product's
    // central claim is checked by reading the manifest, so it is asserted
    // rather than left to review.
    const manifest = readManifest();
    expect(manifest.permissions).not.toContain('tabs');
    expect(Object.prototype.hasOwnProperty.call(manifest, 'host_permissions')).toBe(false);
  });
```

- [ ] **Step 9: 새 단언이 실제로 실패할 수 있는지 확인한다**

1. `FilterBlock` 의 `onToggleTabLock(!tabLock.enabled)` 를 `onToggleTabLock(true)` 로 바꾼다 → `asks to turn the lock off when clicked while on` **red**.
2. `lockTarget` 의 `at lock time` 을 지운다 → `names the tab it is locked to, and says the title is from lock time` **red**.
3. `tabLock.tabId` 를 `activeTab?.id` 로 바꾼다 → `shows the stored tab, not the tab the popup is over now` **red**.
4. `canLock` 을 `true` 로 고정한다 → `cannot be switched on when there is no tab to lock, and says why` **red**.
5. `canLock` 을 `activeTab !== null` 로만 둔다 → `can still be switched off when there is no readable tab` **red**.
6. `wxt.config.ts` 의 `activeTab` 을 빼고 `npm test` 를 돌린다 → 매니페스트 단언 **red** (빌드가 먼저 도므로 실제 산출물을 읽는다).

전부 확인 후 원복.

- [ ] **Step 10: 전체 검사와 커밋**

```bash
npm test && npx tsc --noEmit
git add components/FilterBlock.tsx lib/tabs/tabProbe.ts entrypoints/popup/App.tsx entrypoints/popup/style.css wxt.config.ts tests/unit/TabLock.test.tsx tests/unit/tabProbe.test.ts tests/unit/manifest.test.ts
git commit -m "feat: 필터 블록에서 이 탭에만 적용을 켜고 끈다"
```

---

## Task 8: 프로필 on/off 토글

**Files:**
- Modify: `components/ProfileEditStrip.tsx`, `components/StatusFoot.tsx`, `entrypoints/popup/App.tsx`, `entrypoints/popup/style.css`
- Modify: `lib/view/grid.ts` (`inertReason` 추가)
- Modify: `tests/unit/grid.test.ts`, `tests/unit/ProfileBar.test.tsx`, `tests/unit/App.test.tsx`

**Interfaces:**
- Consumes: `groupCounts` 의 `GroupLiveness` (`lib/view/grid.ts`), `StatusFootProps` (Task 5 까지의 상태)
- Produces:
  - `type InertReason = 'profile-off' | 'paused' | 'filter-unusable' | null`
  - `function inertReason(input: { enabled: boolean; globalPause: boolean; suppressed: boolean }): InertReason`
  - `StatusFootProps` 에 `reason: InertReason` 추가

모델에 `enabled` 가 있고 `compile.ts:28` 이 읽는데 **UI 경로가 없다.** 2b 는 이 때문에 두 결함을 "도달 불가"로 분류해 닫았다(스펙 §5.1). 토글이 생기면 둘 다 살아나므로, 이 태스크는 토글을 붙이고 **회귀가 여전히 초록인지 토글을 통해** 확인하는 일이다.

그리고 2b 리뷰의 M3 를 여기서 닫는다: 꺼진 프로필의 "0 of N" 에 이유를 붙인다. 이유는 `lib/view/grid.ts` 의 순수 함수가 정하고, 우선순위는 `compile.ts` 가 프로필을 죽이는 순서(`:28` → `:40` → `:51`)와 같다 — 화면이 컴파일러와 다른 이유를 대면 그것이 새 침묵이다. 같은 함수가 `live` 도 대신하므로 App 에 판단이 두 개 남지 않는다.

- [ ] **Step 1: 순수 함수의 실패하는 테스트를 쓴다**

`tests/unit/grid.test.ts` 의 `describe('groupCounts')` 앞에 넣는다:

```ts
describe('inertReason', () => {
  const alive = { enabled: true, globalPause: false, suppressed: false };

  it('is null when nothing stops the profile', () => {
    expect(inertReason(alive)).toBeNull();
  });

  it('names each of the three killers on its own', () => {
    expect(inertReason({ ...alive, enabled: false })).toBe('profile-off');
    expect(inertReason({ ...alive, globalPause: true })).toBe('paused');
    expect(inertReason({ ...alive, suppressed: true })).toBe('filter-unusable');
  });

  it('resolves every overlap in compile.ts\'s own order', () => {
    // compile.ts kills a profile at :28 (!enabled), :40 (globalPause) and :51
    // (suppression), in that order — the screen must give the same answer the
    // compiler acted on. All four combinations, not one: a chain that checked
    // only two of the three would still pass any single pair.
    expect(inertReason({ enabled: false, globalPause: true, suppressed: false })).toBe('profile-off');
    expect(inertReason({ enabled: false, globalPause: false, suppressed: true })).toBe('profile-off');
    expect(inertReason({ enabled: true, globalPause: true, suppressed: true })).toBe('paused');
    expect(inertReason({ enabled: false, globalPause: true, suppressed: true })).toBe('profile-off');
  });
});
```

임포트를 넓힌다: `import { groupRows, routeDiagnostics, profileMarker, groupCounts, inertReason } from '@/lib/view/grid';`

- [ ] **Step 2: 붉은지 확인하고 구현한다**

```bash
npx vitest run tests/unit/grid.test.ts
```

기대: `inertReason is not a function`.

`lib/view/grid.ts` 의 `GroupLiveness` 위에 넣는다:

```ts
export type InertReason = 'profile-off' | 'paused' | 'filter-unusable' | null;

/**
 * Why compile() emits nothing for a profile — or null when it does emit.
 *
 * The three judgements that kill a whole profile are not row-level, so none of
 * them ever reaches `byRow` and every row still looks healthy. `groupCounts`
 * already takes the *fact* of that as `live`; this gives the same answer a
 * name, because "0 of 2 applying" with no reason is a number the user cannot
 * act on (2b review, M3).
 *
 * The order is compile.ts's own — `!enabled` at :28, `globalPause` at :40,
 * suppression at :51. A screen that named a different cause than the one the
 * compiler acted on would be a new silence dressed as an explanation.
 *
 * `live` is `inertReason(...) === null`, so the popup composes one expression
 * rather than two that can drift apart.
 */
export function inertReason(input: {
  enabled: boolean;
  globalPause: boolean;
  suppressed: boolean;
}): InertReason {
  if (!input.enabled) return 'profile-off';
  if (input.globalPause) return 'paused';
  if (input.suppressed) return 'filter-unusable';
  return null;
}
```

```bash
npx vitest run tests/unit/grid.test.ts
```

기대: 전부 통과.

- [ ] **Step 3: 스트립에 토글을 붙이는 실패하는 테스트를 쓴다**

`tests/unit/ProfileBar.test.tsx` 의 `describe('ProfileEditStrip')` 안에 넣는다:

```tsx
  it('shows the profile as on, and asks to switch it off', async () => {
    const onPatch = vi.fn();
    render(
      <ProfileEditStrip profile={prof('p1', 'Local')} onPatch={onPatch} onDelete={vi.fn()} onClose={vi.fn()} />,
    );
    const toggle = screen.getByRole('button', { name: 'Profile enabled' });

    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(toggle);

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ enabled: false });
  });

  it('shows a switched-off profile as off, and asks to switch it back on', async () => {
    // Both directions. A handler hardcoded to `{ enabled: false }` passes the
    // test above on its own, and this control's whole job is a round trip.
    const onPatch = vi.fn();
    render(
      <ProfileEditStrip
        profile={{ ...prof('p1', 'Local'), enabled: false }}
        onPatch={onPatch} onDelete={vi.fn()} onClose={vi.fn()}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Profile enabled' });

    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(toggle);

    expect(onPatch).toHaveBeenCalledWith({ enabled: true });
  });
```

- [ ] **Step 4: 붉은지 확인하고 스트립을 고친다**

```bash
npx vitest run tests/unit/ProfileBar.test.tsx
```

기대: `Unable to find role="button" and name "Profile enabled"`.

`components/ProfileEditStrip.tsx` 의 이름 입력 **앞에** 넣는다 — 이름·색·삭제와 같은 줄의 프로필 메타데이터다(스펙 §5.1):

```tsx
      <button
        className="hl-chip"
        aria-label="Profile enabled"
        aria-pressed={profile.enabled}
        onClick={() => onPatch({ enabled: !profile.enabled })}
      >
        {profile.enabled ? 'On' : 'Off'}
      </button>
```

- [ ] **Step 5: 상태 줄에 이유를 붙인다**

`components/StatusFoot.tsx` 를 고친다:

```tsx
import type { InertReason } from '@/lib/view/grid';
import type { RuleCount } from '@/lib/storage/session';

export interface StatusFootProps {
  applying: number;
  total: number;
  off: number;
  needsAccess: number;
  /** The real text of the last failed reconcile, from session storage. */
  lastError: string | null;
  /** The real text of the last save this popup could not complete. */
  writeError: string | null;
  /** Rules the background actually has registered, split by scope. */
  ruleCount: RuleCount;
  /** Why this profile is applying nothing, or null when it is. */
  reason: InertReason;
}

/**
 * The reason, as a phrase that completes "…applying". Kept here rather than in
 * grid.ts because it is copy, and grid.ts is the pure layer that decides.
 */
const REASON_COPY: Record<Exclude<InertReason, null>, string> = {
  'profile-off': 'this profile is off',
  paused: 'everything is paused',
  'filter-unusable': 'no usable domain in the filter',
};
```

본문에서 **applying 카운트 `<span>` 바로 뒤에** 이유를 끼운다. Task 5 가 넣은 `off` 와 `scope-counts` 는 그대로 남는다 — 순서는 `applying → reason → off → scope-counts` 다:

```tsx
          <span>
            <b>{applying}</b> of {total} rules applying
          </span>
          {reason !== null && (
            // "0 of 2" on its own is a number the user cannot act on. The
            // cause is never row-level, so nothing else on the screen carries
            // it (2b review, M3).
            <span className="hl-freason" data-testid="inert-reason">— {REASON_COPY[reason]}</span>
          )}
```

`entrypoints/popup/style.css` 에 넣는다:

```css
.hl-freason { color: var(--hl-txt3); }
```

- [ ] **Step 6: App 이 하나의 표현식으로 두 값을 얻게 한다**

`entrypoints/popup/App.tsx` 의 `live` 계산을 바꾼다:

```tsx
  // The three judgements that stop compile() emitting anything for this profile
  // (compile.ts:28, :40, :51), computed once as a *named* answer and handed to
  // both the grid and the foot, so the group headers, the footer and the
  // reason cannot say different things about the same profile. `isSuppressed`
  // is called, never restated (lib/compile/suppression.ts).
  const reason = inertReason({
    enabled: active.enabled,
    globalPause: state.globalPause,
    suppressed: isSuppressed(active),
  });
  const live = reason === null;
```

임포트에 `inertReason` 을 더하고, `<StatusFoot ... reason={reason} />` 를 넘긴다.

- [ ] **Step 7: 회귀 둘이 토글을 통해서도 초록인지 확인한다**

`tests/unit/App.test.tsx` 의 `describe('App')` 끝에 넣는다:

```tsx
  it('switches the profile off through the strip, and the whole screen agrees on why', async () => {
    // Spec §5.1: 2b closed two defects as unreachable because `enabled` had no
    // UI path. The toggle makes them reachable, so the regression is driven
    // through the control rather than by seeding state — that is the part
    // seeding could never cover.
    await seed(stateWith());
    render(<App />);
    expect((await screen.findByTestId('foot')).textContent).toContain('2 of 2 rules applying');

    await userEvent.click(screen.getByRole('tab', { name: /Local/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Profile enabled' }));

    await waitFor(() => {
      expect(screen.getByTestId('foot').textContent).toContain('0 of 2 rules applying');
    });
    // Three places, one answer: the footer count, the reason, and the group
    // headers. A count that moved without the reason — or a reason naming
    // `paused` — is the shape of the defect this closes.
    expect(screen.getByTestId('inert-reason').textContent).toBe('— this profile is off');
    expect(screen.getByTestId('group-request').textContent).toContain('0 of 1 applying');
    expect(screen.getByTestId('group-response').textContent).toContain('0 of 1 applying');
  });

  it('names pausing, not the profile, when the profile is on and everything is paused', async () => {
    // The reason has to move with the cause; a foot hardwired to one string
    // passes the test above on its own.
    await seed({ ...stateWith(), globalPause: true });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('inert-reason').textContent).toBe('— everything is paused');
    });
  });

  it('names the filter when the profile is on, unpaused and suppressed', async () => {
    const s = stateWith();
    s.profiles[0]!.filter.domains = ['api.example.com', 'https://staging.example.com'];
    await seed(s);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('inert-reason').textContent)
        .toBe('— no usable domain in the filter');
    });
  });

  it('says nothing about a reason when the profile is applying', async () => {
    await seed(stateWith());
    render(<App />);

    await screen.findByTestId('foot');
    expect(screen.queryByTestId('inert-reason')).toBeNull();
  });
```

- [ ] **Step 8: 새 단언이 실제로 실패할 수 있는지 확인한다**

1. `inertReason` 에서 `if (!input.enabled)` 를 맨 아래로 옮긴다 → `resolves every overlap in compile.ts's own order` **red**.
2. `ProfileEditStrip` 의 `!profile.enabled` 를 `false` 로 고정한다 → `shows a switched-off profile as off, and asks to switch it back on` **red**.
3. `StatusFoot` 의 `reason !== null &&` 를 지워 항상 렌더하게 한다 → `says nothing about a reason when the profile is applying` **red**.
4. App 의 `suppressed: isSuppressed(active)` 를 `false` 로 바꾼다 → `names the filter when the profile is on, unpaused and suppressed` **red**.

전부 확인 후 원복.

- [ ] **Step 9: 전체 검사와 커밋**

```bash
npm test && npx tsc --noEmit
git add components/ProfileEditStrip.tsx components/StatusFoot.tsx lib/view/grid.ts entrypoints/popup/App.tsx entrypoints/popup/style.css tests/unit/grid.test.ts tests/unit/ProfileBar.test.tsx tests/unit/App.test.tsx
git commit -m "feat: 프로필을 끄고 켤 수 있고 0 of N 이 이유를 말한다"
```

---

## Task 9: `empty-filter` 분할과 2b 우회 되돌리기

**Files:**
- Modify: `lib/model/types.ts` (`DiagnosticKind`)
- Modify: `lib/compile/filterDiagnostics.ts:122-131`
- Modify: `lib/view/grid.ts` (`profileMarker` 에서 `ProfileLiveness` 제거)
- Modify: `components/ProfileBar.tsx`
- Modify: `tests/unit/filterDiagnostics.test.ts`, `tests/unit/compile.test.ts`, `tests/unit/grid.test.ts`, `tests/unit/ProfileBar.test.tsx`, `tests/unit/App.test.tsx`

**Interfaces:**
- Consumes: `isSuppressed` (`@/lib/compile/suppression`) — 바뀌지 않는다
- Produces:
  - `DiagnosticKind` 에 `'no-usable-domain'` 추가 (10종 → 11종)
  - `profileMarker(diagnostics, profileId)` — **세 번째 인자가 사라진다.** `ProfileLiveness` 도 export 에서 사라진다

한 종류가 정반대 두 상태를 덮고 있다(인수인계 §4.3):

| 상태 | 결과 | 분할 후 |
|---|---|---|
| 도메인 목록이 비어 있음 | 룰이 등록되고 **모든 사이트**에 매칭 | `empty-filter` / warning |
| 도메인이 전부 무효 | 룰이 **아예 없음** | `no-usable-domain` / **error** |

**두 가지를 같은 태스크에서 한다.** 분할만 하면 `profileMarker` 가 억제를 인자로 받는 2b 의 우회가 남아 같은 판단이 두 자리에 있게 된다 — Phase 2a 에서 가장 비쌌던 결함의 형태다(스펙 §5.2).

**regex 모드는 건드리지 않는다.** regex + 전부 무효는 지금도 `invalid-domain`(error)이 잡고 조기 반환하므로 `no-usable-domain` 에 도달하지 않는다. 거기까지 "친절하게" 바꾸면 한 상태에 진단이 둘 나간다.

### `grid.test.ts` 의 세 케이스에 대한 판정

스펙 §5.2 가 함께 판단하라고 지목한 케이스를 포함해 셋 다 `liveness` 인자에 대한 테스트다. **전부 나간다.**

| 테스트 | 판정 | 근거 |
|---|---|---|
| `is error for a suppressed profile whose only diagnostic is a warning` (`:125`) | 삭제 | 분할 후 그 프로필은 `no-usable-domain`(error)을 받으므로 severity 규칙이 스스로 잡는다 |
| `is error for a suppressed profile with no diagnostics of its own at all` (`:134`) | 삭제 | 스펙 §5.2 가 지목한 케이스. 2b 의 N2 수정 이후 유일한 실현자(꺼진 프로필)가 사라져 **더 이상 실현 불가능한 상태를 단언한다** — 우회와 함께 나간다 |
| `does not mark other profiles when this one is suppressed` (`:142`) | 삭제 | 사라지는 인자가 다른 프로필로 새지 않는지를 보는 테스트다 |

셋을 지우면 "도메인이 전부 무효인 프로필의 탭에 표식이 붙는가"라는 **사용자에게 보이는 사실**의 커버리지가 빈다. 그래서 같은 자리에 새 메커니즘을 통과하는 테스트를 넣고, App 층에도 하나 둔다.

- [ ] **Step 1: 분할의 실패하는 테스트를 쓴다**

`tests/unit/filterDiagnostics.test.ts` 의 `:23` 테스트를 바꾸고 두 개를 더한다:

```ts
  it('errors when every domain is unusable — no rule is registered at all', () => {
    // The opposite state from an empty list, and it used to share its kind.
    // An empty list registers a rule that matches every site; this registers
    // nothing. Same warning for both meant the band could not tell the user
    // which had happened (handoff §4.3).
    const d = validateFilter(profileWith({ domains: ['a b.com'] }));
    expect(d).toEqual([{
      kind: 'no-usable-domain',
      severity: 'error',
      profileId: 'p1',
      message: 'No usable domain — this profile is not applied to anything.',
    }]);
  });

  it('keeps empty-filter for an empty list, at warning, with its own message', () => {
    const d = validateFilter(profileWith({ domains: [] }));
    expect(d).toEqual([{
      kind: 'empty-filter',
      severity: 'warning',
      profileId: 'p1',
      message: 'No domain set — this profile applies to every site.',
    }]);
  });

  it('never raises empty-filter and no-usable-domain together', () => {
    // The two are exclusive by construction — `domains.length === 0` decides —
    // but the pair is what the split exists to keep apart, so it is asserted
    // rather than assumed.
    const kinds = (f: Partial<Filter>) => validateFilter(profileWith(f)).map((x) => x.kind);
    expect(kinds({ domains: [] })).toEqual(['empty-filter']);
    expect(kinds({ domains: ['a b.com'] })).toEqual(['no-usable-domain']);
    expect(kinds({ domains: ['a b.com', 'x y.com'] })).toEqual(['no-usable-domain']);
  });
```

`:16` 테스트는 위 두 번째 것으로 대체되므로 지운다. `:42` 와 `:112` 도 고친다:

```ts
  it('does not report port-ignored when the port-bearing host is itself unusable', () => {
    const d = validateFilter(profileWith({ domains: ['a b.com:3000'] }));
    expect(d.map((x) => x.kind)).toEqual(['no-usable-domain']);
  });
```

```ts
  it('never raises invalid-domain and the empty/unusable pair together', () => {
    // All six cases of the branches, so none can drift into another.
    // structured: empty goes to `empty-filter`, all-invalid to
    // `no-usable-domain`, mixed to `invalid-domain`. regex: neither of the
    // first two ever fires, so `invalid-domain` covers both mixed and
    // all-invalid, and an empty list stays quiet because the regex is the
    // condition. The regex row is why the split stops at structured mode:
    // changing it there would put two diagnostics on one state.
    const kinds = (f: Partial<Filter>) => validateFilter(profileWith(f)).map((x) => x.kind);
    const rx = { mode: 'regex', regex: '^https://' } as const;

    expect(kinds({ domains: [] })).toEqual(['empty-filter']);
    expect(kinds({ domains: ['a b.com'] })).toEqual(['no-usable-domain']);
    expect(kinds({ domains: ['ok.com', 'a b.com'] })).toEqual(['invalid-domain']);
    expect(kinds({ ...rx, domains: [] })).toEqual([]);
    expect(kinds({ ...rx, domains: ['a b.com'] })).toEqual(['invalid-domain']);
    expect(kinds({ ...rx, domains: ['ok.com', 'a b.com'] })).toEqual(['invalid-domain']);
  });
```

`:39` 의 `not.toContain('empty-filter')` 는 그대로 둔다 — 그 케이스(포트가 붙었지만 살아남은 도메인)는 어느 쪽도 나오면 안 되므로 두 이름을 다 확인하게 넓힌다:

```ts
  it('does not warn about an empty or unusable filter when a port-bearing domain survives', () => {
    const d = validateFilter(profileWith({ domains: ['localhost:3000'] }));
    expect(d.map((x) => x.kind)).toEqual(['port-ignored']);
  });
```

- [ ] **Step 2: 붉은지 확인한다**

```bash
npx vitest run tests/unit/filterDiagnostics.test.ts
```

기대: 새 세 테스트가 `no-usable-domain` 대신 `empty-filter` 를 받아 red.

- [ ] **Step 3: 종류를 늘리고 분할한다**

`lib/model/types.ts` 의 `DiagnosticKind` 에서 `empty-filter` 줄을 바꾼다:

```ts
  /** The domain list is empty, so the rule is registered with no domain condition. */
  | 'empty-filter'
  /**
   * Every domain in the list is unusable, so the compiler suppresses the whole
   * profile and no rule is registered at all. The opposite outcome from
   * `empty-filter`, which is why it stopped sharing that kind (spec §5.2).
   */
  | 'no-usable-domain'
```

`lib/compile/filterDiagnostics.ts` 의 마지막 블록을 바꾼다:

```ts
  // Two opposite outcomes, and they used to share one kind. An empty list
  // compiles to a rule with no domain condition, which DNR matches against
  // every site — surprising, but working, so `warning`. A list where nothing
  // is usable compiles to no rule at all, so the profile is silently dead —
  // `error`, which is also what puts the marker on its tab without the display
  // layer having to ask about suppression (spec §5.2).
  //
  // Structured mode only. In regex mode the `invalid-domain` branch above has
  // already fired and returned, so reaching for a second kind here would put
  // two diagnostics on one state.
  if (filter.domains.length === 0) {
    diagnostics.push({
      kind: 'empty-filter',
      severity: 'warning',
      profileId: profile.id,
      message: 'No domain set — this profile applies to every site.',
    });
  } else if (!analyses.some((a) => a.valid)) {
    diagnostics.push({
      kind: 'no-usable-domain',
      severity: 'error',
      profileId: profile.id,
      message: 'No usable domain — this profile is not applied to anything.',
    });
  }
```

- [ ] **Step 4: 초록인지 확인하고 compile 층을 맞춘다**

```bash
npx vitest run tests/unit/filterDiagnostics.test.ts
```

기대: 전부 통과.

`tests/unit/compile.test.ts:208` 부근의 단언을 고친다:

```ts
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.kind).toBe('no-usable-domain');
    expect(result.diagnostics[0]?.severity).toBe('error');
    expect(result.dynamic).toHaveLength(0);
```

`:133` 은 빈 목록 케이스이므로 `['empty-filter']` 그대로 둔다.

그리고 **꺼진 프로필은 진단을 하나도 받지 않는다**는 사실을 못 박는 테스트가 `compile.test.ts` 에 있는지 확인하고, 없으면 더한다 — Task 9 가 지우는 `ProfileBar` 의 `p.enabled` 가드가 여기로 옮겨오는 책임이다:

```ts
  it('collects no diagnostic at all for a switched-off profile, however broken it is', () => {
    // compile.ts:28 continues before diagnostics are gathered, deliberately
    // (:31-33): a profile the user switched off is not one they want
    // complaints about. After the display layer stopped asking about
    // suppression (spec §5.2) this is the only thing keeping a dead, disabled
    // profile's tab clean, so it is asserted here rather than left implicit.
    const base = profile();
    const result = compile(state({
      profiles: [profile({
        enabled: false,
        filter: { ...base.filter, domains: ['https://staging.example.com'] },
      })],
    }));
    expect(result.diagnostics).toEqual([]);
    expect(result.dynamic).toEqual([]);
  });
```

- [ ] **Step 5: `profileMarker` 의 우회를 되돌린다**

`lib/view/grid.ts` 에서 `ProfileLiveness` 인터페이스와 그 주석 블록을 통째로 지우고, `profileMarker` 를 바꾼다:

```ts
/**
 * What the profile tab should show for a profile the user is not looking at.
 *
 * compile() reports on every profile, but the popup renders one at a time —
 * without this, a broken profile two tabs over is invisible, which is the same
 * silent failure the diagnostics exist to remove.
 *
 * Two states earn a marker. An error means the profile does not work, and a
 * missing permission means it registered and does nothing. Other warnings are
 * worth saying in the band but do not mean the profile is broken, so the tab
 * stays clean — a marker that fires on everything gets ignored.
 *
 * Suppression used to come in as a separate parameter, because severity could
 * not carry it: a profile whose domains were *all* unusable earned
 * `empty-filter` at severity `warning` while compile.ts emitted nothing for
 * it. Splitting that case out as `no-usable-domain` at severity `error`
 * (spec §5.2) moved the judgement back to where compile() makes it, so the
 * severity rule catches it here and the same decision no longer lives in two
 * places — the shape of Phase 2a's most expensive defect.
 */
export function profileMarker(
  diagnostics: readonly Diagnostic[],
  profileId: string,
): ProfileMarker {
  let permission = false;
  for (const diagnostic of diagnostics) {
    if (diagnostic.profileId !== profileId) continue;
    if (diagnostic.severity === 'error') return 'error';
    if (diagnostic.kind === 'permission-missing') permission = true;
  }
  return permission ? 'permission' : null;
}
```

`components/ProfileBar.tsx` 에서 `isSuppressed` 임포트를 지우고 호출을 바꾼다:

```tsx
          const marker = profileMarker(diagnostics, p.id);
```

그리고 그 컴포넌트의 doc 주석에서 억제와 `p.enabled` 게이팅을 설명하는 두 문단을 아래 한 문단으로 바꾼다:

```
 * The marker reads severity and nothing else. It used to take suppression as
 * a separate signal, because a profile with every domain unusable earned only
 * a warning; `no-usable-domain` is an error, so that detour is gone (spec
 * §5.2). A switched-off profile still shows nothing, for the reason it always
 * did — compile.ts:28 gathers no diagnostic for it at all, deliberately, and
 * the display layer must not shout what the diagnostics layer withholds.
```

- [ ] **Step 6: `grid.test.ts` 의 세 케이스를 판정대로 처리한다**

`describe('profileMarker')` 에서 `const alive = { suppressed: false };` 를 지우고, 남은 호출에서 세 번째 인자를 전부 뺀다. `:125` · `:134` · `:142` 세 테스트를 지우고 그 자리에 넣는다:

```ts
  it('is error for a profile whose domains are all unusable', () => {
    // The mechanism that replaced the `liveness` parameter. Before the split
    // this profile earned `empty-filter` at severity `warning` and its tab
    // stayed clean while compile() emitted nothing for it; `no-usable-domain`
    // is an error, so the severity rule catches it with no second signal.
    expect(profileMarker([diag({ kind: 'no-usable-domain', severity: 'error' })], 'p1'))
      .toBe('error');
  });

  it('is still null for the empty-filter warning, which is the opposite outcome', () => {
    // An empty domain list registers a rule that matches every site — worth
    // saying in the band, not worth marking the tab. Marking both would put
    // the split back where it started.
    expect(profileMarker([diag({ kind: 'empty-filter', severity: 'warning' })], 'p1'))
      .toBeNull();
  });
```

- [ ] **Step 7: `ProfileBar.test.tsx` 의 두 케이스를 새 메커니즘으로 옮긴다**

`:104` 의 테스트를 바꾼다:

```tsx
  it('marks an inactive profile whose domains are all unusable', () => {
    // The tab is the only place this profile can be reported — the band is
    // scoped to the active profile, so nothing anywhere said Staging was dead
    // until you clicked it. Same input as Phase 2a's worst defect: a URL
    // pasted into the domain field. Since the split it arrives as an error,
    // so the bar needs no second signal to see it.
    const dead = { ...prof('p2', 'Staging', 1) };
    dead.filter = { ...dead.filter, domains: ['https://staging.example.com'] };
    render(
      <ProfileBar
        {...base}
        profiles={[base.profiles[0]!, dead]}
        diagnostics={[diag({ kind: 'no-usable-domain', severity: 'error', profileId: 'p2' })]}
      />,
    );
    expect(screen.getByRole('tab', { name: /Staging/ }).getAttribute('data-marker')).toBe('error');
    // Local's domains are untouched, so a dead neighbour must not spill onto
    // it — a bar that marked every tab as soon as one was dead would pass the
    // line above on its own.
    expect(screen.getByRole('tab', { name: /Local/ }).getAttribute('data-marker')).toBeNull();
  });
```

`:127` 의 테스트를 바꾼다 — 진단의 유무가 답을 정한다는 형태로:

```tsx
  it('leaves a switched-off profile unmarked, keeping the silence compile() keeps for it', () => {
    // compile.ts:28 skips a disabled profile before it collects any diagnostic
    // at all, and the comment at :31-33 says why. The bar no longer asks about
    // `enabled` itself — it renders what it is given — so the fixture states
    // exactly what compile() would produce: a diagnostic for the enabled dead
    // profile, none for the disabled one.
    //
    // Local holds the other side of it in the same render — dead the same way
    // but still enabled — so this pins the answer to the diagnostic rather
    // than to the bar having gone quiet.
    const off = { ...prof('p2', 'Staging', 1), enabled: false };
    off.filter = { ...off.filter, domains: ['https://staging.example.com'] };
    const on = { ...prof('p1', 'Local') };
    on.filter = { ...on.filter, domains: ['https://local.example.com'] };
    render(
      <ProfileBar
        {...base}
        profiles={[on, off]}
        diagnostics={[diag({ kind: 'no-usable-domain', severity: 'error', profileId: 'p1' })]}
      />,
    );
    expect(screen.getByRole('tab', { name: /Staging/ }).getAttribute('data-marker')).toBeNull();
    expect(screen.getByRole('tab', { name: /Local/ }).getAttribute('data-marker')).toBe('error');
  });
```

`:145` (`leaves a profile with a usable domain alongside an unusable-looking one unmarked`) 는 진단을 넘기지 않으므로 그대로 통과한다 — 확인만 한다.

- [ ] **Step 8: App 층에서 전 경로가 맞물리는지 못 박는다**

`tests/unit/App.test.tsx` 의 `describe('App')` 끝에 넣는다. Task 8 의 토글이 이 상태를 도달 가능하게 만들었으므로 여기서 함께 본다:

```tsx
  it('marks the dead profile\'s tab and leaves the switched-off one clean, end to end', async () => {
    // The whole pipeline in one render: compile() gathers no diagnostic for
    // the disabled profile (:28), the enabled one earns `no-usable-domain` at
    // error severity, and the bar marks from severity alone. Before the split
    // this needed a suppression signal threaded through the display layer.
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([]);
    const a = createProfile('Alpha', 0);
    const b = createProfile('Beta', 1);
    await seed({
      version: 1,
      globalPause: false,
      theme: 'system',
      profiles: [
        { ...a, id: 'pA', filter: { ...a.filter, domains: ['https://pasted.example.com'] } },
        { ...b, id: 'pB', enabled: false, filter: { ...b.filter, domains: ['https://pasted.example.com'] } },
      ],
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Alpha/ }).getAttribute('data-marker')).toBe('error');
    });
    expect(screen.getByRole('tab', { name: /Beta/ }).getAttribute('data-marker')).toBeNull();
  });
```

- [ ] **Step 9: 새 단언이 실제로 실패할 수 있는지 확인한다**

1. `filterDiagnostics.ts` 의 `no-usable-domain` severity 를 `'warning'` 으로 바꾼다 → `errors when every domain is unusable…` · `is error for a profile whose domains are all unusable` · App 의 `marks the dead profile's tab…` **3건 red**. 이것이 우회를 지워도 안전하다는 증거다.
2. 분할 조건을 뒤집는다(`if (!analyses.some(...))` 를 먼저 검사) → `keeps empty-filter for an empty list…` **red**.
3. `profileMarker` 에서 `if (diagnostic.severity === 'error') return 'error';` 를 지운다 → 여러 건 red.
4. `ProfileBar` 에 `p.enabled` 게이팅을 되살린다 → 되살려도 초록인지 확인한다. **초록이면 그 게이팅이 이제 무의미하다는 뜻이고, 지운 것이 옳다.** 원복한다.

전부 확인 후 원복.

- [ ] **Step 10: 전체 검사와 커밋**

```bash
npm test && npx tsc --noEmit
git add lib/model/types.ts lib/compile/filterDiagnostics.ts lib/view/grid.ts components/ProfileBar.tsx tests/unit/filterDiagnostics.test.ts tests/unit/compile.test.ts tests/unit/grid.test.ts tests/unit/ProfileBar.test.tsx tests/unit/App.test.tsx
git commit -m "fix: 빈 도메인과 전부 무효인 도메인을 다른 진단으로 가른다"
```

---

## Task 10: E2E — 탭 잠금이 실제로 탭을 가른다

**Files:**
- Create: `tests/e2e/tab-lock.spec.ts`

**Interfaces:**
- Consumes: Task 6·7 이 만든 전체 경로. 다만 시드는 서비스 워커가 `chrome.storage.local` 에 직접 하므로 **`activeTab` 에도 팝업에도 의존하지 않는다** — 잠금이 룰을 실제로 가르는지만 본다.
- Produces: 없음

이 단계에서 **이것 하나가 다른 모든 단언보다 무겁다**(스펙 §7). 나머지는 전부 이 동작이 맞다는 전제 위에 있다.

**"잠근 탭에서 헤더가 바뀐다"만으로는 탭 잠금이 전혀 없는 빌드도 통과한다.** 의미를 지고 있는 것은 부정 절반 — **다른 탭에서는 바뀌지 않는다** — 이고, 둘은 **같은 실행에서 같은 픽스처를 상대로** 있어야 한다. 두 스펙 파일로 나누면 각각이 자기 절반만 지키고 서로의 전제를 검사하지 않는다.

세 번째 단언도 필수다: **다른 탭의 요청이 실제로 에코 서버에 도착했는가.** 도착하지 않았으면 "헤더가 없다"는 공허하게 참이다. 같은 파일의 `a remove rule strips a header…` 가 `X-Keep-Me` 로 하는 것과 같은 대조군이다.

- [ ] **Step 1: 실패하는 E2E 를 쓴다**

`tests/e2e/tab-lock.spec.ts`:

```ts
import { expect, test } from './fixtures';
import { startEchoServer, type EchoServer } from './echo-server';

/**
 * `worker.evaluate()` callbacks run inside the extension's service worker,
 * where `chrome` exists at runtime — but `@types/chrome` is not in this
 * project's type program, so `tsc --noEmit` would report TS2503 without a
 * declaration. Declaring only the surface these tests touch keeps the
 * dependency explicit rather than reaching for `any`.
 */
declare const chrome: {
  storage: { local: { set(items: Record<string, unknown>): Promise<void> } };
  tabs: { query(info: { url: string }): Promise<Array<{ id?: number }>> };
  declarativeNetRequest: {
    getSessionRules(): Promise<Array<{ id: number }>>;
    getDynamicRules(): Promise<Array<{ id: number }>>;
  };
};

let echo: EchoServer;

test.beforeEach(async () => {
  echo = await startEchoServer();
});

test.afterEach(async () => {
  await echo.close();
});

test('a tab-locked profile changes headers in the locked tab and nowhere else', async ({
  context,
  serviceWorker,
}) => {
  const worker = serviceWorker;

  // The tab to lock has to exist before its id can be stored, so it is opened
  // first and navigated somewhere harmless — this request predates the rule
  // and is not what the assertions read.
  const lockedTab = await context.newPage();
  await lockedTab.goto(`${echo.origin}/before-lock`);

  // The e2e build declares host_permissions for http://127.0.0.1/*, so the
  // worker can query by url. Only one loopback tab is open at this point.
  const lockedTabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
    return tabs[0]?.id ?? null;
  });
  expect(lockedTabId, 'the tab to lock was found by the service worker').not.toBeNull();

  await worker.evaluate(async ({ state }) => {
    // `local:state` maps to the chrome.storage.local key `state`. WXT keeps the
    // item's version alongside it at `state$`; seed both so the versioned item
    // is not read as un-versioned.
    await chrome.storage.local.set({ state, state$: { v: 1 } });
  }, {
    state: {
      version: 1,
      globalPause: false,
      theme: 'system',
      profiles: [{
        id: 'p1',
        name: 'Locked',
        color: 'green',
        enabled: true,
        order: 0,
        filter: {
          mode: 'structured',
          domains: ['127.0.0.1'],
          excludedDomains: [],
          // Explicit: the DNR default excludes main_frame, which page.goto() is.
          resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
        },
        tabLock: { enabled: true, tabId: lockedTabId, tabTitle: 'echo' },
        headers: [
          { id: 'h1', enabled: true, target: 'request',
            operation: 'set', name: 'X-Headerlab-Locked', value: 'applied' },
        ],
      }],
    },
  });

  // A live tab lock compiles to a *session* rule, never a dynamic one
  // (lib/compile/priority.ts). Both halves are polled: a build that ignored
  // the lock would put the rule in the dynamic set, where it would apply to
  // every tab — and that build would still satisfy a poll on "some rule
  // exists".
  await expect
    .poll(async () => worker.evaluate(async () => ({
      session: (await chrome.declarativeNetRequest.getSessionRules()).length,
      dynamic: (await chrome.declarativeNetRequest.getDynamicRules()).length,
    })), { timeout: 10_000 })
    .toEqual({ session: 1, dynamic: 0 });

  // Same fixture, same run, two tabs. The negative half is what carries the
  // meaning — "headers change in the locked tab" alone passes against a build
  // with no tab lock at all — so both are asserted here rather than split
  // across two tests that could each hold on their own.
  await lockedTab.goto(`${echo.origin}/locked`);

  const otherTab = await context.newPage();
  await otherTab.goto(`${echo.origin}/other`);

  const locked = echo.requests.find((r) => r.url === '/locked');
  const other = echo.requests.find((r) => r.url === '/other');

  // Positive control first: without it, "the header is absent from /other"
  // would hold vacuously if the request never arrived at all.
  expect(locked, 'the echo server received the locked tab\'s navigation').toBeTruthy();
  expect(other, 'the echo server received the other tab\'s navigation').toBeTruthy();

  expect(locked!.headers['x-headerlab-locked']).toBe('applied');
  expect(other!.headers['x-headerlab-locked']).toBeUndefined();

  await lockedTab.close();
  await otherTab.close();
});

test('the background releases the lock when the locked tab closes', async ({
  context,
  serviceWorker,
}) => {
  // Spec §4.3's `tabs.onRemoved` leg, at the layer where the browser actually
  // fires the event — fake-browser can only be told the listener was called.
  const worker = serviceWorker;

  const lockedTab = await context.newPage();
  await lockedTab.goto(`${echo.origin}/before-lock`);

  const lockedTabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
    return tabs[0]?.id ?? null;
  });
  expect(lockedTabId).not.toBeNull();

  await worker.evaluate(async ({ state }) => {
    await chrome.storage.local.set({ state, state$: { v: 1 } });
  }, {
    state: {
      version: 1,
      globalPause: false,
      theme: 'system',
      profiles: [{
        id: 'p1', name: 'Locked', color: 'green', enabled: true, order: 0,
        filter: {
          mode: 'structured', domains: ['127.0.0.1'], excludedDomains: [],
          resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
        },
        tabLock: { enabled: true, tabId: lockedTabId, tabTitle: 'echo' },
        headers: [
          { id: 'h1', enabled: true, target: 'request',
            operation: 'set', name: 'X-Headerlab-Locked', value: 'applied' },
        ],
      }],
    },
  });

  await expect
    .poll(async () => worker.evaluate(async () =>
      (await chrome.declarativeNetRequest.getSessionRules()).length), { timeout: 10_000 })
    .toBe(1);

  await lockedTab.close();

  // Three legs, because each alone admits a wrong implementation: the lock is
  // off in stored state, the session rule is gone, and — the one that matters
  // — the profile did **not** fall back to a dynamic rule applying everywhere.
  // A release that only cleared `tabId` would leave `enabled` true and
  // priority.ts would route it to the dynamic set (spec §4.3).
  await expect
    .poll(async () => worker.evaluate(async () => {
      const stored = await new Promise<Record<string, unknown>>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (chrome as any).storage.local.get('state', resolve);
      });
      const state = stored.state as { profiles: Array<{ tabLock: { enabled: boolean; tabId: number | null } }> };
      return {
        lock: state.profiles[0]?.tabLock ?? null,
        session: (await chrome.declarativeNetRequest.getSessionRules()).length,
        dynamic: (await chrome.declarativeNetRequest.getDynamicRules()).length,
      };
    }), { timeout: 10_000 })
    .toEqual({ lock: { enabled: false, tabId: null, tabTitle: null }, session: 0, dynamic: 0 });
});
```

두 번째 테스트의 `chrome` 선언에 `storage.local.get` 이 필요하므로, 파일 상단 선언을 넓힌다:

```ts
declare const chrome: {
  storage: {
    local: {
      set(items: Record<string, unknown>): Promise<void>;
      get(keys: string): Promise<Record<string, unknown>>;
    };
  };
  tabs: { query(info: { url: string }): Promise<Array<{ id?: number }>> };
  declarativeNetRequest: {
    getSessionRules(): Promise<Array<{ id: number }>>;
    getDynamicRules(): Promise<Array<{ id: number }>>;
  };
};
```

그리고 두 번째 테스트의 `storage.local.get` 호출을 콜백이 아니라 프로미스로 바꾼다:

```ts
      const stored = await chrome.storage.local.get('state');
      const state = stored.state as {
        profiles: Array<{ tabLock: { enabled: boolean; tabId: number | null; tabTitle: string | null } }>;
      };
```

- [ ] **Step 2: 붉은지 확인한다**

```bash
npm run test:e2e
```

기대: 새 두 테스트가 실패한다. **실패 이유를 읽는다** — `session: 1, dynamic: 0` 대신 무엇이 왔는지가 잠금이 어디서 끊겼는지를 말한다.

- [ ] **Step 3: 초록으로 만든다**

Task 6·7 이 이미 구현을 끝냈으므로 여기서 새로 만들 코드는 없다. 붉으면 **테스트가 아니라 구현을 고친다.** 흔한 원인 셋:

1. `resourceTypes` 에 `main_frame` 이 없다 → `page.goto` 가 매칭되지 않는다.
2. `tabLock.tabId` 가 `null` 로 시드됐다 → `priority.ts` 가 dynamic 으로 보내 `{session: 0, dynamic: 1}` 이 온다. 이 경우 `lockedTabId` 를 얻는 쿼리가 빈 배열을 받은 것이므로 `expect(lockedTabId).not.toBeNull()` 이 먼저 붉어야 한다.
3. 두 번째 테스트가 `dynamic: 1` 을 받는다 → 해제가 `enabled` 를 끄지 않고 `tabId` 만 비웠다는 뜻이다. `releaseLocks` 가 세 필드를 다 비우는지 본다.

```bash
npm run test:e2e
```

기대: 6 passed (기존 4 + 새 2).

- [ ] **Step 4: 부정 절반이 실제로 실패할 수 있는지 확인한다**

이 태스크에서 가장 중요한 스텝이다. **탭 잠금을 끈 빌드를 만들어 첫 테스트가 붉어지는지 본다.**

1. `lib/compile/priority.ts` 의 `const locked = profile.tabLock.enabled && typeof profile.tabLock.tabId === 'number';` 를 `const locked = false;` 로 바꾼다.
2. `npm run test:e2e` 를 돌린다.
3. 기대: `a tab-locked profile changes headers in the locked tab and nowhere else` **red**. 붉어지는 단언이 두 개여야 한다 — 룰 폴링(`{session:1,dynamic:0}` 대신 `{session:0,dynamic:1}`)과, 폴링을 통과시키더라도 `other!.headers['x-headerlab-locked']` 가 `'applied'` 로 온다.
4. **첫 테스트만 붉고 헤더 단언은 초록이면 그 테스트는 아무것도 지키지 않는 것이다** — 부정 절반을 다시 본다.
5. 원복하고 6 passed 를 확인한다.

이어서 대조군이 공허하지 않은지도 확인한다:

6. `otherTab.goto(...)` 줄을 지운다 → `the echo server received the other tab's navigation` **red** (`x-headerlab-locked` 부재 단언이 조용히 통과하지 않는다).
7. 원복.

- [ ] **Step 5: 커밋**

```bash
npm test && npm run test:e2e && npx tsc --noEmit
git add tests/e2e/tab-lock.spec.ts
git commit -m "test: 잠근 탭에서만 헤더가 바뀌는 것을 실제 브라우저로 확인한다"
```

---

## 완료 기준

전부 끝났을 때:

```bash
npm test          # 26 → 33 파일, 377 → 약 470개
npm run test:e2e  # 4 → 6
npx tsc --noEmit  # 0
```

그리고 아래가 참이다:

- 팝업에서 `chrome.storage` 로 가는 쓰기 경로가 하나도 없다 (`writePath.test.ts` 가 지킨다)
- 프로덕션 매니페스트의 권한이 정확히 `['storage', 'declarativeNetRequestWithHostAccess', 'activeTab']` 이고 `host_permissions` 가 없다
- `DiagnosticKind` 가 11종이고, `tab-lock-stale` 이 실제로 방출된다
- `profileMarker` 가 인자 두 개를 받는다 — 억제 판단이 표시 층에 없다
- 배포 번들에 `fetch(` · `XMLHttpRequest` · `WebSocket` · `sendBeacon` 이 없다:
  ```bash
  grep -rE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon' .output/chrome-mv3/ ; echo "exit=$?"   # exit=1
  ```
- `package.json` 의 의존성이 `8c2ee24` 와 동일하다:
  ```bash
  git diff 8c2ee24 -- package.json package-lock.json   # 출력 없음
  ```
