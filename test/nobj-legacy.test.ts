import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  convertAtomNobj02,
  convertNucleusNobj01,
  nobjCrc16CcittFalse,
  NobjLegacyError,
  parseAtomNobj02,
  parseNucleusNobj01,
} from '../src/index.js';

const fixtureRoot = fileURLToPath(
  new URL('./fixtures/nobj-legacy/', import.meta.url),
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

const updateLegacyCrc = (bytes: Uint8Array): Uint8Array => {
  const updated = bytes.slice();
  const crc = nobjCrc16CcittFalse(updated.slice(0, -2));
  updated[updated.length - 2] = crc & 0xff;
  updated[updated.length - 1] = crc >>> 8;
  return updated;
};

describe('legacy NOBJ readers and NOBJ 1.0 conversions', () => {
  it('validates ATOM 0.2 and preserves flat bytes, cursor, source parts and entry', () => {
    const cases = [
      ['atom-0.2-empty.nobj.hex', 0, 0x0100, 0x0100, 1],
      ['atom-0.2-sparse-patched-cursor.nobj.hex', 9, 0x0103, 0x0100, 2],
      ['atom-0.2-cursor-65536.nobj.hex', 0x8000, 0x1_0000, 0x8000, 1],
      ['atom-0.2-ds-fill.nobj.hex', 4, 0x0108, 0x0100, 3],
    ] as const;

    for (const [name, usedLength, finalCursor, entry, partCount] of cases) {
      const bytes = fixture(name);
      const legacy = parseAtomNobj02(bytes);
      const converted = convertAtomNobj02(bytes);
      const output = converted.materialized.regions[0];
      const oldBank = legacy.targetImage.banks[0];
      expect(legacy.usedLength, name).toBe(usedLength);
      expect(legacy.finalCursor, name).toBe(finalCursor);
      expect(legacy.entryAddress, name).toBe(entry);
      expect(legacy.sourcePartCount, name).toBe(partCount);
      expect(converted.selectedEntryAddress, name).toBe(entry);
      expect(converted.object.layout.entrySymbolId, name).toBe(0);
      expect(output?.usedLength, name).toBe(usedLength);
      expect(output?.bytes, name).toEqual(oldBank);
      expect(converted.object.metadata.map(({ key }) => key)).toEqual([
        'org.atom.final-cursor',
        'org.nobj.source-parts',
      ]);
    }
  });

  it('keeps ATOM 0.2 image-backed PATCH validation strict', () => {
    const bytes = fixture('atom-0.2-sparse-patched-cursor.nobj.hex');
    let cursor = 0;
    while (cursor < bytes.length) {
      const kind = bytes[cursor];
      const length = (bytes[cursor + 1] ?? 0) | ((bytes[cursor + 2] ?? 0) << 8);
      if (kind === 3) {
        bytes[cursor + 4] = 0x02;
        bytes[cursor + 5] = 0x01;
        break;
      }
      cursor += 3 + length;
    }
    expect(() => parseAtomNobj02(updateLegacyCrc(bytes))).toThrow(
      NobjLegacyError,
    );
  });

  it('validates Nucleus 0.1 and reproduces every bank and runtime extent', () => {
    for (const name of [
      'nucleus-0.1-banked-rom.nobj.hex',
      'nucleus-0.1-singlebank-rom.nobj.hex',
      'nucleus-0.1-loaded.nobj.hex',
    ]) {
      const bytes = fixture(name);
      const legacy = parseNucleusNobj01(bytes);
      const converted = convertNucleusNobj01(bytes);
      const contract = converted.object.contracts.find(
        ({ key }) => key === 'org.nucleus.runtime',
      );
      expect(contract, name).toBeDefined();
      expect(contract?.data[0], name).toBe(4);
      expect(contract?.data[21], name).toBe(legacy.begin.bankCount);
      expect(converted.object.layout.mode, name).toBe('placed');
      expect(converted.object.layout.entrySymbolId, name).not.toBe(0);
      expect(converted.materialized.copies, name).toHaveLength(
        legacy.map.romMode ? 1 : 0,
      );
      expect(converted.materialized.regions, name).toHaveLength(
        legacy.begin.bankCount,
      );
      for (let bank = 0; bank < legacy.begin.bankCount; bank += 1) {
        const output = converted.materialized.regions[bank];
        const oldBank = legacy.targetImage.banks[bank];
        const oldLayout = legacy.map.banks[bank];
        expect(output?.usedLength, `${name} bank ${bank}`).toBe(
          oldLayout?.usedLength,
        );
        expect(output?.bytes, `${name} bank ${bank}`).toEqual(oldBank);
      }
      const entry = converted.object.symbols.find(
        ({ id }) => id === converted.object.layout.entrySymbolId,
      );
      expect(entry?.binding, name).toBe('local');
      const sourceParts = converted.object.metadata.find(
        ({ key }) => key === 'org.nobj.source-parts',
      );
      expect(sourceParts?.data[0], name).toBe(legacy.map.partBanks.length);
      expect(sourceParts?.data[1], name).toBe(0);
      expect(
        Array.from(
          sourceParts?.data.slice(2).filter((_, index) => index % 2 === 0) ??
            [],
        ),
      ).toEqual(legacy.map.partBanks.map((bank) => bank + 1));
    }
  });

  it('rejects malformed legacy Nucleus layout even when its CRC is valid', () => {
    const bytes = fixture('nucleus-0.1-loaded.nobj.hex');
    let cursor = 0;
    while (cursor < bytes.length) {
      const kind = bytes[cursor];
      const length = (bytes[cursor + 1] ?? 0) | ((bytes[cursor + 2] ?? 0) << 8);
      if (kind === 4) {
        const dataLoadLengthOffset = cursor + 3 + 26;
        bytes[dataLoadLengthOffset] = 69;
        bytes[dataLoadLengthOffset + 1] = 0;
        break;
      }
      cursor += 3 + length;
    }
    expect(() => parseNucleusNobj01(updateLegacyCrc(bytes))).toThrow(
      /data-load length differs/,
    );
  });

  it('requires an explicit provider layout for noncanonical Nucleus runtimes', () => {
    const bytes = fixture('nucleus-0.1-provider-layout.nobj.hex');
    const legacy = parseNucleusNobj01(bytes);
    expect(legacy.begin.runtimeIdentity).toBe(1);
    expect(() => convertNucleusNobj01(bytes)).toThrow(/state length/);
    expect(() =>
      convertNucleusNobj01(bytes, { identity: 4, stateLength: 1 }),
    ).toThrow(/identity differs/);
    const converted = convertNucleusNobj01(bytes, {
      identity: 1,
      stateLength: 1,
    });
    expect(converted.object.contracts[0]?.data[0]).toBe(1);
    expect(converted.materialized.regions[0]?.bytes).toEqual(
      legacy.targetImage.banks[0],
    );
  });
});
