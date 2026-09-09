import { describe, expect, it } from 'vitest';
import { TARGET } from '@/lib/target';

describe('the build target under vitest', () => {
  it('is chrome — WXT defines import.meta.env.BROWSER per build, and the fallback is chrome', () => {
    // Every unit test that passes a target passes it explicitly; this one
    // only pins what the adapters see when nothing was built for Firefox.
    expect(TARGET).toBe('chrome');
  });
});
