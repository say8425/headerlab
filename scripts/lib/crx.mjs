/**
 * Reading a CRX3 package: the header format, and the extension id a public key
 * produces.
 *
 * This exists because `scripts/pack-crx.mjs` must not merely *run* Chrome's
 * packer and believe it. The store's verified-upload check rejects a package
 * signed with the wrong key, and it rejects it at upload time — after a release
 * is already tagged. Checking the bytes here moves that failure to the machine
 * that made them.
 *
 * Pure: bytes in, values out, no filesystem and no process. `crx.d.mts` sits
 * beside it so `tests/unit/crx.test.ts` can import it — `allowJs` is off and a
 * bare `.mjs` import is TS7016 without one. Same reason `scripts/lib/png.d.mts`
 * and `packages/headerlab/lib/socket.d.mts` exist.
 */
import { createHash } from 'node:crypto';

/** The four bytes every CRX starts with — `crx_file.cc`'s `kCrxFileHeaderMagic`. */
export const CRX_MAGIC = 'Cr24';

/**
 * The only version this reads. CRX2 was removed from Chrome in 2019 and its
 * header is a different shape entirely, so a CRX2 must fail loudly here rather
 * than be parsed as a malformed CRX3 — the byte at offset 4 is the only thing
 * that tells them apart.
 */
export const CRX_VERSION = 3;

/**
 * Splits a CRX3 into its header and its ZIP payload.
 *
 * ```
 * [4]  "Cr24"
 * [4]  version, uint32 LE
 * [4]  header length, uint32 LE
 * [n]  CrxFileHeader protobuf
 * [..] the ZIP
 * ```
 *
 * Every failure names what it saw. A truncated file read as "no signature"
 * would send the reader looking at the key.
 */
export function parseCrx(buffer) {
  if (buffer.length < 12) {
    throw new Error(`not a CRX: ${buffer.length} bytes, the header alone needs 12`);
  }
  const magic = buffer.subarray(0, 4).toString('latin1');
  if (magic !== CRX_MAGIC) {
    throw new Error(`not a CRX: starts with ${JSON.stringify(magic)}, expected "${CRX_MAGIC}"`);
  }
  const version = buffer.readUInt32LE(4);
  if (version !== CRX_VERSION) {
    throw new Error(`CRX version ${version}, expected ${CRX_VERSION}`);
  }
  const headerLength = buffer.readUInt32LE(8);
  const payloadOffset = 12 + headerLength;
  if (payloadOffset > buffer.length) {
    throw new Error(
      `CRX header claims ${headerLength} bytes but only ${buffer.length - 12} follow the prefix`,
    );
  }
  return {
    version,
    headerLength,
    header: buffer.subarray(12, payloadOffset),
    payload: buffer.subarray(payloadOffset),
  };
}

/**
 * One varint off the wire, and where it ended.
 *
 * Bounded at ten bytes: that is the longest a 64-bit varint can be, and without
 * the bound a run of continuation bits walks off the end of the buffer and
 * throws about buffer bounds rather than about the file.
 */
function readVarint(buffer, at) {
  let value = 0;
  let shift = 0;
  let offset = at;
  for (let i = 0; i < 10; i++) {
    if (offset >= buffer.length) throw new Error('protobuf varint runs past the end of the header');
    const byte = buffer[offset++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7;
  }
  throw new Error('protobuf varint longer than ten bytes');
}

/**
 * Every length-delimited field in one protobuf message, by field number.
 *
 * Only wire type 2 is collected — the three CRX header fields this file cares
 * about are all `bytes`. The other wire types are skipped rather than rejected,
 * because a future Chrome adding a scalar field must not turn into a parse
 * error here: this reads a format it does not own.
 */
function lengthDelimitedFields(message) {
  const fields = new Map();
  let offset = 0;
  while (offset < message.length) {
    const key = readVarint(message, offset);
    offset = key.offset;
    const fieldNumber = Math.floor(key.value / 8);
    const wireType = key.value % 8;
    if (wireType === 2) {
      const size = readVarint(message, offset);
      const start = size.offset;
      const end = start + size.value;
      if (end > message.length) throw new Error('protobuf field runs past the end of the header');
      if (!fields.has(fieldNumber)) fields.set(fieldNumber, []);
      fields.get(fieldNumber).push(message.subarray(start, end));
      offset = end;
    } else if (wireType === 0) {
      offset = readVarint(message, offset).offset;
    } else if (wireType === 5) {
      offset += 4;
    } else if (wireType === 1) {
      offset += 8;
    } else {
      throw new Error(`protobuf wire type ${wireType} is not one this reads`);
    }
  }
  return fields;
}

/**
 * The public keys a CRX3 header declares, and the crx id it signs over.
 *
 * From `crx3.proto`: `CrxFileHeader.sha256_with_rsa` is field 2, each an
 * `AsymmetricKeyProof` whose field 1 is the DER `SubjectPublicKeyInfo`;
 * `signed_header_data` is field 10000, a serialized `SignedData` whose field 1
 * is the 16-byte crx id.
 *
 * Both are returned rather than one. The key proves *which* key signed, and the
 * id proves the signature was computed over that same key — a header naming one
 * key while declaring another's id is exactly the mismatch the store rejects,
 * and it is invisible if only one of the two is read.
 */
export function readCrxHeader(header) {
  const fields = lengthDelimitedFields(header);
  const publicKeys = (fields.get(2) ?? []).flatMap(
    (proof) => lengthDelimitedFields(proof).get(1) ?? [],
  );
  const [signedData] = fields.get(10000) ?? [];
  const [crxId] = signedData ? (lengthDelimitedFields(signedData).get(1) ?? []) : [];
  return { publicKeys, crxId: crxId ?? null };
}

/**
 * The id Chrome gives a *packed* extension: the first 16 bytes of the SHA-256 of
 * the DER `SubjectPublicKeyInfo`, each hex digit mapped 0-f → a-p.
 *
 * The same mapping `packages/headerlab/lib/manifest.mjs` applies to a load
 * path's bytes for an unpacked extension. Different input, one alphabet — Chrome
 * derives both in `id_util.cc`.
 *
 * **This is not the id the Chrome Web Store publishes under.** A verified upload
 * is repackaged with the store's own key before publication, so the listing keeps
 * the id it already had. This is the id the CRX carries on the way there, and it
 * is what makes the header check above an equality rather than a search.
 */
export function extensionIdFromPublicKey(der) {
  return extensionIdFromDigest(createHash('sha256').update(der).digest());
}

/** The a-p encoding on its own, for a digest that has already been taken. */
export function extensionIdFromDigest(digest) {
  return Array.from(digest.subarray(0, 16).toString('hex'))
    .map((hex) => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(hex, 16)))
    .join('');
}
