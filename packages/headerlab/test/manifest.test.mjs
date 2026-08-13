import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HOST_NAME,
  MANIFEST_FILE_NAME,
  hostManifest,
  launcherScript,
  nativeMessagingDir,
  unpackedExtensionId,
} from '../lib/manifest.mjs';

describe('unpackedExtensionId', () => {
  it('reproduces the id Chrome actually assigned this repo', () => {
    // Measured against `chrome://extensions` during the spike, not derived
    // from the same code this test exercises. That is what makes it a fixture
    // rather than a tautology.
    assert.equal(
      unpackedExtensionId('/Users/penguin/dev/headerlab/.output/chrome-mv3'),
      'emdiklpbkfcdhnljlaikoclahpkjledp',
    );
  });

  it('is 32 characters from the a-p alphabet', () => {
    const id = unpackedExtensionId('/anywhere/at/all');
    assert.equal(id.length, 32);
    assert.match(id, /^[a-p]{32}$/);
  });

  it('changes with a trailing slash — the same directory spelled differently is a different id', () => {
    // Not a curiosity: it is why the installer may not accept a path the user
    // typed and assume it matches what Chrome loaded.
    assert.notEqual(unpackedExtensionId('/a/b'), unpackedExtensionId('/a/b/'));
  });
});

describe('nativeMessagingDir', () => {
  it('derives from an explicit user-data-dir when one is given', () => {
    // The e2e case, and the reason this is a parameter at all: Playwright's
    // profile is a fresh temp directory every run, and a manifest installed
    // to the home path is silently absent there.
    assert.equal(
      nativeMessagingDir({ platform: 'darwin', userDataDir: '/tmp/profile' }),
      '/tmp/profile/NativeMessagingHosts',
    );
  });

  it('uses Chrome\u2019s macOS user-data-dir by default', () => {
    assert.equal(
      nativeMessagingDir({ platform: 'darwin', home: '/Users/x', browser: 'chrome' }),
      '/Users/x/Library/Application Support/Google/Chrome/NativeMessagingHosts',
    );
  });

  it('uses Chromium\u2019s, which is a different directory entirely', () => {
    assert.equal(
      nativeMessagingDir({ platform: 'darwin', home: '/Users/x', browser: 'chromium' }),
      '/Users/x/Library/Application Support/Chromium/NativeMessagingHosts',
    );
  });

  it('knows the Linux locations too', () => {
    assert.equal(
      nativeMessagingDir({ platform: 'linux', home: '/home/x', browser: 'chrome' }),
      '/home/x/.config/google-chrome/NativeMessagingHosts',
    );
  });

  it('refuses a platform it has not been taught rather than guessing a path', () => {
    // A wrong path here is the worst possible failure mode: everything
    // succeeds, nothing is where Chrome looks, and the extension's only
    // symptom is the same message it gives for two other causes.
    assert.throws(() => nativeMessagingDir({ platform: 'win32', home: 'C:\\' }), /win32/);
  });
});

describe('hostManifest', () => {
  it('names one exact origin — a wildcard is a hard parse failure in Chrome', () => {
    assert.deepEqual(hostManifest({ launcherPath: '/x/run', extensionId: 'abc' }), {
      name: HOST_NAME,
      description: 'HeaderLab agent bridge',
      path: '/x/run',
      type: 'stdio',
      allowed_origins: ['chrome-extension://abc/'],
    });
  });

  it('files itself under the name the extension connects to', () => {
    assert.equal(MANIFEST_FILE_NAME, `${HOST_NAME}.json`);
  });
});

describe('launcherScript', () => {
  it('names both the interpreter and the entry by absolute path', () => {
    // The measured trap: `#!/usr/bin/env node` never resolves under Chrome,
    // whose environment carries no nvm and no homebrew, and the script does
    // not execute its first line. `/bin/sh` is itself absolute, and `exec`
    // replaces the process so stdio is inherited byte for byte.
    const script = launcherScript({ nodePath: '/opt/node/bin/node', entryPath: '/r/host.mjs' });
    assert.equal(
      script,
      ['#!/bin/sh', "exec '/opt/node/bin/node' '/r/host.mjs' \"$@\"", ''].join('\n'),
    );
  });

  it('refuses a relative interpreter path instead of writing a launcher that cannot run', () => {
    assert.throws(() => launcherScript({ nodePath: 'node', entryPath: '/r/host.mjs' }), /absolute/);
  });

  it('refuses a relative entry path for the same reason', () => {
    assert.throws(
      () => launcherScript({ nodePath: '/opt/node/bin/node', entryPath: 'host.mjs' }),
      /absolute/,
    );
  });

  it('refuses a path holding a single quote rather than emitting breakable shell', () => {
    // Single-quoting is the whole of the escaping here, so a path containing
    // one would end the quote and turn the rest into shell words. Refusing is
    // right: a native messaging host at such a path is not worth the escaping
    // machinery, and a broken launcher fails the same three indistinguishable
    // ways as everything else.
    assert.throws(
      () => launcherScript({ nodePath: "/opt/no'de", entryPath: '/r/host.mjs' }),
      /quote/,
    );
  });
});
