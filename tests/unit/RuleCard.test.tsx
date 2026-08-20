// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RuleCard } from '@/components/RuleCard';
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

function renderCard(
  over: Partial<HeaderRule> = {},
  props: Partial<{
    diagnostics: Diagnostic[];
    onPatch: (patch: Partial<HeaderRule>) => void;
    onDelete: () => void;
  }> = {},
) {
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
      <RuleCard
        rule={rule({ enabled: true })}
        diagnostics={[]}
        onPatch={onPatch}
        onDelete={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('switch'));
    expect(onPatch).toHaveBeenLastCalledWith({ enabled: false });

    rerender(
      <RuleCard
        rule={rule({ enabled: false })}
        diagnostics={[]}
        onPatch={onPatch}
        onDelete={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('switch'));
    expect(onPatch).toHaveBeenLastCalledWith({ enabled: true });
  });

  it('cycles the operation set → append → remove → set', async () => {
    // onPatch is a mock and never writes back, so each leg is driven by
    // re-rendering with the operation a real parent would have stored.
    const onPatch = vi.fn();
    const { rerender } = render(
      <RuleCard
        rule={rule({ operation: 'set' })}
        diagnostics={[]}
        onPatch={onPatch}
        onDelete={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Operation/ }));
    expect(onPatch).toHaveBeenLastCalledWith({ operation: 'append' });

    rerender(
      <RuleCard
        rule={rule({ operation: 'append' })}
        diagnostics={[]}
        onPatch={onPatch}
        onDelete={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Operation/ }));
    expect(onPatch).toHaveBeenLastCalledWith({ operation: 'remove' });

    rerender(
      <RuleCard
        rule={rule({ operation: 'remove' })}
        diagnostics={[]}
        onPatch={onPatch}
        onDelete={vi.fn()}
      />,
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
      <RuleCard
        rule={rule({ target: 'request' })}
        diagnostics={[]}
        onPatch={onPatch}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Direction/ }).textContent).toBe('REQ');
    await userEvent.click(screen.getByRole('button', { name: /Direction/ }));
    expect(onPatch).toHaveBeenLastCalledWith({ target: 'response' });

    rerender(
      <RuleCard
        rule={rule({ target: 'response' })}
        diagnostics={[]}
        onPatch={onPatch}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Direction/ }).textContent).toBe('RES');
    await userEvent.click(screen.getByRole('button', { name: /Direction/ }));
    expect(onPatch).toHaveBeenLastCalledWith({ target: 'request' });
  });

  it('deletes the rule on the second click, armed by the first', async () => {
    // Two clicks, one box (useArmed): the first offers the second in its
    // name, the second calls the handler. Pinned that the first alone does
    // nothing, so the guard cannot be deleted without this failing.
    const onDelete = vi.fn();
    renderCard({}, { onDelete });
    await userEvent.click(screen.getByRole('button', { name: 'Delete rule' }));
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete rule' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('RuleCard tab order', () => {
  /** A readable name for whatever currently holds focus. */
  function focused(): string {
    const el = document.activeElement;
    if (!el || el === document.body) return 'body';
    return el.getAttribute('aria-label') ?? el.tagName.toLowerCase();
  }

  async function walk(steps: number): Promise<string[]> {
    const seq: string[] = [];
    for (let i = 0; i < steps; i += 1) {
      await userEvent.tab();
      seq.push(focused());
    }
    return seq;
  }

  it('goes op → name → value, with delete last', async () => {
    // Typing a name and pressing Tab used to land on Delete, because the
    // button sat beside the name input in the DOM and tab order follows the
    // document. Name then value is the one sequence this card exists to
    // support, and its destructive action belongs at the end — both still
    // true here.
    //
    // Operation moved again (Task 11): it no longer sits between name and
    // value on line 2 — it stacks under the direction Badge in the gutter,
    // so it comes right after Direction and before Header name in the DOM.
    // That is a deliberate reading order, not an incidental one: the
    // gutter's controls (what this rule does) come first, then its content
    // (what it's about) — the same order a person's eye takes across the
    // row, left to right.
    //
    // The whole sequence is asserted, not merely that each control is
    // reachable: a test checking only that the value field and the delete
    // button exist passes against the broken order. `userEvent.tab()` was
    // checked against this setup first — jsdom implements no sequential focus
    // navigation of its own, but user-event walks the document's tabbable
    // elements in source order, which is exactly the property under test.
    render(
      <RuleCard
        rule={rule({ name: 'X-Test' })}
        diagnostics={[]}
        onPatch={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(await walk(6)).toEqual([
      'X-Test enabled',
      'Direction: request',
      'Operation: set',
      'Header name',
      'Header value',
      'Delete rule',
    ]);
  });

  it('keeps that order on a rule whose value is still empty', async () => {
    // An empty `set` rule still renders a real field (a textarea, restored
    // in a later round — see the value slot tests below), so it is in the
    // sequence like any other. (Only `remove` swaps the value for a span —
    // see below.) Without this case the order could hold for filled rules and
    // break for the one a user meets first.
    render(
      <RuleCard
        rule={rule({ name: '', value: '' })}
        diagnostics={[]}
        onPatch={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(await walk(6)).toEqual([
      'Unnamed enabled',
      'Direction: request',
      'Operation: set',
      'Header name',
      'Header value',
      'Delete rule',
    ]);
  });

  it('skips the value on a remove rule, which has none to focus', async () => {
    // `remove` takes no value, so that slot is a span rather than a field and
    // Tab goes straight from the name to delete. Asserted rather than left to
    // chance, because it is the one row where "name then value" cannot hold
    // and the reason must be visible here.
    render(
      <RuleCard
        rule={rule({ operation: 'remove', value: '' })}
        diagnostics={[]}
        onPatch={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(await walk(5)).toEqual([
      'X-Test enabled',
      'Direction: request',
      'Operation: remove',
      'Header name',
      'Delete rule',
    ]);
  });

  it('skips the warning marker — it is not a control, so it does not enter the sequence', async () => {
    // Task 13's marker beside the header name is supplementary information,
    // not a control of its own (see its own comment in RuleCard.tsx), so it
    // must not add a stop. Same six-step sequence as the first test in this
    // block, now with a warning present, to prove that rather than assume it.
    render(
      <RuleCard
        rule={rule({ name: 'X-Test' })}
        diagnostics={[diag({ severity: 'warning', message: 'a live conflict' })]}
        onPatch={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(await walk(6)).toEqual([
      'X-Test enabled',
      'Direction: request',
      'Operation: set',
      'Header name',
      'Header value',
      'Delete rule',
    ]);
  });
});

describe('RuleCard value slot', () => {
  it('says what a remove rule will do, and offers no field to type a value into', () => {
    // The grid this replaces drew an empty cell for `remove` because a column
    // layout gave it no choice, then invented "— no value" to fill it. Task
    // 12 moved on from "remove takes no value" (which described the empty
    // field, not the rule's effect) to a sentence that says what actually
    // happens. `queryByRole` still pins that there is nothing to edit here,
    // not just the wording.
    renderCard({ operation: 'remove', name: 'X-Trace', value: '' });
    expect(screen.getByTestId('rule-value').textContent).toBe('"X-Trace"will be removed');
    expect(screen.queryByRole('textbox', { name: 'Header value' })).toBeNull();
  });

  it('says a remove rule with no name yet will still be removed, without printing empty quotes', () => {
    // The name clause needs a real name to quote. `""` will be removed reads
    // as a typo, not a sentence, so the empty case drops the clause entirely
    // rather than interpolating a blank string into it.
    renderCard({ operation: 'remove', name: '', value: '' });
    expect(screen.getByTestId('rule-value').textContent).toBe(
      "This header will be removed once it's named.",
    );
  });

  it('gives a set rule a real editable value carrying the stored text', () => {
    renderCard({ operation: 'set', value: 'Bearer abc' });
    expect(value()).toHaveProperty('value', 'Bearer abc');
  });
});

describe('RuleCard geometry', () => {
  // The row is no longer a fixed height — the owner ruled that a rule's
  // value must wrap and grow rather than truncate, so different *rules* can
  // be different heights (see the docblock on RuleCard). What must still
  // hold is narrower: a *given* rule's own row must not change height when
  // it is toggled on/off or gains a diagnostic.
  //
  // What this describe block does NOT and cannot guard: the actual pixel
  // claim. jsdom performs no layout (this codebase's own e2e suite says so
  // outright), so nothing here can see a regression like `data-[off]:py-4`
  // or `group-data-off/rule:leading-[20px]` on the row — every Tailwind
  // class is invisible to a test that only reads tag names and text. That
  // claim is a real e2e test instead:
  // `tests/e2e/header-modification.spec.ts`, "a rule row keeps its own
  // height when toggled off, and does not move its neighbours" — seeded
  // with a value long enough to wrap onto multiple lines, measuring
  // `getBoundingClientRect()` before and after toggling.
  //
  // What these two tests *do* honestly check is narrower and complementary:
  // that toggling, or a diagnostic appearing, never changes which elements
  // render, their order, or the value text they carry — a class of
  // regression (the value field swapped for something else, or its text
  // altered or truncated only in one state) that would very likely also
  // change the rendered height, but isn't itself a height claim.
  it("changes only colour and weight when toggled off, never the row's own structure or its value text", () => {
    const base = {
      id: 'h',
      target: 'request',
      operation: 'set',
      name: 'X-Test',
      value:
        'a value long enough that it would wrap across several lines in the real popup, well past one row',
    } as const;
    const shapes = [true, false].map((enabled) => {
      const { container, unmount } = render(
        <RuleCard
          rule={rule({ ...base, enabled })}
          diagnostics={[]}
          onPatch={() => {}}
          onDelete={() => {}}
        />,
      );
      const row = container.querySelector('[data-testid="rule"]')!;
      const structure = Array.from(row.querySelectorAll('*'))
        .map((el) => el.tagName)
        .join(',');
      const valueField = screen.getByTestId('rule-value') as HTMLTextAreaElement;
      const shape = { structure, valueText: valueField.value };
      unmount();
      return shape;
    });
    expect(shapes[0]!.structure).toBe(shapes[1]!.structure);
    expect(shapes[0]!.valueText).toBe(shapes[1]!.valueText);
    expect(shapes[0]!.valueText).toBe(base.value);
  });

  it('replaces the value field with the error message, and never renders both at once', () => {
    // Task 13. An `error`-severity diagnostic means `hasRowError` has
    // already excluded this row from `compileHeaders` — the stored value is
    // not in effect, so showing it would show something that is not real.
    // It takes line 2 outright rather than appearing beside the value,
    // which is why `rule-value` must be genuinely absent here, not merely
    // empty — this is the "state a `rule-value` assertion must name rather
    // than assume" case the brief called out.
    const props = {
      rule: rule({ value: 'a value long enough to wrap onto more than one line' }),
      onPatch: () => {},
      onDelete: () => {},
    };
    const clean = render(<RuleCard {...props} diagnostics={[]} />);
    expect(screen.getByTestId('rule-value')).toBeTruthy();
    expect(screen.queryAllByTestId('rule-problem')).toEqual([]);
    clean.unmount();

    const { container } = render(
      <RuleCard
        {...props}
        diagnostics={[diag({ severity: 'error', message: 'a real problem' })]}
      />,
    );
    expect(screen.queryByTestId('rule-value')).toBeNull();
    expect(screen.getByTestId('rule-problem').textContent).toBe('a real problem');
    // The value textarea is not gone — jsdom cannot see the box-geometry
    // reason (a re-review found the first version of this fix shrank a
    // wrapping row to the message's single line; the e2e guard covers the
    // pixels), but this level can and must check the mechanism the fix
    // rests on: the field is still in the DOM, still carrying the real
    // stored value, and marked unreachable rather than merely unstyled.
    const hidden = container.querySelector('textarea[aria-label="Header value"]');
    expect(hidden).not.toBeNull();
    expect((hidden as HTMLTextAreaElement).value).toBe(
      'a value long enough to wrap onto more than one line',
    );
    expect(hidden).toHaveProperty('readOnly', true);
    expect(hidden?.getAttribute('tabindex')).toBe('-1');
    expect(hidden?.getAttribute('aria-hidden')).toBe('true');
  });

  it('leaves the value field alone for a warning, and marks the row beside its name instead', () => {
    // The opposite half of the same split. `profile-conflict` (the only
    // `warning` kind today) means the row *is* live — hiding its value
    // would show the user less than the truth — so `rule-value` must
    // survive untouched, and the diagnostic gets a marker beside the name
    // rather than line 2.
    renderCard(
      { value: 'still going out' },
      { diagnostics: [diag({ severity: 'warning', message: 'a live conflict' })] },
    );
    expect((screen.getByTestId('rule-value') as HTMLTextAreaElement).value).toBe('still going out');
    expect(screen.queryAllByTestId('rule-problem')).toEqual([]);
    const marker = screen.getByTestId('rule-warning');
    expect(marker.getAttribute('title')).toBe('a live conflict');
    expect(marker.getAttribute('aria-label')).toBe('a live conflict');
  });
});

describe('RuleCard problems', () => {
  it('renders nothing extra when the rule is fine', () => {
    renderCard();
    expect(screen.queryAllByTestId('rule-problem')).toEqual([]);
    expect(screen.queryAllByTestId('rule-warning')).toEqual([]);
  });

  it('shows no problem for a rule that is merely unfinished', () => {
    // The complaint this fixes: pressing "New rule" put a red "Header name is
    // empty." on a row created one click ago. The empty field and its
    // placeholder already say the rule is unfinished, and they say it without
    // accusing anyone. The state is not lost — the rail counts it.
    renderCard(
      { name: '' },
      {
        diagnostics: [
          diag({
            kind: 'incomplete-header',
            severity: 'incomplete',
            message: 'This rule has no name yet, so nothing is sent for it.',
          }),
        ],
      },
    );
    expect(screen.queryAllByTestId('rule-problem')).toEqual([]);
    expect(screen.queryAllByTestId('rule-warning')).toEqual([]);
    expect(screen.getByTestId('rule').getAttribute('data-unfinished')).toBe('true');
  });

  it('still shows a real problem on a rule that is also unfinished', () => {
    // Filtering by severity must remove the incomplete one and nothing else.
    // A filter written as "drop everything when any diagnostic is incomplete"
    // would silence a genuine error sitting on the same row.
    renderCard(
      { name: '' },
      {
        diagnostics: [
          diag({ kind: 'incomplete-header', severity: 'incomplete', message: 'unfinished' }),
          diag({ severity: 'error', message: 'a real problem' }),
        ],
      },
    );
    expect(screen.getByTestId('rule-problem').textContent).toBe('a real problem');
  });

  it('marks a finished rule as finished, so the unfinished flag means something', () => {
    // Without this, `data-unfinished` could be hardcoded and the assertion
    // above would still pass.
    renderCard({ name: 'X-Test' }, { diagnostics: [] });
    expect(screen.getByTestId('rule').getAttribute('data-unfinished')).toBeNull();
  });

  it('shows only the error in line 2 and a marker for the warning when a row carries both', () => {
    // Not "one line per diagnostic" any more (Task 13, replacing the test
    // this one used to be) — an error takes line 2 outright and a warning
    // never touches it, so a row carrying one of each shows exactly one
    // `rule-problem` (the error) and one `rule-warning` (the warning), not
    // two stacked lines.
    renderCard(
      {},
      {
        diagnostics: [
          diag({ severity: 'error', message: 'first' }),
          diag({ severity: 'warning', message: 'second' }),
        ],
      },
    );
    expect(screen.getAllByTestId('rule-problem').map((l) => l.textContent)).toEqual(['first']);
    expect(screen.getByTestId('rule-problem').getAttribute('data-severity')).toBe('error');
    expect(screen.getByTestId('rule-warning').getAttribute('title')).toBe('second');
  });

  it('picks the first error when a row somehow carries more than one', () => {
    // Reachable in practice: `validateHeaders` stops at the first *token*
    // failure but does not stop after `append-not-allowed`, so a row can
    // still pick up `duplicate-header` behind it — two error diagnostics on
    // one row. `.find`, not `.filter`, so this shows the first rather than
    // piling both onto a row that is already not going anywhere.
    renderCard(
      {},
      {
        diagnostics: [
          diag({ severity: 'error', message: 'first error' }),
          diag({ severity: 'error', message: 'second error' }),
        ],
      },
    );
    expect(screen.getByTestId('rule-problem').textContent).toBe('first error');
  });

  it('joins more than one warning into the same marker rather than adding a second', () => {
    renderCard(
      {},
      {
        diagnostics: [
          diag({ severity: 'warning', message: 'one conflict' }),
          diag({ severity: 'warning', message: 'another conflict' }),
        ],
      },
    );
    expect(screen.getAllByTestId('rule-warning')).toHaveLength(1);
    expect(screen.getByTestId('rule-warning').getAttribute('title')).toBe(
      'one conflict another conflict',
    );
  });

  it("lets an error outrank a remove rule's own sentence", () => {
    // Priority item 1 of the brief: `remove` + `error` together (a
    // duplicated remove is the real-world example) show the error, not
    // "will be removed" — what stops the row from running outranks what it
    // would have done if it had run.
    renderCard(
      { operation: 'remove', name: 'X-Trace' },
      { diagnostics: [diag({ severity: 'error', message: 'duplicated' })] },
    );
    expect(screen.getByTestId('rule-problem').textContent).toBe('duplicated');
    expect(screen.queryByText(/will be removed/)).toBeNull();
  });
});
