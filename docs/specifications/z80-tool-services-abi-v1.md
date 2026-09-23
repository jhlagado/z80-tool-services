# Z80 Tool Services ABI v1

Status: authoritative

Date: 2026-08-27

The contract text is maintained by `@jhlagado/z80-tool-services`. The older
Debug80 copy is retained as historical provenance while consumers move to this
authority.

## Scope

This ABI gives Z80 development tools a portable way to read and publish named
binary objects. Source files, prepared source parts, work spools, NOBJ files,
and target images can all use the same operations. Filesystem path resolution,
CP/M FCBs, TEC-FS catalogue lookup, records, sectors, allocation blocks, and
Node file descriptors remain inside the selected provider. The ABI deliberately
has no `resolvePath` operation.

The ABI has three separately versioned pieces:

- the 16-byte request and result block defined here;
- a platform transport that invokes one provider request; and
- a compiler-specific adapter between Atom or Nucleus and that transport.

Atom and Nucleus retain their compact internal callback contracts. The shared
ABI begins in their harness adapters and does not add general service calls to
either assembler or compiler core.

## Z80 call contract

A native client puts the platform's object-service selector in `C`, the request
address in `HL`, and calls the platform tool-service gateway. A successful call
returns carry clear and `A=0`. A failed call returns carry set and a nonzero
canonical status in `A`.

The gateway preserves `IX`, `IY`, stack depth, and the caller's selected bank.
It may change `BC`, `DE`, `HL`, and non-carry flags. A platform binding may use
a different selector or entry address, but it must preserve the request,
result, register, stack, and bank contract.

The request, name, and transfer buffer occupy memory visible to the provider
for the synchronous call. The provider retains no caller pointer after return.

## Request block

Every request is 16 bytes. Words and the double word are little-endian.

| Offset | Size | Field       | Meaning                                         |
| -----: | ---: | ----------- | ----------------------------------------------- |
|      0 |    1 | `size`      | must be 16                                      |
|      1 |    1 | `abi`       | must be 1                                       |
|      2 |    1 | `operation` | operation number                                |
|      3 |    1 | `flags`     | must be zero                                    |
|      4 |    2 | `handle`    | input or returned opaque handle                 |
|      6 |    2 | `pointer`   | name or transfer-buffer address                 |
|      8 |    2 | `length`    | name length or requested transfer length        |
|     10 |    4 | `offset`    | absolute byte offset for `seek`; otherwise zero |
|     14 |    2 | `result`    | transferred byte count; otherwise zero          |

The client initializes every field before each call and sets unused fields to
zero. The provider sets `result` to zero before attempting the operation. A
wrong size or revision, nonzero flags, nonzero unused fields, or a memory range
outside the provider-visible address space returns `invalid`.

Object names are byte strings of 1 through 255 bytes and have no terminator.
The project or deployment profile defines their logical syntax. A provider may
apply tighter character, path, and capacity rules. Handles are opaque nonzero
16-bit values and are valid only for the provider generation that issued them.

## Operations

| Number | Operation    | Inputs                                                            | Success result                                  |
| -----: | ------------ | ----------------------------------------------------------------- | ----------------------------------------------- |
|      0 | `openRead`   | name `pointer` and `length`                                       | readable `handle` at offset zero                |
|      1 | `beginWrite` | name `pointer` and `length`                                       | tentative update `handle` at offset zero        |
|      2 | `read`       | readable or update `handle`, buffer `pointer`, requested `length` | `result` bytes copied                           |
|      3 | `write`      | update `handle`, buffer `pointer`, requested `length`             | `result == length`                              |
|      4 | `rewind`     | readable or update `handle`                                       | cursor becomes zero                             |
|      5 | `seek`       | readable or update `handle`, 32-bit `offset`                      | cursor becomes `offset`                         |
|      6 | `close`      | readable `handle`                                                 | handle released                                 |
|      7 | `commit`     | update `handle`                                                   | tentative generation published; handle released |
|      8 | `abort`      | update `handle`                                                   | tentative generation discarded; handle released |

A zero-length read or write succeeds after validating the request and handle.
A nonzero read may return fewer bytes than requested. A successful read with
`result=0` means end of object; EOF is not a status value and cannot collide
with a data byte. A successful nonzero write transfers the complete requested
range or fails.

`seek` uses an unsigned 32-bit absolute offset. A provider may return
`unsupported` when it cannot represent a requested position. If it permits a
write beyond the current end, the resulting gap contains zero bytes.

## Status values

| Value | Name          | Meaning                                                    |
| ----: | ------------- | ---------------------------------------------------------- |
|     0 | `success`     | operation completed                                        |
|     1 | `invalid`     | malformed request, field, state, or handle use             |
|     2 | `unavailable` | required service or capability is absent                   |
|     3 | `notFound`    | named committed object does not exist                      |
|     4 | `capacity`    | handle, storage, name, or deployment capacity is exhausted |
|     5 | `access`      | operation is not permitted for this object or deployment   |
|     6 | `storage`     | underlying storage failed                                  |
|     7 | `conflict`    | another live update prevents the requested operation       |
|     8 | `cancelled`   | operator or outer host cancelled the operation             |
|     9 | `unsupported` | valid operation is unavailable for this object             |

## Transactions and failures

`beginWrite` creates a tentative replacement. Readers continue to receive the
preceding committed bytes until `commit` succeeds. `commit` publishes the
complete tentative generation atomically and releases its handle. `abort`
discards the tentative generation and releases its handle. An update handle
must finish with one of those operations; `close` applies only to a read
handle.

A failed operation never changes the committed object. These additional rules
apply:

- a failed open allocates no handle;
- a failed read, seek, or rewind leaves the cursor unchanged;
- a failed write leaves the cursor unchanged and poisons the tentative update;
- a poisoned update accepts only `abort`;
- a failed commit leaves the preceding generation current and the update
  available for an explicit abort or a provider-defined retry; and
- `abort` releases the logical handle even when physical cleanup reports an
  error.

An outer harness calls `abortAll` or its native equivalent when execution ends
without a normal close, commit, or abort sequence.

## Published authorities

`@jhlagado/z80-tool-services` publishes the TypeScript constants, provider
types, client, memory reference provider, and reusable conformance vectors. Its
generated `native/z80-tool-services-v1.asmi` contains symbols no longer than
eight characters so Atom can consume it directly.

Every provider must pass the shared vectors plus platform-specific failure
injection. Native gateways additionally prove exact carry, status, register,
stack, bank, request-memory, and transfer-buffer effects. Adding an operation,
field, flag meaning, or changed failure effect requires a new ABI revision.
