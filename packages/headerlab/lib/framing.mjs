import { endianness } from 'node:os';

/**
 * Chrome's native messaging framing: a 32-bit length in NATIVE byte order,
 * then a UTF-8 JSON body.
 *
 * The branch on `endianness()` is the whole point and it is also untestable
 * here in the way that matters: every platform Chrome supports is
 * little-endian, so a hardcoded writeUInt32LE would pass every assertion this
 * file could make. What the tests can hold is that the length counts BYTES
 * rather than characters, which is the mistake that actually happens.
 */
const LE = endianness() === 'LE';

/** host → extension, per the protocol. Larger frames are dropped by Chrome. */
export const MAX_OUTGOING = 1024 * 1024;

/**
 * extension → host, per Chrome's own documented protocol cap:
 * "The maximum size of the message sent to the native messaging host is
 * 64 MiB." (https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging,
 * "Native messaging host protocol").
 *
 * Enforced in `decode()` below. Without a bound, a corrupt or malicious
 * 4-byte length prefix has nothing stopping `stdinBuffer` in `host.mjs` from
 * growing without limit while it waits for bytes that will never arrive —
 * this is that limit, checked the moment the header is read rather than
 * after the buffer has already grown to accommodate it.
 */
export const MAX_INCOMING = 64 * 1024 * 1024;

export function encode(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > MAX_OUTGOING) {
    throw new Error(
      `frame is ${body.length} bytes and the protocol caps host messages at 1 MB; ` +
        'Chrome drops a larger one without saying why',
    );
  }
  const header = Buffer.alloc(4);
  if (LE) header.writeUInt32LE(body.length, 0);
  else header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * Reads whole frames out of a buffer, returning what it could not yet parse.
 * Never throws on a partial read — a chunk boundary is not an error.
 *
 * Does throw on a declared length over `MAX_INCOMING` (a corrupt or
 * malicious prefix, checked before it can make this function buffer
 * indefinitely) and on a body that fails `JSON.parse` despite arriving at
 * the length the header promised. Both are the caller's problem: `host.mjs`
 * catches, logs, and drops the buffered bytes rather than dying — see its
 * own docblock for why an uncaught exception here must not reach it.
 */
export function decode(buffer) {
  const messages = [];
  let rest = buffer;
  for (;;) {
    if (rest.length < 4) return { messages, rest };
    const length = LE ? rest.readUInt32LE(0) : rest.readUInt32BE(0);
    if (length > MAX_INCOMING) {
      throw new Error(
        `frame declares ${length} bytes, over the ${MAX_INCOMING}-byte protocol cap for ` +
          'messages sent to a native messaging host',
      );
    }
    if (rest.length < 4 + length) return { messages, rest };
    messages.push(JSON.parse(rest.subarray(4, 4 + length).toString('utf8')));
    rest = rest.subarray(4 + length);
  }
}
