# Slice 3 and slice 2b validation

The compiler evidence is for `e0c7cf4a1ed496240600254398860e0caffe5705`
on `feat/slice-3-and-2b`, including local main
`d0f9be3d28c514fb6726332d18a546e745c7a286`. The runs used Node 24.12.0.
The gate, native ledger and frozen comparison ran from the same checkout
with no changes to compiler or runtime sources.

| Gate | Exit | Result |
| --- | ---: | --- |
| macOS native subset | 0 | Compiler entry reached `checked` after specialization. |
| macOS workspace check | 0 | 5,988 concurrent, 238 memory and 190 native passes. No failures and 36 native skips. |
| macOS storage and bootstrap | 0 | Seven storage tests passed. All three stage images matched, each 49,569,546 bytes. |
| Linux arm64 on `dev` | 0 | Build and seven storage tests passed. All three stage images matched, each 49,179,064 bytes. |
| Test262 host smoke | 0 | Units 2/2 in 415 s and whole program 2/2 in 251 s. |
| Frozen main | 0 | Hosted and native comparisons produced identical 48,958,602-byte images. |

The macOS stage SHA-256 was
`8d8d39a63aebf20a6076e23f3bebeaa2fa7292e644400fddbe020cd6adbd5d33`.
The Linux stage SHA-256 was
`ce5d3ded69534695452f28d82536f6cc79443eb62e03cf6749881d223be6a36c`.
Stage 2 and 3 inferiors on both targets stopped at entry and exited 0
under LLDB. The detached gate logs are in
`.tint-bootstrap/gate.3Buu5m6G` and `.tint-bootstrap/gate.g1zdUerg`.

The frozen input uses main’s catalog and all of its original source bytes.
The hosted comparison loaded that catalog with `--source-root`. The
native CLI embeds its catalog. Its first run against the older tree
exited 1 with `cannot read packages/foundation/src/values/primitive-contract.ts: open`.
For the native comparison, a common copy of the frozen tree included
the seven additional catalog files so both CLIs could open their inputs.
Main’s image stayed byte-identical to its image from the original tree.
Both native inferiors stopped at entry and exited 0. Both comparisons
returned `cmp=0` with SHA-256
`f20133194ffd2cdfc964852a01a3f92d71ce15b2c2d9b1be20b79b06a1fba6b7`.

The Test262 smoke used checkout `91c70759363c46557b694792bf34a2551a7af5ba`.
Both smoke logs contain preparation `STALL` heartbeats while the
Node compiler was active. Each run subsequently recorded two passes.

## Corpus

Run `tools/unified-pipeline/ledger.ts` with four jobs on the macOS build
host, targeting `linux-aarch64` with the `linux-dev` runner and
`TINT_LINUX_DEBUGGER_LAUNCH=lldb`. The source flags were
`TINT_SOURCE_VALIDATION=1 TINT_SOURCE_REPLAY=1 TINT_FUNCTION_FALLBACK=1`.
The [198-form ledger](unified-pipeline-ledger-slice3-and-2b-e0c7cf4a1-dev-lldb-v1.json)
exited 0 with no regressions across the 168 forms in the
[slice 4a baseline](unified-pipeline-ledger-slice4a-final-b0e612698-dev-lldb-v1.json).

| Form | Typed | Mixed | General | Expected type error | Build failure | Run failure | Unsupported option |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Typed | 46 | 10 | 37 | 2 | 3 | 0 | 1 |
| Untyped | 0 | 0 | 96 | 0 | 1 | 1 | 1 |

The shared `arguments-object` typed fixture moved to mixed.
`explicit-field-contract` typed now passes. The proven
`typed-array-index` case builds and runs. The unproven case and
`type-error-after-generator` report TS2322 at the original source span.
The ledger records 15 open-slot advisories.

Direct eval in `explicit-binding-contract` now stops at build time with
`direct eval requires the hosted evaluator and shared binding contracts`.
The typed iterator fixture still reports `fixture: expected {` at the
`implements` clause. The typed weak-collections fixture reports
`fixture:85:91: unknown type: object`, and the untyped form retains
native exit 70. The unchecked-index option is still unavailable.
The [gap table](../unified-pipeline.md#known-typed-only-gaps-and-the-slice-that-removes-them)
tracks callable ABI, capture layout, aggregate view and byte-storage work.

A separate Linux arm64 fixture used two mutually importing modules.
`second` observes `arguments.length` and shadows `Math` with a local
object, then calls back into `first`. The general module cycle ran
twice under LLDB and exited 42 each time. Its image was
`8f1e90c9b29e4e82e2b748be9bf38f416e32bf526fdc2f128df30a4c2737ceca`.
The source snapshot matched the ledger,
`5d39be25bff4a6c754473d32eb7405f9317b286f237a9271473d586938f57e04`.

## Focused results and budgets

- [Ordinary calls](slice3-ordinary-functions-focused.md)
- [Classes and suspended functions](slice3-classes-and-suspension-focused.md)
- [Native views](slice2b-views-focused.md)
- [Nested bindings](slice3-nested-focused.md)
- [Startup, crossing cycles, allocations and replay](slice3-primitive-budgets.md)

The first validated ledger exposed source-valid library and module
operations without capability metadata. A focused admission audit then
classified all 34 baseline typed forms that previously used module
fallback. Earlier macOS gate logs retain the import boundary, assertion
and script-surface census failures corrected before the final run.
