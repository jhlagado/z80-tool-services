# Stage 2 Nucleus–ATOM probe: 2026-09-24

This is a read-only integration probe for Stage 2 of the portable Z80 platform
roadmap. It does not change the user's Nucleus checkout.

## Revisions under test

| Component | Revision |
| --- | --- |
| active Nucleus compiler rewrite | `e472559c632a023d39ed3d388050d82f1ab0f376` (`compiler-rewrite-12k`) |
| qualified ATOM-native Nucleus line | `11d9732e3650a3c41b6ba284bd8b06c826b3fd56` (`atom-source-native`) |
| ATOM working tree used by the converter | `835e238164005b972647f644179f767a17be132e` (0.3.0) |
| shared tool-services record | `eb8d69ceab1d0477b03fcd22ad2d999499ca90aa` |

The ATOM revision is a local development revision. It was used only to run a
source-conversion probe; it is not a release pin.

## ATOM conversion probe

The probe used the repository's converter, without writing into the Nucleus
checkout:

```text
node /Users/johnhardy/projects/atom/bin/azm-to-atom.mjs --stdout <source.asm>
```

The observed results were:

| Active source | Result | Reason |
| --- | --- | --- |
| `asm/vertical-slice/memory-map-proof.asm` | refused | AZM `.INCLUDE` has no direct ATOM equivalent |
| `asm/vertical-slice/dispatcher-measurement.asm` | refused | AZM `.INCLUDE` has no direct ATOM equivalent |
| `asm/vertical-slice/proof-z80-runtime.asm` | refused | `RuntimeProofServices` exceeds ATOM's eight-character symbol limit |
| `asm/vertical-slice/z80-runtime.asm` | refused | `TrapNumber` exceeds ATOM's eight-character symbol limit |

These are source-structure failures, not assembler installation failures. A
safe migration therefore needs two explicit transformations:

1. prepare or flatten the include graph while preserving source identity and
   diagnostics; and
2. provide a stable, reviewed short-symbol map rather than truncating names or
   performing a global textual replacement.

No generated ATOM file from this probe was copied into a project checkout.

## Branch-integration probe

An isolated worktree was created from `compiler-rewrite-12k` and `main` was
merged with `--no-commit --no-ff`. The merge was then aborted in that isolated
worktree. The user's working tree remained untouched.

The merge produced content conflicts in these nine files:

```text
README.md
asm/vertical-slice/typed-expression-parser.asm
docs/README.md
docs/oddities.md
src/compiler.ts
src/generated-compiler-images.ts
test/compiler.test.ts
test/ll1-stage7.test.ts
test/proof-harness.test.ts
```

The remainder of the native line consists of a large set of added native-ATOM
sources, providers, generated images, proof baselines and release scripts. A
cleanly staged merge is therefore not evidence of semantic compatibility; the
conflicting compiler, generated-image and proof files must be reconciled with
the 12K rewrite deliberately.

## Decision

The qualified `atom-source-native` line remains the ATOM production/release
baseline. The active `compiler-rewrite-12k` line remains the language-work
baseline. They must not be merged wholesale.

The next implementation slice is a selective port from the 12K rewrite onto an
ATOM-native integration branch, one owned concern at a time, beginning with the
parser/compiler source and its tests. Each slice must regenerate its ATOM image
and pass the existing compiler and proof gates before the next concern moves.

The ESP32 target is not part of this gate. The acceptance targets remain the
Triptych macOS-native and WASM hosts.
