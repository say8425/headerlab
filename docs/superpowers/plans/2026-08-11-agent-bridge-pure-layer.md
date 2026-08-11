# Agent Bridge — 1차 계획: 순수 층과 빚진 스파이크

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브리지가 받은 명령을 `AppState` 변경으로 바꾸는 순수 층을 브라우저 없이 완성하고, 어댑터 설계가 기대고 있는 두 가지 사실을 실측한다.

**Architecture:** `lib/bridge/protocol.ts` 가 명령의 모양(zod)을 정의하고, `lib/bridge/apply.ts` 가 `(AppState, Command) → ApplyResult` 를 계산한다. 둘 다 순수이므로 `@webext-core/fake-browser` 도 스파이도 필요 없다. 브라우저에 닿는 것은 이 계획에 없다 — 스파이크만 예외이고, 그건 코드가 아니라 측정이다.

**Tech Stack:** TypeScript, zod 4.4.3, vitest 4.1.10 (environment `node`), pnpm 11.20.0

## 설계 문서

`docs/superpowers/specs/2026-08-11-agent-bridge-design.md` (커밋 `6de7589`). 이 계획은 그 §1–§4 와 §10 을 덮는다.

## 범위에서 뺀 것과 이유

- **pnpm workspace 골격** — spec §11 은 이걸 1단계에 뒀지만 2차 계획으로 민다. 순수 층은 확장 패키지(= 저장소 루트)의 `lib/bridge/` 에 살고 확장은 루트에 남기로 했으므로(spec §6.1), 나중에 workspace 를 만들어도 **이 계획의 파일은 한 개도 움직이지 않는다.** 지금 만들면 아무도 안 쓰는 빈 패키지를, 실패할 수 없는 테스트와 함께 커밋하게 된다.
- **호스트·CLI·팝업·릴리즈·플러그인** — 전부 스파이크 결과 뒤. spec §11 이 "3단계 결과가 4단계 이후를 바꿀 수 있다" 고 못박은 그 지점이 이 계획의 끝이다.
- **스냅샷과 되돌리기** (`state snapshots` / `state restore`) — spec §2·§3 이 요구하지만 저장소에 쓰는 일이므로 순수 층이 아니다. 어댑터와 같은 계획에 들어간다.
- **읽기 명령** (`state get`·`status`·`diagnostics`·`rule ls`) — 상태를 바꾸지 않으므로 리듀서를 통과할 이유가 없다. 기존 `compile()` 과 `ruleTally()` 를 그대로 부르는 CLI 쪽 일이다.

## Global Constraints

이 절은 모든 태스크의 요구사항에 암묵적으로 포함된다.

- **새 의존성 0개.** `zod`·`vitest` 는 이미 있다. 그 외에는 Node 내장만 쓴다.
- **`pnpm test` 를 쓴다. 맨손 `vitest run` 금지.** 여러 테스트가 *빌드된* 산출물을 검사하고 맨손 도구는 빌드하지 않는다. `tests/support/build.ts` 가 staleness 를 감지해 큰 소리로 실패한다 — 우회하지 않는다.
- **명령·PR 은 영어**, `<type>: <description>`. 타입: feat, fix, refactor, docs, test, chore, perf, ci. **문서는 한국어** (`docs/` 의 기존 관례).
- **불변성**: 새 객체를 반환하고 제자리 변경을 하지 않는다.
- **순수 파일은 `chrome.`, `wxt/browser`, `#imports`, `webextension-polyfill`, `wxt/utils/storage` 를 임포트하지 않는다.** `tests/unit/purity.test.ts` 가 강제하되 **`lib/bridge/` 는 자동 탐색 대상이 아니다** — 이름으로 추가해야 가드가 붙는다.
- **모든 단언에 대해 묻는다: 어떤 잘못된 구현이 이걸 통과하는가?** `toEqual`/`toHaveLength` 를 쓰고, `toContain` 은 부분 일치가 실제 의도일 때만 이유를 달아 쓴다.
- jsdom 이 필요한 파일은 `// @vitest-environment jsdom` docblock 을 단다. 이 계획의 테스트는 전부 node 환경이라 필요 없다.
- `@testing-library/jest-dom` 은 **설치돼 있지 않다.** `toBeInTheDocument` 없다.
- **변이 검증은 커밋 뒤에 한다.** 커밋 전 `git checkout --` 되돌리기는 이 저장소에서 실제 작업을 날린 적이 있다.

## 파일 구조

| 파일 | 책임 | 상태 |
|---|---|---|
| `lib/model/defaults.ts` | 기본값과 **새 규칙 세트를 만드는 단 하나의 정의** | 수정 (Task 1) |
| `entrypoints/popup/App.tsx` | 자기 사본 대신 defaults.ts 를 부른다 | 수정 (Task 1) |
| `lib/bridge/protocol.ts` | 명령의 모양과 결과 타입. 순수 | 신규 (Task 2) |
| `lib/bridge/apply.ts` | `(AppState, Command) → ApplyResult`. 순수 | 신규 (Task 3–5) |
| `tests/unit/purity.test.ts` | 순수 가드의 손목록 | 수정 (Task 1–3) |
| `tests/unit/defaults.test.ts` | 부트스트랩 규칙 세트의 계약 | 신규 (Task 1) |
| `tests/unit/protocol.test.ts` | 명령 파싱의 계약 | 신규 (Task 2) |
| `tests/unit/apply.test.ts` | 리듀서의 계약 | 신규 (Task 3–5) |
| `docs/research/2026-08-11-native-messaging-spike.md` | 실측 기록 | 신규 (Task 6) |

---

### Task 1: 부트스트랩 규칙 세트를 한 곳으로 모은다

`App.tsx` 가 `newRule()` 과 `bootstrapProfile()` 을 자기 안에 갖고 있다. `apply.ts` 도 같은 것이 필요하다 — 빈 저장소에 규칙을 넣으라는 명령이 오면 규칙 세트가 있어야 한다. **두 번째 사본을 만들기 전에 옮긴다.** 이 저장소에서 가장 비쌌던 결함이 "같은 판단을 네 번 구현하고 갈라진 것"이었다.

같은 태스크에서 `lib/model/defaults.ts` 를 순수 가드에 넣는다. 가드는 파일 자기 소스만 훑으므로, 가드된 `apply.ts` 가 가드 안 된 `defaults.ts` 를 임포트하면 브라우저 의존성이 한 칸 건너 들어와도 아무도 못 잡는다.

**Files:**
- Modify: `lib/model/defaults.ts`
- Modify: `entrypoints/popup/App.tsx:16-45`
- Modify: `tests/unit/purity.test.ts:20-29`, `:74-82`
- Test: `tests/unit/defaults.test.ts` (신규)

**Interfaces:**
- Produces: `newRule(): HeaderRule`, `bootstrapProfile(): Profile` — `@/lib/model/defaults` 에서. Task 3–5 가 `bootstrapProfile` 을 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/defaults.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bootstrapProfile, newRule, STATE_VERSION } from '@/lib/model/defaults';
import { parseAppState } from '@/lib/model/schema';

describe('newRule', () => {
  it('is born unnamed and switched on', () => {
    const rule = newRule();
    expect(rule.name).toBe('');
    expect(rule.value).toBe('');
    expect(rule.enabled).toBe(true);
    expect(rule.target).toBe('request');
    expect(rule.operation).toBe('set');
  });

  it('mints a fresh id per call — a shared constant would repeat ids', () => {
    expect(newRule().id).not.toBe(newRule().id);
  });
});

describe('bootstrapProfile', () => {
  it('opens with exactly one rule, ready to be named', () => {
    const profile = bootstrapProfile();
    expect(profile.headers).toHaveLength(1);
    expect(profile.headers[0]!.name).toBe('');
  });

  it('is unscoped — nothing applies until a site is added', () => {
    const profile = bootstrapProfile();
    expect(profile.filter.allSites).toBe(false);
    expect(profile.filter.domains).toEqual([]);
  });

  it('mints a fresh id per call', () => {
    expect(bootstrapProfile().id).not.toBe(bootstrapProfile().id);
  });

  it('produces a state the schema accepts', () => {
    const state = {
      version: STATE_VERSION,
      profiles: [bootstrapProfile()],
      globalPause: false,
      theme: 'system',
    };
    expect(parseAppState(state).profiles).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test -- tests/unit/defaults.test.ts`
Expected: FAIL — `bootstrapProfile` 과 `newRule` 이 `@/lib/model/defaults` 에서 export 되지 않는다.

- [ ] **Step 3: defaults.ts 로 옮긴다**

`lib/model/defaults.ts` 의 `import type` 줄에 `HeaderRule` 을 더하고, 파일 끝에 붙인다:

```ts
/**
 * 새 규칙 한 줄. 이름 없이 태어나는 것이 정상이다 — 팝업은 규칙을 비워서
 * 만들고, 그래서 `incomplete-header` 가 `invalid-header-name` 과 별개의
 * 진단으로 존재한다.
 */
export function newRule(): HeaderRule {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    target: 'request',
    operation: 'set',
    name: '',
    value: '',
  };
}

/**
 * 빈 저장소가 처음 열릴 때 만들어지는 암묵적 규칙 세트.
 *
 * **모듈 상수가 아니라 함수다.** 상수라면 임포트 시점에 `crypto.randomUUID()`
 * 가 돌아 아무도 안 쓰는 id 를 매번 만들고, 백그라운드와 팝업이 같은 규칙
 * 세트에 서로 다른 id 를 갖게 된다.
 *
 * 팝업(App.tsx)과 브리지(lib/bridge/apply.ts)가 **둘 다 이걸 부른다.** 사본을
 * 만들지 말 것 — 갈라진 정의는 이 저장소에서 가장 비쌌던 결함이다.
 */
export function bootstrapProfile(): Profile {
  return { ...createProfile('Default', 0), headers: [newRule()] };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm test -- tests/unit/defaults.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: App.tsx 가 사본 대신 그걸 부르게 한다**

`entrypoints/popup/App.tsx` 에서 `newRule` 과 `bootstrapProfile` 함수 정의(및 `bootstrapProfile` 위의 docblock)를 지우고, 기존 import 줄을 바꾼다:

```ts
import { bootstrapProfile, createProfile, newRule } from '@/lib/model/defaults';
```

`createProfile` 이 App.tsx 의 다른 곳에서 안 쓰이면 목록에서 뺀다 — oxlint 의 correctness 가 미사용 임포트를 잡는다.

- [ ] **Step 6: defaults.ts 를 순수 가드에 넣는다**

`tests/unit/purity.test.ts` 의 `EXPLICIT` 배열 끝에 더한다:

```ts
  // `apply.ts` 와 `App.tsx` 가 둘 다 부트스트랩 규칙 세트를 여기서 가져간다.
  // 가드는 파일 자기 소스만 훑으므로, 가드된 `apply.ts` 가 가드 안 된 이
  // 파일을 임포트하면 브라우저 의존성이 한 칸 건너 들어와도 아무도 못 잡는다.
  'lib/model/defaults.ts',
```

그리고 `:77-81` 의 정확값 단언에도 같은 줄을 더한다:

```ts
    expect(EXPLICIT).toEqual([
      'lib/permissions/origins.ts',
      'lib/permissions/audit.ts',
      'lib/model/migrate.ts',
      'lib/model/defaults.ts',
    ]);
```

- [ ] **Step 7: 전체를 돌린다**

Run: `pnpm check`
Expected: typecheck · lint · format · test 전부 통과. App.tsx 테스트가 여전히 초록인지 확인한다 — 팝업의 부트스트랩 동작은 바뀌지 않았다.

- [ ] **Step 8: 커밋**

```bash
git add lib/model/defaults.ts entrypoints/popup/App.tsx tests/unit/purity.test.ts tests/unit/defaults.test.ts
git commit -m "refactor: move the bootstrap rule set into defaults.ts

The bridge needs the same implicit rule set the popup mints on an empty
store, and a second copy of it is how the aliveness predicate came to be
implemented four times. defaults.ts is where createProfile already lives.

Guarded as pure in the same commit: purity.test.ts greps each file's own
source, so a guarded apply.ts importing an unguarded defaults.ts would let
a browser dependency in one hop away with nothing to catch it."
```

---

### Task 2: `lib/bridge/protocol.ts` — 명령의 모양

CLI 가 보내는 것은 신뢰 경계 너머의 바이트다. zod 가 그 경계다.

**Files:**
- Create: `lib/bridge/protocol.ts`
- Modify: `tests/unit/purity.test.ts`
- Test: `tests/unit/protocol.test.ts` (신규)

**Interfaces:**
- Consumes: `AppState` (`@/lib/model/types`)
- Produces:
  - `commandSchema` — zod discriminated union, 판별자는 `cmd`
  - `type Command = z.infer<typeof commandSchema>`
  - `parseCommand(input: unknown): Command` — 실패 시 throw
  - `type ApplyErrorCode = 'invalid-command' | 'invalid-state' | 'unknown-rule' | 'unknown-domain'`
  - `interface ApplyError { code: ApplyErrorCode; message: string }`
  - `type ApplyResult = { ok: true; state: AppState; changed: boolean; note?: string } | { ok: false; error: ApplyError }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseCommand } from '@/lib/bridge/protocol';

describe('parseCommand', () => {
  it('rejects a command it does not know', () => {
    expect(() => parseCommand({ cmd: 'rm -rf' })).toThrow();
  });

  it('rejects a payload with no cmd at all', () => {
    expect(() => parseCommand({ domains: ['example.com'] })).toThrow();
  });

  it('reads site.add with its domains', () => {
    expect(parseCommand({ cmd: 'site.add', domains: ['a.example.com'] })).toEqual({
      cmd: 'site.add',
      domains: ['a.example.com'],
    });
  });

  // A command that cannot change anything is a mistake worth naming, not a
  // no-op worth accepting: the caller asked for something and nothing would
  // happen, with nothing said.
  it('rejects site.add with an empty domain list', () => {
    expect(() => parseCommand({ cmd: 'site.add', domains: [] })).toThrow();
  });

  it('rejects site.add with an empty string as a domain', () => {
    expect(() => parseCommand({ cmd: 'site.add', domains: [''] })).toThrow();
  });

  it('defaults rule.add value to the empty string', () => {
    expect(
      parseCommand({ cmd: 'rule.add', target: 'request', operation: 'remove', name: 'X-Trace' }),
    ).toEqual({
      cmd: 'rule.add',
      target: 'request',
      operation: 'remove',
      name: 'X-Trace',
      value: '',
    });
  });

  it('rejects a target the model does not have', () => {
    expect(() =>
      parseCommand({ cmd: 'rule.add', target: 'trailer', operation: 'set', name: 'X', value: '1' }),
    ).toThrow();
  });

  // Omitted `on` means "flip it", which apply() resolves against the current
  // value. Requiring it would make the CLI read before every toggle.
  it('allows rule.toggle without an explicit on', () => {
    expect(parseCommand({ cmd: 'rule.toggle', id: 'r1' })).toEqual({ cmd: 'rule.toggle', id: 'r1' });
  });

  it('reads rule.toggle with an explicit on', () => {
    expect(parseCommand({ cmd: 'rule.toggle', id: 'r1', on: false })).toEqual({
      cmd: 'rule.toggle',
      id: 'r1',
      on: false,
    });
  });

  it('reads pause and resume, which carry nothing', () => {
    expect(parseCommand({ cmd: 'pause' })).toEqual({ cmd: 'pause' });
    expect(parseCommand({ cmd: 'resume' })).toEqual({ cmd: 'resume' });
  });

  // The payload is deliberately unknown here. Validating it against
  // appStateSchema is apply()'s job, so that a bad payload comes back as a
  // structured invalid-state error rather than as a parse throw three
  // processes away from the person who typed it.
  it('accepts state.set without judging its payload', () => {
    expect(parseCommand({ cmd: 'state.set', state: { nonsense: true } })).toEqual({
      cmd: 'state.set',
      state: { nonsense: true },
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test -- tests/unit/protocol.test.ts`
Expected: FAIL — `@/lib/bridge/protocol` 을 못 찾는다.

- [ ] **Step 3: protocol.ts 를 쓴다**

```ts
import { z } from 'zod';
import type { AppState } from '@/lib/model/types';

/**
 * 브리지가 받는 명령의 모양.
 *
 * 읽기 명령(`state get`, `status`, `diagnostics`)은 여기 없다. 그것들은
 * 상태를 바꾸지 않으므로 `compile()` 과 `ruleTally()` 를 그대로 부르면 되고,
 * 리듀서를 통과할 이유가 없다. 이 스키마는 **쓰기**의 목록이다.
 *
 * 판별자가 `cmd` 인 discriminated union 인 이유: 알 수 없는 명령이
 * "필드가 하나도 안 맞는 union" 이 아니라 "그런 cmd 는 없다" 로 실패해야
 * CLI 가 사람에게 읽을 만한 말을 돌려줄 수 있다.
 */
export const commandSchema = z.discriminatedUnion('cmd', [
  z.object({ cmd: z.literal('site.add'), domains: z.array(z.string().min(1)).min(1) }),
  z.object({ cmd: z.literal('site.remove'), domains: z.array(z.string().min(1)).min(1) }),
  z.object({ cmd: z.literal('site.allSites'), on: z.boolean() }),
  z.object({
    cmd: z.literal('rule.add'),
    target: z.enum(['request', 'response']),
    operation: z.enum(['set', 'append', 'remove']),
    name: z.string(),
    // `remove` 는 값을 갖지 않는다(types.ts). 생략을 허용하되 빈 문자열로
    // 정규화해, 저장되는 모양이 늘 하나가 되게 한다.
    value: z.string().default(''),
  }),
  z.object({ cmd: z.literal('rule.remove'), id: z.string().min(1) }),
  // `on` 생략은 "뒤집어라". 요구하면 CLI 가 토글마다 먼저 읽어야 한다.
  z.object({ cmd: z.literal('rule.toggle'), id: z.string().min(1), on: z.boolean().optional() }),
  z.object({ cmd: z.literal('pause') }),
  z.object({ cmd: z.literal('resume') }),
  // 페이로드는 일부러 검사하지 않는다. `appStateSchema` 로 거르는 것은
  // apply() 의 몫이고, 그래야 나쁜 페이로드가 파싱 throw 가 아니라 구조화된
  // `invalid-state` 로 돌아온다 — 타이핑한 사람은 세 프로세스 건너에 있다.
  z.object({ cmd: z.literal('state.set'), state: z.unknown() }),
]);

export type Command = z.infer<typeof commandSchema>;

/** 실패 시 throw. 신뢰 경계에서 부른다. */
export function parseCommand(input: unknown): Command {
  return commandSchema.parse(input);
}

export type ApplyErrorCode =
  | 'invalid-command'
  | 'invalid-state'
  | 'unknown-rule'
  | 'unknown-domain';

export interface ApplyError {
  code: ApplyErrorCode;
  message: string;
}

/**
 * `changed` 는 `ok` 와 다른 사실이다.
 *
 * 이미 있는 사이트를 다시 더하는 것은 실패가 아니다 — 요청한 상태가 이미
 * 참이다. 하지만 아무 일도 안 일어났다는 것은 말해져야 한다. 팝업의
 * AddSiteField 가 `{added:false, alreadyThere}` 를 돌려주는 것과 같은 구분이고,
 * 같은 구분이어야 한다.
 */
export type ApplyResult =
  | { ok: true; state: AppState; changed: boolean; note?: string }
  | { ok: false; error: ApplyError };
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm test -- tests/unit/protocol.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: 순수 가드에 넣는다**

`tests/unit/purity.test.ts` 의 `EXPLICIT` 에 더하고 정확값 단언도 같이 고친다. **`lib/bridge/` 는 자동 탐색 대상이 아니다** — 자동 탐색은 `lib/compile` 과 `lib/view` 뿐이고, 이 디렉터리는 나중에 어댑터(`port.ts`)를 갖게 되므로 디렉터리 규칙을 만들 수 없다.

```ts
  // lib/permissions/ 와 같은 사정이다: 이 디렉터리는 곧 어댑터(port.ts)도
  // 갖게 되므로 디렉터리 모양의 규칙이 있을 수 없다. 이름으로 적지 않으면
  // 가드가 없다.
  'lib/bridge/protocol.ts',
```

- [ ] **Step 6: 커밋**

```bash
git add lib/bridge/protocol.ts tests/unit/protocol.test.ts tests/unit/purity.test.ts
git commit -m "feat: define the bridge command schema

Writes only. Reads change nothing and go straight to compile(), so putting
them through a reducer would add a shape without adding a check.

state.set carries its payload unvalidated on purpose: appStateSchema runs
inside apply(), so a bad payload comes back as a structured invalid-state
error rather than as a parse throw three processes from whoever typed it."
```

---

### Task 3: `apply.ts` — 사이트 명령

**Files:**
- Create: `lib/bridge/apply.ts`
- Modify: `tests/unit/purity.test.ts`
- Test: `tests/unit/apply.test.ts` (신규)

**Interfaces:**
- Consumes: `Command`·`ApplyResult` (`@/lib/bridge/protocol`), `bootstrapProfile` (`@/lib/model/defaults`), `effectiveDomain` (`@/lib/permissions/origins`), `resolveSingleProfile` (`@/lib/view/singleProfile`)
- Produces: `apply(state: AppState, command: Command): ApplyResult`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/apply.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { apply } from '@/lib/bridge/apply';
import { bootstrapProfile, STATE_VERSION } from '@/lib/model/defaults';
import type { AppState, Profile } from '@/lib/model/types';

function stateWith(profile: Profile): AppState {
  return { version: STATE_VERSION, profiles: [profile], globalPause: false, theme: 'system' };
}

function scoped(domains: string[]): AppState {
  const profile = bootstrapProfile();
  return stateWith({ ...profile, filter: { ...profile.filter, domains } });
}

const EMPTY: AppState = {
  version: STATE_VERSION,
  profiles: [],
  globalPause: false,
  theme: 'system',
};

/** Narrows the result and fails loudly instead of silently skipping. */
function ok(result: ReturnType<typeof apply>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result;
}

describe('apply — site.add', () => {
  it('adds a normalized host', () => {
    const result = ok(apply(scoped([]), { cmd: 'site.add', domains: ['api.example.com'] }));
    expect(result.state.profiles[0]!.filter.domains).toEqual(['api.example.com']);
    expect(result.changed).toBe(true);
  });

  // The stored value IS the value that operates (origins.ts), so a port or a
  // path has to be gone by the time it reaches storage — not stripped again at
  // every read.
  it('stores the host, not what was typed', () => {
    const result = ok(apply(scoped([]), { cmd: 'site.add', domains: ['https://x.com:8443/a/b'] }));
    expect(result.state.profiles[0]!.filter.domains).toEqual(['x.com']);
  });

  it('adds several at once', () => {
    const result = ok(apply(scoped([]), { cmd: 'site.add', domains: ['a.com', 'b.com'] }));
    expect(result.state.profiles[0]!.filter.domains).toEqual(['a.com', 'b.com']);
  });

  // Not an error: the requested state is already true. But nothing happened,
  // and that has to be said — the same distinction AddSiteField makes.
  it('is not an error to add one that is already there, and reports no change', () => {
    const result = ok(apply(scoped(['a.com']), { cmd: 'site.add', domains: ['a.com'] }));
    expect(result.changed).toBe(false);
    expect(result.state.profiles[0]!.filter.domains).toEqual(['a.com']);
    expect(result.note).toContain('a.com');
  });

  it('recognises a duplicate written a different way', () => {
    const result = ok(apply(scoped(['x.com']), { cmd: 'site.add', domains: ['https://x.com/p'] }));
    expect(result.changed).toBe(false);
    expect(result.state.profiles[0]!.filter.domains).toEqual(['x.com']);
  });

  it('adds the new one and skips the duplicate in one command', () => {
    const result = ok(apply(scoped(['a.com']), { cmd: 'site.add', domains: ['a.com', 'b.com'] }));
    expect(result.changed).toBe(true);
    expect(result.state.profiles[0]!.filter.domains).toEqual(['a.com', 'b.com']);
  });

  it('mints the implicit rule set when storage holds none', () => {
    const result = ok(apply(EMPTY, { cmd: 'site.add', domains: ['a.com'] }));
    expect(result.state.profiles).toHaveLength(1);
    expect(result.state.profiles[0]!.filter.domains).toEqual(['a.com']);
    expect(result.state.profiles[0]!.headers).toHaveLength(1);
  });

  it('does not mutate the state it was given', () => {
    const before = scoped([]);
    apply(before, { cmd: 'site.add', domains: ['a.com'] });
    expect(before.profiles[0]!.filter.domains).toEqual([]);
  });
});

describe('apply — site.remove', () => {
  it('removes by host', () => {
    const result = ok(apply(scoped(['a.com', 'b.com']), { cmd: 'site.remove', domains: ['a.com'] }));
    expect(result.state.profiles[0]!.filter.domains).toEqual(['b.com']);
    expect(result.changed).toBe(true);
  });

  // Someone removing a site types what the rail shows them, which is the
  // effective host — while storage may still hold a raw value written before
  // normalization existed.
  it('removes a raw stored entry when given its effective host', () => {
    const result = ok(
      apply(scoped(['https://a.com:80/']), { cmd: 'site.remove', domains: ['a.com'] }),
    );
    expect(result.state.profiles[0]!.filter.domains).toEqual([]);
  });

  it('names a domain that is not there rather than reporting success', () => {
    const result = apply(scoped(['a.com']), { cmd: 'site.remove', domains: ['b.com'] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('unknown-domain');
    expect(result.error.message).toContain('b.com');
  });

  it('removes nothing at all when one of several is unknown', () => {
    const result = apply(scoped(['a.com']), { cmd: 'site.remove', domains: ['a.com', 'b.com'] });
    expect(result.ok).toBe(false);
  });
});

describe('apply — site.allSites', () => {
  it('turns the mode on and keeps the stored list', () => {
    const result = ok(apply(scoped(['a.com']), { cmd: 'site.allSites', on: true }));
    expect(result.state.profiles[0]!.filter.allSites).toBe(true);
    // Keeping the list is what makes the switch reversible.
    expect(result.state.profiles[0]!.filter.domains).toEqual(['a.com']);
    expect(result.changed).toBe(true);
  });

  it('reports no change when the mode is already what was asked for', () => {
    const on = ok(apply(scoped([]), { cmd: 'site.allSites', on: true })).state;
    const again = ok(apply(on, { cmd: 'site.allSites', on: true }));
    expect(again.changed).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test -- tests/unit/apply.test.ts`
Expected: FAIL — `@/lib/bridge/apply` 를 못 찾는다.

- [ ] **Step 3: apply.ts 를 쓴다**

```ts
import { bootstrapProfile } from '@/lib/model/defaults';
import { effectiveDomain } from '@/lib/permissions/origins';
import { resolveSingleProfile } from '@/lib/view/singleProfile';
import type { ApplyResult, Command } from '@/lib/bridge/protocol';
import type { AppState, Profile } from '@/lib/model/types';

/**
 * 브리지 명령 하나를 상태 변경으로 바꾼다. 순수.
 *
 * **이 화면이 보여주는 하나의 규칙 세트에만 손댄다.** 저장소가 여럿을 들고
 * 있으면 `resolveSingleProfile` 이 고르는 첫 번째만 바꾸고 나머지는 건드리지
 * 않는다. 잘라내는 것은 팝업의 쓰기이고(App.tsx), 그 판단을 여기서 두 번째로
 * 구현하면 갈라진다.
 *
 * 저장소가 비어 있으면 팝업이 여는 것과 **같은** 암묵적 규칙 세트를 만든다 —
 * `bootstrapProfile()` 을 부르지, 그 모양을 다시 적지 않는다.
 */
/**
 * 손댈 규칙 세트와, 그것이 실제로 들어있는 상태를 함께 돌려준다.
 *
 * **게으르게 부른다.** `pause` 는 최상위 키만 건드리므로 이걸 부르면 안 된다 —
 * 부르면 빈 저장소에 아무도 요청하지 않은 규칙 세트가 생긴다. 규칙 세트를
 * 건드리는 case 안에서만 부른다.
 */
function seed(state: AppState): { base: AppState; active: Profile } {
  const { profile } = resolveSingleProfile(state.profiles);
  if (profile) return { base: state, active: profile };
  const minted = bootstrapProfile();
  return { base: { ...state, profiles: [minted] }, active: minted };
}

function replace(base: AppState, next: Profile, changed: boolean, note?: string): ApplyResult {
  return {
    ok: true,
    state: { ...base, profiles: base.profiles.map((p) => (p.id === next.id ? next : p)) },
    changed,
    ...(note === undefined ? {} : { note }),
  };
}

export function apply(state: AppState, command: Command): ApplyResult {
  switch (command.cmd) {
    case 'site.add': {
      const { base, active } = seed(state);
      const existing = new Set(active.filter.domains.map(effectiveDomain));
      const fresh: string[] = [];
      const already: string[] = [];
      for (const typed of command.domains) {
        const host = effectiveDomain(typed);
        if (existing.has(host)) {
          already.push(host);
          continue;
        }
        existing.add(host);
        fresh.push(host);
      }
      const domains = [...active.filter.domains, ...fresh];
      const note = already.length === 0 ? undefined : `already listed: ${already.join(', ')}`;
      return replace(
        base,
        { ...active, filter: { ...active.filter, domains } },
        fresh.length > 0,
        note,
      );
    }

    case 'site.remove': {
      const { base, active } = seed(state);
      // 전부 있는지 먼저 확인하고, 하나라도 없으면 아무것도 지우지 않는다.
      // 부분 적용은 "무엇이 지워졌는지" 를 되물어야만 알 수 있게 만든다.
      const wanted = command.domains.map(effectiveDomain);
      const present = new Set(active.filter.domains.map(effectiveDomain));
      const missing = wanted.filter((host) => !present.has(host));
      if (missing.length > 0) {
        return {
          ok: false,
          error: { code: 'unknown-domain', message: `not in the site list: ${missing.join(', ')}` },
        };
      }
      const drop = new Set(wanted);
      const domains = active.filter.domains.filter((d) => !drop.has(effectiveDomain(d)));
      return replace(base, { ...active, filter: { ...active.filter, domains } }, true);
    }

    case 'site.allSites': {
      const { base, active } = seed(state);
      if (active.filter.allSites === command.on) return replace(base, active, false);
      // 목록은 남긴다. 그게 스위치를 되돌릴 수 있게 하는 것이고, 끄면 사용자가
      // 쌓아둔 스코프가 돌아온다.
      return replace(base, { ...active, filter: { ...active.filter, allSites: command.on } }, true);
    }

    default:
      return {
        ok: false,
        error: { code: 'invalid-command', message: `unhandled command: ${command.cmd}` },
      };
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm test -- tests/unit/apply.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: 순수 가드에 넣는다**

`tests/unit/purity.test.ts` 의 `EXPLICIT` 와 그 정확값 단언에 `'lib/bridge/apply.ts'` 를 더한다. 이 시점의 `EXPLICIT` 은 여섯 개다:

```ts
    expect(EXPLICIT).toEqual([
      'lib/permissions/origins.ts',
      'lib/permissions/audit.ts',
      'lib/model/migrate.ts',
      'lib/model/defaults.ts',
      'lib/bridge/protocol.ts',
      'lib/bridge/apply.ts',
    ]);
```

- [ ] **Step 6: 커밋**

```bash
git add lib/bridge/apply.ts tests/unit/apply.test.ts tests/unit/purity.test.ts
git commit -m "feat: apply site commands to state

Normalizes on the way in, so the stored value is the value that operates —
the same bargain AddSiteField makes, reached through effectiveDomain rather
than restated.

site.remove is all-or-nothing. A partial removal leaves the caller having to
ask what actually went, which is the shape of a silent failure even when
every individual step succeeded."
```

---

### Task 4: `apply.ts` — 규칙 명령

**Files:**
- Modify: `lib/bridge/apply.ts`
- Test: `tests/unit/apply.test.ts` (추가)

**Interfaces:**
- Consumes: `newRule` (`@/lib/model/defaults`) — Task 1 이 만든 것
- Produces: 없음. `apply` 의 시그니처는 그대로다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

먼저 **파일 맨 위의 기존 import 블록**을 넓힌다 — `import` 는 파일 중간에 올 수 없다:

```ts
import { apply } from '@/lib/bridge/apply';
import { bootstrapProfile, newRule, STATE_VERSION } from '@/lib/model/defaults';
import type { AppState, HeaderRule, Profile } from '@/lib/model/types';
```

그다음 파일 끝에 붙인다. 위쪽의 `stateWith`·`scoped`·`ok` 헬퍼를 그대로 쓴다.

```ts
function ruled(...headers: HeaderRule[]): AppState {
  const profile = bootstrapProfile();
  return stateWith({ ...profile, headers });
}

const AUTH: HeaderRule = {
  id: 'r-auth',
  enabled: true,
  target: 'request',
  operation: 'set',
  name: 'Authorization',
  value: 'Bearer old',
};

describe('apply — rule.add', () => {
  it('appends a rule with the fields it was given', () => {
    const result = ok(
      apply(ruled(), {
        cmd: 'rule.add',
        target: 'response',
        operation: 'set',
        name: 'Cache-Control',
        value: 'no-store',
      }),
    );
    const rules = result.state.profiles[0]!.headers;
    expect(rules).toHaveLength(1);
    expect(rules[0]!.target).toBe('response');
    expect(rules[0]!.operation).toBe('set');
    expect(rules[0]!.name).toBe('Cache-Control');
    expect(rules[0]!.value).toBe('no-store');
    expect(rules[0]!.enabled).toBe(true);
  });

  it('appends after the rules already there', () => {
    const result = ok(
      apply(ruled(AUTH), {
        cmd: 'rule.add',
        target: 'request',
        operation: 'set',
        name: 'X-Debug',
        value: '1',
      }),
    );
    expect(result.state.profiles[0]!.headers.map((h) => h.name)).toEqual([
      'Authorization',
      'X-Debug',
    ]);
  });

  it('gives each added rule its own id', () => {
    const once = ok(
      apply(ruled(), { cmd: 'rule.add', target: 'request', operation: 'set', name: 'A', value: '1' }),
    ).state;
    const twice = ok(
      apply(once, { cmd: 'rule.add', target: 'request', operation: 'set', name: 'B', value: '2' }),
    ).state;
    const [first, second] = twice.profiles[0]!.headers;
    expect(first!.id).not.toBe(second!.id);
  });

  // types.ts: "Empty string when operation is 'remove'. The compiler drops the
  // field entirely." A value carried on a remove would be dead data that reads
  // as meaningful.
  it('drops a value handed to a remove', () => {
    const result = ok(
      apply(ruled(), {
        cmd: 'rule.add',
        target: 'response',
        operation: 'remove',
        name: 'Content-Security-Policy',
        value: 'ignored',
      }),
    );
    expect(result.state.profiles[0]!.headers[0]!.value).toBe('');
  });
});

describe('apply — rule.remove', () => {
  it('removes the named rule and leaves the rest', () => {
    const other = { ...newRule(), id: 'r-other', name: 'X-Other' };
    const result = ok(apply(ruled(AUTH, other), { cmd: 'rule.remove', id: 'r-auth' }));
    expect(result.state.profiles[0]!.headers.map((h) => h.id)).toEqual(['r-other']);
    expect(result.changed).toBe(true);
  });

  it('names an id that is not there rather than reporting success', () => {
    const result = apply(ruled(AUTH), { cmd: 'rule.remove', id: 'nope' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('unknown-rule');
    expect(result.error.message).toContain('nope');
  });
});

describe('apply — rule.toggle', () => {
  it('flips an on rule off when told nothing', () => {
    const result = ok(apply(ruled(AUTH), { cmd: 'rule.toggle', id: 'r-auth' }));
    expect(result.state.profiles[0]!.headers[0]!.enabled).toBe(false);
    expect(result.changed).toBe(true);
  });

  it('flips an off rule on when told nothing', () => {
    const result = ok(
      apply(ruled({ ...AUTH, enabled: false }), { cmd: 'rule.toggle', id: 'r-auth' }),
    );
    expect(result.state.profiles[0]!.headers[0]!.enabled).toBe(true);
  });

  it('sets rather than flips when told explicitly', () => {
    const result = ok(apply(ruled(AUTH), { cmd: 'rule.toggle', id: 'r-auth', on: true }));
    expect(result.state.profiles[0]!.headers[0]!.enabled).toBe(true);
    // Already on, so nothing moved — an explicit set is idempotent and says so.
    expect(result.changed).toBe(false);
  });

  it('names an id that is not there', () => {
    const result = apply(ruled(AUTH), { cmd: 'rule.toggle', id: 'nope' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('unknown-rule');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test -- tests/unit/apply.test.ts`
Expected: FAIL — 새 describe 블록들이 `invalid-command` 를 받는다(아직 `default` 로 떨어진다).

- [ ] **Step 3: 구현한다**

`lib/bridge/apply.ts` 의 import 에 `newRule` 을 더하고(`import { bootstrapProfile, newRule } from '@/lib/model/defaults';`), `switch` 의 `default` 앞에 세 case 를 넣는다.

```ts
    case 'rule.add': {
      const { base, active } = seed(state);
      // `remove` 는 값을 갖지 않는다(types.ts). 여기서 떨어뜨려, 저장되는
      // 모양이 늘 하나가 되게 한다 — 죽은 값이 의미 있는 것처럼 읽히는 일이
      // 없도록.
      const value = command.operation === 'remove' ? '' : command.value;
      const rule = {
        ...newRule(),
        target: command.target,
        operation: command.operation,
        name: command.name,
        value,
      };
      return replace(base, { ...active, headers: [...active.headers, rule] }, true);
    }

    case 'rule.remove': {
      const { base, active } = seed(state);
      if (!active.headers.some((h) => h.id === command.id)) {
        return {
          ok: false,
          error: { code: 'unknown-rule', message: `no rule with id ${command.id}` },
        };
      }
      return replace(
        base,
        { ...active, headers: active.headers.filter((h) => h.id !== command.id) },
        true,
      );
    }

    case 'rule.toggle': {
      const { base, active } = seed(state);
      const current = active.headers.find((h) => h.id === command.id);
      if (!current) {
        return {
          ok: false,
          error: { code: 'unknown-rule', message: `no rule with id ${command.id}` },
        };
      }
      const next = command.on ?? !current.enabled;
      if (next === current.enabled) return replace(base, active, false);
      return replace(
        base,
        {
          ...active,
          headers: active.headers.map((h) => (h.id === command.id ? { ...h, enabled: next } : h)),
        },
        true,
      );
    }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm test -- tests/unit/apply.test.ts`
Expected: PASS, 25 tests.

- [ ] **Step 5: 커밋**

```bash
git add lib/bridge/apply.ts tests/unit/apply.test.ts
git commit -m "feat: apply rule commands to state

A value handed to a remove is dropped rather than stored. types.ts says the
field is empty for that operation and the compiler drops it anyway, so
keeping it would be dead data that reads as meaningful.

An explicit rule.toggle --on against a rule that is already on succeeds and
reports changed: false. Calling that an error would make the CLI read before
every write to avoid a failure that is not one."
```

---

### Task 5: `apply.ts` — 실행 상태와 통째 쓰기

**Files:**
- Modify: `lib/bridge/apply.ts`
- Test: `tests/unit/apply.test.ts` (추가)

**Interfaces:**
- Consumes: `parseAppState` (`@/lib/model/schema`)
- Produces: 없음.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/apply.test.ts` 끝에 붙인다.

```ts
describe('apply — pause and resume', () => {
  it('pauses', () => {
    const result = ok(apply(scoped(['a.com']), { cmd: 'pause' }));
    expect(result.state.globalPause).toBe(true);
    expect(result.changed).toBe(true);
  });

  it('reports no change when already paused', () => {
    const paused = ok(apply(scoped([]), { cmd: 'pause' })).state;
    expect(ok(apply(paused, { cmd: 'pause' })).changed).toBe(false);
  });

  it('resumes', () => {
    const paused = ok(apply(scoped([]), { cmd: 'pause' })).state;
    const result = ok(apply(paused, { cmd: 'resume' }));
    expect(result.state.globalPause).toBe(false);
    expect(result.changed).toBe(true);
  });

  // globalPause is a top-level key. Minting a rule set as a side effect of
  // pausing would write a profile nobody asked for onto an empty store.
  it('does not mint a rule set on an empty store', () => {
    const result = ok(apply(EMPTY, { cmd: 'pause' }));
    expect(result.state.profiles).toEqual([]);
    expect(result.state.globalPause).toBe(true);
  });
});

describe('apply — state.set', () => {
  it('replaces the whole state when it validates', () => {
    const incoming = scoped(['fresh.example.com']);
    const result = ok(apply(scoped(['old.example.com']), { cmd: 'state.set', state: incoming }));
    expect(result.state.profiles[0]!.filter.domains).toEqual(['fresh.example.com']);
    expect(result.changed).toBe(true);
  });

  // A store that fails validation is never compiled, so there is nothing to
  // neutralise and nothing to justify writing over the caller's bytes.
  it('refuses a payload the schema rejects and leaves the state alone', () => {
    const before = scoped(['keep.example.com']);
    const result = apply(before, { cmd: 'state.set', state: { version: 2, profiles: 'no' } });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('invalid-state');
    expect(before.profiles[0]!.filter.domains).toEqual(['keep.example.com']);
  });

  it('refuses a payload that is not an object at all', () => {
    const result = apply(scoped([]), { cmd: 'state.set', state: 'wat' });
    expect(result.ok).toBe(false);
  });

  // The message has to name the field. A caller three processes away cannot
  // read the zod error off a console that closed.
  it('says which field was wrong', () => {
    const result = apply(scoped([]), { cmd: 'state.set', state: { version: 2, profiles: [] } });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.message).toContain('globalPause');
  });

  it('accepts a state with no profiles without minting one', () => {
    const result = ok(apply(scoped(['a.com']), { cmd: 'state.set', state: EMPTY }));
    expect(result.state.profiles).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test -- tests/unit/apply.test.ts`
Expected: FAIL — 새 케이스들이 `invalid-command` 로 떨어진다.

- [ ] **Step 3: 구현한다**

`pause`·`resume`·`state.set` 은 규칙 세트가 아니라 **상태 전체**를 건드리므로 `replace()` 를 쓰지 않는다. `seeded` 도 쓰지 않는다 — 빈 저장소에서 일시정지했다고 아무도 요청하지 않은 규칙 세트를 만들어 쓰면 안 된다.

`apply.ts` 상단에 `import { parseAppState } from '@/lib/model/schema';` 를 더하고, `switch` 의 `default` 앞에 넣는다:

```ts
    case 'pause':
    case 'resume': {
      const paused = command.cmd === 'pause';
      // `seeded` 가 아니라 `state`. 일시정지는 최상위 키이고, 그것 때문에
      // 규칙 세트가 생겨서는 안 된다.
      if (state.globalPause === paused) return { ok: true, state, changed: false };
      return { ok: true, state: { ...state, globalPause: paused }, changed: true };
    }

    case 'state.set': {
      try {
        // 검증을 통과하지 못한 저장소는 컴파일되지 않으므로 중화할 것도 없고,
        // 남의 바이트를 덮어쓸 근거도 없다. 거절하고 그대로 둔다.
        return { ok: true, state: parseAppState(command.state), changed: true };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'invalid-state',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm test -- tests/unit/apply.test.ts`
Expected: PASS, 34 tests.

**"says which field was wrong" 이 실패하면** zod 의 기본 메시지가 경로를 안 담은 것이다. 계약은 메시지가 필드 이름을 담는다는 것이므로, 메시지를 zod 에 맡기지 말고 직접 만든다. `apply.ts` 의 `catch` 를 이렇게 바꾼다:

```ts
      } catch (error) {
        // zod 의 기본 문구는 경로를 담지 않을 수 있다. 여기서 붙인다 — 이
        // 메시지를 읽는 사람은 세 프로세스 건너에 있고, 콘솔은 이미 닫혔다.
        const message =
          error instanceof ZodError
            ? error.issues
                .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
                .join('; ')
            : error instanceof Error
              ? error.message
              : String(error);
        return { ok: false, error: { code: 'invalid-state', message } };
      }
```

그리고 상단 import 에 `ZodError` 를 더한다: `import { ZodError } from 'zod';`

- [ ] **Step 5: 전체를 돌린다**

Run: `pnpm check`
Expected: 전부 통과.

- [ ] **Step 6: 커밋**

```bash
git add lib/bridge/apply.ts tests/unit/apply.test.ts
git commit -m "feat: apply run-state and whole-state writes

pause and resume touch a top-level key and deliberately do not go through the
profile path: pausing an empty store must not mint a rule set nobody asked
for.

state.set refuses anything the schema rejects and leaves the stored bytes
untouched. A store that fails validation is never compiled, so there is
nothing to neutralise and nothing that would justify writing over it."
```

- [ ] **Step 7: 변이 검증**

커밋이 끝났으므로 이제 안전하다. 셋을 하나씩 깨고, **그 테스트가** 빨개지는지 보고, 되돌린다.

1. `site.add` 의 `effectiveDomain(typed)` 를 `typed` 로 바꾼다 → "stores the host, not what was typed" 가 실패해야 한다.
2. `rule.add` 의 `command.operation === 'remove' ? '' : command.value` 를 `command.value` 로 바꾼다 → "drops a value handed to a remove" 가 실패해야 한다.
3. `state.set` 의 `catch` 가 `{ ok: true, state, changed: false }` 를 돌려주게 바꾼다 → "refuses a payload the schema rejects" 가 실패해야 한다.

각각 `git checkout -- lib/bridge/apply.ts` 로 되돌린다. 무엇이 빨개졌는지 기록해 둔다 — 셋 중 하나라도 초록이면 그 테스트는 실패할 수 없는 단언이고, 그게 이 저장소의 반복 결함이다.

---

### Task 6: 스파이크 — 런타임 권한 승인과 포트 keepalive

이건 코드가 아니라 **측정**이다. 산출물은 `docs/research/` 의 문서 하나이고, 그 결과가 2차 계획의 모양을 정한다.

**두 가지를 한 세션에서 답한다.** 둘 다 살아있는 Chrome 과 던져버릴 호스트 하나가 필요하므로 나누면 준비를 두 번 한다.

- **Q10** — `permissions.request({permissions:['nativeMessaging']})` 가 런타임에 실제로 승인을 주는가? 소스는 optional 가능함만 증명한다(`extensions_api_permissions.cc:113-114` 에 `kFlagCannotBeOptional` 이 없다). 이게 무너지면 native messaging 경로 전체가 무너진다.
- **Q11** — 열린 네이티브 포트와 하트비트가 MV3 service worker 를 실제로 살려두는가? 문서는 Chrome 105 를 말하고 What's New 는 Chrome 100 을 말한다 — 문서끼리 어긋난다.

**Files:**
- Create: `docs/research/2026-08-11-native-messaging-spike.md`
- 스크래치(저장소 밖, 커밋하지 않음): 던져버릴 호스트와 임시 팝업 버튼

**⚠ 사용자 확인이 필요하다.** 이 태스크는 사용자의 실제 Chrome 프로필 디렉터리(`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`)에 파일 하나를 쓴다. **시작 전에 물어보고, 끝나면 지운다.** 무엇을 쓸 것인지와 어떻게 지울 것인지를 먼저 말한다.

- [ ] **Step 1: 사용자에게 확인받는다**

쓸 파일의 절대 경로와 내용, 그리고 정리 명령(`rm <path>`)을 보여주고 진행 여부를 묻는다. 거절당하면 이 태스크는 여기서 끝나고, 2차 계획은 Q10·Q11 을 미결로 안고 시작한다 — 그 사실을 기록한다.

- [ ] **Step 2: 던져버릴 호스트를 쓴다**

스크래치패드에. 커밋하지 않는다. `chmod +x` 하고 shebang 을 단다.

**stdout 은 프로토콜이 쓰고 있으므로 로그를 거기 낼 수 없다** — 내면 프레이밍이 깨진다. 파일로 적는다.

```js
#!/usr/bin/env node
// 던져버릴 스파이크 호스트. 받은 것을 돌려주고, 선택적으로 하트비트를 보낸다.
import { appendFileSync } from 'node:fs';
import { endianness } from 'node:os';

const LOG = process.env.SPIKE_LOG ?? '/tmp/headerlab-spike.log';
const BEAT_MS = Number(process.env.SPIKE_BEAT_MS ?? '0'); // 0 이면 하트비트 없음
const LE = endianness() === 'LE';

const log = (what) => appendFileSync(LOG, `${new Date().toISOString()} ${what}\n`);

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  // native byte order. 하드코딩 LE 가 아니라 분기라는 것이 요점이다.
  if (LE) header.writeUInt32LE(body.length, 0);
  else header.writeUInt32BE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
  log(`sent ${JSON.stringify(message)}`);
}

let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    if (buffer.length < 4) return;
    const length = LE ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0);
    if (buffer.length < 4 + length) return;
    const message = JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'));
    buffer = buffer.subarray(4 + length);
    log(`recv ${JSON.stringify(message)}`);
    send({ echo: message });
  }
});

// 닫힌 stdin 이 종료 신호다. SIGTERM 은 오지 않는다 (spec §8.7).
process.stdin.on('end', () => {
  log('stdin closed — exiting');
  process.exit(0);
});

log(`started argv=${JSON.stringify(process.argv.slice(1))} endianness=${endianness()}`);
if (BEAT_MS > 0) {
  let n = 0;
  setInterval(() => send({ beat: ++n }), BEAT_MS);
}
```

`argv` 를 적는 것은 덤이 아니다 — spec §8.6 은 Chrome 이 확장 origin 말고는 아무것도 안 준다고 주장한다. 이게 그 주장을 이 기계에서 확인한다.

- [ ] **Step 3: 호스트 매니페스트를 설치한다**

`allowed_origins` 는 실제 로드된 확장의 ID 여야 한다. **하드코딩하지 않는다** — `chrome://extensions` 에서 읽거나 `chrome.runtime.id` 로 확인한다. spec §8.3 의 계산값은 참고치일 뿐이다.

- [ ] **Step 4: Q10 을 잰다**

`pnpm dev` 로 띄운 확장에 임시 버튼을 하나 놓고 클릭 핸들러에서:

```ts
const granted = await browser.permissions.request({ permissions: ['nativeMessaging'] });
console.warn('[spike] nativeMessaging granted:', granted);
```

기록할 것: 대화상자가 뜨는가, 문구가 무엇인가, `granted` 가 무엇인가, `permissions.getAll()` 이 그 뒤에 무엇을 담는가, 그리고 **거절했을 때** 무엇이 오는가.

- [ ] **Step 5: Q11 을 잰다**

승인 뒤 `connectNative` 로 포트를 열고 **60초 이상 아무 사용자 조작 없이** 둔다. 호스트의 로그 파일이 계속 자라는지 본다.

두 조건을 따로 잰다:
1. 하트비트를 **끈** 채 — 열린 포트만으로 SW 가 사는가?
2. 하트비트를 **켠** 채(20초) — 얼마나 오래 사는가? 5분을 넘기는가?

`chrome://serviceworker-internals` 나 SW 의 시작 로그로 재시작을 확인한다.

**빌드가 unpacked 라는 것을 기록한다.** `alarms` 주기 제한은 unpacked 에 적용되지 않으므로, 이 세션은 alarm **타이밍**에 대해 아무것도 증명하지 않는다. 포트 keepalive 는 alarm 과 다른 기제라 이 측정이 유효하고, **그 구분을 문서에 적는다.**

- [ ] **Step 6: Q12 를 덤으로 잰다**

이미 붙어 있으므로 공짜다. 포트를 네 가지로 끊고 호스트가 각각 무엇을 보는지 적는다: SW 유휴 만료, 확장 비활성화, Chrome 종료, `permissions.remove()`. **호스트가 이유를 구분할 수 있는가?** 못 한다면 확장이 끊기 전에 이유를 내려보내야 한다.

- [ ] **Step 7: 기록한다**

`docs/research/2026-08-11-native-messaging-spike.md`. 이 저장소의 다른 스파이크 문서와 같은 모양으로 — Chrome 버전, macOS 버전, 무엇을 어떻게 쟀는지, 그리고 **설계가 틀렸으면 그렇게 적는다.** "A spike that contradicts a design is a success — fix the design."

- [ ] **Step 8: 정리한다**

호스트 매니페스트를 지우고, 승인한 권한을 해제하고, 임시 버튼을 되돌린다. **지웠다는 것을 확인하고 문서에 적는다.**

- [ ] **Step 9: 커밋**

```bash
git add docs/research/2026-08-11-native-messaging-spike.md
git commit -m "docs: measure the two facts the bridge adapter rests on

Whether permissions.request() actually grants nativeMessaging at runtime,
and how long an MV3 service worker survives on an open native port with and
without a heartbeat. The permission was source-verified as optional-capable
and never executed; the keep-alive is documented at two different Chrome
versions on two different pages.

Measured on an unpacked load, which is noted in the document: the alarms
throttle does not apply there, so this says nothing about alarm timing in a
packed build. Port keep-alive is a different mechanism and the measurement
holds."
```

---

## 이 계획이 끝나면

- 브리지의 결정 로직 전체가 브라우저 없이 테스트된다.
- 순수 가드가 새 파일 셋을 이름으로 지킨다.
- 어댑터 설계가 기대던 두(덤으로 셋) 사실이 측정되어 문서에 있다.

**그다음 2차 계획**: workspace 골격 → 네이티브 호스트 → `port.ts` 어댑터 → CLI → 팝업 → 릴리즈 → 플러그인 → README. Task 6 의 결과가 그중 앞의 셋을 바꿀 수 있으므로, 2차 계획은 그 문서를 읽고 쓴다.
