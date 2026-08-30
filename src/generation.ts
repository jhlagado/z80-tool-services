/** Language-neutral append-only generation storage primitives. */

export interface GenerationSpool {
  readonly byteLength: number;
  append(bytes: Uint8Array): void;
  chunks(): Iterable<Uint8Array>;
  clear(): void;
}

export type GenerationSpoolFactory = () => GenerationSpool;

export class MemoryGenerationSpool implements GenerationSpool {
  readonly #chunks: Uint8Array[] = [];
  #byteLength = 0;

  get byteLength(): number {
    return this.#byteLength;
  }

  append(bytes: Uint8Array): void {
    const retained = bytes.slice();
    this.#chunks.push(retained);
    this.#byteLength += retained.length;
  }

  *chunks(): Iterable<Uint8Array> {
    for (const chunk of this.#chunks) yield chunk.slice();
  }

  clear(): void {
    this.#chunks.length = 0;
    this.#byteLength = 0;
  }
}

/** Atomic reference to the most recently validated committed generation. */
export class AtomicGenerationStore<T> {
  readonly #validate: (serialized: Uint8Array) => T;
  #current: Uint8Array | undefined;

  constructor(validate: (serialized: Uint8Array) => T) {
    this.#validate = validate;
  }

  get current(): Uint8Array | undefined {
    return this.#current?.slice();
  }

  publish(serialized: Uint8Array): T {
    const parsed = this.#validate(serialized);
    this.#current = serialized.slice();
    return parsed;
  }
}

export type GenerationLifecycleFailure = (message: string) => never;

export class GenerationLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationLifecycleError';
  }
}

const throwLifecycleError: GenerationLifecycleFailure = (message) => {
  throw new GenerationLifecycleError(message);
};

/**
 * Shared open/closed generation sequencing.
 *
 * Format-specific sinks remain responsible for record validation, ordering,
 * serialization, and publication integrity. This class owns only the common
 * lifecycle fact: one tentative generation may be active at a time, and commit
 * or abort closes it.
 */
export class GenerationLifecycle {
  #active = false;

  get active(): boolean {
    return this.#active;
  }

  begin(
    fail: GenerationLifecycleFailure = throwLifecycleError,
    message = 'a generation is already active',
  ): void {
    if (this.#active) fail(message);
    this.#active = true;
  }

  requireActive(
    fail: GenerationLifecycleFailure = throwLifecycleError,
    message = 'no generation is active',
  ): void {
    if (!this.#active) fail(message);
  }

  finish(
    fail: GenerationLifecycleFailure = throwLifecycleError,
    message = 'no generation is active',
  ): void {
    this.requireActive(fail, message);
    this.#active = false;
  }

  abort(
    fail: GenerationLifecycleFailure = throwLifecycleError,
    message = 'no generation is active',
  ): void {
    this.finish(fail, message);
  }

  reset(): void {
    this.#active = false;
  }
}

export interface GenerationLifecycleConformanceSink {
  readonly active: boolean;
  begin(): void;
  image(): void;
  patch(): void;
  commit(): void;
  abort(): void;
}

export interface AppendOnlyGenerationSinkAdapterOptions<
  TBegin,
  TImage,
  TPatch,
  TCommit,
> {
  readonly active: () => boolean;
  readonly begin: (record: TBegin) => void;
  readonly image: (record: TImage) => void;
  readonly patch: (record: TPatch) => void;
  readonly commit: (record: TCommit) => void;
  readonly abort: () => void;
  readonly records: () => {
    readonly begin: TBegin;
    readonly image: TImage;
    readonly patch: TPatch;
    readonly commit: TCommit;
  };
}

/**
 * Adapt a typed append-only generation sink to the reusable lifecycle vectors.
 *
 * Atom and Nucleus use different begin, image, patch, and commit records. The
 * lifecycle contract is still common: closed sinks reject work, begin opens a
 * tentative generation, image and patch require an open generation, and commit
 * or abort closes it. This adapter keeps those records at the caller boundary
 * while sharing the conformance path.
 */
export const appendOnlyGenerationLifecycleAdapter = <
  TBegin,
  TImage,
  TPatch,
  TCommit,
>(
  options: AppendOnlyGenerationSinkAdapterOptions<
    TBegin,
    TImage,
    TPatch,
    TCommit
  >,
): GenerationLifecycleConformanceSink => ({
  get active() {
    return options.active();
  },
  begin() {
    options.begin(options.records().begin);
  },
  image() {
    options.image(options.records().image);
  },
  patch() {
    options.patch(options.records().patch);
  },
  commit() {
    options.commit(options.records().commit);
  },
  abort() {
    options.abort();
  },
});

export interface GenerationLifecycleConformanceResult {
  readonly vectors: number;
  readonly assertions: number;
}

export interface OneByteStatusPolicy {
  readonly success: number;
  readonly unavailable: number;
  readonly invalid: number;
  readonly exception: number;
}

export interface OneByteStatusResult {
  readonly status: number;
  readonly cause?: unknown;
}

export interface OneByteGatewayResult {
  readonly status: number;
  readonly value?: number;
}

export interface OneByteGateway {
  dispatch(
    operation: string,
    request?: Readonly<Record<string, unknown>>,
  ): OneByteGatewayResult | undefined;
}

export interface OneByteGatewayOperations {
  readonly sourceRead: string;
  readonly consoleRead: string;
  readonly consoleWrite: string;
  readonly exitFailure: string;
  readonly begin: string;
  readonly image: string;
  readonly commit: string;
  readonly abort: string;
  readonly unknown: string;
}

export interface OneByteGatewayConformanceFixtures {
  readonly sourceBytes: Uint8Array;
  readonly sourceReadMalformedValue: unknown;
  readonly consoleReadMalformedValue: unknown;
  readonly sinkMalformedStatus: unknown;
  readonly thrownHostOperation: () => unknown;
}

export interface OneByteGatewayConformanceFactory {
  create(fixtures: OneByteGatewayConformanceFixtures): {
    readonly gateway: OneByteGateway;
    readonly effects: readonly string[];
  };
}

export interface OneByteGatewayConformanceOptions {
  readonly operations: OneByteGatewayOperations;
  readonly policy?: OneByteStatusPolicy;
}

export const DEFAULT_ONE_BYTE_STATUS_POLICY: OneByteStatusPolicy =
  Object.freeze({
    success: 0x00,
    unavailable: 0x02,
    invalid: 0xfe,
    exception: 0xef,
  });

export const Z80_BYTE_MAX = 0xff;
export const Z80_WORD_MAX = 0xffff;
export const Z80_ADDRESS_SPACE_BYTES = 0x10000;

export const isUnsignedIntegerUpTo = (
  value: unknown,
  maximum: number,
): value is number =>
  Number.isInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= maximum;

export const isOneByteUnsigned = (value: unknown): value is number =>
  isUnsignedIntegerUpTo(value, Z80_BYTE_MAX);

export const isZ80Word = (value: unknown): value is number =>
  isUnsignedIntegerUpTo(value, Z80_WORD_MAX);

export const z80AddressEnd = (
  base: number,
  length: number,
): number | undefined => {
  if (!isZ80Word(base) || !isZ80Word(length)) return undefined;
  const end = base + length;
  return end <= Z80_ADDRESS_SPACE_BYTES ? end : undefined;
};

export const oneByteValue = (value: unknown): number | undefined =>
  isOneByteUnsigned(value) ? value : undefined;

export const normalizeOneByteStatus = (
  value: unknown,
  policy: OneByteStatusPolicy = DEFAULT_ONE_BYTE_STATUS_POLICY,
): number => {
  const result = value === undefined ? policy.success : value;
  return isOneByteUnsigned(result) ? result : policy.invalid;
};

export const invokeOneByteStatus = (
  action: () => unknown,
  policy: OneByteStatusPolicy = DEFAULT_ONE_BYTE_STATUS_POLICY,
): OneByteStatusResult => {
  try {
    return { status: normalizeOneByteStatus(action(), policy) };
  } catch (cause) {
    return { status: policy.exception, cause };
  }
};

export const runOneByteGatewayConformance = (
  factory: OneByteGatewayConformanceFactory,
  options: OneByteGatewayConformanceOptions,
): GenerationLifecycleConformanceResult => {
  const policy = options.policy ?? DEFAULT_ONE_BYTE_STATUS_POLICY;
  const { operations } = options;
  let assertions = 0;
  const fail = (vector: string, message: string): never => {
    throw new Error(`one-byte gateway conformance ${vector}: ${message}`);
  };
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
  const expectEffects = (
    vector: string,
    actual: readonly string[],
    expected: readonly string[],
  ): void => {
    assertions += 1;
    if (
      actual.length !== expected.length ||
      expected.some((effect, index) => actual[index] !== effect)
    ) {
      fail(vector, `effects [${actual}] do not equal [${expected}]`);
    }
  };

  {
    const vector = 'source-and-output-success';
    const { gateway, effects } = factory.create({
      sourceBytes: Uint8Array.from([0x00, 0x7f, 0xff]),
      sourceReadMalformedValue: 0,
      consoleReadMalformedValue: 0,
      sinkMalformedStatus: 0,
      thrownHostOperation: () => policy.success,
    });
    expectResult(
      vector,
      gateway.dispatch(operations.sourceRead, { part: 0, offset: 1 }),
      {
        status: policy.success,
        value: 0x7f,
      },
    );
    expectResult(vector, gateway.dispatch(operations.begin), {
      status: policy.success,
    });
    expectResult(
      vector,
      gateway.dispatch(operations.image, {
        bank: 0,
        address: 0x4000,
        bytes: Uint8Array.from([1, 2]),
      }),
      { status: policy.success },
    );
    expectResult(vector, gateway.dispatch(operations.commit), {
      status: policy.success,
    });
    expectEffects(vector, effects, ['begin', 'image:1,2', 'commit']);
  }

  {
    const vector = 'unavailable-and-malformed';
    const { gateway, effects } = factory.create({
      sourceBytes: Uint8Array.from([0]),
      sourceReadMalformedValue: 0x100,
      consoleReadMalformedValue: -1,
      sinkMalformedStatus: 0x100,
      thrownHostOperation: () => policy.success,
    });
    expectResult(vector, gateway.dispatch(operations.unknown), {
      status: policy.unavailable,
    });
    expectResult(vector, gateway.dispatch(operations.sourceRead), {
      status: policy.invalid,
    });
    expectResult(vector, gateway.dispatch(operations.consoleRead), {
      status: policy.invalid,
    });
    expectResult(
      vector,
      gateway.dispatch(operations.consoleWrite, { value: 0x100 }),
      { status: policy.invalid },
    );
    expectResult(
      vector,
      gateway.dispatch(operations.exitFailure, { status: 0 }),
      { status: policy.invalid },
    );
    expectResult(vector, gateway.dispatch(operations.begin), {
      status: policy.invalid,
    });
    expectEffects(vector, effects, ['begin']);
  }

  {
    const vector = 'thrown-host-operation';
    const cause = new Error('injected host exception');
    const { gateway } = factory.create({
      sourceBytes: Uint8Array.from([0]),
      sourceReadMalformedValue: 0,
      consoleReadMalformedValue: 0,
      sinkMalformedStatus: 0,
      thrownHostOperation: () => {
        throw cause;
      },
    });
    const result = invokeOneByteStatus(
      () => gateway.dispatch(operations.abort)?.status,
      policy,
    );
    expectResult(vector, result, { status: policy.exception });
    assertions += 1;
    if (result.cause !== cause) fail(vector, 'cause was not preserved');
  }

  return { vectors: 3, assertions };
};

const lifecycleFail = (vector: string, message: string): never => {
  throw new Error(`generation lifecycle conformance ${vector}: ${message}`);
};

/**
 * Run reusable lifecycle vectors without depending on a particular test runner.
 *
 * The adapter should translate its native error/status style into thrown
 * failures. The vectors intentionally avoid format-specific assumptions such as
 * image ordering, map records, CRCs, or target ranges.
 */
export const runGenerationLifecycleConformance = (
  createSink: () => GenerationLifecycleConformanceSink,
): GenerationLifecycleConformanceResult => {
  let assertions = 0;
  const expectActive = (
    vector: string,
    sink: GenerationLifecycleConformanceSink,
    expected: boolean,
  ): void => {
    assertions += 1;
    if (sink.active !== expected) {
      lifecycleFail(vector, `active ${sink.active} does not equal ${expected}`);
    }
  };
  const expectThrows = (vector: string, action: () => void): void => {
    assertions += 1;
    try {
      action();
    } catch {
      return;
    }
    lifecycleFail(vector, 'operation unexpectedly succeeded');
  };

  {
    const vector = 'closed-rejects-work';
    const sink = createSink();
    expectActive(vector, sink, false);
    expectThrows(vector, () => sink.image());
    expectThrows(vector, () => sink.patch());
    expectThrows(vector, () => sink.commit());
    expectThrows(vector, () => sink.abort());
    expectActive(vector, sink, false);
  }

  {
    const vector = 'nested-begin-is-rejected';
    const sink = createSink();
    sink.begin();
    expectActive(vector, sink, true);
    expectThrows(vector, () => sink.begin());
    expectActive(vector, sink, true);
    sink.abort();
    expectActive(vector, sink, false);
  }

  {
    const vector = 'abort-closes-and-allows-restart';
    const sink = createSink();
    sink.begin();
    sink.image();
    sink.patch();
    sink.abort();
    expectActive(vector, sink, false);
    sink.begin();
    expectActive(vector, sink, true);
    sink.abort();
    expectActive(vector, sink, false);
  }

  {
    const vector = 'commit-closes-and-allows-restart';
    const sink = createSink();
    sink.begin();
    sink.image();
    sink.patch();
    sink.commit();
    expectActive(vector, sink, false);
    sink.begin();
    expectActive(vector, sink, true);
    sink.abort();
    expectActive(vector, sink, false);
  }

  return { vectors: 4, assertions };
};
