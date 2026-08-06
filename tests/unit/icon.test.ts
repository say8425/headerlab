import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ICON_PATHS, setToolbarIcon } from '@/lib/sync/icon';

/**
 * `chrome.action` is not part of `@webext-core/fake-browser`, so the spy is
 * planted by hand — the same way the DNR and permissions adapters are tested.
 * Planting it also means an implementation that stopped calling `setIcon`
 * altogether fails loudly here rather than passing on a no-op stub.
 */
const setIcon = vi.fn<(details: unknown) => Promise<void>>();

beforeEach(() => {
  fakeBrowser.reset();
  setIcon.mockReset().mockResolvedValue(undefined);
  (fakeBrowser as unknown as { action: unknown }).action = { setIcon };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('setToolbarIcon', () => {
  it('sends the colour set when running and the grey set when paused — and they differ', async () => {
    // The assertion that matters. "setIcon was called" passes against an
    // implementation that always sends the same picture, which is precisely
    // the bug: an icon that never changes is worse than no icon, because it
    // reports a state it is not tracking.
    await setToolbarIcon(false);
    await setToolbarIcon(true);

    expect(setIcon).toHaveBeenCalledTimes(2);
    const [running] = setIcon.mock.calls[0]! as [{ path: Record<string, string> }];
    const [paused] = setIcon.mock.calls[1]! as [{ path: Record<string, string> }];
    expect(running.path).toEqual({ 16: '/icon/active-16.png', 32: '/icon/active-32.png' });
    expect(paused.path).toEqual({ 16: '/icon/paused-16.png', 32: '/icon/paused-32.png' });
    expect(paused.path).not.toEqual(running.path);
  });

  it('offers both toolbar densities, because Chrome draws 16 at 1x and 32 at 2x', async () => {
    // Sending only one size leaves Chrome upscaling a 16 into a 32 slot on
    // every HiDPI screen, which is most of them.
    await setToolbarIcon(false);
    const [details] = setIcon.mock.calls[0]! as [{ path: Record<string, string> }];
    expect(Object.keys(details.path).sort()).toEqual(['16', '32']);
  });

  it('names two entirely distinct sets of files', () => {
    // Read off the table rather than a call, so a future edit that points both
    // states at one file is caught even if nothing calls the adapter.
    const active = Object.values(ICON_PATHS.active);
    const paused = Object.values(ICON_PATHS.paused);
    expect(active.some((p) => paused.includes(p as never))).toBe(false);
  });

  it('lets a setIcon failure reach the caller rather than swallowing it here', async () => {
    // The adapter stays honest; deciding that a cosmetic failure must not sink
    // a reconcile is the caller's call, and ruleSync makes it explicitly.
    setIcon.mockRejectedValue(new Error('no such icon'));
    await expect(setToolbarIcon(false)).rejects.toThrow('no such icon');
  });
});
