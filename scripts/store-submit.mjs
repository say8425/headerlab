/**
 * Submits a signed CRX to the Chrome Web Store and waits until the store agrees
 * it is in review.
 *
 *   node scripts/store-submit.mjs <path/to/headerlab-<version>-chrome.crx>
 *
 * **This submits for review. It does not publish.** The store's own sentence is
 * "The item will be submitted for review and published when the item passes", so
 * the furthest this can get is `PENDING_REVIEW`, and that is what step 5 asserts.
 * Anything on this repository that claims a merge publishes the extension is
 * wrong.
 *
 * **Why this exists rather than a third-party action.** No new dependencies, and
 * the pieces are small: a signed claim set for a token, one PUT-shaped POST, one
 * publish, one poll. Every decision it makes lives in `scripts/lib/cws.mjs`,
 * pure and unit-tested, because the failure this design most needs to avoid is
 * reading a rejection as a success — the store answers a bad signature in the
 * response *body* while the status line still says 200.
 *
 * Environment:
 *   CWS_SERVICE_ACCOUNT_JSON  the service account key, as JSON (not a path)
 *   CWS_PUBLISHER_ID          from Publisher > Settings in the dashboard
 *   CWS_EXTENSION_ID          defaults to the published item
 *
 * Exit codes: 0 submitted · 1 refused or rejected. Nothing here is retried
 * automatically; the workflow that calls it is re-runnable against an existing
 * tag, which is the intended recovery.
 */
import { createSign } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  claimSet,
  endpoints,
  errorDetail,
  interpretSubmission,
  interpretUpload,
  JWT_BEARER_GRANT,
  mayUpload,
  publishBody,
  readServiceAccount,
  signingInput,
  TOKEN_ENDPOINT,
  uploadHeaders,
} from './lib/cws.mjs';

/** The published item. Public — it is in the store URL and in the README. */
const DEFAULT_EXTENSION_ID = 'kgapijlldieckifoenckgninnepafhnn';

const die = (message) => {
  console.error(`store-submit: ${message}`);
  process.exit(1);
};

const need = (name) => {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    // An absent GitHub secret dereferences to an empty string rather than
    // failing, so "missing" and "set to nothing" are the same case and both
    // have to be caught here rather than by whatever consumes the value.
    die(`${name} is empty. An unset secret reaches this script as "", not as an error.`);
  }
  return value;
};

/** RS256 over `header.payload`, which is the whole of a service-account assertion. */
const assertion = (privateKey, claims) => {
  const input = signingInput(claims);
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  const signature = signer.sign(privateKey).toString('base64url');
  return `${input}.${signature}`;
};

const asJson = async (response) => {
  const text = await response.text();
  try {
    return text === '' ? {} : JSON.parse(text);
  } catch {
    return { _raw: text };
  }
};

/**
 * Every response is logged whole before it is interpreted.
 *
 * The v2 API documents no error responses at all, and v1's `itemError[]` retires
 * with it, so the only error documentation that will ever exist for this item is
 * what a real run prints. Losing it to a tidy log would mean re-learning it on
 * the next failure.
 */
const report = (label, response, body) => {
  console.log(`store-submit: ${label} → HTTP ${response.status}`);
  console.log(JSON.stringify(body, null, 2));
};

const accessToken = async (credential) => {
  const { clientEmail, privateKey } = readServiceAccount(credential);
  const now = Math.floor(Date.now() / 1000);
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: JWT_BEARER_GRANT,
      assertion: assertion(privateKey, claimSet({ clientEmail, now })),
    }),
  });
  const body = await asJson(response);
  if (!response.ok || !body.access_token) {
    report('token', response, body);
    die(errorDetail(body) ?? 'could not exchange the service account assertion for a token');
  }
  console.log(`store-submit: token acquired for ${clientEmail}`);
  return body.access_token;
};

const fetchStatus = async (url, token) => {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await asJson(response);
  report('fetchStatus', response, body);
  if (!response.ok) die(errorDetail(body) ?? `fetchStatus failed with HTTP ${response.status}`);
  return body;
};

const main = async () => {
  const crxPath = process.argv[2];
  if (!crxPath) die('usage: node scripts/store-submit.mjs <path/to/*.crx>');
  if (!crxPath.endsWith('.crx')) die(`this item takes a signed CRX; ${crxPath} is not one`);
  let bytes;
  try {
    bytes = readFileSync(crxPath);
  } catch (error) {
    die(`cannot read ${crxPath}: ${error.message}`);
  }
  if (statSync(crxPath).size === 0) die(`${crxPath} is empty`);

  const version = need('CWS_EXPECTED_VERSION');
  const api = endpoints({
    publisherId: need('CWS_PUBLISHER_ID'),
    extensionId: process.env.CWS_EXTENSION_ID?.trim() || DEFAULT_EXTENSION_ID,
  });
  const token = await accessToken(need('CWS_SERVICE_ACCOUNT_JSON'));

  // 1. Refuse to upload over a submission that is still in review. Nothing
  //    documents what the store does in that case, and a release is the wrong
  //    place to find out.
  const before = await fetchStatus(api.fetchStatus, token);
  const gate = mayUpload(before);
  if (!gate.allowed) die(gate.reason);

  // 2. Upload. The two headers are what make this a verified CRX upload rather
  //    than a zip the store would refuse outright.
  const fileName = path.basename(crxPath);
  const uploadResponse = await fetch(api.upload, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      ...uploadHeaders(fileName),
    },
    body: bytes,
  });
  const uploaded = await asJson(uploadResponse);
  report('upload', uploadResponse, uploaded);
  const verdict = interpretUpload(uploaded);
  if (verdict.verdict === 'failed') die(`upload rejected (${verdict.state}): ${verdict.reason}`);
  if (verdict.verdict === 'pending') {
    console.log('store-submit: the store is still processing the package; polling before publish');
    await settle(api.fetchStatus, token);
  }

  // 3. Publish — which submits for review. `blockOnWarnings` is always true.
  const publishResponse = await fetch(api.publish, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(publishBody()),
  });
  const published = await asJson(publishResponse);
  report('publish', publishResponse, published);
  if (!publishResponse.ok)
    die(errorDetail(published) ?? `publish failed with HTTP ${publishResponse.status}`);

  // 4. HTTP 200 on publish is not evidence. Ask the store what it now holds.
  const after = await settle(api.fetchStatus, token);
  const submission = interpretSubmission(after, version);
  if (!submission.submitted)
    die(`the store did not accept ${version} for review: ${submission.reason}`);

  console.log(
    `store-submit: ${version} is ${submission.state}. Review is Google's; nothing else to do here.`,
  );
};

/** Polls until the store stops saying it is busy, or gives up loudly. */
const settle = async (url, token, attempts = 10, delayMs = 6000) => {
  let body = {};
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    body = await fetchStatus(url, token);
    const state = interpretUpload(body);
    if (state.verdict !== 'pending') return body;
    console.log(`store-submit: still processing (${attempt}/${attempts})`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  die('the store never stopped reporting the upload as in progress');
  return body;
};

await main();
