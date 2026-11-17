# Next generated-code scope for managed eval preparation

The coordinator selected **eval first**: cache steady-state immutable-surface
contract/type-system preparation once per process, measure J's bounded
1,000-eval fixture and an A1 eval-* statementList variant, then consider AOT
metadata only if first-eval setup remains significant. Dense arrays are deferred;
J separately owns ordinary Script array/buildString fast paths. This supersedes
the preference ordering below, which is retained as the scoped alternatives.

The local condition-branch slice is on main. The following field-forwarding
experiments remain held: their operation benchmark improves, but their early
scheduling increases whole-compiler instructions and cycles. Conservative late
scheduling restores the baseline-sized image and changes only two runtime
bodies by 80 static instructions. It does not reach the large program module.
See the [assessment](native-record-values-assessment-v1.md),
[late preparation](native-record-values-late-preparation-v1.md), and
[native hot-function table](native-hot-functions-v17.md).

Two larger representation changes remain plausible. Neither speedup is yet
measured in a managed eval image. The next scope choice is between them.

| Candidate | Native evidence motivating it | Required implementation boundary | Main proof obligation |
| --- | --- | --- | --- |
| Origin-aware private dense arrays inside managed images | Dense encoding previously reduced matched native compiler CPU 1,576.460→397.927 s; historical eval samples spend 15–64% in sparse-list lookup | Compiler lowering, private record/function cloning, managed-frame escape analysis | Every converted allocation and alias remains private; public frame layouts and observable array behavior remain unchanged |
| AOT-encoded invariant managed type/signature metadata | J's early snapshot spends 87.6% inclusively in canonicalization/serialization; later snapshots are wholly within type/signature preparation | Managed directory generation, immutable native data emission, directory reader/contract indexing | Exact type identities, descriptor authority, recursive types and per-realm behavior match reconstructed metadata |

The [3.96x dense result](native-codegen-dense-inline-selfbuild-v1.md) is an older,
different compiler graph. It supports a representation hypothesis, not an
eval-speedup forecast. J's percentages are short inclusive snapshots, not
whole-run shares; compiler initialization is cached once. The proposed work
does not optimize checker algorithms or assume every map lookup is excessive.

## Preferred first scope: private arrays with explicit escape proof

The current gate is `surfacePlans.length === 0` in
`packages/compiler/src/native/index.ts`, around line 1018. Removing it is unsafe.
`lowerReferenceLists` in `packages/ir/src/optimization/reference-lists.ts`
requires one private header and declines raw inspection or unrecognized aliases.
Managed surfaces can expose list carriers to independently compiled code.

A concrete first implementation would:

1. Classify allocation origins and their transitive aliases against managed
   frame inputs/outputs, function addresses, closures, raw inspection and unknown
   calls. Decline conversion for unknown or escaping groups.
2. Reuse the existing dense element encodings for proven-private groups. Where
   a physical header or generic helper is shared with public groups, append a
   private layout and clone the necessary helper family; redirect only proven
   private calls and allocations. Do not reinterpret public sparse headers.
3. Leave managed directory/frame signatures unchanged. If that cannot be proved,
   stop the private-only slice and make the ABI migration a separate decision.
4. Measure emitted indexed-read paths and allocation/root traffic in an actual
   eval-preparation image. Require fewer instructions/cycles there, not only a
   closed CLI benchmark.

Validation must cover holes versus present undefined, growth/truncation,
sparse migration, aliases, captured lists, moving GC, exception paths, escaping
arguments/results, unknown callbacks, descriptor inspection and unsound
assertions. All declined cases retain the current encoding. Existing work and
specialization bounds stay unchanged. Native fixtures, source-pinned Test262
outcomes, a fresh frozen self-build and identical stage images remain gates.

## Alternative first scope: immutable metadata encoding

The concrete boundaries are `managed-directory-reader.ts`,
`managed-surface-text.ts` and `managed-contracts.ts` under
`packages/compiler/src/native/`. Emit an immutable, content-identified table for
the invariant managed type/signature plan using Tint's own data/linking support.
Keep per-eval bindings, script syntax hashes and mutable realm state separate.
The runtime must validate the table's schema, layout/descriptor identities,
target representation and source/toolchain identity before using it; unknown or
incompatible metadata must retain the existing checked path.

This direction needs a data-format decision and malformed/recursive metadata
tests before implementation. It must not merge distinct Script node identities,
silently trust TypeScript assertions, bypass descriptor authority, share mutable
state across realms, or change fresh-process isolation and execution budgets.

The private-array direction has stronger existing native performance evidence;
the metadata direction targets the fixed first-eval preparation more directly.
Both are larger compiler/runtime representation projects than the held local
field-forwarding slice and touch contracts used by other clusters.
