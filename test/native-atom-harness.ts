import {
  assembleResolvedAtomProject,
  materializeAtomGeneration,
  writeAtomD8,
} from 'atom-z80';

// Assemble the canonical ATOM source unchanged. Contract annotations remain
// documentation; executable callback, register and memory checks live in callers.
export const assembleNativeHarness = async (source: string, load: number) => {
  const bytes = new TextEncoder().encode(source);
  const project = {
    parts: [
      {
        ordinal: 0,
        bank: 0,
        logicalIdentity: 'native-proof.asm',
        originalBytes: bytes,
        compilerBytes: bytes,
      },
    ],
  };
  const result = await assembleResolvedAtomProject(project, {
    target: { start: 0, capacity: 0xffff },
    maxInstructions: 100_000_000,
    maxCycles: 1_000_000_000,
  }).catch((cause: { diagnostic?: { line: number }; message: string }) => {
    const line = cause.diagnostic?.line;
    throw new Error(
      `native-proof.asm:${line ?? '?'}: ${cause.message}\n${line === undefined ? '' : source.split('\n')[line - 1]}`,
      { cause },
    );
  });
  const debugMap = writeAtomD8(project, result.generation);
  const symbols: Record<string, number> = Object.fromEntries(
    debugMap.symbols.flatMap(
      (symbol: { name: string; address?: number; value?: number }) => {
        const value = symbol.address ?? symbol.value;
        return value === undefined ? [] : [[symbol.name.toUpperCase(), value]];
      },
    ),
  );
  const materialized = materializeAtomGeneration(result.generation, {
    base: 0,
  });
  for (const name of [
    'IMG_END',
    'STATE',
    'INPUT',
    'CURSOR',
    'LIMIT',
    'ZN_MAT',
  ]) {
    assert.ok(Number.isInteger(symbols[name]), `missing native symbol ${name}`);
  }
  assert.equal(materialized.end, symbols.IMG_END);
  assert.ok(symbols.IMG_END > load);
  assert.equal(materialized.bytes.length, symbols.IMG_END);
  return { bytes: materialized.bytes.slice(load, symbols.IMG_END), symbols };
};
import assert from 'node:assert/strict';
