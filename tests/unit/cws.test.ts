import { describe, expect, it } from 'vitest';
import {
  claimSet,
  CWS_SCOPE,
  endpoints,
  errorDetail,
  interpretSubmission,
  interpretUpload,
  mayUpload,
  publishBody,
  readServiceAccount,
  TOKEN_ENDPOINT,
  uploadHeaders,
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

describe('interpretUpload', () => {
  it('reads each documented success spelling as uploaded', () => {
    for (const uploadState of ['SUCCESS', 'UPLOAD_SUCCESS', 'COMPLETED']) {
      expect(interpretUpload({ uploadState }).verdict).toBe('uploaded');
    }
  });

  /**
   * The docs spell in-progress two ways across pages — `IN_PROGRESS` on the v2
   * UploadState type, `UPLOAD_IN_PROGRESS` in the prose telling you to poll —
   * and neither has been observed against this item. Both are accepted rather
   * than one being guessed at.
   */
  it('reads both spellings of in-progress as pending', () => {
    for (const uploadState of ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS']) {
      expect(interpretUpload({ uploadState }).verdict).toBe('pending');
    }
  });

  it('reads a failure state as failed and carries the store’s own reason', () => {
    const verdict = interpretUpload({
      uploadState: 'FAILURE',
      itemError: [{ error_detail: 'The uploaded package is not signed by the expected key.' }],
    });
    expect(verdict.verdict).toBe('failed');
    expect(verdict.reason).toBe('The uploaded package is not signed by the expected key.');
  });

  /**
   * The one that matters most. An unrecognised state is the shape a silent
   * failure takes here: the store changes a string, the reader shrugs, and a
   * release reports success having submitted nothing. Defaulting to failure
   * costs a red job and a widened set; defaulting to success costs a version
   * that never reached the store while everything went green.
   */
  it('refuses to read an unknown state as success', () => {
    for (const uploadState of ['NOT_A_REAL_STATE', '', undefined]) {
      const verdict = interpretUpload({ uploadState });
      expect(verdict.verdict).toBe('failed');
    }
    expect(interpretUpload({}).verdict).toBe('failed');
    expect(interpretUpload(undefined).verdict).toBe('failed');
  });
});

describe('mayUpload', () => {
  /**
   * Nothing documents what a second upload does to an item already in review,
   * and this repository has cut two releases four minutes apart. Refusing is
   * the only answer that does not find out during one.
   */
  it('refuses while a previous submission is still in review', () => {
    for (const itemState of ['PENDING_REVIEW', 'IN_REVIEW']) {
      const gate = mayUpload({ itemState });
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toContain(itemState);
    }
  });

  it('allows an item that is not in review', () => {
    expect(mayUpload({ itemState: 'PUBLISHED' })).toEqual({ allowed: true });
    expect(mayUpload({})).toEqual({ allowed: true });
  });
});

describe('interpretSubmission', () => {
  /**
   * Both halves are load-bearing, and each is asserted failing on its own. The
   * state alone would pass while the store still held the previous version; the
   * version alone would pass while the package sat in a draft nobody submitted.
   */
  it('accepts only the right version in a review state', () => {
    expect(
      interpretSubmission({ itemState: 'PENDING_REVIEW', crxVersion: '1.8.0' }, '1.8.0'),
    ).toEqual({
      submitted: true,
      state: 'PENDING_REVIEW',
      version: '1.8.0',
    });
  });

  it('rejects the right state holding the wrong version', () => {
    const result = interpretSubmission(
      { itemState: 'PENDING_REVIEW', crxVersion: '1.7.0' },
      '1.8.0',
    );
    expect(result.submitted).toBe(false);
    expect(result.reason).toContain('1.7.0');
  });

  it('rejects the right version sitting in a state that is not review', () => {
    const result = interpretSubmission({ itemState: 'DRAFT', crxVersion: '1.8.0' }, '1.8.0');
    expect(result.submitted).toBe(false);
    expect(result.reason).toContain('DRAFT');
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
