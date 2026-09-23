# Stage 3 Node/Deno Atom host gate: 2026-09-24

This report records the first Stage 3 execution-seam predicate from the
[portable Z80 architecture](../architecture/portable-z80-platform-v1.md).
It qualifies the existing Atom host under Node and Deno; it does not retire
Debug80 Runtime or qualify the Triptych Rust adapter.

## Revisions and command

| Component | Revision or profile |
| --- | --- |
| Atom | `d1fd7c1` (`Prove Atom Node and Deno host parity`) |
| Atom execution seam | `835e238` (`Add replaceable Atom execution adapter`) |
| tool services | `0.2.0`, local checked dependency |
| profile | `atom-bare-host-stage3-v1` |

The reproducible gate is:

```text
npm run verify:stage3
```

The script creates separate temporary workspaces, assembles the same source
under the Node process and under `deno run -A`, then compares normalized
console output, diagnostics and the size and SHA-256 of every selected
artifact. The workspace path and runtime version are deliberately excluded
from the comparison.

## Result

Both hosts returned `identical` for the source identity
`main.asm` (SHA-256
`05e0408114a28b074db4e49b8ca7192a7ac999093c5c7bf236ae4002a55b18c6`) and
assembled one part containing five bytes. The artifact hashes were:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `main.bin` | 5 | `fff348f7dfe88be5698283cbb0133757364650bf947ecb7750c93c42b218c112` |
| `main.hex` | 34 | `204214c151bd587823f874d61c4d6b2f19c48bfd05a44ac558da2e4e8bca52e7` |
| `main.lst` | 589 | `6c2b4a2d9d14e096d40ef77ee32a571122d2509fb86d42cc2508193322dd6b41` |
| `main.d8.json` | 2,118 | `1ffe5f01366ca402c4be6a9f7120783a70b7b56970767adad0f43169d8360a3f` |
| `main.nobj` | 53 | `4600397cb0f8d3ad54d19e555401b9ea7ac942820c97c26d5bef4706a2dd8eb1` |

The full Atom suite also passed at this revision: **369 tests**. The focused
test is `test/host-stage3-node-deno.test.mjs` and the gate is also exposed as
`npm run verify:stage3` for clean-checkout use.

## Interpretation

This closes the first Stage 3 predicate: the same public Atom host path is
observable-equivalent under Node and Deno. The reference execution adapter
still imports Debug80 Runtime, by design. The remaining Stage 3 work is to
qualify a Triptych native/WASM adapter against this seam and then decide,
with the consumer audit, whether Debug80 Runtime can become optional.

ESP32 is not part of this evidence or its acceptance gate.
