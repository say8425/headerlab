import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The popup stylesheet names the directories Tailwind may read for class
 * names, and this holds that list to the files that carry markup.
 *
 * Why the list exists: auto-detection read the whole tree minus `.gitignore`,
 * so the CSS depended on where it was built. The Firefox Add-ons sources
 * archive, extracted and rebuilt, produced 45,274 B of popup CSS against the
 * repository's 45,818 B (measured 2026-09-11) — test files the archive leaves
 * out on one side, the build's own `.output/` on the other — and AMO's
 * reviewers rebuild that archive and diff it against the package: "There must
 * be no differences."
 *
 * Why this test exists: the list's cost is the opposite failure. A UI file in
 * a directory the list does not name has its classes read by nobody, and its
 * CSS is simply absent — no error, no warning, a control that renders
 * unstyled. So every tracked `.tsx` and `.html` outside `tests/` and `docs/`
 * must sit under a listed directory. Plain `.ts` is not held to it, because
 * nearly all of it carries no markup; `lib/` and `public/` are listed anyway,
 * as UI-side code whose strings may name a class, and a list that errs wide
 * costs only the bytes of what those files mention.
 */

const STYLESHEET = 'entrypoints/popup/style.css';
const css = readFileSync(STYLESHEET, 'utf8');

/** Each `@source "<dir>";` line, resolved from the stylesheet to the repo root. */
const sources = [...css.matchAll(/^@source\s+"([^"]+)";$/gm)].map((match) =>
  path.normalize(path.join(path.dirname(STYLESHEET), match[1]!)),
);

describe("the popup stylesheet's class sources", () => {
  it('turns auto-detection off, so the list is the whole story', () => {
    expect(css).toMatch(/^@import "tailwindcss" source\(none\);$/m);
    // An exclusion only means something against auto-detection; beside
    // source(none) it would read as a rule while changing nothing.
    expect(css).not.toMatch(/^@source not /m);
  });

  it('names exactly the four UI directories', () => {
    expect(sources).toEqual(['components', 'entrypoints', 'lib', 'public']);
  });

  it('covers every tracked file that carries markup', () => {
    const markup = execFileSync('git', ['ls-files', '*.tsx', '*.html'], { encoding: 'utf8' })
      .split('\n')
      .filter((file) => file !== '' && !/^(tests|docs)\//.test(file));
    // The floor, so a git that answered nothing cannot pass this vacuously.
    expect(markup.length).toBeGreaterThan(10);
    const uncovered = markup.filter((file) => !sources.some((dir) => file.startsWith(`${dir}/`)));
    expect(uncovered, 'markup outside every @source directory').toEqual([]);
  });
});
