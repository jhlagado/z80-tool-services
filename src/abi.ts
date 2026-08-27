export const NAMED_OBJECT_ABI_VERSION = 1;
export const NAMED_OBJECT_REQUEST_SIZE = 16;

export const NAMED_OBJECT_REQUEST = {
  size: 0,
  abi: 1,
  operation: 2,
  flags: 3,
  handle: 4,
  pointer: 6,
  length: 8,
  offset: 10,
  result: 14,
} as const;

export const NAMED_OBJECT_OPERATION = {
  openRead: 0,
  beginWrite: 1,
  read: 2,
  write: 3,
  rewind: 4,
  seek: 5,
  close: 6,
  commit: 7,
  abort: 8,
} as const;

export type NamedObjectOperation =
  (typeof NAMED_OBJECT_OPERATION)[keyof typeof NAMED_OBJECT_OPERATION];

export const NAMED_OBJECT_STATUS = {
  success: 0,
  invalid: 1,
  unavailable: 2,
  notFound: 3,
  capacity: 4,
  access: 5,
  storage: 6,
  conflict: 7,
  cancelled: 8,
  unsupported: 9,
} as const;

export type NamedObjectStatus =
  (typeof NAMED_OBJECT_STATUS)[keyof typeof NAMED_OBJECT_STATUS];

export interface NamedObjectProvider {
  dispatch(memory: Uint8Array, request: number): NamedObjectStatus;
  abortAll?(): void;
}

export interface NamedObjectFailureContext {
  readonly operation: number;
  readonly handle: number;
  readonly pointer: number;
  readonly length: number;
  readonly offset: number;
}

export const readWord = (memory: Uint8Array, at: number): number =>
  memory[at]! | (memory[at + 1]! << 8);

export const writeWord = (
  memory: Uint8Array,
  at: number,
  value: number,
): void => {
  memory[at] = value & 0xff;
  memory[at + 1] = value >>> 8;
};

export const readDword = (memory: Uint8Array, at: number): number =>
  readWord(memory, at) + readWord(memory, at + 2) * 0x10000;

export const writeDword = (
  memory: Uint8Array,
  at: number,
  value: number,
): void => {
  writeWord(memory, at, value & 0xffff);
  writeWord(memory, at + 2, Math.floor(value / 0x10000));
};

export const memoryRangeIsValid = (
  memory: Uint8Array,
  pointer: number,
  length: number,
): boolean =>
  Number.isInteger(pointer) &&
  Number.isInteger(length) &&
  pointer >= 0 &&
  length >= 0 &&
  pointer + length <= memory.length;
