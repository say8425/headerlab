/// <reference types="chrome" />
import { apply } from '@/lib/bridge/apply';
import { parseCommand } from '@/lib/bridge/protocol';
import { probeNativeMessaging } from '@/lib/permissions/probe';
import { loadState, setState } from '@/lib/storage/state';
import { patchBridgeStatus } from '@/lib/storage/session';
import type { ApplyResult } from '@/lib/bridge/protocol';

/**
 * The one module permitted to call chrome.runtime.connectNative — and it calls
 * `chrome`, not `browser`, because the WXT wrapper does not expose that
 * function at all (measured: `TypeError: t.runtime.connectNative is not a
 * function`).
 *
 * Deliberately **not** in tests/unit/purity.test.ts's list, for the same
 * reason lib/permissions/probe.ts is not: this is the thin adapter the pure
 * layer exists to keep browser calls out of. That is why lib/bridge/ has no
 * directory-shaped purity rule and its two pure files are named one by one.
 *
 * It makes no decisions about what a command means. `parseCommand` validates,
 * `apply()` decides, `setState` writes — and `stateItem.watch` already calls
 * `reconcile()`, so this is a new trigger on the single reconcile loop rather
 * than a second writer.
 */

/**
 * The name Chrome looks up in NativeMessagingHosts. The installer writes a
 * manifest under exactly this name — `packages/host/lib/manifest.mjs` holds
 * the other spelling, and tests/unit/bridgeName.test.ts pins the two together
 * because nothing else can: one is TypeScript bundled into the extension and
 * the other is Node the extension must never import.
 */
export const NATIVE_HOST_NAME = 'com.headerlab.bridge';

/**
 * Consecutive connect attempts before the adapter stops.
 *
 * Not a tuning knob — a correctness bound. Three of the states that break a
 * connect (a missing manifest, a manifest naming a different extension, an
 * interpreter that cannot start) are permanent, and Chrome reports all three
 * with the same message, so nothing here can tell them from a transient fault.
 * An unbounded retry against a permanent fault is an infinite spawn loop. The
 * budget is per episode: `refreshBridge()` resets it, and every lifecycle
 * trigger calls that.
 */
export const MAX_CONNECT_ATTEMPTS = 3;

let port: chrome.runtime.Port | null = null;
let attempts = 0;

/**
 * Whether a `state.set` payload asks for a regex filter.
 *
 * Design §3.1: `appStateSchema` accepts `filter.mode: 'regex'` with any string
 * beside it, and `filterToCondition` compiles that straight into `regexFilter`
 * — with nothing having asked
 * `chrome.declarativeNetRequest.isRegexSupported()`, which is the only
 * authority on RE2 validity. The popup has no regex editor, so such a rule
 * would be applied and invisible: state the UI cannot show, still modifying
 * headers.
 *
 * Read off the raw payload rather than the parsed one, and kept out of the
 * pure layer on purpose — `apply()` goes on accepting everything
 * `parseAppState` accepts, so when the regex UI is built this judgment is
 * deleted from one file rather than found in two.
 */
export function declaresRegexMode(payload: unknown): boolean {
  const profiles = (payload as { profiles?: unknown })?.profiles;
  if (!Array.isArray(profiles)) return false;
  return profiles.some(
    (profile) => (profile as { filter?: { mode?: unknown } })?.filter?.mode === 'regex',
  );
}

/**
 * Brings the port in line with the permission: open one if the permission is
 * held and none is open, close the one that exists if it is not.
 *
 * Every lifecycle trigger funnels here — the same shape `reconcile()` has, and
 * for the same reason. It is deliberately **not** wired to `stateItem.watch`:
 * a state write is not a reason to re-open a native port, and doing so would
 * make every command this adapter applies re-enter it.
 */
export async function refreshBridge(): Promise<void> {
  const allowed = await probeNativeMessaging();
  if (!allowed) {
    disconnectBridge();
    attempts = 0;
    await patchBridgeStatus({ connected: false, lastError: null });
    return;
  }
  if (port !== null) return;
  attempts = 0;
  connect();
}

/**
 * Closes the port without arming a retry.
 *
 * Chrome does not fire `onDisconnect` on the side that called `disconnect()`,
 * but the listener guards on identity anyway — a port superseded by a later
 * connect must not be able to reset the newer one's state from its own
 * teardown.
 */
export function disconnectBridge(): void {
  const closing = port;
  port = null;
  closing?.disconnect();
}

function connect(): void {
  attempts += 1;
  let current: chrome.runtime.Port;
  try {
    current = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  } catch (error) {
    port = null;
    void patchBridgeStatus({
      connected: false,
      lastError: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  port = current;

  current.onMessage.addListener((message: unknown) => {
    void handleMessage(current, message);
  });

  current.onDisconnect.addListener(() => {
    // Chrome's message is only readable inside this callback, and it is the
    // only account of the failure that exists — read it first, decide after.
    const message = chrome.runtime.lastError?.message ?? null;
    if (port !== current) return;
    port = null;
    void patchBridgeStatus({ connected: false, lastError: message });
    if (attempts < MAX_CONNECT_ATTEMPTS) connect();
  });

  // Optimistic, and corrected within milliseconds by the listener above if the
  // host is not really there. The alternative — waiting for a round trip
  // before saying so — would leave the popup showing `idle` for every healthy
  // bridge until someone happened to run a command.
  void patchBridgeStatus({ connected: true, lastError: null });
}

function reply(current: chrome.runtime.Port, id: string, result: ApplyResult): void {
  current.postMessage({ id, ...result });
}

async function handleMessage(current: chrome.runtime.Port, message: unknown): Promise<void> {
  const envelope = message as { id?: unknown; command?: unknown };
  const id = typeof envelope?.id === 'string' ? envelope.id : null;
  // No id means no reply is deliverable: the host broadcasts to every socket
  // client, and each of them discards what does not match its own id. Better
  // to drop it than to send something every listener throws away.
  if (id === null) return;

  let command;
  try {
    command = parseCommand(envelope.command);
  } catch (error) {
    reply(current, id, {
      ok: false,
      error: {
        code: 'invalid-command',
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return;
  }

  if (command.cmd === 'state.set' && declaresRegexMode(command.state)) {
    reply(current, id, {
      ok: false,
      error: {
        code: 'unsupported',
        message:
          'this build refuses a regex filter: there is no regex editor in the popup and ' +
          'nothing validates the pattern, so the rule would apply with no way to see or fix it',
      },
    });
    return;
  }

  const { state, valid } = await loadState();
  if (!valid) {
    reply(current, id, {
      ok: false,
      error: {
        code: 'store-unreadable',
        message:
          'the stored state does not match the format this version expects, so nothing was ' +
          'applied and nothing was overwritten',
      },
    });
    return;
  }

  const result = apply(state, command);
  if (result.ok && result.changed) {
    await setState(result.state);
    await patchBridgeStatus({ lastCommandAt: new Date().toISOString() });
  }
  reply(current, id, result);
}
