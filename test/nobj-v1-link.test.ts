import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  encodeNobj1,
  linkNobj1,
  Nobj1LinkError,
  parseNobj1,
  type Nobj1ContractIdentity,
  type Nobj1LinkObject,
  type Nobj1Region,
  type Nobj1TargetLayout,
  type Nobj1TargetRegion,
} from '../src/index.js';

const fixtureRoot = fileURLToPath(
  new URL('./fixtures/nobj1/', import.meta.url),
);

const fixture = (name: string): Uint8Array => {
  const text = readFileSync(`${fixtureRoot}${name}`, 'utf8');
  const hex = text.replace(/\s+/g, '');
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
    throw new Error(`invalid hex fixture ${name}`);
  }
  return Uint8Array.from(
    Array.from({ length: hex.length / 2 }, (_, index) =>
      Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
    ),
  );
};

const runtime20: Nobj1ContractIdentity = {
  key: 'org.skate.runtime',
  majorVersion: 2,
  minorVersion: 0,
};
const value20: Nobj1ContractIdentity = {
  key: 'org.skate.value',
  majorVersion: 2,
  minorVersion: 0,
};

const flatRegion: Nobj1Region = {
  id: 1,
  addressSpaceKey: 'z80.cpu',
  storageKey: 'cpm.ram',
  base: 0x0100,
  capacity: 0xff00,
  imageFill: 0,
  permissions: 7,
  banked: false,
};

const contractRecords = (entrySymbolId: number) => [
  {
    id: 1,
    ...runtime20,
    data: Uint8Array.of(0, 0, entrySymbolId & 0xff, entrySymbolId >>> 8),
  },
  { id: 2, ...value20, data: new Uint8Array() },
];

const callerBytes = Uint8Array.of(0xcd, 0x00, 0x00, 0xc9);

const makeCaller = (
  options: {
    readonly serviceContractId?: number;
    readonly runtimeVersion?: readonly [number, number];
    readonly region?: Nobj1Region;
  } = {},
): Nobj1LinkObject => {
  const runtime = contractRecords(1)[0];
  const value = contractRecords(1)[1];
  if (runtime === undefined || value === undefined)
    throw new Error('missing contract');
  const contracts = [
    {
      ...runtime,
      ...(options.runtimeVersion === undefined
        ? {}
        : {
            majorVersion: options.runtimeVersion[0],
            minorVersion: options.runtimeVersion[1],
          }),
    },
    value,
  ];
  const region = options.region ?? flatRegion;
  const serialized = encodeNobj1({
    begin: { targetId: 1 },
    contracts,
    regions: [region],
    sections: [
      {
        id: 1,
        storageKind: 1,
        permissions: 5,
        alignment: 1,
        length: callerBytes.length,
        runRegionId: 1,
        runPlacement: 'allocate',
        runOffset: 0,
        loadPlacement: 'same',
        loadRegionId: 1,
        loadOffset: 0,
        fill: 0,
      },
    ],
    ranges: [],
    images: [{ sectionId: 1, offset: 0, bytes: callerBytes.slice() }],
    patches: [],
    symbols: [
      { id: 1, binding: 'local', valueKind: 1, sectionId: 1, offset: 0 },
      {
        id: 2,
        binding: 'service-import',
        valueKind: 1,
        contractId: options.serviceContractId ?? 1,
        serviceKey: 'numeric.add',
      },
    ],
    relocations: [
      {
        siteSectionId: 1,
        siteOffset: 1,
        kind: 1,
        use: 1,
        targetSymbolId: 2,
        addend: 0,
      },
    ],
    metadata: [],
    layout: { mode: 'module', entrySymbolId: 1 },
  });
  return { id: 'caller', object: parseNobj1(serialized) };
};

const makeProvider = (
  address: number,
  bytes = Uint8Array.of(0x3e, 42, 0xc9),
  region: Nobj1Region = flatRegion,
): Nobj1LinkObject => {
  const serialized = encodeNobj1({
    begin: { targetId: 1 },
    contracts: contractRecords(0),
    regions: [region],
    sections: [
      {
        id: 1,
        storageKind: 1,
        permissions: 7,
        alignment: 1,
        length: bytes.length,
        runRegionId: 1,
        runPlacement: 'fixed',
        runOffset: address - region.base,
        loadPlacement: 'same',
        loadRegionId: 1,
        loadOffset: 0,
        fill: 0,
      },
    ],
    ranges: [],
    images: [{ sectionId: 1, offset: 0, bytes: bytes.slice() }],
    patches: [],
    symbols: [
      { id: 1, binding: 'local', valueKind: 1, sectionId: 1, offset: 0 },
    ],
    relocations: [],
    metadata: [],
    layout: { mode: 'module', entrySymbolId: 0 },
  });
  return { id: 'runtime', object: parseNobj1(serialized) };
};

const provider = (
  objectId: string,
  identity: Nobj1ContractIdentity = runtime20,
) => ({
  id: 'skate-runtime-provider',
  objectId,
  supports: [identity, value20],
  services: [{ contract: identity, key: 'numeric.add', symbolId: 1 }],
});

const targetFor = (
  objects: readonly Nobj1LinkObject[],
  visibility: Nobj1TargetLayout['visibility'] = [],
): Nobj1TargetLayout => {
  const unique = new Map<string, Nobj1TargetRegion>();
  for (const { object } of objects) {
    for (const region of object.regions) {
      const key = [
        region.addressSpaceKey,
        region.storageKey,
        region.base,
        region.capacity,
      ].join('\0');
      unique.set(key, {
        id: `region-${unique.size}`,
        addressSpaceKey: region.addressSpaceKey,
        storageKey: region.storageKey,
        base: region.base,
        capacity: region.capacity,
        imageFill: region.imageFill,
        permissions: region.permissions,
        banked: region.banked,
      });
    }
  }
  return { regions: [...unique.values()], visibility };
};

const linkPair = (
  caller: Nobj1LinkObject,
  runtime: Nobj1LinkObject,
  target = targetFor([caller, runtime]),
) =>
  linkNobj1([caller, runtime], {
    mainObjectId: caller.id,
    target,
    providers: [provider(runtime.id)],
  });

describe('NOBJ 1.0 multi-object linker', () => {
  it('resolves object-local service and symbol IDs at different placements without changing inputs', () => {
    const caller = makeCaller();
    const callerBytesBefore = caller.object.serialized.slice();
    const addresses = [0x4200, 0x5200];

    for (const address of addresses) {
      const runtime = makeProvider(address);
      const runtimeBytesBefore = runtime.object.serialized.slice();
      const linked = linkPair(caller, runtime);
      const entry = linked.entry;
      const image = linked.regions[0];
      const callerPlacement = linked.placements.find(
        ({ objectId, sectionId }) => objectId === caller.id && sectionId === 1,
      );
      expect(entry?.address).toBe(0x0100);
      expect(callerPlacement?.runAddress).toBe(0x0100);
      expect(linked.relocations).toEqual([
        {
          objectId: 'caller',
          siteSectionId: 1,
          siteOffset: 1,
          kind: 1,
          use: 1,
          value: address,
          targetObjectId: 'runtime',
          targetSymbolId: 1,
        },
      ]);
      expect(image?.bytes[1]).toBe(address & 0xff);
      expect(image?.bytes[2]).toBe(address >>> 8);
      expect(caller.object.serialized).toEqual(callerBytesBefore);
      expect(runtime.object.serialized).toEqual(runtimeBytesBefore);
    }
  });

  it('lets a provider reject repeated object-scoped contract obligations', () => {
    const caller = makeCaller();
    const runtime = makeProvider(0x4200);
    let runtimeObligations: readonly string[] = [];
    const selectedProvider = {
      ...provider(runtime.id),
      validateObligations: (
        identity: Nobj1ContractIdentity,
        obligations: readonly { objectId: string }[],
      ) => {
        if (identity.key === runtime20.key) {
          runtimeObligations = obligations.map(({ objectId }) => objectId);
          if (obligations.length !== 1) {
            throw new Error('this runtime accepts one runtime contract only');
          }
        }
      },
    };
    expect(() =>
      linkNobj1([caller, runtime], {
        mainObjectId: caller.id,
        target: targetFor([caller, runtime]),
        providers: [selectedProvider],
      }),
    ).toThrowError(/provider skate-runtime-provider rejected/);
    expect(runtimeObligations).toEqual(['caller', 'runtime']);
  });

  it('rejects a service import attached to a non-service value contract', () => {
    const caller = makeCaller({ serviceContractId: 2 });
    const runtime = makeProvider(0x4200);
    expect(() => linkPair(caller, runtime)).toThrowError(
      /non-service contract/,
    );
  });

  it('rejects a runtime contract version without an exact validator and provider', () => {
    const caller = makeCaller({ runtimeVersion: [2, 1] });
    const runtime = makeProvider(0x4200);
    expect(() => linkPair(caller, runtime)).toThrowError(
      /no exact validator for required contract org\.skate\.runtime@2\.1/,
    );
  });

  it('rejects a numerically fitting call into an invisible bank', () => {
    const bank0: Nobj1Region = {
      ...flatRegion,
      storageKey: 'rom.bank.0',
      base: 0x4000,
      capacity: 0x100,
      banked: true,
    };
    const bank1: Nobj1Region = { ...bank0, storageKey: 'rom.bank.1' };
    const caller = makeCaller({ region: bank0 });
    const runtime = makeProvider(0x4000, Uint8Array.of(0xc9), bank1);
    expect(() => linkPair(caller, runtime)).toThrowError(
      /not visible from caller:1/,
    );
  });

  it('rejects a BOUNDARY relocation whose address is 65536', () => {
    const object = parseNobj1(fixture('invalid-reloc-address-65536.nobj.hex'));
    const input = { id: 'endpoint', object };
    const target = targetFor([input]);
    expect(() =>
      linkNobj1([input], {
        mainObjectId: input.id,
        target,
        providers: [],
      }),
    ).toThrowError(/does not fit an ABS16 address/);
  });

  it('returns allocated placements and an object-scoped copy/zero plan', () => {
    const rom: Nobj1Region = {
      id: 1,
      addressSpaceKey: 'z80.cpu',
      storageKey: 'rom.common',
      base: 0x4000,
      capacity: 0x0100,
      imageFill: 0xff,
      permissions: 5,
      banked: false,
    };
    const ram: Nobj1Region = {
      id: 2,
      addressSpaceKey: 'z80.cpu',
      storageKey: 'cpm.ram',
      base: 0x8000,
      capacity: 0x0100,
      imageFill: 0,
      permissions: 7,
      banked: false,
    };
    const serialized = encodeNobj1({
      begin: { targetId: 1 },
      contracts: [],
      regions: [rom, ram],
      sections: [
        {
          id: 1,
          storageKind: 1,
          permissions: 5,
          alignment: 1,
          length: 3,
          runRegionId: 2,
          runPlacement: 'allocate',
          runOffset: 0,
          loadPlacement: 'fixed',
          loadRegionId: 1,
          loadOffset: 0,
          fill: 0,
        },
        {
          id: 2,
          storageKind: 2,
          permissions: 3,
          alignment: 1,
          length: 4,
          runRegionId: 2,
          runPlacement: 'allocate',
          runOffset: 0,
        },
        {
          id: 3,
          storageKind: 3,
          permissions: 0,
          alignment: 1,
          length: 4,
          runRegionId: 2,
          runPlacement: 'allocate',
          runOffset: 0,
        },
      ],
      ranges: [],
      images: [{ sectionId: 1, offset: 0, bytes: Uint8Array.of(0xc9, 0, 0) }],
      patches: [],
      symbols: [
        { id: 1, binding: 'local', valueKind: 1, sectionId: 1, offset: 0 },
      ],
      relocations: [],
      metadata: [],
      layout: { mode: 'module', entrySymbolId: 1 },
    });
    const object = { id: 'startup', object: parseNobj1(serialized) };
    const target = targetFor([object]);
    const linked = linkNobj1([object], {
      mainObjectId: object.id,
      target,
      providers: [],
    });

    expect(linked.entry?.address).toBe(0x8000);
    expect(
      linked.placements.map(({ sectionId, runAddress }) => [
        sectionId,
        runAddress,
      ]),
    ).toEqual([
      [1, 0x8000],
      [2, 0x8003],
      [3, 0x8007],
    ]);
    expect(linked.copies).toEqual([
      {
        objectId: 'startup',
        sectionId: 1,
        sourceRegionId: 1,
        sourceAddress: 0x4000,
        runRegionId: 2,
        runAddress: 0x8000,
        length: 3,
      },
    ]);
    expect(linked.zeroInitializations).toEqual([
      {
        objectId: 'startup',
        sectionId: 2,
        runRegionId: 2,
        runAddress: 0x8003,
        length: 4,
      },
    ]);
    expect(linked.regions).toHaveLength(1);
    expect(linked.regions[0]?.bytes.slice(0, 3)).toEqual(
      Uint8Array.of(0xc9, 0, 0),
    );
    expect(linked.regions[0]?.usedLength).toBe(3);
  });

  it('uses registered exact validators for extension contracts', () => {
    const unknown = parseNobj1(fixture('invalid-unknown-contract.nobj.hex'));
    const original = unknown.serialized.slice();
    const input = { id: 'unknown', object: unknown };
    const unsupportedTarget = targetFor([input]);
    expect(() =>
      linkNobj1([input], {
        mainObjectId: input.id,
        target: unsupportedTarget,
        providers: [],
      }),
    ).toThrow(Nobj1LinkError);

    expect(() =>
      linkNobj1([input], {
        mainObjectId: input.id,
        target: unsupportedTarget,
        providers: [
          {
            id: 'example-provider',
            objectId: input.id,
            supports: [
              { key: 'org.example.badabi', majorVersion: 1, minorVersion: 0 },
            ],
            services: [],
          },
        ],
        contractValidators: [
          {
            key: 'org.example.badabi',
            majorVersion: 1,
            minorVersion: 0,
            validate: (contract, owner) => {
              if (contract.data.length !== 0)
                throw new Error('unexpected data');
              owner.object.serialized.fill(0);
            },
          },
        ],
      }),
    ).not.toThrow();
    expect(unknown.serialized).toEqual(original);
  });
});
