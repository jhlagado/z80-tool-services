# Stage 2 Triptych WASM compiler-host proof: 2026-09-24

This closes the first real-module compiler-host vector for the WASM target.
It does not claim that the macOS-native Nucleus compiler binding is complete,
and it does not change the active dirty Nucleus checkout.

## Contract increment

Triptych commit `8ecbe89` adds `TriptychCpu.ram_view()`, a zero-copy
`Uint8Array` view over its fixed 64 KiB RAM allocation. The generated
wasm-bindgen module does not expose a top-level `memory` property, so the
previous adapter's fake/test-only memory path could not run the real module.
The export is deliberately tied to the existing fixed allocation and carries
the same lifetime rule as the native RAM pointer: hosts must not retain it
after dropping the CPU.

Nucleus commit `753d7e6` makes `createTriptychWasmExecutionAdapter()` prefer
that direct view while retaining the legacy injected-memory path for older
bindings and tests. It also adds a reproducible command:

```text
npm run verify:triptych-wasm -- PATH_TO_TRIPTYCH_WASM_MODULE
```

The proof runs the same source through the Debug80 reference adapter and the
real Triptych WASM module, comparing NOBJ bytes, materialized flat-image
bytes, cycle counts and diagnostics. Host instruction counts are intentionally
not compared because the two CPU cores report different instruction-step
granularity while agreeing on Z80 T-states and outputs.

## Recorded result

Using the module built from Triptych `8ecbe89`, the command passed four cases:

| Case | Result | Cycles | NOBJ SHA-256 | Flat image SHA-256 |
| --- | --- | ---: | --- | --- |
| empty | success | 158,898 | `bb9b81c0568f6fefc2e0ee1366204599cbe845dbf5537122ba027a1f41a13af2` | `5c28389fcf35405847d2f0cfc79003e36c897f73fe7c3ee5fdb269b6ab870f30` |
| typed expression | success | 236,700 | `c55ef2385a3fc8291ee1c64ae9cd7e47bc5aea4bc6d1575e2f4534583e0b81b8` | `c7bbf5fcbbf396e15012513fb0bd2ece0e6c6ad8edf2d0dc7da4f06bd4dfae86` |
| output | success | 301,437 | `d7bfc7227d878d6ed31fbe06c3a03f570634a140f54c31fc9ff154766b6bebdd` | `bd8d53ff789edc7fd92a1f4be1098756cfc2adb6f45845229b85ba025102417c` |
| malformed declaration | diagnostic 134 at offset 10, line 2, column 1 | 61,118 | — | — |

The adapter tests passed 4/4, TypeScript type checking passed, and the
Triptych Rust gate passed formatting, clippy with warnings denied, the full
workspace tests (including 36 WASM-host tests) and the release WASM build.
Both conformance and browser wasm-bindgen outputs include `ram_view()`.

## Boundary and next step

This is a real Triptych WASM guest/compiler-host proof, not a browser disk or
CP/M-system proof. Debug80 remains the reference adapter, and macOS-native
Triptych still needs an equivalent binding or a deliberately documented
out-of-process host protocol. The next Stage 2 increment is to choose and
qualify that native binding without pulling Debug80 into Triptych production
code; ESP32 remains deferred.
