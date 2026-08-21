/**
 * A PNG's dimensions, read out of its own bytes.
 *
 * Two callers, which is why it is here rather than inside either of them:
 * `scripts/store-assets.mjs` checks every image it writes before letting the run
 * finish, and `tests/unit/storeAssets.test.ts` checks every image that was
 * committed. A second copy of the decode would let those two disagree about what
 * counts as a valid 1280x800 file, which is the divergence CLAUDE.md names as
 * this repository's most expensive defect.
 *
 * Consumed from TypeScript, so `png.d.mts` sits beside it — `allowJs` is off and
 * a bare `.mjs` import is TS7016 without one. Same reason
 * `packages/headerlab/lib/socket.d.mts` exists.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The eight bytes every PNG starts with, per the spec's §5.2. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Width and height are big-endian uint32 at byte 16 and byte 20 — the first two
 * fields of the IHDR chunk, which the spec requires to come first.
 *
 * The signature is checked rather than assumed, because the failures without
 * that check are loud in the wrong way. Probed, all four: an empty or truncated
 * file throws a `RangeError` about buffer bounds that names no file, and a JPEG
 * parses happily into 65536x4292542531 — a caller comparing sizes rejects that,
 * but as a size mismatch rather than as the "this is not a PNG" it actually is.
 */
export function pngSize(file) {
  const header = readFileSync(file).subarray(0, 24);
  if (header.length < 24 || !header.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error(
      `${path.basename(file)} is not a PNG — ${header.length} bytes, and the first eight are ` +
        'not the PNG signature.',
    );
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}
