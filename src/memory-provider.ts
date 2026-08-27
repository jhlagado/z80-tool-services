import {
  memoryRangeIsValid,
  NAMED_OBJECT_OPERATION,
  NAMED_OBJECT_REQUEST,
  NAMED_OBJECT_REQUEST_SIZE,
  NAMED_OBJECT_STATUS,
  NAMED_OBJECT_ABI_VERSION,
  type NamedObjectFailureContext,
  type NamedObjectProvider,
  type NamedObjectStatus,
  readDword,
  readWord,
  writeWord,
} from './abi.js';

interface ReadHandle {
  readonly mode: 'read';
  readonly bytes: Uint8Array;
  cursor: number;
}

interface WriteHandle {
  readonly mode: 'write';
  readonly key: string;
  bytes: Uint8Array;
  cursor: number;
  poisoned: boolean;
}

type Handle = ReadHandle | WriteHandle;

export interface MemoryNamedObjectProviderOptions {
  readonly maxHandles?: number;
  readonly maxObjectBytes?: number;
  readonly fail?: (
    context: NamedObjectFailureContext,
  ) => NamedObjectStatus | undefined;
}

const frozenBytes = (bytes: Uint8Array): Uint8Array => Uint8Array.from(bytes);
const keyFor = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const nameBytes = (name: string | Uint8Array): Uint8Array =>
  typeof name === 'string' ? new TextEncoder().encode(name) : name;

/** Byte-transparent, transactional reference provider for ABI conformance. */
export class MemoryNamedObjectProvider implements NamedObjectProvider {
  readonly #objects = new Map<string, Uint8Array>();
  readonly #handles = new Map<number, Handle>();
  readonly #maxHandles: number;
  readonly #maxObjectBytes: number;
  readonly #fail:
    | ((context: NamedObjectFailureContext) => NamedObjectStatus | undefined)
    | undefined;
  #nextHandle = 1;

  public constructor(
    initialObjects: ReadonlyMap<string | Uint8Array, Uint8Array> = new Map(),
    options: MemoryNamedObjectProviderOptions = {},
  ) {
    this.#maxHandles = options.maxHandles ?? 8;
    this.#maxObjectBytes = options.maxObjectBytes ?? 0xffff;
    this.#fail = options.fail;
    if (
      !Number.isInteger(this.#maxHandles) ||
      this.#maxHandles < 1 ||
      this.#maxHandles > 0xffff
    ) {
      throw new RangeError('maxHandles must be in the range 1..65535');
    }
    if (
      !Number.isInteger(this.#maxObjectBytes) ||
      this.#maxObjectBytes < 0 ||
      this.#maxObjectBytes > 0xffffffff
    ) {
      throw new RangeError('maxObjectBytes must be in the range 0..4294967295');
    }
    for (const [name, bytes] of initialObjects) this.seed(name, bytes);
  }

  public get openHandleCount(): number {
    return this.#handles.size;
  }

  public seed(name: string | Uint8Array, bytes: Uint8Array): void {
    const encoded = nameBytes(name);
    if (
      encoded.length < 1 ||
      encoded.length > 255 ||
      bytes.length > this.#maxObjectBytes
    ) {
      throw new RangeError('named object is outside provider capacity');
    }
    this.#objects.set(keyFor(encoded), frozenBytes(bytes));
  }

  public bytes(name: string | Uint8Array): Uint8Array | undefined {
    const bytes = this.#objects.get(keyFor(nameBytes(name)));
    return bytes === undefined ? undefined : frozenBytes(bytes);
  }

  public abortAll(): void {
    this.#handles.clear();
  }

  public dispatch(memory: Uint8Array, request: number): NamedObjectStatus {
    if (!memoryRangeIsValid(memory, request, NAMED_OBJECT_REQUEST_SIZE)) {
      return NAMED_OBJECT_STATUS.invalid;
    }
    const incomingResult = readWord(
      memory,
      request + NAMED_OBJECT_REQUEST.result,
    );
    writeWord(memory, request + NAMED_OBJECT_REQUEST.result, 0);
    if (
      memory[request + NAMED_OBJECT_REQUEST.size] !==
        NAMED_OBJECT_REQUEST_SIZE ||
      memory[request + NAMED_OBJECT_REQUEST.abi] !== NAMED_OBJECT_ABI_VERSION ||
      memory[request + NAMED_OBJECT_REQUEST.flags] !== 0
    ) {
      return NAMED_OBJECT_STATUS.invalid;
    }

    const operation = memory[request + NAMED_OBJECT_REQUEST.operation]!;
    const handle = readWord(memory, request + NAMED_OBJECT_REQUEST.handle);
    const pointer = readWord(memory, request + NAMED_OBJECT_REQUEST.pointer);
    const length = readWord(memory, request + NAMED_OBJECT_REQUEST.length);
    const offset = readDword(memory, request + NAMED_OBJECT_REQUEST.offset);
    const inject = (): NamedObjectStatus | undefined => {
      const injected = this.#fail?.({
        operation,
        handle,
        pointer,
        length,
        offset,
      });
      if (injected === undefined || injected === NAMED_OBJECT_STATUS.success) {
        return undefined;
      }
      const state = this.#handles.get(handle);
      if (
        operation === NAMED_OBJECT_OPERATION.write &&
        state?.mode === 'write'
      ) {
        state.poisoned = true;
      }
      if (
        operation === NAMED_OBJECT_OPERATION.abort &&
        state?.mode === 'write'
      ) {
        this.#handles.delete(handle);
      }
      return injected;
    };

    switch (operation) {
      case NAMED_OBJECT_OPERATION.openRead:
      case NAMED_OBJECT_OPERATION.beginWrite:
        if (
          handle !== 0 ||
          offset !== 0 ||
          incomingResult !== 0 ||
          length < 1 ||
          length > 255 ||
          !memoryRangeIsValid(memory, pointer, length)
        ) {
          return NAMED_OBJECT_STATUS.invalid;
        }
        {
          const injected = inject();
          if (injected !== undefined) return injected;
        }
        return this.#open(memory, request, operation, pointer, length);
      case NAMED_OBJECT_OPERATION.read:
      case NAMED_OBJECT_OPERATION.write:
        if (
          offset !== 0 ||
          incomingResult !== 0 ||
          !memoryRangeIsValid(memory, pointer, length)
        ) {
          return NAMED_OBJECT_STATUS.invalid;
        }
        {
          const injected = inject();
          if (injected !== undefined) return injected;
        }
        return this.#transfer(
          memory,
          request,
          operation,
          handle,
          pointer,
          length,
        );
      case NAMED_OBJECT_OPERATION.rewind:
      case NAMED_OBJECT_OPERATION.close:
      case NAMED_OBJECT_OPERATION.commit:
      case NAMED_OBJECT_OPERATION.abort:
        if (
          pointer !== 0 ||
          length !== 0 ||
          offset !== 0 ||
          incomingResult !== 0
        ) {
          return NAMED_OBJECT_STATUS.invalid;
        }
        {
          const injected = inject();
          if (injected !== undefined) return injected;
        }
        return this.#terminal(operation, handle);
      case NAMED_OBJECT_OPERATION.seek:
        if (pointer !== 0 || length !== 0 || incomingResult !== 0) {
          return NAMED_OBJECT_STATUS.invalid;
        }
        {
          const injected = inject();
          if (injected !== undefined) return injected;
        }
        return this.#seek(handle, offset);
      default:
        return NAMED_OBJECT_STATUS.invalid;
    }
  }

  #allocate(state: Handle): number {
    if (this.#handles.size >= this.#maxHandles) return 0;
    for (let attempts = 0; attempts < 0xffff; attempts += 1) {
      const candidate = this.#nextHandle;
      this.#nextHandle = candidate === 0xffff ? 1 : candidate + 1;
      if (!this.#handles.has(candidate)) {
        this.#handles.set(candidate, state);
        return candidate;
      }
    }
    return 0;
  }

  #open(
    memory: Uint8Array,
    request: number,
    operation: number,
    pointer: number,
    length: number,
  ): NamedObjectStatus {
    const key = keyFor(memory.slice(pointer, pointer + length));
    let state: Handle;
    if (operation === NAMED_OBJECT_OPERATION.openRead) {
      const bytes = this.#objects.get(key);
      if (bytes === undefined) return NAMED_OBJECT_STATUS.notFound;
      state = { mode: 'read', bytes, cursor: 0 };
    } else {
      if (
        [...this.#handles.values()].some(
          (item) => item.mode === 'write' && item.key === key,
        )
      ) {
        return NAMED_OBJECT_STATUS.conflict;
      }
      state = {
        mode: 'write',
        key,
        bytes: new Uint8Array(0),
        cursor: 0,
        poisoned: false,
      };
    }
    const handle = this.#allocate(state);
    if (handle === 0) return NAMED_OBJECT_STATUS.capacity;
    writeWord(memory, request + NAMED_OBJECT_REQUEST.handle, handle);
    return NAMED_OBJECT_STATUS.success;
  }

  #transfer(
    memory: Uint8Array,
    request: number,
    operation: number,
    handle: number,
    pointer: number,
    length: number,
  ): NamedObjectStatus {
    const state = this.#handles.get(handle);
    if (state === undefined || (state.mode === 'write' && state.poisoned)) {
      return NAMED_OBJECT_STATUS.invalid;
    }
    if (operation === NAMED_OBJECT_OPERATION.read) {
      const count = Math.min(
        length,
        Math.max(0, state.bytes.length - state.cursor),
      );
      memory.set(
        state.bytes.subarray(state.cursor, state.cursor + count),
        pointer,
      );
      state.cursor += count;
      writeWord(memory, request + NAMED_OBJECT_REQUEST.result, count);
      return NAMED_OBJECT_STATUS.success;
    }
    if (state.mode !== 'write') return NAMED_OBJECT_STATUS.access;
    const end = state.cursor + length;
    if (end > this.#maxObjectBytes) {
      state.poisoned = true;
      return NAMED_OBJECT_STATUS.capacity;
    }
    if (end > state.bytes.length) {
      const expanded = new Uint8Array(end);
      expanded.set(state.bytes);
      state.bytes = expanded;
    }
    state.bytes.set(memory.subarray(pointer, pointer + length), state.cursor);
    state.cursor = end;
    writeWord(memory, request + NAMED_OBJECT_REQUEST.result, length);
    return NAMED_OBJECT_STATUS.success;
  }

  #seek(handle: number, offset: number): NamedObjectStatus {
    const state = this.#handles.get(handle);
    if (state === undefined || (state.mode === 'write' && state.poisoned)) {
      return NAMED_OBJECT_STATUS.invalid;
    }
    if (state.mode === 'read' && offset > state.bytes.length) {
      return NAMED_OBJECT_STATUS.unsupported;
    }
    if (state.mode === 'write' && offset > this.#maxObjectBytes) {
      return NAMED_OBJECT_STATUS.capacity;
    }
    state.cursor = offset;
    return NAMED_OBJECT_STATUS.success;
  }

  #terminal(operation: number, handle: number): NamedObjectStatus {
    const state = this.#handles.get(handle);
    if (state === undefined) return NAMED_OBJECT_STATUS.invalid;
    switch (operation) {
      case NAMED_OBJECT_OPERATION.rewind:
        if (state.mode === 'write' && state.poisoned) {
          return NAMED_OBJECT_STATUS.invalid;
        }
        state.cursor = 0;
        return NAMED_OBJECT_STATUS.success;
      case NAMED_OBJECT_OPERATION.close:
        if (state.mode !== 'read') return NAMED_OBJECT_STATUS.access;
        this.#handles.delete(handle);
        return NAMED_OBJECT_STATUS.success;
      case NAMED_OBJECT_OPERATION.commit:
        if (state.mode !== 'write' || state.poisoned) {
          return NAMED_OBJECT_STATUS.invalid;
        }
        this.#objects.set(state.key, frozenBytes(state.bytes));
        this.#handles.delete(handle);
        return NAMED_OBJECT_STATUS.success;
      case NAMED_OBJECT_OPERATION.abort:
        if (state.mode !== 'write') return NAMED_OBJECT_STATUS.access;
        this.#handles.delete(handle);
        return NAMED_OBJECT_STATUS.success;
      default:
        return NAMED_OBJECT_STATUS.invalid;
    }
  }
}
