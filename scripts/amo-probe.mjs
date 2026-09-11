/**
 * Asks Firefox Add-ons what it holds for this extension, and prints the
 * answer. Reads only — uploads nothing, changes nothing.
 *
 *   pnpm amo:probe
 *
 * Credentials as in `amo-submit.mjs`: `FIREFOX_JWT_ISSUER`/`FIREFOX_JWT_SECRET`
 * from the environment, else 1Password. The JWT helper and the `op read` are
 * repeated here rather than shared, on purpose and for the same reason
 * `store-probe.mjs` repeats the token exchange: the *decisions* are shared and
 * unit-tested in `lib/amo.mjs`, and this file has to be readable on its own by
 * someone deciding whether it is safe to run against a live listing. What is
 * duplicated is one header, not a predicate.
 *
 * **Why this exists.** `readSignedFile` reads `channel`, `file.status`,
 * `file.url` and `file.hash` off a version-detail response, and those names
 * come from the API documentation rather than from a response this
 * repository has seen. Run this after the first submission and compare what
 * it prints against what the unlisted path expects, before the first unlisted
 * release relies on it.
 */
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import {
  AMO_ORIGIN,
  claimSet,
  endpoints,
  GECKO_ID,
  issuerLooksValid,
  readSignedFile,
  signingInput,
  trustedAmoUrl,
} from './lib/amo.mjs';

const OP_ISSUER = 'op://Personal/Firefox AMO Token/username';
const OP_SECRET = 'op://Personal/Firefox AMO Token/password';

const readOp = (reference) => {
  try {
    return execFileSync('op', ['read', reference], {
      maxBuffer: 1 << 20,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  } catch {
    throw new Error(
      `could not read ${reference} from 1Password\n` +
        '  Sign in with `op signin`, or set FIREFOX_JWT_ISSUER and FIREFOX_JWT_SECRET.',
    );
  }
};

const credentials = () => {
  if (
    (process.env.CI ||
      process.env.FIREFOX_JWT_ISSUER !== undefined ||
      process.env.FIREFOX_JWT_SECRET !== undefined) &&
    (!process.env.FIREFOX_JWT_ISSUER?.trim() || !process.env.FIREFOX_JWT_SECRET?.trim())
  ) {
    throw new Error(
      'Set both FIREFOX_JWT_ISSUER and FIREFOX_JWT_SECRET; refusing partial credentials or CI vault fallback',
    );
  }
  const issuer = process.env.FIREFOX_JWT_ISSUER?.trim() || readOp(OP_ISSUER);
  const secret = process.env.FIREFOX_JWT_SECRET?.trim() || readOp(OP_SECRET);
  if (!issuerLooksValid(issuer)) {
    throw new Error('FIREFOX_JWT_ISSUER does not look like an AMO API key (user:<id>:<key>)');
  }
  if (!secret) throw new Error('FIREFOX_JWT_SECRET is empty');
  return { issuer, secret };
};

const token = ({ issuer, secret }) => {
  const input = signingInput(
    claimSet({ issuer, now: Math.floor(Date.now() / 1000), jti: randomUUID() }),
  );
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
};

const get = async (url, creds) => {
  const response = await fetch(trustedAmoUrl(url), {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `JWT ${token(creds)}` },
  });
  const body = await response.json().catch(() => ({}));
  console.log(`GET ${url.replace(AMO_ORIGIN, '')} → HTTP ${response.status}`);
  return { response, body };
};

const main = async () => {
  const creds = credentials();
  const api = endpoints(GECKO_ID);

  const addon = await get(api.addon, creds);
  if (addon.response.status === 404) {
    console.log('AMO returned no accessible add-on.');
    console.log(
      '\namo-probe: the add-on does not exist on AMO yet. The first submission is by\n' +
        '  hand — docs/store/amo/checklist.md — and nothing in this repository creates it.',
    );
    process.exitCode = 1;
    return;
  }
  if (!addon.response.ok) {
    console.log('AMO add-on request failed.');
    process.exitCode = 1;
    return;
  }
  const a = addon.body;
  console.log(`  status:    ${a.status}   slug: ${a.slug}   guid: ${a.guid}`);
  console.log(
    `  listed:    ${a.current_version?.version ?? '(none)'}   unlisted: ${a.latest_unlisted_version?.version ?? '(none)'}`,
  );

  const versions = await get(`${api.versions('all_with_unlisted')}&page_size=5`, creds);
  if (!versions.response.ok) {
    console.log('AMO versions request failed.');
    process.exitCode = 1;
    return;
  }
  console.log('\n--- what the unlisted path would read, per version ---');
  for (const v of versions.body.results ?? []) {
    const verdict = readSignedFile(v, { channel: v.channel });
    const detail = verdict.kind === 'refused' ? ` (${verdict.reason})` : '';
    console.log(
      `  ${v.version}  ${v.channel}  file: ${v.file?.status ?? '(none)'}  created: ${v.file?.created ?? '?'}  → ${verdict.kind}${detail}`,
    );
  }
  console.log(
    '\n  `ready` is what amo-submit.mjs downloads; `refused` on a version AMO shows as\n' +
      '  signed means scripts/lib/amo.mjs no longer matches the API. Inspect the fields\n' +
      '  above before the first unlisted release.',
  );
};

try {
  await main();
} catch (error) {
  console.error(`amo-probe: ${error.message}`);
  process.exitCode = 1;
}
