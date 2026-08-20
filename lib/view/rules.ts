import { hasRowError, rowKey } from '@/lib/compile/validate';
import type { Diagnostic, HeaderRule } from '@/lib/model/types';

// Re-exported so every existing caller and test
// (`import { rowKey } from '@/lib/view/rules'`) keeps working — the
// definition itself now lives in `lib/compile/validate.ts`, beside
// `hasRowError`, which this file already imports from there. See that
// file's own docblock on `rowKey` for why it moved and what it guards
// against.
export { rowKey };

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
      push(byRow, rowKey(diagnostic.profileId, diagnostic.headerRuleId), diagnostic);
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
  /**
   * Whether the hosts that scope this rule set are granted — the caller's
   * answer again, for the same reason `live` is.
   *
   * A rule cannot match anything on a host the extension has no permission
   * for, so `access: 'none'` holds rules out of `live` exactly as `live:
   * false` does — but only when *every* scoping host is missing. `'some'` is
   * reported, not acted on: the rules still go out to the granted hosts, and
   * this count's job is to say what goes out, not what could.
   *
   * Optional because one caller cannot answer it: the bridge's `status()`
   * builds its payload synchronously and never probes grants, so it leaves
   * the question unanswered. Absent means "not asked" — the count stays as it
   * was before this field existed — never "granted". See CLAUDE.md, Known
   * gaps, for what that leaves open on the CLI side.
   */
  access?: 'all' | 'some' | 'none';
}

export interface RuleTally {
  total: number;
  /** Switched on, unbroken, and in a rule set the compiler actually emits. */
  live: number;
  /** Switched off by the user. */
  off: number;
  /** Started but not named yet, so there is nothing to send. */
  unfinished: number;
  /** Switched on, finished, and still not going out. */
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
 * `access` is the fourth judgement of that shape, and it is why `Liveness`
 * grew its second field. A `permission-missing` diagnostic carries `host` and
 * never `headerRuleId`, so `routeDiagnostics` files it under `byHost` where
 * this loop cannot see it — and it is a warning by design, because the Grant
 * button on the site row is the remedy, not an error to raise here. Without
 * the caller handing the answer in, a rule scoped solely to an ungranted host
 * counted as live with "no problems", which is the first screen every new
 * user reads: they press Grant nowhere, the header never goes out, and the
 * readout spends the whole debugging session insisting it did.
 *
 * `blocked` is what this readout adds. The count it replaces reported
 * "applying" and "off" and left the difference between them unnamed, so a rule
 * switched on and going nowhere appeared in neither figure — the silence this
 * product exists to remove. It is derived as the remainder rather than counted
 * separately, so the four figures cannot fail to account for every rule.
 *
 * `unfinished` splits the honest half of that remainder back out. A rule the
 * user has not named yet is not going out either, but it is not *blocked* —
 * nothing is stopping it, it simply is not a rule yet. Reporting it as blocked
 * is how a popup ends up showing a red error on a row created one click ago,
 * which is a product accusing the user of a mistake it made itself. Counting
 * it under its own name is what lets the row stay quiet without the state
 * going unsaid.
 *
 * `off` is deliberately unaffected by `live`: it means "the user switched this
 * off", which stays true whether or not anything is being emitted. Sweeping it
 * into `blocked` would report rules as fighting to get out while the user is
 * the one holding them back.
 */
export function ruleTally(
  rows: readonly HeaderRule[],
  /** The profile `rows` belong to — half of `byRow`'s key. See `rowKey`. */
  profileId: string,
  byRow: ReadonlyMap<string, Diagnostic[]>,
  liveness: Liveness,
): RuleTally {
  let live = 0;
  let off = 0;
  let unfinished = 0;

  for (const rule of rows) {
    // Switched off first: it is the user's own decision about this rule, so it
    // outranks anything the compiler noticed. It is also the only one of the
    // three that stays true when nothing is being emitted at all.
    if (!rule.enabled) {
      off += 1;
      continue;
    }

    const problems = byRow.get(rowKey(profileId, rule.id));

    // Unfinished before the liveness test, so pausing cannot relabel a rule
    // the user simply has not named yet. "Blocked" would say the pause is what
    // stops it; nothing stops an unnamed rule but the missing name, and that
    // stays true whether the set is running or not.
    //
    // Read off `severity`, never off the kind — see `Diagnostic.severity`.
    if (problems?.some((d) => d.severity === 'incomplete')) {
      unfinished += 1;
      continue;
    }

    if (!liveness.live) continue;
    // After the liveness test, before the row's own health: with no granted
    // host anywhere in the scope the rule cannot match a request no matter
    // how healthy it is, and a healthy rule going nowhere is what `blocked`
    // exists to name. `'some'` deliberately does not stop here — the rule
    // still applies on the hosts that are granted.
    if (liveness.access === 'none') continue;
    if (hasRowError(problems)) continue;
    live += 1;
  }

  return {
    total: rows.length,
    live,
    off,
    unfinished,
    blocked: rows.length - live - off - unfinished,
  };
}
