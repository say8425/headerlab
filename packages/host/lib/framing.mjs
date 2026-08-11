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
 */
export function decode(buffer) {
  const messages = [];
  let rest = buffer;
  for (;;) {
    if (rest.length < 4) return { messages, rest };
    const length = LE ? rest.readUInt32LE(0) : rest.readUInt32BE(0);
    if (rest.length < 4 + length) return { messages, rest };
    messages.push(JSON.parse(rest.subarray(4, 4 + length).toString('utf8')));
    rest = rest.subarray(4 + length);
  }
}
