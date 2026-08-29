import { describe, expect, it } from 'vitest';

import {
  normalizeZ80AssemblerFlavour,
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
    expect(
      normalizeZ80AssemblerFlavour('atom', { allowAuto: false }),
    ).toBe('atom');
    expect(() =>
      normalizeZ80AssemblerFlavour('auto', { allowAuto: false }),
    ).toThrow('assembler flavour must be atom or azm');
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
  });
});
