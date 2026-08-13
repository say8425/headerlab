import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOST_NAME } from '../../packages/host/lib/manifest.mjs';

/**
 * The native host name exists twice and cannot exist once.
 *
 * `packages/host/lib/manifest.mjs` is Node, and the extension bundle must
 * never import it — the bundle guard forbids exactly that kind of reach, and a
 * Node import would drag `node:crypto` into a service worker. `lib/bridge/port.ts`
 * is TypeScript compiled into the extension. So the two spellings are
 * genuinely separate, and this is the only thing that can hold them together:
 * change one and the installer writes a manifest under a name the extension
 * never asks for, with Chrome reporting the same message it gives for three
 * other causes.
 *
 * A text read rather than an import, and that limit is stated rather than
 * hidden: it proves the literal appears in the adapter's source, not that the
 * adapter passes it to `connectNative`. The unit test in tests/unit/port.test.ts
 * asserts the call argument; this asserts the two files agree.
 */
describe('the native host name', () => {
  it('is spelled identically in the adapter and the installer', () => {
    const source = readFileSync('lib/bridge/port.ts', 'utf8');
    expect(source).toContain(`export const NATIVE_HOST_NAME = '${HOST_NAME}';`);
  });

  it('is what this test thinks it is — a renamed constant must not pass vacuously', () => {
    expect(HOST_NAME).toEqual('com.headerlab.bridge');
  });
});
