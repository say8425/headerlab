/**
 * Submits the Firefox build to Firefox Add-ons (AMO), and on the unlisted
 * channel waits for the signed package and writes it beside the archives.
 *
 *   node scripts/amo-submit.mjs [--channel listed|unlisted] [--expect-version <v>]
 *                               [--dry-run] [--timeout-minutes <n>]
 *
 * `pnpm amo:submit` zips first. This is the one entry point for both the
 * developer's machine and `.github/workflows/amo-submit.yml` — the workflow
 * types exactly this command, the way `cws-submit.yml` types `pack-crx.mjs` —
 * so the archive check, the channel and the signed-file fetch exist once.
 *
 * What it does, in order:
 *   1. Finds `.output/headerlab-<v>-firefox.zip` and `-sources.zip` for the
 *      version being submitted (`--expect-version`, else package.json's).
 *   2. Reads the archive's manifest and refuses a version or gecko id that is
 *      not the one being submitted (`manifestMatches` — the same check
 *      `pack-crx.mjs` makes, for the same reason).
 *   3. Runs `wxt submit` — publish-browser-extension, a dependency of wxt —
 *      with the credentials in its environment. It gets the add-on, uploads
 *      the zip on the channel, polls validation (5s, ten minutes), and creates
 *      the version with the sources archive attached. `--dry-run` stops it
 *      after the first call: authentication and the add-on's existence.
 *   4. On `unlisted`, polls the version until AMO reports its file `public`,
 *      downloads it — the JWT sent to the AMO origin only, at most three redirects
 *      and only to Mozilla's CDN — checks the sha256 AMO published for it,
 *      and writes `headerlab-<v>-firefox.xpi`. On `listed` there is nothing to
 *      fetch: AMO hosts the file, and review is Mozilla's.
 *
 * Credentials: `FIREFOX_JWT_ISSUER` and `FIREFOX_JWT_SECRET` from the
 * environment (CI), else from 1Password — `op://Personal/Firefox AMO Token`,
 * fields `username` and `password`. Both flow only into the child's
 * environment and into an Authorization header, never into argv, a log line
 * or a file. The issuer is treated as a secret too.
 *
 * Exit codes: 0 done · 1 refused, or AMO refused. Nothing is retried here; the
 * workflow that calls it is re-runnable against an existing tag, and AMO
 * refuses a version it already holds, so a retry after a partial success
 * fails loudly rather than uploading twice.
 *
 * What is NOT here: creating the add-on. `wxt submit`'s first call is a GET
 * on it, so the first submission is by hand (docs/store/amo/checklist.md).
 *
 * **`file.url` sits outside `/api/` and whether the JWT header is honoured
 * there has not been measured** — `web-ext sign` downloads it that way, so
 * this does too, and the first unlisted run is the measurement.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  archiveNames,
  submitEnvironment,
  CHANNELS,
  claimSet,
  endpoints,
  GECKO_ID,
  issuerLooksValid,
  manifestMatches,
  parseHash,
  readSignedFile,
  signingInput,
  downloadHop,
  trustedAmoUrl,
} from './lib/amo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'node_modules', '.bin');
const WXT = path.join(BIN, 'wxt');

/**
 * The script's own ceilings: wxt submit (whose validation poll alone may take
 * ten minutes), and the signed-file download, which gets its own budget rather
 * than whatever the signature poll left over. amo-submit.yml's job timeout is
 * set above the sum of these and the poll, so a slow run ends with this
 * script's message rather than the runner's.
 */
const SUBMIT_TIMEOUT_MS = 15 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 2 * 60_000;

/** Where the API key lives when the environment does not carry it. */
const OP_ISSUER = 'op://Personal/Firefox AMO Token/username';
const OP_SECRET = 'op://Personal/Firefox AMO Token/password';

/**
 * `die` throws; it does not call `process.exit` — same reasons as
 * store-submit.mjs: control flow the analyser can see, and no truncated stdout
 * on a pipe, which is what Actions gives this script.
 */
class SubmitError extends Error {}
const die = (message) => {
  throw new SubmitError(message);
};
const log = (message) => console.log(`amo-submit: ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `op read` writes to stdout and `execFileSync` hands it back — the value never
 * becomes a command argument, so it is not in `ps` output or shell history.
 */
const readOp = (reference) => {
  try {
    return execFileSync('op', ['read', reference], {
      maxBuffer: 1 << 20,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  } catch {
    die(
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
    die(
      'set both FIREFOX_JWT_ISSUER and FIREFOX_JWT_SECRET. Half a pair is refused, and so is the\n' +
        '  1Password fallback under CI, where a missing secret must fail rather than prompt.',
    );
  }
  const issuer = process.env.FIREFOX_JWT_ISSUER?.trim() || readOp(OP_ISSUER);
  const secret = process.env.FIREFOX_JWT_SECRET?.trim() || readOp(OP_SECRET);
  if (!issuerLooksValid(issuer)) {
    die('FIREFOX_JWT_ISSUER does not look like an AMO API key (user:<id>:<key>)');
  }
  if (!secret) die('FIREFOX_JWT_SECRET is empty');
  return { issuer, secret };
};

/** A fresh token per request: sixty seconds, a new nonce, HS256. */
const token = ({ issuer, secret }) => {
  const input = signingInput(
    claimSet({ issuer, now: Math.floor(Date.now() / 1000), jti: randomUUID() }),
  );
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
};

const locateArchives = (version) => {
  let names;
  try {
    names = archiveNames(version);
  } catch {
    die(
      `--expect-version must be a three-part version such as 1.8.0, got ${JSON.stringify(version)}`,
    );
  }
  const extension = path.join(ROOT, '.output', names.extension);
  const sources = path.join(ROOT, '.output', names.sources);
  for (const file of [extension, sources]) {
    if (!existsSync(file)) {
      die(
        `no archive at ${file}\n` +
          '  Build both with `pnpm zip`, or take them from the release:\n' +
          `  gh release download extension-v${version} -p '*-firefox.zip' -p '*-sources.zip' -D .output`,
      );
    }
  }
  return { extension, sources, signed: path.join(ROOT, '.output', names.signed) };
};

/**
 * The version comes out of the archive, not out of package.json or argv. The
 * archive is an argument (or a release download), and taking the bytes from
 * one place and the name from another is how a 1.8.0 package gets submitted
 * as 1.9.0 with nothing failing.
 */
const checkManifest = (zip, version) => {
  let manifest;
  try {
    manifest = JSON.parse(
      execFileSync('unzip', ['-p', zip, 'manifest.json'], {
        maxBuffer: 1 << 20,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).toString(),
    );
  } catch (error) {
    die(`cannot read manifest.json out of ${path.basename(zip)}: ${error.message.split('\n')[0]}`);
  }
  const problems = manifestMatches(manifest, { version, geckoId: GECKO_ID });
  if (problems.length > 0) {
    die(
      `${path.basename(zip)} is not the package being submitted:\n  ${problems.join('\n  ')}\n` +
        '  Check out the tag that archive belongs to, or pass --expect-version for it.',
    );
  }
};

/**
 * `node_modules/.bin/wxt` rather than `pnpm exec`: the same line works on this
 * machine and in the workflow, and does not depend on which pnpm is on PATH.
 * That alone was not enough, and the first review caught it: the alias itself
 * spawns `wxt-publish-extension` by bare name, so the child's PATH must hold
 * node_modules/.bin — `submitEnvironment` puts it first.
 * The credentials go in through the environment, which is where
 * publish-browser-extension reads them (`FIREFOX_JWT_*`, `FIREFOX_EXTENSION_ID`);
 * a `--firefox-*` flag wins over an environment variable there, so the channel
 * is passed as a flag and cannot be overridden by a stray `FIREFOX_CHANNEL`.
 */
const runWxtSubmit = ({ extension, sources, channel, dryRun, creds }) => {
  const argv = [
    'submit',
    '--firefox-zip',
    extension,
    '--firefox-sources-zip',
    sources,
    '--firefox-channel',
    channel,
    ...(dryRun ? ['--dry-run'] : []),
  ];
  log(`wxt ${argv.join(' ')}`);
  const result = spawnSync(WXT, argv, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 << 20,
    timeout: SUBMIT_TIMEOUT_MS,
    env: submitEnvironment(process.env, creds, { binDir: BIN }),
  });
  // Validation errors in the publisher can echo configuration; redact both halves.
  for (const output of [result.stdout, result.stderr]) {
    if (output)
      console.log(
        output
          .split(creds.issuer)
          .join('[REDACTED]')
          .split(creds.secret)
          .join('[REDACTED]')
          .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED JWT]'),
      );
  }
  if (result.error?.code === 'ETIMEDOUT') {
    die(
      `wxt submit ran past ${SUBMIT_TIMEOUT_MS / 60_000} minutes and was stopped.\n` +
        '  AMO may already hold this version; check pnpm amo:probe before retrying.',
    );
  }
  if (result.error) die(`could not start wxt submit: ${result.error.message}`);
  if (result.status !== 0) {
    // wxt's submit alias catches a failure to start wxt-publish-extension and
    // exits 1 without a word, so an empty exit is named here rather than left
    // pointing at an "output above" that does not exist.
    const silent = !result.stdout?.trim() && !result.stderr?.trim();
    die(
      silent
        ? `wxt submit exited ${result.status} and printed nothing. Its submit alias does that when it\n` +
            `  cannot start wxt-publish-extension; check ${path.join(BIN, 'wxt-publish-extension')} exists.`
        : `wxt submit exited ${result.status}. Its output is above; nothing was retried.`,
    );
  }
};

/**
 * Takes the signed file, following at most three redirects and only to the
 * origins `downloadHop` allows.
 *
 * The first request carries the JWT, because an unlisted file is served to its
 * authors only. Redirects are followed by hand rather than by `fetch` so that
 * where the credential goes is decided here: to the AMO origin and never
 * further. Integrity is the caller's sha256 check against the hash AMO
 * published in the authenticated version response, so a hop to the CDN costs
 * nothing — it is the hash, not the host, that says the file is the one AMO
 * signed. An earlier version refused every redirect, which would have failed
 * the first unlisted release after its tag if AMO answers with one.
 */
const downloadSigned = async (first, creds) => {
  let hop = { url: first, withAuth: true };
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(hop.url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: hop.withAuth ? { Authorization: `JWT ${token(creds)}` } : {},
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) die(`GET ${hop.url} → HTTP ${response.status} with no Location`);
      try {
        hop = downloadHop(location, hop.url);
      } catch (error) {
        die(`not following the redirect from ${hop.url}: ${error.message}`);
      }
      continue;
    }
    if (!response.ok) die(`GET ${hop.url} → HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  die(`more than three redirects from ${first}`);
};

/**
 * Waits for AMO to sign the unlisted version, then takes the file.
 *
 * A 404 right after the version was created is read as "not visible yet"
 * rather than as an error; anything else non-2xx is. The loop stops on the
 * first `refused` — a disabled file, the wrong channel, a status the API does
 * not document — because none of those get better by waiting.
 */
const fetchSigned = async ({ version, channel, signed, creds, timeoutMinutes }) => {
  const api = endpoints(GECKO_ID);
  const deadline = Date.now() + timeoutMinutes * 60_000;
  const intervalMs = 15_000;
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(trustedAmoUrl(api.version(version)), {
      redirect: 'error',
      signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, deadline - Date.now()))),
      headers: { Authorization: `JWT ${token(creds)}` },
    });
    const body = await response.json().catch(() => ({}));
    let verdict;
    if (response.status === 404) {
      verdict = { kind: 'wait', status: 'HTTP 404 (the version is not visible yet)' };
    } else if (!response.ok) {
      die(`GET version ${version} → HTTP ${response.status}`);
    } else {
      if (body.version !== version) die('AMO returned a different version than requested');
      verdict = readSignedFile(body, { channel });
    }
    if (verdict.kind === 'refused') die(`AMO will not hand over a signed file: ${verdict.reason}`);
    if (verdict.kind === 'ready') {
      const expected = parseHash(verdict.hash);
      const bytes = await downloadSigned(trustedAmoUrl(verdict.url), creds);
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== expected.hex) {
        die(`the downloaded file hashes to sha256:${actual}; AMO says ${verdict.hash}`);
      }
      writeFileSync(signed, bytes);
      log(`signed package written: ${signed} (${bytes.length} bytes, sha256:${actual})`);
      return;
    }
    if (Date.now() > deadline) {
      die(
        `gave up after ${timeoutMinutes} minutes; the file is still ${verdict.status}.\n` +
          '  Check pnpm amo:probe. AMO may already hold this version; do not blindly resubmit it.',
      );
    }
    log(`not signed yet (${attempt}): ${verdict.status}; next look in ${intervalMs / 1000}s`);
    await sleep(Math.min(intervalMs, Math.max(1, deadline - Date.now())));
  }
};

const main = async () => {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean', default: false },
      // The flag, else listed. Not FIREFOX_CHANNEL: the workflow resolves the
      // environment's variable itself and passes the result here, so there is
      // one resolution order and it is written in the YAML.
      channel: { type: 'string', default: 'listed' },
      'expect-version': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'timeout-minutes': { type: 'string', default: '15' },
    },
    strict: true,
  });
  if (values.help) {
    log(
      'usage: node scripts/amo-submit.mjs [--channel listed|unlisted] [--expect-version <v>] [--dry-run] [--timeout-minutes <n>]',
    );
    return;
  }
  const channel = values.channel;
  if (!CHANNELS.includes(channel)) {
    die(`--channel must be one of ${CHANNELS.join(', ')}, got ${JSON.stringify(channel)}`);
  }
  const timeoutMinutes = Number(values['timeout-minutes']);
  if (!(Number.isFinite(timeoutMinutes) && timeoutMinutes > 0 && timeoutMinutes <= 120))
    die('--timeout-minutes must be a finite number between 0 and 120');
  const version =
    values['expect-version'] ??
    JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

  // Everything that can refuse without a credential refuses first.
  const archives = locateArchives(version);
  checkManifest(archives.extension, version);
  if (!statSync(archives.sources).isFile() || statSync(archives.sources).size === 0)
    die('sources archive is empty or not a file');
  try {
    execFileSync('unzip', ['-tq', archives.sources], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    die('sources archive is not a valid zip');
  }
  log(
    `${path.basename(archives.extension)} + ${path.basename(archives.sources)} → ${channel}` +
      (values['dry-run'] ? ' (dry run)' : ''),
  );

  // Two more refusals that need no credential, so they come before 1Password.
  if (existsSync(path.join(ROOT, '.env.submit'))) {
    die(
      'remove .env.submit first: wxt submit would read store settings and credentials from it,\n' +
        '  and both must come from this entry point.',
    );
  }
  if (!existsSync(WXT)) die(`no wxt at ${WXT}\n  Run pnpm install first.`);

  const creds = credentials();
  runWxtSubmit({ ...archives, channel, dryRun: values['dry-run'], creds });
  if (values['dry-run']) {
    log('dry run: authenticated and found the add-on; nothing was uploaded.');
    return;
  }
  if (channel === 'listed') {
    log(`${version} is uploaded on the listed channel. Review is Mozilla's and arrives by email.`);
    log('Nothing to attach: AMO hosts the file.');
    return;
  }
  await fetchSigned({ version, channel, signed: archives.signed, creds, timeoutMinutes });
};

try {
  await main();
} catch (error) {
  console.error(`amo-submit: ${error instanceof SubmitError ? error.message : error.stack}`);
  // Not `process.exit`: it abandons pending stdout writes on a pipe.
  process.exitCode = 1;
}
