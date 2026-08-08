# HeaderLab 디자인 시스템화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팝업의 손수 쓴 1143줄 stylesheet 를 Tailwind 토큰 + shadcn 프리미티브 + lucide 아이콘으로 바꿔, 서체가 아니라 크기·무게가 위계를 만들고 컨트롤 언어가 하나이며 목록이 넘쳐도 조용히 잘리지 않는 UI 로 만든다.

**Architecture:** 정보 구조(224px 범위 레일 + 규칙 패널)와 `lib/` 순수 계층은 손대지 않는다. `entrypoints/popup/style.css` 가 Tailwind 진입점이 되고 토큰 어휘는 shadcn 표준 하나로 통일된다. 6개 컴포넌트는 파일이 유지되고 내부만 바뀌며, `data-testid` 는 전부 계약으로 남는다. 가드는 한 번도 어두워지지 않는 순서로 옮긴다.

**Tech Stack:** Tailwind v4 (`@tailwindcss/vite`, 설치됨) · shadcn `radix-nova` 스타일 · `radix-ui@1.6.7` · `lucide-react@1.27.0` · React 19 · WXT 0.21 · Vitest 4 · Playwright 1.62

**Spec:** `docs/superpowers/specs/2026-08-07-headerlab-design-system-design.md`
**Reference mockup:** `docs/design/2026-08-07-popup-tight-instrument.html` — 평상/과밀 두 상태를 담고 있다. **모든 시각적 판단은 이 파일이 기준이다.**

## Global Constraints

- **새 의존성 금지.** shadcn 컴포넌트는 커밋되는 소스이고 필요한 Radix primitive 는 `radix-ui@1.6.7` 에 전부 있다. `npm install <새 패키지>` 를 실행하지 않는다.
- **`npm install` 을 실행하지 않는다.** 프록시가 플랫폼 바인딩 메타데이터를 낡은 채로 주어 락파일이 깨진다. `npx shadcn add` 는 소스만 받으므로 안전하지만, 실행 후 `git diff package-lock.json` 이 비어 있는지 확인한다.
- **`npm test` 를 쓴다. `npx vitest run` 을 쓰지 않는다.** 여러 스위트가 빌드 산출물을 읽는다.
- **`data-testid` 는 계약이다.** 기존 17개를 이름 그대로 유지한다: `add-site-note` `all-sites` `help-bubble` `icon-error` `readout` `rule` `rule-problem` `rule-value` `runstate` `scope-note` `site` `site-count` `site-line` `site-pending` `sync-error` `type-check` `unreadable-store`.
- **행 높이는 고정** — 사이트 48px, 규칙 52px. 형제 수와 무관하다.
- **목록 높이는 내용만큼 자라되 `max-height` 에서 멈춘다.** `max-height` 값은 행 높이의 정수배가 **아니게** 잡아, 넘칠 때만 가장자리 행이 중간에서 잘리게 한다. 그 잘린 행이 "더 있다"는 신호다 — 스크롤바가 보인다고 가정하지 않는다(`::-webkit-scrollbar` 는 Chromium 오버레이를 끄지 못한다, 대조 실험으로 반증됨).
- **모노스페이스는 사용자가 타이핑하는 값에만** — 호스트명과 헤더 값. 헤더 이름·리소스 타입·섹션 라벨은 산세리프.
- **대문자 라벨 금지.** 문장 케이스. 예외는 REQ/RES 뿐.
- **알약(999px)은 스위치 트랙 전용.** 반지름 사다리: 컨트롤 ≤22px → 4px, 컨트롤 24–32px → 6px, 행 → 8px, 표면 → 10px.
- 텍스트 대비 ≥ 4.5:1, 상호작용 컨트롤 경계 ≥ 3:1. 유일한 예외는 스위치 OFF 트랙.
- 커밋 메시지는 한국어 제목, `<type>: <description>`.

---

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `entrypoints/popup/style.css` | Tailwind 진입점 + 토큰 두 팔레트 | 전면 교체 (Task 1 → Task 10) |
| `tests/unit/contrast.test.ts` | 두 팔레트의 대비 보장 | 이름 이관 + 3:1 경계 검사 추가 (Task 1) |
| `tests/e2e/header-modification.spec.ts` | 레이아웃 가드 | 앵커 이관 (Task 2), 과밀 가드 추가 (Task 3) |
| `components/ui/checkbox.tsx` `tooltip.tsx` `badge.tsx` `separator.tsx` | shadcn 프리미티브 | 생성 (Task 3) |
| `components/TypeChecklist.tsx` | 8개 리소스 타입 | 내부 교체 (Task 4) |
| `components/SiteRow.tsx` | 사이트 1행 + 상태 + Grant | 내부 교체 (Task 5) |
| `components/AddSiteField.tsx` | 사이트 추가 | 내부 교체 (Task 6) |
| `components/RuleCard.tsx` | 규칙 1행 | 내부 교체 (Task 7) |
| `components/RulePanel.tsx` | 규칙 목록 + 스크롤 컨테이너 | 내부 교체 (Task 8) |
| `components/ScopeRail.tsx` | 레일 전체 + 사이트 스크롤 컨테이너 | 내부 교체 (Task 9) |
| `components/HelpTip.tsx` | 도움말 | 삭제, tooltip 으로 대체 (Task 9) |
| `tests/unit/HelpTip.test.tsx` | 도움말 동작 | `tooltip.test.tsx` 로 이동 (Task 9) |

---

## Task 1: Tailwind 를 켜고 토큰 어휘를 옮긴다

**Files:**
- Modify: `entrypoints/popup/style.css` (선두에 Tailwind 지시문 + `:root`/`.dark` 블록 교체)
- Modify: `tests/unit/contrast.test.ts`

**Interfaces:**
- Produces: CSS 커스텀 프로퍼티 이름 — 이후 모든 태스크가 이 이름으로 Tailwind 유틸리티를 쓴다.
  `--background --foreground --foreground-2 --muted-foreground --card --border --rail --rail-border --input --primary --primary-foreground --ring --boundary --live --live-bg --pending --pending-bg --pending-border --destructive --destructive-bg --req --req-bg --res --res-bg`

- [ ] **Step 1: 대비 테스트를 새 이름으로 옮긴다 (실패하는 테스트)**

`tests/unit/contrast.test.ts` 에서 세 곳을 바꾼다. **쌍 목록과 4.5:1 기준, 두 팔레트를 각각 검사한다는 성질은 건드리지 않는다.**

정규식을 새 접두사에 맞춘다:

```ts
for (const [, name, value] of match[1]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
```

`NON_COLOR` 와 `COLOR_TOKENS` 를 교체한다:

```ts
/** 색이 아닌 토큰. 형태 검사에서 제외된다. */
const NON_COLOR = ['--radius'];

/** 두 팔레트가 모두 정의해야 하는 색 토큰. 이름이 바뀌면 조용히 지나가지 않는다. */
const COLOR_TOKENS = [
  '--background', '--foreground', '--foreground-2', '--muted-foreground',
  '--card', '--border', '--rail', '--rail-border', '--input',
  '--primary', '--primary-foreground', '--ring', '--boundary',
  '--live', '--live-bg',
  '--pending', '--pending-bg', '--pending-border',
  '--destructive', '--destructive-bg',
  '--req', '--req-bg', '--res', '--res-bg',
] as const;
```

기존 쌍 목록의 토큰 이름을 아래 표대로 치환한다. **쌍의 구성은 바꾸지 않는다** — 같은 요소가 같은 배경 위에 있다.

| 옛 이름 | 새 이름 |
|---|---|
| `--hl-panel` | `--background` |
| `--hl-ink` | `--foreground` |
| `--hl-ink-2` | `--foreground-2` |
| `--hl-ink-3` | `--muted-foreground` |
| `--hl-card` | `--card` |
| `--hl-card-edge` | `--border` |
| `--hl-rail` | `--rail` |
| `--hl-rail-edge` | `--rail-border` |
| `--hl-off-track` | `--input` |
| `--hl-act` | `--ring` |
| `--hl-live` / `--hl-live-bg` | `--live` / `--live-bg` |
| `--hl-pend` / `--hl-pend-bg` / `--hl-pend-edge` | `--pending` / `--pending-bg` / `--pending-border` |
| `--hl-err` / `--hl-err-bg` | `--destructive` / `--destructive-bg` |
| `--hl-req-fg` / `--hl-req-bg` | `--req` / `--req-bg` |
| `--hl-res-fg` / `--hl-res-bg` | `--res` / `--res-bg` |

- [ ] **Step 2: 3:1 경계 검사를 추가한다 (실패하는 테스트)**

파일 끝에 붙인다. 지금 이 검사는 존재하지 않고, 시안 5개 중 5개가 여기서 걸렸다.

```ts
/**
 * WCAG 1.4.11. 경계선이 그것을 컨트롤로 식별시키는 유일한 단서인 자리들 —
 * 점선 "add" 슬롯과 체크박스 테두리. 시안 다섯 개가 전부 여기서 걸렸고,
 * 그때까지 이 저장소에는 이 검사가 없었다.
 *
 * 스위치의 OFF 트랙은 유일하게 허용되는 예외다: 단어가 아니라 형태이고,
 * 그 안의 흰 노브가 상태를 말한다.
 */
describe.each(['light', 'dark'] as const)('%s control boundaries', (theme) => {
  const palette = PALETTES[theme];

  it.each([
    ['--boundary', '--rail'],
    ['--boundary', '--background'],
    ['--boundary', '--card'],
  ] as const)('%s on %s reaches 3:1', (fg, bg) => {
    expect(contrast(palette[fg]!, palette[bg]!)).toBeGreaterThanOrEqual(SHAPE);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npm test -- contrast`
Expected: FAIL — `light defines exactly the known colour tokens` 가 옛 `--hl-*` 이름을 찾아 새 목록과 불일치.

- [ ] **Step 4: Tailwind 를 켜고 토큰을 쓴다**

`entrypoints/popup/style.css` 의 **선두**에 넣는다:

```css
@import "tailwindcss";

/* public/theme.js 가 파싱 시점에 documentElement 에 .dark 를 붙인다.
   MV3 는 인라인 스크립트를 막으므로 그 부트스트랩은 classic script 로 남고,
   Tailwind 는 미디어 쿼리가 아니라 그 클래스를 봐야 한다. */
@custom-variant dark (&:is(.dark *));
```

기존 `:root` 와 `.dark` 블록의 **내용만** 아래로 교체한다(블록 자체와 그 위 주석은 유지).

```css
:root {
  --radius: 8px;

  --background: #ffffff;
  --foreground: #14161c;
  --foreground-2: #454b57;
  --muted-foreground: #5c6371;
  --card: #ffffff;
  --border: #d5d9e1;

  /* 레일은 패널과 다른 재료다. 다크에서 순서가 뒤집힌다 — 라이트에선 레일이
     더 어둡고 패널이 밝은 작업면, 다크에선 레일이 떠 있고 패널이 물러난다.
     shadcn 기본 어휘에는 이 개념이 없어서 따로 둔다. */
  --rail: #f0f1f4;
  --rail-border: #d5d9e1;

  --input: #b6bcc7;
  --primary: #14161c;
  --primary-foreground: #ffffff;
  --ring: #1a56c4;

  /* 경계선이 컨트롤 식별의 유일한 단서인 자리. 3:1 을 넘어야 한다. */
  --boundary: #767d8c;

  --live: #0d6b41;
  --live-bg: #dcf0e4;
  --pending: #8a5200;
  --pending-bg: #fbefdb;
  --pending-border: #e8c88e;
  --destructive: #b3261e;
  --destructive-bg: #fbe6e3;
  --req: #1a56c4;
  --req-bg: #e4ecfb;
  --res: #6a2fbd;
  --res-bg: #efe7fb;
}

/* 라이트에서 파생하지 않는다. 손으로 맞춘 두 번째 팔레트이고, 그래서
   contrast.test.ts 가 양쪽을 각각 검사한다. */
.dark {
  --background: #0b0f14;
  --foreground: #e7eef6;
  --foreground-2: #a6b3c1;
  --muted-foreground: #8b98a6;
  --card: #161d25;
  --border: #242d38;
  --rail: #141a21;
  --rail-border: #232b36;
  --input: #5f6b79;
  --primary: #e7eef6;
  --primary-foreground: #0b0f14;
  --ring: #7fb8f0;
  --boundary: #7b8694;
  --live: #4cde84;
  --live-bg: #10301e;
  --pending: #f0b45c;
  --pending-bg: #2c2113;
  --pending-border: #4e3a1b;
  --destructive: #f08c7c;
  --destructive-bg: #331916;
  --req: #8dc5f7;
  --req-bg: #0f3050;
  --res: #c6abf7;
  --res-bg: #2b1f49;
}

/* 위 토큰을 Tailwind 유틸리티로 노출한다 — bg-rail, text-live, border-boundary 등. */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-foreground-2: var(--foreground-2);
  --color-muted-foreground: var(--muted-foreground);
  --color-card: var(--card);
  --color-border: var(--border);
  --color-rail: var(--rail);
  --color-rail-border: var(--rail-border);
  --color-input: var(--input);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-ring: var(--ring);
  --color-boundary: var(--boundary);
  --color-live: var(--live);
  --color-live-bg: var(--live-bg);
  --color-pending: var(--pending);
  --color-pending-bg: var(--pending-bg);
  --color-pending-border: var(--pending-border);
  --color-destructive: var(--destructive);
  --color-destructive-bg: var(--destructive-bg);
  --color-req: var(--req);
  --color-req-bg: var(--req-bg);
  --color-res: var(--res);
  --color-res-bg: var(--res-bg);
}
```

기존 `.hl-*` 규칙들이 참조하던 `var(--hl-…)` 를 새 이름으로 일괄 치환한다. 위 표가 매핑이다. `--hl-sans` / `--hl-mono` 는 `--font-sans` / `--font-mono` 로 바꾸고 `@theme inline` 에도 넣는다. `--hl-card-sh` 는 라이트에만 그림자가 있고 다크는 `none` 이었는데, 새 팔레트에서는 그림자를 쓰지 않으므로 토큰과 그 사용처를 지운다.

- [ ] **Step 5: 대비 테스트가 통과하는지 확인한다**

Run: `npm test -- contrast`
Expected: PASS. 실패하면 **값을 조정한다** — 테스트가 정답을 정의하고, 특히 `--boundary` 는 세 표면 모두에서 3:1 을 넘어야 한다.

- [ ] **Step 6: 전체 검사와 번들 확인**

Run: `npm run check`
Expected: PASS (591 tests)

Run: `npm run test:e2e`
Expected: 5 passed — 이 시점에 화면은 거의 변하지 않았으므로 레이아웃 가드가 그대로 통과해야 한다.

Tailwind 를 켠 대가를 기록한다:

Run: `npm run build 2>&1 | grep popup.*css`
CSS 크기를 적어둔다(직전은 13.72kB). 늘어난다고 되돌릴 이유는 아니지만 얼마인지는 알아야 한다.

- [ ] **Step 7: 커밋**

```bash
git add entrypoints/popup/style.css tests/unit/contrast.test.ts
git commit -m "$(cat <<'EOF'
refactor: 팝업 토큰을 shadcn 어휘로 옮기고 Tailwind 를 켠다

Tailwind 는 설치돼 있었고 Vite 플러그인까지 물려 있었는데 style.css 에
@import "tailwindcss" 가 없어서 아무것도 방출되지 않았다. 그것 하나가
components/ui/ 와 lib/utils.ts 가 dead code 였던 이유다.

--hl-* 24개를 shadcn 표준 어휘로 통일한다. 컴포넌트가 기대하는 이름을 쓰면
받아온 소스를 고쳐 쓸 일이 없다. 이 제품에만 있는 상태색(live/pending/req/res)
과 레일 표면은 같은 방식으로 확장한다 — shadcn 기본 어휘에는 "레일은 패널과
다른 재료이고 다크에서 순서가 뒤집힌다"는 개념이 없어서, 그대로 가져오면
다크에서 창에 구멍이 뚫린 모양이 된다.

contrast 가드는 읽는 이름만 바뀌고 쌍 목록과 4.5:1 기준, 두 팔레트를 각각
검사한다는 성질은 그대로다. 주제가 살아 있으니 죽는 게 아니라 옮긴다.

3:1 경계 검사를 새로 넣는다. 점선 슬롯과 체크박스 테두리처럼 경계선이 그것을
컨트롤로 식별시키는 유일한 단서인 자리들이고, 시안 다섯 개가 전부 여기서
걸렸는데 그때까지 이 저장소에는 이 검사가 없었다.
EOF
)"
```

---

## Task 2: e2e 레이아웃 앵커를 클래스에서 계약으로 옮긴다

**Files:**
- Modify: `tests/e2e/header-modification.spec.ts:376-385` (`RAIL_BOXES`)
- Modify: `tests/e2e/header-modification.spec.ts:327` (`.hl-pop *` 선택자)
- Modify: `tests/e2e/header-modification.spec.ts:468` (`.hl-subcount`)
- Modify: `components/ScopeRail.tsx` (testid 4개 추가)

**Interfaces:**
- Consumes: Task 1 의 토큰 (시각 변화 없음)
- Produces: 새 testid — `rail-section-types` `type-grid` `add-field` `subcount` `popup-root`. 이후 태스크가 이 이름을 유지해야 한다.

이유: `.hl-*` 클래스는 Task 4~9 에서 사라진다. 클래스는 스타일이고 testid 는 계약이다.

- [ ] **Step 1: ScopeRail 에 testid 를 붙인다**

`components/ScopeRail.tsx` 에서 4곳에 추가한다. **클래스는 아직 그대로 둔다** — 이 태스크는 순수 리팩터다.

```tsx
<div className="hl-railsec hl-railsec-types" data-testid="rail-section-types">
```

`TypeChecklist` 의 루트에 `data-testid="type-grid"`, `AddSiteField` 의 루트에 `data-testid="add-field"`, 그리고 rail 의 `.hl-subcount` 에 `data-testid="subcount"` 를 붙인다. `App.tsx` 의 `.hl-pop` 에 `data-testid="popup-root"` 를 붙인다.

- [ ] **Step 2: e2e 앵커를 testid 로 바꾼다**

```ts
const RAIL_BOXES = [
  '[data-testid="readout"]',
  '[data-testid="runstate"]',
  '[data-testid="all-sites"]',
  '.hl-allsitesstate',
  '[data-testid="site"]',
  '[data-testid="add-field"]',
  '[data-testid="rail-section-types"]',
  '[data-testid="type-grid"]',
] as const;
```

`.hl-allsitesstate` 는 all-sites 행 안의 점이고 testid 가 없다. `ScopeRail.tsx` 의 두 분기(`role="img"` 쪽과 `data-unknown` 쪽) **모두**에 `data-testid="all-sites-state"` 를 붙이고 앵커도 그 selector 로 바꾼다. 두 분기 다 붙여야 하는 이유는 이 앵커가 *옆으로* 움직이는지를 재는 유일한 프로브이기 때문이다.

`.hl-pop *` → `[data-testid="popup-root"] *`, `.hl-subcount` → `[data-testid="subcount"]`.

- [ ] **Step 3: e2e 가 그대로 통과하는지 확인한다**

Run: `npm run test:e2e`
Expected: 5 passed. 시각 변화가 없으므로 좌표 단언이 전부 그대로 맞아야 한다.

- [ ] **Step 4: 앵커가 실제로 무언가를 짚는지 확인한다 (뮤테이션)**

`RAIL_BOXES` 의 첫 항목을 `'[data-testid="does-not-exist"]'` 로 바꾸고 `npm run test:e2e` 를 돌린다. **실패해야 한다.** 통과하면 가드가 빈 selector 를 조용히 넘기고 있다는 뜻이므로, 존재하지 않는 앵커에서 실패하도록 가드를 먼저 고친다. 확인 후 되돌린다.

- [ ] **Step 5: 커밋**

```bash
git add tests/e2e/header-modification.spec.ts components/ScopeRail.tsx entrypoints/popup/App.tsx
git commit -m "$(cat <<'EOF'
test: 레이아웃 가드의 앵커를 클래스에서 testid 로 옮긴다

가드 여덟 개가 .hl-* 클래스로 요소를 짚고 있었다. 그 클래스는 Tailwind 로
가면 사라진다. 클래스는 스타일이고 testid 는 계약이다.

시각 변화 0. 순수 리팩터이고, 존재하지 않는 앵커를 넣으면 실제로 실패하는
것까지 확인했다 — 빈 selector 를 조용히 넘기는 가드였다면 이 이관 자체가
가드를 끄는 일이 됐을 것이다.
EOF
)"
```

---

## Task 3: shadcn 프리미티브를 받고 과밀 가드를 세운다

**Files:**
- Create: `components/ui/checkbox.tsx` `components/ui/tooltip.tsx` `components/ui/badge.tsx` `components/ui/separator.tsx`
- Modify: `tests/e2e/header-modification.spec.ts` (과밀 테스트 추가)

**Interfaces:**
- Consumes: Task 1 의 토큰, Task 2 의 testid
- Produces: `Checkbox` `Tooltip`/`TooltipTrigger`/`TooltipContent`/`TooltipProvider` `Badge` `Separator` — Task 4~9 가 import 한다.

**이 태스크의 e2e 는 빨간 상태로 들어간다.** 현재 UI 가 실제로 잘리기 때문이고, 고쳐야 할 결함이 실재함을 먼저 증명하는 것이 목적이다. Task 9 가 끝나면 초록이 된다.

- [ ] **Step 1: shadcn 컴포넌트를 받는다**

```bash
npx shadcn@4.16.0 add checkbox tooltip badge separator --yes
```

- [ ] **Step 2: 락파일이 안 건드려졌는지 확인한다**

Run: `git diff --stat package-lock.json package.json`
Expected: 비어 있음. 뭔가 나오면 `git checkout -- package-lock.json package.json` 으로 되돌리고, 받은 컴포넌트가 import 하는 것이 `radix-ui` 인지 확인한다(개별 `@radix-ui/react-*` 를 import 하면 그 줄을 `radix-ui` 배럴로 고친다).

- [ ] **Step 3: 받은 소스가 이 팔레트를 읽는지 확인한다**

Run: `grep -oE 'bg-[a-z-]+|text-[a-z-]+|border-[a-z-]+' components/ui/checkbox.tsx components/ui/badge.tsx | sort -u`

`--primary` `--border` `--input` `--ring` 을 쓰면 그대로 둔다. Task 1 에 없는 토큰(`--secondary` `--accent` `--popover` 등)을 쓰면, 그 토큰을 추가하지 말고 **받은 소스를 이 팔레트에 맞춰 고친다** — 어휘를 하나로 두는 것이 이 작업의 목적이다.

- [ ] **Step 4: 과밀 상태 e2e 가드를 쓴다 (실패하는 테스트)**

`tests/e2e/header-modification.spec.ts` 끝에 붙인다.

```ts
/**
 * 시안 다섯 개 중 다섯 개가 정확히 이것에 실패했다. 전부 고정 높이 +
 * overflow: hidden 이라 사이트나 규칙이 하나 늘면 스크롤바도 표시도 없이
 * 사라졌다. 한 시안은 Grant 버튼이 그걸 위해 마련한 바로 그 띠에 7px 잘렸다.
 *
 * 그래서 목록만 스크롤되고, 그 위아래 모든 것은 평상 상태와 같은 좌표에
 * 있어야 한다. 좌표를 재는 이유는 "보인다"는 약한 단언이기 때문이다 —
 * 8px 밀린 것도 보이기는 한다.
 */
test('목록이 넘쳐도 잘리지 않고, 주변은 움직이지 않는다', async ({
  context, extensionId, serviceWorker,
}) => {
  const boxes = async (page: import('@playwright/test').Page) => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const id of ['readout', 'runstate', 'rail-section-types', 'type-grid']) {
      const b = await page.locator(`[data-testid="${id}"]`).first().boundingBox();
      out[id] = { x: Math.round(b!.x), y: Math.round(b!.y) };
    }
    return out;
  };

  const seed = async (sites: string[], rules: number) => {
    await serviceWorker.evaluate(async ({ sites, rules }) => {
      await chrome.storage.local.set({
        state: {
          version: 2, globalPause: false, theme: 'system',
          profiles: [{
            id: 'p', name: 'Default', color: 'green', enabled: true, order: 0,
            filter: {
              mode: 'structured', allSites: false, domains: sites,
              excludedDomains: [],
              resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
            },
            tabLock: { enabled: false, tabId: null, tabTitle: null },
            headers: Array.from({ length: rules }, (_, i) => ({
              id: `h${i}`, enabled: i % 5 !== 0, target: 'request',
              operation: 'set', name: `X-Header-${i}`, value: `value-${i}`,
            })),
          }],
        },
        state$: { v: 2 },
      });
    }, { sites, rules });
  };

  // 평상 상태의 좌표를 먼저 잡는다.
  await seed(['api.example.com', 'staging.example.com'], 4);
  const nominal = await context.newPage();
  await nominal.setViewportSize({ width: 748, height: 600 });
  await nominal.goto(`chrome-extension://${extensionId}/popup.html`);
  await nominal.locator('[data-testid="readout"]').waitFor();
  const before = await boxes(nominal);
  await nominal.close();

  // 과밀 상태.
  await seed([
    'api.example.com', 'staging.example.com', 'internal.example.com',
    'cdn.example.com', 'auth.example.com', 'metrics.example.com',
    'a.example.com', 'a-very-long-subdomain.staging.example.com',
  ], 10);
  const page = await context.newPage();
  await page.setViewportSize({ width: 748, height: 600 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator('[data-testid="site"]').first().waitFor();

  // 1. 목록 밖 어떤 노드도 자기 박스를 넘지 않는다.
  const clipped = await page.evaluate(() => {
    const scrollers = new Set(
      [...document.querySelectorAll<HTMLElement>('*')].filter(
        (el) => getComputedStyle(el).overflowY === 'auto',
      ),
    );
    return [...document.querySelectorAll<HTMLElement>('[data-testid="popup-root"] *')]
      .filter((el) => !scrollers.has(el))
      .filter((el) => el.scrollHeight > el.clientHeight + 1)
      .map((el) => el.getAttribute('data-testid') ?? el.className);
  });
  expect(clipped).toEqual([]);

  // 2. 목록은 실제로 스크롤 컨테이너다.
  const scrollable = await page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('*')].filter(
        (el) => getComputedStyle(el).overflowY === 'auto' && el.scrollHeight > el.clientHeight,
      ).length,
  );
  expect(scrollable).toBe(2);

  // 3. 목록 위아래는 평상 상태와 같은 좌표에 있다.
  expect(await boxes(page)).toEqual(before);

  await page.close();
});
```

- [ ] **Step 5: 실패를 확인한다 — 결함이 실재함의 증명**

Run: `npm run test:e2e`
Expected: 새 테스트만 FAIL. 현재 UI 는 스크롤 컨테이너가 0개이고 레일이 넘친다. 나머지 5개는 PASS 여야 한다.

**이 실패를 고치지 말고 그대로 커밋한다.** Task 9 가 초록으로 만든다.

- [ ] **Step 6: 커밋**

```bash
git add components/ui tests/e2e/header-modification.spec.ts
git commit -m "$(cat <<'EOF'
test: 목록이 넘칠 때 조용히 잘리는지 보는 가드를 세운다 (현재 빨강)

시안 다섯 개 중 다섯 개가 정확히 이것에 실패했다. 전부 고정 높이 +
overflow: hidden 이라 사이트나 규칙이 하나 늘면 스크롤바도 표시도 없이
사라졌다. 한 시안은 Grant 버튼이 그걸 위해 마련한 바로 그 띠에 7px 잘렸고,
다른 시안은 규칙을 지우면 남은 규칙이 전부 23.5px 커졌다.

현재 UI 도 실패한다 — 그래서 빨간 채로 넣는다. 고쳐야 할 결함이 실재함을
먼저 증명하는 편이, 다 고친 뒤에 통과하는 가드를 붙이는 것보다 낫다.
후자는 가드가 무엇을 잡는지 아무도 모르는 채로 남는다.

좌표를 재는 이유는 "보인다"가 약한 단언이기 때문이다. 8px 밀린 것도
보이기는 한다.

shadcn checkbox/tooltip/badge/separator 도 함께 받는다. 전부 커밋되는
소스이고 radix-ui@1.6.7 에 primitive 가 다 있어 새 의존성은 없다.
EOF
)"
```

---

## Task 4: TypeChecklist

**Files:**
- Modify: `components/TypeChecklist.tsx`
- Modify: `entrypoints/popup/style.css` (`.hl-types` `.hl-ty` `.hl-tybox` 삭제)

**Interfaces:**
- Consumes: `Checkbox` (Task 3), 토큰 (Task 1), `data-testid="type-grid"` (Task 2)
- Produces: 없음. `OFFERED_TYPES` export 는 그대로.

가장 작은 컴포넌트라 먼저 한다. 여기서 정한 컨트롤 언어를 나머지가 따른다.

- [ ] **Step 1: 기존 테스트가 통과하는 상태에서 시작한다**

Run: `npm test -- ScopeRail`
Expected: PASS. `type-check` testid 를 쓰는 단언들의 현재 상태를 확인한다.

- [ ] **Step 2: shadcn Checkbox 로 교체한다**

```tsx
import { Checkbox } from '@/components/ui/checkbox';
import type { ResourceType } from '@/lib/model/types';
```

`TypeChecklist` 의 return 만 바꾼다. `OFFERED` 와 `OFFERED_TYPES` 는 손대지 않는다.

```tsx
export function TypeChecklist({ selected, onToggle }: TypeChecklistProps) {
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5" data-testid="type-grid">
      {OFFERED.map(([type, label]) => (
        <label
          key={type}
          className="flex h-5 cursor-pointer items-center gap-2 text-[12px] leading-4
                     text-foreground-2 select-none has-data-[state=unchecked]:text-muted-foreground"
        >
          <Checkbox
            data-testid="type-check"
            aria-label={type}
            checked={selected.includes(type)}
            onCheckedChange={() => onToggle(type)}
            className="size-4 rounded-[4px] border-boundary"
          />
          {label}
        </label>
      ))}
    </div>
  );
}
```

`aria-pressed` 가 `checked` 로 바뀐다 — Radix Checkbox 는 `role="checkbox"` 이고 `aria-checked` 를 스스로 관리한다. 이것은 접근성 개선이지 회귀가 아니다.

- [ ] **Step 3: 테스트를 새 역할에 맞춘다**

`tests/unit/ScopeRail.test.tsx` 에서 `aria-pressed` 를 읽는 단언을 `toBeChecked` 대신 속성으로 확인한다(`@testing-library/jest-dom` 은 설치돼 있지 않다):

```tsx
expect(screen.getAllByTestId('type-check')[0]!.getAttribute('aria-checked')).toBe('true');
```

- [ ] **Step 4: 옛 CSS 를 지운다**

`entrypoints/popup/style.css` 에서 `.hl-types` `.hl-ty` `.hl-tybox` 및 그 하위 선택자 전부 삭제.

- [ ] **Step 5: 검사**

Run: `npm run check`
Expected: PASS

Run: `npm run test:e2e`
Expected: 5 passed + 과밀 1 FAIL (Task 3 에서 세운 것, 아직 빨강)

- [ ] **Step 6: 스크린샷으로 눈으로 확인한다**

Run: `npm run screenshots`
`docs/screenshots/popup-light.png` 를 열어 체크박스가 참조 시안과 같은 언어인지 본다. 다르면 여기서 맞춘다 — 나머지 컴포넌트가 이것을 따라간다.

- [ ] **Step 7: 커밋**

```bash
git add components/TypeChecklist.tsx tests/unit/ScopeRail.test.tsx entrypoints/popup/style.css docs/screenshots
git commit -m "refactor: 리소스 타입 체크리스트를 shadcn Checkbox 로 옮긴다"
```

---

## Task 5: SiteRow

**Files:**
- Modify: `components/SiteRow.tsx`
- Modify: `entrypoints/popup/style.css` (`.hl-dom*` `.hl-need*` 삭제)

**Interfaces:**
- Consumes: `Button` (기존), 토큰, lucide `CircleCheck` `CircleMinus` `Ban` `Trash2`
- Produces: 사이트 행 높이 **48px 고정**, 두 번째 줄 **20px 고정**. Task 9 의 스크롤 컨테이너가 이 값에 의존한다.

이 컴포넌트가 이 작업 전체에서 가장 중요하다. "컨트롤이 나타나도 레이아웃이 움직이지 않는다"가 여기서 지켜지거나 깨진다.

- [ ] **Step 1: 두 번째 줄이 Grant 버튼 높이로 예약되는지 보는 테스트를 쓴다**

`tests/unit/ScopeRail.test.tsx` 에 추가한다.

```tsx
// @vitest-environment jsdom
it('두 번째 줄은 네 상태 모두에서 같은 높이다', () => {
  // 시안 하나가 Grant 버튼을 그것을 위해 마련한 띠에 7px 잘랐다. 띠는 텍스트가
  // 아니라 버튼에 맞춰 잡혀야 한다.
  const heights = (['granted', 'pending', 'unusable', 'idle'] as const).map((state) => {
    const { container, unmount } = render(
      <SiteRow
        domain="api.example.com"
        usable={state !== 'unusable'}
        inert={state === 'idle'}
        diagnostics={state === 'pending'
          ? [{ kind: 'permission-missing', severity: 'warning', profileId: 'p',
               host: 'api.example.com', message: 'needs permission' }]
          : []}
        onGrant={() => {}}
        onRemove={() => {}}
      />,
    );
    const line = container.querySelector('[data-testid="site-line"]')!;
    const h = getComputedStyle(line).height;
    unmount();
    return h;
  });
  expect(new Set(heights).size).toBe(1);
});
```

jsdom 은 레이아웃을 계산하지 않으므로 이 테스트는 **명시된 클래스**를 본다. `site-line` 이 네 상태 모두에서 같은 높이 클래스를 갖는지 확인하는 것이 목적이고, 실제 픽셀은 Task 3 의 e2e 가 본다.

- [ ] **Step 2: 실패 확인**

Run: `npm test -- ScopeRail`
Expected: FAIL — 현재 마크업은 상태마다 다른 클래스를 준다.

- [ ] **Step 3: SiteRow 를 교체한다**

`state` 계산과 `awaitingGrant` 로직, 그리고 그 위 주석들은 **그대로 둔다** — 그것들이 이 컴포넌트의 값어치다. `return` 만 바꾼다.

```tsx
import { Ban, CircleCheck, CircleMinus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STATE_ICON = {
  granted: CircleCheck,
  pending: CircleMinus,
  unusable: Ban,
  idle: CircleMinus,
} as const;

const STATE_TONE = {
  granted: 'text-live',
  pending: 'text-pending',
  unusable: 'text-destructive',
  idle: 'text-muted-foreground',
} as const;
```

```tsx
  const Icon = STATE_ICON[state];
  return (
    <div
      className="flex h-12 flex-col justify-center gap-0.5 rounded-lg bg-card px-2
                 data-[state=pending]:bg-pending-bg data-[state=unusable]:bg-destructive-bg"
      data-testid="site"
      data-state={state}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={`size-3.5 shrink-0 ${STATE_TONE[state]}`} role="img"
              aria-label={STATE_LABEL[state]} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] leading-4 text-foreground"
              title={domain}>
          {domain}
        </span>
        <Button variant="ghost" size="icon-xs" aria-label={`Remove ${domain}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>

      {/* 높이 20px 은 네 상태 모두에서 같다. 가장 큰 내용물이 Grant 버튼이므로
          텍스트가 아니라 버튼에 맞춰 잡는다. 시안 하나가 여기서 7px 잘렸다. */}
      <span className="flex h-5 items-center pl-5" data-testid="site-line">
        {awaitingGrant !== undefined && state !== 'unusable' && state !== 'idle' ? (
          <Button size="xs" variant="secondary" data-testid="site-pending"
                  className="h-5 bg-pending-bg text-pending ring-1 ring-pending-border"
                  onClick={() => onGrant(awaitingGrant.host!)}>
            Grant
          </Button>
        ) : (
          <span className="text-[11px] leading-[14px] text-muted-foreground" aria-hidden="true">
            {state === 'pending' ? '' : STATE_LINE[state]}
          </span>
        )}
      </span>
    </div>
  );
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- ScopeRail`
Expected: PASS

- [ ] **Step 5: 옛 CSS 삭제 후 전체 검사**

`.hl-dom` `.hl-domhost` `.hl-domstate` `.hl-domx` `.hl-need` `.hl-needsay` `.hl-grant` 및 하위 선택자 삭제.

Run: `npm run check` → PASS
Run: `npm run screenshots` → 참조 시안과 비교

- [ ] **Step 6: 커밋**

```bash
git add components/SiteRow.tsx tests/unit/ScopeRail.test.tsx entrypoints/popup/style.css docs/screenshots
git commit -m "$(cat <<'EOF'
refactor: 사이트 행을 lucide 아이콘과 shadcn Button 으로 옮긴다

상태를 말하던 색 점이 CircleCheck/CircleMinus/Ban 으로, × 문자가 Trash2 로
바뀐다. 문자가 아이콘 일을 하고 있던 자리들이다.

두 번째 줄의 20px 은 텍스트가 아니라 Grant 버튼에 맞춰 잡는다. 시안 하나가
바로 그 띠에 버튼을 7px 잘랐고, 그 띠의 존재 이유가 버튼을 담는 것이다.
네 상태가 같은 높이 클래스를 갖는지 보는 단위 테스트를 붙였다 — 실제 픽셀은
과밀 e2e 가 본다.

state 계산과 awaitingGrant 로직, 그 위 주석은 손대지 않았다. 바뀐 것은
그것들이 무엇으로 그려지는지뿐이다.
EOF
)"
```

---

## Task 6: AddSiteField

**Files:**
- Modify: `components/AddSiteField.tsx`
- Modify: `entrypoints/popup/style.css` (`.hl-addfield` `.hl-add*` 삭제)

**Interfaces:**
- Consumes: `Input` `Button` (기존), lucide `Plus`, `--boundary` (3:1 을 넘는 유일한 이유)
- Produces: `data-testid="add-field"` (Task 2 에서 붙임), `add-site-note` 유지

- [ ] **Step 1: 점선 경계가 토큰을 쓰는지 보는 테스트**

이 컴포넌트의 점선 슬롯은 **경계선이 그것을 컨트롤로 식별시키는 유일한 단서**다. Task 1 의 3:1 검사가 `--boundary` 를 보장하므로, 여기서는 그 토큰을 쓰는지만 확인한다.

`tests/unit/ScopeRail.test.tsx` 에 추가:

```tsx
it('추가 슬롯의 경계는 대비가 보장된 토큰을 쓴다', () => {
  const { container } = render(<AddSiteField onAdd={() => ({ added: true })} />);
  const slot = container.querySelector('[data-testid="add-field"]')!;
  expect(slot.className).toContain('border-boundary');
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- ScopeRail` → FAIL

- [ ] **Step 3: 교체한다**

입력 커밋 로직(`onAdd` 의 반환으로 중복을 알리는 부분)과 그 주석은 그대로 두고 마크업만 바꾼다.

```tsx
import { Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
```

```tsx
    <div
      data-testid="add-field"
      className="flex h-9 items-center gap-1.5 rounded-lg border border-dashed
                 border-boundary px-2"
    >
      <Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <Input
        aria-label="Add a site"
        placeholder="add a site"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        className="h-6 border-0 bg-transparent px-0 font-mono text-[12px] shadow-none
                   focus-visible:ring-0"
      />
    </div>
```

`add-site-note` 를 렌더하는 부분은 **높이를 예약한 채로** 유지한다 — 메모가 나타나며 아래를 밀면 안 된다.

- [ ] **Step 4~6: 통과 확인 · 옛 CSS 삭제 · 검사 · 커밋**

Run: `npm test -- ScopeRail` → PASS
Run: `npm run check` → PASS
Run: `npm run screenshots`

```bash
git add components/AddSiteField.tsx tests/unit/ScopeRail.test.tsx entrypoints/popup/style.css docs/screenshots
git commit -m "refactor: 사이트 추가 필드를 shadcn Input 과 lucide Plus 로 옮긴다"
```

---

## Task 7: RuleCard

**Files:**
- Modify: `components/RuleCard.tsx`
- Modify: `entrypoints/popup/style.css` (`.hl-rule` `.hl-r1` `.hl-r2` `.hl-pill` `.hl-op` `.hl-hname` `.hl-hval` `.hl-tog` `.hl-del` `.hl-rprob*` 삭제)

**Interfaces:**
- Consumes: `Switch` `Badge` `Input` `Button`, lucide `ArrowUp` `ArrowDown` `Trash2`
- Produces: 규칙 행 **52px 고정**. Task 8 의 스크롤 컨테이너가 이 값에 의존한다.

여기가 "한 줄에 버튼 언어가 넷"이었던 자리다. REQ/RES 는 Badge, `set`/`remove` 는 테두리 박스가 아니라 타이포그래피 열, 삭제는 ghost 아이콘 버튼.

- [ ] **Step 1: 규칙 행 높이가 상태와 무관한지 보는 테스트**

```tsx
it('규칙 행은 켜짐/꺼짐/문제 있음에서 같은 높이 클래스를 쓴다', () => {
  const base = { id: 'h', target: 'request', operation: 'set',
                 name: 'X-Test', value: 'v' } as const;
  const heights = [
    { ...base, enabled: true },
    { ...base, enabled: false },
  ].map((rule) => {
    const { container, unmount } = render(
      <RuleCard rule={rule} diagnostics={[]} onPatch={() => {}} onDelete={() => {}} />,
    );
    const h = container.querySelector('[data-testid="rule"]')!.className.match(/h-\[?\d+/)?.[0];
    unmount();
    return h;
  });
  expect(new Set(heights).size).toBe(1);
});
```

- [ ] **Step 2: 실패 확인** → `npm test -- RuleCard`

- [ ] **Step 3: 교체한다**

`useCommittedDraft` 사용, `OP_NEXT`/`TARGET_NEXT` 순환, delete 버튼이 DOM 마지막에 있어야 하는 이유(탭 순서) — **전부 그대로 둔다.** 마크업만 바꾼다.

```tsx
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

const TARGET_ICON = { request: ArrowUp, response: ArrowDown } as const;
const TARGET_TONE = {
  request: 'bg-req-bg text-req',
  response: 'bg-res-bg text-res',
} as const;
```

핵심만:

```tsx
    <div
      className="flex h-13 flex-col justify-center gap-0.5 rounded-lg bg-card px-2
                 data-[off]:opacity-60"
      data-testid="rule"
      data-off={!rule.enabled || undefined}
      data-unfinished={unfinished || undefined}
    >
```

`h-13` 은 52px(13 × 4px)이다. `REQ`/`RES` 는 `Badge` 에 방향 아이콘을 넣고, `set`/`remove` 는 테두리 없는 버튼으로 `text-[11px] font-medium text-muted-foreground` 를 준다. 값은 `font-mono`, 이름은 산세리프 — **이것이 서체가 위계를 만들던 문제의 수정이다.**

`remove` 일 때 값 자리에 들어가는 "remove takes no value" 문구와 `rule-value` testid 는 유지한다.

- [ ] **Step 4~6: 통과 확인 · 옛 CSS 삭제 · 검사 · 커밋**

Run: `npm test -- RuleCard` → PASS
Run: `npm run check` → PASS
Run: `npm run screenshots`

```bash
git add components/RuleCard.tsx tests/unit/RuleCard.test.tsx entrypoints/popup/style.css docs/screenshots
git commit -m "$(cat <<'EOF'
refactor: 규칙 행의 버튼 언어를 하나로 모은다

한 줄에 넷이었다 — REQ/RES 는 알약, set/remove 는 테두리 박스, 삭제는 맨
글자 ×. 이제 방향은 화살표 아이콘이 든 Badge, 연산은 테두리 없는 타이포그래피
열, 삭제는 ghost 아이콘 버튼이다.

헤더 이름이 모노스페이스에서 산세리프로 간다. 위계가 서체가 아니라 크기와
무게에서 나와야 하고, 모노스페이스는 사용자가 실제로 타이핑하는 값에만 남는다.

행 높이 52px 은 켜짐/꺼짐/문제 있음에서 같다. 규칙을 지우면 남은 규칙이 전부
23.5px 커지던 시안이 있었다.
EOF
)"
```

---

## Task 8: RulePanel — 규칙 목록을 진짜 스크롤 컨테이너로

**Files:**
- Modify: `components/RulePanel.tsx`
- Modify: `entrypoints/popup/style.css` (`.hl-panel` `.hl-panelhead` `.hl-newrule` `.hl-ghost` 삭제)

**Interfaces:**
- Consumes: `RuleCard` (52px 고정, Task 7), `Button`, lucide `Plus`
- Produces: 규칙 목록의 `overflow-y: auto` 컨테이너. Task 3 의 e2e 가 이것을 센다(2개 중 1개).

- [ ] **Step 1: 교체한다**

```tsx
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between px-3">
        <h2 className="text-[13px] font-semibold text-foreground">Rules</h2>
        <Button size="sm" onClick={onAddRule}>
          <Plus /> New rule
        </Button>
      </header>

      {/* max-height 가 아니라 flex-1 + min-h-0 인 이유: 패널은 팝업 높이를 다
          쓰고, 넘치는 것은 이 목록뿐이다. min-h-0 이 없으면 flex 자식의 기본
          min-height:auto 가 축소를 막아 목록이 스크롤되는 대신 패널이 넘친다. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-3"
           style={{ scrollbarGutter: 'stable' }}>
        {rules.map((rule) => (
          <RuleCard key={rule.id} rule={rule} diagnostics={byRow.get(rule.id) ?? []}
                    autoFocus={autoFocusFirstRule && rule.id === rules[0]?.id}
                    onPatch={(delta) => onPatchRule(rule.id, delta)}
                    onDelete={() => onDeleteRule(rule.id)} />
        ))}
        <button
          className="flex h-13 shrink-0 items-center justify-center gap-1.5 rounded-lg
                     border border-dashed border-boundary text-[12px] text-muted-foreground"
          onClick={onAddRule}
        >
          <Plus className="size-3.5" /> New rule
        </button>
      </div>
    </section>
```

`shrink-0` 이 각 행에 필요하다 — 없으면 flex 가 행을 눌러 Task 7 의 고정 높이가 무너진다.

- [ ] **Step 2: 스크롤 컨테이너가 실제로 줄어드는지 확인한다**

Run: `npm run test:e2e`
Expected: 과밀 테스트의 `scrollable` 단언이 **1** 을 보고 `toBe(2)` 에서 실패한다 — 레일이 아직 남았다. 이것이 진전의 증거다.

- [ ] **Step 3: 옛 CSS 삭제 · 검사 · 커밋**

Run: `npm run check` → PASS
Run: `npm run screenshots`

```bash
git add components/RulePanel.tsx entrypoints/popup/style.css docs/screenshots
git commit -m "refactor: 규칙 목록을 진짜 스크롤 컨테이너로 만든다"
```

---

## Task 9: ScopeRail — 레일과 사이트 목록, 그리고 HelpTip 제거

**Files:**
- Modify: `components/ScopeRail.tsx`
- Delete: `components/HelpTip.tsx`
- Rename: `tests/unit/HelpTip.test.tsx` → `tests/unit/tooltip.test.tsx`
- Modify: `entrypoints/popup/style.css` (나머지 `.hl-*` 전부 삭제)

**Interfaces:**
- Consumes: `SiteRow` (48px), `AddSiteField`, `TypeChecklist`, `Switch` `Separator` `Tooltip`, lucide `ArrowUpDown` `CircleHelp` `Globe`
- Produces: 사이트 목록의 두 번째 `overflow-y: auto` 컨테이너 → Task 3 의 e2e 가 초록이 된다.

- [ ] **Step 1: HelpTip 테스트를 tooltip 으로 옮긴다**

`tests/unit/HelpTip.test.tsx` 를 `tests/unit/tooltip.test.tsx` 로 옮기고, 검사 대상을 shadcn `Tooltip` 으로 바꾼다. **주제가 사라진 게 아니라 형태가 바뀐 것이므로 테스트는 죽지 않는다.** `help-bubble` testid 는 `TooltipContent` 에 유지한다.

- [ ] **Step 2: 레일을 교체한다**

`blockedBy` / `BLAMED` / `subcount` 계산과 그 위 주석 전부 유지. 마크업만 바꾼다.

레일 골격:

```tsx
    <aside className="flex w-56 shrink-0 flex-col gap-3 border-r border-rail-border bg-rail p-3">
      {/* 위: 고정 */}
      <div className="shrink-0"> …brand, readout, runstate… </div>

      <Separator className="shrink-0 bg-rail-border" />

      {/* 사이트: 내용만큼 자라되 max-height 에서 멈춘다.
          max-height 는 행 높이(48+6 간격=54)의 정수배가 아니게 잡는다 — 넘칠 때
          가장자리 행이 중간에서 잘리고, 그 잘린 행이 "더 있다"는 신호다.
          ::-webkit-scrollbar 는 Chromium 오버레이 스크롤바를 끄지 못한다
          (대조 실험으로 반증됨), 그래서 스크롤바가 보인다고 가정하지 않는다. */}
      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto"
           style={{ maxHeight: '170px', scrollbarGutter: 'stable' }}>
        {domains.map(…<SiteRow …/>)}
      </div>

      <AddSiteField … />          {/* 목록 밖 — 항상 보인다 */}
      <div className="mt-auto shrink-0"> …types… </div>
    </aside>
```

`maxHeight: 170px` 은 3행(54×3=162)보다 크고 4행(216)보다 작다 — 4번째 사이트부터 잘린 행이 보인다.

`AddSiteField` 를 스크롤 목록 **밖**에 두는 것이 중요하다. 안에 있으면 사이트가 많을 때 스크롤해야 도달할 수 있고, 그건 "추가"를 숨기는 일이다.

`mt-auto` 가 남는 공간을 Request types 위로 밀어, 사이트가 2개일 때 생기던 54px 구멍을 레일 아래쪽으로 보낸다 — 참조 시안이 하드 캡으로 실패했던 지점이다.

- [ ] **Step 3: 거터를 형제와 맞춘다**

참조 시안이 여기서 걸렸다. `scrollbar-gutter: stable` 은 스크롤 목록의 콘텐츠 박스만 8px 깎는다. 목록 밖 형제(`AddSiteField`, Separator, types 섹션)에 같은 `pr-2` 를 주어 오른쪽 끝이 한 줄로 서게 한다. 안 그러면 두 상태 모두에서 영구적으로 보이는 어긋남이 남는다.

- [ ] **Step 4: 과밀 e2e 가 초록이 되는지 확인한다**

Run: `npm run test:e2e`
Expected: **6 passed.** Task 3 에서 빨간 채로 세운 가드가 여기서 초록이 된다. `scrollable` 이 2, `clipped` 가 `[]`, 좌표가 평상 상태와 동일.

초록이 안 되면 `min-h-0` 이 flex 체인 전체에 있는지부터 본다 — 이 실패의 가장 흔한 원인이다.

- [ ] **Step 5: 옛 CSS 를 전부 지운다**

`entrypoints/popup/style.css` 에 남은 `.hl-*` 규칙을 전부 삭제한다. 남아야 하는 것은 Tailwind 지시문, 두 팔레트 블록, `@theme inline`, 그리고 `html, body` 의 748×600 크기 지정뿐이다.

Run: `grep -c "hl-" entrypoints/popup/style.css`
Expected: 0

- [ ] **Step 6: 검사**

Run: `npm run check` → PASS
Run: `npm run test:e2e` → 6 passed
Run: `npm run screenshots` → 참조 시안과 나란히 비교

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor: 레일을 옮기고 사이트 목록을 스크롤 컨테이너로 만든다

과밀 가드가 초록이 된다. Task 3 에서 빨간 채로 세운 것이다.

사이트 목록은 내용만큼 자라되 170px 에서 멈춘다. 그 값은 행 높이(54)의
정수배가 아니라, 넘칠 때 가장자리 행이 중간에서 잘린다. 그 잘린 행이
"더 있다"는 신호다 — ::-webkit-scrollbar 로 스타일을 줘도 Chromium 오버레이
스크롤바는 꺼지지 않는다(대조 실험으로 반증). 스크롤바가 보인다고 가정하면
지난 시안 다섯 개와 같은 실패로 돌아간다.

참조 시안이 하드 캡(flex: 0 0 176px)이라 사이트가 2개일 때 레일에 72px 구멍이
났다. mt-auto 로 남는 공간을 아래로 보낸다.

거터를 형제와 맞춘다. scrollbar-gutter 는 스크롤 목록의 콘텐츠 박스만 깎아서,
그 위아래가 8px 더 넓게 끝나는 어긋남이 시안에 영구적으로 남아 있었다.

AddSiteField 는 스크롤 목록 밖에 둔다. 안에 있으면 사이트가 많을 때 스크롤해야
도달하고, 그건 추가를 숨기는 일이다.

HelpTip 은 shadcn Tooltip 으로 대체하고 그 테스트는 옮긴다. 주제가 사라진 게
아니라 형태가 바뀌었다.
EOF
)"
```

---

## Task 10: 정리와 문서

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md` (스크린샷은 이미 갱신됨)

- [ ] **Step 1: CLAUDE.md 의 "Known gaps" 에서 dead code 항목을 지운다**

Tailwind·shadcn·Radix·Lucide 가 이제 실사용이다. 그 문단과 `lib/utils.ts` 언급을 삭제한다.

- [ ] **Step 2: 디자인 시스템 절을 추가한다**

`## Interface` 절 아래에 붙인다. 실제로 값을 치른 것만 적는다:

```markdown
**토큰 어휘는 하나다.** shadcn 표준(`--background` `--foreground` `--primary` …)에
이 제품의 상태색(`--live` `--pending` `--req` `--res`)과 레일 표면(`--rail*`)을 같은
방식으로 확장했다. 레일은 패널과 **다른 재료**이고 다크에서 순서가 뒤집힌다 —
shadcn 기본 어휘에 그 개념이 없어서 따로 둔다. 두 팔레트는 파생 관계가 아니라
각각 손으로 맞춘 값이고, `tests/unit/contrast.test.ts` 가 양쪽을 각각 검사한다.

**목록이 넘칠 때 조용히 잘리지 않는다.** 시안 다섯 개를 그려 검증했더니 다섯 개
전부가 이것에 실패했다 — 고정 높이 + `overflow: hidden` 이라 행이 하나 늘면
스크롤바도 표시도 없이 사라졌다. 규칙: **행 높이는 고정**(사이트 48, 규칙 52),
**목록 높이는 내용만큼 자라되 `max-height` 에서 멈추고**, 그 `max-height` 는 행
높이의 **정수배가 아니게** 잡아 넘칠 때 가장자리 행이 잘리게 한다.

**스크롤바가 보인다고 가정하지 않는다.** `::-webkit-scrollbar` 로 스타일을 주면
Chromium 이 오버레이 스크롤바에서 빠진다는 통념은 **대조 실험으로 반증됐다** —
12px 폭에 빨간 썸을 준 상자가 `offsetWidth − clientWidth === 0` 이고 정지 상태에서
아무것도 그리지 않았다. "더 있다"를 말하는 것은 잘린 행이지 스크롤바가 아니다.

**`scrollbar-gutter: stable` 은 스크롤 컨테이너의 콘텐츠 박스만 깎는다.** 목록 밖
형제에 같은 값을 들여쓰지 않으면 오른쪽 끝이 8px 어긋난 채로 영구히 남는다.

**`text-overflow: ellipsis` 는 flex 컨테이너에서 먹지 않는다.** 긴 호스트명이
`a-very-long-subdomain.` 으로 하드 클립됐다 — 뒤에 점이 붙은 채 잘려 *다른*
호스트명처럼 읽히는 값이라, 미관이 아니라 정확성 문제다. 생략은 flex 자식이 아니라
그 안의 블록 요소에 걸고 `min-width: 0` 을 체인에 넣는다.
```

- [ ] **Step 3: 최종 검사**

```bash
npm run check && npm run test:e2e && npm run screenshots
git status --short   # 스크린샷이 바뀌었으면 커밋에 포함
```

- [ ] **Step 4: 커밋**

```bash
git add CLAUDE.md README.md docs/screenshots
git commit -m "docs: 디자인 시스템 도입에 맞춰 CLAUDE.md 를 고친다"
```

- [ ] **Step 5: PR**

```bash
git push -u origin ui-design-system
```

PR 본문에 **before/after 스크린샷**을 넣는다(`github-image-upload` 스킬의 `gh-image`). before 는 `git show main:docs/screenshots/popup-light.png` 로 꺼낸다. 이 저장소의 규칙이고, 이 PR 은 그 규칙이 존재하는 이유 그 자체다.

---

## Self-Review

**스펙 커버리지**

| 스펙 요구 | 태스크 |
|---|---|
| Tailwind 켜기 + `@custom-variant dark` | 1 |
| shadcn 토큰 어휘 통일, 상태색·레일 확장 | 1 |
| contrast 가드 이관 + 3:1 경계 검사 추가 | 1 |
| e2e 앵커 → testid | 2 |
| checkbox/tooltip/badge/separator 받기 | 3 |
| 과밀 e2e 가드 (빨강 → 초록) | 3 → 9 |
| 6개 컴포넌트 교체 | 4·5·6·7·8·9 |
| HelpTip 제거, 테스트 이동 | 9 |
| 행 높이 고정 / 목록 max-height / 잘린 행 신호 | 5·7·8·9 |
| 거터를 형제와 맞추기 | 9 |
| 평상 상태 레일 구멍 (`mt-auto`) | 9 |
| flex 안 ellipsis | 5 (`min-w-0` + `truncate`) |
| 옛 CSS 삭제 | 4~9, 9에서 grep 0 확인 |
| CLAUDE.md 갱신 | 10 |
| 번들 크기 기록 | 1 Step 6 |

**타입 일관성** — `data-testid` 17개 유지, 신규 5개(`rail-section-types` `type-grid` `add-field` `subcount` `popup-root`) + `all-sites-state`. Task 2 가 만들고 Task 3 의 e2e 와 Task 9 가 쓴다. 행 높이 상수는 Task 5(48) → Task 9, Task 7(52) → Task 8 로 흐른다.

**남은 위험** — 스펙의 "열린 위험" 넷은 그대로다. `radix-nova` 소스가 이 팔레트에 없는 토큰을 쓰는 경우는 Task 3 Step 3 이 잡는다.
