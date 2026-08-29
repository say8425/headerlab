import { describe, expect, it } from 'vitest';
import {
  base64url,
  claimSet,
  CWS_SCOPE,
  endpoints,
  errorDetail,
  interpretSubmission,
  interpretUpload,
  mayUpload,
  publishBody,
  readServiceAccount,
  signingInput,
  TOKEN_ENDPOINT,
  uploadHeaders,
  uploadStillRunning,
} from '@/scripts/lib/cws.mjs';

/**
 * The Chrome Web Store submission, tested where it can be wrong silently.
 *
 * None of this talks to the store — it cannot, since the credential and the
 * signing key are both outside CI's unit job by design. What it does cover is
 * every place `scripts/store-submit.mjs` decides what a response *means*, and
 * that is the surface that matters: the store answers a rejected signature in
 * the response body while the status line still reads 200, so a caller that
 * trusts HTTP alone reports a release it never submitted.
 *
 * The endpoint and header assertions are pinned to literal strings rather than
 * rebuilt from the same helpers, so a typo has to be made twice to pass.
 */

const ITEM = { publisherId: '1234567890', extensionId: 'kgapijlldieckifoenckgninnepafhnn' };

describe('endpoints', () => {
  /**
   * The upload endpoint sits under `/upload/v2/` while the other two sit under
   * `/v2/`. Collapsing them to one prefix produces a 404 that reads like a
   * permission problem, which is a long way to walk for a missing path segment.
   */
  it('puts upload on the upload host path and the rest on the plain one', () => {
    expect(endpoints(ITEM)).toEqual({
      upload:
        'https://chromewebstore.googleapis.com/upload/v2/publishers/1234567890/items/kgapijlldieckifoenckgninnepafhnn:upload',
      fetchStatus:
        'https://chromewebstore.googleapis.com/v2/publishers/1234567890/items/kgapijlldieckifoenckgninnepafhnn:fetchStatus',
      publish:
        'https://chromewebstore.googleapis.com/v2/publishers/1234567890/items/kgapijlldieckifoenckgninnepafhnn:publish',
    });
  });

  it('refuses to build a URL with a hole in it', () => {
    expect(() => endpoints({ ...ITEM, publisherId: '' })).toThrow(/publisherId/);
    expect(() => endpoints({ ...ITEM, extensionId: '' })).toThrow(/extensionId/);
  });
});

describe('uploadHeaders', () => {
  /**
   * Quoted from `/docs/webstore/update`: "When using the API, include the
   * following HTTP headers: X-Goog-Upload-Protocol: raw /
   * X-Goog-Upload-File-Name: EXTENSION_FILE_NAME.crx".
   */
  it('sends exactly the two headers a verified CRX upload needs', () => {
    expect(uploadHeaders('headerlab-1.8.0-chrome.crx')).toEqual({
      'X-Goog-Upload-Protocol': 'raw',
      'X-Goog-Upload-File-Name': 'headerlab-1.8.0-chrome.crx',
    });
  });

  /**
   * This item has Verified CRX Uploads on, so it refuses a zip outright. Naming
   * a `.zip` in the header would send one and learn that from the store, after
   * the tag exists.
   */
  it('refuses a file name the store would reject', () => {
    expect(() => uploadHeaders('headerlab-1.8.0-chrome.zip')).toThrow(/\.crx/);
  });
});

/**
 * The live `fetchStatus` body, captured from the published item on 2026-08-28 by
 * `pnpm store:probe`, trimmed of the public key. Every status fixture below is
 * built from this rather than invented, because inventing it is exactly what
 * went wrong: the first version of this module read `itemState` and `crxVersion`
 * at the top level, and the real response has neither.
 */
const LIVE_STATUS = {
  name: 'publishers/2b78bc3e/items/kgapijlldieckifoenckgninnepafhnn',
  itemId: 'kgapijlldieckifoenckgninnepafhnn',
  publishedItemRevisionStatus: {
    state: 'PUBLISHED',
    distributionChannels: [{ deployPercentage: 100, crxVersion: '1.7.0' }],
  },
};

/** The same body with a revision submitted and awaiting review. */
const withSubmitted = (state: string, crxVersion: string) => ({
  ...LIVE_STATUS,
  submittedItemRevisionStatus: { state, distributionChannels: [{ crxVersion }] },
});

describe('interpretUpload', () => {
  /**
   * `SUCCEEDED`, from the v2 `UploadState` enum. An earlier version of this file
   * guessed `SUCCESS`, `UPLOAD_SUCCESS` and `COMPLETED` — none of which exist —
   * so a successful upload would have been read as unrecognised and refused.
   */
  it('reads the documented success state as uploaded', () => {
    expect(interpretUpload({ uploadState: 'SUCCEEDED' }).verdict).toBe('uploaded');
  });

  /**
   * The API's own pages disagree here: `media.upload`'s field docs say
   * "If uploadState is `UPLOAD_IN_PROGRESS`" while the `UploadState` enum lists
   * `IN_PROGRESS`. Neither has been seen in a real upload response, so both are
   * accepted rather than a side being picked.
   */
  it('reads both spellings of in-progress as pending', () => {
    for (const uploadState of ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS']) {
      expect(interpretUpload({ uploadState }).verdict).toBe('pending');
    }
  });

  it('reads the documented failure state as failed, carrying the store’s own reason', () => {
    const verdict = interpretUpload({
      uploadState: 'FAILED',
      itemError: [{ error_detail: 'The uploaded package is not signed by the expected key.' }],
    });
    expect(verdict.verdict).toBe('failed');
    expect(verdict.reason).toBe('The uploaded package is not signed by the expected key.');
  });

  /**
   * The one that matters most. An unrecognised state is the shape a silent
   * failure takes here: the store changes a string, the reader shrugs, and a
   * release reports success having submitted nothing. `NOT_FOUND` and
   * `UPLOAD_STATE_UNSPECIFIED` are included because they are real enum members
   * that belong to a *status* response — arriving on an upload response they
   * mean something this cannot name.
   */
  it('refuses to read an unknown state as success', () => {
    for (const uploadState of [
      'NOT_A_REAL_STATE',
      '',
      undefined,
      'NOT_FOUND',
      'UPLOAD_STATE_UNSPECIFIED',
    ]) {
      expect(interpretUpload({ uploadState }).verdict).toBe('failed');
    }
    expect(interpretUpload({}).verdict).toBe('failed');
    expect(interpretUpload(undefined).verdict).toBe('failed');
  });
});

describe('uploadStillRunning', () => {
  /**
   * A status response reports the upload under `lastAsyncUploadState`, not
   * `uploadState`. Reading the wrong field is what made an earlier polling loop
   * return on its first pass every time, so the wrong field is asserted as
   * explicitly not working.
   */
  it('reads lastAsyncUploadState, and not uploadState', () => {
    expect(uploadStillRunning({ lastAsyncUploadState: 'IN_PROGRESS' })).toBe(true);
    expect(uploadStillRunning({ uploadState: 'IN_PROGRESS' })).toBe(false);
  });

  /** "Only set when there has been an async upload … in the past 24 hours." */
  it('treats an absent field and a settled upload alike, as nothing in flight', () => {
    expect(uploadStillRunning(LIVE_STATUS)).toBe(false);
    expect(uploadStillRunning({ lastAsyncUploadState: 'SUCCEEDED' })).toBe(false);
    expect(uploadStillRunning({ lastAsyncUploadState: 'NOT_FOUND' })).toBe(false);
    expect(uploadStillRunning(undefined)).toBe(false);
  });
});

describe('mayUpload', () => {
  /**
   * The ordinary state between releases: published, nothing submitted since. The
   * live body is exactly this, so a release starting today would proceed — which
   * is the single most important thing this suite can assert, because the first
   * version of the module refused it.
   */
  it('allows an upload when the item has no submitted revision', () => {
    const gate = mayUpload(LIVE_STATUS, '1.8.0');
    expect(gate.allowed).toBe(true);
    expect(gate.state).toBe('PUBLISHED');
  });

  /**
   * `STAGED` is "approved and ready to be published" — still a revision nobody
   * should upload over, and a state the earlier guesswork did not know existed.
   */
  it('refuses while a submitted revision is awaiting review or publication', () => {
    for (const state of ['PENDING_REVIEW', 'STAGED']) {
      const gate = mayUpload(withSubmitted(state, '1.7.5'), '1.8.0');
      expect(gate.allowed).toBe(false);
      expect(gate.alreadySubmitted).toBeUndefined();
      expect(gate.reason).toContain(state);
    }
  });

  /**
   * The retry path would otherwise eat itself. The tag is cut before the store
   * step runs, so re-running against the same tag is the documented recovery —
   * and if the first attempt submitted before dying for some later reason, a
   * plain refusal would block every retry forever.
   */
  it('reports this exact version already being submitted as done, not as a conflict', () => {
    const gate = mayUpload(withSubmitted('PENDING_REVIEW', '1.8.0'), '1.8.0');
    expect(gate.allowed).toBe(false);
    expect(gate.alreadySubmitted).toBe(true);
  });

  /** A settled submitted revision is not going anywhere; a new upload replaces it. */
  it('allows an upload over a rejected or cancelled submission', () => {
    for (const state of ['REJECTED', 'CANCELLED']) {
      expect(mayUpload(withSubmitted(state, '1.7.5'), '1.8.0').allowed).toBe(true);
    }
  });

  it('refuses a taken-down item outright', () => {
    const gate = mayUpload({ ...LIVE_STATUS, takenDown: true }, '1.8.0');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain('taken down');
  });

  /**
   * Fail-closed on a submitted revision whose state this file cannot name — an
   * unnameable state is one it cannot rule an open submission out for. Note the
   * empty body is *allowed*: no submitted revision is the ordinary between-
   * releases case, and refusing it would block every release.
   */
  it('refuses a submitted-revision state it cannot name', () => {
    const gate = mayUpload(withSubmitted('SOMETHING_NEW', '1.7.5'), '1.8.0');
    expect(gate.allowed).toBe(false);
    expect(gate.alreadySubmitted).toBeUndefined();
    expect(gate.reason).toContain('SOMETHING_NEW');
  });
});

describe('signingInput and base64url', () => {
  /**
   * A JWS signature is taken over this exact string, so a `base64` slip here is
   * a token endpoint rejection rather than anything local. Google fails it
   * loudly, which is why these are cheap rather than critical — but they are
   * three lines.
   */
  it('produces two base64url segments with no padding and no base64 alphabet', () => {
    const segments = signingInput(claimSet({ clientEmail: 'a@b.c', now: 1_700_000_000 })).split(
      '.',
    );
    expect(segments).toHaveLength(2);
    for (const segment of segments) {
      expect(segment).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    expect(JSON.parse(Buffer.from(segments[0] ?? '', 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
  });

  it('maps the two characters base64url exists to change, and drops padding', () => {
    expect(base64url(Buffer.from([0xfb, 0xff, 0xbf, 0x00]))).toBe('-_-_AA');
  });
});

describe('interpretSubmission', () => {
  /**
   * Both halves are load-bearing, and each is asserted failing on its own. The
   * state alone would pass while the store still held the previous version; the
   * version alone would pass while the revision sat in a settled state.
   */
  it('accepts only the right version awaiting review', () => {
    expect(interpretSubmission(withSubmitted('PENDING_REVIEW', '1.8.0'), '1.8.0')).toEqual({
      submitted: true,
      state: 'PENDING_REVIEW',
      version: '1.8.0',
    });
  });

  it('accepts a revision already approved and waiting to go out', () => {
    expect(interpretSubmission(withSubmitted('STAGED', '1.8.0'), '1.8.0').submitted).toBe(true);
  });

  it('rejects the right state holding the wrong version', () => {
    const result = interpretSubmission(withSubmitted('PENDING_REVIEW', '1.7.5'), '1.8.0');
    expect(result.submitted).toBe(false);
    expect(result.reason).toContain('1.7.5');
  });

  it('rejects the right version in a settled state', () => {
    const result = interpretSubmission(withSubmitted('REJECTED', '1.8.0'), '1.8.0');
    expect(result.submitted).toBe(false);
    expect(result.reason).toContain('REJECTED');
  });

  /**
   * The published revision is never the answer. After `:publish` the new version
   * becomes the *submitted* revision while the published one still holds the
   * previous version — so reading the published side would wait for something
   * that only happens days later, when review passes.
   */
  it('ignores the published revision entirely', () => {
    const published = interpretSubmission(LIVE_STATUS, '1.7.0');
    expect(published.submitted).toBe(false);
    expect(published.reason).toContain('no submitted revision');
  });

  it('rejects a response that answers neither', () => {
    expect(interpretSubmission({}, '1.8.0').submitted).toBe(false);
  });
});

describe('publishBody', () => {
  /**
   * `blockOnWarnings` defaults to false at the API — warnings ignored — which
   * is the wrong default for a project whose claim is that nothing fails
   * quietly. It is not a parameter, so no call site can forget it.
   */
  it('always blocks on warnings', () => {
    expect(publishBody()).toEqual({ blockOnWarnings: true });
  });
});

describe('claimSet', () => {
  it('builds the assertion the token endpoint expects', () => {
    expect(
      claimSet({ clientEmail: 'bot@example.iam.gserviceaccount.com', now: 1_700_000_000 }),
    ).toEqual({
      iss: 'bot@example.iam.gserviceaccount.com',
      scope: CWS_SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
  });

  it('names the one scope the Chrome Web Store API takes', () => {
    expect(CWS_SCOPE).toBe('https://www.googleapis.com/auth/chromewebstore');
  });

  it('refuses a lifetime Google would reject', () => {
    expect(() => claimSet({ clientEmail: 'a@b.c', now: 0, lifetimeSeconds: 3601 })).toThrow(/3600/);
    expect(() => claimSet({ clientEmail: 'a@b.c', now: 0, lifetimeSeconds: 0 })).toThrow(/3600/);
  });

  /**
   * `now` is injected rather than read, which is what makes the assertion above
   * an equality rather than a range check.
   */
  it('refuses a clock it was not given', () => {
    expect(() => claimSet({ clientEmail: 'a@b.c', now: Number.NaN })).toThrow(/epoch seconds/);
  });
});

describe('readServiceAccount', () => {
  const valid = JSON.stringify({
    type: 'service_account',
    client_email: 'bot@example.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n',
  });

  it('pulls out the two fields the signature needs', () => {
    const { clientEmail, privateKey } = readServiceAccount(valid);
    expect(clientEmail).toBe('bot@example.iam.gserviceaccount.com');
    expect(privateKey).toContain('BEGIN PRIVATE KEY');
  });

  /**
   * A key file that parses but carries no `private_key` would otherwise sign
   * nothing and draw a 400 from Google naming neither field.
   */
  it('names the missing field rather than failing later', () => {
    expect(() => readServiceAccount(JSON.stringify({ client_email: 'a@b.c' }))).toThrow(
      /private_key/,
    );
    expect(() => readServiceAccount(JSON.stringify({ private_key: 'x' }))).toThrow(/client_email/);
  });

  it('rejects a credential that is not a service account', () => {
    expect(() => readServiceAccount(JSON.stringify({ type: 'authorized_user' }))).toThrow(
      /service_account/,
    );
  });

  it('says so when the secret is not JSON at all', () => {
    expect(() => readServiceAccount('not json')).toThrow(/not JSON/);
  });
});

describe('errorDetail', () => {
  it('flattens Google’s envelope and v1’s itemError list into one sentence', () => {
    expect(errorDetail({ error: { message: 'Permission denied.' } })).toBe('Permission denied.');
    expect(errorDetail({ itemError: [{ error_detail: 'a' }, { error_detail: 'b' }] })).toBe('a; b');
    expect(errorDetail({})).toBeUndefined();
  });
});
