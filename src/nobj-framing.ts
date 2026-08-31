/** Shared framing, phase, commit, and checksum validation for NOBJ profiles. */

export const NOBJ_RECORD_KIND = Object.freeze({
  begin: 0x01,
  image: 0x02,
  patch: 0x03,
  map: 0x04,
  commit: 0x05,
} as const);

export interface NobjEnvelopeOptions {
  readonly majorVersion?: number;
  readonly minorVersion?: number;
  readonly requireImage?: boolean;
}

export interface NobjFramedRecord {
  readonly kind: number;
  readonly start: number;
  readonly payloadStart: number;
  readonly payloadEnd: number;
  readonly payload: Uint8Array;
}

export interface NobjEnvelopeCommit {
  readonly recordCount: number;
  readonly entryBank: number;
  readonly entryAddress: number;
  readonly crc16: number;
}

export interface NobjEnvelope {
  readonly serialized: Uint8Array;
  readonly version: Readonly<{ major: number; minor: number }>;
  readonly records: readonly NobjFramedRecord[];
  readonly begin: NobjFramedRecord;
  readonly images: readonly NobjFramedRecord[];
  readonly patches: readonly NobjFramedRecord[];
  readonly map: NobjFramedRecord;
  readonly commitRecord: NobjFramedRecord;
  readonly commit: Readonly<NobjEnvelopeCommit>;
}

export class NobjFramingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NobjFramingError';
  }
}

const fail = (message: string): never => {
  throw new NobjFramingError(message);
};

const u16 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);

export const nobjCrc16CcittFalse = (bytes: Uint8Array): number => {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc =
        (crc & 0x8000) === 0
          ? (crc << 1) & 0xffff
          : ((crc << 1) ^ 0x1021) & 0xffff;
    }
  }
  return crc;
};

const decodeRecords = (serialized: Uint8Array): NobjFramedRecord[] => {
  if (!(serialized instanceof Uint8Array)) {
    return fail('NOBJ input must be bytes');
  }
  const records: NobjFramedRecord[] = [];
  let cursor = 0;
  while (cursor < serialized.length) {
    if (serialized.length - cursor < 3) fail('NOBJ has a truncated record header');
    const start = cursor;
    const kind = serialized[cursor] ?? 0;
    if (kind < NOBJ_RECORD_KIND.begin || kind > NOBJ_RECORD_KIND.commit) {
      fail('reserved NOBJ record kind');
    }
    const length = u16(serialized, cursor + 1);
    const payloadStart = cursor + 3;
    const payloadEnd = payloadStart + length;
    if (payloadEnd > serialized.length) fail('NOBJ has a truncated record payload');
    records.push(Object.freeze({
      kind,
      start,
      payloadStart,
      payloadEnd,
      payload: serialized.slice(payloadStart, payloadEnd),
    }));
    cursor = payloadEnd;
    if (kind === NOBJ_RECORD_KIND.commit && cursor !== serialized.length) {
      fail('NOBJ contains a byte after COMMIT');
    }
  }
  if (records.length === 0) fail('NOBJ stream is empty');
  return records;
};

export const decodeNobjEnvelope = (
  serialized: Uint8Array,
  options: NobjEnvelopeOptions = {},
): NobjEnvelope => {
  const records = decodeRecords(serialized);
  const begin = records[0];
  if (begin?.kind !== NOBJ_RECORD_KIND.begin) {
    return fail('NOBJ BEGIN must be the first record');
  }
  if (
    begin.payload.length < 6 ||
    begin.payload[0] !== 0x4e ||
    begin.payload[1] !== 0x4f ||
    begin.payload[2] !== 0x42 ||
    begin.payload[3] !== 0x4a
  ) {
    fail('NOBJ BEGIN has invalid magic or no version');
  }
  const version = Object.freeze({
    major: begin.payload[4] ?? 0,
    minor: begin.payload[5] ?? 0,
  });
  if (
    (options.majorVersion !== undefined && version.major !== options.majorVersion) ||
    (options.minorVersion !== undefined && version.minor !== options.minorVersion)
  ) {
    fail(
      `NOBJ version is ${version.major}.${version.minor}, expected ${
        options.majorVersion ?? version.major
      }.${options.minorVersion ?? version.minor}`,
    );
  }

  const images: NobjFramedRecord[] = [];
  const patches: NobjFramedRecord[] = [];
  let map: NobjFramedRecord | undefined;
  let commitRecord: NobjFramedRecord | undefined;
  let phase: 'image' | 'patch' | 'map' | 'commit' = 'image';
  for (const record of records.slice(1)) {
    switch (record.kind) {
      case NOBJ_RECORD_KIND.begin:
        return fail('NOBJ contains more than one BEGIN');
      case NOBJ_RECORD_KIND.image:
        if (phase !== 'image') fail('IMAGE appears outside the IMAGE phase');
        images.push(record);
        break;
      case NOBJ_RECORD_KIND.patch:
        if (images.length === 0) fail('PATCH requires at least one IMAGE');
        if (phase !== 'image' && phase !== 'patch') {
          fail('PATCH appears outside the PATCH phase');
        }
        phase = 'patch';
        patches.push(record);
        break;
      case NOBJ_RECORD_KIND.map:
        if (phase !== 'image' && phase !== 'patch') {
          fail('MAP appears outside its terminal position');
        }
        if (options.requireImage === true && images.length === 0) {
          fail('NOBJ profile requires at least one IMAGE');
        }
        phase = 'map';
        map = record;
        break;
      case NOBJ_RECORD_KIND.commit:
        if (phase !== 'map' || map === undefined) {
          fail('COMMIT must immediately follow MAP');
        }
        phase = 'commit';
        commitRecord = record;
        break;
    }
  }
  const finalMap = map ?? fail('NOBJ stream has no MAP');
  const finalCommit = commitRecord ?? fail('NOBJ stream has no terminal COMMIT');
  if (records.at(-1) !== finalCommit) {
    fail('NOBJ stream has no terminal COMMIT');
  }
  if (finalCommit.payload.length !== 7) {
    fail('NOBJ COMMIT payload length is not 7');
  }
  const commit = Object.freeze({
    recordCount: u16(finalCommit.payload, 0),
    entryBank: finalCommit.payload[2] ?? 0,
    entryAddress: u16(finalCommit.payload, 3),
    crc16: u16(finalCommit.payload, 5),
  });
  if (commit.recordCount !== records.length) {
    fail('NOBJ COMMIT record count does not match the stream');
  }
  const calculated = nobjCrc16CcittFalse(serialized.slice(0, -2));
  if (calculated !== commit.crc16) fail('NOBJ COMMIT CRC does not match the stream');

  return Object.freeze({
    serialized,
    version,
    records: Object.freeze(records),
    begin,
    images: Object.freeze(images),
    patches: Object.freeze(patches),
    map: finalMap,
    commitRecord: finalCommit,
    commit,
  });
};
