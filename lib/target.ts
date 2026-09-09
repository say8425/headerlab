import type { Target } from '@/lib/model/types';

/**
 * The one place the build target is read.
 *
 * WXT defines `import.meta.env.BROWSER` per `-b` at build time
 * (`core/utils/globals.mjs`, through Vite `define`), so this folds to a
 * literal in each bundle. Under vitest the WxtVitest plugin defines it too,
 * and anything that is not `'firefox'` — including undefined — reads as
 * Chrome, because Chrome is the build every other tool in this repository
 * produces by default.
 *
 * **Only adapters and the popup import this.** `lib/compile/`, `lib/view/`,
 * `lib/permissions/audit.ts` and `lib/bridge/query.ts` take a `Target`
 * parameter instead, and tests/unit/purity.test.ts forbids this import in
 * every guarded file — a pure function whose answer depends on which bundle
 * it was compiled into is not pure, and would only be testable by building
 * for Firefox.
 */
export const TARGET: Target = import.meta.env.BROWSER === 'firefox' ? 'firefox' : 'chrome';
