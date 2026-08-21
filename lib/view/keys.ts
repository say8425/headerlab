/**
 * Whether an Enter keydown is Enter *meaning* Enter.
 *
 * An IME — Korean, Japanese, Chinese — commits the syllable being composed with
 * the same key that submits a form, and the browser fires `keydown` for both:
 * once with `isComposing` true, to end the composition, and once more for the
 * press the user thinks of as Enter. A handler that only reads `event.key` runs
 * twice on one press. In `AddSiteField` that meant a host added and the field
 * cleared before the composition had finished; in `RuleCard` it committed a
 * half-composed header name.
 *
 * `isComposing` is on the **native** event, not on React's synthetic one, which
 * is the detail that makes this easy to write wrong. It is typed structurally
 * here rather than as a `React.KeyboardEvent` so this module keeps no
 * dependency at all — everything under lib/view is auto-discovered by the
 * purity guard, and a type-only React import would still be an import for a
 * future reader to check.
 *
 * (The path to that guard is named without backticks on purpose: the
 * build-freshness guard reads a quoted path containing a test directory as a
 * shipped file reaching into the suite, and cannot tell a docblock from code.)
 *
 * Not `keyCode === 229`: that is the legacy signal for the same thing, needed
 * for browsers this extension does not target, and it is absent on the second
 * keydown that `isComposing` also reports false for — so the two disagree on
 * exactly the press this guard exists to let through.
 */
export function isEnterKey(event: { key: string; nativeEvent: { isComposing: boolean } }): boolean {
  return event.key === 'Enter' && !event.nativeEvent.isComposing;
}
