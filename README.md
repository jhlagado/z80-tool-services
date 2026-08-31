# Z80 tool services

`@jhlagado/z80-tool-services` defines the language-neutral service boundary
used by Z80-hosted development tools. Version 1 provides named binary objects,
bounded synchronous transfers, opaque handles, 32-bit seek offsets, and
transactional publication.

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

Native CP/M tools can include `native/cpm22-final-image.asm` to render one or
more finalized memory segments as Intel HEX through ordinary BDOS sequential
writes. File creation and transactional rename remain the caller's job.

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
- the `@jhlagado/z80-tool-services/source-preparation` host API.

Compiler-specific source, output, and diagnostic adapters remain in Atom and
Nucleus. Platform packages implement the same provider contract over Node,
CP/M BDOS, MON3, or TEC-FS.

The normative request and transaction contract is
[Z80 Tool Services ABI v1](https://github.com/jhlagado/debug80/blob/main/docs/specifications/z80-tool-services-abi-v1.md).
The shared resolver semantics are specified by the
[Z80 source preparation contract](https://github.com/jhlagado/debug80/blob/main/docs/specifications/z80-source-preparation.md).
