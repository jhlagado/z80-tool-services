import { describe, expect, it } from 'vitest';

import {
  AtomicGenerationStore,
  GenerationLifecycle,
  GenerationLifecycleError,
  MemoryGenerationSpool,
  runGenerationLifecycleConformance,
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
});
