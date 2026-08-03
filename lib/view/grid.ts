import type { Diagnostic, HeaderRule, Profile } from '@/lib/model/types';

export interface RowGroups {
  request: HeaderRule[];
  response: HeaderRule[];
}

/**
 * Splits a profile's rows by target, preserving the order the user put them in.
 *
 * Disabled rows stay: the grid shows them switched off rather than hiding them,
 * so a row you turned off does not vanish from the place you left it.
 */
export function groupRows(profile: Profile): RowGroups {
  const request: HeaderRule[] = [];
  const response: HeaderRule[] = [];
  for (const rule of profile.headers) {
    (rule.target === 'response' ? response : request).push(rule);
  }
  return { request, response };
}

export interface RoutedDiagnostics {
  byRow: Map<string, Diagnostic[]>;
  profileLevel: Diagnostic[];
}

/**
 * Sorts diagnostics into the two places the grid can show them.
 *
 * The test is `headerRuleId`, not the kind. A kind table would have to be
 * edited every time `DiagnosticKind` grows — and Phase 2a grew it twice — so
 * the field decides instead: something that names a row hangs under that row,
 * something that does not belongs to the profile.
 */
export function routeDiagnostics(diagnostics: readonly Diagnostic[]): RoutedDiagnostics {
  const byRow = new Map<string, Diagnostic[]>();
  const profileLevel: Diagnostic[] = [];

  for (const diagnostic of diagnostics) {
    const rowId = diagnostic.headerRuleId;
    if (rowId === undefined) {
      profileLevel.push(diagnostic);
      continue;
    }
    const existing = byRow.get(rowId);
    if (existing) existing.push(diagnostic);
    else byRow.set(rowId, [diagnostic]);
  }

  return { byRow, profileLevel };
}

export type ProfileMarker = 'error' | 'permission' | null;

/**
 * What the profile tab should show for a profile the user is not looking at.
 *
 * compile() reports on every profile, but the popup renders one at a time —
 * without this, a broken profile two tabs over is invisible, which is the same
 * silent failure the diagnostics exist to remove.
 *
 * Only two states earn a marker. An error means the profile does not work; a
 * missing permission means it registered and does nothing. Other warnings are
 * worth saying in the band but do not mean the profile is broken, so the tab
 * stays clean — a marker that fires on everything gets ignored.
 */
export function profileMarker(
  diagnostics: readonly Diagnostic[],
  profileId: string,
): ProfileMarker {
  let permission = false;
  for (const diagnostic of diagnostics) {
    if (diagnostic.profileId !== profileId) continue;
    if (diagnostic.severity === 'error') return 'error';
    if (diagnostic.kind === 'permission-missing') permission = true;
  }
  return permission ? 'permission' : null;
}

export interface GroupCounts {
  total: number;
  applying: number;
  off: number;
}

/**
 * The "N of M applying" figures on a group header.
 *
 * A row applies when it is switched on and nothing about it is an error.
 * A warning does not stop it applying — that is what makes it a warning.
 */
export function groupCounts(
  rows: readonly HeaderRule[],
  byRow: ReadonlyMap<string, Diagnostic[]>,
): GroupCounts {
  let applying = 0;
  let off = 0;

  for (const rule of rows) {
    if (!rule.enabled) {
      off += 1;
      continue;
    }
    const broken = byRow.get(rule.id)?.some((d) => d.severity === 'error') ?? false;
    if (!broken) applying += 1;
  }

  return { total: rows.length, applying, off };
}
