// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProfileBar } from '@/components/ProfileBar';
import { ProfileEditStrip } from '@/components/ProfileEditStrip';
import { createProfile } from '@/lib/model/defaults';
import type { Diagnostic, Profile } from '@/lib/model/types';

function prof(id: string, name: string, order = 0): Profile {
  return { ...createProfile(name, order), id, name };
}

function diag(over: Partial<Diagnostic> = {}): Diagnostic {
  return { kind: 'empty-filter', severity: 'warning', profileId: 'p1', message: 'm', ...over };
}

const base = {
  profiles: [prof('p1', 'Local'), prof('p2', 'Staging', 1)],
  activeId: 'p1',
  diagnostics: [] as Diagnostic[],
  ruleCount: 3,
  onSelect: vi.fn(),
  onReselect: vi.fn(),
  onAdd: vi.fn(),
};

describe('ProfileBar', () => {
  it('renders one tab per profile plus an add button', () => {
    render(<ProfileBar {...base} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'New profile' })).toBeTruthy();
  });

  it('marks the active tab', () => {
    render(<ProfileBar {...base} />);
    expect(screen.getByRole('tab', { name: /Local/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /Staging/ }).getAttribute('aria-selected')).toBe('false');
  });

  it('selects when an inactive tab is clicked', async () => {
    const onSelect = vi.fn();
    const onReselect = vi.fn();
    render(<ProfileBar {...base} onSelect={onSelect} onReselect={onReselect} />);
    await userEvent.click(screen.getByRole('tab', { name: /Staging/ }));
    expect(onSelect).toHaveBeenCalledWith('p2');
    expect(onReselect).not.toHaveBeenCalled();
  });

  it('opens editing when the ALREADY active tab is clicked', async () => {
    const onSelect = vi.fn();
    const onReselect = vi.fn();
    render(<ProfileBar {...base} onSelect={onSelect} onReselect={onReselect} />);
    await userEvent.click(screen.getByRole('tab', { name: /Local/ }));
    expect(onReselect).toHaveBeenCalledWith('p1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows the rule count for the active profile', () => {
    render(<ProfileBar {...base} ruleCount={7} />);
    expect(screen.getByTestId('rule-count').textContent).toContain('7');
  });

  it('marks a tab whose profile has an error, even when it is not active — and only that tab', () => {
    // Asserting only the Staging tab leaves a real hole: an implementation
    // that marks every tab whenever any diagnostic exists anywhere would pass
    // it. Pinning the Local tab to unmarked in the same render closes that —
    // the marker is per-profile, not "diagnostics array is non-empty".
    render(<ProfileBar {...base} diagnostics={[diag({ severity: 'error', profileId: 'p2' })]} />);
    expect(screen.getByRole('tab', { name: /Staging/ }).getAttribute('data-marker')).toBe('error');
    expect(screen.getByRole('tab', { name: /Local/ }).getAttribute('data-marker')).toBeNull();
  });

  it('marks a tab needing permission differently from a broken one', () => {
    render(<ProfileBar {...base} diagnostics={[diag({ kind: 'permission-missing', profileId: 'p2' })]} />);
    expect(screen.getByRole('tab', { name: /Staging/ }).getAttribute('data-marker')).toBe('permission');
  });

  it('leaves a clean tab unmarked', () => {
    render(<ProfileBar {...base} />);
    expect(screen.getByRole('tab', { name: /Local/ }).getAttribute('data-marker')).toBeNull();
  });

  it('keeps the marker and the identity dot on separate elements, not one doing both jobs', () => {
    // A tautological version of this check (asserting the dot's data-tone
    // equals the profile's own colour) would pass for `data-tone={marker ??
    // p.color}` just as easily as for the correct, unmerged implementation —
    // it never actually looks at the marker being absent from the dot. Pin it
    // structurally instead: the marker attribute lives on the tab, the tone
    // attribute lives on a distinct child (the dot), and neither attribute
    // leaks onto the other element.
    render(<ProfileBar {...base} diagnostics={[diag({ severity: 'error', profileId: 'p2' })]} />);
    const stagingTab = screen.getByRole('tab', { name: /Staging/ });
    expect(stagingTab.getAttribute('data-marker')).toBe('error');
    expect(stagingTab.getAttribute('data-tone')).toBeNull();

    const dot = stagingTab.querySelector('.hl-pdot');
    expect(dot).not.toBeNull();
    expect(dot).not.toBe(stagingTab);
    expect(dot!.getAttribute('data-marker')).toBeNull();
    expect(dot!.getAttribute('data-tone')).toBe(base.profiles[1]!.color);
  });

  it('marks an error over permission when a profile carries both at once (precedence, not a dead branch)', () => {
    // profileMarker's error-over-permission ordering is only exercised by a
    // fixture where a single profile has BOTH an unrelated row error and a
    // permission-missing warning simultaneously — two independent, ordinary
    // failure modes on one profile, per the brief. A fixture with only one of
    // the two would pass even if the precedence check were deleted.
    render(
      <ProfileBar
        {...base}
        diagnostics={[
          diag({ kind: 'invalid-header-name', severity: 'error', profileId: 'p2', headerRuleId: 'h1' }),
          diag({ kind: 'permission-missing', severity: 'warning', profileId: 'p2' }),
        ]}
      />,
    );
    expect(screen.getByRole('tab', { name: /Staging/ }).getAttribute('data-marker')).toBe('error');
  });
});

describe('ProfileEditStrip', () => {
  it('commits the name on blur, not per keystroke', async () => {
    const onPatch = vi.fn();
    render(
      <ProfileEditStrip profile={prof('p1', 'Local')} onPatch={onPatch} onDelete={vi.fn()} onClose={vi.fn()} />,
    );
    const input = screen.getByRole('textbox', { name: /Profile name/ });
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed');
    expect(onPatch).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(onPatch).toHaveBeenCalledWith({ name: 'Renamed' });
  });

  it('commits the name once even when Enter is followed by Tab', async () => {
    // Same shape as HeaderRow's name input (tests/unit/editing.test.tsx): the
    // name input never leaves its editable state on Enter, so a later blur
    // re-evaluates the same commit condition. If that condition compares the
    // draft against the (possibly stale) round-tripped `profile.name` prop
    // instead of against what this component itself last sent, a Tab right
    // after an Enter re-fires onPatch for the same edit — breaking the "every
    // handler writes once" invariant reconcile() depends on.
    const onPatch = vi.fn();
    render(
      <ProfileEditStrip profile={prof('p1', 'Local')} onPatch={onPatch} onDelete={vi.fn()} onClose={vi.fn()} />,
    );
    const input = screen.getByRole('textbox', { name: /Profile name/ });
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed{Enter}');
    await userEvent.tab();
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ name: 'Renamed' });
  });

  it('cancels the edit on Escape, so the following blur commits nothing', async () => {
    // In App this strip unmounts on onClose(), which throws the draft away as
    // a side effect. That is the right outcome for the wrong reason: the
    // component itself never cancels, so anything that keeps it mounted (a
    // caller that ignores onClose, or a future strip that stays open) commits
    // the cancelled name on the next blur. onClose is a plain mock here, so
    // this test sees the component's own behaviour rather than App's.
    const onPatch = vi.fn();
    const onClose = vi.fn();
    render(
      <ProfileEditStrip profile={prof('p1', 'Local')} onPatch={onPatch} onDelete={vi.fn()} onClose={onClose} />,
    );
    const input = screen.getByRole('textbox', { name: /Profile name/ });
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed{Escape}');
    await userEvent.tab();
    expect(onPatch).not.toHaveBeenCalled();
    expect(input).toHaveProperty('value', 'Local');
    // Escape still closes the strip — the cancel is added to that, not
    // instead of it.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers the five palette colours', () => {
    render(
      <ProfileEditStrip profile={prof('p1', 'Local')} onPatch={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getAllByTestId('colour-swatch')).toHaveLength(5);
  });

  it('patches the colour when a swatch is chosen — and a different swatch patches a different colour', async () => {
    // Clicking only "red" and checking for { color: 'red' } does not rule out
    // a component that hardcodes { color: 'red' } on every swatch click
    // regardless of which one was pressed — the assertion would still pass.
    // Clicking two distinct swatches and checking each call's argument in
    // turn forces the implementation to actually read which swatch fired.
    const onPatch = vi.fn();
    render(
      <ProfileEditStrip profile={prof('p1', 'Local')} onPatch={onPatch} onDelete={vi.fn()} onClose={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Colour red' }));
    await userEvent.click(screen.getByRole('button', { name: 'Colour blue' }));
    expect(onPatch).toHaveBeenNthCalledWith(1, { color: 'red' });
    expect(onPatch).toHaveBeenNthCalledWith(2, { color: 'blue' });
  });

  it('needs a second click to delete — the first only arms it', async () => {
    const onDelete = vi.fn();
    render(
      <ProfileEditStrip profile={prof('p1', 'Local')} onPatch={vi.fn()} onDelete={onDelete} onClose={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete profile' }));
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Really delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
