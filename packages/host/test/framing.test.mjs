import assert from 'node:assert/strict';
import { endianness } from 'node:os';
import { test } from 'node:test';
import { decode, encode } from '../lib/framing.mjs';

test('encode writes a four byte header then the utf-8 body', () => {
  const frame = encode({ hello: 'world' });
  const body = JSON.stringify({ hello: 'world' });
  assert.equal(frame.length, 4 + Buffer.byteLength(body, 'utf8'));
  assert.equal(frame.subarray(4).toString('utf8'), body);
});

test('the length header counts BYTES, not characters', () => {
  // A multi-byte body is the case a naive `body.length` gets wrong, and it
  // gets it wrong in the direction that truncates.
  const frame = encode({ 값: '한글' });
  const declared = endianness() === 'LE' ? frame.readUInt32LE(0) : frame.readUInt32BE(0);
  assert.equal(declared, frame.length - 4);
  assert.ok(declared > JSON.stringify({ 값: '한글' }).length);
});

test('decode returns nothing until the whole body has arrived', () => {
  const frame = encode({ a: 1 });
  const { messages, rest } = decode(frame.subarray(0, frame.length - 1));
  assert.deepEqual(messages, []);
  assert.equal(rest.length, frame.length - 1);
});

test('decode reads two frames out of one chunk', () => {
  const chunk = Buffer.concat([encode({ a: 1 }), encode({ b: 2 })]);
  const { messages, rest } = decode(chunk);
  assert.deepEqual(messages, [{ a: 1 }, { b: 2 }]);
  assert.equal(rest.length, 0);
});

test('a frame survives the round trip', () => {
  const value = { cmd: 'site.add', domains: ['a.example.com'] };
  const { messages } = decode(encode(value));
  assert.deepEqual(messages, [value]);
});

// The protocol caps host→extension at 1 MB. Chrome drops the connection on a
// larger frame with no diagnosis, so the host refuses first and says so.
test('encode refuses a body over the protocol cap', () => {
  assert.throws(() => encode({ big: 'x'.repeat(1024 * 1024) }), /1 MB/);
});
