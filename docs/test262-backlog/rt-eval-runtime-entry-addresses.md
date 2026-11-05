# RT-EVAL D6c: runtime entry address export and import contracts

Status: **D6c1–D6c4 implemented; D6c5 export-stub factory and checked resolver pass native validation; full runtime integration remains.**
The [native export-stub fixture](../results/native-runtime-entry-stubs-v1.json) covers
construction, final checked identities and lowering. All 3,842 workspace tests pass.
The [native static-address fixture](../results/native-function-address-emission-v1.json)
and [cross-module imported call](../results/native-function-entry-call-v1.json)
pass. The exception fixture's [first observation](../results/native-function-entry-throw-v1.json)
failed before entry during debugger launch. A separately recorded
[direct-debugserver observation](../results/native-function-entry-throw-v2.json)
passes exception propagation; its [provenance correction](../results/native-function-entry-throw-v2-provenance.json)
links the unchanged image to its actual build source.
The D6c2 [frozen self-build](../results/bootstrap-function-address-bindings-v1.json)
produced byte-identical stages; it predates D6c3/C4. No new Test262 passes are
claimed. Parent: [managed-entry lowering](rt-eval-managed-entry.md), slice D6c.
Directory v3 integration follows the [D6d plan](rt-eval-runtime-directory-v3.md).

Captured 2026-11-04 against live source identity `be257a8d…` (532 files,
`workspaceSourceIdentity`). Every `dist` file inspected was newer than its source.
The probes are read-only Node scripts in `/tmp/tint-runtime-entry-plan`
(`p1`–`p4`). They import public `dist` entry points and
`tools/workspace-sources.ts`. They emit no image, execute no native code and write
nothing in the workspace. **All probe results are non-native. No ABI, layout,
performance or conformance claim about native output follows from them.**

## 1. Answer in brief

1. **The blocker is real and narrow.** In an initializer, an identifier that names a
   retained top-level function fails lowering with
   `named function values require managed hoisted initialization`
   (`closure/lowering/index.ts:1478`; reproduced in p1 and p4). The parent's bind
   body (`functions: [table…, witnesses…, runtime…]`) therefore cannot box the
   retained collection instances. Witnesses avoid this only because the compiler
   leaves them unretained (`compiler/src/native/index.ts:349-359`), so
   `prepareModuleInstance` nests them as hoisted initializer locals.
2. **Option (a), initializer forwarders, works but is the weaker design.** A
   non-retained forwarder `function f(a, b) { return runtime(a, b); }` lowers as an
   environment-free closure (`closureEnvironment` and the `function-new`
   environment are both absent; p1, p4). Under the dense rewrite its call is
   retargeted to the dense clone. However, it needs a boxed container, and a
   `readonly unknown[]` container makes the whole dense rewrite decline (p2). It
   also adds ~300 callable, unchecked runtime-operation values to the managed heap,
   a generic "entry of any function" leaf and one extra call hop per operation.
3. **Chosen: option (b), compiler-authorized static address operations.** One new
   IR instruction, `function-address {target, part: "entry"|"signature"}`, yields
   a permanent image address as a `number`. Lowering binds it only through a
   compiler-selected identity stub (the exact `record-descriptor-address`
   precedent). Address words are stored in a `Float64Array`, like record
   identities today. No function value is boxed, no new host leaf is added and no
   environment can exist.
4. **Escape is the safety condition, not a detail.** `provenDirectOnlyFunctions`
   and `provenWordArguments` derive register returns and integer argument facts
   from in-module callers only (`call-boundaries.ts:35-44`,
   `word-arguments.ts:37-56`). A function whose address is exported must be
   treated exactly like a `function-new` target. Otherwise a JIT caller would
   enter code that assumes AOT-only arguments and register returns. Six analyses
   enumerate `function-new` in non-exhaustive `if` chains, so TypeScript will not
   flag a new kind. One shared predicate replaces those chains (§4.2).
5. **The exact final instance comes from the existing remap.** `lowerReferenceLists`
   rewrites `call`, `call-indirect` and `function-new` targets to dense clones
   (`reference-lists.ts:278-287`). If `function-address` is added to that remap,
   the exported entry is the instance that AOT code itself calls. A simulation
   (p2, mode b) retargets 5 of 8 list operations to `__tint_reference_list_*`
   clones and leaves 0 stale sparse targets. The other 3 (create, push, length)
   stay canonical by design.
6. **Import is a public opaque call.** A `call` to an imported function emits the
   `call-indirect` protocol without the brand or signature guard. It zeroes the
   result buffer, sets `x1 = 0` and `x2 = 0` and loads the entry from a patched
   `function-entry` slot. It then checks the status, and the result is read from
   memory. Linking first verifies the signature window words, then patches the
   entry.

## 2. Probes (Node only)

| Probe | Question                                                          | Result                                                                                                                            |
| ----- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| p1    | Box a retained top-level function vs a forwarder (plain lowering) | Direct: lowering error above. Forwarder: env-free, `call` to the retained function                                                |
| p4    | Same, under record lowering with real collection options          | `witnessLike` and `callsTop` lower, and the forwarder's `function-new` has `env=undefined`. `directTop` fails with the same error |
| p3    | Do runtime operation declarations support syntactic forwarders?   | 37 operations (list ×2, Map, Set): all annotated; no default, optional, rest, generic or receiver parameter                       |
| p2 a  | Forwarders boxed in `unknown[]`; dense rewrite; private ABI       | Dense **declined**: the `general`-element list is reachable (`reference-lists.ts:101`)                                            |
| p2 a′ | Forwarders boxed in an inferred record                            | Dense accepted (`rewritten=5`), 0 stale targets, runtime targets 8/8 direct-only                                                  |
| p2 b  | Simulated (b): each instance address taken from the initializer   | Dense accepted (`rewritten=5`), 0 stale. Targets 0/8 direct-only, word masks 0 (exposed)                                          |

Mode b models the escape with an injected `function-new`, because that is the
behavior `function-address` must reproduce. It does not prove the new instruction.

Incidental findings, each reproduced once:

- A generated declaration that copies a runtime declaration's spans is classified
  by `locateSource` as a retained runtime statement. It is then hoisted out of the
  initializer and fails to box (p2 a, first run). Generated syntax must use zero
  spans, and selection must be by explicit name.
- A D6a subject that the transform leaves unretained is nested into the
  initializer, and agreement then fails with
  `runtime binding subject disappeared after transform` (p2 b, first run). D6d must
  add collection anchors to `retained`.
- The existing D4 bind body already builds `readonly unknown[]`. Whether dense
  rewriting already declines for surface images is unknown (parent §7.1). Measure
  it in D6d; D6c adds no such container.

## 3. Options compared

| Criterion              | (a) Initializer forwarders                          | (b) `function-address` (chosen)                                         |
| ---------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| Boxed function values  | ~300 real callable values in the bind result        | None. Words in a `Float64Array`                                         |
| Environment-free proof | Lowering outcome plus a leaf null check at run time | Structural: verify rejects any target with an environment               |
| Exact dense instance   | Indirect (the forwarder's call is remapped)         | Direct (the op's target is remapped)                                    |
| Escape and private ABI | Free via `function-new`; runtime keeps private ABI  | Needs the shared predicate; exported targets lose private returns       |
| Dense rewrite          | Declines if the container is `unknown[]`            | Unaffected                                                              |
| Host surface           | New leaf `native-function-entry`                    | None                                                                    |
| JIT call cost          | Two calls                                           | One call                                                                |
| IR blast radius        | None                                                | One op, verify, effects, codegen, and six analysis sites via one helper |

(b) is chosen because authority stays with the compiler: the stub, the binding
and the target are all selected by the compiler, and nothing callable leaks.
The extra IR work is bounded by one helper. Fallback, if D6d measures an
unacceptable AOT regression from losing private returns: point the same
`function-address` at compiler-generated top-level forwarders, which need no
boxing. The runtime then keeps its private ABI and only the target changes.

## 4. Contracts

### 4.1 IR instruction (`ir/src/scalar/model.ts`)

```ts
| {
    /** Permanent image address of a module function: its code entry or its
     * interned signature descriptor. Exported addresses escape the module. */
    readonly kind: "function-address";
    readonly id: number;
    readonly target: number;
    readonly part: "entry" | "signature";
  }
```

- **Verify** (`ir/src/scalar/index.ts`). The target must exist. It must not be an
  import, and it must have no `environment`, no `closureEnvironment` and no
  `receiverSlot`. `part` must be one of the two literals. Defines `number`.
  Errors: `function address requires a known target`,
  `function address target must be environment-free` and
  `managed imports have no local address`.
- **Effects** (`effects.ts`): none. No allocation, throw, safepoint or heap
  access. **Operands/substitution:** no operands; the target is copied verbatim.
- **Signature part.** The result is the interned descriptor for the target's
  physical ABI (`codegen/.../index.ts:922`). Functions with equal ABIs share it,
  so it is a word-check window and **never** an identity.

### 4.2 One escape predicate (`ir/src/scalar/function-references.ts`, new)

```ts
/** Functions whose address leaves direct-call control: public ABI required. */
export function escapedFunction(op: Instruction): number | undefined; // function-new | function-address
/** Every function-ID operand that pruning and representation rewrites must remap. */
export function referencedFunction(op: Instruction): number | undefined; // + call, call-indirect
```

The following sites replace their inline `op.kind === "function-new"` checks with
the predicates. Each site gets a test that uses `function-address` alone.

| Site                                  | Required behavior for `function-address`               |
| ------------------------------------- | ------------------------------------------------------ |
| `scalar/call-boundaries.ts:43`        | `direct[target] = 0`                                   |
| `scalar/word-arguments.ts:55`         | `exposed[target] = 1`                                  |
| `scalar/record-flow.ts:271`           | target parameters merge `unknown`; no environment edge |
| `optimization/reachability.ts:72`     | include target                                         |
| `optimization/reachable.ts:81`        | remap target IDs when pruning                          |
| `optimization/reference-lists.ts:282` | remap target to the dense clone                        |

`codegen` keeps one defensive assertion: emitting `function-address` for a target
with `directReturns[target] === 1` fails `INVALID_IR`
(`function address target uses a private call ABI`). This catches a site missed in
the future. Codegen `hasFunctions` (`index.ts:870`) needs no change, because no
function object is created.

### 4.3 Lowering binding (`ts-native/src/closure/lowering`)

```ts
export interface FunctionAddressBinding {
  readonly function: number; // checked ID of a compiler-generated stub
  readonly target: number; // checked ID of the final runtime instance
  readonly part: "entry" | "signature";
}
// ModuleEntryOptions.functionAddressBindings?: readonly FunctionAddressBinding[]
```

The new `function-bindings.ts` sits beside `record-bindings.ts`. It replaces the
stub body with one block: `function-address` followed by `return`. Validation
(errors are prefixed `function address binding`):

- The stub is top-level, synchronous and non-generic. It has no receiver, no
  parameters and no closure environment, and its result is `number`. It is
  neither imported nor record-bound, and it is bound at most once.
- The target is top-level, included, not imported, not a stub and not generic.
  After lowering, its `FunctionIR` passes §4.1. The check repeats on the lowered
  IR, because environment facts exist only there.
- `importedFunctions` and record bindings that overlap with stubs or targets are
  rejected. The lowering never infers a target from names, ABI or types.

Authority: only compiler code constructs these bindings, as with `recordBindings`
(`compiler/src/native/index.ts:463-520`). Source spelling never grants one.

### 4.4 AOT export helper (`compiler/src/native/managed-runtime-entries.ts`, new)

This is the self-contained mechanism. D6d wires it into the directory and bind
export, and it does not change v2 bytes.

1. `createRuntimeEntryStubs(names, prefix)` takes the deduplicated runtime
   function names, in the order the D6a context returned them. It returns two
   zero-span stubs per name (`<prefix>_entry_k`, `<prefix>_signature_k`), each with
   body `throw "MANAGED_RUNTIME_ENTRY_UNBOUND"`, plus the stub names. The stubs
   are added to `retained`, like record identities, so they stay top-level.
2. Inside the transform, the bind body stores
   `entries[2k] = <entry_k>(); entries[2k+1] = <signature_k>();` in a
   `Float64Array(2n)`. No `unknown[]` is created and no runtime is referenced
   as a value.
3. After `prepareCollectionRuntimes`, `resolveRuntimeEntryBindings(checked, plan)`
   resolves stubs and targets by declaration identity in the final graph. This is
   the same `rewriteModule` scan as `surfaceSources` (`index.ts:420-433`).
   Names are valid only for the final pass (D6a §4.4). A missing name fails with
   `surface: runtime entry target is missing: <name>`.
4. **Agreement (pre-dense).** After lowering, each target's lowered ABI must equal
   the ABI the plan expects. Failure: `surface: AOT runtime ABI skew <k>`. Dense
   clones are signature-checked by `lowerReferenceLists` itself
   (`reference-lists.ts:115-160`), and pruning only renumbers. The link-time word
   check (§4.6) covers the final emitted ABI physically.
5. **Host exclusion.** After `bindHostOperations`/`bindWeakOperations`, reject
   any `function-address` whose target became a host or weak binding:
   `surface: runtime entry targets a host operation`. A JIT holding the entry of a
   host leaf would be a capability escalation.

### 4.5 Codegen import call (`codegen/src/aarch64/scalar/index.ts`)

```ts
export interface ManagedFunctionEntryBinding extends ManagedIdentityImport {
  readonly function: number; // an IR import (FunctionIR.import === true)
  readonly parameters: readonly ScalarType[];
  readonly returnType: ScalarType | "void";
}
// ManagedABIRequest.functions?: readonly ManagedFunctionEntryBinding[]
// NativeManagedPointerImport.role: … | "function-entry"
```

- Replace the blanket rejection (`index.ts:657`) with per-import checks. Every
  import needs exactly one binding. The binding target must be an import, and its
  ABI must equal the import's `FunctionIR` ABI. Names are unique. Errors:
  `UNSUPPORTED: unbound imported function`,
  `INVALID_IR: function-entry binding requires an imported function` and
  `INVALID_IR: imported function ABI mismatch`.
- **Call sequence.** Arguments are placed by `signatureLayout` (the same
  function determines the AOT callee's layout). The result buffer is zeroed, as for
  `call-indirect`. Then `x0` = context, `x1 = 0`, `x2 = 0`, `x3` = result,
  `managedPointer(16, slot)` and `blr x16`, followed by `cmp w0, #1` and the
  exceptional branch. The result is read from `result+16/24` and never from
  registers: `call-boundaries` already forces `direct[import] = 0`.
- Verify (D6b) still rejects imports as `function-new` or `call-indirect`
  targets. D6c adds a rejection of a `call` to an import with a receiver or with
  `environment: "inherit"`: `managed imports take no environment or receiver`.
- Default emission (no imports, no `function-address`) stays byte-identical.

### 4.6 Link (`compiler/src/native/managed-imports.ts`)

- `ManagedIdentityShape.role` gains `"function-entry"`.
  `ManagedIdentityBinding.entry?: number` is required exactly for that role.
  `address`/`byteLength` denote the signature window, which has the same words as
  `"signature"`.
- Structural validation precedes every read, as today. The window must satisfy
  the existing `%8` rule. The entry must be a safe integer, non-zero, `% 4 === 0`
  (A64 entries are only 4-aligned, `index.ts:1470`). A function-entry binding
  must not serve a `signature` slot or the reverse. The issuer owns permanent
  executable storage disjoint from the new image. The resolver sees unpublished
  bytes, not their eventual load address, so it cannot prove that disjointness;
  it checks structure and domain while storage provenance remains an explicit
  trusted-owner contract. A byte-array length is not an address range.
- The window words are verified for every binding before any patch. The slot then
  receives `entry` and never `address`. Failure leaves `code` untouched.
- The D5 reader stays shaped as it is. `pointer()` stays `%8` for metadata, and a
  separate `codeAddress()` check applies to entries. D6e reads `entries` pairs
  after the digest, restore and count checks. Their contracts are
  `tint.surface.v1/<name>/<digest>/runtime/<k>`, and selection is by contract,
  never by ABI.

### 4.7 GC, lifetime, state and context authority

- Entry and signature words are image code and metadata. They are permanent for
  the context, never traced or moved, and stored in a `Float64Array` (exact below
  2^53, as with record identities). No movable value is embedded in JIT code.
- The callee is the image's own retained instance, so module state stays shared.
  Collection modules declare no module-level state (parent §3.4). Retained
  variables are image globals, which `prepareModuleInstance` already restricts
  ("retained declaration depends on instance state").
- Completion follows the `call-indirect` protocol. The callee pushes and pops its
  own roots. The JIT call has unknown effects (D6b), so it is a safepoint and the
  caller's managed values are rooted across it.
- The domain check (`binding.domain === expectedDomain`) binds each entry to the
  issuing context. Code is published only after every patch succeeds.

## 5. Red-first test slices

Each slice starts with failing tests, then the implementation, then
`pnpm build` and the focused tests. `pnpm check` runs before handoff.

**D6c1, IR** (`ir/test/scalar-function-address.test.ts`, new):
verify accepts both parts and rejects an unknown target, an import, a target with
`environment`, `closureEnvironment` or `receiverSlot`, and an invalid `part`.
`summarizeEffects` is empty for a function that only takes an address. There is
one test per §4.2 site:
`pruneClosedModule` keeps and renumbers the target, `lowerReferenceLists` retargets
an exported `read` to its dense clone (the p2 mode-b shape), `provenDirectOnlyFunctions`
gives 0 and `provenWordArguments` exposes the target. `provenRecordFlows` treats
its parameters as unknown.

**D6c2, lowering** (`ts-native/test/function-address-binding.test.ts`, new):
an entry and a signature stub lower to single-block bodies. Each §4.3 negative case
gets its own error. Binding a nested forwarder as a target is rejected. A runtime
instance from a real `prepareCollectionRuntimes` fixture is accepted.

**D6c3, codegen** (`codegen/test/scalar-function-address.test.ts`, new; extend
`scalar-imported-functions.test.ts`):

- the entry fixup resolves to the target's `NativeFunction.offset`;
- the signature fixup resolves to an interned descriptor with the expected words;
- the private-ABI assertion fires when the predicate is bypassed;
- the import call sequence includes the zeroed buffer, `x1 = 0`, the slot load,
  `blr x16`, the status branch and the memory result;
- the slot appears in `managedImports` with role `function-entry` and the ABI;
- each rejection in §4.5;
- an existing fixture stays byte-identical.

**D6c4, link** (`compiler/test/native-managed-imports.test.ts`, extend): use a spy
`readWord` that counts calls. Cover a patch with `entry`; a word mismatch with no
patch and an unchanged image; and entries of 0, `%4 ≠ 0` or inside the image. Also
cover role crossing, a missing `entry`, and a foreign domain rejected with zero
reads.

**D6c5, AOT export** (`compiler/test/managed-runtime-entries.test.ts`, new): run
the p2 fixture through stubs, `prepareCollectionRuntimes` with D6a context
names, lowering, bindings and `lowerReferenceLists`. Then check:

- the final `function-address` targets are the dense clones for
  read, write, has, delete and resize, and canonical for create, push and length;
- no stale sparse target remains;
- no `unknown[]` is created;
- skew and host-target rejection;
- a forced retry pass re-derives every target (D6a stale-cache rule).

## 6. Negative authority and ABI cases

| Case                                                           | Stage   | Expected                                                 |
| -------------------------------------------------------------- | ------- | -------------------------------------------------------- |
| Bind body names a retained runtime as a value                  | lower   | existing `named function values require…` (kept)         |
| Address of an environment-bearing, receiver or nested function | verify  | `function address target must be environment-free`       |
| Address of an import                                           | verify  | `managed imports have no local address`                  |
| Stub not compiler-selected, or with parameters                 | lower   | `function address binding …`                             |
| Target later bound to a host or weak operation                 | surface | `runtime entry targets a host operation`                 |
| Exported target compiled with private returns                  | emit    | `function address target uses a private call ABI`        |
| Import without a binding, or binding ABI ≠ import ABI          | emit    | `unbound imported function` / `ABI mismatch`             |
| Two entries with equal ABI, swapped by request                 | link    | rejected by contract/role, never accepted on equal words |
| Signature words differ                                         | link    | `Managed identity descriptor differs`, before any patch  |
| Entry 0, misaligned, or inside the importing image             | link    | `Invalid function entry`                                 |
| Foreign or unissued domain                                     | link    | existing domain errors, zero reads                       |

Equal ABI words never select or authorize an entry. Many list operations share
both their ABI and their interned signature descriptor. Only the compiler's
binding (AOT) and the issued contract (JIT) carry semantic identity.

## 7. Files and cleanup

- `ir/src/scalar/{model,index,effects,operands,substitution}.ts`, new
  `function-references.ts`, and `call-boundaries.ts`, `word-arguments.ts`,
  `record-flow.ts`; `ir/src/optimization/{reachability,reachable,reference-lists}.ts`.
- `ts-native/src/closure/lowering/{index,function-bindings}.ts`.
- `codegen/src/aarch64/scalar/index.ts`.
- `compiler/src/native/{managed-imports,managed-runtime-entries}.ts`.
  `managed-directory-reader.ts` gets only `codeAddress`, and only if D6e needs it.
- New source files: follow AGENTS (regenerate and format the compiler catalog).
  That is main's step, not part of this research.
- Cleanup: delete the parent's `native-function-entry` leaf plan. Drop
  `x2 = receiver` from the parent §4.4 sequence, because imports have none.
  Replace the blanket D6b rejection with the per-binding check. Keep the
  witness-exclusion loop in `index.ts`, but select by explicit stub names.

## 8. Risks, unknowns and blockers

1. **Native unknowns.** That an AOT `function-address` encodes the right
   addresses, and that a JIT→AOT import call preserves the context, roots and
   completion, is unproven until D6g. The ADR range from the stub to a distant
   function uses the existing `relativeAddress` patch, which `function-new`
   already exercises.
2. **AOT cost.** Exported targets lose private returns and word facts (p2 b) in
   surface images only. Measure the counts and the image delta in D6d. Use the
   forwarder-target fallback (§3) if the cost matters. Images without surfaces
   are byte-identical.
3. **Dense decline.** The existing `unknown[]` in the D4 bind body may already
   disable the dense rewrite for surface images. This is unknown; record it in D6d.
4. **Missed escape site.** This is mitigated by the shared predicate, one test per
   site and the codegen assertion. A future analysis that pattern-matches
   `function-new` directly would reopen the hazard. Review should look for it.
5. **Stub volume.** Two stubs per unique target (about 300 names on the real
   vocabulary, D6a §5.2) add code. The inliner may fold them. Measure in D6d.
6. **Blockers.** None for D6c1–D6c5 in Node. Integration needs D6d (directory v3;
   no v2 decoder), and the D6d transform must retain anchors and stubs. Native
   evidence waits on main's queued fixture and the isolated self-build. D6c
   changes IR and codegen, so a frozen self-build with byte-identical stages is
   required before any claim.

**Next:** implement D6c2 lowering bindings, D6c3 native address emission and calls,
D6c4 link preflight, and D6c5 AOT export helpers. Native fixtures and the new frozen
self-build remain on main's serial native queue.
