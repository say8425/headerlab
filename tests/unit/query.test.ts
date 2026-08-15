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
