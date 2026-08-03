# HeaderLab Phase 2b 구현 계획 — Data Grid UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 확정된 Data Grid 목업을 실제 컴포넌트로 구현하고, Phase 2a 가 만든 진단 9종과 권한 감사를 인라인으로 표시한다.

**Architecture:** DOM 없이 답할 수 있는 질문은 전부 `lib/view/grid.ts` 의 순수 함수로 뺀다. 컴포넌트는 그 결과를 렌더하고 상호작용만 담당한다. `--cols` 는 `HeaderGrid.tsx` 하나가 소유한다. 팝업이 직접 `compile()` 을 돌려 진단을 얻으므로 화면과 실제 등록된 룰이 어긋날 수 없다.

**Tech Stack:** React 19 · Tailwind v4 · shadcn(Radix) · vitest · React Testing Library + jsdom · Playwright

**근거 문서:**
- 스펙: [`../specs/2026-08-03-headerlab-phase2b-design.md`](../specs/2026-08-03-headerlab-phase2b-design.md)
- 인수인계: [`../specs/2026-08-02-phase2a-handoff.md`](../specs/2026-08-02-phase2a-handoff.md)
- 설계 원본 §8: [`../specs/2026-07-31-headerlab-design.md`](../specs/2026-07-31-headerlab-design.md)
- 목업: [`../../design/popup-dark.html`](../../design/popup-dark.html) · [`../../design/popup-light.html`](../../design/popup-light.html)

---

## Global Constraints

이 절은 모든 태스크의 요구사항에 암묵적으로 포함된다.

### 범위 — 뒷받침 있는 것만 그린다

**만든다:** 프로필 탭·관리 · Match 패턴 · Types 칩 · 헤더 행 · 진단 9종 · 권한 Grant · Pause all · 상태 줄 · 두 테마.

**만들지 않는다:** Tab lock(2c) · ⋯ 메뉴와 Export/Import(2c) · 테마 토글(2c) · 행 복제·이동(v1 범위 밖) · 가상 스크롤.

동작하지 않는 컨트롤을 비활성 상태로 그려두지 않는다. 승인된 목업과 두 곳이 달라진다 — 두 번째 필터 행의 Tab lock, 톱바의 ⋯. 의도된 차이다.

### `--cols` 는 한 곳에만 있다

```css
--cols: 38px 64px 186px 1fr 26px;
```

`HeaderGrid.tsx` 가 소유하고, 컬럼 헤더·그룹 구분선·데이터 행·진단 서브행·추가 행이 전부 그것을 읽는다. **복제하면 안 된다.** Phase 2a 가 같은 실패를 두 번 겪었다(`HEADER_TOKEN` 정규식, 억제 술어) — 두 번 다 값이 복제됐다가 갈라졌다.

### 목업의 정확한 값

```
크기      560 × 600      글꼴 11.5px / line-height 1.35
--cols    38px 64px 186px 1fr 26px
--sbw     9px            (스크롤바 폭 — 본문 여백과 헤더 패딩이 이 값을 읽는다)
```

| 토큰 | 다크 | 라이트 | 의미 |
|---|---|---|---|
| `--bg` | `#0e1116` | `#fafbfc` | 배경 |
| `--row-hi` | `#151a22` | `#edf1f7` | 행 호버 |
| `--cell` | `#171c24` | `#e7eaf1` | 셀 괘선 |
| `--line` | `#1d232d` | `#d9dee7` | 구분선 |
| `--txt` | `#dde4ee` | `#1b2432` | 본문 |
| `--acc` | `#7aa2f7` | `#2b5fd9` | 포커스 |
| `--grn` | `#62c98d` | `#0f8536` | 적용 중 |
| `--amb` | `#e0af68` | `#9d6410` | 탭 잠금 (2b 미사용) |
| `--cyn` | `#74cbf0` | `#0a749e` | 권한 필요 |
| `--red` | `#f2708b` | `#c12544` | 제거 |

**라이트는 다크의 반전이 아니다.** 별도로 도출돼 WCAG 감사를 거쳤다(블로커 2건 포함 18건 수정). 다크 값에서 계산하지 말고 위 표를 그대로 쓴다.

**다섯 색, 하나당 의미 하나.** 흔한 경우인 `set` 은 색을 쓰지 않는다 — 무채색 평문 + 고정폭 기호 슬롯.

### 진단 라우팅은 데이터에서 나온다

```
diagnostic.headerRuleId 있음  → 그 행 밑 DiagnosticRow
diagnostic.headerRuleId 없음  → 필터 아래 DiagnosticBand
```

**종류별 하드코딩 표를 만들지 않는다.** 필드 유무로 분기하므로 2c 가 11번째 종류를 추가해도 제자리를 찾는다.

### error 를 입력에서 막지 않는다

타이핑을 막지 않고 행에 표시한다. `compile()` 이 이미 그 행을 드롭하므로 잘못된 룰은 나가지 않고, 계산 모델과 표시 모델이 같아진다.

### 커밋은 편집당 한 번

편집 중에는 컴포넌트 로컬 상태, 커밋은 **Enter 또는 blur**, Escape 는 취소.

키 입력마다 `patch` 를 부르면 저장소가 바뀔 때마다 `reconcile()` 이 돌아 `updateDynamicRules` 가 타이핑 속도로 요동친다. 그리고 인수인계 §4.5 의 **같은 기록자 경쟁**(왕복 완료 전 두 번째 `patch` 가 앞선 델타를 버림)을 매 키마다 밟는다. 그 결함이 오늘 잠잠한 이유가 "핸들러당 한 번"이다.

### 오버레이를 쓰지 않는다

Popover·DropdownMenu 는 팝업 자신의 `document.body` 로 포털되어 **600px 천장에서 잘림 위험**이 있다(설계 §8.4). 전부 제자리에서 편집한다.

### 순수 층

`lib/view/grid.ts` 는 브라우저를 임포트하지 않는다. **`tests/unit/purity.test.ts` 에 `lib/view/` 를 자동 발견 대상으로 추가한다** — `lib/compile/` 과 같은 방식이며, `lib/permissions/` 가 명시 목록인 이유는 그 안에 어댑터(`probe.ts`)가 섞여 있기 때문이다. `lib/view/` 에는 순수 뷰모델만 들어가므로 자동 발견이 옳다.

### 환경 사실 (실측함)

- **MV3 CSP 가 인라인 스크립트를 차단한다.** `script-src 'self'` 이고 `unsafe-inline` 불가. 테마 스크립트는 `public/theme.js` 로 빼고 `<script src="/theme.js">` 로 부른다. WXT 가 `public/` 을 산출물 루트로 복사한다.
- **`vitest.config.ts` 의 `include` 가 `.ts` 만 잡는다.** `.tsx` 테스트를 발견조차 못 한다. `['tests/unit/**/*.test.{ts,tsx}']` 로 넓힌다.
- **`environment` 는 `'node'` 로 두고** 컴포넌트 테스트 파일 첫 줄에 `// @vitest-environment jsdom` 독블록을 단다. 실측 확인: 독블록 파일과 기존 node 테스트가 같은 스위트에서 함께 통과한다.
- **`@custom-variant dark (&:is(.dark *))`** 는 `.dark` 를 단 요소 자신에게는 적용되지 않고 자손에만 적용된다. 루트(`document.documentElement`)에 달면 우리가 그리는 모든 것이 자손이라 shadcn 기본값이 그대로 동작한다.
- WXT 스토리지는 `#imports` 에서 임포트한다. `wxt/storage` 는 컴파일되지 않는다.
- `chrome` 전역 네임스페이스는 타입이 해석되지 않는다(TS2503). `Browser` 타입은 `wxt/browser` 에서.
- `noUncheckedIndexedAccess: true`. 인덱스 접근은 전부 `T | undefined`.
- `npm test` 는 `wxt build && vitest run` 이다. `pretest` 훅은 `ignore-scripts=true` 때문에 조용히 실행되지 않는다.

### npm 레지스트리 72시간 격리

최근 3일 내 발행 패키지는 `ETARGET`. **우회 금지** — 프로젝트 `.npmrc` 로 `before` 를 덮지 않고, `--force` 를 쓰지 않고, 레지스트리를 바꾸지 않는다. **`npm audit fix` 를 실행하지 않는다.**

### 단언 강도 — Phase 2a 의 반복 결함

2a 에서 "위반해도 통과하는 테스트"가 **여섯 번** 나왔고 전부 계획이 쓴 테스트였다. 매번 정확한 값을 쓸 수 있는 자리에 `toContain` 을 썼다.

**기본값은 `toEqual` / `toHaveLength` 다.** `toContain` 은 정말 부분만 검사해야 할 때만 쓰고 이유를 주석으로 남긴다.

**이전에 없던 UI 를 배선하는 태스크에는 "이 단언이 실제로 실패할 수 있는지 확인" 스텝이 명시돼 있다** — 배선 전에는 "이 요소가 없다" 류 단언이 구조상 전부 공허하게 통과한다.

### E2E 를 약화시키지 않는다

`tests/e2e/header-modification.spec.ts` 의 헤더 변경 단언 **두 개는 건드리지 않는다.** 세 번째(`the popup renders in the real extension`)만 갱신하며, 방향은 약화가 아니라 강화다.

**커밋 형식:** `<type>: <description>` (feat, fix, refactor, docs, test, chore, perf, ci)

---

## 파일 구조

| 파일 | 책임 | 층 |
|---|---|---|
| `lib/view/grid.ts` (신규) | 행 그룹화 · 진단 라우팅 · 카운트 · 탭 표식 | **순수** |
| `entrypoints/popup/App.tsx` (교체) | 조립과 상태 배선 | 컴포넌트 |
| `entrypoints/popup/index.html` (수정) | 테마 스크립트 참조 | — |
| `public/theme.js` (신규) | 파싱 시점 테마 클래스 | — |
| `components/TopBar.tsx` (신규) | 브랜드 · Running/Pause all | 컴포넌트 |
| `components/ProfileBar.tsx` (신규) | 탭 · 추가 · 룰 수 · 표식 · 재클릭 | 컴포넌트 |
| `components/ProfileEditStrip.tsx` (신규) | 이름 · 색 · 삭제 | 컴포넌트 |
| `components/FilterBlock.tsx` (신규) | Match · Types | 컴포넌트 |
| `components/DiagnosticBand.tsx` (신규) | 프로필 단위 진단 + Grant | 컴포넌트 |
| `components/HeaderGrid.tsx` (신규) | **`--cols` 소유** · 헤더 · 그룹 · 추가 행 | 컴포넌트 |
| `components/HeaderRow.tsx` (신규) | 한 행 | 컴포넌트 |
| `components/ValueCell.tsx` (신규) | 읽기 / 확장 / 편집 | 컴포넌트 |
| `components/DiagnosticRow.tsx` (신규) | 행 단위 진단 서브행 | 컴포넌트 |
| `components/StatusFoot.tsx` (신규) | 상태 줄 | 컴포넌트 |
| `entrypoints/popup/style.css` (수정) | 목업 팔레트를 CSS 변수로 | — |
| `vitest.config.ts` (수정) | `include` 에 `.tsx` | — |
| `tests/unit/purity.test.ts` (수정) | `lib/view/` 자동 발견 | — |

**태스크 순서:** 1 순수 뷰모델 → 2 테마 배선 → 3 정적 그리드 → 4 진단 표시 → 5 편집 → 6 프로필 관리 → 7 권한 Grant → 8 상태 줄과 조립 → 9 E2E.

---

### Task 1: `lib/view/grid.ts` — 순수 뷰모델

컴포넌트 테스트는 느리고 깨지기 쉽다. DOM 없이 답할 수 있는 질문을 먼저 전부 뺀다.

**Files:**
- Create: `lib/view/grid.ts`
- Modify: `tests/unit/purity.test.ts`
- Modify: `vitest.config.ts`
- Test: `tests/unit/grid.test.ts`

**Interfaces:**
- Consumes: `Profile`, `HeaderRule`, `Diagnostic` (`lib/model/types.ts`)
- Produces:
  ```ts
  export interface RowGroups { request: HeaderRule[]; response: HeaderRule[] }
  export function groupRows(profile: Profile): RowGroups;

  export interface RoutedDiagnostics {
    /** headerRuleId → 그 행의 진단들. 순서는 입력 순서. */
    byRow: Map<string, Diagnostic[]>;
    /** headerRuleId 없는 것들. 순서는 입력 순서. */
    profileLevel: Diagnostic[];
  }
  export function routeDiagnostics(diagnostics: readonly Diagnostic[]): RoutedDiagnostics;

  export type ProfileMarker = 'error' | 'permission' | null;
  export function profileMarker(
    diagnostics: readonly Diagnostic[],
    profileId: string,
  ): ProfileMarker;

  export interface GroupCounts { total: number; applying: number; off: number }
  export function groupCounts(
    rows: readonly HeaderRule[],
    byRow: ReadonlyMap<string, Diagnostic[]>,
  ): GroupCounts;
  ```

- [ ] **Step 1: `vitest.config.ts` 의 `include` 를 넓힌다**

현재 `.ts` 만 잡아 `.tsx` 테스트를 발견조차 못 한다. 한 줄만 바꾼다:

```ts
    include: ['tests/unit/**/*.test.{ts,tsx}'],
```

`environment: 'node'` 는 그대로 둔다. 컴포넌트 테스트는 파일별 독블록으로 전환한다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`tests/unit/grid.test.ts` 를 새로 만든다:

```ts
import { describe, expect, it } from 'vitest';
import {
  groupRows,
  routeDiagnostics,
  profileMarker,
  groupCounts,
} from '@/lib/view/grid';
import { createProfile } from '@/lib/model/defaults';
import type { Diagnostic, HeaderRule, Profile } from '@/lib/model/types';

function row(over: Partial<HeaderRule> = {}): HeaderRule {
  return {
    id: 'h1', enabled: true, target: 'request',
    operation: 'set', name: 'X-Test', value: 'v',
    ...over,
  };
}

function profileWith(headers: HeaderRule[]): Profile {
  return { ...createProfile('P', 0), id: 'p1', headers };
}

function diag(over: Partial<Diagnostic> = {}): Diagnostic {
  return {
    kind: 'empty-filter', severity: 'warning', profileId: 'p1',
    message: 'm',
    ...over,
  };
}

describe('groupRows', () => {
  it('splits by target, preserving order within each group', () => {
    const p = profileWith([
      row({ id: 'a', target: 'request' }),
      row({ id: 'b', target: 'response' }),
      row({ id: 'c', target: 'request' }),
    ]);
    expect(groupRows(p)).toEqual({
      request: [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'c' })],
      response: [expect.objectContaining({ id: 'b' })],
    });
  });

  it('returns empty arrays, not undefined, when a group has no rows', () => {
    expect(groupRows(profileWith([row({ target: 'request' })]))).toEqual({
      request: [expect.objectContaining({ id: 'h1' })],
      response: [],
    });
  });

  it('keeps disabled rows — they are shown, just switched off', () => {
    const p = profileWith([row({ id: 'a', enabled: false })]);
    expect(groupRows(p).request).toHaveLength(1);
  });

  it('does not mutate the profile it is given', () => {
    const p = profileWith([row({ id: 'b', target: 'response' }), row({ id: 'a' })]);
    const before = p.headers.map((h) => h.id);
    groupRows(p);
    expect(p.headers.map((h) => h.id)).toEqual(before);
  });
});

describe('routeDiagnostics', () => {
  it('routes by headerRuleId presence, not by kind', () => {
    const withRow = diag({ kind: 'invalid-header-name', severity: 'error', headerRuleId: 'h1' });
    const withoutRow = diag({ kind: 'empty-filter' });
    const routed = routeDiagnostics([withRow, withoutRow]);

    expect([...routed.byRow.keys()]).toEqual(['h1']);
    expect(routed.byRow.get('h1')).toEqual([withRow]);
    expect(routed.profileLevel).toEqual([withoutRow]);
  });

  it('routes an unknown future kind by the same rule', () => {
    // The point of routing on the field rather than a kind table: a kind this
    // code has never heard of still lands somewhere sensible.
    const future = { ...diag(), kind: 'not-a-real-kind' } as unknown as Diagnostic;
    expect(routeDiagnostics([future]).profileLevel).toEqual([future]);
  });

  it('collects several diagnostics on one row, in input order', () => {
    const a = diag({ kind: 'invalid-header-name', severity: 'error', headerRuleId: 'h1' });
    const b = diag({ kind: 'duplicate-header', severity: 'error', headerRuleId: 'h1' });
    expect(routeDiagnostics([a, b]).byRow.get('h1')).toEqual([a, b]);
  });

  it('returns an empty map and empty list for no diagnostics', () => {
    const routed = routeDiagnostics([]);
    expect(routed.byRow.size).toBe(0);
    expect(routed.profileLevel).toEqual([]);
  });
});

describe('profileMarker', () => {
  it('is null when that profile has nothing', () => {
    expect(profileMarker([diag({ profileId: 'other' })], 'p1')).toBeNull();
  });

  it('is error when the profile has any error-severity diagnostic', () => {
    expect(profileMarker([diag({ severity: 'error' })], 'p1')).toBe('error');
  });

  it('is permission when the only thing wrong is permission-missing', () => {
    expect(profileMarker([diag({ kind: 'permission-missing' })], 'p1')).toBe('permission');
  });

  it('prefers error over permission when both are present', () => {
    const d = [diag({ kind: 'permission-missing' }), diag({ severity: 'error' })];
    expect(profileMarker(d, 'p1')).toBe('error');
  });

  it('is null for a warning that is not permission-missing', () => {
    // port-ignored is a warning worth showing in the band, but it does not
    // mean the profile is broken, so the tab stays clean.
    expect(profileMarker([diag({ kind: 'port-ignored' })], 'p1')).toBeNull();
  });

  it('ignores diagnostics belonging to another profile', () => {
    expect(profileMarker([diag({ severity: 'error', profileId: 'p2' })], 'p1')).toBeNull();
  });
});

describe('groupCounts', () => {
  it('counts a clean group as all applying', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })];
    expect(groupCounts(rows, new Map())).toEqual({ total: 2, applying: 2, off: 0 });
  });

  it('counts a disabled row as off, not applying', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', enabled: false })];
    expect(groupCounts(rows, new Map())).toEqual({ total: 2, applying: 1, off: 1 });
  });

  it('does not count a row with an error diagnostic as applying', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })];
    const byRow = new Map([['b', [diag({ severity: 'error', headerRuleId: 'b' })]]]);
    expect(groupCounts(rows, byRow)).toEqual({ total: 2, applying: 1, off: 0 });
  });

  it('still counts a row with only a warning as applying', () => {
    const rows = [row({ id: 'a' })];
    const byRow = new Map([['a', [diag({ severity: 'warning', headerRuleId: 'a' })]]]);
    expect(groupCounts(rows, byRow)).toEqual({ total: 1, applying: 1, off: 0 });
  });

  it('counts a disabled row with an error as off, once', () => {
    const rows = [row({ id: 'a', enabled: false })];
    const byRow = new Map([['a', [diag({ severity: 'error', headerRuleId: 'a' })]]]);
    expect(groupCounts(rows, byRow)).toEqual({ total: 1, applying: 0, off: 1 });
  });

  it('counts nothing for an empty group', () => {
    expect(groupCounts([], new Map())).toEqual({ total: 0, applying: 0, off: 0 });
  });
});
```

- [ ] **Step 3: 테스트가 실패하는 것을 확인한다**

```
npx vitest run tests/unit/grid.test.ts
```
기대: FAIL — `lib/view/grid.ts` 가 없다.

- [ ] **Step 4: 구현한다**

`lib/view/grid.ts` 를 만든다:

```ts
import type { Diagnostic, HeaderRule, Profile } from '@/lib/model/types';

export interface RowGroups {
  request: HeaderRule[];
  response: HeaderRule[];
}

/**
 * Splits a profile's rows by target, preserving the order the user put them in.
 *
 * Disabled rows stay: the grid shows them switched off rather than hiding them,
 * so a row you turned off does not vanish from the place you left it.
 */
export function groupRows(profile: Profile): RowGroups {
  const request: HeaderRule[] = [];
  const response: HeaderRule[] = [];
  for (const rule of profile.headers) {
    (rule.target === 'response' ? response : request).push(rule);
  }
  return { request, response };
}

export interface RoutedDiagnostics {
  byRow: Map<string, Diagnostic[]>;
  profileLevel: Diagnostic[];
}

/**
 * Sorts diagnostics into the two places the grid can show them.
 *
 * The test is `headerRuleId`, not the kind. A kind table would have to be
 * edited every time `DiagnosticKind` grows — and Phase 2a grew it twice — so
 * the field decides instead: something that names a row hangs under that row,
 * something that does not belongs to the profile.
 */
export function routeDiagnostics(diagnostics: readonly Diagnostic[]): RoutedDiagnostics {
  const byRow = new Map<string, Diagnostic[]>();
  const profileLevel: Diagnostic[] = [];

  for (const diagnostic of diagnostics) {
    const rowId = diagnostic.headerRuleId;
    if (rowId === undefined) {
      profileLevel.push(diagnostic);
      continue;
    }
    const existing = byRow.get(rowId);
    if (existing) existing.push(diagnostic);
    else byRow.set(rowId, [diagnostic]);
  }

  return { byRow, profileLevel };
}

export type ProfileMarker = 'error' | 'permission' | null;

/**
 * What the profile tab should show for a profile the user is not looking at.
 *
 * compile() reports on every profile, but the popup renders one at a time —
 * without this, a broken profile two tabs over is invisible, which is the same
 * silent failure the diagnostics exist to remove.
 *
 * Only two states earn a marker. An error means the profile does not work; a
 * missing permission means it registered and does nothing. Other warnings are
 * worth saying in the band but do not mean the profile is broken, so the tab
 * stays clean — a marker that fires on everything gets ignored.
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

export interface GroupCounts {
  total: number;
  applying: number;
  off: number;
}

/**
 * The "N of M applying" figures on a group header.
 *
 * A row applies when it is switched on and nothing about it is an error.
 * A warning does not stop it applying — that is what makes it a warning.
 */
export function groupCounts(
  rows: readonly HeaderRule[],
  byRow: ReadonlyMap<string, Diagnostic[]>,
): GroupCounts {
  let applying = 0;
  let off = 0;

  for (const rule of rows) {
    if (!rule.enabled) {
      off += 1;
      continue;
    }
    const broken = byRow.get(rule.id)?.some((d) => d.severity === 'error') ?? false;
    if (!broken) applying += 1;
  }

  return { total: rows.length, applying, off };
}
```

- [ ] **Step 5: 순수성 가드에 `lib/view/` 를 넣는다**

`tests/unit/purity.test.ts` 의 `AUTO_DISCOVERED` 를 두 디렉터리로 넓힌다:

```ts
/** Auto-discovered: every new file in these directories is guarded for free. */
const AUTO_DISCOVERED = ['lib/compile', 'lib/view'].flatMap((dir) =>
  readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => join(dir, f)),
);
```

그리고 자동 발견 단언에 새 파일을 더한다:

```ts
        'lib/compile/validate.ts',
        'lib/view/grid.ts',
      ]),
```

`lib/permissions/` 는 명시 목록 그대로 둔다 — 그 디렉터리에는 어댑터(`probe.ts`)가 섞여 있어 디렉터리 모양의 규칙이 성립하지 않는다.

- [ ] **Step 6: 테스트가 통과하는 것을 확인한다**

```
npx vitest run tests/unit/grid.test.ts tests/unit/purity.test.ts
```
기대: 둘 다 PASS. 순수성 스위트의 테스트 이름 목록에 `lib/view/grid.ts` 가 **나타나야 한다.** 나타나지 않으면 가드가 통과하면서 아무것도 검사하지 않는 것이므로 보고한다.

- [ ] **Step 7: 전체 스위트**

```
npm test
```
기대: 기존 230개 + 신규 전부 통과.

- [ ] **Step 8: 커밋**

```bash
git add lib/view/grid.ts tests/unit/grid.test.ts tests/unit/purity.test.ts vitest.config.ts
git commit -m "feat: 그리드 뷰모델을 순수 함수로 뽑는다

DOM 없이 답할 수 있는 질문을 먼저 전부 뺀다 — 행 그룹화, 진단 라우팅,
탭 표식, 적용 카운트. 그러면 컴포넌트 테스트가 상호작용만 맡는다.

진단 라우팅은 종류 표가 아니라 headerRuleId 유무로 분기한다. Phase 2a 가
DiagnosticKind 를 두 번 넓혔고, 표를 뒀다면 두 번 다 고쳐야 했다."
```

---

### Task 2: 테마 — 파싱 시점 클래스와 목업 팔레트

**Files:**
- Create: `public/theme.js`
- Modify: `entrypoints/popup/index.html`
- Modify: `entrypoints/popup/style.css`
- Test: `tests/unit/theme.test.ts`

**Interfaces:**
- Produces: `document.documentElement` 에 다크일 때 `dark` 클래스. CSS 변수 `--hl-*` 14종.

**왜 별도 파일인가.** 설계 §8.3 은 인라인 스크립트를 규정했지만 **MV3 에서 동작하지 않는다** — 확장 페이지 CSP 가 `script-src 'self'` 이고 `unsafe-inline` 이 불가라 실행되지 않고 콘솔에 위반만 남는다. 실제 확장을 로드해 확인했다. `public/` 에 두면 WXT 가 산출물 루트로 복사하고 패키지된 스크립트라 `'self'` 를 만족한다.

- [ ] **Step 1: `public/theme.js` 를 만든다**

```js
/**
 * Sets the theme class at parse time, before the module script and before
 * first paint.
 *
 * Not inline: MV3's extension CSP is `script-src 'self'` and forbids
 * `unsafe-inline`, so an inline script never runs — it only logs a violation.
 * A packaged file satisfies 'self'. Measured against a real loaded extension.
 *
 * Not a module: `type="module"` defers, which is exactly the paint we are
 * trying to get ahead of.
 *
 * Phase 2b follows the OS only. When Phase 2c adds the toggle it reads the
 * stored theme and swaps this class — a class beats the media query, so
 * swapping is all it takes.
 */
(function () {
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('dark');
  }
})();
```

- [ ] **Step 2: `index.html` 에서 부른다**

`</head>` 바로 앞에 넣는다. 모듈 스크립트보다 **앞**이어야 한다:

```html
    <script src="/theme.js"></script>
  </head>
```

- [ ] **Step 3: 목업 팔레트를 CSS 변수로 넣는다**

`entrypoints/popup/style.css` 끝에 추가한다. **값은 Global Constraints 의 표 그대로다** — 라이트를 다크에서 계산하지 않는다:

```css
/* ===== HeaderLab palette — from docs/design/popup-{dark,light}.html =====
   Five colours, one meaning each: focus / applying / tab lock / needs access
   / removal. `set` is the common case and spends no colour at all.

   The light values are not an inversion of the dark ones. They were derived
   separately and WCAG-audited (18 fixes, 2 of them blockers), so read them
   from the table rather than computing them. */
:root {
  --hl-bg: #fafbfc;
  --hl-bar: #ffffff;
  --hl-row-hi: #edf1f7;
  --hl-cell: #e7eaf1;
  --hl-line: #d9dee7;
  --hl-txt: #1b2432;
  --hl-txt2: #5a6678;
  --hl-txt3: #8b96a8;
  --hl-acc: #2b5fd9;
  --hl-grn: #0f8536;
  --hl-amb: #9d6410;
  --hl-cyn: #0a749e;
  --hl-red: #c12544;
  --hl-sbw: 9px;
}

.dark {
  --hl-bg: #0e1116;
  --hl-bar: #141922;
  --hl-row-hi: #151a22;
  --hl-cell: #171c24;
  --hl-line: #1d232d;
  --hl-txt: #dde4ee;
  --hl-txt2: #94a2b6;
  --hl-txt3: #626e7f;
  --hl-acc: #7aa2f7;
  --hl-grn: #62c98d;
  --hl-amb: #e0af68;
  --hl-cyn: #74cbf0;
  --hl-red: #f2708b;
}

#root {
  width: 560px;
  height: 600px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--hl-bg);
  color: var(--hl-txt);
  font-size: 11.5px;
  line-height: 1.35;
  -webkit-font-smoothing: antialiased;
}
```

> `--hl-amb`(탭 잠금)는 2b 에서 쓰이지 않는다. 팔레트에는 남겨 두고 사용처만 비운다 — 2c 가 탭 잠금을 넣을 때 색을 다시 도출하지 않게.

- [ ] **Step 4: 빌드 산출물을 검증하는 테스트를 쓴다**

`tests/unit/theme.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// `npm test` runs `wxt build` first, so these read a real build artifact.
const OUT = '.output/chrome-mv3';

function read(path: string): string {
  const full = `${OUT}/${path}`;
  if (!existsSync(full)) {
    throw new Error(`${full} is missing. Run "npm test" (which builds first), not "npx vitest run".`);
  }
  return readFileSync(full, 'utf8');
}

describe('theme bootstrap', () => {
  it('ships theme.js at the output root', () => {
    expect(read('theme.js')).toContain('prefers-color-scheme');
  });

  it('loads it as a plain script, not a module — a module defers past first paint', () => {
    const html = read('popup.html');
    expect(html).toContain('<script src="/theme.js"></script>');
  });

  it('loads it before the module script, so the class is set before React runs', () => {
    const html = read('popup.html');
    const theme = html.indexOf('/theme.js');
    const module = html.indexOf('type="module"');
    expect(theme).toBeGreaterThanOrEqual(0);
    expect(module).toBeGreaterThanOrEqual(0);
    expect(theme).toBeLessThan(module);
  });

  it('has no inline script — MV3 CSP blocks those outright', () => {
    // Measured: an inline script in this page logs
    // "Executing inline script violates ... 'script-src 'self''" and never runs.
    // The regex looks for a <script> with no src attribute before its closing >.
    const html = read('popup.html');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  });
});
```

- [ ] **Step 5: 테스트가 실패하는 것을 확인한다**

```
npm test
```
기대: `theme.js` 관련 4건 FAIL — 아직 만들지 않았거나 index.html 을 안 고쳤다면.

> 이미 Step 1–3 을 했다면 통과할 것이다. 그 경우 **한 번 되돌려 실제로 붉어지는지 확인하고** 복구한다 — 통과할 수밖에 없는 단언이 아닌지 보는 것이 목적이다.

- [ ] **Step 6: 전체 스위트와 실제 확장에서 확인한다**

```
npm test
npm run build
```

그리고 손으로: `.output/chrome-mv3` 를 `chrome://extensions` 에서 언팩 로드하고 팝업을 연다. OS 를 다크로 두면 배경이 어둡고, 라이트로 두면 밝아야 한다. **콘솔에 CSP 위반이 없어야 한다.**

- [ ] **Step 7: 커밋**

```bash
git add public/theme.js entrypoints/popup/index.html entrypoints/popup/style.css tests/unit/theme.test.ts
git commit -m "feat: 파싱 시점 테마 클래스와 목업 팔레트

설계 §8.3 은 인라인 스크립트를 규정했으나 MV3 에서 실행되지 않는다 —
확장 CSP 가 script-src 'self' 이고 unsafe-inline 을 허용하지 않아
콘솔에 위반만 남는다. public/theme.js 로 빼면 패키지된 스크립트라
'self' 를 만족하고, 모듈 스크립트보다 앞에서 파싱 시점에 실행된다.

라이트 팔레트는 다크의 반전이 아니라 별도 도출본이므로 목업 값을
그대로 옮겼다."
```

---

### Task 3: 정적 그리드 — `--cols` 와 행 렌더

이 태스크는 **읽기 전용**이다. 상호작용은 Task 5 가 얹는다.

**Files:**
- Create: `components/HeaderGrid.tsx`
- Create: `components/HeaderRow.tsx`
- Create: `components/ValueCell.tsx`
- Test: `tests/unit/HeaderGrid.test.tsx`

**Interfaces:**
- Consumes: `groupRows`, `groupCounts` (Task 1)
- Produces:
  ```ts
  // HeaderGrid.tsx
  export interface HeaderGridProps {
    profile: Profile;
    byRow: ReadonlyMap<string, Diagnostic[]>;
    onToggleRow: (ruleId: string, enabled: boolean) => void;
    onPatchRow: (ruleId: string, patch: Partial<HeaderRule>) => void;
    onDeleteRow: (ruleId: string) => void;
    onAddRow: (target: HeaderTarget) => void;
  }
  export function HeaderGrid(props: HeaderGridProps): JSX.Element;

  // HeaderRow.tsx
  export interface HeaderRowProps {
    rule: HeaderRule;
    diagnostics: readonly Diagnostic[];
    onToggle: (enabled: boolean) => void;
    onPatch: (patch: Partial<HeaderRule>) => void;
    onDelete: () => void;
  }
  export function HeaderRow(props: HeaderRowProps): JSX.Element;

  // ValueCell.tsx
  export interface ValueCellProps {
    value: string;
    onCommit: (next: string) => void;
  }
  export function ValueCell(props: ValueCellProps): JSX.Element;
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/HeaderGrid.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HeaderGrid } from '@/components/HeaderGrid';
import { createProfile } from '@/lib/model/defaults';
import type { HeaderRule, Profile } from '@/lib/model/types';

function row(over: Partial<HeaderRule> = {}): HeaderRule {
  return {
    id: 'h1', enabled: true, target: 'request',
    operation: 'set', name: 'X-Test', value: 'v',
    ...over,
  };
}

function profileWith(headers: HeaderRule[]): Profile {
  return { ...createProfile('P', 0), id: 'p1', headers };
}

function renderGrid(headers: HeaderRule[]) {
  return render(
    <HeaderGrid
      profile={profileWith(headers)}
      byRow={new Map()}
      onToggleRow={vi.fn()}
      onPatchRow={vi.fn()}
      onDeleteRow={vi.fn()}
      onAddRow={vi.fn()}
    />,
  );
}

describe('HeaderGrid', () => {
  it('owns --cols and states it once', () => {
    const { container } = renderGrid([row()]);
    const owner = container.querySelector('[data-cols-owner]');
    expect(owner).not.toBeNull();
    // Every element that lays out on the grid reads the variable rather than
    // repeating the track list. Phase 2a lost a day to a duplicated constant
    // twice; this assertion is what keeps that from happening here.
    expect(container.querySelectorAll('[data-cols-owner]')).toHaveLength(1);
  });

  it('renders both group headers with their counts', () => {
    renderGrid([
      row({ id: 'a', target: 'request' }),
      row({ id: 'b', target: 'request', enabled: false }),
      row({ id: 'c', target: 'response' }),
    ]);
    // `toContain`, not equality: the group header holds its label and count
    // alongside this figure, so a partial check is what is meant here.
    expect(screen.getByTestId('group-request').textContent).toContain('1 of 2 applying');
    expect(screen.getByTestId('group-response').textContent).toContain('1 of 1 applying');
  });

  it('renders one row per header, in order', () => {
    renderGrid([
      row({ id: 'a', name: 'First' }),
      row({ id: 'b', name: 'Second' }),
    ]);
    // The name lives in a text box from the start — read-only until Task 5
    // makes it editable — so this accessor does not change when it does.
    const names = screen
      .getAllByRole('textbox', { name: /Header name/ })
      .map((n) => (n as HTMLInputElement).value);
    expect(names).toEqual(['First', 'Second']);
  });

  it('shows a disabled row switched off rather than hiding it', () => {
    renderGrid([row({ id: 'a', enabled: false, name: 'Off-row' })]);
    expect(screen.getByDisplayValue('Off-row')).toBeTruthy();
    expect(screen.getByRole('switch', { name: /Off-row/ }).getAttribute('aria-checked')).toBe('false');
  });

  it('shows an add row for each group', () => {
    renderGrid([row()]);
    expect(screen.getByRole('button', { name: 'Add request header' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add response header' })).toBeTruthy();
  });

  it('renders an empty group with a zero count and still offers its add row', () => {
    renderGrid([row({ target: 'request' })]);
    expect(screen.getByTestId('group-response').textContent).toContain('0 of 0 applying');
    expect(screen.getByRole('button', { name: 'Add response header' })).toBeTruthy();
  });

  it('shows a remove row with no value rather than an empty cell', () => {
    renderGrid([row({ operation: 'remove', value: '' })]);
    expect(screen.getByTestId('row-value').textContent).toContain('no value');
  });
});
```

> **jest-dom 매처를 쓰지 않는다.** `@testing-library/jest-dom` 은 이 프로젝트에 없으므로 `toHaveTextContent`·`toHaveAttribute`·`toBeInTheDocument` 는 전부 실패한다. 위 테스트는 이미 순수 vitest 매처(`.textContent` + `toContain`, `.getAttribute()` + `toBe`)로 쓰여 있으니 그대로 옮긴다.

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

```
npx vitest run tests/unit/HeaderGrid.test.tsx
```
기대: FAIL — 컴포넌트가 없다.

- [ ] **Step 3: `ValueCell.tsx` 를 만든다 (읽기 상태만)**

```tsx
import type { ValueCellProps } from './types';

/**
 * Read state only for now — Task 5 adds expand and edit.
 *
 * The value wraps to two lines at rest rather than truncating to one: design
 * §8.2 changed this after a review found long values were only legible once
 * you clicked into them.
 */
export function ValueCell({ value }: { value: string }) {
  if (value.length === 0) {
    return (
      <span data-testid="row-value" className="hl-val hl-val-empty">
        — <span className="hl-unit">no value</span>
      </span>
    );
  }
  return (
    <span data-testid="row-value" className="hl-val">
      {value}
    </span>
  );
}
```

> 구현자에게: `ValueCellProps` 는 Task 5 에서 완성된다. 지금은 위처럼 `{ value: string }` 만 받고, Task 5 가 `onCommit` 을 더한다. 별도 `types.ts` 를 만들지 말고 각 컴포넌트 파일에서 props 인터페이스를 내보낸다 — 이 저장소의 기존 방식이다.

- [ ] **Step 4: `HeaderRow.tsx` 를 만든다**

셀 다섯 개를 `--cols` 트랙에 놓는다. **`--cols` 를 다시 선언하지 않는다** — 부모의 그리드 안에 놓이므로 트랙을 상속받는다.

```tsx
import { ValueCell } from './ValueCell';
import type { Diagnostic, HeaderRule } from '@/lib/model/types';

export interface HeaderRowProps {
  rule: HeaderRule;
  diagnostics: readonly Diagnostic[];
  onToggle: (enabled: boolean) => void;
  onPatch: (patch: Partial<HeaderRule>) => void;
  onDelete: () => void;
}

/** `set` is the common case and spends no colour — design §8.2. */
const OP_SIGN: Record<HeaderRule['operation'], string> = {
  set: '',
  append: '+',
  remove: '−',
};

export function HeaderRow({ rule, onToggle }: HeaderRowProps) {
  return (
    <div className="hl-row" data-off={!rule.enabled || undefined}>
      <span className="hl-c hl-c-on">
        <button
          role="switch"
          aria-checked={rule.enabled}
          aria-label={`${rule.name} enabled`}
          className="hl-sw"
          onClick={() => onToggle(!rule.enabled)}
        />
      </span>
      <span className="hl-c hl-c-op">
        <span className="hl-op" data-op={rule.operation}>
          <span className="hl-sig">{OP_SIGN[rule.operation]}</span>
          {rule.operation}
        </span>
      </span>
      <span className="hl-c hl-c-name">
        {/* A text box from the start, read-only until Task 5 wires editing.
            Rendering a span here and swapping it for an input later would
            force Task 5 to rewrite this task's assertions — and a plan that
            edits its own earlier tests is how a weakened assertion sneaks in. */}
        <input readOnly aria-label="Header name" className="hl-nm" value={rule.name} />
      </span>
      <span className="hl-c hl-c-val">
        <ValueCell value={rule.value} />
      </span>
      <span className="hl-c hl-c-act" />
    </div>
  );
}
```

> 삭제 버튼(`onDelete`)과 값 편집(`onPatch`)은 Task 5 가 붙인다. 지금은 props 를 받되 쓰지 않는다 — 시그니처를 먼저 고정해 두면 Task 5 가 호출부를 안 건드린다.

- [ ] **Step 5: `HeaderGrid.tsx` 를 만든다 — `--cols` 소유자**

```tsx
import { HeaderRow } from './HeaderRow';
import { groupCounts, groupRows } from '@/lib/view/grid';
import type { Diagnostic, HeaderRule, HeaderTarget, Profile } from '@/lib/model/types';

export interface HeaderGridProps {
  profile: Profile;
  byRow: ReadonlyMap<string, Diagnostic[]>;
  onToggleRow: (ruleId: string, enabled: boolean) => void;
  onPatchRow: (ruleId: string, patch: Partial<HeaderRule>) => void;
  onDeleteRow: (ruleId: string) => void;
  onAddRow: (target: HeaderTarget) => void;
}

/**
 * Owns `--cols`.
 *
 * One variable drives the sticky column header, both group dividers, every
 * data row, the diagnostic sub-rows and the add rows. That is the property
 * design §8.1 chose this direction for, and it survives only while the track
 * list lives in exactly one place — hence `data-cols-owner`, which a test
 * asserts is unique.
 */
export function HeaderGrid({ profile, byRow, onToggleRow, onPatchRow, onDeleteRow, onAddRow }: HeaderGridProps) {
  const groups = groupRows(profile);

  const section = (target: HeaderTarget, rows: HeaderRule[]) => {
    const counts = groupCounts(rows, byRow);
    const label = target === 'request' ? 'Request headers' : 'Response headers';
    return (
      <>
        <div className="hl-grp" data-testid={`group-${target}`}>
          <span className="hl-glabel">
            {label} <span className="hl-gcount">{counts.total}</span>
          </span>
          <span className="hl-gright">
            {counts.applying} of {counts.total} applying
          </span>
        </div>
        {rows.map((rule) => (
          <HeaderRow
            key={rule.id}
            rule={rule}
            diagnostics={byRow.get(rule.id) ?? []}
            onToggle={(enabled) => onToggleRow(rule.id, enabled)}
            onPatch={(patch) => onPatchRow(rule.id, patch)}
            onDelete={() => onDeleteRow(rule.id)}
          />
        ))}
        <button className="hl-addrow" onClick={() => onAddRow(target)}>
          + Add {target} header
        </button>
      </>
    );
  };

  return (
    <div className="hl-gbody" data-cols-owner>
      <div className="hl-ghead">
        <span className="hl-h">On</span>
        <span className="hl-h">Op</span>
        <span className="hl-h">Header name</span>
        <span className="hl-h">Value</span>
        <span className="hl-h" />
      </div>
      {section('request', groups.request)}
      {section('response', groups.response)}
    </div>
  );
}
```

- [ ] **Step 6: `--cols` 를 CSS 에 넣는다 — 한 곳에만**

`entrypoints/popup/style.css` 끝에 추가한다:

```css
/* ===== the grid =====
   `--cols` is declared once, on the element carrying `data-cols-owner`, and
   every row-shaped child reads it. Duplicating the track list is what kills
   this design — see the uniqueness assertion in HeaderGrid.test.tsx. */
.hl-gbody {
  --cols: 38px 64px 186px 1fr 26px;
  flex: 1;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.hl-ghead,
.hl-grp,
.hl-row,
.hl-subrow,
.hl-addrow {
  display: grid;
  grid-template-columns: var(--cols);
  align-items: center;
  border-bottom: 1px solid var(--hl-cell);
}

.hl-ghead {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--hl-bg);
  color: var(--hl-txt3);
  height: 22px;
}

.hl-grp,
.hl-addrow {
  grid-template-columns: 1fr auto;
  height: 24px;
  padding: 0 8px;
  color: var(--hl-txt2);
  background: var(--hl-bar);
}

.hl-row { min-height: 30px; }
.hl-row:hover { background: var(--hl-row-hi); }
.hl-row[data-off] { color: var(--hl-txt3); }

.hl-c { padding: 0 6px; border-right: 1px solid var(--hl-cell); overflow: hidden; }
.hl-c-act { border-right: 0; }

/* The value column carries its own shading unbroken from the header to the
   last row, so the eye scans down a column instead of parsing a list. */
.hl-c-val { background: color-mix(in oklab, var(--hl-cell) 35%, transparent); }

.hl-val { user-select: text; word-break: break-all; }
.hl-val-empty { color: var(--hl-txt3); }

.hl-op[data-op='remove'] { color: var(--hl-red); }
.hl-sig { display: inline-block; width: 8px; }
```

> **`.hl-grp` 와 `.hl-addrow` 는 `--cols` 를 쓰지 않는다** — 두 열(라벨 / 우측)이라 자체 트랙을 쓴다. 위 CSS 가 그것을 나중에 덮어쓰므로 순서를 지킨다. 목업도 같은 구조다.

- [ ] **Step 7: 테스트가 통과하는 것을 확인한다**

```
npx vitest run tests/unit/HeaderGrid.test.tsx
```
기대: PASS.

- [ ] **Step 8: 단언이 실제로 실패할 수 있는지 확인한다**

이 태스크는 이전에 없던 UI 를 배선하므로, 부정 단언이 공허하게 통과할 위험이 구조적으로 있다. 두 가지를 실제로 깨뜨려 보고 복구한다:

1. `data-cols-owner` 를 `HeaderRow` 에도 달아 본다 → 유일성 단언이 붉어져야 한다
2. `groupCounts` 대신 `rows.length` 를 써서 카운트를 낸다 → `1 of 2 applying` 단언이 붉어져야 한다

붉어지지 않으면 그 단언은 아무것도 지키지 않는 것이므로 보고한다.

- [ ] **Step 9: 전체 스위트와 커밋**

```
npm test
```

```bash
git add components/HeaderGrid.tsx components/HeaderRow.tsx components/ValueCell.tsx \
        entrypoints/popup/style.css tests/unit/HeaderGrid.test.tsx
git commit -m "feat: 정적 데이터 그리드 — --cols 소유자와 행 렌더

--cols 는 data-cols-owner 를 단 요소 하나에만 선언되고 행 모양의 자식들이
그것을 읽는다. 트랙 목록이 복제되는 순간 이 디자인의 이점이 사라지므로
유일성을 테스트가 지킨다."
```

---

### Task 4: 진단 표시 — 서브행과 띠

**Files:**
- Create: `components/DiagnosticRow.tsx`
- Create: `components/DiagnosticBand.tsx`
- Modify: `components/HeaderGrid.tsx`
- Modify: `components/HeaderRow.tsx`
- Test: `tests/unit/Diagnostics.test.tsx`

**Interfaces:**
- Consumes: `routeDiagnostics` (Task 1), `Diagnostic`
- Produces:
  ```ts
  export interface DiagnosticRowProps { diagnostics: readonly Diagnostic[] }
  export function DiagnosticRow(props: DiagnosticRowProps): JSX.Element | null;

  export interface DiagnosticBandProps {
    diagnostics: readonly Diagnostic[];
    onGrant: (host: string) => void;
  }
  export function DiagnosticBand(props: DiagnosticBandProps): JSX.Element | null;
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/Diagnostics.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DiagnosticRow } from '@/components/DiagnosticRow';
import { DiagnosticBand } from '@/components/DiagnosticBand';
import type { Diagnostic } from '@/lib/model/types';

function diag(over: Partial<Diagnostic> = {}): Diagnostic {
  return { kind: 'empty-filter', severity: 'warning', profileId: 'p1', message: 'm', ...over };
}

describe('DiagnosticRow', () => {
  it('renders nothing at all when there is nothing to say', () => {
    const { container } = render(<DiagnosticRow diagnostics={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the message', () => {
    render(<DiagnosticRow diagnostics={[diag({ message: 'Header name is empty.' })]} />);
    expect(screen.getByText('Header name is empty.')).toBeTruthy();
  });

  it('shows one line per diagnostic when a row has several', () => {
    render(<DiagnosticRow diagnostics={[diag({ message: 'one' }), diag({ message: 'two' })]} />);
    expect(screen.getAllByTestId('diagnostic-line')).toHaveLength(2);
  });

  it('marks severity so the palette can colour it', () => {
    render(<DiagnosticRow diagnostics={[diag({ severity: 'error', message: 'e' })]} />);
    expect(screen.getByTestId('diagnostic-line').getAttribute('data-severity')).toBe('error');
  });
});

describe('DiagnosticBand', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<DiagnosticBand diagnostics={[]} onGrant={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows a Grant button only for permission-missing', () => {
    render(
      <DiagnosticBand
        diagnostics={[diag({ kind: 'empty-filter', message: 'no domain' })]}
        onGrant={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Grant/ })).toBeNull();
  });

  it('offers Grant for a missing permission and passes the host', async () => {
    const onGrant = vi.fn();
    render(
      <DiagnosticBand
        diagnostics={[diag({
          kind: 'permission-missing',
          message: 'HeaderLab needs permission for api.example.com. The rule is registered but will not apply until you grant it.',
        })]}
        onGrant={onGrant}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Grant/ }));
    expect(onGrant).toHaveBeenCalledTimes(1);
    expect(onGrant).toHaveBeenCalledWith('api.example.com');
  });

  it('shows every profile-level diagnostic, not just the first', () => {
    render(
      <DiagnosticBand
        diagnostics={[diag({ message: 'one' }), diag({ kind: 'port-ignored', message: 'two' })]}
        onGrant={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId('band-line')).toHaveLength(2);
  });
});
```

**`onGrant` 에 넘길 호스트를 어디서 얻는가.** `Diagnostic` 에는 호스트 필드가 없고 메시지 문자열 안에만 있다. **메시지를 파싱하지 않는다** — 문구가 바뀌면 조용히 깨진다. 대신 이 태스크가 `Diagnostic` 을 넓힌다:

- [ ] **Step 2: `Diagnostic` 에 선택 필드 하나를 더한다**

`lib/model/types.ts`:

```ts
export interface Diagnostic {
  kind: DiagnosticKind;
  severity: 'error' | 'warning';
  profileId: string;
  headerRuleId?: string;
  /**
   * The host this diagnostic is about, when it is about one. Set by
   * `permission-missing` so the Grant button knows what to request without
   * parsing the message — a message is copy, and copy changes.
   */
  host?: string;
  message: string;
}
```

`lib/permissions/audit.ts` 의 `auditDiagnostics` 가 그것을 채운다 — `push` 하는 객체에 `host` 한 줄을 더한다:

```ts
      diagnostics.push({
        kind: 'permission-missing',
        severity: 'warning',
        profileId: profile.id,
        host,
        message:
          `HeaderLab needs permission for ${host}. ` +
          'The rule is registered but will not apply until you grant it.',
      });
```

그리고 `tests/unit/audit.test.ts` 에 한 줄 단언을 더한다(**기존 기대값은 고치지 않는다** — 새 케이스를 추가한다):

```ts
  it('carries the host so the Grant button need not parse the message', () => {
    const d = auditDiagnostics(
      [p('a', 'A', ['x.com'])],
      [{ domain: 'x.com', granted: false }],
    );
    expect(d[0]?.host).toBe('x.com');
  });
```

> `host` 를 더하면 `audit.test.ts` 의 기존 `toEqual` 단언이 붉어질 수 있다. **그 경우 보고한다** — 기대값을 고치는 것과 새 필드를 반영하는 것은 다르고, 판단은 계획 쪽에서 한다.

- [ ] **Step 3: 테스트가 실패하는 것을 확인한다**

```
npx vitest run tests/unit/Diagnostics.test.tsx
```
기대: FAIL — 두 컴포넌트가 없다.

- [ ] **Step 4: `DiagnosticRow.tsx` 를 만든다**

```tsx
import type { Diagnostic } from '@/lib/model/types';

export interface DiagnosticRowProps {
  diagnostics: readonly Diagnostic[];
}

/**
 * Hangs under the row it is about.
 *
 * Renders nothing when there is nothing to say — the conditional chrome only
 * costs vertical space when it has earned it, which is what keeps the popup
 * inside its 600px ceiling in the common case.
 */
export function DiagnosticRow({ diagnostics }: DiagnosticRowProps) {
  if (diagnostics.length === 0) return null;
  return (
    <div className="hl-subrow">
      <span className="hl-sub">
        {diagnostics.map((d, i) => (
          <span
            key={`${d.kind}-${i}`}
            data-testid="diagnostic-line"
            data-severity={d.severity}
            className="hl-subline"
          >
            {d.message}
          </span>
        ))}
      </span>
    </div>
  );
}
```

- [ ] **Step 5: `DiagnosticBand.tsx` 를 만든다**

```tsx
import type { Diagnostic } from '@/lib/model/types';

export interface DiagnosticBandProps {
  diagnostics: readonly Diagnostic[];
  onGrant: (host: string) => void;
}

/**
 * Profile-level diagnostics, directly under the filter block they are about.
 *
 * Grant appears only for `permission-missing`, and takes the host from the
 * diagnostic's own field rather than from its message.
 */
export function DiagnosticBand({ diagnostics, onGrant }: DiagnosticBandProps) {
  if (diagnostics.length === 0) return null;
  return (
    <div className="hl-band">
      {diagnostics.map((d, i) => (
        <div
          key={`${d.kind}-${i}`}
          data-testid="band-line"
          data-severity={d.severity}
          className="hl-bandline"
        >
          <span>{d.message}</span>
          {d.kind === 'permission-missing' && d.host !== undefined && (
            <button className="hl-grant" onClick={() => onGrant(d.host!)}>
              Grant
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```

> `d.host!` 의 비-널 단언은 바로 위 `d.host !== undefined` 가 보장한다. TypeScript 가 콜백 안에서 그 좁힘을 유지하지 못하는 알려진 한계다. 좁힌 값을 지역 변수로 빼도 좋다.

- [ ] **Step 6: `HeaderGrid` 가 서브행을 렌더하게 한다**

`section` 안의 `HeaderRow` 뒤에 서브행을 붙인다. `key` 는 행 id 에 접미어를 붙여 구분한다:

```tsx
        {rows.map((rule) => {
          const rowDiagnostics = byRow.get(rule.id) ?? [];
          return (
            <Fragment key={rule.id}>
              <HeaderRow
                rule={rule}
                diagnostics={rowDiagnostics}
                onToggle={(enabled) => onToggleRow(rule.id, enabled)}
                onPatch={(patch) => onPatchRow(rule.id, patch)}
                onDelete={() => onDeleteRow(rule.id)}
              />
              <DiagnosticRow diagnostics={rowDiagnostics} />
            </Fragment>
          );
        })}
```

`react` 에서 `Fragment` 를 임포트한다.

- [ ] **Step 7: 진단 스타일을 CSS 에 넣는다**

```css
.hl-subrow {
  grid-template-columns: var(--cols);
  min-height: 22px;
}
.hl-subrow .hl-sub {
  grid-column: 2 / -1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 3px 6px;
}
.hl-subline,
.hl-bandline { color: var(--hl-txt2); }
.hl-subline[data-severity='error'],
.hl-bandline[data-severity='error'] { color: var(--hl-red); }

.hl-band {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 5px 8px;
  background: var(--hl-bar);
  border-bottom: 1px solid var(--hl-line);
}
.hl-bandline { display: flex; align-items: center; gap: 6px; }
.hl-grant {
  margin-left: auto;
  padding: 1px 7px;
  border-radius: 3px;
  color: var(--hl-cyn);
  border: 1px solid color-mix(in oklab, var(--hl-cyn) 45%, transparent);
}
```

- [ ] **Step 8: 통과 확인 + 단언이 실패할 수 있는지 확인**

```
npx vitest run tests/unit/Diagnostics.test.tsx tests/unit/audit.test.ts
```

그리고 두 가지를 깨뜨려 보고 복구한다:

1. `DiagnosticRow` 의 `if (diagnostics.length === 0) return null;` 을 지운다 → "renders nothing" 단언이 붉어져야 한다
2. `DiagnosticBand` 의 `d.kind === 'permission-missing'` 조건을 지워 Grant 를 항상 띄운다 → "Grant 는 permission-missing 에만" 단언이 붉어져야 한다

- [ ] **Step 9: 전체 스위트와 커밋**

```
npm test
```

```bash
git add components/DiagnosticRow.tsx components/DiagnosticBand.tsx components/HeaderGrid.tsx \
        lib/model/types.ts lib/permissions/audit.ts entrypoints/popup/style.css \
        tests/unit/Diagnostics.test.tsx tests/unit/audit.test.ts
git commit -m "feat: 진단을 두 자리에 표시한다 — 행 서브행과 프로필 띠

Grant 버튼이 호스트를 메시지에서 파싱하지 않도록 Diagnostic 에 host
필드를 더했다. 메시지는 문구이고 문구는 바뀐다.

둘 다 할 말이 없으면 아무것도 렌더하지 않는다 — 조건부 크롬이 자리를
차지하는 것은 그럴 이유가 있을 때뿐이고, 그것이 600px 천장을 지킨다."
```

---

### Task 5: 편집 — 편집당 한 번 커밋

**Files:**
- Modify: `components/ValueCell.tsx`
- Modify: `components/HeaderRow.tsx`
- Test: `tests/unit/editing.test.tsx`

**Interfaces:**
- Produces: `ValueCellProps { value: string; onCommit: (next: string) => void }`

**커밋 규율.** 키 입력마다 쓰지 않는다. `reconcile()` 이 저장소 변경마다 돌고, 인수인계 §4.5 의 같은 기록자 경쟁을 매 키마다 밟는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/editing.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ValueCell } from '@/components/ValueCell';
import { HeaderRow } from '@/components/HeaderRow';
import type { HeaderRule } from '@/lib/model/types';

function rule(over: Partial<HeaderRule> = {}): HeaderRule {
  return { id: 'h1', enabled: true, target: 'request', operation: 'set', name: 'X-Test', value: 'v', ...over };
}

describe('ValueCell commit discipline', () => {
  it('does not commit while typing', async () => {
    const onCommit = vi.fn();
    render(<ValueCell value="start" onCommit={onCommit} />);
    await userEvent.click(screen.getByRole('button', { name: /Edit value/ }));
    await userEvent.type(screen.getByRole('textbox'), 'abc');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits once on blur', async () => {
    const onCommit = vi.fn();
    render(<ValueCell value="" onCommit={onCommit} />);
    await userEvent.click(screen.getByRole('button', { name: /Edit value/ }));
    await userEvent.type(screen.getByRole('textbox'), 'abc');
    await userEvent.tab();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('abc');
  });

  it('commits on Enter', async () => {
    const onCommit = vi.fn();
    render(<ValueCell value="" onCommit={onCommit} />);
    await userEvent.click(screen.getByRole('button', { name: /Edit value/ }));
    await userEvent.type(screen.getByRole('textbox'), 'abc{Enter}');
    expect(onCommit).toHaveBeenCalledWith('abc');
  });

  it('discards the draft on Escape and commits nothing', async () => {
    const onCommit = vi.fn();
    render(<ValueCell value="original" onCommit={onCommit} />);
    await userEvent.click(screen.getByRole('button', { name: /Edit value/ }));
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), 'changed{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId('row-value').textContent).toContain('original');
  });

  it('returns to the read state after committing', async () => {
    render(<ValueCell value="" onCommit={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Edit value/ }));
    await userEvent.type(screen.getByRole('textbox'), 'abc{Enter}');
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('HeaderRow name editing', () => {
  it('commits the name on blur, not per keystroke', async () => {
    const onPatch = vi.fn();
    render(
      <HeaderRow rule={rule({ name: '' })} diagnostics={[]} onToggle={vi.fn()} onPatch={onPatch} onDelete={vi.fn()} />,
    );
    const input = screen.getByRole('textbox', { name: /Header name/ });
    await userEvent.type(input, 'X-Api-Key');
    expect(onPatch).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ name: 'X-Api-Key' });
  });

  it('cycles the operation set → append → remove → set', async () => {
    const onPatch = vi.fn();
    render(
      <HeaderRow rule={rule({ operation: 'set' })} diagnostics={[]} onToggle={vi.fn()} onPatch={onPatch} onDelete={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Operation/ }));
    expect(onPatch).toHaveBeenCalledWith({ operation: 'append' });
  });

  it('deletes the row', async () => {
    const onDelete = vi.fn();
    render(
      <HeaderRow rule={rule()} diagnostics={[]} onToggle={vi.fn()} onPatch={vi.fn()} onDelete={onDelete} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Delete row/ }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

```
npx vitest run tests/unit/editing.test.tsx
```
기대: FAIL — Edit 버튼도 입력도 없다.

- [ ] **Step 3: `ValueCell` 을 3상태로 만든다**

```tsx
import { useState } from 'react';

export interface ValueCellProps {
  value: string;
  onCommit: (next: string) => void;
}

/**
 * Read at rest, expanded on click, editable on demand.
 *
 * Design §8.2 removed an always-editable panel because a 2KB paste stretched
 * it to 1056px. The height cap is the answer, and it applies to both the read
 * and the edit view.
 *
 * The draft lives here, not in storage. Writing per keystroke would run the
 * background's reconcile loop at typing speed, and would hit the same-writer
 * race recorded in the Phase 2a handoff §4.5 on every key — that race is quiet
 * today only because every handler writes once.
 */
export function ValueCell({ value, onCommit }: ValueCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const begin = () => {
    setDraft(value);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };

  if (editing) {
    return (
      <span className="hl-val-edit">
        <textarea
          autoFocus
          aria-label="Header value"
          className="hl-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setEditing(false);
            }
          }}
        />
      </span>
    );
  }

  return (
    <span className="hl-val-read">
      <span data-testid="row-value" className={value ? 'hl-val' : 'hl-val hl-val-empty'}>
        {value || <>— <span className="hl-unit">no value</span></>}
      </span>
      <button className="hl-vbtn" aria-label="Edit value" onClick={begin}>
        ✎
      </button>
    </span>
  );
}
```

> Escape 는 `setEditing(false)` 만 하고 `draft` 를 되돌리지 않는다 — 다음 `begin()` 이 `setDraft(value)` 로 덮으므로 결과가 같다. 굳이 두 곳에서 되돌리지 않는다.

- [ ] **Step 4: `HeaderRow` 에 이름 편집·연산 순환·삭제를 붙인다**

```tsx
import { useState } from 'react';
import { ValueCell } from './ValueCell';
import type { Diagnostic, HeaderRule, Operation } from '@/lib/model/types';

const OP_SIGN: Record<Operation, string> = { set: '', append: '+', remove: '−' };
const OP_NEXT: Record<Operation, Operation> = { set: 'append', append: 'remove', remove: 'set' };

export interface HeaderRowProps {
  rule: HeaderRule;
  diagnostics: readonly Diagnostic[];
  onToggle: (enabled: boolean) => void;
  onPatch: (patch: Partial<HeaderRule>) => void;
  onDelete: () => void;
}

export function HeaderRow({ rule, onToggle, onPatch, onDelete }: HeaderRowProps) {
  const [nameDraft, setNameDraft] = useState(rule.name);

  const commitName = () => {
    if (nameDraft !== rule.name) onPatch({ name: nameDraft });
  };

  return (
    <div className="hl-row" data-off={!rule.enabled || undefined}>
      <span className="hl-c hl-c-on">
        <button
          role="switch"
          aria-checked={rule.enabled}
          aria-label={`${rule.name || 'Unnamed'} enabled`}
          className="hl-sw"
          onClick={() => onToggle(!rule.enabled)}
        />
      </span>
      <span className="hl-c hl-c-op">
        <button
          className="hl-op"
          data-op={rule.operation}
          aria-label={`Operation: ${rule.operation}`}
          onClick={() => onPatch({ operation: OP_NEXT[rule.operation] })}
        >
          <span className="hl-sig">{OP_SIGN[rule.operation]}</span>
          {rule.operation}
        </button>
      </span>
      <span className="hl-c hl-c-name">
        <input
          aria-label="Header name"
          className="hl-nm"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === 'Enter') commitName(); }}
        />
      </span>
      <span className="hl-c hl-c-val">
        <ValueCell value={rule.value} onCommit={(next) => onPatch({ value: next })} />
      </span>
      <span className="hl-c hl-c-act">
        <button className="hl-rowmenu" aria-label="Delete row" onClick={onDelete}>×</button>
      </span>
    </div>
  );
}
```

> **Task 3 의 테스트는 건드리지 않는다.** 이름은 Task 3 부터 `input` 이었고 접근자(`getByRole('textbox', { name: /Header name/ })`)가 그대로다. 이 태스크가 하는 것은 `readOnly` 를 떼고 `value`·`onChange`·`onBlur`·`onKeyDown` 를 붙이는 것뿐이다.

- [ ] **Step 5: 편집 스타일을 넣는다**

```css
.hl-val-read { display: flex; align-items: center; gap: 4px; width: 100%; }
.hl-val-read .hl-vbtn { margin-left: auto; opacity: 0; color: var(--hl-txt3); }
.hl-row:hover .hl-vbtn { opacity: 1; }

.hl-textarea,
.hl-nm {
  width: 100%;
  background: transparent;
  color: inherit;
  font: inherit;
  border: 0;
  outline: 0;
}
.hl-textarea {
  max-height: 56px;      /* design §8.2 — a 2KB paste must not stretch the row */
  resize: none;
  background: var(--hl-bg);
  outline: 1px solid var(--hl-acc);
}
.hl-nm:focus { outline: 1px solid var(--hl-acc); }
```

- [ ] **Step 6: 통과 확인 + 변이 검증**

```
npx vitest run tests/unit/editing.test.tsx tests/unit/HeaderGrid.test.tsx
```

그리고 커밋 규율이 실제로 지켜지는지 깨뜨려 확인한다:

`ValueCell` 의 `onChange` 를 `(e) => { setDraft(e.target.value); onCommit(e.target.value); }` 로 바꾼다 → "does not commit while typing" 이 붉어져야 한다. 확인 후 복구한다.

- [ ] **Step 7: 전체 스위트와 커밋**

```
npm test
```

```bash
git add components/ValueCell.tsx components/HeaderRow.tsx entrypoints/popup/style.css \
        tests/unit/editing.test.tsx tests/unit/HeaderGrid.test.tsx
git commit -m "feat: 제자리 편집 — 커밋은 편집당 한 번

편집 중에는 컴포넌트 로컬 상태, 커밋은 Enter 또는 blur, Escape 는 취소.

키 입력마다 쓰면 저장소 변경마다 reconcile 이 돌아 updateDynamicRules 가
타이핑 속도로 요동치고, 인수인계 §4.5 의 같은 기록자 경쟁을 매 키마다
밟는다 — 그 결함이 오늘 잠잠한 이유가 '핸들러당 한 번'이다."
```

---

### Task 6: 프로필 바와 관리 스트립

**Files:**
- Create: `components/ProfileBar.tsx`
- Create: `components/ProfileEditStrip.tsx`
- Test: `tests/unit/ProfileBar.test.tsx`

**Interfaces:**
- Consumes: `profileMarker` (Task 1)
- Produces:
  ```ts
  export interface ProfileBarProps {
    profiles: readonly Profile[];
    activeId: string;
    diagnostics: readonly Diagnostic[];
    ruleCount: number;
    onSelect: (id: string) => void;
    onReselect: (id: string) => void;
    onAdd: () => void;
  }
  export function ProfileBar(props: ProfileBarProps): JSX.Element;

  export interface ProfileEditStripProps {
    profile: Profile;
    onPatch: (patch: Partial<Profile>) => void;
    onDelete: () => void;
    onClose: () => void;
  }
  export function ProfileEditStrip(props: ProfileEditStripProps): JSX.Element;
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/ProfileBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProfileBar } from '@/components/ProfileBar';
import { ProfileEditStrip } from '@/components/ProfileEditStrip';
import { createProfile } from '@/lib/model/defaults';
import type { Diagnostic, Profile } from '@/lib/model/types';

function prof(id: string, name: string, order = 0): Profile {
  return { ...createProfile(name, order), id, name };
}

function diag(over: Partial<Diagnostic> = {}): Diagnostic {
  return { kind: 'empty-filter', severity: 'warning', profileId: 'p1', message: 'm', ...over };
}

const base = {
  profiles: [prof('p1', 'Local'), prof('p2', 'Staging', 1)],
  activeId: 'p1',
  diagnostics: [] as Diagnostic[],
  ruleCount: 3,
  onSelect: vi.fn(),
  onReselect: vi.fn(),
  onAdd: vi.fn(),
};

describe('ProfileBar', () => {
  it('renders one tab per profile plus an add button', () => {
    render(<ProfileBar {...base} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'New profile' })).toBeTruthy();
  });

  it('marks the active tab', () => {
    render(<ProfileBar {...base} />);
    expect(screen.getByRole('tab', { name: /Local/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /Staging/ }).getAttribute('aria-selected')).toBe('false');
  });

  it('selects when an inactive tab is clicked', async () => {
    const onSelect = vi.fn();
    const onReselect = vi.fn();
    render(<ProfileBar {...base} onSelect={onSelect} onReselect={onReselect} />);
    await userEvent.click(screen.getByRole('tab', { name: /Staging/ }));
    expect(onSelect).toHaveBeenCalledWith('p2');
    expect(onReselect).not.toHaveBeenCalled();
  });

  it('opens editing when the ALREADY active tab is clicked', async () => {
    const onSelect = vi.fn();
    const onReselect = vi.fn();
    render(<ProfileBar {...base} onSelect={onSelect} onReselect={onReselect} />);
    await userEvent.click(screen.getByRole('tab', { name: /Local/ }));
    expect(onReselect).toHaveBeenCalledWith('p1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows the rule count for the active profile', () => {
    render(<ProfileBar {...base} ruleCount={7} />);
    expect(screen.getByTestId('rule-count').textContent).toContain('7');
  });

  it('marks a tab whose profile has an error, even when it is not active', () => {
    render(<ProfileBar {...base} diagnostics={[diag({ severity: 'error', profileId: 'p2' })]} />);
    expect(screen.getByRole('tab', { name: /Staging/ }).getAttribute('data-marker')).toBe('error');
  });

  it('marks a tab needing permission differently from a broken one', () => {
    render(<ProfileBar {...base} diagnostics={[diag({ kind: 'permission-missing', profileId: 'p2' })]} />);
    expect(screen.getByRole('tab', { name: /Staging/ }).getAttribute('data-marker')).toBe('permission');
  });

  it('leaves a clean tab unmarked', () => {
    render(<ProfileBar {...base} />);
    expect(screen.getByRole('tab', { name: /Local/ }).getAttribute('data-marker')).toBeNull();
  });
});

describe('ProfileEditStrip', () => {
  it('commits the name on blur, not per keystroke', async () => {
    const onPatch = vi.fn();
    render(
      <ProfileEditStrip profile={prof('p1', 'Local')} onPatch={onPatch} onDelete={vi.fn()} onClose={vi.fn()} />,
    );
    const input = screen.getByRole('textbox', { name: /Profile name/ });
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed');
    expect(onPatch).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(onPatch).toHaveBeenCalledWith({ name: 'Renamed' });
  });

  it('offers the five palette colours', () => {
    render(
      <ProfileEditStrip profile={prof('p1', 'Local')} onPatch={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getAllByTestId('colour-swatch')).toHaveLength(5);
  });

  it('patches the colour when a swatch is chosen', async () => {
    const onPatch = vi.fn();
    render(
      <ProfileEditStrip profile={prof('p1', 'Local')} onPatch={onPatch} onDelete={vi.fn()} onClose={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Colour red' }));
    expect(onPatch).toHaveBeenCalledWith({ color: 'red' });
  });

  it('needs a second click to delete — the first only arms it', async () => {
    const onDelete = vi.fn();
    render(
      <ProfileEditStrip profile={prof('p1', 'Local')} onPatch={vi.fn()} onDelete={onDelete} onClose={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete profile' }));
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Really delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

```
npx vitest run tests/unit/ProfileBar.test.tsx
```
기대: FAIL — 두 컴포넌트가 없다.

- [ ] **Step 3: `ProfileBar.tsx` 를 만든다**

```tsx
import { profileMarker } from '@/lib/view/grid';
import type { Diagnostic, Profile } from '@/lib/model/types';

export interface ProfileBarProps {
  profiles: readonly Profile[];
  activeId: string;
  diagnostics: readonly Diagnostic[];
  ruleCount: number;
  onSelect: (id: string) => void;
  onReselect: (id: string) => void;
  onAdd: () => void;
}

/**
 * Clicking an inactive tab switches; clicking the active one opens editing.
 *
 * That second gesture is where profile management lives — there is no overlay
 * anywhere in this popup, because a Popover portals to the popup's own body
 * and risks clipping at the 600px ceiling (design §8.4).
 *
 * The marker is separate from the identity dot. The dot is which profile this
 * is; the marker is whether it works. compile() reports on every profile but
 * the grid shows one, so without the marker a broken profile two tabs over is
 * invisible.
 */
export function ProfileBar({
  profiles, activeId, diagnostics, ruleCount, onSelect, onReselect, onAdd,
}: ProfileBarProps) {
  return (
    <div className="hl-profbar">
      <div className="hl-profs" role="tablist">
        {profiles.map((p) => {
          const marker = profileMarker(diagnostics, p.id);
          const active = p.id === activeId;
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={active}
              data-marker={marker ?? undefined}
              className="hl-prof"
              onClick={() => (active ? onReselect(p.id) : onSelect(p.id))}
            >
              <span className="hl-pdot" data-tone={p.color} data-active={active || undefined} />
              {p.name}
            </button>
          );
        })}
        <button className="hl-prof hl-prof-add" aria-label="New profile" onClick={onAdd}>
          +
        </button>
      </div>
      <span className="hl-prof-meta" data-testid="rule-count">
        <b>{ruleCount}</b> rules
      </span>
    </div>
  );
}
```

- [ ] **Step 4: `ProfileEditStrip.tsx` 를 만든다**

```tsx
import { useState } from 'react';
import type { Profile, ProfileColor } from '@/lib/model/types';

/** The five identity colours. `ProfileColor` also allows cyan; the palette
 *  in design §8.3 is five, so cyan is not offered. */
const COLOURS: ProfileColor[] = ['green', 'amber', 'red', 'blue', 'violet'];

export interface ProfileEditStripProps {
  profile: Profile;
  onPatch: (patch: Partial<Profile>) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function ProfileEditStrip({ profile, onPatch, onDelete, onClose }: ProfileEditStripProps) {
  const [nameDraft, setNameDraft] = useState(profile.name);
  const [armed, setArmed] = useState(false);

  const commitName = () => {
    if (nameDraft !== profile.name) onPatch({ name: nameDraft });
  };

  return (
    <div className="hl-editstrip">
      <input
        aria-label="Profile name"
        className="hl-editname"
        value={nameDraft}
        onChange={(e) => setNameDraft(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitName();
          if (e.key === 'Escape') onClose();
        }}
      />
      <span className="hl-swatches">
        {COLOURS.map((colour) => (
          <button
            key={colour}
            data-testid="colour-swatch"
            aria-label={`Colour ${colour}`}
            data-tone={colour}
            data-chosen={profile.color === colour || undefined}
            className="hl-swatch"
            onClick={() => onPatch({ color: colour })}
          />
        ))}
      </span>
      <button
        className="hl-delete"
        aria-label={armed ? 'Really delete' : 'Delete profile'}
        onClick={() => (armed ? onDelete() : setArmed(true))}
      >
        {armed ? 'Really delete?' : 'Delete'}
      </button>
    </div>
  );
}
```

> 삭제는 되돌릴 수 없으므로 두 단계다. 별도 다이얼로그를 띄우지 않는 것이 오버레이 없음 원칙과 일관된다.

- [ ] **Step 5: 스타일**

```css
.hl-profbar {
  display: flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 8px;
  background: var(--hl-bar);
  border-bottom: 1px solid var(--hl-line);
}
.hl-profs { display: flex; align-items: center; gap: 3px; }
.hl-prof {
  display: flex; align-items: center; gap: 5px;
  padding: 2px 8px; border-radius: 4px;
  color: var(--hl-txt2);
}
.hl-prof[aria-selected='true'] { background: var(--hl-bg); color: var(--hl-txt); }
.hl-prof[data-marker='error']::after { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--hl-red); }
.hl-prof[data-marker='permission']::after { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--hl-cyn); }

/* The identity dot reuses the profile colour muted, and only saturates when
   active — design §8.3. It says which profile, never whether it works. */
.hl-pdot { width: 6px; height: 6px; border-radius: 50%; opacity: .45; }
.hl-pdot[data-active] { opacity: 1; }
.hl-pdot[data-tone='green']  { background: var(--hl-grn); }
.hl-pdot[data-tone='amber']  { background: var(--hl-amb); }
.hl-pdot[data-tone='red']    { background: var(--hl-red); }
.hl-pdot[data-tone='blue']   { background: var(--hl-acc); }
.hl-pdot[data-tone='violet'] { background: #a48cf0; }
.hl-pdot[data-tone='cyan']   { background: var(--hl-cyn); }

.hl-prof-meta { margin-left: auto; color: var(--hl-txt3); }

.hl-editstrip {
  display: flex; align-items: center; gap: 8px;
  height: 28px; padding: 0 8px;
  background: var(--hl-bg);
  border-bottom: 1px solid var(--hl-line);
}
.hl-swatches { display: flex; gap: 4px; }
.hl-swatch { width: 12px; height: 12px; border-radius: 50%; }
.hl-swatch[data-chosen] { outline: 1.5px solid var(--hl-acc); outline-offset: 1px; }
.hl-swatch[data-tone='green']  { background: var(--hl-grn); }
.hl-swatch[data-tone='amber']  { background: var(--hl-amb); }
.hl-swatch[data-tone='red']    { background: var(--hl-red); }
.hl-swatch[data-tone='blue']   { background: var(--hl-acc); }
.hl-swatch[data-tone='violet'] { background: #a48cf0; }
.hl-delete { margin-left: auto; color: var(--hl-red); }
```

- [ ] **Step 6: 통과 확인 + 변이 검증**

```
npx vitest run tests/unit/ProfileBar.test.tsx
```

깨뜨려 확인하고 복구한다: `onClick` 을 `() => onSelect(p.id)` 로 단순화한다 → "opens editing when the ALREADY active tab is clicked" 가 붉어져야 한다.

- [ ] **Step 7: 전체 스위트와 커밋**

```
npm test
```

```bash
git add components/ProfileBar.tsx components/ProfileEditStrip.tsx \
        entrypoints/popup/style.css tests/unit/ProfileBar.test.tsx
git commit -m "feat: 프로필 바와 제자리 관리 스트립

활성 탭을 다시 누르면 편집이 열린다. 오버레이 없이 관리 표면을 얻는
가장 짧은 경로다.

탭 표식은 정체성 점과 별개다 — 점은 어느 프로필인지, 표식은 동작하는지를
말한다. compile 은 모든 프로필을 진단하는데 그리드는 하나만 보여주므로,
표식이 없으면 두 탭 건너의 고장이 보이지 않는다."
```

---

### Task 7: 필터 블록과 톱바

**Files:**
- Create: `components/FilterBlock.tsx`
- Create: `components/TopBar.tsx`
- Create: `components/StatusFoot.tsx`
- Test: `tests/unit/Chrome.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface FilterBlockProps {
    filter: Filter;
    onPatch: (patch: Partial<Filter>) => void;
  }
  export function FilterBlock(props: FilterBlockProps): JSX.Element;

  export interface TopBarProps {
    paused: boolean;
    onTogglePause: (paused: boolean) => void;
  }
  export function TopBar(props: TopBarProps): JSX.Element;

  export interface StatusFootProps {
    applying: number;
    total: number;
    off: number;
    needsAccess: number;
    lastError: string | null;
  }
  export function StatusFoot(props: StatusFootProps): JSX.Element;
  ```

**리소스 타입 8종.** `ResourceType` 은 15종이지만 목업은 3개 + `+5` 로 8개를 보인다. UI 가 노출하는 것은 다음 8종이고, 나머지는 상태에 있으면 유지하되 칩으로 보이지 않는다:

```
main_frame · sub_frame · xmlhttprequest · script · stylesheet · image · font · media
```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/Chrome.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterBlock } from '@/components/FilterBlock';
import { TopBar } from '@/components/TopBar';
import { StatusFoot } from '@/components/StatusFoot';
import type { Filter } from '@/lib/model/types';

function filter(over: Partial<Filter> = {}): Filter {
  return {
    mode: 'structured',
    domains: ['api.example.com'],
    excludedDomains: [],
    resourceTypes: ['xmlhttprequest', 'main_frame'],
    ...over,
  };
}

describe('FilterBlock', () => {
  it('shows the domains joined for reading', () => {
    render(<FilterBlock filter={filter({ domains: ['a.com', 'b.com'] })} onPatch={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /Match domains/ }).getAttribute('value')).toBe('a.com, b.com');
  });

  it('commits domains on blur, split and trimmed', async () => {
    const onPatch = vi.fn();
    render(<FilterBlock filter={filter({ domains: [] })} onPatch={onPatch} />);
    const input = screen.getByRole('textbox', { name: /Match domains/ });
    await userEvent.type(input, ' a.com ,  b.com ');
    expect(onPatch).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(onPatch).toHaveBeenCalledWith({ domains: ['a.com', 'b.com'] });
  });

  it('does not swallow a comma while typing', async () => {
    // The Phase 1 popup split on every keystroke, so a comma vanished as you
    // typed it. The draft is local now, which is what fixes it.
    const onPatch = vi.fn();
    render(<FilterBlock filter={filter({ domains: [] })} onPatch={onPatch} />);
    const input = screen.getByRole('textbox', { name: /Match domains/ });
    await userEvent.type(input, 'a.com,');
    expect(input.getAttribute('value')).toBe('a.com,');
  });

  it('shows the eight offered resource types as chips', () => {
    render(<FilterBlock filter={filter()} onPatch={vi.fn()} />);
    expect(screen.getAllByTestId('type-chip')).toHaveLength(8);
  });

  it('marks the selected types', () => {
    render(<FilterBlock filter={filter({ resourceTypes: ['script'] })} onPatch={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'script' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'image' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('adds a type when an unselected chip is clicked', async () => {
    const onPatch = vi.fn();
    render(<FilterBlock filter={filter({ resourceTypes: ['script'] })} onPatch={onPatch} />);
    await userEvent.click(screen.getByRole('button', { name: 'image' }));
    expect(onPatch).toHaveBeenCalledWith({ resourceTypes: ['script', 'image'] });
  });

  it('removes a type when a selected chip is clicked', async () => {
    const onPatch = vi.fn();
    render(<FilterBlock filter={filter({ resourceTypes: ['script', 'image'] })} onPatch={onPatch} />);
    await userEvent.click(screen.getByRole('button', { name: 'script' }));
    expect(onPatch).toHaveBeenCalledWith({ resourceTypes: ['image'] });
  });

  it('refuses to remove the last type — DNR rejects an empty array', async () => {
    const onPatch = vi.fn();
    render(<FilterBlock filter={filter({ resourceTypes: ['script'] })} onPatch={onPatch} />);
    await userEvent.click(screen.getByRole('button', { name: 'script' }));
    expect(onPatch).not.toHaveBeenCalled();
  });
});

describe('TopBar', () => {
  it('says Running when not paused', () => {
    render(<TopBar paused={false} onTogglePause={vi.fn()} />);
    expect(screen.getByTestId('runstate').textContent).toContain('Running');
  });

  it('says Paused when paused', () => {
    render(<TopBar paused onTogglePause={vi.fn()} />);
    expect(screen.getByTestId('runstate').textContent).toContain('Paused');
  });

  it('toggles', async () => {
    const onTogglePause = vi.fn();
    render(<TopBar paused={false} onTogglePause={onTogglePause} />);
    await userEvent.click(screen.getByRole('button', { name: /Pause all/ }));
    expect(onTogglePause).toHaveBeenCalledWith(true);
  });
});

describe('StatusFoot', () => {
  it('reports the counts', () => {
    render(<StatusFoot applying={6} total={8} off={1} needsAccess={0} lastError={null} />);
    expect(screen.getByTestId('foot').textContent).toContain('6 of 8 rules applying');
    expect(screen.getByTestId('foot').textContent).toContain('1 off');
  });

  it('mentions needed access only when some is needed', () => {
    const { rerender } = render(<StatusFoot applying={6} total={8} off={1} needsAccess={0} lastError={null} />);
    expect(screen.queryByTestId('needs-access')).toBeNull();
    rerender(<StatusFoot applying={6} total={8} off={1} needsAccess={2} lastError={null} />);
    expect(screen.getByTestId('needs-access').textContent).toContain('2 need access');
  });

  it('shows the real failure text when the last sync failed', () => {
    render(<StatusFoot applying={0} total={3} off={0} needsAccess={0} lastError="Rule 3 is invalid" />);
    expect(screen.getByTestId('foot').textContent).toContain('Rule 3 is invalid');
  });
});
```

- [ ] **Step 2: 실패 확인**

```
npx vitest run tests/unit/Chrome.test.tsx
```
기대: FAIL — 세 컴포넌트가 없다.

- [ ] **Step 3: `FilterBlock.tsx`**

```tsx
import { useState } from 'react';
import type { Filter, ResourceType } from '@/lib/model/types';

/**
 * The eight types the popup offers. `ResourceType` has fifteen; the rest are
 * rare enough that a chip each would cost more than it earns. A type already
 * in state that is not offered here is left alone rather than dropped.
 */
const OFFERED: ResourceType[] = [
  'main_frame', 'sub_frame', 'xmlhttprequest', 'script',
  'stylesheet', 'image', 'font', 'media',
];

export interface FilterBlockProps {
  filter: Filter;
  onPatch: (patch: Partial<Filter>) => void;
}

export function FilterBlock({ filter, onPatch }: FilterBlockProps) {
  const [draft, setDraft] = useState(filter.domains.join(', '));

  /**
   * Commits on blur, not per keystroke. The Phase 1 popup split on every
   * change, so typing a comma made it disappear before the next character
   * arrived.
   */
  const commitDomains = () => {
    const next = draft.split(',').map((d) => d.trim()).filter(Boolean);
    const same =
      next.length === filter.domains.length && next.every((d, i) => d === filter.domains[i]);
    if (!same) onPatch({ domains: next });
  };

  const toggleType = (type: ResourceType) => {
    const has = filter.resourceTypes.includes(type);
    // DNR rejects an empty resourceTypes array, and its default silently
    // excludes main_frame — so the last one cannot be removed.
    if (has && filter.resourceTypes.length === 1) return;
    const next = has
      ? filter.resourceTypes.filter((t) => t !== type)
      : [...filter.resourceTypes, type];
    onPatch({ resourceTypes: next });
  };

  return (
    <div className="hl-filters">
      <div className="hl-frow">
        <span className="hl-flabel">Match</span>
        <input
          aria-label="Match domains"
          className="hl-field"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDomains}
          onKeyDown={(e) => { if (e.key === 'Enter') commitDomains(); }}
          placeholder="api.example.com, localhost"
        />
      </div>
      <div className="hl-frow">
        <span className="hl-flabel">Types</span>
        <div className="hl-chips">
          {OFFERED.map((type) => (
            <button
              key={type}
              data-testid="type-chip"
              aria-label={type}
              aria-pressed={filter.resourceTypes.includes(type)}
              className="hl-chip"
              onClick={() => toggleType(type)}
            >
              {type}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `TopBar.tsx`**

```tsx
export interface TopBarProps {
  paused: boolean;
  onTogglePause: (paused: boolean) => void;
}

export function TopBar({ paused, onTogglePause }: TopBarProps) {
  return (
    <div className="hl-topbar">
      <span className="hl-brand">
        Header<b>Lab</b>
      </span>
      <span className="hl-runstate" data-testid="runstate" data-paused={paused || undefined}>
        <span className="hl-fdot" />
        {paused ? 'Paused' : 'Running'}
      </span>
      <button
        className="hl-pause"
        aria-label={paused ? 'Resume all' : 'Pause all'}
        onClick={() => onTogglePause(!paused)}
      >
        {paused ? 'Resume all' : 'Pause all'}
      </button>
    </div>
  );
}
```

- [ ] **Step 5: `StatusFoot.tsx`**

```tsx
export interface StatusFootProps {
  applying: number;
  total: number;
  off: number;
  needsAccess: number;
  /** The real text of the last failed reconcile, from session storage. */
  lastError: string | null;
}

export function StatusFoot({ applying, total, off, needsAccess, lastError }: StatusFootProps) {
  return (
    <div className="hl-foot" data-testid="foot">
      {lastError !== null ? (
        <span className="hl-footerr">{lastError}</span>
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

- [ ] **Step 6: 스타일**

```css
.hl-topbar {
  display: flex; align-items: center; gap: 8px;
  height: 34px; padding: 0 10px;
  background: var(--hl-bar);
  border-bottom: 1px solid var(--hl-line);
}
.hl-brand { font-weight: 500; letter-spacing: .2px; }
.hl-runstate { margin-left: auto; display: flex; align-items: center; gap: 5px; color: var(--hl-grn); }
.hl-runstate[data-paused] { color: var(--hl-txt3); }
.hl-fdot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.hl-pause { padding: 2px 8px; border-radius: 4px; color: var(--hl-txt2); }

.hl-filters { padding: 5px 8px; background: var(--hl-bar); border-bottom: 1px solid var(--hl-line); }
.hl-frow { display: flex; align-items: center; gap: 8px; min-height: 24px; }
.hl-flabel { width: 40px; color: var(--hl-txt3); }
.hl-field { flex: 1; background: transparent; color: inherit; font: inherit; border: 0; outline: 0; }
.hl-field:focus { outline: 1px solid var(--hl-acc); }
.hl-chips { display: flex; flex-wrap: wrap; gap: 3px; }
.hl-chip { padding: 1px 6px; border-radius: 3px; color: var(--hl-txt3); border: 1px solid var(--hl-cell); }
.hl-chip[aria-pressed='true'] { color: var(--hl-txt); border-color: var(--hl-acc); }

.hl-foot {
  display: flex; align-items: center; gap: 5px;
  height: 26px; padding: 0 10px;
  background: var(--hl-bar);
  border-top: 1px solid var(--hl-line);
  color: var(--hl-txt2);
}
.hl-sep { color: var(--hl-txt3); }
.hl-footerr { color: var(--hl-red); }
.hl-pendtag { margin-left: auto; color: var(--hl-cyn); }
```

- [ ] **Step 7: 통과 확인 + 변이 검증**

```
npx vitest run tests/unit/Chrome.test.tsx
```

깨뜨려 확인하고 복구한다: `toggleType` 의 마지막 하나 가드(`if (has && ...length === 1) return;`)를 지운다 → "refuses to remove the last type" 이 붉어져야 한다.

- [ ] **Step 8: 전체 스위트와 커밋**

```
npm test
```

```bash
git add components/FilterBlock.tsx components/TopBar.tsx components/StatusFoot.tsx \
        entrypoints/popup/style.css tests/unit/Chrome.test.tsx
git commit -m "feat: 필터 블록 · 톱바 · 상태 줄

도메인 입력이 blur 에서 커밋된다 — Phase 1 팝업은 키 입력마다 쪼개서
쉼표를 치는 순간 삼켰다.

리소스 타입은 마지막 하나를 지울 수 없다. DNR 은 빈 배열을 거부하고
기본값은 main_frame 을 조용히 제외한다."
```

---

### Task 8: 조립 — `App.tsx` 와 권한 부여

**Files:**
- Replace: `entrypoints/popup/App.tsx`
- Test: `tests/unit/App.test.tsx`

**Interfaces:**
- Consumes: 앞선 모든 컴포넌트, `compile`, `domainsToAudit`, `probeGrants`, `auditDiagnostics`, `requestHost`, `getSyncStatus`, `useAppState`

**부여는 호스트 단위로 한다.** `requiredOrigins` 를 배열째 `permissions.request()` 에 넘기면 항목 하나가 호출 전체를 죽인다(인수인계 §4.1). `probe.ts` 의 `requestHost(host)` 를 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/unit/App.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/entrypoints/popup/App';
import { createProfile } from '@/lib/model/defaults';
import * as probe from '@/lib/permissions/probe';
import type { AppState } from '@/lib/model/types';

function seed(state: AppState) {
  return fakeBrowser.storage.local.set({ state, state$: { v: 1 } });
}

function stateWith(): AppState {
  const p = createProfile('Local', 0);
  return {
    version: 1,
    globalPause: false,
    theme: 'system',
    profiles: [{
      ...p,
      id: 'p1',
      filter: { ...p.filter, domains: ['api.example.com'] },
      headers: [
        { id: 'h1', enabled: true, target: 'request', operation: 'set', name: 'X-A', value: '1' },
        { id: 'h2', enabled: true, target: 'response', operation: 'set', name: 'X-B', value: '2' },
      ],
    }],
  };
}

beforeEach(() => {
  fakeBrowser.reset();
  // permissions.* are throwing stubs in fake-browser; the popup probes on mount.
  vi.spyOn(probe, 'probeGrants').mockResolvedValue([{ domain: 'api.example.com', granted: true }]);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('App', () => {
  it('renders the rows from stored state', async () => {
    await seed(stateWith());
    render(<App />);
    expect(await screen.findByDisplayValue('X-A')).toBeTruthy();
    expect(screen.getByDisplayValue('X-B')).toBeTruthy();
  });

  it('shows a diagnostic computed from that state, without a browser', async () => {
    const s = stateWith();
    s.profiles[0]!.headers[0]!.name = '';   // invalid-header-name
    await seed(s);
    render(<App />);
    expect(await screen.findByText(/Header name is empty/)).toBeTruthy();
  });

  it('offers Grant when a host is not granted, and requests that host alone', async () => {
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([{ domain: 'api.example.com', granted: false }]);
    const requestHost = vi.spyOn(probe, 'requestHost').mockResolvedValue(true);
    await seed(stateWith());
    render(<App />);

    const grant = await screen.findByRole('button', { name: /Grant/ });
    await userEvent.click(grant);

    // One host per call — passing requiredOrigins as an array would let one
    // bad entry kill the whole request (handoff §4.1).
    expect(requestHost).toHaveBeenCalledTimes(1);
    expect(requestHost).toHaveBeenCalledWith('api.example.com');
  });

  it('writes the toggle through to storage', async () => {
    await seed(stateWith());
    render(<App />);
    const pause = await screen.findByRole('button', { name: 'Pause all' });
    await userEvent.click(pause);
    await waitFor(async () => {
      const stored = await fakeBrowser.storage.local.get('state');
      expect((stored.state as AppState).globalPause).toBe(true);
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

```
npx vitest run tests/unit/App.test.tsx
```
기대: FAIL — 옛 App 이 그리드를 렌더하지 않는다.

- [ ] **Step 3: `App.tsx` 를 교체한다**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { ProfileBar } from '@/components/ProfileBar';
import { ProfileEditStrip } from '@/components/ProfileEditStrip';
import { FilterBlock } from '@/components/FilterBlock';
import { DiagnosticBand } from '@/components/DiagnosticBand';
import { HeaderGrid } from '@/components/HeaderGrid';
import { StatusFoot } from '@/components/StatusFoot';
import { compile } from '@/lib/compile/compile';
import { routeDiagnostics, groupCounts, groupRows } from '@/lib/view/grid';
import { domainsToAudit, auditDiagnostics } from '@/lib/permissions/audit';
import { probeGrants, requestHost } from '@/lib/permissions/probe';
import { getSyncStatus } from '@/lib/storage/session';
import { createProfile } from '@/lib/model/defaults';
import { useAppState } from '@/lib/storage/useAppState';
import type { Diagnostic, Filter, HeaderRule, HeaderTarget, Profile } from '@/lib/model/types';

export default function App() {
  const { state, patch } = useAppState();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [grantDiagnostics, setGrantDiagnostics] = useState<Diagnostic[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);

  // compile() is pure, so the popup runs the same function on the same state
  // the background does. Caching diagnostics in storage would mean keeping the
  // two in step; recomputing means they cannot disagree.
  const compiled = useMemo(() => (state ? compile(state) : null), [state]);

  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    (async () => {
      const grants = await probeGrants(domainsToAudit(state.profiles));
      if (!cancelled) setGrantDiagnostics(auditDiagnostics(state.profiles, grants));
    })();
    return () => { cancelled = true; };
  }, [state]);

  useEffect(() => {
    getSyncStatus().then((s) => setLastError(s.lastError)).catch(() => setLastError(null));
  }, [state]);

  if (!state || !compiled) return <div className="hl-loading">Loading…</div>;

  const profiles = state.profiles;
  const active =
    profiles.find((p) => p.id === activeId) ?? profiles[0];

  const allDiagnostics = [...compiled.diagnostics, ...grantDiagnostics];

  const patchProfile = (id: string, delta: Partial<Profile>) =>
    patch((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...delta } : p)) }));

  const patchRow = (profileId: string, ruleId: string, delta: Partial<HeaderRule>) =>
    patch((s) => ({
      profiles: s.profiles.map((p) =>
        p.id === profileId
          ? { ...p, headers: p.headers.map((h) => (h.id === ruleId ? { ...h, ...delta } : h)) }
          : p,
      ),
    }));

  if (!active) {
    return (
      <>
        <TopBar paused={state.globalPause} onTogglePause={(paused) => patch(() => ({ globalPause: paused }))} />
        <div className="hl-empty">
          <button onClick={() => patch((s) => ({ profiles: [createProfile('Local', s.profiles.length)] }))}>
            Create profile
          </button>
        </div>
      </>
    );
  }

  const routed = routeDiagnostics(allDiagnostics.filter((d) => d.profileId === active.id));
  const groups = groupRows(active);
  const req = groupCounts(groups.request, routed.byRow);
  const res = groupCounts(groups.response, routed.byRow);
  const needsAccess = allDiagnostics.filter((d) => d.kind === 'permission-missing').length;

  return (
    <>
      <TopBar
        paused={state.globalPause}
        onTogglePause={(paused) => patch(() => ({ globalPause: paused }))}
      />
      <ProfileBar
        profiles={profiles}
        activeId={active.id}
        diagnostics={allDiagnostics}
        ruleCount={active.headers.length}
        onSelect={(id) => { setActiveId(id); setEditingProfile(false); }}
        onReselect={() => setEditingProfile((open) => !open)}
        onAdd={() => patch((s) => ({ profiles: [...s.profiles, createProfile('New', s.profiles.length)] }))}
      />
      {editingProfile && (
        <ProfileEditStrip
          profile={active}
          onPatch={(delta) => patchProfile(active.id, delta)}
          onDelete={() => {
            patch((s) => ({ profiles: s.profiles.filter((p) => p.id !== active.id) }));
            setEditingProfile(false);
            setActiveId(null);
          }}
          onClose={() => setEditingProfile(false)}
        />
      )}
      <FilterBlock
        filter={active.filter}
        onPatch={(delta: Partial<Filter>) =>
          patchProfile(active.id, { filter: { ...active.filter, ...delta } })
        }
      />
      <DiagnosticBand
        diagnostics={routed.profileLevel}
        onGrant={async (host) => {
          await requestHost(host);
          const grants = await probeGrants(domainsToAudit(state.profiles));
          setGrantDiagnostics(auditDiagnostics(state.profiles, grants));
        }}
      />
      <HeaderGrid
        profile={active}
        byRow={routed.byRow}
        onToggleRow={(ruleId, enabled) => patchRow(active.id, ruleId, { enabled })}
        onPatchRow={(ruleId, delta) => patchRow(active.id, ruleId, delta)}
        onDeleteRow={(ruleId) =>
          patchProfile(active.id, { headers: active.headers.filter((h) => h.id !== ruleId) })
        }
        onAddRow={(target: HeaderTarget) =>
          patchProfile(active.id, {
            headers: [
              ...active.headers,
              {
                id: crypto.randomUUID(),
                enabled: true,
                target,
                operation: 'set',
                name: '',
                value: '',
              },
            ],
          })
        }
      />
      <StatusFoot
        applying={req.applying + res.applying}
        total={req.total + res.total}
        off={req.off + res.off}
        needsAccess={needsAccess}
        lastError={lastError}
      />
    </>
  );
}
```

> **새 행이 빈 이름으로 시작하는 것은 의도된 것이다.** Phase 1 에서 이것이 `updateDynamicRules` 를 트랜잭션째 죽였는데, 이제 `headers.ts` 가 그런 행을 드롭하고 `validate.ts` 가 `invalid-header-name` 을 내므로 안전하고, 사용자는 왜 아직 적용되지 않는지 즉시 본다.

- [ ] **Step 4: 통과 확인**

```
npx vitest run tests/unit/App.test.tsx
```

- [ ] **Step 5: 단언이 실제로 실패할 수 있는지 확인한다**

배선 태스크라 부정 단언이 공허할 위험이 크다. 둘을 깨뜨려 보고 복구한다:

1. `onGrant` 에서 `requestHost(host)` 대신 `requestHost(host); requestHost(host);` 로 두 번 부른다 → `toHaveBeenCalledTimes(1)` 이 붉어져야 한다
2. `allDiagnostics` 에서 `grantDiagnostics` 를 뺀다 → Grant 테스트가 붉어져야 한다

- [ ] **Step 6: 전체 스위트와 손 확인**

```
npm test
npm run dev
```

`.output/chrome-mv3-dev` 를 언팩 로드하고 팝업을 연다. 확인할 것:

- 프로필이 없으면 Create profile, 만들면 그리드가 뜬다
- 헤더 행을 추가하면 이름이 비어 `invalid-header-name` 이 서브행에 뜬다
- 이름을 채우면 사라지고 카운트가 오른다
- 도메인에 `localhost:3000` 을 넣으면 `port-ignored` 가 띠에 뜬다
- Pause all 을 누르면 상태 줄이 바뀐다
- **서비스 워커 콘솔이 조용하다**

- [ ] **Step 7: 커밋**

```bash
git add entrypoints/popup/App.tsx tests/unit/App.test.tsx
git commit -m "feat: 그리드를 조립하고 권한 부여를 붙인다

팝업이 직접 compile() 을 돌린다 — 순수 함수라 백그라운드와 같은 상태에
같은 함수를 적용하므로 화면과 등록된 룰이 어긋날 수 없다.

부여는 호스트 단위다. requiredOrigins 를 배열째 permissions.request() 에
넘기면 항목 하나가 호출 전체를 죽인다(인수인계 §4.1)."
```

---

### Task 9: E2E 갱신

**Files:**
- Modify: `tests/e2e/header-modification.spec.ts` (세 번째 테스트만)

**헤더 변경을 단언하는 두 테스트는 건드리지 않는다.** 그 둘이 "헤더가 실제로 바뀐다"에 답하는 유일한 층이다.

- [ ] **Step 1: 세 번째 테스트를 갱신한다**

현재:

```ts
test('the popup renders in the real extension', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByRole('button', { name: 'Create profile' })).toBeVisible();
  await page.close();
});
```

다음으로 교체한다 — 상태를 주입하고 그리드가 실제로 그것을 렌더하는지 본다. **약화가 아니라 강화다:**

```ts
test('the popup renders the grid from stored state', async ({ context, extensionId, serviceWorker }) => {
  await serviceWorker.evaluate(async () => {
    const state = {
      version: 1,
      globalPause: false,
      theme: 'system',
      profiles: [{
        id: 'p1', name: 'Local', color: 'green', enabled: true, order: 0,
        filter: {
          mode: 'structured', domains: ['api.example.com'],
          excludedDomains: [], resourceTypes: ['xmlhttprequest'],
        },
        tabLock: { enabled: false, tabId: null, tabTitle: null },
        headers: [
          { id: 'h1', enabled: true, target: 'request', operation: 'set', name: 'X-From-E2E', value: 'yes' },
        ],
      }],
    };
    // `local:state` maps to the chrome.storage.local key `state`. WXT keeps the
    // version in a companion key.
    await chrome.storage.local.set({ state, state$: { v: 1 } });
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  // The row's name lives in an input, so its value is the assertion.
  await expect(page.getByDisplayValue('X-From-E2E')).toBeVisible();
  await expect(page.getByText('1 of 1 applying').first()).toBeVisible();

  await page.close();
});
```

> `serviceWorker` 픽스처는 이미 `tests/e2e/fixtures.ts` 에 있다. `chrome` 전역은 그 파일이 쓰는 방식대로 좁게 `declare` 한다 — 기존 두 테스트가 하는 것과 같다.

- [ ] **Step 2: E2E 를 돌린다**

```
npm run test:e2e
```
기대: 3/3. 헤더 변경 두 테스트는 그대로여야 한다.

- [ ] **Step 3: 커밋**

```bash
git add tests/e2e/header-modification.spec.ts
git commit -m "test: E2E 팝업 테스트가 그리드를 실제로 확인하게 한다

'Create profile 버튼이 보인다'에서 '주입한 상태의 행이 렌더된다'로.
헤더 변경을 단언하는 두 테스트는 건드리지 않았다."
```

---

## 완료 기준

- [ ] `npm run compile` 통과
- [ ] `npm test` 통과 — 기존 230개 + 신규 전부
- [ ] `npm run test:e2e` **3/3**, 헤더 변경 두 테스트 무변경
- [ ] 순수성 가드가 `lib/view/grid.ts` 를 덮는다
- [ ] `--cols` 선언이 CSS 전체에 **정확히 한 번**
- [ ] 빌드 매니페스트 무변경 — `permissions` 둘, `host_permissions` 키 부재
- [ ] 산출물에 네트워크 프리미티브 0
- [ ] 실제 확장에서 다크/라이트가 OS 설정을 따르고 **CSP 위반이 없다**

## Phase 2b 가 만들지 않는 것

Tab lock · JSON export/import · ⋯ 메뉴 · 테마 토글 · 행 복제·이동 · 가상 스크롤 · `empty-filter` 를 두 종류로 쪼개기(인수인계 §4.3 — 진단 층의 변경이라 UI 단계에 섞지 않는다).
