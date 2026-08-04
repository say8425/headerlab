import { describe, expect, it } from 'vitest';
import { auditDiagnostics, domainsToAudit } from '@/lib/permissions/audit';
import { createProfile } from '@/lib/model/defaults';
import type { Profile } from '@/lib/model/types';

function p(id: string, name: string, domains: string[], enabled = true): Profile {
  const base = createProfile(name, 0);
  return { ...base, id, name, enabled, filter: { ...base.filter, domains } };
}

describe('domainsToAudit', () => {
  it('collects normalized hosts from enabled profiles, first-seen order', () => {
    expect(domainsToAudit([
      p('a', 'A', ['B.example.com', 'a.example.com']),
      p('b', 'B', ['a.example.com']),
    ])).toEqual(['b.example.com', 'a.example.com']);
  });

  it('normalizes a port away before auditing — the pattern would otherwise throw', () => {
    expect(domainsToAudit([p('a', 'A', ['localhost:3000'])])).toEqual(['localhost']);
  });

  it('skips a profile whose domain list is only partly usable', () => {
    // Replaces an earlier per-entry expectation of ['ok.com']. The compiler
    // suppresses this profile whole, so auditing its surviving host would put
    // a permission badge on a rule that was never registered — exactly what
    // this module's docstring says it avoids.
    expect(domainsToAudit([p('a', 'A', ['a b.com', 'ok.com'])])).toEqual([]);
  });

  it('audits every host of a profile whose domains are all usable', () => {
    expect(domainsToAudit([p('a', 'A', ['ok.com', 'other.com'])]))
      .toEqual(['ok.com', 'other.com']);
  });

  it('ignores disabled profiles', () => {
    expect(domainsToAudit([p('a', 'A', ['x.com'], false)])).toEqual([]);
  });

  it('returns nothing for a profile with no domains — <all_urls> is not auditable per-domain', () => {
    expect(domainsToAudit([p('a', 'A', [])])).toEqual([]);
  });
});

describe('auditDiagnostics', () => {
  it('is quiet when every domain is granted', () => {
    expect(auditDiagnostics(
      [p('a', 'A', ['x.com'])],
      [{ domain: 'x.com', granted: true }],
    )).toEqual([]);
  });

  it('raises permission-missing for an ungranted domain', () => {
    const d = auditDiagnostics(
      [p('a', 'A', ['x.com'])],
      [{ domain: 'x.com', granted: false }],
    );
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('permission-missing');
    expect(d[0]?.severity).toBe('warning');
    expect(d[0]?.profileId).toBe('a');
    expect(d[0]?.message).toContain('x.com');
  });

  it('reports once per profile-domain pair when two profiles need the same host', () => {
    const d = auditDiagnostics(
      [p('a', 'A', ['x.com']), p('b', 'B', ['x.com'])],
      [{ domain: 'x.com', granted: false }],
    );
    expect(d.map((x) => x.profileId).sort()).toEqual(['a', 'b']);
  });

  it('reports once per profile even when the same profile lists the host twice', () => {
    // Two raw entries normalizing to the same host must not double the badge:
    // this is a diagnostic per distinct host per profile, not per raw entry.
    const d = auditDiagnostics(
      [p('a', 'A', ['x.com', 'X.com'])],
      [{ domain: 'x.com', granted: false }],
    );
    expect(d).toHaveLength(1);
  });

  it('says nothing about a domain it was given no answer for', () => {
    // A probe that threw is reported as ungranted by the adapter, never omitted.
    // An omission here means the adapter never asked, so staying quiet is right.
    expect(auditDiagnostics([p('a', 'A', ['x.com'])], [])).toEqual([]);
  });

  it('ignores disabled profiles', () => {
    expect(auditDiagnostics(
      [p('a', 'A', ['x.com'], false)],
      [{ domain: 'x.com', granted: false }],
    )).toEqual([]);
  });

  it('carries the host so the Grant button need not parse the message', () => {
    const d = auditDiagnostics(
      [p('a', 'A', ['x.com'])],
      [{ domain: 'x.com', granted: false }],
    );
    expect(d[0]?.host).toBe('x.com');
  });

  it('says nothing about a profile the compiler suppressed', () => {
    // "The rule is registered but will not apply until you grant it" would be
    // a lie here: no rule was registered, and granting the permission changes
    // nothing. The unusable entry is what the user has to fix, and
    // validateFilter is what says so.
    expect(auditDiagnostics(
      [p('a', 'A', ['api.example.com', 'https://staging.example.com'])],
      [{ domain: 'api.example.com', granted: false }],
    )).toEqual([]);
  });
});
