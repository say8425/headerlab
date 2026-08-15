import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { status } from '@/lib/bridge/query';
import { parseQuery, querySchema } from '@/lib/bridge/protocol';
import { bootstrapProfile } from '@/lib/model/defaults';
import type { AppState } from '@/lib/model/types';

const emptyState = (): AppState => ({
  version: 2,
  globalPause: false,
  profiles: [],
  theme: 'system',
});

describe('querySchema', () => {
  it('accepts the one query it declares', () => {
    expect(parseQuery({ cmd: 'status' })).toEqual({ cmd: 'status' });
  });

  it('rejects a write command — this schema is reads only', () => {
    expect(() => parseQuery({ cmd: 'pause' })).toThrow(ZodError);
    expect(() => parseQuery({ cmd: 'site.add', domains: ['a.com'] })).toThrow(ZodError);
  });

  it('declares exactly one shape', () => {
    expect(querySchema.options).toHaveLength(1);
  });
});

describe('status', () => {
  it('reports an empty store without inventing a profile', () => {
    const payload = status(emptyState());
    expect(payload.profile).toBeNull();
    expect(payload.tally).toBeNull();
    expect(payload.scopingHosts).toEqual([]);
    expect(payload.state).toEqual(emptyState());
  });

  it('reports the scoping hosts, not filter.domains', () => {
    const profile = bootstrapProfile();
    const state: AppState = {
      version: 2,
      globalPause: false,
      theme: 'system',
      profiles: [{ ...profile, filter: { ...profile.filter, allSites: true, domains: ['a.com'] } }],
    };
    // all-sites 는 저장된 목록을 지우지 않고 컴파일만 안 한다. scopingHosts
    // 가 그 구분을 아는 유일한 술어이고, filter.domains 를 직접 읽으면
    // all-sites 프로필을 좁은 것으로 오판한다.
    expect(status(state).scopingHosts).toEqual([]);
  });

  it('counts rules the way the popup counts them', () => {
    const profile = bootstrapProfile();
    const state: AppState = {
      version: 2,
      globalPause: false,
      theme: 'system',
      profiles: [
        {
          ...profile,
          filter: { ...profile.filter, domains: ['a.com'] },
          headers: [
            { id: 'r1', enabled: true, target: 'request', operation: 'set', name: 'A', value: '1' },
            {
              id: 'r2',
              enabled: false,
              target: 'request',
              operation: 'set',
              name: 'B',
              value: '2',
            },
            { id: 'r3', enabled: true, target: 'request', operation: 'set', name: '', value: '' },
          ],
        },
      ],
    };
    const { tally } = status(state);
    expect(tally).not.toBeNull();
    expect(tally!.total).toBe(3);
    expect(tally!.off).toBe(1);
    expect(tally!.unfinished).toBe(1);
  });

  it('does not count a rule as live while the extension is paused', () => {
    // Task 13's implementer mutation-verified that hardcoding
    // `ruleTally(..., { live: true })` in `status()` leaves every other test
    // in this file green — a paused extension would still be reported as
    // shipping its rules live, and nothing here would catch it. This test
    // exists to close exactly that hole: it pins `live` and `blocked` to
    // exact counts (not a partial match) for a state that is both paused
    // and carries one enabled, complete rule, so a wiring that reads
    // `{ live: true }` instead of `{ live: !state.globalPause }` fails it.
    const profile = bootstrapProfile();
    const state: AppState = {
      version: 2,
      globalPause: true,
      theme: 'system',
      profiles: [
        {
          ...profile,
          filter: { ...profile.filter, domains: ['a.com'] },
          headers: [
            { id: 'r1', enabled: true, target: 'request', operation: 'set', name: 'A', value: '1' },
          ],
        },
      ],
    };
    const { tally } = status(state);
    expect(tally).not.toBeNull();
    expect(tally!.total).toBe(1);
    expect(tally!.live).toBe(0);
    expect(tally!.off).toBe(0);
    expect(tally!.unfinished).toBe(0);
    expect(tally!.blocked).toBe(1);
  });

  /**
   * The pause test above claims to close the "is this rule live" hole and
   * closes one third of it: `live` has three terms in the popup
   * (`active.enabled && !state.globalPause && !isSuppressed(active)`) and
   * only the middle one was wired. These two pin the other two terms.
   *
   * The suppressed case is not an edge case. `createProfile` ships a *new*
   * rule set unscoped on purpose, so `headerlab rule add` before
   * `site add` on a fresh install lands exactly here — and for a suppressed
   * set `render.mjs` at least prints a suppression line beside the count,
   * while for a disabled one there is nothing at all to contradict it.
   */
  it('does not count a rule as live in a rule set compile() suppresses', () => {
    const profile = bootstrapProfile();
    const state: AppState = {
      version: 2,
      globalPause: false,
      theme: 'system',
      profiles: [
        {
          ...profile,
          // No domain and all-sites off: `suppressionReason` is `no-scope`,
          // and compile() emits nothing for the whole set.
          filter: { ...profile.filter, domains: [], allSites: false },
          headers: [
            { id: 'r1', enabled: true, target: 'request', operation: 'set', name: 'A', value: '1' },
          ],
        },
      ],
    };
    const payload = status(state);
    // The suppression is reported, so the count contradicting it is visible
    // as a contradiction rather than merely wrong.
    expect(payload.suppression).toBe('no-scope');
    expect(payload.tally).toEqual({ total: 1, live: 0, off: 0, unfinished: 0, blocked: 1 });
  });

  it('does not count a rule as live in a switched-off rule set', () => {
    const profile = bootstrapProfile();
    const state: AppState = {
      version: 2,
      globalPause: false,
      theme: 'system',
      profiles: [
        {
          ...profile,
          enabled: false,
          filter: { ...profile.filter, domains: ['a.com'] },
          headers: [
            { id: 'r1', enabled: true, target: 'request', operation: 'set', name: 'A', value: '1' },
          ],
        },
      ],
    };
    const payload = status(state);
    // Nothing else in the payload says the set is off — `suppression` is
    // null, because a switched-off set is not suppressed — so a wrong count
    // here is a bare false claim about whether headers are being modified.
    expect(payload.suppression).toBeNull();
    expect(payload.tally).toEqual({ total: 1, live: 0, off: 0, unfinished: 0, blocked: 1 });
  });

  /**
   * `resolveSingleProfile` returns the rule sets it could not report, and its
   * docblock says the caller must deal with them. A read command cannot
   * remove them, so it names them.
   */
  it('names the rule sets it is not reporting', () => {
    const first = bootstrapProfile();
    const second = { ...bootstrapProfile(), id: 'left-behind' };
    const payload = status({
      version: 2,
      globalPause: false,
      theme: 'system',
      profiles: [first, second],
    });
    expect(payload.profile?.id).toBe(first.id);
    expect(payload.dropped).toEqual(['left-behind']);
  });

  it('reports no dropped rule sets when there is nothing to drop', () => {
    expect(status(emptyState()).dropped).toEqual([]);
    expect(status({ ...emptyState(), profiles: [bootstrapProfile()] }).dropped).toEqual([]);
  });

  /**
   * Diagnostics belonging to a rule set this payload does not describe must
   * not ride along. `render.mjs` already knew this for rows — it keys by
   * profile id precisely so another rule set's problem does not land on this
   * one's row — and the same leak was open on `byHost` and `scope`.
   */
  it('carries only the reported rule set’s diagnostics', () => {
    const shown = {
      ...bootstrapProfile(),
      filter: { ...bootstrapProfile().filter, domains: ['a.com'] },
    };
    const hidden = {
      ...bootstrapProfile(),
      id: 'hidden',
      // An unusable domain: this produces diagnostics of its own.
      filter: { ...bootstrapProfile().filter, domains: ['not a domain'] },
      headers: [
        {
          id: 'h1',
          enabled: true,
          target: 'request' as const,
          operation: 'set' as const,
          name: '',
          value: '',
        },
      ],
    };
    const payload = status({
      version: 2,
      globalPause: false,
      theme: 'system',
      profiles: [shown, hidden],
    });

    const owners = (p: ReturnType<typeof status>) =>
      [
        ...p.diagnostics.byRow.flatMap(([, ds]) => ds),
        ...p.diagnostics.byHost.flatMap(([, ds]) => ds),
        ...p.diagnostics.scope,
      ].map((d) => d.profileId);

    // Absence first: nothing from the rule set this payload never mentions.
    expect(owners(payload).filter((id) => id !== shown.id)).toEqual([]);

    // And the fixture really does produce them, so the check above is not
    // passing on an empty set. Measured: they land in `byRow` (the unnamed
    // header) and `scope` (the unusable domain) — `scope` being exactly the
    // bucket `render.mjs` had no profile id to key by.
    const alone = status({ version: 2, globalPause: false, theme: 'system', profiles: [hidden] });
    expect(owners(alone)).toEqual(['hidden', 'hidden']);
    expect(alone.diagnostics.scope).toHaveLength(1);
  });

  /**
   * `requiredOrigins` answers for the rule set this payload describes, not
   * for every rule set in storage.
   */
  it('reports the origins the shown rule set needs, not the union', () => {
    const shown = {
      ...bootstrapProfile(),
      filter: { ...bootstrapProfile().filter, domains: ['a.com'] },
    };
    const hidden = {
      ...bootstrapProfile(),
      id: 'hidden',
      filter: { ...bootstrapProfile().filter, domains: ['b.com'] },
    };
    const payload = status({
      version: 2,
      globalPause: false,
      theme: 'system',
      profiles: [shown, hidden],
    });
    expect(payload.requiredOrigins.some((o) => o.includes('b.com'))).toBe(false);
    expect(payload.requiredOrigins.every((o) => o.includes('a.com'))).toBe(true);
    expect(payload.requiredOrigins.length).toBeGreaterThan(0);
  });

  it('serialises the diagnostic maps as pairs so they survive JSON', () => {
    const payload = status(emptyState());
    expect(Array.isArray(payload.diagnostics.byRow)).toBe(true);
    expect(Array.isArray(payload.diagnostics.byHost)).toBe(true);
    // JSON.stringify(new Map()) 은 '{}' 다 — 지도를 그대로 실으면 소켓
    // 건너편에서 조용히 빈 객체가 된다.
    expect(JSON.parse(JSON.stringify(payload)).diagnostics.byRow).toEqual([]);
  });

  it('reports globalPause', () => {
    expect(status({ ...emptyState(), globalPause: true }).globalPause).toBe(true);
  });
});
