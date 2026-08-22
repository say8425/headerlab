// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScopeRail, type ScopeRailProps } from '@/components/ScopeRail';
import type { Diagnostic } from '@/lib/model/types';

function permission(host: string): Diagnostic {
  return {
    kind: 'permission-missing',
    severity: 'warning',
    profileId: 'p1',
    host,
    message: `HeaderLab needs permission for ${host}.`,
  };
}

function props(over: Partial<ScopeRailProps> = {}): ScopeRailProps {
  return {
    paused: false,
    // Silent and unburdened by default: the announcement channel and the
    // access clauses are what the tests about them opt into, so a readout
    // assertion written for the ordinary rail cannot pass by accidentally
    // landing in a granted-half state.
    announcement: null,
    onTogglePause: vi.fn(),
    domains: [],
    byHost: new Map(),
    lastError: null,
    iconError: null,
    // Off and granted by default: the states this change introduces have to be
    // opted into by the tests that are about them, so an assertion written for
    // the ordinary scoped rail cannot pass by accidentally landing in
    // all-sites mode.
    allSites: false,
    allSitesGranted: true,
    onToggleAllSites: vi.fn(),
    onGrantAllSites: vi.fn(),
    resourceTypes: ['xmlhttprequest', 'main_frame'],
    onAddDomain: vi.fn(() => ({ added: true as const })),
    onRemoveDomain: vi.fn(),
    onToggleType: vi.fn(),
    onGrant: vi.fn(),
    // `unknown` would make every existing test render a row with no control,
    // which is not what those tests are about. `off` is the state a fresh
    // install actually opens in, so it is the honest default here — and the
    // tests that are about the other three opt into them by name.
    bridge: 'off',
    bridgeLastCommandAt: null,
    bridgeError: null,
    bridgeRequestError: null,
    onEnableBridge: vi.fn(),
    onDisableBridge: vi.fn(),
    ...over,
  };
}

function renderRail(over: Partial<ScopeRailProps> = {}) {
  return render(<ScopeRail {...props(over)} />);
}

// The readout moved to the panel head (owner's call, 2026-08-20) and its suite
// moved with it — see RulePanel.test.tsx, 'the readout in the panel head'. The
// rail no longer receives `tally`, `blockedBy` or `sitesNeedingAccess` at all.

describe('the announcement channel', () => {
  it('is mounted before anything can fill it, empty when there is nothing to say', () => {
    // A live region that appears together with its first message is never
    // spoken — the browser only announces changes to a region it was already
    // watching — so the region itself must exist in the ordinary state.
    // Presence asserted before content, and in the silent default.
    renderRail();
    expect(screen.getByTestId('announcement').getAttribute('role')).toBe('status');
    expect(screen.getByTestId('announcement').textContent).toEqual('');
  });

  it('renders the outcome App hands it, either way of a permission prompt', () => {
    // The two strings the grant flow produces. The region is the speaker,
    // App is the decision — this pins only that what is decided arrives.
    const { rerender } = renderRail({
      announcement: { text: 'api.example.com — access granted', nonce: 1 },
    });
    expect(screen.getByTestId('announcement').textContent).toBe('api.example.com — access granted');
    rerender(
      <ScopeRail
        {...props({ announcement: { text: 'The permission was not granted', nonce: 2 } })}
      />,
    );
    expect(screen.getByTestId('announcement').textContent).toBe('The permission was not granted');
  });

  it('says the same outcome twice as two separate sayings', () => {
    // A live region is read when its content CHANGES. Both messages this
    // channel carries are fixed strings, so declining the prompt twice stored
    // the identical text: React bailed out, the DOM never moved, and the
    // second decline reached nobody — the interaction the region exists for.
    //
    // The nonce fixes it by keying the span, so an identical message arrives
    // as a NEW node. That is what is asserted: same text, different element.
    // Asserting the text alone would pass against the defect, since the text
    // is precisely what does not change.
    const said = { text: 'The permission was not granted', nonce: 1 };
    const { rerender } = renderRail({ announcement: said });
    const first = screen.getByTestId('announcement');

    rerender(<ScopeRail {...props({ announcement: { ...said, nonce: 2 } })} />);
    const second = screen.getByTestId('announcement');

    expect(second.textContent).toBe('The permission was not granted');
    expect(second).not.toBe(first);
  });
});

describe('the master switch', () => {
  it('says Active when running and Paused when paused', () => {
    const { rerender } = renderRail({ paused: false });
    expect(screen.getByTestId('runstate').textContent).toBe('Active');
    rerender(<ScopeRail {...props({ paused: true })} />);
    expect(screen.getByTestId('runstate').textContent).toBe('Paused');
  });

  // Queried by accessible name, not by role alone: the rail carries two
  // switches now, and `getByRole('switch')` would throw on the ambiguity —
  // or, worse, a later single-switch refactor would silently point these at
  // whichever one happened to remain.
  const pauseSwitch = () => screen.getByRole('switch', { name: /^(Pause|Resume) all rules$/ });

  it('mirrors the run state on the switch itself, not only in the word beside it', () => {
    const { rerender } = renderRail({ paused: false });
    expect(pauseSwitch().getAttribute('aria-checked')).toBe('true');
    rerender(<ScopeRail {...props({ paused: true })} />);
    expect(pauseSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('pauses from running and resumes from paused', async () => {
    // Both directions, so a handler that always sends `true` cannot pass.
    const onTogglePause = vi.fn();
    const { rerender } = renderRail({ paused: false, onTogglePause });
    await userEvent.click(pauseSwitch());
    expect(onTogglePause).toHaveBeenLastCalledWith(true);

    rerender(<ScopeRail {...props({ paused: true, onTogglePause })} />);
    await userEvent.click(pauseSwitch());
    expect(onTogglePause).toHaveBeenLastCalledWith(false);
  });

  it('does not drive the all-sites switch, and is not driven by it', async () => {
    // Two switches in one column, a few pixels apart, and each would look
    // plausible wired to the other's handler. Both directions of both
    // controls, so no single crossed wire survives.
    const onTogglePause = vi.fn();
    const onToggleAllSites = vi.fn();
    renderRail({ paused: false, allSites: false, onTogglePause, onToggleAllSites });

    await userEvent.click(pauseSwitch());
    expect(onTogglePause).toHaveBeenCalledTimes(1);
    expect(onToggleAllSites).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('switch', { name: 'Apply to every site' }));
    expect(onToggleAllSites).toHaveBeenCalledTimes(1);
    expect(onTogglePause).toHaveBeenCalledTimes(1);
  });
});

describe('sites', () => {
  it('renders one row per domain, in order, and counts them in the heading', () => {
    renderRail({ domains: ['api.example.com', 'staging.acme.dev'] });
    // The state line is part of the row's text now — reserved in every state so
    // that a Grant button arriving cannot resize the row. Kept in the exact
    // expectation rather than stripped out of it: a row that stopped rendering
    // the line would still fit the layout, and this is the assertion that
    // notices.
    expect(screen.getAllByTestId('site').map((s) => s.textContent)).toEqual([
      'api.example.comAccess granted',
      'staging.acme.devAccess granted',
    ]);
    expect(screen.getByTestId('site-count').textContent).toBe('2');
  });

  it('counts an empty list as none, not as every site', () => {
    // The heading used to read `all` here, because an empty list was the only
    // spelling of "everywhere". It now says what it has: nothing. Reading
    // `all` in this state is the summary agreeing with a claim the extension
    // no longer makes.
    renderRail({ allSites: false, domains: [] });
    expect(screen.getByTestId('site-count').textContent).toBe('0');
    expect(screen.queryAllByTestId('site')).toEqual([]);
  });

  it('says the scope is every site only when all-sites is on', () => {
    // Both readings of the same empty list, side by side, so the count cannot
    // be satisfied by a component that ignores the mode.
    const { rerender } = renderRail({ allSites: true, domains: [] });
    expect(screen.getByTestId('site-count').textContent).toBe('all');
    rerender(<ScopeRail {...props({ allSites: false, domains: [] })} />);
    expect(screen.getByTestId('site-count').textContent).toBe('0');
  });

  it('still says every site when all-sites is on over a list that has entries', () => {
    // The list is stored but not compiled, so counting its entries here would
    // report a scope narrower than the one actually registered.
    renderRail({ allSites: true, domains: ['api.example.com', 'x.com'] });
    expect(screen.getByTestId('site-count').textContent).toBe('all');
  });

  it('marks only the site that is waiting on permission', () => {
    renderRail({
      domains: ['granted.example.com', 'pending.example.com'],
      byHost: new Map([['pending.example.com', [permission('pending.example.com')]]]),
    });
    const [granted, pending] = screen.getAllByTestId('site');
    expect(granted!.getAttribute('data-state')).toBe('granted');
    expect(pending!.getAttribute('data-state')).toBe('pending');
    expect(within(granted!).queryByRole('button', { name: 'Grant' })).toBeNull();
    expect(within(pending!).getByRole('button', { name: 'Grant' })).toBeTruthy();
  });

  it('marks an unusable site as broken rather than showing it the granted dot', () => {
    // The defect: a site that cannot be used rendered the same green dot as a
    // granted, working one, while the explanation sat in a paragraph
    // elsewhere. One symbol meant two opposite things and the object holding
    // the bad value was the only one on screen not admitting to it.
    //
    // The good row is in the fixture too, so "shows broken" cannot pass by
    // marking everything.
    renderRail({ domains: ['api.example.com', 'a b.com'] });
    const [good, bad] = screen.getAllByTestId('site');
    expect(good!.getAttribute('data-state')).toBe('granted');
    expect(bad!.getAttribute('data-state')).toBe('unusable');
  });

  it('offers no Grant on an unusable site — permission is not what is wrong with it', () => {
    // The permission diagnostic is in the fixture on purpose. Without it this
    // asserts nothing: a row with no diagnostics has no Grant button whatever
    // its state, so the test would pass against a component that ignored
    // usability entirely — which is exactly what mutation-checking caught.
    renderRail({
      domains: ['a b.com'],
      byHost: new Map([['a b.com', [permission('a b.com')]]]),
    });
    expect(screen.getByTestId('site').getAttribute('data-state')).toBe('unusable');
    expect(screen.queryByRole('button', { name: 'Grant' })).toBeNull();
  });

  it('still offers Grant on a usable site waiting on permission', () => {
    // The other half, so "no Grant" cannot be achieved by never rendering one.
    renderRail({
      domains: ['api.example.com'],
      byHost: new Map([['api.example.com', [permission('api.example.com')]]]),
    });
    expect(screen.getByRole('button', { name: 'Grant' })).toBeTruthy();
  });

  it('treats a pasted URL as a usable site, because it normalizes to one', () => {
    // The owner's actual input. It must not wear the broken state: after
    // normalization `www.musinsa.com` is a perfectly good host.
    renderRail({ domains: ['https://www.musinsa.com/'] });
    expect(screen.getByTestId('site').getAttribute('data-state')).toBe('granted');
  });

  it('spends no prose on a pending site — the dot and the button are the message', () => {
    // The complaint: four lines of "HeaderLab needs permission for X. The rule
    // is registered but will not apply until you grant it." per pending site,
    // two of which filled a 196px rail. For this reader a Grant button beside a
    // hostname already carries it. What must stay visible is the state and the
    // remedy — and nothing else does: no prose, and no help mark either, since
    // a `?` on every pending row explains something nobody was confused by.
    renderRail({
      domains: ['api.example.com'],
      byHost: new Map([['api.example.com', [permission('api.example.com')]]]),
    });
    // Asserted on the row's own text rather than on a `site-problem` testid:
    // that element cannot render at all now, so querying for it would be an
    // assertion that can never fail — and one sitting inside a live test reads
    // as coverage it is not providing.
    const row = screen.getByTestId('site');
    expect(row.textContent).not.toMatch(/needs permission/);
    // …but the state and the action are still on screen, unhidden.
    expect(row.getAttribute('data-state')).toBe('pending');
    expect(within(row).getByRole('button', { name: 'Grant' })).toBeTruthy();
    // And the row carries no help mark of its own — the only `?` on screen is
    // the one on the SITES heading.
    expect(within(row).queryAllByRole('button', { name: /^Why / })).toEqual([]);
    expect(screen.getAllByRole('button', { name: /^About / })).toHaveLength(1);
  });

  it('names each row state to assistive tech, since colour is the only other cue', () => {
    // The state dot was `aria-hidden`, which left a granted row and an unusable
    // row with identical accessible names — two opposite meanings distinguished
    // by nothing but a colour. All three are asserted together, because giving
    // every row the same label would satisfy any one of them alone.
    //
    // The unusable label carries the remedy as well as the state, and this is
    // where that is pinned. When the scope notes went (2026-08-19) the
    // sentence telling the reader what to do about a bad entry moved onto the
    // row: on screen as the invalid Badge's `title`, which a pointer can
    // reach and a screen reader cannot, and here as the one channel that is
    // read out. Asserting the whole string rather than a prefix is the point
    // — a label trimmed back to "Unusable site" would leave the remedy
    // reachable by mouse only, which is the state this assertion exists to
    // catch.
    renderRail({
      domains: ['ok.example.com', 'pending.example.com', 'a b.com'],
      byHost: new Map([['pending.example.com', [permission('pending.example.com')]]]),
    });
    const labels = screen
      .getAllByTestId('site')
      .map((row) => within(row).getByRole('img').getAttribute('aria-label'));
    expect(labels).toEqual([
      'Access granted',
      'Awaiting permission',
      'Unusable site. Use a bare hostname like example.com.',
    ]);
  });

  it('grants the host the diagnostic names, not the domain text that carries a port', async () => {
    // `localhost:3000` is what the user typed; `localhost` is what Chrome can
    // actually be asked for, and the diagnostic is the party that already knows
    // the difference. A row passing its own `domain` through would send a
    // pattern permissions.request() rejects outright.
    const onGrant = vi.fn();
    renderRail({
      domains: ['localhost:3000'],
      byHost: new Map([['localhost', [permission('localhost')]]]),
      onGrant,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Grant' }));
    expect(onGrant).toHaveBeenCalledTimes(1);
    expect(onGrant).toHaveBeenCalledWith('localhost');
  });

  it('grants the host of the row whose button was clicked', async () => {
    // With one possible host, a handler reusing a fixed string would pass.
    const onGrant = vi.fn();
    renderRail({
      domains: ['host-a.example.com', 'host-b.example.com'],
      byHost: new Map([
        ['host-a.example.com', [permission('host-a.example.com')]],
        ['host-b.example.com', [permission('host-b.example.com')]],
      ]),
      onGrant,
    });
    const second = screen.getAllByTestId('site')[1]!;
    await userEvent.click(within(second).getByRole('button', { name: 'Grant' }));
    expect(onGrant).toHaveBeenCalledTimes(1);
    expect(onGrant).toHaveBeenCalledWith('host-b.example.com');
    expect(onGrant).not.toHaveBeenCalledWith('host-a.example.com');
  });

  it('removes the domain whose remove control was clicked, on the second click', async () => {
    // Armed before it fires (useArmed), like the rule row's delete.
    const onRemoveDomain = vi.fn();
    renderRail({ domains: ['a.example.com', 'b.example.com'], onRemoveDomain });
    await userEvent.click(screen.getByRole('button', { name: 'Remove b.example.com' }));
    expect(onRemoveDomain).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm removal of b.example.com' }));
    expect(onRemoveDomain).toHaveBeenCalledTimes(1);
    expect(onRemoveDomain).toHaveBeenCalledWith('b.example.com');
  });
});

describe('the all-sites switch', () => {
  const allSitesSwitch = () => screen.getByRole('switch', { name: 'Apply to every site' });

  it('mirrors the mode on the switch itself', () => {
    const { rerender } = renderRail({ allSites: false });
    expect(allSitesSwitch().getAttribute('aria-checked')).toBe('false');
    rerender(<ScopeRail {...props({ allSites: true })} />);
    expect(allSitesSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('turns on from off and off from on', async () => {
    // Both directions, so a handler that always sends `true` cannot pass. The
    // owner asked to be able to turn this off again, and a switch that only
    // goes one way is the defect that request is about.
    const onToggleAllSites = vi.fn();
    const { rerender } = renderRail({ allSites: false, onToggleAllSites });
    await userEvent.click(allSitesSwitch());
    expect(onToggleAllSites).toHaveBeenLastCalledWith(true);

    rerender(<ScopeRail {...props({ allSites: true, onToggleAllSites })} />);
    await userEvent.click(allSitesSwitch());
    expect(onToggleAllSites).toHaveBeenLastCalledWith(false);
  });

  it('offers Grant when the mode is on and access is not, and not once it is', () => {
    // The migrated store and the declined prompt both land here. Asserted in
    // both directions: a rail that always rendered Grant would pass the first
    // half alone.
    const { rerender } = renderRail({ allSites: true, allSitesGranted: false });
    expect(screen.getByTestId('all-sites').getAttribute('data-granted')).toBe('no');
    expect(
      within(screen.getByTestId('all-sites')).getByRole('button', { name: 'Grant' }),
    ).toBeTruthy();

    rerender(<ScopeRail {...props({ allSites: true, allSitesGranted: true })} />);
    expect(screen.getByTestId('all-sites').getAttribute('data-granted')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Grant' })).toBeNull();
  });

  it('names its access state to assistive tech, since colour is the only other cue', () => {
    // The switch says on/off and nothing about permission, so "on and working"
    // and "on and waiting for a grant" were told apart by an amber tint alone.
    // Both are asserted: one label for both states would satisfy either half
    // by itself. Same words the site rows use — it is the same state.
    const bar = () => screen.getByTestId('all-sites');
    const { rerender } = renderRail({ allSites: true, allSitesGranted: false });
    expect(within(bar()).getByRole('img').getAttribute('aria-label')).toBe('Awaiting permission');

    rerender(<ScopeRail {...props({ allSites: true, allSitesGranted: true })} />);
    expect(within(bar()).getByRole('img').getAttribute('aria-label')).toBe('Access granted');
  });

  it('says nothing about access while the probe is still out', () => {
    // `null` is not `false`. A switch that flashes "needs permission" for the
    // instant before the browser has been asked teaches people to disregard
    // the badge, which costs more than the blank moment does. The dot is part
    // of that claim: a state it cannot know yet must not be named either.
    renderRail({ allSites: true, allSitesGranted: null });
    expect(screen.getByTestId('all-sites').getAttribute('data-granted')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Grant' })).toBeNull();
    expect(within(screen.getByTestId('all-sites')).queryByRole('img')).toBeNull();
  });

  it('offers no Grant for access it is not using — the mode is off', () => {
    // `<all_urls>` ungranted matters only to a mode that needs it. A Grant
    // button on a switched-off control would ask for the broadest permission
    // the browser has, for nothing.
    renderRail({ allSites: false, allSitesGranted: false });
    expect(screen.queryByRole('button', { name: 'Grant' })).toBeNull();
  });

  it('asks for access without turning the mode off', async () => {
    const onGrantAllSites = vi.fn();
    const onToggleAllSites = vi.fn();
    renderRail({ allSites: true, allSitesGranted: false, onGrantAllSites, onToggleAllSites });
    await userEvent.click(screen.getByRole('button', { name: 'Grant' }));
    expect(onGrantAllSites).toHaveBeenCalledTimes(1);
    // The Grant button sits inside the switch's own bar, a few pixels from it.
    expect(onToggleAllSites).not.toHaveBeenCalled();
  });
});

describe('the site list while all-sites is on', () => {
  it('keeps the stored sites on screen and says on each one that it is not in use', () => {
    // Hiding them would make turning the mode off look like it had discarded
    // the user's scope, and leave nothing to say what turning it back off
    // returns to.
    //
    // The sentence used to be one paragraph above the list, keyed off
    // `sites-idle`. It is on every row now, because a paragraph that comes and
    // goes with the mode moves the whole list 23.7px each way — and because a
    // site's state belongs on the site. Asserted on both rows and as exact
    // text: one row carrying it, or a row saying merely "not in use" without
    // naming what is overriding it, would leave the reader looking for why.
    renderRail({ allSites: true, domains: ['api.example.com', 'x.com'] });
    expect(screen.getAllByTestId('site').map((s) => s.textContent)).toEqual([
      'api.example.comAll sites is on',
      'x.comAll sites is on',
    ]);
  });

  it('says that only about entries there are — an empty list has nothing sitting idle', () => {
    // The paragraph this replaces was guarded against describing an empty list.
    // The row carries the words now, so "no rows" is what makes it unsaid, and
    // the absence has to be asserted rather than assumed from there being no
    // paragraph left to query.
    const { container } = renderRail({ allSites: true, domains: [] });
    expect(screen.queryAllByTestId('site')).toEqual([]);
    expect(container.textContent).not.toMatch(/Not in use/);
  });

  it('says nothing of the sort while the list is the thing in use', () => {
    renderRail({ allSites: false, domains: ['api.example.com'] });
    expect(screen.getByTestId('site').textContent).not.toMatch(/Not in use/);
    // …and the row is not merely silent: it states the state it is actually in.
    expect(screen.getByTestId('site').textContent).toBe('api.example.comAccess granted');
  });

  it('stops claiming access is granted for a host nothing is scoped to', () => {
    // The green dot means "Access granted", and while all-sites is on nothing
    // probes these hosts at all — so the row would be reporting a permission
    // state no call established. Both modes are asserted, because a row stuck
    // on `idle` would pass either half alone.
    const { rerender } = renderRail({ allSites: true, domains: ['api.example.com'] });
    const dot = () => within(screen.getByTestId('site')).getByRole('img');
    expect(screen.getByTestId('site').getAttribute('data-state')).toBe('idle');
    expect(dot().getAttribute('aria-label')).toBe('Not in use');

    rerender(<ScopeRail {...props({ allSites: false, domains: ['api.example.com'] })} />);
    expect(screen.getByTestId('site').getAttribute('data-state')).toBe('granted');
    expect(dot().getAttribute('aria-label')).toBe('Access granted');
  });

  it('still marks an unusable entry as broken, because it still is', () => {
    // It is doing no harm yet and it is what will suppress every rule the
    // moment the switch goes back off. Reading as merely "not in use" until
    // then would spring the failure on the user at the exact moment they
    // narrowed their scope and expected it to start working.
    renderRail({ allSites: true, domains: ['a b.com', 'ok.example.com'] });
    expect(screen.getAllByTestId('site').map((s) => s.getAttribute('data-state'))).toEqual([
      'unusable',
      'idle',
    ]);
  });

  it('offers no Grant on an idle row — its access is not what is being used', () => {
    // The permission diagnostic is in the fixture on purpose; without it the
    // row has no Grant whatever its state and this would assert nothing.
    renderRail({
      allSites: true,
      domains: ['api.example.com'],
      byHost: new Map([['api.example.com', [permission('api.example.com')]]]),
    });
    expect(within(screen.getByTestId('site')).queryByRole('button', { name: 'Grant' })).toBeNull();
  });
});

describe('adding a site', () => {
  const field = () => screen.getByRole('textbox', { name: 'Add a site' });

  it('does not add on the keydown an IME fires to end a composition', async () => {
    // Typing a Korean hostname and pressing Enter once produces TWO keydowns:
    // the first ends the composition and carries `isComposing`, the second is
    // the press the user means. Both read `e.key === 'Enter'`, so the handler
    // ran twice — the host was added and the field cleared before the syllable
    // being composed had landed.
    //
    // `fireEvent` rather than `userEvent`: composition is not something
    // userEvent's keyboard model produces, and the whole defect lives in a
    // field of the *native* event.
    const onAddDomain = vi.fn(() => ({ added: true as const }));
    renderRail({ onAddDomain });
    await userEvent.type(field(), 'api.example.com');

    // Absence before presence. Asserting only the "one call" at the end would
    // pass a handler that never fired at all.
    fireEvent.keyDown(field(), { key: 'Enter', isComposing: true });
    expect(onAddDomain, 'the composition-ending Enter is not a submit').not.toHaveBeenCalled();

    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onAddDomain).toHaveBeenCalledTimes(1);
    expect(onAddDomain).toHaveBeenCalledWith('api.example.com');
  });

  it('adds on Enter, trimmed, and clears itself', async () => {
    const onAddDomain = vi.fn(() => ({ added: true as const }));
    renderRail({ onAddDomain });
    await userEvent.type(field(), '  api.example.com  {Enter}');
    expect(onAddDomain).toHaveBeenCalledTimes(1);
    expect(onAddDomain).toHaveBeenCalledWith('api.example.com');
    expect(field()).toHaveProperty('value', '');
  });

  it('adds from the + inside the field, and asks for nothing when it is empty', async () => {
    // The plus used to be an `aria-hidden` glyph with `pointer-events-none`
    // — a mark shaped like a button that did nothing, which is worse than no
    // mark. It is the field's submit now, and the empty-field half is the
    // same promise Enter makes: blank input is dropped, not appended.
    const onAddDomain = vi.fn(() => ({ added: true as const }));
    renderRail({ onAddDomain });
    const plus = screen.getByRole('button', { name: 'Add the typed site' });
    expect(plus.className).toContain('cursor-pointer');
    await userEvent.click(plus);
    expect(onAddDomain).not.toHaveBeenCalled();

    await userEvent.type(field(), 'api.example.com');
    await userEvent.click(plus);
    expect(onAddDomain).toHaveBeenCalledTimes(1);
    expect(onAddDomain).toHaveBeenCalledWith('api.example.com');
    expect(field()).toHaveProperty('value', '');
  });

  it('adds on blur, for a domain typed and then clicked away from', async () => {
    const onAddDomain = vi.fn(() => ({ added: true as const }));
    renderRail({ onAddDomain });
    await userEvent.type(field(), 'api.example.com');
    expect(onAddDomain).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(onAddDomain).toHaveBeenCalledTimes(1);
    expect(onAddDomain).toHaveBeenCalledWith('api.example.com');
  });

  it('adds once when Enter is followed by a blur', async () => {
    // Same "once per edit" promise the editable fields make, reached a
    // different way: adding clears the field, so the blur has nothing left.
    const onAddDomain = vi.fn(() => ({ added: true as const }));
    renderRail({ onAddDomain });
    await userEvent.type(field(), 'api.example.com{Enter}');
    await userEvent.tab();
    expect(onAddDomain).toHaveBeenCalledTimes(1);
  });

  it('discards the entry on Escape, so the following blur adds nothing', async () => {
    const onAddDomain = vi.fn(() => ({ added: true as const }));
    renderRail({ onAddDomain });
    await userEvent.type(field(), 'api.example.com{Escape}');
    await userEvent.tab();
    expect(onAddDomain).not.toHaveBeenCalled();
    expect(field()).toHaveProperty('value', '');
  });

  it('says so when the site is already there, and keeps the entry visible', async () => {
    // Silently clearing the field on a duplicate looks exactly like a
    // successful add — the user is told nothing and sees nothing change. The
    // note names the *host*, because after normalization `https://x.com/` and
    // `x.com` are one site and the host is the only thing that explains why two
    // different-looking entries collided.
    const onAddDomain = vi.fn(() => ({ added: false as const, alreadyThere: 'x.com' }));
    renderRail({ domains: ['x.com'], onAddDomain });
    await userEvent.type(field(), 'https://x.com/{Enter}');
    // No space between the host and "is": the two live in separate flex
    // items now (for the truncation in the test below), separated on screen
    // by `gap-1` rather than by a text character. `textContent` sees only
    // the text nodes, never the gap, so this is what it actually reads —
    // a text-character space here would be the same bug round 2 caught
    // (see the test below), just missed the other way.
    expect(screen.getByTestId('add-site-note').textContent).toBe('x.comis already in the list.');
    expect(field()).toHaveProperty('value', 'https://x.com/');
  });

  it('bounds the duplicate note to one line, whatever the hostname length', async () => {
    // `schema.ts` caps nothing about domain length, and the rail is ~194px
    // wide at a 10.5px note — an ordinary corporate subdomain already
    // exceeds one line before "is already in the list." is even appended.
    // jsdom computes no layout, so it cannot see a box actually stay one
    // line tall; what it can check is that every part of the rendering is
    // shaped to stay on one line — the host truncating, the suffix never
    // wrapping — and that bounding the *rendering* does not lose the value
    // — the full host survives in `title` and in `textContent` alike, only
    // its on-screen width is clipped by CSS.
    const long = 'internal-api-gateway.staging.eu-west-1.example.com';
    const onAddDomain = vi.fn(() => ({ added: false as const, alreadyThere: long }));
    renderRail({ domains: [long], onAddDomain });
    await userEvent.type(field(), `${long}{Enter}`);

    const note = screen.getByTestId('add-site-note');
    // No space here either — see the comment on the sibling test above.
    // `gap-1` on the flex row (not a text-node space) is what separates the
    // two on screen; jsdom cannot see that gap, only the text nodes either
    // side of it.
    expect(note.textContent).toBe(`${long}is already in the list.`);

    const host = note.querySelector('b')!;
    expect(host.className).toContain('truncate');
    expect(host.getAttribute('title')).toBe(long);

    // The wrapper this used to assert on — a fixed `h-[15px]` reserving the
    // line so its arrival moved nothing — is gone; AddSiteField's docblock
    // records why, and the movement it prevented is now accepted. What that
    // reservation depended on is what remains worth pinning, and is pinned
    // above: the host truncates rather than wrapping, so the note is one line
    // whatever the hostname's length, which is what keeps the push bounded now
    // that it is not prevented. The height itself is measured in
    // tests/e2e/header-modification.spec.ts, where boxes have one.
    expect(note.className).toContain('overflow-hidden');
    expect(note.querySelector('span')!.className).toContain('whitespace-nowrap');
  });

  it('drops the complaint as soon as the entry is edited', async () => {
    // The note is about the text as it stands; leaving it up while the user
    // types something else would be complaining about a value that is gone.
    const onAddDomain = vi.fn(() => ({ added: false as const, alreadyThere: 'x.com' }));
    renderRail({ domains: ['x.com'], onAddDomain });
    await userEvent.type(field(), 'x.com{Enter}');
    expect(screen.getByTestId('add-site-note')).toBeTruthy();
    await userEvent.type(field(), 'y');
    expect(screen.queryByTestId('add-site-note')).toBeNull();
  });

  it('keeps the host-only rule behind a ?, out of the rail until it is asked for', async () => {
    // The bubble is two worked pairs and nothing else. It used to close with
    // a sentence naming the rule they demonstrate ("Matched by host — a port
    // or path is dropped."); that is gone (owner's call), on the grounds that
    // the pairs already show the transformation and a developer reads the
    // example faster than the sentence describing it. What the rail carries
    // permanently is still only a `?` — the point of this test — and the
    // exact-match below is what keeps the pairs from being quietly reworded
    // into prose again.
    renderRail();
    expect(screen.queryByTestId('help-bubble')).toBeNull();

    // Hover, not click. The `?` is a shadcn Tooltip trigger now, and a Radix
    // tooltip treats a click as "I am busy, get out of the way" — it closes on
    // pointerdown. Hovering and focusing are the two ways it opens, and both
    // are pinned in tooltip.test.tsx; what this test is about is which fact
    // the rail's own mark carries.
    await userEvent.hover(screen.getByRole('button', { name: 'About matching sites' }));
    // Worked pairs first, then the rule they demonstrate — a developer
    // pattern-matches the transformation faster than a sentence describing it.
    expect(screen.getByTestId('help-bubble').textContent).toBe(
      'https://x.com/a/b→x.comlocalhost:3000→localhost',
    );
  });

  it('adds nothing for whitespace alone', async () => {
    // An empty entry in a non-empty list is a domain that can never match,
    // which narrows the scope to nothing without saying so.
    const onAddDomain = vi.fn(() => ({ added: true as const }));
    renderRail({ onAddDomain });
    await userEvent.type(field(), '   {Enter}');
    expect(onAddDomain).not.toHaveBeenCalled();
  });

  it('추가 슬롯의 경계는 대비가 보장된 토큰을 쓴다', () => {
    // The dashed edge is the only thing telling this control apart from
    // plain text — Task 1's 3:1 guard is on `--boundary` itself, so this only
    // has to confirm the slot actually reaches for that token.
    renderRail();
    expect(screen.getByTestId('add-field').className).toContain('border-boundary');
  });
});

describe('request types', () => {
  it('shows exactly the eight offered types, in order, named as Chrome names them', () => {
    // A bare length check would pass eight arbitrary rows. The accessible
    // names carry the real ResourceType values even where the visible label
    // is shorter, because that is the word the user has to match against
    // every other tool — and the one that differs also contains the visible
    // word, so speaking a row by what it shows on screen works too.
    renderRail();
    expect(screen.getAllByTestId('type-check').map((c) => c.getAttribute('aria-label'))).toEqual([
      'main_frame',
      'sub_frame',
      'xhr (xmlhttprequest)',
      'script',
      'stylesheet',
      'image',
      'font',
      'media',
    ]);
  });

  it('shows xmlhttprequest as xhr, because the rail column is not 14 characters wide', () => {
    renderRail();
    expect(
      screen.getByRole('checkbox', { name: 'xhr (xmlhttprequest)' }).closest('label')?.textContent,
    ).toBe('xhr');
  });

  it('marks the selected types and leaves the rest unmarked', () => {
    renderRail({ resourceTypes: ['script'] });
    expect(screen.getByRole('checkbox', { name: 'script' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('checkbox', { name: 'image' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('counts only the offered types in the heading, so a stored oddity cannot read 9 of 8', () => {
    // `websocket` is a real ResourceType this list does not offer. It stays in
    // state untouched, but counting it here would produce a heading that
    // contradicts the eight rows underneath it.
    renderRail({ resourceTypes: ['script', 'image', 'websocket'] });
    expect(screen.getByText('Request types').textContent).toBe('Request types 2 of 8');
  });

  it('toggles the type that was clicked — a different row toggles a different type', async () => {
    const onToggleType = vi.fn();
    renderRail({ resourceTypes: ['script'], onToggleType });
    await userEvent.click(screen.getByRole('checkbox', { name: 'image' }));
    expect(onToggleType).toHaveBeenNthCalledWith(1, 'image');
    await userEvent.click(screen.getByRole('checkbox', { name: 'font' }));
    expect(onToggleType).toHaveBeenNthCalledWith(2, 'font');
  });
});

describe('the rail after the scope notes were removed', () => {
  // The notes are gone (owner's ruling, 2026-08-19): an unusable entry wears
  // its invalid Badge on its own row (SiteRow) and "no site set" is the
  // readout's own sentence. What remains here is the negative — no element
  // may resurrect under the old testid — plus the two error notes that were
  // never scope notes and are untouched.
  it('renders no scope-note element in any state', () => {
    renderRail({ domains: ['a b.com', 'api.example.com'] });
    expect(screen.queryAllByTestId('scope-note')).toEqual([]);
    expect(screen.queryByTestId('sync-error')).toBeNull();
    // The unusable row carries its own mark instead.
    const bad = screen.getAllByTestId('site')[0]!;
    expect(bad.getAttribute('data-state')).toBe('unusable');
    expect(within(bad).getByTestId('site-invalid').textContent).toBe('Use a bare hostname');
  });

  it('says the toolbar is out of date without claiming the rules failed', () => {
    // Two failures that say opposite things about whether headers are being
    // modified, so they get their own notes. Folding this into `lastError`
    // would put it under "Rules not registered" — false, and false in the
    // direction that under-reports an active extension.
    renderRail({ iconError: 'icon missing' });
    const note = screen.getByTestId('icon-error');
    expect(note.textContent).toBe(
      'Toolbar icon out of dateThe icon may not match the run state above. icon missing',
    );
    expect(screen.queryByTestId('sync-error')).toBeNull();
  });

  it('shows nothing about the icon when it is fine', () => {
    renderRail();
    expect(screen.queryByTestId('icon-error')).toBeNull();
  });

  it('shows the real text of a failed reconcile, and not as a scope note', () => {
    // A reconcile failure means nothing is registered, which contradicts the
    // run state directly above it. It is not about scope and must not be filed
    // among the things that are.
    renderRail({ lastError: 'Rule 3 is invalid' });
    expect(screen.getByTestId('sync-error').textContent).toBe(
      'Rules not registeredRule 3 is invalid',
    );
    expect(screen.queryAllByTestId('scope-note')).toEqual([]);
  });
});

describe('the bridge row', () => {
  it.each([
    ['off', false, 'off'],
    ['idle', true, 'idle'],
    ['live', true, 'live'],
  ])('%s names the row and says its state beside the name', (mode, on, word) => {
    render(<ScopeRail {...props({ bridge: mode as 'off' })} />);
    const row = screen.getByTestId('bridgestate');
    // The label is the row's NAME in every state — a reader who does not know
    // what this row is learns that from the words — and the slot beside it is
    // where what it is *doing* reaches the eye.
    //
    // This assertion used to read "leaves the visible state to the switch"
    // and pinned the label alone, so that "an implementation that
    // reintroduced a state word anywhere visible fails". It did not fail:
    // the label does not move, so the guard stayed green through the change
    // that reversed its subject. Asserting both spans is what makes it fail
    // when either half goes.
    expect(screen.getByTestId('bridge-label').textContent).toEqual('Agent bridge');
    expect(screen.getByTestId('bridge-state').textContent).toEqual(word);
    const control = within(row).getByRole('switch');
    expect(control.getAttribute('aria-checked')).toEqual(String(on));
  });

  it('says down when a connection was expected and could not be made', () => {
    render(<ScopeRail {...props({ bridge: 'idle', bridgeError: 'Native host has exited.' })} />);
    // The visible slot has 47.48px of text and `cannot be reached` is
    // 107.70px, so the two lengths differ here and only here. The whole
    // sentence still reaches the description below.
    expect(screen.getByTestId('bridge-state').textContent).toEqual('down');
  });

  it('keeps the state slot present, and empty, before the state is known', () => {
    render(<ScopeRail {...props({ bridge: 'unknown' })} />);
    // Absence before presence. The slot has to exist in `unknown` too: it is
    // the flex item that used to be a bare spacer, so a slot that unmounted
    // would make the row's geometry follow its state — the one thing putting
    // the word here was supposed to avoid.
    expect(screen.getByTestId('bridge-state').textContent).toEqual('');
    expect(screen.getByTestId('bridge-label').textContent).toEqual('Agent bridge');
  });

  it('gives each state its own word', () => {
    const words: (string | null)[] = [];
    for (const bridge of ['off', 'idle', 'live'] as const) {
      const { unmount } = render(<ScopeRail {...props({ bridge })} />);
      words.push(screen.getByTestId('bridge-state').textContent);
      unmount();
    }
    const { unmount } = render(
      <ScopeRail {...props({ bridge: 'idle', bridgeError: 'Native host has exited.' })} />,
    );
    words.push(screen.getByTestId('bridge-state').textContent);
    unmount();
    // Four states, four words. Two of them sharing one would put `off` and
    // `idle` back where the dot alone once left them.
    expect(new Set(words).size).toEqual(4);
  });

  it.each([
    ['off', 'border-muted-foreground', 'off'],
    ['idle', 'border-pending', 'nothing is connected'],
    ['live', 'bg-live', 'live'],
  ])('%s carries its state on the dot and in the detail span', (mode, dot, phrase) => {
    // Colour is one channel and shape is the other: `live` is a filled dot,
    // the not-running states are rings, so the distinction survives
    // colour-blind vision (and the detail span below says it in words).
    // `off` and `idle` still need different colours — they shared one until
    // the label stopped saying which was which, and two states that look
    // identical while calling for opposite actions is exactly the silence
    // this rail exists to remove.
    render(<ScopeRail {...props({ bridge: mode as 'off' })} />);
    const row = screen.getByTestId('bridgestate');
    expect(row.querySelector('[aria-hidden="true"]')!.className).toContain(dot);
    expect(screen.getByTestId('bridge-label').getAttribute('title')).toContain(phrase);
  });

  it('says nothing and offers no control while the probe is still out', () => {
    // Same rule as the all-sites row's `allSitesGranted: null`: a popup that
    // offered a switch for a tenth of a second and then withdrew it is the
    // flicker that teaches people to distrust the screen. The label reads the
    // same here as everywhere else, so absence of the *control* is what this
    // asserts — and it asserts it before presence, so an "always renders the
    // switch" implementation would fail.
    render(<ScopeRail {...props({ bridge: 'unknown' })} />);
    const row = screen.getByTestId('bridgestate');
    expect(row.textContent).toEqual('Agent bridge');
    expect(within(row).queryByRole('switch')).toBeNull();
  });

  it('keeps the row the same height in every state', () => {
    // State changes appearance, not geometry (CLAUDE.md, Interface). The
    // class list is what the e2e measures; here it is enough that all four
    // states render the same box classes.
    const heights = new Set(
      (['unknown', 'off', 'idle', 'live'] as const).map((bridge) => {
        const { unmount } = render(<ScopeRail {...props({ bridge })} />);
        const cls = screen.getByTestId('bridgestate').className;
        unmount();
        return cls;
      }),
    );
    expect(heights.size).toEqual(1);
  });

  it('carries the last external write in a title rather than a second line', () => {
    render(
      <ScopeRail {...props({ bridge: 'live', bridgeLastCommandAt: '2026-08-12T09:30:00.000Z' })} />,
    );
    const label = screen.getByTestId('bridge-label');
    // The exact string, not "contains a date": this is the only place the fact
    // is stated, so a title that dropped the value and kept the prefix would
    // look right and say nothing. The state sentence leads it now — the label
    // no longer says "live", so the title is where that word has to appear.
    expect(label.getAttribute('title')).toEqual(
      'The agent bridge is live — a CLI can reach this extension. ' +
        `Last change through it: ${new Date('2026-08-12T09:30:00.000Z').toLocaleString()}`,
    );
  });

  it('claims no last change when nothing has come through', () => {
    // The guard is unchanged in substance — do not report a write that never
    // happened — but its shape moved: a live bridge now always describes
    // itself, so "no title" stopped being the way to say "no command yet".
    render(<ScopeRail {...props({ bridge: 'live', bridgeLastCommandAt: null })} />);
    const title = screen.getByTestId('bridge-label').getAttribute('title')!;
    expect(title).toContain('live');
    expect(title).not.toContain('Last change');
  });

  // A separate box for this state used to live here — deleted (see
  // ScopeRail.tsx's `bridgeUnreachable` docblock and the site-list docblock's
  // "not hypothetical" paragraph) because the rail has no free height for a
  // box that only sometimes exists, and it collapsed the site list to
  // nothing under real content pressure. The error now folds into the row
  // that already exists, so these tests replace the two above rather than
  // testing a `bridge-error` element that no longer renders.
  describe('an unreachable bridge (idle, with an error)', () => {
    it('keeps the row the exact same box as every other bridge state', () => {
      // Assertion 1 at the unit level: geometry must not depend on whether
      // there is an error. The e2e suite (bridge-rail.spec.ts) makes the same
      // check against real layout; this is the fast, always-run half of it.
      const withError = render(
        <ScopeRail {...props({ bridge: 'idle', bridgeError: 'Native host has exited.' })} />,
      );
      const errorClass = screen.getByTestId('bridgestate').className;
      withError.unmount();

      const withoutError = render(<ScopeRail {...props({ bridge: 'idle', bridgeError: null })} />);
      const plainClass = screen.getByTestId('bridgestate').className;
      withoutError.unmount();

      expect(errorClass).toEqual(plainClass);
    });

    it('keeps the label and swaps the dot to the pending colour', () => {
      render(<ScopeRail {...props({ bridge: 'idle', bridgeError: 'Native host has exited.' })} />);
      const row = screen.getByTestId('bridgestate');
      expect(row.querySelector('[aria-hidden="true"]')!.className).toContain('border-pending');
      // The label is the row's name and does not move for state — what an
      // unreachable bridge changes is the dot and the title, checked here and
      // in the test below.
      expect(screen.getByTestId('bridge-label').textContent).toEqual('Agent bridge');
    });

    it("carries the command and Chrome's own words in title, not on the visible row", () => {
      render(<ScopeRail {...props({ bridge: 'idle', bridgeError: 'Native host has exited.' })} />);
      const label = screen.getByTestId('bridge-label');
      // What to run reaches a pointer via the title and everything else via the
      // detail span — the *visible* row is the name and nothing else, in this
      // state as in every other.
      expect(label.textContent).toEqual('Agent bridge');
      const title = label.getAttribute('title');
      // The remedy leads; Chrome's string trails it — checked as two
      // separate assertions rather than one exact string so the order is
      // pinned without also pinning incidental punctuation between them.
      expect(title).toContain('headerlab bridge install');
      expect(title!.indexOf('headerlab bridge install')).toBeLessThan(
        title!.indexOf('Native host has exited.'),
      );
      // Chrome's own words, kept verbatim. A title that translated them into
      // one of the three possible causes would be a guess presented as a
      // diagnosis — Chrome gives the same message for all three (measured,
      // see ScopeRail.tsx's `bridge-label` docblock).
      expect(title).toContain('Native host has exited.');
    });
  });

  // Assertion 4, absence before presence: the ordinary idle state — the one
  // every install passes through between turning the switch on and running the
  // installer, with no error yet reported — says what it is without borrowing
  // the error treatment's words.
  it('explains an idle bridge without claiming an error nobody reported', () => {
    render(<ScopeRail {...props({ bridge: 'idle', bridgeError: null })} />);
    const label = screen.getByTestId('bridge-label');
    expect(label.textContent).toEqual('Agent bridge');
    const title = label.getAttribute('title')!;
    // It names the remedy, because "permission held, nothing connected" is
    // almost always `bridge install` never having been run...
    expect(title).toContain('headerlab bridge install');
    // ...but it must not read as a failure: absence before presence, so an
    // implementation that reused the unreachable wording here fails.
    expect(title).not.toContain('could not');
  });

  it('shows no bridge-error element at all — its subject is gone', () => {
    // The old note's testid must not resurrect itself under a different code
    // path. A stale error from before the permission was withdrawn must also
    // not accuse a bridge nobody has turned on.
    render(<ScopeRail {...props({ bridge: 'off', bridgeError: 'Native host has exited.' })} />);
    expect(screen.queryByTestId('bridge-error')).toBeNull();
  });

  it('calls enable from the off state and disable from the others', () => {
    const onEnableBridge = vi.fn();
    const onDisableBridge = vi.fn();
    for (const bridge of ['off', 'idle', 'live'] as const) {
      const { unmount } = render(
        <ScopeRail {...props({ bridge, onEnableBridge, onDisableBridge })} />,
      );
      within(screen.getByTestId('bridgestate')).getByRole('switch').click();
      unmount();
    }
    expect(onEnableBridge).toHaveBeenCalledTimes(1);
    expect(onDisableBridge).toHaveBeenCalledTimes(2);
  });

  it('names the switch after the row, and describes it with the report alone', () => {
    // Two defects pinned here.
    //
    // The old one: `aria-describedby` used to point at the visible label,
    // whose subtree text is just "Agent bridge" — the accessible-name
    // algorithm takes content before it ever falls back to the label's
    // `title`, so the description the markup promised was never delivered
    // and every failure state stayed hover-only. The ids have to resolve to
    // elements that really exist and really carry the report, checked the
    // way tooltip.test.tsx checks its own description (resolve, then read).
    //
    // The new one: the switch carried `aria-label={... 'Enable the agent
    // bridge' : 'Disable the agent bridge'}`, naming an action that
    // `role="switch"` already conveys, over a state `aria-checked` already
    // carries. Nothing in the repository pinned that string, which is how it
    // outlived the popup's own Enable button by a whole release.
    render(<ScopeRail {...props({ bridge: 'idle', bridgeError: 'Native host has exited.' })} />);
    const control = within(screen.getByTestId('bridgestate')).getByRole('switch');
    const resolve = (attr: string) =>
      (control.getAttribute(attr) ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? null);
    // An `aria-label` would win over `aria-labelledby`, so its absence is
    // part of the claim rather than an incidental detail.
    expect(control.getAttribute('aria-label')).toBeNull();
    expect(resolve('aria-labelledby')).toEqual(['Agent bridge']);
    // The description is the report and only the report: the name came out
    // of this list when it became the name, or every description would open
    // by repeating it.
    const described = resolve('aria-describedby');
    expect(described).toHaveLength(1);
    // The state word first — the one thing the dot's colour said alone —
    // then the remedy, then Chrome's own words, same order as the title.
    expect(described[0]).toMatch(/^cannot be reached — /);
    expect(described[0]).toContain('headerlab bridge install');
    expect(described[0]).toContain('Native host has exited.');
  });

  it('does not let the switch name invert under the user', () => {
    const names: (string | null)[] = [];
    for (const bridge of ['off', 'idle', 'live'] as const) {
      const { unmount } = render(<ScopeRail {...props({ bridge })} />);
      const control = within(screen.getByTestId('bridgestate')).getByRole('switch');
      const id = control.getAttribute('aria-labelledby')!;
      names.push(document.getElementById(id)?.textContent ?? null);
      unmount();
    }
    // The name is the thing; `aria-checked` is the state. A name that moved
    // with the state would say it twice and, in `live`, say it backwards.
    expect(new Set(names).size).toEqual(1);
    expect(names[0]).toEqual('Agent bridge');
  });

  it('keeps the detail span present but empty while the probe is out', () => {
    // `unknown` says nothing anywhere else; the span must not invent a state
    // either. It stays mounted (a description target that appears late is
    // read late) and empty.
    render(<ScopeRail {...props({ bridge: 'unknown' })} />);
    expect(screen.getByTestId('bridge-detail').textContent).toEqual('');
  });

  it('says on the row itself when a request was declined, rather than going quiet', () => {
    // The defect this replaces: the request came back refused, the row went on
    // reading "Bridge off", and nothing anywhere said a request had even been
    // made. Absence asserted before presence, so an "always marked"
    // implementation cannot pass.
    const { unmount } = render(<ScopeRail {...props({ bridge: 'off' })} />);
    expect(screen.getByTestId('bridgestate').getAttribute('data-request')).toBeNull();
    unmount();

    render(<ScopeRail {...props({ bridge: 'off', bridgeRequestError: { reason: 'declined' } })} />);
    const row = screen.getByTestId('bridgestate');
    expect(row.getAttribute('data-request')).toEqual('declined');
    expect(within(row).getByRole('switch').getAttribute('aria-checked')).toEqual('false');
    // The dot, asserted because it is the only part of this report a reader
    // gets without hovering — `data-request` is for tests and `title` needs a
    // pointer. Without this the amber could be deleted and every other
    // assertion in this file would still pass.
    expect(row.querySelector('[aria-hidden="true"]')!.className).toContain('border-pending');
  });

  it('leaves the dot neutral when no request has failed', () => {
    // The other half of the pair above: `off` with nothing wrong must not
    // borrow the pending colour, or the amber says nothing when it appears.
    render(<ScopeRail {...props({ bridge: 'off' })} />);
    const dot = screen.getByTestId('bridgestate').querySelector('[aria-hidden="true"]')!;
    expect(dot.className).toContain('border-muted-foreground');
    expect(dot.className).not.toContain('border-pending');
  });

  it("carries Chrome's own message when the request could not be made", () => {
    render(
      <ScopeRail
        {...props({
          bridge: 'off',
          bridgeRequestError: { reason: 'error', message: 'user gesture required' },
        })}
      />,
    );
    const row = screen.getByTestId('bridgestate');
    expect(row.getAttribute('data-request')).toEqual('error');
    // The message has to be readable, not merely stored — this is the whole
    // point of keeping it out of the catch.
    expect(screen.getByTestId('bridge-label').getAttribute('title')).toContain(
      'user gesture required',
    );
  });

  it('does not change the row while reporting a failed request', () => {
    // A control appearing must not resize what holds it (CLAUDE.md,
    // Interface), and this rail has zero slack — so the report rides the
    // existing row's colour and title rather than adding anything to it.
    const box = (over: Parameters<typeof props>[0]) => {
      const { unmount } = render(<ScopeRail {...props(over)} />);
      const row = screen.getByTestId('bridgestate');
      const shape = `${row.className}|${row.childElementCount}`;
      unmount();
      return shape;
    };

    expect(box({ bridge: 'off', bridgeRequestError: { reason: 'declined' } })).toEqual(
      box({ bridge: 'off' }),
    );
  });
});
