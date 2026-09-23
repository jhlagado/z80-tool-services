import { describe, expect, it } from 'vitest';

import {
  PORTABLE_CONFORMANCE_SCHEMA,
  PortableConformanceError,
  validatePortableConformanceRecord,
} from '../src/index.js';

const validRecord = () => ({
  schema: PORTABLE_CONFORMANCE_SCHEMA,
  profile: 'triptych-cpu-v0.1',
  source: {
    logicalIdentity: 'stage1.asm',
    sha256: '2ed7f2564f4ce518adf1eff027c69012f43e4ed1b1b330296bd606a8d0dcc0c8',
  },
  artifact: {
    kind: 'flat-binary',
    base: 0x4000,
    end: 0x4003,
    bytes: [0x3e, 0x2a, 0x76],
    sha256: '83eb97a92203f33ccc0839186abcad1a0cc05b857ac46ad30bbb074ef08a1adf',
  },
  diagnostic: null,
  execution: {
    status: 'halted',
    steps: 3,
    tStates: 21,
    cpu: { a: 0x2a, halted: true },
  },
  provenance: {
    assembler: 'atom',
    atomVersion: '0.3.0',
    executionSubstrate: 'triptych-rust-cpu',
    compatibleHosts: ['triptych-native', 'triptych-wasm'],
  },
});

describe('portable conformance record', () => {
  it('accepts the shared v1 shape and preserves profile-owned observations', () => {
    const record = validatePortableConformanceRecord(validRecord());
    expect(record.artifact.end - record.artifact.base).toBe(
      record.artifact.bytes.length,
    );
    expect(record.execution.cpu).toEqual({ a: 0x2a, halted: true });
    expect(record.provenance.compatibleHosts).toEqual([
      'triptych-native',
      'triptych-wasm',
    ]);
  });

  it('accepts a host/tool record with no source and a committed status', () => {
    const value = validRecord();
    value.source = null;
    value.profile = 'atom-bare-host-v1';
    value.execution = { status: 'committed', instructions: 10_167 };
    value.provenance = {
      assembler: 'atom',
      executionSubstrate: 'debug80-reference',
      compatibleHosts: ['node', 'deno'],
    };
    expect(validatePortableConformanceRecord(value).source).toBeNull();
  });

  it.each([
    [
      'schema',
      (value: ReturnType<typeof validRecord>) => {
        value.schema = 'wrong';
      },
    ],
    [
      'source identity',
      (value: ReturnType<typeof validRecord>) => {
        value.source!.logicalIdentity = '/tmp/stage1.asm';
      },
    ],
    [
      'artifact extent',
      (value: ReturnType<typeof validRecord>) => {
        value.artifact.end = 0x4004;
      },
    ],
    [
      'artifact digest',
      (value: ReturnType<typeof validRecord>) => {
        value.artifact.sha256 = '00';
      },
    ],
    [
      'execution status',
      (value: ReturnType<typeof validRecord>) => {
        delete value.execution.status;
      },
    ],
    [
      'compatible hosts',
      (value: ReturnType<typeof validRecord>) => {
        value.provenance.compatibleHosts = [];
      },
    ],
  ])('rejects invalid %s records with a useful path', (_name, mutate) => {
    const value = validRecord();
    mutate(value);
    expect(() => validatePortableConformanceRecord(value)).toThrow(
      PortableConformanceError,
    );
  });

  it('rejects duplicate compatible hosts instead of hiding provenance ambiguity', () => {
    const value = validRecord();
    value.provenance.compatibleHosts = ['triptych-wasm', 'triptych-wasm'];
    expect(() => validatePortableConformanceRecord(value)).toThrow(
      'provenance.compatibleHosts',
    );
  });
});
