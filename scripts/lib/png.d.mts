/**
 * Hand-written declarations for `png.mjs`, whose one export is consumed from
 * TypeScript by `tests/unit/storeAssets.test.ts`. Without this file
 * `tsc --noEmit` fails that import with TS7016 — `allowJs` is off, so a plain
 * `.mjs` has no inferred shape. The same gap `packages/headerlab/lib/socket.d.mts`
 * closes for `socket.mjs`.
 *
 * Nothing checks that this still matches the implementation; CLAUDE.md's "Known
 * gaps" says so of the three that already exist, and it is true of this one too.
 */

export declare function pngSize(file: string): { width: number; height: number };
