# Stage 2 Nucleus compiler-image ATOM qualification: 2026-09-24

**Status:** passed for the active `compiler-rewrite-12k` image generator; the
legacy AZM proof/runtime oracle remains explicitly separate

This is the next bounded increment in the portable Z80 platform roadmap. It
does not merge the historical native-ATOM compiler line into the active
12K-rewrite checkout, and it does not claim that every Nucleus proof has
stopped using the Debug80/AZM reference path.

## Boundary changed

The checked-in compiler-image generator now assembles the two active flat
compiler images with ATOM through a private worker boundary:

```text
scripts/generate-compiler-images.mjs
  -> scripts/assemble-image-worker.mjs
  -> scripts/assemble-image-source.mjs
  -> scripts/atom-source.mjs
  -> atom-z80
```

The generator rejects the retired `--azm-oracle` mode. ATOM source preparation
keeps the include graph and source provenance, schedules forward equates, and
uses explicit short aliases only where ATOM needs them. No AZM output is used
as a production fallback.

The active source still retains AZM imports in `src/proof.ts` and
`src/nucleus-runtime.ts` for the existing differential proof/runtime adapter.
Those imports are the remaining historical oracle boundary and are not part of
the generated compiler-image path.

## Revisions and commands

| Component         | Revision or working boundary                                    |
| ----------------- | --------------------------------------------------------------- |
| Nucleus           | active `compiler-rewrite-12k` checkout                          |
| ATOM package      | `atom-z80` pinned to `802b5c2d320bec777f427755ff2d7338e3b80a05` |
| generator         | `scripts/generate-compiler-images.mjs`                          |
| comparison helper | `scripts/image-comparison.mjs` (test-only)                      |

The following commands passed in the Nucleus checkout:

```text
npm run test:atom-source
  15 tests passed

npm run check:compiler-images
  ATOM assembled flat-target-z80-slice-proof.asm
  ATOM assembled flat-target-debug-z80-slice-proof.asm

TRIPTYCH_WASM_MODULE=/Users/johnhardy/projects/triptych/dist/wasm/triptych_host_wasm.js \
  npm run verify:triptych-wasm
  result: pass
```

The full Nucleus development gate also passed with the current linked AZM
contract oracle:

```text
npm run typecheck && npm test -- --reporter=dot
  17 test files, 150 tests passed
```

The replacement images were compared with the previously checked-in image
artifacts in an isolated probe. Both normal and debug HEX streams are
byte-for-byte identical. The symbol maps preserve every previous symbol and
add only the seven historical `Generated*` aliases required by the current
source contracts; no existing symbol value changed.

The WASM compiler-host proof remains identical:

| Field              |                                                      Triptych WASM | Debug80 reference |
| ------------------ | -----------------------------------------------------------------: | ----------------: |
| NOBJ bytes         |                                                            `1,683` |           `1,683` |
| materialised bytes |                                                            `4,096` |           `4,096` |
| Intel HEX SHA-256  | `0db201a410427dfa00c72bbe988e49b338f9346e3babfd048333a9bbb792fe4d` |              same |
| cycles             |                                                          `230,448` |         `230,448` |

## Interpretation

This closes the production-image assembler predicate for the current active
Nucleus line. It does not remove AZM from every development proof: the
existing strict-register-contract suite is an independent oracle and remains
documented as such until its execution adapter has a replacement conformance
path. A baseline run from the parent active commit currently reports the same
AZM strict-contract failures, so those failures are not attributed to this
ATOM generator change.

The acceptance targets for this work remain macOS-native Triptych and
Triptych WASM. ESP32 is explicitly deferred.

## Next gate

Keep the ATOM generator pinned and reproducible, then migrate one proof/runtime
slice at a time away from the AZM/Debug80 oracle. Re-run the consumer audit
before changing optional peer placement or retiring the reference adapter.
