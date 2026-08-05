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
    for (const [, name, value] of match[1]!.matchAll(/(--hl-[\w-]+)\s*:\s*([^;]+);/g)) {
      vars[name!] = value!.trim();
    }
  }
  return vars;
}

const PALETTES = {
  light: readPalette(':root'),
  dark: readPalette('.dark'),
};

/** Tokens that are not colours, and so are excluded from the shape checks. */
const NON_COLOR = ['--hl-sans', '--hl-mono', '--hl-card-sh'];

/** Every colour token both palettes must define, so a rename cannot go unnoticed. */
const COLOR_TOKENS = [
  '--hl-panel', '--hl-rail', '--hl-rail-edge', '--hl-card', '--hl-card-edge',
  '--hl-ink', '--hl-ink-2', '--hl-ink-3',
  '--hl-req-bg', '--hl-req-fg', '--hl-res-bg', '--hl-res-fg',
  '--hl-live', '--hl-live-bg', '--hl-pend', '--hl-pend-bg', '--hl-pend-edge',
  '--hl-err', '--hl-err-bg', '--hl-act', '--hl-off-track',
] as const;

describe('palette parsing', () => {
  // Without this, every ratio assertion below is worthless: a renamed or
  // dropped token makes `vars[name]` undefined, a helper handed undefined
  // yields NaN, and `expect(NaN).toBeGreaterThanOrEqual(4.5)` fails for the
  // wrong reason — identically to a typo'd token name *in this file*. Naming
  // the expected set is what makes the two distinguishable.
  it.each(['light', 'dark'] as const)('%s defines exactly the known colour tokens', (theme) => {
    const found = Object.keys(PALETTES[theme]).filter((k) => !NON_COLOR.includes(k)).sort();
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
 * themes**; the lowest is `--hl-ink-3` on the rail at 4.56 / 5.95. Nothing is
 * parked in the 3:1 allowance except the off-switch track, which is a shape.
 * That is deliberate and it is the direct answer to the original complaint: the
 * palette this replaces expressed "de-emphasised" by fading text toward the
 * background, and a switched-off rule here keeps full-contrast text and is
 * marked by its switch and a dashed card instead.
 */
const READ_TEXT = 4.5;
const SHAPE = 3;

const TEXT_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  // --- the panel: fields, buttons and the surfaces they sit on ---
  ['header name and value text — .hl-hname / .hl-hval', '--hl-ink', '--hl-panel'],
  ['operation button label — .hl-op', '--hl-ink-2', '--hl-panel'],
  ['first-run hint — .hl-frhint', '--hl-ink-2', '--hl-panel'],
  ['field placeholders and the ghost row — .hl-hval::placeholder / .hl-ghostrule', '--hl-ink-3', '--hl-panel'],
  ['header name over the card behind it — .hl-hname on .hl-rule', '--hl-ink', '--hl-card'],
  ['New rule button — .hl-newbtn', '--hl-panel', '--hl-ink'],
  ['remove operation marker — .hl-op[data-op=remove]', '--hl-err', '--hl-panel'],
  ['REQ direction pill — .hl-pill[data-target=request]', '--hl-req-fg', '--hl-req-bg'],
  ['RES direction pill — .hl-pill[data-target=response]', '--hl-res-fg', '--hl-res-bg'],
  ['warning inside a rule card — .hl-rprob', '--hl-ink', '--hl-pend-bg'],
  ['error inside a rule card — .hl-rprob[data-severity=error]', '--hl-ink', '--hl-err-bg'],
  ['the "!" in a warning badge — .hl-rprob-ic', '--hl-pend-bg', '--hl-pend'],
  ['the "!" in an error badge — .hl-rprob[data-severity=error] .hl-rprob-ic', '--hl-err-bg', '--hl-err'],

  // --- the rail, whose surface is the darker material in light and the
  //     lighter one in dark; both directions are asserted by running every
  //     pair against both palettes ---
  ['site host — .hl-domhost', '--hl-ink', '--hl-rail'],
  ['readout subcount and section headings — .hl-subcount / .hl-railhead', '--hl-ink-2', '--hl-rail'],
  ['section counts and unchecked type labels — .hl-n / .hl-ty', '--hl-ink-3', '--hl-rail'],
  ['"Active" — .hl-pauselab', '--hl-live', '--hl-live-bg'],
  ['"Paused" — .hl-pausebar[data-paused] .hl-pauselab', '--hl-ink-2', '--hl-panel'],
  ['pending-permission message — .hl-needtext', '--hl-pend', '--hl-pend-bg'],
  ['Grant button — .hl-grant', '--hl-panel', '--hl-act'],
  ['site remove × — .hl-domx', '--hl-ink-3', '--hl-panel'],
  ['scope note body — .hl-note', '--hl-ink', '--hl-panel'],
  ['reconcile failure heading — .hl-note-err b', '--hl-err', '--hl-panel'],
];

const SHAPE_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ['switched-off rule track — .hl-tog[aria-checked=false] on .hl-rule', '--hl-off-track', '--hl-card'],
  ['paused master switch track — .hl-sw[aria-checked=false] on the rail', '--hl-off-track', '--hl-rail'],
  ['unchecked type box — .hl-tybox on the rail', '--hl-off-track', '--hl-rail'],
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
   * The hierarchy half of the requirement. Raising every grey until it is black
   * would satisfy every ratio above and destroy the ramp, so the ramp itself is
   * asserted: each step must be strictly lighter than the one before against
   * the surface it is used on. Without this, a palette of three identical
   * near-blacks passes the whole file.
   *
   * Both surfaces, because the rail and the panel are different materials and
   * the three inks are used on both.
   */
  it.each(['--hl-panel', '--hl-rail'] as const)('keeps the ink ramp stepped on %s', (surface) => {
    const against = palette[surface]!;
    const ramp = ['--hl-ink', '--hl-ink-2', '--hl-ink-3'].map((t) =>
      contrast(palette[t]!, against),
    );
    // Every consecutive step, not just the ends. Comparing only the ends lets
    // the middle tone collapse onto either neighbour while the assertion still
    // passes — mutation-checked: setting `--hl-ink-2` to `--hl-ink` left an
    // ends-only check green, and a three-tone hierarchy with two identical
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
 * fails while the authored palette passes: rail against panel is 1.184 light /
 * 1.098 dark, and every edge against the surfaces it divides is at least 1.219.
 */
describe.each(['light', 'dark'] as const)('%s region separation', (theme) => {
  const palette = PALETTES[theme];
  const distinct = (a: string, b: string) => contrast(palette[a]!, palette[b]!);

  it('makes the rail a different material from the panel, not the same one with a line on it', () => {
    expect(distinct('--hl-rail', '--hl-panel')).toBeGreaterThanOrEqual(1.09);
  });

  it('gives the rail an edge that is visible against both surfaces it divides', () => {
    expect(distinct('--hl-rail-edge', '--hl-rail')).toBeGreaterThanOrEqual(1.2);
    expect(distinct('--hl-rail-edge', '--hl-panel')).toBeGreaterThanOrEqual(1.2);
  });

  /**
   * A rule card is an object on the panel, not a region — it is small, it
   * repeats, and it is allowed to sit close to its background. What it may not
   * do is have no boundary at all, and its boundary is the border: the fill
   * alone is 1.065 in light, which would not carry it.
   */
  it('gives a rule card a border visible against both the card and the panel', () => {
    expect(distinct('--hl-card-edge', '--hl-card')).toBeGreaterThanOrEqual(1.2);
    expect(distinct('--hl-card-edge', '--hl-panel')).toBeGreaterThanOrEqual(1.2);
  });

  it('gives a pending site an edge visible against its own amber fill', () => {
    // The one row on screen that changes surface to signal state. If the edge
    // vanished into the fill the row would read as a coloured block, which is
    // the wall of yellow this layout exists to avoid.
    expect(distinct('--hl-pend-edge', '--hl-pend-bg')).toBeGreaterThanOrEqual(1.2);
  });
});
