# RT-WEAK: weak collections, WeakRef and FinalizationRegistry

Status: **implemented and validated**. Two pre-entry launch failures remain in
complete selection reports; no semantic failures or unsupported variants.
[Checkpoint](../results/weak-apis-checkpoint-v1.json). Backlog entry: [README](README.md).

## Implementation checkpoint

- The ABI and copying collector implement marker-7 weak cells and ephemerons,
  fixed-point discovery, forwarded keys and transactional clearing of dead pairs.
  Other scanners retain strong behavior by default; generated weak operations
  explicitly reject the unaudited generational profile.
- Checked IR operations, operand/effect/substitution contracts and AArch64
  allocation/access paths are connected through authorized runtime exports.
  Handles use `unknown`, with physical tag/header checks, rather than a fictional
  record layout. [Native allocation/GC evidence](../results/native-weak-slots-published-diagnostic-v1.json)
  has a separate [source-identity correction](../results/native-weak-slots-source-identity-correction-v1.json).
- WeakMap/WeakSet implement object/nonregistered-symbol keys, iterable construction,
  brands and upserts. [Six native API cases](../results/native-weak-collections-validation-v1.json)
  pass. The complete unchanged selections pass WeakMap 281/281 and WeakSet
  169/170, retaining one pre-entry launch failure.
- WeakRef implements kept objects across synchronous execution and job boundaries.
  FinalizationRegistry uses weak targets, weak tokens and a weak registry directory;
  cleanup callbacks run as jobs, never during collection.
  [Five native API cases](../results/native-weak-references-validation-v1.json) and
  [real-GC lifetime/cleanup checks](../results/native-weak-lifetimes-v2.json) pass.
  Complete selections pass WeakRef 58/58 and FinalizationRegistry 93/94,
  retaining one pre-entry launch failure in the latter. Neither family has
  semantic failures or unsupported variants. The initial lifetime fixture and its diagnostic are retained with
  [the corrected lifetime assertion explained](../results/native-weak-lifetimes-count-analysis-v1.json).
- Workspace gates pass: 3,717 tests, TypeScript checks, dependency boundaries and
  focused formatting. Complete family reports are recorded in
  [the dashboard](../test262.md). The frozen native self-build produces
  byte-identical 62,553,282-byte stage images; signing and DWARF checks pass. No combined weak
  family or whole-suite percentage is claimed from these regression fixtures.

The dependent complete reruns now pass
[Map 405/405](../results/test262-map-weak-followup-native-v1.json) and
[Set 764/764](../results/test262-set-weak-followup-native-v1.json), without failures,
unsupported variants or infrastructure errors.

## Original planning baseline

- **Population:** 603 pinned variants were initially unsupported: `built-ins/WeakMap` 281,
  `WeakSet` 170, `WeakRef` 58 and `FinalizationRegistry` 94. Every file runs as a
  plain Script. None is async or module, none needs `$262.agent`, and none needs
  `$262.gc`. Only the four `proto-from-ctor-realm.js` files need
  `$262.createRealm`, which the runner already provides.
- **Spillover:** the current [Map report](../results/test262-map-native-v2.json)
  has 26 failures, and all of them are WeakMap brand checks or `valid-keys.js`.
  The [Set report](../results/test262-set-native-v1.json) has 16 failures that
  are WeakSet brand checks or `valid-values.js`. `Object/prototype/toString`
  and `Object/seal` have four WeakMap/WeakSet files. Staging, Error and
  ShadowRealm use these APIs elsewhere.
- **Independence:** this does not touch eval, modules, agents, Intl or the
  parent's RelativeTimeFormat work. It does touch shared object and realm files;
  see [Coordination](#coordination).
- **Project rule:** [language coverage](../language-coverage.md) (Map/Set
  section) requires **genuine weak reachability, not strong storage under weak
  collection names**. Most of the engineering is therefore in the collector, not
  the API layer.

Expected impact is up to about 603 direct variants plus about 50 currently
failing Map/Set/Object variants. That is a population ceiling, not a prediction.
Only complete reruns can state the outcome.

## Specification

Pinned behavior follows the current living specification plus the upsert
methods, which the suite tags `upsert`:

- [WeakMap objects](https://tc39.es/ecma262/multipage/keyed-collections.html#sec-weakmap-objects)
  and [WeakSet objects](https://tc39.es/ecma262/multipage/keyed-collections.html#sec-weakset-objects).
  Constructors share [AddEntriesFromIterable](https://tc39.es/ecma262/multipage/keyed-collections.html#sec-add-entries-from-iterable)
  with Map.
- [WeakRef objects](https://tc39.es/ecma262/multipage/managing-memory.html#sec-weak-ref-objects)
  and [FinalizationRegistry objects](https://tc39.es/ecma262/multipage/managing-memory.html#sec-finalization-registry-objects).
- Processing model: [§9.9](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-weakref-processing-model),
  covering liveness, execution and
  [HostEnqueueFinalizationRegistryCleanupJob](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-host-cleanup-finalization-registry).
  Also [ClearKeptObjects](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-clear-kept-objects),
  [AddToKeptObjects](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-addtokeptobjects),
  [CleanupFinalizationRegistry](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-cleanup-finalization-registry)
  and [CanBeHeldWeakly](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-canbeheldweakly).
- [Upsert](https://tc39.es/proposal-upsert/): `WeakMap.prototype.getOrInsert`
  and `getOrInsertComputed`. The test `info` blocks give this step order:
  RequireInternalSlot, then **IsCallable(callbackfn) at step 3**, then
  **CanBeHeldWeakly(key) at step 4**.

Key observable rules:

- **CanBeHeldWeakly(v):** true for any Object. True for a Symbol only when
  `KeyForSymbol(v)` is undefined, so registered `Symbol.for` symbols are
  rejected and well-known symbols are accepted.
- **Rejected keys:**
  - `set`, `getOrInsert`, `getOrInsertComputed`, `WeakSet.prototype.add`, the
    WeakRef constructor and `register` throw **TypeError**.
  - `get` returns `undefined`.
  - `has` and `delete` return `false`.
  - `unregister` throws TypeError.
  - A rejected unregister token in `register` throws TypeError unless it is
    `undefined`.
- **Abrupt completions and ordering:**
  - Constructors check NewTarget, then run `OrdinaryCreateFromConstructor`.
    The `prototype` Get is observable and can be abrupt. Brand slots are set
    before iteration.
  - WeakMap/WeakSet: `Get(map, "set"/"add")`, then IsCallable, then iterate.
    Non-object entries close the iterator (`iterator-items-are-not-object-close-iterator.js`).
    Adder abrupt completions close the iterator too. Reuse Map's path.
  - WeakRef: NewTarget, then **CanBeHeldWeakly(target) before**
    OrdinaryCreateFromConstructor. Then AddToKeptObjects(target).
  - FinalizationRegistry: NewTarget, then IsCallable(cleanupCallback) before
    OrdinaryCreateFromConstructor. Record `[[Realm]]` and a JobCallback.
  - `register`: brand, CanBeHeldWeakly(target), `SameValue(target, heldValue)`
    throws TypeError, then token rules. Returns `undefined`.
  - `unregister`: removes every cell whose token is SameValue to the argument
    and returns a boolean.
  - `getOrInsertComputed`:
    1. Look up the key. If present, return without calling the callback.
    2. Call `callbackfn(key)`.
    3. Look up again. If the callback inserted the key, **overwrite** it
       (`overwrites-mutation-from-callbackfn.js`).
    4. Return the value.
  - Callback throws propagate, and the map is unchanged
    (`check-state-after-callback-fn-throws.js`).
- **Brand checks:** methods use `[[WeakMapData]]`, `[[WeakSetData]]`,
  `[[WeakRefTarget]]` and `[[Cells]]`. A Map, Set, Array, plain object or the
  prototype object itself throws TypeError. Map and Set methods must likewise
  reject WeakMap and WeakSet instances.
- **Prototype metadata:** `@@toStringTag` is `"WeakMap"`, `"WeakSet"`,
  `"WeakRef"` and `"FinalizationRegistry"`. Lengths: WeakMap/WeakSet 0,
  WeakRef 1, FinalizationRegistry 1, register 2, unregister 1, deref 0. Methods
  are not constructors (`isConstructor.js`). Descriptors are checked with
  `propertyHelper.js`.
- **Non-determinism:** the specification allows any latency before collection.
  Test262 cannot observe collection without `$262.gc`, so the unchanged suite
  only measures the API layer. Weak liveness needs separate native fixtures;
  see [Validation](#validation).
- `cleanupSome` is **not** in the pinned suite (`find` returns no directory).
  Do not implement it.

## Current implementation (reuse points)

| Concern                     | Location                                                                                                                                                                                                                                                                                                                                                         | Reuse                                                                                                                                                                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Map/Set intrinsic template  | `packages/js-runtime/src/objects/map-intrinsics.ts` (`installMapIntrinsics`, `requireMap`, upsert loop), `set-intrinsics.ts`                                                                                                                                                                                                                                     | Constructor shape, the `addEntriesFromIterable` adder protocol (`entry-iteration.ts`), the `getOrInsert*` structure and `builtinFunction`/`builtinProperty`/`builtinFunctionMetadata`. `callObjectValue(...).error === "type"` only means "not callable"; thrown errors propagate. |
| Brand slots                 | `OrdinaryObject` and `createObject` in `packages/js-runtime/src/objects/operations.ts`. The literal initializes every `internal*` field.                                                                                                                                                                                                                         | Add **one** field, `internalWeakData`, holding a discriminated record, rather than four fields. Every object literal grows by each added field.                                                                                                                                    |
| Realm prototypes            | `ErrorRealm` and `createErrorRealm` in `objects/errors.ts`. `IntrinsicPrototype` and `intrinsicPrototype` in `objects/functions.ts`. `constructorPrototype(newTarget, fallback, realm, hooks)`                                                                                                                                                                   | Implements GetPrototypeFromConstructor, including the function realm needed by `proto-from-ctor-realm.js`.                                                                                                                                                                         |
| Symbol registry             | `objects/symbols.ts`: `registeredSymbolKey(registry, symbol)`, `SymbolValue`, and the realm's `symbolRegistry`, which child realms share                                                                                                                                                                                                                         | KeyForSymbol for CanBeHeldWeakly                                                                                                                                                                                                                                                   |
| Same-value checks           | `scriptSameValue` and `scriptStrictEqual` in `objects/values.ts`                                                                                                                                                                                                                                                                                                 | Key identity. Keys are only objects or symbols, so identity is enough.                                                                                                                                                                                                             |
| Agent and jobs              | `objects/jobs.ts`: `ScriptAgent`, `enqueueScriptJob`, `drainScriptJobs`, `createSourceExecutionContext`                                                                                                                                                                                                                                                          | Kept-objects list, cleanup-job enqueueing, and end-of-job ClearKeptObjects                                                                                                                                                                                                         |
| Unsupported reporting       | `rejectUnsupportedExecution(realm)` in `objects/errors.ts`                                                                                                                                                                                                                                                                                                       | Use when no weak storage service is configured. Never silently fall back to strong storage.                                                                                                                                                                                        |
| Service-injection precedent | `bytes/shared.ts` (`SharedBlockService`), `native-runtime/src/shared-blocks.ts`, `tools/node-shared-block-service.ts`                                                                                                                                                                                                                                            | The same pattern: a js-runtime contract, a native implementation built from trusted leaves, and a Node test double                                                                                                                                                                 |
| Test262 realm host          | `createRealmHost` in the generated prelude in `tools/test262-native.ts`. It installs per realm and drains jobs at the end of `runNativeScripts`.                                                                                                                                                                                                                 | Add the installer, service creation and ClearKeptObjects points                                                                                                                                                                                                                    |
| Trusted lowering bindings   | `recordBindings` and `hostBindings` in `tools/test262-native.ts` and `packages/compiler/src/build.ts`. Record bindings are in `packages/ts-native/src/closure/lowering/record-bindings.ts`. Host operations are in `packages/ir/src/scalar/host.ts`.                                                                                                             | Pattern for binding a trusted TypeScript declaration to compiler-lowered IR                                                                                                                                                                                                        |
| Managed special allocations | Reference vectors (marker 6). IR ops `reference-vector-*` in `packages/ir/src/scalar/{model,operands,effects,substitution,index}.ts` and `optimization/function-builder.ts`. Codegen in `packages/codegen/src/aarch64/scalar/index.ts` (`allocateIndexed`, `vectorHeader`, `rememberedBarrier`). See [reference-vector storage](../reference-vector-storage.md). | Precedent for adding a header kind end to end: allocation, extent, scan, relocation, roots and barriers                                                                                                                                                                            |
| Collector                   | `packages/native-runtime/src/copying.ts` (`initializeCopyingRuntime`, which the Test262 runner uses: `collector: "copying"`), `tracing/nursery.ts` (`createNurseryEvacuator`), `tracing/scan.ts`, `tracing/extent.ts`, `generational.ts`, `tracing/collector.ts` (graph marker), `heap/compaction.ts`                                                            | Weak processing goes into the evacuator. Every other consumer must treat weak edges **strongly**, which is safe and conservative.                                                                                                                                                  |

Current header kinds (`scan.ts`, `extent.ts`):

- `1`: string
- `2`–`5`: numeric arrays (`flags` 0 = owned, 1 = borrowed, 2 = view)
- `6`: reference vector
- 8-aligned pointer: record descriptor

The evacuator reuses the low four bits of each `sizes[i]` as a classification:
marker, plus 8 for views. **Marker 7 now represents weak cells.** General values are two words
(tag, payload): 0 undefined, 1 number, 2 boolean, 3 string, 4 null,
5 object/function, 6 symbol, 7 bigint. Tags 3, 5, 6 and 7 carry references.
The evacuator temporarily uses classification 15 for processed weak cells,
then normalizes the scratch sizes before commit. Object keys hash to 0 in
`collection-keys.ts` and `linked-map.ts` because the ABI exposes no identity
hash. Map already resolves object keys with linear chains.

## Design

### 1. Collector primitive: the weak slot (marker 7)

Add one fixed 48-byte managed allocation kind, owned by `@tint/abi`:

```text
+0   marker   = 7
+8   flags    = 0 weak cell | 1 ephemeron
+16  key.tag     general value; never traced strongly by the evacuator
+24  key.payload
+32  value.tag   flags 0: always undefined. flags 1: traced iff key survives
+40  value.payload
```

There is no `next` link. Owners keep slots in ordinary arrays, which become
reference vectors, so the slots themselves are strongly reachable.

Collector contract:

- **Strong consumers.** `nativeObjectExtent` accepts marker 7 with flags 0 or 1
  at size 48. `scanObject` gains a mode parameter, and its **default is strong**:
  it visits key and value as general slots. The graph marker, compaction, the
  generational remembered-set scan and anything else that scans then stays
  correct. It just retains weak targets. That is legal latency, though not
  genuine weakness.
- **Weak evacuation.** In `tracing/nursery.ts` `preparePlan`:
  1. When scanning a class-7 survivor, skip the key. For flags 1, visit the
     value only if the key is already resolved. A key is resolved if
     `resolveReference(key, false)` is defined, or it is external, or it lies
     outside the source window.
  2. Replace the single survivor loop with a fixed-point loop:

     ```text
     scanned = 0
     do {
       for (; scanned < plan.count; scanned++) scanSurvivor(scanned)  // may grow count
       progress = false
       for each class-7, flags-1 survivor whose value is not yet visited:
         if keyResolved(survivor): visit value slot (output = copied address); progress = true
     } while (progress)
     ```

     The rescan is O(ephemerons × rounds). That is acceptable for the first
     version. Record a pending bitset in scratch later if profiling demands it.

  3. **Clearing pass.** This runs after the fixed point and before the derived
     backing pass. For every class-7 survivor:
     - Live managed key: append a fixup of the copied key-payload slot to the
       forwarded address.
     - External key: leave it unchanged.
     - Dead key: append fixups that set the key tag to undefined and the key
       payload to 0. For flags 1, do the same to the value. **This is
       mandatory for safety:** an unvisited value payload still points into
       from-space.
       `append` already accepts a value of 0. Fixups target the destination
       copy, using `plan.target + destination + offset`.
  4. Nothing may run user code or allocate. Weak processing stays inside the
     existing prepare/commit failure contract: failure before commit changes
     scratch only.
- **Generational runtime.** The default for the first version: `generational.ts`
  minor collection uses the same evacuator. Weak slots resident in the nursery
  get weak semantics. Old-generation slots reached through the remembered set
  are scanned strongly (conservative). Codegen must emit the remembered barrier
  for weak-slot stores, exactly as for vector stores. If that audit is not
  done, the build must reject the weak ops when `generationalBarriers` is on.
  It must not miscompile.
- **Moving relocation.** Key and value slots are ordinary general slots for
  fixup purposes, so `relocation/*` and `heap/compaction.ts` need no special
  case beyond accepting marker 7.

### 2. Compiler surface

Add a trusted declaration module, for example
`packages/native-runtime/src/intrinsics/weak.ts`, exported through a narrow
entry point. Its functions throw `"HOST_UNAVAILABLE"` in Node, like the other
intrinsic modules:

```ts
// Conceptual handle only: do not implement this as an ordinary branded record.
// Marker-7 storage has no record descriptor or physical brand property.
// Prefer unknown at the trusted boundary with checked native access, or add a
// genuinely opaque compiler type before exposing a narrower source type.
type WeakSlot = unknown;
export function createWeakSlot(
  key: unknown,
  value: unknown,
  ephemeron: boolean,
): WeakSlot;
export function weakSlotKey(slot: WeakSlot): unknown; // undefined once cleared
export function weakSlotValue(slot: WeakSlot): unknown;
export function setWeakSlotValue(slot: WeakSlot, value: unknown): void; // ephemeron only
export function clearWeakSlot(slot: WeakSlot): void; // explicit delete
```

Add IR ops `weak-slot-new`, `weak-slot-key`, `weak-slot-value`,
`weak-slot-set-value` and `weak-slot-clear`, following every
`reference-vector-*` touchpoint:

- model and operand typing
- effects: `new` allocates and is a safepoint; set and clear are managed
  stores with barriers
- substitution and function builder
- codegen: allocation through the existing linear/slow path, field loads and
  stores, and the remembered barrier

Bind the declarations with an explicit authorization list, analogous to
`recordBindings`. Recognition must follow declaration identity, not spelling
([trusted intrinsics](../trusted-intrinsics.md)). Root the key and value
operands across the allocating `new`, following
[memory and lifetimes](../memory-and-lifetimes.md): "Roots and function handoff".

### 3. Runtime contract (js-runtime)

```ts
// objects/weak-storage.ts: portable contract, no native imports
export interface WeakStorageService {
  create(key: unknown, value: unknown, ephemeron: boolean): unknown; // opaque cell
  key(cell: unknown): unknown; // undefined when collected or cleared
  value(cell: unknown): unknown;
  setValue(cell: unknown, value: unknown): void;
  clear(cell: unknown): void;
}
export type WeakData =
  | { readonly kind: "map"; cells: unknown[] } // ephemerons
  | { readonly kind: "set"; cells: unknown[] } // weak cells
  | { readonly kind: "ref"; readonly cell: unknown } // weak cell
  | {
      readonly kind: "registry";
      readonly realm: ErrorRealm;
      readonly cleanup: unknown;
      cells: RegistryCell[];
    };
interface RegistryCell {
  readonly target: unknown /*weak cell*/;
  readonly held: unknown /*strong*/;
  readonly token: unknown | undefined; /*weak cell*/
}
```

- **Agent state.** Weak semantics are agent-wide, so add to `ScriptAgent`:
  - `weakStorage: WeakStorageService | undefined`
  - `keptAlive: unknown[]` (the spec's `[[KeptAlive]]`)
  - `registries: unknown[]`: weak cells pointing to registry objects, so the
    list never keeps a registry alive
    Child realms already share the parent's agent.
- **Missing service.** With no service, every constructor calls
  `rejectUnsupportedExecution`. The outcome is explicit `unsupported`, never
  strong storage.
- **Lookup.** Linear scan of `cells`. Compare `key(cell)` to the probe with
  SameValue. Cleared cells (`undefined` key) count as absent and are spliced
  out on the next mutation. Compaction happens only in mutators, not in
  `get`/`has`, which keeps reads non-allocating. This matches Map's current
  O(n) object-key behavior.
- **WeakSet** stores flags-0 cells. Its value is unused.
- **ClearKeptObjects** truncates `keptAlive`:
  - in `drainScriptJobs` after each job, including abrupt ones
  - in the hosts after each top-level Script evaluation
    The host owns the "synchronous sequence completes" boundary.
- **HostEnqueueFinalizationRegistryCleanupJob.** At each ClearKeptObjects
  point:
  1. Walk `agent.registries`.
  2. For each live registry with any cell whose `key(target)` is undefined,
     enqueue one cleanup job with `enqueueScriptJob`, using the registry's
     realm and execution context.
  3. The job runs CleanupFinalizationRegistry: remove each empty cell and
     call `cleanup(held)`. Abrupt completions follow the job error path.
  4. Do not enqueue a second job while one is pending. Keep a per-registry
     flag.
     No GC epoch intrinsic is needed for the first version. Scanning at
     boundaries costs O(total cells).

### 4. Ownership and layout changes

| Package                                                          | Change                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@tint/abi`                                                      | Weak-slot marker, flags and offsets constants (new module or `relocation.ts` neighbor)                                                                                                                                                                                                                               |
| `@tint/native-runtime`                                           | `tracing/{extent,scan,nursery}.ts`, the strong default in the graph marker, the generational policy, `intrinsics/weak.ts` declarations, and a native `WeakStorageService` factory built on them                                                                                                                      |
| `@tint/ir`, `@tint/codegen`, `@tint/ts-native`, `@tint/compiler` | IR ops, lowering, the binding authorization list and the build option (Test262 build list and `verify-hosted-script.ts` host list)                                                                                                                                                                                   |
| `@tint/js-runtime`                                               | `objects/weak-storage.ts`, `objects/weak-collections.ts` (installer), `objects/finalization-registry.ts`, the `OrdinaryObject.internalWeakData` slot, four realm prototypes with matching `IntrinsicPrototype` names (`"weak-map"`, `"weak-set"`, `"weak-ref"`, `"finalization-registry"`), and `ScriptAgent` fields |
| `tools/`                                                         | `node-weak-storage-service.ts` (Node test double: `WeakRef` keys and strong values, documented as non-conformant liveness), prelude wiring in `test262-native.ts` and `verify-hosted-script.ts`                                                                                                                      |
| Docs                                                             | Weak liveness section in `memory-and-lifetimes.md`, the language-coverage Map/Set row, and the [Test262 dashboard](../test262.md) after complete reruns                                                                                                                                                              |

If new public subpaths are added, update the package manifests,
`workspace-contracts.json` and the compiler catalog
(`node tools/generate-compiler-catalog.ts`, then format).

## Implementation slices

Each slice is independently verifiable. Do not merge slice C before A and B
are native-verified, or WeakMap would ship without genuine weakness.

**A. Collector semantics (native-runtime and abi only).**

- Extent and scanner accept marker 7. Strong mode is the default.
- Evacuator weak mode: the fixed point and the clearing pass.
- Node unit tests build synthetic heaps in typed-array memory, following the
  existing native-runtime suites. Cover:
  1. A cell whose key is only weakly reachable is cleared, and its value is
     cleared too.
  2. A weakly referenced key that is also rooted is forwarded.
  3. Ephemeron chain `k1 → v1 = k2 → v2`: all live when `k1` is rooted, all
     cleared when it is not.
  4. A cycle `v → k` inside one entry does not keep `k` alive.
  5. External/image keys are never cleared.
  6. Prepare failure leaves the heap untouched.
  7. Strong-mode consumers retain everything.

**B. IR and codegen primitive.**

- Ops, effects, binding authorization and allocation.
- Native fixture via LLDB with `TINT_BUILD_ONLY=1`:
  1. Allocate a weak slot to a fresh object.
  2. Drop the root and force collections by allocation pressure.
  3. Assert the key reads `undefined` and an ephemeron value is gone.
  4. Assert a rooted key survives with a correct identity after several
     moving collections.
- Generational build either works conservatively or rejects the ops. Test
  whichever is chosen.
- Self-build: the runtime collector code changed, so rerun the frozen
  self-build stage comparison even though the compiler does not use weak ops.

**C. WeakMap and WeakSet API.**

- Contract, installer, realm wiring, the `internalWeakData` brand and the Node
  service double.
- Node tests cover:
  - CanBeHeldWeakly matrices, including registered, well-known and fresh
    symbols
  - constructor ordering and iterator closing
  - upsert ordering and overwrite
  - brand errors both ways (Map methods on WeakMap and the reverse)
  - descriptors and lengths
- Run unchanged Test262 `built-ins/WeakMap` and `built-ins/WeakSet`, then rerun
  `built-ins/Map`, `built-ins/Set` and `built-ins/Object/prototype/toString`.

**D. WeakRef and kept objects.**

- Constructor ordering, `deref` with AddToKeptObjects, and ClearKeptObjects
  hooks in `drainScriptJobs` and both hosts.
- Native fixture: a target dereferenced in the current job survives a forced
  collection in that job, and is collectible after the job boundary when it
  is otherwise unreachable.
- Run unchanged `built-ins/WeakRef`.

**E. FinalizationRegistry.**

- Cells, `register`/`unregister` semantics, the registry list and cleanup-job
  enqueueing at boundaries.
- Native fixtures:
  1. Cleanup is called with the held value after the target dies.
  2. `unregister` before collection prevents the callback.
  3. The held value stays alive while the target is alive.
  4. The registry itself being unreachable suppresses cleanup.
  5. A throwing callback reports through the job error path.
- Run unchanged `built-ins/FinalizationRegistry`.

**F. Records.**

- Run a complete selection over all four families as a new immutable report.
- Complete reruns of Map and Set.
- Update the dashboard in place.
- Update the language-coverage row and `memory-and-lifetimes.md`.

## Validation

- **Node** (`pnpm check` and focused js-runtime/native-runtime tests): API
  ordering, abrupt completions and brand matrices against the specification.
  Node's own WeakMap is only a reference for API behavior. Node liveness is not
  evidence.
- **Native, required:**
  - collector fixtures under LLDB (slices B, D and E), asserting stopped-at-entry
    and the expected exit
  - unchanged Test262 complete selections (slices C to F)
  - frozen self-build with stage-image comparison
- **Liveness evidence is native-fixture only.** The unchanged suite cannot
  observe collection. Do not claim "genuine weakness" from Test262 passes.
- Keep all unsupported, failure and infrastructure outcomes in denominators.

## Coordination

The parent's INTL-RTF work is modifying `operations.ts`
(`internalRelativeTimeData`), `errors.ts` (`relativeTimeFormatPrototype`),
`functions.ts` (`"intl-relative-time-format"`) and the catalog. Start slice C
after that lands, or rebase onto it. Slices A and B touch none of those files.

## Risks and open questions

1. **Ephemeron cost.** The rescan-until-fixed-point loop is quadratic in the
   worst case. That is fine for Test262 and fixtures, but measure before using
   it in large programs.
2. **Lookup cost.** Linear WeakMap lookup is O(n). An identity hash needs a
   header or side-table design that survives moving GC. Defer it, and do not
   hash addresses.
3. **Generational completeness.** Treating the old generation conservatively
   means old weak targets are never cleared until a policy exists for
   collecting old-generation weak slots. This is spec-legal but must be
   documented. Decide whether the build should instead reject weak ops under
   generational barriers.
4. **Scratch capacity.** The clearing fixups add up to four words per dead
   ephemeron to the fixup arrays. Capacity overflow must fail `prepare` safely,
   as it does today. It must never commit a partial plan.
5. **Script-held cells.** Cells are opaque `unknown` to js-runtime. Ensure no
   Script-visible path can return a cell, and keep the `WeakSlot` type
   non-forgeable (trusted declaration identity).
6. **Kept-objects boundaries.** Kept objects must also clear around
   `$262.evalScript` and agents once those exist (RT-EVAL and HOST-AGENT).
   Record that as a follow-up, not a blocker.
7. **`$262.gc`.** It could be layered on the same collector entry later
   (HOST-GC) for `staging/sm`. It is not required here.
