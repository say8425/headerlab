import assert from 'node:assert/strict';
import { endianness } from 'node:os';
import { test } from 'node:test';
import { MAX_INCOMING, decode, encode } from '../lib/framing.mjs';

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

// Well-framed but not valid JSON — the header's length is honest, the body
// inside it isn't. decode() must throw rather than let JSON.parse's
// SyntaxError escape unlabeled, since host.mjs's catch identifies the frame
// as the cause in its log line.
test('decode throws on a well-framed body that is not valid JSON', () => {
  const body = Buffer.from('{not json', 'utf8');
  const header = Buffer.alloc(4);
  if (endianness() === 'LE') header.writeUInt32LE(body.length, 0);
  else header.writeUInt32BE(body.length, 0);
  assert.throws(() => decode(Buffer.concat([header, body])), SyntaxError);
});

// A declared length under the cap, with the body not yet fully arrived, is
// the ordinary partial-read case and must not throw — only a length that
// already exceeds MAX_INCOMING is rejected, before any body bytes matter.
test('decode does not throw on a partial read merely because more is coming', () => {
  const frame = encode({ a: 1 });
  assert.doesNotThrow(() => decode(frame.subarray(0, frame.length - 1)));
});

// Guards against a corrupt or malicious 4-byte prefix making stdinBuffer in
// host.mjs grow without limit while it waits for bytes that will never
// arrive — decode() must reject the length itself, before it has (or could
// ever have) enough bytes to attempt a body read.
test('decode refuses a declared length over the incoming protocol cap', () => {
  const header = Buffer.alloc(4);
  const oversized = MAX_INCOMING + 1;
  if (endianness() === 'LE') header.writeUInt32LE(oversized, 0);
  else header.writeUInt32BE(oversized, 0);
  assert.throws(() => decode(header), new RegExp(String(MAX_INCOMING)));
});

// A declared length at exactly the cap is still an ordinary partial read
// while its body has not fully arrived — the cap rejects what is over the
// limit, not what is merely large.
test('decode accepts a declared length exactly at the incoming cap as a partial read', () => {
  const header = Buffer.alloc(4);
  if (endianness() === 'LE') header.writeUInt32LE(MAX_INCOMING, 0);
  else header.writeUInt32BE(MAX_INCOMING, 0);
  assert.doesNotThrow(() => decode(header));
});
