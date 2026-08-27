import { describe, expect, it } from 'vitest';

import {
  dispatchSourceByteRead,
  MemorySourceByteProvider,
  runSourceByteProviderConformance,
  runSourceServiceGatewayConformance,
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

  it('dispatches resident source-read requests', () => {
    const provider = new MemorySourceByteProvider([
      { ordinal: 0, bytes: Uint8Array.of(0x41) },
    ]);

    expect(dispatchSourceByteRead(provider, { part: 0, offset: 0 })).toEqual({
      status: 0,
      value: 0x41,
    });
    expect(dispatchSourceByteRead(provider, { part: 0, offset: 1 })).toEqual({
      status: 0xfe,
    });
    expect(dispatchSourceByteRead(provider, { part: '0', offset: 0 })).toEqual({
      status: 0xfe,
    });
    expect(
      dispatchSourceByteRead(
        {
          read() {
            throw new Error('failed');
          },
        },
        { part: 0, offset: 0 },
      ),
    ).toEqual({ status: 0xef });
  });

  it('passes reusable source-service gateway conformance vectors', () => {
    expect(
      runSourceServiceGatewayConformance({
        create: (provider) => ({
          sourceRead: (request) => dispatchSourceByteRead(provider, request),
        }),
      }),
    ).toEqual({ vectors: 3, assertions: 10 });
  });
});
