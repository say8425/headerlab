// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RulePanel, type RulePanelProps } from '@/components/RulePanel';
import { rowKey } from '@/lib/compile/validate';
import type { Diagnostic, HeaderRule } from '@/lib/model/types';

function rule(over: Partial<HeaderRule> = {}): HeaderRule {
  return {
    id: 'h1',
    enabled: true,
    target: 'request',
    operation: 'set',
    name: 'X-Test',
    value: 'v',
    ...over,
  };
}

function diag(over: Partial<Diagnostic> = {}): Diagnostic {
  return { kind: 'invalid-domain', severity: 'warning', profileId: 'p1', message: 'm', ...over };
}

function props(over: Partial<RulePanelProps> = {}): RulePanelProps {
  return {
    rules: [rule()],
    byRow: new Map(),
    autoFocusFirstRule: false,
    onPatchRule: vi.fn(),
    onDeleteRule: vi.fn(),
    onAddRule: vi.fn(),
    tally: { total: 1, live: 1, off: 0, unfinished: 0, blocked: 0 },
    sitesNeedingAccess: 0,
    ...over,
    // Set after the spread rather than defaulted inside it: `over` is
    // `Partial<RulePanelProps>`, so spreading it last widens every property
    // it touches to include `undefined` — harmless for the optional ones,
    // but `profileId` is required, and `over.profileId ?? 'p1'` is what
    // gets its type back to plain `string` for `RulePanelProps` while still
    // honouring an explicit override.
    profileId: over.profileId ?? 'p1',
  };
}

function renderPanel(over: Partial<RulePanelProps> = {}) {
  return render(<RulePanel {...props(over)} />);
}

describe('RulePanel', () => {
  it('renders one card per rule, in stored order, request and response interleaved', () => {
    // Not split into request and response groups: the direction pill on each
    // card says which it is, so the order on screen is the order the user put
    // them in. A grouped implementation would reorder these.
    renderPanel({
      rules: [
        rule({ id: 'a', name: 'First', target: 'request' }),
        rule({ id: 'b', name: 'Second', target: 'response' }),
        rule({ id: 'c', name: 'Third', target: 'request' }),
      ],
    });
    const names = screen
      .getAllByRole('textbox', { name: 'Header name' })
      .map((n) => (n as HTMLInputElement).value);
    expect(names).toEqual(['First', 'Second', 'Third']);
  });

  it('renders each diagnostic inside the rule it names, and not on the others', () => {
    // Task 13: a diagnostic is now a *descendant* of its rule's row, not a
    // sibling after it — that is the fix for CLAUDE.md's "a control
    // appearing must not resize what holds it" (Interface). A sibling block
    // still had a height, and a sibling gaining height still pushed every
    // *following* row down by that much; a descendant swapping content
    // inside a slot the row already reserves (line 2, sized for the value it
    // replaces) cannot resize anything, which a same-height sibling never
    // could guarantee. RuleCard's own docblock and the e2e suite's "an
    // error diagnostic replacing a rule row's value never resizes the row
    // or moves the rows below it" guard carry the height half of this
    // claim, which jsdom cannot see; this test carries the routing half,
    // which it can: a problem named for rule "b" renders inside rule "b"'s
    // own box and nowhere near rule "a"'s.
    renderPanel({
      rules: [rule({ id: 'a', name: 'Clean' }), rule({ id: 'b', name: 'Broken' })],
      byRow: new Map([
        [rowKey('p1', 'b'), [diag({ severity: 'error', message: 'Header name is empty.' })]],
      ]),
    });
    const [clean, broken] = screen.getAllByTestId('rule');
    expect(within(clean!).queryAllByTestId('rule-problem')).toEqual([]);
    const problem = within(broken!).getByTestId('rule-problem');
    expect(problem.textContent).toBe('Header name is empty.');
  });

  it('renders no cards and still offers a way to make one when there are no rules', () => {
    renderPanel({ rules: [] });
    expect(screen.queryAllByTestId('rule')).toEqual([]);
    expect(screen.getByRole('button', { name: 'New rule at end' })).toBeTruthy();
  });

  it('adds a rule from the ghost row at the end of the list', async () => {
    // The only entry point, and this is the whole of it. There were two — the
    // panel head carried a "New rule" button that never scrolled away — and
    // that one is gone (owner's call: two controls for one action, in a head
    // that has width to spare only because it spends none). Its test went with
    // it rather than being re-pointed here, because its subject was the *head*
    // button specifically; this test already covered the survivor. What is
    // left is the discoverable one at the end of the list you are reading.
    //
    // "New rule at end", not "New rule": the ghost row's accessible name is
    // its own, and it was written to be exact-matched apart from the head
    // button's. Keeping the full name matters more now, not less — there is no
    // longer a second control to be confused with, so a loose matcher here
    // would pass against a row that had lost its label entirely.
    const onAddRule = vi.fn();
    renderPanel({ onAddRule });
    await userEvent.click(screen.getByRole('button', { name: 'New rule at end' }));
    expect(onAddRule).toHaveBeenCalledTimes(1);
  });

  it('deletes the rule whose × was clicked, not the first one — on the second click', async () => {
    // Armed before it fires (useArmed): one click offers the second, the
    // second calls the handler. Pinned that the first click alone does
    // nothing, so the guard cannot be deleted without this failing.
    const onDeleteRule = vi.fn();
    renderPanel({
      rules: [rule({ id: 'a', name: 'First' }), rule({ id: 'b', name: 'Second' })],
      onDeleteRule,
    });
    const second = screen.getAllByTestId('rule')[1]!;
    await userEvent.click(within(second).getByRole('button', { name: 'Delete rule' }));
    expect(onDeleteRule).not.toHaveBeenCalled();
    // Armed is a visible state, not an implied one: a 12px glyph changing ink
    // is invisible at a glance, so the box itself paints with the destructive
    // fill — pinned here because that visibility is the whole point of the
    // two-click guard.
    const armed = within(second).getByRole('button', { name: 'Confirm delete rule' });
    expect(armed.className).toContain('bg-destructive/10');
    await userEvent.click(armed);
    expect(onDeleteRule).toHaveBeenCalledTimes(1);
    expect(onDeleteRule).toHaveBeenCalledWith('b');
  });

  it('patches the rule whose field was edited, not the first one', async () => {
    const onPatchRule = vi.fn();
    renderPanel({
      rules: [rule({ id: 'a', name: 'First' }), rule({ id: 'b', name: 'Second' })],
      onPatchRule,
    });
    const second = screen.getAllByTestId('rule')[1]!;
    await userEvent.type(within(second).getByRole('textbox', { name: 'Header name' }), '-Edited');
    await userEvent.tab();
    expect(onPatchRule).toHaveBeenCalledTimes(1);
    expect(onPatchRule).toHaveBeenCalledWith('b', { name: 'Second-Edited' });
  });
});

describe('RulePanel focus', () => {
  it('puts the caret in the first rule when asked, so a header can be typed immediately', () => {
    // The stated failure this replaces: an install opened on a "Create
    // profile" button with nothing to type into.
    renderPanel({ rules: [rule({ id: 'a', name: '', value: '' })], autoFocusFirstRule: true });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Header name' }));
  });

  it('leaves focus alone when not asked', () => {
    // Stealing focus on every open would fight a user who opened the popup to
    // read it rather than to edit it.
    renderPanel({ rules: [rule()], autoFocusFirstRule: false });
    expect(document.activeElement).toBe(document.body);
  });

  it('takes the caret only for the first rule, never a later one', () => {
    // `autoFocus` is passed per card, so an implementation that handed it to
    // every card would leave focus on whichever mounted last.
    renderPanel({
      rules: [rule({ id: 'a', name: '' }), rule({ id: 'b', name: 'Second' })],
      autoFocusFirstRule: true,
    });
    const names = screen.getAllByRole('textbox', { name: 'Header name' });
    expect(document.activeElement).toBe(names[0]);
  });
});

describe('the readout in the panel head', () => {
  // Moved here from ScopeRail's own suite when the count moved out of the rail
  // (owner's call, 2026-08-20). The wording changed with the move — one line
  // instead of two, "live" instead of "rules live" — so these read against the
  // new strings; what did not change is what each one is guarding.

  it('reports live, off and blocked together — and different figures read back differently', () => {
    // A single fixture would pass a component that renders any of these as a
    // literal. Re-rendering with a different tally forces it to read its prop.
    const { rerender } = renderPanel({
      tally: { total: 5, live: 2, off: 1, unfinished: 0, blocked: 2 },
    });
    expect(screen.getByTestId('readout').textContent).toBe('2 of 5 live· 1 off · 2 blocked');
    rerender(
      <RulePanel {...props({ tally: { total: 9, live: 7, off: 2, unfinished: 0, blocked: 0 } })} />,
    );
    expect(screen.getByTestId('readout').textContent).toBe('7 of 9 live· 2 off');
  });

  it('says nothing is configured yet when there are no rules at all', () => {
    // The count is suppressed entirely here rather than reading "0 of 0 live",
    // which names an empty rule set in arithmetic nobody asked for.
    renderPanel({ tally: { total: 0, live: 0, off: 0, unfinished: 0, blocked: 0 } });
    expect(screen.getByTestId('readout').textContent).toBe('nothing configured yet');
  });

  it('says the healthy state with the count alone, adding no second clause', () => {
    // This used to read "no problems", because the rail reserved a second line
    // that had to say *something* or leave a blank band inside a card. There is
    // no such line here — the count sits on the head's own row — so health is
    // "3 of 3 live" and the absence of a clause after it. A row of zeroes, or a
    // phrase restating what the count already says, would be the noise this
    // move was made to remove.
    renderPanel({ tally: { total: 3, live: 3, off: 0, unfinished: 0, blocked: 0 } });
    expect(screen.getByTestId('readout').textContent).toBe('3 of 3 live');
    expect(screen.queryByTestId('subcount')).toBeNull();
  });

  it('names only blocked when nothing is switched off', () => {
    renderPanel({ tally: { total: 3, live: 1, off: 0, unfinished: 0, blocked: 2 } });
    expect(screen.getByTestId('readout').textContent).toBe('1 of 3 live· 2 blocked');
  });

  it('says how many sites still need access while the granted ones keep the count', () => {
    // The half-granted state: the rules ARE live on the granted hosts, so
    // the count does not move — the clause names the hosts they cannot
    // reach, in the same words the rows below wear. With nothing granted
    // the blocked clause carries the story instead, so the clause stands
    // down (the third case below asserts it does NOT — see the note there).
    const tally = { total: 3, live: 3, off: 0, unfinished: 0, blocked: 0 };
    const { rerender } = renderPanel({ tally, sitesNeedingAccess: 1 });
    expect(screen.getByTestId('readout').textContent).toBe('3 of 3 live· 1 site needs access');

    rerender(<RulePanel {...props({ tally, sitesNeedingAccess: 2 })} />);
    expect(screen.getByTestId('readout').textContent).toBe('3 of 3 live· 2 sites need access');

    // Nothing granted at all — and this case used to assert the OPPOSITE, that
    // the clause stood down here because the blocked count "carried the whole
    // story". It stopped carrying it when the count's blame suffix was
    // dropped, leaving the first screen a new user sees naming no remedy. The
    // clause is what names one, so it is asserted present exactly where it was
    // once asserted absent.
    rerender(
      <RulePanel
        {...props({
          tally: { total: 3, live: 0, off: 0, unfinished: 0, blocked: 3 },
          sitesNeedingAccess: 3,
        })}
      />,
    );
    expect(screen.getByTestId('readout').textContent).toBe(
      '0 of 3 live· 3 blocked · 3 sites need access',
    );
  });

  it('names unfinished rules, so a row left quiet is still said out loud', () => {
    // This count is where "unfinished" gets said. The rule itself shows no
    // problem block — an empty name on a row created one click ago is not a
    // mistake to report — so if this went missing the state would be genuinely
    // hidden, which is the silence the product exists to remove.
    renderPanel({ tally: { total: 4, live: 3, off: 0, unfinished: 1, blocked: 0 } });
    expect(screen.getByTestId('readout').textContent).toBe('3 of 4 live· 1 unfinished');
  });

  it('keeps unfinished distinct from off and from blocked when all three are present', () => {
    // Three different figures with three different values, so a component that
    // rendered any one of them in another's place cannot pass. This is also the
    // reading order the count is written in.
    renderPanel({ tally: { total: 9, live: 3, off: 1, unfinished: 2, blocked: 3 } });
    expect(screen.getByTestId('readout').textContent).toBe(
      '3 of 9 live· 1 off · 2 unfinished · 3 blocked',
    );
  });

  it('lets only the detail truncate, never the count', () => {
    // The head is one line, so something must give when the detail is long.
    // The count is short, always relevant, and the half a reader came for —
    // so `truncate` is on the detail and `shrink-0` on the count. Asserted by
    // class rather than by pixels because the geometry is the e2e suite's job;
    // what is pinned here is which of the two was chosen to yield.
    renderPanel({ tally: { total: 9, live: 3, off: 1, unfinished: 2, blocked: 3 } });
    const detail = screen.getByTestId('subcount');
    expect(detail.className).toContain('truncate');
    expect(detail.getAttribute('title')).toBe('1 off · 2 unfinished · 3 blocked');
  });
});
