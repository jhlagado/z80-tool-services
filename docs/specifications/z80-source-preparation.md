# Z80 source preparation contract

This contract refines the source boundary in the
[portable Z80 platform architecture](../architecture/portable-z80-platform-v1.md).

The contract text is maintained by `@jhlagado/z80-tool-services`. The older
Debug80 copy is retained as historical provenance while consumers move to this
authority.

## Purpose

Source preparation turns one entry source into ordered source parts for a
streaming Z80 compiler or assembler. It owns filesystem-facing work. The
language processor receives bounded byte sources and never needs to understand
paths, directories, dependency graphs, or project configuration.

The shared Node implementation is exported as:

```text
@jhlagado/z80-tool-services/source-preparation
```

Native Z80 systems implement the same observable rules over their own file or
object services. They do not run JavaScript and do not parse Node project JSON.

## Boundary

Source preparation owns:

- resolving an entry and its dependencies;
- confining physical reads to a project root where the host has directories;
- assigning stable source identities;
- detecting cycles and duplicate identities;
- ordering dependencies before their importer;
- enforcing source-graph capacities;
- joining path-keyed placement on hosts that support placement; and
- retaining provenance for diagnostics and generated maps.

The language profile owns:

- recognizing its dependency directives;
- evaluating language-specific host conditions;
- deciding which source bytes reach the compiler; and
- preserving the compiler's source-position contract.

The compiler or assembler owns tokens, symbols, types, expressions,
instructions, directives that affect generated code, and final undefined-name
checks.

Artifact rendering and publication occur after compilation. They are not part
of source preparation.

## Source identities

Every source snapshot has three identities:

| Identity            | Meaning                                                                  |
| ------------------- | ------------------------------------------------------------------------ |
| Physical path       | The canonical host path that was opened                                  |
| Dependency identity | The canonical key used for import-once and cycle checks                  |
| Logical identity    | The stable project-relative name used in diagnostics, listings, and maps |

Two requests for one dependency identity must produce one logical identity.
Conflicting aliases are an error. A source is snapshotted on its first read;
later filesystem changes do not alter the current build.

On a directory-based host, absolute paths, lexical root escapes, and symlink
targets outside the project root are errors. Path matching preserves the
physical filename's capitalization. A request with conflicting capitalization
is rejected instead of becoming a second identity.

A native host with flat names may use its normalized object name for all three
identities. It still applies import-once and cycle rules to that canonical key.

## Language profile

The resolver calls two profile operations:

```js
profile.inspectEntry(entrySnapshot, configuration);
profile.inspectDependency(dependencySnapshot, entryState);
```

The entry inspection returns the immutable state shared by all dependency
inspections. Each inspection returns:

- compiler bytes;
- dependency specifiers with source locations; and
- ranges hidden or transformed by the profile.

Compiler bytes must have exactly the same length as the original source bytes.
Profiles preserve CR and LF bytes. A source-part ordinal and byte offset then
identify the same position in the compiler view and the original file.

Atom masks `%INCLUDE`, `%DEFINE`, conditional directives, and inactive lines
with ASCII spaces. Nucleus may use a comment-shaped dependency directive and
pass its remaining bytes through unchanged. These policies share the resolver
without sharing language syntax.

## Dependency order

Resolution is deterministic depth-first postorder:

```text
main imports display, input
display imports hardware
input imports hardware

result:
hardware
display
input
main
```

Dependencies precede their importer. Sibling order follows the directives in
the importer. A dependency diamond contributes one part. Repeating the same
dependency from one importer also contributes one part. A cycle is rejected
with the active edge sequence and the location of the edge that closed it.

The resolver passes its ordered source-part records directly to the consuming
tool. It writes no intermediate ordering file.

## Placement

Placement is optional host policy keyed by logical identity. A default bank
may apply to every part, with explicit path assignments overriding it. The
resolver rejects conflicting aliases, assignments for sources outside the
resolved graph, missing assignments when no default exists, and bank ordinals
outside the selected host's limit.

Flat Atom builds use bank zero. Placement never changes dependency order.

## Capacities

The Node implementation defaults to:

| Capacity                              |           Limit |
| ------------------------------------- | --------------: |
| Source parts                          |             255 |
| Dependency depth, including the entry |              64 |
| Logical identity                      | 255 ASCII bytes |
| Retained logical identities           |    65,536 bytes |
| Bank ordinal                          |             255 |

A caller may lower these limits for a native target. Exact limits are accepted;
the first excess value fails before compiler execution.

The source-part byte limit belongs to the consuming compiler ABI rather than
the graph resolver. Atom uses a 16-bit source offset, so each part may contain
at most 65,535 logical bytes.

The byte-level source-read ABI has a wider ordinal byte than any one resident
driver normally exposes. Atom's native driver uses source-part ordinals
0 through 254 for its 255 ordered parts and leaves byte value 255 available to
lower parser and diagnostic records. Nucleus's resident source descriptors use
ordinals 1 through 255 so byte value zero can mean no part at that boundary.
Both shapes preserve the same 255-part resident capacity; the resolver result
is adapted to the selected driver before compiler entry.

## Result

Each ordered part contains:

- ordinal and bank;
- physical, dependency, and logical identities;
- original and equal-length compiler bytes;
- direct dependency records;
- masked or transformed ranges;
- the active include stack; and
- immutable diagnostic provenance.

The result also contains the bank array, entry profile state, and retained-path
byte count. The compiler receives descriptors and a byte-read service derived
from these records. It does not receive project JSON or a dependency graph.

## Failures

Preparation fails before compiler execution for invalid roots, missing or
escaping sources, identity conflicts, cycles, invalid profile output, changed
source length, placement errors, and capacity excess. A failure carries a
stable category and code and, when available, the original source location.

No output generation begins until preparation succeeds. A preparation failure
therefore cannot replace an earlier object or artifact.

## Platform profiles

| Platform     | Preparation and byte service                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Node/Debug80 | Shared JavaScript resolver; immutable JavaScript source snapshots returned one byte at a time to the emulated Z80                |
| CP/M         | Native include scanner over current-drive names; 128-byte random-record source cache; no JSON parser                             |
| TEC-native   | Native leading-include resolver over TEC-FS; canonical one-byte catalogue identities and bounded descriptor tables in common RAM |

The current CP/M and TEC profiles recognize leading `%INCLUDE` only. They do
not implement Node's `%DEFINE`, `%IF`, `%ELSE`, `%ENDIF`, or `INCBIN` profile.
Both native profiles support up to 255 source parts and preserve Atom's
65,535-byte per-part offset domain. The TEC resolver normalizes one path in a
164-byte common-RAM scratch area, then retains its canonical catalogue ID
rather than the path text.

“Native” means execution on, or close to, a real Z80 environment such as CP/M
or a TEC-1G. Running the Z80 core through Debug80 on Node is an emulated host
profile.
