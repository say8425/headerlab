import { describe, expect, it } from 'vitest';
import { isEnterKey } from '@/lib/view/keys';

/**
 * The predicate three keydown handlers share — `AddSiteField`'s add, and
 * `RuleCard`'s name and value commits.
 *
 * The defect it exists for: an IME commits the syllable being composed with the
 * same key that submits, so one press of Enter fires `keydown` twice — once
 * with `isComposing` true and once without. Every one of those three handlers
 * read `event.key` alone and ran twice, which added a host and cleared the
 * field out from under a half-typed Korean hostname.
 */

const press = (key: string, isComposing = false) => ({ key, nativeEvent: { isComposing } });

describe('isEnterKey', () => {
  it.each([
    // key,      composing, meaning
    ['Enter', false, true],
    // The one this guard is for: the IME's own commit press, which must not
    // reach the handler.
    ['Enter', true, false],
    ['Escape', false, false],
    // An Escape *during* composition is still not Enter. Listed because the
    // handlers branch on Escape right beside Enter, and a predicate that only
    // looked at `isComposing` would get this one wrong in the other direction.
    ['Escape', true, false],
    ['a', false, false],
    ['Tab', false, false],
    [' ', false, false],
  ])('%s (composing: %s) → %s', (key, isComposing, expected) => {
    expect(isEnterKey(press(key, isComposing))).toBe(expected);
  });

  it('reads the native event, not the synthetic one', () => {
    // The detail that makes this easy to write wrong: React's synthetic event
    // carries no `isComposing`, so a handler reaching for `event.isComposing`
    // gets `undefined`, `!undefined` is true, and the guard silently passes
    // every composition through — which is the bug with extra steps.
    //
    // Asserted by giving the object a *lying* top-level `isComposing`: a
    // predicate reading the wrong one returns the wrong answer here.
    const lying = { key: 'Enter', isComposing: false, nativeEvent: { isComposing: true } };
    expect(isEnterKey(lying)).toBe(false);
  });
});
