/** Materialize the initialized image and startup extents in placed NOBJ 1.0. */

import {
  type Nobj1Object,
  type Nobj1Region,
  type Nobj1Section,
  Nobj1Error,
} from './nobj-v1.js';

export interface Nobj1CopyOperation {
  readonly sectionId: number;
  readonly sourceRegionId: number;
  readonly sourceAddress: number;
  readonly runRegionId: number;
  readonly runAddress: number;
  readonly length: number;
}

export interface Nobj1ZeroOperation {
  readonly sectionId: number;
  readonly runRegionId: number;
  readonly runAddress: number;
  readonly length: number;
}

export interface Nobj1MaterializedRegion {
  readonly regionId: number;
  readonly addressSpaceKey: string;
  readonly storageKey: string;
  readonly base: number;
  readonly capacity: number;
  readonly imageFill: number;
  readonly usedLength: number;
  readonly bytes: Uint8Array;
}

export interface Nobj1MaterializedObject {
  readonly regions: readonly Nobj1MaterializedRegion[];
  readonly copies: readonly Nobj1CopyOperation[];
  readonly zeroInitializations: readonly Nobj1ZeroOperation[];
}

const fail = (message: string): never => {
  throw new Nobj1Error(message);
};

const physicalKey = (region: Nobj1Region): string =>
  `${region.addressSpaceKey}\0${region.storageKey}`;

const requireRegion = (
  object: Nobj1Object,
  id: number,
  message: string,
): Nobj1Region => {
  const region = object.regions.find(({ id: candidate }) => candidate === id);
  return region ?? fail(message);
};

const requirePlacedLocation = (
  section: Nobj1Section,
  object: Nobj1Object,
): Readonly<{
  runRegion: Nobj1Region;
  runAddress: number;
  loadRegion?: Nobj1Region;
  loadAddress?: number;
}> => {
  if (section.runPlacement !== 'fixed') {
    fail('cannot materialize a SECTION with allocated run placement');
  }
  const runRegion = requireRegion(
    object,
    section.runRegionId,
    'SECTION run REGION is missing',
  );
  const runAddress = runRegion.base + section.runOffset;
  if (section.storageKind !== 1) {
    return Object.freeze({ runRegion, runAddress });
  }
  if (section.loadPlacement === 'allocate') {
    fail('cannot materialize a SECTION with allocated load placement');
  }
  const loadRegion = requireRegion(
    object,
    section.loadRegionId ?? 0,
    'SECTION load REGION is missing',
  );
  const loadAddress =
    section.loadPlacement === 'same'
      ? runAddress
      : loadRegion.base + (section.loadOffset ?? 0);
  return Object.freeze({ runRegion, runAddress, loadRegion, loadAddress });
};

/**
 * Materialize selected image REGIONs after placement is fixed. Section fill
 * initializes declared LOAD extents, IMAGE overlays producer bytes, and PATCH
 * applies final literal replacements. Runtime copy and BSS work is returned
 * separately; this function does not execute an initialization plan.
 */
export const materializeNobj1Object = (
  object: Nobj1Object,
  selectedRegionIds: readonly number[] = object.regions.map(({ id }) => id),
): Nobj1MaterializedObject => {
  if (object.relocations.length !== 0) {
    fail('cannot materialize an object with unresolved relocations');
  }
  if (
    object.symbols.some(
      ({ binding }) => binding === 'import' || binding === 'service-import',
    )
  ) {
    fail('cannot materialize an object with unresolved imports');
  }
  const seen = new Set<number>();
  const selected: Nobj1Region[] = [];
  for (const id of selectedRegionIds) {
    if (seen.has(id)) fail('image REGION selection contains a duplicate ID');
    seen.add(id);
    selected.push(
      requireRegion(object, id, 'selected image REGION is missing'),
    );
  }
  const outputs = selected.map((region) => {
    const bytes = new Uint8Array(region.capacity);
    bytes.fill(region.imageFill);
    let usedEnd = region.base;
    const extents = new Map<number, Readonly<{ start: number; end: number }>>();
    for (const section of object.sections) {
      if (section.storageKind !== 1) continue;
      const location = requirePlacedLocation(section, object);
      const loadRegion =
        location.loadRegion ??
        fail('initialized SECTION has no resolved LOAD REGION');
      const loadAddress =
        location.loadAddress ??
        fail('initialized SECTION has no resolved LOAD address');
      if (physicalKey(loadRegion) !== physicalKey(region)) continue;
      const end = loadAddress + section.length;
      const regionEnd = region.base + region.capacity;
      const overlaps = loadAddress < regionEnd && region.base < end;
      if (!overlaps) continue;
      if (loadAddress < region.base || end > regionEnd) {
        fail('initialized LOAD extent partially intersects an image REGION');
      }
      const offset = loadAddress - region.base;
      const sectionEnd = offset + section.length;
      bytes.fill(section.fill ?? 0, offset, sectionEnd);
      usedEnd = Math.max(usedEnd, end);
      extents.set(section.id, { start: offset, end: sectionEnd });
    }
    for (const image of object.images) {
      const extent = extents.get(image.sectionId);
      if (extent === undefined) continue;
      const start = extent.start + image.offset;
      bytes.set(image.bytes, start);
    }
    for (const patch of object.patches) {
      const extent = extents.get(patch.sectionId);
      if (extent === undefined) continue;
      const start = extent.start + patch.offset;
      bytes.set(patch.bytes, start);
    }
    return Object.freeze({
      regionId: region.id,
      addressSpaceKey: region.addressSpaceKey,
      storageKey: region.storageKey,
      base: region.base,
      capacity: region.capacity,
      imageFill: region.imageFill,
      usedLength: usedEnd - region.base,
      bytes,
    });
  });

  const copies: Nobj1CopyOperation[] = [];
  const zeroInitializations: Nobj1ZeroOperation[] = [];
  for (const section of object.sections) {
    const location = requirePlacedLocation(section, object);
    if (section.storageKind === 1) {
      const loadRegion =
        location.loadRegion ??
        fail('initialized SECTION has no resolved LOAD REGION');
      const loadAddress =
        location.loadAddress ??
        fail('initialized SECTION has no resolved LOAD address');
      if (
        physicalKey(loadRegion) === physicalKey(location.runRegion) &&
        loadAddress === location.runAddress
      ) {
        continue;
      }
      copies.push(
        Object.freeze({
          sectionId: section.id,
          sourceRegionId: loadRegion.id,
          sourceAddress: loadAddress,
          runRegionId: location.runRegion.id,
          runAddress: location.runAddress,
          length: section.length,
        }),
      );
    } else if (section.storageKind === 2) {
      zeroInitializations.push(
        Object.freeze({
          sectionId: section.id,
          runRegionId: location.runRegion.id,
          runAddress: location.runAddress,
          length: section.length,
        }),
      );
    }
  }

  return Object.freeze({
    regions: Object.freeze(outputs),
    copies: Object.freeze(copies),
    zeroInitializations: Object.freeze(zeroInitializations),
  });
};
