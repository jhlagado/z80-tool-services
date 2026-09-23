/** Nucleus NOBJ 0.1 compatibility reader and NOBJ 1.0 adapter. */

import { decodeNobjEnvelope } from './nobj-framing.js';
import {
  materializeTargetImage,
  type MaterializedTargetImage,
} from './target-image.js';
import { NobjLegacyError } from './nobj-legacy-common.js';
import { encodeNobj1, type Nobj1ObjectDraft } from './nobj-v1-codec.js';
import { materializeNobj1Object } from './nobj-v1-image.js';
import {
  NOBJ1_PERMISSION,
  parseNobj1,
  type Nobj1ImageRecord,
  type Nobj1Object,
  type Nobj1Range,
  type Nobj1Region,
  type Nobj1Section,
} from './nobj-v1.js';

export interface NucleusNobj01Begin {
  readonly banked: boolean;
  readonly runtimeIdentity: number;
  readonly bankCount: number;
  readonly imageFill: number;
  readonly imageBase: number;
  readonly imageCapacity: number;
}

export interface NucleusNobj01Operation {
  readonly bank: number;
  readonly address: number;
  readonly bytes: Uint8Array;
}

export interface NucleusNobj01BankMap {
  readonly usedLength: number;
  readonly readOnlyBase: number;
  readonly readOnlyLength: number;
  readonly aggregateConstantBase: number;
  readonly aggregateConstantLength: number;
}

export interface NucleusNobj01Map {
  readonly romMode: boolean;
  readonly establishedStack: boolean;
  readonly entryBank: number;
  readonly entryAddress: number;
  readonly writableBase: number;
  readonly writableCapacity: number;
  readonly vectorBase: number;
  readonly vectorLength: number;
  readonly initializedRunBase: number;
  readonly initializedRunLength: number;
  readonly bssBase: number;
  readonly bssLength: number;
  readonly stackRequirement: number;
  readonly dataLoadBank: number;
  readonly dataLoadAddress: number;
  readonly dataLoadLength: number;
  readonly partBanks: readonly number[];
  readonly banks: readonly NucleusNobj01BankMap[];
}

export interface NucleusNobj01Object {
  readonly serialized: Uint8Array;
  readonly begin: NucleusNobj01Begin;
  readonly images: readonly NucleusNobj01Operation[];
  readonly patches: readonly NucleusNobj01Operation[];
  readonly map: NucleusNobj01Map;
  readonly recordCount: number;
  readonly crc16: number;
  readonly targetImage: MaterializedTargetImage;
}

export interface NucleusNobj01Conversion {
  readonly legacy: NucleusNobj01Object;
  readonly object: Nobj1Object;
  readonly materialized: ReturnType<typeof materializeNobj1Object>;
}

export interface NucleusRuntimeLayoutDescriptor {
  readonly identity: number;
  readonly stateLength: number;
}

interface Interval {
  readonly start: number;
  readonly end: number;
}

interface ConversionSegment {
  readonly bank: number;
  readonly section: Nobj1Section;
  readonly loadStart: number;
  readonly loadEnd: number;
}

const fail = (message: string): never => {
  throw new NobjLegacyError(message);
};

const requireInteger = (name: string, value: number, maximum: number): void => {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    fail(`${name} is outside 0..${maximum}`);
  }
};

const requireU8 = (name: string, value: number): void =>
  requireInteger(name, value, 0xff);
const requireU16 = (name: string, value: number): void =>
  requireInteger(name, value, 0xffff);

const byteAt = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] ?? fail('Nucleus NOBJ 0.1 field is truncated');

const readU16 = (bytes: Uint8Array, offset: number): number =>
  byteAt(bytes, offset) | (byteAt(bytes, offset + 1) << 8);

const checkedEnd = (name: string, base: number, length: number): number => {
  requireU16(`${name} base`, base);
  requireU16(`${name} length`, length);
  const end = base + length;
  if (end > 0x1_0000) fail(`${name} wraps the Z80 address space`);
  return end;
};

const requireRegion = (
  name: string,
  address: number,
  length: number,
  base: number,
  capacity: number,
): number => {
  const regionEnd = checkedEnd(`${name} region`, base, capacity);
  const end = checkedEnd(name, address, length);
  if (address < base || end > regionEnd) {
    fail(`${name} is outside its image region`);
  }
  return end;
};

const required = <T>(value: T | undefined, message: string): T =>
  value ?? fail(message);

const decodeBegin = (payload: Uint8Array): NucleusNobj01Begin => {
  if (payload.length !== 15) fail('Nucleus BEGIN payload length must be 15');
  if (
    payload[0] !== 0x4e ||
    payload[1] !== 0x4f ||
    payload[2] !== 0x42 ||
    payload[3] !== 0x4a
  ) {
    fail('Nucleus BEGIN magic is not NOBJ');
  }
  if (payload[4] !== 0 || payload[5] !== 1) {
    fail('Nucleus object version is not 0.1');
  }
  const flags = byteAt(payload, 6);
  if ((flags & 0xfe) !== 0) fail('Nucleus BEGIN contains reserved flags');
  const begin = Object.freeze({
    banked: (flags & 1) !== 0,
    runtimeIdentity: readU16(payload, 7),
    bankCount: byteAt(payload, 9),
    imageFill: byteAt(payload, 10),
    imageBase: readU16(payload, 11),
    imageCapacity: readU16(payload, 13),
  });
  requireU16('runtime identity', begin.runtimeIdentity);
  requireU8('bank count', begin.bankCount);
  requireU8('image fill', begin.imageFill);
  requireU16('image base', begin.imageBase);
  requireU16('image capacity', begin.imageCapacity);
  if (begin.imageCapacity === 0) fail('Nucleus image capacity is empty');
  checkedEnd('Nucleus image region', begin.imageBase, begin.imageCapacity);
  if (begin.banked) {
    if (begin.bankCount < 2) fail('banked Nucleus BEGIN requires two banks');
  } else if (begin.bankCount !== 1) {
    fail('flat Nucleus BEGIN requires exactly one bank');
  }
  return begin;
};

const decodeOperation = (
  payload: Uint8Array,
  name: 'IMAGE' | 'PATCH',
): NucleusNobj01Operation => {
  if (payload.length < 4) fail(`Nucleus ${name} payload is too short`);
  return Object.freeze({
    bank: byteAt(payload, 0),
    address: readU16(payload, 1),
    bytes: payload.slice(3),
  });
};

const decodeMap = (payload: Uint8Array): NucleusNobj01Map => {
  if (payload.length < 41) {
    fail('Nucleus MAP payload is too short for one bank');
  }
  if (payload[0] !== 1) fail('Nucleus MAP revision is unsupported');
  const flags = byteAt(payload, 1);
  if ((flags & 0xfc) !== 0) fail('Nucleus MAP contains reserved flags');
  const partCount = byteAt(payload, 28);
  if (partCount === 0) fail('Nucleus MAP part count is empty');
  const bankCountOffset = 29 + partCount;
  if (bankCountOffset >= payload.length) {
    fail('Nucleus MAP is truncated before bank-entry count');
  }
  const bankEntryCount = byteAt(payload, bankCountOffset);
  const expectedLength = 30 + partCount + bankEntryCount * 10;
  if (payload.length !== expectedLength) {
    fail('Nucleus MAP payload length is inconsistent');
  }
  const banks: NucleusNobj01BankMap[] = [];
  let cursor = bankCountOffset + 1;
  for (let index = 0; index < bankEntryCount; index += 1) {
    banks.push(
      Object.freeze({
        usedLength: readU16(payload, cursor),
        readOnlyBase: readU16(payload, cursor + 2),
        readOnlyLength: readU16(payload, cursor + 4),
        aggregateConstantBase: readU16(payload, cursor + 6),
        aggregateConstantLength: readU16(payload, cursor + 8),
      }),
    );
    cursor += 10;
  }
  return Object.freeze({
    romMode: (flags & 1) !== 0,
    establishedStack: (flags & 2) !== 0,
    entryBank: byteAt(payload, 2),
    entryAddress: readU16(payload, 3),
    writableBase: readU16(payload, 5),
    writableCapacity: readU16(payload, 7),
    vectorBase: readU16(payload, 9),
    vectorLength: readU16(payload, 11),
    initializedRunBase: readU16(payload, 13),
    initializedRunLength: readU16(payload, 15),
    bssBase: readU16(payload, 17),
    bssLength: readU16(payload, 19),
    stackRequirement: readU16(payload, 21),
    dataLoadBank: byteAt(payload, 23),
    dataLoadAddress: readU16(payload, 24),
    dataLoadLength: readU16(payload, 26),
    partBanks: Object.freeze(Array.from(payload.slice(29, bankCountOffset))),
    banks: Object.freeze(banks),
  });
};

const validateOptionalImageExtent = (
  name: string,
  base: number,
  length: number,
  imageBase: number,
  usedEnd: number,
): void => {
  requireU16(`${name} base`, base);
  requireU16(`${name} length`, length);
  if (length === 0) {
    if (base !== 0) fail(`zero-length ${name} extent must have base zero`);
    return;
  }
  const end = checkedEnd(`${name} extent`, base, length);
  if (base < imageBase || end > usedEnd) {
    fail(`${name} extent is outside used image`);
  }
};

const validateMap = (
  begin: NucleusNobj01Begin,
  map: NucleusNobj01Map,
  images: readonly NucleusNobj01Operation[],
  patches: readonly NucleusNobj01Operation[],
): void => {
  requireU8('MAP entry bank', map.entryBank);
  requireU16('MAP entry address', map.entryAddress);
  requireU16('MAP writable base', map.writableBase);
  requireU16('MAP writable capacity', map.writableCapacity);
  if (map.writableCapacity === 0) fail('MAP writable capacity is empty');
  const writableEnd = checkedEnd(
    'MAP writable region',
    map.writableBase,
    map.writableCapacity,
  );
  for (const [name, value] of [
    ['vector base', map.vectorBase],
    ['vector length', map.vectorLength],
    ['initialized run base', map.initializedRunBase],
    ['initialized run length', map.initializedRunLength],
    ['BSS base', map.bssBase],
    ['BSS length', map.bssLength],
    ['stack requirement', map.stackRequirement],
    ['data-load address', map.dataLoadAddress],
    ['data-load length', map.dataLoadLength],
  ] as const) {
    requireU16(`MAP ${name}`, value);
  }
  if (map.banks.length !== begin.bankCount) {
    fail('MAP bank-entry count differs from BEGIN.bankCount');
  }
  if (map.entryBank >= begin.bankCount) fail('MAP entry bank is out of range');
  if (map.dataLoadBank >= begin.bankCount) {
    fail('MAP data-load bank is out of range');
  }
  if (map.partBanks.length < 1 || map.partBanks.length > 0xff) {
    fail('MAP part count is outside 1..255');
  }
  for (const bank of map.partBanks) {
    if (bank >= begin.bankCount) fail('MAP source-part bank is out of range');
  }
  if (begin.banked && !map.romMode) {
    fail('a banked object must use ROM mode');
  }
  if (!begin.banked && map.entryBank !== 0) {
    fail('a flat object must enter bank zero');
  }

  const imageEnd = begin.imageBase + begin.imageCapacity;
  const regionsOverlap =
    begin.imageBase < writableEnd && map.writableBase < imageEnd;
  const writableInsideImage =
    map.writableBase >= begin.imageBase && writableEnd <= imageEnd;
  if (map.romMode) {
    if (regionsOverlap) fail('ROM-mode writable and image regions overlap');
  } else if (!writableInsideImage) {
    fail('loaded-mode writable region is not wholly inside image region');
  }

  if (
    map.vectorBase !== map.writableBase ||
    map.initializedRunBase !== map.writableBase
  ) {
    fail('MAP vector and initialized run must begin at writableBase');
  }
  if (map.vectorLength === 0 || map.vectorLength > map.initializedRunLength) {
    fail('MAP vector length must be nonzero and fit initialized data');
  }
  const initializedEnd = checkedEnd(
    'MAP initialized run',
    map.initializedRunBase,
    map.initializedRunLength,
  );
  if (map.bssBase !== initializedEnd)
    fail('MAP BSS must follow initialized data');
  const bssEnd = checkedEnd('MAP BSS', map.bssBase, map.bssLength);
  if (map.initializedRunBase < map.writableBase || bssEnd > writableEnd) {
    fail('MAP initialized data and BSS exceed writable capacity');
  }
  if (map.establishedStack && writableEnd - bssEnd < map.stackRequirement + 2) {
    fail('MAP established stack does not fit writable capacity');
  }
  if (map.dataLoadLength !== map.initializedRunLength) {
    fail('MAP data-load length differs from initialized run length');
  }
  if (!map.romMode) {
    if (
      map.dataLoadBank !== 0 ||
      map.dataLoadAddress !== map.initializedRunBase
    ) {
      fail('loaded MAP data load must use bank zero at initializedRunBase');
    }
  } else if (begin.banked && map.dataLoadBank !== map.entryBank) {
    fail('banked ROM data load must occupy the entry bank');
  }

  const highestEnds = Array.from(
    { length: begin.bankCount },
    () => begin.imageBase,
  );
  for (const item of [...images, ...patches]) {
    if (item.bank >= begin.bankCount) {
      fail('record bank is outside BEGIN.bankCount');
    }
    const end = requireRegion(
      'object record',
      item.address,
      item.bytes.length,
      begin.imageBase,
      begin.imageCapacity,
    );
    highestEnds[item.bank] = Math.max(
      highestEnds[item.bank] ?? begin.imageBase,
      end,
    );
  }

  for (let bankIndex = 0; bankIndex < map.banks.length; bankIndex += 1) {
    const bank = required(map.banks[bankIndex], 'MAP bank entry is missing');
    if (bank.usedLength === 0 || bank.usedLength > begin.imageCapacity) {
      fail('MAP used length is outside 1..imageCapacity');
    }
    const usedEnd = begin.imageBase + bank.usedLength;
    if (highestEnds[bankIndex] !== usedEnd) {
      fail('MAP used length differs from record extent');
    }
    for (const item of [...images, ...patches]) {
      if (
        item.bank === bankIndex &&
        item.address + item.bytes.length > usedEnd
      ) {
        fail('record lies beyond MAP.usedLength');
      }
    }
    validateOptionalImageExtent(
      'read-only',
      bank.readOnlyBase,
      bank.readOnlyLength,
      begin.imageBase,
      usedEnd,
    );
    validateOptionalImageExtent(
      'aggregate-constant',
      bank.aggregateConstantBase,
      bank.aggregateConstantLength,
      begin.imageBase,
      usedEnd,
    );
    if (bank.aggregateConstantLength > 0) {
      const readOnlyEnd = bank.readOnlyBase + bank.readOnlyLength;
      const aggregateEnd =
        bank.aggregateConstantBase + bank.aggregateConstantLength;
      if (
        bank.readOnlyLength === 0 ||
        bank.aggregateConstantBase < bank.readOnlyBase ||
        aggregateEnd > readOnlyEnd
      ) {
        fail('aggregate-constant extent is outside read-only extent');
      }
    }
  }

  const entryUsedEnd =
    begin.imageBase + (map.banks[map.entryBank]?.usedLength ?? 0);
  if (map.entryAddress < begin.imageBase || map.entryAddress >= entryUsedEnd) {
    fail('MAP entry address is outside the entry bank used extent');
  }
  if (!map.romMode) {
    const loadedUsedEnd = begin.imageBase + (map.banks[0]?.usedLength ?? 0);
    if (loadedUsedEnd !== initializedEnd) {
      fail('loaded image must end at the initialized-data run end');
    }
    if (map.entryAddress >= map.writableBase) {
      fail('loaded entry address must precede writable storage');
    }
  }
  if (map.romMode) {
    const loadUsedEnd =
      begin.imageBase + (map.banks[map.dataLoadBank]?.usedLength ?? 0);
    const loadEnd = checkedEnd(
      'MAP data-load extent',
      map.dataLoadAddress,
      map.dataLoadLength,
    );
    if (map.dataLoadAddress < begin.imageBase || loadEnd > loadUsedEnd) {
      fail('MAP data-load extent is outside its bank used extent');
    }
  }
};

/** Validate one complete Nucleus NOBJ 0.1 stream using the legacy rules. */
export const parseNucleusNobj01 = (input: Uint8Array): NucleusNobj01Object => {
  if (!(input instanceof Uint8Array)) fail('Nucleus NOBJ input must be bytes');
  const serialized = input.slice();
  const envelope = (() => {
    try {
      return decodeNobjEnvelope(serialized, {
        majorVersion: 0,
        minorVersion: 1,
        requireImage: true,
      });
    } catch (cause) {
      return fail(cause instanceof Error ? cause.message : String(cause));
    }
  })();
  const begin = decodeBegin(envelope.begin.payload);
  const images = envelope.images.map(({ payload }) =>
    decodeOperation(payload, 'IMAGE'),
  );
  const patches = envelope.patches.map(({ payload }) =>
    decodeOperation(payload, 'PATCH'),
  );
  const map = decodeMap(envelope.map.payload);
  const imageEnds = new Map<number, number>();
  const patchIntervals = new Map<number, Interval[]>();
  for (const item of images) {
    if (item.bank >= begin.bankCount) fail('IMAGE bank is out of range');
    const end = requireRegion(
      'IMAGE',
      item.address,
      item.bytes.length,
      begin.imageBase,
      begin.imageCapacity,
    );
    const previous = imageEnds.get(item.bank);
    if (previous !== undefined && item.address < previous) {
      fail('IMAGE records descend or overlap within a bank');
    }
    imageEnds.set(item.bank, end);
  }
  for (const item of patches) {
    if (item.bank >= begin.bankCount) fail('PATCH bank is out of range');
    const end = requireRegion(
      'PATCH',
      item.address,
      item.bytes.length,
      begin.imageBase,
      begin.imageCapacity,
    );
    const intervals = patchIntervals.get(item.bank) ?? [];
    for (const interval of intervals) {
      if (item.address < interval.end && interval.start < end) {
        fail('PATCH records overlap');
      }
    }
    intervals.push({ start: item.address, end });
    patchIntervals.set(item.bank, intervals);
  }
  validateMap(begin, map, images, patches);

  const targetImage = (() => {
    try {
      return materializeTargetImage({
        geometry: {
          bankCount: begin.bankCount,
          imageBase: begin.imageBase,
          imageCapacity: begin.imageCapacity,
          imageFill: begin.imageFill,
          entryBank: map.entryBank,
          entryAddress: map.entryAddress,
        },
        banks: map.banks,
        images,
        patches,
        patchPolicy: 'used',
      });
    } catch (cause) {
      return fail(
        cause instanceof Error
          ? cause.message
          : 'Nucleus NOBJ image is invalid',
      );
    }
  })();

  return Object.freeze({
    serialized,
    begin,
    images: Object.freeze(images),
    patches: Object.freeze(patches),
    map,
    recordCount: envelope.commit.recordCount,
    crc16: envelope.commit.crc16,
    targetImage,
  });
};

const u16 = (value: number): number[] => [value & 0xff, value >>> 8];

const findSegment = (
  segments: readonly ConversionSegment[],
  bank: number,
  address: number,
  length: number,
): ConversionSegment | undefined =>
  segments.find(
    (segment) =>
      segment.bank === bank &&
      address >= segment.loadStart &&
      address + length <= segment.loadEnd,
  );

const mapOperations = (
  operations: readonly NucleusNobj01Operation[],
  segments: readonly ConversionSegment[],
): Nobj1ImageRecord[] => {
  const result: Nobj1ImageRecord[] = [];
  for (const operation of operations) {
    let covered = 0;
    const operationEnd = operation.address + operation.bytes.length;
    for (const segment of segments) {
      if (segment.bank !== operation.bank) continue;
      const start = Math.max(operation.address, segment.loadStart);
      const end = Math.min(operationEnd, segment.loadEnd);
      if (start >= end) continue;
      result.push(
        Object.freeze({
          sectionId: segment.section.id,
          offset: start - segment.loadStart,
          bytes: operation.bytes.slice(
            start - operation.address,
            end - operation.address,
          ),
        }),
      );
      covered += end - start;
    }
    if (covered !== operation.bytes.length) {
      fail('Nucleus IMAGE/PATCH cannot be represented by its SECTION extents');
    }
  }
  return result;
};

/** Convert a validated Nucleus 0.1 image to NOBJ 1.0, proving byte/layout equivalence. */
export const convertNucleusNobj01 = (
  input: Uint8Array,
  runtimeLayout?: NucleusRuntimeLayoutDescriptor,
): NucleusNobj01Conversion => {
  const legacy = parseNucleusNobj01(input);
  const stateLength = required(
    runtimeLayout?.stateLength ??
      (legacy.begin.runtimeIdentity === 4 ? 37 : undefined),
    'Nucleus conversion requires the selected runtime state length',
  );
  if (
    runtimeLayout !== undefined &&
    runtimeLayout.identity !== legacy.begin.runtimeIdentity
  ) {
    fail('Nucleus runtime layout identity differs from BEGIN');
  }
  if (
    !Number.isInteger(stateLength) ||
    stateLength < 1 ||
    legacy.map.vectorLength + stateLength > legacy.map.initializedRunLength
  ) {
    fail('Nucleus runtime vector/state layout does not fit initialized data');
  }
  if (
    legacy.begin.runtimeIdentity === 4 &&
    (legacy.map.vectorLength !== 33 || stateLength !== 37)
  ) {
    fail(
      'Nucleus runtime identity 0004 requires 33-byte vectors and 37-byte state',
    );
  }

  const { begin, map } = legacy;
  const writableRegionId = begin.bankCount + 1;
  const regions: Nobj1Region[] = [];
  for (let bank = 0; bank < begin.bankCount; bank += 1) {
    regions.push(
      Object.freeze({
        id: bank + 1,
        addressSpaceKey: 'z80.cpu',
        storageKey: map.romMode ? `nucleus.rom.${bank}` : 'nucleus.flat',
        base: begin.imageBase,
        capacity: begin.imageCapacity,
        imageFill: begin.imageFill,
        permissions: NOBJ1_PERMISSION.read | NOBJ1_PERMISSION.execute,
        banked: begin.banked,
      }),
    );
  }
  regions.push(
    Object.freeze({
      id: writableRegionId,
      addressSpaceKey: 'z80.cpu',
      storageKey: map.romMode ? 'nucleus.ram' : 'nucleus.flat',
      base: map.writableBase,
      capacity: map.writableCapacity,
      imageFill: begin.imageFill,
      permissions: NOBJ1_PERMISSION.read | NOBJ1_PERMISSION.write,
      banked: false,
    }),
  );

  const sections: Nobj1Section[] = [];
  const segments: ConversionSegment[] = [];
  let nextSectionId = 1;
  const addImageSection = (
    bank: number,
    startOffset: number,
    endOffset: number,
  ): void => {
    if (endOffset <= startOffset) return;
    const regionId = bank + 1;
    const section: Nobj1Section = Object.freeze({
      id: nextSectionId++,
      storageKind: 1,
      permissions: NOBJ1_PERMISSION.read | NOBJ1_PERMISSION.execute,
      alignment: 1,
      length: endOffset - startOffset,
      runRegionId: regionId,
      runPlacement: 'fixed',
      runOffset: startOffset,
      loadPlacement: 'same',
      loadRegionId: regionId,
      loadOffset: 0,
      fill: begin.imageFill,
    });
    sections.push(section);
    segments.push(
      Object.freeze({
        bank,
        section,
        loadStart: begin.imageBase + startOffset,
        loadEnd: begin.imageBase + endOffset,
      }),
    );
  };

  let initializedSection: Nobj1Section | undefined;
  for (let bank = 0; bank < begin.bankCount; bank += 1) {
    const usedLength = required(
      map.banks[bank]?.usedLength,
      'Nucleus MAP bank extent is missing',
    );
    if (bank !== map.dataLoadBank) {
      addImageSection(bank, 0, usedLength);
      continue;
    }
    const dataStart = map.dataLoadAddress - begin.imageBase;
    const dataEnd = dataStart + map.dataLoadLength;
    if (dataStart < 0 || dataEnd > usedLength) {
      fail('Nucleus initializer does not fit its entry-bank image');
    }
    addImageSection(bank, 0, dataStart);
    const section: Nobj1Section = Object.freeze({
      id: nextSectionId++,
      storageKind: 1,
      permissions: NOBJ1_PERMISSION.read | NOBJ1_PERMISSION.write,
      alignment: 1,
      length: map.initializedRunLength,
      runRegionId: writableRegionId,
      runPlacement: 'fixed',
      runOffset: map.initializedRunBase - map.writableBase,
      loadPlacement: 'fixed',
      loadRegionId: bank + 1,
      loadOffset: dataStart,
      fill: begin.imageFill,
    });
    sections.push(section);
    initializedSection = section;
    segments.push(
      Object.freeze({
        bank,
        section,
        loadStart: map.dataLoadAddress,
        loadEnd: map.dataLoadAddress + map.dataLoadLength,
      }),
    );
    addImageSection(bank, dataEnd, usedLength);
  }
  const initSection =
    initializedSection ?? fail('Nucleus initializer section was not converted');
  let bssSection: Nobj1Section | undefined;
  if (map.bssLength > 0) {
    bssSection = Object.freeze({
      id: nextSectionId++,
      storageKind: 2,
      permissions: NOBJ1_PERMISSION.read | NOBJ1_PERMISSION.write,
      alignment: 1,
      length: map.bssLength,
      runRegionId: writableRegionId,
      runPlacement: 'fixed',
      runOffset: map.bssBase - map.writableBase,
    });
    sections.push(bssSection);
  }

  const entryBankRegionId = map.entryBank + 1;
  const entrySegment = required(
    segments.find(
      ({ bank, section, loadStart, loadEnd }) =>
        bank === map.entryBank &&
        (section.permissions & NOBJ1_PERMISSION.execute) !== 0 &&
        map.entryAddress >= loadStart &&
        map.entryAddress < loadEnd,
    ),
    'Nucleus entry does not identify executable image bytes',
  );
  const entryOffset = map.entryAddress - entrySegment.loadStart;
  const entrySymbolId = 1;
  const startupRangeId = 1;
  const vectorRangeId = 2;
  const runtimeStateRangeId = 3;
  const initializedRunRangeId = 4;
  const initializedLoadRangeId = 5;
  const bssRangeId = bssSection === undefined ? 0 : 6;
  const ranges: Nobj1Range[] = [
    {
      id: startupRangeId,
      sectionId: entrySegment.section.id,
      view: 'run',
      offset: entryOffset,
      length: 1,
    },
    {
      id: vectorRangeId,
      sectionId: initSection.id,
      view: 'run',
      offset: 0,
      length: map.vectorLength,
    },
    {
      id: runtimeStateRangeId,
      sectionId: initSection.id,
      view: 'run',
      offset: map.vectorLength,
      length: stateLength,
    },
    {
      id: initializedRunRangeId,
      sectionId: initSection.id,
      view: 'run',
      offset: 0,
      length: map.initializedRunLength,
    },
    {
      id: initializedLoadRangeId,
      sectionId: initSection.id,
      view: 'load',
      offset: 0,
      length: map.dataLoadLength,
    },
  ];
  if (bssSection !== undefined) {
    ranges.push({
      id: bssRangeId,
      sectionId: bssSection.id,
      view: 'run',
      offset: 0,
      length: map.bssLength,
    });
  }

  const bankRangeIds: Array<Readonly<{ readOnly: number; aggregate: number }>> =
    [];
  let nextRangeId = 7;
  for (let bank = 0; bank < begin.bankCount; bank += 1) {
    const layout = required(
      map.banks[bank],
      'Nucleus MAP bank layout is missing',
    );
    const readOnly =
      layout.readOnlyLength === 0
        ? undefined
        : findSegment(
            segments,
            bank,
            layout.readOnlyBase,
            layout.readOnlyLength,
          );
    if (layout.readOnlyLength > 0 && readOnly === undefined) {
      fail('Nucleus read-only range crosses converted SECTION boundaries');
    }
    const readOnlyId = readOnly === undefined ? 0 : nextRangeId++;
    if (readOnly !== undefined) {
      ranges.push({
        id: readOnlyId,
        sectionId: readOnly.section.id,
        view: 'load',
        offset: layout.readOnlyBase - readOnly.loadStart,
        length: layout.readOnlyLength,
      });
    }
    const aggregate =
      layout.aggregateConstantLength === 0
        ? undefined
        : findSegment(
            segments,
            bank,
            layout.aggregateConstantBase,
            layout.aggregateConstantLength,
          );
    if (layout.aggregateConstantLength > 0 && aggregate === undefined) {
      fail('Nucleus aggregate range crosses converted SECTION boundaries');
    }
    const aggregateId = aggregate === undefined ? 0 : nextRangeId++;
    if (aggregate !== undefined) {
      ranges.push({
        id: aggregateId,
        sectionId: aggregate.section.id,
        view: 'load',
        offset: layout.aggregateConstantBase - aggregate.loadStart,
        length: layout.aggregateConstantLength,
      });
    }
    bankRangeIds.push(
      Object.freeze({
        readOnly: readOnlyId,
        aggregate: aggregateId,
      }),
    );
  }

  const bankIds = Array.from(
    { length: begin.bankCount },
    (_, bank) => bank + 1,
  );
  const contractData: number[] = [
    ...u16(begin.runtimeIdentity),
    (map.romMode ? 1 : 0) | (map.establishedStack ? 2 : 0),
    ...u16(entrySymbolId),
    ...u16(writableRegionId),
    ...u16(startupRangeId),
    ...u16(vectorRangeId),
    ...u16(runtimeStateRangeId),
    ...u16(initializedRunRangeId),
    ...u16(initializedLoadRangeId),
    ...u16(bssRangeId),
    ...u16(map.stackRequirement),
    begin.bankCount,
  ];
  for (let bank = 0; bank < begin.bankCount; bank += 1) {
    const ids = required(
      bankRangeIds[bank],
      'Nucleus bank range IDs are missing',
    );
    contractData.push(
      ...u16(bankIds[bank] ?? 0),
      ...u16(ids.readOnly),
      ...u16(ids.aggregate),
    );
  }

  const sourceParts: number[] = [...u16(map.partBanks.length)];
  for (const bank of map.partBanks) sourceParts.push(...u16(bank + 1));
  const symbols = [
    {
      id: entrySymbolId,
      binding: 'local' as const,
      valueKind: 1 as const,
      sectionId: entrySegment.section.id,
      offset: entryOffset,
    },
  ];
  const draft: Nobj1ObjectDraft = {
    begin: { targetId: 1 },
    contracts: [
      {
        id: 1,
        key: 'org.nucleus.runtime',
        majorVersion: 0,
        minorVersion: 1,
        data: Uint8Array.from(contractData),
      },
    ],
    regions,
    sections,
    ranges,
    images: mapOperations(legacy.images, segments),
    patches: mapOperations(legacy.patches, segments),
    symbols,
    relocations: [],
    metadata: [
      {
        key: 'org.nobj.source-parts',
        majorVersion: 1,
        minorVersion: 0,
        data: Uint8Array.from(sourceParts),
      },
    ],
    layout: { mode: 'placed', entrySymbolId },
  };
  const object = parseNobj1(encodeNobj1(draft));
  const materialized = materializeNobj1Object(object, bankIds);
  for (let bank = 0; bank < begin.bankCount; bank += 1) {
    const output = materialized.regions[bank];
    const previous = legacy.targetImage.banks[bank];
    const oldLayout = map.banks[bank];
    if (
      output === undefined ||
      previous === undefined ||
      oldLayout === undefined ||
      output.usedLength !== oldLayout.usedLength ||
      !output.bytes.every((byte, index) => byte === previous[index])
    ) {
      fail(`Nucleus NOBJ conversion changed bank ${bank} bytes or used extent`);
    }
  }
  const convertedEntry = object.symbols.find(
    ({ id }) => id === object.layout.entrySymbolId,
  );
  const convertedSection = object.sections.find(
    ({ id }) =>
      convertedEntry?.binding === 'local' && id === convertedEntry.sectionId,
  );
  const convertedRegion = object.regions.find(
    ({ id }) => id === convertedSection?.runRegionId,
  );
  if (
    convertedEntry?.binding !== 'local' ||
    convertedSection === undefined ||
    convertedRegion === undefined ||
    convertedRegion.base +
      convertedSection.runOffset +
      convertedEntry.offset !==
      map.entryAddress
  ) {
    fail('Nucleus NOBJ conversion changed the entry address');
  }
  const contract = required(
    object.contracts.find(({ key }) => key === 'org.nucleus.runtime'),
    'converted Nucleus runtime contract is missing',
  );
  const contractPayload = contract.data;
  const contractWritableRegionId = readU16(contractPayload, 5);
  const contractStartupRangeId = readU16(contractPayload, 7);
  const contractVectorRangeId = readU16(contractPayload, 9);
  const contractStateRangeId = readU16(contractPayload, 11);
  const contractInitializedRunRangeId = readU16(contractPayload, 13);
  const contractInitializedLoadRangeId = readU16(contractPayload, 15);
  const contractBssRangeId = readU16(contractPayload, 17);
  const resolveRange = (rangeId: number) => {
    const range = required(
      object.ranges.find(({ id }) => id === rangeId),
      `converted Nucleus RANGE ${rangeId} is missing`,
    );
    const section = required(
      object.sections.find(({ id }) => id === range.sectionId),
      'converted Nucleus RANGE SECTION is missing',
    );
    const regionId =
      range.view === 'run' ? section.runRegionId : (section.loadRegionId ?? 0);
    const region = required(
      object.regions.find(({ id }) => id === regionId),
      'converted Nucleus RANGE REGION is missing',
    );
    const offset =
      range.view === 'run'
        ? section.runOffset
        : section.loadPlacement === 'same'
          ? section.runOffset
          : (section.loadOffset ?? 0);
    const start = region.base + offset + range.offset;
    return Object.freeze({
      range,
      section,
      region,
      start,
      end: start + range.length,
    });
  };
  const writableRegion = required(
    object.regions.find(({ id }) => id === contractWritableRegionId),
    'converted Nucleus writable REGION is missing',
  );
  const startup = resolveRange(contractStartupRangeId);
  const vector = resolveRange(contractVectorRangeId);
  const state = resolveRange(contractStateRangeId);
  const initializedRun = resolveRange(contractInitializedRunRangeId);
  const initializedLoad = resolveRange(contractInitializedLoadRangeId);
  const bankTableOffset = 22;
  if (
    readU16(contractPayload, 0) !== begin.runtimeIdentity ||
    byteAt(contractPayload, 2) !==
      ((map.romMode ? 1 : 0) | (map.establishedStack ? 2 : 0)) ||
    readU16(contractPayload, 3) !== entrySymbolId ||
    writableRegion.base !== map.writableBase ||
    writableRegion.capacity !== map.writableCapacity ||
    readU16(contractPayload, 19) !== map.stackRequirement ||
    byteAt(contractPayload, 21) !== begin.bankCount ||
    startup.start !== map.entryAddress ||
    startup.range.length !== 1 ||
    vector.start !== map.vectorBase ||
    vector.range.length !== map.vectorLength ||
    state.start !== map.vectorBase + map.vectorLength ||
    state.range.length !== stateLength ||
    initializedRun.start !== map.initializedRunBase ||
    initializedRun.range.length !== map.initializedRunLength ||
    initializedLoad.start !== map.dataLoadAddress ||
    initializedLoad.range.length !== map.dataLoadLength ||
    initializedLoad.region.id !== entryBankRegionId ||
    initSection.length !== map.initializedRunLength ||
    map.dataLoadLength !== map.initializedRunLength
  ) {
    fail('Nucleus NOBJ conversion changed retained runtime layout fields');
  }
  if (map.bssLength === 0) {
    if (
      contractBssRangeId !== 0 ||
      map.bssBase !== map.initializedRunBase + map.initializedRunLength
    ) {
      fail('Nucleus NOBJ conversion changed the empty BSS layout');
    }
  } else {
    const bss = resolveRange(contractBssRangeId);
    if (bss.start !== map.bssBase || bss.range.length !== map.bssLength) {
      fail('Nucleus NOBJ conversion changed the BSS extent');
    }
  }
  for (let bank = 0; bank < begin.bankCount; bank += 1) {
    const oldBank = required(map.banks[bank], 'legacy Nucleus bank is missing');
    const tableOffset = bankTableOffset + bank * 6;
    const regionId = readU16(contractPayload, tableOffset);
    const region = required(
      object.regions.find(({ id }) => id === regionId),
      'converted Nucleus bank REGION is missing',
    );
    if (
      region.id !== bank + 1 ||
      region.base !== begin.imageBase ||
      region.capacity !== begin.imageCapacity ||
      region.imageFill !== begin.imageFill
    ) {
      fail(`Nucleus NOBJ conversion changed bank ${bank} geometry`);
    }
    const rangeChecks = [
      {
        rangeId: readU16(contractPayload, tableOffset + 2),
        base: oldBank.readOnlyBase,
        length: oldBank.readOnlyLength,
      },
      {
        rangeId: readU16(contractPayload, tableOffset + 4),
        base: oldBank.aggregateConstantBase,
        length: oldBank.aggregateConstantLength,
      },
    ];
    for (const expected of rangeChecks) {
      if (expected.length === 0) {
        if (expected.rangeId !== 0 || expected.base !== 0) {
          fail(`Nucleus NOBJ conversion changed bank ${bank} empty ranges`);
        }
        continue;
      }
      const actual = resolveRange(expected.rangeId);
      if (
        actual.range.view !== 'load' ||
        actual.region.id !== region.id ||
        actual.start !== expected.base ||
        actual.range.length !== expected.length
      ) {
        fail(`Nucleus NOBJ conversion changed bank ${bank} range layout`);
      }
    }
  }
  const parts = required(
    object.metadata.find(({ key }) => key === 'org.nobj.source-parts'),
    'converted Nucleus source-parts metadata is missing',
  ).data;
  if (readU16(parts, 0) !== map.partBanks.length) {
    fail('Nucleus NOBJ conversion changed the source-part count');
  }
  for (let part = 0; part < map.partBanks.length; part += 1) {
    if (readU16(parts, 2 + part * 2) !== (map.partBanks[part] ?? 0) + 1) {
      fail('Nucleus NOBJ conversion changed source-part bank order');
    }
  }
  return Object.freeze({ legacy, object, materialized });
};
