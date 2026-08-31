import { describe, expect, it } from 'vitest';

import {
  TargetImageError,
  createFlatTargetImage,
  materializeTargetImage,
  renderTargetBinary,
  renderTargetCpmCom,
  renderTargetIntelHex,
  type TargetImageGeneration,
} from '../src/index.js';

const generation = (
  overrides: Partial<TargetImageGeneration> = {},
): TargetImageGeneration => ({
  geometry: {
    bankCount: 1,
    imageBase: 0x0100,
    imageCapacity: 0xff00,
    imageFill: 0x00,
    entryBank: 0,
    entryAddress: 0x0100,
  },
  banks: [{ usedLength: 6 }],
  images: [
    { bank: 0, address: 0x0100, bytes: Uint8Array.of(0x21, 0, 0) },
    { bank: 0, address: 0x0105, bytes: Uint8Array.of(0xc9) },
  ],
  patches: [{ bank: 0, address: 0x0101, bytes: Uint8Array.of(0x34, 0x12) }],
  patchPolicy: 'image',
  ...overrides,
});

describe('finalized target images', () => {
  it('materializes sparse IMAGE records and applies final PATCH bytes', () => {
    const materialized = materializeTargetImage(generation());

    expect(materialized.banks).toHaveLength(1);
    expect(materialized.flatImage?.slice(0, 6)).toEqual(
      Uint8Array.of(0x21, 0x34, 0x12, 0x00, 0x00, 0xc9),
    );
    expect(renderTargetBinary(materialized)).toEqual(
      Uint8Array.of(0x21, 0x34, 0x12, 0x00, 0x00, 0xc9),
    );
  });

  it('supports patches into implicit fill only when the profile permits it', () => {
    const patch = {
      bank: 0,
      address: 0x0104,
      bytes: Uint8Array.of(0xaa),
    };

    expect(() =>
      materializeTargetImage(
        generation({ patches: [patch], patchPolicy: 'image' }),
      ),
    ).toThrow('PATCH does not target an IMAGE byte');
    expect(
      materializeTargetImage(
        generation({ patches: [patch], patchPolicy: 'used' }),
      ).flatImage?.slice(0, 6),
    ).toEqual(Uint8Array.of(0x21, 0, 0, 0, 0xaa, 0xc9));
  });

  it('rejects descending IMAGE records, overlapping PATCH records, and bad extents', () => {
    expect(() =>
      materializeTargetImage(
        generation({
          images: [
            { bank: 0, address: 0x0105, bytes: Uint8Array.of(1) },
            { bank: 0, address: 0x0104, bytes: Uint8Array.of(2) },
          ],
          patches: [],
        }),
      ),
    ).toThrow('IMAGE records descend or overlap');
    expect(() =>
      materializeTargetImage(
        generation({
          patches: [
            { bank: 0, address: 0x0101, bytes: Uint8Array.of(1, 2) },
            { bank: 0, address: 0x0102, bytes: Uint8Array.of(3) },
          ],
        }),
      ),
    ).toThrow('PATCH records overlap');
    expect(() =>
      materializeTargetImage(
        generation({
          images: [{ bank: 0, address: 0x0106, bytes: Uint8Array.of(1) }],
          patches: [],
        }),
      ),
    ).toThrow('IMAGE is outside its bank used extent');
  });

  it('selects an explicit bank for banked BIN and HEX output', () => {
    const materialized = materializeTargetImage({
      geometry: {
        bankCount: 2,
        imageBase: 0x4000,
        imageCapacity: 0x1000,
        imageFill: 0xff,
        entryBank: 1,
        entryAddress: 0x4000,
      },
      banks: [{ usedLength: 1 }, { usedLength: 2 }],
      images: [
        { bank: 0, address: 0x4000, bytes: Uint8Array.of(0xaa) },
        { bank: 1, address: 0x4000, bytes: Uint8Array.of(0xbb, 0xcc) },
      ],
      patches: [],
    });

    expect(() => renderTargetBinary(materialized)).toThrow(
      'banked output requires an explicit bank selection',
    );
    expect(renderTargetBinary(materialized, { bank: 1 })).toEqual(
      Uint8Array.of(0xbb, 0xcc),
    );
    expect(renderTargetIntelHex(materialized, { bank: 0 })).toBe(
      ':01400000AA15\n:00000001FF\n',
    );
  });

  it('renders COM as headerless bytes and enforces CP/M placement', () => {
    const materialized = materializeTargetImage(generation());

    expect(renderTargetCpmCom(materialized)).toEqual(
      materialized.flatImage?.slice(0, 6),
    );
    expect(() =>
      renderTargetCpmCom(
        materializeTargetImage(
          generation({
            geometry: {
              ...generation().geometry,
              imageBase: 0x0200,
              imageCapacity: 0xfe00,
              entryAddress: 0x0200,
            },
            images: [{ bank: 0, address: 0x0200, bytes: Uint8Array.of(0xc9) }],
            patches: [],
            banks: [{ usedLength: 1 }],
          }),
        ),
      ),
    ).toThrow('COM output requires one flat bank loaded and entered at $0100');
  });

  it('renders checksummed Intel HEX with configurable records and line endings', () => {
    const materialized = materializeTargetImage(generation());

    expect(
      renderTargetIntelHex(materialized, {
        recordBytes: 4,
        lineEnding: '\r\n',
      }),
    ).toBe(':040100002134120094\r\n:0201040000C930\r\n:00000001FF\r\n');
  });

  it('wraps already-final flat bytes without retaining the caller buffer', () => {
    const bytes = Uint8Array.of(1, 2, 3);
    const materialized = createFlatTargetImage({
      base: 0x2000,
      bytes,
      capacity: 0x100,
    });
    bytes[0] = 9;

    expect(renderTargetBinary(materialized)).toEqual(Uint8Array.of(1, 2, 3));
  });

  it('uses a domain error for invalid target geometry', () => {
    expect(() =>
      materializeTargetImage(
        generation({
          geometry: { ...generation().geometry, bankCount: 0 },
        }),
      ),
    ).toThrow(TargetImageError);
  });
});
