# RT-EVAL D6d: directory v3 runtime providers and static entry export

Status: **Directory v3 data, reader and AOT entry publication implemented.**
The complete Script vocabulary has 41 providers, 355 slots, 323 distinct targets
and 43 physical ABIs. Canonical provider validation, slot preflight and AOT ABI
agreement pass Node checks. The [native directory fixture](../results/native-runtime-directory-v3-v1.json)
passes with shared module state, callback invocation, copying GC and directory
reads. Full Script-surface publication also [passes natively](../results/native-script-runtime-directory-v3-direct-v2.json), including all 355 slots. Its earlier
[debugger launch failure](../results/native-script-runtime-directory-v3-v1.json)
remains recorded separately. The new frozen self-build [stopped during emission](../results/bootstrap-runtime-directory-v3-direct-v2-analysis.json); isolated collector diagnostics are pending. Version 2 is rejected; no compatibility decoder is retained.

The workspace gate passes 3,859 tests, types, dependency boundaries and formatting
(`.tint-bootstrap/runtime-directory-v3-workspace-check-v1.log`). These compiler
fixtures establish no new Test262 pass rate.

Parent: [managed-entry lowering](rt-eval-managed-entry.md), slice D6d. The
following research describes the planned integration; captured-source statements
below describe the original probes. The JIT matcher, S2 frame and eval scoping
are out of scope.

Captured 2026-11-04 against live source `713d1431…` (533 files). The `dist` files
inspected were newer than their sources. The probes are read-only Node scripts in
`/tmp/tint-runtime-directory-v3-plan` (`p1-dense`, `p2-census`, `p3-retain`), run
with the workspace as the working directory. They import public `dist` entry points,
`tools/workspace-sources.ts` and the earlier `/tmp` harnesses. They emit no image,
run no native code and write nothing in the workspace. **All counts are Node-only.
None of them is a native, ABI-equality, performance or conformance claim.**

## 1. Answer in brief

1. **The dense rewrite already declines for every surface image, and D6 cannot
   change that.** Measured in p1 with `closedProgram` and `denseReferenceLists`:
   - a fixture without a surface rewrites 35 functions;
   - the same fixture with a surface rewrites none, even when `run` never calls
     `bind`, because the initializer reaches the bind export;
   - `readonly unknown[]` alone in `run` also declines;
   - directory-shaped `string[]`, record arrays, `number[]` and a `Float64Array`
     still rewrite 62.

   The cause is `lowerReferenceLists` (`reference-lists.ts:97-107`). It declines when
   any reached list binding has a `general` element. Removing D4's
   `functions: readonly unknown[]` would not help. The census must export
   `list<$T120>` (`$T120 = unknown`), whose `write` is
   `(reference,number,general)→void`. D6c1 makes each `function-address` target
   reachable, so that binding is always reached. **Contract: surface images use the
   sparse representation.** D6d makes this explicit (§4.6) and drops the parent's
   dense fixtures.

2. **The census is exact and stable.** It covers 78 collection aliases (71 array, 6
   Map, 1 Set). They yield **39 exact element keys**: 32 list, 1 Set and 6 Map keys.
   Those keys resolve to **35 operation sets, or 300 distinct functions**. With 21
   primitives and 2 number-text operations, that is **323 distinct targets**. All 300
   collection names resolve to final `options` function IDs. The 323 lowered targets
   have 0 missing ABIs and **43 distinct ABIs**. No key maps to two sets. Two sets
   are shared by several keys: `{$T448,$T131,$T480,$T708}` (string and
   string-like elements, merged by optional-aware matching) and `{$T472,$T475}`
   (structurally equal records with distinct aliases).
3. **Keys are exact canonical aliases, and slots are per key.** Each directory
   provider is keyed by `kind` plus exact canonical alias names. The grouping comes
   from mutual assignability, so it stays a private AOT instance fact. 41 providers
   carry fixed operation vectors, which gives **355 slots**. These are backed by 323
   distinct targets: keys in one AOT group repeat the same address pair. Because the
   key set is a pure function of the restored types, the reader can rebuild and
   canonicality-check it like records and signatures. The JIT selects by exact alias
   key, never by assignability or ABI (§3).
4. **The runtime targets are top-level and environment-free today.** The compiler
   retains every statement whose origin is a non-`retainedExports` runtime module or
   one of its dependencies (`index.ts:203-221`, `:362-373`). Specialized instances
   inherit that origin. p3 reproduces this rule: preparation succeeds, and **0 of 323
   lowered targets carry an environment, closure environment or receiver**. Retaining
   only the targets fails on `number-list.ts`'s module `const maximumCapacity`
   (`retained declaration depends on instance state`). D6d must therefore keep the
   origin rule, not replace it with a target list. Collection anchors are
   zero-span application syntax, so they **must** be retained by name.
5. **Correction: keywords are aliases.** The canonical surface aliases `unknown` and
   `string` (`$T120`, `$T131`). Every element node is a named alias inside a `group`.
   Parent §4.2(3) and §3.6 assumed that keywords stay keywords. They do not, and no
   type-contract index is needed in the transform.

## 2. Probe results (Node only)

| Probe      | Question                                        | Result                                                                                           |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| p1         | Dense rewrite with/without a surface            | rewritten 35 / declined / declined (bind unreachable) / declined (`unknown[]`) / 62 (dir-shaped) |
| p2         | Real census through the implemented D6a context | 2 passes, 78 anchors, 39 keys, 35 sets, 300 + 21 + 2 = 323 names, 43 ABIs, 300/300 option IDs    |
| p3 targets | Retain only the 323 targets                     | `depends on instance state: @2:value:0` (`number-list` const)                                    |
| p3 origin  | Retain by runtime origin (the compiler's rule)  | ok; 323/323 targets top-level and environment-free after lowering                                |

p2 list ABIs fall into 17 `(operation, ABI)` groups. Their `write` element encodings
are `general`, `optional-reference`, `optional-string` and `optional-number`
(number-list).

## 3. Keys, canonicalization and selection

**Provider vocabulary** (moved to `@tint/ts-native/runtime`, §5):

| Kind          | Key fields               | Operations, in order                                                                                      | Count |
| ------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- | ----- |
| `list`        | `element`                | `create read write push length has delete resize`                                                         | 32×8  |
| `set`         | `element`                | `create has add delete clear size iterator.create iterator.advance iterator.read clone`                   | 1×10  |
| `map`         | `element` (key), `value` | `create get has set delete clear size iterator.create iterator.advance iterator.key iterator.value`       | 6×11  |
| `primitive`   | none                     | the 21 `PrimitiveRuntime` fields in `context.primitives()` order (`fromNull` … `canonicalOptionalNumber`) | 21    |
| `number-text` | none                     | `toString fromString`                                                                                     | 2     |

**Canonical key derivation.** `planManagedSurfaceRuntimes(contracts)` is shared by
the producer and the reader. It walks `contracts.surface.declarations` in order. It
classifies each alias by `contracts.checked.types[typeNames.get(alias)].kind`
(`array`/`map`/`set`). It reads element names from the alias syntax after unwrapping
`group`: the array `element`, or the `Map`/`Set` (or `Readonly…`) type arguments.
Each must be a `named` alias, otherwise it fails with
`surface runtime: unsupported element syntax <alias>`. Keys are deduplicated in
first-occurrence order. `primitive` and then `number-text` follow, exactly when the
producer's context returns them. No checker ID or linked name enters the key or the
digest. The diagnostic text is `list<$T5>`, `map<$T131,$T107>`, `primitive` or
`number-text`.

**Grouping is not serialized.** The AOT selection picks the first start whose request
argument is mutually assignable (optional-aware for lists). That depends on the
order of the application's requests, so the layout program and the AOT may group
differently. Per-key slots make this harmless. Each key's slots hold whatever
instance the final AOT pass selects for that key, and agreement checks only the ABI.

**JIT selection handoff (D6f contract, fixed here).** For a JIT binding element:

- Compute the set S of canonical aliases that are exactly equal under the existing
  type-contract index (`matches`, not assignability).
- The candidates are the providers of the same kind whose key aliases are all in S
  (for a Map, both key and value).
- No candidate: `profile: <kind><<element>>.<op> is not provided by the surface`.
- Several candidates (for example `$T448` and `$T480`, which are textually equal):
  take the first in directory order. Equal types have equal semantics. The
  directory, not the JIT graph, fixes the order.
- Select the operation by name and import it by contract `runtime/<slot>`.
- A lowered import ABI that differs from the directory ABI fails with
  `profile: runtime ABI skew`.

Equal signature words or equal entry addresses never select, merge or authorize a
provider.

## 4. Contracts

### 4.1 Directory data (`managed-directory-data.ts`)

```ts
export const managedSurfaceDirectoryVersion = 3; // v2 frozen; no decoder compatibility
export interface ManagedSurfaceRuntimeOperation {
  readonly operation: string;
  readonly parameters: readonly ScalarType[];
  readonly returnType: ReturnType;
}
export interface ManagedSurfaceRuntimeProvider {
  readonly kind: "list" | "set" | "map" | "primitive" | "number-text";
  readonly element: string; // list/set element, map key alias; "" for primitive/number-text
  readonly value: string; // map value alias; "" otherwise
  readonly operations: readonly ManagedSurfaceRuntimeOperation[];
}
// ManagedSurfaceDirectoryData gains: readonly runtimes: readonly ManagedSurfaceRuntimeProvider[];
// ManagedSurfacePhysicalFacts gains: readonly runtimes: readonly ManagedSurfaceRuntimeProvider[];
// ManagedSurfaceExport gains:        readonly entries: Float64Array; // 2 words per slot
```

- **Encoding.** The header is unchanged (`"tint.surface.directory"`, then
  `uint(version)`), so version 3 alone changes every digest. A section follows
  `records`: `uint(n)`, then per provider `text(kind)`, `text(element)`,
  `text(value)`, `uint(m)`, then per operation `text(operation)`,
  `strings(parameters)` and `text(returnType)`. The digest still excludes itself. No
  separate vocabulary version is needed, because operation names are encoded
  verbatim. Addresses are never encoded.
- **Slot order.** Slot `s` enumerates providers in order and then operations in
  order. `entries[2s]` is the code entry and `entries[2s+1]` the signature window
  address. The contract is `tint.surface.v1/<name>/<digest>/runtime/<s>`
  (`managedSurfaceContract` kind `"runtime"`).
- **`createManagedSurfaceDirectory(name, surface, facts, frame)`** derives the
  expected providers with `planManagedSurfaceRuntimes`. `facts.runtimes` must equal
  them in order, kind, key and operation vector. Each ABI must be valid
  (`managedIdentityByteLength({role:"signature",…})` is defined). Errors:
  `surface directory: missing runtime fact: <key>`, `unexpected runtime fact: <key>`
  and `runtime operations differ: <key>`. The reader reuses this rebuild, so
  canonicality covers runtimes too.
- **`verifyManagedSurfacePhysicalAgreement(directory, actual)`** extends to
  `actual.runtimes`: `missing AOT runtime: <key>.<op>`,
  `AOT runtime ABI skew: <key>.<op>` and `unexpected AOT runtime: <key>`.
- **Checkpoint.** The v2 [checkpoint](../results/managed-directory-data-checkpoint-v1.json)
  stays immutable. A new v3 checkpoint pins digest bytes for the test fixture.

### 4.2 Layout program facts (`managed-directory.ts`)

`deriveManagedSurfacePhysicalFacts` appends one zero-span anchor per collection alias
to the layout module: `function $layout_collection_k(v: $Tn): number { return v.length /* v.size */; }`.
It then passes a transform that asks `context.collection({function, parameter: 0})`
for each anchor, plus `primitives()` and `numberText()`. The transform returns the
module unchanged. The names are used only after that same pass succeeds, which
holds because the transform is called once per pass and the last call is the final
pass. Each name is resolved through the existing top-level `sources` map. Its
lowered `FunctionIR` slots give the ABI. Keys sharing a name must report one ABI.
Errors: `surface layout: missing runtime ABI <key>.<op>` and
`surface layout: unsupported runtime element <alias>` (from
`collectRuntimeRequirements(...).unsupported`).

### 4.3 AOT anchors, names and stubs (`managed-aot.ts`, new `managed-runtimes.ts`)

1. **Anchors preexist the transform.** `prepareManagedSurfaceExports` appends
   `<prefix>_collection_k(v: <prefix>_$Tn)` with zero spans before the application
   check, beside the D4 anchors. `ManagedSurfaceAOTPlan` gains
   `collectionAnchors: readonly {name, providerKey}[]` and `runtimes` (the directory
   providers). D4 generic anchors are still removed by `materializeManagedSurfaceTable`.
   **Collection anchors are never removed in the transform.**
2. **Retention.** The transform appends every collection anchor and every runtime
   stub to `retained`. The origin rule (§1.4) keeps targets and their dependencies
   top-level. D6d adds no target list to `retained`.
3. **Names (per pass).** `materializeManagedSurfaceExports(module, plans, context)`
   asks the context for each anchor. For each key, every anchor of that key must
   return identical operation maps, otherwise it fails with
   `surface: runtime key resolves to two instances: <key>`. The result is a slot
   table `slot → target name` plus the distinct targets in first-slot order.
4. **Stubs (inside the transform, rebuilt each pass).** These are D6c5's planned
   `createRuntimeEntryStubs`, refined here:
   - one entry stub per distinct target, `<prefix>_entry_t` (323 on the census);
   - one signature stub per distinct directory ABI, `<prefix>_signature_a` (≤43),
     bound to the first target with that ABI.

   Stub bodies are `throw "MANAGED_RUNTIME_ENTRY_UNBOUND"` with zero spans. Interned
   descriptors make the window identical for equal ABIs, and the window is only a
   word check (D6c §4.1). Correction to D6c §4.4(1): stubs cannot preexist, because
   target names are per-pass facts.

5. **Bind body** (`materializeManagedSurfaceExport` gains `entries` and `slots`): a
   `const <prefix>_entries = new Float64Array(2·slots)` followed by
   `e[2s] = <entry_t>(); e[2s+1] = <signature_a>();`. It adds `entries` to the
   returned object, and `runtimes` to the directory literal. No `unknown[]` and no
   function value are added. D4's `functions: readonly unknown[]` stays, because the
   reader's brand and signature leaves need values.

### 4.4 Compiler wiring and agreement (`compiler/src/native/index.ts`)

After `prepareCollectionRuntimes`, resolve stubs and targets through `surfaceSources`
(the existing final-graph `rewriteModule` scan). A missing name fails with
`surface: runtime entry target is missing: <name>`. Pass `functionAddressBindings`
(D6c2, planned) to `lowerModuleEntries`. Then, before host binding, pruning or
emission:

- **ABI agreement.** For every slot, the target's lowered `FunctionIR` ABI equals the
  directory ABI, and each signature stub's target ABI equals its group ABI. This
  runs through `verifyManagedSurfacePhysicalAgreement` with `actual.runtimes`.
- **Host exclusion.** After `bindHostOperations`/`bindWeakOperations`, a
  `function-address` whose target is a host or weak binding fails with
  `surface: runtime entry targets a host operation`.
- **Identity.** No function-merging pass exists (`ir/src/optimization`). Pruning
  renumbers through `remapReferencedFunction`, and the inliner cannot delete an
  escaped target. The emitted entry is therefore the final instance of the slot's
  option function.

### 4.5 Reader (`managed-directory-reader.ts`)

Order: version, name, ABI, digest, restore, canonical rebuild (§4.1), counts,
**then entries validation, then the first host call**:

- `entries.length === 2 × slots`, otherwise `runtime entry count differs`.
- Each entry word is a safe integer, `> 0` and `% 4 === 0` (`codeAddress`). Each
  signature word passes `pointer()` (`% 8`). Otherwise
  `runtime entry unavailable: runtime/<s>`.
- The output gains `runtimes: ManagedIdentityBinding[]`, one per slot:
  `{domain, role: "function-entry", contract, name: contract, address: signature,
byteLength: window, entry, parameters, returnType}`. This needs D6c4's role and
  `entry` field. Duplicate words across slots are expected and are not rejected.
- `selectManagedIdentityBindings` adds runtimes to the contract pool. The existing
  role, shape and domain equality prevents crossing roles. D6c4 link checks
  (entry outside the importing image, window words before any patch) remain the only
  place that reads memory.
- **Provenance.** The export is the image-owned result of the compiler-bound `bind`.
  The engine calls it and roots it privately. A digest proves consistency, not
  origin. Swapping two equal-ABI pairs inside a privately rooted export is not
  detectable by words and is excluded by provenance, as in D5.

### 4.6 Dense configuration (honest contract)

In `compileArm64Program`, skip `lowerReferenceLists` when `surfacePlans.length > 0`,
and document that surface images are sparse. This saves the up-to-10M-work trace
whose decline is already certain (§1.1). The emitted bytes are identical to today's
decline path. A test requests `denseReferenceLists: true` with a surface and asserts
that no `dense-reference-lists` pass exists and that the native bytes equal those of
`denseReferenceLists: false`. Keep the D6c1 remap, which is harmless and
future-proof. Making surfaces dense would need a non-`general` representation for
`unknown[]`. That is optimizer work and out of scope.

## 5. Files

| File                                            | Change                                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts-native/src/runtime/context.ts`, `index.ts`  | Export `listOperations`, `setOperations`, `mapOperations`, new `primitiveOperations` (used by `primitives()`) and `numberTextOperations` from `./runtime`. No new package |
| `compiler/src/native/managed-runtimes.ts` (new) | `planManagedSurfaceRuntimes`, anchor syntax, per-pass name and slot resolution, `runtimeKey`                                                                              |
| `managed-directory-data.ts`                     | v3, types, encoding, rebuild, agreement (§4.1)                                                                                                                            |
| `managed-directory.ts`                          | layout anchors, context transform, runtime ABIs (§4.2)                                                                                                                    |
| `managed-aot.ts`, `managed-export-body.ts`      | anchors, plan fields, stubs, `entries` body, directory literal (§4.3)                                                                                                     |
| `index.ts`                                      | retention, bindings, agreement, host exclusion, dense skip (§4.4, §4.6)                                                                                                   |
| `managed-directory-reader.ts`                   | v3, entries validation, `runtimes`, pool (§4.5)                                                                                                                           |
| `managed-runtime-entries.ts` (D6c5, planned)    | reused stub and binding helpers; not duplicated in `managed-runtimes.ts`                                                                                                  |

New source files require catalog regeneration and formatting (AGENTS), which is
main's step. `tools/verify-hosted-managed-surface-directory.ts` asserts `version!==2`
and must move to 3. Main should change it only after its queued native run of the
current fixture finishes.

## 6. Tests first

**D6d1, data and canonical rebuild** (no D6c dependency;
`managed-directory-data.test.ts`, `managed-directory-reader.test.ts`, new
`managed-runtimes.test.ts`):

- `planManagedSurfaceRuntimes` on the real vocabulary gives 39 keys (32/1/6) in
  first-occurrence order and 41 providers with primitive and number-text.
- Keys are alias names (`$T120`, `$T131`) and never keywords.
- A non-named element is rejected.
- Encode/digest: the digest changes with one operation name, one element alias, one
  ABI word, the provider order, or version 2 vs 3.
- Rebuild rejects missing, extra, reordered and wrong-vocabulary runtime facts.
- The reader rejects version 2, tampered runtimes (digest or canonicality), and
  every bad `entries` length or word: 0, negative, NaN, fractional, ≥2^53,
  `%4≠0`, signature `%8≠0`. A spy host must record **zero** leaf calls.
- A good read issues 355 function-entry bindings with distinct contracts, and
  selection rejects role crossing and foreign domains.

**D6d2, layout facts** (`managed-directory.test.ts`; the real vocabulary also goes in
a separate slow test): 78 anchors give 355 slots, 323 distinct targets and 43
distinct ABIs. All 300 collection names equal final option function IDs. Keys in one
group report one ABI. An unsupported element gives its error.

**D6d3, AOT wiring** (needs D6c2 and D6c5 for lowering, and D6c3 for emission;
refined in [AOT runtime-entry export](rt-eval-runtime-aot-export.md)):

- Anchors survive the transform and are retained.
- A forced retry pass (the D6a fixture) re-derives stubs, and the old names never
  reach the final bind body.
- `function-address` targets equal option IDs after pruning.
- ABI skew, a key resolving to two instances, and a host-bound target each give
  their error.
- The bind body creates no new `unknown[]`.
- The dense request yields no pass and bytes identical to dense off.
- Images without surfaces stay byte-identical to the frozen comparison source.

**D6d4, link handoff** (needs D6c4; planned in [runtime link handoff](rt-eval-runtime-link-handoff.md)):
a selected runtime binding patches `entry`, and a signature-window mismatch patches nothing.

## 7. Negative authority, ABI and domain cases

| Case                                                         | Stage     | Expected                                                  |
| ------------------------------------------------------------ | --------- | --------------------------------------------------------- |
| v2 directory or v2-shaped export                             | read      | `unsupported directory version`                           |
| Runtime key added, dropped or reordered; operation renamed   | read      | digest mismatch, or `classes: … runtime …`, not canonical |
| Bad `entries` count or word                                  | read      | rejected before `host.domain()`                           |
| Function-entry contract requested as `signature`, or reverse | select    | `import shape differs`                                    |
| Foreign or changed domain                                    | read/link | existing domain errors, zero memory reads                 |
| Anchor deleted or retyped by the transform                   | AOT       | D6a `disappeared` / `names changed after transform`       |
| One key, two instances in the final pass                     | AOT       | `runtime key resolves to two instances`                   |
| Target ABI differs from the directory                        | AOT       | `AOT runtime ABI skew: <key>.<op>`                        |
| Target became a host or weak operation                       | AOT       | `runtime entry targets a host operation`                  |
| JIT element only assignable, not exactly equal               | D6f       | `not provided by the surface`                             |
| Two providers with equal ABI words swapped                   | —         | not detectable by words; excluded by provenance (§4.5)    |

## 8. Corrections to the parent and D6c plans

- Parent §4.2(3)/(4) and §4.4: there are no `function-new` runtime values in
  `functions`, no `function` index, and no leaf calls in the reader. Entries are
  `Float64Array` pairs (D6c §3).
- Parent §3.6: 28 list classes is a count of operation sets. There are 32 exact list
  keys, and the directory has 41 providers and 355 slots over 323 targets.
- Parent §4.2(3): keywords are canonical aliases, so the transform needs no
  type-contract index.
- Parent §7.1 and §7.3 are resolved: surface images are sparse, so remove D6g
  `--entry-dense` and "dense images reading JIT-created lists". Growth is about
  366 stubs plus a 710-word assignment body, not 300 `function-new` values.
- D6c §4.4(1): stubs are built inside the transform per pass, and signature stubs
  are deduplicated per ABI. D6c §8.3 is resolved by §1.1.

## 9. Risks and blockers

1. **Native unknowns.** Whether emitted entries and windows are correct, and whether
   JIT calls preserve roots and completion, waits for D6c3/D6c4 and D6g on main's
   serial queue. A frozen self-build with byte-identical stages is required before
   any claim.
2. **Stub and body size.** 366 stubs and 710 stores per surface. Measure the image
   delta after D6c3. A fallback is one stub per provider kind that returns a packed
   table, which would need a new IR shape, so do not pre-build it.
3. **Retention drift.** If the origin rule ever narrows, targets will nest and verify
   will reject them (environment-free check). That is fail-closed, not silent.
4. **Blockers.** D6d1 and D6d2 have none. D6d3 needs D6c2 and D6c5 (plus D6c3 for
   compile output), and D6d4 needs D6c4.

**Next slice: D6d1 + D6d2** (vocabulary export, `managed-runtimes.ts`, v3 data,
encoding, canonical rebuild, reader entries validation and layout facts). They are
independent of the D6c2–D6c5 work main is doing.
