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

The package exports:

- the canonical 16-byte request layout, operation numbers, and status values;
- TypeScript provider and result types;
- a small synchronous client;
- a byte-transparent in-memory reference provider;
- explicit-ordinal source byte providers;
- append-only generation spools, lifecycle checks, and atomic
  committed-generation storage;
- one-byte service status normalization and thrown-operation capture;
- byte console dispatch helpers for input, output, terminal success, and
  terminal failure;
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
