// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RulePanel, type RulePanelProps } from '@/components/RulePanel';
import type { Diagnostic, HeaderRule } from '@/lib/model/types';

function rule(over: Partial<HeaderRule> = {}): HeaderRule {
  return {
    id: 'h1', enabled: true, target: 'request',
    operation: 'set', name: 'X-Test', value: 'v',
    ...over,
  };
}

function diag(over: Partial<Diagnostic> = {}): Diagnostic {
  return { kind: 'empty-filter', severity: 'warning', profileId: 'p1', message: 'm', ...over };
}

function props(over: Partial<RulePanelProps> = {}): RulePanelProps {
  return {
    rules: [rule()],
    byRow: new Map(),
    firstRun: false,
    onPatchRule: vi.fn(),
    onDeleteRule: vi.fn(),
    onAddRule: vi.fn(),
    ...over,
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

  it('hangs each diagnostic under the rule it names, and not under the others', () => {
    renderPanel({
      rules: [rule({ id: 'a', name: 'Clean' }), rule({ id: 'b', name: 'Broken' })],
      byRow: new Map([['b', [diag({ severity: 'error', message: 'Header name is empty.' })]]]),
    });
    const [clean, broken] = screen.getAllByTestId('rule');
    expect(within(clean!).queryAllByTestId('rule-problem')).toEqual([]);
    expect(within(broken!).getByTestId('rule-problem').textContent).toBe('!Header name is empty.');
  });

  it('renders no cards and still offers a way to make one when there are no rules', () => {
    renderPanel({ rules: [] });
    expect(screen.queryAllByTestId('rule')).toEqual([]);
    expect(screen.getByRole('button', { name: 'New rule at end' })).toBeTruthy();
  });

  it('adds a rule from the head button, which never scrolls away', async () => {
    const onAddRule = vi.fn();
    renderPanel({ onAddRule });
    await userEvent.click(screen.getByRole('button', { name: '+ New rule' }));
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

describe('RulePanel on a fresh install', () => {
  it('says the starter rule is already started and nothing needs setting up first', () => {
    renderPanel({ rules: [rule({ id: 'a', name: '', value: '' })], firstRun: true });
    expect(screen.getByText(/you do not have to set anything up first/)).toBeTruthy();
  });

  it('puts the caret in the starter rule, so a header can be typed immediately', () => {
    // The stated failure this replaces: a fresh install opened on a "Create
    // profile" button with nothing to type into.
    renderPanel({ rules: [rule({ id: 'a', name: '', value: '' })], firstRun: true });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Header name' }));
  });

  it('drops the hint once the install is no longer fresh', () => {
    renderPanel({ rules: [rule()], firstRun: false });
    expect(screen.queryByText(/you do not have to set anything up first/)).toBeNull();
  });

  it('leaves focus alone once the install is no longer fresh', () => {
    // Stealing focus on every open would fight a user who opened the popup to
    // read it rather than to edit it.
    renderPanel({ rules: [rule()], firstRun: false });
    expect(document.activeElement).toBe(document.body);
  });
});
