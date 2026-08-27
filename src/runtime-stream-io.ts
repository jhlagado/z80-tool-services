/** I/O-port gateway for Z80 stubs backed by RuntimeByteStreams. */

import {
  DEFAULT_RUNTIME_STREAM_STATUS_POLICY,
  RUNTIME_STREAM_SERVICE,
  type RuntimeByteStreams,
  type RuntimeStreamStatusPolicy,
} from './runtime-streams.js';
import type { OneByteGatewayResult } from './generation.js';

export const RUNTIME_STREAM_IO_PORT = Object.freeze({
  operation: 0xe0,
  value: 0xe1,
  status: 0xe2,
  result: 0xe3,
  valueHigh: 0xe4,
});

export const RUNTIME_STREAM_IO_OPERATION = Object.freeze({
  readInputByte: 0x00,
  writeOutputByte: 0x01,
  readStorageByte: 0x02,
  rewindStorageInput: 0x03,
  writeStorageByte: 0x04,
  seekStorageOutput: 0x05,
});

export type RuntimeStreamIoOperation =
  (typeof RUNTIME_STREAM_IO_OPERATION)[keyof typeof RUNTIME_STREAM_IO_OPERATION];

export interface RuntimeStreamIoHandlers {
  read(port: number): number;
  write(port: number, value: number): void;
  reset(): void;
}

export interface RuntimeStreamIoGatewayOptions {
  readonly ports?: Partial<typeof RUNTIME_STREAM_IO_PORT>;
  readonly statusPolicy?: RuntimeStreamStatusPolicy;
}

const lowPort = (port: number): number => port & 0xff;

const statusReturnBytes = (ports: typeof RUNTIME_STREAM_IO_PORT): number[] => [
  0xdb,
  ports.status,
  0xb7,
  0xc8,
  0x37,
  0xc9,
];

const readStubBytes = (
  operation: RuntimeStreamIoOperation,
  ports: typeof RUNTIME_STREAM_IO_PORT,
): Uint8Array =>
  Uint8Array.of(
    0x3e,
    operation,
    0xd3,
    ports.operation,
    0xdb,
    ports.status,
    0xb7,
    0x28,
    0x02,
    0x37,
    0xc9,
    0xdb,
    ports.result,
    0xb7,
    0xc9,
  );

const writeByteStubBytes = (
  operation: RuntimeStreamIoOperation,
  ports: typeof RUNTIME_STREAM_IO_PORT,
): Uint8Array =>
  Uint8Array.of(
    0x4f,
    0x3e,
    operation,
    0xd3,
    ports.operation,
    0x79,
    0xd3,
    ports.value,
    ...statusReturnBytes(ports),
  );

const simpleStatusStubBytes = (
  operation: RuntimeStreamIoOperation,
  ports: typeof RUNTIME_STREAM_IO_PORT,
): Uint8Array =>
  Uint8Array.of(
    0x3e,
    operation,
    0xd3,
    ports.operation,
    ...statusReturnBytes(ports),
  );

const seekStubBytes = (
  operation: RuntimeStreamIoOperation,
  ports: typeof RUNTIME_STREAM_IO_PORT,
): Uint8Array =>
  Uint8Array.of(
    0x7d,
    0xd3,
    ports.value,
    0x7c,
    0xd3,
    ports.valueHigh,
    0x3e,
    operation,
    0xd3,
    ports.operation,
    ...statusReturnBytes(ports),
  );

export const createRuntimeStreamIoStubBytes = (
  operation: RuntimeStreamIoOperation,
  options: RuntimeStreamIoGatewayOptions = {},
): Uint8Array => {
  const ports = { ...RUNTIME_STREAM_IO_PORT, ...options.ports };
  switch (operation) {
    case RUNTIME_STREAM_IO_OPERATION.readInputByte:
    case RUNTIME_STREAM_IO_OPERATION.readStorageByte:
      return readStubBytes(operation, ports);
    case RUNTIME_STREAM_IO_OPERATION.writeOutputByte:
    case RUNTIME_STREAM_IO_OPERATION.writeStorageByte:
      return writeByteStubBytes(operation, ports);
    case RUNTIME_STREAM_IO_OPERATION.rewindStorageInput:
      return simpleStatusStubBytes(operation, ports);
    case RUNTIME_STREAM_IO_OPERATION.seekStorageOutput:
      return seekStubBytes(operation, ports);
    default:
      throw new RangeError('runtime stream I/O operation is invalid');
  }
};

export const createRuntimeStreamIoHandlers = (
  streams: RuntimeByteStreams,
  options: RuntimeStreamIoGatewayOptions = {},
): RuntimeStreamIoHandlers => {
  const ports = { ...RUNTIME_STREAM_IO_PORT, ...options.ports };
  const statusPolicy =
    options.statusPolicy ?? DEFAULT_RUNTIME_STREAM_STATUS_POLICY;
  let pendingOperation: number | undefined;
  let pendingValue = 0;
  let pendingValueHigh = 0;
  let lastResult: OneByteGatewayResult = { status: statusPolicy.invalid };

  const dispatch = (): void => {
    switch (pendingOperation) {
      case RUNTIME_STREAM_IO_OPERATION.readInputByte:
        lastResult = streams.readInputByte();
        break;
      case RUNTIME_STREAM_IO_OPERATION.writeOutputByte:
        lastResult = streams.writeOutputByte({ value: pendingValue });
        break;
      case RUNTIME_STREAM_IO_OPERATION.readStorageByte:
        lastResult = streams.readStorageByte();
        break;
      case RUNTIME_STREAM_IO_OPERATION.rewindStorageInput:
        lastResult = streams.rewindStorageInput();
        break;
      case RUNTIME_STREAM_IO_OPERATION.writeStorageByte:
        lastResult = streams.writeStorageByte({ value: pendingValue });
        break;
      case RUNTIME_STREAM_IO_OPERATION.seekStorageOutput:
        lastResult = streams.seekStorageOutput({
          offset: pendingValue | (pendingValueHigh << 8),
        });
        break;
      default:
        lastResult = { status: statusPolicy.invalid };
        break;
    }
    pendingOperation = undefined;
  };

  return {
    read(port: number): number {
      switch (lowPort(port)) {
        case ports.status:
          dispatch();
          return lastResult.status & 0xff;
        case ports.result:
          return lastResult.value ?? 0;
        default:
          return statusPolicy.invalid;
      }
    },
    write(port: number, value: number): void {
      switch (lowPort(port)) {
        case ports.operation:
          pendingOperation = value & 0xff;
          lastResult = { status: statusPolicy.invalid };
          break;
        case ports.value:
          pendingValue = value & 0xff;
          break;
        case ports.valueHigh:
          pendingValueHigh = value & 0xff;
          break;
        default:
          break;
      }
    },
    reset(): void {
      pendingOperation = undefined;
      pendingValue = 0;
      pendingValueHigh = 0;
      lastResult = { status: statusPolicy.invalid };
    },
  };
};

export const runtimeStreamIoOperationName = (
  operation: number,
): string | undefined => {
  switch (operation) {
    case RUNTIME_STREAM_IO_OPERATION.readInputByte:
      return RUNTIME_STREAM_SERVICE.readInputByte;
    case RUNTIME_STREAM_IO_OPERATION.writeOutputByte:
      return RUNTIME_STREAM_SERVICE.writeOutputByte;
    case RUNTIME_STREAM_IO_OPERATION.readStorageByte:
      return RUNTIME_STREAM_SERVICE.readStorageByte;
    case RUNTIME_STREAM_IO_OPERATION.rewindStorageInput:
      return RUNTIME_STREAM_SERVICE.rewindStorageInput;
    case RUNTIME_STREAM_IO_OPERATION.writeStorageByte:
      return RUNTIME_STREAM_SERVICE.writeStorageByte;
    case RUNTIME_STREAM_IO_OPERATION.seekStorageOutput:
      return RUNTIME_STREAM_SERVICE.seekStorageOutput;
    default:
      return undefined;
  }
};
