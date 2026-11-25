# Typed Node FFI overhead investigation on Darwin arm64

The benchmark at `3e9330045dcf98e8f428d2634fbc66dddc4e997c` now
runs Node 26.13.1 and four Tint workloads against the same C library.
Tint runs the typed and untyped loop with both literal and runtime
signatures. The typed builds require typed compilation. The untyped
builds report general lowering. The four baseline images each reached
exit 42 under LLDB and checked the warmup and measured sums for all
nine FFI cases and the control. The baseline images were built from the
`8cf9a9389` compiler and runtime with the new benchmark workload.

Each workload has a JavaScript-only control with the same loop,
accumulator, and indirect operation call. For each case and round, the
runner subtracts its own workload's control time, then reports the
median of the paired differences in nanoseconds per call. It also
records each workload's separate call and control medians. Ten rounds
rotate the five workloads through each launch position twice. Each case
has 20,000 warmup calls and 100,000 measured calls.

The timing runner takes the shared timing lock, requires system idle
above 95% before the round and in each one-second interval during the
round, and releases the lock between retries. The baseline attempt has
accepted zero rounds. A qualifying latency report and typed parity
remain pending.

## Main-thread attribution

PProfessor attached at 997 Hz after LLDB reached each selected C entry.
The capture ended at the next case's C entry or `dlclose`. All five
longer captures reached inferior exit 42, and `pprofessor analyze` read
each capture. These are diagnostic samples collected during the same
workload, with up to five million calls per case.

| Typed definition | Case     | Sample records | Observed work                                                                                                   |
| ---------------- | -------- | -------------: | --------------------------------------------------------------------------------------------------------------- |
| Literal          | Arity 0  |            316 | `callObject`, realm-context construction, and `runScriptContext` around the numeric ABI entry                   |
| Literal          | Arity 24 |          2,540 | Repeated `scalarKind` classification in the generated adapter, `pushList`, and reference-list reads and writes  |
| Runtime          | Arity 0  |            421 | `callObject`, realm entry, and `invokeScalar` around the cached native frame                                    |
| Runtime          | Buffer   |            663 | `invokeScalar`'s pointer argument path, general type classification, object projection, and list initialization |
| Runtime          | Callback |          1,452 | Callback argument-list growth and capture decoding, return conversion, and the surrounding call path            |

The Buffer path passes the stable backing address plus offset. The
callback path runs a registered native trampoline and caches capture
views for each recursive depth. The experiments cover three adapter costs.

- Reuse the active realm context or a cached context for a typed native
  caller. All four candidate workload images passed under LLDB.
- Check the Buffer object view before the BigInt and string branches.
  Prepare the callback result codec and register offset at registration
  and initialize the fresh callback argument list with its first value.
  The typed runtime candidate reached exit 42 in both captures.
- Resolve the scalar codec when generating the static adapter. The
  baseline arity-24 capture showed repeated invocations of `scalarKind`.
  The candidate capture had no sampled scalar classification frames and
  reached exit 42.

The compiler and runtime tree has returned to the baseline. The
candidate captures establish code-path attribution. A qualifying
paired overhead measurement is still needed to select changes.

## General call costs

A typed loop calls the exported FFI callable through `generalCall`,
which uses `packCallArguments` to build a managed list before entering
the FFI wrapper. Untyped lowering constructs its list in `argumentList`
and dispatches it with `invokeList`. Removing these allocations for a
callable returned as a realm value requires changes at those lowering
sites. [`generalCall`](../../packages/ts-native/src/scalar.ts#L5135),
[`argumentList`](../../packages/js-engine/src/lowering/index.ts#L1509)

`callGeneralValue` projects the callable, then calls `callObjectValue`,
which projects it again. `callObject` builds a thunk for realm entry
and returns an error/value record. These general paths belong in the
separate compiler stream. The FFI-owned callback argument list forms
after the ABI transition, inside `ffi-callbacks.ts`.
[`callGeneralValue`](../../packages/js-runtime/src/objects/values.ts#L214),
[`callObject`](../../packages/js-runtime/src/objects/call.ts#L11),
[`dispatch`](../../packages/native-runtime/src/node/ffi-callbacks.ts#L159)

## Validation provenance

The benchmark and resource-classification tests passed 7/7. The
compiler and runtime sources match `8cf9a9389`. At that revision all
25 upstream files and the missing-build control reached LLDB exit 42,
with 94 passes, 25 diagnosed limits and 3 upstream skips. The three
SharedArrayBuffer cases that depended on shared mappings pass through
the shared-block registry.
[Full Node 26.13.1 native suite](node-ffi-v26.13.1-darwin-arm64-8cf9a9389-v5.json)

Compared with main at `1e56551e3`, the leaf images were byte-identical
(SHA-256 `9100616df7d3978a91d1dd21f89b562aa261b4faca907d59588461fcb8868753`).
The frozen v7 compiler run emitted identical output
(SHA-256 `68c11052966f4a851b875c23b6a3413abc74262cec1460532dba09c624d17846`).
These artifact comparisons were run on the same compiler and runtime
sources before the benchmark harness update.
