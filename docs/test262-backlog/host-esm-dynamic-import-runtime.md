# HOST-ESM M3a: dynamic import runtime plan

This is the implementation plan for the runtime half of M3a, as recommended in the
[dynamic import census](host-esm-dynamic-import-census.md) §10. It settles
importer identities, the loaded-module cache, EvaluateImportCall,
ContinueDynamicImport and `import.meta` access. Script, Module and Realm
referrers share one contract, so M3b can be a tools-only host change. The
detailed M3a lowering plan is a separate next task (§8 is the handoff). This
document does not repeat the census counts or plan host routing.

This is research only. No source, test, manifest, catalog, report, dashboard,
queue, journal, marker or snapshot was changed. Nothing was built, and no image,
native binary, debugger, controller or agent was run. The
`run-module-fixture-syntax-selections-v2.mjs` controller, which is running the M2c
selections on the frozen `node-toolchain-module-fixture-syntax-v1` snapshot
(`2c72f4c9…`, 562 files), and the DirectEval pause were left alone.

**Baseline.** Main reports 563 live source files. This plan did not re-measure
them. They include the prerequisite: `modules/import-meta.ts` (`getImportMeta`),
`ModuleRecord.importMeta`, the empty default host policy and 3 semantic tests.
The prerequisite has no native evidence yet. The spec is the ECMA-262 2027 draft
from tc39.es, fetched 2026-11-05 into `/tmp/m3a-runtime/*.html` (§13.3.10.2–3,
§13.3.12.1 and §16.2.1.10–11). Node is v24.12.0.

**All probes are Node-only and non-native.** `/tmp/m3a-runtime/p/probe.mjs` and
`probe2.mjs` run ESM files in `/tmp` under Node. `/tmp/m3a-runtime/vocab.mjs`
imports the built `js-engine/dist/lowering/runtime-imports.js` and only counts
bindings. Nothing was emitted.

## 1. Spec contract (verified against the fetched text)

**EvaluateImportCall.** The referrer is GetActiveScriptOrModule(), or the current
Realm Record when that is null. The specifier and then the options are
evaluated, and a throw from either propagates **synchronously**. Only then is
`! NewPromiseCapability(%Promise%)` created, in the current realm. From that
point on, every failure **rejects** the promise. That covers throws from
ToString(specifier), `Get(options, "with")` and
`EnumerableOwnProperties(with, key+value)`. It also covers TypeErrors for
options or a `with` that is neither `undefined` nor an Object, for a String key
whose value is not a String (Symbol keys are skipped), and for a failed
AllImportAttributesSupported. Static loading raises a SyntaxError for that last
case, as `innerLoading` already does. The attributes are then sorted by key in UTF-16 order, and
`HostLoadImportedModule(referrer, request, empty, capability)` is called.

**FinishLoadingImportedModule** records only normal results in
`[[LoadedModules]]`, matched with ModuleRequestsEqual. An existing entry must
hold the same module. A GraphLoadingState goes on to ContinueModuleLoading, and
a capability to ContinueDynamicImport.

**ContinueDynamicImport.** An abrupt result rejects. Otherwise:

1. `loadPromise = LoadRequestedModules()`.
2. Create `onRejected` (length 1) and `linkAndEvaluate` (length 0) as builtins in
   the **current realm**.
3. `PerformPromiseThen(loadPromise, linkAndEvaluate, onRejected)`.

`linkAndEvaluate` rejects if Link() throws. Otherwise it chains Evaluate() to
`onFulfilled`, which resolves with GetModuleNamespace through the ordinary
Resolve, including its thenable lookup.

**ImportMeta.** GetActiveScriptOrModule() must be a Source Text Module Record.
The object is OrdinaryObjectCreate(null), created lazily, filled with the host
properties and finalized once.

**Host requirements.** An equal (referrer, request) pair must always complete
normally with the same module. The payload is opaque. Referrers are Script,
Cyclic Module or Realm records. Dynamic import **always** calls the host.

## 2. Current source facts

**Active identity.** `ScriptExecutionContext.scriptOrModule` is `unknown`
(`objects/jobs.ts:27-32`). It holds one of:

- `$script` (`lowering/index.ts:288-297`).
- The ModuleRecord (`linking.ts:78`, `evaluation.ts:68`).
- `$site.scriptOrModule` for direct eval.
- The inherited identity carried in `$script.hostDefined`, for indirect eval
  and dynamic functions (`script-evaluation.ts:200-203`, `dynamic-function.ts:202`).

About 30 tests and native fixture sources use opaque identities such as `"a"`,
`42` and `{}`.

**Records and loader.** `ScriptRecord` is `{kind:"script", realm, hostDefined}`
(`jobs.ts:15-25`), and the frame's `$argument1` uses it. `ModuleRecord.loaded`
is indexed by static request and read only through `loadedModule`.

`ModuleLoader` takes `(referrer: ModuleRecord, …, payload: GraphLoadingState)`.
`finishLoadingImportedModule` throws `MODULE_REQUEST_INVARIANT` for a request
outside `shape.requests` (`loading.ts:33-38,134-161`). That signature is written
out in `tools/test262-native.ts:543` and
`tools/verify-hosted-module-evaluation.ts:25,57,66`.

**Views.** `viewObjectValue` and `viewDirectEvalSite` throw `UNBOUND_…` until an
image build binds them. The binding is `recordBindings` operation `"view"`, an
exact `general-record-is` check
(`ts-native/src/closure/lowering/record-bindings.ts`, `index.ts:2780-2880`). Node
tests rebind them in `test/ordinary-object-host-record-views.ts`.

**Primitives to reuse.** For modules: `createModuleCapability`,
`loadRequestedModules`, `linkModule` (typed result), `evaluateModule`,
`getModuleNamespace` and `getImportMeta`. For promises: `performPromiseThen`,
`createScriptPromiseHooks` and `builtinFunction`. For objects: `stringValue`,
`viewObjectValue`, `ownKeys`, `getOwnProperty` and `getProperty`. For requests:
`canonicalModuleRequest` and `moduleRequestsEqual`.

**Vocabulary** (`vocab.mjs`). The default Script form has 114 bindings, `script`
with every flag 124, `direct-eval` 126, and `module` and `all` 128 each. `module`
includes 4 modules-runtime bindings, and `all` has none.

## 3. Decisions

**D1. Keep `scriptOrModule: unknown`, and narrow it with two exact record views**
in the new `modules/referrer.ts`:

```ts
export function viewModuleRecord(value: unknown): ModuleRecord | undefined {
  throw "UNBOUND_MODULE_RECORD_VIEW";
}
export function viewScriptRecord(value: unknown): ScriptRecord | undefined {
  throw "UNBOUND_SCRIPT_RECORD_VIEW";
}
```

These reuse the existing single-parameter `"view"` binding: no cast and no new
compiler operation. Retyping the field to a record union was rejected. It would
ripple into `DirectEvalSite`, the carrier `hostDefined`, every opaque test
identity and the native fixtures, and change the direct-eval site descriptor.
Retyping is the fallback only if gate G1 (§11) finds a record without a managed
layout. Settle G1 first.

**D2. One referrer union.** Each member has `kind` and `realm`. `ErrorRealm` is
wrapped, because it has no discriminant.

```ts
export type ModuleReferrer = ModuleRecord | ScriptRecord | RealmReferrer;
export interface RealmReferrer {
  readonly kind: "realm";
  readonly realm: ErrorRealm;
  readonly loadedRequests: LoadedModuleRequest[];
}
export interface LoadedModuleRequest {
  readonly request: ModuleRequest;
  readonly module: ModuleRecord;
}
```

**D3. Where `[[LoadedModules]]` lives.**

- **ModuleRecord.** The static `loaded` slots, plus a new
  `readonly loadedRequests: LoadedModuleRequest[]` for requests outside
  `shape.requests`. `loadedModule`, linking and evaluation stay static-only.
  Dynamic edges are never graph edges, because Link and Evaluate walk
  `[[RequestedModules]]`.
- **ScriptRecord.** Gains `readonly loadedRequests`, created empty by
  `createScriptRecord`, whose signature is unchanged. This answers census Q1:
  the list goes on `$script`, not in a side table. Indirect-eval carriers carry
  an unused list.
- **Realm.** `ErrorRealm` gains a mutable `realmReferrer`, which
  `realmReferrer(realm)` creates once.

**D4. GetActiveScriptOrModule is a runtime read.**
With no context or an `undefined` identity,
`activeModuleReferrer(realm)` returns the referrer of the current realm
(`active.realm`, or else the argument). Otherwise it tries `viewModuleRecord`,
then `viewScriptRecord`. Any other identity calls
`rejectUnsupportedExecution(current)`. Source functions keep their definition identity, and jobs, generators and async
functions propagate it. So lowered code needs no `$module`.

**D5. The payload is a union.** A second finish on one dynamic payload is a host
fault, `MODULE_DYNAMIC_PAYLOAD_INVARIANT`.

```ts
export interface DynamicImportState {
  readonly kind: "dynamic";
  readonly capability: ModuleCapability;
  readonly hooks: ObjectHooks<unknown>;
  finished: boolean;
}
export type ModuleLoadPayload = GraphLoadingState | DynamicImportState;
export type ModuleLoader = (
  referrer: ModuleReferrer,
  request: ModuleRequest,
  hostDefined: unknown,
  payload: ModuleLoadPayload,
) => void;
```

**D6. Graph loading is preserved exactly.** A `graph` payload still requires a
ModuleRecord referrer and a static request, and otherwise throws
`MODULE_REQUEST_INVARIANT`. `isLoading`, `pendingModulesCount`, `visited` and the
never-roll-back status rule are unchanged. Failures record nothing, so a later
import retries the host. `recordLoadedModule` checks the static slot, then
`loadedRequests`, and a conflicting module throws
`MODULE_LOAD_IDENTITY_INVARIANT`.

**D7. Realms.** The promise and the option TypeErrors use the current realm at
the call. The three closures are `builtinFunction`s of the current realm when
ContinueDynamicImport runs. Link SyntaxErrors keep `linking.ts`'s `active.realm`
rule, which inside the job is the builtin's realm. Tracking uses
`createScriptPromiseHooks`, like `createModuleCapability`.

**D8. Attributes.** EnumerableOwnProperties(key+value) is `ownKeys`, then
`getOwnProperty` and `getProperty` **interleaved per key**. No entry arrays are
allocated, because they are unobservable. Extract
`allImportAttributesSupported(realm, attributes)` from `innerLoading`. Static
failures raise a SyntaxError, and import-call failures a TypeError. Sort with
`canonicalModuleRequest`. The supported keys stay empty until M5.

**D9. `import.meta`.** `getActiveImportMeta(realm)` is
`viewModuleRecord(active.scriptOrModule)`, then `getImportMeta`. Anything else
throws `IMPORT_META_REFERRER_INVARIANT`, because lowering emits it only in
modules.

**D10. Explicit failures in lowering.** `defer` reports
`import.defer requires P-DEFER` and `source` reports
`import.source requires P-SOURCE`. The runtime has no phase parameter.

**D11.** In M3a, `import()` in an `indirect-eval`, `direct-eval` or
`dynamic-function` entry fails with
`dynamic import in eval code requires the managed modules surface`. The `all`
surface is unchanged. Class 03 (2 variants) was already outside M3a.

## 4. Exact runtime API (`@tint/js-runtime/modules`)

| Export                                                                                   | File                | Notes            |
| ---------------------------------------------------------------------------------------- | ------------------- | ---------------- |
| `ModuleReferrer`, `RealmReferrer`, `LoadedModuleRequest` (types)                         | `referrer.ts`       | D2               |
| `viewModuleRecord`, `viewScriptRecord`                                                   | `referrer.ts`       | D1, record-bound |
| `realmReferrer(realm)`, `activeModuleReferrer(realm)`                                    | `referrer.ts`       | D3, D4           |
| `ModuleLoadPayload`, `DynamicImportState`, widened `ModuleLoader` (types)                | `loading.ts`        | D5               |
| `finishLoadingImportedModule(referrer: ModuleReferrer, request, payload, completion)`    | `loading.ts`        | D6               |
| `evaluateImportCall(specifier: unknown, options: unknown, hooks, realm): OrdinaryObject` | `dynamic-import.ts` | Below            |
| `getActiveImportMeta(realm): OrdinaryObject`                                             | `import-meta.ts`    | D9               |

**`evaluateImportCall`:**

1. `createModuleCapability(current, hooks)`.
2. `activeModuleReferrer(realm)`.
3. ToString through `stringValue`. A JS throw rejects with its value, `"type"`
   rejects with a TypeError, and `"unsupported"` stays unsupported.
4. The options, `with` and attributes (D8).
5. `canonicalModuleRequest`.
6. `referrer.realm.moduleLoader` with a new
   `{kind:"dynamic", capability, hooks, finished:false}`. An undefined loader is
   unsupported.
7. Return the promise.

Only host faults and the unsupported case escape synchronously. Reading the
referrer after the operands matches the spec, because operands cannot change the
active identity.

**`continueDynamicImport`** (internal) sets `finished` and rejects on failure.
Otherwise it runs `loadRequestedModules(module, hooks, undefined)`, then
`performPromiseThen` on the load promise's `internalPromiseData` with
`linkAndEvaluate` and `onRejected`. Missing data throws
`MODULE_PROMISE_INVARIANT`. `linkAndEvaluate` rejects on a `!ok` result from
`linkModule`. Otherwise it chains `evaluateModule` to `onFulfilled`, which
resolves with `getModuleNamespace(module)`.

## 5. Ordering and outcomes (spec-derived)

- **Self import while evaluating** (`eval-self-once-module`).
  `loadRequestedModules(self)` resolves, because the status is not `new`.
  `linkAndEvaluate` runs after the host's synchronous root evaluation, when the
  status is `evaluated`. `evaluateModule` returns the root's
  `topLevelCapability`, so the body runs once.
- **Jobs, synchronous host.** For an evaluated graph, the user's `then` runs in
  job 3: `linkAndEvaluate`, `onFulfilled`, then the reaction. A new graph's body
  runs in job 1, never inside `import()`.
- **Errors and namespaces.** Errored modules reject with the cached
  `evaluationError`. Resolve's Get "then" calls an exported function, and an
  uninitialized `then` rejects with its ReferenceError.
- **Overlapping imports of a new module.** The first of the two graph states
  commits `unlinked`. The second link is a no-op, evaluation reuses the
  capability, and there is one namespace.
- **Loader outcomes.** `{ok:true}` is recorded. `{ok:false}` rejects and is not
  recorded, so it can be retried. M2c verdict 40 rejects with a host-realm
  SyntaxError. `rejectUnsupportedExecution` is sticky and throws. Asynchronous
  finishes work. Undiscovered specifiers stay unsupported, because the
  missing-file policy belongs to M3b.

## 6. Red-first tests

**Setup.** Extend `ordinary-object-host-record-views.ts` for
`modules/referrer.(ts|js)`. `UNBOUND_MODULE_RECORD_VIEW` checks
`kind==="module" && "shape" in value`. `UNBOUND_SCRIPT_RECORD_VIEW` checks
`kind==="script" && "loadedRequests" in value`. Write each test first and watch
it fail.

**`js-runtime/test/modules-referrer.test.ts` (new):**

1. Module, Script, `undefined` and no-context identities each map to the right
   referrer, including a foreign `active.realm`.
2. Each realm has one RealmReferrer.
3. Opaque identities are sticky-unsupported.
4. `createScriptRecord` gives distinct empty `loadedRequests`.

**`modules-loading.test.ts` (extended):**

5. A graph payload with a non-static request, or a Script or realm referrer,
   throws `MODULE_REQUEST_INVARIANT`.
6. A dynamic payload records non-static requests. An equal request with the
   same module is accepted, and a different module is an identity fault.
7. A dynamic request equal to a static one reuses the static slot.
8. Failures record nothing.
9. A double finish throws `MODULE_DYNAMIC_PAYLOAD_INVARIANT`.
10. The existing overlap and retry tests are unchanged.

**`modules-dynamic-import.test.ts` (new),** with a fake loader and
`drainScriptJobs`:

11. Each call returns a fresh promise from the caller realm's `%Promise%`,
    across realms too.
12. The order is ToString, Get `with`, ownKeys, then
    `gopd:b, get:b, gopd:a, get:a, gopd:absent` on a runtime proxy. If ToString
    throws, `with` is unread and the promise rejects with that value.
13. Caller-realm TypeErrors for non-object options or `with`, non-String values,
    and any String key. `undefined` gives `attributes: []`. Symbol and
    non-enumerable keys are ignored.
14. The loader receives the exact ScriptRecord, ModuleRecord or RealmReferrer.
15. The body runs in job 1, not during `import()`, and the user's `then` in
    job 3. The namespace is `getModuleNamespace`. Two calls give two promises and
    one namespace.
16. The link SyntaxError comes from the job realm, the evaluation-error identity
    is stable, an `{ok:false}` value is passed through, and an undefined loader
    is unsupported.
17. Self import while `evaluating` runs the body once, and a deferred finish
    settles.
18. A `then` export is called, and an uninitialized `then` rejects with a
    ReferenceError.

**Other packages:**

19. `modules-import-meta.test.ts`: `getActiveImportMeta` equals
    `getImportMeta(module)` in a module context, and otherwise throws
    `IMPORT_META_REFERRER_INVARIANT`.
20. `js-engine/test`: `import-call` lowers in `script` and `module` entries.
21. `js-engine/test`: the D10 and D11 messages.
22. `js-engine/test`: `import.meta` lowers in modules.
23. `js-engine/test`: import-free programs keep the §2 counts.
24. `tools`: the widened loader appears only with a captured
    `evaluateImportCall`, and older captures stay byte-identical.
25. `tools`: both views are record-bound.
26. `tools`: the Script route gives the §9 reason.

## 7. File changes

- **`js-runtime/src/modules`.** New `referrer.ts` and `dynamic-import.ts`.
  `records.ts` gets `LoadedModuleRequest` and `loadedRequests`. `loading.ts` gets
  the widened types and the extracted `allImportAttributesSupported`, and its
  repeated active-realm expression is folded. `import-meta.ts` gets
  `getActiveImportMeta`, and `index.ts` the exports.
- **`js-runtime/src/objects`.** `jobs.ts` gets `ScriptRecord.loadedRequests`.
  `errors.ts` gets `realmReferrer`, initially `undefined`.
- **`js-engine/src/lowering`.** `index.ts` gets the two arms.
  `runtime-imports.ts` gets `usesImportCall` and `usesImportMeta`, which append to
  the module declaration or add one modules declaration for Scripts. The `all`
  list is unchanged.
- **`tools`.** `test262-native.ts` (§9) and `verify-hosted-module-evaluation.ts`
  (widened types).

There are no manifest or dependency changes. If `workspace-contracts.json` or the
compiler catalog list files, regenerate and format them as documented.

## 8. Minimal lowering handoff

Lowering never reads the referrer.

- **`import(s, o)`, evaluation phase, in `script` and `module` entries.**
  Evaluate `s` and then `o` through the existing `value`/`temporary` path, so
  operand throws stay synchronous. Then emit
  `evaluateImportCall(s, o ?? undefined, $global.hooks, $errors)`.
- **`import.meta` in modules.** Emit `getActiveImportMeta($errors)`.
- **Flags.** Each arm sets its usage flag.

The next task was the detailed M3a lowering plan, now the
[M3a lowering plan](host-esm-dynamic-import-lowering.md). It decides whether the call goes
through the completion `check` wrapper, and covers temporaries, optional-chain
and `new` positions, continuations around the call, and the exact
`scriptRuntimeImports` signature.

## 9. Minimal tools handoff (no routing change)

**Module host.** When the captured modules exports include `evaluateImportCall`,
emit the loader as
`(referrer:ModuleReferrer,request:ModuleRequest,hostDefined:unknown,payload:ModuleLoadPayload)`.
Retain both views and add two `operation:"view"` bindings, following
`directEvalSiteImageContract`. `nativeModuleCapability` is unchanged. A new
`nativeDynamicImportCapability` throws when only part of the contract is
captured.

**Script route.** A program that imports `evaluateImportCall`, in an image
without the modules runtime, is reported
`unsupported: Script dynamic import requires HOST-ESM M3b` **before** it is
compiled, so it never becomes a link failure. This replaces the 1,143
`Script expression lowering is not implemented: import-call` first blockers, and
M3b deletes it.

**Census Q2.** `settledModulePromise(evaluation)` stays the last synchronous
check. Dynamic imports settle during `runnerJobs`, and async tests use `$DONE`.

## 10. Measurements to take (in the implementation report)

1. **Snapshot identity and file count.** The expected count is 565. Measure it.
2. **Vocabulary.** Import-free programs keep the §2 counts. `import()` adds 1,
   plus a declaration for Scripts. `import.meta` adds 1. `all` stays at 128.
3. **Layouts and digests.** `ScriptRecord`, `ModuleRecord`, `ErrorRealm`, the
   `$argument1` frame, and their managed-surface directory entries
   (`tools/script-runtime-surface.test.ts`). Report every changed digest. Never
   silently re-pin one.
4. **Node-only re-census under the M3a toolchain.** All 24 module variants should
   prepare, and the 1,143 Script variants should move to the §9 reason. Proposal,
   M4, M5 and M7 rows stay unchanged. Any other movement blocks the native runs.
5. **Module-host image size and compile time.** Informational only.

## 11. Native fixture gates (hosted, `TINT_BUILD_ONLY=1`, LLDB)

Use the live build and record build manifests. Assert stop-at-entry and the
expected final exits. The gates go in a new
`tools/verify-hosted-dynamic-import.ts`, modelled on
`verify-hosted-module-evaluation.ts`.

- **G1. Views.** Each view accepts its own record and rejects the other kind, an
  ordinary object, `42` and `undefined`. Run it first, because it decides D1.
- **G2. Module referrer.** Load, link, evaluate and namespace, with job-3
  settlement, self import and namespace identity.
- **G3. Script and realm referrers through the runtime API.** Not lowered
  Scripts. This is the only native Script-referrer evidence before M3b.
- **G4. Options.** Every rejection kind and the getter order.
- **G5. Outcomes.** The link-error realm, the cached-error identity, retry after
  `{ok:false}`, and unsupported loaders.
- **G6. `import.meta`.** Identity, a null prototype, and
  `setPrototypeOf`/`preventExtensions`/`seal`/`freeze` (census Q3).
- **G7. Existing cases.** N1, N2 and the M2c bespoke cases, unchanged.

## 12. Combined frozen self-build handoff

There is one handoff for the prerequisite plus M3a. Do not freeze the
prerequisite alone. Start only after main has finished and recorded the M2c
fixture-syntax selections.

1. Get `pnpm check` and G1–G7 green on the live workspace. Fix failures at their
   source and rerun everything after them.
2. Capture one frozen snapshot (for example `node-toolchain-dynamic-import-v1`)
   with its manifest. Run the native self-build, the stage-image fixed-point
   comparison and the debug-information verification. Record the hash and file
   count.
3. Under that toolchain, run the 24 re-pinned variants as single-file runs. Then
   run the unchanged `namespace`, `ambiguous-export-bindings` and fixture-syntax
   regressions.
4. Write an immutable report and update the dashboard rows in place. M3b and the
   class-09 verdict extension stay separate.

## 13. Tested Node facts versus unknowns

**Tested (non-native Node v24.12.0).** The order is specifier expression, options
expression, ToString, then Get `with`, and throws from either expression are
synchronous. If ToString throws, the promise rejects and `with` is never read.
Non-object options, a non-object `with`, non-String values and an unsupported key
each reject with a TypeError, while `undefined` options or `with` fulfil. Symbol
and non-enumerable keys are never read. Each call gives a fresh promise, and the
namespace is shared. An errored module rejects with the same error object every
time. A namespace `then` export is invoked. `import.meta` has a null prototype,
is extensible and is stable.

**Node and the spec differ.** V8 runs every `getOwnPropertyDescriptor` before any
`get`. The spec interleaves them per key, so tint follows the spec (D8, test 12).

**Not comparable.** Node's tick count (8 for an evaluated module) reflects its
asynchronous loader. Its `import.meta` keys (`dirname`, `filename`, `main`,
`resolve`, `url`) are host properties.

**Unknown until the native gates run.** Whether both records bind as views (G1),
and whether the widened loader keeps the host callback class exact without
relaxing it. Also the layout and digest deltas (§10), native object integrity on
`import.meta` (G6), and cross-realm error realms beyond what the Node tests show.

## 14. Next runnable slice

1. Write test 1, add the D1 views and build G1 natively, because G1 decides D1.
2. Write tests 2–19 and make the §7 runtime changes.
3. Write the detailed lowering plan (§8), then tests 20–26.
4. Run `pnpm check`, G2–G7, then the §12 handoff.
