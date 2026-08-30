import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  OutputPublicationError,
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
