/** Strict host decoder and common semantic model for NOBJ 1.0 objects. */

import { nobjCrc16CcittFalse } from './nobj-framing.js';

export const NOBJ1_KIND = Object.freeze({
  begin: 0x01,
  contract: 0x02,
  region: 0x03,
  section: 0x04,
  range: 0x05,
  image: 0x06,
  patch: 0x07,
  symbol: 0x08,
  relocation: 0x09,
  metadata: 0x0a,
  layout: 0x0b,
  commit: 0x0c,
} as const);

export const NOBJ1_PERMISSION = Object.freeze({
  read: 0x01,
  write: 0x02,
  execute: 0x04,
} as const);

export type Nobj1ValueKind = 1 | 2 | 3;
export type Nobj1Binding = 'local' | 'export' | 'import' | 'service-import';

export interface Nobj1Begin {
  readonly targetId: number;
}

export interface Nobj1Contract {
  readonly id: number;
  readonly key: string;
  readonly majorVersion: number;
  readonly minorVersion: number;
  readonly data: Uint8Array;
}

export interface Nobj1Region {
  readonly id: number;
  readonly addressSpaceKey: string;
  readonly storageKey: string;
  readonly base: number;
  readonly capacity: number;
  readonly imageFill: number;
  readonly permissions: number;
  readonly banked: boolean;
}

export type Nobj1StorageKind = 1 | 2 | 3;
export type Nobj1RunPlacement = 'fixed' | 'allocate';
export type Nobj1LoadPlacement = 'same' | 'fixed' | 'allocate';

export interface Nobj1Section {
  readonly id: number;
  readonly storageKind: Nobj1StorageKind;
  readonly permissions: number;
  readonly alignment: number;
  readonly length: number;
  readonly runRegionId: number;
  readonly runPlacement: Nobj1RunPlacement;
  readonly runOffset: number;
  readonly loadPlacement?: Nobj1LoadPlacement;
  readonly loadRegionId?: number;
  readonly loadOffset?: number;
  readonly fill?: number;
}

export interface Nobj1Range {
  readonly id: number;
  readonly sectionId: number;
  readonly view: 'run' | 'load';
  readonly offset: number;
  readonly length: number;
}

export interface Nobj1ImageRecord {
  readonly sectionId: number;
  readonly offset: number;
  readonly bytes: Uint8Array;
}

export type Nobj1Symbol =
  | Readonly<{
      id: number;
      binding: 'local';
      valueKind: Nobj1ValueKind;
      sectionId: number;
      offset: number;
    }>
  | Readonly<{
      id: number;
      binding: 'export';
      valueKind: Nobj1ValueKind;
      sectionId: number;
      offset: number;
      namespace: string;
      name: string;
    }>
  | Readonly<{
      id: number;
      binding: 'import';
      valueKind: Nobj1ValueKind;
      namespace: string;
      name: string;
    }>
  | Readonly<{
      id: number;
      binding: 'service-import';
      valueKind: Nobj1ValueKind;
      contractId: number;
      serviceKey: string;
    }>;

export interface Nobj1Relocation {
  readonly siteSectionId: number;
  readonly siteOffset: number;
  readonly kind: 1 | 2;
  readonly use: 1 | 2 | 3;
  readonly targetSymbolId: number;
  readonly addend: number;
}

export interface Nobj1Metadata {
  readonly key: string;
  readonly majorVersion: number;
  readonly minorVersion: number;
  readonly data: Uint8Array;
}

export interface Nobj1Layout {
  readonly mode: 'module' | 'placed';
  readonly entrySymbolId: number;
}

export interface Nobj1Commit {
  readonly recordCount: number;
  readonly layoutMode: 'module' | 'placed';
  readonly entrySymbolId: number;
  readonly crc16: number;
}

export interface Nobj1Object {
  readonly serialized: Uint8Array;
  readonly begin: Nobj1Begin;
  readonly contracts: readonly Nobj1Contract[];
  readonly regions: readonly Nobj1Region[];
  readonly sections: readonly Nobj1Section[];
  readonly ranges: readonly Nobj1Range[];
  readonly images: readonly Nobj1ImageRecord[];
  readonly patches: readonly Nobj1ImageRecord[];
  readonly symbols: readonly Nobj1Symbol[];
  readonly relocations: readonly Nobj1Relocation[];
  readonly metadata: readonly Nobj1Metadata[];
  readonly layout: Nobj1Layout;
  readonly commit: Nobj1Commit;
}

export class Nobj1Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Nobj1Error';
  }
}

interface RawRecord {
  readonly kind: number;
  readonly start: number;
  readonly payloadStart: number;
  readonly payload: Uint8Array;
}

interface PhysicalExtent {
  readonly sectionId: number;
  readonly addressSpaceKey: string;
  readonly storageKey: string;
  readonly start: number;
  readonly end: number;
}

const fail = (message: string): never => {
  throw new Nobj1Error(message);
};

const required = <T>(value: T | undefined, message: string): T =>
  value ?? fail(message);

const byteAt = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] ?? fail('NOBJ 1.0 field is truncated');

const readU16 = (bytes: Uint8Array, offset: number): number =>
  byteAt(bytes, offset) | (byteAt(bytes, offset + 1) << 8);

const readU32 = (bytes: Uint8Array, offset: number): number =>
  byteAt(bytes, offset) +
  byteAt(bytes, offset + 1) * 0x100 +
  byteAt(bytes, offset + 2) * 0x1_0000 +
  byteAt(bytes, offset + 3) * 0x1_000000;

const readI32 = (bytes: Uint8Array, offset: number): number => {
  const value = readU32(bytes, offset);
  return value >= 0x8000_0000 ? value - 0x1_0000_0000 : value;
};

const decodeRecords = (serialized: Uint8Array): RawRecord[] => {
  if (!(serialized instanceof Uint8Array)) {
    return fail('NOBJ input must be bytes');
  }
  const records: RawRecord[] = [];
  let cursor = 0;
  while (cursor < serialized.length) {
    if (serialized.length - cursor < 3) {
      fail('NOBJ 1.0 has a truncated record header');
    }
    const kind = byteAt(serialized, cursor);
    if (kind < NOBJ1_KIND.begin || kind > NOBJ1_KIND.commit) {
      fail(`NOBJ 1.0 reserved record kind ${kind.toString(16)}`);
    }
    const length = readU16(serialized, cursor + 1);
    const payloadStart = cursor + 3;
    const payloadEnd = payloadStart + length;
    if (payloadEnd > serialized.length) {
      fail('NOBJ 1.0 has a truncated record payload');
    }
    records.push({
      kind,
      start: cursor,
      payloadStart,
      payload: serialized.slice(payloadStart, payloadEnd),
    });
    cursor = payloadEnd;
    if (kind === NOBJ1_KIND.commit && cursor !== serialized.length) {
      fail('NOBJ 1.0 contains bytes after COMMIT');
    }
  }
  if (records.length === 0) fail('NOBJ 1.0 stream is empty');
  return records;
};

const requireLength = (
  record: RawRecord,
  length: number,
  name: string,
): void => {
  if (record.payload.length !== length) {
    fail(`${name} payload length is invalid`);
  }
};

const decodeName = (
  bytes: Uint8Array,
  offset: number,
  length: number,
  name: string,
): string => {
  if (length < 1 || length > 63 || offset + length > bytes.length) {
    fail(`${name} length is outside 1..63`);
  }
  let value = '';
  for (let index = offset; index < offset + length; index += 1) {
    const byte = byteAt(bytes, index);
    if (byte > 0x7f) fail(`${name} is not ASCII`);
    value += String.fromCharCode(byte);
  }
  return value;
};

const requireKey = (value: string, name: string): void => {
  if (!/^[a-z0-9][a-z0-9._/-]{0,62}$/.test(value)) {
    fail(`${name} is not a canonical NOBJ 1.0 key`);
  }
};

const requireSymbolName = (value: string, name: string): void => {
  if (!/^[A-Za-z_.$][A-Za-z0-9_.$/-]{0,62}$/.test(value)) {
    fail(`${name} is not a canonical NOBJ 1.0 symbol name`);
  }
};

const requireServiceKey = (value: string): void => {
  if (!/^[a-z][a-z0-9_.-]{0,62}$/.test(value)) {
    fail('service key is not canonical');
  }
};

const decodeBegin = (record: RawRecord): Nobj1Begin => {
  requireLength(record, 9, 'BEGIN');
  const { payload } = record;
  if (
    payload[0] !== 0x4e ||
    payload[1] !== 0x4f ||
    payload[2] !== 0x42 ||
    payload[3] !== 0x4a
  ) {
    fail('BEGIN magic is not NOBJ');
  }
  if (payload[4] !== 1 || payload[5] !== 0) {
    fail('NOBJ version is not 1.0');
  }
  const targetId = readU16(payload, 6);
  if (targetId !== 1) fail('NOBJ target is not the 16-bit Z80 target');
  if (payload[8] !== 0) fail('BEGIN flags are reserved');
  return Object.freeze({ targetId });
};

const decodeContract = (record: RawRecord): Nobj1Contract => {
  const { payload } = record;
  if (payload.length < 10) fail('CONTRACT payload is truncated');
  const id = readU16(payload, 0);
  const keyLength = byteAt(payload, 2);
  const key = decodeName(payload, 3, keyLength, 'contract key');
  requireKey(key, 'contract key');
  const versionOffset = 3 + keyLength;
  if (payload.length < versionOffset + 6) {
    fail('CONTRACT version and data fields are truncated');
  }
  const majorVersion = readU16(payload, versionOffset);
  const minorVersion = readU16(payload, versionOffset + 2);
  const dataLength = readU16(payload, versionOffset + 4);
  if (payload.length !== versionOffset + 6 + dataLength) {
    fail('CONTRACT data length does not match its payload');
  }
  return Object.freeze({
    id,
    key,
    majorVersion,
    minorVersion,
    data: payload.slice(versionOffset + 6),
  });
};

const decodeRegion = (record: RawRecord): Nobj1Region => {
  const { payload } = record;
  if (payload.length < 15) fail('REGION payload is truncated');
  const id = readU16(payload, 0);
  const addressSpaceLength = byteAt(payload, 2);
  const addressSpaceKey = decodeName(
    payload,
    3,
    addressSpaceLength,
    'address-space key',
  );
  requireKey(addressSpaceKey, 'address-space key');
  const storageLengthOffset = 3 + addressSpaceLength;
  const storageLength = byteAt(payload, storageLengthOffset);
  const storageKey = decodeName(
    payload,
    storageLengthOffset + 1,
    storageLength,
    'storage key',
  );
  requireKey(storageKey, 'storage key');
  const fields = storageLengthOffset + 1 + storageLength;
  if (payload.length !== fields + 9) {
    fail('REGION payload length is invalid');
  }
  const base = readU16(payload, fields);
  const capacity = readU32(payload, fields + 2);
  const imageFill = byteAt(payload, fields + 6);
  const permissions = byteAt(payload, fields + 7);
  const flags = byteAt(payload, fields + 8);
  if (capacity === 0 || base + capacity > 0x1_0000) {
    fail('REGION extent is empty or wraps the Z80 address space');
  }
  if (permissions === 0 || (permissions & ~0x07) !== 0) {
    fail('REGION permissions are invalid');
  }
  if ((flags & ~0x01) !== 0) fail('REGION flags are reserved');
  return Object.freeze({
    id,
    addressSpaceKey,
    storageKey,
    base,
    capacity,
    imageFill,
    permissions,
    banked: (flags & 1) !== 0,
  });
};

const decodeSection = (record: RawRecord): Nobj1Section => {
  const { payload } = record;
  if (payload.length !== 17 && payload.length !== 25) {
    fail('SECTION payload length is invalid');
  }
  const id = readU16(payload, 0);
  const storageKind = byteAt(payload, 2);
  if (storageKind < 1 || storageKind > 3) {
    fail('SECTION storage kind is invalid');
  }
  const permissions = byteAt(payload, 3);
  if ((permissions & ~0x07) !== 0) fail('SECTION permissions are reserved');
  const alignment = readU16(payload, 4);
  if (
    alignment === 0 ||
    alignment > 32768 ||
    (alignment & (alignment - 1)) !== 0
  ) {
    fail('SECTION alignment is not a power of two in 1..32768');
  }
  const length = readU32(payload, 6);
  if (length === 0) fail('SECTION length must be nonzero');
  const runRegionId = readU16(payload, 10);
  const runMode = byteAt(payload, 12);
  if (runMode > 1) fail('SECTION run placement is invalid');
  const runOffset = readU32(payload, 13);
  if (runMode === 1 && runOffset !== 0) {
    fail('allocated SECTION run offset must be zero');
  }
  if (storageKind !== 1) {
    if (payload.length !== 17) {
      fail('zero-initialized and reserved SECTION records have no LOAD fields');
    }
    return Object.freeze({
      id,
      storageKind: storageKind as Nobj1StorageKind,
      permissions,
      alignment,
      length,
      runRegionId,
      runPlacement: runMode === 0 ? 'fixed' : 'allocate',
      runOffset,
    });
  }
  if (payload.length !== 25) {
    fail('initialized SECTION lacks its LOAD fields');
  }
  const loadMode = byteAt(payload, 17);
  if (loadMode > 2) fail('SECTION load placement is invalid');
  const loadRegionId = readU16(payload, 18);
  const loadOffset = readU32(payload, 20);
  if (loadMode !== 1 && loadOffset !== 0) {
    fail('same or allocated SECTION load offset must be zero');
  }
  return Object.freeze({
    id,
    storageKind: 1,
    permissions,
    alignment,
    length,
    runRegionId,
    runPlacement: runMode === 0 ? 'fixed' : 'allocate',
    runOffset,
    loadPlacement:
      loadMode === 0 ? 'same' : loadMode === 1 ? 'fixed' : 'allocate',
    loadRegionId,
    loadOffset,
    fill: byteAt(payload, 24),
  });
};

const decodeRange = (record: RawRecord): Nobj1Range => {
  requireLength(record, 13, 'RANGE');
  const { payload } = record;
  const view = byteAt(payload, 4);
  if (view > 1) fail('RANGE view is invalid');
  return Object.freeze({
    id: readU16(payload, 0),
    sectionId: readU16(payload, 2),
    view: view === 0 ? 'run' : 'load',
    offset: readU32(payload, 5),
    length: readU32(payload, 9),
  });
};

const decodeImage = (record: RawRecord, name: string): Nobj1ImageRecord => {
  if (record.payload.length < 7) {
    fail(`${name} must contain at least one data byte`);
  }
  return Object.freeze({
    sectionId: readU16(record.payload, 0),
    offset: readU32(record.payload, 2),
    bytes: record.payload.slice(6),
  });
};

const decodeSymbol = (record: RawRecord): Nobj1Symbol => {
  const { payload } = record;
  if (payload.length < 4) fail('SYMBOL payload is truncated');
  const id = readU16(payload, 0);
  const bindingValue = byteAt(payload, 2);
  const valueKind = byteAt(payload, 3);
  if (valueKind < 1 || valueKind > 3) fail('SYMBOL value kind is invalid');
  const common = {
    id,
    valueKind: valueKind as Nobj1ValueKind,
  };
  if (bindingValue === 0 || bindingValue === 1) {
    if (payload.length < 10) fail('SYMBOL definition is truncated');
    const sectionId = readU16(payload, 4);
    const offset = readU32(payload, 6);
    if (bindingValue === 0) {
      requireLength(record, 10, 'local SYMBOL');
      return Object.freeze({ ...common, binding: 'local', sectionId, offset });
    }
    if (payload.length < 12) fail('export SYMBOL names are truncated');
    const namespaceLength = byteAt(payload, 10);
    const namespace = decodeName(
      payload,
      11,
      namespaceLength,
      'symbol namespace',
    );
    requireKey(namespace, 'symbol namespace');
    const nameLengthOffset = 11 + namespaceLength;
    const nameLength = byteAt(payload, nameLengthOffset);
    const name = decodeName(
      payload,
      nameLengthOffset + 1,
      nameLength,
      'symbol name',
    );
    requireSymbolName(name, 'symbol name');
    requireLength(record, 12 + namespaceLength + nameLength, 'export SYMBOL');
    return Object.freeze({
      ...common,
      binding: 'export',
      sectionId,
      offset,
      namespace,
      name,
    });
  }
  if (bindingValue === 2) {
    if (payload.length < 6) fail('import SYMBOL names are truncated');
    const namespaceLength = byteAt(payload, 4);
    const namespace = decodeName(
      payload,
      5,
      namespaceLength,
      'symbol namespace',
    );
    requireKey(namespace, 'symbol namespace');
    const nameLengthOffset = 5 + namespaceLength;
    const nameLength = byteAt(payload, nameLengthOffset);
    const name = decodeName(
      payload,
      nameLengthOffset + 1,
      nameLength,
      'symbol name',
    );
    requireSymbolName(name, 'symbol name');
    requireLength(record, 6 + namespaceLength + nameLength, 'import SYMBOL');
    return Object.freeze({ ...common, binding: 'import', namespace, name });
  }
  if (bindingValue === 3) {
    if (payload.length < 8) fail('service-import SYMBOL is truncated');
    const contractId = readU16(payload, 4);
    const keyLength = byteAt(payload, 6);
    const serviceKey = decodeName(payload, 7, keyLength, 'service key');
    requireServiceKey(serviceKey);
    requireLength(record, 7 + keyLength, 'service-import SYMBOL');
    return Object.freeze({
      ...common,
      binding: 'service-import',
      contractId,
      serviceKey,
    });
  }
  return fail('SYMBOL binding is invalid');
};

const decodeRelocation = (record: RawRecord): Nobj1Relocation => {
  requireLength(record, 14, 'RELOC');
  const { payload } = record;
  const kind = byteAt(payload, 6);
  const use = byteAt(payload, 7);
  if (kind < 1 || kind > 2) fail('RELOC kind is invalid');
  if (use < 1 || use > 3) fail('RELOC use is invalid');
  return Object.freeze({
    siteSectionId: readU16(payload, 0),
    siteOffset: readU32(payload, 2),
    kind: kind as 1 | 2,
    use: use as 1 | 2 | 3,
    targetSymbolId: readU16(payload, 8),
    addend: readI32(payload, 10),
  });
};

const decodeMetadata = (record: RawRecord): Nobj1Metadata => {
  const { payload } = record;
  if (payload.length < 9) fail('METADATA payload is truncated');
  const keyLength = byteAt(payload, 0);
  const key = decodeName(payload, 1, keyLength, 'metadata key');
  requireKey(key, 'metadata key');
  const versionOffset = 1 + keyLength;
  if (payload.length < versionOffset + 7) {
    fail('METADATA version and data fields are truncated');
  }
  const majorVersion = readU16(payload, versionOffset);
  const minorVersion = readU16(payload, versionOffset + 2);
  const flags = byteAt(payload, versionOffset + 4);
  if (flags !== 0) fail('METADATA flags are reserved');
  const dataLength = readU16(payload, versionOffset + 5);
  if (payload.length !== versionOffset + 7 + dataLength) {
    fail('METADATA data length does not match its payload');
  }
  return Object.freeze({
    key,
    majorVersion,
    minorVersion,
    data: payload.slice(versionOffset + 7),
  });
};

const decodeLayout = (record: RawRecord): Nobj1Layout => {
  requireLength(record, 4, 'LAYOUT');
  const { payload } = record;
  const mode = byteAt(payload, 0);
  if (mode > 1) fail('LAYOUT mode is invalid');
  if (payload[1] !== 0) fail('LAYOUT flags are reserved');
  return Object.freeze({
    mode: mode === 0 ? 'module' : 'placed',
    entrySymbolId: readU16(payload, 2),
  });
};

const requireIncreasingIds = <T>(
  values: readonly T[],
  selectId: (value: T) => number,
  name: string,
): void => {
  let previous = 0;
  for (const value of values) {
    const id = selectId(value);
    if (id === 0 || id <= previous) {
      fail(`${name} IDs must be nonzero and strictly increasing`);
    }
    previous = id;
  }
};

const physicalKey = (region: Nobj1Region): string =>
  `${region.addressSpaceKey}\0${region.storageKey}`;

const validateRegions = (regions: readonly Nobj1Region[]): void => {
  requireIncreasingIds(regions, ({ id }) => id, 'REGION');
  for (let leftIndex = 0; leftIndex < regions.length; leftIndex += 1) {
    const left = regions[leftIndex];
    if (left === undefined) continue;
    const leftEnd = left.base + left.capacity;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < regions.length;
      rightIndex += 1
    ) {
      const right = regions[rightIndex];
      if (right === undefined || physicalKey(left) !== physicalKey(right))
        continue;
      const overlaps =
        left.base < right.base + right.capacity && right.base < leftEnd;
      if (overlaps && left.imageFill !== right.imageFill) {
        fail('overlapping REGION aliases disagree about image fill');
      }
    }
  }
};

const extentFor = (
  name: string,
  region: Nobj1Region,
  offset: number,
  length: number,
): PhysicalExtent => {
  if (offset + length > region.capacity) {
    fail(`${name} does not fit its REGION`);
  }
  const start = region.base + offset;
  const end = start + length;
  if (end > 0x1_0000) fail(`${name} wraps the Z80 address space`);
  return {
    sectionId: 0,
    addressSpaceKey: region.addressSpaceKey,
    storageKey: region.storageKey,
    start,
    end,
  };
};

const validateSections = (
  sections: readonly Nobj1Section[],
  regions: ReadonlyMap<number, Nobj1Region>,
  layout: Nobj1Layout,
): void => {
  requireIncreasingIds(sections, ({ id }) => id, 'SECTION');
  const allocations: PhysicalExtent[] = [];
  for (const section of sections) {
    const runRegion = required(
      regions.get(section.runRegionId),
      'SECTION references an unknown run REGION',
    );
    if ((section.permissions & runRegion.permissions) !== section.permissions) {
      fail('SECTION requests run permissions absent from its REGION');
    }
    if (section.storageKind === 2 && (runRegion.permissions & 2) === 0) {
      fail('zero-initialized SECTION requires writable run storage');
    }
    if (section.length > runRegion.capacity) {
      fail('SECTION cannot fit its run REGION');
    }
    if (section.runPlacement === 'fixed') {
      const extent = extentFor(
        'SECTION run extent',
        runRegion,
        section.runOffset,
        section.length,
      );
      const absolute = runRegion.base + section.runOffset;
      if (absolute % section.alignment !== 0) {
        fail('fixed SECTION run address violates alignment');
      }
      allocations.push({ ...extent, sectionId: section.id });
    } else {
      const firstAlignedOffset =
        (section.alignment - (runRegion.base % section.alignment)) %
        section.alignment;
      if (firstAlignedOffset + section.length > runRegion.capacity) {
        fail('allocated SECTION cannot meet alignment in its run REGION');
      }
      if (layout.mode === 'placed') {
        fail('placed LAYOUT contains an allocated run SECTION');
      }
    }

    if (section.storageKind !== 1) continue;
    const loadRegion = required(
      section.loadRegionId === undefined
        ? undefined
        : regions.get(section.loadRegionId),
      'initialized SECTION references an unknown load REGION',
    );
    if ((loadRegion.permissions & 1) === 0) {
      fail('initialized SECTION load REGION is not readable');
    }
    if (section.length > loadRegion.capacity) {
      fail('SECTION cannot fit its load REGION');
    }
    let loadPlacement = section.loadPlacement;
    let loadOffset = section.loadOffset;
    if (loadPlacement === 'same') {
      if (loadRegion.id !== runRegion.id || loadOffset !== 0) {
        fail('same-as-run LOAD placement disagrees with its run REGION');
      }
      loadPlacement = section.runPlacement === 'fixed' ? 'fixed' : 'allocate';
      loadOffset = section.runOffset;
    }
    if (loadPlacement === 'fixed') {
      const extent = extentFor(
        'SECTION load extent',
        loadRegion,
        loadOffset ?? 0,
        section.length,
      );
      const absolute = loadRegion.base + (loadOffset ?? 0);
      if (absolute % section.alignment !== 0) {
        fail('fixed SECTION load address violates alignment');
      }
      allocations.push({ ...extent, sectionId: section.id });
    } else {
      const firstAlignedOffset =
        (section.alignment - (loadRegion.base % section.alignment)) %
        section.alignment;
      if (firstAlignedOffset + section.length > loadRegion.capacity) {
        fail('allocated SECTION cannot meet alignment in its load REGION');
      }
      if (layout.mode === 'placed') {
        fail('placed LAYOUT contains an allocated load SECTION');
      }
    }
  }

  for (let leftIndex = 0; leftIndex < allocations.length; leftIndex += 1) {
    const left = allocations[leftIndex];
    if (left === undefined) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < allocations.length;
      rightIndex += 1
    ) {
      const right = allocations[rightIndex];
      if (
        right === undefined ||
        left.addressSpaceKey !== right.addressSpaceKey ||
        left.storageKey !== right.storageKey ||
        left.start >= right.end ||
        right.start >= left.end
      ) {
        continue;
      }
      if (
        left.sectionId === right.sectionId &&
        left.start === right.start &&
        left.end === right.end
      ) {
        continue;
      }
      fail('SECTION allocations overlap in physical storage');
    }
  }
};

const validateRanges = (
  ranges: readonly Nobj1Range[],
  sections: ReadonlyMap<number, Nobj1Section>,
): void => {
  requireIncreasingIds(ranges, ({ id }) => id, 'RANGE');
  for (const range of ranges) {
    const section = required(
      sections.get(range.sectionId),
      'RANGE references an unknown SECTION',
    );
    if (range.length === 0 || range.offset + range.length > section.length) {
      fail('RANGE is empty or extends beyond its SECTION');
    }
    if (range.view === 'load' && section.storageKind !== 1) {
      fail('LOAD RANGE requires initialized storage');
    }
  }
};

const validateImagesAndPatches = (
  images: readonly Nobj1ImageRecord[],
  patches: readonly Nobj1ImageRecord[],
  sections: ReadonlyMap<number, Nobj1Section>,
): void => {
  const previousImageEnd = new Map<number, number>();
  for (const image of images) {
    const section = required(
      sections.get(image.sectionId),
      'IMAGE references an unknown SECTION',
    );
    if (section.storageKind !== 1)
      fail('IMAGE requires an initialized SECTION');
    const end = image.offset + image.bytes.length;
    if (end > section.length) fail('IMAGE extends beyond its SECTION');
    const previousEnd = previousImageEnd.get(image.sectionId);
    if (previousEnd !== undefined && image.offset < previousEnd) {
      fail('IMAGE records descend or overlap within a SECTION');
    }
    previousImageEnd.set(image.sectionId, end);
  }
  for (let leftIndex = 0; leftIndex < patches.length; leftIndex += 1) {
    const left = patches[leftIndex];
    if (left === undefined) continue;
    const section = required(
      sections.get(left.sectionId),
      'PATCH references an unknown SECTION',
    );
    if (section.storageKind !== 1)
      fail('PATCH requires an initialized SECTION');
    const leftEnd = left.offset + left.bytes.length;
    if (leftEnd > section.length) fail('PATCH extends beyond its SECTION');
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < patches.length;
      rightIndex += 1
    ) {
      const right = patches[rightIndex];
      if (right === undefined || right.sectionId !== left.sectionId) continue;
      const rightEnd = right.offset + right.bytes.length;
      if (left.offset < rightEnd && right.offset < leftEnd) {
        fail('PATCH records overlap within a SECTION');
      }
    }
  }
};

const symbolDefinition = (
  symbol: Nobj1Symbol,
): symbol is Extract<Nobj1Symbol, { sectionId: number; offset: number }> =>
  symbol.binding === 'local' || symbol.binding === 'export';

const requireSymbolDefinition = (
  symbol: Nobj1Symbol,
  message: string,
): Extract<Nobj1Symbol, { sectionId: number; offset: number }> =>
  symbolDefinition(symbol) ? symbol : fail(message);

const qualifiedName = (symbol: Nobj1Symbol): string | undefined =>
  symbol.binding === 'export' || symbol.binding === 'import'
    ? `${symbol.namespace}\0${symbol.name}`
    : undefined;

const validateSymbols = (
  symbols: readonly Nobj1Symbol[],
  sections: ReadonlyMap<number, Nobj1Section>,
  contracts: ReadonlyMap<number, Nobj1Contract>,
): void => {
  requireIncreasingIds(symbols, ({ id }) => id, 'SYMBOL');
  const exports = new Set<string>();
  for (const symbol of symbols) {
    if (symbolDefinition(symbol)) {
      const section = required(
        sections.get(symbol.sectionId),
        'SYMBOL definition references an unknown SECTION',
      );
      if (symbol.offset > section.length)
        fail('SYMBOL offset exceeds its SECTION');
      if (symbol.valueKind === 3) {
        if (symbol.offset > section.length) {
          fail('BOUNDARY SYMBOL lies beyond the SECTION exclusive end');
        }
      } else if (symbol.offset === section.length) {
        fail('CODE and ADDRESS symbols must identify a byte in their SECTION');
      }
      if (
        symbol.valueKind === 1 &&
        (section.storageKind !== 1 || (section.permissions & 4) === 0)
      ) {
        fail('CODE SYMBOL requires initialized executable storage');
      }
      const externalName = qualifiedName(symbol);
      if (symbol.binding === 'export' && externalName !== undefined) {
        if (exports.has(externalName)) fail('duplicate qualified export');
        exports.add(externalName);
      }
    } else if (symbol.binding === 'service-import') {
      if (symbol.valueKind !== 1)
        fail('service import must have CODE value kind');
      if (!contracts.has(symbol.contractId)) {
        fail('service import references an unknown CONTRACT');
      }
    }
  }
};

const validateRelocations = (
  relocations: readonly Nobj1Relocation[],
  patches: readonly Nobj1ImageRecord[],
  sections: ReadonlyMap<number, Nobj1Section>,
  symbols: ReadonlyMap<number, Nobj1Symbol>,
): void => {
  const sites = new Map<number, Array<{ start: number; end: number }>>();
  for (const relocation of relocations) {
    const section = required(
      sections.get(relocation.siteSectionId),
      'RELOC references an unknown source SECTION',
    );
    if (section.storageKind !== 1)
      fail('RELOC site requires an initialized SECTION');
    const end = relocation.siteOffset + 2;
    if (end > section.length) fail('RELOC site extends beyond its SECTION');
    const target = required(
      symbols.get(relocation.targetSymbolId),
      'RELOC references an unknown SYMBOL',
    );
    if (!(
      (relocation.kind === 1 &&
        relocation.use === 1 &&
        target.valueKind === 1) ||
      (relocation.kind === 1 &&
        relocation.use === 2 &&
        (target.valueKind === 2 || target.valueKind === 3)) ||
      (relocation.kind === 2 && relocation.use === 3 && target.valueKind === 2)
    )) {
      fail('RELOC kind, use and target value kind are incompatible');
    }
    const intervals = sites.get(relocation.siteSectionId) ?? [];
    for (const site of intervals) {
      if (relocation.siteOffset < site.end && site.start < end) {
        fail('RELOC sites overlap');
      }
    }
    intervals.push({ start: relocation.siteOffset, end });
    sites.set(relocation.siteSectionId, intervals);
  }
  for (const patch of patches) {
    const patchEnd = patch.offset + patch.bytes.length;
    for (const site of sites.get(patch.sectionId) ?? []) {
      if (patch.offset < site.end && site.start < patchEnd) {
        fail('PATCH overlaps a RELOC site');
      }
    }
  }
};

const validateMetadata = (
  metadata: readonly Nobj1Metadata[],
  regions: ReadonlyMap<number, Nobj1Region>,
): void => {
  for (let index = 0; index < metadata.length; index += 1) {
    const current = metadata[index];
    const previous = metadata[index - 1];
    if (current === undefined) continue;
    if (previous !== undefined) {
      const keyOrder =
        current.key < previous.key ? -1 : current.key > previous.key ? 1 : 0;
      const order =
        keyOrder ||
        current.majorVersion - previous.majorVersion ||
        current.minorVersion - previous.minorVersion;
      if (order <= 0) {
        fail('METADATA records are not in canonical schema/version order');
      }
    }
    if (
      current.key === 'org.nobj.source-parts' &&
      current.majorVersion === 1 &&
      current.minorVersion === 0
    ) {
      if (current.data.length < 2) fail('source-parts metadata is truncated');
      const count = readU16(current.data, 0);
      if (current.data.length !== 2 + count * 2) {
        fail('source-parts metadata length does not match its count');
      }
      for (let part = 0; part < count; part += 1) {
        if (!regions.has(readU16(current.data, 2 + part * 2))) {
          fail('source-parts metadata references an unknown REGION');
        }
      }
    }
    if (
      current.key === 'org.atom.final-cursor' &&
      current.majorVersion === 1 &&
      current.minorVersion === 0
    ) {
      if (current.data.length !== 6)
        fail('atom final-cursor metadata has invalid length');
      const regionId = readU16(current.data, 0);
      const region = required(
        regions.get(regionId),
        'atom final-cursor metadata references an unknown REGION',
      );
      const cursor = readU32(current.data, 2);
      if (cursor < region.base || cursor > region.base + region.capacity) {
        fail('atom final cursor is outside its REGION');
      }
    }
  }
};

const validateContracts = (
  contracts: readonly Nobj1Contract[],
  ranges: ReadonlyMap<number, Nobj1Range>,
  sections: ReadonlyMap<number, Nobj1Section>,
  symbols: ReadonlyMap<number, Nobj1Symbol>,
  regions: ReadonlyMap<number, Nobj1Region>,
  metadata: readonly Nobj1Metadata[],
  layout: Nobj1Layout,
  relocations: readonly Nobj1Relocation[],
): void => {
  const versions = new Set<string>();
  for (const contract of contracts) {
    const versionKey = `${contract.key}\0${contract.majorVersion}\0${contract.minorVersion}`;
    if (versions.has(versionKey)) {
      fail('duplicate CONTRACT key and version');
    }
    versions.add(versionKey);
    if (
      contract.key === 'org.skate.value' &&
      contract.majorVersion === 2 &&
      contract.minorVersion === 0
    ) {
      if (contract.data.length !== 0)
        fail('Skate value ABI 2.0 payload must be empty');
    }
    if (
      contract.key === 'org.skate.runtime' &&
      contract.majorVersion === 2 &&
      contract.minorVersion === 0
    ) {
      if (contract.data.length !== 4)
        fail('Skate runtime ABI 2.0 payload must be four bytes');
      const descriptorRangeId = readU16(contract.data, 0);
      const topLevelEntrySymbolId = readU16(contract.data, 2);
      if (descriptorRangeId !== 0) {
        const range = ranges.get(descriptorRangeId);
        const section =
          range === undefined ? undefined : sections.get(range.sectionId);
        if (
          range === undefined ||
          range.view !== 'run' ||
          range.length !== 40 ||
          section?.storageKind !== 1
        ) {
          fail('Skate boot descriptor contract range is invalid');
        }
      }
      if (topLevelEntrySymbolId !== 0) {
        const symbol = symbols.get(topLevelEntrySymbolId);
        if (symbol === undefined || symbol.valueKind !== 1) {
          fail('Skate runtime contract entry symbol is invalid');
        }
      }
    }
    if (
      contract.key === 'org.nucleus.runtime' &&
      contract.majorVersion === 0 &&
      contract.minorVersion === 1
    ) {
      validateNucleusContract(
        contract,
        ranges,
        sections,
        symbols,
        regions,
        metadata,
        layout,
        relocations,
      );
    }
  }
};

const validateNucleusContract = (
  contract: Nobj1Contract,
  ranges: ReadonlyMap<number, Nobj1Range>,
  sections: ReadonlyMap<number, Nobj1Section>,
  symbols: ReadonlyMap<number, Nobj1Symbol>,
  regions: ReadonlyMap<number, Nobj1Region>,
  metadata: readonly Nobj1Metadata[],
  layout: Nobj1Layout,
  relocations: readonly Nobj1Relocation[],
): void => {
  if (contract.data.length < 28) fail('Nucleus runtime contract is truncated');
  const { data } = contract;
  const bankCount = byteAt(data, 21);
  if (bankCount === 0 || data.length !== 22 + bankCount * 6) {
    fail('Nucleus runtime contract bank table length is invalid');
  }
  const runtimeIdentity = readU16(data, 0);
  const flags = byteAt(data, 2);
  if ((flags & ~3) !== 0) fail('Nucleus runtime contract flags are reserved');
  const entrySymbolId = readU16(data, 3);
  const writableRegionId = readU16(data, 5);
  const startupRangeId = readU16(data, 7);
  const vectorRangeId = readU16(data, 9);
  const runtimeStateRangeId = readU16(data, 11);
  const initializedRunRangeId = readU16(data, 13);
  const initializedLoadRangeId = readU16(data, 15);
  const bssRangeId = readU16(data, 17);
  const stackRequirement = readU16(data, 19);
  const romMode = (flags & 1) !== 0;
  const establishedStack = (flags & 2) !== 0;
  const writableRegion = required(
    regions.get(writableRegionId),
    'Nucleus runtime contract references an unknown writable REGION',
  );
  if (
    writableRegion.banked ||
    (writableRegion.permissions & NOBJ1_PERMISSION.write) === 0 ||
    writableRegion.capacity > 0xffff
  ) {
    fail('Nucleus writable REGION is missing, banked or not writable');
  }
  const requiredRanges = [
    startupRangeId,
    vectorRangeId,
    runtimeStateRangeId,
    initializedRunRangeId,
    initializedLoadRangeId,
  ];
  const decodedRanges = requiredRanges.map((id) => {
    return required(
      ranges.get(id),
      'Nucleus runtime contract references an unknown RANGE',
    );
  });
  const startup = required(
    decodedRanges[0],
    'Nucleus startup range is missing',
  );
  const vector = required(decodedRanges[1], 'Nucleus vector range is missing');
  const state = required(decodedRanges[2], 'Nucleus state range is missing');
  const initializedRun = required(
    decodedRanges[3],
    'Nucleus initialized run range is missing',
  );
  const initializedLoad = required(
    decodedRanges[4],
    'Nucleus initialized load range is missing',
  );
  if (
    startup.view !== 'run' ||
    vector.view !== 'run' ||
    state.view !== 'run' ||
    initializedRun.view !== 'run' ||
    initializedLoad.view !== 'load'
  ) {
    fail('Nucleus runtime contract range views are invalid');
  }
  const startupSection = required(
    sections.get(startup.sectionId),
    'Nucleus startup range references an unknown SECTION',
  );
  if (
    startupSection?.storageKind !== 1 ||
    (startupSection.permissions & 4) === 0
  ) {
    fail('Nucleus startup range is not initialized executable storage');
  }
  const vectorSection = required(
    sections.get(vector.sectionId),
    'Nucleus vector range references an unknown SECTION',
  );
  const stateSection = required(
    sections.get(state.sectionId),
    'Nucleus state range references an unknown SECTION',
  );
  const initializedRunSection = required(
    sections.get(initializedRun.sectionId),
    'Nucleus initialized run range references an unknown SECTION',
  );
  const initializedLoadSection = required(
    sections.get(initializedLoad.sectionId),
    'Nucleus initialized load range references an unknown SECTION',
  );
  if (
    vectorSection?.runRegionId !== writableRegionId ||
    stateSection?.runRegionId !== writableRegionId ||
    initializedRunSection?.runRegionId !== writableRegionId ||
    initializedRunSection?.storageKind !== 1 ||
    (initializedRunSection.permissions & NOBJ1_PERMISSION.write) === 0 ||
    initializedLoadSection?.id !== initializedRunSection.id ||
    initializedRun.offset !== 0 ||
    initializedRun.length !== initializedRunSection.length ||
    initializedLoad?.offset !== initializedRun?.offset ||
    initializedLoad?.length !== initializedRun?.length ||
    vector?.sectionId !== initializedRun?.sectionId ||
    state?.sectionId !== initializedRun?.sectionId ||
    vector?.offset !== initializedRun?.offset ||
    vector.offset + vector.length >
      initializedRun.offset + initializedRun.length ||
    state.offset !== vector.offset + vector.length ||
    state.offset + state.length > initializedRun.offset + initializedRun.length
  ) {
    fail(
      'Nucleus vector, state and initialized ranges do not share the declared layout',
    );
  }
  if (runtimeIdentity === 4 && (vector.length !== 33 || state.length !== 37)) {
    fail(
      'Nucleus runtime identity 0004 requires 33-byte vectors and 37-byte state',
    );
  }
  const entry = requireSymbolDefinition(
    required(
      symbols.get(entrySymbolId),
      'Nucleus runtime contract references an unknown entry SYMBOL',
    ),
    'Nucleus entry symbol must be a local definition or export',
  );
  if (
    entry.valueKind !== 1 ||
    entry.sectionId !== startup.sectionId ||
    entry.offset < startup.offset ||
    entry.offset >= startup.offset + startup.length
  ) {
    fail('Nucleus entry symbol is not CODE inside startup');
  }
  if (bssRangeId !== 0) {
    const bss = ranges.get(bssRangeId);
    const bssSection =
      bss === undefined ? undefined : sections.get(bss.sectionId);
    if (
      bss?.view !== 'run' ||
      bssSection?.storageKind !== 2 ||
      bssSection.runRegionId !== writableRegionId ||
      (bssSection.permissions & NOBJ1_PERMISSION.write) === 0 ||
      bss.offset !== 0 ||
      bss.length !== bssSection.length
    ) {
      fail('Nucleus BSS range is not zero-initialized writable storage');
    }
  }
  if (initializedLoadSection?.loadRegionId === undefined) {
    fail('Nucleus initialized data has no LOAD REGION');
  }
  const bankRegions: Nobj1Region[] = [];
  const readOnlyRanges: Array<Nobj1Range | undefined> = [];
  const aggregateRanges: Array<Nobj1Range | undefined> = [];
  const bankIds = new Set<number>();
  for (let bank = 0; bank < bankCount; bank += 1) {
    const offset = 22 + bank * 6;
    const regionId = readU16(data, offset);
    const region = required(
      regions.get(regionId),
      'Nucleus bank table references an unknown REGION',
    );
    if (bankIds.has(region.id))
      fail('Nucleus bank REGION IDs are not distinct');
    bankIds.add(region.id);
    const readOnlyRangeId = readU16(data, offset + 2);
    const aggregateRangeId = readU16(data, offset + 4);
    const readOnlyRange =
      readOnlyRangeId === 0 ? undefined : ranges.get(readOnlyRangeId);
    const aggregateRange =
      aggregateRangeId === 0 ? undefined : ranges.get(aggregateRangeId);
    if (
      (readOnlyRangeId !== 0 && readOnlyRange?.view !== 'load') ||
      (aggregateRangeId !== 0 && aggregateRange?.view !== 'load')
    ) {
      fail('Nucleus bank table range views are invalid');
    }
    if (
      aggregateRange !== undefined &&
      (readOnlyRange === undefined ||
        aggregateRange.sectionId !== readOnlyRange.sectionId ||
        aggregateRange.offset < readOnlyRange.offset ||
        aggregateRange.offset + aggregateRange.length >
          readOnlyRange.offset + readOnlyRange.length)
    ) {
      fail('Nucleus aggregate constants are outside the read-only range');
    }
    for (const [name, range] of [
      ['read-only', readOnlyRange],
      ['aggregate', aggregateRange],
    ] as const) {
      if (range !== undefined && range.length > 0xffff) {
        fail(`Nucleus ${name} RANGE exceeds the legacy u16 length`);
      }
    }
    bankRegions.push(region);
    readOnlyRanges.push(readOnlyRange);
    aggregateRanges.push(aggregateRange);
  }
  const firstBank = required(bankRegions[0], 'Nucleus bank table is empty');
  const identities = new Set<string>();
  for (const region of bankRegions) {
    const identity = physicalKey(region);
    if (identities.has(identity))
      fail('Nucleus bank regions share physical storage');
    identities.add(identity);
    if (
      region.base !== firstBank.base ||
      region.capacity !== firstBank.capacity ||
      region.capacity > 0xffff ||
      region.imageFill !== firstBank.imageFill ||
      region.banked !== bankCount > 1
    ) {
      fail('Nucleus bank regions do not share one bank-window geometry');
    }
  }
  if (bankCount > 1 && !romMode) {
    fail('multiple Nucleus banks require ROM mode');
  }

  const sourcePartRecords = metadata.filter(
    ({ key, majorVersion, minorVersion }) =>
      key === 'org.nobj.source-parts' &&
      majorVersion === 1 &&
      minorVersion === 0,
  );
  if (sourcePartRecords.length !== 1) {
    fail('Nucleus runtime requires exactly one source-parts metadata record');
  }
  const sourceParts = required(
    sourcePartRecords[0],
    'Nucleus source-parts metadata is missing',
  ).data;
  const sourcePartCount = readU16(sourceParts, 0);
  if (sourcePartCount < 1 || sourcePartCount > 0xff) {
    fail('Nucleus source-part count is outside 1..255');
  }
  for (let part = 0; part < sourcePartCount; part += 1) {
    if (!bankIds.has(readU16(sourceParts, 2 + part * 2))) {
      fail(
        'Nucleus source-parts metadata names a REGION outside the bank table',
      );
    }
  }

  const rangeLocation = (
    range: Nobj1Range,
  ):
    | Readonly<{
        section: Nobj1Section;
        region: Nobj1Region;
        start: number;
        end: number;
      }>
    | undefined => {
    const section = required(
      sections.get(range.sectionId),
      'Nucleus contract RANGE references an unknown SECTION',
    );
    if (range.length > 0xffff) {
      fail('Nucleus contract RANGE exceeds the legacy u16 length');
    }
    if (range.view === 'run') {
      if (section.runPlacement !== 'fixed') return undefined;
      const region = required(
        regions.get(section.runRegionId),
        'Nucleus contract RUN REGION is missing',
      );
      const start = region.base + section.runOffset + range.offset;
      return Object.freeze({
        section,
        region,
        start,
        end: start + range.length,
      });
    }
    if (section.loadPlacement === 'allocate') return undefined;
    const region = required(
      regions.get(section.loadRegionId ?? 0),
      'Nucleus contract LOAD REGION is missing',
    );
    const loadOffset =
      section.loadPlacement === 'same'
        ? section.runOffset
        : (section.loadOffset ?? 0);
    const start = region.base + loadOffset + range.offset;
    return Object.freeze({ section, region, start, end: start + range.length });
  };
  const mustRangeLocation = (range: Nobj1Range) =>
    rangeLocation(range) ??
    fail('placed Nucleus contract contains an allocated RANGE');

  const positionsResolved = [...sections.values()].every(
    ({ storageKind, runPlacement, loadPlacement }) =>
      runPlacement === 'fixed' &&
      (storageKind !== 1 || loadPlacement !== 'allocate'),
  );
  if (positionsResolved) {
    const runLocation = mustRangeLocation(initializedRun);
    const loadLocation = mustRangeLocation(initializedLoad);
    const vectorLocation = mustRangeLocation(vector);
    const stateLocation = mustRangeLocation(state);
    const startupLocation = mustRangeLocation(startup);
    if (layout.mode === 'placed') {
      const rangesToCheck = [
        startupLocation,
        vectorLocation,
        stateLocation,
        runLocation,
        loadLocation,
      ];
      if (rangesToCheck.some(({ start }) => start < 0 || start > 0xffff)) {
        fail('Nucleus contract RANGE start exceeds a legacy u16 address');
      }
    }
    if (
      vectorLocation.start !== runLocation.start ||
      stateLocation.start !== vectorLocation.end ||
      vectorLocation.end > runLocation.end ||
      stateLocation.end > runLocation.end
    ) {
      fail('Nucleus vector, state and initialized RUN addresses disagree');
    }
    if (runLocation.start !== writableRegion.base) {
      fail('Nucleus initialized RUN range does not begin at writable base');
    }

    const entry = requireSymbolDefinition(
      required(
        symbols.get(entrySymbolId),
        'Nucleus runtime contract references an unknown entry SYMBOL',
      ),
      'Nucleus entry symbol must be a local definition or export',
    );
    if (
      entry.valueKind !== 1 ||
      entry.sectionId !== startup.sectionId ||
      entry.offset < startup.offset ||
      entry.offset >= startup.offset + startup.length
    ) {
      fail('Nucleus entry symbol is not CODE inside startup');
    }
    if (layout.mode === 'placed' && layout.entrySymbolId !== entrySymbolId) {
      fail('placed Nucleus runtime entry differs from LAYOUT');
    }
    if (layout.mode === 'placed') {
      const entrySection = required(
        sections.get(entry.sectionId),
        'Nucleus entry SECTION is missing',
      );
      const entryRegion = required(
        regions.get(entrySection.runRegionId),
        'Nucleus entry REGION is missing',
      );
      const entryAddress =
        entryRegion.base + entrySection.runOffset + entry.offset;
      const startupEnd = startupLocation.end;
      if (
        entryAddress < startupLocation.start ||
        entryAddress >= startupEnd ||
        entryAddress < entryRegion.base ||
        entryAddress >= entryRegion.base + entryRegion.capacity
      ) {
        fail('Nucleus entry address lies outside its startup or REGION');
      }
    }

    const bssRange =
      bssRangeId === 0
        ? undefined
        : required(ranges.get(bssRangeId), 'Nucleus BSS RANGE is missing');
    const bssLocation =
      bssRange === undefined ? undefined : mustRangeLocation(bssRange);
    const initializedEnd = runLocation.end;
    if (bssLocation !== undefined && bssLocation.start !== initializedEnd) {
      fail('Nucleus BSS does not begin at the end of initialized RUN data');
    }
    const bssEnd = bssLocation?.end ?? initializedEnd;
    if (layout.mode === 'placed') {
      const writableEnd = writableRegion.base + writableRegion.capacity;
      if (bssEnd > writableEnd) {
        fail('Nucleus initialized data and BSS exceed writable storage');
      }
      if (establishedStack && writableEnd - bssEnd < stackRequirement + 2) {
        fail('Nucleus established stack cannot fit above BSS');
      }
      if (establishedStack) {
        for (const section of sections.values()) {
          if (
            section.id === initializedRun.sectionId ||
            section.id === bssRange?.sectionId ||
            section.runPlacement !== 'fixed'
          ) {
            continue;
          }
          const runRegion = required(
            regions.get(section.runRegionId),
            'Nucleus SECTION RUN REGION is missing',
          );
          if (physicalKey(runRegion) !== physicalKey(writableRegion)) continue;
          const start = runRegion.base + section.runOffset;
          const end = start + section.length;
          if (start < writableEnd && bssEnd < end) {
            fail('Nucleus SECTION occupies the established stack area');
          }
        }
      }
    }

    const bankUsedEnds = bankRegions.map((bankRegion) => {
      const bankEnd = bankRegion.base + bankRegion.capacity;
      let usedEnd = bankRegion.base;
      if (layout.mode !== 'placed') return undefined;
      for (const section of sections.values()) {
        if (section.storageKind !== 1 || section.loadPlacement === 'allocate') {
          continue;
        }
        const loadRegion = required(
          regions.get(section.loadRegionId ?? 0),
          'Nucleus initialized SECTION LOAD REGION is missing',
        );
        if (physicalKey(loadRegion) !== physicalKey(bankRegion)) continue;
        const loadOffset =
          section.loadPlacement === 'same'
            ? section.runOffset
            : (section.loadOffset ?? 0);
        const start = loadRegion.base + loadOffset;
        const end = start + section.length;
        const overlaps = start < bankEnd && bankRegion.base < end;
        if (!overlaps) continue;
        if (start < bankRegion.base || end > bankEnd) {
          fail(
            'Nucleus initialized LOAD extent partially intersects a bank REGION',
          );
        }
        usedEnd = Math.max(usedEnd, end);
      }
      if (usedEnd === bankRegion.base || usedEnd - bankRegion.base > 0xffff) {
        fail('Nucleus bank used extent is outside the legacy u16 range');
      }
      return usedEnd;
    });
    if (layout.mode === 'placed') {
      const entrySection = required(
        sections.get(entry.sectionId),
        'Nucleus entry SECTION is missing',
      );
      const entryRegion = required(
        regions.get(entrySection.runRegionId),
        'Nucleus entry REGION is missing',
      );
      const entryAddress =
        entryRegion.base + entrySection.runOffset + entry.offset;
      const entryBankIndex = bankRegions.findIndex(
        (region) => physicalKey(region) === physicalKey(entryRegion),
      );
      const startupBankIndex = bankRegions.findIndex(
        (region) => physicalKey(region) === physicalKey(startupLocation.region),
      );
      const loadBankIndex = bankRegions.findIndex(
        (region) => physicalKey(region) === physicalKey(loadLocation.region),
      );
      if (
        entryBankIndex < 0 ||
        startupBankIndex !== entryBankIndex ||
        loadBankIndex !== entryBankIndex
      ) {
        fail('Nucleus entry, startup and initialized LOAD must use one bank');
      }
      const entryRegionForBank = required(
        bankRegions[entryBankIndex],
        'Nucleus entry bank is missing',
      );
      const usedEnd = required(
        bankUsedEnds[entryBankIndex],
        'Nucleus entry bank used end is unavailable',
      );
      if (entryAddress < entryRegionForBank.base || entryAddress >= usedEnd) {
        fail('Nucleus entry address is outside the entry bank used extent');
      }

      for (let bank = 0; bank < bankRegions.length; bank += 1) {
        const bankRegion = required(
          bankRegions[bank],
          'Nucleus bank REGION is missing',
        );
        const usedEnd = required(
          bankUsedEnds[bank],
          'Nucleus bank used end is unavailable',
        );
        for (const range of [readOnlyRanges[bank], aggregateRanges[bank]]) {
          if (range === undefined) continue;
          const location = mustRangeLocation(range);
          const overlaps =
            location.start < bankRegion.base + bankRegion.capacity &&
            bankRegion.base < location.end;
          if (
            physicalKey(location.region) !== physicalKey(bankRegion) ||
            !overlaps ||
            location.start < bankRegion.base ||
            location.end > usedEnd
          ) {
            fail(
              'Nucleus read-only or aggregate RANGE is outside bank used bytes',
            );
          }
        }
      }

      const writableStart = writableRegion.base;
      const writableEnd = writableStart + writableRegion.capacity;
      const bankStart = firstBank.base;
      const bankEnd = bankStart + firstBank.capacity;
      const addressRangesOverlap =
        writableStart < bankEnd && bankStart < writableEnd;
      if (romMode) {
        if (bankCount === 1 && addressRangesOverlap) {
          fail('Nucleus single-bank ROM writable and image intervals overlap');
        }
        for (const bankRegion of bankRegions) {
          const imageEnd = bankRegion.base + bankRegion.capacity;
          if (writableStart < imageEnd && bankRegion.base < writableEnd) {
            fail('Nucleus ROM writable and image intervals overlap');
          }
        }
      } else {
        if (bankCount !== 1)
          fail('Nucleus loaded mode requires exactly one bank');
        if (
          writableStart < bankStart ||
          writableEnd > bankEnd ||
          physicalKey(writableRegion) !== physicalKey(firstBank)
        ) {
          fail(
            'Nucleus loaded writable REGION is not a physical image subview',
          );
        }
        if (
          physicalKey(runLocation.region) !==
            physicalKey(loadLocation.region) ||
          runLocation.start !== loadLocation.start ||
          runLocation.end !== loadLocation.end ||
          usedEnd !== initializedEnd ||
          entryAddress >= writableStart
        ) {
          fail('Nucleus loaded image and runtime data layout is inconsistent');
        }
      }

      const bssSections = [...sections.values()].filter(
        (section) =>
          section.storageKind === 2 && section.runRegionId === writableRegionId,
      );
      if (bssSections.length !== (bssRange === undefined ? 0 : 1)) {
        fail('Nucleus writable BSS sections disagree with the contract');
      }
      if (relocations.some(({ kind, use }) => kind === 2 && use === 3)) {
        fail('placed Nucleus object contains an unresolved LOAD relocation');
      }
    }
  }

  for (const relocation of relocations) {
    if (relocation.kind !== 2 || relocation.use !== 3) continue;
    const siteSection = sections.get(relocation.siteSectionId);
    if (
      siteSection === undefined ||
      siteSection.id !== startup.sectionId ||
      relocation.siteOffset < startup.offset ||
      relocation.siteOffset + 2 > startup.offset + startup.length
    ) {
      fail('Nucleus ABS16_LOAD site is outside startup');
    }
    const target = required(
      symbols.get(relocation.targetSymbolId),
      'Nucleus ABS16_LOAD target SYMBOL is missing',
    );
    if (!symbolDefinition(target)) {
      if (layout.mode === 'placed') {
        fail('placed Nucleus ABS16_LOAD target is unresolved');
      }
      continue;
    }
    const targetSection = required(
      sections.get(target.sectionId),
      'Nucleus ABS16_LOAD target SECTION is missing',
    );
    const targetOffset = target.offset + relocation.addend;
    if (
      targetSection.id !== initializedLoad.sectionId ||
      targetOffset < initializedLoad.offset ||
      targetOffset >= initializedLoad.offset + initializedLoad.length
    ) {
      fail('Nucleus ABS16_LOAD target is outside initialized LOAD data');
    }
  }
};

const validateLayout = (
  layout: Nobj1Layout,
  contracts: readonly Nobj1Contract[],
  sections: readonly Nobj1Section[],
  symbols: readonly Nobj1Symbol[],
  relocations: readonly Nobj1Relocation[],
): void => {
  if (layout.entrySymbolId !== 0) {
    const entry = requireSymbolDefinition(
      required(
        symbols.find(({ id }) => id === layout.entrySymbolId),
        'LAYOUT references an unknown entry SYMBOL',
      ),
      'LAYOUT entry must identify a CODE definition or export',
    );
    if (entry.valueKind !== 1)
      fail('LAYOUT entry must identify a CODE definition or export');
    const section = required(
      sections.find(({ id }) => id === entry.sectionId),
      'LAYOUT entry references an unknown SECTION',
    );
    if (section.storageKind !== 1 || (section.permissions & 4) === 0) {
      fail('LAYOUT entry is not in initialized executable storage');
    }
  }
  if (layout.mode !== 'placed') return;
  if (relocations.length !== 0) fail('placed LAYOUT contains RELOC records');
  if (
    sections.some(
      ({ runPlacement, loadPlacement }) =>
        runPlacement === 'allocate' || loadPlacement === 'allocate',
    )
  ) {
    fail('placed LAYOUT contains allocated SECTION placement');
  }
  if (
    symbols.some(
      ({ binding }) => binding === 'import' || binding === 'service-import',
    )
  ) {
    fail('placed LAYOUT contains unresolved imports');
  }
  const nucleus = contracts.find(
    ({ key, majorVersion, minorVersion }) =>
      key === 'org.nucleus.runtime' && majorVersion === 0 && minorVersion === 1,
  );
  if (
    nucleus !== undefined &&
    readU16(nucleus.data, 3) !== layout.entrySymbolId
  ) {
    fail('placed Nucleus runtime entry differs from LAYOUT');
  }
};

const phaseForKind = (kind: number): number => {
  switch (kind) {
    case NOBJ1_KIND.begin:
      return 0;
    case NOBJ1_KIND.contract:
      return 1;
    case NOBJ1_KIND.region:
      return 2;
    case NOBJ1_KIND.section:
      return 3;
    case NOBJ1_KIND.range:
      return 4;
    case NOBJ1_KIND.image:
      return 5;
    case NOBJ1_KIND.patch:
      return 6;
    case NOBJ1_KIND.symbol:
      return 7;
    case NOBJ1_KIND.relocation:
      return 8;
    case NOBJ1_KIND.metadata:
      return 9;
    case NOBJ1_KIND.layout:
      return 10;
    case NOBJ1_KIND.commit:
      return 11;
    default:
      return fail('NOBJ 1.0 record kind is reserved');
  }
};

/** Parse and validate one complete NOBJ 1.0 object without resolving placement. */
export const parseNobj1 = (input: Uint8Array): Nobj1Object => {
  const serialized = input instanceof Uint8Array ? input.slice() : input;
  const records = decodeRecords(serialized);
  const beginRecord = required(records[0], 'NOBJ 1.0 stream is empty');
  if (beginRecord.kind !== NOBJ1_KIND.begin) {
    fail('BEGIN must be the first NOBJ 1.0 record');
  }
  const begin = decodeBegin(beginRecord);
  const contracts: Nobj1Contract[] = [];
  const regions: Nobj1Region[] = [];
  const sections: Nobj1Section[] = [];
  const ranges: Nobj1Range[] = [];
  const images: Nobj1ImageRecord[] = [];
  const patches: Nobj1ImageRecord[] = [];
  const symbols: Nobj1Symbol[] = [];
  const relocations: Nobj1Relocation[] = [];
  const metadata: Nobj1Metadata[] = [];
  let layout: Nobj1Layout | undefined;
  let commitRecord: RawRecord | undefined;
  let currentPhase = 0;
  for (let index = 1; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined) continue;
    const phase = phaseForKind(record.kind);
    if (phase < currentPhase) fail('NOBJ 1.0 record phases are out of order');
    currentPhase = phase;
    switch (record.kind) {
      case NOBJ1_KIND.begin:
        fail('NOBJ 1.0 contains more than one BEGIN');
        break;
      case NOBJ1_KIND.contract:
        contracts.push(decodeContract(record));
        break;
      case NOBJ1_KIND.region:
        regions.push(decodeRegion(record));
        break;
      case NOBJ1_KIND.section:
        sections.push(decodeSection(record));
        break;
      case NOBJ1_KIND.range:
        ranges.push(decodeRange(record));
        break;
      case NOBJ1_KIND.image:
        images.push(decodeImage(record, 'IMAGE'));
        break;
      case NOBJ1_KIND.patch:
        patches.push(decodeImage(record, 'PATCH'));
        break;
      case NOBJ1_KIND.symbol:
        symbols.push(decodeSymbol(record));
        break;
      case NOBJ1_KIND.relocation:
        relocations.push(decodeRelocation(record));
        break;
      case NOBJ1_KIND.metadata:
        metadata.push(decodeMetadata(record));
        break;
      case NOBJ1_KIND.layout:
        if (layout !== undefined)
          fail('NOBJ 1.0 contains more than one LAYOUT');
        layout = decodeLayout(record);
        break;
      case NOBJ1_KIND.commit:
        if (commitRecord !== undefined)
          fail('NOBJ 1.0 contains more than one COMMIT');
        commitRecord = record;
        break;
    }
  }
  const finalLayout = layout ?? fail('NOBJ 1.0 has no LAYOUT');
  const finalCommitRecord =
    commitRecord ?? fail('NOBJ 1.0 has no terminal COMMIT');
  if (records.at(-1) !== finalCommitRecord)
    fail('COMMIT is not the final record');
  requireLength(finalCommitRecord, 9, 'COMMIT');
  const commitPayload = finalCommitRecord.payload;
  const recordCount = readU32(commitPayload, 0);
  const commitMode = byteAt(commitPayload, 4);
  if (commitMode > 1) fail('COMMIT layout mode is invalid');
  const entrySymbolId = readU16(commitPayload, 5);
  const crc16 = readU16(commitPayload, 7);
  if (recordCount !== records.length) fail('COMMIT record count is incorrect');
  const layoutMode = finalLayout.mode === 'module' ? 0 : 1;
  if (
    commitMode !== layoutMode ||
    entrySymbolId !== finalLayout.entrySymbolId
  ) {
    fail('COMMIT layout fields disagree with LAYOUT');
  }
  const crcOffset = finalCommitRecord.payloadStart + 7;
  if (nobjCrc16CcittFalse(serialized.slice(0, crcOffset)) !== crc16) {
    fail('COMMIT CRC is incorrect');
  }

  requireIncreasingIds(regions, ({ id }) => id, 'REGION');
  requireIncreasingIds(sections, ({ id }) => id, 'SECTION');
  requireIncreasingIds(ranges, ({ id }) => id, 'RANGE');
  requireIncreasingIds(symbols, ({ id }) => id, 'SYMBOL');
  requireIncreasingIds(contracts, ({ id }) => id, 'CONTRACT');
  const contractIds = new Set(contracts.map(({ id }) => id));
  if (contractIds.size !== contracts.length)
    fail('CONTRACT IDs must be unique');
  const contractMap = new Map(
    contracts.map((contract) => [contract.id, contract]),
  );
  const regionMap = new Map(regions.map((region) => [region.id, region]));
  const sectionMap = new Map(sections.map((section) => [section.id, section]));
  const rangeMap = new Map(ranges.map((range) => [range.id, range]));
  const symbolMap = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  validateRegions(regions);
  validateSections(sections, regionMap, finalLayout);
  validateRanges(ranges, sectionMap);
  validateImagesAndPatches(images, patches, sectionMap);
  validateSymbols(symbols, sectionMap, contractMap);
  validateRelocations(relocations, patches, sectionMap, symbolMap);
  validateMetadata(metadata, regionMap);
  validateContracts(
    contracts,
    rangeMap,
    sectionMap,
    symbolMap,
    regionMap,
    metadata,
    finalLayout,
    relocations,
  );
  validateLayout(finalLayout, contracts, sections, symbols, relocations);

  return Object.freeze({
    serialized,
    begin,
    contracts: Object.freeze(contracts),
    regions: Object.freeze(regions),
    sections: Object.freeze(sections),
    ranges: Object.freeze(ranges),
    images: Object.freeze(images),
    patches: Object.freeze(patches),
    symbols: Object.freeze(symbols),
    relocations: Object.freeze(relocations),
    metadata: Object.freeze(metadata),
    layout: finalLayout,
    commit: Object.freeze({
      recordCount,
      layoutMode: finalLayout.mode,
      entrySymbolId,
      crc16,
    }),
  });
};
