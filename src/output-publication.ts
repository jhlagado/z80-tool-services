import * as nodeFilesystem from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export interface OutputFilePublication {
  readonly path: string;
  readonly bytes: Uint8Array | string;
}

export interface OutputPublicationFilesystem {
  readonly access: (target: string) => Promise<unknown>;
  readonly mkdir: (
    target: string,
    options?: { readonly recursive?: boolean },
  ) => Promise<unknown>;
  readonly open: (
    target: string,
    flags: string,
  ) => Promise<{
    readonly writeFile: (bytes: Uint8Array | string) => Promise<unknown>;
    readonly sync: () => Promise<unknown>;
    readonly close: () => Promise<unknown>;
  }>;
  readonly rename: (source: string, target: string) => Promise<unknown>;
  readonly rm: (
    target: string,
    options?: { readonly force?: boolean },
  ) => Promise<unknown>;
}

export interface PublishOutputFilesOptions {
  readonly filesystem?: OutputPublicationFilesystem;
  readonly tagPrefix?: string;
}

export class OutputPublicationError extends Error {
  readonly code: string;

  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'OutputPublicationError';
    this.code = code;
    Object.freeze(this);
  }
}

let transactionOrdinal = 0;

const pathKey = (target: string): string =>
  process.platform === 'win32' ? target.toLowerCase() : target;

const bytesOf = (value: Uint8Array | string): Uint8Array | string => {
  if (value instanceof Uint8Array || typeof value === 'string') return value;
  throw new OutputPublicationError(
    'artifact-value',
    'artifact content must be bytes or text',
  );
};

const exists = async (
  filesystem: OutputPublicationFilesystem,
  target: string,
): Promise<boolean> => {
  try {
    await filesystem.access(target);
    return true;
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }
};

export async function publishOutputFiles(
  outputs: readonly OutputFilePublication[],
  {
    filesystem = nodeFilesystem,
    tagPrefix = 'z80-tool',
  }: PublishOutputFilesOptions = {},
): Promise<readonly string[]> {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new OutputPublicationError(
      'empty-output',
      'at least one output file is required',
    );
  }
  transactionOrdinal += 1;
  const tag = `.${tagPrefix}-${process.pid}-${transactionOrdinal}`;
  const seen = new Set<string>();
  const entries = outputs.map((output) => {
    const target = path.resolve(output.path);
    const key = pathKey(target);
    if (seen.has(key)) {
      throw new OutputPublicationError(
        'duplicate-output',
        `output path is repeated: ${output.path}`,
      );
    }
    seen.add(key);
    return {
      target,
      directory: path.dirname(target),
      temporary: `${target}${tag}.tmp`,
      backup: `${target}${tag}.bak`,
      bytes: bytesOf(output.bytes),
      backedUp: false,
      published: false,
    };
  });

  try {
    for (const entry of entries) {
      await filesystem.mkdir(entry.directory, { recursive: true });
      const handle = await filesystem.open(entry.temporary, 'wx');
      try {
        await handle.writeFile(entry.bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    for (const entry of entries) {
      if (await exists(filesystem, entry.target)) {
        await filesystem.rename(entry.target, entry.backup);
        entry.backedUp = true;
      }
    }
    for (const entry of entries) {
      await filesystem.rename(entry.temporary, entry.target);
      entry.published = true;
    }
    for (const entry of entries) {
      if (entry.backedUp) await filesystem.rm(entry.backup, { force: true });
    }
  } catch (cause) {
    for (const entry of [...entries].reverse()) {
      try {
        if (entry.published) await filesystem.rm(entry.target, { force: true });
        if (entry.backedUp) await filesystem.rename(entry.backup, entry.target);
        await filesystem.rm(entry.temporary, { force: true });
      } catch {
        /* Preserve the first failure. */
      }
    }
    throw new OutputPublicationError(
      'output-transaction',
      'cannot publish the requested outputs',
      cause,
    );
  }

  return Object.freeze(entries.map(({ target }) => target));
}
