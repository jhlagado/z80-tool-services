/** Language-neutral byte source provider primitives. */

export interface SourceByteProvider {
  read(partOrdinal: number, offset: number): number | undefined;
}

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
