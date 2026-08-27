import { describe, expect, it } from 'vitest';

import {
  MemorySourceByteProvider,
  runSourceByteProviderConformance,
} from '../src/index.js';

describe('source byte provider primitives', () => {
  it('snapshots explicit-ordinal source records', () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const provider = new MemorySourceByteProvider([{ ordinal: 3, bytes }]);

    bytes[0] = 9;

    expect(provider.read(3, 0)).toBe(1);
    expect(provider.read(3, 2)).toBe(3);
  });

  it('returns undefined for invalid or missing reads', () => {
    const provider = new MemorySourceByteProvider([
      { ordinal: 0, bytes: Uint8Array.of(7) },
    ]);

    expect(provider.read(0, 1)).toBeUndefined();
    expect(provider.read(1, 0)).toBeUndefined();
    expect(provider.read(0, -1)).toBeUndefined();
    expect(provider.read(0.5, 0)).toBeUndefined();
    expect(provider.read(0, 0.5)).toBeUndefined();
  });

  it('rejects invalid and duplicate records', () => {
    expect(
      () =>
        new MemorySourceByteProvider([
          { ordinal: 1, bytes: Uint8Array.of(1) },
          { ordinal: 1, bytes: Uint8Array.of(2) },
        ]),
    ).toThrow('invalid source byte record');
    expect(
      () =>
        new MemorySourceByteProvider([
          { ordinal: -1, bytes: Uint8Array.of(1) },
        ]),
    ).toThrow('invalid source byte record');
  });

  it('passes reusable source-byte conformance vectors', () => {
    expect(
      runSourceByteProviderConformance({
        create: (records) => new MemorySourceByteProvider(records),
      }),
    ).toEqual({ vectors: 2, assertions: 7 });
  });
});
