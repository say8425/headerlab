import { describe, expect, it } from 'vitest';
import { resolveSingleProfile } from '@/lib/view/singleProfile';
import { createProfile } from '@/lib/model/defaults';
import type { Profile } from '@/lib/model/types';

function prof(id: string, order = 0): Profile {
  return { ...createProfile(id, order), id };
}

describe('resolveSingleProfile', () => {
  it('reports no profile at all for empty storage, rather than inventing one', () => {
    // The empty case is the caller's to fix, and it has to be *told* so.
    // Returning some placeholder here would hide a fresh install behind a
    // profile that exists on screen and not in storage, so nothing the user
    // typed into it would survive the popup closing.
    expect(resolveSingleProfile([])).toEqual({ profile: null, dropped: [] });
  });

  it('keeps the only profile and drops nothing', () => {
    const only = prof('p1');
    // The kept profile is asserted by identity, not by a field: returning a
    // copy would pass a `toEqual` on ids while breaking every `key` and every
    // referential comparison downstream.
    const resolved = resolveSingleProfile([only]);
    expect(resolved.profile).toBe(only);
    expect(resolved.dropped).toEqual([]);
  });

  it('keeps the first of several and names every one it drops, in order', () => {
    // Legacy state from a build that had profiles. Anything not kept goes on
    // modifying headers with no way to see or reach it, so which ones are
    // dropped is the caller's whole basis for removing them from storage —
    // a count would not be enough to write the removal or to log it.
    const kept = prof('p1', 0);
    const second = prof('p2', 1);
    const third = prof('p3', 2);
    const resolved = resolveSingleProfile([kept, second, third]);
    expect(resolved.profile).toBe(kept);
    expect(resolved.dropped.map((p) => p.id)).toEqual(['p2', 'p3']);
  });

  it('does not mutate the list it is given', () => {
    // The destructuring rest could just as easily have been a `splice`, which
    // would empty the caller's own array — and the caller is holding React
    // state.
    const profiles = [prof('p1'), prof('p2')];
    resolveSingleProfile(profiles);
    expect(profiles.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});
