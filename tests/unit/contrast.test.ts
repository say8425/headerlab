import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The popup shipped with light-grey text the owner could not read: the column
 * headers at 2.89:1, the filter labels at 2.99:1, a switched-off resource chip
 * at 2.99:1 — below even the 3:1 floor for something deliberately
 * de-emphasised. The ratios are a stated requirement now, so this file is the
 * thing that fails when the next palette edit quietly walks one back.
 *
 * It reads the two authored palettes out of the stylesheet. The light values
 * are not derived from the dark ones — they are a separate hand-tuned block —
 * so every pair below is asserted against BOTH, which is the half that would
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

/**
 * `over` at `alpha` composited on `under` — the stylesheet paints two surfaces
 * with `color-mix(in oklab, … 35%, transparent)`, and text on those sits on
 * the *blend*, not on either input. Reading the ratio off `--hl-cell` alone
 * would flatter the value column by a wide margin.
 */
function mix(over: string, under: string, alpha: number): string {
  const parse = (hex: string) =>
    [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16));
  const [o, u] = [parse(over), parse(under)];
  return (
    '#' +
    o
      .map((c, i) => Math.round(c * alpha + u[i]! * (1 - alpha)))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  );
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

/** Every colour token both palettes must define, so a rename cannot go unnoticed. */
const COLOR_TOKENS = [
  '--hl-bg', '--hl-panel', '--hl-bar', '--hl-band', '--hl-row-hi', '--hl-cell',
  '--hl-line', '--hl-txt', '--hl-txt2', '--hl-txt3', '--hl-dim', '--hl-acc',
  '--hl-grn', '--hl-amb', '--hl-cyn', '--hl-red',
] as const;

describe('palette parsing', () => {
  // Without this, every ratio assertion below is worthless: a renamed or
  // dropped token makes `vars[name]` undefined, and a helper handed undefined
  // yields NaN — and `expect(NaN).toBeGreaterThanOrEqual(4.5)` fails for the
  // wrong reason while a *typo'd token name in this file* would fail
  // identically. Naming the expected set makes the two distinguishable.
  it.each(['light', 'dark'] as const)('%s defines exactly the known colour tokens', (theme) => {
    const found = Object.keys(PALETTES[theme]).filter((k) => k !== '--hl-sbw').sort();
    expect(found).toEqual([...COLOR_TOKENS].sort());
  });

  // Twice while writing this palette a value was committed as `#6b7policy`
  // and `#38milk` — a token whose value is not a colour. CSS drops the
  // declaration silently, the element inherits, and nothing in a test suite
  // that only reads ratios would notice, because the *other* values still
  // compute fine. An exact-shape assertion on all of them is the cheap guard.
  it.each(['light', 'dark'] as const)('%s gives every colour token a 6-digit hex', (theme) => {
    const malformed = Object.entries(PALETTES[theme])
      .filter(([name]) => name !== '--hl-sbw')
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
 * changes that harm nobody. Each entry names the component and rule that pair
 * it, so a reader can check the claim rather than trust it.
 *
 * The floor is the one the work was specified against: 4.5:1 for anything a
 * user reads, 3:1 for a state that is meant to recede but stay legible.
 * `--hl-dim` is the only token held to 3:1, and it is used only where recession
 * is the point (a switched-off row, an empty value, the foot's "·").
 */
const READ_TEXT = 4.5;
const DE_EMPHASISED = 3;

type Bg = string | { mix: [string, number, string] };
const VALUE_COLUMN = (under: string): Bg => ({ mix: ['--hl-cell', 0.35, under] });

const PAIRS: ReadonlyArray<readonly [string, string, Bg, number]> = [
  // --- primary text, on each of the four surfaces it lands on ---
  ['header name / value text — HeaderRow in .hl-gbody', '--hl-txt', '--hl-bg', READ_TEXT],
  ['brand + pause button — TopBar .hl-topbar', '--hl-txt', '--hl-bar', READ_TEXT],
  ['domain field — FilterBlock .hl-field', '--hl-txt', '--hl-panel', READ_TEXT],
  ['value text over the tinted value column — .hl-c-val', '--hl-txt', VALUE_COLUMN('--hl-bg'), READ_TEXT],
  ['pressed resource chip — .hl-chip[aria-pressed=true]', '--hl-txt', { mix: ['--hl-acc', 0.14, '--hl-bg'] }, READ_TEXT],

  // --- secondary text ---
  ['group rows, add rows, status foot — .hl-grp/.hl-addrow/.hl-foot', '--hl-txt2', '--hl-bar', READ_TEXT],
  ['"n of m applying" — .hl-gright over .hl-grp', '--hl-txt2', VALUE_COLUMN('--hl-bar'), READ_TEXT],
  ['row diagnostic — DiagnosticRow .hl-subline', '--hl-txt2', '--hl-bg', READ_TEXT],
  ['profile diagnostic — DiagnosticBand .hl-bandline', '--hl-txt2', '--hl-band', READ_TEXT],

  // --- the tertiary label grey: every one of these was a named complaint ---
  ['column headers On/Op/Header name/Value — .hl-ghead', '--hl-txt3', '--hl-bg', READ_TEXT],
  ['switched-off resource chip — .hl-chip', '--hl-txt3', '--hl-bg', READ_TEXT],
  ['filter labels Match/Types — .hl-flabel', '--hl-txt3', '--hl-panel', READ_TEXT],
  ['"Paused" — TopBar .hl-runstate[data-paused]', '--hl-txt3', '--hl-bar', READ_TEXT],

  // --- de-emphasised states: recede, but stay above the 3:1 floor ---
  ['switched-off row — .hl-row[data-off]', '--hl-dim', '--hl-bg', DE_EMPHASISED],
  ['switched-off row, value column — .hl-row[data-off] .hl-c-val', '--hl-dim', VALUE_COLUMN('--hl-bg'), DE_EMPHASISED],
  ['empty value placeholder — .hl-val-empty', '--hl-dim', '--hl-bg', DE_EMPHASISED],
  ['foot separator "·" — .hl-sep', '--hl-dim', '--hl-bar', DE_EMPHASISED],

  // --- state that carries meaning: must stay readable on its own surface ---
  ['error diagnostic in the band — .hl-bandline[data-severity=error]', '--hl-red', '--hl-band', READ_TEXT],
  ['error diagnostic on a row — .hl-subline[data-severity=error]', '--hl-red', '--hl-bg', READ_TEXT],
  ['reconcile failure — StatusFoot .hl-footerr', '--hl-red', '--hl-bar', READ_TEXT],
  ['remove-operation marker — .hl-op[data-op=remove]', '--hl-red', VALUE_COLUMN('--hl-bg'), READ_TEXT],
  ['Grant button — DiagnosticBand .hl-grant', '--hl-cyn', '--hl-band', READ_TEXT],
  ['"n need access" — StatusFoot .hl-pendtag', '--hl-cyn', '--hl-bar', READ_TEXT],
  ['"Running" — TopBar .hl-runstate', '--hl-grn', '--hl-bar', READ_TEXT],
];

function resolve(spec: Bg, palette: Record<string, string>): string {
  if (typeof spec === 'string') return palette[spec]!;
  const [token, alpha, under] = spec.mix;
  return mix(palette[token]!, palette[under]!, alpha);
}

describe.each(['light', 'dark'] as const)('%s palette contrast', (theme) => {
  const palette = PALETTES[theme];

  it.each(PAIRS)('%s meets its floor', (_label, fg, bgSpec, floor) => {
    expect(contrast(palette[fg]!, resolve(bgSpec, palette))).toBeGreaterThanOrEqual(floor);
  });

  /**
   * The hierarchy half of the requirement. Raising every grey until it is
   * black would satisfy every ratio above and destroy the ramp, so the ramp
   * itself is asserted: each step must be strictly lighter than the one before
   * against the content background. Without this, a palette of four identical
   * near-blacks passes the whole file.
   */
  it('keeps the text ramp ordered — txt darker than txt2 darker than txt3 darker than dim', () => {
    const against = palette['--hl-bg']!;
    const ramp = ['--hl-txt', '--hl-txt2', '--hl-txt3', '--hl-dim'].map((t) =>
      contrast(palette[t]!, against),
    );
    expect(ramp).toEqual([...ramp].sort((a, b) => b - a));
    // And the ends must actually differ — a sorted array of four equal numbers
    // passes the line above.
    expect(ramp[0]!).toBeGreaterThan(ramp[3]! + 1);
  });
});

/**
 * Region separation. The second complaint was that the top bar, filter block,
 * diagnostic band, grid and status foot were divided by 1px hairlines and
 * nothing else, so the popup read as one sheet — in dark the two surfaces were
 * 0.41% of luminance apart and the hairline carried the whole distinction.
 *
 * Asserted as a contrast RATIO rather than a luminance delta: in a dark theme
 * every surface sits near L=0, so deltas there are tiny by construction and
 * would make a dark palette look broken while a light one sailed through. The
 * ratio is scale-relative and means the same thing in both.
 *
 * 1.1 is the floor for "you can see the edge without a line on it". The pairs
 * are the ones that are actually adjacent in App.tsx's stack.
 */
describe.each(['light', 'dark'] as const)('%s region separation', (theme) => {
  const palette = PALETTES[theme];
  const ADJACENT: ReadonlyArray<readonly [string, string, string]> = [
    ['top bar above filter block', '--hl-bar', '--hl-panel'],
    ['filter block above diagnostic band', '--hl-panel', '--hl-band'],
    ['diagnostic band above grid', '--hl-band', '--hl-bg'],
    ['filter block above grid, when no band is showing', '--hl-panel', '--hl-bg'],
    ['grid above status foot', '--hl-bg', '--hl-bar'],
  ];

  it.each(ADJACENT)('%s are visibly different surfaces', (_label, a, b) => {
    expect(contrast(palette[a]!, palette[b]!)).toBeGreaterThanOrEqual(1.1);
  });
});
