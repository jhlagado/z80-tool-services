# Stage 6 Nucleus compiler Triptych WASM proof

**Date:** 2026-09-24
**Status:** passed as an opt-in compiler-host predicate
**Nucleus revision:** `8503b3b`
**Triptych revision:** `44ba31043fbce95df82bb4e07ea607c8c03c688d`

Nucleus now exports `createTriptychWasmExecutionAdapter()`. It accepts the
Triptych `TriptychCpu` constructor at the host boundary and implements the
existing `NucleusExecutionAdapter` surface without importing Triptych, Rust or
browser code into the compiler package. Output-port observations are translated
to Nucleus's existing `write(port, value)` callback.

The predicate compiles this source through both the Debug80 Runtime reference
adapter and Triptych WASM:

```text
sub main() fails
  writeOutputByte('K') else fail
end
```

The result compares NOBJ bytes, the materialised flat image and its Intel HEX
identity. The exact observed result was:

| Field              |                                                      Triptych WASM | Debug80 reference |
| ------------------ | -----------------------------------------------------------------: | ----------------: |
| NOBJ bytes         |                                                            `1,683` |           `1,683` |
| materialised bytes |                                                            `4,096` |           `4,096` |
| Intel HEX SHA-256  | `0db201a410427dfa00c72bbe988e49b338f9346e3babfd048333a9bbb792fe4d` |              same |
| instructions       |                                                           `22,675` |          `22,571` |
| cycles             |                                                          `230,448` |         `230,448` |
| result             |                                                               pass |              pass |

Instruction counts differ because the engines expose repeated Z80 block
operations at different stepping granularity. The image, serialized object,
port-write meaning and cycle total are the qualified observables for this
predicate. A portable instruction-count contract remains intentionally
unclaimed.

The adapter uses JavaScript-owned memory and instruction-boundary copies for
the same wasm-bindgen view-lifetime reason recorded by the Atom proof. This is
an integration/conformance path, not yet the high-throughput browser compiler
path. The active compiler-image generator is now qualified separately through
ATOM; the AZM imports retained by the proof/runtime modules are a differential
oracle boundary, not the production image generator.

## Reproduction

```sh
cd /Users/johnhardy/projects/triptych
npm run build:wasm-host
cd /Users/johnhardy/projects/nucleus
npm run build
TRIPTYCH_WASM_MODULE=/Users/johnhardy/projects/triptych/dist/wasm/triptych_host_wasm.js \
  npm run verify:triptych-wasm
```

The predicate remains opt-in so Nucleus's normal package checks do not require
a Triptych checkout. Debug80 remains a differential development oracle; this
does not add a Debug80 dependency to Triptych production code.
