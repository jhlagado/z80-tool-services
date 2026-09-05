# Native NOBJ ATOM migration

The common NOBJ consumer and its Atom and Nucleus profiles are canonical ATOM
source. Both native proof suites assemble these files unchanged with `atom-z80`
at `802b5c2d320bec777f427755ff2d7338e3b80a05`. The host Nucleus parser used for
comparison is 0.3.1 at `b5276a85fd36600a10dbd65039f0af3afc033f0d`; execution uses
`debug80-runtime` at `b7343aa8c38c248abbc6ee801b4af270d4843ad6`.

ATOM accepts symbols of at most eight characters. These source constants were
renamed without changing their values or the memory layout. Internal branch
labels were also shortened. Callbacks `ZN_READ`, `ZN_REW`, `ZN_PROF`, `ZN_INIT`,
and `ZN_STORE`, and entries `ZN_MAT` and `ZN_VALID`, retain their names.
The two AZM `@` global-label markers on `NN_BAD` and `NN_FAIL` were removed;
ordinary ATOM global labels retain those names and branch targets.

| Previous constant | ATOM constant |
| ----------------- | ------------- |
| ZN_ADDRLO         | ZNADDRLO      |
| ZN_ADDRHI         | ZNADDRHI      |
| ZN_ENTBNK         | ZNENTBNK      |
| ZN_PROFILE        | ZN_PROFL      |
| ZN_STOREE         | ZNSTOREE      |
| ZN_COMMIT         | ZNCOMMIT      |
| ZA_PCOUNT         | ZAPCOUNT      |
| ZA_PSTART         | ZAPSTART      |
| ZA_TMPEND         | ZATMPEND      |
| ZA_WORDLO         | ZAWORDLO      |
| NM_ENTRYBANK      | NM_ENTBK      |
| NM_VECTOR         | NMVECTOR      |
| NM_BSSEND         | NMBSSEND      |
| NM_LOADBANK       | NM_LDBNK      |
| NM_LOADLEN        | NM_LDLEN      |
| NN_PATCHES        | NN_PATS       |
| NN_BANKINDEX      | NN_BANKI      |
| NN_ROBASE         | NNROBASE      |
| NN_AGBASE         | NNAGBASE      |
| NN_TMPBANK        | NN_TBANK      |
| NN_TMPEND         | NNTMPEND      |
| NN_PATCHINDEX     | NN_PATI       |
| NN_ORDINAL        | NN_ORD        |
| NN_PSTART         | NNPSTART      |
| NN_WORDLO         | NNWORDLO      |

Consumer searches in the qualified ATOM and Nucleus trees and the downstream
Debug80 tree found no external references to these renamed constants. The
generated named-object service ABI include retains all names and values.
Consumers outside those surveyed trees that refer to the old constants must
update their source using the table above; this is a source-level compatibility
change. The separate CP/M renderer retains its existing public names because
the qualified ATOM CP/M adapter consumes them.

The native Nucleus validator still rejects overlapping PATCH records, although
the current host parser accepts them with the last serialized write winning.
The tests retain that explicit distinction, flat and banked image checks,
failure-before-write checks, callback register clobbering, and memory canaries.
ATOM does not implement AZM's static register-contract checker; the `;@ROUTINE`
comments document contracts and the runtime proofs test the exercised paths.
Every native invocation checks its return PC, balanced SP, and preserved IX/IY
on success and failure. Provider callbacks deliberately clobber BC, DE and HL.
These execution checks cover the test corpus; they do not replace static
analysis of paths that the corpus does not execute.

No frozen NOBJ harness bytes or symbol maps existed in the baseline repository
or its tracked history. No AZM assembly was run for this migration. The existing
755-byte common consumer, 1,147-byte Atom profile, and 2,270-byte Nucleus profile
extent assertions remain independent baseline checks, alongside the existing
behavioral corpus and review of the symbol-only source changes. This evidence
does not establish an independently measured byte-for-byte baseline comparison.

## Qualification on 2026-09-05

The implementation agent and lead each ran `npm run check`: all 100 tests,
type checks, lint, formatting, and packed-install smoke checks passed. The 34
native tests include assertions for all 25 renamed constants and the unchanged
20-, 49-, and 94-byte state sizes.

Two independent read-only reviewers checked the final diff and reported no
remaining findings. Review caught a stale package-version assertion, which was
updated to 0.2.0 before the final checks. Both reviewers independently verified
the 96 one-to-one symbol renames and unchanged instruction operands, with the
two documented global-label markers removed. The reviewers did not repeat the
heavy execution tests. These results concern host execution and packaging;
they are not hardware measurements.
