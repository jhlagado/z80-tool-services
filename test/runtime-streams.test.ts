import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RUNTIME_STREAM_STATUS_POLICY,
  dispatchRuntimeStreamService,
  MemoryRuntimeByteStreams,
  runRuntimeByteStreamsConformance,
} from '../src/index.js';

describe('runtime byte-stream services', () => {
  it('passes the reusable stream conformance vectors', () => {
    expect(
      runRuntimeByteStreamsConformance({
        create: (state) => new MemoryRuntimeByteStreams(state),
      }),
    ).toEqual({ vectors: 4, assertions: 30 });
  });

  it('uses Nucleus-compatible default service status assignments', () => {
    expect(DEFAULT_RUNTIME_STREAM_STATUS_POLICY).toEqual({
      success: 0x00,
      endOfInput: 0x01,
      inputFailure: 0x02,
      outputFailure: 0x03,
      storageFailure: 0x04,
      invalid: 0xfe,
    });
  });

  it('dispatches named runtime service operations', () => {
    const streams = new MemoryRuntimeByteStreams({
      input: [0x41],
      storageInput: [0x51],
    });

    expect(dispatchRuntimeStreamService(streams, 'readInputByte')).toEqual({
      status: 0,
      value: 0x41,
    });
    expect(
      dispatchRuntimeStreamService(streams, 'writeOutputByte', { value: 0x42 }),
    ).toEqual({ status: 0 });
    expect(dispatchRuntimeStreamService(streams, 'readStorageByte')).toEqual({
      status: 0,
      value: 0x51,
    });
    expect(dispatchRuntimeStreamService(streams, 'unknown')).toEqual({
      status: 0xfe,
    });
    expect([...streams.output]).toEqual([0x42]);
  });

  it('rejects invalid initial byte arrays', () => {
    expect(() => new MemoryRuntimeByteStreams({ input: [0x100] })).toThrow(
      'input contains a non-byte value',
    );
  });
});
