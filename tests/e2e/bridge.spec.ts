import { execFileSync } from 'node:child_process';
import { expect, findBridgePid, test } from './bridge-fixtures';

/**
 * The only test in this repository that exercises the whole bridge: a real
 * CLI process, a real unix socket, a real native messaging host launched by a
 * real Chrome, and a real service worker writing real storage. Everything
 * else in the suite proves one link.
 */

/**
 * `@types/chrome` is not in this project's type program, so `tsc --noEmit`
 * reports TS2503 without a declaration — the same reason
 * `header-modification.spec.ts` carries one. Declare only what is touched
 * here rather than reaching for `any`.
 */
declare const chrome: {
  storage: { local: { get(key: string): Promise<Record<string, unknown>> } };
};

test('the id computed from the load path is the id Chrome assigned', async ({
  extensionId,
  derivedId,
}) => {
  // `allowed_origins` takes no wildcard, so the manifest is written before
  // launch from a value nothing had confirmed. This is that confirmation, and
  // it is the reason the installer may compute an id but must report it.
  expect(derivedId).toEqual(extensionId);
});

test('a CLI command reaches storage through the bridge', async ({
  serviceWorker,
  extensionId,
  bridgeSocketDir,
}) => {
  // The port opens at worker startup because the e2e build holds the
  // permission outright. Wait for the host to have bound rather than for a
  // duration — a duration photographs whichever moment the machine landed on,
  // which is the same trap `scripts/screenshots.mjs` documents for its waits.
  const origin = `chrome-extension://${extensionId}/`;
  await expect
    .poll(() => findBridgePid(bridgeSocketDir, origin), { timeout: 15_000 })
    .not.toBeNull();
  const pid = findBridgePid(bridgeSocketDir, origin);

  const stdout = execFileSync(
    process.execPath,
    ['packages/headerlab/bin/headerlab.mjs', '--bridge', String(pid), 'site', 'add', 'example.com'],
    { encoding: 'utf8' },
  );
  const reply = JSON.parse(stdout);

  expect(reply.ok).toBe(true);
  expect(reply.changed).toBe(true);

  // Read it back out of the browser, not off the reply. The reply is what the
  // adapter *said*; storage is what a reconcile will actually compile.
  const stored = (await serviceWorker.evaluate(async () => {
    const { state } = await chrome.storage.local.get('state');
    return state;
  })) as { profiles: Array<{ filter: { domains: string[] } }> };
  // The exact list, not "contains". A reducer that appended the domain twice,
  // or that replaced the list instead of adding to it, both pass a containment
  // check and neither is what `site add` means.
  expect(stored.profiles[0]!.filter.domains).toEqual(['example.com']);
});

test('the popup says the bridge is live', async ({ context, extensionId, bridgeSocketDir }) => {
  await expect
    .poll(() => findBridgePid(bridgeSocketDir, `chrome-extension://${extensionId}/`), {
      timeout: 15_000,
    })
    .not.toBeNull();

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  // The whole point of the row: a person who did not run the CLI can still see
  // that an agent could. `toHaveAttribute` retries, so this is not a race.
  await expect(page.getByTestId('bridgestate')).toHaveAttribute('data-bridge', 'live');
});
