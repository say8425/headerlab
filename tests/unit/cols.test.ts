import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The five row-shaped selectors design §3.1 says `--cols` drives. */
const ROW_SHAPED = ['.hl-ghead', '.hl-grp', '.hl-row', '.hl-subrow', '.hl-addrow'] as const;

interface Rule {
  selectors: string[];
  body: string;
}

/**
 * Innermost rule blocks, comments removed.
 *
 * Deliberately not a CSS parser: the selector pattern excludes braces, so a
 * nested at-rule like `@layer base { … }` contributes its inner blocks and not
 * itself. Every rule this file asserts about lives at the top level.
 */
function rules(css: string): Rule[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  for (const [, selector, body] of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({
      selectors: selector!.split(',').map((s) => s.trim()).filter(Boolean),
      body: body!,
    });
  }
  return out;
}

/**
 * Every `grid-template-columns` value this rule set gives `selector`, in source
 * order.
 *
 * Matches the selector as a whole entry in a comma list and nothing else, which
 * is the single-class same-property override this file exists to catch. It does
 * not see a compound or descendant selector (`.hl-gbody .hl-addrow`), the
 * `grid-template` shorthand, or anything an at-rule wraps — those override
 * routes are out of scope here and are caught, if at all, by the resolved-layout
 * assertion in tests/e2e/header-modification.spec.ts.
 */
function templatesFor(css: string, selector: string): string[] {
  const out: string[] = [];
  for (const rule of rules(css)) {
    if (!rule.selectors.includes(selector)) continue;
    for (const [, value] of rule.body.matchAll(/grid-template-columns\s*:\s*([^;}]+)/g)) {
      out.push(value!.trim());
    }
  }
  return out;
}

describe('the --cols track list', () => {
  it('is declared exactly once in the stylesheet', () => {
    // The markup guard in HeaderGrid.test.tsx counts `data-cols-owner`
    // elements, but a jsdom component test never loads this file — a second
    // `--cols:` in CSS would sail past it. This is the half that catches that.
    const css = readFileSync('entrypoints/popup/style.css', 'utf8');
    const declarations = css.match(/--cols\s*:/g) ?? [];
    expect(declarations).toHaveLength(1);
  });

  it('declares the track list the design specifies', () => {
    const css = readFileSync('entrypoints/popup/style.css', 'utf8');
    // `toContain`, not equality: the intent is to find this declaration as a
    // substring of the stylesheet, so comparing against the whole file would
    // be the wrong shape of check.
    expect(css).toContain('--cols: 38px 64px 186px 1fr 26px;');
  });

  it('is declared on the element that carries data-cols-owner, not a sibling', () => {
    // Counting declarations says nothing about *where* the one declaration
    // sits. Moving it to a selector that is not an ancestor of the row-shaped
    // elements — `.hl-foot`, say — leaves both tests above green while every
    // `var(--cols)` below resolves to nothing. `.hl-gbody` is the class
    // HeaderGrid puts `data-cols-owner` on, and HeaderGrid.test.tsx asserts
    // that pairing from the DOM side.
    const css = readFileSync('entrypoints/popup/style.css', 'utf8');
    const owners = rules(css)
      .filter((r) => /--cols\s*:/.test(r.body))
      .flatMap((r) => r.selectors);
    expect(owners).toEqual(['.hl-gbody']);
  });

  it.each(ROW_SHAPED)('gives %s its track list from var(--cols), once and only once', (selector) => {
    // The two tests above look at the *declaration*: how many there are and
    // what it says. Neither looks at the consuming side, so overriding a
    // row-shaped selector with a different track list later in the file
    // leaves both green while the layout breaks — single-class selectors tie
    // on specificity and the last one wins. That is not hypothetical: it is
    // exactly what `.hl-grp, .hl-addrow { grid-template-columns: 1fr auto }`
    // did, unseen by every guard in this suite.
    //
    // Still a claim about the stylesheet's *text*, though, and the text can be
    // right while the layout is not: `.hl-addrow` read this very declaration
    // and resolved a different track list anyway, because Chrome sizes a
    // <button> shrink-to-fit and its `1fr` collapsed to 0. Nothing in this file
    // could have caught that — see `templatesFor` above for the override routes
    // it cannot see either. What the five shapes actually resolve is asserted
    // against a real engine in tests/e2e/header-modification.spec.ts.
    //
    // Exact equality on the whole list, not "the first one is var(--cols)":
    // `['var(--cols)', '1fr auto']` is the override, `['var(--cols)',
    // 'var(--cols)']` is a redundant restatement of the constant this file
    // exists to keep in one place, and `[]` is the selector dropping off the
    // shared block. All three have to fail.
    const css = readFileSync('entrypoints/popup/style.css', 'utf8');
    expect(templatesFor(css, selector)).toEqual(['var(--cols)']);
  });
});
