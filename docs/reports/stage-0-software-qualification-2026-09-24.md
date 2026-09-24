# Portable Z80 software qualification: 2026-09-24

This report records the completed software checkpoint for the portable Z80
platform roadmap. The accepted machine targets are macOS-native Triptych and
Triptych WASM. ESP32 is explicitly deferred and is not an acceptance gate.

## Result

Stages 0 through 6 have passed their software qualification gates. The
repositories remain independent, ATOM is the production assembler, Triptych's
Rust/WASM production path has no Debug80 Runtime dependency, and the same
guest-facing CP/M workflow is qualified on the native and WASM targets.

The checkpoint is reproducible from the following commands (run from each
repository's clean checkout, with the pinned local development dependencies
described by that repository):

| Repository | Gate | Result |
| --- | --- | --- |
| `triptych` | `npm run check` | 676 unit/integration tests, 245 browser tests, native/WASM CP/M parity, disk-library and cross-tab persistence flows, Skate and Nucleus scenarios, Rust tests/Clippy, and release WASM build passed |
| `atom` | `npm run release:check` | 369 tests, self-host, native/WASM adapter proof and no-AZM production measurements passed |
| `nucleus` | `npm run test:atom-source`; `npm run check:compiler-images`; `npm run typecheck && npm test`; `npm run verify:triptych-wasm` | ATOM source translation 15/15, normal/debug image checks, 150 tests, and identical Triptych/Debug80 oracle vectors passed |
| `edit` | `npm run check` | ATOM-only build, CP/M proof, boundary/session/gap/display proofs and 19 gap workloads passed; `EDIT.COM` 5,890 bytes, SHA-256 `f113ba8e9e7c1fa18e4c85caf04a733a760540e34ba3d9265bcdd75f933f7ba1` |
| `skate` | `deno task check`; `deno task test:cpm` | Deno checks, scope/console/data/integer/edge/float/include/generated-effects and release/remount/disk-full/compile-failure CP/M proofs passed |
| `portable-cpm` | `npm run check` | ATOM-only guard, typecheck, format, 403 tests and release artifact build passed |
| `z80-services` | `deno task verify` | 23 native/reference gateway, transport, scheduler and compatibility tests passed |
| `z80-tool-services` | `npm run check` | 132 tests, package build and smoke passed |
| `debug80` | `npm run check:consumer-paths` | 43 consumer/release-path checks passed; shipping extension has no mandatory AZM dependency |
| `debug80-runtime` | `npm run check` | typecheck, lint, format, 312 tests and package smoke passed |

After the table checkpoint, Nucleus revision `0b858d0` also passed
`npm run verify:triptych-wasm-proof`: the unchanged manifest/NOBJ proof runner
matched Debug80 and Triptych WASM on memory-map, NOBJ and banked execution
vectors. The banked vector matched observable memory, NOBJ bytes, selected
bank and `10,384,694` cycles; CPU instruction counts remain
implementation-specific.

## Contract and ownership outcome

The architecture in
[`portable-z80-platform-v1.md`](../architecture/portable-z80-platform-v1.md)
is the working contract map:

- Atom owns the assembler and its resident gateway.
- Nucleus, Edit and Skate own their language/application semantics.
- `z80-tool-services` owns compiler/build, diagnostics, NOBJ and publication
  contracts.
- `z80-services` owns running-program service meanings and vectors.
- Portable CP/M owns CCP and BDOS; Triptych owns its BIOS, machine, native
  host and WASM host.
- Debug80 Runtime remains a development/reference substrate and a supported
  Debug80 product dependency, not a Triptych production dependency.

The active Nucleus compiler-image generator now assembles through ATOM. The
normal and debug images are byte-for-byte identical to the checked-in images.
The remaining AZM imports are confined to differential-proof/runtime oracle
code; they are not production image authority or an automatic fallback.

## Remaining work

This checkpoint does not claim that every historical Debug80 test adapter has
been deleted. The next bounded work is:

1. migrate the remaining Nucleus proof/runtime oracle slices behind the
   qualified Triptych execution seam while retaining Debug80 as a comparison
   oracle;
2. widen the shared running-program service profile only when a second real
   consumer needs the capability; and
3. repeat the Debug80 consumer audit before changing or retiring any
   reference dependency.

These are incremental retirement and contract-widening tasks, not blockers for
the macOS-native/WASM software checkpoint. ESP32 build, boot, timing and
hardware work remain a separate future qualification.

## Provenance

The principal revisions used for this checkpoint were:

| Component | Revision |
| --- | --- |
| Triptych | `44ba31043fbce95df82bb4e07ea607c8c03c688d` |
| Atom | `468461b57c2892bc0d7d9357742ce9ad82bcfbd43` |
| Nucleus | `6faa2a5436e936f1a28685ee4cffbe9c73a17c694` |
| Skate | `1e18a7ac606685c09991dff0d775960110df36515` |
| Portable CP/M | `19859ea0a0ae6cd5f565679994f3a24323a8115d6` |
| Z80 services | `3e7de17976cf67e6658e3a615465aae5c084d1937` |
| Z80 tool services | `8472063d65a18399fa266f2a3d2da11ada0f77558` |
| Debug80 Runtime | `0024be1d868473568984fcde5a8323e575e595bf` |
