// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * The `?` beside the SITES heading, and the one thing it explains.
 *
 * This file used to test `HelpTip`, a hand-rolled `?` with its own open state.
 * That component is gone and shadcn's `Tooltip` does the job, so the tests
 * moved rather than died: the subject was never the component, it was the
 * behaviours the rail depends on — opens without a mouse, dismissible, and
 * described to assistive tech only while it is up. A library swap is exactly
 * when those are most worth having pinned, since none of them is guaranteed by
 * the fact that something appears on hover.
 *
 * Rendered as the rail composes it (ScopeRail.tsx), not as a bare primitive: a
 * `TooltipTrigger asChild` around a real `<button>` is what makes the keyboard
 * path work at all, and that is a decision this harness has to reproduce for
 * the assertions below to mean anything about the shipped popup.
 */
function renderTip() {
  return render(
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label="About matching sites">
            ?
          </button>
        </TooltipTrigger>
        <TooltipContent data-testid="help-bubble">
          <span>
            {[
              ['https://x.com/a/b', 'x.com'],
              ['localhost:3000', 'localhost'],
            ].map(([from, to]) => (
              <span key={from}>
                <code>{from}</code>
                <span aria-hidden="true">→</span>
                <code>{to}</code>
              </span>
            ))}
          </span>
          <span>Matched by host — a port or path is dropped.</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  );
}

const mark = () => screen.getByRole('button', { name: 'About matching sites' });
const bubble = () => screen.queryByTestId('help-bubble');

describe('the help tooltip', () => {
  it('says nothing until it is asked', () => {
    // The whole point of putting this behind a `?`. A test that only checked
    // the text was somewhere in the DOM would pass against standing copy —
    // which is the thing being replaced — so absence is the first assertion.
    renderTip();
    expect(bubble()).toBeNull();
  });

  it('opens on keyboard focus alone, with no pointer involved', async () => {
    // The constraint that matters most, and the one a tooltip library can
    // quietly drop: reachable only by hover hides the explanation from anyone
    // tabbing through, and this is a developer tool where that is ordinary.
    // Tab rather than hover is what makes this test about the keyboard.
    renderTip();
    await userEvent.tab();
    expect(document.activeElement).toBe(mark());
    expect(bubble()?.textContent).toBe(
      'https://x.com/a/b→x.comlocalhost:3000→localhost' +
        'Matched by host — a port or path is dropped.',
    );
  });

  it('opens on hover too', async () => {
    renderTip();
    await userEvent.hover(mark());
    expect(bubble()).not.toBeNull();
  });

  it('closes on Escape while the mark keeps focus', async () => {
    // Escape has to win against the focus that opened it — the mark is still
    // focused afterwards, so an implementation that re-derived "open" from
    // focus would reopen it immediately and this would fail.
    renderTip();
    await userEvent.tab();
    expect(bubble()).not.toBeNull();

    await userEvent.keyboard('{Escape}');
    expect(bubble()).toBeNull();
    expect(document.activeElement).toBe(mark());
  });

  it('closes on the way out, so it cannot be left hanging', async () => {
    renderTip();
    await userEvent.tab();
    expect(bubble()).not.toBeNull();

    await userEvent.tab();
    expect(bubble()).toBeNull();
  });

  it('is a real button, not a native title tooltip', () => {
    // `title=` waits about a second, cannot be styled to the contrast floor
    // the rest of this palette is held to, and never appears on focus at all.
    // Asserting its absence is what stops it coming back as a "simplification".
    renderTip();
    expect(mark().tagName).toBe('BUTTON');
    expect(mark().getAttribute('title')).toBeNull();
  });

  it('tells assistive tech the bubble describes the mark, only while it is up', async () => {
    // The state attribute is Radix's, not ours: the trigger carries
    // `data-state`, where the hand-rolled mark carried `aria-expanded`. Both
    // are asserted through the same question — is the description pointing at
    // something that is on screen — because that is the part a reader with a
    // screen reader actually depends on, and the part that breaks silently
    // when a tooltip is swapped for one that portals its content.
    renderTip();
    expect(mark().getAttribute('data-state')).toBe('closed');
    expect(mark().getAttribute('aria-describedby')).toBeNull();

    await userEvent.tab();
    expect(mark().getAttribute('data-state')).not.toBe('closed');
    const describedBy = mark().getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    // The id has to resolve to an element that is really in the document and
    // really carries the explanation — a dangling `aria-describedby` announces
    // nothing at all, and reads as correct in the markup.
    const description = document.getElementById(describedBy!);
    expect(description).not.toBeNull();
    expect(description!.textContent).toContain('Matched by host');

    await userEvent.keyboard('{Escape}');
    expect(mark().getAttribute('aria-describedby')).toBeNull();
  });

  it('shows worked pairs above the sentence, when the fact has any', async () => {
    // "Show rather than explain": the transformation is the answer to the
    // reader's actual question, so it comes first and the rule follows it.
    renderTip();
    await userEvent.tab();
    const codes = [...bubble()!.querySelectorAll('code')].map((c) => c.textContent);
    expect(codes).toEqual(['https://x.com/a/b', 'x.com', 'localhost:3000', 'localhost']);
  });
});
