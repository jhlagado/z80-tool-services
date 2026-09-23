# Portable Z80 platform architecture

## Stage 0: contract and profile baseline

**Status:** proposed architecture baseline
**Date:** 2026-09-24
**Home:** `z80-tool-services`

This document gives Atom, Nucleus, Edit, Skate, Portable CP/M, Triptych and
the Debug80 tools a common map. It does not replace the normative contract in
any of those projects. It records which project owns each contract, how a
program is qualified on a platform and what evidence is required before a
component moves.

## The decision

Keep the existing repositories independent. Freeze four boundaries before
starting a broad runtime rewrite:

1. **Z80 execution** runs instructions and exposes memory, ports, reset,
   interrupts and run limits.
2. **Running-program services** provide operations requested by a program,
   such as byte streams, storage, terminal input and output, events, video or
   sound.
3. **Compiler and build services** prepare source, accept compiler output,
   publish artifacts and report diagnostics.
4. **Machine, operating-system and host providers** implement those contracts
   for CP/M, Triptych, a browser, Deno, ESP32 or another target.

Applications own language and application semantics. Machines and operating
systems own their ABIs. Shared repositories own only stable, independently
testable contracts.

The immediate consequence is that there will be no immediate Deno rewrite, no
new `z80-runtime` repository and no merge of the existing projects. First we
record behaviour and prove the smallest interfaces through adapters.

## Scope and non-goals

This stage covers:

- the vocabulary used across the projects;
- ownership and dependency direction;
- the difference between a compiler host and a running-program host;
- a qualified execution profile for each supported use case;
- migration stages and their evidence gates;
- release and provenance rules.

The exclusions are every future device, a new transport, renumbering an
existing service, a Debug80 Runtime rewrite and a decision that Rust, Node or
Deno must be the only host. CP/M is not made the universal Z80 abstraction.

## Vocabulary

| Term                         | Meaning                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Execution substrate**      | A Z80 implementation that supplies registers, memory, instruction execution, ports, reset, interrupts, timing and stop conditions. |
| **Machine profile**          | The memory, port, reset, interrupt, timing and run-budget policy supplied to an execution substrate.                               |
| **Operating-system profile** | A guest ABI such as CP/M CCP, BDOS, BIOS, FCB and DMA rules.                                                                       |
| **Capability profile**       | A versioned set of operations a running program may request, with limits, lifetime, EOF and failure rules.                         |
| **Tool-service profile**     | A versioned set of operations used by an assembler, compiler or build tool for source, generation, diagnostics and publication.    |
| **Provider**                 | The platform-side implementation of a capability or tool-service profile.                                                          |
| **Harness**                  | A host composition that loads an artifact, supplies providers and collects an observable result.                                   |
| **Artifact**                 | A released or testable program, object, image or generated file together with its target profile and provenance.                   |
| **Transport**                | The bytes or calls that carry a contract. A transport is not the contract itself.                                                  |

## Boundary model

```text
language or application semantics
       |                         |
       v                         v
compiler/build services   running-program services
       |                         |
       v                         v
host/tool provider        machine and OS provider
       |                         |
       |                 machine profile
       |                         |
       |                 Z80 execution substrate
       |                         |
       +-------------------------+
                    |
          host or hardware result

A compiler implemented as a Z80 guest follows the right-hand machine path as
well. A host compiler can stop at its tool provider without CP/M or a machine
profile.
```

The arrows describe dependency direction. A language may use a service
contract. A machine provider may implement it. A service contract must not
import a language, CP/M, Triptych SPI, a filesystem framework or a particular
host runtime.

The same operation can have different transports. A direct resident gateway,
an I/O port and a framed serial channel can implement one running-program
profile when they preserve its specified behaviour. Sharing semantics does not
require identical addresses, resident layouts or wire formats.

## The qualified execution profile

“Run an arbitrary Z80 binary” is incomplete. Every reproducible run records a
profile with these fields:

```text
profile-id
artifact kind and immutable artifact identity
CPU contract and execution substrate
memory map and reset state
I/O and interrupt model
operating-system or machine profile
required capability profiles and versions
optional capabilities and limits
provider and host
conformance suite and result
source, toolchain and release provenance
```

For example, `ATOM.COM` under CP/M 2.2 and Atom's bare tool harness are two
different profiles even though they execute related Z80 source. The first
needs BDOS, console and disk behaviour. The second needs source reads, console
status and transactional image output.

## Ownership map

| Project                  | Owns                                                                                             | Does not own                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Atom**                 | ATOM language, resident assembler core, Atom gateway, host CLI and `ATOM.COM`                    | CP/M implementation, generic CPU authority, Triptych internals                 |
| **Nucleus**              | Nucleus language/compiler/runtime semantics and Nucleus adapters                                 | Generic service definitions, CP/M BIOS or BDOS                                 |
| **Edit**                 | Editor semantics, `EDIT.COM`, ATOM source and editor proofs                                      | Rust host implementation, Debug80 Runtime                                      |
| **Skate**                | Skate language, compiler/runtime and language-facing effect adapters                             | Generic service authority, CP/M as a universal API                             |
| **z80-tool-services**    | Build-time source preparation, NOBJ, generation, diagnostics, output and transaction contracts   | Running-program effects, CPU execution                                         |
| **z80-services**         | Running-program service contracts, native bindings, reference providers and vectors              | Production platform providers, compiler/build services, CPU implementation     |
| **portable-cpm**         | Portable CCP, BDOS and CP/M contracts with test BIOS doubles                                     | Triptych's production BIOS, generic CPU runtime                                |
| **Triptych**             | Rust CPU machine, native/WASM hosts for this roadmap, BIOS, bootstrap, disk and device providers | Debug80 production dependencies, private CCP/BDOS forks, ESP32 acceptance work |
| **debug80-runtime**      | Existing JavaScript reference and development harness during migration                           | New contract authority, production Triptych dependency                         |
| **debug80**              | IDE and extension integration, including selectable assembler paths                              | Ownership of runtime or application semantics                                  |
| **Future `z80-runtime`** | A generic CPU API and implementation if its contract and consumers justify a release             | CP/M, filesystems, terminals, compiler policy or language semantics            |

The ownership row for a contract is singular. Generated projections and vendored
native modules remain derived copies and must point back to their authority.

## Contract catalogue

### Z80 execution

The future generic CPU contract is intentionally small. It is a design target,
not yet a repository-level normative authority. Triptych's `cpu-v0.1` profile
remains the current authority for the Triptych machine, while another machine
may define its own current profile until a shared CPU contract is adopted.

The target contract would:

- load or reset a machine image;
- inspect and modify memory through a host API;
- perform port reads and writes through a machine callback;
- step or run with an explicit limit;
- report a stop, trap, interrupt or budget result;
- expose registers and cycle information required by the proof.

It would not define files, CP/M calls, terminal policy, compiler services, SPI,
ESP-IDF, Node or Deno. Triptych's Rust core is the current production
implementation direction. Debug80 is a reference/development implementation
until another adapter has parity.

### Running-program services

`z80-services` is the target authority for services requested by a running
program.
Its first qualified profile is the synchronous bounded byte gateway. The six
operations cover standard input, standard output, storage input, storage
rewind, storage output and storage seek. The profile defines status values,
EOF, cursor movement, atomic failure, reset and register preservation.

Terminal controls, named files, input events, clocks, video and sound are
separate capabilities. They are added only when a second real consumer needs
the same semantics. A provider reports an unsupported capability explicitly.
It does not silently substitute CP/M or a device-specific meaning.

Nucleus has an overlapping six-operation service shape. Stage 0 does not
renumber it. Stage 2 compares its exact status, reset and preservation rules
with the shared byte gateway and, if they agree, keeps a compatibility
projection rather than a second semantic authority.

Skate's richer framed effect protocol remains a Skate/provider contract until
the shared profile covers the same behaviour. A single translation at the
provider boundary is preferable to copies in every host.

The current `z80-tool-services` package also exports runtime byte-stream
helpers. Those exports are compatibility code during this transition. They
have no new consumers, and their removal waits for a deprecation release after
the shared `z80-services` profile and its consumers pass the same vectors.

Qualified hosts use the
[`z80-portable-conformance-v1`](../specifications/z80-portable-conformance-v1.md)
record to compare source, artifact, diagnostic and declared execution results.
The record keeps profile and provenance explicit; it does not turn a machine
profile or a service transport into a generic runtime ABI.

### Compiler and build services

`z80-tool-services` is the maintained implementation home and intended
authority for operations performed on behalf of a compiler, assembler or build
tool:

- source identity, confinement, ordering and bounded reads;
- diagnostics and source positions;
- image and patch generation;
- NOBJ framing and target-image materialisation;
- commit, abort and recovery;
- transactional output publication and provenance.

Atom's host filesystem, source preparation and artifact publication belong at
this boundary. Atom's resident core remains filesystem-free. A CP/M adapter,
Node adapter, Deno adapter or Triptych adapter may provide the same service
meaning without sharing a resident call sequence.

Two specifications were a named legacy exception. Their text now lives in
this repository without changing their identifiers or vectors. The Debug80
copies remain historical provenance until consumers have moved their links and
immutable pins to this authority; no new consumer may introduce a third
authority during that transition.

### Operating-system and machine contracts

CP/M remains a platform profile with CCP command behaviour, BDOS calls, BIOS
calls, FCB and DMA rules, disk geometry and resident placement. Portable CP/M
owns CCP and BDOS. Triptych owns the Triptych BIOS and bootstrap. A future
MSX-DOS, TRSDOS or monitor profile may reuse shared running-program semantics
where they genuinely match, but its OS-specific rules remain in that profile.

### Contract identifiers and status

| Contract                         | Identifier or version                | Current authority and status                                                                |
| -------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| Running byte gateway             | `z80-services` `byteGateway/0`       | `z80-services`; first experimental shared profile                                           |
| Tool request and transaction ABI | Z80 Tool Services ABI v1             | `z80-tool-services`; Debug80 copy retained as historical provenance while consumers migrate |
| Tool source preparation          | `source-preparation` legacy contract | `z80-tool-services`; Debug80 copy retained as historical provenance while consumers migrate |
| Portable conformance record      | `z80-portable-conformance-v1`        | `z80-tool-services`; host-neutral evidence for qualified profile comparisons                |
| Nucleus language/runtime         | Nucleus 0.1 contracts                | Nucleus; language-specific, not a shared service authority                                  |
| Triptych CPU                     | `cpu-v0.1`                           | Triptych; current machine-specific CPU authority                                            |
| CP/M operating system            | Portable CP/M release contract       | Portable CP/M for CCP/BDOS; Triptych for its BIOS and bootstrap                             |

The identifier is part of a profile record and release manifest. A generated
projection is not a new version merely because it uses another transport. The
source-preparation document currently has no independent version in its name,
so its transfer gate must assign one without changing its established rules.

## Current and planned profiles

| Use case                | Status       | Execution                         | Machine or OS             | Services                              | Current host or evidence                |
| ----------------------- | ------------ | --------------------------------- | ------------------------- | ------------------------------------- | --------------------------------------- |
| Atom host assembler     | Current path | Z80 adapter                       | Atom tool profile         | Tool source, console, image and patch | Node and Debug80 Runtime                |
| `ATOM.COM`              | Current path | Z80 runtime                       | CP/M 2.2                  | BDOS, console and disk                | Triptych native/WASM qualification      |
| Nucleus host compiler   | Current path | Z80 adapter                       | Nucleus tool profile      | Tool source and output                | Existing host path                      |
| `NUC.COM`               | Current path | Z80 runtime                       | CP/M 2.2                  | BDOS, console and disk                | Triptych CP/M qualification             |
| `EDIT.COM`              | Current path | Z80 runtime                       | CP/M 2.2                  | Console, terminal and storage         | Triptych CP/M qualification             |
| Skate compiler          | Current path | Z80 adapter or host compiler path | Skate tool profile        | Source preparation and publication    | Deno and CP/M compatibility proofs      |
| Generated Skate program | Current path | Z80 runtime                       | CP/M or future profile    | Console, streams and effects          | CP/M and Skate providers                |
| Triptych machine        | Current path | Rust Z80 core                     | Triptych CPU profile      | Host terminal, storage and devices    | Native/WASM; ESP32 is a deferred target |
| Debug80 Runtime         | Current path | JavaScript Z80 engine             | Explicit selected profile | Reference providers                   | Node development harness                |
| Generic `z80-runtime`   | Planned      | Future shared CPU adapter         | Explicit selected profile | None beyond machine callbacks         | No release yet                          |

The current Atom host path is Node plus Debug80 Runtime. A Deno path and a
shared generic CPU adapter are planned, not implied by the current rows. The
machine rows are qualified separately on native and WASM targets for this
roadmap. ESP32 remains a future target and has no acceptance gate here.

The matrix prevents “Atom on Node”, “Atom as `ATOM.COM`” and “Atom on
Triptych” from being treated as competing definitions. They are qualified
profiles with different providers and acceptance evidence.

## Versioning and release rules

1. A normative contract has one maintained authority and a version.
2. Generated TypeScript, ATOM constants and native projections identify their
   source contract and are checked against it.
3. Consumers qualify immutable revisions and record artifact hashes, target
   profiles and toolchain identities. Branch names and local symlinks are
   development conveniences, not release inputs.
4. Cargo, npm and Deno locks retain their own language-level dependency roles.
   A component lock records external Z80 source and artifact inputs separately.
5. ATOM is the assembler for new assembly, generated artifacts and production
   builds. AZM is historical and is not a production fallback.
6. Nucleus currently has a named historical exception: its compiler-image
   proof still links AZM and Debug80 because the checked compiler source uses an
   AZM-specific convention. This exception may remain only while the ATOM
   migration is qualified. No new Nucleus source, production build or fallback
   path may select AZM.
7. Production Triptych code and firmware do not depend on Debug80 Runtime.
   Debug80 may remain a development-only or differential adapter until the
   retirement gate passes.
8. A new repository needs a stable contract, at least two independent
   consumers and a release or ownership reason that cannot be met by an
   existing project. This prevents one repository per capability.

## Migration roadmap

### Stage 0: architecture freeze (this document)

Inventory the current contracts, assign each one owner, record the profile
matrix and agree on dependency direction. Do not move implementations yet.

**Gate:** every current artifact and service fits the ownership map. Each
legacy exception, including the Debug80 specification links, the Debug80 host
path, Nucleus's AZM proof and CP/M-specific adapters, has an explicit owner,
reason and migration stage. No dependency remains unexplained.

### Stage 1: behaviour inventory

Capture golden, user-visible vectors for Atom assembly, Nucleus compilation,
Edit open/edit/save, Skate compile/run, CP/M file and console behaviour and
Triptych native/WASM machine behaviour. Each record states whether evidence is
from a host model, Node, Deno, Rust native, WASM or physical ESP32 hardware.
Include the ATOM replacement of Nucleus's AZM image build as a named migration
vector rather than treating the current AZM proof as a production fallback.

**Gate:** a clean checkout reproduces accepted bytes, transcripts, diagnostics,
files and relevant resource limits.

### Stage 2: contract convergence

Compare Nucleus's service calls with the `z80-services` byte gateway. Freeze
one meaning for each shared operation and generate compatibility projections
where an existing consumer needs its current entry shape. Keep transport and
resident addresses out of the language-neutral contract.

**Gate:** within each versioned profile, every operation identifier has one
meaning. Legacy adapters may map different entry codes explicitly. Every
approved provider passes the same observable vectors.

### Stage 3: portable JavaScript execution seam

**Progress:** Atom's first Node/Deno host predicate is qualified; see
[`stage-3-node-deno-atom-2026-09-24.md`](../reports/stage-3-node-deno-atom-2026-09-24.md).

Define the minimum execution interface and wrap the existing Debug80 Runtime
without rewriting it. Make the public harness standard ESM, run it under Deno
while retaining Node compatibility and adapt Atom's bare harness first. Keep
Debug80 as a differential oracle during the comparison.

**Gate:** Node and Deno produce identical Atom console transcripts, output
bytes, canonical diagnostics and stop results. A canonical diagnostic records
the stable code, source identity, position, message class and normalised text,
while host paths and stack formatting remain outside the comparison. No Atom
core module imports Debug80-only semantics.

### Stage 4: CP/M and tool-service qualification

Make the shared tool-service provider usable from clean Node and Deno hosts.
Run `ATOM.COM`, `NUC.COM` and `EDIT.COM` through the pinned Portable CP/M and
Triptych paths. Keep Triptych BIOS in Triptych and CCP/BDOS in Portable CP/M.

**Gate:** CP/M headless scenarios, disk digests, resident placement and
failure cases pass on the intended native and WASM profiles.

### Stage 5: Skate separation

Separate Skate compiler source/output transport from generated-program runtime
effects. Put CP/M FCB and BDOS details behind a Skate CP/M adapter. Use
`z80-tool-services` for compiler operations and `z80-services` for running
program operations. Add a non-CP/M provider before claiming portability.

**Gates:**

- the compiler transport produces equivalent ordered source, diagnostics and
  published output through CP/M and a non-CP/M provider;
- a generated program produces equivalent canonical traces for an explicitly
  declared shared capability subset;
- an unsupported capability fails explicitly instead of being silently
  substituted by a CP/M or device-specific operation.

### Stage 6: Triptych qualification

Use one Rust CPU core for native macOS/Linux and WASM. ESP32-S3 build, boot and
physical timing are explicitly deferred and do not block this roadmap. Host
simulation and browser proof do not count as hardware measurements.

**Gate:** native/WASM guest parity and hosted release verification pass. No
ESP32 build or hardware evidence is required for this project; any later ESP32
work must be labelled as a separate target qualification.

### Stage 7: Debug80 retirement decision

After active consumers pass their own gates, make Debug80 Runtime optional.
Retain it as a reference if it remains useful. Remove it only when a clean
consumer audit proves that no required build or test depends on it.

### Stage 8: future operating systems

Add an OS profile only when a real program and workflow require it. Define the
OS ABI in its own project, implement shared service adapters only where the
semantics match and qualify the reusable guest-level vectors.

## Rejected alternatives

### CP/M as the universal interface

This would leak BDOS, FCB, DMA and CP/M text rules into programs that may
target another operating system.

### Immediate Deno rewrite

Changing the host and the emulator together would make a behavioural change
difficult to localise. The execution seam and golden vectors come first.

### Triptych-only runtime

Atom and Skate still need a portable headless development path. Rust and WASM
are production machine adapters, not the only useful host.

### One repository for every service

Separate effects, files, terminal and storage repositories would multiply
release and compatibility work before independent consumers justify it.

### One large Z80 monorepo

The projects have different release units, memory constraints and owners.
Shared contracts are sufficient; shared source is not required.

## Risks and controls

| Risk                                                        | Control                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| CPU implementations disagree on flags, timing or interrupts | Instruction and guest-level differential vectors                                |
| Nucleus and Z80 Services retain different meanings          | One shared profile plus explicit compatibility projections                      |
| Atom gains hidden host behaviour                            | Keep filesystem, preprocessing and publication in host adapters                 |
| Skate effect protocol gets copied into every host           | Translate once at a provider boundary                                           |
| Release pins drift                                          | Immutable revisions, component locks and artifact hashes                        |
| A generic runtime is extracted too early                    | Require two consumers and a passing conformance suite                           |
| Host results are mistaken for hardware results              | Label Node, Deno, native, WASM and ESP32 evidence separately                    |
| Repository ownership becomes ambiguous again                | New contracts require an owner, version and consumer list before implementation |

## First implementation predicate

Stage 1 begins with one bounded proof, not a rewrite:

> Atom's existing bare-harness test runs through a small portable execution
> interface under Node and Deno with identical console transcript, generated
> bytes, diagnostics and stop result.

That proof tests the architecture at the least risky boundary. If it requires
CP/M, filesystem policy or a second service authority, the Stage 0 model is
wrong and must be revised before further migration.
