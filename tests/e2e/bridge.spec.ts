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
  storage: {
    local: { get(key: string): Promise<Record<string, unknown>> };
    session: { get(key: string): Promise<Record<string, unknown>> };
  };
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

test('a read command comes back through the bridge with what the popup would show', async ({
  serviceWorker,
  extensionId,
  bridgeSocketDir,
}) => {
  const origin = `chrome-extension://${extensionId}/`;
  await expect
    .poll(() => findBridgePid(bridgeSocketDir, origin), { timeout: 15_000 })
    .not.toBeNull();
  const pid = findBridgePid(bridgeSocketDir, origin);

  // Write first — there has to be something to read for reading to prove anything.
  const addStdout = execFileSync(
    process.execPath,
    [
      'packages/headerlab/bin/headerlab.mjs',
      '--bridge',
      String(pid),
      'site',
      'add',
      'read-me.example.com',
    ],
    { encoding: 'utf8' },
  );
  expect(JSON.parse(addStdout).ok).toBe(true);

  // Both ways a read could write, sampled before the read so "unchanged" is
  // a comparison rather than an assertion about one snapshot. The earlier
  // version of this test claimed absence above a check that could see
  // neither: rewriting the identical bytes through `setState` passes a
  // local-storage equality check, and `patchBridgeStatus({lastCommandAt})`
  // writes *session* storage, which that check never read.
  const sample = () =>
    serviceWorker.evaluate(async () => {
      const { state } = await chrome.storage.local.get('state');
      const { bridgeStatus } = await chrome.storage.session.get('bridgeStatus');
      return { state, bridgeStatus };
    }) as Promise<{
      state: { profiles: Array<{ filter: { domains: string[] } }> };
      bridgeStatus: { lastCommandAt?: string | null } | undefined;
    }>;

  const before = await sample();

  const stdout = execFileSync(
    process.execPath,
    ['packages/headerlab/bin/headerlab.mjs', '--bridge', String(pid), 'rule', 'ls', '--json'],
    { encoding: 'utf8' },
  );
  const payload = JSON.parse(stdout);

  // Absence first: the read changed neither store. `lastCommandAt` is the
  // one a read is most likely to move by accident — the popup would then
  // report a command that never happened.
  const after = await sample();
  expect(after.state).toEqual(before.state);
  expect(after.bridgeStatus?.lastCommandAt).toEqual(before.bridgeStatus?.lastCommandAt);
  expect(after.state.profiles[0]!.filter.domains).toEqual(['read-me.example.com']);

  // Match what the extension actually holds, not the CLI's own claim about it.
  expect(payload.ok).toBe(true);
  expect(payload.scopingHosts).toEqual(['read-me.example.com']);
  expect(payload.state.profiles[0].filter.domains).toEqual(['read-me.example.com']);
  // One derived field, so the read path has end-to-end coverage of the part
  // the extension computes rather than copies — everything asserted above is
  // storage handed back unchanged.
  //
  // Measured, not assumed: this was first written as an all-zero tally on the
  // reasoning that `site add` creates no rules, and the exact assertion said
  // otherwise. `bootstrapProfile` ships the rule set with one blank rule, and
  // a blank rule is `unfinished` — not `blocked`, because nothing is stopping
  // it but the missing name (see `ruleTally`). So one total, one unfinished,
  // and — the part that matters for the read path — **zero live**, which is
  // the term `query.ts` was getting wrong.
  expect(payload.tally).toEqual({ total: 1, live: 0, off: 0, unfinished: 1, blocked: 0 });
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
