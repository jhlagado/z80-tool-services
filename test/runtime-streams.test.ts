import { describe, expect, it } from 'vitest';

import {
  createRuntimeStreamIoStubBytes,
  createRuntimeStreamIoHandlers,
  DEFAULT_RUNTIME_STREAM_STATUS_POLICY,
  dispatchRuntimeStreamService,
  MemoryRuntimeByteStreams,
  RUNTIME_STREAM_IO_OPERATION,
  RUNTIME_STREAM_IO_PORT,
  RUNTIME_STREAM_SERVICE,
  runtimeStreamIoOperationName,
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

    expect(
      dispatchRuntimeStreamService(
        streams,
        RUNTIME_STREAM_SERVICE.readInputByte,
      ),
    ).toEqual({
      status: 0,
      value: 0x41,
    });
    expect(
      dispatchRuntimeStreamService(
        streams,
        RUNTIME_STREAM_SERVICE.writeOutputByte,
        { value: 0x42 },
      ),
    ).toEqual({ status: 0 });
    expect(
      dispatchRuntimeStreamService(
        streams,
        RUNTIME_STREAM_SERVICE.readStorageByte,
      ),
    ).toEqual({
      status: 0,
      value: 0x51,
    });
    expect(dispatchRuntimeStreamService(streams, 'unknown')).toEqual({
      status: 0xfe,
    });
    expect([...streams.output]).toEqual([0x42]);
  });

  it('dispatches runtime stream operations through byte-wide I/O ports', () => {
    const streams = new MemoryRuntimeByteStreams({ input: [0x41] });
    const io = createRuntimeStreamIoHandlers(streams);

    io.write(
      RUNTIME_STREAM_IO_PORT.operation,
      RUNTIME_STREAM_IO_OPERATION.readInputByte,
    );
    expect(io.read(RUNTIME_STREAM_IO_PORT.status)).toBe(0);
    expect(io.read(RUNTIME_STREAM_IO_PORT.result)).toBe(0x41);

    io.write(
      RUNTIME_STREAM_IO_PORT.operation,
      RUNTIME_STREAM_IO_OPERATION.writeOutputByte,
    );
    io.write(RUNTIME_STREAM_IO_PORT.value, 0x42);
    expect(io.read(RUNTIME_STREAM_IO_PORT.status)).toBe(0);
    expect([...streams.output]).toEqual([0x42]);

    io.write(
      RUNTIME_STREAM_IO_PORT.operation,
      RUNTIME_STREAM_IO_OPERATION.seekStorageOutput,
    );
    io.write(RUNTIME_STREAM_IO_PORT.value, 0x00);
    io.write(RUNTIME_STREAM_IO_PORT.valueHigh, 0x01);
    expect(io.read(RUNTIME_STREAM_IO_PORT.status)).toBe(4);

    io.write(RUNTIME_STREAM_IO_PORT.operation, 0xff);
    expect(io.read(RUNTIME_STREAM_IO_PORT.status)).toBe(0xfe);
  });

  it('names the byte-wide I/O operation ordinals', () => {
    expect(
      runtimeStreamIoOperationName(RUNTIME_STREAM_IO_OPERATION.readInputByte),
    ).toBe(RUNTIME_STREAM_SERVICE.readInputByte);
    expect(
      runtimeStreamIoOperationName(
        RUNTIME_STREAM_IO_OPERATION.writeOutputByte,
      ),
    ).toBe(RUNTIME_STREAM_SERVICE.writeOutputByte);
    expect(runtimeStreamIoOperationName(0xff)).toBeUndefined();
  });

  it('generates call-compatible Z80 I/O stubs for every stream service', () => {
    expect([
      ...createRuntimeStreamIoStubBytes(
        RUNTIME_STREAM_IO_OPERATION.readInputByte,
      ),
    ]).toEqual([
      0x3e, 0x00, 0xd3, 0xe0, 0xdb, 0xe2, 0xb7, 0x28, 0x02, 0x37, 0xc9, 0xdb,
      0xe3, 0xb7, 0xc9,
    ]);
    expect([
      ...createRuntimeStreamIoStubBytes(
        RUNTIME_STREAM_IO_OPERATION.writeOutputByte,
      ),
    ]).toEqual([
      0x4f, 0x3e, 0x01, 0xd3, 0xe0, 0x79, 0xd3, 0xe1, 0xdb, 0xe2, 0xb7, 0xc8,
      0x37, 0xc9,
    ]);
    expect([
      ...createRuntimeStreamIoStubBytes(
        RUNTIME_STREAM_IO_OPERATION.readStorageByte,
      ),
    ]).toEqual([
      0x3e, 0x02, 0xd3, 0xe0, 0xdb, 0xe2, 0xb7, 0x28, 0x02, 0x37, 0xc9, 0xdb,
      0xe3, 0xb7, 0xc9,
    ]);
    expect([
      ...createRuntimeStreamIoStubBytes(
        RUNTIME_STREAM_IO_OPERATION.rewindStorageInput,
      ),
    ]).toEqual([
      0x3e, 0x03, 0xd3, 0xe0, 0xdb, 0xe2, 0xb7, 0xc8, 0x37, 0xc9,
    ]);
    expect([
      ...createRuntimeStreamIoStubBytes(
        RUNTIME_STREAM_IO_OPERATION.writeStorageByte,
      ),
    ]).toEqual([
      0x4f, 0x3e, 0x04, 0xd3, 0xe0, 0x79, 0xd3, 0xe1, 0xdb, 0xe2, 0xb7, 0xc8,
      0x37, 0xc9,
    ]);
    expect([
      ...createRuntimeStreamIoStubBytes(
        RUNTIME_STREAM_IO_OPERATION.seekStorageOutput,
      ),
    ]).toEqual([
      0x7d, 0xd3, 0xe1, 0x7c, 0xd3, 0xe4, 0x3e, 0x05, 0xd3, 0xe0, 0xdb, 0xe2,
      0xb7, 0xc8, 0x37, 0xc9,
    ]);
  });

  it('rejects invalid initial byte arrays', () => {
    expect(() => new MemoryRuntimeByteStreams({ input: [0x100] })).toThrow(
      'input contains a non-byte value',
    );
  });

  it('models bounded proof outputs and selected output-call failure', () => {
    const streams = new MemoryRuntimeByteStreams({
      outputCapacity: 1,
      storageOutputCapacity: 1,
      failOutputWriteCall: 2,
    });

    expect(streams.writeOutputByte({ value: 0x41 })).toEqual({ status: 0 });
    expect(streams.writeOutputByte({ value: 0x42 })).toEqual({ status: 3 });
    expect(streams.outputWriteCalls).toBe(2);
    expect([...streams.output]).toEqual([0x41]);
    expect(streams.writeStorageByte({ value: 0x51 })).toEqual({ status: 0 });
    expect(streams.writeStorageByte({ value: 0x52 })).toEqual({ status: 4 });
    expect([...streams.storageOutput]).toEqual([0x51]);
  });

  it('rejects invalid proof-capacity settings', () => {
    expect(() => new MemoryRuntimeByteStreams({ outputCapacity: -1 })).toThrow(
      'output capacity is invalid',
    );
    expect(
      () =>
        new MemoryRuntimeByteStreams({
          storageOutput: [0x41, 0x42],
          storageOutputCapacity: 1,
        }),
    ).toThrow('storage output exceeds storage output capacity');
    expect(
      () => new MemoryRuntimeByteStreams({ failOutputWriteCall: 0 }),
    ).toThrow('fail output write call is invalid');
  });
});
