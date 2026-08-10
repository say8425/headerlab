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
  return { kind: 'no-scope', severity: 'warning', profileId: 'p1', message: 'm', ...over };
}

function props(over: Partial<RulePanelProps> = {}): RulePanelProps {
  return {
    rules: [rule()],
    byRow: new Map(),
    autoFocusFirstRule: false,
    onPatchRule: vi.fn(),
    onDeleteRule: vi.fn(),
    onAddRule: vi.fn(),
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

  it('adds a rule from the head button, which never scrolls away', async () => {
    // "New rule", not "+ New rule": the plus is a lucide icon carrying no
    // accessible name of its own now, where it used to be a literal `+`
    // character in the label. Exact-matching the two names apart is what keeps
    // this from also matching the ghost row below.
    const onAddRule = vi.fn();
    renderPanel({ onAddRule });
    await userEvent.click(screen.getByRole('button', { name: 'New rule' }));
    expect(onAddRule).toHaveBeenCalledTimes(1);
  });

  it('adds a rule from the ghost row at the end of the list', async () => {
    // Two entry points, both asserted: the head button is the one that is
    // always reachable, the ghost row is the discoverable one at the end of
    // the list you are already reading.
    const onAddRule = vi.fn();
    renderPanel({ onAddRule });
    await userEvent.click(screen.getByRole('button', { name: 'New rule at end' }));
    expect(onAddRule).toHaveBeenCalledTimes(1);
  });

  it('deletes the rule whose × was clicked, not the first one', async () => {
    const onDeleteRule = vi.fn();
    renderPanel({
      rules: [rule({ id: 'a', name: 'First' }), rule({ id: 'b', name: 'Second' })],
      onDeleteRule,
    });
    const second = screen.getAllByTestId('rule')[1]!;
    await userEvent.click(within(second).getByRole('button', { name: 'Delete rule' }));
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
