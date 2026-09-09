import { describe, expect, it } from 'vitest';
import { parseFrames } from '../support/marionette';

/**
 * Marionette frames are `<byte length>:<json>`. Bytes, not characters: the
 * popup's readout carries a middle dot (`·`, two bytes in UTF-8), and a parser
 * counting characters would read one byte too few and never resynchronise.
 */
describe('parseFrames', () => {
  const frame = (value: unknown) => {
    const body = JSON.stringify(value);
    return Buffer.from(`${Buffer.byteLength(body)}:${body}`);
  };

  it('splits complete frames and returns the unconsumed tail', () => {
    const buffer = Buffer.concat([
      frame({ a: 1 }),
      frame([1, 2, null, { ok: true }]),
      Buffer.from('12:{"partial"'),
    ]);
    const { messages, rest } = parseFrames(buffer);
    expect(messages).toEqual([{ a: 1 }, [1, 2, null, { ok: true }]]);
    expect(rest.toString()).toBe('12:{"partial"');
  });

  it('counts the length in bytes, so a multi-byte character does not desynchronise it', () => {
    const buffer = Buffer.concat([frame({ text: '1 of 2 live · 1 off' }), frame({ next: true })]);
    const { messages, rest } = parseFrames(buffer);
    expect(messages).toEqual([{ text: '1 of 2 live · 1 off' }, { next: true }]);
    expect(rest.length).toBe(0);
  });

  it('leaves a frame whose bytes have not all arrived', () => {
    const whole = frame({ big: 'x'.repeat(100) });
    const { messages, rest } = parseFrames(whole.subarray(0, 50));
    expect(messages).toEqual([]);
    expect(rest.length).toBe(50);
  });

  it('refuses a stream that does not start with a length', () => {
    expect(() => parseFrames(Buffer.from('nonsense:{}'))).toThrow(/malformed Marionette frame/);
  });
});
