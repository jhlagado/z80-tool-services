# Stage 5 Skate effects boundary: 2026-09-24

This report records the first Stage 5 qualification slice from the
[portable Z80 architecture](../architecture/portable-z80-platform-v1.md).
It confirms that Skate's running-program effect protocol is provider-neutral
at the TypeScript boundary, while keeping CP/M policy in its named adapter.
It does **not** claim that the generated Skate Z80 runtime already runs
through a non-CP/M provider.

## Revisions and commands

| Component | Revision or profile |
| --- | --- |
| Skate | `ed95e38` (`Document Skate byte gateway boundary`) |
| Skate console adapter | `10d8bb6` (`Adapt Skate console effects to byte gateway`) |
| z80-services projection | `3e7de17` (`Add Skate byte gateway projection`) |
| effect profile | Skate external-effects protocol v1; byte-gateway/0 console subset |

The reproducible checks were:

```text
cd /Users/johnhardy/projects/skate
deno task check
deno task test
```

## Result

Both commands passed. The complete Deno check covered formatting, linting,
compiler-budget and source-inclusion checks. The effect suite passed **34
provider/protocol tests**, and the CP/M bridge suite passed **2 tests**.

The qualified behaviours are:

- `read-char` and `write-char` forward only the shared
  `z80-services` byte-gateway meanings;
- CP/M echo, line editing, CR/LF translation and Control-Z/EOF remain owned by
  `tools/cpm-effects.ts`, rather than leaking into the shared contract;
- text, raw frames, mixed streams, normalized/raw events, bounded files,
  staged replacement, sync, abort and checked unsupported-capability errors
  are deterministic at the provider boundary;
- the same logical Triptych control transcript is accepted by independent
  provider backends; unsupported capability numbers fail without backend
  writes.

## Interpretation

This closes the provider-boundary predicate for the host-side effects library.
`MemoryFileBackend` and the recording/Triptych providers are deliberately
non-CP/M provider implementations, so the wire and file semantics no longer
depend on BDOS. The CP/M bridge remains an adapter, not the universal API.

The Stage 5 acceptance gate remains open in one important respect: a generated
Skate program must still produce an equivalent canonical trace through CP/M
and a real non-CP/M running-program provider. The current generated runtime
calls its CP/M console bridge directly, and no host-side compiler replacement
has been silently introduced. The next implementation slice is therefore to
define the smallest generated-program trace fixture, run it through the CP/M
bridge and a Deno/Triptych provider, and record explicit unsupported-capability
behaviour before adding richer storage or device operations.

ESP32 is not part of this evidence or its acceptance gate.
