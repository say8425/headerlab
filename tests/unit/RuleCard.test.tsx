// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RuleCard } from '@/components/RuleCard';
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

function renderCard(over: Partial<HeaderRule> = {}, props: Partial<{
  diagnostics: Diagnostic[];
  onPatch: (patch: Partial<HeaderRule>) => void;
  onDelete: () => void;
}> = {}) {
  return render(
    <RuleCard
      rule={rule(over)}
      diagnostics={props.diagnostics ?? []}
      onPatch={props.onPatch ?? vi.fn()}
      onDelete={props.onDelete ?? vi.fn()}
    />,
  );
}

const name = () => screen.getByRole('textbox', { name: 'Header name' });
const value = () => screen.getByRole('textbox', { name: 'Header value' });

/**
 * The in-place editing rules survive the redesign unchanged — a commit fires
 * once per edit, Escape cancels and the following blur commits nothing — so
 * these move here from the grid's row and value cell rather than being
 * rewritten. Both fields now share one hook, which is exactly why each of them
 * is exercised separately: a hook used twice can still be wired to only one.
 */
describe('RuleCard name editing', () => {
  it('does not commit while typing', async () => {
    const onPatch = vi.fn();
    renderCard({ name: '' }, { onPatch });
    await userEvent.type(name(), 'X-Api-Key');
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('commits the name once on blur', async () => {
    const onPatch = vi.fn();
    renderCard({ name: '' }, { onPatch });
    await userEvent.type(name(), 'X-Api-Key');
    await userEvent.tab();
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ name: 'X-Api-Key' });
  });

  it('commits the name once even when Enter is followed by Tab', async () => {
    // The field never leaves its editable state on Enter, so a later blur
    // re-evaluates the same commit condition. If that condition compared the
    // draft against the (asynchronously round-tripped, therefore possibly
    // stale) `rule.name` prop, a Tab right after an Enter would fire a second
    // patch for one edit — breaking the "every handler writes once" invariant
    // useAppState depends on.
    const onPatch = vi.fn();
    renderCard({ name: '' }, { onPatch });
    await userEvent.type(name(), 'X-Api-Key{Enter}');
    await userEvent.tab();
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ name: 'X-Api-Key' });
  });

  it('cancels the name on Escape, so the following blur commits nothing', async () => {
    // Doing nothing on Escape is not neutral. The cancelled text survives in a
    // field that is still editable and the very next blur writes it —
    // `Authorizatio` is a valid RFC 7230 token, so no diagnostic fires either
    // and the wrong header ships silently. The blur is the point of this test:
    // asserting only the displayed value would pass against a component that
    // never restores the draft at all.
    const onPatch = vi.fn();
    renderCard({ name: 'Authorization' }, { onPatch });
    await userEvent.clear(name());
    await userEvent.type(name(), 'Authorizatio{Escape}');
    await userEvent.tab();
    expect(onPatch).not.toHaveBeenCalled();
    expect(name()).toHaveProperty('value', 'Authorization');
  });
});

describe('RuleCard value editing', () => {
  it('does not commit while typing', async () => {
    const onPatch = vi.fn();
    renderCard({ value: '' }, { onPatch });
    await userEvent.type(value(), 'Bearer abc');
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('commits the value once on blur', async () => {
    const onPatch = vi.fn();
    renderCard({ value: '' }, { onPatch });
    await userEvent.type(value(), 'Bearer abc');
    await userEvent.tab();
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ value: 'Bearer abc' });
  });

  it('commits the value once on Enter, and the following blur adds nothing', async () => {
    const onPatch = vi.fn();
    renderCard({ value: '' }, { onPatch });
    await userEvent.type(value(), 'Bearer abc{Enter}');
    await userEvent.tab();
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ value: 'Bearer abc' });
  });

  it('keeps a bare Enter out of the value it commits', async () => {
    // The field is a textarea so a long value wraps instead of truncating —
    // which also means Enter would otherwise insert a newline, and a header
    // value carrying one is not a header value. Asserting the committed string
    // rather than the keystroke is what makes this fail if preventDefault is
    // dropped.
    const onPatch = vi.fn();
    renderCard({ value: '' }, { onPatch });
    await userEvent.type(value(), 'a{Enter}');
    expect(onPatch).toHaveBeenCalledWith({ value: 'a' });
  });

  it('cancels the value on Escape, so the following blur commits nothing', async () => {
    const onPatch = vi.fn();
    renderCard({ value: 'original' }, { onPatch });
    await userEvent.clear(value());
    await userEvent.type(value(), 'changed{Escape}');
    await userEvent.tab();
    expect(onPatch).not.toHaveBeenCalled();
    expect(value()).toHaveProperty('value', 'original');
  });
});

describe('RuleCard controls', () => {
  it('switches the rule off, and a switched-off rule back on', async () => {
    // Both directions, because a component that always sent `{enabled: false}`
    // would pass either case alone. It has to read the current state.
    const onPatch = vi.fn();
    const { rerender } = render(
      <RuleCard rule={rule({ enabled: true })} diagnostics={[]} onPatch={onPatch} onDelete={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('switch'));
    expect(onPatch).toHaveBeenLastCalledWith({ enabled: false });

    rerender(
      <RuleCard rule={rule({ enabled: false })} diagnostics={[]} onPatch={onPatch} onDelete={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('switch'));
    expect(onPatch).toHaveBeenLastCalledWith({ enabled: true });
  });

  it('cycles the operation set → append → remove → set', async () => {
    // onPatch is a mock and never writes back, so each leg is driven by
    // re-rendering with the operation a real parent would have stored.
    const onPatch = vi.fn();
    const { rerender } = render(
      <RuleCard rule={rule({ operation: 'set' })} diagnostics={[]} onPatch={onPatch} onDelete={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Operation/ }));
    expect(onPatch).toHaveBeenLastCalledWith({ operation: 'append' });

    rerender(
      <RuleCard rule={rule({ operation: 'append' })} diagnostics={[]} onPatch={onPatch} onDelete={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Operation/ }));
    expect(onPatch).toHaveBeenLastCalledWith({ operation: 'remove' });

    rerender(
      <RuleCard rule={rule({ operation: 'remove' })} diagnostics={[]} onPatch={onPatch} onDelete={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Operation/ }));
    expect(onPatch).toHaveBeenLastCalledWith({ operation: 'set' });
  });

  it('turns a request rule into a response rule and back', async () => {
    // Direction is a pill on the row rather than a column to read, so it is
    // also the control — and like the switch it must send the opposite of what
    // it currently shows, not a fixed value.
    const onPatch = vi.fn();
    const { rerender } = render(
      <RuleCard rule={rule({ target: 'request' })} diagnostics={[]} onPatch={onPatch} onDelete={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /Direction/ }).textContent).toBe('REQ');
    await userEvent.click(screen.getByRole('button', { name: /Direction/ }));
    expect(onPatch).toHaveBeenLastCalledWith({ target: 'response' });

    rerender(
      <RuleCard rule={rule({ target: 'response' })} diagnostics={[]} onPatch={onPatch} onDelete={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /Direction/ }).textContent).toBe('RES');
    await userEvent.click(screen.getByRole('button', { name: /Direction/ }));
    expect(onPatch).toHaveBeenLastCalledWith({ target: 'request' });
  });

  it('deletes the rule', async () => {
    const onDelete = vi.fn();
    renderCard({}, { onDelete });
    await userEvent.click(screen.getByRole('button', { name: 'Delete rule' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('RuleCard value slot', () => {
  it('says a remove rule takes no value, and offers no field to type one into', () => {
    // The grid this replaces drew an empty cell for `remove` because a column
    // layout gave it no choice, then invented "— no value" to fill it. Here
    // the operation genuinely has no value, so there is nothing to edit —
    // `queryByRole` is what pins that, not just the wording.
    renderCard({ operation: 'remove', value: '' });
    expect(screen.getByTestId('rule-value').textContent).toBe('remove takes no value');
    expect(screen.queryByRole('textbox', { name: 'Header value' })).toBeNull();
  });

  it('gives a set rule a real editable value carrying the stored text', () => {
    renderCard({ operation: 'set', value: 'Bearer abc' });
    expect(value()).toHaveProperty('value', 'Bearer abc');
  });
});

describe('RuleCard problems', () => {
  it('renders nothing extra when the rule is fine', () => {
    renderCard();
    expect(screen.queryAllByTestId('rule-problem')).toEqual([]);
  });

  it('shows one line per diagnostic, in order, with its severity marked', () => {
    renderCard({}, {
      diagnostics: [
        diag({ severity: 'error', message: 'first' }),
        diag({ severity: 'warning', message: 'second' }),
      ],
    });
    const lines = screen.getAllByTestId('rule-problem');
    expect(lines.map((l) => l.textContent)).toEqual(['!first', '!second']);
    expect(lines.map((l) => l.getAttribute('data-severity'))).toEqual(['error', 'warning']);
  });
});
