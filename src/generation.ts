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
