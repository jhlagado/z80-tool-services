import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compile } from '@jhlagado/azm';
import { createZ80Runtime } from '@jhlagado/debug80-runtime';
import { beforeAll, describe, expect, it } from 'vitest';

import { nobjCrc16CcittFalse } from '../src/nobj-framing.js';

const LOAD = 0x0100;
const TARGET = 0x5000;
const STACK = 0xeff0;
const RETURN = 0xfffe;

interface Harness {
  readonly bytes: Uint8Array;
  readonly symbols: Readonly<Record<string, number>>;
}

const word = (memory: Uint8Array, address: number): number =>
  (memory[address] ?? 0) | ((memory[address + 1] ?? 0) << 8);

const putWord = (memory: Uint8Array, address: number, value: number): void => {
  memory[address] = value & 0xff;
  memory[address + 1] = value >>> 8;
};

const record = (kind: number, payload: readonly number[]): number[] => [
  kind,
  payload.length & 0xff,
  payload.length >>> 8,
  ...payload,
];

const atomObject = (
  dataRecords: readonly number[][],
  { usedLength = 3, finalCursor = TARGET + usedLength, fill = 0 } = {},
): Uint8Array => {
  const records = [
    record(1, [
      0x4e,
      0x4f,
      0x42,
      0x4a,
      0,
      2,
      0,
      0,
      0,
      1,
      fill,
      0,
      0x50,
      0x20,
      0,
    ]),
    ...dataRecords,
    record(4, [
      0x41,
      0,
      0,
      0,
      0x50,
      usedLength & 0xff,
      usedLength >>> 8,
      finalCursor & 0xff,
      finalCursor >>> 8,
      1,
      0,
    ]),
  ];
  const count = records.length + 1;
  const commitPrefix = [5, 7, 0, count & 0xff, count >>> 8, 0, 0, 0x50];
  const covered = Uint8Array.from([...records.flat(), ...commitPrefix]);
  const crc = nobjCrc16CcittFalse(covered);
  return Uint8Array.from([...covered, crc & 0xff, crc >>> 8]);
};

const validObject = (): Uint8Array =>
  atomObject([
    record(2, [0, 0, 0x50, 0x11, 0x22, 0x33]),
    record(3, [0, 1, 0x50, 0xaa]),
  ]);

const harnessSource = (consumer: string, atomProfile: string): string => `
ORG $0100

${consumer}

${atomProfile}

; Memory-backed proof provider for the shared consumer.
;@ROUTINE OUT A,CARRY CLOBBERS BC,DE,HL,ZERO,SIGN,PARITY,HALFCARRY
ZN_READ:
LD   HL,(CURSOR)
PUSH HL
LD   DE,(LIMIT)
OR   A
SBC  HL,DE
POP  HL
JR   Z,READ_EOF
LD   A,(HL)
INC  HL
LD   (CURSOR),HL
PUSH AF
LD   BC,$B1C1
LD   DE,$D1E1
LD   HL,$A1A1
POP  AF
OR   A
RET
READ_EOF:
LD   BC,$B2C2
LD   DE,$D2E2
LD   HL,$A2A2
LD   A,ZN_EOF
SCF
RET

;@ROUTINE OUT A,CARRY CLOBBERS BC,DE,HL,ZERO,SIGN,PARITY,HALFCARRY
ZN_REW:
LD   HL,INPUT
LD   (CURSOR),HL
LD   BC,$B3C3
LD   DE,$D3E3
LD   HL,$A3A3
XOR  A
RET

;@ROUTINE IN A,B,DE OUT A,CARRY CLOBBERS BC,DE,HL,ZERO,SIGN,PARITY,HALFCARRY
ZN_STORE:
PUSH AF
LD   A,(STORE_FAIL)
OR   A
JR   NZ,STORE_BAD
POP  AF
LD   (DE),A
LD   BC,$B4C4
LD   DE,$D4E4
LD   HL,$A4A4
OR   A
RET
STORE_BAD:
POP  AF
LD   BC,$B5C5
LD   DE,$D5E5
LD   HL,$A5A5
SCF
RET

STATE: DS ZA_SIZE
CURSOR: DW INPUT
LIMIT: DW INPUT
STORE_FAIL: DB 0
INPUT: DS 512
IMAGE_END:
`;

const buildHarness = async (): Promise<Harness> => {
  const [consumer, atomProfile] = await Promise.all([
    readFile(new URL('../native/nobj-consumer.asm', import.meta.url), 'utf8'),
    readFile(new URL('../native/atom-flat-nobj.asm', import.meta.url), 'utf8'),
  ]);
  const directory = await mkdtemp(join(tmpdir(), 'zts-native-nobj-'));
  try {
    const sourcePath = join(directory, 'proof.asm');
    const source = harnessSource(consumer, atomProfile)
      .split(/\r\n|\n|\r/)
      .map((line) => {
        const annotation = /^\s*;@(ROUTINE|EXPECTOUT)\b(.*)$/i.exec(line);
        return annotation === null
          ? line
          : `.${annotation[1]?.toLowerCase()}${annotation[2] ?? ''}`;
      })
      .join('\n');
    await writeFile(sourcePath, `${source}\n.end\n`);
    const result = await compile(sourcePath, {
      emitBin: true,
      emitD8m: true,
      emitHex: false,
      emitLst: false,
      registerContracts: 'strict',
      symbolCase: 'insensitive',
    });
    const errors = result.diagnostics.filter(
      ({ severity }) => severity === 'error',
    );
    if (errors.length !== 0) {
      throw new Error(
        errors
          .map(({ line, column, message }) => `${line}:${column}: ${message}`)
          .join('\n'),
      );
    }
    const binary = result.artifacts.find(({ kind }) => kind === 'bin');
    const debugMap = result.artifacts.find(({ kind }) => kind === 'd8m');
    if (binary?.kind !== 'bin' || debugMap?.kind !== 'd8m') {
      throw new Error('native NOBJ proof artifacts are missing');
    }
    const symbols = Object.fromEntries(
      debugMap.json.symbols.flatMap((symbol) => {
        const value = symbol.address ?? symbol.value;
        return value === undefined ? [] : [[symbol.name.toUpperCase(), value]];
      }),
    );
    return { bytes: binary.bytes, symbols };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

let harness: Harness;

beforeAll(async () => {
  harness = await buildHarness();
});

const run = (
  object: Uint8Array,
  options: Readonly<{ stateAddress?: number; storeFailure?: boolean }> = {},
): Readonly<{ status: number; carry: number; memory: Uint8Array }> => {
  const memory = new Uint8Array(0x10000);
  memory.set(harness.bytes, LOAD);
  memory.fill(0xcc, TARGET, TARGET + 16);
  memory.set(object, harness.symbols.INPUT);
  // The public entry owns both rewinds; callers need not pre-position input.
  putWord(
    memory,
    harness.symbols.CURSOR,
    harness.symbols.INPUT + object.length,
  );
  putWord(memory, harness.symbols.LIMIT, harness.symbols.INPUT + object.length);
  memory[harness.symbols.STORE_FAIL] = options.storeFailure === true ? 1 : 0;
  const state = options.stateAddress ?? harness.symbols.STATE;
  memory[state] = 0;
  memory[state + 1] = 2;
  memory[state + 2] = 0;
  putWord(memory, STACK, RETURN);

  const runtime = createZ80Runtime({ memory, startAddress: LOAD }, LOAD);
  runtime.cpu.ix = state;
  runtime.cpu.sp = STACK;
  runtime.cpu.pc = harness.symbols.ZN_MAT;
  for (
    let steps = 0;
    runtime.cpu.pc !== RETURN && steps < 2_000_000;
    steps += 1
  ) {
    runtime.step();
  }
  expect(runtime.cpu.pc).toBe(RETURN);
  return {
    status: runtime.cpu.a,
    carry: runtime.cpu.flags.C,
    memory: runtime.hardware.memory,
  };
};

describe('native NOBJ consumer', () => {
  it('validates, rewinds, applies IMAGE, and then applies PATCH', () => {
    const outcome = run(validObject());
    expect(
      { status: outcome.status, carry: outcome.carry },
      JSON.stringify({
        phase: outcome.memory[harness.symbols.STATE + 7],
        kind: outcome.memory[harness.symbols.STATE + 9],
        length: word(outcome.memory, harness.symbols.STATE + 10),
        cursor:
          word(outcome.memory, harness.symbols.CURSOR) - harness.symbols.INPUT,
      }),
    ).toEqual({
      status: 0,
      carry: 0,
    });
    expect([...outcome.memory.slice(TARGET, TARGET + 3)]).toEqual([
      0x11, 0xaa, 0x33,
    ]);
    expect(word(outcome.memory, harness.symbols.CURSOR)).toBeGreaterThan(
      harness.symbols.INPUT,
    );
    expect(harness.symbols.ZN_END - harness.symbols.ZN_VALID).toBe(755);
    expect(harness.symbols.ZA_END - harness.symbols.ZN_PROF).toBe(1147);
  });

  it('rejects a bad CRC before changing target memory', () => {
    const object = validObject();
    object[object.length - 1] ^= 0x80;
    const outcome = run(object);
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 6,
      carry: 1,
    });
    expect([...outcome.memory.slice(TARGET, TARGET + 3)]).toEqual([
      0xcc, 0xcc, 0xcc,
    ]);
  });

  it('rejects a byte after COMMIT before changing target memory', () => {
    const outcome = run(Uint8Array.from([...validObject(), 0]));
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 2,
      carry: 1,
    });
    expect([...outcome.memory.slice(TARGET, TARGET + 3)]).toEqual([
      0xcc, 0xcc, 0xcc,
    ]);
  });

  it('runs Atom profile validation before changing target memory', () => {
    const object = validObject();
    object[9] = 1;
    const crc = nobjCrc16CcittFalse(object.slice(0, -2));
    object[object.length - 2] = crc & 0xff;
    object[object.length - 1] = crc >>> 8;
    const outcome = run(object);
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 7,
      carry: 1,
    });
    expect([...outcome.memory.slice(TARGET, TARGET + 3)]).toEqual([
      0xcc, 0xcc, 0xcc,
    ]);
  });

  it('rejects a patch that is not covered by IMAGE bytes', () => {
    const outcome = run(
      atomObject(
        [
          record(2, [0, 0, 0x50, 0x11, 0x22, 0x33]),
          record(3, [0, 3, 0x50, 0xaa]),
        ],
        { usedLength: 4 },
      ),
    );
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 7,
      carry: 1,
    });
    expect([...outcome.memory.slice(TARGET, TARGET + 4)]).toEqual([
      0xcc, 0xcc, 0xcc, 0xcc,
    ]);
  });

  it('rejects overlapping patches before changing target memory', () => {
    const outcome = run(
      atomObject(
        [
          record(2, [0, 0, 0x50, 1, 2, 3, 4]),
          record(3, [0, 1, 0x50, 9, 9]),
          record(3, [0, 2, 0x50, 8]),
        ],
        { usedLength: 4 },
      ),
    );
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 7,
      carry: 1,
    });
    expect([...outcome.memory.slice(TARGET, TARGET + 4)]).toEqual([
      0xcc, 0xcc, 0xcc, 0xcc,
    ]);
  });

  it('accepts one patch covered across adjacent IMAGE records', () => {
    const outcome = run(
      atomObject([
        record(2, [0, 0, 0x50, 1]),
        record(2, [0, 1, 0x50, 2, 3]),
        record(3, [0, 0, 0x50, 7, 8, 9]),
      ]),
    );
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 0,
      carry: 0,
    });
    expect([...outcome.memory.slice(TARGET, TARGET + 3)]).toEqual([7, 8, 9]);
  });

  it('initializes implicit gaps with the BEGIN fill byte before applying IMAGE', () => {
    const outcome = run(
      atomObject([record(2, [0, 0, 0x50, 1]), record(2, [0, 2, 0x50, 3])], {
        fill: 0x5a,
      }),
    );
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 0,
      carry: 0,
    });
    expect([...outcome.memory.slice(TARGET, TARGET + 3)]).toEqual([1, 0x5a, 3]);
  });

  it('reports target initialization failure before applying IMAGE or PATCH', () => {
    const outcome = run(validObject(), { storeFailure: true });
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 8,
      carry: 1,
    });
    expect([...outcome.memory.slice(TARGET, TARGET + 3)]).toEqual([
      0xcc, 0xcc, 0xcc,
    ]);
  });

  it('accepts an empty Atom image with a retained zero used length', () => {
    const outcome = run(atomObject([], { usedLength: 0, finalCursor: TARGET }));
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 0,
      carry: 0,
    });
    expect([...outcome.memory.slice(TARGET, TARGET + 3)]).toEqual([
      0xcc, 0xcc, 0xcc,
    ]);
  });

  it('rejects a target capacity that overlaps the consumer state block', () => {
    const outcome = run(validObject(), { stateAddress: TARGET + 8 });
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 7,
      carry: 1,
    });
  });
});
