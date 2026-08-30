/** Language-neutral byte source provider primitives. */

import {
  DEFAULT_ONE_BYTE_STATUS_POLICY,
  oneByteValue,
  type OneByteGatewayResult,
  type OneByteStatusPolicy,
} from './generation.js';

export interface SourceByteProvider {
  read(partOrdinal: number, offset: number): number | undefined;
}

/**
 * Source-read requests carry the source-part ordinal in one byte. The byte can
 * represent 0..255, but a resident driver that also needs an in-band sentinel
 * can expose at most 255 ordered source parts.
 *
 * Atom's native driver uses the zero-based 255-part sequence 0..254 and leaves
 * 255 available to lower parser and diagnostic paths. Nucleus's resident
 * source descriptors use the one-based sequence 1..255 so zero can remain a
 * no-part value at that boundary.
 */
export const Z80_SOURCE_PART_ORDINAL_BYTE_MIN = 0;
export const Z80_SOURCE_PART_ORDINAL_BYTE_MAX = 0xff;

export const Z80_ZERO_BASED_SOURCE_PART_ORDINAL_MIN = 0;
export const Z80_ZERO_BASED_SOURCE_PART_ORDINAL_MAX = 0xfe;
export const Z80_ZERO_BASED_SOURCE_PART_CAPACITY = 0xff;

export const Z80_ONE_BASED_SOURCE_PART_ORDINAL_MIN = 1;
export const Z80_ONE_BASED_SOURCE_PART_ORDINAL_MAX = 0xff;
export const Z80_ONE_BASED_SOURCE_PART_CAPACITY = 0xff;

/** Compatibility aliases for the one-based resident descriptor domain. */
export const Z80_RESIDENT_SOURCE_PART_ORDINAL_MIN =
  Z80_ONE_BASED_SOURCE_PART_ORDINAL_MIN;
export const Z80_RESIDENT_SOURCE_PART_ORDINAL_MAX =
  Z80_ONE_BASED_SOURCE_PART_ORDINAL_MAX;
export const Z80_RESIDENT_SOURCE_PART_CAPACITY =
  Z80_ONE_BASED_SOURCE_PART_CAPACITY;

export interface SourceByteRecord {
  readonly ordinal: number;
  readonly bytes: Uint8Array;
}

export class MemorySourceByteProvider implements SourceByteProvider {
  readonly #parts = new Map<number, Uint8Array>();

  constructor(records: readonly SourceByteRecord[]) {
    for (const record of records) {
      if (
        !Number.isInteger(record.ordinal) ||
        record.ordinal < 0 ||
        !(record.bytes instanceof Uint8Array) ||
        this.#parts.has(record.ordinal)
      ) {
        throw new TypeError('invalid source byte record');
      }
      this.#parts.set(record.ordinal, record.bytes.slice());
    }
  }

  read(partOrdinal: number, offset: number): number | undefined {
    if (
      !Number.isInteger(partOrdinal) ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      return undefined;
    }
    return this.#parts.get(partOrdinal)?.[offset];
  }
}

export interface SourceByteProviderConformanceFactory {
  create(records: readonly SourceByteRecord[]): SourceByteProvider;
}

export interface SourceByteProviderConformanceResult {
  readonly vectors: number;
  readonly assertions: number;
}

export interface SourceServiceGateway {
  sourceRead(
    request?: Readonly<Record<string, unknown>>,
  ): OneByteGatewayResult | undefined;
}

export interface SourceServiceGatewayConformanceFactory {
  create(provider: SourceByteProvider): SourceServiceGateway;
}

export interface SourceServiceGatewayConformanceOptions {
  readonly policy?: OneByteStatusPolicy;
}

const fail = (vector: string, message: string): never => {
  throw new Error(`source byte provider conformance ${vector}: ${message}`);
};

/**
 * Run reusable source-byte vectors without assuming how a host stores or
 * streams the backing data.
 */
export const runSourceByteProviderConformance = (
  factory: SourceByteProviderConformanceFactory,
): SourceByteProviderConformanceResult => {
  let assertions = 0;
  const expectByte = (
    vector: string,
    actual: number | undefined,
    expected: number | undefined,
  ): void => {
    assertions += 1;
    if (actual !== expected) {
      fail(vector, `byte ${actual} does not equal ${expected}`);
    }
  };

  {
    const vector = 'explicit-ordinals';
    const first = Uint8Array.from([0x41, 0x42]);
    const second = Uint8Array.from([0x10, 0x20, 0x30]);
    const provider = factory.create([
      { ordinal: 1, bytes: first },
      { ordinal: 7, bytes: second },
    ]);
    first[0] = 0xff;
    second[2] = 0xff;
    expectByte(vector, provider.read(1, 0), 0x41);
    expectByte(vector, provider.read(1, 1), 0x42);
    expectByte(vector, provider.read(7, 2), 0x30);
  }

  {
    const vector = 'missing-and-out-of-range';
    const provider = factory.create([{ ordinal: 0, bytes: Uint8Array.of(5) }]);
    expectByte(vector, provider.read(0, 0), 5);
    expectByte(vector, provider.read(0, 1), undefined);
    expectByte(vector, provider.read(1, 0), undefined);
    expectByte(vector, provider.read(0, -1), undefined);
  }

  return { vectors: 2, assertions };
};

export const dispatchSourceByteRead = (
  provider: SourceByteProvider,
  request: Readonly<Record<string, unknown>> | undefined,
  policy: OneByteStatusPolicy = DEFAULT_ONE_BYTE_STATUS_POLICY,
): OneByteGatewayResult => {
  const part = request?.part;
  const offset = request?.offset;
  if (
    !Number.isInteger(part) ||
    !Number.isInteger(offset) ||
    (part as number) < 0 ||
    (offset as number) < 0
  ) {
    return { status: policy.invalid };
  }
  try {
    const value = oneByteValue(provider.read(part as number, offset as number));
    return value === undefined
      ? { status: policy.invalid }
      : { status: policy.success, value };
  } catch {
    return { status: policy.exception };
  }
};

export const runSourceServiceGatewayConformance = (
  factory: SourceServiceGatewayConformanceFactory,
  options: SourceServiceGatewayConformanceOptions = {},
): SourceByteProviderConformanceResult => {
  const policy = options.policy ?? DEFAULT_ONE_BYTE_STATUS_POLICY;
  let assertions = 0;
  const expectResult = (
    vector: string,
    actual: OneByteGatewayResult | undefined,
    expected: OneByteGatewayResult,
  ): void => {
    assertions += 1;
    if (actual?.status !== expected.status || actual.value !== expected.value) {
      fail(
        vector,
        `result ${JSON.stringify(actual)} does not equal ${JSON.stringify(
          expected,
        )}`,
      );
    }
  };

  {
    const vector = 'source-request-shape';
    const provider = new MemorySourceByteProvider([
      { ordinal: 0, bytes: Uint8Array.from([0x41, 0x00]) },
      { ordinal: 2, bytes: Uint8Array.from([0xff]) },
    ]);
    const gateway = factory.create(provider);
    expectResult(vector, gateway.sourceRead({ part: 0, offset: 0 }), {
      status: policy.success,
      value: 0x41,
    });
    expectResult(vector, gateway.sourceRead({ part: 0, offset: 1 }), {
      status: policy.success,
      value: 0x00,
    });
    expectResult(vector, gateway.sourceRead({ part: 2, offset: 0 }), {
      status: policy.success,
      value: 0xff,
    });
  }

  {
    const vector = 'eof-and-malformed-source-request';
    const provider = new MemorySourceByteProvider([
      { ordinal: 1, bytes: Uint8Array.of(0x20) },
    ]);
    const gateway = factory.create(provider);
    expectResult(vector, gateway.sourceRead({ part: 1, offset: 1 }), {
      status: policy.invalid,
    });
    expectResult(vector, gateway.sourceRead({ part: 2, offset: 0 }), {
      status: policy.invalid,
    });
    expectResult(vector, gateway.sourceRead({ part: -1, offset: 0 }), {
      status: policy.invalid,
    });
    expectResult(vector, gateway.sourceRead({ part: 1, offset: -1 }), {
      status: policy.invalid,
    });
    expectResult(vector, gateway.sourceRead({ part: '1', offset: 0 }), {
      status: policy.invalid,
    });
    expectResult(vector, gateway.sourceRead(), {
      status: policy.invalid,
    });
  }

  {
    const vector = 'source-provider-failure';
    const gateway = factory.create({
      read() {
        throw new Error('source provider failed');
      },
    });
    expectResult(vector, gateway.sourceRead({ part: 0, offset: 0 }), {
      status: policy.exception,
    });
  }

  return { vectors: 3, assertions };
};
