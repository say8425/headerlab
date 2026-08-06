import { HEADER_TOKEN } from '@/lib/compile/headers';
import type {
  Diagnostic,
  HeaderTarget,
  Profile,
} from '@/lib/model/types';

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
        message:
          `"${name}" is not a valid header name. Use letters, digits, and ! # $ % & ' * + - . ^ _ \` | ~ only — no spaces or colons.`,
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
        message:
          `Chrome does not allow appending to the request header "${name}". ` +
          'Use Set instead, or switch this row to a response header.',
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
        // Deliberately does not say *which* of the two wins. Both are emitted
        // into one action's header list and Chrome's resolution between them
        // is not something this project has measured; naming a winner would be
        // a claim the code cannot back.
        message: `"${name}" is set more than once — only one of them can take effect.`,
      });
    }
    seen.add(key);
  }

  return diagnostics;
}
