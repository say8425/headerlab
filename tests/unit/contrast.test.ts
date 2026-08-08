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
const NON_COLOR = ['--radius', '--font-sans', '--font-mono'];

/** 두 팔레트가 모두 정의해야 하는 색 토큰. 이름이 바뀌면 조용히 지나가지 않는다. */
const COLOR_TOKENS = [
  '--background',
  '--foreground',
  '--foreground-2',
  '--muted-foreground',
  '--card',
  '--border',
  '--tray',
  '--rail',
  '--rail-border',
  '--input',
  '--primary',
  '--primary-foreground',
  '--ring',
  '--boundary',
  '--live',
  '--live-bg',
  '--pending',
  '--pending-bg',
  '--pending-border',
  '--destructive',
  '--destructive-bg',
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
 * themes**; the lowest asserted here is the remove `×` on an unusable site row
 * — `--muted-foreground` on `--destructive-bg` — at **4.51** light. (It reads
 * 4.56 on the rail, which this sentence used to name as the floor; the site
 * rows paint their own background and were added to the guard later.) Nothing
 * is parked in the 3:1 allowance except the off-switch track, which is a
 * shape. That is deliberate and it is the direct answer to the original
 * complaint: the palette this replaces expressed "de-emphasised" by fading
 * text toward the background, and a switched-off rule here keeps
 * full-contrast text and is marked by its switch and a dashed card instead.
 */
const READ_TEXT = 4.5;
const SHAPE = 3;

const TEXT_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  // --- the panel: fields, buttons and the surfaces they sit on ---
  ['header name and value text — .hl-hname / .hl-hval', '--foreground', '--background'],
  ['operation button label — .hl-op', '--foreground-2', '--background'],
  [
    'field placeholders and the ghost row — .hl-hval::placeholder / .hl-ghostrule',
    '--muted-foreground',
    '--background',
  ],
  ['header name over the card behind it — .hl-hname on .hl-rule', '--foreground', '--card'],
  ['New rule button — .hl-newbtn', '--background', '--foreground'],
  ['remove operation marker — .hl-op[data-op=remove]', '--destructive', '--background'],
  ['REQ direction pill — .hl-pill[data-target=request]', '--req', '--req-bg'],
  ['RES direction pill — .hl-pill[data-target=response]', '--res', '--res-bg'],
  ['warning inside a rule card — .hl-rprob', '--foreground', '--pending-bg'],
  ['error inside a rule card — .hl-rprob[data-severity=error]', '--foreground', '--destructive-bg'],
  ['the "!" in a warning badge — .hl-rprob-ic', '--pending-bg', '--pending'],
  [
    'the "!" in an error badge — .hl-rprob[data-severity=error] .hl-rprob-ic',
    '--destructive-bg',
    '--destructive',
  ],

  // --- the tray (the rules well `--card` sits inside — see style.css). No
  //     `.hl-*` rule paints it yet, Task 8 does that, but the token exists
  //     now and a colour that will hold text later must not rot unguarded
  //     until then. ---
  ['text on the tray, granted ahead of Task 8 painting it', '--foreground', '--tray'],
  ['muted text on the tray, granted ahead of Task 8 painting it', '--muted-foreground', '--tray'],

  // --- the rail, whose surface is the darker material in light and the
  //     lighter one in dark; both directions are asserted by running every
  //     pair against both palettes ---
  // `.hl-dom` paints its own background and swaps it by `data-state`, so every
  // text node on a site row is measured against the row, not the rail. The
  // guard used to write these against `--background` alone and so never saw
  // the pending and unusable rows at all — where the popup's true lowest text
  // ratio turned out to live.
  ['site host, granted row — .hl-domhost', '--foreground', '--background'],
  ['site host, pending row — .hl-dom[data-state=pending]', '--foreground', '--pending-bg'],
  ['site host, unusable row — .hl-dom[data-state=unusable]', '--foreground', '--destructive-bg'],
  ['site remove ×, pending row — .hl-domx', '--muted-foreground', '--pending-bg'],
  ['site remove ×, unusable row — .hl-domx', '--muted-foreground', '--destructive-bg'],
  [
    'readout subcount and section headings — .hl-subcount / .hl-railhead',
    '--foreground-2',
    '--rail',
  ],
  ['section counts and unchecked type labels — .hl-n / .hl-ty', '--muted-foreground', '--rail'],
  ['"Active" — .hl-pauselab', '--live', '--live-bg'],
  ['"Paused" — .hl-pausebar[data-paused] .hl-pauselab', '--foreground-2', '--background'],
  // The all-sites switch wears three surfaces, one per state, and each paints
  // its own label. The ungranted one is the pair nothing else on screen used:
  // every other amber element is `--foreground` on the amber fill, and this is
  // the amber ink on it.
  ['"All sites", off — .hl-allsiteslab', '--foreground-2', '--background'],
  ['"All sites", on and granted — .hl-allsites[data-on] .hl-allsiteslab', '--live', '--live-bg'],
  [
    '"All sites", awaiting access — .hl-allsites[data-granted=no] .hl-allsiteslab',
    '--pending',
    '--pending-bg',
  ],
  // Every site row now carries a second line naming its state, and that line is
  // painted on whichever fill the row is wearing — so it needs the pair its
  // hostname needs, once per surface. The idle one replaces the pair that was
  // written for `.hl-fieldnote-calm`: those exact words moved from a paragraph
  // above the list onto the row itself, so the guard moved with them rather
  // than being deleted.
  ['row state line, granted — .hl-needsay', '--muted-foreground', '--background'],
  [
    'row state line, pending — .hl-dom[data-state=pending] .hl-needsay',
    '--muted-foreground',
    '--pending-bg',
  ],
  [
    'row state line, unusable — .hl-dom[data-state=unusable] .hl-needsay',
    '--muted-foreground',
    '--destructive-bg',
  ],
  // The site list while all-sites is on: the row drops its own fill, so both
  // its text and its state line are painted straight onto the rail.
  ['site host, not in use — .hl-dom[data-state=idle] .hl-domhost', '--muted-foreground', '--rail'],
  [
    'row state line, not in use — .hl-dom[data-state=idle] .hl-needsay',
    '--muted-foreground',
    '--rail',
  ],
  ['Grant button — .hl-grant', '--background', '--ring'],
  ['site remove × — .hl-domx', '--muted-foreground', '--background'],
  ['the ? mark — .hl-helpmark', '--muted-foreground', '--rail'],
  [
    'help bubble — .hl-helpbubble, an inverted surface in both themes',
    '--background',
    '--foreground',
  ],
  ['"already in the list" note — .hl-fieldnote', '--pending', '--rail'],
  ['scope note body — .hl-note', '--foreground', '--background'],
  ['reconcile failure heading — .hl-note-err b', '--destructive', '--background'],
  // Parked in Task 1: both tokens were in COLOR_TOKENS but nothing painted
  // with them yet. shadcn's Button (components/ui/button.tsx, `default`
  // variant) is the first thing that does — `bg-primary text-primary-foreground`.
  ['primary button — shadcn Button', '--primary-foreground', '--primary'],
];

const SHAPE_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ['switched-off rule track — .hl-tog[aria-checked=false] on .hl-rule', '--input', '--card'],
  ['paused master switch track — .hl-sw[aria-checked=false] on the rail', '--input', '--rail'],
  ['unchecked type box — .hl-tybox on the rail', '--input', '--rail'],
  // The idle row's dot is a hollow ring rather than a fill — there is no access
  // state to report on a host nothing is scoped to — so what has to stay
  // visible is its outline.
  [
    'not-in-use site dot ring — .hl-dom[data-state=idle] .hl-domstate',
    '--muted-foreground',
    '--rail',
  ],
  // The scope note's left edge is what separates the card from the rail. The
  // `incomplete` one is neutral rather than amber — see the stylesheet — so it
  // is the edge most at risk of being toned down until it stops dividing
  // anything.
  [
    'incomplete note edge — .hl-note[data-severity=incomplete]',
    '--muted-foreground',
    '--background',
  ],
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
 * fails while the authored palette passes: rail against panel is 1.184 light /
 * 1.098 dark, and every edge against the surfaces it divides is at least 1.219.
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
   * reference mockup. Not painted by any `.hl-*` rule yet (Task 8 does that),
   * but it must not rot unguarded in the meantime. The floor reuses the rail
   * check's own 1.09 above rather than the edge checks' 1.2 below: this is the
   * same category of pair (fill vs fill, not a line), and 1.2 is not reachable
   * here in either theme — light measures 1.184 with the mockup's own value,
   * dark 1.098, so 1.2 would fail on the authored palette itself.
   */
  it('gives the panel a third surface — the tray — distinguishable from the card', () => {
    expect(distinct('--card', '--tray')).toBeGreaterThanOrEqual(1.09);
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

  it('gives a pending site an edge visible against its own amber fill', () => {
    // The one row on screen that changes surface to signal state. If the edge
    // vanished into the fill the row would read as a coloured block, which is
    // the wall of yellow this layout exists to avoid.
    expect(distinct('--pending-border', '--pending-bg')).toBeGreaterThanOrEqual(1.2);
  });
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
  ] as const)('%s on %s reaches 3:1', (fg, bg) => {
    expect(contrast(palette[fg]!, palette[bg]!)).toBeGreaterThanOrEqual(SHAPE);
  });
});
