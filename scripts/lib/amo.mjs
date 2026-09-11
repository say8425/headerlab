/**
 * Firefox Add-ons (AMO) — the decisions, without the requests.
 *
 * Everything here is pure: names, endpoints, a JWT claim set, and readers that
 * turn an AMO response or an archive's manifest into a verdict.
 * `scripts/amo-submit.mjs` and `scripts/amo-probe.mjs` do the I/O. Same split
 * as `scripts/lib/cws.mjs` beside it, and for the same reason — the parts that
 * can be wrong in a way nobody notices are the parts that decide what a
 * response *means*, and those are the parts a test can reach without a
 * network, a key, or a listing.
 *
 * `wxt submit` (publish-browser-extension 5.1.0, a dependency of wxt) does the
 * upload itself: get the add-on, upload the zip, poll validation, create the
 * version with the sources archive attached. What it does not do, and what this
 * module decides for, is (1) whether the archive on disk is the version being
 * submitted — `pack-crx.mjs` makes the same check for the same reason — and
 * (2) whether an unlisted version's file is signed yet and safe to download.
 *
 * **The JWT.** AMO authenticates API calls with `Authorization: JWT <token>`:
 * HS256 over `{ iss, jti, iat, exp }`, where `iss` is the API key, `jti` a
 * nonce, and `exp` "must be no longer than five minutes past the issued at
 * time" (addons-server, topics/api/auth). The claim set is assembled here so a
 * test can pin it; `node:crypto` signs it in the caller.
 */

import { delimiter } from 'node:path';

export const AMO_ORIGIN = 'https://addons.mozilla.org';

/** The gecko id. Public — it is in the manifest and in the README. */
export const GECKO_ID = 'headerlab@say8425.github.io';

/** The two channels an upload can name. `enterprise` exists and is not ours. */
export const CHANNELS = ['listed', 'unlisted'];

/** AMO's own cap on a token's life. A longer one is refused with a bare 401. */
export const MAX_JWT_LIFETIME_SECONDS = 300;

/** Base64url, no padding — what JWS wants. Node's own encoding, named. */
export const base64url = (input) => Buffer.from(input).toString('base64url');

/**
 * The three files a version produces. The first two are what `wxt zip -b
 * firefox` writes (its `artifactTemplate` and `sourcesTemplate` defaults); the
 * third is what the unlisted path writes after AMO signs.
 */
export const archiveNames = (version) => {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
    throw new Error(`archiveNames: not a three-part version: ${JSON.stringify(version)}`);
  }
  return {
    extension: `headerlab-${version}-firefox.zip`,
    sources: `headerlab-${version}-sources.zip`,
    signed: `headerlab-${version}-firefox.xpi`,
  };
};

/**
 * AMO's API keys read `user:<user id>:<key id>`. The workflow refuses to start
 * on anything else, because an absent secret arrives as `""` and would
 * otherwise reach `wxt submit` after the checkout and the install.
 */
export const issuerLooksValid = (issuer) => /^user:\d+:\d+$/.test(issuer ?? '');

export const claimSet = ({ issuer, now, jti, lifetimeSeconds = 60 }) => {
  if (!issuerLooksValid(issuer)) {
    throw new Error('claimSet: issuer does not look like an AMO API key (user:<id>:<key>)');
  }
  if (typeof jti !== 'string' || !jti) throw new Error('claimSet: jti (a nonce) is required');
  if (!Number.isInteger(now)) throw new Error('claimSet: now must be an integer epoch second');
  if (
    !(
      Number.isInteger(lifetimeSeconds) &&
      lifetimeSeconds > 0 &&
      lifetimeSeconds <= MAX_JWT_LIFETIME_SECONDS
    )
  ) {
    throw new Error(
      `claimSet: lifetime must be between 1 and ${MAX_JWT_LIFETIME_SECONDS} seconds, got ${lifetimeSeconds}`,
    );
  }
  return { iss: issuer, jti, iat: now, exp: now + lifetimeSeconds };
};

/** `header.payload`, which is the whole of what HMAC signs. */
export const signingInput = (claims) =>
  `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}`;

/**
 * The three endpoints this repository reads. The id goes into the path raw —
 * `@` included — which is how publish-browser-extension addresses the same
 * endpoints and what the API accepts.
 */
export const endpoints = (id) => {
  if (!id) throw new Error('endpoints: id is required');
  const addon = `${AMO_ORIGIN}/api/v5/addons/addon/${id}/`;
  return {
    addon,
    versions: (filter) => `${addon}versions/${filter ? `?filter=${filter}` : ''}`,
    version: (number) => `${addon}versions/${number}/`,
  };
};

/** `file.hash` is `sha256:<hex>`. Anything else is a schema drift, not a hash. */
export const parseHash = (hash) => {
  const match = /^([a-z0-9]+):([0-9a-f]+)$/i.exec(hash ?? '');
  if (!match) throw new Error(`parseHash: not an <algorithm>:<hex> hash: ${JSON.stringify(hash)}`);
  const [, algorithm, hex] = match;
  if (algorithm.toLowerCase() !== 'sha256') {
    throw new Error(`parseHash: expected sha256, got ${algorithm}`);
  }
  if (hex.length !== 64)
    throw new Error('parseHash: sha256 hash must contain 64 hexadecimal digits');
  return { algorithm: 'sha256', hex: hex.toLowerCase() };
};

/**
 * What a version-detail response means for the unlisted path.
 *
 * The API documents three file states — `public` (Approved), `unreviewed`
 * (Awaiting Review), `disabled` (Rejected, disabled, or not reviewed) — and this
 * refuses a fourth rather than reading it as either. Fail-closed, like
 * `UPLOADABLE_STATES` in cws.mjs: an unrecognised value is a schema drift, and
 * the one place it must not be silently absorbed is the loop that decides
 * whether to keep waiting.
 */
export const readSignedFile = (version, { channel }) => {
  if (!version || typeof version !== 'object') {
    return { kind: 'refused', reason: 'no version object in the response' };
  }
  if (version.channel !== channel) {
    return {
      kind: 'refused',
      reason: `version ${version.version ?? '?'} is on the ${version.channel ?? 'unknown'} channel, not ${channel}`,
    };
  }
  const file = version.file;
  if (!file || typeof file !== 'object') {
    return { kind: 'refused', reason: 'the version carries no file object' };
  }
  const status = file.status;
  if (status === 'public') {
    if (typeof file.url !== 'string' || file.url === '') {
      return { kind: 'refused', reason: 'the file is public but carries no url' };
    }
    if (typeof file.hash !== 'string' || file.hash === '') {
      return { kind: 'refused', reason: 'the file is public but carries no hash' };
    }
    return { kind: 'ready', url: file.url, hash: file.hash };
  }
  if (status === 'unreviewed') return { kind: 'wait', status };
  if (status === 'disabled') {
    return { kind: 'refused', reason: 'the file is disabled: rejected, disabled, or not reviewed' };
  }
  return {
    kind: 'refused',
    reason: `unrecognised file status ${JSON.stringify(status)} — the API documents public, unreviewed and disabled`,
  };
};

/**
 * Whether the archive on disk is the version being submitted.
 *
 * The archive is an argument (or a release download) and the version is an
 * input; taking the bytes from one and the name from the other is how a 1.8.0
 * package gets submitted as 1.9.0 with nothing failing. Empty means "matches".
 */
export const manifestMatches = (manifest, { version, geckoId }) => {
  const problems = [];
  const actualVersion = manifest?.version;
  if (actualVersion !== version) {
    problems.push(`manifest version is ${JSON.stringify(actualVersion)}, expected ${version}`);
  }
  const actualId = manifest?.browser_specific_settings?.gecko?.id;
  if (actualId !== geckoId) {
    problems.push(`gecko id is ${JSON.stringify(actualId)}, expected ${geckoId}`);
  }
  return problems;
};

/** Refuse credential-bearing requests outside AMO, including URL credentials. */
export const trustedAmoUrl = (input) => {
  const url = new URL(input);
  if (url.origin !== AMO_ORIGIN || url.username || url.password) {
    throw new Error('refusing URL outside the trusted AMO origin');
  }
  return url.href;
};

/**
 * The two origins a signed file may come from: AMO itself, and the CDN AMO has
 * served public files from. The JWT goes to the first only. Whether an
 * unlisted file is ever redirected at all is unmeasured — the first unlisted
 * run is the measurement — so this is the narrowest set that survives either
 * answer, rather than a claim about which one AMO gives.
 */
export const DOWNLOAD_ORIGINS = [AMO_ORIGIN, 'https://addons.cdn.mozilla.net'];

/**
 * Where a redirect from a signed-file download may lead, and whether the JWT
 * may follow it. A relative Location resolves against the URL that answered;
 * anything that is not https on one of DOWNLOAD_ORIGINS — another host, plain
 * http, another port, credentials in the URL — is refused rather than
 * followed. Integrity does not rest on this: the caller checks the bytes
 * against the sha256 AMO published in the authenticated version response.
 */
export const downloadHop = (location, from) => {
  const url = new URL(location, from);
  if (!DOWNLOAD_ORIGINS.includes(url.origin) || url.username || url.password) {
    throw new Error(
      `refusing a download from ${url.origin}, outside ${DOWNLOAD_ORIGINS.join(' and ')}`,
    );
  }
  return { url: url.href, withAuth: url.origin === AMO_ORIGIN };
};

/**
 * The child's environment for `wxt submit`, which has two jobs.
 *
 * Ambient publisher configuration must not turn an AMO submission into another
 * store's upload or a silent dry run, so every `CHROME_`, `EDGE_`, `OPERA_` and
 * `FIREFOX_` variable and `DRY_RUN` is dropped and the Firefox ones are set here.
 *
 * And `binDir` goes first on PATH. `wxt submit` is an alias that spawns
 * `wxt-publish-extension` by bare name, and only `pnpm run` puts
 * node_modules/.bin on PATH — run as `node scripts/amo-submit.mjs`, which is the
 * line the workflow types, the alias could not find it and exited 1 with zero
 * bytes of output (reproduced 2026-09-11 with a runner-like PATH).
 */
export const submitEnvironment = (env, { issuer, secret }, { binDir } = {}) => {
  if (!binDir) throw new Error('submitEnvironment: binDir is required');
  return {
    ...Object.fromEntries(
      Object.entries(env).filter(([key]) => !/^(CHROME_|EDGE_|OPERA_|FIREFOX_|DRY_RUN$)/.test(key)),
    ),
    PATH: env.PATH ? `${binDir}${delimiter}${env.PATH}` : binDir,
    FIREFOX_EXTENSION_ID: GECKO_ID,
    FIREFOX_JWT_ISSUER: issuer,
    FIREFOX_JWT_SECRET: secret,
    DRY_RUN: 'false',
    FIREFOX_SKIP_SUBMIT_REVIEW: 'false',
  };
};
