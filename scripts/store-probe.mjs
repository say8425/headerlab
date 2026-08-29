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
  JWT_BEARER_GRANT,
  mayUpload,
  publishedRevision,
  readServiceAccount,
  submittedRevision,
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
  const published = publishedRevision(body);
  const submitted = submittedRevision(body);
  const gate = mayUpload(body, '0.0.0-probe');
  console.log('\n--- what the release path reads ---');
  console.log(`  keys present:  ${Object.keys(body).join(', ') || '(none)'}`);
  console.log(
    `  published:     ${published.present ? `${published.state} @ ${published.version}` : '(none)'}`,
  );
  console.log(
    `  submitted:     ${submitted.present ? `${submitted.state} @ ${submitted.version}` : '(none)'}`,
  );
  console.log(`  last upload:   ${body.lastAsyncUploadState ?? '(none in the past 24h)'}`);
  console.log(`  takenDown:     ${body.takenDown ?? false}   warned: ${body.warned ?? false}`);
  console.log(`\n  mayUpload:     ${gate.allowed ? 'ALLOWED' : `REFUSED — ${gate.reason}`}`);

  if (!published.present && !submitted.present) {
    console.log(
      '\nstore-probe: neither revision was found. Either this item has never been\n' +
        '  published and never submitted, or the field names in scripts/lib/cws.mjs\n' +
        '  no longer match the API. Read the JSON above before releasing.',
    );
  } else if (gate.allowed) {
    console.log('\nstore-probe: a release would proceed from here.');
  } else {
    console.log(
      '\nstore-probe: a release would refuse before uploading, for the reason above.\n' +
        '  If that state is an ordinary one to upload over, widen the state sets in\n' +
        '  scripts/lib/cws.mjs.',
    );
  }
};

try {
  await main();
} catch (error) {
  die(error.message);
}
