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

The main package also exports small generation-storage primitives used by
language-specific object sinks: `MemoryGenerationSpool` for append-only byte
chunks and `AtomicGenerationStore` for replacing a committed generation only
after the serialized bytes validate.

The package exports:

- the canonical 16-byte request layout, operation numbers, and status values;
- TypeScript provider and result types;
- a small synchronous client;
- a byte-transparent in-memory reference provider;
- append-only generation spools and atomic committed-generation storage;
- reusable provider conformance vectors; and
- `native/z80-tool-services-v1.asmi`, generated from the TypeScript authority;
- the `@jhlagado/z80-tool-services/source-preparation` host API.

Compiler-specific source, output, and diagnostic adapters remain in Atom and
Nucleus. Platform packages implement the same provider contract over Node,
CP/M BDOS, MON3, or TEC-FS.

The normative request and transaction contract is
[Z80 Tool Services ABI v1](https://github.com/jhlagado/debug80/blob/main/docs/specifications/z80-tool-services-abi-v1.md).
The shared resolver semantics are specified by the
[Z80 source preparation contract](https://github.com/jhlagado/debug80/blob/main/docs/specifications/z80-source-preparation.md).
