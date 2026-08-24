/**
 * Hand-written declarations for `crx.mjs`, whose exports are consumed from
 * TypeScript by `tests/unit/crx.test.ts`. Without this file `tsc --noEmit`
 * fails that import with TS7016 — `allowJs` is off, so a plain `.mjs` has no
 * inferred shape. The same gap `scripts/lib/png.d.mts` closes for `png.mjs`.
 *
 * Nothing checks that this still matches the implementation; CLAUDE.md's "Known
 * gaps" says so of the others, and it is true of this one too.
 */

export declare const CRX_MAGIC: string;
export declare const CRX_VERSION: number;

export declare function parseCrx(buffer: Buffer): {
  version: number;
  headerLength: number;
  header: Buffer;
  payload: Buffer;
};

export declare function readCrxHeader(header: Buffer): {
  publicKeys: Buffer[];
  crxId: Buffer | null;
};

export declare function extensionIdFromPublicKey(der: Buffer): string;
export declare function extensionIdFromDigest(digest: Buffer): string;
