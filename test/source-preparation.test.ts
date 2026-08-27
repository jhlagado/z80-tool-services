import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createNodeSourceReader,
  resolveSourceProject,
  SourcePreparationError,
  type SourceProfile,
} from '../source-preparation/index.mjs';

const profile: SourceProfile<undefined, undefined> = {
  inspectEntry(snapshot) {
    return {
      state: undefined,
      compilerBytes: snapshot.originalBytes,
      dependencies: [{ specifier: 'lib.asm', location: { line: 1 } }],
      maskedRanges: [],
    };
  },
  inspectDependency(snapshot) {
    return {
      compilerBytes: snapshot.originalBytes,
      dependencies: [],
      maskedRanges: [],
    };
  },
};

describe('shared source preparation', () => {
  it('confines reads and orders dependencies before their importer', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'z80-source-preparation-'));
    try {
      await writeFile(path.join(root, 'main.asm'), 'MAIN\n');
      await writeFile(path.join(root, 'lib.asm'), 'LIB\n');
      const reader = await createNodeSourceReader(root);
      const project = await resolveSourceProject({
        reader,
        entry: 'main.asm',
        profile,
        configuration: undefined,
      });
      expect(project.parts.map((part) => part.logicalIdentity)).toEqual([
        'lib.asm',
        'main.asm',
      ]);
      expect(project.bankArray).toEqual([0, 0]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains structured errors on the shared public surface', () => {
    const error = new SourcePreparationError(
      'dependency',
      'missing-source',
      'cannot read source',
      { line: 3 },
    );
    expect(error).toMatchObject({
      name: 'SourcePreparationError',
      category: 'dependency',
      code: 'missing-source',
      location: { line: 3 },
    });
    expect(Object.isFrozen(error.location)).toBe(true);
  });
});
