# Z80 portable conformance record v1

**Status:** experimental shared proof format

**Owner:** `z80-tool-services`

This document defines the record used to compare a qualified Z80 program run
across hosts. It is a result format, not a CPU ABI and not a replacement for a
machine or operating-system profile. A record describes one bounded run and
keeps the host substrate, machine profile and service providers visible.

## Required shape

Every record is a UTF-8 JSON object with these fields:

| Field        | Meaning                                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| `schema`     | Exactly `z80-portable-conformance-v1`.                                                |
| `profile`    | The immutable machine, OS or bare-host profile used for the run.                      |
| `source`     | The logical source identity and SHA-256 of the source bytes, when the run has source. |
| `artifact`   | The loaded or produced artifact, including kind, address range, bytes and SHA-256.    |
| `diagnostic` | `null` for a diagnostic-free run, or the profile's canonical diagnostic object.       |
| `execution`  | The bounded run outcome and observable counters.                                      |
| `provenance` | Toolchain, substrate and compatible-host information.                                 |

The record must not contain absolute paths, host stack traces, timestamps,
random identifiers or other values that make the same qualified run differ
between machines. A provider may keep those details in a separate local log.

## Source and artifact identity

`source.logicalIdentity` is a stable project-relative identity, not a host
path. `source.sha256` hashes the exact source bytes supplied to the compiler or
assembler. If no source exists, `source` is `null`.

`artifact.kind` identifies the loaded representation, for example
`flat-binary`. `artifact.base` and `artifact.end` are half-open addresses in
the profile's address space. `artifact.bytes` is the exact byte sequence at
that range, and `artifact.sha256` hashes those bytes. A record with generated
or assembled output must include all four artifact fields; a record for a
pre-existing image may use a profile-specific kind but must still identify the
bytes that were executed.

## Execution outcome

`execution.status` is the profile's stable outcome class. `committed` means a
tool-service transaction published its output. Machine-only records may use a
profile-defined class such as `halted`, provided the profile documents it.
`execution` may contain bounded counters (`instructions`, `cycles`, `steps`,
`tStates`), a stop reason, selected final registers, service-call counts and
other observations. Counter names are case-sensitive and are only comparable
when the profile says they have the same meaning.

The record must distinguish a successful stop from a step, cycle or resource
limit. A host must not convert a trap, timeout or unsupported capability into a
successful result.

## Diagnostics

`diagnostic` is either `null` or an object owned by the profile. Shared
comparison requires stable fields for code, logical source identity, position,
message class and normalized message text. Host paths, stack formatting and
colours are not part of the comparison.

## Provenance and comparison

`provenance` identifies at least the assembler or compiler, its version, the
execution substrate and the host labels for which the result is valid. It may
also include immutable component revisions. A compatible host label is an
assertion backed by a checked-in test, not a promise that every host can run
every profile.

Two records are equivalent only after their `profile` values are compatible.
For compatible profiles, comparison is byte-for-byte for source and artifact,
structural for diagnostics, and field-by-field for the declared execution
observations. Host-specific provenance may differ without making the guest
result different.

## Current qualified records

- Atom's bare-host proof is checked in at
  `atom/proofs/stage-1-atom-host.json` and is currently exercised under Node
  and Deno on the Debug80 reference substrate.
- Triptych's `atom-stage1-halt` fixture is the corresponding Rust CPU proof.
  Triptych derives its normalized record from that fixture for its native and
  WASM qualification; the Rust fixture remains the executable authority for
  the machine result.

These records intentionally keep `atom-bare-host-v1` and the Triptych CPU
profile distinct. They compare the common artifact and declared observations;
they do not imply that a CP/M guest profile and a bare Atom host have the same
services.

## Change rule

Changes to required fields or their meanings require a new schema version.
Adding an optional profile-owned observation is compatible only when old
consumers can ignore it without changing the required comparison. A generated
record is derived evidence and must name the fixture, source and toolchain that
produced it.
