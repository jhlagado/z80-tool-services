/** Language-neutral finalized Z80 image materialization and rendering. */

import {
  Z80_BYTE_MAX,
  Z80_WORD_MAX,
  isUnsignedIntegerUpTo,
  z80AddressEnd,
} from './generation.js';

export interface TargetImageGeometry {
  readonly bankCount: number;
  readonly imageBase: number;
  readonly imageCapacity: number;
  readonly imageFill: number;
  readonly entryBank: number;
  readonly entryAddress: number;
}

export interface TargetImageBank {
  readonly usedLength: number;
}

export interface TargetImageOperation {
  readonly bank: number;
  readonly address: number;
  readonly bytes: Uint8Array | readonly number[];
}

export type TargetImagePatchPolicy = 'image' | 'used';

export interface TargetImageGeneration {
  readonly geometry: TargetImageGeometry;
  readonly banks: readonly TargetImageBank[];
  readonly images: readonly TargetImageOperation[];
  readonly patches: readonly TargetImageOperation[];
  /**
   * `image` requires every patched byte to have appeared in an IMAGE record.
   * `used` also permits patches into implicit fill inside the used extent.
   */
  readonly patchPolicy?: TargetImagePatchPolicy;
}

export interface MaterializedTargetImage {
  readonly geometry: TargetImageGeometry;
  readonly usedLengths: readonly number[];
  /** One image-capacity byte array per bank; use usedLengths for publication. */
  readonly banks: readonly Uint8Array[];
  /** Present only for a one-bank image. */
  readonly flatImage?: Uint8Array;
}

export interface TargetImageBankSelection {
  readonly bank?: number;
}

export interface IntelHexOptions extends TargetImageBankSelection {
  readonly lineEnding?: string;
  readonly recordBytes?: number;
}

export interface FlatTargetImageOptions {
  readonly base: number;
  readonly bytes: Uint8Array;
  readonly entryAddress?: number;
  readonly capacity?: number;
  readonly fill?: number;
}

export class TargetImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetImageError';
  }
}

const fail = (message: string): never => {
  throw new TargetImageError(message);
};

const requireInteger = (name: string, value: number, maximum: number): void => {
  if (!isUnsignedIntegerUpTo(value, maximum)) {
    fail(`${name} is outside 0..${maximum}`);
  }
};

const checkedEnd = (name: string, base: number, length: number): number => {
  requireInteger(`${name} address`, base, Z80_WORD_MAX);
  requireInteger(`${name} length`, length, Z80_WORD_MAX);
  const end = z80AddressEnd(base, length);
  return end ?? fail(`${name} wraps the Z80 address space`);
};

const selectedBank = (
  image: MaterializedTargetImage,
  requested: number | undefined,
): number => {
  if (requested === undefined) {
    if (image.banks.length !== 1) {
      fail('banked output requires an explicit bank selection');
    }
    return 0;
  }
  requireInteger('selected bank', requested, Z80_BYTE_MAX);
  if (requested >= image.banks.length) fail('selected bank is unavailable');
  return requested;
};

const normalizedBytes = (
  operation: TargetImageOperation,
  name: string,
): Uint8Array => {
  const bytes =
    operation.bytes instanceof Uint8Array
      ? operation.bytes
      : Uint8Array.from(operation.bytes);
  if (bytes.length === 0) fail(`${name} byte count must be nonzero`);
  for (const byte of operation.bytes) {
    requireInteger(`${name} byte`, byte, Z80_BYTE_MAX);
  }
  return bytes;
};

/**
 * Validate a finalized IMAGE/PATCH generation and produce exact used extents.
 *
 * This function deliberately knows nothing about symbols or relocation
 * expressions: PATCH records already contain their final bytes.
 */
export const materializeTargetImage = (
  generation: TargetImageGeneration,
): MaterializedTargetImage => {
  const { geometry } = generation;
  if (
    generation.patchPolicy !== undefined &&
    generation.patchPolicy !== 'image' &&
    generation.patchPolicy !== 'used'
  ) {
    fail('PATCH policy is invalid');
  }
  requireInteger('bank count', geometry.bankCount, Z80_BYTE_MAX);
  if (geometry.bankCount === 0) fail('bank count must be nonzero');
  requireInteger('image fill', geometry.imageFill, Z80_BYTE_MAX);
  requireInteger('image base', geometry.imageBase, Z80_WORD_MAX);
  requireInteger('image capacity', geometry.imageCapacity, Z80_WORD_MAX);
  if (geometry.imageCapacity === 0) fail('image capacity must be nonzero');
  const capacityEnd = checkedEnd(
    'image region',
    geometry.imageBase,
    geometry.imageCapacity,
  );
  requireInteger('entry bank', geometry.entryBank, Z80_BYTE_MAX);
  if (geometry.entryBank >= geometry.bankCount) {
    fail('entry bank is outside the image bank count');
  }
  requireInteger('entry address', geometry.entryAddress, Z80_WORD_MAX);
  if (
    geometry.entryAddress < geometry.imageBase ||
    geometry.entryAddress >= capacityEnd
  ) {
    fail('entry address is outside the image region');
  }
  if (generation.banks.length !== geometry.bankCount) {
    fail('bank-map count differs from the image bank count');
  }

  const usedLengths = generation.banks.map(({ usedLength }, bank) => {
    requireInteger(`bank ${bank} used length`, usedLength, Z80_WORD_MAX);
    if (usedLength > geometry.imageCapacity) {
      fail(`bank ${bank} used length exceeds image capacity`);
    }
    return usedLength;
  });
  const banks = usedLengths.map(() => {
    const bytes = new Uint8Array(geometry.imageCapacity);
    bytes.fill(geometry.imageFill);
    return bytes;
  });
  const imageIntervals = Array.from(
    { length: geometry.bankCount },
    () => [] as Array<{ readonly start: number; readonly end: number }>,
  );
  const patchIntervals = Array.from(
    { length: geometry.bankCount },
    () => [] as Array<{ readonly start: number; readonly end: number }>,
  );
  const imageEnds = new Array<number | undefined>(geometry.bankCount);

  const apply = (
    operation: TargetImageOperation,
    name: 'IMAGE' | 'PATCH',
  ): void => {
    requireInteger(`${name} bank`, operation.bank, Z80_BYTE_MAX);
    if (operation.bank >= geometry.bankCount) {
      fail(`${name} bank is outside the image bank count`);
    }
    const bytes = normalizedBytes(operation, name);
    const end = checkedEnd(name, operation.address, bytes.length);
    const usedEnd = geometry.imageBase + (usedLengths[operation.bank] ?? 0);
    if (operation.address < geometry.imageBase || end > usedEnd) {
      fail(`${name} is outside its bank used extent`);
    }
    const offset = operation.address - geometry.imageBase;
    if (name === 'IMAGE') {
      const previousEnd = imageEnds[operation.bank];
      if (previousEnd !== undefined && operation.address < previousEnd) {
        fail('IMAGE records descend or overlap within a bank');
      }
      imageEnds[operation.bank] = end;
      imageIntervals[operation.bank]?.push({
        start: operation.address,
        end,
      });
    } else {
      for (const interval of patchIntervals[operation.bank] ?? []) {
        if (operation.address < interval.end && interval.start < end) {
          fail('PATCH records overlap');
        }
      }
      if ((generation.patchPolicy ?? 'used') === 'image') {
        for (let address = operation.address; address < end; address += 1) {
          const covered = (imageIntervals[operation.bank] ?? []).some(
            (interval) => address >= interval.start && address < interval.end,
          );
          if (!covered) fail('PATCH does not target an IMAGE byte');
        }
      }
      patchIntervals[operation.bank]?.push({
        start: operation.address,
        end,
      });
    }
    banks[operation.bank]?.set(bytes, offset);
  };

  for (const operation of generation.images) apply(operation, 'IMAGE');
  for (const operation of generation.patches) apply(operation, 'PATCH');

  return Object.freeze({
    geometry: Object.freeze({ ...geometry }),
    usedLengths: Object.freeze([...usedLengths]),
    banks: Object.freeze(banks),
    ...(banks.length === 1 ? { flatImage: banks[0] } : {}),
  });
};

/** Wrap already-final flat bytes in the shared materialized-image contract. */
export const createFlatTargetImage = (
  options: FlatTargetImageOptions,
): MaterializedTargetImage => {
  const capacity = options.capacity ?? Math.max(1, options.bytes.length);
  const entryAddress = options.entryAddress ?? options.base;
  return materializeTargetImage({
    geometry: {
      bankCount: 1,
      imageBase: options.base,
      imageCapacity: capacity,
      imageFill: options.fill ?? 0,
      entryBank: 0,
      entryAddress,
    },
    banks: [{ usedLength: options.bytes.length }],
    images:
      options.bytes.length === 0
        ? []
        : [{ bank: 0, address: options.base, bytes: options.bytes }],
    patches: [],
  });
};

/** Return a copy of one exact used bank extent suitable for a raw BIN file. */
export const renderTargetBinary = (
  image: MaterializedTargetImage,
  options: TargetImageBankSelection = {},
): Uint8Array => {
  const bank = selectedBank(image, options.bank);
  return (
    image.banks[bank]?.slice(0, image.usedLengths[bank]) ??
    fail('selected bank is unavailable')
  );
};

/**
 * Return CP/M transient-program bytes. A COM file has no header: it is a raw
 * binary constrained to load and enter at $0100.
 */
export const renderTargetCpmCom = (
  image: MaterializedTargetImage,
): Uint8Array => {
  if (
    image.geometry.bankCount !== 1 ||
    image.geometry.imageBase !== 0x0100 ||
    image.geometry.entryBank !== 0 ||
    image.geometry.entryAddress !== 0x0100
  ) {
    fail('COM output requires one flat bank loaded and entered at $0100');
  }
  const bytes = renderTargetBinary(image);
  if (bytes.length > 0xff00) {
    fail('COM output exceeds the 65,280-byte CP/M transient-program range');
  }
  return bytes;
};

const hex2 = (value: number): string =>
  value.toString(16).toUpperCase().padStart(2, '0');

const intelRecord = (
  address: number,
  type: number,
  bytes: Uint8Array,
): string => {
  const values = [bytes.length, address >>> 8, address & 0xff, type, ...bytes];
  const checksum = -values.reduce((sum, byte) => sum + byte, 0) & Z80_BYTE_MAX;
  return `:${values.map(hex2).join('')}${hex2(checksum)}`;
};

/** Render one materialized bank as 16-bit-address Intel HEX. */
export const renderTargetIntelHex = (
  image: MaterializedTargetImage,
  options: IntelHexOptions = {},
): string => {
  const bank = selectedBank(image, options.bank);
  const bytes = renderTargetBinary(image, { bank });
  const recordBytes = options.recordBytes ?? 16;
  requireInteger('Intel HEX record size', recordBytes, Z80_BYTE_MAX);
  if (recordBytes === 0) fail('Intel HEX record size must be nonzero');
  const lineEnding = options.lineEnding ?? '\n';
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += recordBytes) {
    const address = geometryAddress(image, offset);
    lines.push(
      intelRecord(address, 0, bytes.slice(offset, offset + recordBytes)),
    );
  }
  lines.push(':00000001FF');
  return `${lines.join(lineEnding)}${lineEnding}`;
};

const geometryAddress = (
  image: MaterializedTargetImage,
  offset: number,
): number => {
  const address = image.geometry.imageBase + offset;
  if (address > Z80_WORD_MAX) fail('Intel HEX address exceeds 16 bits');
  return address;
};
