# Agent Bridge — 3차 계획: 어댑터 · 팝업 · 인스톨러

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브리지를 실제로 동작하게 만든다. 1·2차가 만든 순수 층·호스트·CLI 는 서로 닿아 있지
않다 — 확장에는 `connectNative` 를 부르는 파일이 없고, 팝업에는 켜는 버튼이 없으며, Chrome 이
읽을 호스트 매니페스트를 쓰는 것이 없다. 이 셋을 채우면 `headerlab site add example.com` 이
브라우저의 저장소를 바꾼다.

**Architecture:** `lib/bridge/port.ts` 가 `chrome.runtime.connectNative` 를 부르는 유일한
파일이고, 받은 명령을 이미 있는 `parseCommand` → `apply()` → `setState` 로 흘려보낸다.
`stateItem.watch` 가 이미 `reconcile()` 을 부르므로 **새 writer 가 아니라 새 trigger** 다.
팝업은 세션 저장소에 적힌 브리지 상태를 읽어 리드아웃 카드의 넷째 줄로 보여준다. 인스톨러는
`packages/cli` 안에 있고 절대 경로 셔뱅을 가진 런처를 쓴 뒤 **그것을 직접 실행해 검증한다.**

**Tech Stack:** WXT · React 19 · zod 4 · Node 24 내장만 · `@types/chrome` (이미 설치됨)

## 읽을 것

- 설계: `docs/superpowers/specs/2026-08-11-agent-bridge-design.md` — §3.1, §5, §8 전부
- 실측: `docs/research/2026-08-11-native-messaging-spike.md`
- 인계: `docs/superpowers/specs/2026-08-12-agent-bridge-handoff.md`
- 시안: `docs/design/2026-08-11-agent-bridge-placement.html` (안 A)

**아래 "실측으로 확정된 사실"은 다시 유도하지 말 것.** 다만 브리프의 사실이 재현되지 않으면
멈추고 보고한다 — 1·2차에서 그 지시가 잘못된 사실 셋을 잡았다.

## 실측으로 확정된 사실

- **`browser.runtime.connectNative` 는 함수가 아니다.** WXT 래퍼가 노출하지 않는다.
  `chrome.runtime.connectNative` 를 직접 부른다. `@types/chrome` 이 설치돼 있어
  `chrome.runtime.Port` 타입은 그냥 쓸 수 있다(`node_modules/@types/chrome/index.d.ts:9600`).
- **`@webext-core/fake-browser` 의 `runtime.connectNative` 는 던지는 스텁**이다
  (`notMockedFunction("runtime.connectNative")`). 설계 §9 는 "정의하지 않는다"고 적었는데
  실제로는 정의돼 있고 던진다 — 효과는 같다. 테스트는 `browser` 가 아니라
  `globalThis.chrome` 에 스텁을 심는다.
- **하트비트도 `alarms` 도 넣지 않는다.** 열린 포트가 SW 를 7분 넘게 살려뒀다. 재연결은
  `background.ts` 가 이미 듣는 `onStartup`·`onInstalled`·`permissions.onAdded`/`onRemoved` 에
  얹고, `onDisconnect` 에 **제한된** 재시도만 더한다. 무제한은 인터프리터 부재·ID 불일치에서
  무한 루프가 된다.
- **`#!/usr/bin/env node` 는 Chrome 이 주는 환경에서 해석되지 않는다.** 스크립트가 0줄
  실행되고 확장이 받는 것은 `{"message":"Native host has exited."}` 한 줄뿐이다.
- **Chrome 의 에러 문구는 매니페스트 거부 · ID 불일치 · 인터프리터 부재 셋 모두에 대해
  동일하다.** 확장 쪽에서 구분할 수 없다 — 그래서 인스톨러가 자기 출력을 스스로 검증한다.
- **`allowed_origins` 는 와일드카드가 하드 파스 실패**이고 정확한 `chrome-extension://<ID>/`
  여야 한다.
- **unpacked ID 는 로드 경로 바이트의 SHA-256 앞 16바이트를 `0-f` → `a-p` 로 매핑한 것.**
  측정된 쌍: `/Users/penguin/dev/headerlab/.output/chrome-mv3` →
  `emdiklpbkfcdhnljlaikoclahpkjledp`.
- **호스트 매니페스트 디렉터리는 user-data-dir 파생**이다. macOS Chrome:
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`.
- **Chrome 이 호스트에 주는 argv 는 확장 origin 하나뿐이다.** 소켓 이름이 pid 를 다는 이유.

## 이 3차에서 내리는 설계 판단 둘

**1. `Bridge idle` 의 정의를 바꾼다.** 설계 §5 의 표는 가운데 상태를 "권한 있음, CLI 안 붙음"
이라고 적었다. 확장은 CLI 가 소켓에 붙었는지 **알 수 없다** — 호스트만 안다. 호스트가 그것을
확장에 알리게 하면 `packages/cli/lib/bridge.mjs` 의 `sendCommand` 독블록이 "상관관계를
릴레이에 밀어넣으면 파이프가 프로토콜 참여자가 된다"고 논증해둔 선을 호스트가 넘는다.

그래서 세 상태를 **확장이 관측할 수 있는 것**으로 다시 놓는다:

| 상태 | 뜻 | 점 | 라벨 | 오른쪽 |
|---|---|---|---|---|
| off | `nativeMessaging` 권한 없음 | `muted-foreground` | Bridge off | `Enable` |
| idle | 권한 있음, 포트 안 열림 | `muted-foreground` | Bridge idle | `Disable` |
| live | 포트 열림 | `live` | Bridge live | `Disable` |

라벨·점 색·버튼·기하는 설계 그대로다. 바뀐 것은 가운데의 **뜻**뿐이고, 그 뜻은 더 유용하다 —
`idle` 이 정확히 "Enable 은 눌렀는데 `headerlab bridge install` 을 안 돌렸다"는, 사용자가
실제로 가장 많이 만날 상태를 가리킨다. 포트가 열려 있으면 CLI 는 언제든 붙을 수 있으므로
`live` 는 "지금 붙어 있다"보다 강한 안전 진술이기도 하다.

네 번째 내부 상태 `unknown`(권한 프로브가 아직 답하지 않음)이 있다. all-sites 행의
`allSitesGranted: null` 과 **정확히 같은 이유**로 존재하고 같은 방식으로 렌더된다 — 색 없는
점, `Bridge` 라는 라벨, 빈 버튼 칸. 기하는 동일하다.

**2. 저장소를 읽을 수 없으면 브리지 쓰기를 거절한다.** `loadState()` 가 `valid: false` 를
주면 `apply()` 를 부르지 않는다. 부르면 `DEFAULT_STATE` 위에 얹혀 사용자의 바이트를
덮어쓴다 — `App.tsx:70-82` 가 팝업에서 이미 값을 치른 그 결함이다. 새 에러 코드
`store-unreadable` 로 거절한다.

## Global Constraints

- **새 의존성 0개.** `@types/chrome` 은 이미 설치돼 있다.
- **설치 시점 `permissions` 는 한 글자도 바뀌지 않는다.** `["storage",
  "declarativeNetRequestWithHostAccess"]` 그대로. `nativeMessaging` 은
  `optional_permissions` 로만 간다.
- **`pnpm` 이 이 기계에서 깨져 있다.** 래퍼를 PATH 앞에 둔다:
  `PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH"`. `pnpm check` 가
  자기를 재귀 호출하므로 디렉터리가 PATH **앞**이어야 한다. **`pnpm install` 은 돌리지
  않는다.**
- **`pnpm test` 를 쓴다. 맨손 `vitest run` 금지** — 빌드를 읽는 테스트가 여럿이다.
  **`pnpm test -- <파일>` 은 필터가 안 걸린다.** 인자를 그냥 준다: `pnpm test protocol`.
- **`node --test packages/cli` 는 그 경로를 파일로 읽는다.** 패키지 안에서 돌린다.
- 스모크 테스트로 호스트를 띄웠으면 **반드시 정리한다.** 좀비는 SIGTERM 으로 안 죽고
  SIGKILL 로 죽으며 `pnpm -r test` 를 간헐적으로 깬다.
- **커밋은 영어**, `<type>: <description>`. **`docs/` 문서는 한국어, 코드 주석은 영어.**
- **변이 검증은 커밋 후에.** `git checkout --` 이 이 브랜치에서 미커밋 작업을 두 번 날렸다.
- **불변성**: 새 객체를 반환한다.
- **모든 단언에 대해 묻는다: 어떤 잘못된 구현이 이걸 통과하는가?** 이 브랜치에서 나온 결함
  열여섯 중 열하나가 "없는 단언"과 "실패할 수 없는 단언"이었고 스위트가 잡은 것은 0이다.
- oxlint `require-to-throw-message` 가 켜져 있다 — 맨 `toThrow()` 는 린트 실패. 클래스 인자는
  통과한다(실측).
- jsdom 이 필요한 테스트 파일은 `// @vitest-environment jsdom` 독블록을 단다.
  **`@testing-library/jest-dom` 은 없다** — `toBeInTheDocument` 금지.
- **컨트롤이 나타난다고 그것을 담은 것이 크기를 바꾸면 안 된다.** 상태는 외양을 바꾸고
  기하를 바꾸지 않는다.

## 이 계획이 하지 않는 것 — 그리고 왜 적어 두는가

설계 §3 의 명령 표에는 아직 아무 단계도 만들지 않은 것이 넷 있다. 3차가 그것들을 만들지 않는
것은 판단이지 누락이 아니고, **적어 두지 않으면 다음 사람이 "빠뜨렸구나" 로 읽는다.**

- `headerlab status` · `headerlab diagnostics` · `headerlab state get` · `rule ls` — 읽기
  전용 명령들. 지금은 **성공한 쓰기의 응답이 상태를 통째로 실어 오므로** 읽을 방법이 없지는
  않다(SKILL.md 가 그렇게 적고 있다). 읽기 명령은 쓰기 경로에 손대지 않는 순수한 덧셈이라
  3차의 세 조각과 얽히지 않는다. 4차로 미룬다.
- `headerlab state snapshots | restore <id>` — **이것은 다르다.** 설계 §2 의 신뢰 모델이
  "통째 쓰기는 검증과 **스냅샷**을 통과한다" 고 약속하는데, `state.set` 은 검증만 통과하고
  스냅샷은 존재하지 않는다. README 는 이 약속을 하지 않으므로 **밖으로 나간 거짓 주장은
  없다.** 그러나 spec 은 하고 있다. Task 7 이 spec 을 사실에 맞춘다 — 약속을 지우는 것이
  아니라 아직 구현되지 않았다고 적는 것이다. 구현 자체는 4차다.

## 파일 구조

| 파일 | 성격 | 태스크 |
|---|---|---|
| `wxt.config.ts` | 수정 — `optional_permissions` | 1 |
| `lib/permissions/probe.ts` | 수정 — 권한 셋 추가 | 1 |
| `lib/storage/session.ts` | 수정 — `BridgeStatus` | 2 |
| `lib/bridge/protocol.ts` | 수정 — 에러 코드 둘 | 2 |
| `lib/bridge/port.ts` | 신규 — 어댑터. **purity 가드에 넣지 않는다** | 2 |
| `entrypoints/background.ts` | 수정 — 트리거 배선 | 2 |
| `components/ScopeRail.tsx` | 수정 — 브리지 줄과 노트 | 3 |
| `entrypoints/popup/App.tsx` | 수정 — 상태 구독과 핸들러 | 3 |
| `packages/host/lib/manifest.mjs` | 신규 — 매니페스트·런처·ID 계산 | 4 |
| `packages/cli/lib/install.mjs` | 신규 — 설치·제거·상태, 자기 검증 | 4 |
| `packages/cli/lib/args.mjs` | 수정 — `bridge` 서브커맨드 | 5 |
| `packages/cli/bin/headerlab.mjs` | 수정 — 소켓을 타지 않는 분기 | 5 |
| `packages/plugin/skills/headerlab/SKILL.md` | 수정 | 5 |
| `tests/e2e/bridge.spec.ts` | 신규 — 사슬 전체 | 6 |
| README · CLAUDE.md · 설계 spec | 수정 | 7 |

---

### Task 1: `nativeMessaging` 권한 — 매니페스트, 가드, 권한 어댑터

**Files:**
- Modify: `wxt.config.ts`
- Modify: `tests/unit/manifest.test.ts`
- Modify: `lib/permissions/probe.ts`
- Modify: `tests/unit/probe.test.ts`

**Interfaces:**
- Produces: `probeNativeMessaging(): Promise<boolean>`,
  `requestNativeMessaging(): Promise<boolean>`, `removeNativeMessaging(): Promise<boolean>`,
  `NATIVE_MESSAGING: 'nativeMessaging'` — 전부 `@/lib/permissions/probe` 에서.

- [ ] **Step 1: 매니페스트 가드부터 쓴다 (실패하는 테스트)**

`tests/unit/manifest.test.ts` 의 `describe('production manifest', …)` 안, `'declares exactly
the two permissions actually used …'` 테스트 **뒤에** 추가한다:

```ts
  it('declares nativeMessaging as optional, exactly — the bridge asks for it at runtime', () => {
    // §8.1: `permissions_parser.cc` drops an optional-ineligible permission
    // from the list and leaves only an install warning, and the one
    // consistency check is a DCHECK compiled out of release builds. So a
    // Chrome change that made this permission non-optional would fail
    // *silently*: the key would still be here and the request would never
    // succeed. Pinning the exact value is what makes the e2e in Task 6 —
    // which drives a real request through a real Chrome — the thing that
    // would notice.
    expect(readManifest().optional_permissions).toEqual(['nativeMessaging']);
  });

  it('keeps the install-time permission list byte-identical after adding it', () => {
    // The whole point of the optional route. This assertion is the one that
    // fails if someone "fixes" a connect error by moving the permission into
    // `permissions` — which would work, and would silently trade away the
    // zero-permission install posture this product is built on.
    expect(readManifest().permissions).toEqual(['storage', 'declarativeNetRequestWithHostAccess']);
  });
```

- [ ] **Step 2: 실패를 확인한다**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm test manifest
```

기대: 두 테스트 중 첫째가 `undefined` vs `['nativeMessaging']` 로 실패. 둘째는 이미 통과
(그게 정상이다 — 지금은 아무것도 안 바뀌었으니까).

- [ ] **Step 3: 매니페스트에 넣는다**

`wxt.config.ts` 의 `optional_host_permissions` 줄 **바로 아래**:

```ts
    optional_host_permissions: ['<all_urls>'],
    // Requested at runtime from the popup's Enable button, never at install.
    // `extensions_api_permissions.cc:113-114` carries no `kFlagCannotBeOptional`
    // for this one (declarativeNetRequest does, at :57-59), and the runtime
    // grant was measured rather than inferred — the consent dialog appeared,
    // allowing it worked, and a second click went straight to connectNative
    // (docs/research/2026-08-11-native-messaging-spike.md).
    optional_permissions: ['nativeMessaging'],
```

- [ ] **Step 4: 통과를 확인한다**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm test manifest
```

기대: 전부 PASS.

- [ ] **Step 5: 권한 어댑터 테스트를 쓴다 (실패하는 테스트)**

`tests/unit/probe.test.ts` 끝에 추가한다. 임포트 줄도 함께 고친다:

```ts
import {
  probeAllSites,
  probeGrants,
  probeNativeMessaging,
  removeNativeMessaging,
  requestHost,
  requestNativeMessaging,
} from '@/lib/permissions/probe';
```

(기존 임포트 목록에 맞춰 정렬만 유지한다. 기존에 없던 이름만 더한다.)

```ts
type PermissionsArg = { permissions?: string[]; origins?: string[] };

describe('the nativeMessaging permission', () => {
  it('probes the permission key, never an origin — it is not a host', async () => {
    // A copy-paste from probeAllSites would send `{origins: ['nativeMessaging']}`,
    // which `contains()` answers `false` to without complaining. The shape of
    // the argument is the whole of what distinguishes the two calls, so it is
    // what gets asserted.
    const asked: PermissionsArg[] = [];
    vi.spyOn(perms(), 'contains').mockImplementation((async (p: PermissionsArg) => {
      asked.push(p);
      return true;
    }) as never);

    await expect(probeNativeMessaging()).resolves.toBe(true);
    expect(asked).toEqual([{ permissions: ['nativeMessaging'] }]);
  });

  it('reports not-granted rather than propagating a throw', async () => {
    vi.spyOn(perms(), 'contains').mockImplementation((() => {
      throw new Error('not implemented');
    }) as never);

    await expect(probeNativeMessaging()).resolves.toBe(false);
  });

  it('requests exactly that permission and nothing else', async () => {
    const asked: PermissionsArg[] = [];
    vi.spyOn(perms(), 'request').mockImplementation((async (p: PermissionsArg) => {
      asked.push(p);
      return true;
    }) as never);

    await expect(requestNativeMessaging()).resolves.toBe(true);
    // No `origins` key at all. Asking for a host alongside it would smuggle a
    // host grant into a dialog the user reads as being about the bridge.
    expect(asked).toEqual([{ permissions: ['nativeMessaging'] }]);
  });

  it('reports a declined request as false rather than throwing', async () => {
    vi.spyOn(perms(), 'request').mockImplementation((async () => false) as never);
    await expect(requestNativeMessaging()).resolves.toBe(false);
  });

  it('removes exactly that permission', async () => {
    const asked: PermissionsArg[] = [];
    vi.spyOn(perms(), 'remove').mockImplementation((async (p: PermissionsArg) => {
      asked.push(p);
      return true;
    }) as never);

    await expect(removeNativeMessaging()).resolves.toBe(true);
    expect(asked).toEqual([{ permissions: ['nativeMessaging'] }]);
  });

  it('reports a failed removal as false — the bridge stays reachable and must say so', async () => {
    // Returning `true` on a throw would leave the popup claiming the bridge is
    // off while the permission is still held and the port can still open.
    vi.spyOn(perms(), 'remove').mockImplementation((() => {
      throw new Error('not implemented');
    }) as never);

    await expect(removeNativeMessaging()).resolves.toBe(false);
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm test probe
```

기대: 임포트가 없어서 여섯 개 전부 실패.

- [ ] **Step 7: 권한 어댑터를 구현한다**

`lib/permissions/probe.ts` 끝에 추가한다:

```ts
/**
 * The one permission the agent bridge needs, and the only optional
 * *permission* (as opposed to optional host permission) this extension
 * declares. Named once here so the popup, the adapter and the tests cannot
 * spell it three ways.
 */
export const NATIVE_MESSAGING = 'nativeMessaging';

/**
 * Whether the bridge permission is already held.
 *
 * `{permissions: [...]}`, never `{origins: [...]}` — this is not a host, and
 * `contains()` answers a nonsense origin with a calm `false` rather than an
 * error, so the wrong shape would read as "the user declined" forever.
 *
 * Throws are reported as not-granted for the same reason `covers()` does it:
 * a throw is not an answer, and this product's rule is that a state it cannot
 * establish is shown as the one that offers a remedy.
 */
export async function probeNativeMessaging(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ permissions: [NATIVE_MESSAGING] });
  } catch {
    return false;
  }
}

/**
 * Asks for the bridge permission. Must be called from a user gesture — the
 * popup's Enable button click is that gesture, and it is the only caller.
 *
 * Nothing else rides along in the request. The consent dialog Chrome draws is
 * the user's only view of what is being asked for, so bundling a host pattern
 * into the same call would put a grant they did not read behind a button
 * labelled Enable.
 */
export async function requestNativeMessaging(): Promise<boolean> {
  try {
    return await browser.permissions.request({ permissions: [NATIVE_MESSAGING] });
  } catch {
    return false;
  }
}

/**
 * Gives the bridge permission back. This is what "turning it off is physical"
 * means: without the permission the port cannot open, Chrome kills the host,
 * and the socket file disappears — there is no flag left that could claim the
 * bridge is alive.
 *
 * A failure is reported as `false` rather than swallowed. Reporting success
 * here would leave the popup saying the bridge is off while it is still
 * reachable, which is the exact direction of under-reporting this product
 * exists to rule out.
 */
export async function removeNativeMessaging(): Promise<boolean> {
  try {
    return await browser.permissions.remove({ permissions: [NATIVE_MESSAGING] });
  } catch {
    return false;
  }
}
```

- [ ] **Step 8: 통과를 확인한다**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm check
```

기대: typecheck · lint · format · test 전부 초록.

- [ ] **Step 9: 커밋**

```bash
git add wxt.config.ts tests/unit/manifest.test.ts lib/permissions/probe.ts tests/unit/probe.test.ts
git commit -m "feat: declare nativeMessaging as an optional permission"
```

- [ ] **Step 10: 변이 검증 (커밋 후)**

`wxt.config.ts` 의 `optional_permissions` 값을 `['nativeMessaging', 'tabs']` 로 바꾸고
`pnpm test manifest` 를 돌린다. 첫 테스트가 그 정확값으로 실패해야 한다. `git checkout --
wxt.config.ts` 로 되돌린다. 이어서 `probeNativeMessaging` 의 인자를 `{origins: [...]}` 로
바꾸고 `pnpm test probe` 가 빨개지는지 본다. 되돌린다. 결과를 보고서에 적는다.

---

### Task 2: `lib/bridge/port.ts` — 어댑터, 세션 상태, background 배선

**Files:**
- Modify: `lib/bridge/protocol.ts`
- Modify: `lib/storage/session.ts`
- Modify: `tests/unit/session.test.ts`
- Create: `lib/bridge/port.ts`
- Create: `tests/unit/port.test.ts`
- Modify: `entrypoints/background.ts`
- Modify: `tests/unit/purity.test.ts` (주석만 — 목록은 안 바뀐다)

**Interfaces:**
- Consumes: `parseCommand`, `apply`, `ApplyResult` (`@/lib/bridge/protocol`, `@/lib/bridge/apply`),
  `loadState`, `setState` (`@/lib/storage/state`), `probeNativeMessaging` (Task 1).
- Produces: `refreshBridge(): Promise<void>`, `disconnectBridge(): void`,
  `declaresRegexMode(payload: unknown): boolean`, `NATIVE_HOST_NAME`,
  `MAX_CONNECT_ATTEMPTS` — 전부 `@/lib/bridge/port` 에서.
  `BridgeStatus`, `bridgeStatusItem`, `getBridgeStatus`, `patchBridgeStatus`,
  `DEFAULT_BRIDGE_STATUS` — `@/lib/storage/session` 에서.

- [ ] **Step 1: 에러 코드 둘을 더한다**

`lib/bridge/protocol.ts` 의 `ApplyErrorCode` 를 바꾼다:

```ts
export type ApplyErrorCode =
  | 'invalid-command'
  | 'invalid-state'
  | 'unknown-rule'
  | 'unknown-domain'
  // The stored bytes failed validation. Distinct from `invalid-state`, which
  // is about the payload the caller sent: this one says the caller's command
  // was fine and there is nothing safe to apply it to. Applying onto the
  // fallback and writing the result would overwrite whatever was really on
  // disk — the defect App.tsx already paid for once (`if (!valid) return`).
  | 'store-unreadable'
  // Refused rather than failed. `state.set` can carry `filter.mode: 'regex'`,
  // which `appStateSchema` accepts and `filterToCondition` compiles straight
  // into `regexFilter` with nothing having asked
  // `chrome.declarativeNetRequest.isRegexSupported()`. The popup has no regex
  // editor, so a payload that sets one produces a rule nobody can see or fix.
  // Design §3.1 puts this refusal at the adapter, not in the pure layer.
  | 'unsupported';
```

- [ ] **Step 2: 세션 저장소 테스트를 쓴다 (실패하는 테스트)**

`tests/unit/session.test.ts` 끝에 추가한다 (임포트 줄도 함께 확장한다):

```ts
describe('bridge status', () => {
  it('defaults to disconnected with nothing said about it', async () => {
    // Not "connected: false plus a stale error from a previous session" — the
    // fallback is what a popup opening on a fresh worker renders, and an error
    // string in it would put a note on screen about something that never
    // happened.
    expect(await getBridgeStatus()).toEqual({
      connected: false,
      lastCommandAt: null,
      lastError: null,
    });
  });

  it('patches one field and leaves the rest of the record alone', async () => {
    // The whole reason a patch helper exists. `connect` writes `connected`,
    // an applied command writes `lastCommandAt`, and a disconnect writes
    // `lastError` — three writers, and a full-record write from any of them
    // erases what the other two said.
    await patchBridgeStatus({ lastCommandAt: '2026-08-12T00:00:00.000Z' });
    await patchBridgeStatus({ connected: true });

    expect(await getBridgeStatus()).toEqual({
      connected: true,
      lastCommandAt: '2026-08-12T00:00:00.000Z',
      lastError: null,
    });
  });

  it('can clear a field back to null', async () => {
    // `{lastError: null}` must not be read as "no change" by a merge that
    // filters undefined the wrong way — clearing the error on a successful
    // reconnect is the only way the note ever comes off the screen.
    await patchBridgeStatus({ lastError: 'Native host has exited.' });
    await patchBridgeStatus({ lastError: null });

    expect((await getBridgeStatus()).lastError).toBeNull();
  });
});
```

기존 파일의 `beforeEach(() => { fakeBrowser.reset(); })` 패턴을 따른다. 없으면 추가한다.

- [ ] **Step 3: 실패를 확인한다**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm test session
```

- [ ] **Step 4: 세션 저장소를 구현한다**

`lib/storage/session.ts` 끝에 추가한다:

```ts
/**
 * What the agent bridge is doing. Session-scoped for the same reason
 * {@link SyncStatus} is, and more sharply: a native port belongs to one
 * worker session, so a `connected: true` that survived a browser restart
 * would be a claim about a port that no longer exists.
 */
export interface BridgeStatus {
  /** True while a native port is open. */
  connected: boolean;
  /**
   * ISO timestamp of the last command the bridge actually applied, or null.
   *
   * Shown in the popup as a `title`, not as a line of its own — the rail has
   * 28px of slack and the bridge row spends all of it.
   */
  lastCommandAt: string | null;
  /**
   * Chrome's own message from the last failed connect, or null.
   *
   * Kept verbatim rather than translated. Chrome gives the *same* message
   * whether the host manifest is missing, names a different extension, or
   * points at an interpreter that cannot start (measured) — so any sentence
   * this code wrote instead would be a guess presented as a diagnosis.
   */
  lastError: string | null;
}

export const DEFAULT_BRIDGE_STATUS: BridgeStatus = {
  connected: false,
  lastCommandAt: null,
  lastError: null,
};

export const bridgeStatusItem = storage.defineItem<BridgeStatus>('session:bridgeStatus', {
  fallback: DEFAULT_BRIDGE_STATUS,
});

export async function getBridgeStatus(): Promise<BridgeStatus> {
  return (await bridgeStatusItem.getValue()) ?? DEFAULT_BRIDGE_STATUS;
}

/**
 * Merges one field into the record.
 *
 * Three separate events write to this — the port opening, a command being
 * applied, and a disconnect — and each knows only its own field. A
 * whole-record write from any of them would erase what the other two said,
 * which is how `lastCommandAt` would vanish every time the port blinked.
 */
export async function patchBridgeStatus(patch: Partial<BridgeStatus>): Promise<void> {
  const current = await getBridgeStatus();
  await bridgeStatusItem.setValue({ ...current, ...patch });
}
```

- [ ] **Step 5: 통과를 확인한다**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm test session
```

- [ ] **Step 6: 어댑터 테스트를 쓴다 (실패하는 테스트)**

`tests/unit/port.test.ts` 를 새로 만든다. **`globalThis.chrome` 에 스텁을 심는다** —
fake-browser 의 `runtime.connectNative` 는 던지는 스텁이고, 실제 어댑터는 `browser` 가 아니라
`chrome` 을 부른다.

```ts
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declaresRegexMode, disconnectBridge, refreshBridge } from '@/lib/bridge/port';
import { getBridgeStatus } from '@/lib/storage/session';
import { setState } from '@/lib/storage/state';
import { bootstrapProfile, DEFAULT_STATE } from '@/lib/model/defaults';
import type { AppState } from '@/lib/model/types';

/**
 * `chrome.runtime.connectNative` is what this adapter calls, and it is the one
 * function the WXT `browser` wrapper does not expose — measured, the spike saw
 * `TypeError: t.runtime.connectNative is not a function`. fake-browser does
 * define it, as a stub that throws. So the port under test is a hand-planted
 * `globalThis.chrome`, not a fake-browser mock.
 */
interface FakePort {
  messages: unknown[];
  disconnected: boolean;
  onMessage: { addListener: (fn: (message: unknown) => void) => void };
  onDisconnect: { addListener: (fn: () => void) => void };
  postMessage: (message: unknown) => void;
  disconnect: () => void;
  /** Drives the extension side: hand it what the host would have sent. */
  send: (message: unknown) => void;
  /** Drives Chrome's side: pretend the host died. */
  die: (message: string | null) => void;
}

function makePort(): FakePort {
  let onMessage: (message: unknown) => void = () => {};
  let onDisconnect: () => void = () => {};
  const port: FakePort = {
    messages: [],
    disconnected: false,
    onMessage: {
      addListener: (fn) => {
        onMessage = fn;
      },
    },
    onDisconnect: {
      addListener: (fn) => {
        onDisconnect = fn;
      },
    },
    postMessage: (message) => port.messages.push(message),
    disconnect: () => {
      port.disconnected = true;
    },
    send: (message) => onMessage(message),
    die: (message) => {
      lastError = message === null ? undefined : { message };
      onDisconnect();
      lastError = undefined;
    },
  };
  return port;
}

let lastError: { message: string } | undefined;
let ports: FakePort[] = [];
let connectNative: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  fakeBrowser.reset();
  ports = [];
  lastError = undefined;
  connectNative = vi.fn(() => {
    const port = makePort();
    ports.push(port);
    return port;
  });
  Reflect.set(globalThis, 'chrome', {
    runtime: {
      connectNative,
      get lastError() {
        return lastError;
      },
    },
  });
  vi.spyOn(fakeBrowser.permissions, 'contains').mockImplementation((async () => true) as never);
  await setState(DEFAULT_STATE);
});

afterEach(() => {
  disconnectBridge();
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, 'chrome');
});

/** Lets the adapter's floating promises settle before an assertion reads storage. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('opening the port', () => {
  it('does not connect at all when the permission is not held', async () => {
    vi.spyOn(fakeBrowser.permissions, 'contains').mockImplementation((async () => false) as never);

    await refreshBridge();

    // Zero calls, not "a call that failed". Connecting without the permission
    // is what would make Chrome show the host-not-found error to a user who
    // never asked for a bridge at all.
    expect(connectNative).toHaveBeenCalledTimes(0);
    expect(await getBridgeStatus()).toEqual({
      connected: false,
      lastCommandAt: null,
      lastError: null,
    });
  });

  it('connects by the host name the installer writes', async () => {
    await refreshBridge();
    expect(connectNative.mock.calls).toEqual([['com.headerlab.bridge']]);
  });

  it('does not open a second port when one is already open', async () => {
    await refreshBridge();
    await refreshBridge();
    expect(connectNative).toHaveBeenCalledTimes(1);
  });

  it('closes the port when the permission goes away', async () => {
    await refreshBridge();
    const [port] = ports;
    vi.spyOn(fakeBrowser.permissions, 'contains').mockImplementation((async () => false) as never);

    await refreshBridge();

    expect(port!.disconnected).toBe(true);
    expect((await getBridgeStatus()).connected).toBe(false);
  });
});

describe('reconnection is bounded', () => {
  it('retries a dropped port but stops before it becomes a loop', async () => {
    // The host manifest being absent is not a transient fault: Chrome returns
    // a Port and then disconnects it, every time, forever. An unbounded retry
    // here is an infinite spawn loop against a machine that will never
    // succeed — which is why the count is asserted exactly rather than
    // "more than one".
    await refreshBridge();
    for (let i = 0; i < 10; i += 1) {
      ports.at(-1)!.die('Specified native messaging host not found.');
      await settle();
    }

    expect(connectNative).toHaveBeenCalledTimes(3);
    const status = await getBridgeStatus();
    expect(status.connected).toBe(false);
    expect(status.lastError).toEqual('Specified native messaging host not found.');
  });

  it('lets a later trigger try again after the budget is spent', async () => {
    // The budget is per-episode, not per-session. `onStartup` and a permission
    // grant both funnel into refreshBridge(), and a user who has just run
    // `headerlab bridge install` must not have to reload the extension.
    await refreshBridge();
    for (let i = 0; i < 5; i += 1) {
      ports.at(-1)!.die('Native host has exited.');
      await settle();
    }
    expect(connectNative).toHaveBeenCalledTimes(3);

    await refreshBridge();

    expect(connectNative).toHaveBeenCalledTimes(4);
  });

  it('records a disconnect that carries no message without inventing one', async () => {
    await refreshBridge();
    ports.at(-1)!.die(null);
    await settle();

    // `null`, not the string "undefined" and not a sentence this file wrote.
    // The popup renders a note only when there is something to say.
    expect((await getBridgeStatus()).lastError).toBeNull();
  });
});

describe('applying a command', () => {
  it('echoes the request id back — nothing else can correlate a reply', async () => {
    // The host broadcasts every extension reply to every connected socket
    // client with no pairing of its own, so two concurrent `headerlab`
    // invocations would each read the other's answer. The contract is written
    // down in packages/cli/lib/bridge.mjs's sendCommand docblock; this is the
    // assertion that holds the extension's half of it.
    await refreshBridge();
    const port = ports[0]!;

    port.send({ id: 'abc', command: { cmd: 'pause' } });
    await settle();

    expect(port.messages).toHaveLength(1);
    expect((port.messages[0] as { id: string }).id).toEqual('abc');
  });

  it('writes the applied state to storage', async () => {
    await refreshBridge();
    const port = ports[0]!;

    port.send({ id: '1', command: { cmd: 'pause' } });
    await settle();

    const { getState } = await import('@/lib/storage/state');
    expect((await getState()).globalPause).toBe(true);
    expect(port.messages[0]).toMatchObject({ ok: true, changed: true });
  });

  it('does not write when nothing changed', async () => {
    // `changed` is a different fact from `ok` (protocol.ts). A write here
    // would fire `stateItem.watch`, which fires reconcile(), which replaces
    // every DNR rule — for a command that asked for a state already true.
    const seen: AppState[] = [];
    await refreshBridge();
    const { stateItem } = await import('@/lib/storage/state');
    const unwatch = stateItem.watch((value) => {
      if (value) seen.push(value);
    });

    ports[0]!.send({ id: '1', command: { cmd: 'resume' } });
    await settle();
    unwatch();

    expect(seen).toEqual([]);
    expect(ports[0]!.messages[0]).toMatchObject({ ok: true, changed: false });
  });

  it('answers an unparseable command with invalid-command rather than dying', async () => {
    // An uncaught throw inside onMessage kills nothing visibly and leaves the
    // CLI waiting out its ten-second timeout for a reply that is never coming.
    await refreshBridge();
    const port = ports[0]!;

    port.send({ id: '1', command: { cmd: 'nope' } });
    await settle();

    expect(port.messages).toHaveLength(1);
    expect(port.messages[0]).toMatchObject({
      id: '1',
      ok: false,
      error: { code: 'invalid-command' },
    });
  });

  it('drops a message with no id — there is nobody to answer', async () => {
    await refreshBridge();
    const port = ports[0]!;

    port.send({ command: { cmd: 'pause' } });
    await settle();

    // Silence rather than a reply nobody can match. Posting an id-less reply
    // would be delivered to *every* connected client and discarded by each.
    expect(port.messages).toEqual([]);
  });

  it('records when a command was applied, and only when one was', async () => {
    await refreshBridge();
    const port = ports[0]!;

    port.send({ id: '1', command: { cmd: 'resume' } });
    await settle();
    expect((await getBridgeStatus()).lastCommandAt).toBeNull();

    port.send({ id: '2', command: { cmd: 'pause' } });
    await settle();
    expect((await getBridgeStatus()).lastCommandAt).not.toBeNull();
  });
});

describe('the two refusals', () => {
  it('refuses to write onto a store it could not read', async () => {
    // The measured failure this guards: `loadState()` hands back DEFAULT_STATE
    // when the bytes fail validation, and applying onto that and writing it
    // destroys whatever was really on disk. The popup already paid for this
    // once (App.tsx: `if (!valid) return`).
    await fakeBrowser.storage.local.set({ state: { profiles: 'not an array' } });
    await refreshBridge();
    const port = ports[0]!;

    port.send({ id: '1', command: { cmd: 'pause' } });
    await settle();

    expect(port.messages[0]).toMatchObject({
      id: '1',
      ok: false,
      error: { code: 'store-unreadable' },
    });
    // And the bytes are still there. This is the assertion that fails if
    // someone "fixes" the refusal by resetting the store first.
    expect(await fakeBrowser.storage.local.get('state')).toEqual({
      state: { profiles: 'not an array' },
    });
  });

  it('refuses a state.set that declares a regex filter', async () => {
    await refreshBridge();
    const port = ports[0]!;
    const profile = bootstrapProfile();
    const payload = {
      ...DEFAULT_STATE,
      profiles: [{ ...profile, filter: { ...profile.filter, mode: 'regex', regex: '.*' } }],
    };

    port.send({ id: '1', command: { cmd: 'state.set', state: payload } });
    await settle();

    expect(port.messages[0]).toMatchObject({
      id: '1',
      ok: false,
      error: { code: 'unsupported' },
    });
  });

  it('lets an ordinary state.set through', async () => {
    // Absence before presence: without this, "refuse everything" passes the
    // test above.
    await refreshBridge();
    const port = ports[0]!;

    port.send({ id: '1', command: { cmd: 'state.set', state: DEFAULT_STATE } });
    await settle();

    expect(port.messages[0]).toMatchObject({ id: '1', ok: true });
  });
});

describe('declaresRegexMode', () => {
  it.each([
    ['a payload that is not an object', 'nope', false],
    ['a payload with no profiles', {}, false],
    ['profiles that is not an array', { profiles: 5 }, false],
    ['a domains-mode profile', { profiles: [{ filter: { mode: 'domains' } }] }, false],
    ['a regex-mode profile', { profiles: [{ filter: { mode: 'regex' } }] }, true],
    [
      'a regex-mode profile hiding behind a good one',
      { profiles: [{ filter: { mode: 'domains' } }, { filter: { mode: 'regex' } }] },
      true,
    ],
  ])('%s → %s', (_label, payload, expected) => {
    expect(declaresRegexMode(payload)).toBe(expected);
  });
});
```

- [ ] **Step 7: 실패를 확인한다**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm test port
```

기대: `lib/bridge/port.ts` 가 없어서 전부 실패.

- [ ] **Step 8: 어댑터를 구현한다**

`lib/bridge/port.ts` 를 새로 만든다:

```ts
import { apply } from '@/lib/bridge/apply';
import { parseCommand } from '@/lib/bridge/protocol';
import { probeNativeMessaging } from '@/lib/permissions/probe';
import { loadState, setState } from '@/lib/storage/state';
import { patchBridgeStatus } from '@/lib/storage/session';
import type { ApplyResult } from '@/lib/bridge/protocol';

/**
 * The one module permitted to call chrome.runtime.connectNative — and it calls
 * `chrome`, not `browser`, because the WXT wrapper does not expose that
 * function at all (measured: `TypeError: t.runtime.connectNative is not a
 * function`).
 *
 * Deliberately **not** in tests/unit/purity.test.ts's list, for the same
 * reason lib/permissions/probe.ts is not: this is the thin adapter the pure
 * layer exists to keep browser calls out of. That is why lib/bridge/ has no
 * directory-shaped purity rule and its two pure files are named one by one.
 *
 * It makes no decisions about what a command means. `parseCommand` validates,
 * `apply()` decides, `setState` writes — and `stateItem.watch` already calls
 * `reconcile()`, so this is a new trigger on the single reconcile loop rather
 * than a second writer.
 */

/**
 * The name Chrome looks up in NativeMessagingHosts. The installer writes a
 * manifest under exactly this name — `packages/host/lib/manifest.mjs` holds
 * the other spelling, and tests/unit/bridgeName.test.ts pins the two together
 * because nothing else can: one is TypeScript bundled into the extension and
 * the other is Node the extension must never import.
 */
export const NATIVE_HOST_NAME = 'com.headerlab.bridge';

/**
 * Consecutive connect attempts before the adapter stops.
 *
 * Not a tuning knob — a correctness bound. Three of the states that break a
 * connect (a missing manifest, a manifest naming a different extension, an
 * interpreter that cannot start) are permanent, and Chrome reports all three
 * with the same message, so nothing here can tell them from a transient fault.
 * An unbounded retry against a permanent fault is an infinite spawn loop. The
 * budget is per episode: `refreshBridge()` resets it, and every lifecycle
 * trigger calls that.
 */
export const MAX_CONNECT_ATTEMPTS = 3;

let port: chrome.runtime.Port | null = null;
let attempts = 0;

/**
 * Whether a `state.set` payload asks for a regex filter.
 *
 * Design §3.1: `appStateSchema` accepts `filter.mode: 'regex'` with any string
 * beside it, and `filterToCondition` compiles that straight into `regexFilter`
 * — with nothing having asked
 * `chrome.declarativeNetRequest.isRegexSupported()`, which is the only
 * authority on RE2 validity. The popup has no regex editor, so such a rule
 * would be applied and invisible: state the UI cannot show, still modifying
 * headers.
 *
 * Read off the raw payload rather than the parsed one, and kept out of the
 * pure layer on purpose — `apply()` goes on accepting everything
 * `parseAppState` accepts, so when the regex UI is built this judgment is
 * deleted from one file rather than found in two.
 */
export function declaresRegexMode(payload: unknown): boolean {
  const profiles = (payload as { profiles?: unknown })?.profiles;
  if (!Array.isArray(profiles)) return false;
  return profiles.some(
    (profile) => (profile as { filter?: { mode?: unknown } })?.filter?.mode === 'regex',
  );
}

/**
 * Brings the port in line with the permission: open one if the permission is
 * held and none is open, close the one that exists if it is not.
 *
 * Every lifecycle trigger funnels here — the same shape `reconcile()` has, and
 * for the same reason. It is deliberately **not** wired to `stateItem.watch`:
 * a state write is not a reason to re-open a native port, and doing so would
 * make every command this adapter applies re-enter it.
 */
export async function refreshBridge(): Promise<void> {
  const allowed = await probeNativeMessaging();
  if (!allowed) {
    disconnectBridge();
    attempts = 0;
    await patchBridgeStatus({ connected: false, lastError: null });
    return;
  }
  if (port !== null) return;
  attempts = 0;
  connect();
}

/**
 * Closes the port without arming a retry.
 *
 * Chrome does not fire `onDisconnect` on the side that called `disconnect()`,
 * but the listener guards on identity anyway — a port superseded by a later
 * connect must not be able to reset the newer one's state from its own
 * teardown.
 */
export function disconnectBridge(): void {
  const closing = port;
  port = null;
  closing?.disconnect();
}

function connect(): void {
  attempts += 1;
  let current: chrome.runtime.Port;
  try {
    current = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  } catch (error) {
    port = null;
    void patchBridgeStatus({
      connected: false,
      lastError: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  port = current;

  current.onMessage.addListener((message: unknown) => {
    void handleMessage(current, message);
  });

  current.onDisconnect.addListener(() => {
    // Chrome's message is only readable inside this callback, and it is the
    // only account of the failure that exists — read it first, decide after.
    const message = chrome.runtime.lastError?.message ?? null;
    if (port !== current) return;
    port = null;
    void patchBridgeStatus({ connected: false, lastError: message });
    if (attempts < MAX_CONNECT_ATTEMPTS) connect();
  });

  // Optimistic, and corrected within milliseconds by the listener above if the
  // host is not really there. The alternative — waiting for a round trip
  // before saying so — would leave the popup showing `idle` for every healthy
  // bridge until someone happened to run a command.
  void patchBridgeStatus({ connected: true, lastError: null });
}

function reply(current: chrome.runtime.Port, id: string, result: ApplyResult): void {
  current.postMessage({ id, ...result });
}

async function handleMessage(current: chrome.runtime.Port, message: unknown): Promise<void> {
  const envelope = message as { id?: unknown; command?: unknown };
  const id = typeof envelope?.id === 'string' ? envelope.id : null;
  // No id means no reply is deliverable: the host broadcasts to every socket
  // client, and each of them discards what does not match its own id. Better
  // to drop it than to send something every listener throws away.
  if (id === null) return;

  let command;
  try {
    command = parseCommand(envelope.command);
  } catch (error) {
    reply(current, id, {
      ok: false,
      error: {
        code: 'invalid-command',
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return;
  }

  if (command.cmd === 'state.set' && declaresRegexMode(command.state)) {
    reply(current, id, {
      ok: false,
      error: {
        code: 'unsupported',
        message:
          'this build refuses a regex filter: there is no regex editor in the popup and ' +
          'nothing validates the pattern, so the rule would apply with no way to see or fix it',
      },
    });
    return;
  }

  const { state, valid } = await loadState();
  if (!valid) {
    reply(current, id, {
      ok: false,
      error: {
        code: 'store-unreadable',
        message:
          'the stored state does not match the format this version expects, so nothing was ' +
          'applied and nothing was overwritten',
      },
    });
    return;
  }

  const result = apply(state, command);
  if (result.ok && result.changed) {
    await setState(result.state);
    await patchBridgeStatus({ lastCommandAt: new Date().toISOString() });
  }
  reply(current, id, result);
}
```

- [ ] **Step 9: 통과를 확인한다**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm test port
```

- [ ] **Step 10: background 에 배선한다**

`entrypoints/background.ts` 를 통째로 바꾼다:

```ts
import { browser } from 'wxt/browser';
import { refreshBridge } from '@/lib/bridge/port';
import { stateItem } from '@/lib/storage/state';
import { reconcile } from '@/lib/sync/ruleSync';

export default defineBackground(() => {
  const run = () => {
    reconcile().catch((error) => {
      console.error('[HeaderLab] reconcile failed', error);
    });
  };

  // The bridge rides the same triggers, minus one. It is deliberately not on
  // `stateItem.watch`: a state write is not a reason to re-open a native port,
  // and since applying a bridge command *is* a state write, wiring it there
  // would make every command re-enter the adapter that just handled it.
  //
  // These four are also the whole of the reconnection strategy. The port keeps
  // the worker alive on its own (measured: seven minutes with no traffic), so
  // the cases where it really dies — browser restart, extension reload, crash,
  // and a permission arriving or going away — are exactly what these already
  // fire on. No heartbeat, and no `alarms` permission to pay for one.
  const syncBridge = () => {
    refreshBridge().catch((error) => {
      console.error('[HeaderLab] bridge refresh failed', error);
    });
  };

  // Every trigger funnels into the same idempotent reconcile.
  run();
  syncBridge();
  browser.runtime.onStartup.addListener(run);
  browser.runtime.onStartup.addListener(syncBridge);
  browser.runtime.onInstalled.addListener(run);
  browser.runtime.onInstalled.addListener(syncBridge);
  browser.permissions.onAdded.addListener(run);
  browser.permissions.onAdded.addListener(syncBridge);
  browser.permissions.onRemoved.addListener(run);
  browser.permissions.onRemoved.addListener(syncBridge);
  stateItem.watch(run);
});
```

- [ ] **Step 11: purity 가드의 주석을 사실에 맞춘다**

`tests/unit/purity.test.ts` 의 `'lib/bridge/protocol.ts'` 위 주석에서 미래형을 없앤다:

```ts
  // Same situation as lib/permissions/: this directory also holds an adapter
  // (port.ts), so there can be no directory-shaped rule here. Without naming
  // each pure file explicitly, there is no guard.
```

목록 자체는 바뀌지 않는다 — `port.ts` 는 가드 대상이 **아니다**.

- [ ] **Step 12: 전체 검사**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm check
```

- [ ] **Step 13: 커밋**

```bash
git add lib/bridge/port.ts lib/bridge/protocol.ts lib/storage/session.ts \
  entrypoints/background.ts tests/unit/port.test.ts tests/unit/session.test.ts \
  tests/unit/purity.test.ts
git commit -m "feat: connect the bridge port and apply commands from it"
```

- [ ] **Step 14: 변이 검증 (커밋 후)**

셋을 각각 심고 되돌린다. 각각에 대해 **어느 테스트가 빨개졌는지 이름으로** 보고한다.

1. `handleMessage` 의 `if (!valid)` 블록을 삭제 → `refuses to write onto a store it could not read`
2. `reply()` 에서 `id` 를 빼기 → `echoes the request id back`
3. `if (attempts < MAX_CONNECT_ATTEMPTS)` 를 무조건 `connect()` 로 → `retries a dropped port but stops before it becomes a loop`

---

### Task 3: 팝업의 브리지 줄 — 안 A

**Files:**
- Modify: `components/ScopeRail.tsx`
- Modify: `entrypoints/popup/App.tsx`
- Modify: `tests/unit/ScopeRail.test.tsx`
- Modify: `tests/e2e/header-modification.spec.ts` (레이아웃 가드 하나 추가)

**Interfaces:**
- Consumes: `BridgeStatus`, `bridgeStatusItem`, `getBridgeStatus`, `DEFAULT_BRIDGE_STATUS`
  (`@/lib/storage/session`), `probeNativeMessaging`, `requestNativeMessaging`,
  `removeNativeMessaging` (`@/lib/permissions/probe`).
- Produces: `ScopeRailProps` 에 `bridge`, `bridgeLastCommandAt`, `bridgeError`,
  `onEnableBridge`, `onDisableBridge`.

- [ ] **Step 1: 빌드된 팝업에서 레일의 여유를 다시 잰다**

**이것이 첫 단계다.** 28px 은 소스에서 읽은 값이고, 설계 문서가 직접 "구현 시 빌드된 팝업에서
다시 잰다" 고 적어 두었다.

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm build
```

스크래치에 `measure-rail.mjs` 를 쓴다. `scripts/screenshots.mjs` 를 읽고 그 파일이 확장을
로드하는 방식(`launchPersistentContext` 인자와 팝업 URL 조립)을 **그대로** 베낀다 — 그 파일이
이 저장소에서 프로덕션 번들을 실제 Chrome 에 띄우는 유일한 코드다. 측정 부분만 이것으로
바꾼다:

```js
const rail = page.locator('aside').first();
console.log(
  JSON.stringify(
    await rail.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      slack: el.clientHeight - el.scrollHeight,
    })),
  ),
);
```

**측정값을 보고서에 적는다.** `slack >= 28` 이면 계획대로 간다. `slack < 28` 이면 **멈추고
보고한다** — 사이트 목록의 `max-h-[132px]` 를 줄이는 것은 셋째 행을 반쯤 자르는 affordance 를
깨는 일이라 임의로 할 수 없다.

- [ ] **Step 2: ScopeRail 테스트를 쓴다 (실패하는 테스트)**

먼저 `tests/unit/ScopeRail.test.tsx` 의 `props()` 헬퍼에 새 필드의 기본값을 넣는다.
`onGrant: vi.fn(),` 뒤, 반환 객체가 닫히기 전에:

```tsx
    // `unknown` would make every existing test render a row with no control,
    // which is not what those tests are about. `off` is the state a fresh
    // install actually opens in, so it is the honest default here — and the
    // tests that are about the other three opt into them by name.
    bridge: 'off',
    bridgeLastCommandAt: null,
    bridgeError: null,
    onEnableBridge: vi.fn(),
    onDisableBridge: vi.fn(),
```

그 다음 파일 끝에 추가한다:

```tsx
describe('the bridge row', () => {
  it.each([
    ['off', 'Bridge off', 'Enable'],
    ['idle', 'Bridge idle', 'Disable'],
    ['live', 'Bridge live', 'Disable'],
  ])('%s reads "%s" with a %s button', (mode, label, button) => {
    render(<ScopeRail {...props({ bridge: mode as 'off' })} />);
    const row = screen.getByTestId('bridgestate');
    expect(row.textContent).toEqual(`${label}${button}`);
  });

  it('says nothing and offers no control while the probe is still out', () => {
    // Same rule as the all-sites row's `allSitesGranted: null`: a popup that
    // showed "Bridge off" with an Enable button for a tenth of a second and
    // then withdrew it is the flicker that teaches people to distrust the
    // screen. Absence asserted before presence — an "always renders Enable"
    // implementation would pass a presence-only check.
    render(<ScopeRail {...props({ bridge: 'unknown' })} />);
    const row = screen.getByTestId('bridgestate');
    expect(row.textContent).toEqual('Bridge');
    expect(row.querySelector('button')).toBeNull();
  });

  it('keeps the row the same height in every state', () => {
    // State changes appearance, not geometry (CLAUDE.md, Interface). The
    // class list is what the e2e measures; here it is enough that all four
    // states render the same box classes.
    const heights = new Set(
      (['unknown', 'off', 'idle', 'live'] as const).map((bridge) => {
        const { unmount } = render(<ScopeRail {...props({ bridge })} />);
        const cls = screen.getByTestId('bridgestate').className;
        unmount();
        return cls;
      }),
    );
    expect(heights.size).toEqual(1);
  });

  it('carries the last external write in a title rather than a second line', () => {
    render(
      <ScopeRail
        {...props({ bridge: 'live', bridgeLastCommandAt: '2026-08-12T09:30:00.000Z' })}
      />,
    );
    const label = screen.getByTestId('bridge-label');
    // The exact string, not "contains a date": the rail has 28px and this is
    // the only place the fact is stated, so a title that dropped the value and
    // kept the prefix would look right and say nothing.
    expect(label.getAttribute('title')).toEqual(
      `Last change through the bridge: ${new Date('2026-08-12T09:30:00.000Z').toLocaleString()}`,
    );
  });

  it('has no title at all when nothing has come through', () => {
    render(<ScopeRail {...props({ bridge: 'live', bridgeLastCommandAt: null })} />);
    expect(screen.getByTestId('bridge-label').getAttribute('title')).toBeNull();
  });

  it('names the connect failure and what to run, without guessing at the cause', () => {
    render(
      <ScopeRail {...props({ bridge: 'idle', bridgeError: 'Native host has exited.' })} />,
    );
    const note = screen.getByTestId('bridge-error');
    expect(note.textContent).toContain('headerlab bridge install');
    // Chrome's own words, kept verbatim. A note that translated them into one
    // of the three possible causes would be a guess presented as a diagnosis —
    // Chrome gives the same message for all three (measured).
    expect(note.textContent).toContain('Native host has exited.');
  });

  it('shows no note when the bridge is simply off', () => {
    // A stale error from before the permission was withdrawn must not sit on
    // screen accusing a bridge nobody has turned on.
    render(<ScopeRail {...props({ bridge: 'off', bridgeError: 'Native host has exited.' })} />);
    expect(screen.queryByTestId('bridge-error')).toBeNull();
  });

  it('calls enable from the off state and disable from the others', () => {
    const onEnableBridge = vi.fn();
    const onDisableBridge = vi.fn();
    for (const bridge of ['off', 'idle', 'live'] as const) {
      const { unmount } = render(
        <ScopeRail {...props({ bridge, onEnableBridge, onDisableBridge })} />,
      );
      screen.getByTestId('bridgestate').querySelector('button')!.click();
      unmount();
    }
    expect(onEnableBridge).toHaveBeenCalledTimes(1);
    expect(onDisableBridge).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm test ScopeRail
```

- [ ] **Step 4: ScopeRail 을 구현한다**

`ScopeRailProps` 에 추가한다:

```ts
  /**
   * What the agent bridge is doing.
   *
   * `unknown` is not `off`. The permission probe has not answered yet, and a
   * row that offered Enable before the browser had been asked is the same
   * flicker `allSitesGranted: null` exists to prevent — so that state carries
   * no colour and no control, only the word.
   *
   * `idle` means the permission is held and no port is open. That is not the
   * design's original wording ("a CLI is not attached"), and the change is
   * deliberate: the extension cannot see the host's socket clients, and making
   * the host tell it would turn a relay into a protocol participant — the
   * thing packages/cli/lib/bridge.mjs argues against by name. What `idle`
   * actually points at is the state a user really lands in: Enable pressed,
   * `headerlab bridge install` never run.
   */
  bridge: 'unknown' | 'off' | 'idle' | 'live';
  /** ISO timestamp of the last command applied through the bridge, or null. */
  bridgeLastCommandAt: string | null;
  /** Chrome's own message from the last failed connect, or null. */
  bridgeError: string | null;
  onEnableBridge: () => void;
  onDisableBridge: () => void;
```

`SWITCH_CLASS` 상수 아래에 추가한다:

```ts
/**
 * Disable is not a request — it hands a permission back — so it does not
 * borrow the amber Grant palette. Enable does: it opens Chrome's consent
 * dialog, which is exactly what GRANT_BUTTON_CLASS already means everywhere
 * else on this screen.
 */
const BRIDGE_OFF_BUTTON_CLASS = 'h-5 rounded-[4px]';

const BRIDGE_LABEL = {
  unknown: 'Bridge',
  off: 'Bridge off',
  idle: 'Bridge idle',
  live: 'Bridge live',
} as const;
```

`runstate` div 바로 **뒤**, 카드를 닫는 `</div>` 앞에 넣는다:

```tsx
        {/* The fourth line of the readout card, and the whole of the 28px of
            slack the rail had left — measured in the built popup, not read off
            the source. The site list's max-height stays at 132px so the third
            row is still cut across the middle, which is the affordance that
            says the list continues.

            Shaped exactly like the run state above it because it is the same
            kind of fact: a thing that is either happening or not, with one
            control. The control is a button and not a switch for the reason
            the all-sites switch stopped calling `permissions.request()` — a
            consent dialog must follow a button that asks for consent, never a
            control that merely moved. */}
        <div
          className="mt-2 flex h-5 items-center gap-[7px]"
          data-testid="bridgestate"
          data-bridge={bridge}
        >
          {/* Colour only when a port is actually open. `unknown` gets the slot
              with no fill at all — reserving the space must not put a phantom
              state on screen, the same bargain the all-sites glyph makes. */}
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              bridge === 'live'
                ? 'bg-live'
                : bridge === 'unknown'
                  ? 'bg-transparent'
                  : 'bg-muted-foreground'
            }`}
            aria-hidden="true"
          />
          <span
            className="text-[12px] leading-4 font-semibold text-foreground"
            data-testid="bridge-label"
            {...(bridgeLastCommandAt === null
              ? {}
              : {
                  title: `Last change through the bridge: ${new Date(
                    bridgeLastCommandAt,
                  ).toLocaleString()}`,
                })}
          >
            {BRIDGE_LABEL[bridge]}
          </span>
          <span className="flex-1" />
          {bridge === 'unknown' ? null : bridge === 'off' ? (
            <Button
              size="xs"
              variant="secondary"
              className={GRANT_BUTTON_CLASS}
              onClick={onEnableBridge}
            >
              Enable
            </Button>
          ) : (
            <Button
              size="xs"
              variant="secondary"
              className={BRIDGE_OFF_BUTTON_CLASS}
              onClick={onDisableBridge}
            >
              Disable
            </Button>
          )}
        </div>
```

`iconError` 노트 **뒤**에 브리지 노트를 넣는다:

```tsx
      {/* Amber, not red: the permission is held and the bridge simply is not
          reachable — incomplete rather than wrong, the same reading that keeps
          a pending site row out of the error palette.

          Chrome's message is repeated verbatim and not interpreted. It is
          identical for a missing manifest, a manifest naming a different
          extension, and an interpreter that cannot start (measured), so any
          sentence here that picked one would be a guess wearing a diagnosis's
          clothes. What *is* actionable is the command, so that is what leads. */}
      {bridge === 'idle' && bridgeError !== null && (
        <div className={`${NOTE_CLASS} border-l-pending`} data-testid="bridge-error">
          <b className="mb-0.5 block font-bold text-foreground">Bridge not connected</b>
          Run <code className="font-mono text-[10px]">headerlab bridge install</code>. Chrome
          reports the same message for a missing host manifest, one naming a different extension,
          and an interpreter it cannot start. {bridgeError}
        </div>
      )}
```

시그니처의 구조 분해에 `bridge`, `bridgeLastCommandAt`, `bridgeError`, `onEnableBridge`,
`onDisableBridge` 를 더한다.

- [ ] **Step 5: 통과를 확인한다**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm test ScopeRail
```

- [ ] **Step 6: App.tsx 를 잇는다**

임포트에 더한다:

```ts
import {
  probeAllSites,
  probeGrants,
  probeNativeMessaging,
  removeNativeMessaging,
  requestAllSites,
  requestNativeMessaging,
  requestHost,
} from '@/lib/permissions/probe';
import { bridgeStatusItem, DEFAULT_BRIDGE_STATUS, getBridgeStatus } from '@/lib/storage/session';
import type { BridgeStatus } from '@/lib/storage/session';
```

(기존 `getSyncStatus` 임포트는 그대로 둔다.)

상태 훅을 더한다:

```ts
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>(DEFAULT_BRIDGE_STATUS);
  // `null` until the probe answers, for exactly the reason `allSitesGranted`
  // is: the row must not offer Enable before the browser has been asked.
  const [bridgeAllowed, setBridgeAllowed] = useState<boolean | null>(null);
```

효과 둘을 더한다 (`getSyncStatus` 효과 아래):

```ts
  /**
   * Watched rather than polled. The background worker writes this record when
   * the port opens, when it drops, and when a command is applied — three
   * events the popup has no other way to learn about, and a popup that read
   * once on mount would show a bridge as idle for as long as it stayed open.
   *
   * `[]` and not `[state]`: this subscription is about the port, not the rule
   * set, and re-subscribing on every keystroke would tear down and rebuild the
   * listener for nothing.
   */
  useEffect(() => {
    let cancelled = false;
    getBridgeStatus()
      .then((s) => {
        if (!cancelled) setBridgeStatus(s);
      })
      .catch(() => {});
    const unwatch = bridgeStatusItem.watch((value) => {
      setBridgeStatus(value ?? DEFAULT_BRIDGE_STATUS);
    });
    return () => {
      cancelled = true;
      unwatch();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    probeNativeMessaging()
      .then((allowed) => {
        if (!cancelled) setBridgeAllowed(allowed);
      })
      .catch(() => {
        if (!cancelled) setBridgeAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [state]);
```

`blockedBy` 계산 근처에 모드 계산을 더한다:

```ts
  // The permission decides `off`; the port decides the other two. Kept in this
  // order because a held permission with no port is the state that actually
  // needs a remedy on screen, and reading the port first would hide it behind
  // a bridge nobody enabled.
  const bridgeMode =
    bridgeAllowed === null
      ? 'unknown'
      : !bridgeAllowed
        ? 'off'
        : bridgeStatus.connected
          ? 'live'
          : 'idle';
```

`ScopeRail` 에 props 를 넘긴다 (`iconError` 아래):

```tsx
        bridge={bridgeMode}
        bridgeLastCommandAt={bridgeStatus.lastCommandAt}
        bridgeError={bridgeStatus.lastError}
        onEnableBridge={async () => {
          // The click is the user gesture `permissions.request()` requires.
          // Nothing here opens the port: the background worker's
          // `permissions.onAdded` listener does, and the record it writes is
          // what this component is already watching. One path in, one path out.
          const granted = await requestNativeMessaging();
          if (mountedRef.current) setBridgeAllowed(granted);
        }}
        onDisableBridge={async () => {
          const removed = await removeNativeMessaging();
          // Re-probed rather than assumed. A removal that failed leaves the
          // bridge reachable, and saying otherwise would be the one direction
          // of under-reporting this product exists to rule out.
          if (mountedRef.current) setBridgeAllowed(removed ? false : await probeNativeMessaging());
        }}
```

- [ ] **Step 7: App 테스트를 더한다**

`tests/unit/App.test.tsx` 는 이미 `seed()`, `stateWith()`, `stored()` 헬퍼와
`import * as probe from '@/lib/permissions/probe'` 를 갖고 있다. 그것들을 그대로 쓴다:

```tsx
describe('the bridge row', () => {
  it('says nothing before the permission probe answers', async () => {
    // A promise that never settles is the honest model of "the probe is still
    // out" — a resolved `false` would be testing the off state instead.
    vi.spyOn(probe, 'probeNativeMessaging').mockReturnValue(new Promise(() => {}));
    await seed(stateWith());

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('bridgestate')).toBeTruthy());
    expect(screen.getByTestId('bridgestate').getAttribute('data-bridge')).toEqual('unknown');
  });

  it('reads live from the session record, not from the permission', async () => {
    // Permission held and a port open are two different facts. An
    // implementation that derived `live` from the permission alone would call
    // a bridge live with no host installed — the single most misleading thing
    // this row could say, and the exact state `bridge install` exists to fix.
    vi.spyOn(probe, 'probeNativeMessaging').mockResolvedValue(true);
    await seed(stateWith());
    await fakeBrowser.storage.session.set({
      bridgeStatus: { connected: false, lastCommandAt: null, lastError: null },
    });

    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('bridgestate').getAttribute('data-bridge')).toEqual('idle'),
    );
  });

  it('turns live once the worker records a connected port', async () => {
    vi.spyOn(probe, 'probeNativeMessaging').mockResolvedValue(true);
    await seed(stateWith());
    await fakeBrowser.storage.session.set({
      bridgeStatus: { connected: true, lastCommandAt: null, lastError: null },
    });

    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('bridgestate').getAttribute('data-bridge')).toEqual('live'),
    );
  });

  it('asks for the permission when Enable is clicked, and only then', async () => {
    // The button is the user gesture. Nothing else in the popup may reach
    // `permissions.request()` — the all-sites switch already had that removed
    // for the same reason.
    vi.spyOn(probe, 'probeNativeMessaging').mockResolvedValue(false);
    const request = vi.spyOn(probe, 'requestNativeMessaging').mockResolvedValue(true);
    await seed(stateWith());

    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('bridgestate').getAttribute('data-bridge')).toEqual('off'),
    );
    expect(request).toHaveBeenCalledTimes(0);

    await userEvent.click(within(screen.getByTestId('bridgestate')).getByRole('button'));

    expect(request).toHaveBeenCalledTimes(1);
  });
});
```

`fakeBrowser.storage.session` 에 시드하는 키는 `bridgeStatus` 다 — WXT 의 `session:` 접두사는
영역을 고르는 것이고 실제 키는 접두사를 뗀 나머지다. `local:state` 가 키 `state` 로 앉는 것과
같다.

- [ ] **Step 8: e2e 레이아웃 가드를 더한다**

`tests/e2e/header-modification.spec.ts` 에 하나 더한다 (그 파일의 기존 레이아웃 가드들과 같은
모양으로):

```ts
test('the bridge row does not push the rail past its column', async ({ page, extensionId }) => {
  // The rail had 28px of slack and this row spends all of it. Measured here
  // rather than asserted from the source, because the source figure is what
  // the design doc warned would be stale.
  await openPopup(page, extensionId); // 이 파일의 기존 헬퍼를 쓴다
  const rail = page.locator('aside').first();
  const { scrollHeight, clientHeight } = await rail.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(scrollHeight).toBeLessThanOrEqual(clientHeight);

  // And the affordance the slack was protecting is still there: the site list
  // stops mid-row, not on one.
  const list = page.getByTestId('site-list');
  expect(await list.evaluate((el) => el.clientHeight)).toEqual(132);
});
```

- [ ] **Step 9: 전체 검사**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm check
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm test:e2e
```

- [ ] **Step 10: 스크린샷을 다시 찍는다**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm screenshots
```

네 장을 눈으로 본다. 브리지 줄이 카드 안에 있고, 리퀘스트 타입 체크리스트가 잘리지 않았고,
사이트 목록의 셋째 행이 여전히 반쯤 잘려 있는지 확인한다. **보고서에 무엇을 보았는지 적는다** —
이 저장소에서 픽셀을 읽는 것은 사람뿐이고, 색과 정렬을 잡는 자동 가드는 없다.

- [ ] **Step 11: 커밋**

```bash
git add components/ScopeRail.tsx entrypoints/popup/App.tsx tests/unit/ScopeRail.test.tsx \
  tests/unit/App.test.tsx tests/e2e/header-modification.spec.ts docs/screenshots
git commit -m "feat: show the bridge state in the popup and offer the switch"
```

- [ ] **Step 12: 변이 검증 (커밋 후)**

`bridgeMode` 를 `bridgeAllowed ? 'live' : 'off'` 로 바꾸고 `pnpm test App` 이 빨개지는지 본다.
`data-bridge` 를 지우고 e2e 가 빨개지는지 본다. 되돌린다.

---

### Task 4: 호스트 매니페스트와 인스톨러 코어

**Files:**
- Create: `packages/host/lib/manifest.mjs`
- Create: `packages/host/test/manifest.test.mjs`
- Create: `packages/cli/lib/install.mjs`
- Create: `packages/cli/test/install.test.mjs`
- Create: `tests/unit/bridgeName.test.ts`

**Interfaces:**
- Produces (`packages/host/lib/manifest.mjs`): `HOST_NAME`, `MANIFEST_FILE_NAME`,
  `unpackedExtensionId(loadPath)`, `nativeMessagingDir({platform, home, userDataDir, browser})`,
  `hostManifest({launcherPath, extensionId})`, `launcherScript({nodePath, entryPath})`.
- Produces (`packages/cli/lib/install.mjs`): `installBridge(options)`, `uninstallBridge(options)`,
  `bridgeStatus(options)`, `defaultInstallPaths(env)`.

- [ ] **Step 1: 골든 쌍을 먼저 재현한다**

무엇을 쓰기 전에, 실측된 쌍이 이 알고리즘으로 재현되는지 확인한다:

```bash
node -e '
const {createHash}=require("node:crypto");
const p="/Users/penguin/dev/headerlab/.output/chrome-mv3";
const d=createHash("sha256").update(Buffer.from(p,"utf8")).digest("hex").slice(0,32);
console.log([...d].map(c=>String.fromCharCode(97+parseInt(c,16))).join(""));
'
```

기대 출력: `emdiklpbkfcdhnljlaikoclahpkjledp`.

**다르면 멈추고 보고한다.** 이 값은 스파이크에서 `chrome://extensions` 카드와 대조된 것이고,
Task 6 의 e2e 는 이 함수가 맞다는 데 기댄다.

- [ ] **Step 2: 매니페스트 모듈 테스트를 쓴다 (실패하는 테스트)**

`packages/host/test/manifest.test.mjs`:

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HOST_NAME,
  MANIFEST_FILE_NAME,
  hostManifest,
  launcherScript,
  nativeMessagingDir,
  unpackedExtensionId,
} from '../lib/manifest.mjs';

describe('unpackedExtensionId', () => {
  it('reproduces the id Chrome actually assigned this repo', () => {
    // Measured against `chrome://extensions` during the spike, not derived
    // from the same code this test exercises. That is what makes it a fixture
    // rather than a tautology.
    assert.equal(
      unpackedExtensionId('/Users/penguin/dev/headerlab/.output/chrome-mv3'),
      'emdiklpbkfcdhnljlaikoclahpkjledp',
    );
  });

  it('is 32 characters from the a-p alphabet', () => {
    const id = unpackedExtensionId('/anywhere/at/all');
    assert.equal(id.length, 32);
    assert.match(id, /^[a-p]{32}$/);
  });

  it('changes with a trailing slash — the same directory spelled differently is a different id', () => {
    // Not a curiosity: it is why the installer may not accept a path the user
    // typed and assume it matches what Chrome loaded.
    assert.notEqual(unpackedExtensionId('/a/b'), unpackedExtensionId('/a/b/'));
  });
});

describe('nativeMessagingDir', () => {
  it('derives from an explicit user-data-dir when one is given', () => {
    // The e2e case, and the reason this is a parameter at all: Playwright's
    // profile is a fresh temp directory every run, and a manifest installed
    // to the home path is silently absent there.
    assert.equal(
      nativeMessagingDir({ platform: 'darwin', userDataDir: '/tmp/profile' }),
      '/tmp/profile/NativeMessagingHosts',
    );
  });

  it('uses Chrome\u2019s macOS user-data-dir by default', () => {
    assert.equal(
      nativeMessagingDir({ platform: 'darwin', home: '/Users/x', browser: 'chrome' }),
      '/Users/x/Library/Application Support/Google/Chrome/NativeMessagingHosts',
    );
  });

  it('uses Chromium\u2019s, which is a different directory entirely', () => {
    assert.equal(
      nativeMessagingDir({ platform: 'darwin', home: '/Users/x', browser: 'chromium' }),
      '/Users/x/Library/Application Support/Chromium/NativeMessagingHosts',
    );
  });

  it('knows the Linux locations too', () => {
    assert.equal(
      nativeMessagingDir({ platform: 'linux', home: '/home/x', browser: 'chrome' }),
      '/home/x/.config/google-chrome/NativeMessagingHosts',
    );
  });

  it('refuses a platform it has not been taught rather than guessing a path', () => {
    // A wrong path here is the worst possible failure mode: everything
    // succeeds, nothing is where Chrome looks, and the extension's only
    // symptom is the same message it gives for two other causes.
    assert.throws(() => nativeMessagingDir({ platform: 'win32', home: 'C:\\' }), /win32/);
  });
});

describe('hostManifest', () => {
  it('names one exact origin — a wildcard is a hard parse failure in Chrome', () => {
    assert.deepEqual(hostManifest({ launcherPath: '/x/run', extensionId: 'abc' }), {
      name: HOST_NAME,
      description: 'HeaderLab agent bridge',
      path: '/x/run',
      type: 'stdio',
      allowed_origins: ['chrome-extension://abc/'],
    });
  });

  it('files itself under the name the extension connects to', () => {
    assert.equal(MANIFEST_FILE_NAME, `${HOST_NAME}.json`);
  });
});

describe('launcherScript', () => {
  it('names both the interpreter and the entry by absolute path', () => {
    // The measured trap: `#!/usr/bin/env node` never resolves under Chrome,
    // whose environment carries no nvm and no homebrew, and the script does
    // not execute its first line. `/bin/sh` is itself absolute, and `exec`
    // replaces the process so stdio is inherited byte for byte.
    const script = launcherScript({ nodePath: '/opt/node/bin/node', entryPath: '/r/host.mjs' });
    assert.equal(
      script,
      ['#!/bin/sh', "exec '/opt/node/bin/node' '/r/host.mjs' \"$@\"", ''].join('\n'),
    );
  });

  it('refuses a relative interpreter path instead of writing a launcher that cannot run', () => {
    assert.throws(() => launcherScript({ nodePath: 'node', entryPath: '/r/host.mjs' }), /absolute/);
  });

  it('refuses a relative entry path for the same reason', () => {
    assert.throws(
      () => launcherScript({ nodePath: '/opt/node/bin/node', entryPath: 'host.mjs' }),
      /absolute/,
    );
  });

  it('refuses a path holding a single quote rather than emitting breakable shell', () => {
    // Single-quoting is the whole of the escaping here, so a path containing
    // one would end the quote and turn the rest into shell words. Refusing is
    // right: a native messaging host at such a path is not worth the escaping
    // machinery, and a broken launcher fails the same three indistinguishable
    // ways as everything else.
    assert.throws(
      () => launcherScript({ nodePath: "/opt/no'de", entryPath: '/r/host.mjs' }),
      /quote/,
    );
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

```bash
cd packages/host && node --test test/manifest.test.mjs
```

- [ ] **Step 4: `packages/host/lib/manifest.mjs` 를 구현한다**

```js
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * Everything the installer needs to know about *what* a native messaging host
 * manifest is, with no filesystem in it. It lives in `packages/host` rather
 * than `packages/cli` because it describes this host — the name Chrome looks
 * up and the shape of the file that points at it — and `packages/cli` already
 * imports from here for the socket paths.
 */

/**
 * The name Chrome resolves in NativeMessagingHosts, and the name the extension
 * passes to `connectNative`. `lib/bridge/port.ts` holds the other spelling of
 * it — it cannot import this file, since that would pull Node into the
 * extension bundle — and `tests/unit/bridgeName.test.ts` is what keeps the two
 * from drifting apart.
 */
export const HOST_NAME = 'com.headerlab.bridge';

export const MANIFEST_FILE_NAME = `${HOST_NAME}.json`;

/**
 * The id Chrome assigns an unpacked extension: the first 16 bytes of the
 * SHA-256 of the load path's **bytes**, each hex digit mapped 0-f → a-p
 * (`id_util.cc:41-67`).
 *
 * Reproduced against a real load — `/Users/penguin/dev/headerlab/.output/chrome-mv3`
 * gives `emdiklpbkfcdhnljlaikoclahpkjledp`, which matched the
 * `chrome://extensions` card and the error URL both.
 *
 * The path is used exactly as given. A symlink, a trailing slash, or a
 * different spelling of the same directory each produce a different id, which
 * is why the installer compares its computed value against the id the browser
 * actually reports rather than trusting either one alone.
 */
export function unpackedExtensionId(loadPath) {
  const digest = createHash('sha256').update(Buffer.from(loadPath, 'utf8')).digest('hex');
  return [...digest.slice(0, 32)]
    .map((hex) => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(hex, 16)))
    .join('');
}

const USER_DATA_DIRS = {
  darwin: {
    chrome: ['Library', 'Application Support', 'Google', 'Chrome'],
    chromium: ['Library', 'Application Support', 'Chromium'],
  },
  linux: {
    chrome: ['.config', 'google-chrome'],
    chromium: ['.config', 'chromium'],
  },
};

/**
 * Where Chrome looks for host manifests: `DIR_USER_DATA + "NativeMessagingHosts"`
 * (`chrome_paths.cc:478-483`). **`--user-data-dir` moves it**, which is not a
 * corner case — every Playwright run gets its own profile, so an e2e that
 * installed to the home path would find the host silently absent.
 *
 * Throws on a platform this has not been taught. A guessed path is the worst
 * available outcome: every step reports success, the file lands somewhere
 * Chrome never reads, and the extension's only symptom is a message it gives
 * for two other causes as well.
 */
export function nativeMessagingDir({ platform, home, userDataDir, browser = 'chrome' }) {
  if (userDataDir) return path.join(userDataDir, 'NativeMessagingHosts');
  const byBrowser = USER_DATA_DIRS[platform];
  if (!byBrowser) {
    throw new Error(
      `no known NativeMessagingHosts location for platform ${platform} — ` +
        'pass --user-data-dir to name it explicitly',
    );
  }
  const segments = byBrowser[browser];
  if (!segments) throw new Error(`unknown browser: ${browser}`);
  return path.join(home, ...segments, 'NativeMessagingHosts');
}

export function hostManifest({ launcherPath, extensionId }) {
  return {
    name: HOST_NAME,
    description: 'HeaderLab agent bridge',
    path: launcherPath,
    type: 'stdio',
    // Exactly one origin, spelled out. Chrome treats a wildcard here as a hard
    // parse failure (`native_messaging_host_manifest.cc:131-134`), and a
    // rejected manifest and a wrong id produce the same message the extension
    // sees for a missing interpreter.
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

function requireAbsolute(label, value) {
  if (!path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path, got: ${value}`);
  }
  if (value.includes("'")) {
    throw new Error(`${label} must not contain a single quote: ${value}`);
  }
  return value;
}

/**
 * The file Chrome actually executes.
 *
 * A `/bin/sh` one-liner rather than a copy of the host: the real host imports
 * `../lib/host.mjs` and `../lib/socket.mjs` by relative path, so a copy would
 * either drag those along or duplicate the wiring — and duplicating a judgment
 * is this repo's most expensive defect by name. `exec` replaces the shell, so
 * stdin and stdout reach the host untouched, which is the whole protocol.
 *
 * `#!/bin/sh` is absolute and always present; the interpreter and the entry
 * are named absolutely for the measured reason that Chrome gives a host an
 * environment with no usable PATH, where `#!/usr/bin/env node` does not
 * execute the script's first line.
 */
export function launcherScript({ nodePath, entryPath }) {
  const node = requireAbsolute('the interpreter path', nodePath);
  const entry = requireAbsolute('the host entry path', entryPath);
  return ['#!/bin/sh', `exec '${node}' '${entry}' "$@"`, ''].join('\n');
}
```

- [ ] **Step 5: 통과를 확인한다**

```bash
cd packages/host && node --test test/manifest.test.mjs
```

- [ ] **Step 6: 이름 정합 가드를 쓴다**

`tests/unit/bridgeName.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOST_NAME } from '../../packages/host/lib/manifest.mjs';

/**
 * The native host name exists twice and cannot exist once.
 *
 * `packages/host/lib/manifest.mjs` is Node, and the extension bundle must
 * never import it — the bundle guard forbids exactly that kind of reach, and a
 * Node import would drag `node:crypto` into a service worker. `lib/bridge/port.ts`
 * is TypeScript compiled into the extension. So the two spellings are
 * genuinely separate, and this is the only thing that can hold them together:
 * change one and the installer writes a manifest under a name the extension
 * never asks for, with Chrome reporting the same message it gives for three
 * other causes.
 *
 * A text read rather than an import, and that limit is stated rather than
 * hidden: it proves the literal appears in the adapter's source, not that the
 * adapter passes it to `connectNative`. The unit test in tests/unit/port.test.ts
 * asserts the call argument; this asserts the two files agree.
 */
describe('the native host name', () => {
  it('is spelled identically in the adapter and the installer', () => {
    const source = readFileSync('lib/bridge/port.ts', 'utf8');
    expect(source).toContain(`export const NATIVE_HOST_NAME = '${HOST_NAME}';`);
  });

  it('is what this test thinks it is — a renamed constant must not pass vacuously', () => {
    expect(HOST_NAME).toEqual('com.headerlab.bridge');
  });
});
```

- [ ] **Step 7: 인스톨러 테스트를 쓴다 (실패하는 테스트)**

`packages/cli/test/install.test.mjs`. **핵심은 자기 검증이 진짜로 프로세스를 띄운다는 것**이고,
테스트는 그것을 스크래치 디렉터리에 대고 진짜로 한다.

```js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { bridgeStatus, installBridge, uninstallBridge } from '../lib/install.mjs';
import { MANIFEST_FILE_NAME } from '../../host/lib/manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_ENTRY = path.resolve(HERE, '../../host/bin/headerlab-host.mjs');

let root;
let options;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'headerlab-install-'));
  options = {
    manifestDir: path.join(root, 'NativeMessagingHosts'),
    launcherDir: path.join(root, 'bin'),
    entryPath: HOST_ENTRY,
    nodePath: process.execPath,
    extensionId: 'a'.repeat(32),
    // The verification host binds here rather than in the real per-user socket
    // directory, so a test run cannot be mistaken for a live bridge by a CLI
    // the developer happens to run at the same moment.
    socketDirPath: path.join(root, 'sockets'),
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('installBridge', () => {
  it('writes a manifest Chrome would accept, and a launcher it can execute', async () => {
    const result = await installBridge(options);

    assert.equal(result.ok, true);
    const manifest = JSON.parse(
      readFileSync(path.join(options.manifestDir, MANIFEST_FILE_NAME), 'utf8'),
    );
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${'a'.repeat(32)}/`]);
    assert.equal(manifest.path, result.launcherPath);
    assert.equal(manifest.type, 'stdio');

    // Executable, and executable by its owner specifically — Chrome runs it as
    // the user, and a 0644 launcher fails with the same opaque message as
    // everything else.
    assert.equal(statSync(result.launcherPath).mode & 0o700, 0o700);
  });

  it('rewrites the shebang to an absolute interpreter, which is the whole point', async () => {
    const result = await installBridge(options);
    const script = readFileSync(result.launcherPath, 'utf8');

    assert.ok(script.startsWith('#!/bin/sh\n'), script);
    // Not `env`. `#!/usr/bin/env node` was measured to leave the script with
    // zero lines executed under Chrome's environment.
    assert.ok(!script.includes('/usr/bin/env'), script);
    assert.ok(script.includes(`'${process.execPath}'`), script);
  });

  it('actually runs what it wrote and reports that it did', async () => {
    // The self-verification design §8.3 demands. Chrome reports a rejected
    // manifest, a wrong extension id and an unstartable interpreter with the
    // same message, so "the files exist" is not evidence the bridge works.
    const result = await installBridge(options);
    assert.equal(result.verified, true);
  });

  it('leaves nothing behind when verification fails', async () => {
    // A broken manifest left on disk is worse than no manifest: Chrome finds
    // it, fails, and says the same thing it says for a missing one.
    const broken = { ...options, entryPath: path.join(root, 'does-not-exist.mjs') };

    const result = await installBridge(broken);

    assert.equal(result.ok, false);
    assert.equal(existsSync(path.join(broken.manifestDir, MANIFEST_FILE_NAME)), false);
    assert.equal(existsSync(path.join(broken.launcherDir, 'headerlab-host')), false);
  });

  it('reports the interpreter it could not use rather than a generic failure', async () => {
    const result = await installBridge({ ...options, nodePath: path.join(root, 'no-node') });
    assert.equal(result.ok, false);
    assert.match(result.error.message, /no-node/);
  });
});

describe('uninstallBridge', () => {
  it('removes both files it wrote', async () => {
    const result = await installBridge(options);
    await uninstallBridge(options);

    assert.equal(existsSync(path.join(options.manifestDir, MANIFEST_FILE_NAME)), false);
    assert.equal(existsSync(result.launcherPath), false);
  });

  it('is not an error when nothing is installed', async () => {
    // Idempotent for the same reason `removeRegistryEntry` is: "make sure it
    // is gone" must not fail because it already was.
    const first = await uninstallBridge(options);
    const second = await uninstallBridge(options);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.removed.length, 0);
  });
});

describe('bridgeStatus', () => {
  it('reports nothing installed as installed:false, not as an error', async () => {
    const status = await bridgeStatus(options);
    assert.equal(status.ok, true);
    assert.equal(status.installed, false);
  });

  it('reports the origin the installed manifest actually allows', async () => {
    // The one fact that silently breaks when the extension is reloaded from a
    // different path: the manifest still parses, the launcher still runs, and
    // Chrome refuses the connection with — again — the same message.
    await installBridge(options);
    const status = await bridgeStatus(options);

    assert.equal(status.installed, true);
    assert.deepEqual(status.allowedOrigins, [`chrome-extension://${'a'.repeat(32)}/`]);
  });

  it('notices when the entry the launcher names has gone away', async () => {
    // Moving or deleting the repository leaves a manifest that parses, a
    // launcher that is executable, and an entry that is not there. Nothing
    // else in the system would ever mention it — Chrome reports it with the
    // same message as two other causes.
    //
    // Written directly rather than installed: `installBridge` verifies by
    // *running* the launcher, so an install pointed at a throwaway entry
    // would fail verification and remove the very files this is about. What
    // is under test here is the reader, not the writer.
    await installBridge(options);
    const launcherPath = path.join(options.launcherDir, 'headerlab-host');
    const gone = path.join(root, 'moved-away.mjs');
    writeFileSync(launcherPath, `#!/bin/sh\nexec '${process.execPath}' '${gone}' "$@"\n`, {
      mode: 0o700,
    });

    const status = await bridgeStatus(options);

    assert.equal(status.installed, true);
    assert.equal(status.launcherMissing, false);
    assert.equal(status.entryMissing, true);
  });

  it('does not cry entryMissing on a healthy install', async () => {
    // Absence before presence: a `entryMissing: true` constant passes the test
    // above.
    await installBridge(options);
    const status = await bridgeStatus(options);
    assert.equal(status.entryMissing, false);
  });
});
```

- [ ] **Step 8: 실패를 확인한다**

```bash
cd packages/cli && node --test test/install.test.mjs
```

- [ ] **Step 9: `packages/cli/lib/install.mjs` 를 구현한다**

```js
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_FILE_NAME,
  hostManifest,
  launcherScript,
  nativeMessagingDir,
} from '../../host/lib/manifest.mjs';
import { findLiveBridges } from './bridge.mjs';
import { isSocketAlive, socketDir, socketPathFor } from '../../host/lib/socket.mjs';

/**
 * Installs, removes and reports on the native messaging host manifest.
 *
 * Every path is a parameter rather than something this module resolves for
 * itself — the same discipline `lib/bridge.mjs` follows — because the e2e
 * suite has to install into Playwright's throwaway profile and the tests have
 * to install into a scratch directory. `defaultInstallPaths()` is where the
 * real locations are decided, and it is called by `bin/headerlab.mjs`.
 */

const LAUNCHER_NAME = 'headerlab-host';

/** How long the verification host gets to bind its socket. */
const VERIFY_TIMEOUT_MS = 5000;
const VERIFY_POLL_MS = 50;

export function defaultInstallPaths({ userDataDir = null, browser = 'chrome' } = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return {
    manifestDir: nativeMessagingDir({
      platform: process.platform,
      home: homedir(),
      userDataDir,
      browser,
    }),
    // Our own directory, not Chrome's. Chrome's holds manifests; a launcher
    // sitting among them is a file nobody expects and uninstall has to reason
    // about separately.
    launcherDir: path.join(homedir(), '.headerlab', 'bin'),
    entryPath: path.resolve(here, '../../host/bin/headerlab-host.mjs'),
    nodePath: process.execPath,
    socketDirPath: socketDir(),
  };
}

function launcherPathIn(launcherDir) {
  return path.join(launcherDir, LAUNCHER_NAME);
}

function manifestPathIn(manifestDir) {
  return path.join(manifestDir, MANIFEST_FILE_NAME);
}

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * Writes the launcher and the manifest, then **runs the launcher** and waits
 * for it to bind a socket.
 *
 * Running it is not belt-and-braces. Chrome reports a rejected manifest, an
 * origin mismatch and an unstartable interpreter with byte-identical messages
 * (measured), and the extension can see none of the three — so an installer
 * that only wrote files would be asking Chrome to diagnose it, which is this
 * repository's definition of a silent failure.
 *
 * A failed verification removes both files. Leaving them would be strictly
 * worse than not installing: Chrome would find a manifest, fail on it, and
 * report the same message as for no manifest at all.
 */
export async function installBridge({
  manifestDir,
  launcherDir,
  entryPath,
  nodePath,
  extensionId,
  socketDirPath,
}) {
  if (!existsSync(entryPath)) {
    return fail('install-failed', `the host entry does not exist: ${entryPath}`);
  }

  let script;
  try {
    script = launcherScript({ nodePath, entryPath });
  } catch (error) {
    return fail('install-failed', error.message);
  }

  const launcherPath = launcherPathIn(launcherDir);
  const manifestPath = manifestPathIn(manifestDir);

  mkdirSync(launcherDir, { recursive: true, mode: 0o700 });
  writeFileSync(launcherPath, script, { mode: 0o700 });
  chmodSync(launcherPath, 0o700);

  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    manifestPath,
    `${JSON.stringify(hostManifest({ launcherPath, extensionId }), null, 2)}\n`,
    { mode: 0o600 },
  );

  const verification = await verifyLauncher(launcherPath, extensionId, socketDirPath);
  if (!verification.ok) {
    rmSync(launcherPath, { force: true });
    rmSync(manifestPath, { force: true });
    return fail('install-failed', verification.message);
  }

  return { ok: true, manifestPath, launcherPath, extensionId, verified: true };
}

/**
 * Starts the launcher exactly the way Chrome would — one argv entry, the
 * extension origin — and waits for the socket that proves it got as far as
 * binding. Then closes its stdin, which is the documented shutdown signal, and
 * waits for it to go.
 */
async function verifyLauncher(launcherPath, extensionId, socketDirPath) {
  let child;
  try {
    child = spawn(launcherPath, [`chrome-extension://${extensionId}/`], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    return { ok: false, message: `could not run ${launcherPath}: ${error.message}` };
  }

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  const exited = new Promise((resolve) => {
    child.once('exit', (code) => resolve(code));
    child.once('error', (error) => resolve(error));
  });

  const socketPath = socketPathFor(socketDirPath, child.pid);
  const deadline = Date.now() + VERIFY_TIMEOUT_MS;
  let bound = false;
  while (Date.now() < deadline) {
    if (await isSocketAlive(socketPath)) {
      bound = true;
      break;
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, VERIFY_POLL_MS));
  }

  child.stdin.end();
  child.kill('SIGKILL');
  await exited;

  if (!bound) {
    const detail = stderr.trim() === '' ? '' : ` — it said: ${stderr.trim()}`;
    return {
      ok: false,
      message:
        `the host at ${launcherPath} did not start${detail}. ` +
        'Chrome gives no more detail than this either — it reports the same message for a ' +
        'rejected manifest, a mismatched extension id and an interpreter it cannot run.',
    };
  }
  return { ok: true };
}

/** Idempotent: removing what is not there is success, not an error. */
export async function uninstallBridge({ manifestDir, launcherDir }) {
  const removed = [];
  for (const target of [manifestPathIn(manifestDir), launcherPathIn(launcherDir)]) {
    if (!existsSync(target)) continue;
    rmSync(target, { force: true });
    removed.push(target);
  }
  return { ok: true, removed };
}

/**
 * What is on disk and what is live. Reports facts rather than a verdict — the
 * three facts that go wrong independently are whether the manifest is there,
 * which origin it names, and whether the file its launcher points at still
 * exists (moving the repository breaks exactly that one, and nothing else in
 * the system would ever mention it).
 */
export async function bridgeStatus({ manifestDir, launcherDir, socketDirPath }) {
  const manifestPath = manifestPathIn(manifestDir);
  const launcherPath = launcherPathIn(launcherDir);
  const live = await findLiveBridges(socketDirPath);
  const base = {
    ok: true,
    manifestPath,
    launcherPath,
    installed: false,
    allowedOrigins: null,
    launcherMissing: !existsSync(launcherPath),
    entryMissing: false,
    liveBridges: live.map(({ pid, origin }) => ({ pid, origin })),
  };

  if (!existsSync(manifestPath)) return base;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { ...base, installed: true, unreadableManifest: error.message };
  }

  let entryMissing = false;
  if (!base.launcherMissing) {
    const match = /^exec '([^']+)' '([^']+)'/m.exec(readFileSync(launcherPath, 'utf8'));
    entryMissing = match === null || !existsSync(match[2]);
  }

  return {
    ...base,
    installed: true,
    allowedOrigins: manifest.allowed_origins ?? null,
    entryMissing,
  };
}
```

- [ ] **Step 10: 통과를 확인한다**

```bash
cd packages/cli && node --test test/install.test.mjs
```

**끝나면 좀비를 확인하고 죽인다:**

```bash
pgrep -f headerlab-host || echo "none"
pkill -9 -f headerlab-host || true
```

- [ ] **Step 11: 아웃바운드 가드가 새 파일을 덮는지 확인한다**

`tests/unit/outbound.test.ts` 는 `packages/{cli,host}/**/*.mjs` 를 글롭한다. 새 두 파일이
목록에 들어오는지 확인한다:

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm test outbound
```

`install.mjs` 는 `child_process` 를 쓴다 — 금지 목록에 없고 그래야 한다(호스트를 띄우는 것이
이 파일의 일이다). 하지만 **그 사실을 그 파일의 독블록에 적었는지** 확인한다.

- [ ] **Step 12: 전체 검사와 커밋**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm check:all
```

```bash
git add packages/host/lib/manifest.mjs packages/host/test/manifest.test.mjs \
  packages/cli/lib/install.mjs packages/cli/test/install.test.mjs tests/unit/bridgeName.test.ts
git commit -m "feat: install a host manifest and verify it by running what it points at"
```

- [ ] **Step 13: 변이 검증 (커밋 후)**

1. `launcherScript` 의 `#!/bin/sh` 를 `#!/usr/bin/env node` 로 → 셔뱅 테스트가 빨개져야 한다
2. `verifyLauncher` 를 `return {ok:true}` 로 → `leaves nothing behind when verification fails`
3. `hostManifest` 의 `allowed_origins` 를 `['chrome-extension://*/']` 로 → 매니페스트 테스트

---

### Task 5: CLI `bridge` 서브커맨드와 SKILL.md

**Files:**
- Modify: `packages/cli/lib/args.mjs`
- Modify: `packages/cli/test/args.test.mjs`
- Modify: `packages/cli/bin/headerlab.mjs`
- Modify: `packages/cli/test/headerlab.test.mjs`
- Modify: `packages/plugin/skills/headerlab/SKILL.md`

**Interfaces:**
- Consumes: `installBridge`, `uninstallBridge`, `bridgeStatus`, `defaultInstallPaths` (Task 4),
  `unpackedExtensionId` (Task 4).
- Produces: `parse()` 가 `{cmd: 'bridge.install'|'bridge.uninstall'|'bridge.status', …}` 를 낸다.

- [ ] **Step 1: 인자 파싱 테스트를 쓴다 (실패하는 테스트)**

`packages/cli/test/args.test.mjs` 에 추가한다:

```js
describe('bridge', () => {
  it('takes an extension id verbatim', () => {
    assert.deepEqual(parse(['bridge', 'install', '--extension-id', 'abc']), {
      ok: true,
      command: { cmd: 'bridge.install', extensionId: 'abc', loadPath: null, userDataDir: null, browser: 'chrome' },
    });
  });

  it('takes a load path instead, to be turned into an id later', () => {
    // Kept as a path here rather than resolved: this file is pure, and
    // resolving means hashing the *absolute* path, which needs process.cwd().
    assert.deepEqual(parse(['bridge', 'install', '--load-path', '.output/chrome-mv3']), {
      ok: true,
      command: {
        cmd: 'bridge.install',
        extensionId: null,
        loadPath: '.output/chrome-mv3',
        userDataDir: null,
        browser: 'chrome',
      },
    });
  });

  it('refuses install with neither', () => {
    const result = parse(['bridge', 'install']);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'invalid-args');
    assert.match(result.error.message, /--extension-id|--load-path/);
  });

  it('refuses install with both — one of them would silently win', () => {
    const result = parse([
      'bridge', 'install', '--extension-id', 'abc', '--load-path', '/x',
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'invalid-args');
  });

  it('accepts the browser it should install for', () => {
    assert.deepEqual(parse(['bridge', 'install', '--extension-id', 'abc', '--browser', 'chromium']).command.browser, 'chromium');
  });

  it('refuses a browser it has no directory for', () => {
    const result = parse(['bridge', 'install', '--extension-id', 'abc', '--browser', 'firefox']);
    assert.equal(result.ok, false);
    assert.match(result.error.message, /firefox/);
  });

  it('parses uninstall and status with no arguments', () => {
    assert.deepEqual(parse(['bridge', 'uninstall']).command.cmd, 'bridge.uninstall');
    assert.deepEqual(parse(['bridge', 'status']).command.cmd, 'bridge.status');
  });

  it('names the unknown subcommand rather than the group', () => {
    const result = parse(['bridge', 'reinstall']);
    assert.equal(result.ok, false);
    assert.match(result.error.message, /reinstall/);
  });
});
```

- [ ] **Step 2: 실패를 확인하고, 파싱을 구현한다**

```bash
cd packages/cli && node --test test/args.test.mjs
```

`packages/cli/lib/args.mjs` 의 `switch (group)` 에 한 줄을 더한다:

```js
    case 'bridge':
      return parseBridge(rest);
```

사용법 문자열에도 `bridge` 를 넣는다:

```js
      'usage: headerlab <bridge|site|rule|pause|resume|state> ... — see the plugin skill for the full command list',
```

그리고 `parseState` 아래에 더한다:

```js
const BRIDGE_BROWSERS = ['chrome', 'chromium'];

/**
 * `bridge` is the one group that never reaches a socket — it is what makes a
 * socket possible. `bin/headerlab.mjs` branches on the `bridge.` prefix before
 * it resolves a target, because "no bridge is running" is the normal state for
 * someone typing `bridge install`.
 *
 * Stays pure like the rest of this file: `--load-path` is carried through as
 * the text that was typed, not resolved and hashed here. Turning it into an
 * extension id means resolving it against `process.cwd()`, which is I/O this
 * layer does not do.
 */
function parseBridge(args) {
  const [sub, ...rest] = args;
  if (sub === 'uninstall' || sub === 'status') {
    return parseNullary(rest, `bridge.${sub}`);
  }
  if (sub !== 'install') {
    return invalidArgs(`unknown bridge command: ${sub ?? '(nothing)'}`);
  }

  let values;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        'extension-id': { type: 'string' },
        'load-path': { type: 'string' },
        'user-data-dir': { type: 'string' },
        browser: { type: 'string' },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    return invalidArgs(`bridge install: ${error.message}`);
  }

  const extensionId = values['extension-id'] ?? null;
  const loadPath = values['load-path'] ?? null;
  if (extensionId === null && loadPath === null) {
    return invalidArgs(
      'bridge install needs --extension-id <id> (copy it from chrome://extensions) or ' +
        '--load-path <dir> (the unpacked directory Chrome was pointed at)',
    );
  }
  // Refused rather than resolved by precedence. `allowed_origins` takes one
  // exact origin and no wildcard, so a silent winner between two ids is a
  // manifest Chrome rejects with the same message it gives for a host that
  // does not exist.
  if (extensionId !== null && loadPath !== null) {
    return invalidArgs('bridge install takes --extension-id or --load-path, not both');
  }

  const browser = values.browser ?? 'chrome';
  if (!BRIDGE_BROWSERS.includes(browser)) {
    return invalidArgs(
      `bridge install needs --browser ${BRIDGE_BROWSERS.join('|')}, got: ${browser}`,
    );
  }

  return ok({
    cmd: 'bridge.install',
    extensionId,
    loadPath,
    userDataDir: values['user-data-dir'] ?? null,
    browser,
  });
}
```

`parseNullary` 는 지금 `{cmd}` 를 그대로 돌려주므로 `bridge.uninstall`/`bridge.status` 를 그
이름으로 넘기면 된다. 에러 문구가 `bridge.uninstall takes no arguments` 로 나오는데, 사람이
치는 것은 `bridge uninstall` 이다. `parseNullary` 에 표시용 이름을 하나 더 받게 고친다:

```js
function parseNullary(args, cmd, display = cmd) {
  if (args.length > 0) {
    return invalidArgs(`${display} takes no arguments, got: ${args.join(' ')}`);
  }
  return ok({ cmd });
}
```

그리고 호출부를 `parseNullary(rest, \`bridge.${sub}\`, \`bridge ${sub}\`)` 로 한다. 기존
`pause`/`resume` 호출은 두 인자 그대로 두면 동작이 바뀌지 않는다.

- [ ] **Step 3: bin 분기 테스트를 쓴다 (실패하는 테스트)**

`packages/cli/test/headerlab.test.mjs` 에, 그 파일이 이미 쓰는 서브프로세스 실행 헬퍼로 추가한다:

```js
it('bridge status answers without a live bridge — it never touches a socket', async () => {
  // The whole point of the branch. `bridge install` on a machine with no
  // bridge running must not fail with `bridge-off`: there is no bridge yet,
  // which is precisely why someone is running it.
  const { stdout, code } = await runCli(['bridge', 'status'], { env: cleanEnv });
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, true);
  assert.equal(code, 0);
});

it('bridge install computes the id from a load path and says which one it used', async () => {
  // The id is the one value nobody can verify from inside this process, so it
  // is reported rather than kept — the person compares it against
  // chrome://extensions, which is the only ground truth there is.
  const { stdout } = await runCli([
    'bridge', 'install',
    '--load-path', '/Users/penguin/dev/headerlab/.output/chrome-mv3',
    '--user-data-dir', scratchProfile,
  ]);
  assert.equal(JSON.parse(stdout).extensionId, 'emdiklpbkfcdhnljlaikoclahpkjledp');
});
```

두 번째 테스트는 실제로 설치와 검증을 돌린다. **끝나면 좀비를 확인한다.**

- [ ] **Step 4: bin 을 구현한다**

임포트를 더한다:

```js
import path from 'node:path';
import { bridgeStatus, defaultInstallPaths, installBridge, uninstallBridge } from '../lib/install.mjs';
import { unpackedExtensionId } from '../../host/lib/manifest.mjs';
```

`main()` 안, `resolveTarget` 을 부르기 **전에** 분기한다 — `state.set` 의 I/O 분기 바로 뒤:

```js
  // Never reaches a socket, and must not. "No bridge is running" is the normal
  // state for someone typing `bridge install` — routing it through
  // resolveTarget would fail with `bridge-off` on exactly the machine the
  // command exists to fix.
  if (command.cmd.startsWith('bridge.')) {
    await runBridgeCommand(command);
    return;
  }
```

`main()` 위에 더한다:

```js
async function runBridgeCommand(command) {
  const paths = defaultInstallPaths({
    userDataDir: command.userDataDir ?? null,
    browser: command.browser ?? 'chrome',
  });

  if (command.cmd === 'bridge.uninstall') {
    printResult(await uninstallBridge(paths));
    return;
  }
  if (command.cmd === 'bridge.status') {
    printResult(await bridgeStatus(paths));
    return;
  }

  // Resolved here rather than in args.mjs, which is pure: turning a typed path
  // into an id means resolving it against process.cwd() and hashing the bytes
  // of the result.
  const extensionId =
    command.extensionId ?? unpackedExtensionId(path.resolve(command.loadPath));

  const result = await installBridge({ ...paths, extensionId });
  if (!result.ok) {
    fail(result.error.code, result.error.message);
    return;
  }
  printResult({
    ...result,
    // Reported, never assumed. A symlink, a trailing slash, or a differently
    // spelled path to the same directory each yield a different id, and
    // `allowed_origins` takes no wildcard — so a mismatch is a bridge that
    // installs cleanly and never connects, with Chrome giving the same
    // message it gives for a manifest that is not there at all.
    ...(command.extensionId === null
      ? {
          note:
            `computed from ${path.resolve(command.loadPath)} — check it against the id on ` +
            'chrome://extensions before assuming this worked',
        }
      : {}),
  });
}
```

`fail()` 과 `printResult()` 는 이미 그 파일에 있다. `fail` 이 `process.exitCode = 1` 을
세우므로 실패 경로의 종료 코드는 자동으로 따라온다.

- [ ] **Step 5: SKILL.md 를 고친다**

- 명령 표에 `headerlab bridge install|uninstall|status` 를 더한다.
- `bridge-off` 절에 한 문단을 더한다: 브리지가 안 도는 흔한 이유는 호스트 매니페스트가 설치되지
  않은 것이고, **`headerlab bridge install` 은 사람이 팝업에서 Enable 을 누른 뒤에 의미가
  있다** — CLI 는 권한을 줄 수 없다.
- 에러 코드 목록에 `store-unreadable`, `unsupported`, `install-failed` 를 더한다. 각각이 무슨
  뜻이고 에이전트가 무엇을 해야 하는지 한 줄씩:
  - `store-unreadable` — 저장된 상태를 읽을 수 없다. 아무것도 안 썼고 아무것도 안 덮었다.
    사람에게 팝업을 열어보라고 말하고 멈춘다.
  - `unsupported` — 이 빌드가 거절한다(지금은 regex 필터 하나뿐). 우회하지 않는다.
  - `install-failed` — 매니페스트를 쓰긴 했으나 검증에 실패해 되돌렸다. 메시지를 그대로 전한다.

- [ ] **Step 6: 검사와 커밋**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm check:all
pgrep -f headerlab-host || echo none
```

```bash
git add packages/cli packages/plugin/skills/headerlab/SKILL.md
git commit -m "feat: add the bridge install subcommand to the CLI"
```

---

### Task 6: e2e — 사슬 전체

**Files:**
- Modify: `wxt.config.ts` (e2e 모드에만 `nativeMessaging`)
- Modify: `tests/unit/manifest.test.ts` (프로덕션에 안 새는지)
- Create: `tests/e2e/bridge-fixtures.ts`
- Create: `tests/e2e/bridge.spec.ts`

**이 태스크는 이 단계의 합격 증거다.** 약화시키지 않는다. 못 하겠으면 BLOCKED 로 보고한다.

- [ ] **Step 1: 매니페스트 디렉터리를 먼저 측정한다**

무엇을 쓰기 전에, Chrome 이 `--user-data-dir` 안의 `NativeMessagingHosts/` 를 실제로 읽는지
확인한다. 스크래치에서:

1. `mkdtemp` 로 프로필 디렉터리를 만든다
2. `pnpm build:e2e` 로 빌드하고, 그 절대 경로에서 `unpackedExtensionId` 로 ID 를 계산한다
3. `headerlab bridge install --load-path <빌드경로> --user-data-dir <프로필>` 을 돌린다
4. Playwright 로 `chromium.launchPersistentContext(<프로필>, {--load-extension=…})`
5. SW 에서 `chrome.permissions.getAll()` 로 `nativeMessaging` 을 확인하고,
   `chrome.runtime.connectNative('com.headerlab.bridge')` 를 부른 뒤 소켓 디렉터리에
   `bridge-*.sock` 가 생기는지 본다

**측정 결과를 보고서에 적는다.** 안 되면 멈추고 보고한다 — 무엇을 측정했고 무엇이 나왔는지.

- [ ] **Step 2: e2e 빌드에 권한을 넣는다**

`wxt.config.ts` 의 e2e 분기를 확장한다:

```ts
    // e2e builds only. Two things Playwright cannot do: click Chrome's consent
    // dialog for a runtime permission, and click the popup's Enable button
    // before the worker has started. Granting both at install in this build is
    // the same bargain the loopback host permission already makes — and
    // tests/unit/manifest.test.ts asserts neither reaches production.
    ...(mode === 'e2e'
      ? {
          host_permissions: ['http://127.0.0.1/*'],
          permissions: [
            'storage',
            'declarativeNetRequestWithHostAccess',
            'nativeMessaging',
          ],
        }
      : {}),
```

`manifest.test.ts` 에 하나 더한다:

```ts
  it('does not carry the e2e build\u2019s nativeMessaging grant', () => {
    // The e2e build hands it out at install so Playwright never meets a
    // consent dialog. A production build doing that would give away the
    // zero-permission posture without anyone noticing — the manifest would
    // still look small.
    expect(readManifest().permissions).not.toContain('nativeMessaging');
  });
```

- [ ] **Step 3: 브리지 픽스처를 쓴다**

`tests/e2e/bridge-fixtures.ts` — 기존 `fixtures.ts` 를 베끼되 프로필 디렉터리를 직접 만든다:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { assertBuildFresh } from '../support/build';
import { unpackedExtensionId } from '../../packages/host/lib/manifest.mjs';
import { installBridge, uninstallBridge } from '../../packages/cli/lib/install.mjs';
import { socketDir } from '../../packages/host/lib/socket.mjs';

/**
 * A context whose native messaging host is installed into its own profile.
 *
 * `fixtures.ts` launches with `''`, letting Playwright pick a throwaway
 * profile — which is unusable here: Chrome resolves NativeMessagingHosts from
 * the user data dir, so a manifest has to be written into a directory that
 * exists before launch. That is the one genuinely new difficulty in this layer
 * and it is the whole reason this file is separate rather than an option on
 * the other one.
 *
 * The extension id is computed from the load path *before* launch, because the
 * manifest needs it and `allowed_origins` takes no wildcard. `derivedId` is
 * exported so the test can assert it against the id the browser really
 * assigned — which is exactly the self-verification §8.3 asks for, done
 * against a running Chrome rather than by hand.
 */
export const test = base.extend<{
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  derivedId: string;
  bridgeSocketDir: string;
}>({
  // oxlint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const extensionPath = assertBuildFresh('e2e');
    const profile = mkdtempSync(path.join(tmpdir(), 'headerlab-e2e-'));
    const paths = {
      manifestDir: path.join(profile, 'NativeMessagingHosts'),
      launcherDir: path.join(profile, 'bin'),
      entryPath: path.resolve('packages/host/bin/headerlab-host.mjs'),
      nodePath: process.execPath,
      extensionId: unpackedExtensionId(extensionPath),
      socketDirPath: socketDir(),
    };
    const installed = await installBridge(paths);
    if (!installed.ok) throw new Error(`bridge install failed: ${installed.error.message}`);

    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
    await uninstallBridge(paths);
    rmSync(profile, { recursive: true, force: true });
  },

  derivedId: async ({}, use) => {
    await use(unpackedExtensionId(assertBuildFresh('e2e')));
  },

  bridgeSocketDir: async ({}, use) => {
    await use(socketDir());
  },

  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const id = serviceWorker.url().split('/')[2];
    if (!id) throw new Error(`could not derive extension id from ${serviceWorker.url()}`);
    await use(id);
  },
});

export const expect = test.expect;
```

**`chromium` 채널을 쓰므로 `nativeMessagingDir` 의 `chromium` 분기가 맞는지 주의한다** — 여기서는
`userDataDir` 을 명시하므로 브라우저 분기를 타지 않는다. 그것이 이 픽스처가 `userDataDir` 을
쓰는 또 하나의 이유다.

- [ ] **Step 4: 사슬 테스트를 쓴다**

`tests/e2e/bridge.spec.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './bridge-fixtures';

/**
 * The only test in this repository that exercises the whole bridge: a real
 * CLI process, a real unix socket, a real native messaging host launched by a
 * real Chrome, and a real service worker writing real storage. Everything
 * else in the suite proves one link.
 */

/**
 * `@types/chrome` is not in this project's type program, so `tsc --noEmit`
 * reports TS2503 without a declaration — the same reason
 * `header-modification.spec.ts` carries one. Declare only what is touched
 * here rather than reaching for `any`.
 */
declare const chrome: {
  storage: { local: { get(key: string): Promise<Record<string, unknown>> } };
};

test('the id computed from the load path is the id Chrome assigned', async ({
  extensionId,
  derivedId,
}) => {
  // `allowed_origins` takes no wildcard, so the manifest is written before
  // launch from a value nothing had confirmed. This is that confirmation, and
  // it is the reason the installer may compute an id but must report it.
  expect(derivedId).toEqual(extensionId);
});

test('a CLI command reaches storage through the bridge', async ({
  context,
  serviceWorker,
  extensionId,
  bridgeSocketDir,
}) => {
  // The port opens at worker startup because the e2e build holds the
  // permission outright. Wait for the host to have bound rather than for a
  // duration — a duration photographs whichever moment the machine landed on,
  // which is the same trap `scripts/screenshots.mjs` documents for its waits.
  const origin = `chrome-extension://${extensionId}/`;
  await expect
    .poll(() => findBridgePid(bridgeSocketDir, origin), { timeout: 15_000 })
    .not.toBeNull();
  const pid = findBridgePid(bridgeSocketDir, origin);

  const stdout = execFileSync(
    process.execPath,
    ['packages/cli/bin/headerlab.mjs', '--bridge', String(pid), 'site', 'add', 'example.com'],
    { encoding: 'utf8' },
  );
  const reply = JSON.parse(stdout);

  expect(reply.ok).toBe(true);
  expect(reply.changed).toBe(true);

  // Read it back out of the browser, not off the reply. The reply is what the
  // adapter *said*; storage is what a reconcile will actually compile.
  const stored = (await serviceWorker.evaluate(async () => {
    const { state } = await chrome.storage.local.get('state');
    return state;
  })) as { profiles: Array<{ filter: { domains: string[] } }> };
  // The exact list, not "contains". A reducer that appended the domain twice,
  // or that replaced the list instead of adding to it, both pass a containment
  // check and neither is what `site add` means.
  expect(stored.profiles[0]!.filter.domains).toEqual(['example.com']);
});

test('the popup says the bridge is live', async ({ context, extensionId, bridgeSocketDir }) => {
  await expect
    .poll(() => findBridgePid(bridgeSocketDir, `chrome-extension://${extensionId}/`), {
      timeout: 15_000,
    })
    .not.toBeNull();

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  // The whole point of the row: a person who did not run the CLI can still see
  // that an agent could. `toHaveAttribute` retries, so this is not a race.
  await expect(page.getByTestId('bridgestate')).toHaveAttribute('data-bridge', 'live');
});

/** The registry is what makes a specific bridge addressable — see §8.6. */
function findBridgePid(dir: string, origin: string): number | null {
  for (const name of readdirSync(dir)) {
    const match = /^(\d+)\.json$/.exec(name);
    if (!match) continue;
    try {
      const entry = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
      if (entry.origin === origin) return Number(match[1]);
    } catch {
      // A half-written entry is not this test's bridge.
    }
  }
  return null;
}
```

**`--bridge <pid>` 는 생략할 수 없다.** 개발자 자신의 Chrome 이 동시에 브리지를 띄우고 있을 수
있고, 그러면 CLI 는 `multiple-bridges` 로 끝난다. 레지스트리에서 origin 으로 찾는 것이 정확히
그 레지스트리가 존재하는 이유다.

- [ ] **Step 5: 돌린다**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm test:e2e
pgrep -f headerlab-host || echo none
```

- [ ] **Step 6: 커밋과 변이 검증**

```bash
git add wxt.config.ts tests/unit/manifest.test.ts tests/e2e/bridge-fixtures.ts tests/e2e/bridge.spec.ts
git commit -m "test: drive a CLI command through the whole bridge in a real Chrome"
```

커밋 후: `lib/bridge/port.ts` 의 `setState` 호출을 지우고 e2e 가 빨개지는지 본다. 되돌린다.

---

### Task 7: 문서

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-11-agent-bridge-design.md`

- [ ] **Step 1: 설계 문서를 사실에 맞춘다**

§5 의 상태 표 아래에, `idle` 의 뜻이 바뀌었다는 것과 **그 이유**를 적는다 — 호스트가 소켓
클라이언트를 확장에 알리게 하면 릴레이가 프로토콜 참여자가 되고, 그것은
`packages/cli/lib/bridge.mjs` 가 이름으로 반대해둔 것이다. 원래 문장을 지우지 말고 무엇이
바뀌었는지 보이게 남긴다 — 이 저장소의 문서는 기록이다.

§11 의 단계 목록에서 4·5·6 을 완료로 표시한다.

§10 의 미결 표에서 Q12 옆에 "3차도 필요로 하지 않았다" 를 적는다.

- [ ] **Step 2: README**

- "Not wired up yet" 를 지운다. 이제 물려 있다.
- Agent bridge 절에 **켜는 절차 세 줄**을 넣는다: 팝업에서 Enable → `headerlab bridge install
  --load-path <확장 디렉터리>` → 팝업이 `Bridge live` 로 바뀐다.
- 신뢰 주장 셋 아래에 넷째를 더한다: **CLI 는 권한을 켤 수 없다.** `Enable` 은 사람이 누르고
  Chrome 자체 동의 대화상자를 거친다. 그리고 **regex 필터를 거절한다** — 검증할 것도 보여줄
  것도 없기 때문이다.
- 테스트 개수를 다시 센다.
- 팝업 스크린샷이 Task 3 에서 다시 찍혔으므로 그것을 쓴다.

- [ ] **Step 3: CLAUDE.md**

Non-negotiables 의 "Zero host permissions at install" 항목 안에 한 문단을 더한다:

> **`optional_permissions` 는 `["nativeMessaging"]` 이고, 설치 시점 `permissions` 는 여전히
> 정확히 둘이다.** `manifest.test.ts` 가 셋 다 고정한다. Chrome 이 이 권한을 optional 불가로
> 바꾸면 실패가 조용하다 — `permissions_parser.cc` 가 목록에서 지우고 설치 경고만 남기며
> 유일한 정합성 검사는 릴리즈 빌드에서 컴파일 아웃된다. 그래서 매니페스트 문자열이 아니라
> **런타임 승인이 진짜 가드**이고, 그것을 도는 것은 `tests/e2e/bridge.spec.ts` 뿐이다.

Architecture 트리의 `lib/bridge/` 줄에 `port.ts` 를 더하고 "the one browser caller" 라고 적는다.

Testing 절에 e2e 개수를 갱신하고, **브리지 e2e 가 무엇을 증명하는지** 한 줄로 적는다 — 로드
경로에서 계산한 ID 가 Chrome 이 실제로 부여한 ID 와 같다는 것까지 포함해서.

Known gaps 에 더한다:
- **브리지의 `idle` 은 "CLI 가 안 붙었다"가 아니라 "포트가 안 열렸다"** 이고, 그 차이는 확장이
  호스트의 소켓 클라이언트를 볼 수 없기 때문이다.
- **`bridge install` 은 `~/.headerlab/bin/headerlab-host` 를 쓴다.** 저장소를 옮기면 그것이
  가리키는 엔트리가 사라지고, 그 사실을 말하는 것은 `headerlab bridge status` 뿐이다.

- [ ] **Step 4: 검사와 커밋**

```
PATH="$PWD/.superpowers/sdd/2026-08-12-agent-bridge-packaging:$PATH" pnpm check:all
```

```bash
git add README.md CLAUDE.md docs/
git commit -m "docs: record what the bridge does now that it is connected"
```

---

## 이 계획이 끝나면

`pnpm check:all` 과 `pnpm test:e2e` 가 초록이고, PR #17 을 병합할 수 있다. 저장소는 squash
merge 만 허용한다.

병합 전에 사용자 환경 정리 하나가 남아 있다 — 스파이크 잔재:

```
rm "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.headerlab.spike.json"
```
