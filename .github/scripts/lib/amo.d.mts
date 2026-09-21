/**
 * Hand-written declarations for `amo.mjs`, whose exports are consumed from
 * TypeScript by `tests/unit/amo.test.ts`. Without this file `tsc --noEmit`
 * fails that import with TS7016 — `allowJs` is off. Same gap `cws.d.mts`,
 * `crx.d.mts` and `png.d.mts` close for their own modules, and the same
 * caveat: nothing checks that this still matches the implementation
 * (CLAUDE.md, "Known gaps").
 */

export declare const AMO_ORIGIN: string;
export declare const GECKO_ID: string;
export declare const CHANNELS: readonly string[];
export declare const MAX_JWT_LIFETIME_SECONDS: number;

export declare function base64url(input: string | Uint8Array): string;

export declare function archiveNames(version: string): {
  extension: string;
  sources: string;
  signed: string;
};

export declare function issuerLooksValid(issuer: unknown): boolean;

export declare function claimSet(input: {
  issuer: string;
  now: number;
  jti: string;
  lifetimeSeconds?: number;
}): { iss: string; jti: string; iat: number; exp: number };

export declare function signingInput(claims: object): string;

export declare function endpoints(id: string): {
  addon: string;
  versions: (filter?: string) => string;
  version: (number: string) => string;
};

export declare function parseHash(hash: string): { algorithm: 'sha256'; hex: string };

export type SignedFileVerdict =
  | { kind: 'ready'; url: string; hash: string }
  | { kind: 'wait'; status: string }
  | { kind: 'refused'; reason: string };

export declare function readSignedFile(
  version: unknown,
  options: { channel: string },
): SignedFileVerdict;

export declare function manifestMatches(
  manifest: unknown,
  expected: { version: string; geckoId: string },
): string[];

export declare function trustedAmoUrl(input: string): string;
export declare function submitEnvironment(
  env: Record<string, string | undefined>,
  creds: { issuer: string; secret: string },
  options: { binDir: string },
): Record<string, string | undefined>;

export declare const DOWNLOAD_ORIGINS: readonly string[];
export declare function downloadHop(
  location: string,
  from: string,
): { url: string; withAuth: boolean };
