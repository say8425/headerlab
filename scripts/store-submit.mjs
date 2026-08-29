/**
 * Submits a signed CRX to the Chrome Web Store and waits until the store agrees
 * it is in review.
 *
 *   node scripts/store-submit.mjs <path/to/headerlab-<version>-chrome.crx>
 *
 * **This submits for review. It does not publish.** The store's own sentence is
 * "The item will be submitted for review and published when the item passes", so
 * the furthest this can get is a review state, and that is what the last step
 * asserts. Anything on this repository that claims a merge publishes the
 * extension is wrong.
 *
 * **Why this exists rather than a third-party action.** No new dependencies, and
 * the pieces are small: a signed claim set for a token, one upload, one publish,
 * one poll. Every decision it makes lives in `scripts/lib/cws.mjs`, pure and
 * unit-tested, because the failure this design most needs to avoid is reading a
 * rejection as a success — the store answers a bad signature in the response
 * *body* while the status line still says 200.
 *
 * Environment, all four required:
 *   CWS_SERVICE_ACCOUNT_JSON  the service account key, as JSON (not a path)
 *   CWS_PUBLISHER_ID          from Publisher > Settings in the dashboard
 *   CWS_EXPECTED_VERSION      the version the store must end up holding
 *   CWS_EXTENSION_ID          optional; defaults to the published item
 *
 * Exit codes: 0 submitted (or already submitted) · 1 refused or rejected.
 * Nothing here is retried automatically; the workflow that calls it is
 * re-runnable against an existing tag, which is the intended recovery — and
 * `mayUpload` knows the difference between "someone else's submission is in the
 * way" and "this exact version is already in review", so a retry after a
 * partial success reports success rather than deadlocking.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
  uploadStillRunning,
} from './lib/cws.mjs';

/** The published item. Public — it is in the store URL and in the README. */
const DEFAULT_EXTENSION_ID = 'kgapijlldieckifoenckgninnepafhnn';

/**
 * `die` throws; it does not call `process.exit`.
 *
 * Two reasons, and the second is the one that bit this repository before.
 * Throwing keeps "this does not continue" true for the reader *and* for the
 * control-flow analyser, so `need()` returning a value after a `die` is not a
 * thing anyone has to reason about. And `process.exit()` abandons pending
 * stdout writes when stdout is a pipe — which it always is under Actions — so
 * exiting immediately after printing a large response body can truncate exactly
 * the bytes this script exists to record. `pack-crx.mjs` carries the same
 * lesson from the other direction, where `process.exit` skipped a `finally`.
 */
class SubmitError extends Error {}
const die = (message) => {
  throw new SubmitError(message);
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
  return `${input}.${signer.sign(privateKey).toString('base64url')}`;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/**
 * Waits for the store to stop calling the *upload* in progress.
 *
 * A status response reports the upload under `lastAsyncUploadState`, not
 * `uploadState` — that second name belongs to the upload response, and reading
 * for it here is what made an earlier version of this loop return on its first
 * pass every time. The field is "only set when there has been an async upload
 * for the item in the past 24 hours", so absent means nothing is in flight and
 * ends the wait rather than failing.
 */
const awaitUpload = async (url, token, attempts = 10, delayMs = 6000) => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (!uploadStillRunning(await fetchStatus(url, token))) return;
    console.log(`store-submit: still processing (${attempt}/${attempts})`);
    await sleep(delayMs);
  }
  die('the store never stopped reporting the upload as in progress');
};

/**
 * Waits for the item itself to hold the released version in a review state.
 *
 * This is the assertion the whole script exists to make, and it polls because
 * `:publish` returning 200 is not the same as the item having moved. An earlier
 * version read this condition with `interpretUpload` — a category error, since
 * that reads an *upload* response and the thing being waited for is an *item*
 * state, so the loop returned on its first pass every time and the poll was
 * decoration.
 */
const awaitSubmission = async (url, token, expectedVersion, attempts = 10, delayMs = 6000) => {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = interpretSubmission(await fetchStatus(url, token), expectedVersion);
    if (last.submitted) return last;
    console.log(`store-submit: not there yet (${attempt}/${attempts}): ${last.reason}`);
    if (attempt < attempts) await sleep(delayMs);
  }
  die(`the store did not accept ${expectedVersion} for review: ${last.reason}`);
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
  if (bytes.length === 0) die(`${crxPath} is empty`);

  const version = need('CWS_EXPECTED_VERSION');
  const api = endpoints({
    publisherId: need('CWS_PUBLISHER_ID'),
    extensionId: process.env.CWS_EXTENSION_ID?.trim() || DEFAULT_EXTENSION_ID,
  });
  const token = await accessToken(need('CWS_SERVICE_ACCOUNT_JSON'));

  // 1. Ask what the item is doing before touching it. A review in progress is
  //    an undocumented thing to upload over; an unrecognised state is one this
  //    cannot rule that out for, so both refuse.
  const gate = mayUpload(await fetchStatus(api.fetchStatus, token), version);
  if (gate.alreadySubmitted) {
    console.log(`store-submit: ${gate.reason} Nothing to do.`);
    return;
  }
  if (!gate.allowed) die(gate.reason);

  // 2. Upload. The two headers are what make this a verified CRX upload rather
  //    than a zip the store would refuse outright.
  const uploadResponse = await fetch(api.upload, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      ...uploadHeaders(path.basename(crxPath)),
    },
    body: bytes,
  });
  const uploaded = await asJson(uploadResponse);
  report('upload', uploadResponse, uploaded);
  const verdict = interpretUpload(uploaded);
  if (verdict.verdict === 'failed') die(`upload rejected (${verdict.state}): ${verdict.reason}`);
  if (verdict.verdict === 'pending') await awaitUpload(api.fetchStatus, token);

  // 3. Publish — which submits for review. `blockOnWarnings` is always true.
  const publishResponse = await fetch(api.publish, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(publishBody()),
  });
  const published = await asJson(publishResponse);
  report('publish', publishResponse, published);
  if (!publishResponse.ok) {
    die(errorDetail(published) ?? `publish failed with HTTP ${publishResponse.status}`);
  }

  // 4. HTTP 200 on publish is not evidence. Ask the item what it now holds.
  const submission = await awaitSubmission(api.fetchStatus, token, version);
  console.log(
    `store-submit: ${version} is ${submission.state}. Review is Google's; nothing else to do here.`,
  );
};

try {
  await main();
} catch (error) {
  console.error(`store-submit: ${error instanceof SubmitError ? error.message : error.stack}`);
  // Not `process.exit`: it abandons pending stdout writes, and everything above
  // printed the store's own responses on the way here.
  process.exitCode = 1;
}
