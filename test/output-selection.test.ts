import { describe, expect, it } from 'vitest';

import {
  selectOutputFormatBySuffix,
  splitPositiveOutputArguments,
  validatePositiveOutputSelections,
} from '../src/index.js';

describe('positive output selection', () => {
  const formats = [
    { format: 'd8' as const, suffix: '.d8.json' },
    { format: 'bin' as const, suffix: '.bin' },
    { format: 'hex' as const, suffix: '.hex' },
    {
      format: 'com' as const,
      suffix: '.com',
      message: 'COM output is not implemented here',
    },
  ];

  it('selects formats by case-insensitive suffix with longest suffix first', () => {
    expect(selectOutputFormatBySuffix('BUILD/PROGRAM.D8.JSON', formats)).toBe(
      'd8',
    );
    expect(selectOutputFormatBySuffix('build/program.BIN', formats)).toBe(
      'bin',
    );
  });

  it('validates positive output paths and rejects ambiguous requests', () => {
    expect(
      validatePositiveOutputSelections({
        filenames: ['build/program.bin', 'build/program.hex'],
        formats,
        baseDirectory: '/tmp/project',
      }),
    ).toEqual([
      { format: 'bin', path: '/tmp/project/build/program.bin' },
      { format: 'hex', path: '/tmp/project/build/program.hex' },
    ]);
    expect(() =>
      validatePositiveOutputSelections({
        filenames: ['build/one.bin', 'build/two.bin'],
        formats,
        baseDirectory: '/tmp/project',
      }),
    ).toThrow('output format is repeated: bin');
    expect(() =>
      validatePositiveOutputSelections({
        filenames: ['build/program.bin', 'build/program.bin'],
        formats,
        baseDirectory: '/tmp/project',
      }),
    ).toThrow('output format is repeated: bin');
    expect(() =>
      validatePositiveOutputSelections({
        filenames: ['build/program.com'],
        formats,
        baseDirectory: '/tmp/project',
      }),
    ).toThrow('COM output is not implemented here');
    expect(() => selectOutputFormatBySuffix('build/program', formats)).toThrow(
      'output path has no recognized format suffix: build/program',
    );
  });

  it('splits the common positive-output CLI shape', () => {
    expect(
      splitPositiveOutputArguments({
        positionals: ['src/main.asm', 'build/main.bin', 'build/main.hex'],
      }),
    ).toEqual({
      input: 'src/main.asm',
      outputPaths: ['build/main.bin', 'build/main.hex'],
      output: 'build/main.bin',
    });
    expect(
      splitPositiveOutputArguments({
        positionals: ['src/main.asm', 'build/main.hex'],
        optionOutputs: ['build/main.bin'],
      }),
    ).toEqual({
      input: 'src/main.asm',
      outputPaths: ['build/main.bin', 'build/main.hex'],
      output: 'build/main.bin',
    });
    expect(splitPositiveOutputArguments({ positionals: [] })).toEqual({
      input: undefined,
      outputPaths: [],
      output: undefined,
    });
  });
});
