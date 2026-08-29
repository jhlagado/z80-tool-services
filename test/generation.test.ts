import { describe, expect, it } from 'vitest';

import {
  AtomicGenerationStore,
  GenerationLifecycle,
  GenerationLifecycleError,
  MemoryGenerationSpool,
  appendOnlyGenerationLifecycleAdapter,
  invokeOneByteStatus,
  normalizeOneByteStatus,
  oneByteValue,
  runGenerationLifecycleConformance,
  runOneByteGatewayConformance,
} from '../src/index.js';

describe('generation storage primitives', () => {
  it('stores append-only chunks by value and returns chunk snapshots', () => {
    const spool = new MemoryGenerationSpool();
    const bytes = Uint8Array.from([1, 2]);

    spool.append(bytes);
    bytes[0] = 9;

    expect(spool.byteLength).toBe(2);
    const chunks = [...spool.chunks()];
    expect(chunks).toEqual([Uint8Array.from([1, 2])]);

    chunks[0]![1] = 8;
    expect([...spool.chunks()]).toEqual([Uint8Array.from([1, 2])]);
  });

  it('clears retained chunks and byte count', () => {
    const spool = new MemoryGenerationSpool();

    spool.append(Uint8Array.from([1, 2, 3]));
    spool.clear();

    expect(spool.byteLength).toBe(0);
    expect([...spool.chunks()]).toEqual([]);
  });

  it('publishes only validated generations and preserves prior committed bytes', () => {
    const store = new AtomicGenerationStore((bytes) => {
      if (bytes[0] !== 0xa5) throw new Error('invalid generation');
      return { length: bytes.length };
    });
    const first = Uint8Array.from([0xa5, 1]);

    expect(store.publish(first)).toEqual({ length: 2 });
    first[1] = 9;
    expect(store.current).toEqual(Uint8Array.from([0xa5, 1]));

    expect(() => store.publish(Uint8Array.from([0x00]))).toThrow(
      'invalid generation',
    );
    expect(store.current).toEqual(Uint8Array.from([0xa5, 1]));
  });

  it('rejects invalid open and closed lifecycle transitions', () => {
    const lifecycle = new GenerationLifecycle();

    expect(lifecycle.active).toBe(false);
    expect(() => lifecycle.requireActive()).toThrow(GenerationLifecycleError);

    lifecycle.begin();
    expect(lifecycle.active).toBe(true);
    expect(() => lifecycle.begin()).toThrow('a generation is already active');

    lifecycle.finish();
    expect(lifecycle.active).toBe(false);
    expect(() => lifecycle.abort()).toThrow('no generation is active');
  });

  it('runs reusable lifecycle conformance vectors', () => {
    const result = runGenerationLifecycleConformance(() => {
      const lifecycle = new GenerationLifecycle();
      let imageSeen = false;

      return {
        get active() {
          return lifecycle.active;
        },
        begin() {
          imageSeen = false;
          lifecycle.begin();
        },
        image() {
          lifecycle.requireActive();
          imageSeen = true;
        },
        patch() {
          lifecycle.requireActive();
          if (!imageSeen) throw new Error('patch requires image');
        },
        commit() {
          lifecycle.finish();
        },
        abort() {
          lifecycle.abort();
        },
      };
    });

    expect(result).toEqual({ vectors: 4, assertions: 16 });
  });

  it('adapts typed append-only sinks to lifecycle conformance vectors', () => {
    const result = runGenerationLifecycleConformance(() => {
      const lifecycle = new GenerationLifecycle();
      let cursor = 0;
      const events: string[] = [];

      return appendOnlyGenerationLifecycleAdapter({
        active: () => lifecycle.active,
        begin(record: { readonly target: number }) {
          cursor = record.target;
          events.length = 0;
          lifecycle.begin();
          events.push(`begin:${record.target}`);
        },
        image(record: { readonly address: number; readonly bytes: Uint8Array }) {
          lifecycle.requireActive();
          if (record.address !== cursor) {
            throw new Error('non-contiguous image');
          }
          cursor += record.bytes.length;
          events.push(`image:${record.address}:${record.bytes.length}`);
        },
        patch(record: { readonly address: number; readonly bytes: Uint8Array }) {
          lifecycle.requireActive();
          if (record.bytes.length === 0 || record.address < 0x4000) {
            throw new Error('invalid patch');
          }
          events.push(`patch:${record.address}`);
        },
        commit(record: { readonly finalCursor: number }) {
          lifecycle.requireActive();
          if (record.finalCursor !== cursor) {
            throw new Error('wrong final cursor');
          }
          events.push(`commit:${record.finalCursor}`);
          lifecycle.finish();
        },
        abort() {
          events.push('abort');
          lifecycle.abort();
        },
        records: () => ({
          begin: { target: 0x4000 },
          image: {
            address: cursor,
            bytes: Uint8Array.of(1, 2),
          },
          patch: { address: 0x4001, bytes: Uint8Array.of(9) },
          commit: { finalCursor: cursor },
        }),
      });
    });

    expect(result).toEqual({ vectors: 4, assertions: 16 });
  });

  it('normalizes one-byte values and statuses', () => {
    expect(oneByteValue(0)).toBe(0);
    expect(oneByteValue(0xff)).toBe(0xff);
    expect(oneByteValue(-1)).toBeUndefined();
    expect(oneByteValue(0x100)).toBeUndefined();
    expect(oneByteValue(1.5)).toBeUndefined();

    expect(normalizeOneByteStatus(undefined)).toBe(0);
    expect(normalizeOneByteStatus(0x7f)).toBe(0x7f);
    expect(normalizeOneByteStatus(0x100)).toBe(0xfe);
    expect(
      normalizeOneByteStatus(undefined, {
        success: 1,
        unavailable: 4,
        invalid: 2,
        exception: 3,
      }),
    ).toBe(1);
  });

  it('converts thrown host operations to one-byte status results', () => {
    const cause = new Error('host failed');

    expect(invokeOneByteStatus(() => undefined)).toEqual({ status: 0 });
    expect(invokeOneByteStatus(() => 0x55)).toEqual({ status: 0x55 });
    expect(invokeOneByteStatus(() => 0x100)).toEqual({ status: 0xfe });
    expect(
      invokeOneByteStatus(() => {
        throw cause;
      }),
    ).toEqual({
      status: 0xef,
      cause,
    });
    expect(
      invokeOneByteStatus(
        () => {
          throw cause;
        },
        { success: 1, unavailable: 4, invalid: 2, exception: 3 },
      ),
    ).toEqual({ status: 3, cause });
  });

  it('runs reusable one-byte gateway conformance vectors', () => {
    const result = runOneByteGatewayConformance(
      {
        create: (fixtures) => {
          const effects: string[] = [];
          return {
            effects,
            gateway: {
              dispatch(operation, request = {}) {
                switch (operation) {
                  case 'sourceRead': {
                    const offset = request.offset;
                    const value =
                      typeof offset === 'number'
                        ? fixtures.sourceBytes[offset]
                        : fixtures.sourceReadMalformedValue;
                    const byteValue = oneByteValue(value);
                    return byteValue === undefined
                      ? { status: 0xfe }
                      : { status: 0, value: byteValue };
                  }
                  case 'consoleRead':
                    return typeof fixtures.consoleReadMalformedValue ===
                      'number' &&
                      fixtures.consoleReadMalformedValue >= 0 &&
                      fixtures.consoleReadMalformedValue <= 0xff
                      ? { status: 0, value: fixtures.consoleReadMalformedValue }
                      : { status: 0xfe };
                  case 'consoleWrite':
                  case 'exitFailure':
                    return { status: 0xfe };
                  case 'begin':
                    effects.push('begin');
                    return typeof fixtures.sinkMalformedStatus === 'number' &&
                      fixtures.sinkMalformedStatus > 0xff
                      ? { status: 0xfe }
                      : { status: 0 };
                  case 'image':
                    effects.push(`image:${[...(request.bytes as Uint8Array)]}`);
                    return { status: 0 };
                  case 'commit':
                    effects.push('commit');
                    return { status: 0 };
                  case 'abort':
                    fixtures.thrownHostOperation();
                    return { status: 0 };
                  default:
                    return { status: 2 };
                }
              },
            },
          };
        },
      },
      {
        operations: {
          sourceRead: 'sourceRead',
          consoleRead: 'consoleRead',
          consoleWrite: 'consoleWrite',
          exitFailure: 'exitFailure',
          begin: 'begin',
          image: 'image',
          commit: 'commit',
          abort: 'abort',
          unknown: 'unknown',
        },
      },
    );

    expect(result).toEqual({ vectors: 3, assertions: 14 });
  });
});
