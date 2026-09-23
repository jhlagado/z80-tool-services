# Shared platform services for Z80 language tools

`@jhlagado/z80-tool-services` is the independent home for services that have
the same meaning in ATOM, Nucleus and Skate. Each language still owns its
syntax, compiler, runtime semantics and release. The shared package can release
on its own cadence; consumers pin a tested revision and update separately.

## The boundary

A host or operating-system adapter owns physical files, path policy, source
transport and output publication. The language tool consumes ordered source
parts and emits an object or program through a small private adapter. The
adapter may be a Node module, a WASM host callback or Z80 source assembled into
a CP/M executable. A common service meaning does not require an identical
resident call sequence: ATOM's source/IMAGE/PATCH interface and Nucleus's
compiler-host vector are allowed to remain different.

Generated programs have a second boundary for console and external data. A
compiler's access to source and publication must not be confused with the
services required by its output. Shared byte-stream semantics may support both
boundaries, but their capabilities and providers are selected separately.

The shared package owns language-neutral operations and their conformance
vectors: source identity and confined reads, deterministic dependency order,
bounded source parts, byte-transparent transfer, failure status, commit/abort
publication, and runtime byte streams. Each tool owns the profile that
recognizes its source syntax and translates to that neutral model. Platform
adapters own BDOS, host filesystem, monitor or device calls. Native modules
are shared as ATOM-assembled source until a suitable native library format
exists; consumers link only the modules they use.

## Current consumers and migration

- **ATOM** uses this package's source-preparation and host services. Its Z80
  core has compact private callbacks. Preserve that measured ABI and use ATOM
  as a conformance consumer for shared changes.
- **Nucleus** accepts ordered source parts and external service addresses, but
  does not yet consume the shared source-preparation package. Adopt a neutral
  service only where its project ordering, source bytes and target contract
  remain identical. Reuse does not require a language-level `include`.
- **Skate** reads `.SKM` parts in its released CP/M compiler and calls BDOS in
  its source/output adapters. Its generated runtime also has CP/M I/O. Prepare
  `(include ...)` with the shared resolver and stage the existing `.SKM` input
  first. Then isolate compiler BDOS transport behind a measured adapter. Port
  generated-program I/O separately.

Skate's host-side source preparation is the first new integration. Its
language profile recognizes only leading top-level `(include ...)` forms;
the shared resolver retains identity, import-once order, path confinement,
cycles and provenance. Staged `.SK8` parts contain masked include forms, so
the released compiler still sees its ordinary ordered input. This adds no
resident compiler or generated-runtime bytes.

## Release rule

1. State the behaviour and byte-level contracts affected by a shared change.
2. Prove the package's own conformance vectors and package build.
3. Run the relevant ATOM, Nucleus and Skate consumer flows against the proposed
   package revision. A consumer that has not adopted an API still runs its
   baseline gate to detect integration breakage.
4. Record native code, immutable data, writable workspace and generated
   runtime costs separately for any resident adapter change.
5. Release the shared package, then update each consumer's immutable pin with
   its own successful gate. No consumer is required to release in lockstep.

The first host resolver does not itself make Skate portable. The portability
milestone is reached when a second, non-CP/M provider can compile the same
ordered source and publish the same program without changing Skate's compiler
core; a separate proof must do the same for generated-program I/O.
