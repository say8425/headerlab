/**
 * The Chrome Web Store publish API, as decisions rather than as requests.
 *
 * Everything here is pure: URLs, headers, a JWT claim set, and four readers that
 * turn an API response into a verdict. `scripts/store-submit.mjs` does the I/O.
 * Same split as `scripts/lib/crx.mjs` beside it, and for the same reason — the
 * parts that can be wrong in a way nobody notices are the parts that decide
 * whether a response means success, and those are the parts a test can reach
 * without a network, a key, or a store item.
 *
 * **The API version matters and the documentation is split across two pages.**
 * v1 retires 2026-10-15 ("The Chrome Web Store API (V1) is deprecated and will
 * only be supported until 15th October 2026", on the v1 reference). v2 supplies
 * the endpoints below. But v2's own page never mentions CRX — measured, zero
 * occurrences of `crx` and zero of `X-Goog` over the stripped page — and the two
 * upload headers come from `/docs/webstore/update`, whose "Update API" link is
 * still the v1-era path `using_webstore_api#uploadexisting` and reaches v2 only
 * through a site-wide 301. So pairing the v2 endpoint with the CRX headers is an
 * inference from adjacency, not something either document states. It is the
 * first thing a real run measures, which is why `interpretUpload` below refuses
 * to read an unrecognised response as success.
 *
 * **Why a hand-rolled JWT rather than a library or an action.** This repository
 * takes no new dependencies, and the service-account flow is a signed claim set
 * posted to one endpoint. `node:crypto` does the signing in the caller; the
 * claim set is assembled here so a test can pin it.
 */

/** The one OAuth scope the Chrome Web Store API takes. */
export const CWS_SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

/** Google's token endpoint, and the audience the JWT must name. */
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** RFC 7523's grant type for a service-account assertion. */
export const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

/** Base64url, no padding — what JWS wants and what `base64` is not. */
export const base64url = (input) =>
  Buffer.from(input)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

/**
 * The three v2 endpoints, built from the publisher and the item.
 *
 * Note `upload` sits on a different path prefix (`/upload/v2/...`) from the
 * other two (`/v2/...`). Getting that wrong produces a 404 that reads like a
 * permission problem.
 */
export const endpoints = ({ publisherId, extensionId }) => {
  if (!publisherId) throw new Error('endpoints: publisherId is required');
  if (!extensionId) throw new Error('endpoints: extensionId is required');
  const item = `publishers/${publisherId}/items/${extensionId}`;
  return {
    upload: `https://chromewebstore.googleapis.com/upload/v2/${item}:upload`,
    fetchStatus: `https://chromewebstore.googleapis.com/v2/${item}:fetchStatus`,
    publish: `https://chromewebstore.googleapis.com/v2/${item}:publish`,
  };
};

/**
 * The two headers a verified-CRX upload needs, quoted from
 * `/docs/webstore/update`: "When using the API, include the following HTTP
 * headers: X-Goog-Upload-Protocol: raw / X-Goog-Upload-File-Name:
 * EXTENSION_FILE_NAME.crx".
 *
 * The `.crx` suffix is required rather than cosmetic — it is how the store is
 * told the body is a signed package instead of a zip, and this item refuses a
 * zip outright.
 */
export const uploadHeaders = (fileName) => {
  if (!fileName.endsWith('.crx')) {
    throw new Error(`uploadHeaders: the store wants a .crx file name, got ${fileName}`);
  }
  return {
    'X-Goog-Upload-Protocol': 'raw',
    'X-Goog-Upload-File-Name': fileName,
  };
};

/**
 * The publish body.
 *
 * `blockOnWarnings` defaults to false — warnings ignored — which is the wrong
 * default for a project whose whole claim is that nothing fails quietly. It is
 * always sent, always true, and never a parameter, so there is no call site that
 * can forget it.
 */
export const publishBody = () => ({ blockOnWarnings: true });

/**
 * The service-account assertion's claim set.
 *
 * `now` is injected rather than read, so this is testable and so the caller owns
 * the one clock. `iat`/`exp` are seconds, and Google rejects a lifetime over an
 * hour.
 */
export const claimSet = ({ clientEmail, now, lifetimeSeconds = 3600 }) => {
  if (!clientEmail) throw new Error('claimSet: clientEmail is required');
  if (!Number.isFinite(now)) throw new Error('claimSet: now must be epoch seconds');
  if (lifetimeSeconds < 1 || lifetimeSeconds > 3600) {
    throw new Error(`claimSet: lifetime must be 1..3600 seconds, got ${lifetimeSeconds}`);
  }
  return {
    iss: clientEmail,
    scope: CWS_SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + lifetimeSeconds,
  };
};

/** The `header.payload` string a JWS signature is taken over. */
export const signingInput = (claims) =>
  `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}`;

/**
 * Reads the service-account JSON, failing loudly on the two fields that matter.
 *
 * A key file that parses but carries no `private_key` would otherwise produce a
 * signature over nothing and a 400 from Google that names neither.
 */
export const readServiceAccount = (json) => {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`service account credential is not JSON: ${error.message}`);
  }
  const { client_email: clientEmail, private_key: privateKey, type } = parsed;
  if (type && type !== 'service_account') {
    throw new Error(`service account credential has type "${type}", expected "service_account"`);
  }
  if (!clientEmail) throw new Error('service account credential has no client_email');
  if (!privateKey) throw new Error('service account credential has no private_key');
  return { clientEmail, privateKey };
};

/**
 * Upload states, and the reason this is a set rather than a comparison.
 *
 * The documentation spells the in-progress state two ways across pages
 * (`IN_PROGRESS` on the v2 UploadState type, `UPLOAD_IN_PROGRESS` in the prose
 * telling you to poll), and v1 used `SUCCESS`/`FAILURE` for the same field. None
 * of that has been observed against this item, so all the known spellings are
 * accepted and an unknown one is an error rather than a shrug.
 */
const UPLOAD_OK = new Set(['SUCCESS', 'UPLOAD_SUCCESS', 'COMPLETED']);
const UPLOAD_PENDING = new Set(['IN_PROGRESS', 'UPLOAD_IN_PROGRESS']);
const UPLOAD_FAILED = new Set(['FAILURE', 'UPLOAD_FAILURE', 'FAILED']);

/**
 * Turns an upload response into one of three verdicts, and never into a fourth.
 *
 * HTTP 200 is not success here. The store answers an upload with a body naming
 * an `uploadState`, and a signature it rejects is reported in that body rather
 * than in the status line — so a caller that checks only the status ships a
 * release believing it submitted something.
 */
export const interpretUpload = (body) => {
  const state = body?.uploadState;
  const detail = errorDetail(body);
  if (UPLOAD_OK.has(state)) return { verdict: 'uploaded', state };
  if (UPLOAD_PENDING.has(state)) return { verdict: 'pending', state };
  if (UPLOAD_FAILED.has(state)) {
    return {
      verdict: 'failed',
      state,
      reason: detail ?? 'the store rejected the upload and said no more',
    };
  }
  return {
    verdict: 'failed',
    state: state ?? '(absent)',
    reason:
      detail ??
      `unrecognised uploadState ${JSON.stringify(state)} — refusing to read it as success. ` +
        'Record what the store actually returned and widen the sets in scripts/lib/cws.mjs.',
  };
};

/**
 * Whether a new package may be uploaded at all.
 *
 * Nothing documents what a second upload does to an item already in review, so
 * this refuses instead of finding out during a release. `fetchStatus` is the
 * only way to ask.
 */
export const mayUpload = (status) => {
  const state = status?.itemState ?? status?.state;
  if (state === 'PENDING_REVIEW' || state === 'IN_REVIEW') {
    return {
      allowed: false,
      reason:
        `the item is ${state}: a previous submission has not finished review. ` +
        'Uploading over it is undocumented, so this refuses. Wait for the review, or cancel it in the dashboard.',
    };
  }
  return { allowed: true };
};

/**
 * The only reading of "this release reached the store".
 *
 * Both halves are load-bearing. The state alone would pass while the store held
 * a previous version; the version alone would pass while the submission sat in a
 * draft nobody submitted.
 */
export const interpretSubmission = (status, expectedVersion) => {
  const state = status?.itemState ?? status?.state ?? '(absent)';
  const version = status?.crxVersion ?? status?.version ?? '(absent)';
  if (version !== expectedVersion) {
    return {
      submitted: false,
      state,
      version,
      reason: `the store reports version ${version}, expected ${expectedVersion}`,
    };
  }
  if (state !== 'PENDING_REVIEW' && state !== 'IN_REVIEW') {
    return {
      submitted: false,
      state,
      version,
      reason: `version ${version} is on the item but its state is ${state}, not a review state`,
    };
  }
  return { submitted: true, state, version };
};

/** Google's error envelope, when there is one, flattened to a sentence. */
export const errorDetail = (body) => {
  const message = body?.error?.message ?? body?.error_description;
  const items = Array.isArray(body?.itemError)
    ? body.itemError.map((e) => e?.error_detail ?? e?.errorDetail).filter(Boolean)
    : [];
  const parts = [message, ...items].filter(Boolean);
  return parts.length > 0 ? parts.join('; ') : undefined;
};
