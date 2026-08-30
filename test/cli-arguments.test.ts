import { describe, expect, it } from 'vitest';

import { readCliOptionValue } from '../src/index.js';

describe('CLI argument helpers', () => {
  it('reads the following option value and reports the caller-owned value name', () => {
    expect(readCliOptionValue(['--root', 'src'], 0, '--root')).toBe('src');
    expect(() => readCliOptionValue(['--root'], 0, '--root')).toThrow(
      '--root requires a value',
    );
    expect(() =>
      readCliOptionValue(['--output'], 0, '--output', 'file'),
    ).toThrow('--output requires a file');
  });
});
