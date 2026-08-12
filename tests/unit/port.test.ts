import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declaresRegexMode, disconnectBridge, refreshBridge } from '@/lib/bridge/port';
import { getBridgeStatus } from '@/lib/storage/session';
import { setState } from '@/lib/storage/state';
import { bootstrapProfile, DEFAULT_STATE } from '@/lib/model/defaults';
import type { AppState } from '@/lib/model/types';

/**
 * `chrome.runtime.connectNative` is what this adapter calls, and it is the one
 * function the WXT `browser` wrapper does not expose — measured, the spike saw
 * `TypeError: t.runtime.connectNative is not a function`. fake-browser does
 * define it, as a stub that throws. So the port under test is a hand-planted
 * `globalThis.chrome`, not a fake-browser mock.
 */
interface FakePort {
  messages: unknown[];
  disconnected: boolean;
  onMessage: { addListener: (fn: (message: unknown) => void) => void };
  onDisconnect: { addListener: (fn: () => void) => void };
  postMessage: (message: unknown) => void;
  disconnect: () => void;
  /** Drives the extension side: hand it what the host would have sent. */
  send: (message: unknown) => void;
  /** Drives Chrome's side: pretend the host died. */
  die: (message: string | null) => void;
}

function makePort(): FakePort {
  let onMessage: (message: unknown) => void = () => {};
  let onDisconnect: () => void = () => {};
  const port: FakePort = {
    messages: [],
    disconnected: false,
    onMessage: {
      addListener: (fn) => {
        onMessage = fn;
      },
    },
    onDisconnect: {
      addListener: (fn) => {
        onDisconnect = fn;
      },
    },
    postMessage: (message) => port.messages.push(message),
    disconnect: () => {
      port.disconnected = true;
    },
    send: (message) => onMessage(message),
    die: (message) => {
      lastError = message === null ? undefined : { message };
      onDisconnect();
      lastError = undefined;
    },
  };
  return port;
}

let lastError: { message: string } | undefined;
let ports: FakePort[] = [];
let connectNative: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  fakeBrowser.reset();
  ports = [];
  lastError = undefined;
  connectNative = vi.fn(() => {
    const port = makePort();
    ports.push(port);
    return port;
  });
  Reflect.set(globalThis, 'chrome', {
    runtime: {
      connectNative,
      get lastError() {
        return lastError;
      },
    },
  });
  vi.spyOn(fakeBrowser.permissions, 'contains').mockImplementation((async () => true) as never);
  await setState(DEFAULT_STATE);
});

afterEach(() => {
  disconnectBridge();
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, 'chrome');
});

/** Lets the adapter's floating promises settle before an assertion reads storage. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('opening the port', () => {
  it('does not connect at all when the permission is not held', async () => {
    vi.spyOn(fakeBrowser.permissions, 'contains').mockImplementation((async () => false) as never);

    await refreshBridge();

    // Zero calls, not "a call that failed". Connecting without the permission
    // is what would make Chrome show the host-not-found error to a user who
    // never asked for a bridge at all.
    expect(connectNative).toHaveBeenCalledTimes(0);
    expect(await getBridgeStatus()).toEqual({
      connected: false,
      lastCommandAt: null,
      lastError: null,
    });
  });

  it('connects by the host name the installer writes', async () => {
    await refreshBridge();
    expect(connectNative.mock.calls).toEqual([['com.headerlab.bridge']]);
  });

  it('does not open a second port when one is already open', async () => {
    await refreshBridge();
    await refreshBridge();
    expect(connectNative).toHaveBeenCalledTimes(1);
  });

  it('closes the port when the permission goes away', async () => {
    await refreshBridge();
    const [port] = ports;
    vi.spyOn(fakeBrowser.permissions, 'contains').mockImplementation((async () => false) as never);

    await refreshBridge();

    expect(port!.disconnected).toBe(true);
    expect((await getBridgeStatus()).connected).toBe(false);
  });
});

describe('reconnection is bounded', () => {
  it('retries a dropped port but stops before it becomes a loop', async () => {
    // The host manifest being absent is not a transient fault: Chrome returns
    // a Port and then disconnects it, every time, forever. An unbounded retry
    // here is an infinite spawn loop against a machine that will never
    // succeed — which is why the count is asserted exactly rather than
    // "more than one".
    await refreshBridge();
    for (let i = 0; i < 10; i += 1) {
      ports.at(-1)!.die('Specified native messaging host not found.');
      await settle();
    }

    expect(connectNative).toHaveBeenCalledTimes(3);
    const status = await getBridgeStatus();
    expect(status.connected).toBe(false);
    expect(status.lastError).toEqual('Specified native messaging host not found.');
  });

  it('lets a later trigger try again after the budget is spent', async () => {
    // The budget is per-episode, not per-session. `onStartup` and a permission
    // grant both funnel into refreshBridge(), and a user who has just run
    // `headerlab bridge install` must not have to reload the extension.
    await refreshBridge();
    for (let i = 0; i < 5; i += 1) {
      ports.at(-1)!.die('Native host has exited.');
      await settle();
    }
    expect(connectNative).toHaveBeenCalledTimes(3);

    await refreshBridge();

    expect(connectNative).toHaveBeenCalledTimes(4);
  });

  it('records a disconnect that carries no message without inventing one', async () => {
    await refreshBridge();
    ports.at(-1)!.die(null);
    await settle();

    // `null`, not the string "undefined" and not a sentence this file wrote.
    // The popup renders a note only when there is something to say.
    expect((await getBridgeStatus()).lastError).toBeNull();
  });
});

describe('applying a command', () => {
  it('echoes the request id back — nothing else can correlate a reply', async () => {
    // The host broadcasts every extension reply to every connected socket
    // client with no pairing of its own, so two concurrent `headerlab`
    // invocations would each read the other's answer. The contract is written
    // down in packages/cli/lib/bridge.mjs's sendCommand docblock; this is the
    // assertion that holds the extension's half of it.
    await refreshBridge();
    const port = ports[0]!;

    port.send({ id: 'abc', command: { cmd: 'pause' } });
    await settle();

    expect(port.messages).toHaveLength(1);
    expect((port.messages[0] as { id: string }).id).toEqual('abc');
  });

  it('writes the applied state to storage', async () => {
    await refreshBridge();
    const port = ports[0]!;

    port.send({ id: '1', command: { cmd: 'pause' } });
    await settle();

    const { getState } = await import('@/lib/storage/state');
    expect((await getState()).globalPause).toBe(true);
    expect(port.messages[0]).toMatchObject({ ok: true, changed: true });
  });

  it('does not write when nothing changed', async () => {
    // `changed` is a different fact from `ok` (protocol.ts). A write here
    // would fire `stateItem.watch`, which fires reconcile(), which replaces
    // every DNR rule — for a command that asked for a state already true.
    const seen: AppState[] = [];
    await refreshBridge();
    const { stateItem } = await import('@/lib/storage/state');
    const unwatch = stateItem.watch((value) => {
      if (value) seen.push(value);
    });

    ports[0]!.send({ id: '1', command: { cmd: 'resume' } });
    await settle();
    unwatch();

    expect(seen).toEqual([]);
    expect(ports[0]!.messages[0]).toMatchObject({ ok: true, changed: false });
  });

  it('answers an unparseable command with invalid-command rather than dying', async () => {
    // An uncaught throw inside onMessage kills nothing visibly and leaves the
    // CLI waiting out its ten-second timeout for a reply that is never coming.
    await refreshBridge();
    const port = ports[0]!;

    port.send({ id: '1', command: { cmd: 'nope' } });
    await settle();

    expect(port.messages).toHaveLength(1);
    expect(port.messages[0]).toMatchObject({
      id: '1',
      ok: false,
      error: { code: 'invalid-command' },
    });
  });

  it('drops a message with no id — there is nobody to answer', async () => {
    await refreshBridge();
    const port = ports[0]!;

    port.send({ command: { cmd: 'pause' } });
    await settle();

    // Silence rather than a reply nobody can match. Posting an id-less reply
    // would be delivered to *every* connected client and discarded by each.
    expect(port.messages).toEqual([]);
  });

  it('records when a command was applied, and only when one was', async () => {
    await refreshBridge();
    const port = ports[0]!;

    port.send({ id: '1', command: { cmd: 'resume' } });
    await settle();
    expect((await getBridgeStatus()).lastCommandAt).toBeNull();

    port.send({ id: '2', command: { cmd: 'pause' } });
    await settle();
    expect((await getBridgeStatus()).lastCommandAt).not.toBeNull();
  });
});

describe('the two refusals', () => {
  it('refuses to write onto a store it could not read', async () => {
    // The measured failure this guards: `loadState()` hands back DEFAULT_STATE
    // when the bytes fail validation, and applying onto that and writing it
    // destroys whatever was really on disk. The popup already paid for this
    // once (App.tsx: `if (!valid) return`).
    await fakeBrowser.storage.local.set({ state: { profiles: 'not an array' } });
    await refreshBridge();
    const port = ports[0]!;

    port.send({ id: '1', command: { cmd: 'pause' } });
    await settle();

    expect(port.messages[0]).toMatchObject({
      id: '1',
      ok: false,
      error: { code: 'store-unreadable' },
    });
    // And the bytes are still there. This is the assertion that fails if
    // someone "fixes" the refusal by resetting the store first.
    expect(await fakeBrowser.storage.local.get('state')).toEqual({
      state: { profiles: 'not an array' },
    });
  });

  it('refuses a state.set that declares a regex filter', async () => {
    await refreshBridge();
    const port = ports[0]!;
    const profile = bootstrapProfile();
    const payload = {
      ...DEFAULT_STATE,
      profiles: [{ ...profile, filter: { ...profile.filter, mode: 'regex', regex: '.*' } }],
    };

    port.send({ id: '1', command: { cmd: 'state.set', state: payload } });
    await settle();

    expect(port.messages[0]).toMatchObject({
      id: '1',
      ok: false,
      error: { code: 'unsupported' },
    });
  });

  it('lets an ordinary state.set through', async () => {
    // Absence before presence: without this, "refuse everything" passes the
    // test above.
    await refreshBridge();
    const port = ports[0]!;

    port.send({ id: '1', command: { cmd: 'state.set', state: DEFAULT_STATE } });
    await settle();

    expect(port.messages[0]).toMatchObject({ id: '1', ok: true });
  });
});

describe('declaresRegexMode', () => {
  it.each([
    ['a payload that is not an object', 'nope', false],
    ['a payload with no profiles', {}, false],
    ['profiles that is not an array', { profiles: 5 }, false],
    ['a domains-mode profile', { profiles: [{ filter: { mode: 'domains' } }] }, false],
    ['a regex-mode profile', { profiles: [{ filter: { mode: 'regex' } }] }, true],
    [
      'a regex-mode profile hiding behind a good one',
      { profiles: [{ filter: { mode: 'domains' } }, { filter: { mode: 'regex' } }] },
      true,
    ],
  ])('%s → %s', (_label, payload, expected) => {
    expect(declaresRegexMode(payload)).toBe(expected);
  });
});
