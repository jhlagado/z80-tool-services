# Z80 tool services

`@jhlagado/z80-tool-services` defines the language-neutral service boundary
used by Z80-hosted development tools. Version 1 provides named binary objects,
bounded synchronous transfers, opaque handles, 32-bit seek offsets, and
transactional publication.

This is the independently versioned authority for those contracts. It builds
and tests without a Debug80 checkout; Debug80, Atom, Nucleus, and Skate use
parts of its service surface.
The [platform integration plan](docs/platform-integration.md) records how
ATOM, Nucleus and Skate adopt shared services without sharing a resident ABI
or a release schedule.

The [portable Z80 platform architecture](docs/architecture/portable-z80-platform-v1.md)
defines the ownership boundaries and staged migration. The current evidence is
recorded in the [Stage 1 behaviour inventory](docs/reports/stage-1-behaviour-inventory.md);
the [Stage 2 Nucleus–ATOM reconciliation plan](docs/reports/stage-2-nucleus-atom-reconciliation-plan.md)
describes the safe integration of the active compiler-rewrite line with the
qualified ATOM-native release. The current acceptance targets are Triptych's
macOS-native and WASM hosts; ESP32 is deferred.

The [Z80 Runtime extraction map](docs/architecture/z80-runtime-extraction-map-2026-09-24.md)
records the selected CPU-first boundary for separating a future
`@jhlagado/z80-runtime` package from the mixed Debug80 Runtime compatibility
bundle. It also maps current consumers and the documentation homes for the
runtime, service, tool, CP/M, Triptych and application contracts.

```sh
npm install
npm run check
```

The repository retains the package's path history through Debug80 commit
`6c8d0f19767166308bf6e3c9271c4d2aae0e309e` and subtree split
`c714d483f2d918652de2e1844ba2104124e82212`.

The `source-preparation` subpath provides the Node-hosted project layer shared
by streaming Z80 tools: confined source reads, stable physical and logical
identities, deterministic dependency ordering, cycle detection, path-keyed
placement, bounded capacities, and provenance. Each language supplies its own
directive profile and compiler-byte policy.

The main package also exports small source and generation primitives used by
language-specific host adapters: `MemorySourceByteProvider` for explicit
part-ordinal byte reads, `MemoryGenerationSpool` for append-only byte chunks,
`AtomicGenerationStore` for replacing a committed generation only after the
serialized bytes validate, and `GenerationLifecycle` plus conformance vectors
for the common `begin`/`image`/`patch`/`commit`/`abort` sequencing. It also
provides one-byte status helpers for Z80 service gateways that return success
or failure in a register, byte console dispatch helpers for input, output, and
terminal status, plus conformance vectors for direct-host gateways built on
those shapes.

The package also owns common NOBJ framing and finalized target-image
materialization. `decodeNobjEnvelope` validates record lengths, phase order,
version selection, the terminal record count, and CRC-16/CCITT-FALSE. Atom and
Nucleus then validate their different BEGIN and MAP profiles before converting
the IMAGE, PATCH, geometry, and used-length records to `materializeTargetImage`.
The result contains one capacity-sized RAM image per bank and the exact used
length of each bank.
`renderTargetBinary`, `renderTargetCpmCom`, and `renderTargetIntelHex` then
produce final files from that common result. A COM file is a headerless binary
whose load and entry address must both be `$0100`.

Portable host evidence can use `validatePortableConformanceRecord` for one
record and `assertPortableConformanceParity` for a native/WASM (or Node/Deno)
pair. Parity compares the logical source, generated artifact, diagnostics and
public stop status; provider-owned counters and substrate observations remain
available in each record but are not required to be identical.

The NOBJ 1.0 host core adds a strict decoder, canonical writer, section-image
materializer, and version-specific readers for ATOM 0.2 and Nucleus 0.1. The
legacy readers keep each old profile's checks, then convert accepted streams
to NOBJ 1.0 and compare every materialized bank and retained layout field.
ATOM's final cursor and source-part order remain explicit metadata. Nucleus
conversion requires the provider's state length when the runtime identity is
not the canonical 0004 layout. These APIs do not change either producer's
existing output format.

The NOBJ 1.0 linker accepts committed objects, an explicit target layout, and
selected runtime providers. It keeps local IDs and contract obligations scoped
by input object, places fixed and allocated sections deterministically, resolves
qualified exports and service imports, checks bank visibility and address
overflow, and returns combined images plus copy/zero initialization plans. It
does not publish files. Built-in Skate 2.0 and Nucleus 0.1 contract schemas are
validated by the reader; another required contract needs an exact validator.
Providers may apply their own rule to repeated object-scoped obligations.

Native CP/M tools can include `native/cpm22-final-image.asm` to render one or
more finalized memory segments as Intel HEX through ordinary BDOS sequential
writes. File creation and transactional rename remain the caller's job.

Native tools can include `native/nobj-consumer.asm` to consume a stored NOBJ
without loading the complete file into Z80 RAM. `ZN_MAT` validates the common
record envelope, phase order, version, record count, and CRC; calls the
tool-selected Atom or Nucleus profile validator; initializes used target bytes
with the profile fill value; rewinds the input; and only then applies IMAGE and
PATCH bytes. The caller supplies byte-read, rewind, profile-validation,
target-initialization, and target-store routines plus a 20-byte state block.
The selected target memory must not overlap that state block.

The NOBJ consumer and both profile sources use canonical ATOM syntax and
eight-character symbols. Their proofs assemble those files directly with
ATOM, without source translation. Callback entry names, status values, state
offsets, instruction order, and the native PATCH subset are unchanged. The
source-level constant renames are listed in
[the native ATOM migration notes](native/ATOM-MIGRATION.md).

`native/atom-flat-nobj.asm` supplies the Atom 0.2 profile hook. It validates the
flat bank-zero BEGIN and MAP fields, image bounds and monotonicity, used and
final extents, entry address, source-part banks, PATCH coverage, and PATCH
non-overlap. It uses a 49-byte state block and rejects a target capacity that
overlaps it. PATCH verification repeats sequential scans instead of retaining
an address bitmap or interval list, so its RAM cost does not grow with the
object.

`native/nucleus-nobj.asm` supplies the Nucleus 0.1 profile hook. It accepts flat
loaded images and banked ROM images, validates the complete MAP relationship,
checks IMAGE order separately in every bank, proves PATCH non-overlap, and
initializes each bank through the caller's target-store routine. Its 94-byte
state block has constant size from one through 255 banks. The validator trades
execution time for RAM by rescanning the immutable object for each bank and
patch. Pairwise PATCH checking is quadratic in the number of patches; the
profile adds no lower record limit, so a native platform may publish and
diagnose its own execution-time limit. The measured native code is 755 bytes
for the common consumer and 2,270 bytes for the Nucleus profile, with 94 bytes
of caller-owned state.

This native Nucleus profile supports the legacy non-overlapping PATCH subset.
The current Nucleus host format also permits overlapping PATCH records, with
the last serialized write winning. The native profile still rejects those
objects; it is not a complete loader for every object accepted by the current
host parser. Tests exercise that difference explicitly.

From the first read until `ZN_MAT` returns, the input must remain readable and
byte-for-byte unchanged, and no target write may alias it. The read, rewind,
profile, initialization, and store callbacks preserve IX and IY. A direct-memory
store routine must be infallible after profile validation. A fallible target
uses tentative storage and publishes it only after `ZN_MAT` succeeds. File
opening, naming, closing, replacement, and rollback belong to the platform
adapter rather than the NOBJ consumer.

The main package also defines the shared assembler-flavour names used by Node
tools that accept ordinary `.asm` files. Callers choose `atom`, `azm`, or
`auto`; filenames do not select a dialect by themselves. Neutral tools should
call `dispatchZ80AssemblerFlavour` with explicit Atom and AZM handlers after
reading project or target configuration. Command-owned tools may pass a
concrete default, but the shared package still performs the same normalization
and rejects unresolved `auto` before any assembler-specific code runs.

The main package also exports the shared positive-output selector and file
publication transaction used by the desktop CLIs. A tool supplies its own
suffix table, including any tool-specific rejection messages for formats it
does not implement. The shared selector performs case-insensitive suffix
matching, prefers the longest suffix, resolves paths against the caller's base
directory, and rejects repeated formats or output paths before any files are
written. The shared publisher stages every requested file, replaces targets
only after all staged writes have succeeded, and restores previous targets if
a later replacement fails. The same publication module also provides a
content-addressed generation-directory transaction for tools that publish an
immutable artifact set and atomically advance a `current` pointer. Tool
packages still define their artifact names and manifest schema; the shared
layer owns the staging, conflict detection, cleanup, and pointer swap.
The output-selection module also exposes the common positive-output CLI split:
the first positional argument is the input, later positional arguments are
outputs, and any compatibility output-option values are prepended to that
output list.
The CLI helper module also provides a deliberately small option-value reader
for commands that keep their own option vocabulary but share the same
"next argument is required" failure rule.

The package exports:

- the canonical 16-byte request layout, operation numbers, and status values;
- shared Z80 assembler-flavour constants and normalization;
- concrete assembler-flavour selection and dependency-free dispatcher helpers;
- small CLI argument helpers that do not impose a command vocabulary;
- positive output selection by suffix with duplicate format and path checks;
- positive-output CLI argument splitting;
- transactional positive-output file publication;
- content-addressed artifact-generation publication;
- resident byte-domain source-part constants for adapters that carry
  source-part ordinals as one byte, including Atom's zero-based 255-part
  driver domain and Nucleus's one-based 255-part descriptor domain;
- TypeScript provider and result types;
- a small synchronous client;
- a byte-transparent in-memory reference provider;
- explicit-ordinal source byte providers;
- append-only generation spools, lifecycle checks, and atomic
  committed-generation storage;
- shared finalized-image validation and materialization, including flat and
  banked images, profile-selected PATCH rules, and fill bytes;
- shared NOBJ record framing, phase, version, commit-count, and CRC validation;
- BIN, CP/M COM, and Intel HEX rendering from a materialized image;
- one-byte service status normalization and thrown-operation capture;
- byte console dispatch helpers for input, output, terminal success, and
  terminal failure;
- runtime byte-stream services for generated programs with standard input,
  standard output, storage input, storage output, seek, rewind, and reset;
- reusable provider and gateway conformance vectors; and
- `native/z80-tool-services-v1.asmi`, generated from the TypeScript authority;
- native Z80 NOBJ validation/materialization and CP/M Intel HEX rendering
  modules; and
- the `@jhlagado/z80-tool-services/source-preparation` host API.

Compiler-specific source, output, and diagnostic adapters remain in Atom and
Nucleus. Platform packages implement the same provider contract over Node,
CP/M BDOS, MON3, or TEC-FS.

The normative request and transaction contract is
[Z80 Tool Services ABI v1](docs/specifications/z80-tool-services-abi-v1.md).
The shared resolver semantics are specified by the
[Z80 source preparation contract](docs/specifications/z80-source-preparation.md).
Cross-host execution evidence uses the
[Z80 portable conformance record](docs/specifications/z80-portable-conformance-v1.md).
`validatePortableConformanceRecord` is the dependency-free runtime validator
for that JSON shape; it checks the stable identity, address, digest and host
provenance fields before a record is accepted as evidence. Profile-owned
execution and diagnostic observations remain opaque to this shared layer.
Debug80 retains historical copies for provenance; new consumers must link the
specifications from this repository.
