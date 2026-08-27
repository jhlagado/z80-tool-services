/** Language-neutral byte stream services for generated Z80 programs. */

import {
  isOneByteUnsigned,
  oneByteValue,
  type GenerationLifecycleConformanceResult,
  type OneByteGatewayResult,
} from './generation.js';

export interface RuntimeStreamStatusPolicy {
  readonly success: number;
  readonly endOfInput: number;
  readonly inputFailure: number;
  readonly outputFailure: number;
  readonly storageFailure: number;
  readonly invalid: number;
}

export const RUNTIME_STREAM_SERVICE = Object.freeze({
  readInputByte: 'readInputByte',
  writeOutputByte: 'writeOutputByte',
  readStorageByte: 'readStorageByte',
  rewindStorageInput: 'rewindStorageInput',
  writeStorageByte: 'writeStorageByte',
  seekStorageOutput: 'seekStorageOutput',
});

export const DEFAULT_RUNTIME_STREAM_STATUS_POLICY: RuntimeStreamStatusPolicy =
  Object.freeze({
    success: 0x00,
    endOfInput: 0x01,
    inputFailure: 0x02,
    outputFailure: 0x03,
    storageFailure: 0x04,
    invalid: 0xfe,
  });

export interface RuntimeByteStreams {
  readonly output: Uint8Array;
  readonly storageOutput: Uint8Array;
  readonly inputOffset: number;
  readonly outputWriteCalls: number;
  readonly storageInputOffset: number;
  readonly storageOutputOffset: number;
  readInputByte(): OneByteGatewayResult;
  writeOutputByte(
    request?: Readonly<Record<string, unknown>>,
  ): OneByteGatewayResult;
  readStorageByte(): OneByteGatewayResult;
  rewindStorageInput(): OneByteGatewayResult;
  writeStorageByte(
    request?: Readonly<Record<string, unknown>>,
  ): OneByteGatewayResult;
  seekStorageOutput(
    request?: Readonly<Record<string, unknown>>,
  ): OneByteGatewayResult;
  reset(): void;
}

export interface MemoryRuntimeByteStreamsState {
  readonly input?: Uint8Array | readonly number[];
  readonly storageInput?: Uint8Array | readonly number[];
  readonly storageOutput?: Uint8Array | readonly number[];
  readonly outputCapacity?: number;
  readonly storageOutputCapacity?: number;
  readonly failOutputWriteCall?: number;
  readonly failInputReads?: boolean;
  readonly failOutputWrites?: boolean;
  readonly failStorageReads?: boolean;
  readonly failStorageRewind?: boolean;
  readonly failStorageWrites?: boolean;
  readonly failStorageSeek?: boolean;
  readonly policy?: RuntimeStreamStatusPolicy;
}

export interface RuntimeByteStreamsConformanceFactory {
  create(state: MemoryRuntimeByteStreamsState): RuntimeByteStreams;
}

const fail = (vector: string, message: string): never => {
  throw new Error(`runtime byte-stream conformance ${vector}: ${message}`);
};

const checkedByteArray = (
  name: string,
  bytes: Uint8Array | readonly number[] | undefined,
): Uint8Array => {
  for (const byte of bytes ?? []) {
    if (!isOneByteUnsigned(byte)) {
      throw new TypeError(`${name} contains a non-byte value`);
    }
  }
  return Uint8Array.from(bytes ?? []);
};

const wordValue = (value: unknown): number | undefined =>
  Number.isInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= 0xffff
    ? (value as number)
    : undefined;

const capacityValue = (
  name: string,
  value: number | undefined,
  fallback: number,
): number => {
  if (value === undefined) return fallback;
  if (value === Number.POSITIVE_INFINITY) return value;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
};

const positiveIntegerValue = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
};

export class MemoryRuntimeByteStreams implements RuntimeByteStreams {
  readonly #initialInput: Uint8Array;
  readonly #initialStorageInput: Uint8Array;
  readonly #initialStorageOutput: Uint8Array;
  readonly #policy: RuntimeStreamStatusPolicy;
  readonly #outputCapacity: number;
  readonly #storageOutputCapacity: number;
  readonly #failOutputWriteCall: number | undefined;
  readonly #failInputReads: boolean;
  readonly #failOutputWrites: boolean;
  readonly #failStorageReads: boolean;
  readonly #failStorageRewind: boolean;
  readonly #failStorageWrites: boolean;
  readonly #failStorageSeek: boolean;
  readonly #output: number[] = [];
  readonly #storageOutput: number[] = [];
  #inputOffset = 0;
  #outputWriteCalls = 0;
  #storageInputOffset = 0;
  #storageOutputOffset = 0;

  constructor(state: MemoryRuntimeByteStreamsState = {}) {
    this.#initialInput = checkedByteArray('input', state.input);
    this.#initialStorageInput = checkedByteArray(
      'storage input',
      state.storageInput,
    );
    this.#initialStorageOutput = checkedByteArray(
      'storage output',
      state.storageOutput,
    );
    this.#policy = state.policy ?? DEFAULT_RUNTIME_STREAM_STATUS_POLICY;
    this.#outputCapacity = capacityValue(
      'output capacity',
      state.outputCapacity,
      Number.POSITIVE_INFINITY,
    );
    this.#storageOutputCapacity = capacityValue(
      'storage output capacity',
      state.storageOutputCapacity,
      Number.POSITIVE_INFINITY,
    );
    if (this.#initialStorageOutput.length > this.#storageOutputCapacity) {
      throw new TypeError('storage output exceeds storage output capacity');
    }
    this.#failOutputWriteCall =
      state.failOutputWriteCall === undefined
        ? undefined
        : positiveIntegerValue(
            'fail output write call',
            state.failOutputWriteCall,
          );
    this.#failInputReads = state.failInputReads === true;
    this.#failOutputWrites = state.failOutputWrites === true;
    this.#failStorageReads = state.failStorageReads === true;
    this.#failStorageRewind = state.failStorageRewind === true;
    this.#failStorageWrites = state.failStorageWrites === true;
    this.#failStorageSeek = state.failStorageSeek === true;
    this.reset();
  }

  get output(): Uint8Array {
    return Uint8Array.from(this.#output);
  }

  get storageOutput(): Uint8Array {
    return Uint8Array.from(this.#storageOutput);
  }

  get inputOffset(): number {
    return this.#inputOffset;
  }

  get outputWriteCalls(): number {
    return this.#outputWriteCalls;
  }

  get storageInputOffset(): number {
    return this.#storageInputOffset;
  }

  get storageOutputOffset(): number {
    return this.#storageOutputOffset;
  }

  reset(): void {
    this.#inputOffset = 0;
    this.#outputWriteCalls = 0;
    this.#storageInputOffset = 0;
    this.#output.length = 0;
    this.#storageOutput.length = 0;
    this.#storageOutput.push(...this.#initialStorageOutput);
    this.#storageOutputOffset = this.#storageOutput.length;
  }

  readInputByte(): OneByteGatewayResult {
    if (this.#failInputReads) return { status: this.#policy.inputFailure };
    if (this.#inputOffset >= this.#initialInput.length) {
      return { status: this.#policy.endOfInput };
    }
    const value = this.#initialInput[this.#inputOffset] as number;
    this.#inputOffset += 1;
    return { status: this.#policy.success, value };
  }

  writeOutputByte(
    request?: Readonly<Record<string, unknown>>,
  ): OneByteGatewayResult {
    const value = oneByteValue(request?.value);
    if (value === undefined) return { status: this.#policy.invalid };
    this.#outputWriteCalls += 1;
    if (
      this.#failOutputWrites ||
      this.#outputWriteCalls === this.#failOutputWriteCall ||
      this.#output.length >= this.#outputCapacity
    ) {
      return { status: this.#policy.outputFailure };
    }
    this.#output.push(value);
    return { status: this.#policy.success };
  }

  readStorageByte(): OneByteGatewayResult {
    if (this.#failStorageReads) return { status: this.#policy.storageFailure };
    if (this.#storageInputOffset >= this.#initialStorageInput.length) {
      return { status: this.#policy.endOfInput };
    }
    const value = this.#initialStorageInput[this.#storageInputOffset] as number;
    this.#storageInputOffset += 1;
    return { status: this.#policy.success, value };
  }

  rewindStorageInput(): OneByteGatewayResult {
    if (this.#failStorageRewind) return { status: this.#policy.storageFailure };
    this.#storageInputOffset = 0;
    return { status: this.#policy.success };
  }

  writeStorageByte(
    request?: Readonly<Record<string, unknown>>,
  ): OneByteGatewayResult {
    const value = oneByteValue(request?.value);
    if (value === undefined) return { status: this.#policy.invalid };
    if (this.#failStorageWrites) return { status: this.#policy.storageFailure };
    if (
      this.#storageOutputOffset === this.#storageOutput.length &&
      this.#storageOutput.length >= this.#storageOutputCapacity
    ) {
      return { status: this.#policy.storageFailure };
    }
    this.#storageOutput[this.#storageOutputOffset] = value;
    this.#storageOutputOffset += 1;
    return { status: this.#policy.success };
  }

  seekStorageOutput(
    request?: Readonly<Record<string, unknown>>,
  ): OneByteGatewayResult {
    const offset = wordValue(request?.offset);
    if (offset === undefined) return { status: this.#policy.invalid };
    if (this.#failStorageSeek || offset > this.#storageOutput.length) {
      return { status: this.#policy.storageFailure };
    }
    this.#storageOutputOffset = offset;
    return { status: this.#policy.success };
  }
}

export const dispatchRuntimeStreamService = (
  streams: RuntimeByteStreams,
  operation: string,
  request?: Readonly<Record<string, unknown>>,
): OneByteGatewayResult => {
  switch (operation) {
    case RUNTIME_STREAM_SERVICE.readInputByte:
      return streams.readInputByte();
    case RUNTIME_STREAM_SERVICE.writeOutputByte:
      return streams.writeOutputByte(request);
    case RUNTIME_STREAM_SERVICE.readStorageByte:
      return streams.readStorageByte();
    case RUNTIME_STREAM_SERVICE.rewindStorageInput:
      return streams.rewindStorageInput();
    case RUNTIME_STREAM_SERVICE.writeStorageByte:
      return streams.writeStorageByte(request);
    case RUNTIME_STREAM_SERVICE.seekStorageOutput:
      return streams.seekStorageOutput(request);
    default:
      return { status: DEFAULT_RUNTIME_STREAM_STATUS_POLICY.invalid };
  }
};

export const runRuntimeByteStreamsConformance = (
  factory: RuntimeByteStreamsConformanceFactory,
  policy: RuntimeStreamStatusPolicy = DEFAULT_RUNTIME_STREAM_STATUS_POLICY,
): GenerationLifecycleConformanceResult => {
  let assertions = 0;

  const expectResult = (
    vector: string,
    actual: OneByteGatewayResult,
    expected: OneByteGatewayResult,
  ): void => {
    assertions += 1;
    if (actual.status !== expected.status || actual.value !== expected.value) {
      fail(
        vector,
        `result ${JSON.stringify(actual)} does not equal ${JSON.stringify(
          expected,
        )}`,
      );
    }
  };

  const expectBytes = (
    vector: string,
    actual: Uint8Array,
    expected: readonly number[],
  ): void => {
    assertions += 1;
    if (
      actual.length !== expected.length ||
      expected.some((byte, index) => actual[index] !== byte)
    ) {
      fail(vector, `bytes [${[...actual]}] do not equal [${expected}]`);
    }
  };

  const expectNumber = (
    vector: string,
    actual: number,
    expected: number,
  ): void => {
    assertions += 1;
    if (actual !== expected)
      fail(vector, `${actual} does not equal ${expected}`);
  };

  {
    const vector = 'input-output-streams';
    const streams = factory.create({ input: [0x41, 0x42] });
    expectResult(vector, streams.readInputByte(), {
      status: policy.success,
      value: 0x41,
    });
    expectResult(vector, streams.readInputByte(), {
      status: policy.success,
      value: 0x42,
    });
    expectResult(vector, streams.readInputByte(), {
      status: policy.endOfInput,
    });
    expectNumber(vector, streams.inputOffset, 2);
    expectResult(vector, streams.writeOutputByte({ value: 0x55 }), {
      status: policy.success,
    });
    expectResult(vector, streams.writeOutputByte({ value: 0x100 }), {
      status: policy.invalid,
    });
    expectBytes(vector, streams.output, [0x55]);
  }

  {
    const vector = 'storage-read-rewind-seek-write';
    const streams = factory.create({
      storageInput: [0x10, 0x20],
      storageOutput: [0x01, 0x02],
    });
    expectResult(vector, streams.readStorageByte(), {
      status: policy.success,
      value: 0x10,
    });
    expectResult(vector, streams.rewindStorageInput(), {
      status: policy.success,
    });
    expectResult(vector, streams.readStorageByte(), {
      status: policy.success,
      value: 0x10,
    });
    expectResult(vector, streams.seekStorageOutput({ offset: 1 }), {
      status: policy.success,
    });
    expectResult(vector, streams.writeStorageByte({ value: 0x99 }), {
      status: policy.success,
    });
    expectResult(vector, streams.writeStorageByte({ value: 0x88 }), {
      status: policy.success,
    });
    expectBytes(vector, streams.storageOutput, [0x01, 0x99, 0x88]);
    expectNumber(vector, streams.storageOutputOffset, 3);
  }

  {
    const vector = 'storage-atomic-failures';
    const streams = factory.create({
      storageInput: [0x10],
      storageOutput: [0x01, 0x02],
      failStorageReads: true,
      failStorageRewind: true,
      failStorageWrites: true,
      failStorageSeek: true,
    });
    expectResult(vector, streams.readStorageByte(), {
      status: policy.storageFailure,
    });
    expectNumber(vector, streams.storageInputOffset, 0);
    expectResult(vector, streams.rewindStorageInput(), {
      status: policy.storageFailure,
    });
    expectNumber(vector, streams.storageInputOffset, 0);
    expectResult(vector, streams.writeStorageByte({ value: 0x77 }), {
      status: policy.storageFailure,
    });
    expectResult(vector, streams.seekStorageOutput({ offset: 0 }), {
      status: policy.storageFailure,
    });
    expectBytes(vector, streams.storageOutput, [0x01, 0x02]);
    expectNumber(vector, streams.storageOutputOffset, 2);
  }

  {
    const vector = 'reset-restores-initial-state';
    const streams = factory.create({
      input: [0x41],
      storageInput: [0x10],
      storageOutput: [0x01],
    });
    streams.readInputByte();
    streams.readStorageByte();
    streams.writeOutputByte({ value: 0x55 });
    streams.writeStorageByte({ value: 0x66 });
    streams.reset();
    expectNumber(vector, streams.inputOffset, 0);
    expectNumber(vector, streams.storageInputOffset, 0);
    expectNumber(vector, streams.storageOutputOffset, 1);
    expectBytes(vector, streams.output, []);
    expectBytes(vector, streams.storageOutput, [0x01]);
    expectResult(vector, streams.readInputByte(), {
      status: policy.success,
      value: 0x41,
    });
    expectResult(vector, streams.readStorageByte(), {
      status: policy.success,
      value: 0x10,
    });
  }

  return { vectors: 4, assertions };
};
