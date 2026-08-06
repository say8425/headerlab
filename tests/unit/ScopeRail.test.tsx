// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScopeRail, type ScopeRailProps } from '@/components/ScopeRail';
import type { Diagnostic } from '@/lib/model/types';

function diag(over: Partial<Diagnostic> = {}): Diagnostic {
  return { kind: 'empty-filter', severity: 'warning', profileId: 'p1', message: 'm', ...over };
}

function permission(host: string): Diagnostic {
  return {
    kind: 'permission-missing', severity: 'warning', profileId: 'p1', host,
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
    const { rerender } = renderRail({ tally: { total: 5, live: 2, off: 1, unfinished: 0, blocked: 2 } });
    expect(screen.getByTestId('readout').textContent).toBe(
      '2of 5 rules live1 off · 2 blocked',
    );
    rerender(<ScopeRail {...props({ tally: { total: 9, live: 7, off: 2, unfinished: 0, blocked: 0 } })} />);
    expect(screen.getByTestId('readout').textContent).toBe('7of 9 rules live2 off');
  });

  it('says nothing is configured yet when there are no rules at all', () => {
    renderRail({ tally: { total: 0, live: 0, off: 0, unfinished: 0, blocked: 0 } });
    expect(screen.getByTestId('readout').textContent).toBe('0of 0 rules livenothing configured yet');
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
    expect(screen.getByTestId('readout').textContent)
      .toBe('1of 2 rules live1 blocked by an unusable site');

    rerender(<ScopeRail {...props({ tally, blockedBy: 'pause' })} />);
    expect(screen.getByTestId('readout').textContent)
      .toBe('1of 2 rules live1 blocked while paused');

    rerender(<ScopeRail {...props({ tally, blockedBy: null })} />);
    expect(screen.getByTestId('readout').textContent).toBe('1of 2 rules live1 blocked');
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

  it('mirrors the run state on the switch itself, not only in the word beside it', () => {
    const { rerender } = renderRail({ paused: false });
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    rerender(<ScopeRail {...props({ paused: true })} />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  });

  it('pauses from running and resumes from paused', async () => {
    // Both directions, so a handler that always sends `true` cannot pass.
    const onTogglePause = vi.fn();
    const { rerender } = renderRail({ paused: false, onTogglePause });
    await userEvent.click(screen.getByRole('switch'));
    expect(onTogglePause).toHaveBeenLastCalledWith(true);

    rerender(<ScopeRail {...props({ paused: true, onTogglePause })} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onTogglePause).toHaveBeenLastCalledWith(false);
  });
});

describe('sites', () => {
  it('renders one row per domain, in order, and counts them in the heading', () => {
    renderRail({ domains: ['api.example.com', 'staging.acme.dev'] });
    expect(screen.getAllByTestId('site').map((s) => s.textContent)).toEqual([
      'api.example.com×',
      'staging.acme.dev×',
    ]);
    expect(screen.getByText('Sites').textContent).toBe('Sites 2');
  });

  it('says the scope is every site when no domain is set', () => {
    renderRail({ domains: [] });
    expect(screen.getByText('Sites').textContent).toBe('Sites all');
    expect(screen.queryAllByTestId('site')).toEqual([]);
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

  it('offers no Grant for a site problem that is not about permission', () => {
    // `host` is set here too, on an otherwise Grant-eligible-looking fixture —
    // without it "no button" would be true for the wrong reason.
    renderRail({
      domains: ['api.example.com'],
      byHost: new Map([[
        'api.example.com',
        [diag({ kind: 'invalid-domain', severity: 'error', host: 'api.example.com', message: 'unusable' })],
      ]]),
    });
    expect(screen.queryByRole('button', { name: 'Grant' })).toBeNull();
    expect(screen.getByTestId('site-problem').textContent).toBe('unusable');
  });

  it('removes the domain whose × was clicked', async () => {
    const onRemoveDomain = vi.fn();
    renderRail({ domains: ['a.example.com', 'b.example.com'], onRemoveDomain });
    await userEvent.click(screen.getByRole('button', { name: 'Remove b.example.com' }));
    expect(onRemoveDomain).toHaveBeenCalledTimes(1);
    expect(onRemoveDomain).toHaveBeenCalledWith('b.example.com');
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

  it('teaches the host-only rule on the field, once, rather than after each entry', async () => {
    // The one fact the chip cannot convey: a port could never have narrowed
    // anything, because requestDomains is host-only. Said before the typing it
    // prevents the mistake; said after it would only explain a change already
    // visible in the chip.
    renderRail();
    expect(screen.getByText(/Matched by host/).textContent)
      .toBe('Matched by host — a port or path cannot narrow it.');
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
      'main_frame', 'sub_frame', 'xmlhttprequest', 'script',
      'stylesheet', 'image', 'font', 'media',
    ]);
  });

  it('shows xmlhttprequest as xhr, because the rail column is not 14 characters wide', () => {
    renderRail();
    expect(screen.getByRole('button', { name: 'xmlhttprequest' }).textContent).toBe('xhr');
  });

  it('marks the selected types and leaves the rest unmarked', () => {
    renderRail({ resourceTypes: ['script'] });
    expect(screen.getByRole('button', { name: 'script' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'image' }).getAttribute('aria-pressed')).toBe('false');
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
    await userEvent.click(screen.getByRole('button', { name: 'image' }));
    expect(onToggleType).toHaveBeenNthCalledWith(1, 'image');
    await userEvent.click(screen.getByRole('button', { name: 'font' }));
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
        diag({ kind: 'empty-filter', message: 'No site set.' }),
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
      notes: [diag({ kind: 'empty-filter', message: 'No site set.' })],
    });
    const note = screen.getByTestId('scope-note');
    const types = screen.getByText('Request types');
    expect(note.compareDocumentPosition(types) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the real text of a failed reconcile, and not as a scope note', () => {
    // A reconcile failure means nothing is registered, which contradicts the
    // run state directly above it. It is not about scope and must not be filed
    // among the things that are.
    renderRail({ lastError: 'Rule 3 is invalid' });
    expect(screen.getByTestId('sync-error').textContent).toBe('Rules not registeredRule 3 is invalid');
    expect(screen.queryAllByTestId('scope-note')).toEqual([]);
  });
});
