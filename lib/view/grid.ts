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
 * Whether compile() suppresses the profile named by `profileId` — the caller's
 * answer, never this module's.
 *
 * The predicate lives in `lib/compile/suppression.ts` and has exactly one
 * definition there; its comment says why restating it is how Phase 2a broke.
 * Taking the answer as a parameter keeps this module free of the compile layer
 * (the purity guard covers `lib/view`) *and* keeps the predicate to one caller
 * per surface, which is the same thing that comment asks for.
 */
export interface ProfileLiveness {
  suppressed: boolean;
}

/**
 * What the profile tab should show for a profile the user is not looking at.
 *
 * compile() reports on every profile, but the popup renders one at a time —
 * without this, a broken profile two tabs over is invisible, which is the same
 * silent failure the diagnostics exist to remove.
 *
 * Three states earn a marker. An error means the profile does not work; a
 * missing permission means it registered and does nothing; and a suppressed
 * profile emits no rule at all. Other warnings are worth saying in the band but
 * do not mean the profile is broken, so the tab stays clean — a marker that
 * fires on everything gets ignored.
 *
 * Suppression has to come in separately because severity cannot carry it. A
 * profile whose domains are *all* unusable earns `empty-filter` at severity
 * `warning` (filterDiagnostics.ts:126) while compile.ts emits nothing for it,
 * so the severity rule alone leaves a dead profile's tab clean and the band —
 * scoped to the active profile — never mentions it either. Splitting
 * `empty-filter` so that case becomes an error is deferred to 2c (spec §9);
 * until then the marker asks whether the profile is alive rather than guessing
 * from the diagnostic it happened to earn.
 */
export function profileMarker(
  diagnostics: readonly Diagnostic[],
  profileId: string,
  liveness: ProfileLiveness,
): ProfileMarker {
  // Ahead of the scan, not folded into it: the marker must appear even when
  // this profile has no diagnostic of its own to upgrade.
  if (liveness.suppressed) return 'error';

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
 * Whether compile() emits any rule at all for the profile these rows belong to
 * — again the caller's answer, for the reason ProfileLiveness gives.
 */
export interface GroupLiveness {
  live: boolean;
}

/**
 * The "N of M applying" figures on a group header.
 *
 * A row applies when it is switched on, nothing about it is an error, and the
 * profile it sits in is actually emitting rules.
 *
 * A warning does not stop a row applying — that is what makes it a warning. But
 * the three judgements that kill a *whole* profile are not row-level at all:
 * a profile switched off is skipped before anything else (compile.ts:28),
 * `globalPause` skips the rule-building block outright (compile.ts:40), and
 * suppression `continue`s past the profile (compile.ts:51). None produces a
 * diagnostic carrying a `headerRuleId`, so nothing about them ever reaches
 * `byRow` and every row still looks healthy. Without `live` the group header
 * says "3 of 3 applying" directly above a band reading "the whole profile is
 * not applied" — one screen contradicting itself while zero rules are
 * registered. `live` is what makes this figure a claim about compile()'s output
 * rather than about row state that merely resembles it.
 *
 * The caller answers all three by asking, never by restating: the suppression
 * half is `isSuppressed` (lib/compile/suppression.ts), which has exactly one
 * definition and a comment on why a fifth copy of that predicate is how Phase
 * 2a broke. See entrypoints/popup/App.tsx for the one expression that composes
 * them.
 *
 * `off` is deliberately unaffected: it means "the user switched this row off",
 * which stays true whether or not the profile is live. Zeroing it too would
 * report switched-off rows as switched on.
 */
export function groupCounts(
  rows: readonly HeaderRule[],
  byRow: ReadonlyMap<string, Diagnostic[]>,
  liveness: GroupLiveness,
): GroupCounts {
  let applying = 0;
  let off = 0;

  for (const rule of rows) {
    if (!rule.enabled) {
      off += 1;
      continue;
    }
    if (!liveness.live) continue;
    const broken = byRow.get(rule.id)?.some((d) => d.severity === 'error') ?? false;
    if (!broken) applying += 1;
  }

  return { total: rows.length, applying, off };
}

export interface RuleTally {
  total: number;
  /** Switched on, unbroken, and in a rule set the compiler actually emits. */
  live: number;
  /** Switched off by the user. */
  off: number;
  /** Switched on and still not going out. */
  blocked: number;
}

/**
 * The rail's readout: "N of M rules live", then "K switched off · J blocked".
 *
 * `live` is the same judgement `groupCounts` called `applying`, and for the
 * same reasons — a warning does not stop a rule going out, but the three
 * profile-level judgements (compile.ts:28, :40, :51) stop all of them at once
 * without ever reaching `byRow`, so the caller has to answer that separately.
 *
 * What is new here is `blocked`, and it exists because this readout is the
 * only count on screen. `groupCounts` reported `applying` and `off` and left
 * the difference between them unnamed: a rule switched on and going nowhere
 * was simply missing from both figures, which is the silence this product is
 * against. Deriving it as `total - live - off` rather than counting it
 * separately is deliberate — the three figures then cannot fail to add up to
 * `total`, so the readout can never accuse itself of losing a rule.
 */
export function ruleTally(
  rows: readonly HeaderRule[],
  byRow: ReadonlyMap<string, Diagnostic[]>,
  liveness: GroupLiveness,
): RuleTally {
  let live = 0;
  let off = 0;

  for (const rule of rows) {
    if (!rule.enabled) {
      off += 1;
      continue;
    }
    if (!liveness.live) continue;
    const broken = byRow.get(rule.id)?.some((d) => d.severity === 'error') ?? false;
    if (!broken) live += 1;
  }

  return { total: rows.length, live, off, blocked: rows.length - live - off };
}
