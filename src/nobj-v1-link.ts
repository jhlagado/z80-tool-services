/** Pure multi-object placement, relocation, and image construction for NOBJ 1.0. */

import { encodeNobj1 } from './nobj-v1-codec.js';
import {
  NOBJ1_PERMISSION,
  Nobj1Error,
  parseNobj1,
  type Nobj1Contract,
  type Nobj1Object,
  type Nobj1Region,
  type Nobj1Relocation,
  type Nobj1Section,
  type Nobj1Symbol,
} from './nobj-v1.js';

export interface Nobj1LinkObject {
  readonly id: string;
  readonly object: Nobj1Object;
}

export interface Nobj1ContractIdentity {
  readonly key: string;
  readonly majorVersion: number;
  readonly minorVersion: number;
}

export interface Nobj1TargetRegion {
  /** Target-layout-local identifier; object REGION IDs remain object-scoped. */
  readonly id: string;
  readonly addressSpaceKey: string;
  readonly storageKey: string;
  readonly base: number;
  readonly capacity: number;
  readonly imageFill: number;
  readonly permissions: number;
  readonly banked: boolean;
}

export interface Nobj1RegionIdentity {
  readonly addressSpaceKey: string;
  readonly storageKey: string;
}

export interface Nobj1TargetVisibility {
  readonly from: Nobj1RegionIdentity;
  readonly to: Nobj1RegionIdentity;
  readonly use: Nobj1Relocation['use'];
}

export interface Nobj1TargetLayout {
  readonly regions: readonly Nobj1TargetRegion[];
  /** Visibility is directed. A region is always visible from itself. */
  readonly visibility: readonly Nobj1TargetVisibility[];
}

export interface Nobj1SectionPlacement {
  readonly objectId: string;
  readonly sectionId: number;
  readonly runRegionId: number;
  readonly runTargetRegionId: string;
  readonly runAddress: number;
  readonly loadRegionId?: number;
  readonly loadTargetRegionId?: string;
  readonly loadAddress?: number;
}

export interface Nobj1LinkedRegionImage {
  readonly targetRegionId: string;
  readonly addressSpaceKey: string;
  readonly storageKey: string;
  readonly base: number;
  readonly capacity: number;
  readonly imageFill: number;
  readonly usedLength: number;
  readonly bytes: Uint8Array;
}

export interface Nobj1LinkedCopyOperation {
  readonly objectId: string;
  readonly sectionId: number;
  readonly sourceRegionId: number;
  readonly sourceAddress: number;
  readonly runRegionId: number;
  readonly runAddress: number;
  readonly length: number;
}

export interface Nobj1LinkedZeroOperation {
  readonly objectId: string;
  readonly sectionId: number;
  readonly runRegionId: number;
  readonly runAddress: number;
  readonly length: number;
}

export interface Nobj1ResolvedRelocation {
  readonly objectId: string;
  readonly siteSectionId: number;
  readonly siteOffset: number;
  readonly kind: Nobj1Relocation['kind'];
  readonly use: Nobj1Relocation['use'];
  readonly value: number;
  readonly targetObjectId: string;
  readonly targetSymbolId: number;
}

export interface Nobj1LinkEntry {
  readonly objectId: string;
  readonly symbolId: number;
  readonly address: number;
}

export interface Nobj1LinkResult {
  readonly placements: readonly Nobj1SectionPlacement[];
  readonly regions: readonly Nobj1LinkedRegionImage[];
  readonly copies: readonly Nobj1LinkedCopyOperation[];
  readonly zeroInitializations: readonly Nobj1LinkedZeroOperation[];
  readonly relocations: readonly Nobj1ResolvedRelocation[];
  readonly entry?: Nobj1LinkEntry;
}

export interface Nobj1InitializerSourceContext {
  readonly objectId: string;
  readonly object: Nobj1Object;
  readonly contract: Nobj1Contract;
  readonly relocation: Nobj1Relocation;
  readonly sourceSection: Nobj1Section;
  readonly sourceRunRegion: Nobj1Region;
  readonly siteRunAddress: number;
  readonly siteLoadAddress: number;
  readonly targetObjectId: string;
  readonly targetSymbol: Nobj1Symbol;
  readonly targetSection: Nobj1Section;
  readonly targetLoadRegion: Nobj1Region;
  readonly targetLoadAddress: number;
  readonly adjustedTargetOffset: number;
}

export interface Nobj1PlacedContractContext {
  readonly objectId: string;
  readonly object: Nobj1Object;
  readonly contract: Nobj1Contract;
  readonly placements: readonly Nobj1SectionPlacement[];
}

export interface Nobj1ContractValidator extends Nobj1ContractIdentity {
  /** Service imports are legal only for schemas explicitly marked service-bearing. */
  readonly serviceBearing?: boolean;
  /** Required for contract identities not validated by the NOBJ core. */
  readonly validate?: (contract: Nobj1Contract, owner: Nobj1LinkObject) => void;
  /** Additional checks that need final section addresses. */
  readonly validatePlaced?: (context: Nobj1PlacedContractContext) => void;
  /** Authorizes one ABS16_LOAD initializer source relocation. */
  readonly authorizeInitializerSource?: (
    context: Nobj1InitializerSourceContext,
  ) => boolean;
}

export interface Nobj1ServiceBinding {
  readonly contract: Nobj1ContractIdentity;
  readonly key: string;
  /** Symbol ID in the provider's object, not a link-global ID. */
  readonly symbolId: number;
}

export interface Nobj1ContractObligation {
  readonly objectId: string;
  readonly object: Nobj1Object;
  readonly contract: Nobj1Contract;
  readonly placements: readonly Nobj1SectionPlacement[];
}

export interface Nobj1RuntimeProvider {
  readonly id: string;
  readonly objectId: string;
  readonly supports: readonly Nobj1ContractIdentity[];
  readonly services: readonly Nobj1ServiceBinding[];
  /**
   * Optional whole-link policy. Obligations remain separate and object-scoped;
   * the provider decides whether repeated records can coexist.
   */
  readonly validateObligations?: (
    identity: Nobj1ContractIdentity,
    obligations: readonly Nobj1ContractObligation[],
  ) => void;
}

export interface Nobj1LinkOptions {
  readonly mainObjectId: string;
  readonly target: Nobj1TargetLayout;
  readonly providers: readonly Nobj1RuntimeProvider[];
  readonly contractValidators?: readonly Nobj1ContractValidator[];
}

export class Nobj1LinkError extends Nobj1Error {
  constructor(message: string) {
    super(message);
    this.name = 'Nobj1LinkError';
  }
}

interface ResolvedInput {
  readonly id: string;
  readonly object: Nobj1Object;
  readonly regionMap: ReadonlyMap<number, Nobj1TargetRegion>;
}

interface SectionState {
  readonly input: ResolvedInput;
  readonly section: Nobj1Section;
  runAddress?: number;
  loadAddress?: number;
}

interface Allocation {
  readonly objectId: string;
  readonly sectionId: number;
  readonly addressSpaceKey: string;
  readonly storageKey: string;
  readonly start: number;
  readonly end: number;
}

interface ResolvedDefinition {
  readonly objectId: string;
  readonly symbol: Extract<Nobj1Symbol, { sectionId: number; offset: number }>;
  readonly section: Nobj1Section;
}

interface RelocationResolution extends Nobj1ResolvedRelocation {
  readonly sourceLoadAddress: number;
}

const BUILTIN_CONTRACTS: readonly Nobj1ContractValidator[] = Object.freeze([
  Object.freeze({
    key: 'org.skate.runtime',
    majorVersion: 2,
    minorVersion: 0,
    serviceBearing: true,
  }),
  Object.freeze({
    key: 'org.skate.value',
    majorVersion: 2,
    minorVersion: 0,
  }),
  Object.freeze({
    key: 'org.nucleus.runtime',
    majorVersion: 0,
    minorVersion: 1,
    authorizeInitializerSource: authorizeNucleusInitializerSource,
  }),
]);

function fail(message: string): never {
  throw new Nobj1LinkError(message);
}

const readU16 = (bytes: Uint8Array, offset: number): number => {
  const low = bytes[offset];
  const high = bytes[offset + 1];
  if (low === undefined || high === undefined) {
    return fail('contract data is truncated');
  }
  return low | (high << 8);
};

const physicalKey = (region: Nobj1Region | Nobj1TargetRegion): string =>
  `${region.addressSpaceKey}\0${region.storageKey}`;

const identityKey = (identity: Nobj1RegionIdentity): string =>
  `${identity.addressSpaceKey}\0${identity.storageKey}`;

const contractKey = (identity: Nobj1ContractIdentity): string =>
  `${identity.key}\0${identity.majorVersion}\0${identity.minorVersion}`;

const requireIdentity = (identity: Nobj1ContractIdentity): void => {
  if (
    !/^[a-z0-9][a-z0-9._/-]{0,62}$/.test(identity.key) ||
    !Number.isInteger(identity.majorVersion) ||
    identity.majorVersion < 0 ||
    identity.majorVersion > 0xffff ||
    !Number.isInteger(identity.minorVersion) ||
    identity.minorVersion < 0 ||
    identity.minorVersion > 0xffff
  ) {
    fail('contract identity is not canonical');
  }
};

const qualifiedName = (namespace: string, name: string): string =>
  `${namespace}\0${name}`;

const inputKey = (objectId: string, localId: number): string =>
  `${objectId}\0${localId}`;

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const validateTarget = (target: Nobj1TargetLayout): void => {
  if (
    target === null ||
    typeof target !== 'object' ||
    !Array.isArray(target.regions) ||
    !Array.isArray(target.visibility)
  ) {
    fail('target layout requires regions and visibility arrays');
  }
  const ids = new Set<string>();
  const identities = new Set<string>();
  for (const region of target.regions) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(region.id)) {
      fail('target REGION ID is not canonical');
    }
    if (ids.has(region.id)) fail('target REGION IDs must be unique');
    ids.add(region.id);
    if (
      !/^[a-z0-9][a-z0-9._/-]{0,62}$/.test(region.addressSpaceKey) ||
      !/^[a-z0-9][a-z0-9._/-]{0,62}$/.test(region.storageKey)
    ) {
      fail('target REGION identity is not canonical');
    }
    if (
      !Number.isInteger(region.base) ||
      region.base < 0 ||
      region.base > 0xffff ||
      !Number.isInteger(region.capacity) ||
      region.capacity <= 0 ||
      region.base + region.capacity > 0x1_0000 ||
      !Number.isInteger(region.imageFill) ||
      region.imageFill < 0 ||
      region.imageFill > 0xff ||
      !Number.isInteger(region.permissions) ||
      region.permissions <= 0 ||
      (region.permissions & ~0x07) !== 0 ||
      typeof region.banked !== 'boolean'
    ) {
      fail(`target REGION ${region.id} has invalid geometry or attributes`);
    }
    identities.add(physicalKey(region));
  }
  for (let leftIndex = 0; leftIndex < target.regions.length; leftIndex += 1) {
    const left = target.regions[leftIndex];
    if (left === undefined) continue;
    const leftEnd = left.base + left.capacity;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < target.regions.length;
      rightIndex += 1
    ) {
      const right = target.regions[rightIndex];
      if (right === undefined || physicalKey(left) !== physicalKey(right)) {
        continue;
      }
      const overlaps =
        left.base < right.base + right.capacity && right.base < leftEnd;
      if (overlaps && left.imageFill !== right.imageFill) {
        fail('overlapping target REGION aliases disagree about image fill');
      }
    }
  }

  const visibilityEdges = new Set<string>();
  for (const edge of target.visibility) {
    if (
      edge === null ||
      typeof edge !== 'object' ||
      edge.from === null ||
      typeof edge.from !== 'object' ||
      edge.to === null ||
      typeof edge.to !== 'object'
    ) {
      fail('target visibility entry is invalid');
    }
    if (
      !/^[a-z0-9][a-z0-9._/-]{0,62}$/.test(edge.from.addressSpaceKey) ||
      !/^[a-z0-9][a-z0-9._/-]{0,62}$/.test(edge.from.storageKey) ||
      !/^[a-z0-9][a-z0-9._/-]{0,62}$/.test(edge.to.addressSpaceKey) ||
      !/^[a-z0-9][a-z0-9._/-]{0,62}$/.test(edge.to.storageKey) ||
      (edge.use !== 1 && edge.use !== 2 && edge.use !== 3)
    ) {
      fail('target visibility entry is invalid');
    }
    if (
      !identities.has(identityKey(edge.from)) ||
      !identities.has(identityKey(edge.to))
    ) {
      fail('target visibility entry names unknown physical storage');
    }
    const key = `${identityKey(edge.from)}\0${identityKey(edge.to)}\0${edge.use}`;
    if (visibilityEdges.has(key)) fail('duplicate target visibility entry');
    visibilityEdges.add(key);
  }
};

const matchTargetRegion = (
  source: Nobj1Region,
  target: Nobj1TargetLayout,
): Nobj1TargetRegion => {
  const end = source.base + source.capacity;
  const candidates = target.regions.filter(
    (region) =>
      physicalKey(region) === physicalKey(source) &&
      region.base <= source.base &&
      region.base + region.capacity >= end &&
      region.imageFill === source.imageFill &&
      region.banked === source.banked &&
      (region.permissions & source.permissions) === source.permissions,
  );
  if (candidates.length === 0) {
    return fail(`object REGION ${source.id} is not supported by the target`);
  }
  return (
    [...candidates].sort(
      (left, right) =>
        left.capacity - right.capacity ||
        left.base - right.base ||
        compareText(left.id, right.id),
    )[0] ?? fail(`object REGION ${source.id} has no target match`)
  );
};

const buildInputs = (
  objects: readonly Nobj1LinkObject[],
  target: Nobj1TargetLayout,
): ResolvedInput[] => {
  if (!Array.isArray(objects) || objects.length === 0) {
    fail('link requires at least one NOBJ input object');
  }
  const seen = new Set<string>();
  return objects.map((entry) => {
    if (entry === null || typeof entry !== 'object') {
      return fail('link input is not an object');
    }
    const { id, object } = entry;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
      fail('link object ID is not canonical');
    }
    if (seen.has(id)) fail(`duplicate link object ID ${id}`);
    seen.add(id);
    if (!(object?.serialized instanceof Uint8Array)) {
      fail(`link input ${id} is not a parsed NOBJ object`);
    }
    let parsed: Nobj1Object;
    try {
      // Reparse the owned byte stream so callers cannot mutate the parsed model
      // independently of its checksum-protected representation.
      parsed = parseNobj1(object.serialized);
    } catch (error) {
      return fail(
        `link input ${id} failed NOBJ validation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const regionMap = new Map<number, Nobj1TargetRegion>();
    for (const region of parsed.regions) {
      regionMap.set(region.id, matchTargetRegion(region, target));
    }
    return Object.freeze({ id, object: parsed, regionMap });
  });
};

const schemaTable = (
  validators: readonly Nobj1ContractValidator[] = [],
): ReadonlyMap<string, Nobj1ContractValidator> => {
  if (!Array.isArray(validators)) fail('contract validators must be an array');
  const schemas = new Map<string, Nobj1ContractValidator>();
  for (const schema of BUILTIN_CONTRACTS) {
    schemas.set(contractKey(schema), schema);
  }
  for (const schema of validators) {
    requireIdentity(schema);
    const key = contractKey(schema);
    if (schemas.has(key)) {
      fail(
        `duplicate or built-in contract validator ${schema.key}@${schema.majorVersion}.${schema.minorVersion}`,
      );
    }
    if (typeof schema.validate !== 'function') {
      fail(
        `contract validator ${schema.key}@${schema.majorVersion}.${schema.minorVersion} has no validate function`,
      );
    }
    schemas.set(key, schema);
  }
  return schemas;
};

const providerTable = (
  providers: readonly Nobj1RuntimeProvider[],
  inputs: readonly ResolvedInput[],
  schemas: ReadonlyMap<string, Nobj1ContractValidator>,
): ReadonlyMap<string, Nobj1RuntimeProvider> => {
  if (!Array.isArray(providers)) fail('runtime providers must be an array');
  const inputIds = new Set(inputs.map(({ id }) => id));
  const providerIds = new Set<string>();
  const byContract = new Map<string, Nobj1RuntimeProvider>();
  for (const provider of providers) {
    if (
      provider === null ||
      typeof provider !== 'object' ||
      !Array.isArray(provider.supports) ||
      !Array.isArray(provider.services)
    ) {
      fail('runtime provider is malformed');
    }
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(provider.id) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(provider.objectId)
    ) {
      fail('runtime provider and object IDs are not canonical');
    }
    if (providerIds.has(provider.id))
      fail(`duplicate runtime provider ID ${provider.id}`);
    providerIds.add(provider.id);
    if (!inputIds.has(provider.objectId)) {
      fail(
        `runtime provider ${provider.id} names an object not supplied to the link`,
      );
    }
    const supported = new Set<string>();
    for (const identity of provider.supports) {
      requireIdentity(identity);
      const key = contractKey(identity);
      if (supported.has(key)) {
        fail(`runtime provider ${provider.id} repeats a supported contract`);
      }
      supported.add(key);
      if (byContract.has(key)) {
        fail(
          `more than one selected provider supports ${identity.key}@${identity.majorVersion}.${identity.minorVersion}`,
        );
      }
      byContract.set(key, provider);
    }
  }

  for (const input of inputs) {
    for (const contract of input.object.contracts) {
      const identity = contractKey(contract);
      const schema = schemas.get(identity);
      if (schema === undefined) {
        fail(
          `no exact validator for required contract ${contract.key}@${contract.majorVersion}.${contract.minorVersion}`,
        );
      }
      const provider = byContract.get(identity);
      if (provider === undefined) {
        fail(
          `no selected provider supports required contract ${contract.key}@${contract.majorVersion}.${contract.minorVersion}`,
        );
      }
      if (schema.validate !== undefined) {
        try {
          const validationObject = parseNobj1(input.object.serialized.slice());
          const validationContract = validationObject.contracts.find(
            ({ id }) => id === contract.id,
          );
          if (validationContract === undefined) {
            fail(
              `contract ${contract.id} disappeared while validating ${input.id}`,
            );
          }
          schema.validate(
            validationContract,
            Object.freeze({ id: input.id, object: validationObject }),
          );
        } catch (error) {
          fail(
            `contract validator rejected ${contract.key}@${contract.majorVersion}.${contract.minorVersion} in ${input.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      void provider;
    }
  }
  return byContract;
};

const findObject = (
  inputs: readonly ResolvedInput[],
  id: string,
): ResolvedInput =>
  inputs.find(({ id: candidate }) => candidate === id) ??
  fail(`unknown link object ${id}`);

const findSection = (input: ResolvedInput, id: number): Nobj1Section =>
  input.object.sections.find(({ id: candidate }) => candidate === id) ??
  fail(`object ${input.id} has no SECTION ${id}`);

const findObjectRegion = (input: ResolvedInput, id: number): Nobj1Region =>
  input.object.regions.find(({ id: candidate }) => candidate === id) ??
  fail(`object ${input.id} has no REGION ${id}`);

const sectionStateKey = (objectId: string, sectionId: number): string =>
  inputKey(objectId, sectionId);

const alignmentUp = (address: number, alignment: number): number =>
  Math.ceil(address / alignment) * alignment;

const overlaps = (left: Allocation, right: Allocation): boolean =>
  left.addressSpaceKey === right.addressSpaceKey &&
  left.storageKey === right.storageKey &&
  left.start < right.end &&
  right.start < left.end;

const placeSections = (
  inputs: readonly ResolvedInput[],
): Readonly<{
  states: readonly SectionState[];
  allocations: readonly Allocation[];
}> => {
  const states: SectionState[] = [];
  const stateByKey = new Map<string, SectionState>();
  for (const input of inputs) {
    for (const section of input.object.sections) {
      const state: SectionState = { input, section };
      states.push(state);
      stateByKey.set(sectionStateKey(input.id, section.id), state);
    }
  }
  const allocations: Allocation[] = [];

  const reserve = (
    input: ResolvedInput,
    section: Nobj1Section,
    region: Nobj1Region,
    address: number,
  ): void => {
    const candidate: Allocation = {
      objectId: input.id,
      sectionId: section.id,
      addressSpaceKey: region.addressSpaceKey,
      storageKey: region.storageKey,
      start: address,
      end: address + section.length,
    };
    for (const allocation of allocations) {
      if (!overlaps(candidate, allocation)) continue;
      if (
        candidate.objectId === allocation.objectId &&
        candidate.sectionId === allocation.sectionId &&
        candidate.start === allocation.start &&
        candidate.end === allocation.end
      ) {
        return;
      }
      fail(
        `SECTION allocation overlaps ${allocation.objectId}:${allocation.sectionId}`,
      );
    }
    allocations.push(candidate);
  };

  // Fixed extents reserve space before any first-fit allocation.
  for (const state of states) {
    const { input, section } = state;
    if (section.runPlacement === 'fixed') {
      const region = findObjectRegion(input, section.runRegionId);
      state.runAddress = region.base + section.runOffset;
      reserve(input, section, region, state.runAddress);
    }
    if (section.storageKind !== 1 || section.loadPlacement === 'same') continue;
    if (section.loadPlacement === 'fixed') {
      const region = findObjectRegion(input, section.loadRegionId ?? 0);
      state.loadAddress = region.base + (section.loadOffset ?? 0);
      reserve(input, section, region, state.loadAddress);
    }
  }

  const allocate = (
    input: ResolvedInput,
    section: Nobj1Section,
    region: Nobj1Region,
  ): number => {
    const regionEnd = region.base + region.capacity;
    let candidate = alignmentUp(region.base, section.alignment);
    while (candidate + section.length <= regionEnd) {
      const extent: Allocation = {
        objectId: input.id,
        sectionId: section.id,
        addressSpaceKey: region.addressSpaceKey,
        storageKey: region.storageKey,
        start: candidate,
        end: candidate + section.length,
      };
      if (!allocations.some((existing) => overlaps(extent, existing))) {
        allocations.push(extent);
        return candidate;
      }
      candidate += section.alignment;
    }
    return fail(`no room for SECTION ${input.id}:${section.id}`);
  };

  // Allocate in input order, section ID order, RUN before LOAD.
  for (const state of states) {
    const { input, section } = state;
    if (state.runAddress === undefined) {
      const region = findObjectRegion(input, section.runRegionId);
      state.runAddress = allocate(input, section, region);
    }
    if (section.storageKind !== 1) continue;
    if (section.loadPlacement === 'same') {
      state.loadAddress = state.runAddress;
    } else if (state.loadAddress === undefined) {
      const region = findObjectRegion(input, section.loadRegionId ?? 0);
      state.loadAddress = allocate(input, section, region);
    }
  }

  for (const state of states) {
    if (state.runAddress === undefined)
      fail('SECTION RUN placement is unresolved');
    if (state.section.storageKind === 1 && state.loadAddress === undefined) {
      fail('SECTION LOAD placement is unresolved');
    }
  }

  return Object.freeze({ states, allocations });
};

const placementsFor = (
  states: readonly SectionState[],
): Nobj1SectionPlacement[] =>
  states.map(({ input, section, runAddress, loadAddress }) => {
    const runTargetRegion = input.regionMap.get(section.runRegionId);
    if (runTargetRegion === undefined)
      fail('SECTION target RUN REGION is unresolved');
    if (runAddress === undefined) fail('SECTION RUN address is unresolved');
    if (section.storageKind !== 1) {
      return Object.freeze({
        objectId: input.id,
        sectionId: section.id,
        runRegionId: section.runRegionId,
        runTargetRegionId: runTargetRegion.id,
        runAddress,
      });
    }
    const loadRegionId = section.loadRegionId ?? section.runRegionId;
    const loadTargetRegion = input.regionMap.get(loadRegionId);
    if (loadTargetRegion === undefined || loadAddress === undefined) {
      fail('SECTION target LOAD placement is unresolved');
    }
    return Object.freeze({
      objectId: input.id,
      sectionId: section.id,
      runRegionId: section.runRegionId,
      runTargetRegionId: runTargetRegion.id,
      runAddress,
      loadRegionId,
      loadTargetRegionId: loadTargetRegion.id,
      loadAddress,
    });
  });

const fixedPlacedObject = (
  input: ResolvedInput,
  states: ReadonlyMap<string, SectionState>,
): Nobj1Object => {
  const sections = input.object.sections.map((section) => {
    const state = states.get(sectionStateKey(input.id, section.id));
    if (state?.runAddress === undefined)
      fail('SECTION RUN placement is unresolved');
    const runRegion = findObjectRegion(input, section.runRegionId);
    const runOffset = state.runAddress - runRegion.base;
    if (section.storageKind !== 1) {
      return Object.freeze({
        ...section,
        runPlacement: 'fixed' as const,
        runOffset,
      });
    }
    const loadRegionId = section.loadRegionId ?? section.runRegionId;
    const loadRegion = findObjectRegion(input, loadRegionId);
    const loadAddress = state.loadAddress;
    if (loadAddress === undefined) fail('SECTION LOAD placement is unresolved');
    const isSame =
      loadRegionId === section.runRegionId &&
      physicalKey(runRegion) === physicalKey(loadRegion) &&
      state.runAddress === loadAddress;
    return Object.freeze({
      ...section,
      runPlacement: 'fixed' as const,
      runOffset,
      loadPlacement: isSame ? ('same' as const) : ('fixed' as const),
      loadRegionId,
      loadOffset: isSame ? 0 : loadAddress - loadRegion.base,
    });
  });
  const encoded = encodeNobj1({
    begin: input.object.begin,
    contracts: input.object.contracts,
    regions: input.object.regions,
    sections,
    ranges: input.object.ranges,
    images: input.object.images,
    patches: input.object.patches,
    symbols: input.object.symbols,
    relocations: input.object.relocations,
    metadata: input.object.metadata,
    layout: input.object.layout,
  });
  return parseNobj1(encoded);
};

const buildExports = (
  inputs: readonly ResolvedInput[],
): ReadonlyMap<string, ResolvedDefinition> => {
  const exports = new Map<string, ResolvedDefinition>();
  for (const input of inputs) {
    for (const symbol of input.object.symbols) {
      if (symbol.binding !== 'export') continue;
      const name = qualifiedName(symbol.namespace, symbol.name);
      if (exports.has(name))
        fail(`duplicate qualified export ${symbol.namespace}:${symbol.name}`);
      exports.set(name, {
        objectId: input.id,
        symbol,
        section: findSection(input, symbol.sectionId),
      });
    }
  }
  return exports;
};

const makeServiceTable = (
  providers: readonly Nobj1RuntimeProvider[],
  inputs: readonly ResolvedInput[],
  schemas: ReadonlyMap<string, Nobj1ContractValidator>,
): ReadonlyMap<string, ResolvedDefinition> => {
  const services = new Map<string, ResolvedDefinition>();
  for (const provider of providers) {
    const input = findObject(inputs, provider.objectId);
    const seen = new Set<string>();
    for (const binding of provider.services) {
      requireIdentity(binding.contract);
      const serviceName = `${contractKey(binding.contract)}\0${binding.key}`;
      if (!/^[a-z][a-z0-9_.-]{0,62}$/.test(binding.key)) {
        fail(`runtime provider ${provider.id} has a noncanonical service key`);
      }
      if (seen.has(serviceName)) {
        fail(`runtime provider ${provider.id} repeats service ${binding.key}`);
      }
      seen.add(serviceName);
      if (
        !provider.supports.some(
          (identity) => contractKey(identity) === contractKey(binding.contract),
        )
      ) {
        fail(
          `runtime provider ${provider.id} exposes a service for an unsupported contract`,
        );
      }
      const schema = schemas.get(contractKey(binding.contract));
      if (schema?.serviceBearing !== true) {
        fail(
          `contract ${binding.contract.key}@${binding.contract.majorVersion}.${binding.contract.minorVersion} does not authorize service imports`,
        );
      }
      const symbol = input.object.symbols.find(
        ({ id }) => id === binding.symbolId,
      );
      if (
        symbol === undefined ||
        (symbol.binding !== 'local' && symbol.binding !== 'export') ||
        symbol.valueKind !== 1
      ) {
        fail(
          `runtime provider ${provider.id} service ${binding.key} must target a provider-local CODE definition`,
        );
      }
      services.set(serviceName, {
        objectId: input.id,
        symbol,
        section: findSection(input, symbol.sectionId),
      });
    }
  }
  return services;
};

const resolveDefinitions = (
  inputs: readonly ResolvedInput[],
  exports: ReadonlyMap<string, ResolvedDefinition>,
  providersByContract: ReadonlyMap<string, Nobj1RuntimeProvider>,
  services: ReadonlyMap<string, ResolvedDefinition>,
  schemas: ReadonlyMap<string, Nobj1ContractValidator>,
): ReadonlyMap<string, ResolvedDefinition> => {
  const definitions = new Map<string, ResolvedDefinition>();
  for (const input of inputs) {
    for (const symbol of input.object.symbols) {
      if (symbol.binding === 'local' || symbol.binding === 'export') {
        definitions.set(inputKey(input.id, symbol.id), {
          objectId: input.id,
          symbol,
          section: findSection(input, symbol.sectionId),
        });
        continue;
      }
      if (symbol.binding === 'import') {
        const definition = exports.get(
          qualifiedName(symbol.namespace, symbol.name),
        );
        if (definition === undefined) {
          fail(
            `unresolved import ${symbol.namespace}:${symbol.name} in ${input.id}`,
          );
        }
        if (definition.symbol.valueKind !== symbol.valueKind) {
          fail(
            `import ${symbol.namespace}:${symbol.name} has the wrong value kind`,
          );
        }
        definitions.set(inputKey(input.id, symbol.id), definition);
        continue;
      }

      const contract = input.object.contracts.find(
        ({ id }) => id === symbol.contractId,
      );
      if (contract === undefined)
        fail(`service import in ${input.id} has no contract`);
      const identity = contractKey(contract);
      const schema = schemas.get(identity);
      if (schema?.serviceBearing !== true) {
        fail(`service import ${symbol.serviceKey} uses a non-service contract`);
      }
      if (providersByContract.get(identity) === undefined) {
        fail(
          `service import ${symbol.serviceKey} has no selected contract provider`,
        );
      }
      const definition = services.get(`${identity}\0${symbol.serviceKey}`);
      if (definition === undefined) {
        fail(`unresolved service ${contract.key}:${symbol.serviceKey}`);
      }
      definitions.set(inputKey(input.id, symbol.id), definition);
    }
  }
  return definitions;
};

const getState = (
  states: ReadonlyMap<string, SectionState>,
  objectId: string,
  sectionId: number,
): SectionState =>
  states.get(sectionStateKey(objectId, sectionId)) ??
  fail(`missing placement for ${objectId}:${sectionId}`);

const visible = (
  target: Nobj1TargetLayout,
  from: Nobj1Region,
  to: Nobj1Region,
  use: Nobj1Relocation['use'],
): boolean => {
  if (physicalKey(from) === physicalKey(to)) return true;
  return target.visibility.some(
    (edge) =>
      edge.use === use &&
      identityKey(edge.from) === physicalKey(from) &&
      identityKey(edge.to) === physicalKey(to),
  );
};

function authorizeNucleusInitializerSource(
  context: Nobj1InitializerSourceContext,
): boolean {
  const data = context.contract.data;
  const startupRangeId = readU16(data, 7);
  const initializedLoadRangeId = readU16(data, 15);
  const startup = context.object.ranges.find(({ id }) => id === startupRangeId);
  const initializedLoad = context.object.ranges.find(
    ({ id }) => id === initializedLoadRangeId,
  );
  if (
    startup === undefined ||
    initializedLoad === undefined ||
    startup.view !== 'run' ||
    initializedLoad.view !== 'load' ||
    startup.sectionId !== context.relocation.siteSectionId ||
    context.relocation.siteOffset < startup.offset ||
    context.relocation.siteOffset + 2 > startup.offset + startup.length ||
    context.targetObjectId !== context.objectId ||
    initializedLoad.sectionId !== context.targetSection.id ||
    context.adjustedTargetOffset < initializedLoad.offset ||
    context.adjustedTargetOffset >=
      initializedLoad.offset + initializedLoad.length
  ) {
    return false;
  }
  return true;
}

const resolveRelocations = (
  inputs: readonly ResolvedInput[],
  states: ReadonlyMap<string, SectionState>,
  definitions: ReadonlyMap<string, ResolvedDefinition>,
  target: Nobj1TargetLayout,
  schemas: ReadonlyMap<string, Nobj1ContractValidator>,
): RelocationResolution[] => {
  const resolved: RelocationResolution[] = [];
  for (const input of inputs) {
    for (const relocation of input.object.relocations) {
      const sourceSection = findSection(input, relocation.siteSectionId);
      const sourceState = getState(states, input.id, sourceSection.id);
      const sourceRunRegion = findObjectRegion(
        input,
        sourceSection.runRegionId,
      );
      const sourceLoadRegionId =
        sourceSection.loadRegionId ?? sourceSection.runRegionId;
      const sourceLoadRegion = findObjectRegion(input, sourceLoadRegionId);
      const sourceLoadAddress = sourceState.loadAddress;
      if (
        sourceState.runAddress === undefined ||
        sourceLoadAddress === undefined
      ) {
        fail('relocation source placement is unresolved');
      }
      const targetDefinition = definitions.get(
        inputKey(input.id, relocation.targetSymbolId),
      );
      if (targetDefinition === undefined)
        fail(`relocation target is unresolved in ${input.id}`);
      const targetInput = findObject(inputs, targetDefinition.objectId);
      const targetSection = targetDefinition.section;
      const targetState = getState(
        states,
        targetDefinition.objectId,
        targetSection.id,
      );
      const targetRunRegion = findObjectRegion(
        targetInput,
        targetSection.runRegionId,
      );
      const definitionOffset = targetDefinition.symbol.offset;
      const adjustedTargetOffset = definitionOffset + relocation.addend;
      const isBoundary = targetDefinition.symbol.valueKind === 3;
      if (
        adjustedTargetOffset < 0 ||
        adjustedTargetOffset > targetSection.length ||
        (!isBoundary && adjustedTargetOffset === targetSection.length)
      ) {
        fail('relocation addend escapes its target SECTION');
      }

      let resolvedValue: number;
      if (relocation.kind === 1) {
        if (
          !visible(target, sourceRunRegion, targetRunRegion, relocation.use)
        ) {
          fail(
            `relocation target storage is not visible from ${input.id}:${sourceSection.id}`,
          );
        }
        if (
          relocation.use === 1 &&
          (sourceSection.permissions & NOBJ1_PERMISSION.execute) === 0
        ) {
          fail('control-transfer relocation site is not in executable storage');
        }
        if (targetState.runAddress === undefined)
          fail('relocation target RUN address is unresolved');
        resolvedValue = targetState.runAddress + adjustedTargetOffset;
      } else {
        if (relocation.use !== 3 || targetSection.storageKind !== 1) {
          fail(
            'ABS16_LOAD requires an initialized target and initializer-source use',
          );
        }
        const targetLoadRegion = findObjectRegion(
          targetInput,
          targetSection.loadRegionId ?? targetSection.runRegionId,
        );
        if (!visible(target, sourceRunRegion, targetLoadRegion, 3)) {
          fail(
            `initializer source is not visible from ${input.id}:${sourceSection.id}`,
          );
        }
        if (targetState.loadAddress === undefined)
          fail('relocation target LOAD address is unresolved');
        const contract = input.object.contracts.find((candidate) => {
          const schema = schemas.get(contractKey(candidate));
          if (schema?.authorizeInitializerSource === undefined) return false;
          try {
            // Contract hooks see a defensive copy; a validator cannot mutate
            // the object records that the linker will continue to resolve.
            const validationObject = parseNobj1(
              input.object.serialized.slice(),
            );
            const validationContract = validationObject.contracts.find(
              ({ id }) => id === candidate.id,
            );
            const validationRelocation = validationObject.relocations.find(
              ({ siteSectionId, siteOffset, targetSymbolId }) =>
                siteSectionId === relocation.siteSectionId &&
                siteOffset === relocation.siteOffset &&
                targetSymbolId === relocation.targetSymbolId,
            );
            const validationSourceSection = validationObject.sections.find(
              ({ id }) => id === sourceSection.id,
            );
            const validationSourceRegion = validationObject.regions.find(
              ({ id }) => id === sourceRunRegion.id,
            );
            const targetObject = findObject(
              inputs,
              targetDefinition.objectId,
            ).object;
            const validationTargetObject = parseNobj1(
              targetObject.serialized.slice(),
            );
            const validationTargetSymbol = validationTargetObject.symbols.find(
              ({ id }) => id === targetDefinition.symbol.id,
            );
            const validationTargetSection =
              validationTargetObject.sections.find(
                ({ id }) => id === targetSection.id,
              );
            const validationTargetLoadRegion =
              validationTargetObject.regions.find(
                ({ id }) => id === targetLoadRegion.id,
              );
            if (
              validationContract === undefined ||
              validationRelocation === undefined ||
              validationSourceSection === undefined ||
              validationSourceRegion === undefined ||
              validationTargetSymbol === undefined ||
              validationTargetSection === undefined ||
              validationTargetLoadRegion === undefined
            ) {
              fail('initializer contract validation context is incomplete');
            }
            return schema.authorizeInitializerSource({
              objectId: input.id,
              object: validationObject,
              contract: validationContract,
              relocation: validationRelocation,
              sourceSection: validationSourceSection,
              sourceRunRegion: validationSourceRegion,
              siteRunAddress: sourceState.runAddress! + relocation.siteOffset,
              siteLoadAddress: sourceLoadAddress + relocation.siteOffset,
              targetObjectId: targetDefinition.objectId,
              targetSymbol: validationTargetSymbol,
              targetSection: validationTargetSection,
              targetLoadRegion: validationTargetLoadRegion,
              targetLoadAddress:
                targetState.loadAddress! + adjustedTargetOffset,
              adjustedTargetOffset,
            });
          } catch (error) {
            fail(
              `initializer-source contract validator failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        });
        if (contract === undefined) {
          fail('ABS16_LOAD relocation is not authorized by a source contract');
        }
        resolvedValue = targetState.loadAddress + adjustedTargetOffset;
      }
      if (
        !Number.isInteger(resolvedValue) ||
        resolvedValue < 0 ||
        resolvedValue > 0xffff
      ) {
        fail(
          `relocation result ${resolvedValue} does not fit an ABS16 address`,
        );
      }
      resolved.push(
        Object.freeze({
          objectId: input.id,
          siteSectionId: relocation.siteSectionId,
          siteOffset: relocation.siteOffset,
          kind: relocation.kind,
          use: relocation.use,
          value: resolvedValue,
          targetObjectId: targetDefinition.objectId,
          targetSymbolId: targetDefinition.symbol.id,
          sourceLoadAddress: sourceLoadAddress + relocation.siteOffset,
        }),
      );
      void sourceLoadRegion;
    }
  }
  return resolved;
};

const createImages = (
  inputs: readonly ResolvedInput[],
  states: ReadonlyMap<string, SectionState>,
  relocations: readonly RelocationResolution[],
): Nobj1LinkedRegionImage[] => {
  const selected = new Map<string, Nobj1TargetRegion>();
  for (const input of inputs) {
    for (const section of input.object.sections) {
      if (section.storageKind !== 1) continue;
      const regionId = section.loadRegionId ?? section.runRegionId;
      const targetRegion = input.regionMap.get(regionId);
      if (targetRegion === undefined)
        fail('image LOAD target REGION is unresolved');
      selected.set(targetRegion.id, targetRegion);
    }
  }

  return [...selected.values()]
    .sort((left, right) => compareText(left.id, right.id))
    .map((outputRegion) => {
      const bytes = new Uint8Array(outputRegion.capacity);
      bytes.fill(outputRegion.imageFill);
      let usedEnd = outputRegion.base;
      const regionEnd = outputRegion.base + outputRegion.capacity;

      for (const input of inputs) {
        for (const section of input.object.sections) {
          if (section.storageKind !== 1) continue;
          const state = getState(states, input.id, section.id);
          const loadRegion = findObjectRegion(
            input,
            section.loadRegionId ?? section.runRegionId,
          );
          const loadAddress = state.loadAddress;
          if (
            loadAddress === undefined ||
            physicalKey(loadRegion) !== physicalKey(outputRegion)
          )
            continue;
          const loadEnd = loadAddress + section.length;
          const start = Math.max(loadAddress, outputRegion.base);
          const end = Math.min(loadEnd, regionEnd);
          if (start >= end) continue;
          const outputOffset = start - outputRegion.base;
          const sectionOffset = start - loadAddress;
          const count = end - start;
          bytes.fill(section.fill ?? 0, outputOffset, outputOffset + count);
          usedEnd = Math.max(usedEnd, end);
          for (const image of input.object.images) {
            if (image.sectionId !== section.id) continue;
            const imageStart = Math.max(sectionOffset, image.offset);
            const imageEnd = Math.min(
              sectionOffset + count,
              image.offset + image.bytes.length,
            );
            if (imageStart < imageEnd) {
              bytes.set(
                image.bytes.subarray(
                  imageStart - image.offset,
                  imageEnd - image.offset,
                ),
                outputOffset + imageStart - sectionOffset,
              );
            }
          }
          for (const patch of input.object.patches) {
            if (patch.sectionId !== section.id) continue;
            const patchStart = Math.max(sectionOffset, patch.offset);
            const patchEnd = Math.min(
              sectionOffset + count,
              patch.offset + patch.bytes.length,
            );
            if (patchStart < patchEnd) {
              bytes.set(
                patch.bytes.subarray(
                  patchStart - patch.offset,
                  patchEnd - patch.offset,
                ),
                outputOffset + patchStart - sectionOffset,
              );
            }
          }
        }
      }

      for (const relocation of relocations) {
        const address = relocation.sourceLoadAddress;
        const siteEnd = address + 2;
        if (
          relocationSourceIdentity(inputs, relocation) !==
            physicalKey(outputRegion) ||
          address < outputRegion.base ||
          siteEnd > regionEnd
        ) {
          continue;
        }
        const offset = address - outputRegion.base;
        bytes[offset] = relocation.value & 0xff;
        bytes[offset + 1] = relocation.value >>> 8;
        usedEnd = Math.max(usedEnd, siteEnd);
      }

      return Object.freeze({
        targetRegionId: outputRegion.id,
        addressSpaceKey: outputRegion.addressSpaceKey,
        storageKey: outputRegion.storageKey,
        base: outputRegion.base,
        capacity: outputRegion.capacity,
        imageFill: outputRegion.imageFill,
        usedLength: usedEnd - outputRegion.base,
        bytes,
      });
    });
};

const relocationSourceIdentity = (
  inputs: readonly ResolvedInput[],
  relocation: RelocationResolution,
): string => {
  const input = findObject(inputs, relocation.objectId);
  const section = findSection(input, relocation.siteSectionId);
  return physicalKey(
    findObjectRegion(input, section.loadRegionId ?? section.runRegionId),
  );
};

const placedObjectMap = (
  inputs: readonly ResolvedInput[],
  states: ReadonlyMap<string, SectionState>,
): ReadonlyMap<string, Nobj1Object> => {
  const result = new Map<string, Nobj1Object>();
  for (const input of inputs)
    result.set(input.id, fixedPlacedObject(input, states));
  return result;
};

const validateProviderObligations = (
  providers: readonly Nobj1RuntimeProvider[],
  inputs: readonly ResolvedInput[],
  placedObjects: ReadonlyMap<string, Nobj1Object>,
  placements: readonly Nobj1SectionPlacement[],
): void => {
  for (const provider of providers) {
    if (provider.validateObligations === undefined) continue;
    for (const identity of provider.supports) {
      const key = contractKey(identity);
      const obligations: Nobj1ContractObligation[] = [];
      for (const input of inputs) {
        const parsedObject = placedObjects.get(input.id);
        if (parsedObject === undefined) {
          fail(
            `placed object ${input.id} is missing during contract validation`,
          );
        }
        for (const contract of parsedObject.contracts) {
          if (contractKey(contract) !== key) continue;
          const defensiveObject = parseNobj1(parsedObject.serialized.slice());
          const defensiveContract = defensiveObject.contracts.find(
            ({ id }) => id === contract.id,
          );
          if (defensiveContract === undefined) {
            fail(`contract ${contract.id} disappeared from ${input.id}`);
          }
          obligations.push(
            Object.freeze({
              objectId: input.id,
              object: defensiveObject,
              contract: defensiveContract,
              placements: Object.freeze(
                placements.filter(({ objectId }) => objectId === input.id),
              ),
            }),
          );
        }
      }
      if (obligations.length === 0) continue;
      try {
        provider.validateObligations(
          Object.freeze({ ...identity }),
          Object.freeze(obligations),
        );
      } catch (error) {
        fail(
          `provider ${provider.id} rejected ${identity.key}@${identity.majorVersion}.${identity.minorVersion} obligations: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
};

/**
 * Link committed NOBJ objects without changing them or publishing an output.
 * Contract IDs, symbol IDs and SECTION IDs stay local to each `id` in `objects`.
 */
export const linkNobj1 = (
  objects: readonly Nobj1LinkObject[],
  options: Nobj1LinkOptions,
): Nobj1LinkResult => {
  if (options === null || typeof options !== 'object') {
    fail('link options are required');
  }
  validateTarget(options.target);
  const inputs = buildInputs(objects, options.target);
  const main = inputs.find(({ id }) => id === options.mainObjectId);
  if (main === undefined)
    fail(`main object ${options.mainObjectId} was not supplied`);
  const schemas = schemaTable(options.contractValidators);
  const providers = options.providers ?? [];
  const providersByContract = providerTable(providers, inputs, schemas);
  const { states } = placeSections(inputs);
  const stateByKey = new Map(
    states.map((state) => [
      sectionStateKey(state.input.id, state.section.id),
      state,
    ]),
  );
  const placements = placementsFor(states);
  const placedObjects = placedObjectMap(inputs, stateByKey);

  for (const input of inputs) {
    const placed = placedObjects.get(input.id);
    if (placed === undefined) fail('fixed object validation is unavailable');
    for (const contract of placed.contracts) {
      const schema = schemas.get(contractKey(contract));
      if (schema?.validatePlaced === undefined) continue;
      const objectPlacements = placements.filter(
        ({ objectId }) => objectId === input.id,
      );
      try {
        schema.validatePlaced({
          objectId: input.id,
          object: placed,
          contract,
          placements: objectPlacements,
        });
      } catch (error) {
        fail(
          `placed contract validator rejected ${contract.key}@${contract.majorVersion}.${contract.minorVersion} in ${input.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  validateProviderObligations(providers, inputs, placedObjects, placements);

  const exports = buildExports(inputs);
  const services = makeServiceTable(providers, inputs, schemas);
  const definitions = resolveDefinitions(
    inputs,
    exports,
    providersByContract,
    services,
    schemas,
  );
  const relocations = resolveRelocations(
    inputs,
    stateByKey,
    definitions,
    options.target,
    schemas,
  );

  const copies: Nobj1LinkedCopyOperation[] = [];
  const zeroInitializations: Nobj1LinkedZeroOperation[] = [];
  for (const state of states) {
    const { input, section } = state;
    const runRegion = findObjectRegion(input, section.runRegionId);
    const runAddress = state.runAddress;
    if (runAddress === undefined) fail('startup RUN operation is unresolved');
    if (section.storageKind === 1) {
      const loadRegion = findObjectRegion(
        input,
        section.loadRegionId ?? section.runRegionId,
      );
      const loadAddress = state.loadAddress;
      if (loadAddress === undefined)
        fail('startup LOAD operation is unresolved');
      if (
        physicalKey(runRegion) !== physicalKey(loadRegion) ||
        runAddress !== loadAddress
      ) {
        copies.push(
          Object.freeze({
            objectId: input.id,
            sectionId: section.id,
            sourceRegionId: loadRegion.id,
            sourceAddress: loadAddress,
            runRegionId: runRegion.id,
            runAddress,
            length: section.length,
          }),
        );
      }
    } else if (section.storageKind === 2) {
      zeroInitializations.push(
        Object.freeze({
          objectId: input.id,
          sectionId: section.id,
          runRegionId: runRegion.id,
          runAddress,
          length: section.length,
        }),
      );
    }
  }

  let entry: Nobj1LinkEntry | undefined;
  if (main.object.layout.entrySymbolId !== 0) {
    const symbolId = main.object.layout.entrySymbolId;
    const definition = definitions.get(inputKey(main.id, symbolId));
    if (
      definition === undefined ||
      definition.objectId !== main.id ||
      definition.symbol.valueKind !== 1
    ) {
      fail('main entry is not a local or exported CODE definition');
    }
    const state = getState(stateByKey, main.id, definition.section.id);
    if (state.runAddress === undefined)
      fail('main entry address is unresolved');
    const address = state.runAddress + definition.symbol.offset;
    if (address < 0 || address > 0xffff)
      fail('main entry does not fit a Z80 address');
    entry = Object.freeze({ objectId: main.id, symbolId, address });
  }

  const regions = createImages(inputs, stateByKey, relocations);
  return Object.freeze({
    placements: Object.freeze(placements),
    regions: Object.freeze(regions),
    copies: Object.freeze(copies),
    zeroInitializations: Object.freeze(zeroInitializations),
    relocations: Object.freeze(
      relocations.map(({ sourceLoadAddress: _source, ...item }) =>
        Object.freeze(item),
      ),
    ),
    ...(entry === undefined ? {} : { entry }),
  });
};
