// @vitest-environment jsdom
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/entrypoints/popup/App';
import { createProfile } from '@/lib/model/defaults';
import * as probe from '@/lib/permissions/probe';
import type { AppState, Profile } from '@/lib/model/types';

function seed(state: AppState) {
  return fakeBrowser.storage.local.set({ state, state$: { v: 2 } });
}

function stored(): Promise<AppState> {
  return fakeBrowser.storage.local.get('state').then((s) => s.state as AppState);
}

function stateWith(over: Partial<AppState> = {}): AppState {
  const p = createProfile('Local', 0);
  return {
    version: 2,
    globalPause: false,
    theme: 'system',
    profiles: [
      {
        ...p,
        id: 'p1',
        filter: { ...p.filter, domains: ['api.example.com'] },
        headers: [
          { id: 'h1', enabled: true, target: 'request', operation: 'set', name: 'X-A', value: '1' },
          {
            id: 'h2',
            enabled: true,
            target: 'response',
            operation: 'set',
            name: 'X-B',
            value: '2',
          },
        ],
      },
    ],
    ...over,
  };
}

const readout = () => screen.getByTestId('readout').textContent;

beforeEach(() => {
  fakeBrowser.reset();
  // permissions.* are throwing stubs in fake-browser; the popup probes on mount.
  vi.spyOn(probe, 'probeGrants').mockResolvedValue([{ domain: 'api.example.com', granted: true }]);
  // The all-sites probe is a second, independent mount-time call. Answered
  // `true` by default so the fixtures above — which are all scoped, with the
  // mode off — never render an all-sites Grant button that the existing
  // `{ name: 'Grant' }` queries would then find beside the host ones.
  vi.spyOn(probe, 'probeAllSites').mockResolvedValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('App', () => {
  it('renders every rule from stored state as one list, request and response together', async () => {
    // No request/response grouping: the direction pill on each card says which
    // it is. Asserting the values in order is what would fail if the list were
    // split and reordered — finding one name would not.
    await seed(stateWith());
    render(<App />);
    await screen.findByDisplayValue('X-A');
    const names = screen
      .getAllByRole('textbox', { name: 'Header name' })
      .map((n) => (n as HTMLInputElement).value);
    expect(names).toEqual(['X-A', 'X-B']);
  });

  it('hangs a rule-level diagnostic inside that rule, never in the rail', async () => {
    // The whole point of the split: a problem about one rule stays in the
    // panel. Checking the text is present somewhere would pass an
    // implementation that put every diagnostic back into a band above the
    // rules, so both halves are asserted.
    const s = stateWith();
    // A typo, not a blank: a name the user actually got wrong is what earns an
    // error, and an error is what renders a problem block. A blank name is a
    // different state entirely — see the unfinished cases below.
    s.profiles[0]!.headers[0]!.name = 'X Session Id'; // invalid-header-name, headerRuleId: 'h1'
    await seed(s);
    render(<App />);

    const problems = await screen.findAllByTestId('rule-problem');
    expect(problems.some((el) => /Not a valid header name/.test(el.textContent ?? ''))).toBe(true);
    const notes = screen.queryAllByTestId('scope-note');
    expect(notes.some((el) => /not a valid header name/.test(el.textContent ?? ''))).toBe(false);
  });

  it('puts a scope diagnostic in the rail, never inside a rule', async () => {
    // The other direction of the same claim, and the reason the rail exists: in
    // the build this replaces every one of these stacked above the grid and
    // pushed the actual work off the screen.
    const s = stateWith();
    s.profiles[0]!.filter.domains = [];
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([]);
    await seed(s);
    render(<App />);

    const notes = await screen.findAllByTestId('scope-note');
    expect(notes.some((el) => /No site set/.test(el.textContent ?? ''))).toBe(true);
    expect(screen.queryAllByTestId('rule-problem')).toEqual([]);
  });

  it('stops counting rules as live when the whole app is paused', async () => {
    // `globalPause` makes compile.ts skip the rule-building block entirely, so
    // zero rules are registered — but it produces no diagnostic and no
    // rule-level judgement, so every card still looks healthy. Seeding the live
    // state first matters: an implementation that always reported 0 would pass
    // the paused assertion on its own.
    await seed(stateWith());
    render(<App />);
    await waitFor(() => expect(readout()).toBe('2of 2 rules liveno problems'));

    await seed(stateWith({ globalPause: true }));
    await waitFor(() => expect(readout()).toBe('0of 2 rules live2 blocked while paused'));
  });

  it('stops counting rules as live when the rule set is suppressed', async () => {
    // One usable domain and one that is not (a pasted URL — the input Phase 2a
    // recorded as its worst defect). isSuppressed is true, compile.ts skips the
    // whole set, zero rules are registered. The diagnostic it earns has no
    // headerRuleId, so nothing reaches the cards and every rule looks healthy.
    const s = stateWith();
    s.profiles[0]!.filter.domains = ['api.example.com', 'a b.com'];
    await seed(s);
    render(<App />);
    // "by an unusable site": the rules themselves are fine, so a bare
    // "2 blocked" would point the user at the wrong object entirely.
    await waitFor(() => expect(readout()).toBe('0of 2 rules live2 blocked by an unusable site'));
  });

  it('stops counting rules as live when the stored rule set is switched off', async () => {
    // Nothing in this UI can switch the rule set off — but legacy state can
    // hold one that is, and compile.ts:28 `continue`s before collecting any
    // diagnostic, deliberately. Zero rules registered, zero diagnostics, and
    // nothing anywhere to correct a readout still claiming they are live.
    await seed(stateWith());
    render(<App />);
    await waitFor(() => expect(readout()).toBe('2of 2 rules liveno problems'));

    const off = stateWith();
    off.profiles[0]!.enabled = false;
    await seed(off);
    await waitFor(() => expect(readout()).toBe('0of 2 rules live2 blocked'));
  });

  it('offers Grant on the site row itself, and requests only the host whose button was clicked', async () => {
    // Two distinct ungranted hosts: with only one possible host, a handler that
    // ignored its `host` argument and reused a fixed string would still pass.
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([
      { domain: 'host-a.example.com', granted: false },
      { domain: 'host-b.example.com', granted: false },
    ]);
    const requestHost = vi.spyOn(probe, 'requestHost').mockResolvedValue(true);
    const s = stateWith();
    s.profiles[0]!.filter.domains = ['host-a.example.com', 'host-b.example.com'];
    await seed(s);
    render(<App />);

    // Waiting on the site rows would settle on the first render, before the
    // (async) permission probe has said anything — the Grant buttons are what
    // the probe actually produces, so they are what to wait for.
    expect(await screen.findAllByRole('button', { name: 'Grant' })).toHaveLength(2);
    const sites = screen.getAllByTestId('site');
    expect(sites).toHaveLength(2);
    const second = sites.find((row) => /host-b\.example\.com/.test(row.textContent ?? ''));
    if (!second) throw new Error('expected a site row naming host-b.example.com');
    await userEvent.click(within(second).getByRole('button', { name: 'Grant' }));

    // One host per call — passing requiredOrigins as an array would let one bad
    // entry kill the whole request — and it must be the host whose Grant button
    // was actually clicked, not the other one.
    expect(requestHost).toHaveBeenCalledTimes(1);
    expect(requestHost).toHaveBeenCalledWith('host-b.example.com');
    expect(requestHost).not.toHaveBeenCalledWith('host-a.example.com');
  });

  it('recomputes grant diagnostics from state current when requestHost resolves, not the state captured when Grant was clicked', async () => {
    // probeGrants echoes back whichever hosts it is asked to check, all
    // ungranted, so the diagnostic that lands names exactly the domain set it
    // was called with — that is how this tells "used the state closed over at
    // click time" apart from "used the state once the prompt closed".
    const probeGrants = vi
      .spyOn(probe, 'probeGrants')
      .mockImplementation(async (hosts: readonly string[]) =>
        hosts.map((domain) => ({ domain, granted: false })),
      );
    let resolveRequest: (granted: boolean) => void = () => {};
    vi.spyOn(probe, 'requestHost').mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRequest = resolve;
        }),
    );

    await seed(stateWith());
    render(<App />);

    const grant = await screen.findByRole('button', { name: 'Grant' });
    await userEvent.click(grant); // onGrant('api.example.com') is awaiting requestHost
    expect(probeGrants).toHaveBeenCalledTimes(1); // just the mount-time probe so far

    // A second writer changes the domain while the (user-gesture gated,
    // genuinely slow) permission prompt is still open — the exact hazard
    // stateRef exists for.
    const changed = stateWith();
    changed.profiles[0]!.filter.domains = ['new-host.example.com'];
    await seed(changed);

    // Wait for the mount effect (App's other probeGrants caller, not onGrant)
    // to react to the external change — this count is monotonic, so waiting on
    // it proves React's `state` actually moved before the prompt resolves.
    await waitFor(() => expect(probeGrants).toHaveBeenCalledTimes(2));

    resolveRequest(true); // the prompt is answered; onGrant's continuation runs
    await waitFor(() => expect(probeGrants).toHaveBeenCalledTimes(3));

    // Flush the microtask tail of that third call before reading the DOM — a
    // `waitFor` here risks succeeding on its first, pre-flush check.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Read off the site rows rather than a message: a routine permission
    // prompt no longer spends a sentence saying what a Grant button beside a
    // hostname already says. The claim is unchanged — the diagnostics that
    // landed describe the domain current when the prompt resolved, not the one
    // captured when Grant was clicked — only its visible form moved.
    const rows = screen.getAllByTestId('site');
    expect(rows.map((r) => r.textContent ?? '').some((t) => /new-host\.example\.com/.test(t))).toBe(
      true,
    );
    expect(rows.map((r) => r.textContent ?? '').some((t) => /api\.example\.com/.test(t))).toBe(
      false,
    );
    // And it is the *pending* state that proves the recomputed audit reached
    // the row — a row rendered from state alone would look granted.
    expect(rows[0]!.getAttribute('data-state')).toBe('pending');
  });

  it('writes the pause switch through to storage', async () => {
    await seed(stateWith());
    render(<App />);
    const pause = await screen.findByRole('switch', { name: 'Pause all rules' });
    await userEvent.click(pause);
    await waitFor(async () => {
      expect((await stored()).globalPause).toBe(true);
    });
  });
});

describe('a fresh install', () => {
  it('opens on a rule that can be typed into, with no set-up step first', async () => {
    // `lib/model/defaults.ts` ships `profiles: []`, and this used to open on a
    // single "Create profile" button — a wall between the user and the one
    // thing the extension does. What replaces it has to be usable on sight: a
    // field, focused, that a header name goes into.
    await seed({ version: 1, globalPause: false, theme: 'system', profiles: [] });
    render(<App />);

    const name = await screen.findByRole('textbox', { name: 'Header name' });
    expect(name).toHaveProperty('value', '');
    expect(document.activeElement).toBe(name);
    expect(screen.queryByRole('button', { name: /Create profile/ })).toBeNull();
  });

  it('persists that rule set, so what is typed into it survives the popup closing', async () => {
    // It has to exist in storage, not only on screen. compile() reads storage;
    // a rule set living only in a React tree would take everything typed into
    // it along when the popup closes.
    await seed({ version: 1, globalPause: false, theme: 'system', profiles: [] });
    render(<App />);
    await screen.findByRole('textbox', { name: 'Header name' });

    await waitFor(async () => {
      const profiles = (await stored()).profiles;
      expect(profiles).toHaveLength(1);
      expect(profiles[0]!.headers).toHaveLength(1);
    });
    const only = (await stored()).profiles[0]!;
    expect(only.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(only.headers[0]).toMatchObject({
      enabled: true,
      target: 'request',
      operation: 'set',
      name: '',
      value: '',
    });
  });

  it('mints a different id per install, rather than one constant shared by all of them', async () => {
    // A module-level constant would call crypto.randomUUID() at import time —
    // once per module load, then handed to every install that module serves.
    await seed({ version: 1, globalPause: false, theme: 'system', profiles: [] });
    const { unmount } = render(<App />);
    await screen.findByRole('textbox', { name: 'Header name' });
    await waitFor(async () => expect((await stored()).profiles).toHaveLength(1));
    const first = (await stored()).profiles[0]!.id;
    unmount();

    fakeBrowser.reset();
    await seed({ version: 1, globalPause: false, theme: 'system', profiles: [] });
    render(<App />);
    await screen.findByRole('textbox', { name: 'Header name' });
    await waitFor(async () => expect((await stored()).profiles).toHaveLength(1));
    expect((await stored()).profiles[0]!.id).not.toBe(first);
  });
});

describe('a store that fails validation', () => {
  /** Plainly the user's work, but one enum this build cannot read. */
  function unreadable(): unknown {
    const s = stateWith();
    return {
      ...s,
      profiles: [
        {
          ...s.profiles[0]!,
          color: 'chartreuse',
          headers: [
            {
              id: 'h1',
              enabled: true,
              target: 'request',
              operation: 'set',
              name: 'X-Precious',
              value: 'do-not-lose-me',
            },
          ],
        },
      ],
    };
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('leaves the stored bytes exactly as they were, having been merely opened', async () => {
    // The blocker. `getState` returns DEFAULT_STATE for an invalid store, which
    // is indistinguishable from a fresh install — so the bootstrap minted a
    // profile onto the fallback and `patchState` wrote it over the real thing.
    // Opening the popup was enough to destroy someone's rules, with no user
    // action and nothing on screen.
    //
    // Asserting the *stored bytes* rather than the screen is the whole point: a
    // popup that merely looks right while the store is being overwritten
    // underneath is exactly the failure this is about.
    const before = unreadable();
    await fakeBrowser.storage.local.set({ state: before, state$: { v: 2 } });
    render(<App />);
    await screen.findByTestId('unreadable-store');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const after = (await fakeBrowser.storage.local.get('state')).state;
    expect(after).toEqual(before);
  });

  it('says so on screen, not only to a console in a window that has closed', async () => {
    await fakeBrowser.storage.local.set({ state: unreadable(), state$: { v: 2 } });
    render(<App />);

    const shown = await screen.findByTestId('unreadable-store');
    expect(shown.textContent).toContain('could not be read');
    expect(shown.textContent).toContain('Nothing has been changed or overwritten');
    // And emphatically not the working screen — no rail, no rules, nothing that
    // invites an edit that would write over the bytes still on disk.
    expect(screen.queryByTestId('readout')).toBeNull();
    expect(screen.queryAllByTestId('rule')).toEqual([]);
  });

  it('still writes the starter rule set when the store is merely empty', async () => {
    // The other side of the distinction: "empty" and "invalid" both arrive as
    // DEFAULT_STATE, and only one of them should be written to. Without this,
    // refusing to write on invalid could be achieved by never writing at all.
    await seed({ version: 1, globalPause: false, theme: 'system', profiles: [] });
    render(<App />);
    await screen.findByRole('textbox', { name: 'Header name' });
    await waitFor(async () => expect((await stored()).profiles).toHaveLength(1));
  });
});

describe('legacy state holding more than one rule set', () => {
  function threeSets(): AppState {
    const make = (id: string, name: string, order: number): Profile => {
      const p = createProfile(name, order);
      return {
        ...p,
        id,
        name,
        filter: { ...p.filter, domains: [`${id}.example.com`] },
        headers: [
          {
            id: `${id}-h`,
            enabled: true,
            target: 'request',
            operation: 'set',
            name: `X-${name}`,
            value: 'v',
          },
        ],
      };
    };
    return {
      version: 1,
      globalPause: false,
      theme: 'system',
      profiles: [make('pa', 'Alpha', 0), make('pb', 'Beta', 1), make('pc', 'Gamma', 2)],
    };
  }

  beforeEach(() => {
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([]);
  });

  it('removes the ones it cannot show from storage, not merely from the screen', async () => {
    // This is why truncation is a write. compile() reads storage, not this
    // screen — a rule set left behind goes on modifying headers with no way to
    // see it, switch it off, or find out where the change came from. Hiding it
    // would be exactly the silent failure this product exists to remove, so
    // asserting the DOM alone would let the real defect through.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seed(threeSets());
    render(<App />);

    await waitFor(async () => expect((await stored()).profiles).toHaveLength(1));
    expect((await stored()).profiles[0]!.id).toBe('pa');
  });

  it('keeps the set the previous build opened on, with its rules and its scope intact', async () => {
    // `profiles[0]` is what the old profile bar fell back to, so a user who
    // upgrades keeps looking at the rule set they were already looking at — and
    // it must arrive whole, not as a stub carrying the right id.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seed(threeSets());
    render(<App />);

    await waitFor(async () => expect((await stored()).profiles).toHaveLength(1));
    const kept = (await stored()).profiles[0]!;
    expect(kept.headers.map((h) => h.name)).toEqual(['X-Alpha']);
    expect(kept.filter.domains).toEqual(['pa.example.com']);
    expect(screen.getByRole('textbox', { name: 'Header name' })).toHaveProperty('value', 'X-Alpha');
  });

  it('says what it removed, naming each set rather than only counting them', async () => {
    // Silent removal is the one thing worse than the problem it fixes. The
    // message has to name the sets, so a user who wanted one can recognise what
    // went and restore it from an export.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seed(threeSets());
    render(<App />);

    await waitFor(() => expect(warn).toHaveBeenCalled());
    const message = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(message).toContain('Beta');
    expect(message).toContain('pb');
    expect(message).toContain('Gamma');
    expect(message).toContain('pc');
  });

  it('leaves a single stored rule set alone, and says nothing', async () => {
    // The truncation must not fire on the ordinary case — a warning on every
    // open is a warning nobody reads, and a needless write on every open would
    // wake the background's reconcile loop for nothing.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([
      { domain: 'api.example.com', granted: true },
    ]);
    await seed(stateWith());
    render(<App />);
    await screen.findByDisplayValue('X-A');

    expect(warn).not.toHaveBeenCalled();
    expect((await stored()).profiles).toHaveLength(1);
  });
});

describe('editing scope', () => {
  it('adds a typed site, and refuses to add the same one twice', async () => {
    await seed(stateWith());
    render(<App />);
    const field = await screen.findByRole('textbox', { name: 'Add a site' });

    await userEvent.type(field, 'staging.acme.dev{Enter}');
    await waitFor(async () =>
      expect((await stored()).profiles[0]!.filter.domains).toEqual([
        'api.example.com',
        'staging.acme.dev',
      ]),
    );

    // A duplicate would compile to a repeated requestDomains entry and show two
    // rows for one site.
    await userEvent.type(field, 'staging.acme.dev{Enter}');
    await waitFor(async () =>
      expect((await stored()).profiles[0]!.filter.domains).toEqual([
        'api.example.com',
        'staging.acme.dev',
      ]),
    );
  });

  it('accepts a pasted URL, keeps the rules live, and says what it trimmed', async () => {
    // The owner's exact input, end to end. Before this it produced a site chip
    // wearing the green "working" dot, an error paragraph elsewhere, and
    // `0 of 1 rules live · 1 blocked` — pointing at a rule that was fine.
    // Every one of those four is asserted here, because fixing any one alone
    // would leave the screen still contradicting itself.
    const s = stateWith();
    s.profiles[0]!.filter.domains = [];
    s.profiles[0]!.headers = [
      {
        id: 'h1',
        enabled: true,
        target: 'request',
        operation: 'set',
        name: 'x-canary',
        value: '1',
      },
    ];
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([
      { domain: 'www.musinsa.com', granted: true },
    ]);
    await seed(s);
    render(<App />);

    const field = await screen.findByRole('textbox', { name: 'Add a site' });
    await userEvent.type(field, 'https://www.musinsa.com/{Enter}');

    // The rule stays live: the site normalized to a usable host, so nothing is
    // suppressed and nothing is blamed.
    await waitFor(() => expect(readout()).toBe('1of 1 rules liveno problems'));
    // The chip shows the value the extension actually ended up with — which is
    // the whole fix. Showing the raw paste and explaining the difference in a
    // paragraph was the defect.
    expect(screen.getByTestId('site').textContent).toContain('www.musinsa.com');
    expect(screen.getByTestId('site').textContent).not.toContain('https://');
    expect(screen.getByTestId('site').getAttribute('data-state')).toBe('granted');
    // And nothing is announced, because there is nothing left to announce.
    expect(screen.queryAllByTestId('scope-note')).toEqual([]);
  });

  it('stores the host, so what is saved is what the extension matches on', async () => {
    // This is the change. Storing the raw text and normalizing at every read
    // is what put one value on screen and another on the wire; committing the
    // host means the two cannot drift apart again.
    const s = stateWith();
    s.profiles[0]!.filter.domains = [];
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([]);
    await seed(s);
    render(<App />);

    const field = await screen.findByRole('textbox', { name: 'Add a site' });
    await userEvent.type(field, 'https://www.musinsa.com/{Enter}');
    await waitFor(async () =>
      expect((await stored()).profiles[0]!.filter.domains).toEqual(['www.musinsa.com']),
    );
  });

  it('stores the host of the deep path the owner actually pasted', async () => {
    const s = stateWith();
    s.profiles[0]!.filter.domains = [];
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([]);
    await seed(s);
    render(<App />);

    const field = await screen.findByRole('textbox', { name: 'Add a site' });
    await userEvent.type(
      field,
      'https://www.musinsa.com/snap/_next/data/K_la.../recommend.json{Enter}',
    );
    await waitFor(async () =>
      expect((await stored()).profiles[0]!.filter.domains).toEqual(['www.musinsa.com']),
    );
  });

  it('refuses a second spelling of a site it already has, and says which', async () => {
    // Normalizing at input creates collisions that could not happen before:
    // these two entries are one site now. Doing nothing silently would look
    // exactly like a successful add.
    const s = stateWith();
    s.profiles[0]!.filter.domains = ['x.com'];
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([{ domain: 'x.com', granted: true }]);
    await seed(s);
    render(<App />);

    const field = await screen.findByRole('textbox', { name: 'Add a site' });
    await userEvent.type(field, 'https://x.com/{Enter}');

    // No space between the host and "is": AddSiteField separates the two
    // with a flex `gap`, not a text character — a leading space in the text
    // node collapses away in a real browser (verified in Chromium; jsdom
    // does no such collapsing, which is why this had to be caught by eye,
    // not by this suite, the first time). `textContent` sees only the text
    // nodes either side of the gap.
    expect(screen.getByTestId('add-site-note').textContent).toBe('x.comis already in the list.');
    expect((await stored()).profiles[0]!.filter.domains).toEqual(['x.com']);
  });

  it('keeps unsalvageable input as typed, on a chip that names it', async () => {
    // Internal whitespace has no host to fall back on. It still has to land as
    // an unusable chip showing what the user wrote, with a diagnostic that
    // states the cause and the remedy — this is the one path here that
    // genuinely needs words.
    const s = stateWith();
    s.profiles[0]!.filter.domains = [];
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([]);
    await seed(s);
    render(<App />);

    const field = await screen.findByRole('textbox', { name: 'Add a site' });
    await userEvent.type(field, 'a b.com{Enter}');

    await waitFor(async () =>
      expect((await stored()).profiles[0]!.filter.domains).toEqual(['a b.com']),
    );
    const site = await screen.findByTestId('site');
    expect(site.getAttribute('data-state')).toBe('unusable');
    expect(site.textContent).toContain('a b.com');
    const notes = screen.getAllByTestId('scope-note').map((n) => n.textContent ?? '');
    expect(notes.some((t) => /bare hostname like example\.com/.test(t))).toBe(true);
  });

  it('shows a legacy raw entry as its host, without needing it rewritten first', async () => {
    // Values stored before this change still carry their scheme and path.
    // Read-time normalization goes on working, and the chip shows the
    // effective value — otherwise the defect would survive for exactly the
    // people who already hit it.
    const s = stateWith();
    s.profiles[0]!.filter.domains = ['https://legacy.example.com/deep/path'];
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([
      { domain: 'legacy.example.com', granted: true },
    ]);
    await seed(s);
    render(<App />);

    const site = await screen.findByTestId('site');
    expect(site.textContent).toContain('legacy.example.com');
    expect(site.textContent).not.toContain('deep/path');
    expect(site.getAttribute('data-state')).toBe('granted');
  });

  it('refuses a spelling that needs more than one normalization pass', async () => {
    // The reviewer's scenario, verbatim. `*.*.example.com` is a plausible thing
    // to type for anyone carrying the match-pattern habit. It used to store as
    // `*.example.com` — a value that normalizes further on the next read — so
    // the dedupe compared `example.com` against `*.example.com`, found no
    // clash, and appended: two rows both reading `example.com`, both keyed to
    // the same host, each with its own Grant.
    const s = stateWith();
    s.profiles[0]!.filter.domains = ['example.com'];
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([{ domain: 'example.com', granted: true }]);
    await seed(s);
    render(<App />);

    const field = await screen.findByRole('textbox', { name: 'Add a site' });
    await userEvent.type(field, '*.*.example.com{Enter}');

    // No space — see the comment on the same assertion above.
    expect(screen.getByTestId('add-site-note').textContent).toBe(
      'example.comis already in the list.',
    );
    expect((await stored()).profiles[0]!.filter.domains).toEqual(['example.com']);
    expect(screen.getAllByTestId('site')).toHaveLength(1);
  });

  it('removes the site whose × was clicked', async () => {
    const s = stateWith();
    s.profiles[0]!.filter.domains = ['a.example.com', 'b.example.com'];
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([]);
    await seed(s);
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'Remove a.example.com' }));
    await waitFor(async () =>
      expect((await stored()).profiles[0]!.filter.domains).toEqual(['b.example.com']),
    );
  });

  it('refuses to remove the last request type — DNR rejects an empty array', async () => {
    // Its default also silently excludes main_frame, so an empty list is not
    // "match everything", it is "match almost nothing, quietly". This guard
    // moved here from the filter block when that component was replaced.
    const s = stateWith();
    s.profiles[0]!.filter.resourceTypes = ['script'];
    await seed(s);
    render(<App />);

    await userEvent.click(await screen.findByRole('checkbox', { name: 'script' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await stored()).profiles[0]!.filter.resourceTypes).toEqual(['script']);
  });

  it('adds and removes a request type that is not the last one', async () => {
    // The other half: the refusal above has to be about the *last* one, not
    // about the control being inert.
    await seed(stateWith());
    render(<App />);

    await userEvent.click(await screen.findByRole('checkbox', { name: 'image' }));
    await waitFor(async () =>
      expect((await stored()).profiles[0]!.filter.resourceTypes).toEqual([
        'xmlhttprequest',
        'main_frame',
        'sub_frame',
        'image',
      ]),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'image' }));
    await waitFor(async () =>
      expect((await stored()).profiles[0]!.filter.resourceTypes).toEqual([
        'xmlhttprequest',
        'main_frame',
        'sub_frame',
      ]),
    );
  });
});

describe('a rule that has not been named yet', () => {
  it('adds no red to the row the moment it is created', async () => {
    // The whole complaint, end to end: press "New rule", and the product used
    // to answer "Header name is empty." — creating an invalid object and then
    // telling the user off for it before they had touched the keyboard.
    await seed(stateWith());
    render(<App />);
    await screen.findByDisplayValue('X-A');
    expect(screen.queryAllByTestId('rule-problem')).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'New rule' }));
    await waitFor(() => expect(screen.getAllByTestId('rule')).toHaveLength(3));
    expect(screen.queryAllByTestId('rule-problem')).toEqual([]);
  });

  it('counts it in the rail instead, so the state is said rather than hidden', async () => {
    // Going quiet everywhere would trade the red row for the silent failure
    // this product exists to remove. Both halves are asserted together: no
    // problem block, and a count that names it.
    await seed(stateWith());
    render(<App />);
    await screen.findByDisplayValue('X-A');
    await waitFor(() => expect(readout()).toBe('2of 2 rules liveno problems'));

    await userEvent.click(screen.getByRole('button', { name: 'New rule' }));
    await waitFor(() => expect(readout()).toBe('2of 3 rules live1 unfinished'));
    expect(screen.queryAllByTestId('rule-problem')).toEqual([]);
  });

  it('reads the same after the popup is closed and reopened', async () => {
    // The owner's decision is that the empty rule is written to storage like
    // any other — not a draft, not created disabled. So reopening must not
    // resurrect the error: this seeds state exactly as storage would hold it
    // after the popup closed on an unnamed rule, which is what a fresh mount
    // reads back.
    const s = stateWith();
    s.profiles[0]!.headers.push({
      id: 'h3',
      enabled: true,
      target: 'request',
      operation: 'set',
      name: '',
      value: '',
    });
    await seed(s);
    render(<App />);

    await waitFor(() => expect(readout()).toBe('2of 3 rules live1 unfinished'));
    expect(screen.queryAllByTestId('rule-problem')).toEqual([]);
  });

  it('turns into a real error once the name is wrong rather than absent', async () => {
    // The states have to be distinguishable in the running app, not only in
    // the validator: typing something invalid must still produce the error.
    // Without this, "unfinished" could be implemented by silencing the row.
    await seed(stateWith());
    render(<App />);
    const name = await screen.findByDisplayValue('X-A');

    await userEvent.clear(name);
    await userEvent.type(name, 'X Session Id');
    await userEvent.tab();

    const problems = await screen.findAllByTestId('rule-problem');
    expect(problems.some((el) => /Not a valid header name/.test(el.textContent ?? ''))).toBe(true);
  });

  it('is not live, because the compiler emits nothing for it', async () => {
    // Verified rather than assumed. compileHeaders skips a blank name
    // (tests/unit/headers.test.ts), so an unfinished rule registers no DNR
    // rule — and the readout must agree with that rather than flatter it.
    const s = stateWith();
    s.profiles[0]!.headers = [
      {
        id: 'h1',
        enabled: true,
        target: 'request',
        operation: 'set',
        name: '',
        value: '',
      },
    ];
    await seed(s);
    render(<App />);

    await waitFor(() => expect(readout()).toBe('0of 1 rules live1 unfinished'));
  });
});

describe('editing rules', () => {
  it('appends a new rule without disturbing the ones already there', async () => {
    await seed(stateWith());
    render(<App />);
    await screen.findByDisplayValue('X-A');

    await userEvent.click(screen.getByRole('button', { name: 'New rule' }));
    await waitFor(async () => expect((await stored()).profiles[0]!.headers).toHaveLength(3));
    expect((await stored()).profiles[0]!.headers.map((h) => h.name)).toEqual(['X-A', 'X-B', '']);
  });

  it('deletes the rule whose × was clicked, and leaves the other one', async () => {
    await seed(stateWith());
    render(<App />);
    await screen.findByDisplayValue('X-A');

    const second = screen.getAllByTestId('rule')[1]!;
    await userEvent.click(within(second).getByRole('button', { name: 'Delete rule' }));
    await waitFor(async () => expect((await stored()).profiles[0]!.headers).toHaveLength(1));
    expect((await stored()).profiles[0]!.headers[0]!.name).toBe('X-A');
  });

  it('writes an edited header name through to storage, leaving its neighbour alone', async () => {
    await seed(stateWith());
    render(<App />);
    const name = await screen.findByDisplayValue('X-A');

    await userEvent.type(name, '-Edited');
    await userEvent.tab();
    await waitFor(async () =>
      expect((await stored()).profiles[0]!.headers[0]!.name).toBe('X-A-Edited'),
    );
    // A patch that rebuilt the list from the rendered cards would quietly
    // rewrite the other rule too.
    expect((await stored()).profiles[0]!.headers[1]!.name).toBe('X-B');
  });
});

describe('the bridge row', () => {
  it('says nothing before the permission probe answers', async () => {
    // A promise that never settles is the honest model of "the probe is still
    // out" — a resolved `false` would be testing the off state instead.
    vi.spyOn(probe, 'probeNativeMessaging').mockReturnValue(new Promise(() => {}));
    await seed(stateWith());

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('bridgestate')).toBeTruthy());
    expect(screen.getByTestId('bridgestate').getAttribute('data-bridge')).toEqual('unknown');
  });

  it('reads live from the session record, not from the permission', async () => {
    // Permission held and a port open are two different facts. An
    // implementation that derived `live` from the permission alone would call
    // a bridge live with no host installed — the single most misleading thing
    // this row could say, and the exact state `bridge install` exists to fix.
    vi.spyOn(probe, 'probeNativeMessaging').mockResolvedValue(true);
    await seed(stateWith());
    await fakeBrowser.storage.session.set({
      bridgeStatus: { connected: false, lastCommandAt: null, lastError: null },
    });

    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('bridgestate').getAttribute('data-bridge')).toEqual('idle'),
    );
  });

  it('turns live once the worker records a connected port', async () => {
    vi.spyOn(probe, 'probeNativeMessaging').mockResolvedValue(true);
    await seed(stateWith());
    await fakeBrowser.storage.session.set({
      bridgeStatus: { connected: true, lastCommandAt: null, lastError: null },
    });

    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('bridgestate').getAttribute('data-bridge')).toEqual('live'),
    );
  });

  it('asks for the permission when the bridge switch is turned on, and only then', async () => {
    // Switching this one on IS the request — a documented exception to the
    // rule the all-sites switch established, argued at its call site in
    // ScopeRail.tsx. What still holds is the "only then": nothing else in the
    // popup may reach `permissions.request()`.
    vi.spyOn(probe, 'probeNativeMessaging').mockResolvedValue(false);
    const request = vi.spyOn(probe, 'requestNativeMessaging').mockResolvedValue({ ok: true });
    await seed(stateWith());

    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('bridgestate').getAttribute('data-bridge')).toEqual('off'),
    );
    expect(request).toHaveBeenCalledTimes(0);

    await userEvent.click(within(screen.getByTestId('bridgestate')).getByRole('switch'));

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('puts a declined request on the row instead of leaving it silently off', async () => {
    // The defect: the request came back refused and the popup changed in no
    // way at all, so the only reading available was that the click had done
    // nothing. Absence before presence — the mark must not be there until the
    // request has actually failed.
    vi.spyOn(probe, 'probeNativeMessaging').mockResolvedValue(false);
    vi.spyOn(probe, 'requestNativeMessaging').mockResolvedValue({
      ok: false,
      reason: 'declined',
    });
    await seed(stateWith());

    render(<App />);
    const row = () => screen.getByTestId('bridgestate');
    await waitFor(() => expect(row().getAttribute('data-bridge')).toEqual('off'));
    expect(row().getAttribute('data-request')).toBeNull();

    await userEvent.click(within(row()).getByRole('switch'));

    await waitFor(() => expect(row().getAttribute('data-request')).toEqual('declined'));
  });

  it("shows Chrome's message when the request could not be made at all", async () => {
    vi.spyOn(probe, 'probeNativeMessaging').mockResolvedValue(false);
    vi.spyOn(probe, 'requestNativeMessaging').mockResolvedValue({
      ok: false,
      reason: 'error',
      message: 'user gesture required',
    });
    await seed(stateWith());

    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('bridgestate').getAttribute('data-bridge')).toEqual('off'),
    );

    await userEvent.click(within(screen.getByTestId('bridgestate')).getByRole('switch'));

    await waitFor(() =>
      expect(screen.getByTestId('bridge-label').getAttribute('title')).toContain(
        'user gesture required',
      ),
    );
  });
});

describe('all-sites mode', () => {
  const allSitesSwitch = () => screen.getByRole('switch', { name: 'Apply to every site' });

  /** Renders on a scoped store and waits for the popup to be interactive. */
  async function openOn(over: Partial<Profile> = {}) {
    const s = stateWith();
    s.profiles[0] = { ...s.profiles[0]!, ...over };
    await seed(s);
    render(<App />);
    await screen.findByDisplayValue('X-A');
  }

  it('sets the mode and asks for nothing — Grant is the only control that prompts', async () => {
    // The switch used to call `requestAllSites` itself, so flipping it fired
    // Chrome's prompt for `<all_urls>` — the broadest grant this extension can
    // ask for — before the user had pressed anything labelled Grant. Adding a
    // site does not prompt either; it produces a pending row and a button. The
    // same state reached by a different control must not behave differently.
    //
    // Asserting that Grant *does* call it would pass against the defect, which
    // called it from both places. Only the absence here can fail.
    vi.spyOn(probe, 'probeAllSites').mockResolvedValue(false);
    const requestAllSites = vi.spyOn(probe, 'requestAllSites').mockResolvedValue(true);
    await openOn();
    const bar = await screen.findByTestId('all-sites');

    await userEvent.click(allSitesSwitch());

    expect(requestAllSites).not.toHaveBeenCalled();
    await waitFor(async () => expect((await stored()).profiles[0]!.filter.allSites).toBe(true));
    // And the mode is not silently broken meanwhile: the state says it is on
    // and unpermitted, and carries the remedy — exactly what a pending site
    // row does. Without this the absence above could be satisfied by a switch
    // that simply did nothing.
    expect(allSitesSwitch().getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(bar.getAttribute('data-granted')).toBe('no'));
    expect(within(bar).getByRole('img').getAttribute('aria-label')).toBe('Awaiting permission');
    expect(within(bar).getByRole('button', { name: 'Grant' })).toBeTruthy();
  });

  it('asks for nothing when the mode is switched off', async () => {
    // Turning it off needs no permission, and prompting on the way out would
    // ask for the broadest grant there is at the exact moment the user said
    // they wanted less.
    vi.spyOn(probe, 'probeAllSites').mockResolvedValue(true);
    const requestAllSites = vi.spyOn(probe, 'requestAllSites').mockResolvedValue(true);
    const p = createProfile('Local', 0);
    await openOn({ filter: { ...p.filter, allSites: true, domains: ['api.example.com'] } });

    await userEvent.click(allSitesSwitch());

    await waitFor(async () => expect((await stored()).profiles[0]!.filter.allSites).toBe(false));
    expect(requestAllSites).not.toHaveBeenCalled();
  });

  it('keeps the mode on when the Grant prompt is declined, and leaves the way back', async () => {
    // The mode is the user's decision; the grant is the browser's answer to a
    // separate question. Tying them together would make a declined prompt
    // swallow a choice plainly made. The remedy has to survive the refusal too,
    // or recovering would mean toggling off and on to re-trigger a prompt.
    vi.spyOn(probe, 'probeAllSites').mockResolvedValue(false);
    const requestAllSites = vi.spyOn(probe, 'requestAllSites').mockResolvedValue(false);
    const p = createProfile('Local', 0);
    await openOn({ filter: { ...p.filter, allSites: true, domains: ['api.example.com'] } });

    const bar = await screen.findByTestId('all-sites');
    await waitFor(() => expect(bar.getAttribute('data-granted')).toBe('no'));
    await userEvent.click(within(bar).getByRole('button', { name: 'Grant' }));

    expect(requestAllSites).toHaveBeenCalledTimes(1);
    expect((await stored()).profiles[0]!.filter.allSites).toBe(true);
    expect(bar.getAttribute('data-granted')).toBe('no');
    expect(within(bar).getByRole('button', { name: 'Grant' })).toBeTruthy();
  });

  it('clears the Grant once the access is given', async () => {
    // The recovery path, end to end: the migrated and the declined store both
    // arrive here, and a Grant button that never goes away is a badge nobody
    // can satisfy.
    vi.spyOn(probe, 'probeAllSites').mockResolvedValue(false);
    const requestAllSites = vi.spyOn(probe, 'requestAllSites').mockResolvedValue(true);
    const p = createProfile('Local', 0);
    await openOn({ filter: { ...p.filter, allSites: true, domains: [] } });

    const bar = await screen.findByTestId('all-sites');
    await waitFor(() => expect(bar.getAttribute('data-granted')).toBe('no'));
    await userEvent.click(within(bar).getByRole('button', { name: 'Grant' }));

    expect(requestAllSites).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(bar.getAttribute('data-granted')).toBeNull());
    expect(within(bar).queryByRole('button', { name: 'Grant' })).toBeNull();
  });

  it('does not prompt for access it already holds', async () => {
    // The other branch of the same switch. The test above covers the ungranted
    // case; this one pins the granted one, so "never prompts" cannot be
    // achieved for one state while the other still asks. Re-toggling a mode
    // whose permission is held is the most ordinary thing a user does with this
    // control, and it must stay silent.
    vi.spyOn(probe, 'probeAllSites').mockResolvedValue(true);
    const requestAllSites = vi.spyOn(probe, 'requestAllSites').mockResolvedValue(true);
    await openOn();

    // Wait for the mount probe, so the click lands on a rail that knows the
    // permission is held rather than on one that has not been told yet.
    await waitFor(() =>
      expect(screen.getByTestId('all-sites').getAttribute('data-granted')).toBeNull(),
    );
    await userEvent.click(allSitesSwitch());

    await waitFor(async () => expect((await stored()).profiles[0]!.filter.allSites).toBe(true));
    expect(requestAllSites).not.toHaveBeenCalled();
  });

  it('keeps the stored sites through a round trip of the switch', async () => {
    // The reversibility the whole design rests on. If turning the mode on
    // cleared the list, turning it off would drop the user into the no-scope
    // state with their work gone — and nothing on screen would have warned
    // them that was the trade.
    vi.spyOn(probe, 'probeAllSites').mockResolvedValue(true);
    vi.spyOn(probe, 'requestAllSites').mockResolvedValue(true);
    await openOn();

    await userEvent.click(allSitesSwitch());
    await waitFor(async () => expect((await stored()).profiles[0]!.filter.allSites).toBe(true));
    expect((await stored()).profiles[0]!.filter.domains).toEqual(['api.example.com']);

    await userEvent.click(allSitesSwitch());
    await waitFor(async () => expect((await stored()).profiles[0]!.filter.allSites).toBe(false));
    expect((await stored()).profiles[0]!.filter.domains).toEqual(['api.example.com']);
  });

  it('reads each of the four scope states differently in the rail', async () => {
    // The states the owner will judge this by, asserted as the readout text
    // the rail actually shows. Two of them stop every rule and must not say
    // the same thing about why.
    const p = createProfile('Local', 0);
    const open = async (filter: Partial<typeof p.filter>) => {
      const s = stateWith();
      s.profiles[0] = { ...s.profiles[0]!, filter: { ...p.filter, ...filter } };
      await seed(s);
      render(<App />);
      await screen.findByDisplayValue('X-A');
    };

    // off + none: inert, and said without alarm.
    await open({ allSites: false, domains: [] });
    expect(readout()).toBe('0of 2 rules live2 blocked until a site is set');
    expect(screen.getByTestId('site-count').textContent).toBe('0');
    expect(screen.getByTestId('scope-note').getAttribute('data-severity')).toBe('incomplete');
    expect(screen.getByTestId('scope-note').textContent).toBe(
      'No site set yet, so nothing is being applied. Add a site above, or turn on All sites.',
    );
    cleanup();

    // off + some: ordinary scoped operation, nothing to report.
    await open({ allSites: false, domains: ['api.example.com'] });
    expect(readout()).toBe('2of 2 rules liveno problems');
    expect(screen.getByTestId('site-count').textContent).toBe('1');
    expect(screen.queryAllByTestId('scope-note')).toEqual([]);
    cleanup();

    // on: everywhere, by choice, and equally quiet.
    await open({ allSites: true, domains: [] });
    expect(readout()).toBe('2of 2 rules liveno problems');
    expect(screen.getByTestId('site-count').textContent).toBe('all');
    expect(screen.queryAllByTestId('scope-note')).toEqual([]);
    cleanup();

    // off + unusable: the one that is genuinely wrong, and still an error.
    await open({ allSites: false, domains: ['a b.com'] });
    expect(readout()).toBe('0of 2 rules live2 blocked by an unusable site');
    expect(screen.getByTestId('scope-note').getAttribute('data-severity')).toBe('error');
  });
});
