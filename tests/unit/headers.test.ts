import { describe, expect, it } from 'vitest';
import { compileHeaders } from '@/lib/compile/headers';
import type { HeaderRule } from '@/lib/model/types';

function rule(over: Partial<HeaderRule> = {}): HeaderRule {
  return {
    id: 'h1',
    enabled: true,
    target: 'request',
    operation: 'set',
    name: 'X-Debug-Mode',
    value: 'true',
    ...over,
  };
}

describe('compileHeaders', () => {
  it('compiles an enabled set rule', () => {
    expect(compileHeaders([rule()])).toEqual({
      requestHeaders: [{ header: 'X-Debug-Mode', operation: 'set', value: 'true' }],
    });
  });

  it('drops the value field entirely for remove', () => {
    const out = compileHeaders([rule({ operation: 'remove', name: 'If-None-Match', value: '' })]);
    expect(out.requestHeaders).toEqual([{ header: 'If-None-Match', operation: 'remove' }]);
    expect(out.requestHeaders![0]).not.toHaveProperty('value');
  });

  it('keeps an empty value for set — an empty header value is legal', () => {
    const out = compileHeaders([rule({ operation: 'set', value: '' })]);
    expect(out.requestHeaders).toEqual([
      { header: 'X-Debug-Mode', operation: 'set', value: '' },
    ]);
  });

  it('skips disabled rules', () => {
    expect(compileHeaders([rule({ enabled: false })])).toEqual({});
  });

  it('separates request and response targets', () => {
    const out = compileHeaders([
      rule({ id: 'a', target: 'request', name: 'Authorization', value: 'Bearer x' }),
      rule({ id: 'b', target: 'response', name: 'Cache-Control', value: 'no-store' }),
    ]);
    expect(out.requestHeaders).toEqual([
      { header: 'Authorization', operation: 'set', value: 'Bearer x' },
    ]);
    expect(out.responseHeaders).toEqual([
      { header: 'Cache-Control', operation: 'set', value: 'no-store' },
    ]);
  });

  it('omits an array entirely when that target has no enabled rules', () => {
    const out = compileHeaders([rule({ target: 'request' })]);
    expect(out).not.toHaveProperty('responseHeaders');
  });

  it('returns an empty object for an empty input', () => {
    expect(compileHeaders([])).toEqual({});
  });

  it('preserves author order within a target', () => {
    const out = compileHeaders([
      rule({ id: 'a', name: 'A' }),
      rule({ id: 'b', name: 'B' }),
      rule({ id: 'c', name: 'C' }),
    ]);
    expect(out.requestHeaders!.map((h) => h.header)).toEqual(['A', 'B', 'C']);
  });
});
