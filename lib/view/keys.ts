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
 * Not `keyCode === 229`: that is the legacy signal for the same thing, for
 * browsers this extension does not target. On the press this guard exists to
 * let through the two agree — both say "not composing" — so 229 buys nothing
 * here and costs a second thing to keep true. (An earlier version of this
 * paragraph said they *disagreed* on that press while describing them agreeing;
 * it was wrong in the sentence that argued for the choice.)
 */
export type ComposableKeyEvent = { key: string; nativeEvent: { isComposing: boolean } };

/** The half both predicates share: the keydown that ends a composition is not a press. */
const meansIt = (event: ComposableKeyEvent, key: string): boolean =>
  event.key === key && !event.nativeEvent.isComposing;

export function isEnterKey(event: ComposableKeyEvent): boolean {
  return meansIt(event, 'Enter');
}

/**
 * Whether an Escape keydown is Escape *meaning* Escape.
 *
 * The same defect as Enter's, on the key sitting beside it in all three
 * handlers. An IME cancels the composition with Escape, and that keydown
 * carries `isComposing` too — so a composing Escape used to clear the whole
 * draft rather than just the syllable being composed. Discarding what somebody
 * typed is the more expensive half of the two.
 */
export function isEscapeKey(event: ComposableKeyEvent): boolean {
  return meansIt(event, 'Escape');
}
