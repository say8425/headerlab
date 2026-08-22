// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScopeRail, type ScopeRailProps } from '@/components/ScopeRail';

/**
 * The documents may only quote what the bridge row actually paints.
 *
 * This is the guard that would have caught #57. Six documents told a reader to
 * confirm the bridge by looking for **Agent bridge live** in the popup; the row
 * rendered its name and nothing else, and the state reached the accessibility
 * tree alone. Every existing guard stayed green: the unit table read the label,
 * which was correct; the e2e suite read geometry; `docs.test.mjs` compared the
 * *commands* in these files and never their prose.
 *
 * The tokens are pinned rather than the sentences. `**Agent bridge …**` is
 * byte-identical in all five languages by construction — it is the one thing a
 * translation cannot translate, because it is the string on screen — so this
 * reads no prose and needs no per-language rule. It is also the only reason
 * `grep -rn "Agent bridge live"` found the defect at all.
 *
 * Direction matters: every token in the documents must be renderable, not the
 * reverse. The row says `down` in the unreachable state and no document
 * mentions it; that is a state nobody has had to write about, not a gap.
 *
 * **What this file cannot see, stated rather than left to be discovered.** It
 * binds the *words*, not their visibility. jsdom applies no CSS, so putting
 * `VISUALLY_HIDDEN` back on the state span — literally reinstating #57 —
 * leaves every test here green. The visibility half is asserted in e2e, where
 * `clip-path` is readable: `header-modification.spec.ts` for `off` and
 * `bridge-rail.spec.ts` for `live` and `down`. Neither half is sufficient
 * alone, and this docblock exists so nobody reads one as both.
 */
/**
 * Every markdown file that quotes the row, found rather than listed.
 *
 * A hand-kept list is one a seventh document can be added beside without
 * anybody noticing — which is the shape of the defect this file is about. The
 * walk skips `docs/superpowers/`, whose specs and plans are dated records and
 * are allowed to quote a row as it was.
 */
function docsQuotingTheRow(dir = '.'): string[] {
  const skip = new Set(['node_modules', '.output', '.git', '.wxt', 'superpowers', 'coverage']);
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
    const full = `${dir}/${entry.name}`.replace(/^\.\//, '');
    if (entry.isDirectory()) out.push(...docsQuotingTheRow(full));
    else if (entry.name.endsWith('.md') && readFileSync(full, 'utf8').includes('**Agent bridge'))
      out.push(full);
  }
  return out.sort();
}

const DOCS = docsQuotingTheRow();

function props(over: Partial<ScopeRailProps> = {}): ScopeRailProps {
  return {
    paused: false,
    announcement: null,
    onTogglePause: vi.fn(),
    domains: [],
    byHost: new Map(),
    lastError: null,
    iconError: null,
    allSites: false,
    allSitesGranted: true,
    onToggleAllSites: vi.fn(),
    onGrantAllSites: vi.fn(),
    resourceTypes: ['xmlhttprequest', 'main_frame'],
    onAddDomain: vi.fn(() => ({ added: true as const })),
    onRemoveDomain: vi.fn(),
    onToggleType: vi.fn(),
    onGrant: vi.fn(),
    bridge: 'off',
    bridgeLastCommandAt: null,
    bridgeError: null,
    bridgeRequestError: null,
    onEnableBridge: vi.fn(),
    onDisableBridge: vi.fn(),
    ...over,
  };
}

/**
 * What a person reads off the row: the name, then the state slot beside it.
 *
 * Deliberately not `row.textContent` — that would sweep in the off-canvas
 * detail span and make every token match through text nobody can see, which is
 * the exact confusion this file exists to end.
 */
function visibleRowText(over: Partial<ScopeRailProps>): string {
  const { unmount } = render(<ScopeRail {...props(over)} />);
  // Document order, not an order this function chooses. Assembling it as
  // `[name, state]` would keep passing if the two spans swapped places, and
  // the row would then read `off  Agent bridge` while every document claiming
  // **Agent bridge off** stayed "verified" — the mismatch moved, not removed.
  //
  // The off-canvas span is excluded by its own marker rather than by testid,
  // so a second clipped element added later is skipped for the same reason
  // this one is. jsdom computes no styles, so the class is what there is to
  // read; the e2e side reads the real `clip-path`.
  const row = screen.getByTestId('bridgestate');
  const text = [...row.querySelectorAll('span')]
    .filter((el) => !el.className.includes('clip-path'))
    .map((el) => el.textContent?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
  unmount();
  return text;
}

/** Every `**Agent bridge …**` a document quotes, with the file it came from. */
function quotedTokens(name: string): string[] {
  const text = readFileSync(name, 'utf8');
  return [...text.matchAll(/\*\*(Agent bridge[^*]*)\*\*/g)].map((m) => m[1]!.trim());
}

describe('the bridge row and the documents that quote it', () => {
  const renderable = new Set(
    [
      visibleRowText({ bridge: 'unknown' }),
      visibleRowText({ bridge: 'off' }),
      visibleRowText({ bridge: 'idle' }),
      visibleRowText({ bridge: 'live' }),
      visibleRowText({ bridge: 'idle', bridgeError: 'Native host has exited.' }),
    ].filter(Boolean),
  );

  it('renders a distinct visible line for every bridge state', () => {
    // Five renders, five strings. If two states collapsed onto one line the
    // set below would silently accept a document quoting either.
    expect(renderable.size).toEqual(5);
    expect(renderable).toContain('Agent bridge');
  });

  it.each(DOCS)('%s quotes only what the row can render', (name) => {
    const tokens = quotedTokens(name);
    // Absence before presence: a document that stopped quoting the row would
    // otherwise pass this by having nothing to check.
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(renderable, `${name} quotes "${token}", which the row never renders`).toContain(token);
    }
  });
});
