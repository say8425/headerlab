/// <reference types="chrome" />
import { apply } from '@/lib/bridge/apply';
import { parseCommand, parseQuery } from '@/lib/bridge/protocol';
import { status } from '@/lib/bridge/query';
import { probeNativeMessaging } from '@/lib/permissions/probe';
import { loadState, setState } from '@/lib/storage/state';
import { patchBridgeStatus } from '@/lib/storage/session';
import type { ApplyResult } from '@/lib/bridge/protocol';
import type { StatusPayload } from '@/lib/bridge/query';
import type { LoadedState } from '@/lib/storage/state';

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
 * manifest under exactly this name — `packages/headerlab/lib/manifest.mjs` holds
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
 * The `onDisconnect` listener guards on identity (`if (port !== current)
 * return`) regardless of which side triggers it: a port superseded by a
 * later connect must not be able to reset the newer one's state from its own
 * teardown, whether or not this call itself also fires that listener.
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
    reportStatusFailure(
      patchBridgeStatus({
        connected: false,
        lastError: error instanceof Error ? error.message : String(error),
      }),
    );
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
    reportStatusFailure(patchBridgeStatus({ connected: false, lastError: message }));
    if (attempts < MAX_CONNECT_ATTEMPTS) connect();
  });

  // Optimistic, and corrected within milliseconds by the listener above if the
  // host is not really there. The alternative — waiting for a round trip
  // before saying so — would leave the popup showing `idle` for every healthy
  // bridge until someone happened to run a command.
  reportStatusFailure(patchBridgeStatus({ connected: true, lastError: null }));
}

/**
 * Every caller here is fire-and-forget — `void patchBridgeStatus(...)`, on an
 * event chain nothing else awaits. Without this wrapper such a failure is
 * **silent**: not merely unreported, but invisible.
 *
 * That is worth stating precisely, because the obvious guess is wrong and the
 * wrong guess is the dangerous one. `patchBridgeStatus` keeps its queue alive
 * by chaining `pending = result.catch(() => {})` (lib/storage/session.ts), and
 * attaching *any* rejection handler marks a promise handled for V8's
 * unhandled-rejection tracking — regardless of what becomes of the derived
 * promise, and regardless of whether anyone ever touches the original. So a
 * dropped rejection here does not even produce the console noise someone
 * skipping this wrapper would be counting on noticing.
 *
 * Measured rather than reasoned: the same chain shape called fire-and-forget
 * emits nothing and fires no `unhandledRejection`, while the identical
 * rejection with no split baton fires it. Do not add a fire-and-forget
 * `patchBridgeStatus(...)` call site without this wrapper on the theory that
 * a failure would announce itself — it would not.
 *
 * Same shape as `recordStatus`/`recordIcon` in lib/sync/ruleSync.ts: a side
 * record's failure must not become the caller's failure, and must not go
 * unreported.
 */
function reportStatusFailure(result: Promise<void>): void {
  result.catch((error) => {
    console.error('[HeaderLab] failed to record bridge status', error);
  });
}

function reply(
  current: chrome.runtime.Port,
  id: string,
  result: ApplyResult | ({ ok: true } & StatusPayload),
): void {
  current.postMessage({ id, ...result });
}

async function handleMessage(current: chrome.runtime.Port, message: unknown): Promise<void> {
  const envelope = message as { id?: unknown; command?: unknown };
  const id = typeof envelope?.id === 'string' ? envelope.id : null;
  // No id means no reply is deliverable: the host broadcasts to every socket
  // client, and each of them discards what does not match its own id. Better
  // to drop it than to send something every listener throws away.
  if (id === null) return;

  // 읽기를 먼저 시도한다. `querySchema` 에 맞으면 리듀서를 거치지 않고
  // 답한다 — 상태를 바꾸지 않으므로 거칠 이유가 없다 (protocol.ts).
  let query;
  try {
    query = parseQuery(envelope.command);
  } catch {
    query = null;
  }

  if (query !== null) {
    let loaded: LoadedState;
    try {
      loaded = await loadState();
    } catch (error) {
      reply(current, id, {
        ok: false,
        error: {
          code: 'store-unwritable',
          message: `the store could not be read: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
      return;
    }
    if (!loaded.valid) {
      // 검증에 실패한 바이트를 사람에게 "상태" 라고 보여주는 것은 이
      // 저장소가 금지하는 "닿을 수 없는 것을 보여주기" 다. 쓰기와 같은
      // 코드로 답한다.
      reply(current, id, {
        ok: false,
        error: {
          code: 'store-unreadable',
          message:
            'the stored state does not match the format this version expects, so there is ' +
            'nothing safe to report',
        },
      });
      return;
    }
    // `patchBridgeStatus({lastCommandAt})` 를 부르지 않는다 — 읽기는
    // 명령이 아니고, 읽었다는 이유로 마지막 명령 시각이 움직이면 팝업이
    // 거짓말을 하게 된다.
    reply(current, id, { ok: true, ...status(loaded.state) });
    return;
  }

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

  // loadState() itself can reject — not just answer `valid: false` — when the
  // underlying stateItem.getValue() throws (a chrome.storage.local read
  // failure, or the extension torn down mid-read). Unguarded, that rejection
  // would propagate out of this async function with nobody awaiting it (the
  // listener above does `void handleMessage(...)`), so reply() below would
  // never run and the CLI would wait out its ten-second timeout and report
  // `timeout` — the transport blamed for a failure that was storage.
  let loaded: LoadedState;
  try {
    loaded = await loadState();
  } catch (error) {
    reply(current, id, {
      ok: false,
      error: {
        code: 'store-unwritable',
        message: `the store could not be read: ${error instanceof Error ? error.message : String(error)}`,
      },
    });
    return;
  }
  const { state, valid } = loaded;
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
    // Same shape as the loadState() guard above, for the write side. An
    // unguarded stateItem.setValue() rejecting here would skip reply()
    // entirely, for the identical reason patchBridgeStatus's own rejection is
    // caught a few lines below — except this call is the state write itself,
    // not an informational timestamp, so its failure has to reach the caller
    // as an answer rather than be caught and merely logged.
    try {
      await setState(result.state);
    } catch (error) {
      reply(current, id, {
        ok: false,
        error: {
          code: 'store-unwritable',
          message: `the applied state could not be written: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
      return;
    }
    // The state write above already succeeded — the reply below is the
    // truthful thing regardless of whether this purely informational
    // timestamp lands. Awaited rather than fire-and-forget (unlike connect()'s
    // writes) specifically so its own `.catch` runs *before* `reply()`, not
    // racing it: letting the rejection propagate past this point would skip
    // `reply()` entirely, leaving the CLI to wait out its timeout for an
    // answer to a command that already applied.
    await patchBridgeStatus({ lastCommandAt: new Date().toISOString() }).catch((error) => {
      console.error('[HeaderLab] failed to record bridge status', error);
    });
  }
  reply(current, id, result);
}
