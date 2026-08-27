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

export interface GenerationLifecycleConformanceResult {
  readonly vectors: number;
  readonly assertions: number;
}

export interface OneByteStatusPolicy {
  readonly success: number;
  readonly invalid: number;
  readonly exception: number;
}

export interface OneByteStatusResult {
  readonly status: number;
  readonly cause?: unknown;
}

export const DEFAULT_ONE_BYTE_STATUS_POLICY: OneByteStatusPolicy =
  Object.freeze({
    success: 0x00,
    invalid: 0xfe,
    exception: 0xef,
  });

export const isOneByteUnsigned = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= 0xff;

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
