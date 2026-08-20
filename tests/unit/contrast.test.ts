import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The popup shipped once with light-grey text the owner could not read — column
 * headers at 2.89:1, switched-off chips at 2.99:1, below even the 3:1 floor for
 * something deliberately de-emphasised. The layout that carried those greys is
 * gone, but the requirement outlived it, so this file follows the palette
 * rather than the markup: it is what fails when the next edit quietly walks a
 * ratio back.
 *
 * It reads the two authored palettes out of the stylesheet. The light values
 * are not derived from the dark ones — they are separate hand-tuned blocks — so
 * every pair below is asserted against BOTH, which is the half that would
 * otherwise rot: fixing one theme's grey says nothing about the other's.
 *
 * ## What this file cannot see
 *
 * It reads TOKENS, never the composited pixel. Every pair below is two hex
 * values out of the stylesheet handed to a luminance formula — so a colour that
 * reaches the screen by any route other than "a token painted straight onto a
 * token" is outside this file's reach *in principle*, not by omission:
 *
 *   - **Alpha.** `bg-input/30` composites `--input` onto whatever is behind it
 *     and produces a value that is in neither palette. This file would assert
 *     the two opaque endpoints and never compute the blend.
 *   - **Which class actually wins.** `cn` is `twMerge(clsx(…))`, and
 *     tailwind-merge groups by variant: a bare `bg-transparent` does not
 *     displace a `dark:bg-input/30`, so a call site can believe it overrode a
 *     fill it did not. Nothing here reads a className.
 *
 * Both were live at once and this file was fully green through it: the header
 * name Input inherited shadcn's `dark:bg-input/30`, `RuleCard`'s
 * `bg-transparent` failed to displace it, and the field wore a grey box at
 * rgb(44,52,62) — exactly `--card` under 30% `--input` — in dark only. Every
 * pair here passed, correctly, because every pair here was about a different
 * question. It was caught by looking at a screenshot.
 *
 * So: green here means the PALETTE is sound. It does not mean the screen is.
 *
 * And nothing else in this repo covers the gap automatically. **The e2e suite is
 * not the backstop it looks like** — measured: it reads geometry and nothing else,
 * `getBoundingClientRect` in eight places and `getComputedStyle(el).overflowY` in
 * two, with no colour read anywhere and no snapshot comparison configured (zero
 * `toHaveScreenshot`/`toMatchSnapshot` calls, no snapshot config in
 * `playwright.config.ts`). The `color: 'green'` strings in that file are profile
 * colours being seeded into a fixture, not a colour being read back.
 *
 * The only output with pixels in it is `pnpm screenshots`, and **a human is what
 * reads it.** That is not a figure of speech: it is how the grey box above was
 * actually found. A colour born of alpha or of merge order is, today, caught by
 * someone looking at the dark screenshot and noticing.
 *
 * If you want a test instead of a person, it does not exist yet and has to be
 * built — a colour read or a snapshot comparison in e2e, where the popup is really
 * rendered. Do not add one here; this file has no browser and never will.
 */

const CSS = readFileSync('entrypoints/popup/style.css', 'utf8');

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return a > b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05);
}

function readPalette(selector: string): Record<string, string> {
  const block = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g');
  const vars: Record<string, string> = {};
  for (const match of CSS.matchAll(block)) {
    for (const [, name, value] of match[1]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      vars[name!] = value!.trim();
    }
  }
  return vars;
}

const PALETTES = {
  light: readPalette(':root'),
  dark: readPalette('.dark'),
};

/** 색이 아닌 토큰. 형태 검사에서 제외된다. */
const NON_COLOR = ['--font-sans', '--font-mono'];

/** 두 팔레트가 모두 정의해야 하는 색 토큰. 이름이 바뀌면 조용히 지나가지 않는다. */
const COLOR_TOKENS = [
  '--background',
  '--foreground',
  '--foreground-2',
  '--muted-foreground',
  '--card',
  '--border',
  '--tray',
  '--rowoff',
  '--rail',
  '--rail-border',
  '--input',
  '--primary',
  '--primary-foreground',
  '--ring',
  '--boundary',
  '--live',
  '--pending',
  '--pending-bg',
  '--destructive',
  '--req',
  '--req-bg',
  '--res',
  '--res-bg',
] as const;

describe('palette parsing', () => {
  // Without this, every ratio assertion below is worthless: a renamed or
  // dropped token makes `vars[name]` undefined, a helper handed undefined
  // yields NaN, and `expect(NaN).toBeGreaterThanOrEqual(4.5)` fails for the
  // wrong reason — identically to a typo'd token name *in this file*. Naming
  // the expected set is what makes the two distinguishable.
  it.each(['light', 'dark'] as const)('%s defines exactly the known colour tokens', (theme) => {
    const found = Object.keys(PALETTES[theme])
      .filter((k) => !NON_COLOR.includes(k))
      .sort();
    expect(found).toEqual([...COLOR_TOKENS].sort());
  });

  // Twice while writing the previous palette a value was committed as
  // `#6b7policy` and `#38milk` — a token whose value is not a colour. CSS drops
  // the declaration silently, the element inherits, and nothing that only reads
  // ratios would notice, because every *other* value still computes fine.
  it.each(['light', 'dark'] as const)('%s gives every colour token a 6-digit hex', (theme) => {
    const malformed = Object.entries(PALETTES[theme])
      .filter(([name]) => !NON_COLOR.includes(name))
      .filter(([, value]) => !/^#[0-9a-f]{6}$/.test(value))
      .map(([name, value]) => `${name}: ${value}`);
    expect(malformed).toEqual([]);
  });
});

/**
 * Foreground / background pairs that actually occur in the rendered popup.
 *
 * Chosen by walking the markup and taking the background each text node is
 * really painted on — not every token crossed with every other, which would
 * assert ratios for combinations no user can see and make the suite fight
 * changes that harm nobody. Each entry names the element that pairs them, so a
 * reader can check the claim rather than trust it.
 *
 * The floor is 4.5:1 for anything a user reads and 3:1 for a shape that carries
 * state without words. **Every piece of text in this design clears 4.5 in both
 * themes**, with real headroom: the lowest text pair asserted here is a
 * switched-off rule's value — `--muted-foreground` on `--tray` — at **5.10**
 * light. Nothing is parked in the 3:1 allowance except the off-switch track,
 * which is the lowest shape pair at **3.13** dark and is a shape rather than a
 * word. That is deliberate and it is the direct answer to the original
 * complaint: the palette this replaces expressed "de-emphasised" by fading
 * text toward the background, and a switched-off rule here keeps
 * full-contrast text and is marked by its switch and a recessed row instead.
 */
/**
 * `fg` painted over `bg` at `alpha`, which is what a `/80` utility produces.
 * Source-over on straight sRGB bytes — the same arithmetic the compositor does
 * before `contrast()` ever sees a pixel.
 */
function composite(fg: string, bg: string, alpha: number): string {
  const bytes = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [fr, fg_, fb] = bytes(fg) as [number, number, number];
  const [br, bg_, bb] = bytes(bg) as [number, number, number];
  const mix = (f: number, b: number) => Math.round(f * alpha + b * (1 - alpha));
  return `#${[mix(fr, br), mix(fg_, bg_), mix(fb, bb)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const READ_TEXT = 4.5;
const SHAPE = 3;

const TEXT_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  // --- the panel: fields, buttons and the surfaces they sit on ---
  // Nothing below names a stylesheet selector any more, because there are none
  // left to name: every element in this popup is composed from Tailwind
  // utilities and shadcn primitives in its own file, and style.css holds the
  // two palettes and little else. Each entry names the element instead, which
  // is what a reader has to find in order to check the claim.
  ['header name text — the name Input, line 1 of a rule row', '--foreground', '--background'],
  ['header value text — the value Input, line 2 of a rule row', '--foreground-2', '--background'],
  // Task 11: the operation control moved off line 2 into the gutter, as a
  // filled chip stacked under the direction Badge rather than borderless
  // typography beside the value. `--tray`, not `--card`/`--background` — the
  // chip's own fill never changes with the row's surface, same as the badge
  // above it never repaints for `data-off`.
  [
    "operation chip — set/append/remove, the direction badge's sibling",
    '--muted-foreground',
    '--tray',
  ],
  [
    'field placeholders — the name and value Inputs, on the row they sit in',
    '--muted-foreground',
    '--card',
  ],
  ['header name over the card behind it — the name Input on the row', '--foreground', '--card'],
  ['header value over the card behind it — the value Input on the row', '--foreground-2', '--card'],
  // Task 12 item 6: a `remove` rule's value column is a sentence, not the
  // value textarea — "X-Trace" will be removed — and it doubles as the
  // "this row's input is disabled" signal (`cursor-not-allowed`, no
  // `disabled:opacity-50`, which measured 2.1–2.5:1 in this palette and
  // would have failed the floor below). Unconditionally `--muted-foreground`,
  // not repainted by `data-off` the way the value textarea is, so this one
  // pair covers both the finished and unfinished ("This header will be
  // removed once it's named.") wording.
  [
    'remove-rule sentence — the value column of a remove rule, on a live row',
    '--muted-foreground',
    '--card',
  ],
  // Task 13: an `error`-severity diagnostic takes the same value-column slot
  // outright, ahead of even a `remove` sentence — see RuleCard.tsx's own
  // comment on `errorDiag`. No `--rowoff` counterpart, deliberately, unlike
  // the pair above: every source of a row diagnostic in this codebase
  // (`validateHeaders`, `detectConflicts`) skips a disabled rule before
  // computing one, so an error message painted on a switched-off row is not
  // a state this popup can reach — asserting that pair would guard a
  // combination that cannot render, same failure this file's docblock names.
  [
    'error message — the value column of a rule the compiler excluded, on a live row',
    '--destructive',
    '--card',
  ],
  // The ghost row that ends the rule list is toned as what it is — the first
  // empty slot in the well — so its label and its dashed plus are read against
  // `--tray`, not against the panel. The outline is load-bearing (it is the
  // only thing saying "control" about a row with no fill of its own), so it is
  // also in the boundary block at the bottom of this file.
  ['"New rule" ghost row label — the last row in the well', '--foreground-2', '--tray'],
  ["the ghost row's plus glyph — inside its dashed chip", '--muted-foreground', '--tray'],
  ['REQ direction badge — the Badge wearing an ArrowUp, data-dir=request', '--req', '--req-bg'],
  ['RES direction badge — the Badge wearing an ArrowDown, data-dir=response', '--res', '--res-bg'],
  // Task 13 moved a rule's diagnostic off a sibling block below the row
  // (CLAUDE.md: a control appearing must not resize what holds it, and a
  // block gaining height still pushed every following row down by that
  // much) into two slots that already have a size. Both pairs that named
  // "the diagnostic line below the row" — text on `--pending-bg` for a
  // warning, text on `--destructive-bg` for an error — went with the block:
  // there is no coloured fill left anywhere in a rule row for either
  // severity, so a foreground-on-that-fill pair would guard a combination
  // that renders nowhere, the exact failure this file's own docblock names.
  // `--destructive-bg` itself is gone from the palette (`style.css`, both
  // themes) and the `@theme inline` bridge that exposed it as
  // `bg-destructive-bg`/`text-destructive-bg` — zero consumers left in
  // `components/`/`entrypoints/` once the block did, checked before
  // deleting (R2). `--pending-bg` stays: `SiteRow`'s Grant button still
  // paints with it, and so does the marker two lines down.
  //
  // An error's message is now plain text on the row's own fill — see the
  // new `--destructive` pair among the rule-row text pairs above.
  //
  // A warning's marker keeps the exact circle-and-glyph pair the old badge
  // wore (`--pending-bg` glyph on `--pending` fill) — Task 13 relocated it
  // rather than inventing a new one, so only its description changes here;
  // the tokens are identical to what this entry always asserted.
  ['the "!" in the warning marker beside a header name', '--pending-bg', '--pending'],

  // --- the tray: the well the rule rows sit in (`rule-list` in RulePanel.tsx)
  //     and, at the same tone, the ghost row at the end of the list. ---
  ['text on the well itself — the tray behind the rule rows', '--foreground', '--tray'],

  // --- the switched-off rule row, which has its own tone (`--rowoff`) rather
  //     than sharing the well's. These two pairs read `--tray` until the token
  //     arrived; leaving them there would have kept checking a combination no
  //     longer on screen, which is the way this file rots. ---
  [
    'header name text on a switched-off row — .te-name/[data-on=false] in the mockup',
    '--foreground-2',
    '--rowoff',
  ],
  [
    'header value text on a switched-off row — .te-val/[data-on=false] in the mockup',
    '--muted-foreground',
    '--rowoff',
  ],
  // The remove-rule sentence's own state does not move when the row does —
  // see the on-row entry above for why — so it lands on `--rowoff` too once
  // the row is switched off, same token pair as the value textarea directly
  // above but a different element, same as that pair's own reasoning.
  [
    'remove-rule sentence — the value column of a remove rule, on a switched-off row',
    '--muted-foreground',
    '--rowoff',
  ],

  // --- the rail, whose surface is the darker material in light and the
  //     lighter one in dark; both directions are asserted by running every
  //     pair against both palettes ---
  // The site row (SiteRow.tsx) keeps one fill — `--card` — in all four
  // states, matching the reference mockup: no `[data-state=…]` selector in it
  // ever repaints `.te-row`. State is said by the icon and the second line,
  // not by the row's own surface, so one pairing now covers every state
  // rather than one per state.
  ['site host — the hostname on its row', '--foreground', '--card'],
  // `Button variant="ghost"` sets no text colour of its own, so an unstyled
  // ghost icon button inherits the row's ink (`--foreground`). Both delete
  // buttons — this one and RuleCard's below — now override that with an
  // explicit `text-muted-foreground`, which is what the mockup's `.te-icb`
  // wears and what keeps a destructive control from being the loudest thing
  // on its row. This pair spent one task naming `--foreground` instead,
  // because that was the colour that actually painted while the site row was
  // out of the fixing task's file list; the defect is fixed now and the guard
  // moves with it.
  ['site remove control — the ghost icon button on its row', '--muted-foreground', '--card'],
  // RuleCard's delete button overrides the same shadcn ghost default with an
  // explicit `text-muted-foreground` (this task, in response to review) so it
  // does not out-shout the header name it sits beside — the one-button-
  // language fix landing on its last element too.
  ['rule delete control — the ghost icon button on its row', '--muted-foreground', '--card'],
  // The rail's own chrome. The section headings sit directly on the rail;
  // everything in the readout sits on the raised card inside it, which is a
  // different surface and so a different pair — the two used to be one entry
  // naming `--rail` for both, which stopped being true when the readout moved
  // onto a card of its own.
  ['section headings — "Sites" / "Request types" on the rail', '--foreground-2', '--rail'],
  [
    'section counts and unchecked type labels — the count beside a heading, TypeChecklist label',
    '--muted-foreground',
    '--rail',
  ],
  ['the live count — the big number on the readout card', '--foreground', '--card'],
  ['"of N rules live" — beside the big number', '--foreground-2', '--card'],
  ['the readout subcount — "1 off · 2 blocked", under the big number', '--foreground-2', '--card'],
  // The run state is a word and a dot on the same card, in both directions —
  // it no longer repaints a bar around itself, so neither state pairs against
  // a tinted fill. The dot carries the colour (see SHAPE_PAIRS).
  ['"Active" / "Paused" — the run state on the readout card', '--foreground', '--card'],
  // The all-sites row is a site row in every respect but its glyph: one
  // `--card` fill in all four states, with the state said by the globe, the
  // second line and the Grant button rather than by repainting the row. It
  // used to wear three tinted surfaces, one per state, each painting its own
  // label — those three pairs are these three, moved onto the surface that
  // actually paints them now.
  ['"All sites" — the label on its row, any state', '--foreground', '--card'],
  ['all-sites state line, granted — "Access granted"', '--live', '--card'],
  ['all-sites state line, off — "The list below applies"', '--muted-foreground', '--card'],
  // Every site row now carries a second line naming its state, coloured to
  // match — mirroring the mockup's `.te-l2--live` / `.te-l2--err`, which
  // colours the line itself rather than leaving severity to the icon alone.
  // All three pair against `--card`, since the row no longer changes fill by
  // state (see above). The idle one replaces the pair that was written for the
  // "not in use while All sites is on" paragraph: those exact words moved from
  // above the list onto the row itself, so the guard moved with them rather
  // than being deleted.
  ['row state line, granted', '--live', '--card'],
  // Was 'row state line, unusable'. That span stopped rendering when the
  // unusable row's line became the invalid Badge (2026-08-19), so the guard
  // moved onto the Badge rather than being deleted — the same ink on the same
  // row. The Badge's own fill is `bg-destructive/10`, an alpha tint this file
  // cannot see (see the docblock at the top), so `--card` remains the honest
  // background to hold the ink against: a 10% wash is the nearest thing to
  // the pair a reader actually gets, and pinning it here is what keeps the
  // ink from being toned down until the word stops reading.
  ['invalid Badge — the word on an unusable site row', '--destructive', '--card'],
  ['row state line, not in use — All sites is on', '--muted-foreground', '--card'],
  // The Grant button is the shadcn Button in its `pending` variant, size
  // `xs`, shared by the site row and the all-sites bar — the palette's amber
  // fill/ink pair, the same "something needs you" the row's glyph and the
  // readout's clause wear. The remedy carries the state it answers.
  [
    'Grant button label — Button pending, shared by the site row and the all-sites bar (GRANT_BUTTON_PROPS)',
    '--pending',
    '--pending-bg',
  ],
  ['the ? mark — the CircleHelp beside the SITES heading', '--muted-foreground', '--rail'],
  // Two elements, one pairing: the tooltip's own surface (shadcn's
  // TooltipContent is `bg-foreground text-background`) and the brand mark,
  // which is the same inversion at 24px.
  [
    'help bubble and brand mark — an inverted surface in both themes',
    '--background',
    '--foreground',
  ],
  [
    '"already in the list" note — AddSiteField.tsx\'s [data-testid=add-site-note]',
    '--pending',
    '--rail',
  ],
  // Was 'scope note body'. The scope notes are gone (2026-08-19) but
  // `NOTE_CLASS` is not: the sync-error and icon-error notes still wear it,
  // still `text-foreground` on `bg-background`. Same pair, named for what
  // paints it now.
  ['note body — the sync-error / icon-error card in the rail', '--foreground', '--background'],
  [
    'reconcile failure heading — the bold line of the sync-error note',
    '--destructive',
    '--background',
  ],
  // The `--primary` pair is **gone, subject and all**. shadcn's Button in its
  // `default` variant was the only thing painting it, and the panel head's
  // "New rule" was that variant's only call site in the popup — both removed
  // (owner's call). Every surviving Button names a variant: `pending` for the
  // two Grants, `ghost` for the two deletes. Deleted rather than kept, because
  // a pair pinned to nothing passes while describing nothing, which this file
  // has been caught doing twice. The tokens stay declared in both palettes and
  // `COLOR_TOKENS` still pins that, so re-adding a primary control re-adds a
  // guard rather than discovering one is missing.
];

const SHAPE_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  // The third pair the `--rowoff` change moves, and the one easiest to miss:
  // this switch is *on* the switched-off row, so its background is that row's
  // fill, not the well's. Measured across the move — light 3.164 → 3.373, dark
  // 3.434 → 3.281 — so it clears the shape floor on both sides of the change.
  [
    'switched-off rule track — the Switch unchecked, on the row it turns off',
    '--input',
    '--rowoff',
  ],
  // Both rail switches live on the readout card and the all-sites row now, not
  // on the rail itself — the surface under an OFF track changed with them.
  ['paused master switch track — the Switch unchecked, on the readout card', '--input', '--card'],
  // The readout's own dot: green while running, neutral while paused. It is
  // the colour half of a claim whose word ("Active"/"Paused") is asserted
  // above, so both states are pinned rather than only the live one.
  ['run state dot, active', '--live', '--card'],
  ['run state dot, paused', '--muted-foreground', '--card'],
  // The all-sites globe, which is that row's one unconditional state carrier
  // in the two states where the answer is known. Same floor and same reasoning
  // as the site rows' icons directly below.
  ['all-sites globe, granted', '--live', '--card'],
  ['all-sites globe, awaiting permission', '--pending', '--card'],
  // The site row's lucide icon (CircleCheck/CircleMinus/Ban) is the state's one
  // unconditional carrier now — every state renders it, on line 1, on the
  // row's one fill (`--card`). A graphical indicator rather than a paragraph,
  // so it is held to the 3:1 shape floor rather than the 4.5:1 text one.
  ['state icon, granted — CircleCheck on the site row', '--live', '--card'],
  ['state icon, pending — CircleMinus on the site row', '--pending', '--card'],
  ['state icon, unusable — Ban on the site row', '--destructive', '--card'],
  ['state icon, not in use — CircleMinus on the site row', '--muted-foreground', '--card'],
  // The `incomplete` note edge is **gone, subject and all** (2026-08-19).
  // It guarded the neutral left border a scope note of severity `incomplete`
  // wore, and that border was painted by exactly one branch of exactly one
  // element — the severity ternary in the scope-note block, deleted with the
  // block. No note wears a neutral edge now: the two that remain
  // (sync-error, icon-error) are both `border-l-destructive`. `incomplete`
  // itself still exists as a severity — `validate.ts` gives it to
  // `incomplete-header` — but that one is routed `byRow` and rendered inside
  // a rule row, which wears no note edge at all. Deleted rather than moved,
  // because this is the case CLAUDE.md's Testing section warns about twice:
  // a contrast pair pinned to an element that no longer renders passes while
  // describing nothing.
];

describe.each(['light', 'dark'] as const)('%s palette contrast', (theme) => {
  const palette = PALETTES[theme];

  it.each(TEXT_PAIRS)('%s is readable', (_label, fg, bg) => {
    expect(contrast(palette[fg]!, palette[bg]!)).toBeGreaterThanOrEqual(READ_TEXT);
  });

  it.each(SHAPE_PAIRS)('%s stays visible as a shape', (_label, fg, bg) => {
    expect(contrast(palette[fg]!, palette[bg]!)).toBeGreaterThanOrEqual(SHAPE);
  });

  /**
   * The one pair above whose token is not the colour that paints.
   *
   * `components/ui/switch.tsx` fills an unchecked track with `bg-input` in
   * light and `dark:data-unchecked:bg-input/80` in dark, so in dark the table
   * above measures a colour the screen never shows. That gap is not academic:
   * it hid a real regression once. `--card` was lightened, the pair above went
   * red, `--input` was raised until the pair passed at full opacity — and the
   * composited track was still 2.5330, under this same floor, while every
   * check in this file was green.
   *
   * Composited here rather than fixed in `SHAPE_PAIRS` because the alpha
   * belongs to one component, not to the token: light paints the token whole,
   * and folding 80% into the table would make the light assertion wrong to fix
   * the dark one. This is the alpha trap CLAUDE.md documents, asserted rather
   * than described.
   */
  it('keeps the unchecked switch track visible at the opacity it is painted with', () => {
    const track =
      theme === 'dark'
        ? composite(palette['--input']!, palette['--card']!, 0.8)
        : palette['--input']!;
    expect(contrast(track, palette['--card']!)).toBeGreaterThanOrEqual(SHAPE);
  });

  /**
   * The hierarchy half of the requirement. Raising every grey until it is black
   * would satisfy every ratio above and destroy the ramp, so the ramp itself is
   * asserted: each step must be strictly lighter than the one before against
   * the surface it is used on. Without this, a palette of three identical
   * near-blacks passes the whole file.
   *
   * Both surfaces, because the rail and the panel are different materials and
   * the three inks are used on both.
   */
  it.each(['--background', '--rail'] as const)('keeps the ink ramp stepped on %s', (surface) => {
    const against = palette[surface]!;
    const ramp = ['--foreground', '--foreground-2', '--muted-foreground'].map((t) =>
      contrast(palette[t]!, against),
    );
    // Every consecutive step, not just the ends. Comparing only the ends lets
    // the middle tone collapse onto either neighbour while the assertion still
    // passes — mutation-checked: setting `--foreground-2` to `--foreground` left
    // an ends-only check green, and a three-tone hierarchy with two identical
    // tones is a two-tone hierarchy.
    //
    // A ratio rather than a difference, because these are ratios: the gap
    // between 18.02 and 7.54 is not comparable to the one between 7.54 and
    // 5.40 in absolute terms, but as multiples they are 2.39 and 1.40. The
    // narrowest step this palette actually uses is 1.38.
    const steps = ramp.slice(0, -1).map((value, i) => value / ramp[i + 1]!);
    for (const step of steps) {
      expect(step).toBeGreaterThanOrEqual(1.2);
    }
  });
});

/**
 * Region separation, which was the second complaint about the build this
 * replaces: five stacked regions divided by 1px hairlines and nothing else, so
 * the popup read as one sheet — in dark the two surfaces were 0.41% of
 * luminance apart and the hairline carried the whole distinction.
 *
 * This design answers it structurally rather than by darkening the line. There
 * are two regions, not five, and the boundary between them carries **two**
 * independent signals: the rail is a different material from the panel, and it
 * also has an edge. Both are asserted, because either one alone is the failure
 * mode — a hairline doing the whole job is what broke before, and two surfaces
 * meeting with no edge at all is the same problem wearing the other hat.
 *
 * Asserted as contrast RATIOS rather than luminance deltas: in a dark theme
 * every surface sits near L=0, so deltas there are tiny by construction and
 * would make a dark palette look broken while a light one sailed through. The
 * ratio is scale-relative and means the same thing in both.
 *
 * The floors are set just under what this design measures, so a regression
 * fails while the authored palette passes: rail against panel is 1.129 light /
 * 1.098 dark, and every edge against the surfaces it divides is at least 1.219.
 * (The light figure read 1.184 until Task 10 re-measured it: that was `--card`
 * against `--tray`, one assertion down, and it stopped describing the rail when
 * Task 1 moved `--rail`. Two adjacent pairs sharing one number is how this file
 * rots — the ratio here is `--rail` against `--background`, nothing else.)
 */
describe.each(['light', 'dark'] as const)('%s region separation', (theme) => {
  const palette = PALETTES[theme];
  const distinct = (a: string, b: string) => contrast(palette[a]!, palette[b]!);

  it('makes the rail a different material from the panel, not the same one with a line on it', () => {
    expect(distinct('--rail', '--background')).toBeGreaterThanOrEqual(1.09);
  });

  /**
   * `--card` and `--background` are the identical `#ffffff` in light (and
   * merely close in dark) — a rule card's fill alone no longer separates it
   * from the panel at all (1.000 in light, not merely weak). `--tray` is the
   * third surface between them: the recessed well the rows sit in, per the
   * reference mockup, and painted by `rule-list` itself. The floor reuses the rail
   * check's own 1.09 above rather than the edge checks' 1.2 below: this is the
   * same category of pair (fill vs fill, not a line), and 1.2 is not reachable
   * here in either theme — light measures 1.184 with the mockup's own value,
   * dark 1.098, so 1.2 would fail on the authored palette itself.
   */
  it('gives the panel a third surface — the tray — distinguishable from the card', () => {
    expect(distinct('--card', '--tray')).toBeGreaterThanOrEqual(1.09);
  });

  /**
   * The pair this file was missing, and the omission was not harmless.
   *
   * Every card in the rail — the readout, the all-sites row, each site row —
   * is `--card` painted on `--rail`, so this is the most-repeated surface pair
   * on the screen. It was the one adjacency with no assertion: `--rail` was
   * checked against `--background` and `--card` against `--tray` and
   * `--rowoff`, and the two tokens that actually touch here were never
   * compared. Dark drifted to 1.0309 — under a third of light's 1.1294 — and
   * every check in this file stayed green while the rail's cards were, on
   * report, not distinguishable from the rail.
   *
   * Same 1.09 floor as the two pairs above, for the same reason: fill against
   * fill, not a line.
   */
  it('separates a card from the rail it sits on', () => {
    expect(distinct('--card', '--rail')).toBeGreaterThanOrEqual(1.09);
  });

  /**
   * The fourth surface, and the only one whose whole job is to be a *step*: a
   * switched-off rule row recedes toward the well without becoming it. Before
   * `--rowoff` existed the off row was painted `--tray`, so it, the empty slot
   * at the end of the list and the empty well below were one value — a last
   * row that happened to be off dissolved into the space under it.
   *
   * **This is the assertion that guards that token, and no ratio pair can.**
   * The dispatch expected the two moved text pairs to catch a collapse back to
   * `--tray`; measured, they do not and cannot. A pair asserts a foreground
   * against a background, and `--foreground-2` on `#e9ecf1` reads the same
   * whether that value is called `--rowoff` or `--tray` — set the two tokens
   * equal and the whole file stays green (verified: 126 passed). What is
   * being claimed here is not legibility but *separation*, so it is separation
   * that has to be measured.
   *
   * Both neighbours, because a step that merges upward is as gone as one that
   * merges downward, and the dark ladder is inverted (`--card` is the lighter
   * end there) so neither direction can be assumed.
   *
   * The floor is 1.04, and where it sits is the whole question. Measured:
   * light 1.1109 / 1.0660, dark 1.0494 / 1.0466.
   *
   * It cannot be the 1.09 the checks above use. Dark sets the ceiling here:
   * `--card`→`--tray` spans only 1.0983 in total there (1.184 in light), so a
   * step placed midway is at best √1.0983 ≈ 1.048 on each side — 1.09 would
   * fail the authored palette itself, by construction rather than by regression.
   *
   * But "not 1.09" does not imply "as low as you like", which is the step this
   * file's convention exists to stop. A floor's job is to bound how much of a
   * measured separation a future edit may give away before something says so,
   * and the sibling `--card`↔`--tray` check four lines up sits ~8.5% under what
   * it measures. At 1.03 this one sat ~36% under the binding pair — four times
   * looser than its own neighbour, so a third of the step could go quietly.
   * 1.04 brings that to ~14% while keeping 0.0066 of margin on dark
   * `--rowoff`↔`--tray`, the tightest of the four and therefore the one the
   * floor actually tracks. (The light pairs are wider and so are guarded more
   * loosely by the same number; one floor per assertion is this file's shape,
   * and it follows the pair with the least room.)
   *
   * A collapse to either neighbour is exactly 1.000 and fails loudly.
   */
  it('gives a switched-off row its own tone, stepped from both the card and the well', () => {
    expect(distinct('--card', '--rowoff')).toBeGreaterThanOrEqual(1.04);
    expect(distinct('--rowoff', '--tray')).toBeGreaterThanOrEqual(1.04);
  });

  it('gives the rail an edge that is visible against both surfaces it divides', () => {
    expect(distinct('--rail-border', '--rail')).toBeGreaterThanOrEqual(1.2);
    expect(distinct('--rail-border', '--background')).toBeGreaterThanOrEqual(1.2);
  });

  /**
   * A rule card is an object on the panel, not a region — it is small, it
   * repeats, and it is allowed to sit close to its background. What it may not
   * do is have no boundary at all, and its boundary is the border: the fill
   * alone is 1.000 in light — `--card` and `--background` are the same
   * `#ffffff` — which would not carry it at all.
   */
  it('gives a rule card a border visible against both the card and the panel', () => {
    expect(distinct('--border', '--card')).toBeGreaterThanOrEqual(1.2);
    expect(distinct('--border', '--background')).toBeGreaterThanOrEqual(1.2);
  });

  // A "pending site edge" check used to sit here, pairing `--pending-border`
  // against `--pending-bg`. Its subject is gone: the site row keeps one fill —
  // `--card` — in all four states (see the pairs above, which say so), and the
  // two elements that do wear `--pending-bg`, the Grant button and the rule
  // problem block, are borderless. Measured before deleting: zero consumers in
  // `components/` and `entrypoints/`, and zero `var(--pending-border)` in the
  // built CSS, against one each for `--rowoff` and `--boundary`, which paint.
  //
  // Both tokens went with it — `--live-bg` was the same shape one step worse,
  // orphaned with no guard at all while both palettes still declared it. A
  // guard whose subject no longer renders passes while describing nothing,
  // which is the failure CLAUDE.md names and the fourth time this file has
  // done it. If an amber-edged or green-filled surface is wanted later, the
  // token comes back with the element that needs it.
});

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
    // 규칙 목록 끝의 ghost 행 — 점선 플러스 칩이 well(--tray) 위에 놓인다.
    ['--boundary', '--tray'],
  ] as const)('%s on %s reaches 3:1', (fg, bg) => {
    expect(contrast(palette[fg]!, palette[bg]!)).toBeGreaterThanOrEqual(SHAPE);
  });
});
