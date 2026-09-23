/** Canonical NOBJ 1.0 writer; encoded streams are revalidated before return. */

import { nobjCrc16CcittFalse } from './nobj-framing.js';
import {
  NOBJ1_KIND,
  Nobj1Error,
  parseNobj1,
  type Nobj1Object,
  type Nobj1Relocation,
  type Nobj1Section,
  type Nobj1Symbol,
} from './nobj-v1.js';

export type Nobj1ObjectDraft = Omit<Nobj1Object, 'serialized' | 'commit'>;

const fail = (message: string): never => {
  throw new Nobj1Error(message);
};

const requireUnsigned = (
  name: string,
  value: number,
  maximum: number,
): void => {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    fail(`${name} is outside 0..${maximum}`);
  }
};

const appendU8 = (bytes: number[], name: string, value: number): void => {
  requireUnsigned(name, value, 0xff);
  bytes.push(value);
};

const appendU16 = (bytes: number[], name: string, value: number): void => {
  requireUnsigned(name, value, 0xffff);
  bytes.push(value & 0xff, value >>> 8);
};

const appendU32 = (bytes: number[], name: string, value: number): void => {
  requireUnsigned(name, value, 0xffff_ffff);
  bytes.push(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
};

const appendI32 = (bytes: number[], name: string, value: number): void => {
  if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    fail(`${name} is outside -2147483648..2147483647`);
  }
  appendU32(bytes, name, value < 0 ? value + 0x1_0000_0000 : value);
};

const appendAscii = (bytes: number[], name: string, value: string): void => {
  if (value.length < 1 || value.length > 63) {
    fail(`${name} length is outside 1..63`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 0x7f) fail(`${name} must contain ASCII characters`);
    bytes.push(code);
  }
};

const record = (kind: number, payload: readonly number[]): Uint8Array => {
  if (payload.length > 0xffff) {
    fail('NOBJ 1.0 record payload exceeds 65,535 bytes');
  }
  return Uint8Array.from([
    kind,
    payload.length & 0xff,
    payload.length >>> 8,
    ...payload,
  ]);
};

const encodeBegin = (targetId: number): Uint8Array => {
  const payload = [0x4e, 0x4f, 0x42, 0x4a, 1, 0];
  appendU16(payload, 'BEGIN target ID', targetId);
  payload.push(0);
  return record(NOBJ1_KIND.begin, payload);
};

const encodeContract = (contract: Nobj1ObjectDraft['contracts'][number]) => {
  const payload: number[] = [];
  appendU16(payload, 'CONTRACT ID', contract.id);
  appendU8(payload, 'CONTRACT key length', contract.key.length);
  appendAscii(payload, 'CONTRACT key', contract.key);
  appendU16(payload, 'CONTRACT major version', contract.majorVersion);
  appendU16(payload, 'CONTRACT minor version', contract.minorVersion);
  appendU16(payload, 'CONTRACT data length', contract.data.length);
  payload.push(...contract.data);
  return record(NOBJ1_KIND.contract, payload);
};

const encodeRegion = (region: Nobj1ObjectDraft['regions'][number]) => {
  const payload: number[] = [];
  appendU16(payload, 'REGION ID', region.id);
  appendU8(
    payload,
    'REGION address-space key length',
    region.addressSpaceKey.length,
  );
  appendAscii(payload, 'REGION address-space key', region.addressSpaceKey);
  appendU8(payload, 'REGION storage key length', region.storageKey.length);
  appendAscii(payload, 'REGION storage key', region.storageKey);
  appendU16(payload, 'REGION base', region.base);
  appendU32(payload, 'REGION capacity', region.capacity);
  appendU8(payload, 'REGION image fill', region.imageFill);
  appendU8(payload, 'REGION permissions', region.permissions);
  appendU8(payload, 'REGION flags', region.banked ? 1 : 0);
  return record(NOBJ1_KIND.region, payload);
};

const encodeSection = (section: Nobj1Section) => {
  const payload: number[] = [];
  appendU16(payload, 'SECTION ID', section.id);
  appendU8(payload, 'SECTION storage kind', section.storageKind);
  appendU8(payload, 'SECTION permissions', section.permissions);
  appendU16(payload, 'SECTION alignment', section.alignment);
  appendU32(payload, 'SECTION length', section.length);
  appendU16(payload, 'SECTION run REGION ID', section.runRegionId);
  appendU8(
    payload,
    'SECTION run placement',
    section.runPlacement === 'fixed' ? 0 : 1,
  );
  appendU32(payload, 'SECTION run offset', section.runOffset);
  if (section.storageKind === 1) {
    const loadPlacement =
      section.loadPlacement ??
      fail('initialized SECTION is missing LOAD placement');
    const loadRegionId =
      section.loadRegionId ??
      fail('initialized SECTION is missing a LOAD REGION');
    const loadOffset =
      section.loadOffset ??
      fail('initialized SECTION is missing a LOAD offset');
    const fill = section.fill ?? fail('initialized SECTION is missing fill');
    appendU8(
      payload,
      'SECTION load placement',
      loadPlacement === 'same' ? 0 : loadPlacement === 'fixed' ? 1 : 2,
    );
    appendU16(payload, 'SECTION load REGION ID', loadRegionId);
    appendU32(payload, 'SECTION load offset', loadOffset);
    appendU8(payload, 'SECTION fill', fill);
  }
  return record(NOBJ1_KIND.section, payload);
};

const encodeRange = (range: Nobj1ObjectDraft['ranges'][number]) => {
  const payload: number[] = [];
  appendU16(payload, 'RANGE ID', range.id);
  appendU16(payload, 'RANGE SECTION ID', range.sectionId);
  appendU8(payload, 'RANGE view', range.view === 'run' ? 0 : 1);
  appendU32(payload, 'RANGE offset', range.offset);
  appendU32(payload, 'RANGE length', range.length);
  return record(NOBJ1_KIND.range, payload);
};

const encodeImage = (
  kind: typeof NOBJ1_KIND.image | typeof NOBJ1_KIND.patch,
  image: Nobj1ObjectDraft['images'][number],
) => {
  if (image.bytes.length === 0) fail('IMAGE/PATCH requires at least one byte');
  const payload: number[] = [];
  appendU16(payload, 'IMAGE/PATCH SECTION ID', image.sectionId);
  appendU32(payload, 'IMAGE/PATCH offset', image.offset);
  payload.push(...image.bytes);
  return record(kind, payload);
};

const encodeSymbol = (symbol: Nobj1Symbol) => {
  const payload: number[] = [];
  appendU16(payload, 'SYMBOL ID', symbol.id);
  const binding =
    symbol.binding === 'local'
      ? 0
      : symbol.binding === 'export'
        ? 1
        : symbol.binding === 'import'
          ? 2
          : 3;
  appendU8(payload, 'SYMBOL binding', binding);
  appendU8(payload, 'SYMBOL value kind', symbol.valueKind);
  if (symbol.binding === 'local' || symbol.binding === 'export') {
    appendU16(payload, 'SYMBOL SECTION ID', symbol.sectionId);
    appendU32(payload, 'SYMBOL offset', symbol.offset);
    if (symbol.binding === 'export') {
      appendU8(payload, 'SYMBOL namespace length', symbol.namespace.length);
      appendAscii(payload, 'SYMBOL namespace', symbol.namespace);
      appendU8(payload, 'SYMBOL name length', symbol.name.length);
      appendAscii(payload, 'SYMBOL name', symbol.name);
    }
  } else if (symbol.binding === 'import') {
    appendU8(payload, 'SYMBOL namespace length', symbol.namespace.length);
    appendAscii(payload, 'SYMBOL namespace', symbol.namespace);
    appendU8(payload, 'SYMBOL name length', symbol.name.length);
    appendAscii(payload, 'SYMBOL name', symbol.name);
  } else {
    appendU16(payload, 'SYMBOL contract ID', symbol.contractId);
    appendU8(payload, 'SYMBOL service key length', symbol.serviceKey.length);
    appendAscii(payload, 'SYMBOL service key', symbol.serviceKey);
  }
  return record(NOBJ1_KIND.symbol, payload);
};

const encodeRelocation = (relocation: Nobj1Relocation) => {
  const payload: number[] = [];
  appendU16(payload, 'RELOC source SECTION ID', relocation.siteSectionId);
  appendU32(payload, 'RELOC site offset', relocation.siteOffset);
  appendU8(payload, 'RELOC kind', relocation.kind);
  appendU8(payload, 'RELOC use', relocation.use);
  appendU16(payload, 'RELOC target SYMBOL ID', relocation.targetSymbolId);
  appendI32(payload, 'RELOC addend', relocation.addend);
  return record(NOBJ1_KIND.relocation, payload);
};

const encodeMetadata = (metadata: Nobj1ObjectDraft['metadata'][number]) => {
  const payload: number[] = [];
  appendU8(payload, 'METADATA key length', metadata.key.length);
  appendAscii(payload, 'METADATA key', metadata.key);
  appendU16(payload, 'METADATA major version', metadata.majorVersion);
  appendU16(payload, 'METADATA minor version', metadata.minorVersion);
  payload.push(0);
  appendU16(payload, 'METADATA data length', metadata.data.length);
  payload.push(...metadata.data);
  return record(NOBJ1_KIND.metadata, payload);
};

const encodeLayout = (draft: Nobj1ObjectDraft) => {
  const payload = [draft.layout.mode === 'module' ? 0 : 1, 0];
  appendU16(payload, 'LAYOUT entry SYMBOL ID', draft.layout.entrySymbolId);
  return record(NOBJ1_KIND.layout, payload);
};

const concatenate = (parts: readonly Uint8Array[]): Uint8Array => {
  const total = parts.reduce((length, part) => length + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const compareAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Encode one complete NOBJ 1.0 object and reject drafts outside the schema. */
export const encodeNobj1 = (draft: Nobj1ObjectDraft): Uint8Array => {
  const records: Uint8Array[] = [encodeBegin(draft.begin.targetId)];
  records.push(
    ...[...draft.contracts]
      .sort((left, right) => left.id - right.id)
      .map(encodeContract),
  );
  records.push(
    ...[...draft.regions]
      .sort((left, right) => left.id - right.id)
      .map(encodeRegion),
  );
  records.push(
    ...[...draft.sections]
      .sort((left, right) => left.id - right.id)
      .map(encodeSection),
  );
  records.push(
    ...[...draft.ranges]
      .sort((left, right) => left.id - right.id)
      .map(encodeRange),
  );
  records.push(
    ...[...draft.images]
      .sort(
        (left, right) =>
          left.sectionId - right.sectionId || left.offset - right.offset,
      )
      .map((image) => encodeImage(NOBJ1_KIND.image, image)),
  );
  records.push(
    ...draft.patches.map((patch) => encodeImage(NOBJ1_KIND.patch, patch)),
  );
  records.push(
    ...[...draft.symbols]
      .sort((left, right) => left.id - right.id)
      .map(encodeSymbol),
  );
  records.push(...draft.relocations.map(encodeRelocation));
  records.push(
    ...[...draft.metadata]
      .sort(
        (left, right) =>
          compareAscii(left.key, right.key) ||
          left.majorVersion - right.majorVersion ||
          left.minorVersion - right.minorVersion,
      )
      .map(encodeMetadata),
  );
  records.push(encodeLayout(draft));

  const recordCount = records.length + 1;
  requireUnsigned('COMMIT record count', recordCount, 0xffff_ffff);
  const commitPayload = [
    recordCount & 0xff,
    (recordCount >>> 8) & 0xff,
    (recordCount >>> 16) & 0xff,
    (recordCount >>> 24) & 0xff,
    draft.layout.mode === 'module' ? 0 : 1,
    draft.layout.entrySymbolId & 0xff,
    draft.layout.entrySymbolId >>> 8,
  ];
  const commitCoveredPrefix = Uint8Array.from([
    NOBJ1_KIND.commit,
    9,
    0,
    ...commitPayload,
  ]);
  const covered = concatenate([...records, commitCoveredPrefix]);
  const checksum = nobjCrc16CcittFalse(covered);
  const encoded = concatenate([
    covered,
    Uint8Array.from([checksum & 0xff, checksum >>> 8]),
  ]);
  parseNobj1(encoded);
  return encoded;
};
