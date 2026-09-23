/** NOBJ 0.2 ATOM flat-image compatibility reader and NOBJ 1.0 adapter. */

import { decodeNobjEnvelope } from './nobj-framing.js';
import {
  materializeTargetImage,
  type MaterializedTargetImage,
  type TargetImageOperation,
} from './target-image.js';
import { NobjLegacyError } from './nobj-legacy-common.js';
import { encodeNobj1, type Nobj1ObjectDraft } from './nobj-v1-codec.js';
import { materializeNobj1Object } from './nobj-v1-image.js';
import { parseNobj1, type Nobj1Object } from './nobj-v1.js';

export interface AtomNobj02Operation extends TargetImageOperation {
  readonly bank: number;
  readonly address: number;
  readonly bytes: Uint8Array;
}

export interface AtomNobj02Object {
  readonly serialized: Uint8Array;
  readonly recordCount: number;
  readonly images: readonly AtomNobj02Operation[];
  readonly patches: readonly AtomNobj02Operation[];
  readonly imageBase: number;
  readonly imageCapacity: number;
  readonly imageFill: number;
  readonly usedLength: number;
  readonly finalCursor: number;
  readonly entryAddress: number;
  readonly sourcePartCount: number;
  readonly crc16: number;
  readonly targetImage: MaterializedTargetImage;
}

export interface AtomNobj02Conversion {
  /** The selected legacy entry is retained for callers; it does not imply executable code. */
  readonly selectedEntryAddress: number;
  readonly legacy: AtomNobj02Object;
  readonly object: Nobj1Object;
  readonly materialized: ReturnType<typeof materializeNobj1Object>;
}

const fail = (message: string): never => {
  throw new NobjLegacyError(message);
};

const byteAt = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] ?? fail('ATOM NOBJ 0.2 field is truncated');

const readU16 = (bytes: Uint8Array, offset: number): number =>
  byteAt(bytes, offset) | (byteAt(bytes, offset + 1) << 8);

const readU32 = (bytes: Uint8Array, offset: number): number =>
  byteAt(bytes, offset) +
  byteAt(bytes, offset + 1) * 0x100 +
  byteAt(bytes, offset + 2) * 0x1_0000 +
  byteAt(bytes, offset + 3) * 0x100_0000;

const u16 = (value: number): number[] => [value & 0xff, value >>> 8];

const u32 = (value: number): number[] => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
];

const copyOperations = (
  records: readonly { readonly payload: Uint8Array }[],
): AtomNobj02Operation[] =>
  records.map(({ payload }) => {
    if (payload.length < 4) {
      fail('ATOM NOBJ 0.2 IMAGE/PATCH record has no data bytes');
    }
    return Object.freeze({
      bank: payload[0] ?? 0,
      address: readU16(payload, 1),
      bytes: payload.slice(3),
    });
  });

/** Validate one complete ATOM flat-profile NOBJ 0.2 stream. */
export const parseAtomNobj02 = (input: Uint8Array): AtomNobj02Object => {
  if (!(input instanceof Uint8Array)) fail('ATOM NOBJ input must be bytes');
  const serialized = input.slice();
  const envelope = (() => {
    try {
      return decodeNobjEnvelope(serialized, {
        majorVersion: 0,
        minorVersion: 2,
        requireImage: false,
      });
    } catch (cause) {
      return fail(cause instanceof Error ? cause.message : String(cause));
    }
  })();
  const begin = envelope.begin.payload;
  if (
    begin.length !== 15 ||
    String.fromCharCode(...begin.slice(0, 4)) !== 'NOBJ'
  ) {
    fail('NOBJ is not the ATOM flat-image profile 0.2');
  }
  if (begin[6] !== 0 || readU16(begin, 7) !== 0 || begin[9] !== 1) {
    fail('ATOM NOBJ BEGIN is not the flat bank-zero profile');
  }
  const imageFill = byteAt(begin, 10);
  const imageBase = readU16(begin, 11);
  const imageCapacity = readU16(begin, 13);
  if (imageCapacity === 0 || imageBase + imageCapacity > 0x1_0000) {
    fail('ATOM NOBJ image region is invalid');
  }

  const images = copyOperations(envelope.images);
  const patches = copyOperations(envelope.patches);
  const map = envelope.map.payload;
  if (map.length < 10 || map[0] !== 0x41) {
    fail('ATOM NOBJ lacks flat MAP revision 0x41');
  }
  const sourcePartCount = byteAt(map, 9);
  if (
    map.length !== 10 + sourcePartCount ||
    map[1] !== 0 ||
    map[2] !== 0 ||
    sourcePartCount === 0 ||
    map.slice(10).some((bank) => bank !== 0)
  ) {
    fail('ATOM NOBJ flat MAP is invalid');
  }
  const entryAddress = readU16(map, 3);
  const usedLength = readU16(map, 5);
  const cursorWord = readU16(map, 7);
  const finalCursor =
    cursorWord === 0 && imageBase + imageCapacity === 0x1_0000
      ? 0x1_0000
      : cursorWord;
  if (
    usedLength > imageCapacity ||
    finalCursor < imageBase ||
    finalCursor > imageBase + imageCapacity
  ) {
    fail('ATOM NOBJ output extent or final cursor is invalid');
  }
  if (
    envelope.commit.entryBank !== 0 ||
    envelope.commit.entryAddress !== entryAddress
  ) {
    fail('ATOM NOBJ COMMIT entry differs from MAP');
  }

  const targetImage = (() => {
    try {
      return materializeTargetImage({
        geometry: {
          bankCount: 1,
          imageBase,
          imageCapacity,
          imageFill,
          entryBank: 0,
          entryAddress,
        },
        banks: [{ usedLength }],
        images,
        patches,
        patchPolicy: 'image',
      });
    } catch (cause) {
      return fail(
        cause instanceof Error ? cause.message : 'ATOM NOBJ image is invalid',
      );
    }
  })();

  return Object.freeze({
    serialized,
    recordCount: envelope.records.length,
    images: Object.freeze(images),
    patches: Object.freeze(patches),
    imageBase,
    imageCapacity,
    imageFill,
    usedLength,
    finalCursor,
    entryAddress,
    sourcePartCount,
    crc16: envelope.commit.crc16,
    targetImage,
  });
};

/** Convert a validated ATOM 0.2 image to a placed NOBJ 1.0 object. */
export const convertAtomNobj02 = (input: Uint8Array): AtomNobj02Conversion => {
  const legacy = parseAtomNobj02(input);
  const sectionId = legacy.usedLength === 0 ? undefined : 1;
  const draft: Nobj1ObjectDraft = {
    begin: { targetId: 1 },
    contracts: [],
    regions: [
      {
        id: 1,
        addressSpaceKey: 'z80.cpu',
        storageKey: 'atom.flat',
        base: legacy.imageBase,
        capacity: legacy.imageCapacity,
        imageFill: legacy.imageFill,
        permissions: 7,
        banked: false,
      },
    ],
    sections:
      sectionId === undefined
        ? []
        : [
            {
              id: sectionId,
              storageKind: 1,
              permissions: 7,
              alignment: 1,
              length: legacy.usedLength,
              runRegionId: 1,
              runPlacement: 'fixed',
              runOffset: 0,
              loadPlacement: 'same',
              loadRegionId: 1,
              loadOffset: 0,
              fill: legacy.imageFill,
            },
          ],
    ranges: [],
    images:
      sectionId === undefined
        ? []
        : legacy.images.map(({ address, bytes }) => ({
            sectionId,
            offset: address - legacy.imageBase,
            bytes,
          })),
    patches:
      sectionId === undefined
        ? []
        : legacy.patches.map(({ address, bytes }) => ({
            sectionId,
            offset: address - legacy.imageBase,
            bytes,
          })),
    symbols: [],
    relocations: [],
    metadata: [
      {
        key: 'org.atom.final-cursor',
        majorVersion: 1,
        minorVersion: 0,
        data: Uint8Array.from([...u16(1), ...u32(legacy.finalCursor)]),
      },
      {
        key: 'org.nobj.source-parts',
        majorVersion: 1,
        minorVersion: 0,
        data: Uint8Array.from([
          ...u16(legacy.sourcePartCount),
          ...Array.from({ length: legacy.sourcePartCount }, () =>
            u16(1),
          ).flat(),
        ]),
      },
    ],
    layout: { mode: 'placed', entrySymbolId: 0 },
  };
  const object = parseNobj1(encodeNobj1(draft));
  const materialized = materializeNobj1Object(object);
  const converted = materialized.regions[0];
  const oldBank = legacy.targetImage.banks[0];
  if (
    converted === undefined ||
    oldBank === undefined ||
    converted.base !== legacy.imageBase ||
    converted.capacity !== legacy.imageCapacity ||
    converted.imageFill !== legacy.imageFill ||
    converted.usedLength !== legacy.usedLength ||
    !converted.bytes.every((byte, index) => byte === oldBank[index])
  ) {
    fail('ATOM NOBJ 0.2 conversion changed its materialized image');
  }
  const cursorMetadata =
    object.metadata.find(({ key }) => key === 'org.atom.final-cursor') ??
    fail('ATOM final-cursor metadata is missing after conversion');
  const sourcePartMetadata =
    object.metadata.find(({ key }) => key === 'org.nobj.source-parts') ??
    fail('ATOM source-parts metadata is missing after conversion');
  if (
    readU16(cursorMetadata.data, 0) !== 1 ||
    readU32(cursorMetadata.data, 2) !== legacy.finalCursor ||
    readU16(sourcePartMetadata.data, 0) !== legacy.sourcePartCount
  ) {
    fail('ATOM NOBJ 0.2 conversion changed retained MAP fields');
  }
  for (let part = 0; part < legacy.sourcePartCount; part += 1) {
    if (readU16(sourcePartMetadata.data, 2 + part * 2) !== 1) {
      fail('ATOM NOBJ 0.2 conversion changed source-part bank order');
    }
  }
  return Object.freeze({
    selectedEntryAddress: legacy.entryAddress,
    legacy,
    object,
    materialized,
  });
};
