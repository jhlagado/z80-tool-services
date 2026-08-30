import { createHash } from 'node:crypto';
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
  readonly readFile: (
    target: string,
    encoding?: BufferEncoding,
  ) => Promise<Buffer | string>;
  readonly rm: (
    target: string,
    options?: { readonly force?: boolean; readonly recursive?: boolean },
  ) => Promise<unknown>;
  readonly symlink: (
    target: string,
    path: string,
    type?: 'dir' | 'file' | 'junction',
  ) => Promise<unknown>;
  readonly unlink: (target: string) => Promise<unknown>;
}

export interface PublishOutputFilesOptions {
  readonly filesystem?: OutputPublicationFilesystem;
  readonly tagPrefix?: string;
}

export interface ArtifactGenerationFile {
  readonly name: string;
  readonly bytes: Uint8Array | string;
}

export interface ArtifactGenerationSummary {
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ArtifactGenerationManifest {
  readonly name: string;
  readonly bytes: Uint8Array | string;
}

export interface PublishArtifactGenerationOptions {
  readonly filesystem?: OutputPublicationFilesystem;
  readonly tagPrefix?: string;
  readonly currentName?: string;
  readonly manifest?: (
    generation: string,
    artifacts: readonly ArtifactGenerationSummary[],
  ) => ArtifactGenerationManifest;
  readonly verifyManifest?: (
    generation: string,
    manifest: unknown,
  ) => boolean;
}

export interface PublishedArtifactGeneration {
  readonly bundle: string;
  readonly generation: string;
  readonly generationDirectory: string;
  readonly current: string;
  readonly paths: ReadonlyMap<string, string>;
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

const byteArrayOf = (value: Uint8Array | string): Uint8Array =>
  value instanceof Uint8Array ? value : new TextEncoder().encode(value);

const validateArtifactName = (name: string): void => {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new OutputPublicationError(
      'artifact-name',
      'artifact name must be a portable filename',
    );
  }
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

const syncDirectory = async (
  filesystem: OutputPublicationFilesystem,
  directory: string,
): Promise<void> => {
  const handle = await filesystem.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
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

const generationDigest = (
  files: readonly { readonly name: string; readonly bytes: Uint8Array }[],
): string => {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.name, 'utf8');
    hash.update(Uint8Array.from([0]));
    hash.update(file.bytes);
  }
  return hash.digest('hex');
};

const verifyArtifactGeneration = async (
  filesystem: OutputPublicationFilesystem,
  generationDirectory: string,
  files: readonly { readonly name: string; readonly bytes: Uint8Array }[],
  manifestFile: ArtifactGenerationManifest | undefined,
  digest: string,
  verifyManifest: PublishArtifactGenerationOptions['verifyManifest'],
): Promise<void> => {
  try {
    for (const file of files) {
      const read = await filesystem.readFile(
        path.join(generationDirectory, file.name),
      );
      const actual =
        typeof read === 'string' ? new TextEncoder().encode(read) : read;
      if (
        actual.length !== file.bytes.length ||
        actual.some((byte, index) => byte !== file.bytes[index])
      ) {
        throw new OutputPublicationError(
          'generation-conflict',
          `existing artifact generation ${digest} has different bytes`,
        );
      }
    }
    if (manifestFile !== undefined) {
      const manifestPath = path.join(generationDirectory, manifestFile.name);
      const manifest = JSON.parse(
        await filesystem.readFile(manifestPath, 'utf8') as string,
      ) as unknown;
      if (verifyManifest !== undefined && !verifyManifest(digest, manifest)) {
        throw new OutputPublicationError(
          'generation-conflict',
          `existing artifact generation ${digest} has an invalid manifest`,
        );
      }
    }
  } catch (cause) {
    if (cause instanceof OutputPublicationError) throw cause;
    throw new OutputPublicationError(
      'generation-conflict',
      `existing artifact generation ${digest} cannot be verified`,
      cause,
    );
  }
};

export async function publishArtifactGeneration(
  destination: string,
  files: readonly ArtifactGenerationFile[],
  {
    filesystem = nodeFilesystem,
    tagPrefix = 'z80-tool',
    currentName = 'current',
    manifest,
    verifyManifest,
  }: PublishArtifactGenerationOptions = {},
): Promise<PublishedArtifactGeneration> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new OutputPublicationError(
      'empty-output',
      'at least one artifact file is required',
    );
  }
  validateArtifactName(currentName);
  const materialized = files.map((file) => {
    validateArtifactName(file.name);
    return {
      name: file.name,
      bytes: byteArrayOf(bytesOf(file.bytes)),
    };
  });
  const seen = new Set<string>();
  for (const file of materialized) {
    const key = pathKey(file.name);
    if (seen.has(key)) {
      throw new OutputPublicationError(
        'duplicate-output',
        `artifact name is repeated: ${file.name}`,
      );
    }
    seen.add(key);
  }

  const digest = generationDigest(materialized);
  const summaries = materialized.map((file) => Object.freeze({
    name: file.name,
    bytes: file.bytes.length,
    sha256: createHash('sha256').update(file.bytes).digest('hex'),
  }));
  const manifestFile = manifest?.(digest, summaries);
  if (manifestFile !== undefined) {
    validateArtifactName(manifestFile.name);
    if (seen.has(pathKey(manifestFile.name))) {
      throw new OutputPublicationError(
        'duplicate-output',
        `artifact name is repeated: ${manifestFile.name}`,
      );
    }
  }
  const manifestBytes =
    manifestFile === undefined
      ? undefined
      : byteArrayOf(bytesOf(manifestFile.bytes));
  const bundle = path.resolve(destination);
  const generations = path.join(bundle, 'generations');
  const generationDirectory = path.join(generations, digest);
  transactionOrdinal += 1;
  const temporary = path.join(
    generations,
    `.${tagPrefix}-${process.pid}-${transactionOrdinal}.tmp`,
  );
  const currentTemporary = path.join(
    bundle,
    `.${currentName}-${tagPrefix}-${process.pid}-${transactionOrdinal}`,
  );
  let ownsTemporary = false;
  let ownsCurrentTemporary = false;

  try {
    await filesystem.mkdir(generations, { recursive: true });
    try {
      await filesystem.mkdir(temporary);
      ownsTemporary = true;
      for (const file of materialized) {
        const handle = await filesystem.open(path.join(temporary, file.name), 'wx');
        try {
          await handle.writeFile(file.bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      if (manifestFile !== undefined && manifestBytes !== undefined) {
        const handle = await filesystem.open(
          path.join(temporary, manifestFile.name),
          'wx',
        );
        try {
          await handle.writeFile(manifestBytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      await syncDirectory(filesystem, temporary);
      try {
        await filesystem.rename(temporary, generationDirectory);
        ownsTemporary = false;
        await syncDirectory(filesystem, generations);
      } catch (error) {
        if (
          error === null ||
          typeof error !== 'object' ||
          !('code' in error) ||
          (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY')
        ) {
          throw error;
        }
        await filesystem.rm(temporary, { recursive: true, force: true });
        ownsTemporary = false;
      }
      await verifyArtifactGeneration(
        filesystem,
        generationDirectory,
        materialized,
        manifestFile,
        digest,
        verifyManifest,
      );
    } catch (cause) {
      if (cause instanceof OutputPublicationError) throw cause;
      throw new OutputPublicationError(
        'generation-write',
        'cannot stage the artifact generation',
        cause,
      );
    }

    try {
      await filesystem.symlink(
        path.join('generations', digest),
        currentTemporary,
        'dir',
      );
      ownsCurrentTemporary = true;
      await filesystem.rename(currentTemporary, path.join(bundle, currentName));
      ownsCurrentTemporary = false;
      await syncDirectory(filesystem, bundle);
    } catch (cause) {
      throw new OutputPublicationError(
        'generation-publish',
        'cannot atomically select the artifact generation',
        cause,
      );
    }
  } catch (error) {
    if (ownsCurrentTemporary) {
      try {
        await filesystem.unlink(currentTemporary);
      } catch {
        /* Preserve the first failure. */
      }
    }
    if (ownsTemporary) {
      try {
        await filesystem.rm(temporary, { recursive: true, force: true });
      } catch {
        /* Preserve the first failure. */
      }
    }
    throw error;
  }

  const current = path.join(bundle, currentName);
  return Object.freeze({
    bundle,
    generation: digest,
    generationDirectory,
    current,
    paths: new Map([
      ...materialized.map((file) => [file.name, path.join(current, file.name)] as const),
      ...(manifestFile === undefined
        ? []
        : [[manifestFile.name, path.join(current, manifestFile.name)] as const]),
    ]),
  });
}
