// @vitest-environment jsdom
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/entrypoints/popup/App';
import { createProfile } from '@/lib/model/defaults';
import * as probe from '@/lib/permissions/probe';
import type { AppState, Profile } from '@/lib/model/types';

function seed(state: AppState) {
  return fakeBrowser.storage.local.set({ state, state$: { v: 1 } });
}

function stored(): Promise<AppState> {
  return fakeBrowser.storage.local.get('state').then((s) => s.state as AppState);
}

function stateWith(over: Partial<AppState> = {}): AppState {
  const p = createProfile('Local', 0);
  return {
    version: 1,
    globalPause: false,
    theme: 'system',
    profiles: [{
      ...p,
      id: 'p1',
      filter: { ...p.filter, domains: ['api.example.com'] },
      headers: [
        { id: 'h1', enabled: true, target: 'request', operation: 'set', name: 'X-A', value: '1' },
        { id: 'h2', enabled: true, target: 'response', operation: 'set', name: 'X-B', value: '2' },
      ],
    }],
    ...over,
  };
}

const readout = () => screen.getByTestId('readout').textContent;

beforeEach(() => {
  fakeBrowser.reset();
  // permissions.* are throwing stubs in fake-browser; the popup probes on mount.
  vi.spyOn(probe, 'probeGrants').mockResolvedValue([{ domain: 'api.example.com', granted: true }]);
});
afterEach(() => { vi.restoreAllMocks(); });

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
    expect(problems.some((el) => /not a valid header name/.test(el.textContent ?? ''))).toBe(true);
    const notes = screen.queryAllByTestId('scope-note');
    expect(notes.some((el) => /not a valid header name/.test(el.textContent ?? ''))).toBe(false);
  });

  it('puts a scope diagnostic in the rail, never inside a rule', async () => {
    // The other direction of the same claim, and the reason the rail exists: in
    // the build this replaces every one of these stacked above the grid and
    // pushed the actual work off the screen.
    const s = stateWith();
    s.profiles[0]!.filter.domains = ['localhost:3000'];
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([{ domain: 'localhost', granted: true }]);
    await seed(s);
    render(<App />);

    const notes = await screen.findAllByTestId('scope-note');
    expect(notes.some((el) => /Port ignored/.test(el.textContent ?? ''))).toBe(true);
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
    await waitFor(() => expect(readout()).toBe('2of 2 rules live'));

    await seed(stateWith({ globalPause: true }));
    await waitFor(() => expect(readout()).toBe('0of 2 rules live2 blocked'));
  });

  it('stops counting rules as live when the rule set is suppressed', async () => {
    // One usable domain and one that is not (a pasted URL — the input Phase 2a
    // recorded as its worst defect). isSuppressed is true, compile.ts skips the
    // whole set, zero rules are registered. The diagnostic it earns has no
    // headerRuleId, so nothing reaches the cards and every rule looks healthy.
    const s = stateWith();
    s.profiles[0]!.filter.domains = ['api.example.com', 'https://staging.example.com'];
    await seed(s);
    render(<App />);
    await waitFor(() => expect(readout()).toBe('0of 2 rules live2 blocked'));
  });

  it('stops counting rules as live when the stored rule set is switched off', async () => {
    // Nothing in this UI can switch the rule set off — but legacy state can
    // hold one that is, and compile.ts:28 `continue`s before collecting any
    // diagnostic, deliberately. Zero rules registered, zero diagnostics, and
    // nothing anywhere to correct a readout still claiming they are live.
    await seed(stateWith());
    render(<App />);
    await waitFor(() => expect(readout()).toBe('2of 2 rules live'));

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
    const probeGrants = vi.spyOn(probe, 'probeGrants').mockImplementation(
      async (hosts: readonly string[]) => hosts.map((domain) => ({ domain, granted: false })),
    );
    let resolveRequest: (granted: boolean) => void = () => {};
    vi.spyOn(probe, 'requestHost').mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveRequest = resolve; }),
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

    const problems = screen.getAllByTestId('site-problem').map((l) => l.textContent ?? '');
    expect(problems.some((t) => /new-host\.example\.com/.test(t))).toBe(true);
    expect(problems.some((t) => /api\.example\.com/.test(t))).toBe(false);
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
      enabled: true, target: 'request', operation: 'set', name: '', value: '',
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

describe('legacy state holding more than one rule set', () => {
  function threeSets(): AppState {
    const make = (id: string, name: string, order: number): Profile => {
      const p = createProfile(name, order);
      return {
        ...p, id, name,
        filter: { ...p.filter, domains: [`${id}.example.com`] },
        headers: [{
          id: `${id}-h`, enabled: true, target: 'request',
          operation: 'set', name: `X-${name}`, value: 'v',
        }],
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
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([{ domain: 'api.example.com', granted: true }]);
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
      expect((await stored()).profiles[0]!.filter.domains)
        .toEqual(['api.example.com', 'staging.acme.dev']),
    );

    // A duplicate would compile to a repeated requestDomains entry and show two
    // rows for one site.
    await userEvent.type(field, 'staging.acme.dev{Enter}');
    await waitFor(async () =>
      expect((await stored()).profiles[0]!.filter.domains)
        .toEqual(['api.example.com', 'staging.acme.dev']),
    );
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

    await userEvent.click(await screen.findByRole('button', { name: 'script' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await stored()).profiles[0]!.filter.resourceTypes).toEqual(['script']);
  });

  it('adds and removes a request type that is not the last one', async () => {
    // The other half: the refusal above has to be about the *last* one, not
    // about the control being inert.
    await seed(stateWith());
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'image' }));
    await waitFor(async () =>
      expect((await stored()).profiles[0]!.filter.resourceTypes).toContain('image'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'image' }));
    await waitFor(async () =>
      expect((await stored()).profiles[0]!.filter.resourceTypes).not.toContain('image'),
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

    await userEvent.click(screen.getByRole('button', { name: '+ New rule' }));
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
    await waitFor(() => expect(readout()).toBe('2of 2 rules live'));

    await userEvent.click(screen.getByRole('button', { name: '+ New rule' }));
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
      id: 'h3', enabled: true, target: 'request', operation: 'set', name: '', value: '',
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
    expect(problems.some((el) => /not a valid header name/.test(el.textContent ?? ''))).toBe(true);
  });

  it('is not live, because the compiler emits nothing for it', async () => {
    // Verified rather than assumed. compileHeaders skips a blank name
    // (tests/unit/headers.test.ts), so an unfinished rule registers no DNR
    // rule — and the readout must agree with that rather than flatter it.
    const s = stateWith();
    s.profiles[0]!.headers = [{
      id: 'h1', enabled: true, target: 'request', operation: 'set', name: '', value: '',
    }];
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

    await userEvent.click(screen.getByRole('button', { name: '+ New rule' }));
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
