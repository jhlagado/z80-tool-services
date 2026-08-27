import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

function run(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status, signal) =>
      resolve({ status, signal, stdout, stderr }),
    );
  });
}

const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), 'z80-tool-services-package-'),
);

try {
  const packageDirectory = path.join(temporary, 'package');
  const installDirectory = path.join(temporary, 'install');
  await fs.mkdir(packageDirectory);

  const packed = await run(
    'npm',
    ['pack', '--pack-destination', packageDirectory, '--json'],
    { cwd: process.cwd() },
  );
  assert.equal(packed.status, 0, packed.stderr);
  const [census] = JSON.parse(packed.stdout);
  assert.equal(census.name, '@jhlagado/z80-tool-services');
  assert.equal(census.version, '0.1.0');
  assert.ok(census.files.some(({ path }) => path === 'dist/index.js'));
  assert.ok(
    census.files.some(({ path }) => path === 'source-preparation/index.mjs'),
  );
  assert.ok(
    census.files.some(({ path }) => path === 'source-preparation/index.d.mts'),
  );
  assert.ok(
    census.files.some(
      ({ path }) => path === 'native/z80-tool-services-v1.asmi',
    ),
  );
  assert.equal(
    census.files.some(({ path }) => /^atom(?:\/|$)/i.test(path)),
    false,
  );
  assert.equal(
    census.files.some(({ path }) => /^nucleus(?:\/|$)/i.test(path)),
    false,
  );

  const archive = path.join(packageDirectory, census.filename);
  const installed = await run(
    'npm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--prefix',
      installDirectory,
      archive,
    ],
    { cwd: temporary },
  );
  assert.equal(installed.status, 0, installed.stderr);

  const probe = await run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      [
        "const api = await import('@jhlagado/z80-tool-services');",
        "const prep = await import('@jhlagado/z80-tool-services/source-preparation');",
        "const { readFile } = await import('node:fs/promises');",
        "const nativeUrl = import.meta.resolve('@jhlagado/z80-tool-services/native/z80-tool-services-v1.asmi');",
        "const native = await readFile(new URL(nativeUrl), 'utf8');",
        "if (typeof api.MemoryNamedObjectProvider !== 'function') throw new Error('main API missing provider');",
        "if (typeof api.runNamedObjectConformance !== 'function') throw new Error('main API missing conformance');",
        "if (typeof prep.resolveSourceProject !== 'function') throw new Error('source preparation resolver missing');",
        "if (typeof prep.createNodeSourceReader !== 'function') throw new Error('source preparation reader missing');",
        "if (!native.includes('ZT_ABI EQU 1')) throw new Error('native ABI include missing version');",
      ].join('\n'),
    ],
    { cwd: installDirectory },
  );
  assert.equal(probe.status, 0, probe.stderr);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
