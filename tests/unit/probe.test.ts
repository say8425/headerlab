import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeGrants, requestHost } from '@/lib/permissions/probe';

// fake-browser defines permissions.* as stubs that THROW ("not implemented"),
// exactly as it does for declarativeNetRequest — measured, see
// docs/research/2026-08-01-permission-audit-spike.md §5. Spies are the only
// way to exercise this layer, and `fakeBrowser.reset()` does not remove them,
// so `vi.restoreAllMocks()` has to.
const perms = () => fakeBrowser.permissions;

type ContainsArg = { origins?: string[] };

beforeEach(() => {
  fakeBrowser.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('probeGrants', () => {
  it('asks one origin per call — a batch would lose every answer to one bad member', async () => {
    const calls: string[][] = [];
    vi.spyOn(perms(), 'contains').mockImplementation((async (p: ContainsArg) => {
      calls.push(p.origins ?? []);
      return false;
    }) as never);

    await probeGrants(['example.com']);

    expect(calls.length).toBeGreaterThan(1);
    for (const origins of calls) expect(origins).toHaveLength(1);
  });

  it('reports granted as soon as a candidate matches, and stops asking', async () => {
    const asked: string[] = [];
    vi.spyOn(perms(), 'contains').mockImplementation((async (p: ContainsArg) => {
      const origin = p.origins?.[0] ?? '';
      asked.push(origin);
      return origin === 'https://example.com/*';
    }) as never);

    expect(await probeGrants(['example.com'])).toEqual([{ domain: 'example.com', granted: true }]);
    expect(asked).toEqual(['https://example.com/*']);
  });

  it('finds a grant on the http rung — the loopback case', async () => {
    vi.spyOn(perms(), 'contains').mockImplementation(
      (async (p: ContainsArg) => p.origins?.[0] === 'http://127.0.0.1/*') as never,
    );
    expect(await probeGrants(['127.0.0.1'])).toEqual([{ domain: '127.0.0.1', granted: true }]);
  });

  it('reports ungranted when every candidate says no', async () => {
    vi.spyOn(perms(), 'contains').mockResolvedValue(false as never);
    expect(await probeGrants(['example.com'])).toEqual([{ domain: 'example.com', granted: false }]);
  });

  it('survives a candidate that throws and keeps checking the rest', async () => {
    vi.spyOn(perms(), 'contains').mockImplementation((async (p: ContainsArg) => {
      const origin = p.origins?.[0] ?? '';
      if (origin.startsWith('https://')) throw new Error('Invalid value for origin pattern');
      return origin === 'http://example.com/*';
    }) as never);
    expect(await probeGrants(['example.com'])).toEqual([{ domain: 'example.com', granted: true }]);
  });

  it('reports ungranted, not a rejection, when every candidate throws', async () => {
    vi.spyOn(perms(), 'contains').mockRejectedValue(new Error('Invalid port.') as never);
    await expect(probeGrants(['example.com'])).resolves.toEqual([
      { domain: 'example.com', granted: false },
    ]);
  });

  it('keeps one bad host from poisoning another host answer', async () => {
    vi.spyOn(perms(), 'contains').mockImplementation((async (p: ContainsArg) => {
      const origin = p.origins?.[0] ?? '';
      if (origin.includes('bad')) throw new Error('Invalid port.');
      return origin === 'https://good.com/*';
    }) as never);
    expect(await probeGrants(['bad.com', 'good.com'])).toEqual([
      { domain: 'bad.com', granted: false },
      { domain: 'good.com', granted: true },
    ]);
  });

  it('returns an empty list without calling the browser for no hosts', async () => {
    const spy = vi.spyOn(perms(), 'contains').mockResolvedValue(false as never);
    expect(await probeGrants([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('echoes the host back verbatim — auditDiagnostics looks it up by exact string, not by re-normalizing', async () => {
    // A host that is not already in normalized form: if the implementation
    // echoed `normalizeDomain(host)` instead of `host` itself, this would
    // come back lowercased and the assertion below would catch it.
    vi.spyOn(perms(), 'contains').mockResolvedValue(true as never);
    const [grant] = await probeGrants(['Example.COM']);
    expect(grant?.domain).toBe('Example.COM');
  });
});

describe('requestHost', () => {
  it('requests the broad pattern, not the narrow one', async () => {
    const seen: string[] = [];
    vi.spyOn(perms(), 'request').mockImplementation((async (p: ContainsArg) => {
      seen.push(...(p.origins ?? []));
      return true;
    }) as never);

    expect(await requestHost('example.com')).toBe(true);
    expect(seen).toEqual(['*://*.example.com/*']);
  });

  it('reports false rather than rejecting when the request throws', async () => {
    vi.spyOn(perms(), 'request').mockRejectedValue(new Error('user gesture required') as never);
    await expect(requestHost('example.com')).resolves.toBe(false);
  });
});
