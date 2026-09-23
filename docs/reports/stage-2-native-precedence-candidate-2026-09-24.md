# Stage 2 native precedence-climber candidate: 2026-09-24

This is a bounded candidate for the Nucleus–ATOM reconciliation. It is not a
release or a change to the user's active `compiler-rewrite-12k` checkout.

## Candidate

| Item | Revision or location |
| --- | --- |
| isolated worktree | `/tmp/nucleus-atom-precedence-climber` |
| branch | `atom-precedence-climber` |
| base | qualified native-adapter line `79f11c3` |
| candidate commit | `3ca16f4` |
| production assembler | ATOM only |

The candidate replaces the native typed-expression parser's separate
multiplicative, additive and comparison loops with one precedence-climber.
Multiplication, division and remainder bind tighter than addition and
subtraction; comparisons bind last and remain non-associative. The source is
written in the native ATOM syntax and keeps the existing diagnostic and stack
contracts. No AZM source, adapter or fallback was introduced.

## Evidence

The following gates passed in the candidate worktree:

```text
npm run check:release-source
  native source/image tests: 63 passed
  compiler-image reproducibility: passed
  TypeScript typecheck: passed

npx vitest run test/compiler.test.ts test/select-case.test.ts \
  test/while-true-fallthrough.test.ts test/nested-arrays.test.ts \
  test/standard-library.test.ts --maxWorkers=1 --reporter=dot
  5 files, 77 tests passed

npx vitest run test/proof-harness.test.ts -t \
  "executes general scalar symbols and precedence as direct Z80|executes typed scalar expressions and traps atomically as direct Z80" \
  --maxWorkers=1 --reporter=verbose
  2 tests passed

npm run check:runtime-boundary
  published runtime boundary excludes assemblers and proof-only modules
```

The intentional proof baselines for this algorithm are:

| Proof | ATOM instructions | Z80 T-states | notable extents |
| --- | ---: | ---: | --- |
| expression | 108,670 | 1,151,601 | front-end 8,604; parser 7,663; compiler core 12,286 |
| typed expression | 626,368 | 6,443,159 | front-end 8,604; parser 7,663; compiler core 11,186 |

The proof status and generated-output observations remain successful. The
changed counts are recorded rather than hidden because they are part of the
performance and capacity contract.

## Deliberate non-promotion

`npm run check:release-package` stops at the existing release-baseline guard:

```text
NUC.COM differs from release baseline: 21312 bytes,
c04a407641a5a988a23b8a69a940bf3d78498347c516ce876ae5e4a59e2e09d4
```

That is the correct result for an intentional compiler-code change. The
candidate does not update `cpm22-release-baseline.json`, `dist/NUC.COM`, the
package version or the published image. Promoting it requires a separate
review of the new CP/M artifact, a version decision, and the complete package
release checks. No release bytes were changed in any user checkout.

The repository-wide Vitest run was not used as a completion claim: its
single-worker native aggregate battery exceeded the observed bounded window,
so it was interrupted after the focused semantic gates passed.

## Next step

Review this candidate against the active `compiler-rewrite-12k` line. If the
precedence-climber is accepted there, port it selectively and regenerate its
artifact set; only then decide whether the resulting CP/M image warrants a
versioned release. Until that work is complete, Stage 2 remains
**migration-qualified on the separate native line and reconciliation-pending
on the active compiler-rewrite line**.
