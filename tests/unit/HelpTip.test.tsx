// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HelpTip } from '@/components/HelpTip';

function renderTip() {
  return render(
    <HelpTip
      label="About matching sites"
      examples={[['x.com/a', 'x.com']]}
      text="Chrome matches by host."
    />,
  );
}

const mark = () => screen.getByRole('button', { name: 'About matching sites' });
const bubble = () => screen.queryByTestId('help-bubble');

describe('HelpTip', () => {
  it('says nothing until it is asked', () => {
    // The whole point of moving this behind a `?`. A test that only checked
    // the text was somewhere in the DOM would pass against standing copy —
    // which is the thing being replaced — so absence is the first assertion.
    renderTip();
    expect(bubble()).toBeNull();
  });

  it('opens on keyboard focus alone, with no pointer involved', async () => {
    // The constraint that matters most. A tooltip reachable only by hover
    // hides the explanation from anyone tabbing through, and this is a
    // developer tool where that is ordinary. Tab rather than hover is what
    // makes this test about the keyboard.
    renderTip();
    await userEvent.tab();
    expect(document.activeElement).toBe(mark());
    expect(bubble()?.textContent).toBe('x.com/a→x.comChrome matches by host.');
  });

  it('opens on hover too', async () => {
    renderTip();
    await userEvent.hover(mark());
    expect(bubble()).not.toBeNull();
  });

  it('closes on Escape while the mark keeps focus', async () => {
    // Escape has to win against the focus that opened it — the mark is still
    // focused afterwards, so an implementation that re-derived `open` from
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
    renderTip();
    expect(mark().getAttribute('aria-expanded')).toBe('false');
    expect(mark().getAttribute('aria-describedby')).toBeNull();

    await userEvent.tab();
    expect(mark().getAttribute('aria-expanded')).toBe('true');
    // The description has to point at the bubble that is actually on screen.
    expect(mark().getAttribute('aria-describedby')).toBe(bubble()!.getAttribute('id'));
    expect(bubble()!.getAttribute('role')).toBe('tooltip');

    await userEvent.keyboard('{Escape}');
    expect(mark().getAttribute('aria-describedby')).toBeNull();
  });

  it('shows worked pairs above the sentence, when the fact has any', async () => {
    // "Show rather than explain": the transformation is the answer to the
    // reader's actual question, so it comes first and the rule follows it.
    render(
      <HelpTip
        label="About matching sites"
        examples={[
          ['https://x.com/a/b', 'x.com'],
          ['localhost:3000', 'localhost'],
        ]}
        text="Matched by host — a port or path is dropped."
      />,
    );
    await userEvent.tab();
    const codes = [...bubble()!.querySelectorAll('code')].map((c) => c.textContent);
    expect(codes).toEqual(['https://x.com/a/b', 'x.com', 'localhost:3000', 'localhost']);
    // Order matters: examples, then the rule they demonstrate.
    expect(bubble()!.textContent).toBe(
      'https://x.com/a/b→x.comlocalhost:3000→localhost' +
        'Matched by host — a port or path is dropped.',
    );
  });
});
