import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * Everything the installer needs to know about *what* a native messaging host
 * manifest is, with no filesystem in it — `install.mjs`, alongside it in this
 * `lib/`, imports it for the manifest shape and reuses `socket.mjs`'s paths.
 */

/**
 * The name Chrome resolves in NativeMessagingHosts, and the name the extension
 * passes to `connectNative`. `lib/bridge/port.ts` holds the other spelling of
 * it — it cannot import this file, since that would pull Node into the
 * extension bundle — and `tests/unit/bridgeName.test.ts` is what keeps the two
 * from drifting apart.
 */
export const HOST_NAME = 'com.headerlab.bridge';

export const MANIFEST_FILE_NAME = `${HOST_NAME}.json`;

/**
 * The id Chrome assigns an unpacked extension: the first 16 bytes of the
 * SHA-256 of the load path's **bytes**, each hex digit mapped 0-f → a-p
 * (`id_util.cc:41-67`).
 *
 * Reproduced against a real load — `/Users/penguin/dev/headerlab/.output/chrome-mv3`
 * gives `emdiklpbkfcdhnljlaikoclahpkjledp`, which matched the
 * `chrome://extensions` card and the error URL both.
 *
 * The path is used exactly as given. A symlink, a trailing slash, or a
 * different spelling of the same directory each produce a different id, which
 * is why the installer compares its computed value against the id the browser
 * actually reports rather than trusting either one alone.
 */
export function unpackedExtensionId(loadPath) {
  const digest = createHash('sha256').update(Buffer.from(loadPath, 'utf8')).digest('hex');
  // Array.from, not a spread: digest is a string, and oxlint's
  // no-useless-spread heuristic cannot see that — it reads `.slice` and
  // assumes an array, where spreading a copy would indeed be redundant.
  return Array.from(digest.slice(0, 32))
    .map((hex) => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(hex, 16)))
    .join('');
}

const USER_DATA_DIRS = {
  darwin: {
    chrome: ['Library', 'Application Support', 'Google', 'Chrome'],
    chromium: ['Library', 'Application Support', 'Chromium'],
  },
  linux: {
    chrome: ['.config', 'google-chrome'],
    chromium: ['.config', 'chromium'],
  },
};

/**
 * Where Chrome looks for host manifests: `DIR_USER_DATA + "NativeMessagingHosts"`
 * (`chrome_paths.cc:478-483`). **`--user-data-dir` moves it**, which is not a
 * corner case — every Playwright run gets its own profile, so an e2e that
 * installed to the home path would find the host silently absent.
 *
 * Throws on a platform this has not been taught. A guessed path is the worst
 * available outcome: every step reports success, the file lands somewhere
 * Chrome never reads, and the extension's only symptom is a message it gives
 * for two other causes as well.
 */
export function nativeMessagingDir({ platform, home, userDataDir, browser = 'chrome' }) {
  if (userDataDir) return path.join(userDataDir, 'NativeMessagingHosts');
  const byBrowser = USER_DATA_DIRS[platform];
  if (!byBrowser) {
    throw new Error(
      `no known NativeMessagingHosts location for platform ${platform} — ` +
        'pass --user-data-dir to name it explicitly',
    );
  }
  const segments = byBrowser[browser];
  if (!segments) throw new Error(`unknown browser: ${browser}`);
  return path.join(home, ...segments, 'NativeMessagingHosts');
}

export function hostManifest({ launcherPath, extensionId }) {
  return {
    name: HOST_NAME,
    description: 'HeaderLab agent bridge',
    path: launcherPath,
    type: 'stdio',
    // Exactly one origin, spelled out. Chrome treats a wildcard here as a hard
    // parse failure (`native_messaging_host_manifest.cc:131-134`), and a
    // rejected manifest and a wrong id produce the same message the extension
    // sees for a missing interpreter.
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

function requireAbsolute(label, value) {
  if (!path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path, got: ${value}`);
  }
  if (value.includes("'")) {
    throw new Error(`${label} must not contain a single quote: ${value}`);
  }
  return value;
}

/**
 * The file Chrome actually executes.
 *
 * A `/bin/sh` one-liner rather than a copy of the host: the real host imports
 * `../lib/host.mjs` and `../lib/socket.mjs` by relative path, so a copy would
 * either drag those along or duplicate the wiring — and duplicating a judgment
 * is this repo's most expensive defect by name. `exec` replaces the shell, so
 * stdin and stdout reach the host untouched, which is the whole protocol.
 *
 * `#!/bin/sh` is absolute and always present; the interpreter and the entry
 * are named absolutely for the measured reason that Chrome gives a host an
 * environment with no usable PATH, where `#!/usr/bin/env node` does not
 * execute the script's first line.
 */
export function launcherScript({ nodePath, entryPath }) {
  const node = requireAbsolute('the interpreter path', nodePath);
  const entry = requireAbsolute('the host entry path', entryPath);
  return ['#!/bin/sh', `exec '${node}' '${entry}' "$@"`, ''].join('\n');
}
