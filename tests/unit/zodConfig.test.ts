import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { util } from 'zod/v4/core';
import { appStateSchema } from '@/lib/model/schema';
import { z } from '@/lib/model/zod';

/**
 * zod runs jitless, and the flag is set before any schema exists.
 *
 * zod reads `jitless` when a `z.object` is constructed, not when it parses, so
 * setting it after a schema module has loaded changes nothing for the schemas
 * that module already built — and nothing would say so. `lib/model/zod.ts`
 * explains why the flag is on at all: the eval probe it switches off is what
 * Firefox Add-ons' validator flagged, and an MV3 page refuses it anyway.
 */

describe('zod, as the extension configures it', () => {
  it('has jitless set', () => {
    expect(z.config().jitless).toBe(true);
  });

  /**
   * The behavioural half, and the one that can tell "set in time" from "set".
   * Node permits `new Function`, so without the flag zod's cached probe answers
   * true here. It answers false only if `jitless` was already set when the
   * first object schema was built — which importing `schema.ts` above has done.
   */
  it('never probes for eval, even where eval is allowed', () => {
    expect(appStateSchema).toBeDefined();
    expect(util.allowsEval.value).toBe(false);
  });

  /**
   * zod means the fast path and the jitless path to agree, and this file checks
   * only that the flag landed. The behavioural cover is everywhere else: the
   * schema and protocol suites build through the configured module, so since
   * this change they run jitless — unknown keys, defaults and nested errors
   * included — and a divergence would surface there.
   */
  it('still parses an object schema without the compiled fast path', () => {
    expect(z.object({ a: z.string() }).parse({ a: 'x' })).toEqual({ a: 'x' });
    expect(() => z.object({ a: z.string() }).parse({ a: 1 })).toThrow(/expected string/);
  });
});

/**
 * The ordering holds only while every shipped schema gets `z` from the one
 * module that configures it. A new file importing 'zod' directly could build an
 * object schema before that module loads — and then that file's schemas, and
 * the cached probe, would be decided without the flag, in silence.
 *
 * Statements, not text: a comment saying "not from 'zod'" is not an import, and
 * the first version of this pattern read one as if it were. Three forms count —
 * a static `import`/`export … from`, a dynamic `import('zod')` and
 * `require('zod')` — because any of them can build a schema before the
 * configured module loads; the first version knew only the static one.
 * `[^;]*?` keeps the static form inside one statement, multi-line braces
 * included.
 */
const IMPORTS_ZOD = new RegExp(
  [
    String.raw`^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]zod(?:\/[^'"]*)?['"]`,
    String.raw`\b(?:import|require)\s*\(\s*['"]zod(?:\/[^'"]*)?['"]\s*\)`,
  ].join('|'),
  'm',
);

describe('who imports zod', () => {
  it.each([
    "import { z } from 'zod';",
    'import {\n  z,\n} from "zod";',
    "export { z } from 'zod';",
    "import { util } from 'zod/v4/core';",
    "const { z } = await import('zod');",
    "const { z } = require('zod');",
  ])('counts %j as importing zod', (source) => {
    expect(IMPORTS_ZOD.test(source)).toBe(true);
  });

  it.each([
    "// The configured zod, not the package itself: not from 'zod'.",
    "import { z } from '@/lib/model/zod';",
    "import { zodiac } from 'zodiac';",
  ])('does not count %j', (source) => {
    expect(IMPORTS_ZOD.test(source)).toBe(false);
  });

  it('is lib/model/zod.ts alone, among the shipped sources', () => {
    const sources = ['lib', 'components', 'entrypoints'].flatMap((dir) =>
      (readdirSync(dir, { recursive: true }) as string[])
        .filter((file) => /\.(ts|tsx)$/.test(file))
        .map((file) => path.join(dir, file)),
    );
    expect(sources.length).toBeGreaterThan(20);
    const direct = sources.filter((file) => IMPORTS_ZOD.test(readFileSync(file, 'utf8')));
    expect(direct).toEqual(['lib/model/zod.ts']);
  });
});
