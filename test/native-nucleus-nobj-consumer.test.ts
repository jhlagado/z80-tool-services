import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compile } from '@jhlagado/azm';
import { createZ80Runtime } from '@jhlagado/debug80-runtime';
import { beforeAll, describe, expect, it } from 'vitest';

import { nobjCrc16CcittFalse } from '../src/nobj-framing.js';
import { parseNobj } from '../../nucleus/src/nobj.js';

const LOAD = 0x0100;
const TARGET = 0x5000;
const STACK = 0xeff0;
const RETURN = 0xfffe;
const INITIAL_IY = 0xcafe;

interface Harness {
  readonly bytes: Uint8Array;
  readonly symbols: Readonly<Record<string, number>>;
}

interface BankMap {
  readonly used: number;
  readonly readOnlyBase?: number;
  readonly readOnlyLength?: number;
  readonly aggregateBase?: number;
  readonly aggregateLength?: number;
}

interface MapFields {
  readonly rom: boolean;
  readonly entryBank: number;
  readonly entryAddress: number;
  readonly writableBase: number;
  readonly writableCapacity: number;
  readonly vectorLength: number;
  readonly initializedLength: number;
  readonly bssLength: number;
  readonly stackRequirement: number;
  readonly loadBank: number;
  readonly loadAddress: number;
  readonly partBanks: readonly number[];
  readonly banks: readonly BankMap[];
}

const appendWord = (bytes: number[], value: number): void => {
  bytes.push(value & 0xff, value >>> 8);
};

const record = (kind: number, payload: readonly number[]): number[] => [
  kind,
  payload.length & 0xff,
  payload.length >>> 8,
  ...payload,
];

const image = (
  kind: 2 | 3,
  bank: number,
  address: number,
  bytes: readonly number[],
): number[] => record(kind, [bank, address & 0xff, address >>> 8, ...bytes]);

const mapRecord = (map: MapFields): number[] => {
  const bytes = [1, (map.rom ? 1 : 0) | 2, map.entryBank];
  appendWord(bytes, map.entryAddress);
  appendWord(bytes, map.writableBase);
  appendWord(bytes, map.writableCapacity);
  appendWord(bytes, map.writableBase);
  appendWord(bytes, map.vectorLength);
  appendWord(bytes, map.writableBase);
  appendWord(bytes, map.initializedLength);
  appendWord(bytes, map.writableBase + map.initializedLength);
  appendWord(bytes, map.bssLength);
  appendWord(bytes, map.stackRequirement);
  bytes.push(map.loadBank);
  appendWord(bytes, map.loadAddress);
  appendWord(bytes, map.initializedLength);
  bytes.push(map.partBanks.length, ...map.partBanks, map.banks.length);
  for (const bank of map.banks) {
    appendWord(bytes, bank.used);
    appendWord(bytes, bank.readOnlyBase ?? 0);
    appendWord(bytes, bank.readOnlyLength ?? 0);
    appendWord(bytes, bank.aggregateBase ?? 0);
    appendWord(bytes, bank.aggregateLength ?? 0);
  }
  return record(4, bytes);
};

const nucleusObject = ({
  records,
  map,
  banked = map.banks.length > 1,
  fill = 0x5a,
  base = TARGET,
  capacity = 0x20,
}: {
  readonly records: readonly number[][];
  readonly map: MapFields;
  readonly banked?: boolean;
  readonly fill?: number;
  readonly base?: number;
  readonly capacity?: number;
}): Uint8Array => {
  const beginPayload = [0x4e, 0x4f, 0x42, 0x4a, 0, 1, banked ? 1 : 0];
  appendWord(beginPayload, 0x1234);
  beginPayload.push(map.banks.length, fill);
  appendWord(beginPayload, base);
  appendWord(beginPayload, capacity);
  const framed = [record(1, beginPayload), ...records, mapRecord(map)];
  const count = framed.length + 1;
  const commitPrefix = [
    5,
    7,
    0,
    count & 0xff,
    count >>> 8,
    map.entryBank,
    map.entryAddress & 0xff,
    map.entryAddress >>> 8,
  ];
  const covered = Uint8Array.from([...framed.flat(), ...commitPrefix]);
  const crc = nobjCrc16CcittFalse(covered);
  return Uint8Array.from([...covered, crc & 0xff, crc >>> 8]);
};

const bankedMap = (): MapFields => ({
  rom: true,
  entryBank: 1,
  entryAddress: TARGET,
  writableBase: 0x6000,
  writableCapacity: 0x100,
  vectorLength: 4,
  initializedLength: 8,
  bssLength: 8,
  stackRequirement: 0x20,
  loadBank: 1,
  loadAddress: TARGET + 2,
  partBanks: [0, 1],
  banks: [
    { used: 2 },
    {
      used: 10,
      readOnlyBase: TARGET,
      readOnlyLength: 10,
      aggregateBase: TARGET + 8,
      aggregateLength: 2,
    },
  ],
});

const validBankedObject = (): Uint8Array =>
  nucleusObject({
    records: [
      image(2, 0, TARGET, [0x10]),
      image(2, 1, TARGET, [0x20, 0x21, 1, 2, 3, 4, 5, 6, 0x28, 0x29]),
      image(3, 0, TARGET + 1, [0x11]),
      image(3, 1, TARGET + 1, [0xaa]),
    ],
    map: bankedMap(),
  });

const flatMap = (): MapFields => ({
  rom: false,
  entryBank: 0,
  entryAddress: TARGET,
  writableBase: TARGET + 4,
  writableCapacity: 0x100,
  vectorLength: 2,
  initializedLength: 4,
  bssLength: 4,
  stackRequirement: 0x20,
  loadBank: 0,
  loadAddress: TARGET + 4,
  partBanks: [0],
  banks: [{ used: 8 }],
});

const harnessSource = (consumer: string, profile: string): string => `
ORG $0100

${consumer}

${profile}

VALIDATE_ONLY:
CALL ZN_VALID
RET  C
JP   ZN_PROF

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

; Map logical bank N to a proof backing area N pages above its target address.
;@ROUTINE IN A,B,DE OUT A,CARRY CLOBBERS BC,DE,HL,ZERO,SIGN,PARITY,HALFCARRY
ZN_STORE:
PUSH AF
LD   A,(STORE_FAIL)
OR   A
JR   NZ,STORE_BAD
LD   A,D
ADD  A,B
LD   D,A
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

STATE: DS NN_SIZE
CURSOR: DW INPUT
LIMIT: DW INPUT
STORE_FAIL: DB 0
INPUT: DS 8192
IMAGE_END:
`;

const buildHarness = async (): Promise<Harness> => {
  const [consumer, profile] = await Promise.all([
    readFile(new URL('../native/nobj-consumer.asm', import.meta.url), 'utf8'),
    readFile(new URL('../native/nucleus-nobj.asm', import.meta.url), 'utf8'),
  ]);
  const directory = await mkdtemp(join(tmpdir(), 'zts-native-nucleus-'));
  try {
    const sourcePath = join(directory, 'proof.asm');
    const source = harnessSource(consumer, profile)
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
      throw new Error('native Nucleus proof artifacts are missing');
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

const putWord = (memory: Uint8Array, address: number, value: number): void => {
  memory[address] = value & 0xff;
  memory[address + 1] = value >>> 8;
};

const run = (
  object: Uint8Array,
  {
    storeFailure = false,
    stateAddress = harness.symbols.STATE,
    stackAddress = STACK,
    entry = 'ZN_MAT',
    maxSteps = 10_000_000,
  }: {
    readonly storeFailure?: boolean;
    readonly stateAddress?: number;
    readonly stackAddress?: number;
    readonly entry?: 'ZN_MAT' | 'VALIDATE_ONLY';
    readonly maxSteps?: number;
  } = {},
): Readonly<{
  status: number;
  carry: number;
  iy: number;
  steps: number;
  memory: Uint8Array;
}> => {
  const memory = new Uint8Array(0x10000);
  memory.fill(0xcc);
  memory.set(harness.bytes, LOAD);
  memory.set(object, harness.symbols.INPUT);
  putWord(
    memory,
    harness.symbols.CURSOR,
    harness.symbols.INPUT + object.length,
  );
  putWord(memory, harness.symbols.LIMIT, harness.symbols.INPUT + object.length);
  memory[harness.symbols.STORE_FAIL] = storeFailure ? 1 : 0;
  memory[stateAddress] = 0;
  memory[stateAddress + 1] = 1;
  memory[stateAddress + 2] = 1;
  putWord(memory, stackAddress, RETURN);
  const runtime = createZ80Runtime({ memory, startAddress: LOAD }, LOAD);
  runtime.cpu.ix = stateAddress;
  runtime.cpu.iy = INITIAL_IY;
  runtime.cpu.sp = stackAddress;
  runtime.cpu.pc = harness.symbols[entry]!;
  let steps = 0;
  for (; runtime.cpu.pc !== RETURN && steps < maxSteps; steps += 1) {
    runtime.step();
  }
  expect(runtime.cpu.pc).toBe(RETURN);
  return {
    status: runtime.cpu.a,
    carry: runtime.cpu.flags.C,
    iy: runtime.cpu.iy,
    steps,
    memory: runtime.hardware.memory,
  };
};

const withCrc = (object: Uint8Array): Uint8Array => {
  const copy = object.slice();
  const crc = nobjCrc16CcittFalse(copy.slice(0, -2));
  copy[copy.length - 2] = crc & 0xff;
  copy[copy.length - 1] = crc >>> 8;
  return copy;
};

const payloadOffset = (object: Uint8Array, kind: number): number => {
  for (let cursor = 0; cursor < object.length;) {
    const length = (object[cursor + 1] ?? 0) | ((object[cursor + 2] ?? 0) << 8);
    if (object[cursor] === kind) return cursor + 3;
    cursor += 3 + length;
  }
  throw new Error(`record kind ${kind} is missing`);
};

const mutate = (
  object: Uint8Array,
  kind: number,
  offset: number,
  bytes: readonly number[],
): Uint8Array => {
  const copy = object.slice();
  copy.set(bytes, payloadOffset(copy, kind) + offset);
  return withCrc(copy);
};

const resizeRecord = (
  object: Uint8Array,
  kind: number,
  delta: -1 | 1,
): Uint8Array => {
  const payload = payloadOffset(object, kind);
  const header = payload - 3;
  const length = (object[header + 1] ?? 0) | ((object[header + 2] ?? 0) << 8);
  const nextLength = length + delta;
  const bytes = [...object];
  if (delta < 0) bytes.splice(payload + length - 1, 1);
  else bytes.splice(payload + length, 0, 0);
  bytes[header + 1] = nextLength & 0xff;
  bytes[header + 2] = nextLength >>> 8;
  return withCrc(Uint8Array.from(bytes));
};

describe('native Nucleus NOBJ consumer', () => {
  it('validates, fills, and patches a banked Nucleus object', () => {
    const outcome = run(validBankedObject());
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 0,
      carry: 0,
    });
    expect(outcome.iy).toBe(INITIAL_IY);
    expect([...outcome.memory.slice(TARGET, TARGET + 2)]).toEqual([0x10, 0x11]);
    expect([...outcome.memory.slice(TARGET + 0x100, TARGET + 0x10a)]).toEqual([
      0x20, 0xaa, 1, 2, 3, 4, 5, 6, 0x28, 0x29,
    ]);
    expect(harness.symbols.NN_END - harness.symbols.ZN_PROF).toBe(2270);
  });

  it('accepts the loaded flat profile', () => {
    const outcome = run(
      nucleusObject({
        records: [image(2, 0, TARGET, [1, 2, 3, 4, 5, 6, 7, 8])],
        map: flatMap(),
        banked: false,
        capacity: 0x200,
      }),
    );
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 0,
      carry: 0,
    });
    expect([...outcome.memory.slice(TARGET, TARGET + 8)]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('rejects descending IMAGE records before changing target banks', () => {
    const object = nucleusObject({
      records: [
        image(2, 0, TARGET + 1, [2]),
        image(2, 0, TARGET, [1]),
        image(2, 1, TARGET, [0x20, 0x21, 1, 2, 3, 4, 5, 6, 0x28, 0x29]),
      ],
      map: bankedMap(),
    });
    expect(() => parseNobj(object)).toThrow();
    const outcome = run(object);
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 7,
      carry: 1,
    });
    expect([...outcome.memory.slice(TARGET, TARGET + 2)]).toEqual([0xcc, 0xcc]);
  });

  it.each([
    [TARGET + 1, [3], TARGET, [4, 5]],
    [TARGET, [4, 5], TARGET + 1, [3]],
  ] as const)(
    'rejects overlapping PATCH records in either address order',
    (firstAddress, firstBytes, secondAddress, secondBytes) => {
      const object = nucleusObject({
        records: [
          image(2, 0, TARGET, [1, 2]),
          image(2, 1, TARGET, [0x20, 0x21, 1, 2, 3, 4, 5, 6, 0x28, 0x29]),
          image(3, 0, firstAddress, firstBytes),
          image(3, 0, secondAddress, secondBytes),
        ],
        map: bankedMap(),
      });
      expect(() => parseNobj(object)).toThrow();
      const outcome = run(object);
      expect({ status: outcome.status, carry: outcome.carry }).toEqual({
        status: 7,
        carry: 1,
      });
    },
  );

  it('retains the declared fill byte in an untouched IMAGE gap', () => {
    const map: MapFields = {
      rom: false,
      entryBank: 0,
      entryAddress: TARGET,
      writableBase: TARGET + 1,
      writableCapacity: 4,
      vectorLength: 1,
      initializedLength: 2,
      bssLength: 0,
      stackRequirement: 0,
      loadBank: 0,
      loadAddress: TARGET + 1,
      partBanks: [0],
      banks: [{ used: 3 }],
    };
    const object = nucleusObject({
      records: [image(2, 0, TARGET, [0x10]), image(2, 0, TARGET + 2, [0x12])],
      map,
      banked: false,
      capacity: 0x20,
    });
    expect(() => parseNobj(object)).not.toThrow();
    const outcome = run(object);
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 0,
      carry: 0,
    });
    expect([...outcome.memory.slice(TARGET, TARGET + 3)]).toEqual([
      0x10, 0x5a, 0x12,
    ]);
  });

  it('accepts target and state extents that end exactly at $10000', () => {
    const top = 0xfff0;
    const map: MapFields = {
      rom: true,
      entryBank: 0,
      entryAddress: top,
      writableBase: 0x6000,
      writableCapacity: 0x20,
      vectorLength: 1,
      initializedLength: 1,
      bssLength: 0,
      stackRequirement: 0,
      loadBank: 0,
      loadAddress: top,
      partBanks: [0],
      banks: [{ used: 16 }],
    };
    const topObject = nucleusObject({
      records: [
        image(
          2,
          0,
          top,
          Array.from({ length: 16 }, (_, i) => i),
        ),
      ],
      map,
      banked: false,
      base: top,
      capacity: 16,
    });
    expect(() => parseNobj(topObject)).not.toThrow();
    const targetOutcome = run(topObject);
    expect({
      status: targetOutcome.status,
      carry: targetOutcome.carry,
    }).toEqual({
      status: 0,
      carry: 0,
    });
    expect([...targetOutcome.memory.slice(top)]).toEqual(
      Array.from({ length: 16 }, (_, i) => i),
    );

    const stateOutcome = run(validBankedObject(), {
      stateAddress: 0x10000 - 94,
      stackAddress: 0xe000,
    });
    expect({ status: stateOutcome.status, carry: stateOutcome.carry }).toEqual({
      status: 0,
      carry: 0,
    });
  });

  it('accepts state adjacency and rejects state overlap', () => {
    const adjacent = run(validBankedObject(), { stateAddress: TARGET + 0x20 });
    expect({ status: adjacent.status, carry: adjacent.carry }).toEqual({
      status: 0,
      carry: 0,
    });
    const overlap = run(validBankedObject(), { stateAddress: TARGET + 0x1f });
    expect({ status: overlap.status, carry: overlap.carry }).toEqual({
      status: 7,
      carry: 1,
    });
  });

  it.each([-1, 1] as const)(
    'rejects a MAP payload whose exact length differs by %i',
    (delta) => {
      const object = resizeRecord(validBankedObject(), 4, delta);
      expect(() => parseNobj(object)).toThrow();
      const outcome = run(object);
      expect({ status: outcome.status, carry: outcome.carry }).toEqual({
        status: 7,
        carry: 1,
      });
    },
  );

  it('validates the 255-bank profile boundary with constant state RAM', () => {
    const banks = Array.from({ length: 255 }, () => ({ used: 1 }));
    const map: MapFields = {
      rom: true,
      entryBank: 254,
      entryAddress: TARGET,
      writableBase: 0x6000,
      writableCapacity: 0x100,
      vectorLength: 1,
      initializedLength: 1,
      bssLength: 0,
      stackRequirement: 0,
      loadBank: 254,
      loadAddress: TARGET,
      partBanks: Array.from({ length: 255 }, (_, bank) => bank),
      banks,
    };
    const object = nucleusObject({
      records: Array.from({ length: 255 }, (_, bank) =>
        image(2, bank, TARGET, [bank]),
      ),
      map,
      base: TARGET,
      capacity: 1,
    });
    expect(() => parseNobj(object)).not.toThrow();
    const outcome = run(object, {
      entry: 'VALIDATE_ONLY',
      maxSteps: 50_000_000,
    });
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 0,
      carry: 0,
    });
    expect(outcome.steps).toBeLessThan(50_000_000);
  });

  it('rejects a MAP used extent that differs from record high water', () => {
    const map = bankedMap();
    const object = nucleusObject({
      records: [
        image(2, 0, TARGET, [1]),
        image(2, 1, TARGET, [0x20, 0x21, 1, 2, 3, 4, 5, 6, 0x28, 0x29]),
      ],
      map: { ...map, banks: [{ used: 2 }, map.banks[1]!] },
    });
    const outcome = run(object);
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 7,
      carry: 1,
    });
  });

  it('rejects an out-of-range bank ordinal', () => {
    const object = validBankedObject();
    const firstImageBank = 21;
    object[firstImageBank] = 2;
    const outcome = run(withCrc(object));
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 7,
      carry: 1,
    });
  });

  it('reports initialization failure before applying any target record', () => {
    const outcome = run(validBankedObject(), { storeFailure: true });
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 8,
      carry: 1,
    });
    expect([...outcome.memory.slice(TARGET, TARGET + 2)]).toEqual([0xcc, 0xcc]);
  });

  it.each([
    [
      'reserved BEGIN flags',
      (object: Uint8Array) => mutate(object, 1, 6, [0x81]),
    ],
    [
      'banked MAP without ROM mode',
      (object: Uint8Array) => mutate(object, 4, 1, [2]),
    ],
    [
      'out-of-range source-part bank',
      (object: Uint8Array) => mutate(object, 4, 29, [2]),
    ],
    [
      'wrong MAP bank-entry count',
      (object: Uint8Array) => mutate(object, 4, 31, [1]),
    ],
    [
      'data load in the wrong bank',
      (object: Uint8Array) => mutate(object, 4, 23, [0]),
    ],
    [
      'aggregate constants outside read-only data',
      (object: Uint8Array) => mutate(object, 4, 48, [0xff, 0x4f]),
    ],
    [
      'COMMIT entry mismatch',
      (object: Uint8Array) => mutate(object, 5, 2, [0]),
    ],
  ])('rejects %s before changing target banks', (_name, corrupt) => {
    const outcome = run(corrupt(validBankedObject()));
    expect({ status: outcome.status, carry: outcome.carry }).toEqual({
      status: 7,
      carry: 1,
    });
    expect([...outcome.memory.slice(TARGET, TARGET + 2)]).toEqual([0xcc, 0xcc]);
    expect([...outcome.memory.slice(TARGET + 0x100, TARGET + 0x102)]).toEqual([
      0xcc, 0xcc,
    ]);
  });
});
