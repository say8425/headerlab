import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * `@testing-library/react`'s own auto-cleanup only fires when it finds a
 * global `afterEach` — which requires `test.globals: true`. This project
 * keeps globals off and imports `describe`/`it`/`expect` explicitly instead,
 * so component tests get an empty document between cases only if something
 * wires it up. Without this, a second `render()` in the same file leaves the
 * first render's DOM behind and every `getByTestId`/`getByRole` query that
 * used to find one element starts finding two.
 */
afterEach(() => {
  cleanup();
});

/**
 * jsdom implements no `ResizeObserver`, and Radix's popper layer (the tooltip's
 * positioning) constructs one as soon as content mounts — so opening a tooltip
 * in a jsdom test throws `ResizeObserver is not defined` before any assertion
 * runs. A stub that observes nothing is the right shape here rather than a
 * polyfill: jsdom performs no layout, so there is no resize to report and
 * nothing downstream of a callback that would never fire anyway. Positioning is
 * not what these tests are about; what they check is which element is in the
 * document and what it says.
 */
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
