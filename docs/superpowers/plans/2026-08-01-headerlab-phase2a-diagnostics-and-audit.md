# HeaderLab Phase 2a 구현 계획 — 진단과 권한 감사

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설계 §7 의 진단 8종과 §5.4 의 권한 감사를 완성해, Phase 2b 의 Data Grid 가 렌더할 데이터를 만든다. **UI 는 만들지 않는다.**

**Architecture:** Phase 1 이 세운 경계를 그대로 확장한다 — 판정은 브라우저를 임포트하지 않는 순수 층에, 브라우저 호출은 얇은 어댑터 하나에. `@webext-core/fake-browser` 가 `declarativeNetRequest` 에 이어 `permissions.*` 도 던지는 스텁으로 정의하므로(실측 §5) 이 분리는 선택이 아니라 강제다. 진단은 `compile()` 의 `CompileResult.diagnostics` 로 나오고, 비동기인 `permission-missing` 만 어댑터가 채운다.

**Tech Stack:** 기존과 동일. 새 런타임 의존성 없음.

**근거 문서:**
- 설계: [`../specs/2026-07-31-headerlab-design.md`](../specs/2026-07-31-headerlab-design.md) — §5.4 권한 감사 · §7 진단
- 인수인계: [`../specs/2026-08-01-phase1-handoff.md`](../specs/2026-08-01-phase1-handoff.md)
- **실측: [`../../research/2026-08-01-permission-audit-spike.md`](../../research/2026-08-01-permission-audit-spike.md)** — 이 계획이 설계 §5.4 를 정정하는 근거
- 플랫폼 조사: [`../../research/2026-07-31-technical-constraints.md`](../../research/2026-07-31-technical-constraints.md) — §1.4 append 허용목록

---

## Global Constraints

이 절은 모든 태스크의 요구사항에 암묵적으로 포함된다.

**설계 §5.4 를 두 곳에서 정정한다.** 실측이 근거이며, 정정의 목적은 §5.4 자신이 명시한 목적("배지가 거짓 양성을 내면 기능의 존재 이유가 사라진다")과 같다.

1. **후보 사다리는 4단이 아니라 6단이다.** `http://` 단이 없으면 `http://127.0.0.1/*` 를 부여한 상태에서 네 후보가 전부 false 가 되어 거짓 양성이 난다. 이 저장소의 e2e 빌드 자신이 그 설정이다.
2. **감사는 후보를 한 번에 하나씩 검사하고 각각을 개별적으로 `catch` 한다.** `permissions.contains()` 는 유효하지 않은 패턴에 예외를 던지며, 배치하면 함께 넘긴 유효 항목까지 죽는다.

**도메인은 거부하지 않고 정규화한다.** DNR 의 `requestDomains` 는 호스트 전용이라 포트를 표현할 수 없고, 호스트가 매칭되면 포트와 무관하게 매칭된다. `localhost:3000` 을 거부하면 이 도구의 가장 흔한 입력이 막힌다. 포트를 벗기고 진단으로 알린다.

**fail-open 비대칭 (인수인계 §3.2).** 헤더는 행 단위로 건너뛴다(fail-closed, 안전). **도메인은 프로필 단위로 억제한다** — 유일한 도메인을 건너뛰면 조건 없는 룰이 되고 DNR 에서 그것은 **모든 사이트에 매칭**된다. 대칭 수정은 이 중 정확히 하나에서 틀린다.

**순수 층은 브라우저를 임포트하지 않는다.** `tests/unit/purity.test.ts` 가 강제한다. 가드는 `lib/compile/*.ts` 를 `readdirSync` 로 자동 발견하지만 `lib/permissions/` 아래는 `origins.ts` 만 명시 목록으로 덮는다. **`lib/permissions/` 에 순수 파일을 추가하면 반드시 `PURE_FILES` 에 넣는다** — 넣지 않으면 가드가 조용히 비껴간다.

**블라스트 반경을 갖는 표면.** 잘못된 항목 하나가 자기 행이 아니라 전체를 죽이는 곳(실측 §4):

| 표면 | 결과 |
|---|---|
| `updateDynamicRules` — 헤더명 RFC 토큰 위반 | 배치 전체 무효 |
| `updateDynamicRules` — 허용목록 밖 요청 헤더 `append` | 배치 전체 무효 |
| `permissions.contains()` — 유효하지 않은 매치 패턴 | 호출 전체 예외 |
| `updateDynamicRules` — 이상한 `requestDomains` | 없음 (조용히 등록, 미매칭) |

**환경 사실 (Phase 1 의 계획 오류 10건이 전부 이 범주였다):**
- WXT 스토리지는 `#imports` 에서 임포트한다. `wxt/storage` 는 컴파일되지 않는다. 모든 키에 영역 접두어(`local:` / `session:`)가 필요하다.
- `chrome` 전역 네임스페이스는 타입이 해석되지 않는다(TS2503). `Browser` 타입은 `wxt/browser` 에서 가져온다.
- `tsconfig` 에 `noUncheckedIndexedAccess: true`. 인덱스 접근은 전부 `T | undefined` 다.
- `baseUrl` 은 하드 에러다. 경로 별칭은 `paths` 만으로 선언돼 있다.
- `npm test` 는 `wxt build && vitest run` 이다. `pretest` 훅은 `ignore-scripts=true` 때문에 **조용히 실행되지 않는다.**
- vitest 플러그인 경로는 `wxt/testing/vitest-plugin` 이다. `wxt/testing` 배럴은 없다.

**npm 레지스트리 72시간 격리.** 최근 3일 내 발행 패키지는 `ETARGET` 이다. **우회 금지** — 프로젝트 `.npmrc` 로 `before` 를 덮지 않고, `--force` 를 쓰지 않고, 레지스트리를 바꾸지 않는다. 회사 보안 통제다. **`npm audit fix` 를 실행하지 않는다** — 핀과 싸운다.

**E2E 를 약화시키지 않는다.** `tests/e2e/header-modification.spec.ts` 의 헤더 변경 단언이 "헤더가 실제로 바뀐다"에 답하는 유일한 층이다. 이 계획은 그 파일을 건드리지 않는다.

**커밋 형식:** `<type>: <description>` (feat, fix, refactor, docs, test, chore, perf, ci)

---

## 파일 구조

| 파일 | 책임 | 순수? |
|---|---|---|
| `lib/permissions/origins.ts` (수정) | 도메인 정규화·유효성·후보 사다리·요청 패턴 | 순수 (가드 목록에 이미 있음) |
| `lib/compile/validate.ts` (신규) | 헤더 진단 3종 + append 허용목록 | 순수 (자동 발견) |
| `lib/compile/filterDiagnostics.ts` (신규) | 필터 진단 3종 | 순수 (자동 발견) |
| `lib/compile/conflicts.ts` (신규) | 프로필 간 충돌 탐지 | 순수 (자동 발견) |
| `lib/compile/compile.ts` (수정) | 위 셋을 `CompileResult.diagnostics` 로 통합 | 순수 |
| `lib/compile/conditions.ts` (수정) | `excludedRequestDomains` 정규화 | 순수 |
| `lib/permissions/audit.ts` (신규) | 후보 결과 → `permission-missing` 진단 | **순수 — `PURE_FILES` 에 추가 필수** |
| `lib/permissions/probe.ts` (신규) | `permissions.contains()` 를 부르는 유일한 파일 | 어댑터 |
| `lib/storage/session.ts` (신규) | 재조정 실패 메시지 세션 저장 | 어댑터 |
| `lib/storage/useAppState.ts` (수정) | 전체 덮어쓰기 → 부분 갱신 | 어댑터 |
| `entrypoints/background.ts` (수정) | 실패를 세션 저장소에 기록 | 어댑터 |
| `wxt.config.ts` (수정) | `activeTab` 재도입 | — |

---

### Task 1: `origins.ts` — 포트 정규화와 6단 사다리

설계 §5.4 를 실측에 맞춰 정정한다. 이 태스크가 뒤의 모든 권한 작업의 토대다.

**Files:**
- Modify: `lib/permissions/origins.ts`
- Test: `tests/unit/origins.test.ts`

**Interfaces:**
- Consumes: `Filter` (`lib/model/types.ts`)
- Produces:
  ```ts
  export interface DomainAnalysis {
    host: string;          // 정규화된 베어 호스트
    portDropped: boolean;  // 입력에 포트가 있었고 벗겨냈다
    valid: boolean;        // 이 호스트를 룰과 패턴에 쓸 수 있다
  }
  export function analyzeDomain(domain: string): DomainAnalysis;
  export function normalizeDomain(domain: string): string;   // 기존 시그니처 유지
  export function isValidDomain(domain: string): boolean;    // 기존 시그니처 유지
  export function originCandidates(domain: string): string[]; // 4개 → 6개
  export function requestPattern(domain: string): string;    // 변경 없음
  export function originsForFilter(filter: Filter): string[]; // 변경 없음
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/origins.test.ts` 의 기존 `describe` 블록들은 그대로 두고 파일 끝에 추가한다:

```ts
import { analyzeDomain } from '@/lib/permissions/origins';

describe('analyzeDomain', () => {
  it('strips a trailing port and says so', () => {
    expect(analyzeDomain('localhost:3000')).toEqual({
      host: 'localhost',
      portDropped: true,
      valid: true,
    });
  });

  it('leaves a plain host untouched', () => {
    expect(analyzeDomain('api.example.com')).toEqual({
      host: 'api.example.com',
      portDropped: false,
      valid: true,
    });
  });

  it('keeps stripping the leading wildcard and dot, as before', () => {
    expect(analyzeDomain('*.Example.COM').host).toBe('example.com');
    expect(analyzeDomain('.example.com').host).toBe('example.com');
  });

  it('drops a trailing dot — the same host, spelled as an FQDN', () => {
    expect(analyzeDomain('example.com.').host).toBe('example.com');
  });

  it('does not mistake a version-like suffix for a port', () => {
    // Only a trailing :digits is a port. An embedded scheme ends in letters.
    expect(analyzeDomain('https://example.com').portDropped).toBe(false);
  });

  it('rejects an embedded scheme — permissions.contains() throws on it', () => {
    expect(analyzeDomain('https://example.com').valid).toBe(false);
  });

  it('rejects internal whitespace — DNR registers it and it never matches', () => {
    expect(analyzeDomain('a b.com').valid).toBe(false);
  });

  it('rejects a path segment', () => {
    expect(analyzeDomain('example.com/api').valid).toBe(false);
  });

  it('rejects an empty host', () => {
    expect(analyzeDomain('   ').valid).toBe(false);
    expect(analyzeDomain('*.').valid).toBe(false);
  });

  it('still rejects non-ASCII — DNR rejects it in requestDomains', () => {
    expect(analyzeDomain('도메인.kr').valid).toBe(false);
  });

  it('accepts an IPv4 literal', () => {
    expect(analyzeDomain('127.0.0.1')).toEqual({
      host: '127.0.0.1',
      portDropped: false,
      valid: true,
    });
  });
});

describe('originCandidates — narrowest to broadest, both schemes', () => {
  it('offers six candidates in narrowest-first order', () => {
    expect(originCandidates('example.com')).toEqual([
      'https://example.com/*',
      'http://example.com/*',
      'https://*.example.com/*',
      'http://*.example.com/*',
      '*://example.com/*',
      '*://*.example.com/*',
    ]);
  });

  it('includes an http rung — this is the loopback regression', () => {
    // Measured: with http://127.0.0.1/* granted, every https-only candidate
    // returns false, because contains() is a subset check and *:// demands
    // both schemes. Without this rung the audit shows a false "grant needed"
    // badge on the single most common local-development setup — and on this
    // repository's own e2e build.
    expect(originCandidates('127.0.0.1')).toContain('http://127.0.0.1/*');
  });

  it('normalizes before building candidates', () => {
    expect(originCandidates('localhost:3000')[0]).toBe('https://localhost/*');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

```
npx vitest run tests/unit/origins.test.ts
```
기대: `analyzeDomain` 임포트 실패, `originCandidates` 는 4개만 반환해 불일치.

- [ ] **Step 3: 구현한다**

`lib/permissions/origins.ts` 를 다음으로 **전체 교체**한다:

```ts
import type { Filter } from '@/lib/model/types';

const ASCII_ONLY = /^[\x00-\x7F]+$/;

/**
 * Characters that make a host unusable, measured rather than assumed:
 *
 * - `:` and `/` make `permissions.contains()` **throw**, which kills the whole
 *   audit call — not just the candidate carrying them.
 * - whitespace is accepted by both DNR and contains(), and then never matches
 *   anything. A silently dead rule is worse than a rejected one.
 *
 * A trailing `:digits` is handled before this test runs — that is a port, and
 * ports are normalized away rather than rejected.
 */
const HOST_FORBIDDEN = /[\s/:?#@\\]/;

/**
 * Only a trailing colon followed by digits is a port. An embedded scheme ends
 * in letters, so `https://example.com` is not mistaken for one.
 *
 * A bracketed IPv6 literal (`[::1]`) matches neither this nor the host shape
 * below, so it is reported invalid. That is deliberate for now: Chrome match
 * patterns and `requestDomains` both treat IPv6 as an edge case, and no
 * measurement backs a specific handling yet.
 */
const TRAILING_PORT = /^(.+):(\d{1,5})$/;

export interface DomainAnalysis {
  /** Normalized bare host: trimmed, lowercased, no leading `*.`/`.`, no port. */
  host: string;
  /** The input carried a port and it was dropped. */
  portDropped: boolean;
  /** The host can be used in a DNR condition and in a match pattern. */
  valid: boolean;
}

/**
 * Normalizes a user-entered domain and reports what had to be changed.
 *
 * Ports are **normalized away, not rejected.** `requestDomains` is host-only —
 * it cannot express a port, and a host match applies on every port. Rejecting
 * `localhost:3000` would block the most common input this tool receives; the
 * caller raises a `port-ignored` diagnostic so the change is never silent.
 */
export function analyzeDomain(domain: string): DomainAnalysis {
  let d = domain.trim().toLowerCase();
  if (d.startsWith('*.')) d = d.slice(2);
  if (d.startsWith('.')) d = d.slice(1);

  let portDropped = false;
  const withPort = TRAILING_PORT.exec(d);
  // `noUncheckedIndexedAccess` makes the capture `string | undefined`.
  const host = withPort?.[1];
  if (host !== undefined) {
    d = host;
    portDropped = true;
  }

  // `example.com.` and `example.com` are the same host spelled two ways.
  if (d.endsWith('.')) d = d.slice(0, -1);

  const valid = d.length > 0 && ASCII_ONLY.test(d) && !HOST_FORBIDDEN.test(d);
  return { host: d, portDropped, valid };
}

/**
 * Exported so lib/compile/conditions.ts normalizes the same way this module
 * does — otherwise the same user string becomes a different value in the
 * permission audit than in the compiled rule condition.
 */
export function normalizeDomain(domain: string): string {
  return analyzeDomain(domain).host;
}

export function isValidDomain(domain: string): boolean {
  return analyzeDomain(domain).valid;
}

/**
 * Match patterns to test with permissions.contains(), narrowest first.
 *
 * contains() is a subset check, so a broad pattern returns false when the user
 * granted only a narrow one. Testing narrowest-first and accepting any hit
 * prevents a false "grant needed" badge on a configuration that actually works.
 *
 * **Both schemes get their own rungs.** `*://` is broader than either `http://`
 * or `https://`, so an extension granted only `http://127.0.0.1/*` fails every
 * https-only and every `*://` candidate. Measured, not inferred — see
 * docs/research/2026-08-01-permission-audit-spike.md §2.
 */
export function originCandidates(domain: string): string[] {
  const d = normalizeDomain(domain);
  return [
    `https://${d}/*`,
    `http://${d}/*`,
    `https://*.${d}/*`,
    `http://*.${d}/*`,
    `*://${d}/*`,
    `*://*.${d}/*`,
  ];
}

/**
 * The pattern to pass to permissions.request(): audit leniently, request
 * generously. Verified to cover a bare IPv4 host as well as subdomains.
 */
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

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

```
npx vitest run tests/unit/origins.test.ts
```
기대: PASS. 기존 테스트도 전부 통과해야 한다 — `normalizeDomain` 과 `isValidDomain` 의 시그니처와 기존 동작은 유지된다.

- [ ] **Step 5: 전체 스위트가 회귀하지 않았는지 본다**

```
npm test
```
기대: 100개 이상 전부 통과. `isValidDomain` 이 엄격해졌으므로 `compile.test.ts` 나 `conditions.test.ts` 가 붉어질 수 있다 — 그렇다면 **테스트를 약화시키지 말고** 그 테스트가 무엇을 기대했는지 보고, 새 동작이 옳으면 기대값을 갱신하고 근거를 주석으로 남긴다.

- [ ] **Step 6: 커밋**

```bash
git add lib/permissions/origins.ts tests/unit/origins.test.ts
git commit -m "fix: 권한 후보 사다리에 http 단을 넣고 도메인 포트를 정규화

측정 결과 http://127.0.0.1/* 만 부여된 상태에서 기존 4단 후보가 전부
false 였다. contains() 는 부분집합 검사라 *:// 가 두 스킴을 모두 요구한다.
로컬 개발 설정 전체에 거짓 '권한 필요' 배지가 뜨는 경로였다.

포트는 거부가 아니라 정규화한다 — requestDomains 는 호스트 전용이고
호스트 매칭은 포트와 무관하다."
```

---

### Task 2: `validate.ts` — 헤더 진단 3종과 append 허용목록

Phase 1 에서 이월된 모듈이다. 허용목록 밖 `append` 는 **룰 등록 시점에 배치 전체를 무효로 만든다** — 순수 층이 그런 룰을 방출하지 않게 하는 것이 이 태스크의 요점이다.

**Files:**
- Create: `lib/compile/validate.ts`
- Test: `tests/unit/validate.test.ts`

**Interfaces:**
- Consumes: `Profile`, `HeaderRule`, `Diagnostic` (`lib/model/types.ts`)
- Produces:
  ```ts
  export const APPEND_ALLOWED_REQUEST_HEADERS: ReadonlySet<string>;
  export function isAppendAllowed(target: HeaderTarget, name: string): boolean;
  /** Diagnostics for one profile's header rows. Enabled rows only. */
  export function validateHeaders(profile: Profile): Diagnostic[];
  ```
  `lib/compile/headers.ts` 의 기존 `HEADER_TOKEN` 정규식과 **같은 경계**를 쓴다. 두 곳이 어긋나면 진단이 없는데 룰이 드롭되거나 그 반대가 된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/validate.test.ts` 를 새로 만든다:

```ts
import { describe, expect, it } from 'vitest';
import {
  APPEND_ALLOWED_REQUEST_HEADERS,
  isAppendAllowed,
  validateHeaders,
} from '@/lib/compile/validate';
import { createProfile } from '@/lib/model/defaults';
import type { HeaderRule, Profile } from '@/lib/model/types';

function profileWith(headers: HeaderRule[]): Profile {
  return { ...createProfile('P', 0), id: 'p1', headers };
}

function row(patch: Partial<HeaderRule>): HeaderRule {
  return {
    id: patch.id ?? 'h1',
    enabled: true,
    target: 'request',
    operation: 'set',
    name: 'X-Test',
    value: 'v',
    ...patch,
  };
}

describe('the append allowlist', () => {
  it('holds exactly the 21 request headers Chromium allows', () => {
    expect(APPEND_ALLOWED_REQUEST_HEADERS.size).toBe(21);
  });

  it('allows a listed request header', () => {
    expect(isAppendAllowed('request', 'Accept-Language')).toBe(true);
  });

  it('rejects a custom request header — registration would fail the whole batch', () => {
    expect(isAppendAllowed('request', 'X-Custom')).toBe(false);
  });

  it('allows any response header — there is no allowlist for those', () => {
    expect(isAppendAllowed('response', 'X-Anything')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isAppendAllowed('request', 'USER-AGENT')).toBe(true);
  });
});

describe('validateHeaders', () => {
  it('is quiet on a clean profile', () => {
    expect(validateHeaders(profileWith([row({})]))).toEqual([]);
  });

  it('flags a name that is not an RFC 7230 token', () => {
    const d = validateHeaders(profileWith([row({ name: 'X Test' })]));
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('invalid-header-name');
    expect(d[0]?.severity).toBe('error');
    expect(d[0]?.headerRuleId).toBe('h1');
  });

  it('flags a blank name — the popup can create one and it kills the batch', () => {
    expect(validateHeaders(profileWith([row({ name: '' })]))[0]?.kind)
      .toBe('invalid-header-name');
  });

  it('accepts a name that only needs trimming, matching what the compiler emits', () => {
    expect(validateHeaders(profileWith([row({ name: 'X-Test ' })]))).toEqual([]);
  });

  it('flags append on a request header outside the allowlist', () => {
    const d = validateHeaders(profileWith([
      row({ operation: 'append', name: 'X-Custom' }),
    ]));
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('append-not-allowed');
    expect(d[0]?.severity).toBe('error');
  });

  it('does not flag append on a response header', () => {
    expect(validateHeaders(profileWith([
      row({ target: 'response', operation: 'append', name: 'X-Custom' }),
    ]))).toEqual([]);
  });

  it('flags two enabled rows touching the same header on the same target', () => {
    const d = validateHeaders(profileWith([
      row({ id: 'a', name: 'Authorization' }),
      row({ id: 'b', name: 'authorization' }),
    ]));
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('duplicate-header');
    // The diagnostic points at the later row — the one that loses.
    expect(d[0]?.headerRuleId).toBe('b');
  });

  it('does not call the same name on different targets a duplicate', () => {
    expect(validateHeaders(profileWith([
      row({ id: 'a', target: 'request', name: 'X-Same' }),
      row({ id: 'b', target: 'response', name: 'X-Same' }),
    ]))).toEqual([]);
  });

  it('ignores disabled rows entirely', () => {
    expect(validateHeaders(profileWith([
      row({ id: 'a', enabled: false, name: '' }),
      row({ id: 'b', enabled: false, operation: 'append', name: 'X-Custom' }),
    ]))).toEqual([]);
  });

  it('carries the profile id on every diagnostic', () => {
    const d = validateHeaders(profileWith([row({ name: '' })]));
    expect(d[0]?.profileId).toBe('p1');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

```
npx vitest run tests/unit/validate.test.ts
```
기대: FAIL — `lib/compile/validate.ts` 가 없다.

- [ ] **Step 3: 구현한다**

`lib/compile/validate.ts` 를 만든다:

```ts
import type {
  Diagnostic,
  HeaderTarget,
  Profile,
} from '@/lib/model/types';

/**
 * Chromium's `kDNRRequestHeaderAppendAllowList`. Exactly these 21 request
 * headers accept `append`.
 *
 * Anything else fails at rule-registration time with
 * ERROR_APPEND_INVALID_REQUEST_HEADER, and `updateDynamicRules` is
 * transactional — so one bad row stops every already-working rule. That error
 * never reaches the user, which is why this has to be caught here.
 *
 * Response headers have no allowlist at all: any header may be appended, and
 * the semantics differ (a request append joins with a separator, a response
 * append adds another header line).
 */
export const APPEND_ALLOWED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'access-control-request-headers',
  'cache-control',
  'connection',
  'content-language',
  'cookie',
  'forwarded',
  'if-match',
  'if-none-match',
  'keep-alive',
  'range',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'via',
  'want-digest',
  'x-forwarded-for',
]);

/**
 * Same boundary as lib/compile/headers.ts. Chrome's rejection boundary is
 * exactly "not an RFC 7230 token", so one predicate maps 1:1 onto it. If the
 * two ever diverge, a row is either dropped without a diagnostic or flagged
 * without being dropped.
 */
const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function isAppendAllowed(target: HeaderTarget, name: string): boolean {
  if (target === 'response') return true;
  return APPEND_ALLOWED_REQUEST_HEADERS.has(name.trim().toLowerCase());
}

/**
 * Diagnostics for one profile's header rows.
 *
 * Disabled rows are ignored: they never reach the compiler, so a complaint
 * about one would be noise the user cannot act on meaningfully.
 */
export function validateHeaders(profile: Profile): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();

  for (const rule of profile.headers) {
    if (!rule.enabled) continue;

    const name = rule.name.trim();

    if (!HEADER_TOKEN.test(name)) {
      diagnostics.push({
        kind: 'invalid-header-name',
        severity: 'error',
        profileId: profile.id,
        headerRuleId: rule.id,
        message: name.length === 0
          ? 'Header name is empty.'
          : `"${name}" is not a valid header name. Use letters, digits and - _ . only.`,
      });
      // A name this broken cannot be meaningfully checked for the other two
      // conditions; reporting three errors for one typo helps nobody.
      continue;
    }

    if (rule.operation === 'append' && !isAppendAllowed(rule.target, name)) {
      diagnostics.push({
        kind: 'append-not-allowed',
        severity: 'error',
        profileId: profile.id,
        headerRuleId: rule.id,
        message:
          `Chrome does not allow appending to the request header "${name}". ` +
          'Use Set instead, or switch this row to a response header.',
      });
    }

    const key = `${rule.target} ${name.toLowerCase()}`;
    if (seen.has(key)) {
      diagnostics.push({
        kind: 'duplicate-header',
        severity: 'error',
        profileId: profile.id,
        headerRuleId: rule.id,
        message: `"${name}" is set more than once in this profile.`,
      });
    }
    seen.add(key);
  }

  return diagnostics;
}
```

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

```
npx vitest run tests/unit/validate.test.ts
```
기대: PASS.

- [ ] **Step 5: 순수성 가드가 새 파일을 덮는지 확인한다**

```
npx vitest run tests/unit/purity.test.ts
```
기대: PASS 이고, 테스트 이름 목록에 `lib/compile/validate.ts` 가 **나타난다**. `lib/compile` 은 `readdirSync` 로 자동 발견되므로 목록 수정은 필요 없다 — 나타나지 않으면 무언가 잘못된 것이다.

- [ ] **Step 6: 커밋**

```bash
git add lib/compile/validate.ts tests/unit/validate.test.ts
git commit -m "feat: 헤더 진단 3종과 append 허용목록

허용목록 밖 요청 헤더에 append 를 걸면 룰 등록 시점에 실패하고,
updateDynamicRules 는 트랜잭셔널이라 이미 동작하던 룰까지 함께 멈춘다.
그 에러는 사용자에게 도달하지 않으므로 순수 층이 막는다."
```

---

### Task 3: `filterDiagnostics.ts` — 필터 진단 3종

**Files:**
- Create: `lib/compile/filterDiagnostics.ts`
- Test: `tests/unit/filterDiagnostics.test.ts`

**Interfaces:**
- Consumes: `Profile`, `Diagnostic`; `analyzeDomain` (Task 1)
- Produces:
  ```ts
  export function validateFilter(profile: Profile): Diagnostic[];
  ```
  진단 종류: `empty-filter` (warning) · `regex-unsupported` (error) · `port-ignored` (warning, 신규).

**신규 진단 종류 하나를 추가한다.** `DiagnosticKind` 에 `'port-ignored'` 를 넣는다 — 포트를 정규화로 없애는 이상, 그 사실을 사용자에게 알리는 종류가 필요하다. 설계 §7.1 의 8종에 더해 9종이 된다.

- [ ] **Step 1: `DiagnosticKind` 를 넓힌다**

`lib/model/types.ts` 의 `DiagnosticKind` 유니온에 한 줄을 추가한다:

```ts
export type DiagnosticKind =
  | 'append-not-allowed'
  | 'invalid-header-name'
  | 'duplicate-header'
  | 'regex-unsupported'
  | 'profile-conflict'
  | 'permission-missing'
  | 'tab-lock-stale'
  | 'empty-filter'
  /** A port was normalized away: requestDomains is host-only and matches every port. */
  | 'port-ignored';
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`tests/unit/filterDiagnostics.test.ts` 를 새로 만든다:

```ts
import { describe, expect, it } from 'vitest';
import { validateFilter } from '@/lib/compile/filterDiagnostics';
import { createProfile } from '@/lib/model/defaults';
import type { Filter, Profile } from '@/lib/model/types';

function profileWith(filter: Partial<Filter>): Profile {
  const base = createProfile('P', 0);
  return { ...base, id: 'p1', filter: { ...base.filter, ...filter } };
}

describe('validateFilter', () => {
  it('is quiet on a filter with one plain domain', () => {
    expect(validateFilter(profileWith({ domains: ['api.example.com'] }))).toEqual([]);
  });

  it('warns when no domain survives — the rule would match every site', () => {
    const d = validateFilter(profileWith({ domains: [] }));
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('empty-filter');
    expect(d[0]?.severity).toBe('warning');
  });

  it('warns when every domain is unusable, for the same reason', () => {
    const d = validateFilter(profileWith({ domains: ['a b.com'] }));
    expect(d.map((x) => x.kind)).toContain('empty-filter');
  });

  it('reports a dropped port without calling the domain invalid', () => {
    const d = validateFilter(profileWith({ domains: ['localhost:3000'] }));
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('port-ignored');
    expect(d[0]?.severity).toBe('warning');
    expect(d[0]?.message).toContain('localhost');
  });

  it('does not warn about an empty filter when a port-bearing domain survives', () => {
    const d = validateFilter(profileWith({ domains: ['localhost:3000'] }));
    expect(d.map((x) => x.kind)).not.toContain('empty-filter');
  });

  it('flags a non-ASCII regex — regexFilter is ASCII-only', () => {
    const d = validateFilter(profileWith({ mode: 'regex', regex: '도메인' }));
    expect(d.map((x) => x.kind)).toContain('regex-unsupported');
    expect(d.find((x) => x.kind === 'regex-unsupported')?.severity).toBe('error');
  });

  it('flags a regex over the 2KB compiled budget', () => {
    const d = validateFilter(profileWith({ mode: 'regex', regex: 'a'.repeat(2049) }));
    expect(d.map((x) => x.kind)).toContain('regex-unsupported');
  });

  it('flags an empty regex in regex mode', () => {
    const d = validateFilter(profileWith({ mode: 'regex', regex: '' }));
    expect(d.map((x) => x.kind)).toContain('regex-unsupported');
  });

  it('does not check the regex when the filter is in structured mode', () => {
    const d = validateFilter(profileWith({ domains: ['a.com'], regex: '도메인' }));
    expect(d.map((x) => x.kind)).not.toContain('regex-unsupported');
  });

  it('does not raise empty-filter in regex mode — the regex is the condition', () => {
    const d = validateFilter(profileWith({ mode: 'regex', regex: '^https://a\\.com/' }));
    expect(d).toEqual([]);
  });

  it('flags a non-ASCII path pattern — urlFilter is ASCII-only too', () => {
    const d = validateFilter(profileWith({ domains: ['a.com'], pathPattern: '/경로' }));
    expect(d.map((x) => x.kind)).toContain('regex-unsupported');
  });
});
```

- [ ] **Step 3: 테스트가 실패하는 것을 확인한다**

```
npx vitest run tests/unit/filterDiagnostics.test.ts
```
기대: FAIL — 모듈 없음.

- [ ] **Step 4: 구현한다**

`lib/compile/filterDiagnostics.ts` 를 만든다:

```ts
import { analyzeDomain } from '@/lib/permissions/origins';
import type { Diagnostic, Profile } from '@/lib/model/types';

const ASCII_ONLY = /^[\x00-\x7F]*$/;

/** regexFilter must be under 2KB once compiled. The source length is a cheap
 *  upper bound — a source this long cannot compile smaller. */
const REGEX_MAX_SOURCE = 2048;

/**
 * Diagnostics for one profile's filter.
 *
 * `regex-unsupported` here covers only what can be decided without a browser:
 * ASCII-ness and size. `chrome.declarativeNetRequest.isRegexSupported()` is the
 * authority on RE2 syntax and lives in the adapter layer; the regex editor that
 * would call it is Phase 2c.
 */
export function validateFilter(profile: Profile): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const { filter } = profile;

  if (filter.mode === 'regex') {
    const regex = filter.regex ?? '';
    if (regex.length === 0) {
      diagnostics.push({
        kind: 'regex-unsupported',
        severity: 'error',
        profileId: profile.id,
        message: 'Regex mode is on but no pattern is set.',
      });
    } else if (!ASCII_ONLY.test(regex)) {
      diagnostics.push({
        kind: 'regex-unsupported',
        severity: 'error',
        profileId: profile.id,
        message: 'Chrome only accepts ASCII characters in a regex filter.',
      });
    } else if (regex.length > REGEX_MAX_SOURCE) {
      diagnostics.push({
        kind: 'regex-unsupported',
        severity: 'error',
        profileId: profile.id,
        message: 'This regex is too large. Chrome caps a compiled pattern at 2KB.',
      });
    }
    // A regex filter is its own condition — an empty domain list is expected.
    return diagnostics;
  }

  if (filter.pathPattern !== undefined && !ASCII_ONLY.test(filter.pathPattern)) {
    diagnostics.push({
      kind: 'regex-unsupported',
      severity: 'error',
      profileId: profile.id,
      message: 'Chrome only accepts ASCII characters in a path pattern.',
    });
  }

  const analyses = filter.domains.map(analyzeDomain);

  // An unusable entry raises no diagnostic of its own — the profile-level
  // `empty-filter` below is what the user has to act on, and per-entry noise
  // would bury it.
  for (const a of analyses) {
    if (!a.portDropped || !a.valid) continue;
    diagnostics.push({
      kind: 'port-ignored',
      severity: 'warning',
      profileId: profile.id,
      message:
        `Port ignored — this applies to every port on ${a.host}. ` +
        'Chrome matches requests by host, not by port.',
    });
  }

  if (!analyses.some((a) => a.valid)) {
    diagnostics.push({
      kind: 'empty-filter',
      severity: 'warning',
      profileId: profile.id,
      message: filter.domains.length === 0
        ? 'No domain set — this profile applies to every site.'
        : 'No usable domain — this profile would apply to every site, so it is not applied.',
    });
  }

  return diagnostics;
}
```

- [ ] **Step 5: 테스트가 통과하는 것을 확인한다**

```
npx vitest run tests/unit/filterDiagnostics.test.ts tests/unit/purity.test.ts
```
기대: 둘 다 PASS, 순수성 가드 목록에 `lib/compile/filterDiagnostics.ts` 가 나타난다.

- [ ] **Step 6: 커밋**

```bash
git add lib/model/types.ts lib/compile/filterDiagnostics.ts tests/unit/filterDiagnostics.test.ts
git commit -m "feat: 필터 진단 — empty-filter, regex-unsupported, port-ignored

도메인 조건 없는 룰은 DNR 에서 모든 사이트에 매칭되므로 경고가 필요하다.
포트는 벗겨내되 조용히 벗기지 않는다."
```

---

### Task 4: `conflicts.ts` — 프로필 간 충돌 탐지

설계 §7.2. 두 프로필이 같은 헤더를 건드리면 Chromium 이 선착순으로 해소하고 **패자를 에러 없이 폐기한다.** 조건이 실제로 겹치는지 판정하는 것은 일반적으로 불가능하므로 보수적으로 본다.

**Files:**
- Create: `lib/compile/conflicts.ts`
- Test: `tests/unit/conflicts.test.ts`

**Interfaces:**
- Consumes: `Profile`, `Diagnostic`; `analyzeDomain`
- Produces:
  ```ts
  /** Conflicts across enabled profiles, in the order the profiles compile. */
  export function detectConflicts(profiles: readonly Profile[]): Diagnostic[];
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/conflicts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectConflicts } from '@/lib/compile/conflicts';
import { createProfile } from '@/lib/model/defaults';
import type { HeaderRule, Profile } from '@/lib/model/types';

function p(
  id: string,
  name: string,
  domains: string[],
  headers: Array<Partial<HeaderRule>>,
  order = 0,
): Profile {
  const base = createProfile(name, order);
  return {
    ...base,
    id,
    name,
    filter: { ...base.filter, domains },
    headers: headers.map((h, i) => ({
      id: `${id}-h${i}`,
      enabled: true,
      target: 'request',
      operation: 'set',
      name: 'X-Test',
      value: 'v',
      ...h,
    })),
  };
}

describe('detectConflicts', () => {
  it('is quiet for one profile', () => {
    expect(detectConflicts([p('a', 'A', ['x.com'], [{}])])).toEqual([]);
  });

  it('is quiet when domains do not overlap', () => {
    expect(detectConflicts([
      p('a', 'A', ['x.com'], [{ name: 'Authorization' }], 0),
      p('b', 'B', ['y.com'], [{ name: 'Authorization' }], 1),
    ])).toEqual([]);
  });

  it('flags the same header on overlapping domains, naming the winner', () => {
    const d = detectConflicts([
      p('a', 'Local', ['x.com'], [{ name: 'Authorization' }], 0),
      p('b', 'Staging', ['x.com'], [{ name: 'Authorization' }], 1),
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('profile-conflict');
    expect(d[0]?.severity).toBe('warning');
    // The diagnostic lands on the loser so the UI can mark the row that dies.
    expect(d[0]?.profileId).toBe('b');
    expect(d[0]?.message).toContain('Local');
  });

  it('treats append-after-append as compatible — Chrome allows it', () => {
    expect(detectConflicts([
      p('a', 'A', ['x.com'], [{ name: 'Accept', operation: 'append' }], 0),
      p('b', 'B', ['x.com'], [{ name: 'Accept', operation: 'append' }], 1),
    ])).toEqual([]);
  });

  it('treats append after set as compatible within one extension', () => {
    expect(detectConflicts([
      p('a', 'A', ['x.com'], [{ name: 'Accept', operation: 'set' }], 0),
      p('b', 'B', ['x.com'], [{ name: 'Accept', operation: 'append' }], 1),
    ])).toEqual([]);
  });

  it('flags anything after remove — remove allows nothing', () => {
    const d = detectConflicts([
      p('a', 'A', ['x.com'], [{ name: 'Accept', operation: 'remove' }], 0),
      p('b', 'B', ['x.com'], [{ name: 'Accept', operation: 'append' }], 1),
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]?.profileId).toBe('b');
  });

  it('treats a regex-mode profile as potentially overlapping everything', () => {
    const a = p('a', 'A', ['x.com'], [{ name: 'Authorization' }], 0);
    const b = p('b', 'B', ['y.com'], [{ name: 'Authorization' }], 1);
    const bRegex: Profile = { ...b, filter: { ...b.filter, mode: 'regex', regex: '^https://' } };
    expect(detectConflicts([a, bRegex])).toHaveLength(1);
  });

  it('treats a domainless profile as overlapping everything', () => {
    expect(detectConflicts([
      p('a', 'A', [], [{ name: 'Authorization' }], 0),
      p('b', 'B', ['y.com'], [{ name: 'Authorization' }], 1),
    ])).toHaveLength(1);
  });

  it('ignores disabled profiles and disabled rows', () => {
    const a = p('a', 'A', ['x.com'], [{ name: 'Authorization' }], 0);
    const b = p('b', 'B', ['x.com'], [{ name: 'Authorization', enabled: false }], 1);
    expect(detectConflicts([a, { ...b, enabled: true }])).toEqual([]);
    expect(detectConflicts([a, { ...b, enabled: false }])).toEqual([]);
    expect(detectConflicts([{ ...a, enabled: false }, b])).toEqual([]);
  });

  it('does not cross request and response headers', () => {
    expect(detectConflicts([
      p('a', 'A', ['x.com'], [{ name: 'X-Same', target: 'request' }], 0),
      p('b', 'B', ['x.com'], [{ name: 'X-Same', target: 'response' }], 1),
    ])).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

```
npx vitest run tests/unit/conflicts.test.ts
```
기대: FAIL — 모듈 없음.

- [ ] **Step 3: 구현한다**

`lib/compile/conflicts.ts` 를 만든다:

```ts
import { analyzeDomain } from '@/lib/permissions/origins';
import type { Diagnostic, Operation, Profile } from '@/lib/model/types';

/**
 * What Chromium still allows once an operation has been applied to a header
 * (design §7.2). The loser is discarded with no error, which is exactly the
 * silent failure this project exists to remove.
 */
function allowsAfter(first: Operation, second: Operation): boolean {
  if (first === 'append') return second === 'append';
  // `set` then `append` is allowed within the same extension, and every rule
  // here belongs to this extension.
  if (first === 'set') return second === 'append';
  return false; // remove allows nothing
}

/**
 * Conservative overlap: two profiles may collide unless we can show they
 * cannot. Deciding real overlap between arbitrary conditions is not generally
 * possible, and a false warning is cheaper than a silent discard.
 */
function mayOverlap(a: Profile, b: Profile): boolean {
  if (a.filter.mode === 'regex' || b.filter.mode === 'regex') return true;

  const hostsOf = (p: Profile) =>
    p.filter.domains.map(analyzeDomain).filter((x) => x.valid).map((x) => x.host);

  const aHosts = hostsOf(a);
  const bHosts = hostsOf(b);

  // A profile with no usable domain matches every site.
  if (aHosts.length === 0 || bHosts.length === 0) return true;

  // Domains match subdomains too, so `example.com` and `api.example.com`
  // overlap without being equal.
  return aHosts.some((x) =>
    bHosts.some((y) => x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`)),
  );
}

export function detectConflicts(profiles: readonly Profile[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const active = profiles.filter((p) => p.enabled);

  for (let i = 0; i < active.length; i += 1) {
    const later = active[i];
    if (!later) continue;

    for (const rule of later.headers) {
      if (!rule.enabled) continue;
      const key = `${rule.target} ${rule.name.trim().toLowerCase()}`;

      for (let j = 0; j < i; j += 1) {
        const earlier = active[j];
        if (!earlier) continue;
        if (!mayOverlap(earlier, later)) continue;

        const clash = earlier.headers.find(
          (h) =>
            h.enabled &&
            `${h.target} ${h.name.trim().toLowerCase()}` === key &&
            !allowsAfter(h.operation, rule.operation),
        );
        if (!clash) continue;

        diagnostics.push({
          kind: 'profile-conflict',
          severity: 'warning',
          profileId: later.id,
          headerRuleId: rule.id,
          message:
            `"${earlier.name}" already ${clash.operation}s ${rule.name.trim()} ` +
            `on a matching site, so this row is discarded.`,
        });
        break; // one warning per row is enough to act on
      }
    }
  }

  return diagnostics;
}
```

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

```
npx vitest run tests/unit/conflicts.test.ts tests/unit/purity.test.ts
```
기대: 둘 다 PASS.

- [ ] **Step 5: 커밋**

```bash
git add lib/compile/conflicts.ts tests/unit/conflicts.test.ts
git commit -m "feat: 프로필 간 헤더 충돌 탐지

Chromium 은 겹치는 modifyHeaders 를 선착순으로 해소하고 패자를 에러 없이
폐기한다. 조건 겹침 판정은 일반적으로 불가능하므로 보수적으로 본다 —
거짓 양성이 조용한 폐기보다 낫다."
```

---

### Task 5: `compile()` 이 진단을 방출한다

지금까지 만든 순수 판정기를 `CompileResult.diagnostics` 로 모은다. 여기서 `excludedRequestDomains` 의 정규화 갭(인수인계 §2.1)도 함께 닫는다.

**Files:**
- Modify: `lib/compile/compile.ts`
- Modify: `lib/compile/conditions.ts`
- Test: `tests/unit/compile.test.ts`, `tests/unit/conditions.test.ts`

**Interfaces:**
- Consumes: `validateHeaders` (Task 2), `validateFilter` (Task 3), `detectConflicts` (Task 4)
- Produces: `compile()` 의 시그니처는 그대로. `CompileResult.diagnostics` 가 더 이상 빈 배열이 아니다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/compile.test.ts` 끝에 추가한다. 이 파일에 이미 있는 `header()`·`profile()`·`state()` 헬퍼를 쓴다 — 셋 다 `Partial<>` 오버라이드를 받는다.

```ts
describe('compile emits diagnostics', () => {
  it('reports a blank header name and still compiles the other rows', () => {
    const result = compile(state({
      profiles: [profile({
        headers: [
          header({ id: 'h1', name: '' }),
          header({ id: 'h2', name: 'X-Ok' }),
        ],
      })],
    }));
    expect(result.diagnostics.map((d) => d.kind)).toContain('invalid-header-name');
    expect(result.dynamic).toHaveLength(1);
  });

  it('reports an empty filter on the profile it suppresses', () => {
    const base = profile();
    const result = compile(state({
      profiles: [profile({ filter: { ...base.filter, domains: ['a b.com'] } })],
    }));
    expect(result.diagnostics.map((d) => d.kind)).toContain('empty-filter');
    expect(result.dynamic).toHaveLength(0);
  });

  it('reports a conflict between two profiles', () => {
    const result = compile(state({
      profiles: [
        profile({ id: 'p1', name: 'Local', order: 0, headers: [header({ name: 'Authorization' })] }),
        profile({ id: 'p2', name: 'Staging', order: 1, headers: [header({ name: 'Authorization' })] }),
      ],
    }));
    expect(result.diagnostics.map((d) => d.kind)).toContain('profile-conflict');
  });

  it('keeps diagnostics when globalPause is on — the user still needs to see them', () => {
    const result = compile(state({
      globalPause: true,
      profiles: [profile({ headers: [header({ name: '' })] })],
    }));
    expect(result.dynamic).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.kind)).toContain('invalid-header-name');
  });

  it('does not report on a disabled profile', () => {
    const base = profile();
    expect(compile(state({
      profiles: [profile({
        enabled: false,
        filter: { ...base.filter, domains: [] },
        headers: [header({ name: '' })],
      })],
    })).diagnostics).toEqual([]);
  });
});
```

> **주의:** `profile()` 의 기본 헤더는 `header()` 하나이고 그 이름은 `X-Debug-Mode` 다. 기본 도메인은 `['api.example.com']` 이다. 오버라이드하지 않은 필드는 그 값이라는 뜻이다.

- [ ] **Step 2: `conditions.ts` 의 제외 도메인 갭을 닫는 테스트를 쓴다**

`tests/unit/conditions.test.ts` 끝에 추가한다:

```ts
describe('excludedRequestDomains goes through the same normalization', () => {
  const base: Filter = {
    mode: 'structured',
    domains: ['example.com'],
    excludedDomains: [],
    resourceTypes: ['xmlhttprequest'],
  };

  it('normalizes an excluded domain the way an included one is normalized', () => {
    const c = filterToCondition({ ...base, excludedDomains: ['*.Beta.Example.COM'] });
    expect(c.excludedRequestDomains).toEqual(['beta.example.com']);
  });

  it('drops an unusable excluded domain instead of registering a dead string', () => {
    const c = filterToCondition({
      ...base,
      excludedDomains: ['a b.com', 'beta.example.com'],
    });
    expect(c.excludedRequestDomains).toEqual(['beta.example.com']);
  });

  it('omits the key entirely when nothing survives — an empty array is not the same thing', () => {
    const c = filterToCondition({ ...base, excludedDomains: ['a b.com'] });
    expect(c).not.toHaveProperty('excludedRequestDomains');
  });

  it('deduplicates after normalization', () => {
    const c = filterToCondition({
      ...base,
      excludedDomains: ['Beta.example.com', '*.beta.example.com'],
    });
    expect(c.excludedRequestDomains).toEqual(['beta.example.com']);
  });
});
```

`filterToCondition` 은 `(filter: Filter, tabId?: number | null)` 을 받는다. 이 파일은 이미 그것을 임포트하고 `Filter` 타입도 임포트하고 있다 — 추가 임포트는 필요 없다.

**중요 — 비대칭:** 제외 도메인을 개별적으로 건너뛰는 것은 **안전하다**. 제외가 하나 줄면 룰이 더 넓게 매칭되는 것이 아니라 원래 의도한 범위에 가까워질 뿐이고, 제외가 전부 사라지면 키가 없는 것이 정상 상태다. **포함 도메인(`requestDomains`)에 같은 처리를 하면 안 된다** — 거기서는 전부 사라진 상태가 "모든 사이트"를 뜻한다. 그쪽은 이미 프로필 단위 억제로 닫혀 있다.

- [ ] **Step 3: 두 테스트가 실패하는 것을 확인한다**

```
npx vitest run tests/unit/compile.test.ts tests/unit/conditions.test.ts
```
기대: 새 케이스들이 FAIL.

- [ ] **Step 4: `conditions.ts` 를 고친다**

임포트 줄에 `isValidDomain` 을 더한다 (현재는 `normalizeDomain` 만 가져온다):

```ts
import { isValidDomain, normalizeDomain } from '@/lib/permissions/origins';
```

그리고 47-49 행의 다음 블록을

```ts
  if (filter.excludedDomains.length > 0) {
    condition.excludedRequestDomains = [...filter.excludedDomains];
  }
```

이것으로 교체한다:

```ts
  // Exclusions get the same normalization the include side gets, so the same
  // user string means the same host on both. Dropping an unusable exclusion
  // individually is safe — one fewer exclusion can only narrow the rule back
  // toward what the domain list already says. The include side is NOT safe
  // this way: dropping every domain leaves a rule with no domain condition,
  // which DNR matches against every site.
  const excluded = [
    ...new Set(filter.excludedDomains.filter(isValidDomain).map(normalizeDomain)),
  ];
  if (excluded.length > 0) {
    condition.excludedRequestDomains = excluded;
  }
```

빈 배열과 키 부재는 다르다 — DNR 은 빈 배열을 거부한다. 위 조건문이 그것을 지킨다.

- [ ] **Step 5: `compile.ts` 에 진단을 연결한다**

`lib/compile/compile.ts` 의 프로필 순회 안에서, 각 활성 프로필에 대해 `validateHeaders(profile)` 와 `validateFilter(profile)` 의 결과를 누적하고, 순회가 끝난 뒤 `detectConflicts(state.profiles)` 를 더한다.

```ts
import { detectConflicts } from '@/lib/compile/conflicts';
import { validateFilter } from '@/lib/compile/filterDiagnostics';
import { validateHeaders } from '@/lib/compile/validate';
```

규칙 세 가지:

1. **비활성 프로필은 진단하지 않는다.** 사용자가 껐다는 것은 지금 신경 쓰지 않겠다는 뜻이다.
2. **`globalPause` 여도 진단은 계속 낸다.** 룰만 비우고 진단은 그대로다 — 일시정지 중에 설정을 고치는 것이 정상 흐름이다. `requiredOrigins` 를 계속 계산하는 기존 동작과 같은 이유다.
3. **진단은 룰 생성을 막지 않는다.** 진단과 억제는 별개 판단이다 — 억제는 이미 `headers.ts` 의 행 단위 스킵과 `compile.ts` 의 프로필 단위 게이트가 한다. 진단은 그 사실을 사용자에게 전할 뿐이다.

- [ ] **Step 6: 테스트가 통과하는 것을 확인한다**

```
npm test
```
기대: 전부 통과.

- [ ] **Step 7: 커밋**

```bash
git add lib/compile/compile.ts lib/compile/conditions.ts tests/unit/compile.test.ts tests/unit/conditions.test.ts
git commit -m "feat: compile 이 진단을 방출하고 제외 도메인도 정규화한다

제외 도메인을 개별적으로 버리는 것은 안전하다 — 제외가 줄면 룰이 넓어지는
것이 아니라 도메인 목록이 말한 범위로 돌아갈 뿐이다. 포함 도메인에는 같은
처리를 하면 안 되며 그쪽은 프로필 단위 억제로 이미 닫혀 있다."
```

---

### Task 6: `permissions/audit.ts` — 순수 결정 로직

`permission-missing` 만이 비동기 진단이다. 그 비동기성은 **후보를 실제로 조회하는 부분**에만 있고, 조회 결과로 무엇을 판정할지는 순수하다. 그 둘을 나눈다.

**Files:**
- Create: `lib/permissions/audit.ts`
- Modify: `tests/unit/purity.test.ts` (가드 목록에 추가 — **자동 발견되지 않는다**)
- Test: `tests/unit/audit.test.ts`

**Interfaces:**
- Consumes: `analyzeDomain` (Task 1); `Diagnostic`, `Profile`
- Produces:
  ```ts
  /** One domain's audit input: the domain and whether any candidate matched. */
  export interface DomainGrant {
    domain: string;
    granted: boolean;
  }
  /** Domains a set of profiles needs, deduplicated, in first-seen order. */
  export function domainsToAudit(profiles: readonly Profile[]): string[];
  /** `permission-missing` diagnostics for the domains that came back ungranted. */
  export function auditDiagnostics(
    profiles: readonly Profile[],
    grants: readonly DomainGrant[],
  ): Diagnostic[];
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/audit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { auditDiagnostics, domainsToAudit } from '@/lib/permissions/audit';
import { createProfile } from '@/lib/model/defaults';
import type { Profile } from '@/lib/model/types';

function p(id: string, name: string, domains: string[], enabled = true): Profile {
  const base = createProfile(name, 0);
  return { ...base, id, name, enabled, filter: { ...base.filter, domains } };
}

describe('domainsToAudit', () => {
  it('collects normalized hosts from enabled profiles, first-seen order', () => {
    expect(domainsToAudit([
      p('a', 'A', ['B.example.com', 'a.example.com']),
      p('b', 'B', ['a.example.com']),
    ])).toEqual(['b.example.com', 'a.example.com']);
  });

  it('normalizes a port away before auditing — the pattern would otherwise throw', () => {
    expect(domainsToAudit([p('a', 'A', ['localhost:3000'])])).toEqual(['localhost']);
  });

  it('skips unusable domains — no pattern can be built for them', () => {
    expect(domainsToAudit([p('a', 'A', ['a b.com', 'ok.com'])])).toEqual(['ok.com']);
  });

  it('ignores disabled profiles', () => {
    expect(domainsToAudit([p('a', 'A', ['x.com'], false)])).toEqual([]);
  });

  it('returns nothing for a profile with no domains — <all_urls> is not auditable per-domain', () => {
    expect(domainsToAudit([p('a', 'A', [])])).toEqual([]);
  });
});

describe('auditDiagnostics', () => {
  it('is quiet when every domain is granted', () => {
    expect(auditDiagnostics(
      [p('a', 'A', ['x.com'])],
      [{ domain: 'x.com', granted: true }],
    )).toEqual([]);
  });

  it('raises permission-missing for an ungranted domain', () => {
    const d = auditDiagnostics(
      [p('a', 'A', ['x.com'])],
      [{ domain: 'x.com', granted: false }],
    );
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('permission-missing');
    expect(d[0]?.severity).toBe('warning');
    expect(d[0]?.profileId).toBe('a');
    expect(d[0]?.message).toContain('x.com');
  });

  it('reports once per profile-domain pair when two profiles need the same host', () => {
    const d = auditDiagnostics(
      [p('a', 'A', ['x.com']), p('b', 'B', ['x.com'])],
      [{ domain: 'x.com', granted: false }],
    );
    expect(d.map((x) => x.profileId).sort()).toEqual(['a', 'b']);
  });

  it('says nothing about a domain it was given no answer for', () => {
    // A probe that threw is reported as ungranted by the adapter, never omitted.
    // An omission here means the adapter never asked, so staying quiet is right.
    expect(auditDiagnostics([p('a', 'A', ['x.com'])], [])).toEqual([]);
  });

  it('ignores disabled profiles', () => {
    expect(auditDiagnostics(
      [p('a', 'A', ['x.com'], false)],
      [{ domain: 'x.com', granted: false }],
    )).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

```
npx vitest run tests/unit/audit.test.ts
```
기대: FAIL — 모듈 없음.

- [ ] **Step 3: 구현한다**

`lib/permissions/audit.ts` 를 만든다:

```ts
import { analyzeDomain } from '@/lib/permissions/origins';
import type { Diagnostic, Profile } from '@/lib/model/types';

/** One domain's audit answer, as produced by the adapter. */
export interface DomainGrant {
  domain: string;
  granted: boolean;
}

/**
 * Hosts that need a permission check, deduplicated, in first-seen order.
 *
 * A profile with no usable domain is skipped rather than audited as
 * `<all_urls>`: it is already suppressed by the compiler, so a permission
 * badge on it would point at a rule that does not exist.
 */
export function domainsToAudit(profiles: readonly Profile[]): string[] {
  const hosts: string[] = [];
  for (const profile of profiles) {
    if (!profile.enabled) continue;
    for (const domain of profile.filter.domains) {
      const { host, valid } = analyzeDomain(domain);
      if (!valid) continue;
      if (!hosts.includes(host)) hosts.push(host);
    }
  }
  return hosts;
}

/**
 * `permission-missing` for every enabled profile that needs an ungranted host.
 *
 * One diagnostic per profile-domain pair: the badge lives on a profile row in
 * the UI, so a shared host has to reach every profile that depends on it.
 */
export function auditDiagnostics(
  profiles: readonly Profile[],
  grants: readonly DomainGrant[],
): Diagnostic[] {
  const ungranted = new Set(
    grants.filter((g) => !g.granted).map((g) => g.domain),
  );
  if (ungranted.size === 0) return [];

  const diagnostics: Diagnostic[] = [];
  for (const profile of profiles) {
    if (!profile.enabled) continue;
    const seen = new Set<string>();
    for (const domain of profile.filter.domains) {
      const { host, valid } = analyzeDomain(domain);
      if (!valid || !ungranted.has(host) || seen.has(host)) continue;
      seen.add(host);
      diagnostics.push({
        kind: 'permission-missing',
        severity: 'warning',
        profileId: profile.id,
        message:
          `HeaderLab needs permission for ${host}. ` +
          'The rule is registered but will not apply until you grant it.',
      });
    }
  }
  return diagnostics;
}
```

- [ ] **Step 4: 순수성 가드에 이 파일을 넣는다**

`tests/unit/purity.test.ts` 의 `PURE_FILES` 를 고친다:

```ts
const PURE_FILES = [
  ...readdirSync('lib/compile').filter((f) => f.endsWith('.ts')).map((f) => join('lib/compile', f)),
  'lib/permissions/origins.ts',
  'lib/permissions/audit.ts',
];
```

`lib/permissions/` 는 자동 발견되지 않는다. 여기에 넣지 않으면 이 파일이 나중에 브라우저를 임포트해도 가드가 조용히 통과시킨다.

- [ ] **Step 5: 테스트가 통과하는 것을 확인한다**

```
npx vitest run tests/unit/audit.test.ts tests/unit/purity.test.ts
```
기대: 둘 다 PASS, 가드 목록에 `lib/permissions/audit.ts` 가 나타난다.

- [ ] **Step 6: 커밋**

```bash
git add lib/permissions/audit.ts tests/unit/audit.test.ts tests/unit/purity.test.ts
git commit -m "feat: 권한 감사의 순수 결정 로직

비동기성은 후보를 조회하는 부분에만 있고 결과로 무엇을 판정할지는 순수하다.
lib/permissions/ 는 순수성 가드가 자동 발견하지 않으므로 목록에 명시했다."
```

---

### Task 7: `permissions/probe.ts` — 어댑터

`permissions.contains()` 를 부르는 **유일한** 파일이다. `ruleSync.ts` 가 DNR 에 대해 하는 역할과 같다.

**Files:**
- Create: `lib/permissions/probe.ts`
- Test: `tests/unit/probe.test.ts`

**Interfaces:**
- Consumes: `originCandidates`, `requestPattern` (Task 1); `DomainGrant` (Task 6)
- Produces:
  ```ts
  /** Asks the browser whether any candidate for each host is granted. */
  export function probeGrants(hosts: readonly string[]): Promise<DomainGrant[]>;
  /** Requests the broad pattern for one host. Must be called from a user gesture. */
  export function requestHost(host: string): Promise<boolean>;
  ```

**두 가지를 반드시 지킨다:**

1. **후보를 한 번에 하나씩 넘긴다.** `contains({origins: [a, b]})` 에서 `b` 가 유효하지 않으면 호출 전체가 던지고 `a` 의 답도 잃는다.
2. **각 호출을 개별적으로 `catch` 한다.** 던진 후보는 "부여되지 않음"으로 보고 다음 후보로 넘어간다. Task 1 이 포트와 스킴을 정규화하므로 도달하기 어렵지만, 이 함수가 마지막 방어선이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/probe.test.ts`:

```ts
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeGrants, requestHost } from '@/lib/permissions/probe';

// fake-browser defines permissions.* as stubs that THROW ("not implemented"),
// exactly as it does for declarativeNetRequest — measured, see
// docs/research/2026-08-01-permission-audit-spike.md §5. Spies are the only
// way to exercise this layer, and `fakeBrowser.reset()` does not remove them,
// so `vi.restoreAllMocks()` has to.
const perms = () => fakeBrowser.permissions;

type ContainsArg = { origins?: string[] };

beforeEach(() => { fakeBrowser.reset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('probeGrants', () => {
  it('asks one origin per call — a batch would lose every answer to one bad member', async () => {
    const calls: string[][] = [];
    vi.spyOn(perms(), 'contains').mockImplementation((async (p: ContainsArg) => {
      calls.push(p.origins ?? []);
      return false;
    }) as never);

    await probeGrants(['example.com']);

    expect(calls.length).toBeGreaterThan(1);
    for (const origins of calls) expect(origins).toHaveLength(1);
  });

  it('reports granted as soon as a candidate matches, and stops asking', async () => {
    const asked: string[] = [];
    vi.spyOn(perms(), 'contains').mockImplementation((async (p: ContainsArg) => {
      const origin = p.origins?.[0] ?? '';
      asked.push(origin);
      return origin === 'https://example.com/*';
    }) as never);

    expect(await probeGrants(['example.com'])).toEqual([
      { domain: 'example.com', granted: true },
    ]);
    expect(asked).toEqual(['https://example.com/*']);
  });

  it('finds a grant on the http rung — the loopback case', async () => {
    vi.spyOn(perms(), 'contains').mockImplementation((async (p: ContainsArg) =>
      p.origins?.[0] === 'http://127.0.0.1/*') as never);
    expect(await probeGrants(['127.0.0.1'])).toEqual([
      { domain: '127.0.0.1', granted: true },
    ]);
  });

  it('reports ungranted when every candidate says no', async () => {
    vi.spyOn(perms(), 'contains').mockResolvedValue(false as never);
    expect(await probeGrants(['example.com'])).toEqual([
      { domain: 'example.com', granted: false },
    ]);
  });

  it('survives a candidate that throws and keeps checking the rest', async () => {
    vi.spyOn(perms(), 'contains').mockImplementation((async (p: ContainsArg) => {
      const origin = p.origins?.[0] ?? '';
      if (origin.startsWith('https://')) throw new Error('Invalid value for origin pattern');
      return origin === 'http://example.com/*';
    }) as never);
    expect(await probeGrants(['example.com'])).toEqual([
      { domain: 'example.com', granted: true },
    ]);
  });

  it('reports ungranted, not a rejection, when every candidate throws', async () => {
    vi.spyOn(perms(), 'contains').mockRejectedValue(new Error('Invalid port.') as never);
    await expect(probeGrants(['example.com'])).resolves.toEqual([
      { domain: 'example.com', granted: false },
    ]);
  });

  it('keeps one bad host from poisoning another host answer', async () => {
    vi.spyOn(perms(), 'contains').mockImplementation((async (p: ContainsArg) => {
      const origin = p.origins?.[0] ?? '';
      if (origin.includes('bad')) throw new Error('Invalid port.');
      return origin === 'https://good.com/*';
    }) as never);
    expect(await probeGrants(['bad.com', 'good.com'])).toEqual([
      { domain: 'bad.com', granted: false },
      { domain: 'good.com', granted: true },
    ]);
  });

  it('returns an empty list without calling the browser for no hosts', async () => {
    const spy = vi.spyOn(perms(), 'contains').mockResolvedValue(false as never);
    expect(await probeGrants([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('requestHost', () => {
  it('requests the broad pattern, not the narrow one', async () => {
    const seen: string[] = [];
    vi.spyOn(perms(), 'request').mockImplementation((async (p: ContainsArg) => {
      seen.push(...(p.origins ?? []));
      return true;
    }) as never);

    expect(await requestHost('example.com')).toBe(true);
    expect(seen).toEqual(['*://*.example.com/*']);
  });

  it('reports false rather than rejecting when the request throws', async () => {
    vi.spyOn(perms(), 'request').mockRejectedValue(new Error('user gesture required') as never);
    await expect(requestHost('example.com')).resolves.toBe(false);
  });
});
```

> **`as never` 에 대해.** `ruleSync.test.ts` 가 이미 같은 이유로 쓰고 있다 — `webextension-polyfill` 의 오버로드된 시그니처가 `vi.spyOn` 의 모의 타입과 정확히 맞지 않는다. 이 캐스트는 테스트 배선에만 있고 제품 코드에는 없다.

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

```
npx vitest run tests/unit/probe.test.ts
```
기대: FAIL — 모듈 없음.

- [ ] **Step 3: 구현한다**

`lib/permissions/probe.ts` 를 만든다:

```ts
import { browser } from 'wxt/browser';
import { originCandidates, requestPattern } from '@/lib/permissions/origins';
import type { DomainGrant } from '@/lib/permissions/audit';

/**
 * Asks the browser whether one match pattern is already covered.
 *
 * `permissions.contains()` **throws** on a pattern the browser considers
 * malformed — a port, an embedded scheme, an empty host. A throw is not an
 * answer, so it is reported as "not granted" and the next candidate is tried.
 * Measured behaviour: docs/research/2026-08-01-permission-audit-spike.md §3.
 */
async function covers(origin: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [origin] });
  } catch {
    return false;
  }
}

/**
 * Whether each host is already granted, narrowest candidate first.
 *
 * **One origin per call, never a batch.** `contains()` rejects the entire call
 * when any member is malformed, so batching would throw away the answers for
 * every valid origin sent alongside it.
 */
export async function probeGrants(hosts: readonly string[]): Promise<DomainGrant[]> {
  const grants: DomainGrant[] = [];

  for (const host of hosts) {
    let granted = false;
    for (const candidate of originCandidates(host)) {
      if (await covers(candidate)) {
        granted = true;
        break;
      }
    }
    grants.push({ domain: host, granted });
  }

  return grants;
}

/**
 * Requests host access for one domain. Audit leniently, request generously —
 * the broad pattern means a later scheme change or new subdomain does not
 * prompt the user again.
 *
 * Must be called from a user gesture; the Grant button click is that gesture.
 */
export async function requestHost(host: string): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins: [requestPattern(host)] });
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

```
npx vitest run tests/unit/probe.test.ts
```
기대: PASS.

- [ ] **Step 5: 순수성 가드가 이 파일을 덮지 **않는지** 확인한다**

```
npx vitest run tests/unit/purity.test.ts
```
기대: PASS. `lib/permissions/probe.ts` 는 목록에 **없어야** 한다 — 이 파일은 어댑터이므로 `wxt/browser` 를 임포트하는 것이 정상이다. 목록에 넣으면 즉시 붉어진다.

- [ ] **Step 6: 커밋**

```bash
git add lib/permissions/probe.ts tests/unit/probe.test.ts
git commit -m "feat: 권한 조회 어댑터 — 한 번에 하나, 개별 catch

contains() 는 유효하지 않은 패턴에 예외를 던지고, 배치하면 함께 넘긴
유효 항목의 답까지 잃는다. 실측으로 확인한 동작이다."
```

---

### Task 8: `activeTab` 재도입과 매니페스트 테스트 정정

설계 §5.1 의 매니페스트로 되돌린다. 권한 감사(§5.3)가 현재 탭 오리진을 알아야 하고, 그것이 `activeTab` 의 용도다.

**Files:**
- Modify: `wxt.config.ts`
- Test: `tests/unit/manifest.test.ts`

- [ ] **Step 1: 테스트를 먼저 고친다 (아직 실패해야 한다)**

`tests/unit/manifest.test.ts` 의 세 번째 `it` 을 교체한다:

```ts
  it('declares exactly the permissions actually used — nothing extra to explain away', () => {
    const manifest = readManifest();
    // The claim is "no install warning", not "two permissions". `activeTab`
    // adds none: it grants access to one tab at the moment the user clicks the
    // extension icon. The `tabs` permission would have added a "read your
    // browsing history" warning, which is why it is not here.
    expect(manifest.permissions).toEqual([
      'storage',
      'declarativeNetRequestWithHostAccess',
      'activeTab',
    ]);
  });
```

`host_permissions` 부재를 확인하는 두 `it` 은 **그대로 둔다.** 그것이 설치 경고 0개를 지탱하는 단언이다.

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

```
npm test
```
기대: 매니페스트 테스트 FAIL — 빌드된 매니페스트에 `activeTab` 이 없다.

- [ ] **Step 3: 매니페스트를 고친다**

`wxt.config.ts` 의 `permissions` 배열에 `'activeTab'` 을 **마지막에** 추가한다. 테스트가 순서까지 단언하므로 순서를 맞춘다.

```ts
    permissions: ['storage', 'declarativeNetRequestWithHostAccess', 'activeTab'],
```

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

```
npm test
```
기대: 전부 통과.

- [ ] **Step 5: 빌드 산출물을 직접 확인한다**

```
node -e "const m=require('./.output/chrome-mv3/manifest.json');console.log(m.permissions, Object.prototype.hasOwnProperty.call(m,'host_permissions'))"
```
기대: `[ 'storage', 'declarativeNetRequestWithHostAccess', 'activeTab' ] false`

키 존재로 확인한다 — `"optional_host_permissions"` 가 `"host_permissions"` 를 부분 문자열로 포함하므로 문자열 검색은 거짓 통과한다.

- [ ] **Step 6: 커밋**

```bash
git add wxt.config.ts tests/unit/manifest.test.ts
git commit -m "feat: activeTab 재도입 — 권한 감사가 현재 탭 오리진을 읽는다

설계 §5.3 의 두 번째 줄(사용자가 스스로 알아낼 수 없는 부분)이 현재 탭
오리진을 요구한다. activeTab 은 설치 경고를 붙이지 않는다 — tabs 권한과
다른 점이 그것이다.

매니페스트 단언을 '권한 두 개'에서 '정확히 이 세 개'로 바꿨다. 주장은
처음부터 설치 경고 0개였고 activeTab 은 경고를 만들지 않는다."
```

---

### Task 9: 팝업 쓰기 경로를 부분 갱신으로 바꾼다

인수인계 §2.2 와 §2.1 의 마지막 줄은 **같은 원인**이다 — 팝업이 `AppState` 전체를 덮어쓴다. 하나를 고치면 둘 다 닫힌다.

**Files:**
- Modify: `lib/storage/useAppState.ts`
- Modify: `lib/storage/state.ts`
- Modify: `entrypoints/popup/App.tsx` (호출 지점 조정)
- Test: `tests/unit/state.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** Merges a partial patch into the stored state instead of replacing it. */
  export function patchState(patch: Partial<AppState>): Promise<AppState>;
  // useAppState:
  //   update(fn: (draft: AppState) => AppState)  →  삭제
  //   patch(fn: (draft: AppState) => Partial<AppState>)  →  신규
  ```

**왜 부분 갱신인가.** 두 가지를 동시에 고친다:

- **단일 기록자 가정.** 설계 §6.3 은 서비스워커가 기동 시 죽은 탭의 잠금을 해제하도록 규정한다 — 백그라운드의 상태 쓰기다. 팝업이 전체를 덮어쓰면 팝업의 다음 편집이 그것을 되돌린다.
- **미지의 키 소실.** `parseAppState` 는 읽을 때 미지의 키를 벗겨낸다(전방 호환을 위한 의도적 설계). 전체 덮어쓰기는 그 손실을 영구화한다.

부분 갱신은 쓰기 직전에 저장된 값을 다시 읽어 병합하므로, 팝업이 건드리지 않은 최상위 키는 그대로 남는다.

> **범위 주의:** 이것은 최상위 키 단위 병합이다. `profiles` 배열 자체를 두 기록자가 동시에 편집하는 경우는 해결하지 않는다 — 그 문제는 탭 잠금이 실제로 상태를 쓰기 시작하는 Phase 2c 에서 다룬다. 지금 필요한 것은 백그라운드가 `profiles` 를 쓰고 팝업이 `theme` 를 쓸 때 서로를 지우지 않는 것이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/state.test.ts` 끝에 추가한다:

```ts
describe('patchState', () => {
  it('leaves untouched top-level keys alone', async () => {
    await setState({ version: 1, profiles: [], globalPause: true, theme: 'dark' });
    await patchState({ globalPause: false });
    const after = await getState();
    expect(after.globalPause).toBe(false);
    expect(after.theme).toBe('dark');
  });

  it('returns the merged state', async () => {
    await setState({ version: 1, profiles: [], globalPause: false, theme: 'system' });
    const merged = await patchState({ theme: 'light' });
    expect(merged.theme).toBe('light');
    expect(merged.globalPause).toBe(false);
  });

  it('reads the stored value at write time, not a stale snapshot', async () => {
    await setState({ version: 1, profiles: [], globalPause: false, theme: 'system' });
    // Another writer lands between the popup's read and its write.
    await setState({ version: 1, profiles: [], globalPause: true, theme: 'system' });
    await patchState({ theme: 'dark' });
    const after = await getState();
    expect(after.globalPause).toBe(true); // the other writer's change survives
    expect(after.theme).toBe('dark');
  });
});
```

이 파일의 현재 임포트는 `getState` 만 가져온다. 다음으로 바꾼다:

```ts
import { getState, patchState, setState } from '@/lib/storage/state';
```

`describe` 블록은 이 파일의 기존 것들과 같은 `beforeEach(() => { fakeBrowser.reset(); })` 안에 있어야 한다 — `fakeBrowser` 는 `'wxt/testing/fake-browser'` 에서 온다(`@webext-core/fake-browser` 를 직접 임포트하지 않는다).

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

```
npx vitest run tests/unit/state.test.ts
```
기대: FAIL — `patchState` 가 없다.

- [ ] **Step 3: `state.ts` 에 `patchState` 를 넣는다**

```ts
/**
 * Merges a patch into the stored state, re-reading immediately before the
 * write.
 *
 * The popup used to replace the whole AppState. That made the last writer win
 * over keys it never touched — and design §6.3 has the background worker
 * writing state too (releasing a tab lock whose tab is gone). It also made the
 * unknown-key stripping in `parseAppState` permanent: a key written by a newer
 * version, read and stripped by an older one, was gone on the next edit.
 *
 * Top-level merge only. Concurrent edits to `profiles` itself are Phase 2c,
 * where tab lock actually starts writing.
 */
export async function patchState(patch: Partial<AppState>): Promise<AppState> {
  const current = await getState();
  const next: AppState = { ...current, ...patch };
  await setState(next);
  return next;
}
```

- [ ] **Step 4: `useAppState` 를 부분 갱신으로 바꾼다**

```ts
import { useEffect, useState } from 'react';
import { getState, patchState, stateItem } from '@/lib/storage/state';
import type { AppState } from '@/lib/model/types';

export function useAppState() {
  const [state, setLocal] = useState<AppState | null>(null);

  useEffect(() => {
    getState().then(setLocal);
    return stateItem.watch((next) => setLocal(next));
  }, []);

  /**
   * Applies a patch derived from the current state. The optimistic local
   * update keeps typing responsive; `patchState` re-reads before writing, so a
   * concurrent writer's untouched keys survive and the watcher corrects any
   * drift.
   */
  const patch = (fn: (draft: AppState) => Partial<AppState>) => {
    setLocal((current) => {
      if (!current) return current;
      const delta = fn(current);
      void patchState(delta);
      return { ...current, ...delta };
    });
  };

  return { state, patch };
}
```

- [ ] **Step 5: `App.tsx` 의 호출 지점을 고친다**

`App.tsx` 는 `update((s) => ({ ...s, profiles: ... }))` 를 세 곳에서 쓴다. 각각 `patch((s) => ({ profiles: ... }))` 로 바꾼다 — **`...s` 를 뺀 나머지가 그대로 델타다.**

```ts
const { state, patch } = useAppState();

const addProfile = () =>
  patch(() => ({ profiles: [createProfile('Local', 0)] }));

const patchProfile = (fn: (p: Profile) => Profile) =>
  patch((s) => ({ profiles: s.profiles.map((p, i) => (i === 0 ? fn(p) : p)) }));
```

`addHeader` 와 `patchHeader` 는 `patchProfile` 을 거치므로 수정할 것이 없다.

- [ ] **Step 6: 테스트와 타입이 통과하는지 확인한다**

```
npm run compile && npm test
```
기대: 둘 다 통과. `update` 를 참조하는 곳이 남아 있으면 `tsc` 가 잡는다.

- [ ] **Step 7: 커밋**

```bash
git add lib/storage/state.ts lib/storage/useAppState.ts entrypoints/popup/App.tsx tests/unit/state.test.ts
git commit -m "fix: 팝업이 상태를 통째로 덮어쓰지 않는다

인수인계 §2.2 의 단일 기록자 충돌과 §2.1 의 미지 키 소실은 같은 원인이다.
쓰기 직전에 다시 읽어 병합하면 둘 다 닫힌다.

최상위 키 단위 병합이다. profiles 배열 자체의 동시 편집은 탭 잠금이 실제로
상태를 쓰기 시작하는 Phase 2c 의 문제다."
```

---

### Task 10: 재조정 실패를 세션 저장소에 기록한다

설계 §6.2 — "에러 메시지를 세션 저장소에 기록해 팝업이 실제 문구를 보여준다." 기록까지가 Phase 2a 이고, 보여주는 것은 Phase 2b 다.

**Files:**
- Create: `lib/storage/session.ts`
- Modify: `entrypoints/background.ts`
- Modify: `lib/sync/ruleSync.ts`
- Test: `tests/unit/session.test.ts`, `tests/unit/ruleSync.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SyncStatus {
    /** Null when the last reconcile succeeded. */
    lastError: string | null;
    /** Rules registered by the last successful reconcile. */
    ruleCount: number;
  }
  export const syncStatusItem: /* WxtStorageItem */;
  export function getSyncStatus(): Promise<SyncStatus>;
  export function setSyncStatus(status: SyncStatus): Promise<void>;
  ```
  **세션 영역을 쓴다** (`session:syncStatus`). 브라우저를 다시 열면 사라지는 것이 옳다 — 지난 세션의 실패 문구를 보여줄 이유가 없다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/session.test.ts`:

```ts
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { getSyncStatus, setSyncStatus } from '@/lib/storage/session';

beforeEach(() => { fakeBrowser.reset(); });

describe('sync status', () => {
  it('starts clean', async () => {
    expect(await getSyncStatus()).toEqual({ lastError: null, ruleCount: 0 });
  });

  it('round-trips a failure message', async () => {
    await setSyncStatus({ lastError: 'Rule 3 is invalid', ruleCount: 0 });
    expect((await getSyncStatus()).lastError).toBe('Rule 3 is invalid');
  });

  it('clears the message on a later success', async () => {
    await setSyncStatus({ lastError: 'boom', ruleCount: 0 });
    await setSyncStatus({ lastError: null, ruleCount: 4 });
    expect(await getSyncStatus()).toEqual({ lastError: null, ruleCount: 4 });
  });
});
```

`tests/unit/ruleSync.test.ts` 에 추가한다:

```ts
it('records the failure message where the popup can read it', async () => {
  // Install a failing updateDynamicRules the same way this file's other
  // failure tests do, then assert the recorded status.
  // (Follow the existing spy setup in this file — do not invent a new one.)
  await reconcile();
  expect((await getSyncStatus()).lastError).toContain('boom');
});

it('clears a previous failure once a reconcile succeeds', async () => {
  await setSyncStatus({ lastError: 'boom', ruleCount: 0 });
  await reconcile();
  expect((await getSyncStatus()).lastError).toBeNull();
});
```

> **구현자에게:** `ruleSync.test.ts` 는 이미 `updateDynamicRules` 실패를 시뮬레이션하는 스파이 설정을 가지고 있다. **그 설정을 그대로 재사용한다.** 새 방식을 만들지 않는다.
>
> 같은 파일에 인수인계 §2.1 이 지적한 결함이 있다 — `reconcile` 테스트가 `await` 이전에 단언해서, 단언이 실패하면 모듈 스코프의 `inFlight` 가 pending 으로 남아 다음 테스트를 오염시킨다. **이 태스크에서 함께 고친다:** 단언을 `await reconcile()` **뒤로** 옮긴다.

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

```
npx vitest run tests/unit/session.test.ts tests/unit/ruleSync.test.ts
```
기대: FAIL.

- [ ] **Step 3: `lib/storage/session.ts` 를 만든다**

```ts
import { storage } from '#imports';

/**
 * What the last reconcile did. Session-scoped on purpose: a failure message
 * from a previous browser session describes rules that no longer exist.
 *
 * WXT requires an area prefix on every key.
 */
export interface SyncStatus {
  /** Null when the last reconcile succeeded. */
  lastError: string | null;
  /** Rules registered by the last successful reconcile. */
  ruleCount: number;
}

const DEFAULT_STATUS: SyncStatus = { lastError: null, ruleCount: 0 };

export const syncStatusItem = storage.defineItem<SyncStatus>('session:syncStatus', {
  fallback: DEFAULT_STATUS,
});

export async function getSyncStatus(): Promise<SyncStatus> {
  return (await syncStatusItem.getValue()) ?? DEFAULT_STATUS;
}

export async function setSyncStatus(status: SyncStatus): Promise<void> {
  await syncStatusItem.setValue(status);
}
```

> **구현자에게:** `lib/storage/state.ts` 가 `defineItem` 을 쓰는 방식을 먼저 읽고 **그 형태에 맞춘다.** 임포트 경로는 `#imports` 다 — `wxt/storage` 는 컴파일되지 않는다.

- [ ] **Step 4: `ruleSync.ts` 가 결과를 기록하게 한다**

`reconcile()` 이 룰 갱신을 시도한 뒤:
- 성공하면 `setSyncStatus({ lastError: null, ruleCount: <등록한 룰 수> })`
- 실패하면 `setSyncStatus({ lastError: <에러 메시지>, ruleCount: 0 })` 를 부르고 **기존 에러 처리 동작은 그대로 둔다** (콘솔 기록과 던지기 여부를 바꾸지 않는다).

기록 자체가 실패해도 재조정을 무너뜨리지 않는다 — 상태 기록은 부수적이다:

```ts
try {
  await setSyncStatus({ lastError: null, ruleCount: rules.length });
} catch {
  // Recording status is best-effort; it must never mask the reconcile result.
}
```

- [ ] **Step 5: 테스트가 통과하는 것을 확인한다**

```
npm test
```
기대: 전부 통과.

- [ ] **Step 6: 커밋**

```bash
git add lib/storage/session.ts lib/sync/ruleSync.ts entrypoints/background.ts tests/unit/session.test.ts tests/unit/ruleSync.test.ts
git commit -m "feat: 재조정 실패를 세션 저장소에 기록한다

설계 §6.2 는 팝업이 실제 문구를 보여주도록 규정한다. 기록이 Phase 2a 이고
표시는 2b 다. 세션 영역인 이유는 지난 브라우저 세션의 실패 문구가 이미
존재하지 않는 룰을 가리키기 때문이다.

ruleSync 테스트가 await 이전에 단언하던 것도 함께 고쳤다 — 단언이 실패하면
모듈 스코프 inFlight 가 pending 으로 남아 다음 테스트를 오염시킨다."
```

---

## 완료 기준

- [ ] `npm run compile` 통과
- [ ] `npm test` 통과, 새 테스트 포함
- [ ] `npm run test:e2e` 통과 — **3/3 그대로.** 이 계획은 E2E 를 건드리지 않는다
- [ ] 순수성 가드가 `lib/compile/*.ts` 전부와 `lib/permissions/{origins,audit}.ts` 를 덮고, `probe.ts` 는 덮지 않는다
- [ ] 빌드 매니페스트: `permissions` 가 정확히 세 개, `host_permissions` 키 부재
- [ ] `CompileResult.diagnostics` 가 7종을 낸다 — `permission-missing` 은 어댑터가, `tab-lock-stale` 은 Phase 2c 가 채운다

## Phase 2a 가 만들지 않는 것

UI 는 하나도 만들지 않는다. 진단을 보여주는 인라인 행, 권한 부여 버튼, Data Grid, 테마 — 전부 Phase 2b 다. 이 단계의 산출물은 2b 가 렌더할 **데이터와 그 데이터가 옳다는 증거**다.

`tab-lock-stale` 진단과 탭 잠금 생명주기, 전체 일시정지 UI, JSON export/import 는 Phase 2c 다. JSON import 가 `regexFilter` 와 `urlFilter` 표면을 실제로 도달 가능하게 만들므로, **2c 는 Task 3 의 필터 검증보다 나중이어야 한다** — 이 계획이 그 순서를 지킨다.
