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
 * `UploadState`, from the v2 enum page, verbatim: `UPLOAD_STATE_UNSPECIFIED`,
 * `SUCCEEDED`, `IN_PROGRESS`, `FAILED`, `NOT_FOUND`.
 *
 * An earlier version of this file guessed `SUCCESS`, `UPLOAD_SUCCESS`,
 * `COMPLETED`, `FAILURE` and `UPLOAD_FAILURE` — every one of them wrong, and
 * `SUCCEEDED` absent — so a successful upload would have been read as an
 * unrecognised state and refused. `pnpm store:probe` is what caught it.
 *
 * `UPLOAD_IN_PROGRESS` is kept beside `IN_PROGRESS` because the API's own pages
 * disagree: `media.upload`'s field docs say "If uploadState is
 * `UPLOAD_IN_PROGRESS`" while the `UploadState` enum lists `IN_PROGRESS`. One of
 * them is wrong and neither has been seen in a real upload response, so both are
 * accepted rather than a side being picked.
 *
 * `NOT_FOUND` and `UPLOAD_STATE_UNSPECIFIED` belong to `lastAsyncUploadState` on
 * a status response rather than to an upload response, and are handled where
 * that field is read.
 */
const UPLOAD_OK = new Set(['SUCCEEDED']);
const UPLOAD_PENDING = new Set(['IN_PROGRESS', 'UPLOAD_IN_PROGRESS']);
const UPLOAD_FAILED = new Set(['FAILED']);

/**
 * Whether a status response says an upload is still being processed.
 *
 * Separate from `interpretUpload` because it reads a different field of a
 * different response: `fetchStatus` reports the upload under
 * `lastAsyncUploadState`, and "Only set when there has been an async upload for
 * the item in the past 24 hours" — so absent is ordinary and means nothing is in
 * flight. Conflating the two is what made an earlier `settle()` return on its
 * first pass every time.
 */
export const uploadStillRunning = (status) => UPLOAD_PENDING.has(status?.lastAsyncUploadState);

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
 * `ItemState`, from the v2 enum page, verbatim and complete:
 * `ITEM_STATE_UNSPECIFIED`, `PENDING_REVIEW`, `STAGED`, `PUBLISHED`,
 * `PUBLISHED_TO_TESTERS`, `REJECTED`, `CANCELLED`.
 *
 * Two of these decide whether a submission is still in Google's hands.
 * `PENDING_REVIEW` is "pending review"; `STAGED` is "approved and ready to be
 * published", which is still a revision nobody should upload over. There is no
 * `IN_REVIEW` — an earlier version of this file invented it.
 */
const OPEN_SUBMISSION_STATES = new Set(['PENDING_REVIEW', 'STAGED']);

/**
 * Where the state actually lives, which is not where this file first guessed.
 *
 * A `fetchStatus` body carries two revisions, either of which may be unset:
 * `publishedItemRevisionStatus` ("the current published revision … unset if the
 * item is not published") and `submittedItemRevisionStatus` ("the item revision
 * submitted to be published … unset if the item has not been submitted for
 * publishing since the last successful publish"). Each is
 * `{ state, distributionChannels: [{ deployPercentage, crxVersion }] }`.
 *
 * There is no top-level `itemState` and no top-level `crxVersion`. Reading for
 * them returned nothing at all, which `mayUpload` correctly refused on and
 * `interpretSubmission` would have failed every release with. Measured against
 * the live listing with `pnpm store:probe`.
 *
 * **The submitted revision is the one that matters here.** After `:publish` the
 * new version becomes the *submitted* revision while the published one still
 * holds the previous version, so a release that asked the published revision
 * whether its version had landed would wait for something that only happens days
 * later, when review passes.
 */
const revision = (status, which) => {
  const node = status?.[which];
  const channels = Array.isArray(node?.distributionChannels) ? node.distributionChannels : [];
  const withVersion = channels.find((channel) => channel?.crxVersion);
  return {
    present: Boolean(node),
    state: node?.state ?? '(absent)',
    version: withVersion?.crxVersion ?? '(absent)',
  };
};

/** The revision awaiting publication, if there is one. */
export const submittedRevision = (status) => revision(status, 'submittedItemRevisionStatus');

/** The revision currently public, if the item is published. */
export const publishedRevision = (status) => revision(status, 'publishedItemRevisionStatus');

/**
 * Whether a new package may be uploaded at all, and whether it already was.
 *
 * Three answers, not two. `alreadySubmitted` exists because without it the
 * retry path eats itself: the tag is cut before the store step runs, so the
 * documented recovery is re-running the workflow against the same tag — and if
 * the first attempt actually submitted before dying for some later reason, a
 * plain refusal on `PENDING_REVIEW` would block every retry forever. Asking
 * whether the item already holds *this* version separates "someone else's
 * submission is in the way" from "this one is already done".
 *
 * Unknown states refuse. Nothing documents what a second upload does to an item
 * in review, so a state this file cannot name is one it cannot rule that out
 * for. The refusal prints what the store actually said; widen the set above
 * from that rather than from a guess.
 */
export const mayUpload = (status, expectedVersion) => {
  if (status?.takenDown === true) {
    return {
      allowed: false,
      state: 'TAKEN_DOWN',
      version: '(absent)',
      reason:
        'the item has been taken down for a policy violation. Uploading will not fix that; ' +
        'read the developer dashboard first.',
    };
  }
  const submitted = submittedRevision(status);
  if (!submitted.present) {
    // Nothing has been submitted since the last successful publish, which is the
    // ordinary state of an item between releases.
    return { allowed: true, state: publishedRevision(status).state, version: '(absent)' };
  }
  const { state, version } = submitted;
  if (OPEN_SUBMISSION_STATES.has(state)) {
    if (expectedVersion !== undefined && version === expectedVersion) {
      return {
        allowed: false,
        alreadySubmitted: true,
        state,
        version,
        reason: `version ${version} is already ${state}: a previous run submitted it.`,
      };
    }
    return {
      allowed: false,
      state,
      version,
      reason:
        `a submitted revision is ${state} holding version ${version}. Uploading over a revision ` +
        'awaiting review or publication is undocumented, so this refuses. Wait for it, or cancel ' +
        'it in the dashboard.',
    };
  }
  // REJECTED and CANCELLED are settled: the submitted revision is not going
  // anywhere and a new upload replaces it. Anything else is a state this file
  // cannot name, and an unnameable state is one it cannot rule an open
  // submission out for.
  if (state === 'REJECTED' || state === 'CANCELLED') return { allowed: true, state, version };
  return {
    allowed: false,
    state,
    version,
    reason:
      `unrecognised submitted-revision state ${JSON.stringify(state)} — refusing rather than ` +
      'uploading over something this cannot name. Record what the store returned and widen ' +
      'the state sets in scripts/lib/cws.mjs.',
  };
};

/**
 * The only reading of "this release reached the store".
 *
 * Both halves are load-bearing. The state alone would pass while the store held
 * a previous version; the version alone would pass while the submission sat in a
 * draft nobody submitted.
 */
export const interpretSubmission = (status, expectedVersion) => {
  const { present, state, version } = submittedRevision(status);
  if (!present) {
    return {
      submitted: false,
      state,
      version,
      reason: 'the item has no submitted revision at all — nothing was accepted for review',
    };
  }
  if (version !== expectedVersion) {
    return {
      submitted: false,
      state,
      version,
      reason: `the submitted revision is version ${version}, expected ${expectedVersion}`,
    };
  }
  if (!OPEN_SUBMISSION_STATES.has(state)) {
    return {
      submitted: false,
      state,
      version,
      reason: `version ${version} was submitted but its state is ${state}, not one awaiting review`,
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
