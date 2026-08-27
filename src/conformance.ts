import {
  NAMED_OBJECT_STATUS,
  type NamedObjectProvider,
  type NamedObjectStatus,
} from './abi.js';
import { NamedObjectClient } from './client.js';

export interface NamedObjectConformanceFactory {
  create(
    initialObjects: ReadonlyMap<string, Uint8Array>,
    options?: { readonly maxHandles?: number },
  ): NamedObjectProvider;
}

export interface NamedObjectConformanceResult {
  readonly vectors: number;
  readonly assertions: number;
}

const bytesEqual = (actual: Uint8Array, expected: readonly number[]): boolean =>
  actual.length === expected.length &&
  expected.every((byte, index) => actual[index] === byte);

const fail = (vector: string, message: string): never => {
  throw new Error(`named-object conformance ${vector}: ${message}`);
};

/**
 * Run the platform-neutral ABI vectors. A provider package can call this from
 * its own test runner without depending on a particular assertion framework.
 */
export const runNamedObjectConformance = (
  factory: NamedObjectConformanceFactory,
): NamedObjectConformanceResult => {
  let assertions = 0;
  const expectStatus = (
    vector: string,
    actual: NamedObjectStatus,
    expected: NamedObjectStatus,
  ): void => {
    assertions += 1;
    if (actual !== expected) {
      fail(vector, `status ${actual} does not equal ${expected}`);
    }
  };
  const expectBytes = (
    vector: string,
    actual: Uint8Array,
    expected: readonly number[],
  ): void => {
    assertions += 1;
    if (!bytesEqual(actual, expected)) {
      fail(vector, `bytes [${[...actual]}] do not equal [${expected}]`);
    }
  };

  {
    const vector = 'binary-read-and-eof';
    const provider = factory.create(
      new Map([['binary', Uint8Array.from([0x00, 0x1a, 0x7f, 0x80, 0xff])]]),
    );
    const first = new NamedObjectClient(provider);
    const second = new NamedObjectClient(provider);
    const firstOpen = first.openRead('binary');
    const secondOpen = second.openRead('binary');
    expectStatus(vector, firstOpen.status, NAMED_OBJECT_STATUS.success);
    expectStatus(vector, secondOpen.status, NAMED_OBJECT_STATUS.success);
    expectBytes(
      vector,
      first.read(firstOpen.handle, 3).bytes,
      [0x00, 0x1a, 0x7f],
    );
    expectBytes(vector, second.read(secondOpen.handle, 1).bytes, [0x00]);
    expectBytes(vector, first.read(firstOpen.handle, 3).bytes, [0x80, 0xff]);
    const eof = first.read(firstOpen.handle, 1);
    expectStatus(vector, eof.status, NAMED_OBJECT_STATUS.success);
    expectBytes(vector, eof.bytes, []);
    expectStatus(
      vector,
      first.close(firstOpen.handle).status,
      NAMED_OBJECT_STATUS.success,
    );
    expectStatus(
      vector,
      second.close(secondOpen.handle).status,
      NAMED_OBJECT_STATUS.success,
    );
    expectStatus(
      vector,
      first.close(firstOpen.handle).status,
      NAMED_OBJECT_STATUS.invalid,
    );
  }

  {
    const vector = 'tentative-abort-and-commit';
    const provider = factory.create(
      new Map([['output', Uint8Array.from([0x6f, 0x6c, 0x64])]]),
    );
    const client = new NamedObjectClient(provider);
    const discarded = client.beginWrite('output');
    expectStatus(vector, discarded.status, NAMED_OBJECT_STATUS.success);
    expectStatus(
      vector,
      client.write(discarded.handle, Uint8Array.from([0x80, 0xff])).status,
      NAMED_OBJECT_STATUS.success,
    );
    const oldReader = client.openRead('output');
    expectBytes(
      vector,
      client.read(oldReader.handle, 3).bytes,
      [0x6f, 0x6c, 0x64],
    );
    expectStatus(
      vector,
      client.close(oldReader.handle).status,
      NAMED_OBJECT_STATUS.success,
    );
    expectStatus(
      vector,
      client.abort(discarded.handle).status,
      NAMED_OBJECT_STATUS.success,
    );

    const replacement = client.beginWrite('output');
    expectStatus(
      vector,
      client.write(replacement.handle, Uint8Array.from([0x00, 0x1a, 0xff]))
        .status,
      NAMED_OBJECT_STATUS.success,
    );
    expectStatus(
      vector,
      client.commit(replacement.handle).status,
      NAMED_OBJECT_STATUS.success,
    );
    const committed = client.openRead('output');
    expectBytes(
      vector,
      client.read(committed.handle, 4).bytes,
      [0x00, 0x1a, 0xff],
    );
    expectStatus(
      vector,
      client.close(committed.handle).status,
      NAMED_OBJECT_STATUS.success,
    );
    expectStatus(
      vector,
      client.commit(replacement.handle).status,
      NAMED_OBJECT_STATUS.invalid,
    );
  }

  {
    const vector = 'rewind-and-update-read';
    const provider = factory.create(new Map());
    const client = new NamedObjectClient(provider);
    const writer = client.beginWrite('work');
    expectStatus(
      vector,
      client.write(writer.handle, Uint8Array.from([1, 2, 3])).status,
      NAMED_OBJECT_STATUS.success,
    );
    expectStatus(
      vector,
      client.rewind(writer.handle).status,
      NAMED_OBJECT_STATUS.success,
    );
    expectBytes(vector, client.read(writer.handle, 3).bytes, [1, 2, 3]);
    expectStatus(
      vector,
      client.abort(writer.handle).status,
      NAMED_OBJECT_STATUS.success,
    );
  }

  {
    const vector = 'conflict-and-capacity';
    const provider = factory.create(
      new Map([['other', Uint8Array.from([1])]]),
      { maxHandles: 1 },
    );
    const client = new NamedObjectClient(provider);
    const writer = client.beginWrite('one');
    expectStatus(vector, writer.status, NAMED_OBJECT_STATUS.success);
    expectStatus(
      vector,
      client.beginWrite('one').status,
      NAMED_OBJECT_STATUS.conflict,
    );
    expectStatus(
      vector,
      client.openRead('missing').status,
      NAMED_OBJECT_STATUS.notFound,
    );
    expectStatus(
      vector,
      client.openRead('other').status,
      NAMED_OBJECT_STATUS.capacity,
    );
    expectStatus(
      vector,
      client.abort(writer.handle).status,
      NAMED_OBJECT_STATUS.success,
    );
  }

  return { vectors: 4, assertions };
};
