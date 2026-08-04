// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HeaderGrid } from '@/components/HeaderGrid';
import { createProfile } from '@/lib/model/defaults';
import type { HeaderRule, Profile } from '@/lib/model/types';

function row(over: Partial<HeaderRule> = {}): HeaderRule {
  return {
    id: 'h1', enabled: true, target: 'request',
    operation: 'set', name: 'X-Test', value: 'v',
    ...over,
  };
}

function profileWith(headers: HeaderRule[]): Profile {
  return { ...createProfile('P', 0), id: 'p1', headers };
}

// `live` defaults to true: every case below except the two that name it is
// about row state, which is what the grid showed before the profile-level
// judgements were threaded in, so their expected counts are unchanged.
function renderGrid(headers: HeaderRule[], live = true) {
  return render(
    <HeaderGrid
      profile={profileWith(headers)}
      byRow={new Map()}
      live={live}
      onToggleRow={vi.fn()}
      onPatchRow={vi.fn()}
      onDeleteRow={vi.fn()}
      onAddRow={vi.fn()}
    />,
  );
}

describe('HeaderGrid', () => {
  it('owns --cols and states it once', () => {
    const { container } = renderGrid([row()]);
    const owner = container.querySelector('[data-cols-owner]');
    expect(owner).not.toBeNull();
    // Every element that lays out on the grid reads the variable rather than
    // repeating the track list. Phase 2a lost a day to a duplicated constant
    // twice; this assertion is what keeps that from happening here.
    expect(container.querySelectorAll('[data-cols-owner]')).toHaveLength(1);
    // The stylesheet declares `--cols` on `.hl-gbody` (cols.test.ts pins that
    // selector). This is the other end of the same pairing: if the owner
    // attribute ever moves to a different element, `var(--cols)` resolves to
    // nothing and neither the CSS-side nor the count assertion notices.
    expect(owner!.className).toBe('hl-gbody');
  });

  it('renders both group headers with their counts', () => {
    renderGrid([
      row({ id: 'a', target: 'request' }),
      row({ id: 'b', target: 'request', enabled: false }),
      row({ id: 'c', target: 'response' }),
    ]);
    // `toContain`, not equality: the group header holds its label and count
    // alongside this figure, so a partial check is what is meant here.
    expect(screen.getByTestId('group-request').textContent).toContain('1 of 2 applying');
    expect(screen.getByTestId('group-response').textContent).toContain('1 of 1 applying');
  });

  it('reports nothing applying in either group header when the profile emits no rules', () => {
    // The rows here are switched on and carry no diagnostic — `byRow` is empty
    // because neither suppression nor globalPause is a row-level judgement, so
    // nothing about them can reach it. This is the case where the group header
    // said "1 of 1 applying" while compile() had registered zero rules.
    renderGrid([
      row({ id: 'a', target: 'request' }),
      row({ id: 'c', target: 'response' }),
    ], false);
    expect(screen.getByTestId('group-request').textContent).toContain('0 of 1 applying');
    expect(screen.getByTestId('group-response').textContent).toContain('0 of 1 applying');
  });

  it('renders one row per header, in order', () => {
    renderGrid([
      row({ id: 'a', name: 'First' }),
      row({ id: 'b', name: 'Second' }),
    ]);
    // The name lives in a text box from the start — read-only until Task 5
    // makes it editable — so this accessor does not change when it does.
    const names = screen
      .getAllByRole('textbox', { name: /Header name/ })
      .map((n) => (n as HTMLInputElement).value);
    expect(names).toEqual(['First', 'Second']);
  });

  it('shows a disabled row switched off rather than hiding it', () => {
    renderGrid([row({ id: 'a', enabled: false, name: 'Off-row' })]);
    expect(screen.getByDisplayValue('Off-row')).toBeTruthy();
    expect(screen.getByRole('switch', { name: /Off-row/ }).getAttribute('aria-checked')).toBe('false');
  });

  it('shows an add row for each group', () => {
    renderGrid([row()]);
    expect(screen.getByRole('button', { name: 'Add request header' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add response header' })).toBeTruthy();
  });

  it('renders an empty group with a zero count and still offers its add row', () => {
    renderGrid([row({ target: 'request' })]);
    expect(screen.getByTestId('group-response').textContent).toContain('0 of 0 applying');
    expect(screen.getByRole('button', { name: 'Add response header' })).toBeTruthy();
  });

  it('shows a remove row with no value rather than an empty cell', () => {
    renderGrid([row({ operation: 'remove', value: '' })]);
    expect(screen.getByTestId('row-value').textContent).toContain('no value');
  });
});
