# Stage 2: Nucleus–ATOM reconciliation plan

**Status:** in progress; host seam and first source/integration probe landed,
source/artifact reconciliation still pending

**Scope:** reconcile the active Nucleus `compiler-rewrite-12k` line with the
qualified ATOM-native line `atom-source-native`/`nucleus-v0.3.1`. The target
platforms are Triptych macOS-native and WASM. ESP32 is explicitly deferred.

This is a selective integration, not a replacement of the compiler rewrite.
The native ATOM line is a valuable completed migration and release record, but
the active compiler-rewrite line contains newer compiler work and user-owned
changes. Neither branch may be discarded or merged blindly.

## Divergence snapshot

The first isolated comparison was made on 2026-09-24 from a detached worktree
of `compiler-rewrite-12k`; the user's Nucleus checkout was not changed. The
tip-to-tip comparison with `atom-source-native` spans **581 paths**: 11 added,
153 modified and 417 deleted on the active line. The difference includes
generated compiler images, proof fixtures, native source providers and public
APIs, so a branch merge would conceal too much intent to be a safe first step.

The active line is version `0.1.0` and still has AZM references in
`src/proof.ts`, `src/nucleus-runtime.ts`,
`scripts/check-azm-toolchain.mjs`, `scripts/generate-compiler-images.mjs`,
`package.json` and `package-lock.json`. The ATOM-native line is version `0.3.1`,
tagged `nucleus-v0.3.1` at commit `11d9732`; its release package uses the
`atom-z80` source pin and keeps Debug80 Runtime as a dependency of the host
adapter. This confirms the migration boundary, but not compatibility with the
new compiler rewrite.

## First conversion predicate

The existing `azm-to-atom` migration utility was exercised in a detached
worktree against three active compiler sources. It correctly refuses to emit
misleading ATOM source: `memory-map-proof.asm` still uses AZM `.INCLUDE`,
`dispatcher-measurement.asm` does the same, and `proof-z80-runtime.asm` uses
the overlong `RuntimeProofServices` symbol. The runtime source reaches the
same eight-character-symbol limit. These failures are useful evidence:
reconciliation needs an include-flattening/source-preparation pass and an
explicit stable symbol map, not a global search-and-replace or a package
rename. No converted file was written to the user's Nucleus checkout.

The exact revisions, commands, refusal messages and isolated branch-merge
result are recorded in the [2026-09-24 probe report](stage-2-nucleus-atom-probe-2026-09-24.md).
The probe confirms that the next work is a selective source port, not a
wholesale branch merge.

## Host seam delivered

The active Nucleus compiler now accepts an explicit
`NucleusExecutionAdapter`. Its default adapter is the development/reference
Debug80 implementation, so existing behaviour remains unchanged, while a
Triptych native or WASM implementation can later supply the same parsed image,
memory, CPU-register, step and stop surface. The adapter is exercised by an
explicit-wrapper compiler test. The current Nucleus suite is **150 tests in 17
files**, with type checking and formatting passing.

This does not yet qualify Triptych as a compiler host: the active generated
compiler images still come from the AZM path, and the adapter has not been
implemented for the Rust machine. Those are intentionally separate gates in
the sequence below.

The qualified ATOM-native branch now has the same execution seam in an isolated
integration commit (`2e55e4a`, branch `nucleus-native-adapter-clean`). It covers
both resident and streaming compiler hosts without changing compiler images or
language semantics. Its compiler file passed **38/38** tests, the ATOM source
and image battery passed **63/63**, and type checking plus the runtime-boundary
check passed. The commit remains isolated until the active 12K source line has
been reconciled; it is not a merge of the two compiler histories.

## Triptych substrate checkpoint

Triptych commits `d2f0d5b` and `21d85f3` now expose the lower host surface
needed by a future Nucleus or Atom adapter on the two acceptance platforms.
The Rust core can install architectural CPU state and remove the reset
overlay at a bare-image boundary. The WASM host exposes checked image RAM
writes, CPU-field updates, a stable 64 KiB view address, and ordered full port
tracing. The native host now supplies the same image, state, buffered-console
and trace surface. A five-instruction output-and-halt predicate proves the
setup, service-boundary observation and final state on both hosts; the
validation was run with the full Rust workspace, all features and clippy
warnings denied, plus a release `wasm32-unknown-unknown` build and
wasm-bindgen declaration generation.

This is deliberately a substrate proof, not a claim that Nucleus has already
compiled through Rust/WASM. The next adapter must preserve the Nucleus image,
register/flag updates and host-service ordering against this surface, then
produce the portable conformance record. macOS-native and WASM remain the
acceptance targets; ESP32 is outside this gate.

## Nucleus WASM adapter checkpoint

The isolated ATOM-native Nucleus line now contains commit `79f11c3`
(`nucleus-native-adapter-clean`), which supplies
`createTriptychWasmExecutionAdapter`. It injects the generated Triptych
wasm-bindgen module structurally rather than adding a Triptych package
dependency, parses the compiler's flat Intel HEX without Debug80, maps the
fixed 64 KiB RAM view, installs CPU and flag state at instruction boundaries,
and translates Triptych's packed full-port write trace into the existing
Nucleus host callback. Three fake-binding tests cover malformed images,
zero-copy memory, state synchronisation, output ordering and halting.

The adapter's bounded gates passed: TypeScript build; 97 Atom/CP/M boundary
tests; 63 ATOM source and image proofs; compiler-image reproducibility;
runtime-boundary; package export/CLI checks. The repository-wide Vitest run was
manually stopped after remaining CPU-bound in its existing aggregate compiler
battery, so it is not reported as a full-suite pass. This is an adapter
qualification increment, not yet a Rust/WASM Nucleus compiler proof: the next
gate must run the actual generated Triptych module against the same compiler
vectors and then add the native macOS binding. As a lower-level integration
smoke, the generated Triptych web-bindgen module was instantiated from the
release WASM and driven through this adapter with `OUT (n),A` followed by
`HALT`; it produced the expected full-port trace and halted state.

That compiler gate has now passed for the first direct source case. With
Triptych commit `5ee04a4` and Nucleus commit `79f11c3`, the generated release
WASM module compiled `sub main()\nend\n` through the adapter to a 1,568-byte
NOBJ after 13,780 instructions and 158,898 T-states. The Triptych trace
capacity fix is part of this proof: the compiler's long run no longer detaches
the adapter's zero-copy RAM view. This is one deterministic WASM vector, not
yet the complete compiler battery or the macOS-native binding. After the fix,
Triptych's existing `proof:wasm-host` and `proof:native-terminal` acceptance
commands also passed; the first exercises the full browser/CP/M scenario set,
while the second proves native macOS terminal byte preservation and restoration.

## Boundaries

- ATOM is the production assembler and the only assembler used for new source
  and release builds.
- AZM may remain only as a historical comparison oracle during the migration;
  it must not remain a production assembler, fallback, or required build
  dependency.
- Nucleus compiler semantics, source language and generated CP/M artefacts
  remain Nucleus-owned.
- The Nucleus running-program byte gateway consumes the shared
  `z80-services` projection; the projection does not make the compiler depend
  on a machine or on CP/M.
- Debug80 Runtime remains a development/reference adapter only. Triptych
  production code must not depend on it.

## Safe execution sequence

1. **Inventory the divergence.** From fresh temporary worktrees, compare
   `compiler-rewrite-12k` with `atom-source-native` by source modules, package
   manifests, generated images, proof drivers, diagnostics, and public APIs.
   Record each changed concern and its intended owner before editing.
2. **Create an isolated integration worktree.** Base it on the current
   `compiler-rewrite-12k` commit. Do not checkout, reset or merge in the
   user's dirty working tree. Preserve user-owned documentation, lockfiles and
   untracked files outside the integration worktree.
3. **Port the ATOM-native source and providers selectively.** Bring across the
   native ATOM source, source-provider rules, CP/M helpers, prefix generation,
   diagnostics and memory-map changes only where they are compatible with the
   compiler rewrite. Keep unrelated historical generated output out of the
   patch.
4. **Remove the AZM production path.** Delete AZM imports and required
   dependencies from the reconciled build. If an oracle is needed for a
   comparison, isolate it behind an explicitly named development-only check
   and remove it from release scripts and runtime packages.
5. **Re-run compiler and service contracts.** Qualify the existing Nucleus
   tests, the six byte-gateway operations, the checked
   `nucleus-byte-gateway-v0` projection, Atom source preparation, diagnostics,
   NOBJ generation and compiler-image generation. Add one executable vector
   in which a Nucleus-generated program uses the projected byte service.
6. **Qualify the guest artefacts.** Build the Nucleus CP/M image with ATOM,
   run it under the Triptych Rust native host and WASM host, and compare
   deterministic output, diagnostics, stop results and image digests. No
   ESP32 run is required for this stage.
7. **Review adversarially.** Have an independent review check for accidental
   AZM production coupling, changed compiler semantics, unstable generated
   bytes, absolute paths/timestamps in records, and ownership leaks between
   compiler services, running-program services and CP/M.
8. **Publish only after the gate.** Update the Nucleus version/pin and
   Triptych image only after the isolated worktree passes its full checks.
   Record the exact commit, ATOM version, conformance records and native/WASM
   commands. Keep the active branch untouched until that evidence exists.

## Exit criteria

Stage 2 is complete when:

- the active Nucleus line builds and tests without AZM in its production path;
- ATOM assembles the checked source and the resulting image is reproducible;
- the shared byte-gateway projection has an executable Nucleus consumer proof;
- Nucleus artefacts run with equivalent observable results under Triptych
  native and WASM hosts;
- the release record identifies source, assembler, profile, digest and host
  provenance without absolute paths or timestamps; and
- an independent review finds no unresolved boundary or ownership violation.

Until those criteria are met, Nucleus should be reported as **migration
qualified on a separate historical line, reconciliation pending on the active
compiler-rewrite line**.
