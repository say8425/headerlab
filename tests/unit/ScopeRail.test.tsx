// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScopeRail, type ScopeRailProps } from '@/components/ScopeRail';
import type { Diagnostic } from '@/lib/model/types';

function diag(over: Partial<Diagnostic> = {}): Diagnostic {
  return { kind: 'no-scope', severity: 'warning', profileId: 'p1', message: 'm', ...over };
}

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
    tally: { total: 0, live: 0, off: 0, unfinished: 0, blocked: 0 },
    paused: false,
    onTogglePause: vi.fn(),
    domains: [],
    byHost: new Map(),
    notes: [],
    blockedBy: null,
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
    ...over,
  };
}

function renderRail(over: Partial<ScopeRailProps> = {}) {
  return render(<ScopeRail {...props(over)} />);
}

describe('the readout', () => {
  it('reports live, off and blocked together — and different figures read back differently', () => {
    // A single fixture would pass a component that renders any of these as a
    // literal. Re-rendering with a different tally forces it to read its prop.
    const { rerender } = renderRail({
      tally: { total: 5, live: 2, off: 1, unfinished: 0, blocked: 2 },
    });
    expect(screen.getByTestId('readout').textContent).toBe('2of 5 rules live1 off · 2 blocked');
    rerender(
      <ScopeRail {...props({ tally: { total: 9, live: 7, off: 2, unfinished: 0, blocked: 0 } })} />,
    );
    expect(screen.getByTestId('readout').textContent).toBe('7of 9 rules live2 off');
  });

  it('says nothing is configured yet when there are no rules at all', () => {
    renderRail({ tally: { total: 0, live: 0, off: 0, unfinished: 0, blocked: 0 } });
    expect(screen.getByTestId('readout').textContent).toBe(
      '0of 0 rules livenothing configured yet',
    );
  });

  it('adds no second line when every rule is going out', () => {
    // The big number already says it. A line reading "0 off · 0
    // blocked" would be noise that never changes.
    renderRail({ tally: { total: 3, live: 3, off: 0, unfinished: 0, blocked: 0 } });
    expect(screen.getByTestId('readout').textContent).toBe('3of 3 rules live');
  });

  it('names only blocked when nothing is switched off', () => {
    renderRail({ tally: { total: 3, live: 1, off: 0, unfinished: 0, blocked: 2 } });
    expect(screen.getByTestId('readout').textContent).toBe('1of 3 rules live2 blocked');
  });

  it('says what is holding the rules when it is not the rules themselves', () => {
    // "1 blocked" beside a perfectly good rule points the user at the wrong
    // object. An unusable site stops every rule while each one is fine, and a
    // pause does the same — so the count names the cause instead of implying
    // the rule is at fault. All three renderings are pinned together, because
    // an implementation that ignored the prop would still pass any one alone.
    const tally = { total: 2, live: 1, off: 0, unfinished: 0, blocked: 1 };
    const { rerender } = renderRail({ tally, blockedBy: 'sites' });
    expect(screen.getByTestId('readout').textContent).toBe(
      '1of 2 rules live1 blocked by an unusable site',
    );

    rerender(<ScopeRail {...props({ tally, blockedBy: 'pause' })} />);
    expect(screen.getByTestId('readout').textContent).toBe(
      '1of 2 rules live1 blocked while paused',
    );

    rerender(<ScopeRail {...props({ tally, blockedBy: null })} />);
    expect(screen.getByTestId('readout').textContent).toBe('1of 2 rules live1 blocked');
  });

  it('distinguishes having no scope from having a broken one', () => {
    // Two states that both stop every rule and call for opposite actions.
    // "by an unusable site" sends the reader hunting through the list for a
    // broken entry — which, when nothing has been added yet, does not exist.
    // Pinned against the unusable wording in the same test so the two cannot
    // quietly converge on one string.
    const tally = { total: 2, live: 0, off: 0, unfinished: 0, blocked: 2 };
    const { rerender } = renderRail({ tally, blockedBy: 'scope' });
    expect(screen.getByTestId('readout').textContent).toBe(
      '0of 2 rules live2 blocked until a site is set',
    );

    rerender(<ScopeRail {...props({ tally, blockedBy: 'sites' })} />);
    expect(screen.getByTestId('readout').textContent).toBe(
      '0of 2 rules live2 blocked by an unusable site',
    );
  });

  it('names unfinished rules, so a row left quiet is still said out loud', () => {
    // The rail is where "unfinished" gets said. The rule itself shows no
    // problem block — an empty name on a row created one click ago is not a
    // mistake to report — so if this count went missing the state would be
    // genuinely hidden, which is the silence the product exists to remove.
    renderRail({ tally: { total: 4, live: 3, off: 0, unfinished: 1, blocked: 0 } });
    expect(screen.getByTestId('readout').textContent).toBe('3of 4 rules live1 unfinished');
  });

  it('keeps unfinished distinct from off and from blocked when all three are present', () => {
    // Three different figures with three different values, so a component that
    // rendered any one of them in another's place cannot pass. This is also the
    // reading order the count is written in.
    renderRail({ tally: { total: 9, live: 3, off: 1, unfinished: 2, blocked: 3 } });
    expect(screen.getByTestId('readout').textContent).toBe(
      '3of 9 rules live1 off · 2 unfinished · 3 blocked',
    );
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
      'api.example.com×Access granted',
      'staging.acme.dev×Access granted',
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
    renderRail({
      domains: ['ok.example.com', 'pending.example.com', 'a b.com'],
      byHost: new Map([['pending.example.com', [permission('pending.example.com')]]]),
    });
    const labels = screen
      .getAllByTestId('site')
      .map((row) => within(row).getByRole('img').getAttribute('aria-label'));
    expect(labels).toEqual(['Access granted', 'Awaiting permission', 'Unusable site']);
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

  it('removes the domain whose × was clicked', async () => {
    const onRemoveDomain = vi.fn();
    renderRail({ domains: ['a.example.com', 'b.example.com'], onRemoveDomain });
    await userEvent.click(screen.getByRole('button', { name: 'Remove b.example.com' }));
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
      'api.example.com×Not in use while All sites is on',
      'x.com×Not in use while All sites is on',
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
    expect(screen.getByTestId('site').textContent).toBe('api.example.com×Access granted');
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

  it('adds on Enter, trimmed, and clears itself', async () => {
    const onAddDomain = vi.fn(() => ({ added: true as const }));
    renderRail({ onAddDomain });
    await userEvent.type(field(), '  api.example.com  {Enter}');
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
    expect(screen.getByTestId('add-site-note').textContent).toBe('x.com is already in the list.');
    expect(field()).toHaveProperty('value', 'https://x.com/');
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
    // The one fact the chip cannot convey: a port could never have narrowed
    // anything, because requestDomains is host-only. It is worth knowing once,
    // not worth permanent space in a 196px column — so the rail carries a `?`
    // and nothing else until someone reaches for it.
    renderRail();
    expect(screen.queryByTestId('help-bubble')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'About matching sites' }));
    // Worked pairs first, then the rule they demonstrate — a developer
    // pattern-matches the transformation faster than a sentence describing it.
    expect(screen.getByTestId('help-bubble').textContent).toBe(
      'https://x.com/a/b→x.comlocalhost:3000→localhost' +
        'Matched by host — a port or path is dropped.',
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
});

describe('request types', () => {
  it('shows exactly the eight offered types, in order, named as Chrome names them', () => {
    // A bare length check would pass eight arbitrary rows. The accessible names
    // are the real ResourceType values even where the visible label is shorter,
    // because that is the word the user has to match against every other tool.
    renderRail();
    expect(screen.getAllByTestId('type-check').map((c) => c.getAttribute('aria-label'))).toEqual([
      'main_frame',
      'sub_frame',
      'xmlhttprequest',
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
      screen.getByRole('checkbox', { name: 'xmlhttprequest' }).closest('label')?.textContent,
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

describe('scope notes', () => {
  it('shows nothing when there is nothing to say', () => {
    renderRail();
    expect(screen.queryAllByTestId('scope-note')).toEqual([]);
    expect(screen.queryByTestId('sync-error')).toBeNull();
  });

  it('shows one note per scope diagnostic, in order, with its severity marked', () => {
    renderRail({
      notes: [
        diag({ kind: 'no-scope', message: 'No site set.' }),
        diag({ kind: 'invalid-domain', severity: 'error', message: 'Unusable site.' }),
      ],
    });
    const notes = screen.getAllByTestId('scope-note');
    expect(notes.map((n) => n.textContent)).toEqual(['No site set.', 'Unusable site.']);
    expect(notes.map((n) => n.getAttribute('data-severity'))).toEqual(['warning', 'error']);
  });

  it('puts its notes above the request-type checklist, where they cannot be scrolled past', () => {
    // The rail scrolls. With two sites awaiting permission the real diagnostic
    // copy is tall enough that anything below the checklist falls past 600px —
    // measured on the built popup, where a scope note landed roughly 37px out
    // of sight. A warning you have to go looking for is the failure
    // this layout exists to remove, and the checklist is the least-touched
    // control on screen, so it is the part that can afford to be scrolled to.
    renderRail({
      domains: ['api.example.com'],
      notes: [diag({ kind: 'no-scope', message: 'No site set.' })],
    });
    const note = screen.getByTestId('scope-note');
    const types = screen.getByText('Request types');
    expect(note.compareDocumentPosition(types) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
