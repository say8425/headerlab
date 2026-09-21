---
paths:
  - "components/**"
  - "entrypoints/popup/**"
  - "lib/view/**"
  - "tests/e2e/header-modification.spec.ts"
  - "tests/unit/contrast.test.ts"
  - "scripts/screenshots.mjs"
  - "scripts/store-assets.mjs"
---

# Popup interface

## Geometry

- **A control appearing must not resize what holds it.** Size the container to its largest
  state and let the element occupy or vacate it. In a 748×600 popup, a few pixels of reflow
  moves most of the screen while the user is reading it.
- Fixes, in the order to reach for them:
  1. **Make the line always say something true**, so its box never changes (the readout's
     `no problems`). Costs nothing.
  2. **Re-home the message on the thing it names** — an unusable site says its remedy on its own
     row, in the slot a pending row gives its Grant button. Works only when such a thing is on
     screen.
  3. **Reserve the space** — paid in every state, including the healthy ones, and in the rail
     that cost comes out of the site list.
  Removing a reservation instead is allowed only by saying in the diff what the movement costs
  and what bounds it, and rewriting the guard that promised otherwise into the sharper claim.
  Recorded carve-outs: `AddSiteField`'s duplicate-site note (created, bounded to one line), and
  the rail's rows since 2026-08-21 (Grant arriving grows its own row).
- **Width is a different rule from height.** The all-sites row still reserves Grant's width
  (its `h-6 w-[52px]` slot), or the switch slides 50px under the pointer that just pressed it.
- **State changes appearance, not geometry.** Colour, weight, opacity and content may follow
  state; box dimensions and positions should not.

## A state-dependent line is ONE line, always (owner's rule, 2026-08-21)

1. `truncate` on the line (`white-space: nowrap` plus ellipsis), so no string can add a line.
   Short copy alone is not the rule — prose grows.
2. **Measure every string against the space the text gets, not against the box.** `site-line`
   is 155px wide and spends 20px on `pl-5`, so the budget is 135px. Keep real headroom: CI's
   Linux fallback fonts differ, and the truncation check has zero tolerance.
3. **Guard both halves** — one line *and* not clipped. `measureLines` in
   `tests/e2e/header-modification.spec.ts` reports `truncated`.

No chips (Badges) inside such a line: a chip is a second box with its own height. Say the
remedy in plain text; colour and glyph carry the complaint, and `title` carries the full
sentence.

## Styling

- `cn` is `twMerge(clsx(…))`, and tailwind-merge groups by variant, not by property:
  `bg-transparent` does not displace a primitive's own `dark:bg-input/30`, and the `dark:` one
  wins where it applies. **To override a `dark:` default, write the `dark:` form too**
  (`AddSiteField` and `RuleCard` carry `dark:bg-transparent` for this).
- A class named in a comment under `components/`, `entrypoints/`, `lib/` or `public/` ships its
  CSS (toolchain rules).
- `components/ui/separator.tsx` is the one primitive nothing imports.

## Colour

- `tests/unit/contrast.test.ts` compares palette tokens, not pixels: a colour produced by alpha
  compositing or by tailwind-merge choosing an unexpected class is outside it by construction.
  `COLOR_TOKENS` catches the two palettes drifting apart, not a token nothing paints — find
  orphans by grepping `components/`, `entrypoints/` and the built CSS for `var(--<token>)`.
- `pnpm screenshots` output is read by a human, and that is how colour defects get found. Look.

## Measuring

- **Headless is not headed.** `::-webkit-scrollbar` alone reserves 0px headless and 8px headed,
  and every e2e test runs headless. When the measured thing is not mode-invariant, a screenshot
  is the instrument, not an assertion. `scroll-list` sets the gutter *and* the scrollbar style
  because that combination is where both modes agree
  (`docs/research/2026-08-09-headless-vs-headed-scrollbar-gutter.md`).
- "Is the rail full" cannot be measured as `clientHeight − scrollHeight` (the site list is
  `flex-shrink: 1` and absorbs any deficit) or by summing computed margins (the request-types
  section's `mt-auto` counts the free space twice). Measure the height the rail was asked for,
  with the list at `min(max-height, scrollHeight)` and auto margins skipped — `measure()` in
  `docs/design/2026-08-12-agent-bridge-rail-budget.html`. Record every figure with the state it
  was measured in (which notes were showing); the leftover is a row of a table, not a property.
- Under browser zoom a shortfall is a scrollbar rather than hidden controls (no `overflow:
  hidden` on `html, body`); the e2e width guard asserts `scrollWidth === clientWidth`.

## Known gaps

- `sync-error` and `icon-error` are notes that appear above the site list and have no row to
  re-home onto; with both up, the list yields most of its height (the sites section clips
  rather than overprinting the request-types heading). Needs its own design pass, not a patch.
- The dropped-types note (`components/TypeChecklist.tsx`, `data-testid="type-note"`) is one line
  but clips in both states in the Firefox popup. Reachable only through a hand-edited store;
  the remedy is the owner's call (a count-style line or a two-line reservation), and there is no
  guard yet because it would be red today.
