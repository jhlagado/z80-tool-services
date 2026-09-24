# Z80 Runtime extraction map

**Status:** CPU-first package published; generic consumer migration complete  
**Date:** 2026-09-24  
**Decision home:** `z80-tool-services`

This document separates the reusable Z80 execution substrate from the current
`@jhlagado/debug80-runtime` package. It began as an extraction map and now also
records the completed CPU-first move and its consumer evidence. The existing
package remains intact for Debug80, CP/M and TEC compatibility paths.

## Executive decision

Create a separate repository and package named `z80-runtime` /
`@jhlagado/z80-runtime` for the smallest generic Z80 execution surface:

- instruction execution and CPU state;
- 64K memory access and configurable memory-write policy;
- port callbacks and execution ticks;
- reset, bounded stepping/running and stop reasons;
- CPU snapshots needed by hosts and tests; and
- Intel HEX (or an equivalent image) loading.

The package must not depend on `z80-services`, `z80-tool-services`, CP/M,
Triptych, a filesystem, a terminal, TEC hardware, Debug Adapter Protocol, Node
or Deno. It provides callbacks and types; machine, operating-system and host
providers give those callbacks meaning.

This is deliberately a smaller boundary than the current standalone
`debug80-runtime` repository. That repository is already independent of the
Debug80 editor, but it still bundles three different responsibilities:

1. a reusable CPU and image loader;
2. CP/M and TEC machine profiles; and
3. Debug80-oriented headless and platform helpers.

The package name `@jhlagado/debug80-runtime` remains a compatibility surface for
now. Debug80 is not being reverted or changed by this document.

## Why the smallest boundary wins

Two extraction shapes were considered:

| Candidate                                | Shape                                                                       | Boundary clarity | Portability | Migration safety | Leakage risk |     Score |
| ---------------------------------------- | --------------------------------------------------------------------------- | ---------------: | ----------: | ---------------: | -----------: | --------: |
| **A — CPU-first (selected)**             | `errors.ts`, `src/z80/**`, and their tests; add a narrow public entry point |                5 |           5 |                5 |            5 | **20/20** |
| B — broad platform runtime               | CPU plus cycle clock, simple platform, CP/M, TEC, and headless session      |                2 |           2 |                3 |            1 |      8/20 |
| C — rename the existing package in place | Change the existing package identity and make every consumer follow it      |                2 |           3 |                1 |            2 |      8/20 |

Candidate B looks convenient because it moves more files at once, but it makes
the new repository another mixed machine library. Candidate C would break the
Debug80 extension and its platform imports for no product benefit. Candidate A
gives Atom and the other bare Z80 harnesses a stable substrate while leaving
CP/M and TEC ownership with the projects that define those behaviours.

The first implementation predicate is therefore:

> A clean `@jhlagado/z80-runtime` package can build and run the existing
> generic CPU tests without importing any file under `platforms/cpm22`,
> `platforms/tec*`, `platforms/serial`, or `headless`.

## Source classification

The source inventory is against Debug80 Runtime revision
`0024be1d868473568984fcde5a8323e575e595bf` (package `0.3.0`).

### Move first: generic substrate

| Current path              | Destination   | Reason                                                     |
| ------------------------- | ------------- | ---------------------------------------------------------- |
| `src/errors.ts`           | `z80-runtime` | Image/loader error has no machine or UI meaning.           |
| `src/z80/constants.ts`    | `z80-runtime` | CPU constants.                                             |
| `src/z80/core-helpers.ts` | `z80-runtime` | CPU execution helpers.                                     |
| `src/z80/cpu.ts`          | `z80-runtime` | Register state and instruction execution.                  |
| `src/z80/decode*.ts`      | `z80-runtime` | Instruction decoders.                                      |
| `src/z80/opcode-types.ts` | `z80-runtime` | Opcode typing.                                             |
| `src/z80/opcodes.ts`      | `z80-runtime` | Opcode tables and control-flow classification.             |
| `src/z80/rotate.ts`       | `z80-runtime` | CPU arithmetic/rotate helpers.                             |
| `src/z80/loaders.ts`      | `z80-runtime` | Image parsing and write-range metadata.                    |
| `src/z80/runtime.ts`      | `z80-runtime` | Generic memory, I/O, stepping, running and snapshots.      |
| `src/z80/types.ts`        | `z80-runtime` | CPU, callback and hardware context types.                  |
| `test/z80/**`             | `z80-runtime` | The generic decoder, flag, loader and runtime proof suite. |

The public API should be intentionally narrower than the source tree. The
first release should expose image loading, runtime construction, run/step
results, snapshots and the callback types. Decoder internals and opcode tables
remain subpath or private exports until a consumer genuinely needs them.

### Defer and split only with evidence

| Current path                      | Initial treatment                     | Reason                                                                                                                                                      |
| --------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/platforms/cycle-clock.ts`    | Leave in the current platform package | Useful, but its scheduling semantics are not required by the CPU-first contract. Extract only when a second independent host needs the same clock contract. |
| `src/platforms/simple/runtime.ts` | Leave in place initially              | It is a machine profile, not just a CPU. Split generic memory-region types if a second profile needs them.                                                  |
| `src/platforms/types.ts`          | Do not move wholesale                 | It mixes simple, CP/M, TEC-1 and TEC-1G configuration, including assembler and device policy.                                                               |

This avoids creating a “generic” package that quietly acquires platform policy.

### Keep outside `z80-runtime`

| Current paths                                | Owner after the split                           | Why                                                                  |
| -------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| `src/platforms/cpm22/**`                     | Portable CP/M / Triptych test and host adapters | CP/M disk geometry, filesystem, terminal and BIOS-facing behaviour.  |
| `src/platforms/tec-common/**`                | Debug80/TEC platform package                    | TEC monitor and display conventions.                                 |
| `src/platforms/tec1/**`                      | Debug80/TEC platform package                    | TEC-1 keypad, display and machine state.                             |
| `src/platforms/tec1g/**`                     | Debug80/TEC platform package                    | TEC-1G banking, SD, LCD, TMS9918, matrix and serial devices.         |
| `src/platforms/serial/**`                    | Device/platform package                         | Bit-banged UART policy is a device implementation.                   |
| `src/headless/**`                            | Debug80/TEC headless package                    | The session API constructs a TEC-1G machine and consumes D8 symbols. |
| `src/platforms/types.ts` (CP/M/TEC portions) | Their respective platform packages              | These types encode machine policy rather than execution.             |

The existing `src/index.ts` is therefore not a model for the new package: it
is an aggregate compatibility entry point. The new runtime must not re-export
all platform modules merely to preserve that shape.

## Contract and dependency direction

```text
Atom / Nucleus / Edit bare harnesses
                 |
                 v
        @jhlagado/z80-runtime
                 |
       callbacks and CPU snapshots
                 |
     machine / OS / host providers
       |             |             |
       v             v             v
    CP/M ABI     Triptych      Deno/Node host
```

The related repositories sit beside the runtime, not below it:

| Repository          | Owns                                                               | Relationship to `z80-runtime`                                                              |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `z80-services`      | Running-program capability meanings, providers and vectors         | May use the runtime in proof harnesses; runtime does not import it.                        |
| `z80-tool-services` | Compiler/build source, diagnostics, NOBJ and publication contracts | May use the runtime in native consumer proofs; runtime does not import it.                 |
| `portable-cpm`      | CCP, BDOS and CP/M contracts                                       | Supplies an OS profile/adapter; not a runtime dependency.                                  |
| `triptych`          | Rust CPU, native/WASM machine, BIOS, storage and browser hosts     | Independent implementation, qualified against common vectors; no JS runtime in production. |
| `debug80`           | VS Code debugger, UI and selectable assembler integration          | Continues to use the compatibility runtime until a separate debugger migration.            |
| `debug80-runtime`   | Current TypeScript reference bundle during transition              | Temporary compatibility/oracle and platform source; not the new contract authority.        |

`z80-services` and `z80-tool-services` are not two layers inside the CPU. The
former describes effects requested by a running program; the latter describes
compiler and artifact work. A CPU can run without either. A host can combine
all three when it needs to assemble or run a guest program.

## Consumer inventory

The audit found the following uses of `@jhlagado/debug80-runtime`:

| Consumer              | Current use                                                                                                                              | First migration slice                                        | What stays behind                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| **Atom**              | Bare host execution and compiler proofs use `createZ80Runtime` and `parseIntelHex`; CP/M tests still import the CP/M filesystem/runtime. | Migrated in `16fb8de`.                                       | CP/M image tests and their platform adapter.  |
| **Nucleus**           | Compiler/execution adapter and compiler/NOBJ tests use the generic root API.                                                             | Migrated in `6935269`.                                       | Any CP/M-specific proof host.                 |
| **Edit**              | Editor workload tests use the generic runtime and a CP/M terminal.                                                                       | Migrated in `63762528`.                                      | Terminal and CP/M filesystem helpers.         |
| **Skate**             | Deno differential proof runs generated programs through the generic runtime.                                                             | Migrated in `3f93298`.                                       | Skate effect semantics and Triptych provider. |
| **Portable CP/M**     | Test support uses the new CPU snapshot type while its named Debug80 harness remains the compatibility oracle.                            | Migrated in `4fdc62a`.                                       | CP/M machine and BDOS/BIOS behaviour.         |
| **Triptych**          | Rust/WASM are production; JavaScript runtime imports are test/proof helpers only.                                                        | Generic proofs migrated in `5f804f0`; production unchanged.  | Rust/WASM machine and BIOS.                   |
| **z80-services**      | Native byte-gateway tests instantiate the JS CPU.                                                                                        | Migrated in `2fb4692`.                                       | Service contract and native provider.         |
| **z80-tool-services** | Native NOBJ consumer tests instantiate the JS CPU.                                                                                       | Migrated in `247e379`.                                       | Tool-service authority and native modules.    |
| **Debug80**           | The extension directly consumes generic CPU types and TEC/CP/M platform types.                                                           | No automatic migration; make it a separate product decision. | TEC, CP/M and debugger-facing compatibility.  |

The migrated consumers pin `e4ee190`. The old revision pins remain only in
deliberate Debug80 compatibility paths, including the CP/M test oracle and
Triptych's product-specific adapter.

## Documentation index

The repository boundary is only useful if a reader can find the right manual.
The intended homes are:

| Topic                           | Documentation home                                    | Document responsibility                                                            |
| ------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Generic CPU API and conformance | `z80-runtime/README.md`, `z80-runtime/docs/`          | Machine-independent runtime API, limits, snapshots, stop reasons and test vectors. |
| Running-program capabilities    | `z80-services/README.md`, `z80-services/docs/`        | Byte streams, terminal/events and provider semantics.                              |
| Compiler/build services         | `z80-tool-services/README.md`, `docs/specifications/` | Source preparation, diagnostics, NOBJ, publication and provenance.                 |
| CP/M                            | `portable-cpm/README.md`, `portable-cpm/docs/`        | CCP/BDOS/BIOS-facing OS profile and machine assumptions.                           |
| Triptych                        | `triptych/README.md`, `triptych/docs/`                | Rust/WASM/native machine, BIOS, disk and browser integration.                      |
| Atom                            | `atom/README.md`, `atom/docs/`                        | Assembler semantics and host adapters; no CPU ownership claim.                     |
| Nucleus                         | `nucleus/README.md`, `nucleus/docs/`                  | Language/compiler semantics and execution-adapter contract.                        |
| Edit                            | `edit/README.md`, `edit/docs/`                        | Editor semantics and CP/M application behaviour.                                   |
| Skate                           | `skate/README.md`, `skate/docs/`                      | Language effects and Deno/Triptych providers.                                      |
| Debug80                         | `debug80/README.md`, `apps/debug80-vscode/docs/`      | Debugger and editor product behaviour, including legacy runtime use.               |

This document remains the cross-repository map. It should link to the runtime
README once the repository exists, and the runtime README should link back to
the normative service and platform specifications rather than copying them.

## Migration stages and evidence gates

1. **Freeze this map.** Review the module classification and public API list.
   No source move is part of this stage.
2. **Create the CPU-first package.** Preserve source history where practical;
   copy no CP/M or TEC implementation into it. Add generic tests and a package
   smoke test under Node 20 and Deno-compatible ESM.
3. **Add a compatibility adapter.** Let the old runtime keep its platform
   exports. Migrate one generic consumer at a time instead of changing the
   Debug80 extension's imports in bulk.
4. **Migrate bare harnesses.** Atom first, then Nucleus and Edit's generic
   proof support. Compare image bytes, observable output, registers and stop
   status against the pinned reference runtime.
5. **Migrate service proof consumers.** Update `z80-services`,
   `z80-tool-services`, Skate and Portable CP/M test paths only after their
   existing vectors pass through the new package.
6. **Keep Triptych production independent.** Extend the common portable
   conformance records to compare the new host where useful; Rust/WASM remains
   the production implementation and ESP32 stays deferred.
7. **Decide Debug80 separately.** Retain the old package for the debugger until
   a debugger-specific execution interface and release plan exist. Extraction
   is not permission to roll back or remove AZM/legacy Debug80 behaviour.

The extraction is complete only when the new package has a published contract,
two independent migrated consumers, passing generic vectors, and no import
path from the new package into CP/M, TEC or Debug80 UI code.

## Migration evidence at this checkpoint

The CPU-first package is public at
[`z80-runtime`](https://github.com/jhlagado/z80-runtime), pinned by consumers to
`e4ee190`. The following repository commits use the new package for their
generic CPU or proof paths:

| Repository        | Commit     | Evidence                                                                                                                              |
| ----------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Atom              | `16fb8de`  | 369 Node tests pass; CP/M adapter remains on the compatibility runtime.                                                               |
| Nucleus           | `6935269`  | 150 tests, Atom-source proofs and compiler-image checks pass.                                                                         |
| Edit              | `63762528` | Editor CPU workload harness and measurements use the new package; CP/M terminal remains separate.                                     |
| Skate             | `3f93298`  | Deno typecheck, scope-budget proof and generated-effects Triptych proof pass through the new import map.                              |
| Portable CP/M     | `4fdc62a`  | CPU snapshot typing uses the new package; the named Debug80 test harness remains as the compatibility oracle.                         |
| z80-services      | `2fb4692`  | Full Deno verification passes, including the native byte-gateway proof.                                                               |
| z80-tool-services | `247e379`  | 132 tests and native NOBJ consumer proof pass.                                                                                        |
| Triptych          | `62f49d7`  | New-runtime CPU conformance, typecheck, sound proof, and CP/M 2.2 compatibility proof pass; Rust/WASM production remains independent. |

The new package itself passes its Node typecheck, lint, formatting, 90 generic
CPU tests and package smoke test. No production source imports the old runtime
through these migrated paths. Debug80's product-specific runtime, TEC/CP/M
platform modules and AZM integration remain unchanged.

## Completion state

The boundary is implemented, documented and pushed in every targeted
repository. Node and Deno consumers use the CPU-first package; Triptych's Rust
and WASM implementations are qualified against it; and the old Debug80 bundle
remains available for its explicit CP/M, TEC and debugger compatibility paths.
The only future work is a separate, product-specific Debug80 migration decision.
Do not remove or rewrite the legacy runtime until that gate exists.
