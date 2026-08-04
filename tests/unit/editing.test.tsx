// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ValueCell } from '@/components/ValueCell';
import { HeaderRow } from '@/components/HeaderRow';
import type { HeaderRule } from '@/lib/model/types';

function rule(over: Partial<HeaderRule> = {}): HeaderRule {
  return { id: 'h1', enabled: true, target: 'request', operation: 'set', name: 'X-Test', value: 'v', ...over };
}

describe('read-view height cap (design §8.2)', () => {
  it('caps .hl-val to two lines, same as the editor caps .hl-textarea', () => {
    // jsdom doesn't lay out CSS, so this can't be asserted through rendering —
    // cols.test.ts already reads the stylesheet directly for the same reason.
    // The brief's global constraint is the cap applies to both the read and
    // the edit view; `-webkit-line-clamp: 2` appears nowhere else in the file
    // today, so finding it at all pins the fix to the read view specifically.
    const css = readFileSync('entrypoints/popup/style.css', 'utf8');
    expect(css).toContain('-webkit-line-clamp: 2');
  });
});

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

  it('commits the name once even when Enter is followed by Tab', async () => {
    // Unlike ValueCell, the name input never leaves its editable state on
    // Enter, so a later blur re-evaluates the same commit condition. If that
    // condition is still "does the draft differ from the (possibly stale)
    // rule.name prop", a Tab right after an Enter re-fires onPatch for the
    // same edit — the "every handler writes once" invariant the whole task
    // rests on.
    const onPatch = vi.fn();
    render(
      <HeaderRow rule={rule({ name: '' })} onToggle={vi.fn()} onPatch={onPatch} onDelete={vi.fn()} />,
    );
    const input = screen.getByRole('textbox', { name: /Header name/ });
    await userEvent.type(input, 'X-Api-Key{Enter}');
    await userEvent.tab();
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ name: 'X-Api-Key' });
  });

  it('cancels the edit on Escape, so the following blur commits nothing', async () => {
    // Doing nothing on Escape is not neutral here. The name input never
    // leaves its editable state, so the cancelled draft survives and the very
    // next blur runs commitName() and writes the value the user just
    // cancelled. `Authorizatio` is a valid RFC 7230 token, so no diagnostic
    // fires either — the wrong header ships silently. The blur is the whole
    // point of this test: asserting only the displayed value after Escape
    // would pass against a component that never restores the draft at all.
    const onPatch = vi.fn();
    render(
      <HeaderRow rule={rule({ name: 'Authorization' })} onToggle={vi.fn()} onPatch={onPatch} onDelete={vi.fn()} />,
    );
    const input = screen.getByRole('textbox', { name: /Header name/ });
    await userEvent.clear(input);
    await userEvent.type(input, 'Authorizatio{Escape}');
    await userEvent.tab();
    expect(onPatch).not.toHaveBeenCalled();
    expect(input).toHaveProperty('value', 'Authorization');
  });

  it('cycles the operation set → append → remove → set', async () => {
    const onPatch = vi.fn();
    const { rerender } = render(
      <HeaderRow rule={rule({ operation: 'set' })} onToggle={vi.fn()} onPatch={onPatch} onDelete={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Operation/ }));
    expect(onPatch).toHaveBeenLastCalledWith({ operation: 'append' });

    // onPatch is a mock — it never actually updates rule.operation — so
    // exercising the next leg means re-rendering with the operation the
    // parent would have written back, exactly as it would in production.
    rerender(
      <HeaderRow rule={rule({ operation: 'append' })} onToggle={vi.fn()} onPatch={onPatch} onDelete={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Operation/ }));
    expect(onPatch).toHaveBeenLastCalledWith({ operation: 'remove' });

    rerender(
      <HeaderRow rule={rule({ operation: 'remove' })} onToggle={vi.fn()} onPatch={onPatch} onDelete={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Operation/ }));
    expect(onPatch).toHaveBeenLastCalledWith({ operation: 'set' });
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
