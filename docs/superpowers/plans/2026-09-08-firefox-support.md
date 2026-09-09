# Firefox Support (Build Target + E2E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HeaderLab 을 Firefox MV3 확장으로도 빌드하고, Firefox 가 거부하는 것을 순수 계층에서 걸러 말하며, 진짜 Firefox 에서 헤더가 wire 에 닿는 것을 의존성 없이 e2e 로 증명한다.

**Architecture:** 빌드 타깃(`'chrome' | 'firefox'`)은 `lib/target.ts` 한 곳에서 `import.meta.env.BROWSER` 로 읽고, 순수 계층(`compile` 과 그 호출 그래프)은 그것을 **매개변수로** 받는다. 타깃별로 다른 사실은 `lib/compile/capabilities.ts` 한 파일에 표로 둔다. Firefox e2e 는 Playwright 의 브라우저 대신 Firefox 자체의 Marionette 프로토콜을 `node:net` 으로 말하는 클라이언트를 통해 돌리되, 러너는 `@playwright/test` 그대로 쓴다.

**Tech Stack:** WXT 0.21 (`-b firefox`, `manifestVersion: 3`), React 19, zod 4, vitest 4, `@playwright/test` 1.62 (러너만), Node 24 `node:net`/`node:child_process`, Firefox ≥ 138 (`-remote-allow-system-access`).

**Spec:** `docs/superpowers/specs/2026-09-08-firefox-support-design.md` — 측정치는 `docs/research/2026-09-08-firefox-marionette-spike.md`. 이 플랜이 스펙과 다르면 스펙이, 스펙이 스파이크와 다르면 스파이크가 맞다.

## Global Constraints

- **새 의존성 없음.** `package.json` 의 `dependencies`/`devDependencies` 는 한 줄도 바뀌지 않는다. `pnpm-lock.yaml` 도 바뀌지 않는다 (CLAUDE.md: 이 머신에서 락파일을 쓰지 않는다).
- **pnpm 만 쓴다.** `pnpm test` 는 빌드를 포함한다 — 빌드 산출물을 읽는 테스트를 bare `vitest run` 으로 돌리지 않는다.
- **gecko id 는 `headerlab@say8425.github.io`**, `strict_min_version` 은 `'128.0'`, `data_collection_permissions` 는 `{ required: ['none'] }`. 이 셋은 `wxt.config.ts` 에 리터럴로, `tests/support/firefox.ts` 의 `GECKO_ID` 와 매니페스트 테스트가 묶는다.
- **Firefox 매니페스트에 `optional_permissions` 없음.** `permissions` 는 정확히 `['storage', 'declarativeNetRequestWithHostAccess']`, `host_permissions` 키 없음(프로덕션), `optional_host_permissions` 는 `['<all_urls>']`.
- **순수 파일은 `@/lib/target` 을 import 하지 않는다.** 타깃은 인자다. `tests/unit/purity.test.ts` 가 기계로 막는다.
- **타깃 매개변수에 기본값을 두지 않는다.** `target: Target = 'chrome'` 은 금지 — Chrome 을 전제한 호출을 조용히 살려두는 자리다.
- **릴리스 워크플로·`pnpm zip`·`pnpm crx`·`store:*` 는 손대지 않는다.**
- **Firefox e2e 는 Marionette 만** (`--marionette --remote-allow-system-access --headless`), 프로필은 `test-results/` 아래, 스폰은 `detached: true`, 종료는 프로세스 그룹에 SIGKILL.
- **카피 규칙:** 양쪽 브라우저에 보이는 문장에 "Chrome" 을 쓰지 않는다. Chrome 에서만 뜨는 문장(`append-not-allowed`, 브릿지 행)은 그대로.
- **커밋:** `<type>: <description>`, 영어, 스쿼시 머지 전제. 모든 커밋 메시지는 다음 두 트레일러로 끝난다:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01X7XpCj1bESKpE1VkojMAis
  ```
- **린트는 `correctness` 를 error 로 돈다.** 쓰지 않는 매개변수·변수는 빌드를 깨뜨린다. 새 fixture 의 빈 구조분해에는 기존 `tests/e2e/fixtures.ts` 와 같은 `// oxlint-disable-next-line no-empty-pattern` 을 단다 (CLAUDE.md 의 억제 개수가 8→9 로 바뀐다 — Task 8 이 고친다).
- 브랜치는 `feat/firefox-support` (이미 있음, 스펙 커밋 `8a5e9ec` 위).

---

## 파일 구조

**새로 만드는 것**

| 파일 | 책임 |
| --- | --- |
| `lib/target.ts` | `TARGET` 상수 — `import.meta.env.BROWSER` 를 읽는 유일한 곳 |
| `lib/compile/capabilities.ts` | 타깃별 사실 표: 지원 리소스 타입, append 허용, 브릿지 유무, 브라우저 이름 |
| `tests/unit/target.test.ts`, `tests/unit/capabilities.test.ts`, `tests/unit/suppression.test.ts` | 위 둘과 새 억제 사유 |
| `tests/unit/App.firefox.test.tsx` | `TARGET` 을 firefox 로 모킹한 팝업 |
| `tests/support/marionette.ts` | Marionette 클라이언트 (`node:net`, 바이트 프레이밍) |
| `tests/support/firefox.ts` | Firefox 찾기·프로필·실행·세션 헬퍼 |
| `tests/unit/marionette.test.ts` | 프레임 파서 |
| `tests/e2e/firefox-fixtures.ts`, `tests/e2e/firefox.spec.ts` | Firefox e2e 세 테스트 |

**고치는 것**

| 파일 | 무엇 |
| --- | --- |
| `lib/model/types.ts` | `Target`, `DiagnosticKind` 에 `'unsupported-resource-type'` |
| `lib/model/schema.ts` | `RESOURCE_TYPES` export |
| `lib/compile/{validate,conditions,suppression,filterDiagnostics,conflicts,compile}.ts`, `lib/permissions/audit.ts`, `lib/bridge/query.ts` | `target` 매개변수, Firefox 동작 |
| `lib/sync/ruleSync.ts`, `lib/bridge/port.ts`, `entrypoints/popup/App.tsx` | `TARGET` 을 넘김; 팝업은 브릿지 행 숨김·타입 노트 |
| `components/ScopeRail.tsx`, `components/TypeChecklist.tsx` | `bridge: 'unavailable'`, `typeNote`/`note` |
| `packages/headerlab/lib/render.mjs` | 새 억제 사유 문장 |
| `wxt.config.ts`, `package.json` | Firefox 타깃, 스크립트 |
| `tests/support/build.ts`, `tests/unit/{manifest,bundle,purity}.test.ts` | 빌드 두 개, Firefox 매니페스트 가드 |
| 시그니처가 바뀐 함수를 부르는 단위 테스트 10개 | `'chrome'` 명시 |
| `.github/workflows/ci.yml` | `firefox --version` 단계 |
| `README.md` + `docs/README.{ko,ja,zh,es}.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-07-31-headerlab-design.md` | 문서 |

---

### Task 1: `Target` 타입, `TARGET` 상수, 능력표

**Files:**
- Modify: `lib/model/types.ts` (`HeaderTarget` 바로 아래, `DiagnosticKind` 의 `'invalid-domain'` 뒤)
- Modify: `lib/model/schema.ts` (`resourceType` enum 아래)
- Create: `lib/target.ts`
- Create: `lib/compile/capabilities.ts`
- Create: `tests/unit/target.test.ts`, `tests/unit/capabilities.test.ts`
- Modify: `tests/unit/purity.test.ts`

**Interfaces:**
- Produces: `type Target = 'chrome' | 'firefox'` (types.ts); `const TARGET: Target` (target.ts); `RESOURCE_TYPES: readonly ResourceType[]` (schema.ts); capabilities.ts 의 `SUPPORTED_RESOURCE_TYPES: Readonly<Record<Target, ReadonlySet<ResourceType>>>`, `supportedResourceTypes(target, types): ResourceType[]`, `unsupportedResourceTypes(target, types): ResourceType[]`, `hasBridge(target): boolean`, `BROWSER_NAME: Readonly<Record<Target, string>>`; `DiagnosticKind` 에 `'unsupported-resource-type'`.

- [ ] **Step 1: 실패하는 테스트를 쓴다 — 능력표**

`tests/unit/capabilities.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  BROWSER_NAME,
  SUPPORTED_RESOURCE_TYPES,
  hasBridge,
  supportedResourceTypes,
  unsupportedResourceTypes,
} from '@/lib/compile/capabilities';
import { RESOURCE_TYPES } from '@/lib/model/schema';

describe('resource types per target', () => {
  it('Chrome accepts every type the schema allows', () => {
    // Asserted against the schema's own list, not a literal: the two cannot
    // drift apart when a sixteenth type arrives.
    expect([...SUPPORTED_RESOURCE_TYPES.chrome].sort()).toEqual([...RESOURCE_TYPES].sort());
    expect(RESOURCE_TYPES).toHaveLength(15);
  });

  it('Firefox is missing exactly webtransport and webbundle', () => {
    // Measured 2026-09-08 (docs/research/2026-09-08-firefox-marionette-spike.md):
    // either one rejects the whole updateDynamicRules batch with
    // "Invalid enumeration value". BCD records both as version_added: false.
    const missing = RESOURCE_TYPES.filter((t) => !SUPPORTED_RESOURCE_TYPES.firefox.has(t));
    expect(missing.sort()).toEqual(['webbundle', 'webtransport']);
  });

  it('filters in the order given, keeping what the target knows', () => {
    expect(supportedResourceTypes('firefox', ['webbundle', 'main_frame', 'webtransport', 'xmlhttprequest'])).toEqual([
      'main_frame',
      'xmlhttprequest',
    ]);
    expect(supportedResourceTypes('chrome', ['webbundle', 'main_frame'])).toEqual(['webbundle', 'main_frame']);
  });

  it('names what it dropped, in the order given', () => {
    expect(unsupportedResourceTypes('firefox', ['webbundle', 'main_frame', 'webtransport'])).toEqual([
      'webbundle',
      'webtransport',
    ]);
    expect(unsupportedResourceTypes('chrome', ['webbundle', 'main_frame'])).toEqual([]);
  });
});

describe('the rest of the table', () => {
  it('offers the agent bridge on Chrome only', () => {
    // Firefox event pages close ports on idle (spec §9), so the bridge as
    // designed cannot run there and the popup must not offer it.
    expect(hasBridge('chrome')).toBe(true);
    expect(hasBridge('firefox')).toBe(false);
  });

  it('spells each browser the way copy will', () => {
    expect(BROWSER_NAME).toEqual({ chrome: 'Chrome', firefox: 'Firefox' });
  });
});
```

`tests/unit/target.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TARGET } from '@/lib/target';

describe('the build target under vitest', () => {
  it('is chrome — WXT defines import.meta.env.BROWSER per build, and the fallback is chrome', () => {
    // Every unit test that passes a target passes it explicitly; this one
    // only pins what the adapters see when nothing was built for Firefox.
    expect(TARGET).toBe('chrome');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm exec vitest run tests/unit/capabilities.test.ts tests/unit/target.test.ts`
Expected: FAIL — `Cannot find module '@/lib/compile/capabilities'` (그리고 `@/lib/target`).

- [ ] **Step 3: 타입과 스키마 export 를 더한다**

`lib/model/types.ts`, `export type HeaderTarget = 'request' | 'response';` 바로 아래에:

```ts
/**
 * The browser a build is for.
 *
 * Decided once, at build time, in `lib/target.ts`; everything pure takes it as
 * a parameter rather than reading it, so Firefox behaviour is testable without
 * a Firefox build. `lib/compile/capabilities.ts` is the one table of what each
 * target accepts.
 */
export type Target = 'chrome' | 'firefox';
```

같은 파일, `DiagnosticKind` 의 마지막 멤버 `| 'invalid-domain';` 를 다음으로 바꾼다:

```ts
  | 'invalid-domain'
  /**
   * The profile lists a request type this browser's declarativeNetRequest
   * does not know. Sending it rejects the whole batch ("Invalid enumeration
   * value", measured on Firefox), so the compiler drops the type instead —
   * `warning` when other types remain, `error` when none do and the profile
   * is suppressed (`suppressionReason` → `'no-resource-type'`).
   */
  | 'unsupported-resource-type';
```

`lib/model/schema.ts`, `const resourceType = z.enum([...]);` 바로 아래에 (파일 상단에 `import type { ResourceType } from '@/lib/model/types';` 가 없으면 추가):

```ts
/**
 * The fifteen values, in schema order, for anyone who needs the list rather
 * than the validator — `lib/compile/capabilities.ts` derives each target's
 * supported set from it, so a sixteenth type added here reaches that table
 * without a second list to update.
 */
export const RESOURCE_TYPES: readonly ResourceType[] = resourceType.options;
```

- [ ] **Step 4: `lib/target.ts` 를 만든다**

```ts
import type { Target } from '@/lib/model/types';

/**
 * The one place the build target is read.
 *
 * WXT defines `import.meta.env.BROWSER` per `-b` at build time
 * (`core/utils/globals.mjs`, through Vite `define`), so this folds to a
 * literal in each bundle. Under vitest the WxtVitest plugin defines it too,
 * and anything that is not `'firefox'` — including undefined — reads as
 * Chrome, because Chrome is the build every other tool in this repository
 * produces by default.
 *
 * **Only adapters and the popup import this.** `lib/compile/`, `lib/view/`,
 * `lib/permissions/audit.ts` and `lib/bridge/query.ts` take a `Target`
 * parameter instead, and tests/unit/purity.test.ts forbids this import in
 * every guarded file — a pure function whose answer depends on which bundle
 * it was compiled into is not pure, and would only be testable by building
 * for Firefox.
 */
export const TARGET: Target = import.meta.env.BROWSER === 'firefox' ? 'firefox' : 'chrome';
```

- [ ] **Step 5: `lib/compile/capabilities.ts` 를 만든다**

```ts
import { RESOURCE_TYPES } from '@/lib/model/schema';
import type { ResourceType, Target } from '@/lib/model/types';

/**
 * What each browser's declarativeNetRequest accepts, in one place.
 *
 * "One predicate, one definition" (CLAUDE.md), applied to the browser: every
 * difference between targets that the compiler, the diagnostics or the popup
 * has to know about is a row here, never an `if (target === 'firefox')`
 * somewhere else. Pure — `lib/compile/` is auto-guarded by
 * tests/unit/purity.test.ts — and the target arrives as a parameter, never
 * from `lib/target.ts`.
 *
 * Every row is measured, not read off a compatibility table:
 * docs/research/2026-09-08-firefox-marionette-spike.md.
 */

/**
 * Types Firefox's DNR schema does not know. `updateDynamicRules` answers a
 * rule carrying one with `Invalid enumeration value "webbundle"` and rejects
 * the **whole batch** — every other rule with it. BCD records both as
 * `version_added: false`.
 */
const FIREFOX_UNSUPPORTED_RESOURCE_TYPES: ReadonlySet<ResourceType> = new Set([
  'webtransport',
  'webbundle',
]);

export const SUPPORTED_RESOURCE_TYPES: Readonly<Record<Target, ReadonlySet<ResourceType>>> = {
  chrome: new Set(RESOURCE_TYPES),
  firefox: new Set(RESOURCE_TYPES.filter((t) => !FIREFOX_UNSUPPORTED_RESOURCE_TYPES.has(t))),
};

/** `types` less what `target` cannot take, in the order given. */
export function supportedResourceTypes(
  target: Target,
  types: readonly ResourceType[],
): ResourceType[] {
  const supported = SUPPORTED_RESOURCE_TYPES[target];
  return types.filter((t) => supported.has(t));
}

/** The complement of {@link supportedResourceTypes}, for the diagnostic that names them. */
export function unsupportedResourceTypes(
  target: Target,
  types: readonly ResourceType[],
): ResourceType[] {
  const supported = SUPPORTED_RESOURCE_TYPES[target];
  return types.filter((t) => !supported.has(t));
}

/**
 * Whether the agent bridge can exist on this target.
 *
 * Firefox MV3 backgrounds are event pages, and "message ports cannot prevent
 * an event page from shutting down … the ports are closed when the event page
 * idles" (MDN). The native host dies with the port, so the bridge as designed
 * — a host that stays up holding a socket — cannot run there. Spec §9; the
 * Firefox bridge is its own spec. The popup renders no bridge row where this
 * is false, and the Firefox manifest declares no `nativeMessaging`.
 */
export function hasBridge(target: Target): boolean {
  return target === 'chrome';
}

/** How copy spells each browser. */
export const BROWSER_NAME: Readonly<Record<Target, string>> = {
  chrome: 'Chrome',
  firefox: 'Firefox',
};
```

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

Run: `pnpm exec vitest run tests/unit/capabilities.test.ts tests/unit/target.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: 순수 가드에 새 파일과 새 금지 패턴을 더한다**

`tests/unit/purity.test.ts`:

1. `FORBIDDEN` 배열의 마지막 항목 뒤에 추가:
   ```ts
     // The build-target constant is an adapter concern. A pure function that
     // read it would answer differently per bundle and be testable only by
     // building for Firefox; the target arrives as a parameter instead.
     /from\s+['"]@\/lib\/target['"]/,
   ```
2. `it('auto-discovers every file in lib/compile', …)` 의 `expect.arrayContaining([...])` 목록에 `'lib/compile/capabilities.ts',` 를 `'lib/compile/compile.ts',` 앞에 추가.
3. `describe('the guard itself', …)` 안에 테스트 추가:
   ```ts
     it('catches an import of the build-target constant', () => {
       const source = stripComments(`import { TARGET } from '@/lib/target';`);
       expect(source).toMatch(/from\s+['"]@\/lib\/target['"]/);
     });
   ```

Run: `pnpm exec vitest run tests/unit/purity.test.ts`
Expected: PASS.

- [ ] **Step 8: 타입체크·린트·포맷**

Run: `pnpm typecheck && pnpm lint && pnpm format:check`
Expected: 모두 0 errors. `format:check` 가 불평하면 `pnpm format` 후 다시.

- [ ] **Step 9: 커밋**

```bash
git add lib/model/types.ts lib/model/schema.ts lib/target.ts lib/compile/capabilities.ts tests/unit/target.test.ts tests/unit/capabilities.test.ts tests/unit/purity.test.ts
git commit -F - <<'EOF'
feat: name the build target once and table what each browser accepts

`lib/target.ts` is the only reader of import.meta.env.BROWSER; the pure
layer will take a Target parameter. `lib/compile/capabilities.ts` holds
the per-target facts the spike measured: Firefox's DNR rejects
webtransport and webbundle as enum values, and offers no agent bridge
because event pages close native ports on idle.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7XpCj1bESKpE1VkojMAis
EOF
```

---

### Task 2: 타깃을 순수 계층에 꿰고, Firefox 동작을 넣는다

이 과제는 하나로 간다: 리소스 타입을 거르는 `conditions.ts` 와 그 결과가 빌 때 닫는 `suppression.ts` 는 따로 커밋할 수 없다 (하나만 있으면 `resourceTypes: []` 가 DNR 에 닿아 배치를 깨뜨린다), 그리고 시그니처가 바뀌면 어댑터까지 같이 바뀌어야 `pnpm typecheck` 가 초록이다.

**Files:**
- Modify: `lib/compile/capabilities.ts` (append 허용목록 이사), `lib/compile/validate.ts`, `lib/compile/conditions.ts`, `lib/compile/suppression.ts`, `lib/compile/filterDiagnostics.ts`, `lib/compile/conflicts.ts`, `lib/compile/compile.ts`, `lib/permissions/audit.ts`, `lib/bridge/query.ts`
- Modify (어댑터, `TARGET` 전달만): `lib/sync/ruleSync.ts:71`, `lib/bridge/port.ts:245`, `entrypoints/popup/App.tsx:121,182,362-364,376,593`
- Create: `tests/unit/suppression.test.ts`
- Modify (테스트): `tests/unit/validate.test.ts`, `conditions.test.ts`, `filterDiagnostics.test.ts`, `conflicts.test.ts`, `compile.test.ts`, `audit.test.ts`, `query.test.ts`, `port.test.ts`, `ruleSync.test.ts`, `migrate.test.ts`, `App.test.tsx:776`

**Interfaces:**
- Consumes: Task 1 의 `Target`, `supportedResourceTypes`, `unsupportedResourceTypes`, `BROWSER_NAME`, `TARGET`.
- Produces (기본값 없음):
  - `isAppendAllowed(target: Target, headerTarget: HeaderTarget, name: string): boolean` 과 `APPEND_ALLOWED_REQUEST_HEADERS` — **`capabilities.ts` 로 이사**, `validate.ts` 에서는 사라진다
  - `validateHeaders(profile: Profile, target: Target): Diagnostic[]`
  - `filterToCondition(filter: Filter, target: Target, tabId?: number | null): DnrRuleCondition`
  - `type SuppressionReason = 'no-scope' | 'unusable-site' | 'no-resource-type'`; `suppressionReason(profile: Profile, target: Target)`; `isSuppressed(profile: Profile, target: Target)`
  - `validateFilter(profile: Profile, target: Target): Diagnostic[]`
  - `detectConflicts(profiles: readonly Profile[], target: Target): Diagnostic[]`
  - `compile(state: AppState, target: Target): CompileResult`
  - `domainsToAudit(profiles: readonly Profile[], target: Target): string[]`; `auditDiagnostics(profiles, grants, target: Target): Diagnostic[]`
  - `status(state: AppState, target: Target): StatusPayload`

- [ ] **Step 1: 실패하는 테스트 — append 는 Firefox 에서 자유롭다**

`tests/unit/validate.test.ts` 상단 import 를 다음으로 바꾼다:

```ts
import { validateHeaders } from '@/lib/compile/validate';
import { APPEND_ALLOWED_REQUEST_HEADERS, isAppendAllowed } from '@/lib/compile/capabilities';
```

`describe('the append allowlist', …)` 안에 추가:

```ts
  it('is Chrome\'s: Firefox appends any request header (measured 2026-09-08)', () => {
    // docs/research/2026-09-08-firefox-marionette-spike.md — `X-Custom`
    // with operation `append` was ACCEPTED by Firefox's updateDynamicRules
    // and is refused by Chrome outside the 21-entry allowlist.
    expect(isAppendAllowed('chrome', 'request', 'X-Custom')).toBe(false);
    expect(isAppendAllowed('firefox', 'request', 'X-Custom')).toBe(true);
    expect(isAppendAllowed('chrome', 'request', 'Accept-Language')).toBe(true);
  });

  it('never restricts a response header on either target', () => {
    expect(isAppendAllowed('chrome', 'response', 'X-Custom')).toBe(true);
    expect(isAppendAllowed('firefox', 'response', 'X-Custom')).toBe(true);
  });

  it('raises append-not-allowed on Chrome and not on Firefox for the same row', () => {
    const p = profileWith([row({ operation: 'append', name: 'X-Custom' })]);
    expect(validateHeaders(p, 'chrome').map((d) => d.kind)).toEqual(['append-not-allowed']);
    expect(validateHeaders(p, 'firefox')).toEqual([]);
  });
```

같은 파일의 나머지 호출을 고친다: 모든 `validateHeaders(X)` → `validateHeaders(X, 'chrome')`, 모든 `isAppendAllowed('request', N)` / `isAppendAllowed('response', N)` → `isAppendAllowed('chrome', 'request', N)` / `isAppendAllowed('chrome', 'response', N)`. (파일에 `validateHeaders(`/`isAppendAllowed(` 가 합쳐서 15군데 있다 — 다 고치면 `grep -c "'chrome'" tests/unit/validate.test.ts` 가 그 수 이상이다.)

- [ ] **Step 2: 실패하는 테스트 — 리소스 타입은 타깃별로 걸러진다**

`tests/unit/conditions.test.ts` 에 describe 추가:

```ts
describe('filterToCondition — resource types per target', () => {
  it('drops what Firefox does not know and keeps the order of the rest', () => {
    const f = { ...base, resourceTypes: ['webbundle', 'main_frame', 'webtransport', 'xmlhttprequest'] as const };
    expect(filterToCondition({ ...f, resourceTypes: [...f.resourceTypes] }, 'firefox').resourceTypes).toEqual([
      'main_frame',
      'xmlhttprequest',
    ]);
  });

  it('sends Chrome the list untouched', () => {
    const f = { ...base, resourceTypes: ['webbundle', 'main_frame'] as const };
    expect(filterToCondition({ ...f, resourceTypes: [...f.resourceTypes] }, 'chrome').resourceTypes).toEqual([
      'webbundle',
      'main_frame',
    ]);
  });
});
```

같은 파일의 나머지 호출: `filterToCondition(X)` → `filterToCondition(X, 'chrome')`, `filterToCondition(X, N)` (탭 id 를 넘기던 곳) → `filterToCondition(X, 'chrome', N)`.

- [ ] **Step 3: 실패하는 테스트 — 새 억제 사유**

`tests/unit/suppression.test.ts` 를 만든다:

```ts
import { describe, expect, it } from 'vitest';
import { isSuppressed, suppressionReason } from '@/lib/compile/suppression';
import { createProfile } from '@/lib/model/defaults';
import type { Filter, Profile } from '@/lib/model/types';

function profileWith(filter: Partial<Filter>): Profile {
  const base = createProfile('P', 0);
  return { ...base, id: 'p1', filter: { ...base.filter, ...filter } };
}

describe('suppressionReason — request types', () => {
  it('fails a Firefox profile closed when no listed type is supported there', () => {
    // A rule with `resourceTypes: []` is rejected by DNR, and one with the
    // key omitted widens to every type but main_frame — so nothing usable
    // left means no rule, said out loud.
    const p = profileWith({ domains: ['api.example.com'], resourceTypes: ['webbundle'] });
    expect(suppressionReason(p, 'firefox')).toBe('no-resource-type');
    expect(isSuppressed(p, 'firefox')).toBe(true);
    expect(suppressionReason(p, 'chrome')).toBeNull();
  });

  it('outranks all-sites: that mode empties the domain condition, not the type condition', () => {
    const p = profileWith({ allSites: true, domains: [], resourceTypes: ['webtransport'] });
    expect(suppressionReason(p, 'firefox')).toBe('no-resource-type');
    expect(suppressionReason(p, 'chrome')).toBeNull();
  });

  it('is not raised while one supported type remains', () => {
    const p = profileWith({ domains: ['api.example.com'], resourceTypes: ['webbundle', 'xmlhttprequest'] });
    expect(suppressionReason(p, 'firefox')).toBeNull();
  });

  it('does not trust the schema about emptiness — an empty list is closed on Chrome too', () => {
    // schema.ts says min(1); this predicate is the last line before DNR and
    // decides for itself, the same way conditions.ts drops bad domains.
    const p = profileWith({ domains: ['api.example.com'], resourceTypes: [] });
    expect(suppressionReason(p, 'chrome')).toBe('no-resource-type');
  });

  it('still answers the two older reasons with a target in hand', () => {
    expect(suppressionReason(profileWith({ domains: [] }), 'chrome')).toBe('no-scope');
    expect(suppressionReason(profileWith({ domains: ['a b.com'] }), 'firefox')).toBe('unusable-site');
  });
});
```

- [ ] **Step 4: 실패하는 테스트 — 진단과 중립 카피**

`tests/unit/filterDiagnostics.test.ts` 에 describe 추가:

```ts
describe('validateFilter — unsupported-resource-type', () => {
  it('is an error, naming the browser and the types, when nothing usable is left', () => {
    const d = validateFilter(profileWith({ domains: ['a.com'], resourceTypes: ['webbundle', 'webtransport'] }), 'firefox');
    expect(d).toEqual([
      {
        kind: 'unsupported-resource-type',
        severity: 'error',
        profileId: 'p1',
        message: 'Not supported in Firefox: webbundle, webtransport.',
      },
    ]);
  });

  it('is a warning when other types carry the rule', () => {
    const d = validateFilter(profileWith({ domains: ['a.com'], resourceTypes: ['webbundle', 'xmlhttprequest'] }), 'firefox');
    expect(d.map((x) => [x.kind, x.severity, x.message])).toEqual([
      ['unsupported-resource-type', 'warning', 'Not supported in Firefox: webbundle.'],
    ]);
  });

  it('says nothing on Chrome for the same list', () => {
    expect(validateFilter(profileWith({ domains: ['a.com'], resourceTypes: ['webbundle', 'webtransport'] }), 'chrome')).toEqual([]);
  });

  it('is raised in all-sites mode too — the mode drops the domains, not the types', () => {
    const d = validateFilter(profileWith({ allSites: true, domains: [], resourceTypes: ['webbundle'] }), 'firefox');
    expect(d.map((x) => x.kind)).toEqual(['unsupported-resource-type']);
  });
});
```

같은 파일: 모든 `validateFilter(X)` → `validateFilter(X, 'chrome')`. 그리고 카피가 바뀐 기대값 셋을 고친다 — 78행 근처 `'Chrome only accepts ASCII characters in a regex filter.'` → `'Only ASCII characters are accepted in a regex filter.'`, 84행 근처 `'This regex is too large. Chrome caps a compiled pattern at 2KB.'` → `'This regex is too large. A compiled pattern is capped at 2KB.'`, 경로 패턴 테스트의 `'Chrome only accepts ASCII characters in a path pattern.'` → `'Only ASCII characters are accepted in a path pattern.'` (`grep -n "Chrome" tests/unit/filterDiagnostics.test.ts` 로 찾는다; 메시지를 `toEqual` 로 통째로 비교하는 곳만 해당).

- [ ] **Step 5: 실패하는 테스트 — 컴파일러·감사·쿼리**

`tests/unit/compile.test.ts` 에 describe 추가 (파일의 `profile()`/`state()` 헬퍼를 쓴다):

```ts
describe('compile — per target', () => {
  it('emits no rule on Firefox for a profile whose only types it cannot take, and says so', () => {
    const s = state({
      profiles: [profile({ filter: { ...profile().filter, resourceTypes: ['webbundle'] } })],
    });
    const result = compile(s, 'firefox');
    expect(result.dynamic).toEqual([]);
    expect(result.diagnostics.map((d) => [d.kind, d.severity])).toEqual([
      ['unsupported-resource-type', 'error'],
    ]);
    // The identical state compiles on Chrome: the difference is the target, nothing else.
    expect(compile(s, 'chrome').dynamic).toHaveLength(1);
  });

  it('sends Firefox a narrowed rule, with a warning, when some types survive', () => {
    const s = state({
      profiles: [profile({ filter: { ...profile().filter, resourceTypes: ['webbundle', 'xmlhttprequest'] } })],
    });
    const result = compile(s, 'firefox');
    expect(result.dynamic.map((r) => r.condition.resourceTypes)).toEqual([['xmlhttprequest']]);
    expect(result.diagnostics.map((d) => d.severity)).toEqual(['warning']);
  });
});
```

`tests/unit/audit.test.ts` 에 추가 (파일의 `p()` 헬퍼):

```ts
describe('domainsToAudit — per target', () => {
  it('skips a profile Firefox suppresses for its request types, like any other suppressed profile', () => {
    const only = p('p1', 'A', ['api.example.com']);
    const firefoxDead = { ...only, filter: { ...only.filter, resourceTypes: ['webbundle' as const] } };
    expect(domainsToAudit([firefoxDead], 'firefox')).toEqual([]);
    expect(domainsToAudit([firefoxDead], 'chrome')).toEqual(['api.example.com']);
  });
});
```

`tests/unit/query.test.ts` 에 추가 (파일의 상태 헬퍼를 그대로 쓴다; 없으면 `compile.test.ts` 의 `state()`/`profile()` 을 복사):

```ts
describe('status — per target', () => {
  it('reports no-resource-type on Firefox and nothing on Chrome for the same store', () => {
    const s = state({
      profiles: [profile({ filter: { ...profile().filter, resourceTypes: ['webbundle'] } })],
    });
    expect(status(s, 'firefox').suppression).toBe('no-resource-type');
    expect(status(s, 'chrome').suppression).toBeNull();
    expect(status(s, 'firefox').tally?.live).toBe(0);
  });
});
```

나머지 파일들의 기존 호출을 고친다 (전부 `'chrome'` 을 새 인자 자리에):

| 파일 | 바꿀 호출 |
| --- | --- |
| `tests/unit/compile.test.ts` | `compile(X)` → `compile(X, 'chrome')` |
| `tests/unit/conflicts.test.ts` | `detectConflicts(X)` → `detectConflicts(X, 'chrome')` |
| `tests/unit/audit.test.ts` | `domainsToAudit(X)` → `domainsToAudit(X, 'chrome')`; `auditDiagnostics(X, Y)` → `auditDiagnostics(X, Y, 'chrome')` |
| `tests/unit/query.test.ts` | `status(X)` → `status(X, 'chrome')` |
| `tests/unit/port.test.ts` | `status(` 가 코드로 불리면 같은 방식; 주석이면 그대로 |
| `tests/unit/ruleSync.test.ts:188,221` | `compile(stateB)` → `compile(stateB, 'chrome')`, `compile(state)` → `compile(state, 'chrome')` |
| `tests/unit/migrate.test.ts:75` | `compile(parseAppState(...))` → `compile(parseAppState(...), 'chrome')` |
| `tests/unit/App.test.tsx:776` | `validateFilter({...})` → `validateFilter({...}, 'chrome')` |

- [ ] **Step 6: 실패를 확인한다**

Run: `pnpm typecheck`
Expected: 시그니처 불일치로 여러 오류 — 새 테스트가 부르는 인자 수와 구현이 다르다. (아직 구현 전이므로 vitest 는 돌리지 않는다.)

- [ ] **Step 7: `capabilities.ts` 에 append 허용목록을 옮긴다**

`lib/compile/capabilities.ts` 의 `hasBridge` 앞에 추가 — `lib/compile/validate.ts` 의 `APPEND_ALLOWED_REQUEST_HEADERS` 선언(docblock 포함, `export const … = new Set([...]);` 까지)을 **잘라내어** 여기 붙이고, 아래 함수를 그 뒤에 둔다. import 에 `HeaderTarget` 을 더한다 (`import type { HeaderTarget, ResourceType, Target } from '@/lib/model/types';`).

```ts
/**
 * Whether `append` is accepted for this header on this target.
 *
 * Chrome: response headers always, request headers only from the allowlist
 * above — outside it, `updateDynamicRules` fails the whole batch with
 * ERROR_APPEND_INVALID_REQUEST_HEADER. Firefox: any header, either
 * direction — measured 2026-09-08, `X-Custom` appended to a request was
 * accepted. The name is compared trimmed and lower-cased because header
 * names are case-insensitive and the popup persists what was typed.
 */
export function isAppendAllowed(target: Target, headerTarget: HeaderTarget, name: string): boolean {
  if (headerTarget === 'response') return true;
  if (target === 'firefox') return true;
  return APPEND_ALLOWED_REQUEST_HEADERS.has(name.trim().toLowerCase());
}
```

`lib/compile/validate.ts`: 옛 `isAppendAllowed` 함수와 `APPEND_ALLOWED_REQUEST_HEADERS` 를 지우고, 상단에 `import { isAppendAllowed } from '@/lib/compile/capabilities';` 와 `import type { Diagnostic, Profile, Target } from '@/lib/model/types';` (기존 `HeaderTarget` import 는 더 이상 쓰지 않으면 제거). 시그니처와 호출:

```ts
export function validateHeaders(profile: Profile, target: Target): Diagnostic[] {
```
```ts
    if (rule.operation === 'append' && !isAppendAllowed(target, rule.target, name)) {
```

- [ ] **Step 8: `conditions.ts`**

```ts
import { supportedResourceTypes } from '@/lib/compile/capabilities';
import type { DnrRuleCondition, Filter, Target } from '@/lib/model/types';
```
```ts
export function filterToCondition(
  filter: Filter,
  target: Target,
  tabId?: number | null,
): DnrRuleCondition {
```
`const condition: DnrRuleCondition = { resourceTypes: [...filter.resourceTypes] };` 를 다음으로:

```ts
  // Narrowed to what this browser's DNR schema knows. Firefox has no
  // `webtransport`/`webbundle` and rejects the whole batch for either one
  // (capabilities.ts). This can leave an empty list — DNR refuses that too,
  // and omitting the key would widen the rule to every type but main_frame —
  // so `suppressionReason` fails the profile closed (`'no-resource-type'`)
  // before compile.ts ever asks for this condition. Same pairing as the
  // domain drop above: neither half is safe alone.
  const condition: DnrRuleCondition = {
    resourceTypes: supportedResourceTypes(target, filter.resourceTypes),
  };
```

- [ ] **Step 9: `suppression.ts`**

```ts
import { supportedResourceTypes } from '@/lib/compile/capabilities';
import { isValidDomain } from '@/lib/permissions/origins';
import type { Profile, Target } from '@/lib/model/types';
```
```ts
export type SuppressionReason =
  /** Nothing says where to apply: no site listed, and all-sites is off. */
  | 'no-scope'
  /** A listed site cannot be used, so the whole profile fails closed. */
  | 'unusable-site'
  /**
   * No listed request type is one this browser's DNR knows, so there is no
   * type condition to send: an empty list is rejected and an omitted key
   * widens to every type but main_frame. Outranks all-sites, which empties
   * the domain condition and says nothing about types.
   */
  | 'no-resource-type';
```
```ts
export function suppressionReason(profile: Profile, target: Target): SuppressionReason | null {
  const { allSites, domains, mode, resourceTypes } = profile.filter;

  // First, before the all-sites early return below: that mode drops the
  // domain condition on purpose and leaves the type condition exactly as it
  // is, so a profile with no usable type is dead in either mode. Decided here
  // rather than trusting schema.ts's min(1): this is the last predicate before
  // DNR, and conditions.ts drops types the same way it drops bad domains.
  if (supportedResourceTypes(target, resourceTypes).length === 0) return 'no-resource-type';

  if (allSites) return null;
  // (아래는 그대로)
```
```ts
export function isSuppressed(profile: Profile, target: Target): boolean {
  return suppressionReason(profile, target) !== null;
}
```

- [ ] **Step 10: `filterDiagnostics.ts`**

import:
```ts
import { BROWSER_NAME, unsupportedResourceTypes } from '@/lib/compile/capabilities';
import { suppressionReason } from '@/lib/compile/suppression';
import { analyzeDomain } from '@/lib/permissions/origins';
import type { Diagnostic, Profile, Target } from '@/lib/model/types';
```
시그니처 `export function validateFilter(profile: Profile, target: Target): Diagnostic[] {`. `const reason = suppressionReason(profile);` 를 `const reason = suppressionReason(profile, target);` 로 바꾸고, 그 줄 **바로 아래**(도메인 `bad` 계산보다 앞)에:

```ts
  // Said before the domain diagnostics, because it outranks them in
  // `suppressionReason`. Raised in every mode: all-sites drops the domain
  // list, not the type list. `error` exactly when the suppression reason is
  // this one — the same coupling `invalid-domain` below keeps with
  // `'unusable-site'`.
  const dropped = unsupportedResourceTypes(target, filter.resourceTypes);
  if (dropped.length > 0) {
    diagnostics.push({
      kind: 'unsupported-resource-type',
      severity: reason === 'no-resource-type' ? 'error' : 'warning',
      profileId: profile.id,
      message: `Not supported in ${BROWSER_NAME[target]}: ${dropped.join(', ')}.`,
    });
  }
```

카피 셋:
- `'Chrome only accepts ASCII characters in a regex filter.'` → `'Only ASCII characters are accepted in a regex filter.'`
- `'This regex is too large. Chrome caps a compiled pattern at 2KB.'` → `'This regex is too large. A compiled pattern is capped at 2KB.'`
- `'Chrome only accepts ASCII characters in a path pattern.'` → `'Only ASCII characters are accepted in a path pattern.'`

- [ ] **Step 11: `conflicts.ts`, `compile.ts`, `audit.ts`, `query.ts`**

`conflicts.ts`: `import type { Diagnostic, HeaderRule, Operation, Profile, Target } from '@/lib/model/types';`, `export function detectConflicts(profiles: readonly Profile[], target: Target): Diagnostic[] {`, 71행 `.filter((p) => p.enabled && !isSuppressed(p, target))`.

`compile.ts`: `import type { AppState, CompileResult, Diagnostic, DnrRule, Target } from '@/lib/model/types';`, `export function compile(state: AppState, target: Target): CompileResult {`, 그리고

```ts
    diagnostics.push(...validateHeaders(profile, target), ...validateFilter(profile, target));
```
```ts
  diagnostics.push(...detectConflicts(state.profiles, target));
```
```ts
      if (isSuppressed(profile, target)) continue;
```
```ts
        condition: filterToCondition(
          profile.filter,
          target,
          alloc.scope === 'session' ? profile.tabLock.tabId : undefined,
        ),
```

`audit.ts`: `import type { Diagnostic, Profile, Target } from '@/lib/model/types';`, `export function domainsToAudit(profiles: readonly Profile[], target: Target): string[] {` 와 안의 `isSuppressed(profile, target)`; `export function auditDiagnostics(profiles: readonly Profile[], grants: readonly DomainGrant[], target: Target): Diagnostic[] {` 와 안의 `isSuppressed(profile, target)`.

`query.ts`: `import type { AppState, Diagnostic, Profile, Target } from '@/lib/model/types';`, `export function status(state: AppState, target: Target): StatusPayload {`, `const compiled = compile(state, target);`, `live: profile.enabled && !state.globalPause && !isSuppressed(profile, target),`, `suppression: profile ? suppressionReason(profile, target) : null,`.

- [ ] **Step 12: 어댑터에 `TARGET` 을 넘긴다**

`lib/sync/ruleSync.ts`: `import { TARGET } from '@/lib/target';` 를 추가하고 71행 `const result = compile(state);` → `const result = compile(state, TARGET);`.

`lib/bridge/port.ts`: `import { TARGET } from '@/lib/target';` 추가, 245행 `status(loaded.state)` → `status(loaded.state, TARGET)`.

`entrypoints/popup/App.tsx`: `import { TARGET } from '@/lib/target';` 추가, 그리고
- 121행 `compile(state)` → `compile(state, TARGET)`
- 182행 `domainsToAudit(state.profiles)` → `domainsToAudit(state.profiles, TARGET)`
- 362-364행 `auditDiagnostics(state.profiles, domainsToAudit(state.profiles).map(...))` — 안쪽 `domainsToAudit(state.profiles, TARGET)`, 바깥 `auditDiagnostics(…, …, TARGET)` (마지막 인자로)
- 376행 `isSuppressed(active)` → `isSuppressed(active, TARGET)`
- 593행 `domainsToAudit(current.profiles)` → `domainsToAudit(current.profiles, TARGET)`

`grep -rn "compile(\|isSuppressed(\|domainsToAudit(\|auditDiagnostics(\|status(\|validateFilter(\|validateHeaders(\|filterToCondition(\|detectConflicts(\|suppressionReason(" lib components entrypoints --include='*.ts' --include='*.tsx' | grep -v 'export function' | grep -v '^\S*:\s*//' | grep -v '^\S*:\s*\*'` 로 남은 호출이 전부 타깃을 받는지 눈으로 확인한다.

- [ ] **Step 13: 초록 확인**

Run: `pnpm typecheck`
Expected: 0 errors. 오류가 남으면 그 줄이 타깃을 못 받은 호출이다 — 위 표대로 고친다.

Run: `pnpm exec vitest run tests/unit`
Expected: PASS (빌드를 읽는 파일 — `manifest`, `bundle`, `theme`, `buildFreshness` — 은 `.output/chrome-mv3` 가 stale 이면 그 사실을 이름으로 말하며 빨강일 수 있다; 그러면 `pnpm test` 로 대신 돌린다).

Run: `pnpm lint && pnpm format:check`
Expected: 0. (`format` 이 불평하면 `pnpm format`.)

- [ ] **Step 14: 커밋**

```bash
git add lib tests/unit entrypoints/popup/App.tsx
git commit -F - <<'EOF'
feat: compile for a target — Firefox drops two resource types and appends freely

Every pure entry point takes a Target; the adapters pass TARGET. On
Firefox, conditions.ts narrows resourceTypes to what its DNR schema
knows and suppressionReason fails the profile closed
('no-resource-type') when nothing is left — the pairing that keeps an
empty list from reaching updateDynamicRules. validateFilter says which
types were dropped. isAppendAllowed moves into the capability table and
answers true for any request header on Firefox, as measured.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7XpCj1bESKpE1VkojMAis
EOF
```

---

### Task 3: 팝업 — Firefox 에는 브릿지 행이 없고, 걸러진 타입은 한 줄로 말한다

**Files:**
- Modify: `components/TypeChecklist.tsx`
- Modify: `components/ScopeRail.tsx` (props 인터페이스 ~55-98행, `bridgeTitle` 212-245행, `bridgeState` ~346행, 브릿지 행 `<div … data-testid="bridgestate">` ~466-583행, `<TypeChecklist …/>` 1015행)
- Modify: `entrypoints/popup/App.tsx` (import, 브릿지 probe effect ~282-294행, `bridgeMode` ~419-426행, `<ScopeRail …>` props ~440-452행)
- Modify: `tests/unit/ScopeRail.test.tsx` (`props()` 헬퍼에 `typeNote: null`)
- Create: `tests/unit/App.firefox.test.tsx`

**Interfaces:**
- Consumes: `hasBridge`, `TARGET`, `Diagnostic` (`routed.scope`).
- Produces: `ScopeRailProps.bridge: 'unknown' | 'off' | 'idle' | 'live' | 'unavailable'`; `ScopeRailProps.typeNote: { severity: 'error' | 'warning'; message: string } | null`; `TypeChecklistProps.note?: { severity: 'error' | 'warning'; message: string } | null`; DOM: `[data-testid="type-note"][data-severity]`.

- [ ] **Step 1: 실패하는 테스트 — ScopeRail**

`tests/unit/ScopeRail.test.tsx` 의 `props()` 에 `typeNote: null,` 을 `onDisableBridge: vi.fn(),` 뒤에 추가한다. 파일 끝에:

```ts
describe('a target with no bridge', () => {
  it('renders no bridge row at all — not a disabled one', () => {
    // Absence first: the row is the only element with this test id, and a
    // popup that drew a switch nobody can flip would be showing a control
    // the user cannot reach.
    renderRail({ bridge: 'unavailable' });
    expect(screen.queryByTestId('bridgestate')).toBeNull();
    expect(screen.queryByTestId('bridge-label')).toBeNull();
    // The rest of the rail is untouched by the absence.
    expect(screen.getByTestId('runstate')).toBeTruthy();
    expect(screen.getByTestId('rail-section-types')).toBeTruthy();
  });
});

describe('the request-type note', () => {
  it('is absent when there is nothing to say', () => {
    renderRail();
    expect(screen.queryByTestId('type-note')).toBeNull();
  });

  it('shows the message on one line, coloured by severity, with the full text in the title', () => {
    renderRail({ typeNote: { severity: 'warning', message: 'Not supported in Firefox: webbundle.' } });
    const note = screen.getByTestId('type-note');
    expect(note.textContent).toBe('Not supported in Firefox: webbundle.');
    expect(note.getAttribute('title')).toBe('Not supported in Firefox: webbundle.');
    expect(note.getAttribute('data-severity')).toBe('warning');
    expect(note.className).toContain('truncate');
    expect(note.className).toContain('text-pending');

    cleanup();
    renderRail({ typeNote: { severity: 'error', message: 'Not supported in Firefox: webbundle, webtransport.' } });
    expect(screen.getByTestId('type-note').getAttribute('data-severity')).toBe('error');
    expect(screen.getByTestId('type-note').className).toContain('text-destructive');
  });
});
```

(`cleanup` 을 `@testing-library/react` import 에 추가.)

- [ ] **Step 2: 실패하는 테스트 — Firefox 로 모킹한 App**

`tests/unit/App.firefox.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/entrypoints/popup/App';
import { createProfile } from '@/lib/model/defaults';
import * as probe from '@/lib/permissions/probe';
import type { AppState } from '@/lib/model/types';

// The one module the pure layer is forbidden to import is mocked here, in a
// file of its own, so no other App test inherits a Firefox build by accident.
vi.mock('@/lib/target', () => ({ TARGET: 'firefox' }));

function seed(state: AppState) {
  return fakeBrowser.storage.local.set({ state, state$: { v: 2 } });
}

function stateWith(over: Partial<AppState> = {}): AppState {
  const p = createProfile('Local', 0);
  return {
    version: 2,
    globalPause: false,
    theme: 'system',
    profiles: [
      {
        ...p,
        id: 'p1',
        filter: { ...p.filter, domains: ['api.example.com'] },
        headers: [
          { id: 'h1', enabled: true, target: 'request', operation: 'set', name: 'X-A', value: '1' },
        ],
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(probe, 'probeGrants').mockResolvedValue([{ domain: 'api.example.com', granted: true }]);
  vi.spyOn(probe, 'probeAllSites').mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the popup built for Firefox', () => {
  it('renders no bridge row and never asks about nativeMessaging', async () => {
    const nativeProbe = vi.spyOn(probe, 'probeNativeMessaging').mockResolvedValue(true);
    await seed(stateWith());

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('readout')).toBeTruthy());
    expect(screen.queryByTestId('bridgestate')).toBeNull();
    expect(nativeProbe).not.toHaveBeenCalled();
  });

  it('says which request types it dropped, on the checklist that can fix them', async () => {
    const s = stateWith();
    s.profiles[0]!.filter.resourceTypes = ['webbundle', 'xmlhttprequest'];
    await seed(s);

    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('type-note').textContent).toBe('Not supported in Firefox: webbundle.'),
    );
    expect(screen.getByTestId('type-note').getAttribute('data-severity')).toBe('warning');
    // The rule still goes out — one live, none blocked.
    expect(screen.getByTestId('readout').textContent).toBe('1 of 1 live');
  });

  it('counts the rule as blocked, not live, when no listed type survives', async () => {
    const s = stateWith();
    s.profiles[0]!.filter.resourceTypes = ['webbundle'];
    await seed(s);

    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('type-note').getAttribute('data-severity')).toBe('error'),
    );
    expect(screen.getByTestId('readout').textContent).toBe('0 of 1 live · 1 blocked');
  });
});
```

리드아웃 문자열의 정확한 형태는 `components/RulePanel.tsx` 의 `.join(' · ')` 조립을 따른다 — 기대값이 틀리면 테스트 출력의 실제 문자열을 읽고 **구현이 아니라 기대값**을 그 형식에 맞춘다 (단, `blocked` 가 1 이어야 한다는 사실은 양보하지 않는다).

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm exec vitest run tests/unit/ScopeRail.test.tsx tests/unit/App.firefox.test.tsx`
Expected: FAIL — `typeNote` 를 모르는 타입 오류이거나 `type-note` 를 찾지 못함; App 테스트는 `bridgestate` 가 렌더됨.

- [ ] **Step 4: `TypeChecklist` 에 노트를 더한다**

`components/TypeChecklist.tsx`:

```ts
export interface TypeChecklistProps {
  selected: readonly ResourceType[];
  onToggle: (type: ResourceType) => void;
  /**
   * The `unsupported-resource-type` diagnostic for the shown rule set, or
   * null. Rendered here rather than as a rail note because this is the
   * control that can act on it: a type this browser does not know is
   * cleared by ticking one it does. One line, always — `truncate` and the
   * full text in `title`, the rule CLAUDE.md's Interface section states for
   * every state-dependent line.
   */
  note?: { severity: 'error' | 'warning'; message: string } | null;
}
```

컴포넌트 시그니처 `export function TypeChecklist({ selected, onToggle, note = null }: TypeChecklistProps) {`, 그리고 반환 JSX 를 다음으로 (grid 는 그대로, 바깥을 fragment 로 감싼다):

```tsx
  return (
    <>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1" data-testid="type-grid">
        {/* (기존 OFFERED.map 그대로) */}
      </div>
      {note === null ? null : (
        // Severity carried by colour, the same two the site rows use: the
        // pending palette for a rule that still goes out narrower than
        // written, destructive for one that goes nowhere. Appears rather than
        // reserved (Interface carve-out 2): bounded to one line, and in this
        // build reachable only through a hand-edited store.
        <p
          data-testid="type-note"
          data-severity={note.severity}
          title={note.message}
          className={`mt-1 truncate text-[11px] leading-[14px] font-semibold ${
            note.severity === 'error' ? 'text-destructive' : 'text-pending'
          }`}
        >
          {note.message}
        </p>
      )}
    </>
  );
```

- [ ] **Step 5: `ScopeRail` — `unavailable` 과 `typeNote`**

props 인터페이스:
- `bridge: 'unknown' | 'off' | 'idle' | 'live';` → `bridge: 'unknown' | 'off' | 'idle' | 'live' | 'unavailable';` 그리고 그 docblock 끝에 한 문단: `` `unavailable` is a build with no bridge at all (Firefox: `hasBridge(TARGET)` is false). Not a state of the bridge — the row is not rendered, because a switch nobody can flip is a control the user cannot reach. ``
- `onDisableBridge: () => void;` 뒤에:
  ```ts
  /** The `unsupported-resource-type` diagnostic for this rule set, or null — see TypeChecklist. */
  typeNote: { severity: 'error' | 'warning'; message: string } | null;
  ```
- 컴포넌트의 구조분해 매개변수 목록에 `typeNote` 추가.

`bridgeTitle`: `if (bridge === 'unknown') return null;` → `if (bridge === 'unknown' || bridge === 'unavailable') return null;`.

`bridgeState` 삼항: `: bridge === 'unknown' ? null` → `: bridge === 'unknown' || bridge === 'unavailable' ? null`.

브릿지 행: `<div className="relative mt-1 flex h-5 items-center gap-[7px]" data-testid="bridgestate" …>` 부터 그 짝 `</div>` 까지를 `{bridge === 'unavailable' ? null : ( … )}` 로 감싼다. 감싸기 직전에 JSX 주석 한 줄:

```tsx
        {/* No row on a build with no bridge (Firefox, spec §9): the 21px it
            held returns to the rail and is deliberately left unspent. */}
```

`<TypeChecklist selected={resourceTypes} onToggle={onToggleType} />` → `<TypeChecklist selected={resourceTypes} onToggle={onToggleType} note={typeNote} />`.

- [ ] **Step 6: `App.tsx`**

import 에 `import { hasBridge } from '@/lib/compile/capabilities';` 추가 (Task 2 에서 `TARGET` import 는 이미 있다).

브릿지 probe effect (`probeNativeMessaging()` 를 부르는 `useEffect`, ~282행) 의 첫 줄에:

```ts
    // Nothing to probe for on a build with no bridge: the Firefox manifest
    // declares no nativeMessaging permission and the rail renders no row.
    if (!hasBridge(TARGET)) return;
```

`bridgeMode` 계산을 다음으로:

```ts
  const bridgeMode: ScopeRailProps['bridge'] = !hasBridge(TARGET)
    ? 'unavailable'
    : bridgeAllowed === null
      ? 'unknown'
      : !bridgeAllowed
        ? 'off'
        : bridgeStatus.connected
          ? 'live'
          : 'idle';
```

`const routed = routeDiagnostics(...)` (370행) 아래에:

```ts
  // The one profile-level diagnostic that has a control to sit beside. Picked
  // by kind because it is being *placed*, not classified — the severity is
  // still what colours it (TypeChecklist).
  const typeDiagnostic = routed.scope.find((d) => d.kind === 'unsupported-resource-type');
  const typeNote =
    typeDiagnostic !== undefined && typeDiagnostic.severity !== 'incomplete'
      ? { severity: typeDiagnostic.severity, message: typeDiagnostic.message }
      : null;
```

`routed.scope` 가 행도 호스트도 없는 진단을 담는지 `lib/view/rules.ts` 의 `routeDiagnostics` 를 읽어 확인한다 — 다른 버킷에 들어간다면 그 버킷에서 같은 `find` 를 한다.

`<ScopeRail …>` 에 `typeNote={typeNote}` 를 `onDisableBridge={…}` 뒤에 추가.

- [ ] **Step 7: 초록 확인**

Run: `pnpm exec vitest run tests/unit/ScopeRail.test.tsx tests/unit/App.firefox.test.tsx tests/unit/App.test.tsx`
Expected: PASS. (`App.test.tsx` 의 기존 브릿지 테스트는 `TARGET === 'chrome'` 이라 그대로 통과해야 한다.)

Run: `pnpm typecheck && pnpm lint && pnpm format:check`
Expected: 0.

- [ ] **Step 8: 커밋**

```bash
git add components/TypeChecklist.tsx components/ScopeRail.tsx entrypoints/popup/App.tsx tests/unit/ScopeRail.test.tsx tests/unit/App.firefox.test.tsx
git commit -F - <<'EOF'
feat(popup): no bridge row on Firefox, and a note when request types are dropped

A build with no bridge renders no bridge row and never probes for the
permission — a switch nobody can flip is a control the user cannot
reach. The unsupported-resource-type diagnostic lands on the request
type checklist, the control that can act on it, as one truncated line
coloured by severity.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7XpCj1bESKpE1VkojMAis
EOF
```

---

### Task 4: CLI 가 새 억제 사유를 말로 옮긴다

**Files:**
- Modify: `packages/headerlab/lib/render.mjs` (`SUPPRESSION_WORDS`, ~183행)
- Modify: `packages/headerlab/test/render.test.mjs` (~545행의 `status 가 억눌린 이유를 사람 말로 말한다` 테스트)

**Interfaces:**
- Consumes: `StatusPayload.suppression` 이 `'no-resource-type'` 을 실어 올 수 있다 (Task 2).

- [ ] **Step 1: 실패하는 테스트**

`packages/headerlab/test/render.test.mjs` 의 `test('status 가 억눌린 이유를 사람 말로 말한다', …)` 본문 끝에 추가:

```js
  const noType = renderResult(
    { ...statusPayload, live: true, suppression: 'no-resource-type' },
    { command: ['status'], ...plain },
  );
  assert.equal(noType.includes('no-resource-type'), false);
  assert.equal(
    noType.includes('not applying — no request type this browser supports is selected'),
    true,
  );
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd packages/headerlab && node --test test/render.test.mjs`
Expected: 그 테스트 하나 FAIL — 슬러그가 그대로 찍힌다 (`'brand-new-reason'` 테스트가 보장하는 바로 그 동작).

- [ ] **Step 3: 표에 한 줄**

`SUPPRESSION_WORDS` 에:

```js
  'no-resource-type': 'no request type this browser supports is selected',
```

- [ ] **Step 4: 통과 확인, 스킬 재검토**

Run: `cd packages/headerlab && node --test test/render.test.mjs`
Expected: PASS.

CLI 를 만졌으므로 Conventions 규칙대로 `packages/plugin/skills/headerlab/SKILL.md` 를 `grep -n 'no-scope\|unusable-site\|suppress' packages/plugin/skills/headerlab/SKILL.md` 로 확인한다. 0건이면 (스펙 작성 시점 측정값) 바꿀 문장이 없다. 1건 이상이면 그 문장 옆에 새 사유를 같은 형식으로 더한다.

- [ ] **Step 5: 커밋**

```bash
git add packages/headerlab/lib/render.mjs packages/headerlab/test/render.test.mjs
git commit -F - <<'EOF'
feat(cli): render the new suppression reason in words

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7XpCj1bESKpE1VkojMAis
EOF
```

---

### Task 5: Firefox 빌드 타깃, 스크립트, 매니페스트·번들 가드

**Files:**
- Modify: `wxt.config.ts`
- Modify: `package.json` (scripts 만)
- Modify: `tests/support/build.ts` (`BUILDS`)
- Modify: `tests/unit/manifest.test.ts`, `tests/unit/bundle.test.ts`
- Create: `tests/support/firefox.ts` 의 **상수 둘만** 이 과제에서 만든다 (`GECKO_ID`, `EXTENSION_UUID`); 나머지는 Task 6.

**Interfaces:**
- Produces: `BuildMode` 에 `'firefox' | 'firefox-e2e'`; `.output/firefox-mv3`, `.output/firefox-mv3-e2e`; `GECKO_ID = 'headerlab@say8425.github.io'`, `EXTENSION_UUID = '5f0c2f3e-1111-4222-8333-444455556666'` (tests/support/firefox.ts).

- [ ] **Step 1: 상수 파일의 씨앗**

`tests/support/firefox.ts`:

```ts
/**
 * The id the Firefox manifest declares (`browser_specific_settings.gecko.id`).
 * Spelled once here and once in wxt.config.ts; tests/unit/manifest.test.ts
 * binds the two. Email-shaped as MDN recommends — not a mailbox, a namespace.
 */
export const GECKO_ID = 'headerlab@say8425.github.io';

/**
 * The internal UUID the e2e profile pins for that id
 * (`extensions.webextensions.uuids`), so `moz-extension://<uuid>/popup.html`
 * is a known address. Firefox otherwise mints one per profile.
 */
export const EXTENSION_UUID = '5f0c2f3e-1111-4222-8333-444455556666';
```

- [ ] **Step 2: 실패하는 테스트 — 매니페스트**

`tests/unit/manifest.test.ts` 상단 import 에 `import { GECKO_ID } from '../support/firefox';` 추가, `readManifest()` 아래에:

```ts
function readFirefoxManifest(): Record<string, unknown> {
  return JSON.parse(readBuildFile('firefox', 'manifest.json'));
}
```

파일 끝에:

```ts
describe('the Firefox manifest', () => {
  it('carries the gecko block AMO requires, exactly', () => {
    // MV3 needs an id to be signed at all; 128 is where optional_host_permissions
    // arrived (below it the all-sites switch asks for a grant it can never get);
    // data_collection_permissions is mandatory for new AMO submissions since
    // 2025-11-03 and `none` is this product's premise.
    expect(readFirefoxManifest().browser_specific_settings).toEqual({
      gecko: {
        id: GECKO_ID,
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
    });
  });

  it('runs an event page, not a service worker — Firefox MV3 has none', () => {
    const background = readFirefoxManifest().background as Record<string, unknown>;
    expect(background.scripts).toEqual(['background.js']);
    expect(Object.prototype.hasOwnProperty.call(background, 'service_worker')).toBe(false);
  });

  it('keeps the install-time posture byte-identical to Chrome', () => {
    const manifest = readFirefoxManifest();
    expect(manifest.permissions).toEqual(['storage', 'declarativeNetRequestWithHostAccess']);
    expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
    expect(Object.prototype.hasOwnProperty.call(manifest, 'host_permissions')).toBe(false);
  });

  it('declares no optional permission at all — there is no bridge to ask for', () => {
    // Spec §9: event pages close native ports on idle, so the bridge cannot
    // run on Firefox and the popup renders no row for it. A permission nothing
    // can request is a line to explain away in review; adding it later, when
    // the Firefox bridge lands, costs no re-consent.
    expect(Object.prototype.hasOwnProperty.call(readFirefoxManifest(), 'optional_permissions')).toBe(false);
  });

  it('shares name, description, icons and action with Chrome', () => {
    const chrome = readManifest();
    const firefox = readFirefoxManifest();
    for (const key of ['name', 'description', 'icons', 'action'] as const) {
      expect(firefox[key]).toEqual(chrome[key]);
    }
  });

  it('is the only build with a gecko block', () => {
    expect(Object.prototype.hasOwnProperty.call(readManifest(), 'browser_specific_settings')).toBe(false);
  });
});
```

- [ ] **Step 3: 실패하는 테스트 — 번들**

`tests/unit/bundle.test.ts`: `bundleFiles()` 를 모드를 받게 바꾼다:

```ts
type ShippedBuild = 'production' | 'firefox';

function bundleFiles(mode: ShippedBuild = 'production'): Array<{ file: string; source: string }> {
  const dir = assertBuildFresh(mode);
```

그리고 `describe('the shipped bundle', …)` 을 두 빌드에 대해 돌린다:

```ts
describe.each(['production', 'firefox'] as const)('the shipped %s bundle', (mode) => {
  it('has files to read, so an empty build cannot satisfy the checks below', () => {
    const files = bundleFiles(mode);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.file.endsWith('.js'))).toBe(true);
  });

  it.each(FORBIDDEN)('calls no %s anywhere in the build', (_name, pattern) => {
    // Same sources, but WXT emits per target — the Firefox bundle is read on
    // its own account, not inferred from Chrome's.
    const offenders = bundleFiles(mode)
      .filter((f) => pattern.test(f.source))
      .map((f) => f.file);
    expect(offenders).toEqual([]);
  });
});

describe('the forbidden patterns themselves', () => {
  // (기존 'matches every forbidden form when it is present' 와
  //  'matches none of the benign substrings …' 두 테스트를 여기로 옮긴다, 본문 그대로)
});
```

팔레트 describe 는 그대로 `bundleFiles()` (production) 를 쓴다.

- [ ] **Step 4: `build.ts` 의 BUILDS**

`tests/support/build.ts` 의 `BUILDS` 에 `'bridge-e2e'` 항목 뒤:

```ts
  // The second shipped target. Same sources, a different manifest and a
  // different background shape (event page); read on its own account.
  firefox: {
    dir: '.output/firefox-mv3',
    fix: 'run `pnpm test`, which builds both targets first — not a bare `vitest run`',
  },
  'firefox-e2e': {
    dir: '.output/firefox-mv3-e2e',
    fix:
      'run `pnpm test:e2e` (or `pnpm build:firefox-e2e` before `playwright test`) — ' +
      'not a bare `playwright test`, and not a plain `pnpm build`',
  },
```

- [ ] **Step 5: 실패를 확인한다**

Run: `pnpm exec vitest run tests/unit/manifest.test.ts tests/unit/bundle.test.ts`
Expected: FAIL — `extension build not found at .output/firefox-mv3 — run pnpm test …` (있던 8월 25일자 산출물이 남아 있으면 stale 로 같은 취지의 메시지).

- [ ] **Step 6: `wxt.config.ts`**

`defineConfig({` 바로 아래 `modules: […],` 다음에:

```ts
  // Both targets are MV3. WXT's default for Firefox is MV2 — `wxt build -b
  // firefox` without this wrote `.output/firefox-mv2` (measured 2026-09-08) —
  // and this extension has no MV2 shape at all: declarativeNetRequest,
  // optional_host_permissions and the event page are all MV3 facts.
  manifestVersion: 3,
```

`manifest: ({ mode }) => ({` → `manifest: ({ browser, mode }) => ({`.

`optional_permissions: ['nativeMessaging'],` 와 그 위의 주석 블록(`// Requested at runtime from the popup's Enable button …` 부터 `// (docs/research/2026-08-11-native-messaging-spike.md).` 까지)을 다음으로 바꾼다:

```ts
    // Per target. Firefox gets the block AMO requires — the id MV3 signing
    // needs, the floor where optional_host_permissions arrived, and the
    // data-collection declaration mandatory for new submissions since
    // 2025-11-03 — and **no optional_permissions**: its event page closes
    // native ports on idle, so the bridge as designed cannot run there and
    // the popup renders no row for it (spec §9). Chrome keeps nativeMessaging
    // optional, requested at runtime from the popup's bridge switch, never at
    // install. `extensions_api_permissions.cc:113-114` carries no
    // `kFlagCannotBeOptional` for this one (declarativeNetRequest does, at
    // :57-59), and the runtime grant was measured rather than inferred — the
    // consent dialog appeared, allowing it worked, and a second click went
    // straight to connectNative (docs/research/2026-08-11-native-messaging-spike.md).
    // tests/unit/manifest.test.ts pins both halves.
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'headerlab@say8425.github.io',
              strict_min_version: '128.0',
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : { optional_permissions: ['nativeMessaging'] }),
```

- [ ] **Step 7: `package.json` 스크립트**

```json
    "test": "wxt build && wxt build -b firefox && vitest run",
    "build": "wxt build && wxt build -b firefox",
    "build:firefox": "wxt build -b firefox",
    "build:firefox-e2e": "wxt build -b firefox --mode e2e",
    "dev:firefox": "wxt -b firefox",
    "test:e2e": "wxt build --mode e2e && wxt build --mode bridge-e2e && wxt build -b firefox --mode e2e && playwright test",
```

(`build:e2e`, `build:bridge-e2e`, `zip`, `crx`, `screenshots`, `store:*`, `dev` 는 그대로. oxfmt 가 `package.json` 키를 정렬한다 — `pnpm format` 이 순서를 정하게 둔다.)

- [ ] **Step 8: 빌드하고 통과 확인**

Run: `rm -rf .output/firefox-mv2 .output/firefox-mv2-e2e .output/firefox-mv3 .output/firefox-mv3-e2e && pnpm test`
Expected: 두 빌드가 돌고 (`.output/chrome-mv3`, `.output/firefox-mv3`), vitest 전체 PASS. WXT 가 Firefox 빌드에서 id/data-collection 경고를 **찍지 않아야** 한다 — 찍으면 gecko 블록이 매니페스트 함수의 `browser` 분기에 안 걸린 것이다.

Run: `cat .output/firefox-mv3/manifest.json`
Expected: `browser_specific_settings.gecko` 세 필드, `background.scripts`, `optional_permissions` 없음.

Run: `pnpm typecheck && pnpm lint && pnpm format:check`
Expected: 0.

- [ ] **Step 9: 커밋**

```bash
git add wxt.config.ts package.json tests/support/build.ts tests/support/firefox.ts tests/unit/manifest.test.ts tests/unit/bundle.test.ts
git commit -F - <<'EOF'
feat: build a Firefox MV3 target and guard its manifest and bundle

`pnpm build` and `pnpm test` build both targets. The Firefox manifest
carries the gecko block AMO requires and no optional_permissions — the
bridge cannot run on an event page — and the tests pin both, read the
Firefox bundle for network primitives on its own account, and hold the
install-time permission surface byte-identical to Chrome's.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7XpCj1bESKpE1VkojMAis
EOF
```

---

### Task 6: Marionette 클라이언트와 Firefox 실행기 (의존성 0)

**Files:**
- Create: `tests/support/marionette.ts`
- Modify: `tests/support/firefox.ts` (Task 5 의 상수 아래에 실행기)
- Create: `tests/unit/marionette.test.ts`

**Interfaces:**
- Produces (marionette.ts): `parseFrames(buffer: Buffer): { messages: unknown[]; rest: Buffer }`; `connectMarionette(port: number): Promise<MarionetteClient>`; `interface MarionetteClient { send<T = unknown>(name: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>; close(): void }`.
- Produces (firefox.ts): `findFirefox(): string`; `launchFirefox(extensionDir: string): Promise<FirefoxSession>`; `interface FirefoxSession { popupUrl: string; evaluate<T = unknown>(expression: string): Promise<T>; navigate(url: string): Promise<void>; newTab(url: string): Promise<string>; switchTo(handle: string): Promise<void>; screenshot(): Promise<Buffer>; close(): Promise<void> }`.

- [ ] **Step 1: 실패하는 테스트 — 프레임 파서는 바이트로 센다**

`tests/unit/marionette.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseFrames } from '../support/marionette';

/**
 * Marionette frames are `<byte length>:<json>`. Bytes, not characters: the
 * popup's readout carries a middle dot (`·`, two bytes in UTF-8), and a parser
 * counting characters would read one byte too few and never resynchronise.
 */
describe('parseFrames', () => {
  const frame = (value: unknown) => {
    const body = JSON.stringify(value);
    return Buffer.from(`${Buffer.byteLength(body)}:${body}`);
  };

  it('splits complete frames and returns the unconsumed tail', () => {
    const buffer = Buffer.concat([frame({ a: 1 }), frame([1, 2, null, { ok: true }]), Buffer.from('12:{"partial"')]);
    const { messages, rest } = parseFrames(buffer);
    expect(messages).toEqual([{ a: 1 }, [1, 2, null, { ok: true }]]);
    expect(rest.toString()).toBe('12:{"partial"');
  });

  it('counts the length in bytes, so a multi-byte character does not desynchronise it', () => {
    const buffer = Buffer.concat([frame({ text: '1 of 2 live · 1 off' }), frame({ next: true })]);
    const { messages, rest } = parseFrames(buffer);
    expect(messages).toEqual([{ text: '1 of 2 live · 1 off' }, { next: true }]);
    expect(rest.length).toBe(0);
  });

  it('leaves a frame whose bytes have not all arrived', () => {
    const whole = frame({ big: 'x'.repeat(100) });
    const { messages, rest } = parseFrames(whole.subarray(0, 50));
    expect(messages).toEqual([]);
    expect(rest.length).toBe(50);
  });

  it('refuses a stream that does not start with a length', () => {
    expect(() => parseFrames(Buffer.from('nonsense:{}'))).toThrow(/malformed Marionette frame/);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm exec vitest run tests/unit/marionette.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `tests/support/marionette.ts`**

```ts
import { connect, type Socket } from 'node:net';

/**
 * A Marionette client in `node:net` alone.
 *
 * Marionette is Firefox's own automation protocol (the one geckodriver
 * speaks): TCP, `<byte length>:<json>` frames, a hello object from the server
 * first, then commands `[0, id, name, params]` answered by
 * `[1, id, error | null, result]`. It is used here because Playwright cannot
 * load a Firefox extension, and because Marionette — under
 * `-remote-allow-system-access` — will navigate a tab to
 * `moz-extension://…`, which WebDriver BiDi refuses (measured:
 * docs/research/2026-09-08-firefox-marionette-spike.md). No dependency is
 * added for it, which is this repository's rule.
 */

export interface MarionetteError {
  error: string;
  message: string;
  stacktrace?: string;
}

export interface MarionetteClient {
  /**
   * Sends one command and resolves with its `result`.
   *
   * Rejects with the server's error, or — after `timeoutMs` — with an error
   * naming the command. The spike sat silently on a script whose syntax was
   * wrong: the callback was never called, and nothing said which command was
   * waiting. A timeout with the name in it is the difference.
   */
  send<T = unknown>(name: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  close(): void;
}

/**
 * Splits a byte stream into complete frames.
 *
 * Bytes, not characters: the readout string this suite reads back carries a
 * middle dot (two bytes), and a character count would desynchronise on it.
 * Pure, and unit-tested on its own (tests/unit/marionette.test.ts).
 */
export function parseFrames(buffer: Buffer): { messages: unknown[]; rest: Buffer } {
  const messages: unknown[] = [];
  let rest = buffer;
  for (;;) {
    const colon = rest.indexOf(0x3a); // ':'
    if (colon === -1) break;
    const head = rest.subarray(0, colon).toString('ascii');
    if (!/^\d+$/.test(head)) {
      throw new Error(`malformed Marionette frame: ${rest.subarray(0, 40).toString('utf8')}`);
    }
    const length = Number.parseInt(head, 10);
    if (rest.length < colon + 1 + length) break;
    messages.push(JSON.parse(rest.subarray(colon + 1, colon + 1 + length).toString('utf8')));
    rest = rest.subarray(colon + 1 + length);
  }
  return { messages, rest };
}

interface Pending {
  name: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Connects, retrying until Firefox is listening, and waits for the hello.
 *
 * Retrying the connect is how the launcher waits for Firefox to be up without
 * parsing its log: the port refuses until Marionette binds it. 150 × 200ms is
 * thirty seconds, which is more than a cold headless start needs.
 */
export async function connectMarionette(
  port: number,
  { attempts = 150, intervalMs = 200 }: { attempts?: number; intervalMs?: number } = {},
): Promise<MarionetteClient> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    let remaining = attempts;
    const attempt = () => {
      const s = connect({ host: '127.0.0.1', port }, () => resolve(s));
      s.once('error', (error) => {
        remaining -= 1;
        if (remaining <= 0) {
          reject(new Error(`Marionette did not answer on port ${port}: ${error.message}`));
          return;
        }
        setTimeout(attempt, intervalMs);
      });
    };
    attempt();
  });

  let buffered = Buffer.alloc(0);
  let hello: unknown = null;
  const pending = new Map<number, Pending>();
  let nextId = 1;

  socket.on('data', (chunk: Buffer) => {
    const parsed = parseFrames(Buffer.concat([buffered, chunk]));
    buffered = parsed.rest;
    for (const message of parsed.messages) {
      if (hello === null && !Array.isArray(message)) {
        hello = message;
        continue;
      }
      if (!Array.isArray(message)) continue;
      const [, id, error, result] = message as [number, number, MarionetteError | null, unknown];
      const waiting = pending.get(id);
      if (!waiting) continue;
      pending.delete(id);
      clearTimeout(waiting.timer);
      if (error) waiting.reject(new Error(`${waiting.name}: ${error.error}: ${error.message}`));
      else waiting.resolve(result);
    }
  });
  socket.on('close', () => {
    for (const [id, waiting] of pending) {
      pending.delete(id);
      clearTimeout(waiting.timer);
      waiting.reject(new Error(`${waiting.name}: Marionette socket closed`));
    }
  });

  const send = <T,>(name: string, params: Record<string, unknown> = {}, timeoutMs = 20_000) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${name} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { name, resolve: resolve as (v: unknown) => void, reject, timer });
      const body = JSON.stringify([0, id, name, params]);
      socket.write(`${Buffer.byteLength(body)}:${body}`);
    });

  const helloDeadline = Date.now() + 10_000;
  while (hello === null) {
    if (Date.now() > helloDeadline) throw new Error('Marionette connected but sent no hello');
    await new Promise((r) => setTimeout(r, 20));
  }

  return { send, close: () => socket.end() };
}
```

- [ ] **Step 4: 파서 테스트 통과 확인**

Run: `pnpm exec vitest run tests/unit/marionette.test.ts`
Expected: PASS (4).

- [ ] **Step 5: `tests/support/firefox.ts` 에 실행기를 더한다**

Task 5 의 두 상수 아래에:

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { REPO_ROOT } from './build';
import { connectMarionette, type MarionetteClient } from './marionette';

/**
 * Where Firefox is. `FIREFOX_BIN` first, then the two macOS bundles, then a
 * `firefox` on PATH (which is what the CI runner has — apt, from the Mozilla
 * team PPA, so not a snap, and Firefox 154 there against a floor of 138 for
 * `-remote-allow-system-access`).
 *
 * Throws, never skips: a Firefox suite that reported green because no Firefox
 * was found is the silent failure this repository exists to rule out.
 */
export function findFirefox(): string {
  const candidates = [
    process.env.FIREFOX_BIN,
    '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
    '/Applications/Firefox.app/Contents/MacOS/firefox',
    ...(process.env.PATH ?? '').split(path.delimiter).map((dir) => path.join(dir, 'firefox')),
  ].filter((c): c is string => typeof c === 'string' && c.length > 0);
  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    throw new Error(
      'no Firefox found — set FIREFOX_BIN, or install Firefox Developer Edition; looked at: ' +
        candidates.slice(0, 3).join(', ') +
        ' and every directory on PATH',
    );
  }
  return found;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const address = s.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('could not pick a free port'));
        return;
      }
      s.close(() => resolve(address.port));
    });
  });

export interface FirefoxSession {
  /** `moz-extension://<EXTENSION_UUID>/popup.html`. */
  popupUrl: string;
  /**
   * Evaluates an expression in the current tab and returns its value.
   *
   * The expression may return a promise (`browser.*` does); it is awaited.
   * A thrown error is rethrown here with its message, so a test never reads
   * `undefined` where an exception happened.
   */
  evaluate<T = unknown>(expression: string): Promise<T>;
  navigate(url: string): Promise<void>;
  /** Opens a tab, switches to it, navigates, and returns its handle. */
  newTab(url: string): Promise<string>;
  switchTo(handle: string): Promise<void>;
  screenshot(): Promise<Buffer>;
  close(): Promise<void>;
}

/**
 * Launches a headless Firefox with a fresh profile, installs the build at
 * `extensionDir` temporarily, and navigates the first tab to the popup.
 *
 * Every preference below was needed, and each is named for why:
 *
 * - `extensions.webextensions.uuids` pins the internal UUID so the popup has
 *   a known address.
 * - `extensions.originControls.grantByDefault` grants the e2e manifest's
 *   `host_permissions` at install; Firefox MV3 treats them as optional
 *   otherwise, and nothing here can click a doorhanger.
 * - `extensions.webextOptionalPermissionPrompts: false` lets a future
 *   `permissions.request()` resolve without one.
 * - The rest silence first-run pages and the default-browser check.
 *
 * The profile lives under `test-results/` — gitignored, so it is outside the
 * build-freshness source set, and inside the workspace, which a snap-confined
 * Firefox can read where `/tmp` it cannot. The process is spawned detached so
 * `close()` can kill the whole group: Firefox's crashhelper and
 * plugin-container hold the stdio pipes open otherwise (measured — a `| tail`
 * on the spike waited forever).
 */
export async function launchFirefox(extensionDir: string): Promise<FirefoxSession> {
  const binary = findFirefox();
  const marionettePort = await freePort();
  const profile = path.join(REPO_ROOT, 'test-results', 'firefox-profiles', randomUUID());
  mkdirSync(profile, { recursive: true });

  const prefs: Record<string, string | number | boolean> = {
    'extensions.webextensions.uuids': JSON.stringify({ [GECKO_ID]: EXTENSION_UUID }),
    'extensions.originControls.grantByDefault': true,
    'extensions.webextOptionalPermissionPrompts': false,
    'marionette.port': marionettePort,
    'xpinstall.signatures.required': false,
    'browser.shell.checkDefaultBrowser': false,
    'datareporting.policy.dataSubmissionPolicyBypassNotification': true,
    'toolkit.telemetry.reportingpolicy.firstRun': false,
    'browser.startup.homepage_override.mstone': 'ignore',
    'browser.startup.page': 0,
    'browser.aboutwelcome.enabled': false,
  };
  writeFileSync(
    path.join(profile, 'user.js'),
    `${Object.entries(prefs)
      .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
      .join('\n')}\n`,
  );

  const child: ChildProcess = spawn(
    binary,
    ['--headless', '--profile', profile, '-no-remote', '--marionette', '--remote-allow-system-access'],
    { stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  let stderr = '';
  child.stderr?.on('data', (c: Buffer) => {
    stderr += c.toString('utf8');
  });
  child.stdout?.on('data', (c: Buffer) => {
    stderr += c.toString('utf8');
  });

  const killGroup = () => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  };

  let client: MarionetteClient;
  try {
    client = await connectMarionette(marionettePort);
  } catch (error) {
    killGroup();
    rmSync(profile, { recursive: true, force: true });
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nfirefox said:\n${stderr}`,
    );
  }

  await client.send('WebDriver:NewSession', { capabilities: { alwaysMatch: {} } });
  const installed = await client.send<{ value: string }>('Addon:Install', {
    path: extensionDir,
    temporary: true,
  });
  if (installed.value !== GECKO_ID) {
    killGroup();
    throw new Error(`Firefox installed the build as ${installed.value}, expected ${GECKO_ID}`);
  }

  const popupUrl = `moz-extension://${EXTENSION_UUID}/popup.html`;

  const evaluate = async <T,>(expression: string): Promise<T> => {
    const r = await client.send<{ value: unknown }>('WebDriver:ExecuteAsyncScript', {
      script:
        `const done = arguments[0];\n` +
        `Promise.resolve().then(() => (${expression})).then(` +
        `(v) => done({ ok: true, value: v }), (e) => done({ ok: false, message: String(e && e.message || e) }));`,
      args: [],
    });
    const outcome = r.value as { ok: true; value: T } | { ok: false; message: string };
    if (!outcome.ok) throw new Error(`evaluate failed: ${outcome.message}\n  in: ${expression}`);
    return outcome.value;
  };

  const navigate = async (url: string) => {
    await client.send('WebDriver:Navigate', { url });
  };

  await navigate(popupUrl);

  return {
    popupUrl,
    evaluate,
    navigate,
    async newTab(url) {
      const win = await client.send<{ handle: string }>('WebDriver:NewWindow', { type: 'tab' });
      await client.send('WebDriver:SwitchToWindow', { handle: win.handle });
      await navigate(url);
      return win.handle;
    },
    async switchTo(handle) {
      await client.send('WebDriver:SwitchToWindow', { handle });
    },
    async screenshot() {
      const shot = await client.send<{ value: string }>('WebDriver:TakeScreenshot', { full: false });
      return Buffer.from(shot.value, 'base64');
    },
    async close() {
      try {
        await client.send('WebDriver:DeleteSession', {}, 5_000);
      } catch {
        /* the kill below is the real teardown */
      }
      client.close();
      killGroup();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 6: 타입체크·린트**

Run: `pnpm typecheck && pnpm lint && pnpm format:check`
Expected: 0. (위 코드의 `<T,>` 는 `.ts` 파일에서는 `<T>` 로 쓴다 — 쉼표는 `.tsx` 에서만 필요하고 oxfmt 가 어차피 지운다.) 이 실행기의 첫 실제 실행은 Task 7 Step 3 의 e2e 다 — Node 는 `tests/support/build` 같은 확장자 없는 TS import 를 해석하지 못하므로 스크래치 스크립트로 먼저 돌려보는 길은 없다.

- [ ] **Step 7: 커밋**

```bash
git add tests/support/marionette.ts tests/support/firefox.ts tests/unit/marionette.test.ts
git commit -F - <<'EOF'
test: a zero-dependency Marionette client and Firefox launcher for e2e

Playwright cannot load a Firefox extension. Firefox's own Marionette
protocol can, under -remote-allow-system-access, and it is plain TCP
with byte-length-prefixed JSON — node:net is enough. The launcher pins
the extension's UUID, grants the e2e host permission by preference,
keeps the profile under test-results/, and kills the process group so
Firefox's helpers cannot hold the pipes open.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7XpCj1bESKpE1VkojMAis
EOF
```

---

### Task 7: Firefox e2e 세 테스트와 CI 단계

**Files:**
- Create: `tests/e2e/firefox-fixtures.ts`, `tests/e2e/firefox.spec.ts`
- Modify: `.github/workflows/ci.yml` (e2e 잡, `Install Chromium` 단계 뒤)

**Interfaces:**
- Consumes: `launchFirefox`, `FirefoxSession`, `assertBuildFresh('firefox-e2e')`, `startEchoServer`.

- [ ] **Step 1: 픽스처**

`tests/e2e/firefox-fixtures.ts`:

```ts
import { test as base } from '@playwright/test';
import { assertBuildFresh } from '../support/build';
import { launchFirefox, type FirefoxSession } from '../support/firefox';
import { startEchoServer, type EchoServer } from './echo-server';

/**
 * The Firefox half of the e2e suite rides the same runner as the Chrome half
 * — fixtures, `expect.poll`, the reporter, and the `--list` count CLAUDE.md
 * cites — but the browser is a real Firefox driven over Marionette, because
 * Playwright's own Firefox cannot load an extension.
 *
 * The build is `firefox-mv3-e2e`: production plus `host_permissions` for the
 * loopback echo server, exactly as Chrome's `e2e` mode. assertBuildFresh
 * refuses a stale or absent one by name.
 */
export const test = base.extend<{ firefox: FirefoxSession; echo: EchoServer }>({
  // Playwright reads a fixture's dependencies off its destructuring pattern, so
  // an empty one is how a fixture declares that it depends on nothing.
  // oxlint-disable-next-line no-empty-pattern
  firefox: async ({}, use) => {
    const session = await launchFirefox(assertBuildFresh('firefox-e2e'));
    await use(session);
    await session.close();
  },
  // oxlint-disable-next-line no-empty-pattern
  echo: async ({}, use) => {
    const server = await startEchoServer();
    await use(server);
    await server.close();
  },
});

export const expect = test.expect;
```

- [ ] **Step 2: 스펙 — 세 테스트**

`tests/e2e/firefox.spec.ts`:

```ts
import { expect, test } from './firefox-fixtures';

/**
 * The strongest evidence this repository has for Chrome, repeated for
 * Firefox: a rule written into storage reaches the wire, read back off a
 * loopback echo server rather than off anything the extension itself claims.
 * The third test is the one layout fact this slice requires of the Firefox
 * popup — that there is no bridge row — asserted as an absence before any
 * presence.
 *
 * `firefox.evaluate` runs in the popup page, where `browser.*` is the
 * extension's own API surface; the tests seed `chrome.storage.local`'s
 * `state`/`state$` pair the same way the Chrome suite does.
 */

const seedState = (profileOver: Record<string, unknown>) =>
  JSON.stringify({
    version: 2,
    globalPause: false,
    theme: 'system',
    profiles: [
      {
        id: 'p1',
        name: 'E2E',
        color: 'green',
        enabled: true,
        order: 0,
        filter: {
          mode: 'structured',
          allSites: false,
          domains: ['127.0.0.1'],
          excludedDomains: [],
          // Explicit: the DNR default excludes main_frame, which a navigation is.
          resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
        },
        tabLock: { enabled: false, tabId: null, tabTitle: null },
        ...profileOver,
      },
    ],
  });

async function seedAndWaitForRules(
  firefox: { evaluate<T>(e: string): Promise<T> },
  profileOver: Record<string, unknown>,
) {
  await firefox.evaluate(
    `browser.storage.local.set({ state: ${seedState(profileOver)}, state$: { v: 2 } }).then(() => 'ok')`,
  );
  // The storage watcher drives reconcile; the rule count is the settling signal.
  await expect
    .poll(
      () => firefox.evaluate<number>('browser.declarativeNetRequest.getDynamicRules().then((r) => r.length)'),
      { timeout: 10_000 },
    )
    .toBe(1);
}

test('a configured set rule reaches the wire on Firefox', async ({ firefox, echo }) => {
  await seedAndWaitForRules(firefox, {
    headers: [
      { id: 'h1', enabled: true, target: 'request', operation: 'set', name: 'X-Headerlab-Test', value: 'applied' },
      { id: 'h2', enabled: false, target: 'request', operation: 'set', name: 'X-Headerlab-Disabled', value: 'nope' },
    ],
  });

  await firefox.newTab(`${echo.origin}/probe`);

  const probe = echo.requests.find((r) => r.url === '/probe');
  expect(probe, 'echo server received the navigation').toBeTruthy();
  expect(probe!.headers['x-headerlab-test']).toBe('applied');
  expect(probe!.headers['x-headerlab-disabled']).toBeUndefined();
});

test('a remove rule strips a header the page would otherwise send, on Firefox', async ({ firefox, echo }) => {
  await seedAndWaitForRules(firefox, {
    filter: {
      mode: 'structured',
      allSites: false,
      domains: ['127.0.0.1'],
      excludedDomains: [],
      resourceTypes: ['xmlhttprequest'],
    },
    headers: [{ id: 'h1', enabled: true, target: 'request', operation: 'remove', name: 'X-Remove-Me', value: '' }],
  });

  await firefox.newTab(`${echo.origin}/host`);
  await firefox.evaluate(
    `fetch(${JSON.stringify(`${echo.origin}/xhr`)}, { headers: { 'X-Remove-Me': 'should-be-gone', 'X-Keep-Me': 'should-survive' } }).then(() => 'sent')`,
  );

  await expect.poll(() => echo.requests.some((r) => r.url === '/xhr')).toBe(true);
  const xhr = echo.requests.find((r) => r.url === '/xhr')!;
  expect(xhr.headers['x-remove-me']).toBeUndefined();
  // Positive control: a server that stopped seeing custom headers at all would
  // pass the absence above vacuously.
  expect(xhr.headers['x-keep-me']).toBe('should-survive');
});

test('the popup renders from stored state with no bridge row', async ({ firefox }) => {
  await seedAndWaitForRules(firefox, {
    headers: [
      { id: 'h1', enabled: true, target: 'request', operation: 'set', name: 'X-Headerlab-Test', value: 'applied' },
      { id: 'h2', enabled: false, target: 'request', operation: 'set', name: 'X-Headerlab-Disabled', value: 'nope' },
    ],
  });
  // A fresh load, so the screen is what a user opening the popup sees, not a
  // re-render mid-write.
  await firefox.navigate(firefox.popupUrl);

  // Absence first. The bridge row is the only element with this test id; the
  // Firefox build must never draw a switch nobody can flip.
  await expect
    .poll(() => firefox.evaluate<number>(`document.querySelectorAll('[data-testid="rule"]').length`), {
      timeout: 10_000,
    })
    .toBe(2);
  expect(await firefox.evaluate<number>(`document.querySelectorAll('[data-testid="bridgestate"]').length`)).toBe(0);
  expect(await firefox.evaluate<number>(`document.querySelectorAll('[data-testid="site"]').length`)).toBe(1);
  await expect
    .poll(() => firefox.evaluate<string>(`document.querySelector('[data-testid="readout"]').textContent`))
    .toBe('1 of 2 live · 1 off');
});
```

리드아웃 문자열의 형식은 Task 3 Step 2 와 같은 규칙으로 맞춘다 (`RulePanel.tsx` 의 조립이 진실; `off` 가 1 이어야 한다는 사실은 양보하지 않는다). `[data-testid="site"]` 가 사이트 행의 id 인지 `components/SiteRow.tsx` 로 확인한다.

- [ ] **Step 3: 돌린다**

Run: `pnpm test:e2e`
Expected: 세 빌드 후 `21 passed` (Chrome 18 + Firefox 3). 실패하면 `test-results/` 의 리포트와 `firefox said:` 로 시작하는 오류 메시지를 읽는다.

Run: `pnpm exec playwright test --list | tail -1`
Expected: `Total: 21 tests in 4 files`.

Run: `pgrep -fl firefox-profiles | wc -l`
Expected: `0` — 세션이 남긴 프로세스가 없다.

- [ ] **Step 4: CI 단계**

`.github/workflows/ci.yml` 의 e2e 잡, `Install Chromium` 단계 뒤에:

```yaml
      # tests/e2e/firefox.spec.ts drives the runner's own Firefox — apt, from
      # the Mozilla team PPA, not a snap — over Marionette. Printed so a failing
      # log says which Firefox it was; the harness needs 138 or later.
      - run: firefox --version
```

잡 이름 `e2e (real Chrome, headers on the wire)` → `e2e (real Chrome and Firefox, headers on the wire)`.

- [ ] **Step 5: 린트·포맷, 커밋**

Run: `pnpm typecheck && pnpm lint && pnpm format:check`
Expected: 0.

```bash
git add tests/e2e/firefox-fixtures.ts tests/e2e/firefox.spec.ts .github/workflows/ci.yml
git commit -F - <<'EOF'
test: Firefox e2e — headers on the wire, and a popup with no bridge row

Three tests through a real Firefox: a set rule reaches the loopback echo
server, a remove rule strips a header while its sibling survives, and
the popup renders two rules and one site with no bridge row. The CI
runner's own Firefox is used; its version is printed for the log.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7XpCj1bESKpE1VkojMAis
EOF
```

---

### Task 8: 문서 — README 다섯, CLAUDE.md, 옛 스펙의 각주

**Files:**
- Modify: `README.md` (16-41행 Install, 187-197행 Limitations), `docs/README.ko.md`, `docs/README.ja.md`, `docs/README.zh.md`, `docs/README.es.md` (각 Install 첫 문단과 Limitations 표)
- Modify: `CLAUDE.md` (Commands 블록 12-27행, Architecture 트리 ~40-60행, Non-negotiables 첫 항목, Toolchain 의 억제 개수 문단, `spawn-sync` 문단 176-183행, WXT specifics 문단, Testing 첫 문단 1364-1392행, Platform traps 끝)
- Modify: `docs/superpowers/specs/2026-07-31-headerlab-design.md` (§10 `**제외:**` 줄 아래)

- [ ] **Step 1: `dev:firefox` 가 `spawn-sync` 없이 도는지 잰다**

Run: `timeout 25 pnpm dev:firefox; echo "exit=$?"` (`timeout` 이 없으면 백그라운드로 띄우고 25초 뒤 `kill`)
Expected: WXT 가 Firefox Developer Edition 을 띄우고 확장을 올린다 (`fx-runner` 경로). `spawn-sync` 관련 오류가 없어야 한다 — 그 패키지의 빌드 스크립트는 Node 0.12 이전용 폴리필이고 현대 Node 에서는 `child_process.spawnSync` 로 바로 해결된다. 오류가 나면 이 단계에서 멈추고 보고한다 (`allowBuilds` 를 바꾸는 것은 소유자 결정이다).

- [ ] **Step 2: README.md**

18행 `Chrome only for now. Firefox and Safari are planned.` → `Chrome from the store, Firefox by loading a build — a signed Firefox release is next. Safari is planned.`

`### Build it yourself` 절의 코드 블록과 그 아래 문장을 다음으로:

````markdown
### Build it yourself

```bash
corepack enable          # pnpm comes from package.json's packageManager field
pnpm install
pnpm build               # → .output/chrome-mv3 and .output/firefox-mv3
```

Load `.output/chrome-mv3` the same way.

### Firefox

There is no signed Firefox build yet, so release Firefox will not install this
permanently. Load it temporarily: `about:debugging` → **This Firefox** → **Load
Temporary Add-on** → `.output/firefox-mv3/manifest.json` after `pnpm build`. It stays
until Firefox restarts. The agent bridge is not offered on Firefox — see Limitations.
````

Limitations 표 마지막 행 뒤에:

```markdown
| Agent bridge (HeaderLab's own) | ✓ | ✓ | **none** — event pages close native ports on idle | **none** |
```

- [ ] **Step 3: 네 번역본**

각 파일의 Install 첫 문단과 "직접 빌드" 절, Limitations 표에 같은 내용을 넣는다. 명령과 경로는 바이트 그대로 (`packages/headerlab/test/docs.test.mjs` 는 `headerlab ` 명령만 묶으므로 이 절은 영향이 없지만, `readmeLiterals.test.ts` 가 고정하는 리드아웃 문자열은 건드리지 않는다).

`docs/README.ko.md` 18행 → `크롬은 스토어에서, 파이어폭스는 빌드를 직접 로드해서 — 서명된 파이어폭스 배포가 다음 순서입니다. 사파리는 예정.` `### 직접 빌드` 절의 `pnpm build` 주석 → `# → .output/chrome-mv3 와 .output/firefox-mv3`, 그 절 뒤에:

````markdown
### 파이어폭스

아직 서명된 파이어폭스 빌드가 없어 릴리스 파이어폭스에는 영구 설치되지 않습니다. 임시로
로드합니다: `about:debugging` → **This Firefox** → **Load Temporary Add-on** → `pnpm build`
뒤의 `.output/firefox-mv3/manifest.json`. 파이어폭스를 재시작하면 사라집니다. 에이전트
브리지는 파이어폭스에서 제공되지 않습니다 — 제한 사항 표를 보세요.
````

표 행: `| 에이전트 브리지 (HeaderLab 자체) | ✓ | ✓ | **없음** — 이벤트 페이지가 유휴 시 네이티브 포트를 닫음 | **없음** |`

`docs/README.ja.md` 18행 → `Chrome はストアから、Firefox はビルドを読み込んで — 署名付き Firefox リリースが次です。Safari は対応予定。` 절:

````markdown
### Firefox

署名付きの Firefox ビルドはまだないため、リリース版 Firefox には永続インストールできません。
一時的に読み込みます: `about:debugging` → **This Firefox** → **Load Temporary Add-on** →
`pnpm build` 後の `.output/firefox-mv3/manifest.json`。Firefox を再起動すると消えます。
エージェントブリッジは Firefox では提供されません — 制限事項の表を参照。
````

표 행: `| エージェントブリッジ (HeaderLab 独自) | ✓ | ✓ | **なし** — イベントページがアイドル時にネイティブポートを閉じる | **なし** |`

`docs/README.zh.md` 17행 → `Chrome 从商店安装，Firefox 直接加载构建 — 签名的 Firefox 发布是下一步。Safari 在计划中。` 절:

````markdown
### Firefox

目前还没有签名的 Firefox 构建，正式版 Firefox 不会永久安装它。临时加载：`about:debugging`
→ **This Firefox** → **Load Temporary Add-on** → `pnpm build` 之后的
`.output/firefox-mv3/manifest.json`。Firefox 重启后即消失。代理桥接不在 Firefox 上提供 —
见限制表。
````

표 행: `| 代理桥接（HeaderLab 自有） | ✓ | ✓ | **无** — 事件页空闲时会关闭原生端口 | **无** |`

`docs/README.es.md` 18행 → `Chrome desde la tienda, Firefox cargando una build — una release firmada para Firefox es lo siguiente. Safari está previsto.` 절:

````markdown
### Firefox

Todavía no hay una build firmada para Firefox, así que el Firefox de release no la instalará
de forma permanente. Cárgala temporalmente: `about:debugging` → **This Firefox** → **Load
Temporary Add-on** → `.output/firefox-mv3/manifest.json` tras `pnpm build`. Dura hasta que
Firefox se reinicie. El puente para agentes no se ofrece en Firefox — ver Limitaciones.
````

표 행: `| Puente para agentes (propio de HeaderLab) | ✓ | ✓ | **ninguno** — las event pages cierran los puertos nativos al quedar inactivas | **ninguno** |`

각 번역본의 `pnpm build` 주석 줄도 `.output/firefox-mv3` 를 언급하도록 같은 꼴로 고친다.

- [ ] **Step 4: CLAUDE.md**

1. Commands 블록: `pnpm test` 줄 → `pnpm test            # wxt build && wxt build -b firefox && vitest run — both builds, see below`; `pnpm test:e2e` 줄 → `pnpm test:e2e        # three e2e builds (chrome e2e · bridge-e2e · firefox e2e) && playwright test`; `pnpm build` 줄 → `pnpm build           # production builds → .output/chrome-mv3 and .output/firefox-mv3`; `pnpm dev` 줄 뒤에 `pnpm dev:firefox     # WXT dev server against Firefox (web-ext-run finds the binary)`.
2. Architecture 트리: `lib/compile/     AppState → DNR rules + diagnostics        pure` 줄 아래에 `                 capabilities.ts — the one table of what each target accepts`; `lib/utils.ts` 줄 위에 `lib/target.ts    TARGET — the only reader of import.meta.env.BROWSER; pure code takes a Target parameter`.
3. Non-negotiables 첫 항목(`Zero host permissions at install`) 끝에 문단 추가:
   > **The Firefox manifest holds the same two install-time permissions and adds one block.** `browser_specific_settings.gecko` is exactly `{ id: 'headerlab@say8425.github.io', strict_min_version: '128.0', data_collection_permissions: { required: ['none'] } }` — the id MV3 signing needs, the floor where `optional_host_permissions` arrived, and the data-collection declaration AMO requires of new submissions since 2025-11-03. It declares **no `optional_permissions`**: Firefox event pages close native ports on idle (MDN), so the bridge as designed cannot run there and the popup renders no row for it. `tests/unit/manifest.test.ts` pins the block, the absence, and that the Chrome build carries no gecko block at all.
4. Toolchain 의 `Suppressions are per-site and carry a reason.` 문단: `Eight exist` → `Nine exist`, `four \`no-empty-pattern\`` → `five \`no-empty-pattern\``, 픽스처 열거에 `tests/e2e/firefox-fixtures.ts`'s `firefox` and `echo` 를 더한다 (그러면 `no-empty-pattern` 은 여섯이므로 문장을 `six \`no-empty-pattern\` … one per fixture that declares no dependency` 로, 총계는 `ten` 으로 — **`grep -rn "oxlint-disable" | wc -l` 로 세고 그 수를 쓴다**, 이 문단 자체가 "세지 말고 재라" 고 말한다).
5. `spawn-sync` 문단: `WXT's Firefox runner, which this Chrome-only extension never invokes.` → `WXT's Firefox runner, which \`pnpm dev:firefox\` now invokes — and it runs without that build script, because the script builds a polyfill for a Node without \`child_process.spawnSync\`, which this repository's Node 24 has had for a decade (measured 2026-09-08 by running \`pnpm dev:firefox\` with the build still denied).` (Step 1 의 결과가 다르면 그 결과를 쓴다.)
6. WXT specifics 문단의 `**Two e2e modes exist — \`e2e\` and \`bridge-e2e\`**` 앞에 한 문장: `**Three e2e builds exist**: Chrome \`e2e\`, Chrome \`bridge-e2e\`, and Firefox \`e2e\` (\`wxt build -b firefox --mode e2e\` → \`firefox-mv3-e2e\`), and the first two are modes of one target while the third is the other target in the first mode.`
7. Testing 첫 문단: `Two of the eighteen e2e tests` → `Two of the twenty-one e2e tests`; 열거 끝 `and the bridge row does not push the rail past its own column.` 뒤에 `Three are Firefox's, in \`tests/e2e/firefox.spec.ts\`, driven through Marionette rather than Playwright's browser (tests/support/firefox.ts): the same two wire tests, and the popup rendering from stored state with no bridge row.`; `Total: 18 tests in 3 files` → `Total: 21 tests in 4 files`; `gives the same 13 + 4 + 1` → `gives the same 13 + 4 + 1 + 3`.
8. Platform traps 끝에 절 추가:
   > **Firefox, measured 2026-09-08 (docs/research/2026-09-08-firefox-marionette-spike.md).** WXT builds `-b firefox` as **MV2** unless `manifestVersion: 3` is set. Firefox MV3 has no `background.service_worker`; WXT emits `background.scripts`. `updateDynamicRules` rejects `webbundle` and `webtransport` as enum values — the whole batch — so `conditions.ts` filters by target and `suppressionReason` returns `'no-resource-type'` when nothing is left; the same call **accepts** `append` on any request header, so Chrome's 21-entry allowlist is Chrome's (`capabilities.ts`). `permissions.contains` still needs the six-rung ladder (an `http://` grant answers `false` to `*://` and `https://`), and answers a malformed pattern with `false` where Chrome throws. Playwright cannot load a Firefox extension; WebDriver BiDi refuses `moz-extension://` navigation; Marionette allows it under `-remote-allow-system-access` (Firefox 138+), and its frames are **byte**-length-prefixed — the readout's middle dot is two bytes. Firefox's helper processes hold inherited pipes open after the parent dies: spawn detached and kill the group.

- [ ] **Step 5: 옛 스펙의 각주**

`docs/superpowers/specs/2026-07-31-headerlab-design.md` §10 의 `**제외:** … 사이드 패널 · Firefox` 줄 바로 아래에 (원문은 그대로):

```markdown
> 2026-09-08: Firefox 제외는 `2026-09-08-firefox-support-design.md` 로 풀렸다 — 빌드 타깃과
> e2e 까지. AMO 배포와 브릿지는 각각 후속 스펙이다.
```

- [ ] **Step 6: 확인과 커밋**

Run: `pnpm test:packages` (README 를 묶는 `docs.test.mjs`) 와 `pnpm exec vitest run tests/unit/readmeLiterals.test.ts tests/unit/storeListing.test.ts`
Expected: PASS.

```bash
git add README.md docs/README.ko.md docs/README.ja.md docs/README.zh.md docs/README.es.md CLAUDE.md docs/superpowers/specs/2026-07-31-headerlab-design.md
git commit -F - <<'EOF'
docs: Firefox install route, manifest facts, and the new test count

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X7XpCj1bESKpE1VkojMAis
EOF
```

---

### Task 9: 뮤테이션 확인, 헤디드 눈 확인, 최종 점검

커밋된 상태에서 한다 (CLAUDE.md: 미커밋 작업 위에서 뮤테이션 확인을 하다 실제 편집을 날린 적이 있다). 각 뮤테이션은 **줄 번호로** 넣고, 넣은 줄을 다시 읽어 실제로 코드가 바뀌었는지(주석이 아니라) 확인한 뒤 돌리고, `git checkout -- <file>` 로 되돌린다.

- [ ] **Step 1: 능력표를 무력화하면 Firefox 컴파일 테스트가 빨갛다**

`lib/compile/capabilities.ts` 의 `supportedResourceTypes` 본문을 `return [...types];` 로 바꾼다.
Run: `pnpm exec vitest run tests/unit/compile.test.ts tests/unit/conditions.test.ts tests/unit/suppression.test.ts`
Expected: FAIL — `compile — per target` 둘, `resource types per target` 하나, `suppression — request types` 셋 이상. 되돌린다.

- [ ] **Step 2: gecko 블록을 빼면 매니페스트 테스트가 빨갛다**

`wxt.config.ts` 의 `browser === 'firefox'` 분기에서 `data_collection_permissions: { required: ['none'] },` 줄을 지운다.
Run: `pnpm test`
Expected: `the Firefox manifest › carries the gecko block AMO requires, exactly` FAIL (그리고 WXT 가 빌드 중 data-collection 경고를 찍는다). 되돌린다.

- [ ] **Step 3: 브릿지 행을 다시 그리면 e2e 3번이 빨갛다**

`components/ScopeRail.tsx` 의 `{bridge === 'unavailable' ? null : (` 를 `{false ? null : (` 로 바꾼다.
Run: `pnpm test:e2e -- tests/e2e/firefox.spec.ts` (`pnpm test:e2e` 는 빌드를 포함한다; 인자를 못 넘기면 `pnpm build:firefox-e2e && pnpm exec playwright test tests/e2e/firefox.spec.ts`)
Expected: `the popup renders from stored state with no bridge row` FAIL (`bridgestate` 가 1). 되돌린다. `tests/unit/ScopeRail.test.tsx` 의 `a target with no bridge` 도 같은 뮤테이션에 빨갛다 — 함께 확인한다.

- [ ] **Step 4: 헤디드로 눈으로 본다**

`pnpm build` 뒤 Firefox Developer Edition 을 헤디드로 열고 `about:debugging` → This Firefox → Load Temporary Add-on → `.output/firefox-mv3/manifest.json`. 툴바 아이콘을 눌러 **실제 팝업 패널** 안에서 본다:
- 748×600 이 잘리지 않고 다 보이는가 (Firefox 의 상한은 800×600).
- 브릿지 행이 없는가.
- 사이트를 하나 추가하고 Grant 를 눌렀을 때 Firefox 의 권한 doorhanger 가 뜨고, 허용하면 행이 `Access granted` 로 바뀌는가.
- 룰을 하나 만들고 그 사이트에 가서 개발자 도구 네트워크 탭에서 헤더가 붙는가.

결과를 `docs/research/2026-09-08-firefox-marionette-spike.md` 의 `## 재지 않은 것` 첫 두 항목 옆에 날짜와 함께 기록한다 (잘림이 있으면 그 수치를). 커밋: `docs: what the headed Firefox popup looked like`.

- [ ] **Step 4b: 노트 줄의 너비를 잰다 (스펙 §6 이 요구하는 측정)**

같은 헤디드 Firefox 에서 `about:debugging` → 이 확장의 **Inspect** 로 확장 콘솔을 열고, 저장된 상태의 `resourceTypes` 를 두 형태로 심는다 — 먼저 `['webbundle', 'webtransport']` (error, 가장 긴 문장), 다음 `['webbundle', 'xmlhttprequest']` (warning):

```js
const { state } = await browser.storage.local.get('state');
state.profiles[0].filter.resourceTypes = ['webbundle', 'webtransport'];
await browser.storage.local.set({ state });
```

팝업을 다시 열어 인스펙터에서 `[data-testid="type-note"]` 의 `scrollWidth` 와 `clientWidth` 를 읽는다. 텍스트 예산은 레일 224px 에서 `px-3` 양쪽 24px 을 뺀 **200px** 이다.

- 두 문장 모두 `scrollWidth <= clientWidth` 면 그대로 두고, 두 수치를 스파이크 문서에 적는다.
- 어느 하나라도 넘치면 **문장을 줄인다**, 예산을 늘리지 않는다: `lib/compile/filterDiagnostics.ts` 의 메시지를 `Skipped in ${BROWSER_NAME[target]}: ${dropped.join(', ')}.` 로 바꾸고 (`title` 은 여전히 전체 문장을 실으므로 정보는 잃지 않는다), 그 문자열을 기대하는 테스트 — `tests/unit/filterDiagnostics.test.ts`, `tests/unit/App.firefox.test.tsx`, `tests/unit/ScopeRail.test.tsx` — 를 같이 고친 뒤 다시 잰다. 그래도 넘치면 멈추고 보고한다: 200px 에 두 이름을 넣을 수 없다면 그것은 카피가 아니라 설계의 문제이고, 소유자의 결정이다.

측정값과 결정을 스파이크 문서의 `## 매니페스트와 팝업` 절에 한 줄로 남긴다. 커밋에 포함한다.

- [ ] **Step 5: 전체**

Run: `pnpm check:all && pnpm test:e2e`
Expected: 모두 PASS. `git status` 가 깨끗하다 (`.DS_Store` 셋은 이 브랜치 전부터 있던 untracked).

Run: `pnpm exec playwright test --list | tail -1`
Expected: `Total: 21 tests in 4 files`.

- [ ] **Step 6: PR**

브랜치를 푸시하고 PR 을 연다 (`git push -u origin feat/firefox-support`, `gh pr create`). 본문에는 스펙 경로, 스파이크 경로, 테스트 플랜(위 Step 5 의 두 명령과 Step 4 의 눈 확인), 그리고 범위 밖 둘(AMO 배포, Firefox 브릿지)을 적는다. 시각적 변경이므로 `github-image-upload` 스킬로 Firefox 팝업 스크린샷(Task 6 의 `screenshot()` 또는 Step 4 의 캡처)을 `## Screenshots` 에 붙인다. PR 을 만든 뒤 `superpowers:requesting-code-review` 를 부른다.
