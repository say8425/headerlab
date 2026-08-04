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
