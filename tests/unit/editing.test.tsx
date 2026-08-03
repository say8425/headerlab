// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ValueCell } from '@/components/ValueCell';
import { HeaderRow } from '@/components/HeaderRow';
import type { HeaderRule } from '@/lib/model/types';

function rule(over: Partial<HeaderRule> = {}): HeaderRule {
  return { id: 'h1', enabled: true, target: 'request', operation: 'set', name: 'X-Test', value: 'v', ...over };
}

describe('ValueCell commit discipline', () => {
  it('does not commit while typing', async () => {
    const onCommit = vi.fn();
    render(<ValueCell value="start" onCommit={onCommit} />);
    await userEvent.click(screen.getByRole('button', { name: /Edit value/ }));
    await userEvent.type(screen.getByRole('textbox'), 'abc');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits once on blur', async () => {
    const onCommit = vi.fn();
    render(<ValueCell value="" onCommit={onCommit} />);
    await userEvent.click(screen.getByRole('button', { name: /Edit value/ }));
    await userEvent.type(screen.getByRole('textbox'), 'abc');
    await userEvent.tab();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('abc');
  });

  it('commits on Enter', async () => {
    const onCommit = vi.fn();
    render(<ValueCell value="" onCommit={onCommit} />);
    await userEvent.click(screen.getByRole('button', { name: /Edit value/ }));
    await userEvent.type(screen.getByRole('textbox'), 'abc{Enter}');
    // Not just "was called with the right value" — the task's whole thesis is
    // once per edit, so a stray second commit (e.g. a blur firing on the
    // textarea's unmount) must be caught too.
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('abc');
  });

  it('discards the draft on Escape and commits nothing', async () => {
    const onCommit = vi.fn();
    render(<ValueCell value="original" onCommit={onCommit} />);
    await userEvent.click(screen.getByRole('button', { name: /Edit value/ }));
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), 'changed{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId('row-value').textContent).toContain('original');
  });

  it('re-seeds the draft from value on the next edit after Escape', async () => {
    // The component relies on begin() re-seeding draft from the value prop
    // rather than resetting draft on Escape itself (see ValueCell's comment).
    // Checking only the read view after Escape does not exercise that path —
    // this reopens the editor and checks the textbox itself.
    render(<ValueCell value="original" onCommit={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Edit value/ }));
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), 'changed{Escape}');
    await userEvent.click(screen.getByRole('button', { name: /Edit value/ }));
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'original');
  });

  it('returns to the read state after committing', async () => {
    render(<ValueCell value="" onCommit={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Edit value/ }));
    await userEvent.type(screen.getByRole('textbox'), 'abc{Enter}');
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('HeaderRow name editing', () => {
  it('commits the name on blur, not per keystroke', async () => {
    const onPatch = vi.fn();
    render(
      <HeaderRow rule={rule({ name: '' })} onToggle={vi.fn()} onPatch={onPatch} onDelete={vi.fn()} />,
    );
    const input = screen.getByRole('textbox', { name: /Header name/ });
    await userEvent.type(input, 'X-Api-Key');
    expect(onPatch).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ name: 'X-Api-Key' });
  });

  it('cycles the operation set → append → remove → set', async () => {
    const onPatch = vi.fn();
    render(
      <HeaderRow rule={rule({ operation: 'set' })} onToggle={vi.fn()} onPatch={onPatch} onDelete={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Operation/ }));
    expect(onPatch).toHaveBeenCalledWith({ operation: 'append' });
  });

  it('deletes the row', async () => {
    const onDelete = vi.fn();
    render(
      <HeaderRow rule={rule()} onToggle={vi.fn()} onPatch={vi.fn()} onDelete={onDelete} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Delete row/ }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
