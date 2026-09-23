import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  encodeNobj1,
  materializeNobj1Object,
  Nobj1Error,
  parseNobj1,
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

const needsCopy = (
  object: ReturnType<typeof parseNobj1>,
  section: ReturnType<typeof parseNobj1>['sections'][number],
): boolean => {
  const runRegion = object.regions.find(({ id }) => id === section.runRegionId);
  const loadRegion = object.regions.find(
    ({ id }) => id === section.loadRegionId,
  );
  if (runRegion === undefined || loadRegion === undefined) return true;
  const runAddress = runRegion.base + section.runOffset;
  const loadAddress =
    section.loadPlacement === 'same'
      ? runAddress
      : loadRegion.base + (section.loadOffset ?? 0);
  return (
    runRegion.addressSpaceKey !== loadRegion.addressSpaceKey ||
    runRegion.storageKey !== loadRegion.storageKey ||
    runAddress !== loadAddress
  );
};

describe('NOBJ 1.0 common host decoder', () => {
  it('decodes all frozen valid vectors and retains their layout records', () => {
    const vectors = [
      ['valid-atom-empty.nobj.hex', 6],
      ['valid-atom-cursor-65536.nobj.hex', 7],
      ['valid-atom-cursor-below-high-water.nobj.hex', 8],
      ['valid-skate-service-reloc.nobj.hex', 11],
      ['valid-nucleus-banked-rom.nobj.hex', 27],
      ['valid-nucleus-loaded.nobj.hex', 19],
    ] as const;

    for (const [name, count] of vectors) {
      const object = parseNobj1(fixture(name));
      expect(object.commit.recordCount, name).toBe(count);
      expect(object.begin.targetId, name).toBe(1);
      expect(object.commit.layoutMode, name).toBe(object.layout.mode);
    }

    const empty = parseNobj1(fixture('valid-atom-empty.nobj.hex'));
    expect(empty.regions).toHaveLength(1);
    expect(empty.sections).toHaveLength(0);
    expect(empty.images).toHaveLength(0);
    expect(empty.metadata[0]?.key).toBe('org.atom.final-cursor');

    const endpoint = parseNobj1(fixture('valid-atom-cursor-65536.nobj.hex'));
    const cursor = endpoint.metadata.find(
      ({ key }) => key === 'org.atom.final-cursor',
    );
    expect(cursor?.data[2]).toBe(0);
    expect(cursor?.data[3]).toBe(0);
    expect(cursor?.data[4]).toBe(1);
    expect(cursor?.data[5]).toBe(0);

    const banked = parseNobj1(fixture('valid-nucleus-banked-rom.nobj.hex'));
    expect(banked.contracts[0]?.key).toBe('org.nucleus.runtime');
    expect(banked.sections.some(({ storageKind }) => storageKind === 2)).toBe(
      true,
    );
    expect(banked.ranges.some(({ view }) => view === 'load')).toBe(true);
  });

  it('writes the frozen vectors byte-for-byte and validates its own output', () => {
    for (const name of [
      'valid-atom-empty.nobj.hex',
      'valid-atom-cursor-65536.nobj.hex',
      'valid-atom-cursor-below-high-water.nobj.hex',
      'valid-skate-service-reloc.nobj.hex',
      'valid-nucleus-banked-rom.nobj.hex',
      'valid-nucleus-loaded.nobj.hex',
    ]) {
      const original = fixture(name);
      const object = parseNobj1(original);
      const encoded = encodeNobj1({
        begin: object.begin,
        contracts: object.contracts,
        regions: object.regions,
        sections: object.sections,
        ranges: object.ranges,
        images: object.images,
        patches: object.patches,
        symbols: object.symbols,
        relocations: object.relocations,
        metadata: object.metadata,
        layout: object.layout,
      });
      expect(encoded, name).toEqual(original);
      expect(parseNobj1(encoded).commit).toEqual(object.commit);
    }
  });

  it('rejects broken framing, checksums, patch intervals and reserved kinds', () => {
    for (const [name, message] of [
      ['invalid-bad-crc.nobj.hex', 'CRC'],
      ['invalid-unknown-record-kind.nobj.hex', 'reserved record kind'],
      ['invalid-truncated-image.nobj.hex', 'truncated record payload'],
      ['invalid-overlapping-patch.nobj.hex', 'PATCH records overlap'],
    ] as const) {
      expect(() => parseNobj1(fixture(name)), name).toThrowError(
        new RegExp(message),
      );
    }
  });

  it('leaves target-dependent failures for the linker or provider', () => {
    const crossBank = parseNobj1(fixture('invalid-cross-bank-call.nobj.hex'));
    expect(crossBank.relocations).toHaveLength(1);

    const endpointRelocation = parseNobj1(
      fixture('invalid-reloc-address-65536.nobj.hex'),
    );
    const relocation = endpointRelocation.relocations[0];
    expect(relocation).toBeDefined();
    const target = endpointRelocation.symbols.find(
      ({ id }) => id === relocation?.targetSymbolId,
    );
    expect(target?.valueKind).toBe(3);
    if (target?.binding === 'local' || target?.binding === 'export') {
      const section = endpointRelocation.sections.find(
        ({ id }) => id === target.sectionId,
      );
      const region = endpointRelocation.regions.find(
        ({ id }) => id === section?.runRegionId,
      );
      expect(region?.base + (section?.runOffset ?? 0) + target.offset).toBe(
        0x1_0000,
      );
    }

    const unknownContract = parseNobj1(
      fixture('invalid-unknown-contract.nobj.hex'),
    );
    expect(unknownContract.contracts[0]?.key).toBe('org.example.badabi');
  });

  it('materializes section fill, sparse images, load regions and startup work', () => {
    const empty = parseNobj1(fixture('valid-atom-empty.nobj.hex'));
    const emptyImage = materializeNobj1Object(empty).regions[0];
    expect(emptyImage?.usedLength).toBe(0);
    expect(
      emptyImage?.bytes.every((byte) => byte === emptyImage.imageFill),
    ).toBe(true);

    const endpoint = parseNobj1(fixture('valid-atom-cursor-65536.nobj.hex'));
    const endpointImage = materializeNobj1Object(endpoint).regions[0];
    expect(endpointImage?.usedLength).toBe(endpointImage?.capacity);

    for (const name of [
      'valid-nucleus-banked-rom.nobj.hex',
      'valid-nucleus-loaded.nobj.hex',
    ]) {
      const object = parseNobj1(fixture(name));
      const materialized = materializeNobj1Object(object);
      expect(materialized.regions).toHaveLength(object.regions.length);
      expect(materialized.copies).toHaveLength(
        object.sections.filter(
          (section) => section.storageKind === 1 && needsCopy(object, section),
        ).length,
      );
      expect(materialized.zeroInitializations).toHaveLength(
        object.sections.filter(({ storageKind }) => storageKind === 2).length,
      );
      for (const output of materialized.regions) {
        expect(output.bytes).toHaveLength(output.capacity);
        expect(output.bytes[output.capacity - 1]).toBe(output.imageFill);
      }
    }
  });

  it('copies input bytes and rejects legacy versions instead of guessing', () => {
    const bytes = fixture('valid-atom-empty.nobj.hex');
    const decoded = parseNobj1(bytes);
    const original = bytes.slice();
    bytes.fill(0);
    expect(decoded.serialized).toEqual(original);

    const legacy = fixture('valid-atom-empty.nobj.hex');
    legacy[7] = 0;
    expect(() => parseNobj1(legacy)).toThrow(Nobj1Error);
  });
});
