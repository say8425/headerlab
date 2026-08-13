import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { bridgeStatus, installBridge, uninstallBridge } from '../lib/install.mjs';
import { MANIFEST_FILE_NAME } from '../../host/lib/manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_ENTRY = path.resolve(HERE, '../../host/bin/headerlab-host.mjs');

let root;
let options;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'headerlab-install-'));
  options = {
    manifestDir: path.join(root, 'NativeMessagingHosts'),
    launcherDir: path.join(root, 'bin'),
    entryPath: HOST_ENTRY,
    nodePath: process.execPath,
    extensionId: 'a'.repeat(32),
    // The verification host binds here rather than in the real per-user socket
    // directory, so a test run cannot be mistaken for a live bridge by a CLI
    // the developer happens to run at the same moment.
    socketDirPath: path.join(root, 'sockets'),
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('installBridge', () => {
  it('writes a manifest Chrome would accept, and a launcher it can execute', async () => {
    const result = await installBridge(options);

    assert.equal(result.ok, true);
    const manifest = JSON.parse(
      readFileSync(path.join(options.manifestDir, MANIFEST_FILE_NAME), 'utf8'),
    );
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${'a'.repeat(32)}/`]);
    assert.equal(manifest.path, result.launcherPath);
    assert.equal(manifest.type, 'stdio');

    // Executable, and executable by its owner specifically — Chrome runs it as
    // the user, and a 0644 launcher fails with the same opaque message as
    // everything else.
    assert.equal(statSync(result.launcherPath).mode & 0o700, 0o700);
  });

  it('rewrites the shebang to an absolute interpreter, which is the whole point', async () => {
    const result = await installBridge(options);
    const script = readFileSync(result.launcherPath, 'utf8');

    assert.ok(script.startsWith('#!/bin/sh\n'), script);
    // Not `env`. `#!/usr/bin/env node` was measured to leave the script with
    // zero lines executed under Chrome's environment.
    assert.ok(!script.includes('/usr/bin/env'), script);
    assert.ok(script.includes(`'${process.execPath}'`), script);
  });

  it('actually runs what it wrote and reports that it did', async () => {
    // The self-verification design §8.3 demands. Chrome reports a rejected
    // manifest, a wrong extension id and an unstartable interpreter with the
    // same message, so "the files exist" is not evidence the bridge works.
    const result = await installBridge(options);
    assert.equal(result.verified, true);
  });

  it('leaves no socket or registry entry behind in the scratch socket directory', async () => {
    // Task 4 review, promoted from Minor: verifyLauncher used to SIGKILL the
    // verification host immediately after closing its stdin, with no gap
    // between them, so the host's own cleanup() in
    // packages/host/lib/host.mjs — unlink the socket, remove the registry
    // entry — never got to run. In production socketDirPath is the real
    // per-user directory (defaultInstallPaths() sets it to socketDir()), so
    // every install left a dead bridge-<pid>.sock and <pid>.json behind in
    // the one directory findLiveBridges enumerates to find live bridges.
    // Self-healing — the next host's sweepStaleSockets clears it — but
    // litter our own installer creates in that directory is still a defect.
    // Red against the pre-fix code (verified by hand before committing);
    // green now that shutdown() gives the host SHUTDOWN_GRACE_MS to run its
    // own cleanup before escalating to SIGKILL.
    const result = await installBridge(options);
    assert.equal(result.ok, true);

    const entries = existsSync(options.socketDirPath) ? readdirSync(options.socketDirPath) : [];
    assert.deepEqual(entries, []);
  });

  it('does not write files when the entry does not exist', async () => {
    // Renamed from "leaves nothing behind when verification fails" — that
    // name overpromised. This fixture's missing entryPath trips
    // installBridge's very first guard, so it returns before verifyLauncher
    // is ever called; a verifyLauncher that always reported success would
    // still pass this test. The fixture below it, "reports the interpreter
    // it could not use", is the one that genuinely reaches and fails
    // verification, and it carries the equivalent assertions for that case.
    const broken = { ...options, entryPath: path.join(root, 'does-not-exist.mjs') };

    const result = await installBridge(broken);

    assert.equal(result.ok, false);
    assert.equal(existsSync(path.join(broken.manifestDir, MANIFEST_FILE_NAME)), false);
    assert.equal(existsSync(path.join(broken.launcherDir, 'headerlab-host')), false);
  });

  it('reports the interpreter it could not use rather than a generic failure', async () => {
    const broken = { ...options, nodePath: path.join(root, 'no-node') };
    const result = await installBridge(broken);
    assert.equal(result.ok, false);
    assert.match(result.error.message, /no-node/);

    // This is the case "does not write files when the entry does not exist"
    // does not actually cover: that test's fixture has a missing *entry*
    // path, so installBridge returns before ever calling verifyLauncher,
    // and a verifyLauncher that always reported success would still pass
    // it. Here the entry is real and verification genuinely runs and
    // genuinely fails — mutation-verified: an unconditional
    // `return { ok: true }` in verifyLauncher turns this test red
    // (result.ok becomes true), where it leaves the other test green.
    assert.equal(existsSync(path.join(broken.manifestDir, MANIFEST_FILE_NAME)), false);
    assert.equal(existsSync(path.join(broken.launcherDir, 'headerlab-host')), false);
  });
});

describe('uninstallBridge', () => {
  it('removes both files it wrote', async () => {
    const result = await installBridge(options);
    await uninstallBridge(options);

    assert.equal(existsSync(path.join(options.manifestDir, MANIFEST_FILE_NAME)), false);
    assert.equal(existsSync(result.launcherPath), false);
  });

  it('is not an error when nothing is installed', async () => {
    // Idempotent for the same reason `removeRegistryEntry` is: "make sure it
    // is gone" must not fail because it already was.
    const first = await uninstallBridge(options);
    const second = await uninstallBridge(options);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.removed.length, 0);
  });
});

describe('bridgeStatus', () => {
  it('reports nothing installed as installed:false, not as an error', async () => {
    const status = await bridgeStatus(options);
    assert.equal(status.ok, true);
    assert.equal(status.installed, false);
  });

  it('reports the origin the installed manifest actually allows', async () => {
    // The one fact that silently breaks when the extension is reloaded from a
    // different path: the manifest still parses, the launcher still runs, and
    // Chrome refuses the connection with — again — the same message.
    await installBridge(options);
    const status = await bridgeStatus(options);

    assert.equal(status.installed, true);
    assert.deepEqual(status.allowedOrigins, [`chrome-extension://${'a'.repeat(32)}/`]);
  });

  it('notices when the entry the launcher names has gone away', async () => {
    // Moving or deleting the repository leaves a manifest that parses, a
    // launcher that is executable, and an entry that is not there. Nothing
    // else in the system would ever mention it — Chrome reports it with the
    // same message as two other causes.
    //
    // Written directly rather than installed: `installBridge` verifies by
    // *running* the launcher, so an install pointed at a throwaway entry
    // would fail verification and remove the very files this is about. What
    // is under test here is the reader, not the writer.
    await installBridge(options);
    const launcherPath = path.join(options.launcherDir, 'headerlab-host');
    const gone = path.join(root, 'moved-away.mjs');
    writeFileSync(launcherPath, `#!/bin/sh\nexec '${process.execPath}' '${gone}' "$@"\n`, {
      mode: 0o700,
    });

    const status = await bridgeStatus(options);

    assert.equal(status.installed, true);
    assert.equal(status.launcherMissing, false);
    assert.equal(status.entryMissing, true);
  });

  it('does not cry entryMissing on a healthy install', async () => {
    // Absence before presence: a `entryMissing: true` constant passes the test
    // above.
    await installBridge(options);
    const status = await bridgeStatus(options);
    assert.equal(status.entryMissing, false);
  });
});
