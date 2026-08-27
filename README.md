# Z80 tool services

`@jhlagado/z80-tool-services` defines the language-neutral service boundary
used by Z80-hosted development tools. Version 1 provides named binary objects,
bounded synchronous transfers, opaque handles, 32-bit seek offsets, and
transactional publication.

The package exports:

- the canonical 16-byte request layout, operation numbers, and status values;
- TypeScript provider and result types;
- a small synchronous client;
- a byte-transparent in-memory reference provider;
- reusable provider conformance vectors; and
- `native/z80-tool-services-v1.asmi`, generated from the TypeScript authority.

Compiler-specific source, output, and diagnostic adapters remain in Atom and
Nucleus. Platform packages implement the same provider contract over Node,
CP/M BDOS, MON3, or TEC-FS.

The normative request and transaction contract is
[Z80 Tool Services ABI v1](https://github.com/jhlagado/debug80/blob/main/docs/specifications/z80-tool-services-abi-v1.md).
