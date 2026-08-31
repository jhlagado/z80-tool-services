import { describe, expect, it } from 'vitest';

import {
  decodeNobjEnvelope,
  nobjCrc16CcittFalse,
  NOBJ_RECORD_KIND,
} from '../src/index.js';

const record = (kind: number, payload: readonly number[]): number[] => [
  kind,
  payload.length & 0xff,
  payload.length >>> 8,
  ...payload,
];

const envelope = (): Uint8Array => {
  const records = [
    record(NOBJ_RECORD_KIND.begin, [0x4e, 0x4f, 0x42, 0x4a, 0, 2]),
    record(NOBJ_RECORD_KIND.image, [0, 0, 1, 0xc9]),
    record(NOBJ_RECORD_KIND.patch, [0, 0, 1, 0x00]),
    record(NOBJ_RECORD_KIND.map, [0x41, 0, 0, 0, 1]),
  ];
  const commitPrefix = [
    NOBJ_RECORD_KIND.commit,
    7,
    0,
    records.length + 1,
    0,
    0,
    0,
    1,
  ];
  const covered = Uint8Array.from([...records.flat(), ...commitPrefix]);
  const crc = nobjCrc16CcittFalse(covered);
  return Uint8Array.from([...covered, crc & 0xff, crc >>> 8]);
};

describe('shared NOBJ framing', () => {
  it('decodes the common record phases, commit, version, and checksum', () => {
    const decoded = decodeNobjEnvelope(envelope(), {
      majorVersion: 0,
      minorVersion: 2,
      requireImage: true,
    });

    expect(decoded.version).toEqual({ major: 0, minor: 2 });
    expect(decoded.records.map(({ kind }) => kind)).toEqual([1, 2, 3, 4, 5]);
    expect(decoded.images).toHaveLength(1);
    expect(decoded.patches).toHaveLength(1);
    expect(decoded.commit).toMatchObject({
      recordCount: 5,
      entryBank: 0,
      entryAddress: 0x0100,
    });
  });

  it('rejects truncation, phase errors, version drift, count drift, and CRC drift', () => {
    const valid = envelope();
    expect(() => decodeNobjEnvelope(valid.slice(0, -1))).toThrow('truncated');

    const phase = valid.slice();
    phase[9] = NOBJ_RECORD_KIND.patch;
    expect(() => decodeNobjEnvelope(phase)).toThrow(
      'PATCH requires at least one IMAGE',
    );

    expect(() => decodeNobjEnvelope(valid, { majorVersion: 1 })).toThrow(
      'NOBJ version is 0.2, expected 1.2',
    );

    const count = valid.slice();
    count[count.length - 7] = 4;
    expect(() => decodeNobjEnvelope(count)).toThrow('record count');

    const crc = valid.slice();
    crc[15] ^= 1;
    expect(() => decodeNobjEnvelope(crc)).toThrow('CRC');
  });

  it('allows an image-free profile only when the caller says so', () => {
    const all = [...envelope()];
    const imageStart = 9;
    const imageLength = 7;
    const patchStart = imageStart + imageLength;
    const patchLength = 7;
    const withoutData = Uint8Array.from([
      ...all.slice(0, imageStart),
      ...all.slice(patchStart + patchLength, -10),
    ]);
    const commitPrefix = [NOBJ_RECORD_KIND.commit, 7, 0, 3, 0, 0, 0, 1];
    const covered = Uint8Array.from([...withoutData, ...commitPrefix]);
    const checksum = nobjCrc16CcittFalse(covered);
    const complete = Uint8Array.from([
      ...covered,
      checksum & 0xff,
      checksum >>> 8,
    ]);

    expect(() => decodeNobjEnvelope(complete, { requireImage: true })).toThrow(
      'requires at least one IMAGE',
    );
    expect(decodeNobjEnvelope(complete).images).toHaveLength(0);
  });
});
