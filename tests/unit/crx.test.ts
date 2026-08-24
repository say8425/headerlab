import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { unpackedExtensionId } from '../../packages/headerlab/lib/manifest.mjs';
import {
  CRX_MAGIC,
  extensionIdFromDigest,
  extensionIdFromPublicKey,
  parseCrx,
  readCrxHeader,
} from '@/scripts/lib/crx.mjs';

/**
 * `scripts/pack-crx.mjs` reads the bytes Chrome wrote rather than trusting its
 * exit code, and this is the reader. Everything here is synthetic, and the
 * reason is Chrome rather than the key: a throwaway `openssl genpkey` pair
 * packs a real CRX3 perfectly well, so what a CI run would need is
 * `--pack-extension`, which the unit job has no browser for. An earlier version
 * of this paragraph said the signing key was what stood in the way, which is
 * true and not the constraint — worth correcting rather than repeating, because
 * it is the difference between "cannot be done" and "not done here".
 *
 * The distinction matters because of what a broken reader looks like. It does
 * not throw; it returns "no key found" or "no id", and the packer refuses a
 * package the store would have accepted. A reader that silently agrees with
 * everything is worse still — it passes a package the store rejects, at upload
 * time, after the release is tagged.
 */

/** One length-delimited protobuf field, so the fixtures below are real wire bytes. */
function field(number: number, payload: Buffer): Buffer {
  const key = number * 8 + 2;
  const varint: number[] = [];
  let rest = key;
  do {
    const byte = rest % 128;
    rest = Math.floor(rest / 128);
    varint.push(rest > 0 ? byte | 0x80 : byte);
  } while (rest > 0);
  const length: number[] = [];
  let size = payload.length;
  do {
    const byte = size % 128;
    size = Math.floor(size / 128);
    length.push(size > 0 ? byte | 0x80 : byte);
  } while (size > 0);
  return Buffer.concat([Buffer.from(varint), Buffer.from(length), payload]);
}

/** A CRX3 around a given header and payload. */
function crx(header: Buffer, payload: Buffer, { version = 3 } = {}): Buffer {
  const prefix = Buffer.alloc(12);
  prefix.write(CRX_MAGIC, 0, 'latin1');
  prefix.writeUInt32LE(version, 4);
  prefix.writeUInt32LE(header.length, 8);
  return Buffer.concat([prefix, header, payload]);
}

const KEY = Buffer.from('a public key, in DER, if you squint');
const ID_BYTES = createHash('sha256').update(KEY).digest().subarray(0, 16);

/** `sha256_with_rsa` is field 2, its `public_key` field 1; `signed_header_data` is 10000. */
const HEADER = Buffer.concat([field(2, field(1, KEY)), field(10000, field(1, ID_BYTES))]);

describe('parseCrx', () => {
  it('splits the header from the payload at the offsets the prefix declares', () => {
    const payload = Buffer.from('PK and the rest of a zip');
    const parsed = parseCrx(crx(HEADER, payload));

    expect(parsed.version).toBe(3);
    expect(parsed.headerLength).toBe(HEADER.length);
    expect(parsed.header.equals(HEADER)).toBe(true);
    expect(parsed.payload.equals(payload)).toBe(true);
  });

  it('refuses a file that does not start with the magic, naming what it saw', () => {
    const notCrx = Buffer.concat([Buffer.from('PK'), Buffer.alloc(40)]);
    expect(() => parseCrx(notCrx)).toThrow(/starts with "PK/);
  });

  // The byte at offset 4 is the only thing separating the two formats, and a
  // CRX2 header is a different shape — read as a CRX3 it produces nonsense
  // rather than an error, which is the failure this rejection exists to avoid.
  it('refuses CRX2 by version rather than mis-reading its header', () => {
    expect(() => parseCrx(crx(HEADER, Buffer.alloc(4), { version: 2 }))).toThrow(
      'CRX version 2, expected 3',
    );
  });

  it('refuses a file too short to hold the 12-byte prefix', () => {
    expect(() => parseCrx(Buffer.from('Cr24'))).toThrow('4 bytes, the header alone needs 12');
  });

  it('refuses a header longer than the bytes that follow it', () => {
    const truncated = crx(HEADER, Buffer.alloc(0)).subarray(0, 12 + HEADER.length - 5);
    expect(() => parseCrx(truncated)).toThrow(/claims \d+ bytes but only \d+ follow/);
  });
});

describe('readCrxHeader', () => {
  it('returns the declared public key and the signed crx id', () => {
    const { rsaPublicKeys, crxId } = readCrxHeader(HEADER);

    expect(rsaPublicKeys).toHaveLength(1);
    expect(rsaPublicKeys[0]?.equals(KEY)).toBe(true);
    expect(crxId?.equals(ID_BYTES)).toBe(true);
  });

  // Every other fixture here carries one proof, and with only those a reader
  // that returned just the first would stay green — measured by making exactly
  // that change and watching all of them pass. `pack-crx.mjs` asks whether the
  // signing key is among the declared ones, so a reader that stops at the first
  // would refuse a package the store accepts, and refuse it while saying the
  // key is absent.
  it('collects every proof in the header, not the first', () => {
    const second = Buffer.from('a second key, from a second proof');
    const twoProofs = Buffer.concat([field(2, field(1, KEY)), field(2, field(1, second))]);

    const { rsaPublicKeys } = readCrxHeader(twoProofs);

    expect(rsaPublicKeys).toHaveLength(2);
    expect(rsaPublicKeys.map((key) => key.toString())).toEqual([KEY.toString(), second.toString()]);
  });

  // Absence before presence: a header with no `signed_header_data` must report
  // `null` rather than an id from somewhere else, because the packer's equality
  // check would otherwise compare against whatever it found.
  it('reports no crx id when the header signs over nothing', () => {
    const { rsaPublicKeys, crxId } = readCrxHeader(field(2, field(1, KEY)));

    expect(crxId).toBe(null);
    expect(rsaPublicKeys).toHaveLength(1);
  });

  it('finds nothing in a header that declares nothing', () => {
    expect(readCrxHeader(Buffer.alloc(0))).toEqual({ rsaPublicKeys: [], crxId: null });
  });

  // This reads a format it does not own. A future Chrome adding a scalar field
  // must not turn into a parse error, so the three non-length-delimited wire
  // types are skipped — and skipping them by the wrong width would swallow the
  // fields that follow, which is what this pins.
  it('skips varint, fixed32 and fixed64 fields and still reads what follows', () => {
    const varintField = Buffer.from([3 * 8 + 0, 0x96, 0x01]); // field 3, value 150
    const fixed32Field = Buffer.concat([Buffer.from([4 * 8 + 5]), Buffer.alloc(4, 0xab)]);
    const fixed64Field = Buffer.concat([Buffer.from([5 * 8 + 1]), Buffer.alloc(8, 0xcd)]);
    const padded = Buffer.concat([varintField, HEADER, fixed32Field, fixed64Field]);

    const { rsaPublicKeys, crxId } = readCrxHeader(padded);

    expect(rsaPublicKeys).toHaveLength(1);
    expect(rsaPublicKeys[0]?.equals(KEY)).toBe(true);
    expect(crxId?.equals(ID_BYTES)).toBe(true);
  });

  // A skip that steps past the end is the one truncation that used to be
  // silent: the loop condition simply goes false and every field after it
  // disappears with no error, so the caller reports "no key declared" and sends
  // the reader to look at the signing key. Both widths, because a bound written
  // for one of them is a bound the other does not have.
  it.each([
    ['fixed32', Buffer.from([4 * 8 + 5, 0x01, 0x02]), 'fixed32'],
    ['fixed64', Buffer.from([5 * 8 + 1, 0x01, 0x02, 0x03]), 'fixed64'],
  ])(
    'refuses a %s field that runs past the end rather than losing what follows',
    (_n, bytes, w) => {
      expect(() => readCrxHeader(Buffer.concat([bytes]))).toThrow(
        `protobuf ${w} field runs past the end of the header`,
      );
    },
  );

  it('refuses a field whose length runs past the end of the header', () => {
    const overlong = Buffer.from([2 * 8 + 2, 0x40, 0x01, 0x02]); // claims 64 bytes, carries 2
    expect(() => readCrxHeader(overlong)).toThrow('runs past the end of the header');
  });

  it('refuses a varint that never terminates', () => {
    expect(() => readCrxHeader(Buffer.alloc(6, 0xff))).toThrow(/varint/);
  });

  // Nothing in a CRX header comes near 2^53, which is the reason to say so in
  // an error rather than to let a Number quietly stop counting exactly: a length
  // off by one reads the wrong bytes and reports nothing.
  it('refuses a varint too large to count exactly', () => {
    const huge = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]);
    expect(() => readCrxHeader(huge)).toThrow('larger than this reads exactly');
  });
});

describe('extensionIdFromDigest', () => {
  // Hand-derivable and independent of the implementation: hex 0 is the first
  // letter of the alphabet Chrome uses and hex f is the sixteenth.
  it('maps hex 0 to a and hex f to p', () => {
    expect(extensionIdFromDigest(Buffer.alloc(32, 0x00))).toBe('a'.repeat(32));
    expect(extensionIdFromDigest(Buffer.alloc(32, 0xff))).toBe('p'.repeat(32));
  });

  // Two vectors computed outside this module, from the well-known SHA-256 of
  // the empty string and of the word `headerlab`. A mapping that is off by one
  // letter passes the two uniform vectors above and fails these.
  it.each([
    ['', 'odlameecjipmbmbejkplpemijjgpljce'],
    ['headerlab', 'ckcpgbjljgalnnlhfnngbklphombocka'],
  ])('encodes sha256(%o) as %s', (input, expected) => {
    expect(extensionIdFromDigest(createHash('sha256').update(input).digest())).toBe(expected);
  });

  // `packages/headerlab/lib/manifest.mjs` applies this same alphabet to a load
  // path's bytes for an *unpacked* extension. The two cannot share code — that
  // file ships in a separately versioned npm package and `scripts/` is not in
  // its tarball — so this asserts they agree instead. One of them changing the
  // alphabet turns this red without either importing the other.
  it('agrees with the unpacked-extension id encoder on the same 32 hex digits', () => {
    const path = '/Users/penguin/dev/headerlab/.output/chrome-mv3';
    expect(extensionIdFromDigest(createHash('sha256').update(path).digest())).toBe(
      unpackedExtensionId(path),
    );
  });

  it('reads only the first 16 bytes, whatever the digest carries after them', () => {
    const digest = Buffer.concat([Buffer.alloc(16, 0x00), Buffer.alloc(16, 0xff)]);
    expect(extensionIdFromDigest(digest)).toBe('a'.repeat(32));
  });
});

describe('extensionIdFromPublicKey', () => {
  it('is 32 letters of the a-p alphabet', () => {
    expect(extensionIdFromPublicKey(KEY)).toMatch(/^[a-p]{32}$/);
  });

  it('hashes the key it is given rather than any part of it', () => {
    expect(extensionIdFromPublicKey(KEY)).toBe(
      extensionIdFromDigest(createHash('sha256').update(KEY).digest()),
    );
    expect(extensionIdFromPublicKey(KEY)).not.toBe(
      extensionIdFromPublicKey(Buffer.concat([KEY, Buffer.from('!')])),
    );
  });
});
