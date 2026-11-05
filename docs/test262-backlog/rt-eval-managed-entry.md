# RT-EVAL S1 D6: managed-entry lowering with collection values

Status: **planned (research only).** Parent: [surface directory](rt-eval-surface-directory.md)
§5.7 and slice D6. Prerequisites: [D4 layouts and directory](rt-eval-directory-layouts.md)
and the D5 reader. This document answers one question with measurements: how a
lowered Script, compiled at run time against an AOT image's directory, can use
`unknown[]`, `Map` and `Set` values. It must reuse the same TS/native lowering
and the image's own collection code, without copying runtime implementations
into each JIT module. General eval/`Function` scoping, ESM, agents and the Script
frame/global environment profile (S2) are out of scope.

Captured 2026-11-04 against live source identity `d2f5902e…` (527 files,
`workspaceSourceIdentity`). The tree includes main's in-progress D4b file
`managed-directory-data.ts`. The public `dist` was rebuilt by main (compiler
`dist` 13:37). The probes are read-only Node scripts in
`/tmp/tint-managed-entry-plan` (`p0`–`p12`). They import public `dist` entry
points plus `tools/workspace-sources.ts`, emit no image, execute no native code
and write nothing in the workspace. **No native conformance, native equality or
performance claim follows from them.** Times are single Node runs.

## 1. Answer in brief

1. **Three blockers, in order.** A real `lowerScript` output passed through
   `adaptManagedSurfaceEntry` first fails the **check**, because lowered code
   writes registry instantiations (`GlobalEnvironment<ScriptPropertyKey, unknown>`,
   `createGlobalScope<…>(…)`) against already-instantiated surface aliases. After a
   checked erasure it fails **lowering** on the anonymous `readonly unknown[]`
   (§3.2). Linking collection runtimes repairs lowering, but it copies 52 runtime
   functions into the JIT module (§3.3).
2. **Copying is unsound, not only wasteful.** `lowerReferenceLists`
   (`denseReferenceLists`, enabled for project builds) rewrites the AOT list
   representation and retargets every `call`/`function-new` to dense clones. A JIT
   copy of SparseList code would misread AOT-created lists (§3.4).
3. **Import the image's runtime entries.** JIT lowering keeps its normal
   `ListRuntimeBinding`/`Set…`/`Map…`/`PrimitiveRuntime` options from the real
   runtime declarations. Functions named by those options become **import
   declarations**: they keep the signature computed by the same lowering but have no
   body. Codegen calls them through a permanent patched code-address slot. A
   simulation with trap bodies verifies, and pruning keeps exactly the 15 imported
   operations and no other runtime body (§3.5).
4. **The directory gains a `runtimes` section.** It holds 323 entries discovered
   from the surface's 78 collection aliases through the existing demand collector:
   28 list classes × 8, 1 set × 10, 6 maps × 11, 21 primitive operations and 2
   number-text operations. Each entry is keyed by exact element class and operation
   and backed by the **retained AOT instance** from the final
   `prepareCollectionRuntimes` pass (§3.6, §4.2).
5. **Callbacks already map exactly.** The probe's 4 JIT closures join 3 exact
   classes, and their IDs survive lowering and both pruning passes. The only
   non-member `function-new` was a copied runtime function, which disappears under
   imports (§3.7). D6 rejects every escaping non-member JIT closure.
6. **Frame and state need no new mechanism.** Code embeds only permanent words:
   the brand, signatures, record descriptors and now AOT code entries. The table,
   realm, scope and arguments arrive through the traced frame (§4.7).

## 2. Probe method

`common.mts` (copied from the D4 probe) reproduces `compileArm64Program` up to the
table, and `canonicalizeManagedSurfaceTypes` gives the 919-alias surface. The JIT
input is `lowerScript` of
`function f(a,b){return [a,b,function(){return a;}];} var r=f(1,2); r.length; f.call(null,...r);`.
That Script produces `export function execute($global: GlobalEnvironment, $errors: ErrorRealm): ScriptCompletionRecord`
with 113 imported bindings, 22 array literals and 2 index expressions. The probe
folds the three runtime specifiers into a single `$surface` specifier and classifies
names by surface membership (entries are values; everything else is a type).

| Probe   | Question                                     | Mechanism                                                                                                                     |
| ------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| p2/p3   | Closed managed entry over a lowered Script   | `adaptManagedSurfaceEntry` → `prepareNativeFunctionEntry`; registry erasure                                                   |
| p4–p6   | Repair by linking runtimes; what is copied   | Link the JIT module with the nine runtime sources → `prepareCollectionRuntimes` → `lowerModuleEntries` → prune/optimize/prune |
| p7/p8   | Callback membership through lowering/pruning | `createManagedTypeContractIndex`, `planManagedSurfaceContracts`, `planManagedSignatureGroups`, `lowerManagedSignatureGroups`  |
| p9      | Import simulation; frontier element classes  | Frontier bodies replaced by `trap`, then `verify` and `pruneClosedModule`                                                     |
| p10/p12 | Surface runtime census                       | One anchor per collection alias, `collectRuntimeRequirements`, then the full linked `prepareCollectionRuntimes`               |
| p11     | Can lowering skip runtime bodies today?      | `lowerModuleEntries` with the entry alone, then the entry plus all binding operations                                         |

## 3. Measured results

### 3.1 Instantiation erasure (p2, p3)

`prepareNativeFunctionEntry` on the adapted module stops at **check** with
`incorrect type argument count for GlobalEnvironment`. Lowered code instantiates
generic vocabulary explicitly: 14 distinct generic helpers are called with type
arguments, such as
`createGlobalScope<ScriptPropertyKey, unknown>` and
`runScriptContext<ScriptCompletionRecord>`, and type references with
`arguments` (the `TypeNode` field is `arguments`, not `typeArguments`). Surface
entries and type exports are already instantiated, non-generic aliases.

A checked erasure rewrites each argument list that equals the
`scriptRuntimeSurface()` registry entry for that name, and rejects every other list.
It erases **35** lists and rejects **0**. Erasure is fail-closed: the erased call is
rechecked against the exact canonical alias, so a wrong registry entry yields a
check error, never a widened call. The registry is the same D1 code that drives
lowering, so no directory change is needed.

### 3.2 Closed lowering fails on collections (p3)

After erasure the module checks (1,929 types, 6 functions). The closed prepare fails
at **lower** with `type requires an unsupported native representation (type 1905)`.
Type 1905 is `{kind: "array", element: unknown, readonly: true}`, an anonymous
array without a surface alias. Any Script that builds an argument vector reaches it.
This is the D4 §3.2 failure, now reproduced on real lowered code.

### 3.3 Repair by linking runtimes, and its cost (p4–p6)

Linking the adapted module with the nine runtime sources and running the existing
`prepareNativeGlobals` → `specializeModule` → `checkClosureModule` →
`prepareCollectionRuntimes` → `lowerModuleEntries` → prune/optimize/prune
pipeline **succeeds** (79/1/17 list/set/map bindings, about 0.8 s, 1,557 lowered
functions). The final module has 84 functions and 58 records. Of those, **52
functions are runtime copies**, and the JIT code calls 15 of them directly (the
_frontier_):

| Operation (binding element)                              | Calls   | Physical ABI                                                                                           |
| -------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `list<unknown>` create / length / push / read            | 2/3/3/2 | `(number)→reference`, `(reference)→number`, `(reference,general)→number`, `(reference,number)→general` |
| `list<string>` create / push                             | 9/3     | `(number)→reference`, `(reference,optional-string)→number`                                             |
| `list<$T472>` / `<$T473>` / `<$T471>` / `<$T474>` create | 3/1/1/2 | `(number)→reference`                                                                                   |
| `list<$T473>` push                                       | 1       | `(reference,optional-reference)→number`                                                                |
| `primitive.fromNull` / `kindOf` / `readString`           | 1/1/1   | `()→reference`, `(reference)→string` ×2                                                                |
| `numberToString`                                         | 3       | `(number)→string`                                                                                      |

Object elements were mapped to canonical classes with exact `matches` in the JIT
graph (p9). All four are surface aliases.

### 3.4 Why runtime bodies must stay in the image (p11, source)

- **Lowering cannot skip them today.** Lowering the entry alone fails with
  `primitive runtime signature mismatch for 25: expected () => reference; received missing`.
  Adding the 371 binding operations as further roots fails with
  `named function values require managed hoisted initialization`. Option
  signatures come from lowering the runtime bodies themselves.
- **Representation.** For closed programs with `denseReferenceLists`,
  `compileArm64Program` calls `lowerReferenceLists`, which replaces the SparseList
  header representation and remaps `call`, `call-indirect` **and** `function-new`
  targets to the dense clones (`reference-lists.ts`). `project.ts` enables this
  option for project builds; the Test262 host currently disables it. JIT-copied
  sparse code would read dense headers incorrectly. Exported runtime function values
  are remapped by the same pass, so imports always reach the representation the
  image actually uses.
- **Not a state problem.** `sparse-list`, `linked-map`, `linked-set` and
  `native-runtime/values` declare no module-level `let`/`const`, so copying would
  not duplicate state. The objection is representation, code size and the
  directive.

### 3.5 Import simulation (p9)

After the frontier's 15 function bodies are replaced with a single `trap` block,
`verify` succeeds. `pruneClosedModule` from the JIT root keeps **15 runtime
functions, all of them frontier stubs**, plus the JIT functions. Records drop from
58 to 46 (the storage records of the copied runtimes). The JIT module therefore
needs only signatures and call sites for the operations it uses, with no runtime
body and no transitive callee.

### 3.6 Surface runtime census (p10, p12)

The canonical surface has **71 array, 6 map and 1 set** aliases. Checking the
declarations alone yields no demand, because `collectRuntimeRequirements` follows
code. One non-exported anchor per alias (`(v: $Tn): number => v.length` or
`v.size`) gives 29 list, 1 set and 6 map requirements. In the full linked pass:

| Kind      | Bindings | Distinct exact classes      | Duplicates | Ops/binding | Entries |
| --------- | -------- | --------------------------- | ---------- | ----------- | ------- |
| list      | 79       | 29 (28 surface + 1 private) | 50         | 8           | 224     |
| set       | 1        | 1 (`$T103`)                 | 0          | 10          | 10      |
| map       | 17       | 6                           | 11         | 11          | 66      |
| primitive | 1        | –                           | –          | 21          | 21      |
| number    | –        | –                           | –          | 2           | 2       |

The **323 entries** are the image's runtime promise. The 28 surface list classes
are `unknown`, `string`, `number` and 25 aliases (`$T103`–`$T897`). Duplicate
bindings are distinct AOT instances for exactly equal element types. The directory
exports the first binding of each class in binding order, which is deterministic.
The private list class is a runtime-internal object (by shape, a `linked-map`
entry) and is not exported.
Every frontier element in §3.3 is in the census.

### 3.7 Callback membership (p7, p8)

| JIT function (lowered Script) | Exact class (aliases)                                 | Final native ID |
| ----------------------------- | ----------------------------------------------------- | --------------- |
| arrow, 0 params (outer)       | `$T165`                                               | 52              |
| arrow, 0 params               | `$T360` (`$T459`, `$T486`, `$T567`, `$T673`: 5 types) | 53              |
| two arrows, 4 params          | `$T159`                                               | 54, 55          |
| entry, `execute`              | none; not function values                             | –               |

`planManagedSignatureGroups` on the linked graph followed by
`lowerManagedSignatureGroups(entries, signatureTypes, [reach.functionIds, pruned.functionIds])`
yields `$T159:[54,55]`, `$T165:[52]` and `$T360:[53]`. Every final `function-new`
target is a member, except `@1:value:97` (`(reference,reference)→reference`), which
is a copied runtime function and is absent under imports.

## 4. Design

### 4.1 Contract summary

| Value kind                             | Semantic authority                                         | Physical check                                      | In JIT code                                 |
| -------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------- |
| Helper closures (100)                  | Table field, exact class                                   | Signature import (existing)                         | `call-indirect` via frame table             |
| JIT closures                           | Explicit member of an exact class                          | Member-only signature import (B8)                   | `function-new` with imported signature      |
| Surface records (178 classes)          | Record contract                                            | Full layout (existing)                              | Imported descriptor slot                    |
| **Runtime entries (323)**              | `runtime/<k>` contract: kind, element class(es), operation | Signature words; branded, environment-free function | **Patched code-address slot; direct `blr`** |
| Collection storage (lists, sets, maps) | None. Opaque `reference`                                   | None; never described or read by JIT code           | Only passed to imported entries             |

Collection values stay opaque. The directory never describes SparseList, dense
list, linked-map or cursor layouts, and JIT IR never reads or writes them. Semantic
arrays (`$Tn = E[]`) are typed views whose only operations are runtime entries.
The same lowering produces the calls; only the callee is imported.

### 4.2 AOT side: retain and describe runtime entries

1. **Anchors (D4c extension).** For each array/map/set canonical alias, append to
   `normalized` a non-retained, non-exported anchor
   `function $surface_collection_k(v: $Tn): number { return v.length /* v.size */; }`.
   The final `prepareCollectionRuntimes` pass, the one that produces the
   application's `options`, then creates the bindings. No separate
   `specializeCheckedRoots` pass runs for application helpers.
2. **Transform input (ts-native, extend an existing contract).**
   ```ts
   export interface RuntimeBindingNames {
     readonly checked: CheckedClosures; // the pass input graph; element IDs index it
     readonly lists: readonly { element: CollectionElement; operations: ReadonlyMap<ListOperation | "sort", string> }[];
     readonly sets: readonly { element: CollectionElement; operations: ReadonlyMap<string, string> }[];
     readonly maps: readonly { key: CollectionElement; value: CollectionElement; operations: ReadonlyMap<string, string> }[];
     readonly primitives: ReadonlyMap<keyof PrimitiveRuntime, string> | undefined;
     readonly numberToString?: string;
     readonly numberFromString?: string;
   }
   export type RuntimeModuleTransform = (module: Module, runtime: RuntimeBindingNames) => …;
   ```
   `prepareCollectionPass` already knows `specializedValue.roots[start + offset]`
   before it calls `transform`. Existing callers ignore the second argument.
   Operation names follow the `ListRuntime`/`SetRuntime`/`MapRuntime` field names,
   with iterator operations as `iterator.create` and so on.
3. **Bind body.** Inside the transform, the compiler matches each binding element
   to a canonical alias with `createManagedTypeContractIndex(runtime.checked.types)`
   (`unknown`, `string` and `number` stay keywords). It keeps the first binding per
   class and appends those instance names after the table fields and witnesses:
   `functions: [table…, witnesses…, runtime…]`. These are top-level retained runtime
   functions, so `function-new` has no environment. **Keep** the collection
   anchors: unlike D4's generic anchors, deleting them could drop demand on a
   `prepareCollectionRuntimes` retry, which then fails the convergence check. They
   nest as unused instance functions, and closed pruning removes them.
4. **Directory (`runtimes`).** Each entry is
   `{kind: "list"|"set"|"map"|"primitive"|"number", element?: string, key?: string, value?: string, operation: string, function: number, parameters: ScalarType[], returnType}`.
   Entries are in census order (§3.6), and `function` indexes `functions`. The
   layout program (D4a) adds the same anchors and reads each operation's ABI from its
   own lowering, so the directory is computed before AOT checking, like the rest.
   Encode the section after `records` in the D4 encoding (`str` kind, operation and
   element names; `u32` function index; counted parameter strings). **Version:**
   use `3`: v2 bytes are frozen in the
   [directory checkpoint](../results/managed-directory-data-checkpoint-v1.json).
   The runtime section therefore requires a new version.
5. **Agreement (D4d extension).** After AOT lowering and before pruning, each
   exported operation's lowered ABI must equal the directory ABI, or fail with
   `surface: AOT runtime ABI skew <kind>/<element>/<operation>`. Dense rewriting
   happens later and keeps `listFunctionSignature`; the reader re-verifies the final
   words physically.
6. **Census gate.** Reject a surface whose anchors raise
   `collectRuntimeRequirements(...).unsupported` with
   `surface: unsupported runtime element <alias>`.

### 4.3 Lowering: imported functions (ts-native, ir)

- `ModuleEntryOptions.importedFunctions?: readonly number[]` lists checked function
  IDs whose signature is computed exactly as for an entry: the same `scalar`,
  `defaultInput` and receiver rules. They are emitted as
  `FunctionIR { …, import: true, blocks: [], entry: 0 }`. They are never lowered,
  never expanded into children and never inherit environments. A function in this
  list that has a closure environment, a receiver or a parent fails with
  `lower: imported function requires a top-level environment-free declaration`.
- `ir/src/scalar/model.ts`: `FunctionIR.import?: true`. Verification checks that
  an import has no blocks, no environment, no `closureEnvironment` and no
  `receiverSlot`, and that it is only a `call` target. It must not be a
  `function-new` or `call-indirect` target, and it cannot be `exported`.
  `effects.ts` gives imports every effect (throw, allocate, write-heap, invoke,
  escape). `reachability.ts`/`reachable.ts` keep a called import but do not traverse
  it. `inline.ts` and every optimization pass skip imports. `substitution.ts` and
  `operands.ts` need no change (no blocks). `optimizeModule` therefore never sees
  a throwing body.
- The JIT pipeline passes `importedFunctions` = every function ID in
  `prepared.options` (lists, sets, maps, primitives, number-text). Lowering
  succeeds without runtime bodies. Pruning then reduces the imports to the frontier
  (§3.5).

### 4.4 Codegen, leaf and linking

- **Codegen.** `ManagedABIRequest.functions?: readonly { name; contract; function: number; parameters; returnType }[]`
  binds each import (native ID) to a `NativeManagedPointerImport` with the new role
  `"function-entry"`. A `call` to an import emits the `call-indirect` sequence
  without the brand and signature guard: `x0` = context, `x1` = 0 (no environment),
  `x2` = receiver/0, `x3` = result, then `managedPointer(16, slot)` and `blr x16`.
  It uses the memory completion protocol (never `directReturns`). An unbound import,
  or one whose bound ABI differs from the IR signature, fails emission
  (`UNSUPPORTED: unbound imported function` / `imported function ABI mismatch`).
  Imports emit no code bytes. Default AOT emission never contains imports.
- **Leaf.** Add `HostOperation` `"native-function-entry"` (`["reference"]` → number)
  beside `native-function-descriptor`/`-signature`. It guards the brand and returns
  `0` unless the environment word is null; otherwise it returns the entry word.
  It is pure and does not allocate.
- **Reader (D5 extension).** For each `runtimes[k]`, the reader calls
  `signature(functions[f])`, then `entry(functions[f])` (a non-zero result is
  required). It issues `{role: "function-entry", contract: tint.surface.v1/<name>/<digest>/runtime/<k>, address: signature, byteLength: header + 8·n, entry, parameters, returnType}`.
  The calls are adjacent and no allocation separates them. Everything still happens
  after the digest, restore and count checks; nothing is dereferenced.
- **`resolveManagedPointers`.** It verifies the signature window exactly as for
  `"signature"` (version, parameter and return words) before any patch. It then
  patches the slot with `entry`. A binding's entry must be non-zero and must not
  alias a slot address. Domain checks precede all reads (unchanged). Reject a
  function-entry binding used for a signature slot or vice versa.

### 4.5 JIT pipeline: `prepareManagedSurfaceEntry`

New in `compiler/src/native/managed-entry.ts`. The closed `prepareNativeFunctionEntry`
keeps its restrictions.

```ts
export interface ManagedSurfaceEntryRequest {
  readonly module: Module; // lowerScript output or typed source
  readonly entry: string;
  readonly specifiers: ReadonlySet<string>; // all map to the surface
  readonly instantiations: ReadonlyMap<string, readonly string[]>; // scriptRuntimeSurface()
  readonly directory: SerializedManagedSurfaceDirectory; // already read by D5
  readonly runtime: ManagedSurfaceLayoutRuntime; // the same sources the image used
}
export function prepareManagedSurfaceEntry(request): Result<{
  module: ModuleIR;
  entryId: number;
  abi: ManagedABIRequest;
  frame: string;
}>;
```

1. Adapt imports (generalized `adaptManagedSurfaceEntry`). Accept several
   specifiers, classify by surface membership (B2), erase instantiations (§3.1) and
   reject unknown instantiations (`profile: instantiation not in surface <name>`).
2. Build the entry over the **AOT frame alias** (§4.7) and add the JIT-internal
   `view` binding for the table.
3. Link with `runtime` sources, then `prepareNativeGlobals` → `specializeModule` →
   `checkClosureModule` → `prepareCollectionRuntimes`.
4. Match every binding to `directory.runtimes` by kind, exact element class(es) and
   operation. Unmatched bindings stay unbound until step 7.
5. Plan signature groups (§4.6).
6. `lowerModuleEntries(JIT top-level functions, {...options, importedFunctions, recordBindings: [view], recordTypes, signatureTypes})`.
7. Prune → `optimizeModule` → prune. A surviving import without a directory match
   fails with `profile: <kind><<element>>.<operation> is not provided by the surface`.
   A surviving import whose lowered ABI differs from the directory ABI fails with
   `profile: runtime ABI skew`.
8. Map records with `recordTypes` through both maps. Surface records become
   `ManagedRecordBinding`s whose layout equals the directory layout.
9. `lowerManagedSignatureGroups(…, [reach, pruned])` produces `localFunctions`.
10. Apply the escape rule (§4.6) on final IR.
11. Run `emitModule` with `managedABI {functionBrand, signatures (B8), records, functions}`.
12. Run `resolveManagedPointers`, then `EngineCodeStorage.publish`, then
    `callExecutableManaged`. Any failure publishes nothing.

### 4.6 Membership and the escape rule

For each directory signature class, request `planManagedSignatureGroups` with the
JIT graph's alias type for the class (`@k:type:$Tn`), the IDs of the other aliases,
and every JIT-origin function whose checked type `matches` the class exactly.
A function that matches two classes is an internal error, because classes are
disjoint. **Escape rule (strict D6 default):** every JIT-origin `function-new`
target in the final IR must belong to `localFunctions`. Otherwise reject before
emission with `profile: JIT closure without an exact surface callback class`.
This contains B7 (same ABI, non-member) and also the different-ABI case, which
would otherwise trap at an AOT `call-indirect`. Equal physical ABI never grants
membership. Variance adaptation and JIT-internal-only closures are later
relaxations, with no silent fallback.

### 4.7 Frame, state and GC

- **Frame.** The surface request's `frame` type export is an AOT record, for
  example `ManagedEntryFrame = { readonly imports: unknown; readonly arguments: … }`.
  Its record contract is imported, so the host allocates it with the AOT
  descriptor. JIT code narrows `imports` with the `view` binding against the
  imported table record (`$T0`) and throws `MANAGED_SURFACE_TABLE` on mismatch.
  Script-specific frame fields (`global`, `errors`) belong to S2.
- **Permanent versus movable.** Code slots hold the brand, signature and record
  descriptor addresses, and AOT code entries. All are image or context metadata
  that copying GC never moves. Every function object, table, realm, scope,
  argument list and collection value is a traced frame or heap value.
- **Shared state and completion.** Helpers run on the image's own closures, so
  `created === 1` holds. Runtime entries are stateless (§3.4). An imported call uses
  the same completion protocol as `call-indirect`: a non-1 status takes the
  exceptional branch with the payload at `result+16/24`. The callee pushes and pops
  its own root frames on the context root chain. Domain checks precede every
  foreign read and every publication (unchanged).

## 5. Implementation slices (tests first)

**D6a. Runtime binding names** (`ts-native/src/runtime/index.ts`). Superseded in
detail by the [runtime binding context plan](rt-eval-runtime-binding-context.md),
which resolves the transform-before-check cycle. Tests: the
second transform argument names every operation of every binding, and its element
IDs index `runtime.checked`. Existing transforms are unchanged and
`compileArm64Program` output stays byte-identical. Duplicate equal-class bindings
are reported in binding order.

**D6b. Imported functions in IR and lowering** — ABI-only IR, conservative effects/call boundaries, pruning and body-skipping lowering pass Node tests. The focused imported-function compiler fixture builds and returns 42 in Node; its serial native run is queued. Codegen rejects these imports until D6c supplies explicit entry bindings. (`ir/src/scalar/{model,verify,effects}.ts`,
`ir/src/optimization/{reachability,reachable,inline,index}.ts`,
`ts-native/src/closure/lowering/index.ts`). Tests:

- The §3 Script lowers with `importedFunctions` equal to all option functions. After
  pruning it keeps exactly 15 imports and 0 runtime bodies; the import ABIs equal
  the §3.3 table.
- Verification rejects an import with blocks, an environment, a receiver, a
  `function-new`/`call-indirect` target or `exported: true`.
- `optimizeModule` never inlines or removes a called import. `summarizeEffects`
  of a caller includes throw and allocate.
- An imported nested function or environment-bearing function is rejected.

**D6c. Codegen and leaf** (`codegen/src/aarch64/scalar`, `ir/src/scalar/host.ts`).
Refined by the [runtime entry address plan](rt-eval-runtime-entry-addresses.md):
compiler-authorized `function-address` operations replace the leaf.
Tests: the import call sequence (no guard, `x1 = 0`, memory result, exceptional
branch) and its relocation offsets; unbound import and ABI-mismatch rejection;
`native-function-entry` encoding. Default AOT emission is byte-identical.

**D6d. Directory runtimes** (`managed-directory.ts`, `managed-directory-data.ts`,
`index.ts`). Refined by the [directory v3 runtime plan](rt-eval-runtime-directory-v3.md):
41 exact-alias providers give 355 `Float64Array` slots over 323 targets, and surface
images are sparse (the dense rewrite already declines). Tests: the real vocabulary yields 323 entries in census order, with
first-binding deduplication and the private class excluded; the digest changes with
one operation name, one element class or one ABI word; agreement skew is rejected;
a forced retry pass still converges with the anchors present.

**D6e. Reader and linking** (D5 code, `managed-imports.ts`). Tests with spy leaves:
`function-entry` bindings are issued after all digest and restore checks; an entry
of `0` (environment-bearing function) is rejected; a signature-word mismatch is
rejected before any patch; a foreign domain is rejected before reads; patched bytes
change only the slot.

**D6f. Entry preparation** (`managed-entry.ts`). Refined by the
[managed-surface JIT entry plan](rt-eval-managed-jit-entry.md). Node tests over the §3 Script and
fixture modules: instantiations are erased and unknown ones rejected; the classes
match §3.7; and every negative case in §6 produces its distinct error.

**D6g. Native fixtures** (parent runs them later, serially, `TINT_BUILD_ONLY=1`
under LLDB; no claim before then). Extend
`tools/verify-hosted-managed-surface-directory.ts` with `--entry` (and later
`--entry-dense` for an image built with `denseReferenceLists: true`):

- **Accept:** a JIT function builds `[a, b]` (`unknown[]`) and passes it to an AOT
  helper, which returns an `unknown[]` that JIT reads by index and length. It also
  covers `Map<string, …>` and `Set<$T103>` round trips through AOT helpers, a JIT
  closure returned to AOT and called by an AOT helper after 32 MiB of copying-GC
  churn, a member callback with no JIT call site, throw propagation from an imported
  runtime entry (out-of-range resize) and from a helper with root restoration,
  shared `created === 1`, and dense images reading JIT-created lists.
- **Reject (distinct statuses, foreign pointer never invoked):** an operation not
  in the surface (a JIT-private element type); a tampered `runtimes` ABI word; an
  environment-bearing function substituted for a runtime entry; a foreign or
  unissued domain; a non-member escaping closure with an equal ABI; and a frame
  whose `imports` is not the table.
- Then the §7 regressions of the parent plan and a frozen self-build with
  byte-identical stages (D6b/D6c touch IR and codegen).

## 6. Negative cases and errors

| Case                                                 | Stage   | Error                                                   |
| ---------------------------------------------------- | ------- | ------------------------------------------------------- |
| Instantiation other than the registry's              | profile | `instantiation not in surface <name>`                   |
| Imported value not in the table                      | profile | `managed surface helper is missing: <name>` (existing)  |
| Collection over a JIT-private element type           | profile | `<kind><<element>>.<op> is not provided by the surface` |
| Sort or another operation absent from the census     | profile | same as above                                           |
| Directory ABI differs from the JIT import ABI        | profile | `runtime ABI skew`                                      |
| Escaping non-member JIT closure                      | profile | `JIT closure without an exact surface callback class`   |
| Runtime entry with an environment, or not a function | link    | `function-entry requires an environment-free function`  |
| Signature words of an entry differ                   | link    | existing signature mismatch, before any patch           |
| Foreign or unissued domain                           | link    | existing domain errors, before reads                    |

Language early errors stay `EARLY_ERROR` from `lowerScript`. Unsupported compilation
(profile) is distinct from missing authority (link) and from runtime throws.

## 7. Boundaries, risks and unknowns

1. **Dense lists and exported methods.** Source reading shows that
   `lowerReferenceLists` remaps `function-new` targets. It is unknown whether the
   bind stub's `function-new` of list methods makes the transform decline. A
   decline would be an AOT performance regression, not a correctness issue. D6d
   records `dense-reference-lists` rewritten counts with and without a surface.
2. **JIT compile cost.** The JIT still links and checks the nine runtime sources to
   obtain declarations (about 0.8 s in Node, including lowering of runtime bodies
   that imports remove). The native cost is unmeasured. A precompiled declaration
   graph is the later optimization.
3. **AOT growth.** The image gains 78 anchors (pruned in closed programs),
   about 300 extra retained `function-new` values in the bind body and the
   `runtimes` section. Retaining unused bindings prevents pruning them. Measure in
   the D6 report.
4. **Duplicate instances.** The image already carries 50 duplicate list bindings
   and 11 duplicate map bindings for exactly equal element types (§3.6). D6 exports
   one per class; merging them is a separate AOT cleanup.
5. **Operations outside the census.** List `sort` (`list-sort`/`indexed-sort`) and
   any operation demanded only by a future lowering rejects until the surface
   anchors demand it. Extend the anchors when a lowering feature needs it, never with
   a hand-written list.
6. **Node only.** All numbers are from Node. Native equality of ABIs, layouts and
   counts is proved only by the D6g fixtures and `resolveManagedPointers` per image.
7. **Out of scope.** The S2 Script frame and global environment, eval/`Function`
   scoping, async dynamic bodies, variance adaptation and the two-live-heap proof.

**Next:** after D5, implement D6a–D6f behind Node gates. Hand D6g fixtures and the
self-build to the parent's serial native queue.
