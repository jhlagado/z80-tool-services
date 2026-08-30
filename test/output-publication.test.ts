import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  OutputPublicationError,
  publishArtifactGeneration,
  publishOutputFiles,
} from '../src/output-publication.js';

describe('positive output publication', () => {
  it('stages every file and rolls back a failed replacement', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'z80-output-'));
    try {
      const binary = path.join(directory, 'program.bin');
      const listing = path.join(directory, 'program.lst');
      await publishOutputFiles([
        { path: binary, bytes: Uint8Array.of(1) },
        { path: listing, bytes: 'first\n' },
      ]);
      expect(await readFile(binary)).toEqual(Buffer.from([1]));
      expect(await readFile(listing, 'utf8')).toBe('first\n');

      const injected = {
        ...fs,
        async rename(source: string, target: string) {
          if (source.endsWith('.tmp') && target === listing) {
            throw Object.assign(new Error('injected'), { code: 'EIO' });
          }
          return fs.rename(source, target);
        },
      };

      await expect(publishOutputFiles([
        { path: binary, bytes: Uint8Array.of(2) },
        { path: listing, bytes: 'second\n' },
      ], { filesystem: injected })).rejects.toMatchObject({
        code: 'output-transaction',
      });
      expect(await readFile(binary)).toEqual(Buffer.from([1]));
      expect(await readFile(listing, 'utf8')).toBe('first\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects empty and duplicate output selections', async () => {
    await expect(publishOutputFiles([])).rejects.toBeInstanceOf(
      OutputPublicationError,
    );
    await expect(publishOutputFiles([
      { path: 'build/program.bin', bytes: Uint8Array.of(1) },
      { path: 'build/program.bin', bytes: Uint8Array.of(2) },
    ])).rejects.toMatchObject({ code: 'duplicate-output' });
  });
});

describe('content-addressed artifact generation publication', () => {
  it('selects one immutable generation and preserves current on pointer failure', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'z80-generation-'));
    try {
      const destination = path.join(directory, 'program.tool');
      const first = await publishArtifactGeneration(
        destination,
        [{ name: 'program.bin', bytes: Uint8Array.of(1) }],
        {
          tagPrefix: 'test',
          manifest: (generation, artifacts) => ({
            name: 'manifest.json',
            bytes: `${JSON.stringify({
              format: 'test-artifact-set',
              generation,
              artifacts,
            })}\n`,
          }),
          verifyManifest: (generation, manifest) =>
            typeof manifest === 'object' &&
            manifest !== null &&
            'format' in manifest &&
            manifest.format === 'test-artifact-set' &&
            'generation' in manifest &&
            manifest.generation === generation,
        },
      );
      expect(await readFile(path.join(first.current, 'program.bin'))).toEqual(
        Buffer.from([1]),
      );

      const injected = {
        ...fs,
        async rename(source: string, target: string) {
          if (path.basename(source).startsWith('.current-')) {
            throw Object.assign(new Error('injected'), { code: 'EIO' });
          }
          return fs.rename(source, target);
        },
      };
      await expect(publishArtifactGeneration(
        destination,
        [{ name: 'program.bin', bytes: Uint8Array.of(2) }],
        { filesystem: injected, tagPrefix: 'test' },
      )).rejects.toMatchObject({ code: 'generation-publish' });
      expect(await readFile(path.join(first.current, 'program.bin'))).toEqual(
        Buffer.from([1]),
      );
      expect(
        (await fs.readdir(destination)).filter((name) =>
          name.startsWith('.current-')
        ),
      ).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects conflicting existing generations and duplicate artifact names', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'z80-generation-conflict-'));
    try {
      const destination = path.join(directory, 'program.tool');
      const published = await publishArtifactGeneration(destination, [
        { name: 'program.bin', bytes: Uint8Array.of(1) },
      ]);
      await fs.writeFile(
        path.join(published.generationDirectory, 'program.bin'),
        Buffer.from([9]),
      );
      await expect(publishArtifactGeneration(destination, [
        { name: 'program.bin', bytes: Uint8Array.of(1) },
      ])).rejects.toMatchObject({ code: 'generation-conflict' });

      await expect(publishArtifactGeneration(destination, [
        { name: 'program.bin', bytes: Uint8Array.of(1) },
        { name: 'program.bin', bytes: Uint8Array.of(2) },
      ])).rejects.toMatchObject({ code: 'duplicate-output' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
