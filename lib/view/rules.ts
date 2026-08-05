import type { Diagnostic, HeaderRule } from '@/lib/model/types';

export interface RoutedDiagnostics {
  /** Problems belonging to one rule, keyed by its id. */
  byRow: Map<string, Diagnostic[]>;
  /** Problems belonging to one site, keyed by the normalized host they name. */
  byHost: Map<string, Diagnostic[]>;
  /** Everything else: about the screen, not about any one rule or site. */
  scope: Diagnostic[];
}

/**
 * Sorts diagnostics into the three places this popup can show them.
 *
 * The test is the **field**, never the kind. A kind table would have to be
 * edited every time `DiagnosticKind` grows — and Phase 2a grew it twice — so
 * the fields decide instead: something naming a rule hangs inside that rule's
 * card, something naming a host hangs on that host's row in the rail, and
 * something naming neither is about the screen.
 *
 * `host` earns its own destination because of what this layout does with it. A
 * domain and its access state are the same object here, so `permission-missing`
 * has to reach the row that named the domain rather than a band shoving the
 * rules down the screen — and `host` is documented on `Diagnostic` as exactly
 * "the host this diagnostic is about, when it is about one", so routing on it
 * stays correct as new kinds arrive without a list to maintain.
 *
 * Rule first, host second, for a future diagnostic carrying both: a problem
 * that names a specific rule belongs beside that rule, where it can be acted
 * on.
 */
export function routeDiagnostics(diagnostics: readonly Diagnostic[]): RoutedDiagnostics {
  const byRow = new Map<string, Diagnostic[]>();
  const byHost = new Map<string, Diagnostic[]>();
  const scope: Diagnostic[] = [];

  const push = (map: Map<string, Diagnostic[]>, key: string, diagnostic: Diagnostic) => {
    const existing = map.get(key);
    if (existing) existing.push(diagnostic);
    else map.set(key, [diagnostic]);
  };

  for (const diagnostic of diagnostics) {
    if (diagnostic.headerRuleId !== undefined) {
      push(byRow, diagnostic.headerRuleId, diagnostic);
    } else if (diagnostic.host !== undefined) {
      push(byHost, diagnostic.host, diagnostic);
    } else {
      scope.push(diagnostic);
    }
  }

  return { byRow, byHost, scope };
}

/**
 * Whether compile() emits any rule at all for the rule set these rows belong
 * to — the caller's answer, never this module's.
 *
 * The predicate half of it lives in `lib/compile/suppression.ts` and has
 * exactly one definition there; its comment says why restating it is how Phase
 * 2a broke. Taking the answer as a parameter keeps this module clear of the
 * compile layer (the purity guard covers `lib/view`) *and* keeps that
 * predicate to one caller per surface, which is what that comment asks for.
 */
export interface Liveness {
  live: boolean;
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
 * A rule is live when it is switched on, nothing about it is an error, and the
 * rule set it sits in is actually emitting rules. A warning does not stop a
 * rule going out — that is what makes it a warning.
 *
 * That last term cannot be derived here. The three judgements that kill every
 * rule at once are not rule-level at all: a switched-off rule set is skipped
 * before anything else (compile.ts:28), `globalPause` skips the rule-building
 * block outright (compile.ts:40), and suppression `continue`s past it
 * (compile.ts:51). None produces a diagnostic carrying a `headerRuleId`, so
 * nothing about them reaches `byRow` and every rule still looks healthy.
 * Without `live` the readout says "3 of 3 rules live" while zero rules are
 * registered — one screen contradicting itself.
 *
 * `blocked` is what this readout adds. The count it replaces reported
 * "applying" and "off" and left the difference between them unnamed, so a rule
 * switched on and going nowhere appeared in neither figure — the silence this
 * product exists to remove. It is derived as `total - live - off` rather than
 * counted separately, so the three figures cannot fail to account for every
 * rule.
 *
 * `off` is deliberately unaffected by `live`: it means "the user switched this
 * off", which stays true whether or not anything is being emitted. Sweeping it
 * into `blocked` would report rules as fighting to get out while the user is
 * the one holding them back.
 */
export function ruleTally(
  rows: readonly HeaderRule[],
  byRow: ReadonlyMap<string, Diagnostic[]>,
  liveness: Liveness,
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
