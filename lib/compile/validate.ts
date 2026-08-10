import { HEADER_TOKEN } from '@/lib/compile/headers';
import type { Diagnostic, HeaderTarget, Profile } from '@/lib/model/types';

/**
 * Chromium's `kDNRRequestHeaderAppendAllowList`. Exactly these 21 request
 * headers accept `append`.
 *
 * Anything else fails at rule-registration time with
 * ERROR_APPEND_INVALID_REQUEST_HEADER, and `updateDynamicRules` is
 * transactional — so one bad row stops every already-working rule. That error
 * never reaches the user, which is why this has to be caught here.
 *
 * Response headers have no allowlist at all: any header may be appended, and
 * the semantics differ (a request append joins with a separator, a response
 * append adds another header line).
 */
export const APPEND_ALLOWED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'access-control-request-headers',
  'cache-control',
  'connection',
  'content-language',
  'cookie',
  'forwarded',
  'if-match',
  'if-none-match',
  'keep-alive',
  'range',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'via',
  'want-digest',
  'x-forwarded-for',
]);

export function isAppendAllowed(target: HeaderTarget, name: string): boolean {
  if (target === 'response') return true;
  return APPEND_ALLOWED_REQUEST_HEADERS.has(name.trim().toLowerCase());
}

/**
 * Diagnostics for one profile's header rows.
 *
 * Disabled rows are ignored: they never reach the compiler, so a complaint
 * about one would be noise the user cannot act on meaningfully.
 */
export function validateHeaders(profile: Profile): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();

  for (const rule of profile.headers) {
    if (!rule.enabled) continue;

    const name = rule.name.trim();

    // Unfinished, not wrong — and the two are genuinely different events. The
    // popup creates a rule with an empty name on purpose, so an error here
    // means the product manufactures an invalid object and then tells the user
    // off for it before they have touched the keyboard.
    //
    // It still earns a diagnostic. Going quiet would trade this flaw for the
    // failure mode the whole product exists to remove: a rule that sends
    // nothing and says nothing. What it earns is a severity that says "not
    // finished" rather than "broken", which is what lets the popup count it
    // separately instead of colouring it red.
    //
    // Raised ahead of the token test rather than branched inside it. The check
    // below used to pick its message by testing `name.length === 0` while
    // emitting one kind and one severity for both — so the only thing telling
    // the two apart was the copy, and no consumer reads copy.
    //
    // Whitespace-only counts as unfinished: `name` is already trimmed here, the
    // same trim the compiler applies before deciding what to emit, so "   " and
    // "" are the same header name — none.
    if (name.length === 0) {
      diagnostics.push({
        kind: 'incomplete-header',
        severity: 'incomplete',
        profileId: profile.id,
        headerRuleId: rule.id,
        message: 'This rule has no name yet, so nothing is sent for it.',
      });
      continue;
    }

    if (!HEADER_TOKEN.test(name)) {
      diagnostics.push({
        kind: 'invalid-header-name',
        severity: 'error',
        profileId: profile.id,
        headerRuleId: rule.id,
        // Remedy first (Task 13): this renders truncated at ~338px/11px when
        // it takes over a rule row's value line, same as every other
        // bounded-row-meets-unbounded-text spot in this popup, and the tail
        // is what gets cut. The character set the user can actually act on
        // has to survive that; the fact of the failure is what can afford to.
        message: `Use letters, digits, and ! # $ % & ' * + - . ^ _ \` | ~ only — no spaces or colons. "${name}" is not a valid header name.`,
      });
      // A name this broken cannot be meaningfully checked for the other two
      // conditions; reporting three errors for one typo helps nobody.
      continue;
    }

    if (rule.operation === 'append' && !isAppendAllowed(rule.target, name)) {
      diagnostics.push({
        kind: 'append-not-allowed',
        severity: 'error',
        profileId: profile.id,
        headerRuleId: rule.id,
        // Remedy first (Task 13) — same reasoning as invalid-header-name
        // above: what to do ("Use Set instead…") used to be the clause a
        // truncated row cut, with the clause the user can do nothing about
        // left standing.
        message:
          'Use Set instead, or switch this row to a response header. ' +
          `Chrome does not allow appending to the request header "${name}".`,
      });
    }

    const key = `${rule.target} ${name.toLowerCase()}`;
    if (seen.has(key)) {
      diagnostics.push({
        kind: 'duplicate-header',
        severity: 'error',
        profileId: profile.id,
        headerRuleId: rule.id,
        // No "profile" here either: the UI shows one implicit rule set and no
        // profiles, so the word named something the reader cannot see.
        //
        // Names the winner, unlike the message this replaced. That older
        // message hedged because both rows used to reach Chrome and this
        // project had not measured which one Chrome kept. That is no longer
        // true: only the *first* occurrence of a key is left undiagnosed —
        // every later one lands here, at `error` severity, and `compile.ts`'s
        // `hasRowError` filter now excludes every diagnosed row from
        // `compileHeaders` before anything is sent. So this row specifically
        // is the one that stays home; the earlier row is the one still going
        // out, deterministically, by list order rather than by Chrome's own
        // unspecified resolution between two conflicting entries.
        //
        // Remedy first (Task 13), same reasoning as the other two error
        // messages in this file: what to do about it survives truncation,
        // not just the fact that something is wrong.
        message: `Rename this row or delete it. An earlier row already sets "${name}".`,
      });
    }
    seen.add(key);
  }

  return diagnostics;
}

/**
 * Whether a header row has at least one error-severity diagnostic among the
 * ones already computed for it.
 *
 * One predicate, one definition — `suppression.ts`'s own rule, restated for
 * the row half of it. Two callers used to each decide this independently
 * (or, for compile.ts, not decide it at all): `compile.ts` must not hand a
 * diagnosed row to `compileHeaders` — `updateDynamicRules` is transactional,
 * so one bad row rejects the whole batch and leaves whatever was registered
 * before still in force, silently, while the screen shows the new state.
 * The rail's readout (`lib/view/rules.ts`) must not count a row like that
 * as live either. Both now ask this rather than re-testing `severity`
 * themselves.
 *
 * Two of the three `error` kinds this file emits are the real batch-rejection
 * risk: an append Chrome will refuse (`append-not-allowed`), and a duplicate
 * (`duplicate-header`) — both pass `HEADER_TOKEN` and were, before this
 * function existed, sent to `compileHeaders` unfiltered. The third,
 * `invalid-header-name`, was never actually one of them: `compileHeaders`
 * already runs its own `HEADER_TOKEN.test` and skips a name that fails it,
 * independently of anything here, so that row never reached Chrome even
 * before this filter existed. Excluding it here too is belt-and-braces, not
 * the fix for a reach-Chrome bug the other two are.
 *
 * `incomplete` deliberately does not count: an unfinished row is not
 * broken, it simply is not a rule yet, and `compileHeaders` already drops it
 * on its own terms (an empty name fails `HEADER_TOKEN`).
 */
export function hasRowError(diagnostics: readonly Diagnostic[] | undefined): boolean {
  return diagnostics?.some((d) => d.severity === 'error') ?? false;
}
