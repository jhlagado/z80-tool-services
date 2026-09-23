# Stage 1 behaviour inventory

**Status:** first portable predicate complete; broader behaviour inventory remains open

**Date:** 2026-09-24

**Scope:** WASM and macOS-native Triptych targets. ESP32 is deliberately
deferred and does not appear in the acceptance gates below.

This is the first execution record for the portable Z80 platform roadmap in
[`../architecture/portable-z80-platform-v1.md`](../architecture/portable-z80-platform-v1.md).
It records what is already proved, where the current host seams are, and the
smallest next implementation predicate. It is not a claim that the whole
platform migration is complete.

## Current contract inventory

| Area                          | Current authority                             | Current evidence                                                                                                                      | Remaining Stage 1 work                                                                                          |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Z80 execution for Triptych    | Triptych `cpu-v0.1` machine profile           | Rust workspace tests, WASM host proof and a normalized portable record                                                                | Qualify more than the first CPU predicate and compare the guest-level profiles                                  |
| Running-program byte services | `z80-services` `byteGateway/0`                | Deno verification passes memory and I/O-port providers plus the ATOM client against shared vectors; Nucleus projection is now checked | Execute the projection through a Nucleus-generated program without changing the byte meanings                   |
| Compiler/build services       | `z80-tool-services` package                   | Source preparation, generation lifecycle, NOBJ and publication tests; authority specs are now local                                   | Qualify a second consumer without introducing a duplicate authority                                             |
| Atom bare host                | Atom host adapter plus pinned Debug80 Runtime | 153 Atom host tests plus the checked-in portable record                                                                               | Add an independent execution substrate; Node and Deno remain reference-host checks                              |
| `ATOM.COM` under CP/M         | Atom CP/M profile                             | Triptych WASM proof includes Atom compile and generated-program runs                                                                  | Compare the bare-host result with the CP/M profile; do not collapse the two profiles                            |
| Nucleus and Edit              | Their own language/editor profiles            | Nucleus has 150 tests; its compiler host now accepts an explicit execution adapter; Triptych proof exercises compile/edit flows; Nucleus still has a documented AZM legacy build exception    | Inventory exact inputs/outputs and qualify the shared byte-gateway projection before changing the compiler path |
| Skate                         | Skate-owned compiler and effect protocol      | Repository has Deno tooling and CP/M proofs                                                                                           | Separate compiler transport from generated-program effects in a later stage                                     |

## Baseline evidence

The following checks were run from clean process invocations on 2026-09-24.
They are deliberately recorded as commands, rather than as an unrepeatable
test count copied from a console.

### Shared compiler/build services

```text
cd /Users/johnhardy/projects/z80-tool-services
npm test
```

Result: **119 tests passed in 17 files** after temporarily linking the checked-
out Atom package into `node_modules/atom-z80` for the two native-consumer test
suites. Without that local development link, the package build still succeeds
but those suites stop at `Cannot find package 'atom-z80'`. The link is a local
test setup detail, not a repository change and is removed after the run.

The package currently builds its TypeScript distribution and generated native
ABI. The two formerly external normative documents now live under this
repository; Debug80 retains historical copies while consumer links and pins
are migrated. No new contract is being introduced to address that seam.

### Shared running-program services

```text
cd /Users/johnhardy/projects/z80-services
deno task verify
```

Result: **22 tests passed**. The run checks the language-neutral byte-gateway
vectors through the memory provider, the I/O-port provider and the native ATOM
client. It also checks the separate P2 transport and scheduler experiment;
those are not being promoted to the byte-gateway ABI by this report. The
Nucleus compatibility projection is machine-readable and checked against the
shared operation and status constants; the next consumer comparison is an
executed Nucleus-generated program, not another provider transport.

### Atom host

```text
cd /Users/johnhardy/projects/atom
npm run test:host
```

Result: **153 tests passed**. The run exercises source preparation, the native
Atom core, artifact publication, diagnostics, NOBJ generation and the existing
Debug80-backed host. This is the current reference behaviour for the first
portable-host comparison; it is not evidence that Debug80 is a permanent
production dependency. The host now exposes an explicit execution-adapter
seam, with Debug80 isolated to the default development adapter; a replacement
substrate must provide the same memory, CPU-step and Intel-HEX image surface
and pass the same boundary record. The full `npm test` release suite also
passes: **368 tests**. Its dependency guard now pins the tested
`z80-tool-services` 0.2.0 release range rather than rejecting the current
service package as an out-of-range development checkout.

### Nucleus host

```text
cd /Users/johnhardy/projects/nucleus
npm test
```

Result: **150 tests passed in 17 files** on the current compiler-rewrite
branch. This is Nucleus's own language and host baseline, not evidence that it
has adopted the `z80-services` package. Its six byte-stream operations and
status meanings match the shared audit; the next step is an explicit consumer
projection and one executable vector run, while its documented AZM legacy
image-build exception remains isolated.

The compiler host now has an explicit `NucleusExecutionAdapter` boundary. The
default adapter is still the development/reference Debug80 implementation, and
a wrapper adapter is covered by the compiler tests. This is a seam only: it
does not claim that Triptych can execute the compiler image yet, and it does
not remove the active AZM compiler-image build path. Stage 2 remains
responsible for that migration and the native/WASM parity proof.

There is also a completed ATOM-native Nucleus line in the repository history.
The local `atom-source-native` branch, tagged `nucleus-v0.3.1` at commit
`11d9732`, records the native ATOM source migration, release qualification and
hosted checks. It is evidence that the migration has been done once; it is not
yet evidence that the active `compiler-rewrite-12k` line has adopted it. The
two lines have diverged substantially, and the active branch still contains
AZM imports and legacy toolchain checks. A dedicated reconciliation stage is
therefore required before changing the active compiler path. That stage must
preserve the compiler rewrite, selectively port the ATOM-native source and
release proofs, and remove AZM from the production/build path without
overwriting the user's active work.

### Triptych WASM and macOS-native workspace

```text
cd /Users/johnhardy/projects/triptych
npm run proof:wasm-host
cargo test --workspace --all-features
npm run proof:native-terminal
```

All three commands passed. The WASM proof rebuilt the conformance host and passed
the CPU fixtures plus the CP/M scenarios for boot, console, directory and
file round trips, Atom compilation, Edit and Nucleus workflows, persistence,
and the checked disk behaviours. The Rust workspace test compiled and tested
the native host, CPU core, WASM host, CP/M image and CLI crates, including the
language-neutral CPU fixtures.

The native terminal proof also passed its PTY `ctrl-c` and `SIGTERM` cases,
including byte-preserving input/output and terminal restoration. This is the
macOS-native host evidence currently available; it does not yet compare an
Atom bare-harness result with a Triptych machine result.

These results establish that the selected WASM and macOS-native Triptych
targets are viable today. They do not yet establish parity between Triptych's
Rust machine and Atom's bare host, which is the next proof we need.

### Edit, Skate, Portable CP/M and the reference runtime

The supporting application and reference-host baselines were also run on
2026-09-24:

```text
cd /Users/johnhardy/projects/edit
npm test

cd /Users/johnhardy/projects/portable-cpm
npm test

cd /Users/johnhardy/projects/skate
deno task check

cd /Users/johnhardy/projects/debug80-runtime
npm test
```

All four commands passed. Portable CP/M reported **403 tests in 21 files**;
Debug80 Runtime reported **312 tests in 41 files**. Edit's proof suite passed
its editor, session, gap-buffer, native-ATOM and display boundary checks, then
completed its measured engine, gap, display and search workloads. Skate's Deno
check passed formatting, linting, compiler-budget and source-inclusion tests
(one budget test and four source-inclusion tests). These are host and product
baselines, not evidence that the applications already share one runtime ABI.
Their next work is to adopt the frozen service records at their own explicit
boundaries.

## Current seams to preserve

1. **Atom host versus `ATOM.COM`.** The host assembler uses source and output
   services; `ATOM.COM` uses CP/M. They are related products, not one implicit
   operating-system contract.
2. **Debug80 is a development adapter.** Existing Atom tests may continue to
   use it while a second adapter is built. New production Triptych code must
   not import it.
3. **Nucleus/AZM is a named legacy exception.** The current Nucleus proof path
   still documents an AZM-specific convention. This inventory does not broaden
   that exception and does not use AZM for new assembly or production builds.
4. **Triptych platform scope.** WASM and macOS-native are acceptance targets
   for this project. ESP32 remains a separate future target and cannot block
   the current milestone.

## First implementation predicate

The first Stage 1 predicate is now implemented in Atom as a host-neutral result
record and one golden case. The record is generated by
`scripts/generate-stage1-record.mjs`, checked in at
`proofs/stage-1-atom-host.json`, and exercised by
`test/host-stage1-record.test.mjs`. It includes:

- the selected profile identifier;
- the generated bytes and their digest;
- the canonical diagnostic shape for failure;
- the observable console transcript, if the case uses console input/output;
- the stop reason and bounded instruction/cycle result; and
- toolchain and source provenance.

The case is a filesystem-free Atom program that reads one source part through
the tool-service provider, emits three deterministic bytes at `$4000`, records a
diagnostic-free commit and halts. It does not require CP/M, BDOS, a disk image
or a Triptych-specific machine. Its output digest is
`83eb97a92203f33ccc0839186abcad1a0cc05b857ac46ad30bbb074ef08a1adf`.

The same record passes under both hosts:

```text
cd /Users/johnhardy/projects/atom
npm run verify:stage1-record
npm run verify:deno-stage1
node --test test/host-stage1-record.test.mjs
```

This is a host portability proof, not yet an independent CPU proof: both
invocations still use Atom's pinned Debug80 reference substrate. Triptych also
carries the corresponding `atom-stage1-halt` CPU fixture, executing the same
three bytes through the Rust CPU core; the rebuilt WASM proof reports that
fixture alongside its existing CPU and CP/M scenarios. The fixture now derives
the normalized record at
`/Users/johnhardy/projects/triptych/test/conformance/records/atom-stage1-triptych.json`.
The record uses the shared
[`z80-portable-conformance-v1`](../specifications/z80-portable-conformance-v1.md)
shape while keeping the bare-host and Triptych profiles distinct. Its checked
generator and fixture checks are:

```text
cd /Users/johnhardy/projects/triptych
npm run check:stage1-record
cargo test -p triptych-cpu-core --features conformance --test conformance
npm run proof:wasm-host
```

This proves the first artifact and CPU result can be compared without a
Debug80 import in Triptych. It does not yet qualify a second running-program
provider, the CP/M profile, Nucleus, Edit or Skate against the same record.
Keeping the record outside a generic `z80-runtime` repository avoids extracting
that runtime before two real machine consumers need it.

## Stage 1 exit gate

Stage 1 is complete when all of the following are true:

1. The first case has a checked-in source fixture and a stable result record.
2. Node and Deno produce byte-identical output, diagnostics and stop results
   from the same fixture. **Complete for the reference substrate.**
3. The provider contract and result record name their profile and provenance.
   **Complete for the first Atom/Triptych predicate.**
4. Triptych native and WASM can consume the record without importing Debug80.
   **Complete for the first CPU fixture; broader guest profiles remain open.**
5. The package and consumer checks above remain green, with any missing local
   development dependency described rather than silently repaired in a build.

The first predicate is now recorded with its fixture name, result digest and
second-host command. This remains an incremental report, not a completion
certificate for the whole platform.
