import {
  NAMED_OBJECT_ABI_VERSION,
  NAMED_OBJECT_OPERATION,
  NAMED_OBJECT_REQUEST,
  NAMED_OBJECT_REQUEST_SIZE,
  type NamedObjectOperation,
  type NamedObjectProvider,
  type NamedObjectStatus,
  readWord,
  writeDword,
  writeWord,
} from './abi.js';

export interface NamedObjectResult {
  readonly status: NamedObjectStatus;
  readonly handle: number;
  readonly result: number;
  readonly bytes: Uint8Array;
}

export interface NamedObjectClientOptions {
  readonly memoryBytes?: number;
  readonly requestAddress?: number;
  readonly bufferAddress?: number;
  readonly bufferBytes?: number;
}

interface CallFields {
  readonly handle?: number;
  readonly bytes?: Uint8Array;
  readonly length?: number;
  readonly offset?: number;
}

/** Synchronous ABI client used by host adapters and provider proofs. */
export class NamedObjectClient {
  readonly #provider: NamedObjectProvider;
  readonly #memory: Uint8Array;
  readonly #requestAddress: number;
  readonly #bufferAddress: number;
  readonly #bufferBytes: number;

  public constructor(
    provider: NamedObjectProvider,
    options: NamedObjectClientOptions = {},
  ) {
    this.#provider = provider;
    this.#memory = new Uint8Array(options.memoryBytes ?? 0x400);
    this.#requestAddress = options.requestAddress ?? 0x20;
    this.#bufferAddress = options.bufferAddress ?? 0x100;
    this.#bufferBytes = options.bufferBytes ?? 0x100;
    if (
      this.#requestAddress + NAMED_OBJECT_REQUEST_SIZE > this.#memory.length ||
      this.#bufferAddress + this.#bufferBytes > this.#memory.length ||
      this.#bufferBytes < 1
    ) {
      throw new RangeError('named-object client memory layout is invalid');
    }
  }

  public openRead(name: string | Uint8Array): NamedObjectResult {
    return this.#call(NAMED_OBJECT_OPERATION.openRead, {
      bytes: encodeName(name),
    });
  }

  public beginWrite(name: string | Uint8Array): NamedObjectResult {
    return this.#call(NAMED_OBJECT_OPERATION.beginWrite, {
      bytes: encodeName(name),
    });
  }

  public read(handle: number, length: number): NamedObjectResult {
    return this.#call(NAMED_OBJECT_OPERATION.read, { handle, length });
  }

  public write(handle: number, bytes: Uint8Array): NamedObjectResult {
    return this.#call(NAMED_OBJECT_OPERATION.write, { handle, bytes });
  }

  public rewind(handle: number): NamedObjectResult {
    return this.#call(NAMED_OBJECT_OPERATION.rewind, { handle });
  }

  public seek(handle: number, offset: number): NamedObjectResult {
    return this.#call(NAMED_OBJECT_OPERATION.seek, { handle, offset });
  }

  public close(handle: number): NamedObjectResult {
    return this.#call(NAMED_OBJECT_OPERATION.close, { handle });
  }

  public commit(handle: number): NamedObjectResult {
    return this.#call(NAMED_OBJECT_OPERATION.commit, { handle });
  }

  public abort(handle: number): NamedObjectResult {
    return this.#call(NAMED_OBJECT_OPERATION.abort, { handle });
  }

  #call(
    operation: NamedObjectOperation,
    fields: CallFields,
  ): NamedObjectResult {
    const handle = fields.handle ?? 0;
    const offset = fields.offset ?? 0;
    if (!Number.isInteger(handle) || handle < 0 || handle > 0xffff) {
      throw new RangeError('named-object handle is outside 0..65535');
    }
    if (!Number.isInteger(offset) || offset < 0 || offset > 0xffffffff) {
      throw new RangeError('named-object offset is outside 0..4294967295');
    }
    const request = this.#requestAddress;
    this.#memory.fill(0, request, request + NAMED_OBJECT_REQUEST_SIZE);
    this.#memory[request + NAMED_OBJECT_REQUEST.size] =
      NAMED_OBJECT_REQUEST_SIZE;
    this.#memory[request + NAMED_OBJECT_REQUEST.abi] = NAMED_OBJECT_ABI_VERSION;
    this.#memory[request + NAMED_OBJECT_REQUEST.operation] = operation;
    writeWord(this.#memory, request + NAMED_OBJECT_REQUEST.handle, handle);

    if (fields.bytes !== undefined) {
      this.#requireTransfer(fields.bytes.length);
      this.#memory.set(fields.bytes, this.#bufferAddress);
      writeWord(
        this.#memory,
        request + NAMED_OBJECT_REQUEST.pointer,
        this.#bufferAddress,
      );
      writeWord(
        this.#memory,
        request + NAMED_OBJECT_REQUEST.length,
        fields.bytes.length,
      );
    } else if (fields.length !== undefined) {
      this.#requireTransfer(fields.length);
      writeWord(
        this.#memory,
        request + NAMED_OBJECT_REQUEST.pointer,
        this.#bufferAddress,
      );
      writeWord(
        this.#memory,
        request + NAMED_OBJECT_REQUEST.length,
        fields.length,
      );
    }

    writeDword(this.#memory, request + NAMED_OBJECT_REQUEST.offset, offset);
    const status = this.#provider.dispatch(this.#memory, request);
    const count = readWord(this.#memory, request + NAMED_OBJECT_REQUEST.result);
    return {
      status,
      handle: readWord(this.#memory, request + NAMED_OBJECT_REQUEST.handle),
      result: count,
      bytes: this.#memory.slice(
        this.#bufferAddress,
        this.#bufferAddress + count,
      ),
    };
  }

  #requireTransfer(length: number): void {
    if (!Number.isInteger(length) || length < 0 || length > this.#bufferBytes) {
      throw new RangeError('named-object transfer exceeds the client buffer');
    }
  }
}

const encodeName = (name: string | Uint8Array): Uint8Array =>
  typeof name === 'string' ? new TextEncoder().encode(name) : name;
