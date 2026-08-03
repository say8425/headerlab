// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterBlock } from '@/components/FilterBlock';
import { TopBar } from '@/components/TopBar';
import { StatusFoot } from '@/components/StatusFoot';
import type { Filter } from '@/lib/model/types';

function filter(over: Partial<Filter> = {}): Filter {
  return {
    mode: 'structured',
    domains: ['api.example.com'],
    excludedDomains: [],
    resourceTypes: ['xmlhttprequest', 'main_frame'],
    ...over,
  };
}

describe('FilterBlock', () => {
  it('shows the domains joined for reading', () => {
    render(<FilterBlock filter={filter({ domains: ['a.com', 'b.com'] })} onPatch={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /Match domains/ }).getAttribute('value')).toBe('a.com, b.com');
  });

  it('commits domains on blur, split and trimmed', async () => {
    const onPatch = vi.fn();
    render(<FilterBlock filter={filter({ domains: [] })} onPatch={onPatch} />);
    const input = screen.getByRole('textbox', { name: /Match domains/ });
    await userEvent.type(input, ' a.com ,  b.com ');
    expect(onPatch).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ domains: ['a.com', 'b.com'] });
  });

  it('does not swallow a comma while typing', async () => {
    // The Phase 1 popup split on every keystroke, so a comma vanished as you
    // typed it. The draft is local now, which is what fixes it.
    const onPatch = vi.fn();
    render(<FilterBlock filter={filter({ domains: [] })} onPatch={onPatch} />);
    const input = screen.getByRole('textbox', { name: /Match domains/ });
    await userEvent.type(input, 'a.com,');
    expect(input.getAttribute('value')).toBe('a.com,');
  });

  it('commits the domains once even when Enter is followed by Tab', async () => {
    // Same shape as HeaderRow's name input (tests/unit/editing.test.tsx) and
    // ProfileEditStrip's (tests/unit/ProfileBar.test.tsx): the domains input
    // never leaves its editable state on Enter, so a later blur re-evaluates
    // the same commit condition. If that condition compares the derived
    // array against the (possibly stale) round-tripped `filter.domains` prop
    // instead of against what this component itself last sent, a Tab right
    // after an Enter re-fires onPatch for the same edit.
    const onPatch = vi.fn();
    render(<FilterBlock filter={filter({ domains: [] })} onPatch={onPatch} />);
    const input = screen.getByRole('textbox', { name: /Match domains/ });
    await userEvent.type(input, 'a.com,{Enter}');
    await userEvent.tab();
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ domains: ['a.com'] });
  });

  it('shows exactly the eight offered resource types as chips, in order', () => {
    // A bare length check of 8 would pass eight arbitrary chips. Pinning the
    // brief's verbatim list by aria-label rules that out and also subsumes
    // the length assertion.
    render(<FilterBlock filter={filter()} onPatch={vi.fn()} />);
    const labels = screen.getAllByTestId('type-chip').map((c) => c.getAttribute('aria-label'));
    expect(labels).toEqual([
      'main_frame', 'sub_frame', 'xmlhttprequest', 'script',
      'stylesheet', 'image', 'font', 'media',
    ]);
  });

  it('marks the selected types', () => {
    render(<FilterBlock filter={filter({ resourceTypes: ['script'] })} onPatch={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'script' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'image' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('adds the clicked type — a different chip adds a different type', async () => {
    // Clicking only one chip would also pass a component that hardcodes the
    // appended type instead of reading which chip fired the click.
    const onPatch = vi.fn();
    render(<FilterBlock filter={filter({ resourceTypes: ['script'] })} onPatch={onPatch} />);
    await userEvent.click(screen.getByRole('button', { name: 'image' }));
    expect(onPatch).toHaveBeenNthCalledWith(1, { resourceTypes: ['script', 'image'] });
    await userEvent.click(screen.getByRole('button', { name: 'font' }));
    expect(onPatch).toHaveBeenNthCalledWith(2, { resourceTypes: ['script', 'font'] });
  });

  it('removes the clicked type — a different chip removes a different type', async () => {
    // Three selected types so that removing either of two different chips
    // leaves a distinguishable two-element array — with only two selected
    // types, removing either one leaves a one-element array and the test
    // cannot tell "removed the clicked chip" from "removed an arbitrary one".
    const onPatch = vi.fn();
    render(
      <FilterBlock filter={filter({ resourceTypes: ['script', 'image', 'font'] })} onPatch={onPatch} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'script' }));
    expect(onPatch).toHaveBeenNthCalledWith(1, { resourceTypes: ['image', 'font'] });
    await userEvent.click(screen.getByRole('button', { name: 'font' }));
    expect(onPatch).toHaveBeenNthCalledWith(2, { resourceTypes: ['script', 'image'] });
  });

  it('refuses to remove the last type — DNR rejects an empty array', async () => {
    const onPatch = vi.fn();
    render(<FilterBlock filter={filter({ resourceTypes: ['script'] })} onPatch={onPatch} />);
    await userEvent.click(screen.getByRole('button', { name: 'script' }));
    expect(onPatch).not.toHaveBeenCalled();
  });
});

describe('TopBar', () => {
  it('says Running when not paused', () => {
    render(<TopBar paused={false} onTogglePause={vi.fn()} />);
    expect(screen.getByTestId('runstate').textContent).toContain('Running');
  });

  it('says Paused when paused', () => {
    render(<TopBar paused onTogglePause={vi.fn()} />);
    expect(screen.getByTestId('runstate').textContent).toContain('Paused');
  });

  it('toggles from running to paused, passing true', async () => {
    const onTogglePause = vi.fn();
    render(<TopBar paused={false} onTogglePause={onTogglePause} />);
    await userEvent.click(screen.getByRole('button', { name: /Pause all/ }));
    expect(onTogglePause).toHaveBeenCalledWith(true);
  });

  it('toggles from paused to running, passing false', async () => {
    // Pinned separately from the previous case so a component that always
    // calls onTogglePause(true) regardless of the current state cannot pass
    // both — it must send the negation of the current `paused` prop.
    const onTogglePause = vi.fn();
    render(<TopBar paused onTogglePause={onTogglePause} />);
    await userEvent.click(screen.getByRole('button', { name: /Resume all/ }));
    expect(onTogglePause).toHaveBeenCalledWith(false);
  });
});

describe('StatusFoot', () => {
  it('reports the counts — and different counts read back differently', () => {
    // A single fixture would pass a component that hardcodes "1 off" as a
    // literal. Rerendering with different numbers forces the component to
    // actually read its props (same shape as the Task 6 swatch fix).
    const { rerender } = render(
      <StatusFoot applying={6} total={8} off={1} needsAccess={0} lastError={null} />,
    );
    expect(screen.getByTestId('foot').textContent).toContain('6 of 8 rules applying');
    expect(screen.getByTestId('foot').textContent).toContain('1 off');
    rerender(<StatusFoot applying={2} total={9} off={4} needsAccess={0} lastError={null} />);
    expect(screen.getByTestId('foot').textContent).toContain('2 of 9 rules applying');
    expect(screen.getByTestId('foot').textContent).toContain('4 off');
  });

  it('mentions needed access only when some is needed', () => {
    const { rerender } = render(<StatusFoot applying={6} total={8} off={1} needsAccess={0} lastError={null} />);
    expect(screen.queryByTestId('needs-access')).toBeNull();
    rerender(<StatusFoot applying={6} total={8} off={1} needsAccess={2} lastError={null} />);
    expect(screen.getByTestId('needs-access').textContent).toContain('2 need access');
  });

  it('shows the real failure text when the last sync failed, in place of the normal counts', async () => {
    // Checking only for the presence of the error text would still pass a
    // component that renders the error alongside the normal counts instead
    // of branching to replace them — the `not.toContain` half pins the
    // branch, not just the string.
    render(<StatusFoot applying={0} total={3} off={0} needsAccess={0} lastError="Rule 3 is invalid" />);
    const text = screen.getByTestId('foot').textContent ?? '';
    expect(text).toContain('Rule 3 is invalid');
    expect(text).not.toContain('rules applying');
  });
});
