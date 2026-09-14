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
 */
describe('who imports zod', () => {
  const SHIPPED = ['lib', 'components', 'entrypoints'];
  const sources = SHIPPED.flatMap((dir) =>
    (readdirSync(dir, { recursive: true }) as string[])
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .map((file) => path.join(dir, file)),
  );

  it('is lib/model/zod.ts alone, among the shipped sources', () => {
    expect(sources.length).toBeGreaterThan(20);
    // Statements, not text: a comment saying "not from 'zod'" is not an import,
    // and the first version of this pattern read one as if it were. `[^;]*?`
    // keeps a match inside one statement, multi-line braces included.
    const IMPORTS_ZOD = /^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]zod(?:\/[^'"]*)?['"]/m;
    const direct = sources.filter((file) => IMPORTS_ZOD.test(readFileSync(file, 'utf8')));
    expect(direct).toEqual(['lib/model/zod.ts']);
  });
});
