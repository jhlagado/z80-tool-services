import { describe, expect, it } from 'vitest';

import {
  dispatchZ80AssemblerFlavour,
  normalizeZ80AssemblerFlavour,
  selectConcreteZ80AssemblerFlavour,
  Z80_ASSEMBLER_FLAVOUR,
  z80AssemblerFlavours,
} from '../src/index.js';

describe('Z80 assembler flavour selection', () => {
  it('normalizes explicit assembler names and aliases', () => {
    expect(normalizeZ80AssemblerFlavour('atom')).toBe('atom');
    expect(normalizeZ80AssemblerFlavour('ATOM-Z80')).toBe('atom');
    expect(normalizeZ80AssemblerFlavour('azm')).toBe('azm');
    expect(normalizeZ80AssemblerFlavour('ASM80')).toBe('azm');
    expect(normalizeZ80AssemblerFlavour('auto')).toBe('auto');
    expect(z80AssemblerFlavours).toEqual(['atom', 'azm', 'auto']);
    expect(Z80_ASSEMBLER_FLAVOUR).toEqual({
      atom: 'atom',
      azm: 'azm',
      auto: 'auto',
    });
  });

  it('defaults to auto unless a caller supplies a narrower default', () => {
    expect(normalizeZ80AssemblerFlavour(undefined)).toBe('auto');
    expect(normalizeZ80AssemblerFlavour(null)).toBe('auto');
    expect(
      normalizeZ80AssemblerFlavour(undefined, {
        defaultFlavour: Z80_ASSEMBLER_FLAVOUR.atom,
      }),
    ).toBe('atom');
  });

  it('lets callers disable auto when a concrete assembler is required', () => {
    expect(normalizeZ80AssemblerFlavour('atom', { allowAuto: false })).toBe(
      'atom',
    );
    expect(() =>
      normalizeZ80AssemblerFlavour('auto', { allowAuto: false }),
    ).toThrow('assembler flavour must be atom or azm');
  });

  it('selects a concrete assembler without using the source extension', () => {
    expect(
      selectConcreteZ80AssemblerFlavour({
        requested: 'ATOM-Z80',
        sourcePath: 'src/main.asm',
      }),
    ).toBe('atom');
    expect(
      selectConcreteZ80AssemblerFlavour({
        requested: 'ASM80',
        sourcePath: 'src/main.asm',
      }),
    ).toBe('azm');
    expect(
      selectConcreteZ80AssemblerFlavour({
        defaultFlavour: Z80_ASSEMBLER_FLAVOUR.atom,
        sourcePath: 'src/main.asm',
      }),
    ).toBe('atom');
    expect(() =>
      selectConcreteZ80AssemblerFlavour({ sourcePath: 'src/main.asm' }),
    ).toThrow(
      'src/main.asm does not select an assembler from its filename; set assembler to atom or azm',
    );
    expect(() =>
      selectConcreteZ80AssemblerFlavour({
        requested: 'auto',
        sourcePath: 'src/main.asm',
      }),
    ).toThrow(
      'src/main.asm does not select an assembler from its filename; set assembler to atom or azm',
    );
  });

  it('dispatches a source to the selected concrete assembler handler', () => {
    const calls: string[] = [];
    const handlers = {
      atom: (flavour: 'atom' | 'azm') => {
        calls.push(`atom:${flavour}`);
        return 'assembled-by-atom';
      },
      azm: (flavour: 'atom' | 'azm') => {
        calls.push(`azm:${flavour}`);
        return 'assembled-by-azm';
      },
    };

    expect(
      dispatchZ80AssemblerFlavour({
        requested: 'atom-z80',
        sourcePath: 'src/main.asm',
        handlers,
      }),
    ).toBe('assembled-by-atom');
    expect(calls).toEqual(['atom:atom']);

    expect(
      dispatchZ80AssemblerFlavour({
        requested: 'asm80',
        sourcePath: 'src/main.asm',
        handlers,
      }),
    ).toBe('assembled-by-azm');
    expect(calls).toEqual(['atom:atom', 'azm:azm']);
  });

  it('keeps neutral callers from routing .asm by filename alone', () => {
    expect(() =>
      dispatchZ80AssemblerFlavour({
        sourcePath: 'src/main.asm',
        handlers: {
          atom: () => 'atom',
          azm: () => 'azm',
        },
      }),
    ).toThrow(
      'src/main.asm does not select an assembler from its filename; set assembler to atom or azm',
    );
  });

  it('rejects invalid values at the host boundary', () => {
    expect(() => normalizeZ80AssemblerFlavour('')).toThrow(
      'assembler flavour must be atom, azm, or auto',
    );
    expect(() => normalizeZ80AssemblerFlavour('zasm')).toThrow(
      'assembler flavour must be atom, azm, or auto',
    );
    expect(() => normalizeZ80AssemblerFlavour(1)).toThrow(
      'assembler flavour must be atom, azm, or auto',
    );
    expect(() =>
      normalizeZ80AssemblerFlavour(undefined, {
        // @ts-expect-error Deliberately invalid runtime input.
        defaultFlavour: 'native',
      }),
    ).toThrow('default assembler flavour is invalid');
    expect(() =>
      selectConcreteZ80AssemblerFlavour({
        // @ts-expect-error Deliberately invalid runtime input.
        defaultFlavour: 'auto',
      }),
    ).toThrow('default assembler flavour is invalid');
    expect(() =>
      dispatchZ80AssemblerFlavour({
        requested: 'atom',
        sourcePath: 'src/main.asm',
        handlers: {
          // @ts-expect-error Deliberately invalid runtime input.
          atom: undefined,
          azm: () => 'azm',
        },
      }),
    ).toThrow('assembler handler for atom is unavailable');
  });
});
