/**
 * Runtime validation for the host-neutral portable conformance record.
 *
 * The record is deliberately a JSON-shaped object rather than a CPU or
 * service ABI.  Providers can retain profile-owned observations, but the
 * identity and provenance fields must be stable before a record is used as
 * release evidence.
 */

export const PORTABLE_CONFORMANCE_SCHEMA =
  'z80-portable-conformance-v1' as const;

export interface PortableConformanceSource {
  readonly logicalIdentity: string;
  readonly sha256: string;
}

export interface PortableConformanceArtifact {
  readonly kind: string;
  readonly base: number;
  readonly end: number;
  readonly bytes: readonly number[];
  readonly sha256: string;
}

export interface PortableConformanceProvenance {
  readonly executionSubstrate: string;
  readonly compatibleHosts: readonly string[];
  readonly [key: string]: unknown;
}

export interface PortableConformanceRecord {
  readonly schema: typeof PORTABLE_CONFORMANCE_SCHEMA;
  readonly profile: string;
  readonly source: PortableConformanceSource | null;
  readonly artifact: PortableConformanceArtifact;
  readonly diagnostic: Record<string, unknown> | null;
  readonly execution: Record<string, unknown> & { readonly status: string };
  readonly provenance: PortableConformanceProvenance;
}

export class PortableConformanceError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`portable conformance record ${path}: ${message}`);
    this.name = 'PortableConformanceError';
    this.path = path;
  }
}

/** Raised when independently produced records do not describe the same proof. */
export class PortableConformanceParityError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`portable conformance parity ${path}: ${message}`);
    this.name = 'PortableConformanceParityError';
    this.path = path;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fail = (path: string, message: string): never => {
  throw new PortableConformanceError(path, message);
};

const failParity = (path: string, message: string): never => {
  throw new PortableConformanceParityError(path, message);
};

/**
 * Produce a deterministic JSON value for profile-owned diagnostic fields.
 * Host observations are deliberately not included in the parity projection,
 * but diagnostics may contain nested objects whose insertion order differs
 * between providers.
 */
const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
};

const parityProjection = (record: PortableConformanceRecord): unknown => ({
  schema: record.schema,
  profile: record.profile,
  source: record.source,
  artifact: record.artifact,
  diagnostic: stableValue(record.diagnostic),
  executionStatus: record.execution.status,
});

const requiredString = (
  value: Record<string, unknown>,
  key: string,
): string => {
  const candidate = value[key];
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return fail(key, 'must be a non-empty string');
  }
  return candidate;
};

const sha256 = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
    return fail(path, 'must be a 64-character hexadecimal SHA-256 digest');
  }
  return value;
};

const logicalIdentity = (value: string, path: string): string => {
  if (
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes('\\')
  ) {
    return fail(path, 'must be a stable logical identity, not a host path');
  }
  return value;
};

const finiteInteger = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return fail(path, 'must be a safe integer');
  }
  return value;
};

const validateSource = (value: unknown): PortableConformanceSource | null => {
  if (value === null) return null;
  if (!isRecord(value)) return fail('source', 'must be an object or null');
  return {
    logicalIdentity: logicalIdentity(
      requiredString(value, 'logicalIdentity'),
      'source.logicalIdentity',
    ),
    sha256: sha256(value.sha256, 'source.sha256'),
  };
};

const validateArtifact = (value: unknown): PortableConformanceArtifact => {
  if (!isRecord(value)) return fail('artifact', 'must be an object');
  const base = finiteInteger(value.base, 'artifact.base');
  const end = finiteInteger(value.end, 'artifact.end');
  if (base < 0 || base > 0x10000 || end < 0 || end > 0x10000 || end < base) {
    fail(
      'artifact',
      'base and end must be ordered addresses in the 16-bit space',
    );
  }
  if (!Array.isArray(value.bytes))
    return fail('artifact.bytes', 'must be an array');
  const bytes = value.bytes.map((byte: unknown, index: number) => {
    const checked = finiteInteger(byte, `artifact.bytes[${index}]`);
    if (checked < 0 || checked > 0xff) {
      fail(`artifact.bytes[${index}]`, 'must be an octet');
    }
    return checked;
  });
  if (end - base !== bytes.length) {
    fail('artifact', 'end must equal base plus the byte count');
  }
  return {
    kind: requiredString(value, 'kind'),
    base,
    end,
    bytes,
    sha256: sha256(value.sha256, 'artifact.sha256'),
  };
};

const validateDiagnostic = (value: unknown): Record<string, unknown> | null => {
  if (value === null) return null;
  if (!isRecord(value)) return fail('diagnostic', 'must be an object or null');
  const identity = value.logicalIdentity;
  if (identity !== undefined) {
    if (typeof identity !== 'string' || identity.length === 0) {
      return fail(
        'diagnostic.logicalIdentity',
        'must be a non-empty string when present',
      );
    }
    logicalIdentity(identity, 'diagnostic.logicalIdentity');
  }
  return value;
};

const validateExecution = (
  value: unknown,
): Record<string, unknown> & { readonly status: string } => {
  if (!isRecord(value)) return fail('execution', 'must be an object');
  return { ...value, status: requiredString(value, 'status') };
};

const validateProvenance = (value: unknown): PortableConformanceProvenance => {
  if (!isRecord(value)) return fail('provenance', 'must be an object');
  const hosts = value.compatibleHosts;
  if (!Array.isArray(hosts) || hosts.length === 0) {
    return fail(
      'provenance.compatibleHosts',
      'must contain at least one host label',
    );
  }
  const compatibleHosts = hosts.map((host: unknown, index: number) => {
    if (typeof host !== 'string' || host.length === 0) {
      return fail(
        `provenance.compatibleHosts[${index}]`,
        'must be a non-empty string',
      );
    }
    return host;
  });
  if (new Set(compatibleHosts).size !== compatibleHosts.length) {
    fail(
      'provenance.compatibleHosts',
      'must not contain duplicate host labels',
    );
  }
  return {
    ...value,
    executionSubstrate: requiredString(value, 'executionSubstrate'),
    compatibleHosts,
  };
};

/** Validate and narrow an untrusted JSON value to the v1 record shape. */
export const validatePortableConformanceRecord = (
  value: unknown,
): PortableConformanceRecord => {
  if (!isRecord(value)) return fail('$', 'must be a JSON object');
  if (value.schema !== PORTABLE_CONFORMANCE_SCHEMA) {
    fail('schema', `must equal ${PORTABLE_CONFORMANCE_SCHEMA}`);
  }
  return {
    schema: PORTABLE_CONFORMANCE_SCHEMA,
    profile: requiredString(value, 'profile'),
    source: validateSource(value.source),
    artifact: validateArtifact(value.artifact),
    diagnostic: validateDiagnostic(value.diagnostic),
    execution: validateExecution(value.execution),
    provenance: validateProvenance(value.provenance),
  };
};

/**
 * Check that two or more host records describe one portable proof.
 *
 * Execution counters, CPU snapshots, substrate names and other provider-owned
 * observations are intentionally ignored. Source identity, generated bytes,
 * diagnostics and the public stop status must agree. This lets native/WASM,
 * Node/Deno and future providers prove the same result without pretending that
 * their internal measurements are identical.
 */
export const assertPortableConformanceParity = (
  values: readonly unknown[],
): readonly PortableConformanceRecord[] => {
  if (values.length < 2) {
    return failParity('records', 'must contain at least two host records');
  }
  const records = values.map((value, index) => {
    try {
      return validatePortableConformanceRecord(value);
    } catch (error) {
      if (error instanceof PortableConformanceError) {
        failParity(`records[${index}].${error.path}`, error.message);
      }
      throw error;
    }
  });
  const baseline = records[0];
  if (!baseline) return failParity('records', 'must contain a baseline record');
  const expected = JSON.stringify(parityProjection(baseline));
  records.slice(1).forEach((record, offset) => {
    const actual = JSON.stringify(parityProjection(record));
    if (actual !== expected) {
      failParity(
        `records[${offset + 1}]`,
        'does not match records[0] on source, artifact, diagnostics or status',
      );
    }
  });
  return records;
};
