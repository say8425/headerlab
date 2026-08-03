import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
});
