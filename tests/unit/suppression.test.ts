import { describe, expect, it } from 'vitest';
import { isSuppressed, scopeSuppression, suppressionReason } from '@/lib/compile/suppression';
import { createProfile } from '@/lib/model/defaults';
import type { Filter, Profile } from '@/lib/model/types';

function profileWith(filter: Partial<Filter>): Profile {
  const base = createProfile('P', 0);
  return { ...base, id: 'p1', filter: { ...base.filter, ...filter } };
}

describe('suppressionReason — request types', () => {
  it('fails a Firefox profile closed when no listed type is supported there', () => {
    // A rule with `resourceTypes: []` is rejected by DNR, and one with the
    // key omitted widens to every type but main_frame — so nothing usable
    // left means no rule, said out loud.
    const p = profileWith({ domains: ['api.example.com'], resourceTypes: ['webbundle'] });
    expect(suppressionReason(p, 'firefox')).toBe('no-resource-type');
    expect(isSuppressed(p, 'firefox')).toBe(true);
    expect(suppressionReason(p, 'chrome')).toBeNull();
  });

  it('outranks all-sites: that mode empties the domain condition, not the type condition', () => {
    const p = profileWith({ allSites: true, domains: [], resourceTypes: ['webtransport'] });
    expect(suppressionReason(p, 'firefox')).toBe('no-resource-type');
    expect(suppressionReason(p, 'chrome')).toBeNull();
  });

  it('is not raised while one supported type remains', () => {
    const p = profileWith({
      domains: ['api.example.com'],
      resourceTypes: ['webbundle', 'xmlhttprequest'],
    });
    expect(suppressionReason(p, 'firefox')).toBeNull();
  });

  it('does not trust the schema about emptiness — an empty list is closed on Chrome too', () => {
    // schema.ts says min(1); this predicate is the last line before DNR and
    // decides for itself, the same way conditions.ts drops bad domains.
    const p = profileWith({ domains: ['api.example.com'], resourceTypes: [] });
    expect(suppressionReason(p, 'chrome')).toBe('no-resource-type');
  });

  it('still answers the two older reasons with a target in hand', () => {
    expect(suppressionReason(profileWith({ domains: [] }), 'chrome')).toBe('no-scope');
    expect(suppressionReason(profileWith({ domains: ['a b.com'] }), 'firefox')).toBe(
      'unusable-site',
    );
  });
});

describe('scopeSuppression — the target-free domain half', () => {
  it('answers unusable-site, no-scope or null for the three domain states, independent of any target', () => {
    expect(scopeSuppression(profileWith({ domains: ['a b.com'] }))).toBe('unusable-site');
    expect(scopeSuppression(profileWith({ domains: [] }))).toBe('no-scope');
    expect(scopeSuppression(profileWith({ domains: ['api.example.com'] }))).toBeNull();
  });

  it('lets a target-only failure through — suppressionReason still puts no-resource-type first', () => {
    // A domain list this function calls perfectly fine (`null`) can still be
    // part of a suppressed profile once the type list is asked too — that
    // composition, and its priority, belongs to `suppressionReason` alone.
    const p = profileWith({ domains: ['api.example.com'], resourceTypes: ['webbundle'] });
    expect(scopeSuppression(p)).toBeNull();
    expect(suppressionReason(p, 'firefox')).toBe('no-resource-type');
  });
});
