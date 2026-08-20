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
        // Direct, owner's wording (2026-08-18): the fact, bare. This message
        // never renders on the row anyway — an unfinished row stays quiet and
        // the rail's "N unfinished" carries the state — so "so nothing is
        // sent" was narration with no audience.
        message: 'No name.',
      });
      continue;
    }

    if (!HEADER_TOKEN.test(name)) {
      diagnostics.push({
        kind: 'invalid-header-name',
        severity: 'error',
        profileId: profile.id,
        headerRuleId: rule.id,
        // The character set the user can actually act on is what has to
        // survive the truncation of a rule row's value line; the fact of
        // the failure is what can afford to be cut. "Invalid", not "Not a
        // valid" — the same fact in the voice a validation error uses.
        message: 'Invalid header name — no spaces or colons.',
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
        message: 'Use Set. Chrome does not append request headers.',
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
        // "Already declared", owner's wording (2026-08-18): a validation
        // error should read like one — the fact first, in the voice every
        // form the reader has ever filled in uses. This replaces "Rename or
        // delete. An earlier row uses this header.", which led with the
        // remedy on the truncation argument (Task 13); the owner chose the
        // direct statement over that convention, and the remedy a reader
        // needs here is the obvious one — the row is a duplicate, and the
        // row itself is what they are looking at.
        //
        // "declared", never "set": the earlier wording debate ("uses", not
        // "sets") survives in adapted form. `seen` stores only the
        // `target name` key, never which operation the earlier row used, so
        // the earlier row could be `append` or `remove` just as easily as
        // `set`; "declared" makes no claim about an operation, the same way
        // "uses" did not. `detectConflicts` faces the identical shape of
        // fact and names it `firstToucher` (`lib/compile/conflicts.ts`) —
        // that function *can* say which operation, since it holds the
        // earlier rule and composes `already ${operation}s`, a message this
        // one has no way to write.
        message: 'Already declared.',
      });
    }
    seen.add(key);
  }

  return diagnostics;
}

/**
 * The first error-severity diagnostic on a row, if it has one.
 *
 * One predicate, one definition — `suppression.ts`'s own rule, restated for
 * the row half of it. Three callers used to each decide "does this row
 * count as broken" independently (or, for `compile.ts` before its own fix,
 * not decide it at all): `compile.ts` must not hand a diagnosed row to
 * `compileHeaders` — `updateDynamicRules` is transactional, so one bad row
 * rejects the whole batch and leaves whatever was registered before still
 * in force, silently, while the screen shows the new state. The rail's
 * readout (`lib/view/rules.ts`) must not count a row like that as live
 * either. `RuleCard` must show the row's error message on line 2 rather
 * than a value that is not in effect. All three now ask this — `RuleCard`
 * for the diagnostic object, the other two via `hasRowError` below for the
 * boolean — rather than re-testing `severity === 'error'` themselves.
 * Re-testing it was a review finding, not a hypothetical: `RuleCard` did
 * exactly that until this function grew a form it could call instead, and
 * the two would have silently diverged the day a fourth severity arrived
 * and only one of them was taught about it.
 *
 * Two of the three `error` kinds this file emits are the real batch-rejection
 * risk: an append Chrome will refuse (`append-not-allowed`), and a duplicate
 * (`duplicate-header`) — both pass `HEADER_TOKEN` and were, before
 * `hasRowError` existed, sent to `compileHeaders` unfiltered. The third,
 * `invalid-header-name`, was never actually one of them: `compileHeaders`
 * already runs its own `HEADER_TOKEN.test` and skips a name that fails it,
 * independently of anything here, so that row never reached Chrome even
 * before this filter existed. Excluding it here too is belt-and-braces, not
 * the fix for a reach-Chrome bug the other two are.
 *
 * `incomplete` deliberately does not count: an unfinished row is not
 * broken, it simply is not a rule yet, and `compileHeaders` already drops it
 * on its own terms (an empty name fails `HEADER_TOKEN`).
 *
 * `.find`, not `.filter`: at most one is ever shown anywhere, so the first
 * is the one every caller needs.
 */
export function rowError(diagnostics: readonly Diagnostic[] | undefined): Diagnostic | undefined {
  return diagnostics?.find((d) => d.severity === 'error');
}

/** `rowError(diagnostics) !== undefined` — see `rowError`'s own docblock. */
export function hasRowError(diagnostics: readonly Diagnostic[] | undefined): boolean {
  return rowError(diagnostics) !== undefined;
}

/**
 * The key a row-level diagnostic map is grouped under: a diagnostic belongs
 * to a row *of a profile*, never to a row id on its own.
 *
 * `headerRuleId` alone was the key both `compile.ts` and `lib/view/rules.ts`
 * used until a re-review demonstrated what that costs. With two profiles
 * whose rows happen to share an id, profile B's broken row lands in the same
 * bucket as profile A's healthy one, and `hasRowError` reading that bucket
 * then drops A's header from `compileHeaders` too — measured: `dynamic: []`,
 * A's header silently stops being sent, while the only diagnostic on screen
 * carries B's `profileId` and so says nothing about A at all. Headers that
 * stop being modified without the screen saying so is the first thing this
 * project's rules forbid.
 *
 * Not reachable today: ids come from `crypto.randomUUID()`, and the popup
 * truncates storage to a single profile before this ever gets two to
 * compare. It becomes reachable the day anything else writes state —
 * `schema.ts` requires only `id: z.string().min(1)`, enforces no uniqueness
 * across profiles, and its own docblock says it guards "every trust
 * boundary, including JSON import." Import is exactly the feature CLAUDE.md
 * names as the one that makes a dormant surface reachable, so this is closed
 * now rather than left as a trap for the commit that adds it.
 *
 * Lives here, not in `lib/view/rules.ts`, even though the UI-routing half of
 * this fix is also there: `lib/view/rules.ts` already imports `hasRowError`
 * from this file, and the reverse import would run the compile layer through
 * the view layer for one string. One predicate, one definition, and one
 * direction for the dependency.
 *
 * The joiner is a space, which is why it looks like nothing between the two
 * halves. It is still load-bearing: `schema.ts` constrains an id to `min(1)`
 * and nothing else, so an id containing the joiner itself could make two
 * different `{profileId, headerRuleId}` pairs collide on the same key — for
 * instance `{a, "b c"}` and `{"a b", c}` both key as `"a b c"`. A space is a
 * practical choice, not a proven-safe one: it does not occur in
 * `crypto.randomUUID()`'s output, which is every id this product generates
 * today, but nothing stops a future id (imported, hand-typed) from
 * containing one.
 */
export const rowKey = (profileId: string, headerRuleId: string): string =>
  `${profileId} ${headerRuleId}`;
