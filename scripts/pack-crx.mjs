/**
 * Signs the release ZIP into a CRX3 the Chrome Web Store's verified-upload
 * check will accept. `pnpm crx` builds the ZIP first.
 *
 *   node scripts/pack-crx.mjs [path/to/headerlab-<version>-chrome.zip]
 *
 * **Why the ZIP and not the build directory.** `.output/chrome-mv3` and the
 * release ZIP are two artifacts of one build, and only the ZIP is what a
 * stranger can download from the GitHub release. Packing from the ZIP makes the
 * CRX uploaded to the store and the archive attached to the release provably the
 * same *files* — step 4 below compares every one of them by hash. Packing from
 * the directory would leave that as an assumption.
 *
 * **This runs in CI as well as by hand, as of 2026-08-26.** It used to be local
 * only, on the argument that a repository whose entire claim is "verifiable by a
 * stranger who trusts none of this" should not hold a secret that publishes on
 * its behalf. That cost is real and the owner took it anyway, so that merging the
 * release PR is the whole of a release; CLAUDE.md's "Chrome Web Store" section
 * keeps the argument beside the decision and lists what narrows it. Nothing in
 * this file changed for it — `.github/workflows/store-submit.yml` sets
 * `HEADERLAB_CRX_KEY` and `CHROME` and calls it exactly as a person would.
 *
 * The key comes out of 1Password by default and is never written anywhere but a
 * 0600 file inside a 0700 temp directory, removed on the way out however this
 * exits — see the cleanup registration below, and note that a `try/finally`
 * alone does not achieve that. It is written at step 3, after the archive is
 * unpacked and its version checked, so the two things that can refuse a run
 * happen while there is still nothing on disk to clean up. Set
 * `HEADERLAB_CRX_KEY` to a PEM path to sign without 1Password.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extensionIdFromPublicKey, parseCrx, readCrxHeader } from './lib/crx.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where the item's signing key lives. The public half is on the same record. */
const OP_SECRET = 'op://Personal/HeaderLab CRX signing key/private key';

/**
 * Chrome does the signing. There is no packer in this repository and there
 * should not be: `--pack-extension` is the same code path that produced every
 * CRX the store has ever accepted, and a hand-rolled CRX3 writer would be a
 * second implementation of a format this repo does not own.
 */
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const die = (message) => {
  console.error(`pack-crx: ${message}`);
  process.exit(1);
};

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/**
 * Every file under a directory, repo-relative, sorted — the comparison's spine.
 *
 * Two edges it does not have: an empty directory is dropped, and a symlink is
 * counted as a file whose target gets hashed. A WXT build has neither, so this
 * is a note rather than a defect — but a comparison that quietly ignores a kind
 * of entry is worth writing down before something starts producing one.
 */
function filesUnder(dir) {
  const walk = (at) =>
    readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(at, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  return walk(dir)
    .map((full) => path.relative(dir, full))
    .sort();
}

const declaredVersion = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const zip = path.resolve(
  process.argv[2] ?? path.join(ROOT, '.output', `headerlab-${declaredVersion}-chrome.zip`),
);

if (!existsSync(zip)) {
  die(`no archive at ${zip}\n  Build one first: pnpm zip`);
}

/**
 * The key, as bytes, without it reaching argv.
 *
 * `op read` writes to stdout and `execFileSync` hands it back — the value never
 * becomes a command argument, which is where the CLI's own skill file warns a
 * secret would land in `ps` output and in shell history.
 */
function readSigningKey() {
  const override = process.env.HEADERLAB_CRX_KEY;
  if (override) {
    if (!existsSync(override)) die(`HEADERLAB_CRX_KEY points at nothing: ${override}`);
    return readFileSync(override);
  }
  try {
    return execFileSync('op', ['read', OP_SECRET], { maxBuffer: 1 << 20 });
  } catch (error) {
    die(
      `could not read the signing key from 1Password (${OP_SECRET})\n` +
        `  ${error.message.split('\n')[0]}\n` +
        '  Sign in with `op signin`, or set HEADERLAB_CRX_KEY to a PEM path.',
    );
  }
}

if (!existsSync(CHROME)) {
  die(`no Chrome at ${CHROME}\n  Set CHROME to the executable inside the .app bundle.`);
}

const work = mkdtempSync(path.join(tmpdir(), 'headerlab-crx-'));
chmodSync(work, 0o700);

/**
 * The key leaves no copy behind, on **every** way out of this script.
 *
 * A `try/finally` alone does not do that, and the gap is the one that matters:
 * `process.exit()` does not throw, so it ends the process without running any
 * `finally` on the stack. Measured — a probe that writes a file, calls
 * `process.exit(1)` inside a `try`, and logs from the `finally` prints nothing
 * and leaves the file. Every refusal below reaches `die()`, which is
 * `process.exit(1)`, so a `finally` would have kept the key on disk on exactly
 * the paths where somebody then goes looking through the directory to find out
 * what went wrong.
 *
 * `process.on('exit')` runs on `process.exit()` too, and only synchronous work
 * is allowed in it — which `rmSync` is. Registered here rather than at the end,
 * so nothing between this line and the last one can be added in front of it.
 * The same shape CLAUDE.md's Testing section records for an installer's
 * teardown: register it so it cannot be skipped.
 */
const clean = () => rmSync(work, { recursive: true, force: true });
process.on('exit', clean);
/**
 * **These three earn their place by being registered, not by running.** The
 * bodies below are unreachable, and knowing why is the difference between
 * trusting this and re-deriving it.
 *
 * A signal's default action ends the process immediately, with no 'exit' event
 * — so without a handler the key survives. Measured on the real script with
 * real Chrome, Ctrl-C during the pack: handlers removed, exit 130 and **four**
 * temp directories left holding a `signing.pem`; handlers present, exit 1 and
 * none. Registering a JS handler suppresses that default action, and that alone
 * is what keeps the process alive long enough for the synchronous body to reach
 * its own cleanup.
 *
 * The body never runs because **this script has no yield point at all** — every
 * call is a `*Sync` variant and there is no `await`, promise, timer or
 * `nextTick` anywhere in it, so the event loop does not turn once between this
 * registration and the last line. What happens on Ctrl-C instead, measured:
 * Chrome is in the same process group, dies on the signal, and `execFileSync`
 * throws with `status: null, signal: 'SIGINT'`. The `catch` below turns that
 * into a sentence and `die()` exits through the 'exit' handler.
 *
 * A signal delivered to this process *alone* does nothing at all: Chrome
 * finishes, the pack succeeds, and the run exits 0 with the handler never
 * having fired. Also measured. So the statuses below are what a future reader
 * would see only after somebody introduces an `await` — which is exactly why
 * they stay: the day the loop can turn, these become live, and 128 plus the
 * signal number is the shell's own convention for "died on this signal".
 *
 * SIGKILL and a power cut are outside all of this by construction; the key then
 * sits in `$TMPDIR` until the OS clears it, which is what `.gitignore`'s
 * `*.pem` is a backstop for rather than a solution to.
 */
for (const [signal, status] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
]) {
  process.on(signal, () => process.exit(status));
}

try {
  // 1. The ZIP's contents become the directory Chrome packs.
  const staged = path.join(work, 'extension');
  mkdirSync(staged);
  execFileSync('unzip', ['-q', zip, '-d', staged]);

  /**
   * 2. The version comes out of the archive, not out of `package.json`.
   *
   * The archive is an argument, and the checklist's own instruction hands it
   * one — `gh release download extension-v<version>`. Taking the name from
   * `package.json` while taking the bytes from argv is how a 1.2.0 package ends
   * up called `headerlab-1.6.0-chrome.crx`: nothing fails, because both content
   * checks below compare that ZIP against itself. Reading it here makes the
   * filename part of what is verified, and the mismatch loud rather than a
   * label.
   */
  const manifest = JSON.parse(readFileSync(path.join(staged, 'manifest.json'), 'utf8'));
  const version = manifest.version;
  if (version !== declaredVersion) {
    die(
      `${path.basename(zip)} holds version ${version}, and package.json says ${declaredVersion}.\n` +
        '  Check out the tag that archive belongs to, or pass the archive for this version.',
    );
  }

  // 3. The key, on disk only for as long as Chrome needs a path to it.
  const keyFile = path.join(work, 'signing.pem');
  writeFileSync(keyFile, readSigningKey(), { mode: 0o600 });

  // 4. Chrome writes `<staged>.crx` beside the directory it was given.
  try {
    execFileSync(
      CHROME,
      [
        `--pack-extension=${staged}`,
        `--pack-extension-key=${keyFile}`,
        // Chrome reports a packing failure in a modal. With stdio inherited and
        // nobody at the keyboard, that is a script that never returns rather
        // than one that fails.
        '--no-message-box',
        // A profile of its own, inside the directory that is already being
        // cleaned up. Without it this attaches to whatever Chrome the developer
        // has open, which makes the behaviour depend on something outside the
        // run.
        `--user-data-dir=${path.join(work, 'profile')}`,
      ],
      { stdio: 'inherit' },
    );
  } catch (error) {
    // Ctrl-C lands here rather than in the handler above, because Chrome shares
    // this process group and dies on the signal — so the throw carries
    // `signal` and no status. Saying that is the whole point: an uncaught
    // `execFileSync` error prints a stack naming a temp path that no longer
    // exists, which reads like a defect in the packer rather than like the
    // interruption it was.
    if (error.signal) die(`Chrome was interrupted (${error.signal}). Nothing was written.`);
    die(`Chrome could not pack the extension: ${error.message.split('\n')[0]}`);
  }
  const packed = `${staged}.crx`;
  if (!existsSync(packed)) die(`Chrome reported success but wrote no ${path.basename(packed)}`);

  // 5. Read the bytes back rather than trusting the exit code. Three claims,
  //    each of which the store checks in its own way at upload time.
  const crx = readFileSync(packed);
  const { version: crxVersion, header, payload } = parseCrx(crx);
  const { rsaPublicKeys, crxId } = readCrxHeader(header);

  const signingKey = readFileSync(keyFile);
  const expectedDer = execFileSync('openssl', ['rsa', '-pubout', '-outform', 'DER'], {
    input: signingKey,
    maxBuffer: 1 << 20,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const expectedId = extensionIdFromPublicKey(expectedDer);
  const expectedIdBytes = createHash('sha256').update(expectedDer).digest().subarray(0, 16);

  if (!rsaPublicKeys.some((key) => key.equals(expectedDer))) {
    die(
      `the CRX header declares ${rsaPublicKeys.length} RSA public key(s), none of them the signing key.\n` +
        '  The store would reject this upload.',
    );
  }
  if (!crxId) die('the CRX header carries no signed crx id');
  if (!expectedIdBytes.equals(crxId)) {
    die(`the CRX header signs over a different id than the signing key produces (${expectedId})`);
  }

  // 6. Same files, same bytes. Chrome rebuilds the archive, so the container
  //    differs and the contents must not — comparing the ZIPs byte for byte
  //    would fail on metadata and prove nothing about what ships.
  const unpacked = path.join(work, 'verify');
  mkdirSync(unpacked);
  const payloadZip = path.join(work, 'payload.zip');
  writeFileSync(payloadZip, payload);
  execFileSync('unzip', ['-q', payloadZip, '-d', unpacked]);

  const zipFiles = filesUnder(staged);
  const packedFiles = filesUnder(unpacked);
  if (zipFiles.join('\n') !== packedFiles.join('\n')) {
    die(
      `the CRX holds a different set of files than ${path.basename(zip)}\n` +
        `  only in the zip:  ${zipFiles.filter((f) => !packedFiles.includes(f)).join(', ') || '—'}\n` +
        `  only in the crx:  ${packedFiles.filter((f) => !zipFiles.includes(f)).join(', ') || '—'}`,
    );
  }
  const differing = zipFiles.filter(
    (name) => sha256(path.join(staged, name)) !== sha256(path.join(unpacked, name)),
  );
  if (differing.length > 0) {
    die(`the CRX and the zip disagree on ${differing.length} file(s): ${differing.join(', ')}`);
  }

  // 7. Only now does it become an artifact.
  const out = path.join(ROOT, '.output', `headerlab-${version}-chrome.crx`);
  copyFileSync(packed, out);

  console.log(`\npacked  ${path.relative(ROOT, out)}  (${statSync(out).size} bytes)`);
  console.log(`  crx version   ${crxVersion}`);
  console.log(`  signed by     ${expectedId}  ← this key's id, not the store listing's`);
  console.log(`  files         ${zipFiles.length}, each byte-identical to ${path.basename(zip)}`);
  console.log(`  sha256 zip    ${sha256(zip)}`);
  console.log(`  sha256 crx    ${sha256(out)}`);
  console.log('\nUpload this file. The store verifies the signature, then repackages it');
  console.log('with its own key, so the published item keeps the id it already has.');
} finally {
  clean();
}
