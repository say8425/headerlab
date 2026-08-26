/**
 * Hand-written declarations for `cws.mjs`, whose exports are consumed from
 * TypeScript by `tests/unit/cws.test.ts`. Without this file `tsc --noEmit`
 * fails that import with TS7016 — `allowJs` is off, so a plain `.mjs` has no
 * inferred shape. The same gap `scripts/lib/crx.d.mts` and
 * `scripts/lib/png.d.mts` close for their own modules.
 *
 * Nothing checks that this still matches the implementation; CLAUDE.md's "Known
 * gaps" says so of the others, and it is true of this one too.
 */

export declare const CWS_SCOPE: string;
export declare const TOKEN_ENDPOINT: string;
export declare const JWT_BEARER_GRANT: string;

export declare function base64url(input: string | Uint8Array): string;

export declare function endpoints(item: { publisherId: string; extensionId: string }): {
  upload: string;
  fetchStatus: string;
  publish: string;
};

export declare function uploadHeaders(fileName: string): {
  'X-Goog-Upload-Protocol': string;
  'X-Goog-Upload-File-Name': string;
};

export declare function publishBody(): { blockOnWarnings: boolean };

export declare function claimSet(input: {
  clientEmail: string;
  now: number;
  lifetimeSeconds?: number;
}): {
  iss: string;
  scope: string;
  aud: string;
  iat: number;
  exp: number;
};

export declare function signingInput(claims: object): string;

export declare function readServiceAccount(json: string): {
  clientEmail: string;
  privateKey: string;
};

export declare function interpretUpload(body: unknown): {
  verdict: 'uploaded' | 'pending' | 'failed';
  state: string;
  reason?: string;
};

export declare function mayUpload(status: unknown): { allowed: boolean; reason?: string };

export declare function interpretSubmission(
  status: unknown,
  expectedVersion: string,
): { submitted: boolean; state: string; version: string; reason?: string };

export declare function errorDetail(body: unknown): string | undefined;
