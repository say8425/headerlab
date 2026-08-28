/**
 * Asks the Chrome Web Store what it thinks this item's state is, and prints the
 * answer. Reads only — it uploads nothing, publishes nothing, changes nothing.
 *
 *   CWS_SERVICE_ACCOUNT_JSON="$(cat key.json)" CWS_PUBLISHER_ID=… \
 *     node scripts/store-probe.mjs
 *
 * **Why this exists.** `scripts/lib/cws.mjs` decides three things from a
 * `fetchStatus` body — whether uploading is allowed, whether a submission
 * landed, and when to stop polling — and the field names it reads (`itemState`,
 * `crxVersion`) are an inference. The v2 page documents the endpoint and not the
 * response; that module's own docblock says so. If the inference is wrong all
 * three misbehave at once, and the first time anyone would find out is during a
 * release, after the tag is cut.
 *
 * One read settles it. Run this before the first release that uses the automated
 * path, compare what it prints against `UPLOADABLE_STATES`, and widen that set
 * from a real response rather than from a guess.
 *
 * The token exchange below repeats `store-submit.mjs`'s. That is deliberate: the
 * *decisions* are shared and unit-tested in `lib/cws.mjs`, and this file needs to
 * be readable on its own by someone deciding whether it is safe to run against a
 * live listing. What is duplicated is one HTTP call, not a predicate.
 */
import { createSign } from 'node:crypto';
import {
  claimSet,
  endpoints,
  errorDetail,
  interpretSubmission,
  JWT_BEARER_GRANT,
  mayUpload,
  readServiceAccount,
  signingInput,
  TOKEN_ENDPOINT,
} from './lib/cws.mjs';

const DEFAULT_EXTENSION_ID = 'kgapijlldieckifoenckgninnepafhnn';

const die = (message) => {
  console.error(`store-probe: ${message}`);
  process.exitCode = 1;
};

const need = (name) => {
  const value = process.env[name];
  if (!value || value.trim() === '') throw new Error(`${name} is empty`);
  return value;
};

const main = async () => {
  const { clientEmail, privateKey } = readServiceAccount(need('CWS_SERVICE_ACCOUNT_JSON'));
  const api = endpoints({
    publisherId: need('CWS_PUBLISHER_ID'),
    extensionId: process.env.CWS_EXTENSION_ID?.trim() || DEFAULT_EXTENSION_ID,
  });

  const now = Math.floor(Date.now() / 1000);
  const input = signingInput(claimSet({ clientEmail, now }));
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: JWT_BEARER_GRANT,
      assertion: `${input}.${signer.sign(privateKey).toString('base64url')}`,
    }),
  });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || !token.access_token) {
    console.error(JSON.stringify(token, null, 2));
    throw new Error(
      errorDetail(token) ?? `token exchange failed with HTTP ${tokenResponse.status}`,
    );
  }
  console.log(`store-probe: token acquired for ${clientEmail}\n`);

  const response = await fetch(api.fetchStatus, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const body = await response.json().catch(() => ({}));

  console.log(`GET :fetchStatus → HTTP ${response.status}`);
  console.log(JSON.stringify(body, null, 2));
  if (!response.ok) throw new Error(errorDetail(body) ?? 'fetchStatus failed');

  // What the release path would conclude from exactly these bytes. This is the
  // whole point of the probe: not the response, but what `lib/cws.mjs` makes of it.
  const gate = mayUpload(body, '0.0.0-probe');
  const submission = interpretSubmission(body, '0.0.0-probe');
  console.log('\n--- what the release path would do with that ---');
  console.log(`  keys present:   ${Object.keys(body).join(', ') || '(none)'}`);
  console.log(`  state read as:  ${submission.state}`);
  console.log(`  version read as:${submission.version}`);
  console.log(`  mayUpload:      ${gate.allowed ? 'allowed' : `REFUSED — ${gate.reason}`}`);

  if (!gate.allowed && !gate.alreadySubmitted && submission.state === '(absent)') {
    console.log(
      '\nstore-probe: the state field was not found under `itemState` or `state`.\n' +
        '  That is the inference this probe exists to test, and it is wrong.\n' +
        '  Read the JSON above, then fix the field names and UPLOADABLE_STATES in\n' +
        '  scripts/lib/cws.mjs before releasing.',
    );
  } else if (!gate.allowed && !gate.alreadySubmitted) {
    console.log(
      `\nstore-probe: the state is read correctly but ${JSON.stringify(submission.state)} is not in\n` +
        '  UPLOADABLE_STATES, so a release would refuse before uploading. Add it in\n' +
        '  scripts/lib/cws.mjs if it is an ordinary, not-in-review state.',
    );
  } else {
    console.log('\nstore-probe: a release would proceed from this state.');
  }
};

try {
  await main();
} catch (error) {
  die(error.message);
}
