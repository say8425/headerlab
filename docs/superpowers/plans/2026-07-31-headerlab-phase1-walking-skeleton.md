# HeaderLab Phase 1 — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the thinnest end-to-end slice of HeaderLab that provably modifies a real HTTP header — scaffold, data model, pure rule compiler, DNR sync adapter, a minimal popup, and an echo-server E2E test that proves the header actually changed on the wire.

**Architecture:** All correctness lives in a pure function layer (`lib/compile/`, `lib/permissions/origins.ts`) that never imports `chrome.*` and is unit-tested without a browser. A single thin adapter (`lib/sync/ruleSync.ts`) is the only file that calls `chrome.declarativeNetRequest`. A single `reconcile()` entry point in the background service worker recompiles from storage and replaces all rules atomically. This shape is forced by a hard constraint: `@webext-core/fake-browser` does not implement `declarativeNetRequest` — every method throws `MockNotImplementedError` — so browser-imitation testing is unavailable, and the response is to make the browser irrelevant to the logic.

**Tech Stack:** WXT 0.21.1 · React 19.2.8 · TypeScript 7.0.2 · Vite 8.1.5 · Tailwind CSS 4.3.3 · shadcn/ui 4.16.0 (Radix base) · Zod 4.4.3 · Vitest 4.1.10 · Playwright 1.62.0

**Spec:** [`docs/superpowers/specs/2026-07-31-headerlab-design.md`](../specs/2026-07-31-headerlab-design.md)
**Technical constraints:** [`docs/research/2026-07-31-technical-constraints.md`](../../research/2026-07-31-technical-constraints.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **Target browsers:** Chrome and Edge only. Edge reuses the Chrome ZIP; no separate build.
- **Dependency versions** — pin these exactly; do not float or downgrade below them:
  `wxt@0.21.1` · `@wxt-dev/module-react@1.2.2` · `react@19.2.8` · `react-dom@19.2.8` ·
  `typescript@7.0.2` · `tailwindcss@4.3.3` · `@tailwindcss/vite@4.3.3` ·
  `shadcn@4.16.0` · `vitest@4.1.10` · `@playwright/test@1.62.0` ·
  `@webext-core/fake-browser@2.0.1` · `zod@4.4.3` · `@types/react@19.2.17` ·
  `@types/react-dom@19.2.3` · `@types/chrome@0.2.2`

  These are the newest versions installable here, not the newest that exist. The npm
  registry in use (`nexus.mng.musinsa.io`) enforces a rolling 72-hour publish-date
  quarantine — a supply-chain defence — so anything published in the last three days
  resolves to `ETARGET`. Five pins were lowered by one patch for this reason on
  2026-07-31: `wxt` 0.21.2→0.21.1, `@types/react` 19.2.18→19.2.17, `@types/react-dom`
  19.2.4→19.2.3, `@playwright/test` 1.62.1→1.62.0, and `vite` 8.2.0→whatever WXT
  resolves (it is no longer pinned directly; WXT brings its own).

  Do not work around the quarantine — no project `.npmrc` overriding `before`, no
  `--force`, no registry switch. If a pin fails to install, report it rather than
  substituting a version yourself. `wxt@0.21.1` is in fact the version this project's
  shadcn integration procedure was empirically verified against.
- **TypeScript 7 is in use.** `baseUrl` in `tsconfig.json` is a hard error. Never add it.
- **WXT storage import path** is `#imports` or `wxt/utils/storage`. **Never `wxt/storage`** — it does not compile on 0.21.x.
- **Every WXT storage key carries an area prefix.** There is no default area. This project uses `local:` only.
- **`lib/compile/**` and `lib/permissions/origins.ts` must never import `chrome.*`, `webextension-polyfill`, `wxt/browser`, or `#imports`.** They are pure. This is enforced by a test in Task 9.
- **`lib/sync/ruleSync.ts` is the only file permitted to call `chrome.declarativeNetRequest`.**
- **No network calls anywhere in shipped code.** No analytics, telemetry, remote config, or update pings. No content scripts. No external resources — including web fonts.
- **UI language is English.** Code comments and commit messages may be Korean or English; user-facing strings are English.
- **`resourceTypes` is always explicit** in every compiled rule condition. Never rely on the DNR default, which silently excludes `main_frame`.
- **Commit after every task.** Conventional commit prefixes: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

## Phase 1 scope

**In:** project scaffold · data model + Zod schemas · filter→condition compilation · header→action compilation · rule ID and priority allocation · origin derivation · the `compile()` assembly · storage with migrations · `ruleSync` + `reconcile()` · a minimal functional popup · echo-server E2E proving a header changed.

**Out — deferred to Phase 2 and 3:** the eight diagnostic kinds and their UI · permission audit and grant flows · the full Data Grid UI and both themes · tab lock · `testMatchOutcome` integration tests · the `check-no-network.ts` CI guard · JSON export/import · global pause UI.

Phase 1 deliberately ships a *correct but small* feature surface. `compile()` is built with the seams the deferred work plugs into (`diagnostics`, `requiredOrigins`, session rules) but Phase 1 only populates what it needs.

## File structure

| File | Responsibility |
|---|---|
| `wxt.config.ts` | Manifest, Tailwind plugin registration, React module, e2e-mode host permissions |
| `tsconfig.json` | Path aliases without `baseUrl` |
| `vite.config.ts` | Inert stub so the shadcn CLI's framework detection passes |
| `lib/model/types.ts` | All domain types and the DNR-shaped output types. No dependencies. |
| `lib/model/schema.ts` | Zod schemas mirroring `types.ts`, for untrusted input |
| `lib/model/defaults.ts` | Default `AppState` and profile factory |
| `lib/compile/conditions.ts` | `Filter` → `RuleCondition` |
| `lib/compile/headers.ts` | `HeaderRule[]` → `ModifyHeaderInfo[]` pair |
| `lib/compile/priority.ts` | Rule ID and priority allocation |
| `lib/permissions/origins.ts` | `Filter` → origin patterns |
| `lib/compile/compile.ts` | Assembly: `AppState` → `CompileResult` |
| `lib/storage/state.ts` | WXT storage item, versioned |
| `lib/sync/ruleSync.ts` | The only `chrome.declarativeNetRequest` caller |
| `entrypoints/background.ts` | `reconcile()` and its triggers |
| `entrypoints/popup/App.tsx` | Minimal editing UI |
| `tests/e2e/echo-server.ts` | Local HTTP server recording received headers |
| `tests/e2e/fixtures.ts` | Playwright persistent-context extension fixture |

---

## Task 1: Project scaffold

Produces a building, loadable extension. The step order below is load-bearing — steps 4 and 6 must precede step 8, because `shadcn init`'s "Validating import alias" check depends on both.

**Files:**
- Create: `package.json`, `wxt.config.ts`, `tsconfig.json`, `vite.config.ts`, `.gitignore`
- Create: `entrypoints/background.ts`, `entrypoints/popup/index.html`, `entrypoints/popup/main.tsx`, `entrypoints/popup/App.tsx`, `entrypoints/popup/style.css`

**Interfaces:**
- Consumes: nothing
- Produces: a working `wxt build`; the `@/*` path alias resolving to the project root

- [ ] **Step 1: Initialize the package and install dependencies**

```bash
cd /Users/penguin/dev/headerlab
npm init -y
npm i -D wxt@0.21.1 @wxt-dev/module-react@1.2.2 typescript@7.0.2 \
         @types/react@19.2.17 @types/react-dom@19.2.3 @types/chrome@0.2.2 \
         tailwindcss@4.3.3 @tailwindcss/vite@4.3.3
npm i react@19.2.8 react-dom@19.2.8 zod@4.4.3
```

- [ ] **Step 2: Write `wxt.config.ts`**

`optional_host_permissions` is a valid MV3 key but may not be in WXT's manifest type; the `as never` cast on that one property keeps the rest of the object type-checked. The `e2e` mode branch adds a loopback host permission so Task 12's E2E build can modify headers without a runtime permission prompt — the shipped build never includes it.

```ts
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => ({
    name: 'HeaderLab',
    description: 'Add, modify and remove HTTP request and response headers.',
    permissions: ['storage', 'declarativeNetRequestWithHostAccess', 'activeTab'],
    optional_host_permissions: ['<all_urls>'],
    // e2e builds only: lets the E2E suite modify headers on the loopback echo
    // server without a runtime permission prompt Playwright cannot click.
    // Task 14 Step 3 asserts this never reaches a production build.
    ...(mode === 'e2e' ? { host_permissions: ['http://127.0.0.1/*'] } : {}),
  }),
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
```

If `tsc` rejects `optional_host_permissions` as an unknown property, WXT's manifest type
predates the key. Spread it in instead of listing it, which bypasses excess-property
checking without weakening the rest of the object:

```ts
    ...({ optional_host_permissions: ['<all_urls>'] } as Record<string, unknown>),
```

- [ ] **Step 3: Write the entrypoints**

`entrypoints/background.ts`:

```ts
export default defineBackground(() => {
  console.info('[HeaderLab] background ready');
});
```

`entrypoints/popup/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>HeaderLab</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`entrypoints/popup/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`entrypoints/popup/App.tsx`:

```tsx
export default function App() {
  return <div className="p-4 text-sm">HeaderLab</div>;
}
```

`entrypoints/popup/style.css`:

```css
@import "tailwindcss";
```

- [ ] **Step 4: Write `tsconfig.json` — no `baseUrl`**

`wxt prepare` generates `.wxt/tsconfig.json` whose `paths` are relative to `.wxt/`. The shadcn CLI resolves aliases through `tsconfig-paths`, which anchors `absoluteBaseUrl` at the project root — so the inherited `../*` values resolve one directory too high and `shadcn add` writes components *outside* the project with no error. Declaring `paths` here overrides that. `baseUrl` is a hard error on TypeScript 7, which is why shadcn's own Vite instructions cannot be followed.

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "paths": {
      "@": ["./"],
      "@/*": ["./*"]
    }
  }
}
```

- [ ] **Step 5: Generate WXT's types**

```bash
npx wxt prepare
```

Expected: `.wxt/` directory created containing `tsconfig.json`.

- [ ] **Step 6: Add the inert `vite.config.ts` stub**

WXT configures Vite through `wxt.config.ts` and has no `vite.config.ts`, so shadcn's framework detection fails with "We could not detect a supported framework". WXT never reads this file.

```ts
import { defineConfig } from 'vite';

export default defineConfig({});
```

- [ ] **Step 7: Verify the extension builds before adding shadcn**

Run: `npx wxt build`
Expected: exits 0, `.output/chrome-mv3/` created containing `manifest.json`.

- [ ] **Step 8: Run `shadcn init`**

`--preset` is mandatory: `shadcn init` prompts for a preset interactively **even with `--yes`**, and will hang without it. `--base radix` is mandatory too: the CLI default changed to Base UI in July 2026.

```bash
npx shadcn@4.16.0 init --yes --base radix --preset nova
```

- [ ] **Step 9: Verify shadcn writes inside the project**

This is the silent failure the `paths` override in Step 4 prevents. Verify with a dry run before adding anything for real.

Run: `npx shadcn@4.16.0 add button --dry-run --yes`
Expected: the reported path is `components/ui/button.tsx`.
**If it reports `../components/ui/button.tsx`, stop.** Step 4 did not take effect — re-check `tsconfig.json` and re-run `npx wxt prepare`.

- [ ] **Step 10: Remove the web font import**

`shadcn init` adds a font `@import` to the CSS entry. External resources are forbidden (Global Constraints) and would fail under the extension CSP.

Open `entrypoints/popup/style.css` and delete any line matching `@import url(...)` or any `@import` referencing `fonts.googleapis.com` / `fonts.bunny.net`. Keep `@import "tailwindcss";` and everything shadcn wrote below it.

Run: `grep -n "@import" entrypoints/popup/style.css`
Expected: no line contains `url(` or `http`.

- [ ] **Step 11: Verify the build still succeeds**

Run: `npx wxt build && grep -c "optional_host_permissions" .output/chrome-mv3/manifest.json`
Expected: build exits 0 and grep prints `1`.

- [ ] **Step 12: Add npm scripts**

Add to `package.json`:

```json
{
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "build:e2e": "wxt build --mode e2e",
    "zip": "wxt zip",
    "compile": "tsc --noEmit",
    "postinstall": "wxt prepare"
  }
}
```

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: WXT + React + Tailwind v4 + shadcn 스캐폴딩

tsconfig 의 paths 를 직접 선언해 shadcn CLI 가 프로젝트 밖에 쓰는 것을 방지.
vite.config.ts 스텁으로 shadcn 프레임워크 감지 통과.
shadcn 이 넣은 웹폰트 import 제거 (외부 리소스 금지)."
```

---

## Task 2: Domain types

Pure type declarations with no runtime dependencies. Every later task imports from here.

**Files:**
- Create: `lib/model/types.ts`
- Test: none (types only; Task 3 exercises them)

**Interfaces:**
- Consumes: nothing
- Produces: `Operation`, `HeaderTarget`, `ResourceType`, `RequestMethod`, `HeaderRule`, `Filter`, `TabLock`, `Profile`, `AppState`, `ProfileColor`, `DnrRule`, `DnrRuleCondition`, `ModifyHeaderInfo`, `CompileResult`, `Diagnostic`, `MAX_PROFILES`

- [ ] **Step 1: Write `lib/model/types.ts`**

The DNR-shaped types are declared locally rather than imported from `@types/chrome` so that `lib/compile/**` has zero external type dependencies and stays trivially testable. `lib/sync/ruleSync.ts` casts to the real Chrome types at the boundary.

```ts
// ---------- domain ----------

export type Operation = 'set' | 'append' | 'remove';
export type HeaderTarget = 'request' | 'response';

export type ResourceType =
  | 'main_frame' | 'sub_frame' | 'stylesheet' | 'script' | 'image'
  | 'font' | 'object' | 'xmlhttprequest' | 'ping' | 'csp_report'
  | 'media' | 'websocket' | 'webtransport' | 'webbundle' | 'other';

export type RequestMethod =
  | 'connect' | 'delete' | 'get' | 'head' | 'options'
  | 'patch' | 'post' | 'put' | 'other';

export type ProfileColor = 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'cyan';

export interface HeaderRule {
  id: string;
  enabled: boolean;
  target: HeaderTarget;
  operation: Operation;
  name: string;
  /** Empty string when operation is 'remove'. The compiler drops the field entirely. */
  value: string;
  comment?: string;
}

export interface Filter {
  mode: 'structured' | 'regex';
  domains: string[];
  excludedDomains: string[];
  pathPattern?: string;
  regex?: string;
  /** Never empty. DNR rejects empty arrays and its default silently excludes main_frame. */
  resourceTypes: ResourceType[];
  requestMethods?: RequestMethod[];
}

export interface TabLock {
  enabled: boolean;
  tabId: number | null;
  tabTitle: string | null;
}

export interface Profile {
  id: string;
  name: string;
  color: ProfileColor;
  enabled: boolean;
  order: number;
  filter: Filter;
  tabLock: TabLock;
  headers: HeaderRule[];
}

export interface AppState {
  version: number;
  profiles: Profile[];
  globalPause: boolean;
  theme: 'system' | 'light' | 'dark';
}

/**
 * Bounds two undocumented behaviours at once: whether a rule id may be reused
 * across the dynamic and session rulesets, and the (undocumented) upper bound
 * of `priority`. See spec §4.6.
 */
export const MAX_PROFILES = 200;

// ---------- DNR output shapes ----------

export interface ModifyHeaderInfo {
  header: string;
  operation: Operation;
  /** Absent for 'remove'. Required for 'set' and 'append'. */
  value?: string;
}

export interface DnrRuleCondition {
  urlFilter?: string;
  regexFilter?: string;
  requestDomains?: string[];
  excludedRequestDomains?: string[];
  resourceTypes: ResourceType[];
  requestMethods?: RequestMethod[];
  /** Session-scoped rules only. */
  tabIds?: number[];
}

export interface DnrRule {
  id: number;
  priority: number;
  condition: DnrRuleCondition;
  action: {
    type: 'modifyHeaders';
    requestHeaders?: ModifyHeaderInfo[];
    responseHeaders?: ModifyHeaderInfo[];
  };
}

// ---------- compiler output ----------

export type DiagnosticKind =
  | 'append-not-allowed'
  | 'invalid-header-name'
  | 'duplicate-header'
  | 'regex-unsupported'
  | 'profile-conflict'
  | 'permission-missing'
  | 'tab-lock-stale'
  | 'empty-filter';

export interface Diagnostic {
  kind: DiagnosticKind;
  severity: 'error' | 'warning';
  profileId: string;
  headerRuleId?: string;
  message: string;
}

export interface CompileResult {
  dynamic: DnrRule[];
  session: DnrRule[];
  diagnostics: Diagnostic[];
  requiredOrigins: string[];
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run compile`
Expected: exits 0 with no output.

- [ ] **Step 3: Commit**

```bash
git add lib/model/types.ts
git commit -m "feat: 도메인 타입과 DNR 출력 형태 정의

컴파일러 층이 외부 타입 의존 없이 테스트되도록 DNR 형태를 로컬 선언."
```

---

## Task 3: Header validation — MOVED TO PHASE 2

**Do not implement this task. Skip to Task 4.**

`lib/compile/validate.ts` (the 21-header append allowlist, `isValidHeaderName`, `canAppend`)
has no caller in Phase 1: it is consumed by the `append-not-allowed` and
`invalid-header-name` diagnostics and by the operation dropdown, all of which are Phase 2.
Shipping it now would land uncalled code that a reviewer would correctly flag as a YAGNI
violation.

The allowlist is not at risk of being lost — it is recorded with its per-header join
delimiters in [`docs/research/2026-07-31-technical-constraints.md`](../../research/2026-07-31-technical-constraints.md) §1.4,
sourced from Chromium's `kDNRRequestHeaderAppendAllowList`.

Task numbering is unchanged so that every cross-reference in this document stays valid.
**Phase 1 has 13 executable tasks: 1, 2, and 4 through 14.**

One thing Task 3 was carrying that Phase 1 still needs — the Vitest setup — moves into
Task 4, which is the first task with a test.

---

## Task 4: Filter → RuleCondition

**Files:**
- Create: `lib/compile/conditions.ts`
- Test: `tests/unit/conditions.test.ts`

**Interfaces:**
- Consumes: `Filter`, `DnrRuleCondition` from `lib/model/types.ts`
- Produces: `filterToCondition(filter: Filter, tabId?: number | null): DnrRuleCondition`

- [ ] **Step 1: Install and configure Vitest**

This is the first task with a test, so the runner is set up here.

```bash
npm i -D vitest@4.1.10 @vitest/coverage-v8@4.1.10 @webext-core/fake-browser@2.0.1
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
```

The `WxtVitest` plugin supplies WXT's path aliases (so `@/...` resolves in tests) and
swaps `wxt/browser` for the fake browser.

The import path is `wxt/testing/vitest-plugin`, **not** `wxt/testing`. wxt@0.21.1 exports
only `./testing/fake-browser` and `./testing/vitest-plugin`; the bare `wxt/testing` barrel
does not exist and fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Verified empirically on
2026-07-31.

Add to `package.json` scripts: `"test": "vitest run"` and `"test:watch": "vitest"`.

Run: `npx vitest run --passWithNoTests`
Expected: exits 0.

- [ ] **Step 2: Write the failing test**

`urlFilter` substring-matches the entire serialized URL, not the path — so a bare `/v2/` would also match `?q=/v2/`. The compiler anchors it against the domain instead. `||` is the domain-name anchor and `^` is the separator character.

`tests/unit/conditions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { filterToCondition } from '@/lib/compile/conditions';
import type { Filter } from '@/lib/model/types';

const base: Filter = {
  mode: 'structured',
  domains: ['api.example.com'],
  excludedDomains: [],
  resourceTypes: ['xmlhttprequest'],
};

describe('filterToCondition — structured mode', () => {
  it('maps domains to requestDomains', () => {
    expect(filterToCondition(base)).toEqual({
      requestDomains: ['api.example.com'],
      resourceTypes: ['xmlhttprequest'],
    });
  });

  it('omits excludedRequestDomains when the list is empty', () => {
    expect(filterToCondition(base)).not.toHaveProperty('excludedRequestDomains');
  });

  it('includes excludedRequestDomains when present', () => {
    const f = { ...base, excludedDomains: ['static.example.com'] };
    expect(filterToCondition(f).excludedRequestDomains).toEqual(['static.example.com']);
  });

  it('omits requestDomains entirely when no domains are given', () => {
    const f = { ...base, domains: [] };
    expect(filterToCondition(f)).not.toHaveProperty('requestDomains');
  });

  it('anchors a single-domain path pattern to the domain', () => {
    const f = { ...base, pathPattern: '/v2/' };
    expect(filterToCondition(f).urlFilter).toBe('||api.example.com^*/v2/');
  });

  it('leaves the path unanchored when several domains are targeted', () => {
    const f = { ...base, domains: ['a.example.com', 'b.example.com'], pathPattern: '/v2/' };
    expect(filterToCondition(f).urlFilter).toBe('/v2/');
  });

  it('normalizes a path pattern that omits the leading slash', () => {
    const f = { ...base, pathPattern: 'v2/' };
    expect(filterToCondition(f).urlFilter).toBe('||api.example.com^*/v2/');
  });

  it('strips a trailing wildcard, which urlFilter implies', () => {
    const f = { ...base, pathPattern: '/v2/*' };
    expect(filterToCondition(f).urlFilter).toBe('||api.example.com^*/v2/');
  });

  it('omits urlFilter when the path pattern is blank', () => {
    const f = { ...base, pathPattern: '   ' };
    expect(filterToCondition(f)).not.toHaveProperty('urlFilter');
  });
});

describe('filterToCondition — regex mode', () => {
  const rx: Filter = { ...base, mode: 'regex', regex: '^https://api\\.example\\.com/v\\d+/' };

  it('emits regexFilter and never urlFilter', () => {
    const c = filterToCondition(rx);
    expect(c.regexFilter).toBe('^https://api\\.example\\.com/v\\d+/');
    expect(c).not.toHaveProperty('urlFilter');
  });

  it('still emits requestDomains, which composes with regexFilter', () => {
    expect(filterToCondition(rx).requestDomains).toEqual(['api.example.com']);
  });

  it('omits regexFilter when the regex is blank', () => {
    expect(filterToCondition({ ...rx, regex: '' })).not.toHaveProperty('regexFilter');
  });
});

describe('filterToCondition — shared', () => {
  it('always emits resourceTypes verbatim', () => {
    const f = { ...base, resourceTypes: ['xmlhttprequest', 'main_frame'] as const };
    expect(filterToCondition({ ...f, resourceTypes: [...f.resourceTypes] }).resourceTypes)
      .toEqual(['xmlhttprequest', 'main_frame']);
  });

  it('includes requestMethods only when non-empty', () => {
    expect(filterToCondition(base)).not.toHaveProperty('requestMethods');
    expect(filterToCondition({ ...base, requestMethods: ['get'] }).requestMethods).toEqual(['get']);
    expect(filterToCondition({ ...base, requestMethods: [] })).not.toHaveProperty('requestMethods');
  });

  it('adds tabIds when a tab id is supplied', () => {
    expect(filterToCondition(base, 42).tabIds).toEqual([42]);
  });

  it('omits tabIds for null and undefined', () => {
    expect(filterToCondition(base, null)).not.toHaveProperty('tabIds');
    expect(filterToCondition(base)).not.toHaveProperty('tabIds');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/conditions.test.ts`
Expected: FAIL — cannot resolve `@/lib/compile/conditions`.

- [ ] **Step 4: Write `lib/compile/conditions.ts`**

```ts
import type { DnrRuleCondition, Filter } from '@/lib/model/types';

/**
 * Builds the urlFilter fragment for a path pattern.
 *
 * urlFilter matches a substring of the whole serialized URL, so a bare "/v2/"
 * also matches "?q=/v2/". With exactly one target domain we can anchor against
 * it: "||" is the domain-name anchor and "^" the separator character. With
 * several domains a single anchored pattern cannot cover them all, so the
 * fragment is left unanchored and the UI shows a match preview instead.
 */
function buildUrlFilter(pathPattern: string, domains: string[]): string | undefined {
  let path = pathPattern.trim();
  if (!path) return undefined;

  // urlFilter is an unanchored substring match, so a trailing "*" adds nothing.
  while (path.endsWith('*')) path = path.slice(0, -1);
  if (!path) return undefined;

  if (!path.startsWith('/')) path = `/${path}`;

  return domains.length === 1 ? `||${domains[0]}^*${path}` : path;
}

export function filterToCondition(
  filter: Filter,
  tabId?: number | null,
): DnrRuleCondition {
  const condition: DnrRuleCondition = {
    resourceTypes: [...filter.resourceTypes],
  };

  if (filter.domains.length > 0) {
    condition.requestDomains = [...filter.domains];
  }
  if (filter.excludedDomains.length > 0) {
    condition.excludedRequestDomains = [...filter.excludedDomains];
  }

  // urlFilter and regexFilter are mutually exclusive.
  if (filter.mode === 'regex') {
    const regex = filter.regex?.trim();
    if (regex) condition.regexFilter = regex;
  } else if (filter.pathPattern) {
    const urlFilter = buildUrlFilter(filter.pathPattern, filter.domains);
    if (urlFilter) condition.urlFilter = urlFilter;
  }

  if (filter.requestMethods && filter.requestMethods.length > 0) {
    condition.requestMethods = [...filter.requestMethods];
  }

  if (typeof tabId === 'number') {
    condition.tabIds = [tabId];
  }

  return condition;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/conditions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/compile/conditions.ts tests/unit/conditions.test.ts
git commit -m "feat: Filter -> RuleCondition 컴파일

urlFilter 는 경로가 아니라 URL 전체 부분 문자열 매칭이므로 도메인 앵커를 붙임.
도메인이 여럿이면 단일 앵커로 덮을 수 없어 앵커 없이 두고 UI 가 미리보기를 보여줌."
```

---

## Task 5: HeaderRule[] → ModifyHeaderInfo[]

**Files:**
- Create: `lib/compile/headers.ts`
- Test: `tests/unit/headers.test.ts`

**Interfaces:**
- Consumes: `HeaderRule`, `ModifyHeaderInfo` from `lib/model/types.ts`
- Produces: `compileHeaders(headers: HeaderRule[]): { requestHeaders?: ModifyHeaderInfo[]; responseHeaders?: ModifyHeaderInfo[] }`

- [ ] **Step 1: Write the failing test**

`tests/unit/headers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { compileHeaders } from '@/lib/compile/headers';
import type { HeaderRule, Profile } from '@/lib/model/types';

function rule(over: Partial<HeaderRule> = {}): HeaderRule {
  return {
    id: 'h1',
    enabled: true,
    target: 'request',
    operation: 'set',
    name: 'X-Debug-Mode',
    value: 'true',
    ...over,
  };
}

describe('compileHeaders', () => {
  it('compiles an enabled set rule', () => {
    expect(compileHeaders([rule()])).toEqual({
      requestHeaders: [{ header: 'X-Debug-Mode', operation: 'set', value: 'true' }],
    });
  });

  it('drops the value field entirely for remove', () => {
    const out = compileHeaders([rule({ operation: 'remove', name: 'If-None-Match', value: '' })]);
    expect(out.requestHeaders).toEqual([{ header: 'If-None-Match', operation: 'remove' }]);
    expect(out.requestHeaders![0]).not.toHaveProperty('value');
  });

  it('keeps an empty value for set — an empty header value is legal', () => {
    const out = compileHeaders([rule({ operation: 'set', value: '' })]);
    expect(out.requestHeaders).toEqual([
      { header: 'X-Debug-Mode', operation: 'set', value: '' },
    ]);
  });

  it('skips disabled rules', () => {
    expect(compileHeaders([rule({ enabled: false })])).toEqual({});
  });

  it('separates request and response targets', () => {
    const out = compileHeaders([
      rule({ id: 'a', target: 'request', name: 'Authorization', value: 'Bearer x' }),
      rule({ id: 'b', target: 'response', name: 'Cache-Control', value: 'no-store' }),
    ]);
    expect(out.requestHeaders).toEqual([
      { header: 'Authorization', operation: 'set', value: 'Bearer x' },
    ]);
    expect(out.responseHeaders).toEqual([
      { header: 'Cache-Control', operation: 'set', value: 'no-store' },
    ]);
  });

  it('omits an array entirely when that target has no enabled rules', () => {
    const out = compileHeaders([rule({ target: 'request' })]);
    expect(out).not.toHaveProperty('responseHeaders');
  });

  it('returns an empty object for an empty input', () => {
    expect(compileHeaders([])).toEqual({});
  });

  it('preserves author order within a target', () => {
    const out = compileHeaders([
      rule({ id: 'a', name: 'A' }),
      rule({ id: 'b', name: 'B' }),
      rule({ id: 'c', name: 'C' }),
    ]);
    expect(out.requestHeaders!.map((h) => h.header)).toEqual(['A', 'B', 'C']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/headers.test.ts`
Expected: FAIL — cannot resolve `@/lib/compile/headers`.

- [ ] **Step 3: Write `lib/compile/headers.ts`**

```ts
import type { HeaderRule, ModifyHeaderInfo } from '@/lib/model/types';

function toModifyHeaderInfo(rule: HeaderRule): ModifyHeaderInfo {
  // `value` must be absent for remove and present for set/append.
  if (rule.operation === 'remove') {
    return { header: rule.name, operation: 'remove' };
  }
  return { header: rule.name, operation: rule.operation, value: rule.value };
}

export function compileHeaders(headers: HeaderRule[]): {
  requestHeaders?: ModifyHeaderInfo[];
  responseHeaders?: ModifyHeaderInfo[];
} {
  const requestHeaders: ModifyHeaderInfo[] = [];
  const responseHeaders: ModifyHeaderInfo[] = [];

  for (const rule of headers) {
    if (!rule.enabled) continue;
    const target = rule.target === 'request' ? requestHeaders : responseHeaders;
    target.push(toModifyHeaderInfo(rule));
  }

  const out: ReturnType<typeof compileHeaders> = {};
  if (requestHeaders.length > 0) out.requestHeaders = requestHeaders;
  if (responseHeaders.length > 0) out.responseHeaders = responseHeaders;
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/headers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/compile/headers.ts tests/unit/headers.test.ts
git commit -m "feat: HeaderRule -> ModifyHeaderInfo 컴파일

remove 는 value 필드 자체를 제거해야 함. set 의 빈 값은 합법이므로 유지."
```

---

## Task 6: Rule ID and priority allocation

**Files:**
- Create: `lib/compile/priority.ts`
- Test: `tests/unit/priority.test.ts`

**Interfaces:**
- Consumes: `Profile`, `MAX_PROFILES` from `lib/model/types.ts`
- Produces:
  - `DYNAMIC_ID_BASE = 1`, `SESSION_ID_BASE = 10000`
  - `interface Allocation { profileId: string; ruleId: number; priority: number; scope: 'dynamic' | 'session' }`
  - `allocate(profiles: Profile[]): Allocation[]`

- [ ] **Step 1: Write the failing test**

Priorities must be **unique**: the tie-break between two equal-priority `modifyHeaders` rules is undocumented. ID spaces must be **disjoint**: whether one id may appear in both the dynamic and session rulesets is likewise undocumented. Both constraints exist to avoid depending on unspecified behaviour.

`tests/unit/priority.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { allocate, DYNAMIC_ID_BASE, SESSION_ID_BASE } from '@/lib/compile/priority';
import { MAX_PROFILES, type Profile } from '@/lib/model/types';

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'Local',
    color: 'green',
    enabled: true,
    order: 0,
    filter: { mode: 'structured', domains: [], excludedDomains: [], resourceTypes: ['xmlhttprequest'] },
    tabLock: { enabled: false, tabId: null, tabTitle: null },
    headers: [],
    ...over,
  };
}

describe('allocate', () => {
  it('gives the first profile the highest priority', () => {
    const out = allocate([
      profile({ id: 'a', order: 0 }),
      profile({ id: 'b', order: 1 }),
      profile({ id: 'c', order: 2 }),
    ]);
    expect(out.map((a) => a.priority)).toEqual([3, 2, 1]);
  });

  it('never emits a priority below 1', () => {
    const out = allocate([profile({ id: 'a', order: 0 })]);
    expect(out[0].priority).toBe(1);
  });

  it('assigns unique priorities so the undocumented tie-break never applies', () => {
    const out = allocate(Array.from({ length: 20 }, (_, i) => profile({ id: `p${i}`, order: i })));
    expect(new Set(out.map((a) => a.priority)).size).toBe(20);
  });

  it('sorts by order, not by array position', () => {
    const out = allocate([
      profile({ id: 'later', order: 5 }),
      profile({ id: 'first', order: 1 }),
    ]);
    expect(out.map((a) => a.profileId)).toEqual(['first', 'later']);
    expect(out[0].priority).toBeGreaterThan(out[1].priority);
  });

  it('routes tab-locked profiles to the session scope and others to dynamic', () => {
    const out = allocate([
      profile({ id: 'plain', order: 0 }),
      profile({ id: 'locked', order: 1, tabLock: { enabled: true, tabId: 7, tabTitle: 'x' } }),
    ]);
    expect(out.find((a) => a.profileId === 'plain')!.scope).toBe('dynamic');
    expect(out.find((a) => a.profileId === 'locked')!.scope).toBe('session');
  });

  it('treats a tab lock with a null tabId as dynamic', () => {
    const out = allocate([
      profile({ id: 'stale', tabLock: { enabled: true, tabId: null, tabTitle: null } }),
    ]);
    expect(out[0].scope).toBe('dynamic');
  });

  it('keeps the dynamic and session id spaces disjoint', () => {
    const out = allocate([
      profile({ id: 'a', order: 0 }),
      profile({ id: 'b', order: 1, tabLock: { enabled: true, tabId: 7, tabTitle: 'x' } }),
      profile({ id: 'c', order: 2 }),
    ]);
    const dynamic = out.filter((a) => a.scope === 'dynamic').map((a) => a.ruleId);
    const session = out.filter((a) => a.scope === 'session').map((a) => a.ruleId);
    expect(dynamic).toEqual([DYNAMIC_ID_BASE, DYNAMIC_ID_BASE + 1]);
    expect(session).toEqual([SESSION_ID_BASE]);
    expect(dynamic.every((id) => id < SESSION_ID_BASE)).toBe(true);
  });

  it('skips disabled profiles entirely', () => {
    const out = allocate([
      profile({ id: 'on', order: 0 }),
      profile({ id: 'off', order: 1, enabled: false }),
    ]);
    expect(out.map((a) => a.profileId)).toEqual(['on']);
  });

  it('throws above MAX_PROFILES', () => {
    const many = Array.from({ length: MAX_PROFILES + 1 }, (_, i) =>
      profile({ id: `p${i}`, order: i }),
    );
    expect(() => allocate(many)).toThrow(/MAX_PROFILES/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/priority.test.ts`
Expected: FAIL — cannot resolve `@/lib/compile/priority`.

- [ ] **Step 3: Write `lib/compile/priority.ts`**

```ts
import { MAX_PROFILES, type Profile } from '@/lib/model/types';

export const DYNAMIC_ID_BASE = 1;
export const SESSION_ID_BASE = 10_000;

export interface Allocation {
  profileId: string;
  ruleId: number;
  priority: number;
  scope: 'dynamic' | 'session';
}

/**
 * Assigns each enabled profile a rule id and a priority.
 *
 * Priorities are unique because the tie-break between two equal-priority
 * modifyHeaders rules is undocumented. The dynamic and session id spaces are
 * disjoint because whether an id may be reused across rulesets is likewise
 * undocumented. Both narrow the design away from unspecified behaviour.
 */
export function allocate(profiles: Profile[]): Allocation[] {
  if (profiles.length > MAX_PROFILES) {
    throw new RangeError(
      `profile count ${profiles.length} exceeds MAX_PROFILES (${MAX_PROFILES})`,
    );
  }

  const active = profiles
    .filter((p) => p.enabled)
    .sort((a, b) => a.order - b.order);

  let dynamicId = DYNAMIC_ID_BASE;
  let sessionId = SESSION_ID_BASE;

  return active.map((profile, index) => {
    const locked = profile.tabLock.enabled && typeof profile.tabLock.tabId === 'number';
    const scope = locked ? 'session' : 'dynamic';
    return {
      profileId: profile.id,
      ruleId: locked ? sessionId++ : dynamicId++,
      priority: active.length - index,
      scope,
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/priority.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/compile/priority.ts tests/unit/priority.test.ts
git commit -m "feat: 룰 ID 와 priority 배정

priority 를 유일하게 배정해 미문서화 타이브레이크를 회피하고,
dynamic/session ID 공간을 분리해 ID 재사용 가능 여부를 확인할 필요를 없앰."
```

---

## Task 7: Origin derivation

**Files:**
- Create: `lib/permissions/origins.ts`
- Test: `tests/unit/origins.test.ts`

**Interfaces:**
- Consumes: `Filter` from `lib/model/types.ts`
- Produces:
  - `originCandidates(domain: string): string[]` — narrowest to broadest
  - `requestPattern(domain: string): string` — the broad pattern to request
  - `originsForFilter(filter: Filter): string[]`

- [ ] **Step 1: Write the failing test**

`permissions.contains()` is a **subset** check. `requestDomains` carries no scheme, so a naively derived `*://*.D/*` returns false when the user granted only `https://D/*` — producing a false "grant needed" badge on a working configuration. The audit therefore tries candidates narrowest-first and treats any hit as granted, while grant requests use the broad pattern.

`tests/unit/origins.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { originCandidates, originsForFilter, requestPattern } from '@/lib/permissions/origins';
import type { Filter } from '@/lib/model/types';

describe('originCandidates', () => {
  it('lists candidates narrowest to broadest', () => {
    expect(originCandidates('api.example.com')).toEqual([
      'https://api.example.com/*',
      'https://*.api.example.com/*',
      '*://api.example.com/*',
      '*://*.api.example.com/*',
    ]);
  });

  it('lowercases the domain', () => {
    expect(originCandidates('API.Example.COM')[0]).toBe('https://api.example.com/*');
  });

  it('strips a leading dot', () => {
    expect(originCandidates('.example.com')[0]).toBe('https://example.com/*');
  });

  it('strips a leading wildcard label', () => {
    expect(originCandidates('*.example.com')[0]).toBe('https://example.com/*');
  });
});

describe('requestPattern', () => {
  it('returns the broadest pattern so one grant covers scheme and subdomains', () => {
    expect(requestPattern('api.example.com')).toBe('*://*.api.example.com/*');
  });
});

describe('originsForFilter', () => {
  const base: Filter = {
    mode: 'structured',
    domains: ['api.example.com'],
    excludedDomains: [],
    resourceTypes: ['xmlhttprequest'],
  };

  it('returns the request pattern for each domain', () => {
    expect(originsForFilter(base)).toEqual(['*://*.api.example.com/*']);
  });

  it('deduplicates domains that normalize to the same host', () => {
    const f = { ...base, domains: ['api.example.com', 'API.example.com', '*.api.example.com'] };
    expect(originsForFilter(f)).toEqual(['*://*.api.example.com/*']);
  });

  it('returns <all_urls> when no domain narrows the filter', () => {
    expect(originsForFilter({ ...base, domains: [] })).toEqual(['<all_urls>']);
  });

  it('returns <all_urls> for regex mode — a regex cannot be reduced to origins', () => {
    const f: Filter = { ...base, mode: 'regex', regex: '^https://.*/v2/', domains: [] };
    expect(originsForFilter(f)).toEqual(['<all_urls>']);
  });

  it('still uses the domains in regex mode when they are given', () => {
    const f: Filter = { ...base, mode: 'regex', regex: '^https://.*/v2/' };
    expect(originsForFilter(f)).toEqual(['*://*.api.example.com/*']);
  });

  it('ignores blank domain entries', () => {
    expect(originsForFilter({ ...base, domains: ['  ', 'api.example.com'] }))
      .toEqual(['*://*.api.example.com/*']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/origins.test.ts`
Expected: FAIL — cannot resolve `@/lib/permissions/origins`.

- [ ] **Step 3: Write `lib/permissions/origins.ts`**

```ts
import type { Filter } from '@/lib/model/types';

/** Normalizes a user-entered domain to a bare host. */
function normalizeDomain(domain: string): string {
  let d = domain.trim().toLowerCase();
  if (d.startsWith('*.')) d = d.slice(2);
  if (d.startsWith('.')) d = d.slice(1);
  return d;
}

/**
 * Match patterns to test with permissions.contains(), narrowest first.
 *
 * contains() is a subset check, so a broad pattern returns false when the user
 * granted only a narrow one. Testing narrowest-first and accepting any hit
 * prevents a false "grant needed" badge on a configuration that actually works.
 */
export function originCandidates(domain: string): string[] {
  const d = normalizeDomain(domain);
  return [
    `https://${d}/*`,
    `https://*.${d}/*`,
    `*://${d}/*`,
    `*://*.${d}/*`,
  ];
}

/** The pattern to pass to permissions.request(): audit leniently, request generously. */
export function requestPattern(domain: string): string {
  return `*://*.${normalizeDomain(domain)}/*`;
}

export function originsForFilter(filter: Filter): string[] {
  const domains = filter.domains
    .map(normalizeDomain)
    .filter((d) => d.length > 0);

  if (domains.length === 0) return ['<all_urls>'];

  return [...new Set(domains)].map((d) => `*://*.${d}/*`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/origins.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/permissions/origins.ts tests/unit/origins.test.ts
git commit -m "feat: 필터에서 오리진 패턴 유도

contains() 는 부분집합 검사라 넓은 패턴이 좁은 부여에 false 를 냄.
좁은 것부터 검사해 거짓 '권한 필요' 배지를 막고, 요청은 넓게 함."
```

---

## Task 8: The compile assembly

**Files:**
- Create: `lib/compile/compile.ts`
- Test: `tests/unit/compile.test.ts`

**Interfaces:**
- Consumes: `filterToCondition` (Task 4), `compileHeaders` (Task 5), `allocate` (Task 6), `originsForFilter` (Task 7)
- Produces: `compile(state: AppState): CompileResult`

- [ ] **Step 1: Write the failing test**

`tests/unit/compile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { compile } from '@/lib/compile/compile';
import type { AppState, HeaderRule, Profile } from '@/lib/model/types';

function header(over: Partial<HeaderRule> = {}): HeaderRule {
  return {
    id: 'h1', enabled: true, target: 'request',
    operation: 'set', name: 'X-Debug-Mode', value: 'true',
    ...over,
  };
}

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1', name: 'Local', color: 'green', enabled: true, order: 0,
    filter: {
      mode: 'structured', domains: ['api.example.com'],
      excludedDomains: [], resourceTypes: ['xmlhttprequest'],
    },
    tabLock: { enabled: false, tabId: null, tabTitle: null },
    headers: [header()],
    ...over,
  };
}

function state(over: Partial<AppState> = {}): AppState {
  return { version: 1, profiles: [profile()], globalPause: false, theme: 'system', ...over };
}

describe('compile', () => {
  it('emits exactly one rule per enabled profile', () => {
    const out = compile(state());
    expect(out.dynamic).toHaveLength(1);
    expect(out.session).toHaveLength(0);
  });

  it('batches every header of a profile into that one rule', () => {
    const p = profile({
      headers: [
        header({ id: 'a', name: 'Authorization', value: 'Bearer x' }),
        header({ id: 'b', name: 'X-Tenant-Id', value: 'musinsa-dev' }),
        header({ id: 'c', target: 'response', name: 'Cache-Control', value: 'no-store' }),
      ],
    });
    const out = compile(state({ profiles: [p] }));
    expect(out.dynamic).toHaveLength(1);
    expect(out.dynamic[0].action.requestHeaders).toHaveLength(2);
    expect(out.dynamic[0].action.responseHeaders).toHaveLength(1);
  });

  it('produces a complete, well-formed rule', () => {
    expect(compile(state()).dynamic[0]).toEqual({
      id: 1,
      priority: 1,
      condition: {
        requestDomains: ['api.example.com'],
        resourceTypes: ['xmlhttprequest'],
      },
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'X-Debug-Mode', operation: 'set', value: 'true' }],
      },
    });
  });

  it('routes a tab-locked profile into session with tabIds', () => {
    const p = profile({ tabLock: { enabled: true, tabId: 42, tabTitle: 'Checkout' } });
    const out = compile(state({ profiles: [p] }));
    expect(out.dynamic).toHaveLength(0);
    expect(out.session).toHaveLength(1);
    expect(out.session[0].condition.tabIds).toEqual([42]);
    expect(out.session[0].id).toBe(10_000);
  });

  it('skips a profile whose enabled headers compile to nothing', () => {
    const p = profile({ headers: [header({ enabled: false })] });
    expect(compile(state({ profiles: [p] })).dynamic).toHaveLength(0);
  });

  it('skips disabled profiles', () => {
    expect(compile(state({ profiles: [profile({ enabled: false })] })).dynamic).toHaveLength(0);
  });

  it('emits no rules at all when globalPause is on', () => {
    const out = compile(state({ globalPause: true }));
    expect(out.dynamic).toHaveLength(0);
    expect(out.session).toHaveLength(0);
  });

  it('still reports requiredOrigins while paused, so the UI stays informative', () => {
    expect(compile(state({ globalPause: true })).requiredOrigins)
      .toEqual(['*://*.api.example.com/*']);
  });

  it('collects requiredOrigins across profiles without duplicates', () => {
    const out = compile(state({
      profiles: [
        profile({ id: 'a', order: 0 }),
        profile({ id: 'b', order: 1 }),
      ],
    }));
    expect(out.requiredOrigins).toEqual(['*://*.api.example.com/*']);
  });

  it('gives the earlier profile the higher priority', () => {
    const out = compile(state({
      profiles: [
        profile({ id: 'a', order: 0 }),
        profile({ id: 'b', order: 1 }),
      ],
    }));
    expect(out.dynamic[0].priority).toBeGreaterThan(out.dynamic[1].priority);
  });

  it('returns an empty diagnostics array in phase 1', () => {
    expect(compile(state()).diagnostics).toEqual([]);
  });

  it('is pure — the same input yields a deeply equal result', () => {
    const s = state();
    expect(compile(s)).toEqual(compile(s));
  });

  it('does not mutate its input', () => {
    const s = state();
    const snapshot = structuredClone(s);
    compile(s);
    expect(s).toEqual(snapshot);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/compile.test.ts`
Expected: FAIL — cannot resolve `@/lib/compile/compile`.

- [ ] **Step 3: Write `lib/compile/compile.ts`**

```ts
import { compileHeaders } from '@/lib/compile/headers';
import { filterToCondition } from '@/lib/compile/conditions';
import { allocate } from '@/lib/compile/priority';
import { originsForFilter } from '@/lib/permissions/origins';
import type { AppState, CompileResult, Diagnostic, DnrRule } from '@/lib/model/types';

/**
 * Turns application state into declarativeNetRequest rules.
 *
 * Pure: imports nothing from chrome.*, performs no I/O, does not mutate its
 * input. One enabled profile compiles to exactly one rule — action.requestHeaders
 * and action.responseHeaders are arrays, so a profile's whole header set shares
 * a single rule and the 5,000 unsafe-dynamic-rule ceiling never binds.
 */
export function compile(state: AppState): CompileResult {
  const dynamic: DnrRule[] = [];
  const session: DnrRule[] = [];
  const diagnostics: Diagnostic[] = [];
  const origins = new Set<string>();

  const byId = new Map(state.profiles.map((p) => [p.id, p]));

  for (const profile of state.profiles) {
    if (!profile.enabled) continue;
    for (const origin of originsForFilter(profile.filter)) origins.add(origin);
  }

  // globalPause suppresses rules but not analysis: the user must still be able
  // to see problems with their configuration while paused.
  if (!state.globalPause) {
    for (const alloc of allocate(state.profiles)) {
      const profile = byId.get(alloc.profileId);
      if (!profile) continue;

      const action = compileHeaders(profile.headers);
      if (!action.requestHeaders && !action.responseHeaders) continue;

      const rule: DnrRule = {
        id: alloc.ruleId,
        priority: alloc.priority,
        condition: filterToCondition(
          profile.filter,
          alloc.scope === 'session' ? profile.tabLock.tabId : undefined,
        ),
        action: { type: 'modifyHeaders', ...action },
      };

      (alloc.scope === 'session' ? session : dynamic).push(rule);
    }
  }

  return { dynamic, session, diagnostics, requiredOrigins: [...origins] };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/compile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/compile/compile.ts tests/unit/compile.test.ts
git commit -m "feat: compile() 조립 — 상태를 DNR 룰로

프로필 하나 = 룰 하나 배칭으로 unsafe 동적 룰 상한 5000 을 비제약으로 만듦.
globalPause 는 룰만 비우고 분석은 그대로 수행."
```

---

## Task 9: Purity guard

A test that fails the build if the pure layer ever gains a browser dependency. Cheap insurance for the property the whole architecture rests on.

**Files:**
- Test: `tests/unit/purity.test.ts`

**Interfaces:**
- Consumes: the source files of `lib/compile/` and `lib/permissions/origins.ts`
- Produces: nothing

- [ ] **Step 1: Write the test**

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PURE_FILES = [
  ...readdirSync('lib/compile').filter((f) => f.endsWith('.ts')).map((f) => join('lib/compile', f)),
  'lib/permissions/origins.ts',
];

const FORBIDDEN = [
  /\bchrome\s*\./,
  /from\s+['"]webextension-polyfill['"]/,
  /from\s+['"]wxt\/browser['"]/,
  /from\s+['"]#imports['"]/,
  /from\s+['"]wxt\/utils\/storage['"]/,
];

/**
 * Removes block and line comments so the guard tests code rather than prose.
 *
 * Without this, a comment documenting the constraint — "imports nothing from
 * chrome.*" — trips the guard it is describing. The comment is good; forbidding
 * it would be wrong.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the pure layer stays pure', () => {
  it('finds the files it is supposed to guard', () => {
    expect(PURE_FILES.length).toBeGreaterThanOrEqual(5);
  });

  it.each(PURE_FILES)('%s has no browser dependency', (path) => {
    const source = stripComments(readFileSync(path, 'utf8'));
    for (const pattern of FORBIDDEN) {
      expect(source, `${path} matched ${pattern}`).not.toMatch(pattern);
    }
  });
});

describe('the guard itself', () => {
  it('ignores a browser name that appears only in a comment', () => {
    const source = stripComments(`
      /** Pure: imports nothing from chrome.*, performs no I/O. */
      // also not a real use: chrome.runtime
      export const x = 1;
    `);
    expect(source).not.toMatch(/\bchrome\s*\./);
  });

  it('still catches a real browser reference', () => {
    const source = stripComments(`export const id = chrome.runtime.id;`);
    expect(source).toMatch(/\bchrome\s*\./);
  });

  it('does not mistake a url inside a string for a line comment', () => {
    const source = stripComments(`export const u = 'https://example.com/a';`);
    expect(source).toContain('https://example.com/a');
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run tests/unit/purity.test.ts`
Expected: PASS — 5 guarded files plus the three self-tests of the guard.

If a guarded file fails on `/\bchrome\s*\./`, read the matched line before changing
anything. `lib/compile/compile.ts` legitimately mentions `chrome.*` in its header comment;
that is what `stripComments` exists for. A failure there means the stripper is broken, not
that the file is impure.

- [ ] **Step 3: Verify the guard actually catches a violation**

A guard that cannot fail is not a guard. Temporarily append to `lib/compile/compile.ts`:

```ts
// TEMPORARY — verifying the purity guard
export const broken = () => chrome.runtime.id;
```

Run: `npx vitest run tests/unit/purity.test.ts`
Expected: FAIL on `lib/compile/compile.ts`.

Now delete those two lines and re-run.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/purity.test.ts
git commit -m "test: 순수 층에 브라우저 의존이 새어들면 실패하는 가드

아키텍처 전체가 이 성질 위에 서 있으므로 회귀를 테스트로 막음."
```

---

## Task 10: Storage

**Files:**
- Create: `lib/model/schema.ts`
- Create: `lib/model/defaults.ts`
- Create: `lib/storage/state.ts`
- Test: `tests/unit/schema.test.ts`

**Interfaces:**
- Consumes: types from `lib/model/types.ts`
- Produces:
  - `appStateSchema` (Zod), `parseAppState(input: unknown): AppState`
  - `DEFAULT_STATE: AppState`, `createProfile(name: string, order: number): Profile`
  - `stateItem` — WXT storage item with `getValue()`, `setValue()`, `watch()`

- [ ] **Step 1: Write the failing test**

`tests/unit/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseAppState } from '@/lib/model/schema';
import { createProfile, DEFAULT_STATE } from '@/lib/model/defaults';

describe('parseAppState', () => {
  it('accepts the default state', () => {
    expect(parseAppState(DEFAULT_STATE)).toEqual(DEFAULT_STATE);
  });

  it('accepts a state carrying a profile', () => {
    const s = { ...DEFAULT_STATE, profiles: [createProfile('Local', 0)] };
    expect(parseAppState(s).profiles).toHaveLength(1);
  });

  it('rejects an unknown operation', () => {
    const p = createProfile('Local', 0);
    p.headers = [{
      id: 'h', enabled: true, target: 'request',
      operation: 'mutate' as never, name: 'X', value: '1',
    }];
    expect(() => parseAppState({ ...DEFAULT_STATE, profiles: [p] })).toThrow();
  });

  it('rejects an empty resourceTypes array — DNR rejects it too', () => {
    const p = createProfile('Local', 0);
    p.filter.resourceTypes = [];
    expect(() => parseAppState({ ...DEFAULT_STATE, profiles: [p] })).toThrow();
  });

  it('rejects a non-object', () => {
    expect(() => parseAppState(null)).toThrow();
    expect(() => parseAppState('{}')).toThrow();
  });

  it('strips unknown keys rather than failing — forward compatibility', () => {
    const parsed = parseAppState({ ...DEFAULT_STATE, futureField: 123 });
    expect(parsed).not.toHaveProperty('futureField');
  });
});

describe('createProfile', () => {
  it('produces a profile that parses', () => {
    const s = { ...DEFAULT_STATE, profiles: [createProfile('Staging', 1)] };
    expect(() => parseAppState(s)).not.toThrow();
  });

  it('assigns a unique id per call', () => {
    expect(createProfile('a', 0).id).not.toBe(createProfile('a', 0).id);
  });

  it('defaults resourceTypes to the three types a debugger actually uses', () => {
    expect(createProfile('a', 0).filter.resourceTypes)
      .toEqual(['xmlhttprequest', 'main_frame', 'sub_frame']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/schema.test.ts`
Expected: FAIL — cannot resolve `@/lib/model/schema`.

- [ ] **Step 3: Write `lib/model/schema.ts`**

```ts
import { z } from 'zod';
import type { AppState } from '@/lib/model/types';

const resourceType = z.enum([
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image',
  'font', 'object', 'xmlhttprequest', 'ping', 'csp_report',
  'media', 'websocket', 'webtransport', 'webbundle', 'other',
]);

const requestMethod = z.enum([
  'connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'other',
]);

const headerRuleSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  target: z.enum(['request', 'response']),
  operation: z.enum(['set', 'append', 'remove']),
  name: z.string(),
  value: z.string(),
  comment: z.string().optional(),
});

const filterSchema = z.object({
  mode: z.enum(['structured', 'regex']),
  domains: z.array(z.string()),
  excludedDomains: z.array(z.string()),
  pathPattern: z.string().optional(),
  regex: z.string().optional(),
  // DNR rejects an empty resourceTypes array outright.
  resourceTypes: z.array(resourceType).min(1),
  requestMethods: z.array(requestMethod).optional(),
});

const profileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  color: z.enum(['green', 'amber', 'red', 'blue', 'violet', 'cyan']),
  enabled: z.boolean(),
  order: z.number().int().nonnegative(),
  filter: filterSchema,
  tabLock: z.object({
    enabled: z.boolean(),
    tabId: z.number().int().nullable(),
    tabTitle: z.string().nullable(),
  }),
  headers: z.array(headerRuleSchema),
});

export const appStateSchema = z.object({
  version: z.number().int().positive(),
  profiles: z.array(profileSchema),
  globalPause: z.boolean(),
  theme: z.enum(['system', 'light', 'dark']),
});

/** Throws on invalid input. Used at every trust boundary, including JSON import. */
export function parseAppState(input: unknown): AppState {
  return appStateSchema.parse(input) as AppState;
}
```

- [ ] **Step 4: Write `lib/model/defaults.ts`**

```ts
import type { AppState, Profile, ProfileColor } from '@/lib/model/types';

const COLORS: ProfileColor[] = ['green', 'amber', 'red', 'blue', 'violet', 'cyan'];

export const STATE_VERSION = 1;

export function createProfile(name: string, order: number): Profile {
  return {
    id: crypto.randomUUID(),
    name,
    color: COLORS[order % COLORS.length],
    enabled: true,
    order,
    filter: {
      mode: 'structured',
      domains: [],
      excludedDomains: [],
      // Explicit by policy: DNR's default silently excludes main_frame.
      resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
    },
    tabLock: { enabled: false, tabId: null, tabTitle: null },
    headers: [],
  };
}

export const DEFAULT_STATE: AppState = {
  version: STATE_VERSION,
  profiles: [],
  globalPause: false,
  theme: 'system',
};
```

- [ ] **Step 5: Write `lib/storage/state.ts`**

```ts
import { storage } from '#imports';
import { DEFAULT_STATE, STATE_VERSION } from '@/lib/model/defaults';
import type { AppState } from '@/lib/model/types';

/**
 * The single source of truth. chrome.storage.local only — sync caps items at
 * 8KB, and this product's premise is that nothing leaves the machine.
 * Backup is explicit JSON export/import.
 *
 * Add a `migrations` entry keyed by the new version number when bumping
 * STATE_VERSION; WXT runs them automatically.
 */
export const stateItem = storage.defineItem<AppState>('local:state', {
  fallback: DEFAULT_STATE,
  version: STATE_VERSION,
});

export async function getState(): Promise<AppState> {
  return stateItem.getValue();
}

export async function setState(next: AppState): Promise<void> {
  await stateItem.setValue(next);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/unit/schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify the whole suite and the type check**

Run: `npm test && npm run compile`
Expected: all tests pass, `tsc --noEmit` exits 0.

- [ ] **Step 8: Commit**

```bash
git add lib/model/schema.ts lib/model/defaults.ts lib/storage/state.ts tests/unit/schema.test.ts
git commit -m "feat: Zod 스키마와 버전 관리되는 로컬 저장소

storage.local 만 사용. sync 는 항목당 8KB 제한이 있고 구글 서버를 경유하므로
'아무것도 나가지 않는다'는 전제와 어긋남."
```

---

## Task 11: ruleSync and the reconcile loop

**Files:**
- Create: `lib/sync/ruleSync.ts`
- Modify: `entrypoints/background.ts`
- Test: `tests/unit/ruleSync.test.ts`

**Interfaces:**
- Consumes: `compile` (Task 8), `getState` (Task 10), `DnrRule` (Task 2)
- Produces:
  - `syncRules(result: Pick<CompileResult, 'dynamic' | 'session'>): Promise<void>`
  - `reconcile(): Promise<void>`

- [ ] **Step 1: Write the failing test**

`fakeBrowser` defines `declarativeNetRequest` methods as **throwing stubs**, not as undefined — so they must be explicitly spied over, and `fakeBrowser.reset()` will not clean them up (it only resets namespaces exposing `resetState()`). Hence `vi.restoreAllMocks()`.

`tests/unit/ruleSync.test.ts`:

```ts
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncRules } from '@/lib/sync/ruleSync';
import type { DnrRule } from '@/lib/model/types';

const dnr = () => fakeBrowser.declarativeNetRequest;

function rule(id: number): DnrRule {
  return {
    id,
    priority: 1,
    condition: { requestDomains: ['api.example.com'], resourceTypes: ['xmlhttprequest'] },
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'X', operation: 'set', value: '1' }] },
  };
}

describe('syncRules', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.spyOn(dnr(), 'getDynamicRules').mockResolvedValue([]);
    vi.spyOn(dnr(), 'getSessionRules').mockResolvedValue([]);
    vi.spyOn(dnr(), 'updateDynamicRules').mockResolvedValue(undefined);
    vi.spyOn(dnr(), 'updateSessionRules').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes every existing rule and adds the new set in one call', async () => {
    vi.spyOn(dnr(), 'getDynamicRules').mockResolvedValue([{ id: 7 }, { id: 8 }] as never);

    await syncRules({ dynamic: [rule(1)], session: [] });

    expect(dnr().updateDynamicRules).toHaveBeenCalledTimes(1);
    expect(dnr().updateDynamicRules).toHaveBeenCalledWith({
      removeRuleIds: [7, 8],
      addRules: [rule(1)],
    });
  });

  it('updates the session ruleset independently', async () => {
    vi.spyOn(dnr(), 'getSessionRules').mockResolvedValue([{ id: 10_000 }] as never);

    await syncRules({ dynamic: [], session: [rule(10_001)] });

    expect(dnr().updateSessionRules).toHaveBeenCalledWith({
      removeRuleIds: [10_000],
      addRules: [rule(10_001)],
    });
  });

  it('clears both rulesets when compilation yields nothing', async () => {
    vi.spyOn(dnr(), 'getDynamicRules').mockResolvedValue([{ id: 1 }] as never);
    vi.spyOn(dnr(), 'getSessionRules').mockResolvedValue([{ id: 10_000 }] as never);

    await syncRules({ dynamic: [], session: [] });

    expect(dnr().updateDynamicRules).toHaveBeenCalledWith({ removeRuleIds: [1], addRules: [] });
    expect(dnr().updateSessionRules).toHaveBeenCalledWith({
      removeRuleIds: [10_000], addRules: [],
    });
  });

  it('propagates a failure instead of swallowing it — updates are transactional', async () => {
    vi.spyOn(dnr(), 'updateDynamicRules').mockRejectedValue(new Error('quota exceeded'));
    await expect(syncRules({ dynamic: [rule(1)], session: [] })).rejects.toThrow('quota exceeded');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/ruleSync.test.ts`
Expected: FAIL — cannot resolve `@/lib/sync/ruleSync`.

- [ ] **Step 3: Write `lib/sync/ruleSync.ts`**

```ts
import { browser } from 'wxt/browser';
import { compile } from '@/lib/compile/compile';
import { getState } from '@/lib/storage/state';
import type { CompileResult, DnrRule } from '@/lib/model/types';

/**
 * The only module permitted to call chrome.declarativeNetRequest.
 *
 * It makes no decisions: it replaces whatever is registered with whatever it is
 * handed. updateDynamicRules/updateSessionRules remove before they add and are
 * fully transactional, so a failure leaves the previous rules intact rather
 * than a half-applied set.
 */
async function replace(
  scope: 'dynamic' | 'session',
  rules: DnrRule[],
): Promise<void> {
  const dnr = browser.declarativeNetRequest;
  const existing =
    scope === 'dynamic' ? await dnr.getDynamicRules() : await dnr.getSessionRules();

  // Our DnrRule is structurally identical to Chrome's Rule but nominally
  // separate, so lib/compile/ can stay free of browser types (see Task 2).
  // This boundary is the one place the two meet, and the one place the cast
  // belongs.
  const update = {
    removeRuleIds: existing.map((r) => r.id),
    addRules: rules as unknown as chrome.declarativeNetRequest.Rule[],
  };

  if (scope === 'dynamic') {
    await dnr.updateDynamicRules(update);
  } else {
    await dnr.updateSessionRules(update);
  }
}

export async function syncRules(
  result: Pick<CompileResult, 'dynamic' | 'session'>,
): Promise<void> {
  await replace('dynamic', result.dynamic);
  await replace('session', result.session);
}

/**
 * The single entry point every trigger funnels into: recompile from storage and
 * replace everything. Idempotent, so there is nowhere for state drift to hide.
 */
export async function reconcile(): Promise<void> {
  const state = await getState();
  await syncRules(compile(state));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/ruleSync.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the background service worker**

`entrypoints/background.ts`:

```ts
import { browser } from 'wxt/browser';
import { stateItem } from '@/lib/storage/state';
import { reconcile } from '@/lib/sync/ruleSync';

export default defineBackground(() => {
  const run = () => {
    reconcile().catch((error) => {
      console.error('[HeaderLab] reconcile failed', error);
    });
  };

  // Every trigger funnels into the same idempotent reconcile.
  run();
  browser.runtime.onStartup.addListener(run);
  browser.runtime.onInstalled.addListener(run);
  browser.permissions.onAdded.addListener(run);
  browser.permissions.onRemoved.addListener(run);
  stateItem.watch(run);
});
```

- [ ] **Step 6: Verify the build and the full suite**

Run: `npm test && npm run compile && npm run build`
Expected: all green, `.output/chrome-mv3/` rebuilt.

- [ ] **Step 7: Commit**

```bash
git add lib/sync/ruleSync.ts entrypoints/background.ts tests/unit/ruleSync.test.ts
git commit -m "feat: ruleSync 어댑터와 단일 reconcile 루프

DNR 을 호출하는 유일한 파일. 판단은 하지 않고 통째로 교체만 함.
저장소 변경 · SW 기동 · 권한 변경이 모두 같은 멱등 함수로 모임."
```

---

## Task 12: Minimal popup

Enough UI to create a profile and one header, and to see it take effect. The full Data Grid lands in Phase 2 — this is deliberately plain.

**Files:**
- Modify: `entrypoints/popup/App.tsx`
- Create: `lib/storage/useAppState.ts`

**Interfaces:**
- Consumes: `stateItem`, `getState`, `setState` (Task 10), `createProfile` (Task 10)
- Produces: `useAppState(): { state: AppState | null; update(fn: (draft: AppState) => AppState): void }`

- [ ] **Step 1: Write the state hook**

`lib/storage/useAppState.ts`:

```tsx
import { useEffect, useState } from 'react';
import { getState, setState, stateItem } from '@/lib/storage/state';
import type { AppState } from '@/lib/model/types';

export function useAppState() {
  const [state, setLocal] = useState<AppState | null>(null);

  useEffect(() => {
    getState().then(setLocal);
    return stateItem.watch((next) => setLocal(next));
  }, []);

  const update = (fn: (draft: AppState) => AppState) => {
    setLocal((current) => {
      if (!current) return current;
      const next = fn(current);
      void setState(next);
      return next;
    });
  };

  return { state, update };
}
```

- [ ] **Step 2: Add the shadcn components the popup uses**

```bash
npx shadcn@4.16.0 add button input switch --yes
```

Verify: `ls components/ui/`
Expected: `button.tsx`, `input.tsx`, `switch.tsx` — inside the project, not above it.

- [ ] **Step 3: Write the popup**

`entrypoints/popup/App.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { createProfile } from '@/lib/model/defaults';
import { useAppState } from '@/lib/storage/useAppState';
import type { HeaderRule } from '@/lib/model/types';

export default function App() {
  const { state, update } = useAppState();
  if (!state) return <div className="w-[560px] p-4 text-sm">Loading…</div>;

  // `noUncheckedIndexedAccess` is on, so this is `Profile | undefined`.
  const profile = state.profiles[0];

  const addProfile = () =>
    update((s) => ({ ...s, profiles: [createProfile('Local', 0)] }));

  // Typed against `Profile`, not `typeof profile` — the latter would carry the
  // `undefined` and make `map` produce `(Profile | undefined)[]`, which does not
  // assign back to `profiles`. The `if (!profile)` guard below is too late to help:
  // it narrows the render branch, not this closure.
  const patchProfile = (fn: (p: Profile) => Profile) =>
    update((s) => ({ ...s, profiles: s.profiles.map((p, i) => (i === 0 ? fn(p) : p)) }));

  const addHeader = () =>
    patchProfile((p) => ({
      ...p,
      headers: [
        ...p.headers,
        {
          id: crypto.randomUUID(),
          enabled: true,
          target: 'request',
          operation: 'set',
          name: '',
          value: '',
        } satisfies HeaderRule,
      ],
    }));

  const patchHeader = (id: string, patch: Partial<HeaderRule>) =>
    patchProfile((p) => ({
      ...p,
      headers: p.headers.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    }));

  if (!profile) {
    return (
      <div className="w-[560px] space-y-3 p-4">
        <p className="text-sm text-muted-foreground">No profile yet.</p>
        <Button onClick={addProfile}>Create profile</Button>
      </div>
    );
  }

  return (
    <div className="w-[560px] space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Switch
          checked={profile.enabled}
          onCheckedChange={(enabled) => patchProfile((p) => ({ ...p, enabled }))}
        />
        <span className="text-sm font-medium">{profile.name}</span>
      </div>

      <Input
        placeholder="Domain, e.g. api.example.com"
        value={profile.filter.domains.join(', ')}
        onChange={(e) =>
          patchProfile((p) => ({
            ...p,
            filter: {
              ...p.filter,
              domains: e.target.value.split(',').map((d) => d.trim()).filter(Boolean),
            },
          }))
        }
      />

      {profile.headers.map((header) => (
        <div key={header.id} className="flex items-center gap-2">
          <Switch
            checked={header.enabled}
            onCheckedChange={(enabled) => patchHeader(header.id, { enabled })}
          />
          <Input
            className="flex-1"
            placeholder="Header name"
            value={header.name}
            onChange={(e) => patchHeader(header.id, { name: e.target.value })}
          />
          <Input
            className="flex-1 font-mono"
            placeholder="Value"
            value={header.value}
            onChange={(e) => patchHeader(header.id, { value: e.target.value })}
          />
        </div>
      ))}

      <Button variant="secondary" onClick={addHeader}>
        Add header
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Load the extension and verify by hand**

```bash
npm run build
```

Open `chrome://extensions`, enable Developer mode, "Load unpacked", select `.output/chrome-mv3`.
Click the HeaderLab toolbar icon.
Expected: the popup renders, "Create profile" works, a domain and a header row can be entered, and the values survive closing and reopening the popup.

Check the service worker console (chrome://extensions → "service worker"): no `reconcile failed` errors.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/popup/App.tsx lib/storage/useAppState.ts components/ui package.json
git commit -m "feat: 최소 팝업 — 프로필과 헤더 편집

Phase 2 의 Data Grid 이전 단계. 걷는 뼈대를 사람이 손으로 확인할 수 있게 함."
```

---

## Task 13: Echo-server E2E — proof a header actually changed

The only layer that proves the real thing. `getMatchedRules` and `testMatchOutcome` are rule-matching oracles whose return types contain no header data, and Playwright's `request.headers()` omits security-related headers. A local server that records what it received is downstream of the mutation, which is what makes it ground truth.

**Files:**
- Create: `tests/e2e/echo-server.ts`
- Create: `tests/e2e/fixtures.ts`
- Create: `tests/e2e/header-modification.spec.ts`
- Create: `playwright.config.ts`

**Interfaces:**
- Consumes: the `e2e`-mode build from Task 1
- Produces: `startEchoServer(): Promise<EchoServer>`, the Playwright `test`/`expect` fixtures

- [ ] **Step 1: Install Playwright**

```bash
npm i -D @playwright/test@1.62.0
npx playwright install --with-deps --no-shell chromium
```

`--no-shell` matters: the default headless build is `chromium-headless-shell`, a separate build that must not be used for extension tests.

- [ ] **Step 2: Write the echo server**

`tests/e2e/echo-server.ts`:

```ts
import { createServer, type IncomingHttpHeaders } from 'node:http';

export interface RecordedRequest {
  url: string;
  headers: IncomingHttpHeaders;
}

export interface EchoServer {
  origin: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

/** Binds to an ephemeral loopback port and records every request it receives. */
export async function startEchoServer(): Promise<EchoServer> {
  const requests: RecordedRequest[] = [];

  const server = createServer((req, res) => {
    requests.push({ url: req.url ?? '', headers: { ...req.headers } });
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>echo</title><body>echo</body>');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('echo server did not bind to a port');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
```

- [ ] **Step 3: Write the Playwright fixtures**

`channel: 'chromium'` is required. Chrome and Edge removed the command-line flags needed to side-load extensions, so `channel: 'chrome'` silently loads nothing; the bundled Chromium supports extensions in headless mode.

`tests/e2e/fixtures.ts`:

```ts
import path from 'node:path';
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';

const EXTENSION_PATH = path.resolve('.output/chrome-mv3');

export const test = base.extend<{
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
    await use(context);
    await context.close();
  },

  // Exposed as a fixture so tests never re-derive it — `context.serviceWorkers()[0]`
  // is `Worker | undefined` under `noUncheckedIndexedAccess`, and narrowing it once
  // here beats a non-null assertion in every test.
  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const id = serviceWorker.url().split('/')[2];
    if (!id) {
      throw new Error(`could not derive extension id from ${serviceWorker.url()}`);
    }
    await use(id);
  },
});

export const expect = test.expect;
```

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
});
```

- [ ] **Step 4: Write the failing test**

State is seeded directly into storage rather than driven through the popup, so this proves the compile → sync → DNR chain independently of any UI. `resourceTypes` is explicit: omitting it excludes `main_frame`, so a `page.goto()` would never match.

`tests/e2e/header-modification.spec.ts`:

```ts
import { expect, test } from './fixtures';
import { startEchoServer, type EchoServer } from './echo-server';

let echo: EchoServer;

test.beforeEach(async () => {
  echo = await startEchoServer();
});

test.afterEach(async () => {
  await echo.close();
});

test('a configured set rule reaches the wire', async ({ context, serviceWorker }) => {
  const worker = serviceWorker;

  await worker.evaluate(async (state) => {
    // `local:state` maps to the chrome.storage.local key `state`. WXT keeps the
    // item's version alongside it at `state$`; seed both so the versioned item
    // is not read as un-versioned. See the troubleshooting note below if the
    // rule count never reaches 1.
    await chrome.storage.local.set({ state, state$: { v: 1 } });
  }, {
    version: 1,
    globalPause: false,
    theme: 'system',
    profiles: [{
      id: 'p1',
      name: 'E2E',
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
      tabLock: { enabled: false, tabId: null, tabTitle: null },
      headers: [
        { id: 'h1', enabled: true, target: 'request',
          operation: 'set', name: 'X-Headerlab-Test', value: 'applied' },
        { id: 'h2', enabled: false, target: 'request',
          operation: 'set', name: 'X-Headerlab-Disabled', value: 'nope' },
      ],
    }],
  });

  // Wait for the storage watcher to drive reconcile to completion.
  await expect
    .poll(async () => (await worker.evaluate(() =>
      chrome.declarativeNetRequest.getDynamicRules().then((r) => r.length),
    )), { timeout: 10_000 })
    .toBe(1);

  const page = await context.newPage();
  await page.goto(`${echo.origin}/probe`);

  const probe = echo.requests.find((r) => r.url === '/probe');
  expect(probe, 'echo server received the navigation').toBeTruthy();
  expect(probe!.headers['x-headerlab-test']).toBe('applied');
  expect(probe!.headers['x-headerlab-disabled']).toBeUndefined();

  await page.close();
});

test('a remove rule strips a header the page would otherwise send', async ({
  context,
  serviceWorker,
}) => {
  const worker = serviceWorker;

  await worker.evaluate(async (state) => {
    // `local:state` maps to the chrome.storage.local key `state`. WXT keeps the
    // item's version alongside it at `state$`; seed both so the versioned item
    // is not read as un-versioned. See the troubleshooting note below if the
    // rule count never reaches 1.
    await chrome.storage.local.set({ state, state$: { v: 1 } });
  }, {
    version: 1,
    globalPause: false,
    theme: 'system',
    profiles: [{
      id: 'p1', name: 'E2E', color: 'green', enabled: true, order: 0,
      filter: {
        mode: 'structured', domains: ['127.0.0.1'], excludedDomains: [],
        resourceTypes: ['xmlhttprequest'],
      },
      tabLock: { enabled: false, tabId: null, tabTitle: null },
      headers: [
        { id: 'h1', enabled: true, target: 'request',
          operation: 'remove', name: 'X-Remove-Me', value: '' },
      ],
    }],
  });

  await expect
    .poll(async () => (await worker.evaluate(() =>
      chrome.declarativeNetRequest.getDynamicRules().then((r) => r.length),
    )), { timeout: 10_000 })
    .toBe(1);

  const page = await context.newPage();
  await page.goto(`${echo.origin}/host`);
  await page.evaluate(async (origin) => {
    await fetch(`${origin}/xhr`, { headers: { 'X-Remove-Me': 'should-be-gone' } });
  }, echo.origin);

  await expect.poll(() => echo.requests.some((r) => r.url === '/xhr')).toBe(true);

  const xhr = echo.requests.find((r) => r.url === '/xhr')!;
  expect(xhr.headers['x-remove-me']).toBeUndefined();

  await page.close();
});
```

**Troubleshooting the seed.** If the `getDynamicRules().length` poll times out at 0, the
storage seed did not reach `reconcile()`. Check in this order, from the service worker
console at `chrome://extensions`:

1. `await chrome.storage.local.get(null)` — confirm the keys you wrote are present and that
   the metadata key is spelled the way WXT expects. If WXT writes something other than
   `state$`, match whatever it actually wrote and update the seed.
2. If the metadata shape is the problem, drop `version` from `stateItem` in
   `lib/storage/state.ts` for the duration of Phase 1 — nothing is being migrated yet — and
   seed `state` alone. Restore it when Phase 2 introduces the first migration.
3. If storage is correct but no rule appears, the `stateItem.watch` listener in
   `entrypoints/background.ts` is not firing. Confirm the worker is alive; MV3 workers
   suspend after roughly 30 seconds, and Playwright keeps the same `Worker` handle across
   restarts, so a stale-looking handle is not the cause.

- [ ] **Step 5: Run the test to verify it fails**

The extension has not been built in `e2e` mode yet, so it lacks the loopback host permission and the rules will not apply.

Run: `npm run build && npx playwright test`
Expected: FAIL — `x-headerlab-test` is `undefined`.

This failure is informative: it is exactly what a user hits when host permission is missing. The rules register successfully and are silently not applied.

- [ ] **Step 6: Build in e2e mode and re-run**

Run: `npm run build:e2e && npx playwright test`
Expected: PASS — both tests green.

- [ ] **Step 7: Add the test script**

Add to `package.json` scripts: `"test:e2e": "wxt build --mode e2e && playwright test"`.

Run: `npm run test:e2e`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tests/e2e playwright.config.ts package.json
git commit -m "test: 로컬 에코 서버로 헤더 변경을 실제 바이트 수준에서 증명

getMatchedRules 도 testMatchOutcome 도 Playwright 의 request.headers() 도
헤더 변경을 확인해 주지 못함. 서버 측 관측만이 변경 이후 시점의 정답.

e2e 모드 빌드에만 루프백 호스트 권한을 추가 — 배포 빌드에는 들어가지 않음."
```

---

## Task 14: Phase 1 close-out

**Files:**
- Create: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: everything
- Produces: a documented, verifiable Phase 1 deliverable

- [ ] **Step 1: Write `README.md`**

```markdown
# HeaderLab

Add, modify and remove HTTP request and response headers. Chrome and Edge.

A replacement for ModHeader, which was removed from both stores in July 2026
after a hidden tracker was found in it.

## Trust posture

- **No network calls.** No analytics, telemetry, remote config, or update pings.
- **No content scripts.** Nothing is injected into any page.
- **No host permissions at install.** Site access is granted by you, per site or
  all at once, and can be revoked at any time.
- **No external resources.** No CDN, no web fonts.

## Development

```bash
npm install
npm run dev          # load .output/chrome-mv3 as an unpacked extension
npm test             # unit tests, no browser required
npm run test:e2e     # end-to-end, proves headers change on the wire
npm run compile      # type check
npm run build        # production build
```

## Architecture

All correctness lives in a pure layer that never imports `chrome.*`:

- `lib/compile/` — application state to declarativeNetRequest rules
- `lib/permissions/origins.ts` — filters to origin patterns

One thin adapter, `lib/sync/ruleSync.ts`, is the only module that calls
`chrome.declarativeNetRequest`. A single `reconcile()` in the background service
worker recompiles from storage and replaces every rule atomically; storage
changes, worker startup, and permission changes all funnel into it.

This shape is forced rather than chosen: `@webext-core/fake-browser` does not
implement `declarativeNetRequest`, so browser-imitation testing is unavailable.
Making the browser irrelevant to the logic is the response.

See `docs/superpowers/specs/` for the design and `docs/research/` for the
verified platform constraints behind it.

## Status

Phase 1 (walking skeleton) complete: rules compile, sync, and demonstrably
modify real headers. Diagnostics, permission UX, the full Data Grid UI, themes,
and tab lock are Phase 2.
```

- [ ] **Step 2: Run the full verification**

Run each and confirm the expected result before proceeding:

```bash
npm run compile     # exits 0
npm test            # all unit suites pass
npm run test:e2e    # both e2e tests pass
npm run build       # exits 0
```

- [ ] **Step 3: Confirm the shipped manifest has no host permissions**

Run: `npx wxt build && cat .output/chrome-mv3/manifest.json`
Expected: `optional_host_permissions` is present; **`host_permissions` is absent.**
If `host_permissions` appears, the e2e-mode branch leaked into the production build — fix `wxt.config.ts` before committing.

- [ ] **Step 4: Commit**

```bash
git add README.md package.json
git commit -m "docs: Phase 1 README 및 마무리

걷는 뼈대 완료 — 룰이 컴파일되고 동기화되며 실제 헤더를 바꾸는 것이 증명됨."
```

---

## Phase 2 preview — not in this plan

For sequencing context only. Each becomes its own plan.

**Phase 2 — the product.** `lib/compile/validate.ts` (the 21-header append allowlist and
header-name validity) together with its callers · the eight diagnostic kinds and their inline UI treatment · the permission audit (§5.4 candidate-order rule) and grant flows · the full Data Grid popup in both themes, built from `docs/design/popup-dark.html` and `popup-light.html` · tab lock including session-rule rebuild on worker startup · global pause · JSON export/import.

**Phase 3 — hardening.** `testMatchOutcome` integration tests covering the URL-pattern × resource-type × initiator × method matrix · the `check-no-network.ts` CI guard · resolution of the two open questions in spec §11.7 and §11.8 · an Edge run of the E2E suite.
