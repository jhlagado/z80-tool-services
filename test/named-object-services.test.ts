import { describe, expect, it } from 'vitest';

import {
  MemoryNamedObjectProvider,
  NAMED_OBJECT_ABI_VERSION,
  NAMED_OBJECT_OPERATION,
  NAMED_OBJECT_REQUEST,
  NAMED_OBJECT_REQUEST_SIZE,
  NAMED_OBJECT_STATUS,
  NamedObjectClient,
  runNamedObjectConformance,
} from '../src/index.js';

describe('named-object services ABI 1', () => {
  it('keeps the frozen request layout, operations, and statuses', () => {
    expect(NAMED_OBJECT_ABI_VERSION).toBe(1);
    expect(NAMED_OBJECT_REQUEST_SIZE).toBe(16);
    expect(NAMED_OBJECT_REQUEST).toEqual({
      size: 0,
      abi: 1,
      operation: 2,
      flags: 3,
      handle: 4,
      pointer: 6,
      length: 8,
      offset: 10,
      result: 14,
    });
    expect(NAMED_OBJECT_OPERATION).toEqual({
      openRead: 0,
      beginWrite: 1,
      read: 2,
      write: 3,
      rewind: 4,
      seek: 5,
      close: 6,
      commit: 7,
      abort: 8,
    });
    expect(NAMED_OBJECT_STATUS).toEqual({
      success: 0,
      invalid: 1,
      unavailable: 2,
      notFound: 3,
      capacity: 4,
      access: 5,
      storage: 6,
      conflict: 7,
      cancelled: 8,
      unsupported: 9,
    });
  });

  it('passes the reusable provider conformance vectors', () => {
    const result = runNamedObjectConformance({
      create: (objects, options) =>
        new MemoryNamedObjectProvider(objects, options),
    });
    expect(result).toEqual({ vectors: 4, assertions: 29 });
  });

  it('poisons a failed write and preserves the committed generation', () => {
    let failWrite = true;
    const provider = new MemoryNamedObjectProvider(
      new Map([['output', Uint8Array.from([9])]]),
      {
        fail: ({ operation }) => {
          if (operation === NAMED_OBJECT_OPERATION.write && failWrite) {
            failWrite = false;
            return NAMED_OBJECT_STATUS.storage;
          }
          return undefined;
        },
      },
    );
    const client = new NamedObjectClient(provider);
    const writer = client.beginWrite('output');
    expect(client.write(writer.handle, Uint8Array.from([1])).status).toBe(
      NAMED_OBJECT_STATUS.storage,
    );
    expect(client.commit(writer.handle).status).toBe(
      NAMED_OBJECT_STATUS.invalid,
    );
    expect(client.abort(writer.handle).status).toBe(
      NAMED_OBJECT_STATUS.success,
    );
    expect([...provider.bytes('output')!]).toEqual([9]);
  });

  it('supports 32-bit sparse writes and zero-fills the gap', () => {
    const provider = new MemoryNamedObjectProvider(new Map(), {
      maxObjectBytes: 0x1_0010,
    });
    const client = new NamedObjectClient(provider);
    const writer = client.beginWrite('large');
    expect(client.seek(writer.handle, 0x1_0002).status).toBe(0);
    expect(client.write(writer.handle, Uint8Array.from([0x5a])).status).toBe(0);
    expect(client.commit(writer.handle).status).toBe(0);
    const bytes = provider.bytes('large')!;
    expect(bytes.length).toBe(0x1_0003);
    expect(bytes[0x1_0001]).toBe(0);
    expect(bytes[0x1_0002]).toBe(0x5a);
  });

  it('rejects values that cannot be represented by the request block', () => {
    const client = new NamedObjectClient(
      new MemoryNamedObjectProvider(new Map()),
    );
    expect(() => client.read(0x1_0000, 1)).toThrow(/handle/);
    expect(() => client.seek(1, 0x1_0000_0000)).toThrow(/offset/);
    expect(() => client.read(1, 0x101)).toThrow(/buffer/);
  });
});
