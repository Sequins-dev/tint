# HOST-ESM M1b: module loading and synchronous evaluation

Plan for slice M1b of the [HOST-ESM plan](host-esm.md), building on the M1a
records, resolution, linking and namespace APIs in
[host-esm-static-linking.md](host-esm-static-linking.md) §4–§6. Research only:
no source, test, manifest, catalog, report or native change was made.

**Every API named here that `src/modules/` does not export today is proposed
and does not yet exist.** When this was written, `modules/` held main's
in-progress M1a `records.ts`, `resolve.ts` and `index.ts`; linking,
namespaces, loading and evaluation were absent. Statements about those files
describe a mutable working tree, not a fingerprinted snapshot.

**Spec source.** Fetched 2026-11-05 from the ECMA-262 editor's draft
(`tc39.es/ecma262/multipage`, "ECMAScript® 2027", "Draft ECMA-262 / November
3, 2026"). Clause numbers refer to that draft. Unlike the parent document,
every algorithm cited here was checked against the fetched text. Read-only
probes ran in `/tmp/hostesm-load/` under Node v24.12.0.

**Implementation update:** loading and synchronous evaluation now pass the
[4,189-test workspace gate](../results/module-loading-evaluation-node-checkpoint-v1.json).
The [surface census](../results/module-loading-surface-census-v1.json) is measured.
The native fixture builds, but its launch failed before confirmed entry; the
[observation is retained](../results/module-loading-preentry-observations-v1.json).
Native behavior and the frozen compiler fixed point remain unverified. M2
lowering and Test262 module execution are not implemented.

## 1. Spec verification: corrections and settled questions

### 1.1 Re-exported namespace imports are indirect, so no shared cell is needed

ParseModule (16.2.1.7.1) step 10.a.ii rewrites every local export whose
`[[LocalName]]` is an imported bound name into an **indirect** entry
`{ModuleRequest: ie.[[ModuleRequest]], ImportName: ie.[[ImportName]],
LocalName: null}`. For `import * as ns from "x"; export {ns}` the import name
is `namespace`, so the entry equals that of `export * as ns from "x"`.
ResolveExport step 6.a.iii returns `{Module: x, BindingName: namespace}`, and
each importer creates **its own** immutable binding holding
`GetModuleNamespace(x)` (InitializeEnvironment step 7.c.iv).

- **The parent §4.2 rule is outdated and wrong.** It says "a re-exported
  namespace import stays local". Under it, the pinned tests
  `ambiguous-export-bindings/namespace-unambiguous-if-import-star-as-and-export.js`
  and `…-if-export-star-as-from-and-import-star-as-and-export.js` would report
  ambiguity; both expect `typeof foo === "object"`. `instn-star-equality.js`
  covers the same graph as a cycle.
- **The cycle hazard does not arise.** A resolved string `BindingName` always
  names a `[[LocalExportEntries]]` local, and step 10.a.i keeps only names that
  are not imports. Every target cell is therefore one that `declare` created.
  No peer ever needs another module's namespace-import cell.
- **Fix the in-progress predeclaration.** `createSourceTextModule`
  predeclares an immutable cell per namespace import, citing that hazard. The
  cell is harmless while module-local, but its rationale is false.
  **Recommendation:** remove the loop and create the cell at
  InitializeEnvironment commit, like a named import that resolves to a
  namespace. Add a shape invariant: a `localExports` entry whose `localName` is
  an import local throws `"MODULE_SHAPE_INVARIANT"`.
- **Node is not the reference here.** Node 24.12 rejects the two-fixture graph
  with `SyntaxError: … conflicting star exports for name 'foo'`
  (`probe/root.mjs`), which is the old semantics.

### 1.2 Link failure leaves partial state; retries must be idempotent

On abrupt completion, Link (16.2.1.6.1.2) step 4 resets only the modules still
on `stack` to `unlinked`. Two kinds of state survive:

1. **Child SCCs stay `linked`, with initialized environments.** They were
   already popped and set to `linked` (InnerModuleLinking step 13); the spec's
   example says "C's [[Status]] has become linked, though" (16.2.1.6.2). Tests
   must assert this, not "no partial state".
2. **Stack members may already have run InitializeEnvironment.** In `R ↔ B`,
   B initializes, then R fails, and both return to `unlinked`. The spec gives B
   a fresh environment on retry (InitializeEnvironment step 5); D1′ reuses B's.

Reuse is unobservable given four facts that M1a must preserve:

- **(a)** InnerModuleLoading only descends into `new` modules (step 2), so
  `[[LoadedModules]]` is fixed for the rest.
- **(b)** ResolveExport must return the same result for the same arguments
  (Table 40).
- **(c)** No code runs during Link, so nothing observes hoisted function
  objects or a half-built environment.
- **(d)** Namespace objects refer to the module, not to its environment.

**M1a contract:** InitializeEnvironment is per-module all-or-nothing: resolve
every entry, then commit. Once `environmentInitialized` is true, it returns
without re-resolving and without calling `instantiate` again. Each failed
attempt throws a **new** SyntaxError ("a newly created SyntaxError object").
Node returns the same object for both failed `import()` calls
(`probe/lentry.mjs`) because it caches per host module job. That is host
policy, not Link semantics.

### 1.3 Hoisted functions are created inside the module context

InitializeEnvironment step 17 pushes `moduleContext` (realm = module realm,
ScriptOrModule = module) **before** InstantiateFunctionObject (step 24.c), and
removes it at step 25. Tint's `createSourceExecutionContext`
(`objects/jobs.ts:129`) captures `agent.activeContext.scriptOrModule` when a
function is created.

**M1a contract:** `linking.ts` calls `instantiate()` inside
`runScriptContext(agent, {realm: module.realm, scriptOrModule: module}, …)`.
Otherwise hoisted functions take the linker caller's identity, which breaks
their later `import()` and job behaviour.

### 1.4 Error realms

The current realm is `agent.activeContext?.realm ?? module.realm`.

- **Link SyntaxErrors** (InitializeEnvironment steps 1.c and 7.c.iii) are
  thrown **before** step 17, so they use the current realm of Link's caller.
  Taking intrinsics from the current realm is the spec's convention for "a
  newly created X object"; no sentence states it explicitly. Test262 module
  tests are single-realm and cannot tell the difference.
- **The unsupported-attribute SyntaxError** (InnerModuleLoading step 2.d.i.1)
  uses the current realm at that moment. That may be the host's context, if it
  finishes loading asynchronously.
- **The Evaluate and LoadRequestedModules promises** use
  `NewPromiseCapability(%Promise%)` in the current realm.
- **Evaluation errors** are what module code throws. The cached completion is
  rethrown with the same identity, including non-objects.

### 1.5 Loading (verified)

- **Per request.** LoadRequestedModules (16.2.1.6.1.1) starts with
  `PendingModulesCount: 1` and returns a promise. For each request in source
  order, InnerModuleLoading step 2.d does one of three things:
  - unsupported attribute key → SyntaxError through ContinueModuleLoading;
  - an equal `[[LoadedModules]]` record → recurse without the host;
  - otherwise → HostLoadImportedModule.
- **First error stops the loop.** Step 2.d.iv returns once `IsLoading` is
  false.
- **Status change.** `new` → `unlinked` happens for all of `Visited` at once,
  only when the count reaches 0 (step 5).
- **Failed loads keep their slots.** FinishLoadingImportedModule (16.2.1.11)
  step 1 records a successful `LoadedModuleRequest` **before**
  ContinueModuleLoading ignores it after a failure. A failed load therefore
  leaves `new` modules with partly filled `loaded` slots. A retry recurses
  through those slots and asks the host only for missing ones.
- **Host duties (16.2.1.10).** Finish synchronously or asynchronously, return
  the same record for the same (referrer, equal request) on success, and treat
  the payload as opaque.
- **Ordering.** Loading is depth-first in source order only with a synchronous
  host; an asynchronous host may finish in any order, and the first throw
  completion wins. The M2 Test262 host finishes synchronously from M0's
  pre-discovered fixtures, so its order is deterministic.
- **Attributes.** The default HostGetSupportedImportAttributes is «». JSON
  modules are required only for a _supported_ `type: "json"`. Tint keeps «»
  until a JSON slice adds Synthetic Module Records (16.2.1.8). The runner
  routes the `import-attributes` and `json-modules` features to `unsupported`
  (M2).
- **Request equality.** ModuleRequestsEqual compares attributes as
  order-insensitive sets, and ModuleRequests deduplicates with it. Indexing by
  `loaded[i]` is valid only if M2's shape builder deduplicates the same way.

### 1.6 Evaluation (verified)

- **Evaluate (16.2.1.6.1.3):**
  - for an `evaluating-async`/`evaluated` module with `[[CycleRoot]]`, switch
    to the root;
  - return an existing `[[TopLevelCapability]]` promise;
  - otherwise run InnerModuleEvaluation. On abrupt completion, **every stack
    member** becomes `evaluated` with the **same** completion, then the
    promise is rejected.
- **Successful stack members inherit the failure.** In `R ↔ A`, A runs, R
  throws E, and both cache E.
- **Failed members have no `[[CycleRoot]]`.** It is set only when the root pops
  (InnerModuleEvaluation step 16.b.viii). So `Evaluate(A)` later creates a
  **new** promise rejected with the identical E (Evaluate step 3.b). "One
  promise" holds only per cycle root.
- **Unvisited siblings stay `linked`.** Step 11.b propagates the first failing
  dependency immediately (`eval-rqstd-abrupt.js`: the URIError fixture never
  runs).
- **Asynchronous modules are M4.** That covers step 12 (HasTLA or async
  dependencies), ExecuteAsyncModule, GatherAvailableAncestors and
  AsyncModuleExecutionFulfilled/Rejected.
- **Resource disposal (new).** ExecuteModule step 3.f runs
  `DisposeResources(env.[[DisposableResourceStack]], result)`. M2 lowering
  routes top-level `using` through `objects/lexical-disposal.ts`, or rejects it
  explicitly.
- **Non-cyclic records (new).** EvaluateModuleSync (16.2.1.5.1) and Synthetic
  records add branches at InnerModuleLinking step 1 and InnerModuleEvaluation
  step 1. M1b makes them invariant throws.
- **GetActiveScriptOrModule (9.4.1)** returns the topmost non-null
  ScriptOrModule, which Tint's nearest-active-identity model already matches.

## 2. Ownership and lifetime

- **Loader slot.** Proposed: `ErrorRealm.moduleLoader: ModuleLoader |
undefined` and `ErrorRealm.supportedImportAttributes: readonly string[]`
  (default `[]`), set in `createErrorRealm` beside `dynamicFunctionCompiler`
  and unreachable from JavaScript. The attribute list is fixed at realm
  creation because HostGetSupportedImportAttributes must be stable.
- **Module map.** The host owns it inside the loader closure: one map per
  realm, keyed by normalized specifier plus attributes. The host creates
  records in the referrer's realm, and the runtime enforces only the identity
  rule (§3.2).
- **Agent.** M1b adds no agent fields; the async evaluation counter is M4.
  Synchronous Evaluate cannot re-enter through `import()`, because the
  continuation is a job and `drainScriptJobs` refuses to run while
  `activeContext` is set.
- **No new scheduler.** Reuse `createPromiseObject`,
  `createScriptPromiseHooks`, `createResolvingFunctions`, `enqueueScriptJob`
  and `drainScriptJobs`. `disposalPromise` (`objects/disposal-resources.ts:40`)
  is the intrinsic-capability precedent. `ObjectHooks` are passed in, since
  `ErrorRealm` does not store them.

## 3. Proposed contracts (nonexistent)

### 3.1 Record fields added by M1b (`modules/records.ts`)

```ts
interface ModuleRecord {
  // M1a fields unchanged
  readonly execute: () => void; // body only; run under the module context
  evaluationError: { readonly error: unknown } | undefined; // boxed: `throw undefined` is an error
  cycleRoot: ModuleRecord | undefined;
  topLevelCapability: ModuleCapability | undefined;
}
interface ModuleCapability {
  readonly promise: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly functions: PromiseResolvingFunctions<unknown>;
}
```

`createSourceTextModule` gains a sixth parameter, `execute`. M4 adds
`asyncEvaluationOrder`, `asyncParentModules` and `pendingAsyncDependencies`.

### 3.2 `modules/loading.ts`

```ts
type ModuleReferrer = ModuleRecord; // M3 widens to ScriptRecord | ErrorRealm
type ModuleCompletion =
  | { readonly ok: true; readonly module: ModuleRecord }
  | { readonly ok: false; readonly error: unknown };
interface GraphLoadingState {
  // Table 43
  readonly kind: "graph"; // M3 adds a dynamic-import payload kind
  readonly capability: ModuleCapability;
  readonly hooks: PromiseHooks<unknown>;
  isLoading: boolean;
  pendingModulesCount: number;
  readonly visited: ModuleRecord[];
  readonly hostDefined: unknown;
}
type ModuleLoader = (
  referrer: ModuleReferrer,
  request: ModuleRequest,
  hostDefined: unknown,
  payload: GraphLoadingState,
) => void;
function loadRequestedModules(
  module: ModuleRecord,
  hooks: ObjectHooks<unknown>,
  hostDefined?: unknown,
): OrdinaryObject<ScriptPropertyKey, unknown>;
function finishLoadingImportedModule(
  referrer: ModuleReferrer,
  request: ModuleRequest,
  payload: GraphLoadingState,
  completion: ModuleCompletion,
): void;
function moduleRequestsEqual(x: ModuleRequest, y: ModuleRequest): boolean;
```

- **The host calls an exported function, not a callback.** Using
  `finishLoadingImportedModule` instead of a per-load `finish` closure keeps
  one loader callback type. The census's callback and record authorities then
  grow only by the measured hook and record classes, with no closure ABI per
  load.
- **Missing loader** → `rejectUnsupportedExecution(realm)`, never a
  JavaScript rejection.
- **Identity invariant.** If `loaded[i]` is already set and the host finishes
  with a different record, the call throws `"MODULE_LOAD_IDENTITY_INVARIANT"`
  as a host fault, outside ContinueModuleLoading.
- **Unknown request.** A request with no equal entry in `shape.requests`
  throws `"MODULE_REQUEST_INVARIANT"`. M3 adds storage for dynamic requests,
  including Script and Realm referrers.
- **The promise is real.** M3's ContinueDynamicImport observes it through
  `PerformPromiseThen`, so a callback-only design would have to be rewritten.

### 3.3 `modules/evaluation.ts`

```ts
function evaluateModule(
  module: ModuleRecord,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown>; // Evaluate()
type HostModuleOutcome =
  | { readonly kind: "fulfilled" }
  | { readonly kind: "rejected"; readonly error: unknown }
  | { readonly kind: "pending" }; // M4 only
function settledModulePromise(
  promise: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
): HostModuleOutcome;
```

- **Completions, not exceptions.** `innerModuleEvaluation` returns
  `number | { readonly error: unknown }`. Only `execute()` is wrapped in
  `try`/`catch`.
- **Host faults stay distinct.** Invariant strings and pre-execution
  unsupported signals propagate **out of** `evaluateModule` and are never
  cached. Separating them by position is sound; separating them by value is
  not, because module code can `throw "MODULE_LOADED_INVARIANT"`.
- **Execution context.** `execute` runs under `runScriptContext(agent, {realm:
module.realm, scriptOrModule: module}, …)`, and jobs enqueued there capture
  the module.
- **Top-level await.** After Evaluate steps 3–4 and **before** step 5, walk the
  not-yet-evaluated graph. If any module has `hasTopLevelAwait`, call
  `rejectUnsupportedExecution(currentRealm)`: no status change, no `execute`,
  no capability. Step 12 stays an invariant throw until M4.
- **Unsupported during execution.** It throws `undefined` and is cached like
  any error. The host checks `realm.unsupported` (`finishScriptExecution`)
  before interpreting a rejection, and then discards that realm's records.
- **Preconditions.** Status not `linked`, `evaluating-async` or `evaluated` →
  `"MODULE_EVALUATE_INVARIANT"`.
- **Host helper.** `settledModulePromise` mirrors EvaluateModuleSync steps
  3–5. It reads `internalPromiseData`; if the promise is rejected and
  unhandled, it calls `realm.promiseRejectionTracker(record, "handle")` and
  sets `handled`. The M2 host then drains jobs.

### 3.4 Clarified M1a contracts (no source edits made)

C-a namespace re-exports (§1.1); C-b idempotent InitializeEnvironment (§1.2);
C-c instantiation context (§1.3); C-e link error realm (§1.4). Also:

- **C-d, typed link result:** `{ok: true} | {ok: false, error}` for
  linker-created SyntaxErrors, while invariants throw. Either path resets only
  stack members.
- **C-f, non-cyclic branch:** InnerModuleLinking step 1 throws
  `"MODULE_KIND_INVARIANT"`.

## 4. Red-first Node tests (proposed, `packages/js-runtime/test/`)

**Shared fixture.** A `graph()` helper builds hand-made shapes and
`createSourceTextModule` records whose `declare`, `instantiate` and `execute`
closures append to `log`. Its test loader, over `Map<string, ModuleRecord>`,
either finishes synchronously or pushes `() => finishLoadingImportedModule(…)`
onto `deferred` for manual ordering. Realms are built as in
`ordinary-object-jobs.test.ts`.

**`modules-loading.test.ts`**

- **G1** "source-order DFS, synchronous host": R→[A,C], A→[B]. The host log is
  `["R→A","A→B","R→C"]`, the promise is fulfilled, and all are `unlinked`.
- **G2** "async completion keeps every module new until the last": complete C
  before A. Modules stay `new` and the promise `pending`; then all become
  `unlinked` together.
- **G3** "first failure wins": A fails with `e` synchronously. C is never
  requested, the promise rejects with `e` (same identity), and R stays `new`.
- **G4** "late success after failure is recorded, not followed": fail A, then
  succeed C. `R.loaded[1] === C`, but C's requests never reach the host.
- **G5** "retry reuses slots": after G4, the host is asked only for A and C's
  missing requests.
- **G6** "cycles visit once": R↔A makes exactly two host calls.
- **G7** "non-new modules are not descended."
- **G8** "unsupported attribute": `./a` loads, then `./b` with `{type:"json"}`
  under `[]`. The promise rejects with a current-realm SyntaxError, and the
  host log is `["R→a"]`.
- **G9** "attributes compare as sets": equal when only order differs; unequal
  when a value or the count differs.
- **G10** "identity invariant": a different record for the same request throws
  `"MODULE_LOAD_IDENTITY_INVARIANT"`, and the promise stays pending.
- **G11** "missing loader": `realm.unsupported` is set and no rejection is
  recorded.

**`modules-linking.test.ts` additions**

- **L3′** "child SCC stays linked after the parent fails": R→[C,B], where B
  imports a missing name from C. C is `linked` with one `instantiate`; R and B
  are `unlinked`. Relinking throws a SyntaxError `!==` the first, and C's
  count is still 1.
- **L9** "SCC member idempotent on retry": R↔B, where B's imports are valid
  and R's are not. B's `instantiate` ran once, and its `Binding` objects are
  identical across the retry.
- **L10** "instantiate runs in the module context", and the previous context
  is restored afterwards.
- **L11** "a re-exported namespace import is indirect": in a cycle with P
  initialized before R, `resolveExport(R,"ns")` is `{module: X, bindingName:
undefined}`, and P's local `ns` is `getModuleNamespace(X)`.
- **L12** "unambiguous star re-exports of one namespace": the shapes of the
  two pinned tests.
- **L13** "shape invariant": `"MODULE_SHAPE_INVARIANT"`.

**`modules-evaluation.test.ts`**

- **E1** "post-order, exactly once": R→[A,B], A→[C], B→[C]. The log is
  `C,A,B,R`, the promise is fulfilled synchronously, and a second call returns
  the same promise and logs nothing.
- **E2** "cycle": A runs first. Calling R's hoisted function works; reading
  R's `let` gives `"reference"`.
- **E3** "SCC error caching": R↔A, where A runs and R throws `e`. Both end
  `evaluated` with `e` and no `cycleRoot`. `evaluateModule(A)` returns a new
  promise rejected with `e` and re-runs nothing; R returns its original
  promise.
- **E4** "eval-rqstd-abrupt": R→[T,U], where T throws. U never runs and stays
  `linked`; a later `evaluateModule(U)` runs it.
- **E5** "completed child SCC keeps success": R→[C,F], where F throws. C is
  `evaluated` with no error and `cycleRoot === C`.
- **E6** "throw undefined is cached": the error is `{error: undefined}`, and an
  importer is rejected with `undefined`.
- **E7** "module identity": `execute`, a function created in `instantiate`, and
  a job enqueued in `execute` all observe the module after `drainScriptJobs`.
- **E8** "TLA graph is unsupported before any effect": `realm.unsupported` is
  set, `log` is empty, and statuses stay `linked`.
- **E9** "host fault versus thrown value": a corrupted `loaded` slot makes
  `evaluateModule` throw and caches nothing. A body throwing the same string is
  cached as a JS error.
- **E10** "precondition": an `unlinked` module throws
  `"MODULE_EVALUATE_INVARIANT"`.
- **E11** "host helper": the tracker sees `"reject"` then `"handle"`.

## 5. Native fixture gate

**Proposed fixture:** `tools/verify-hosted-module-evaluation.ts`, a
`verifyHostedFixture` like `verify-hosted-module-import-bindings.ts`.

- **Dependencies:** `modules` → `js-runtime/src/modules/index.ts`, `records` →
  `environments/records/index.ts`, `objects` → `objects/index.ts`.
- **Exit codes:** 70–83, one per check, and 42 on success.
- **Checks:** G1, G3, G4, G8, L3′, L9, L10, E1, E3, E4, E6 and E7, plus one
  GC-churn check between link and evaluate. Allocate as at
  `verify-hosted-jobs.ts:37`, then assert that the cached error identity, the
  capability promise and the shared binding survive.
- **Unverified:** if retained closures are reported missing, follow
  `verify-hosted-promise-objects.ts`.

**Prerequisites:**

1. The queued `module-import-bindings` fixture passes under LLDB.
2. The M1a `verify-hosted-module-records.ts` fixture passes.
3. The active AGF17 lane and the constructor groups after it are finished.
   Until then, do not rebuild `dist`, the catalog or images.

**Validation order:**

1. Node tests red, then green.
2. `pnpm build`, then `pnpm check`.
3. Regenerate and format the catalog.
4. Run a new immutable census report,
   `module-loading-surface-census-v1.json`. Record the exact record-class,
   callback-class, signature and ABI deltas, with no exemptions.
5. Build with `TINT_BUILD_ONLY=1` and run serially under LLDB. Assert
   stopped-at-entry and exit 42; keep pre-entry failures separate.
6. Rerun `verify-hosted-jobs.ts`, `verify-hosted-promise-capability.ts` and the
   M1a fixture.
7. Do a frozen self-build with stage-image comparison, recording image size.

No Test262 rerun is needed, because no adapter path changes.

## 6. Phase and outcome separation (input to M2)

| Event                                                                               | Outcome                                            |
| ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| Loader rejection (fixture not in siblings, other specifier)                         | JS TypeError, resolution phase                     |
| Unsupported attribute; link SyntaxError                                             | resolution phase, codes 60–68                      |
| Evaluate rejection                                                                  | runtime phase, codes 30–38                         |
| Missing loader, TLA, `<module source>`, sibling not in `nodes`, unsupported builtin | `unsupported` (exit 10)                            |
| Invariant string escaping `loadRequestedModules`, `link` or `evaluateModule`        | host fault; never a JS outcome, never retried away |

Journal identity and the `native-script-v10-modules` adapter stay as in parent
§5.

## 7. Next implementation slice

1. **Before M1a's linking lands:** fold C-a to C-f into M1a. C-a changes
   `createSourceTextModule` and the shape contract M2's builder relies on.
2. **M1b-1, loading only:** `loading.ts`, the two `ErrorRealm` fields and
   G1–G11. It needs only M1a's records and `loaded` slots.
3. **M1b-2:** the record fields, `evaluation.ts` and E1–E11, plus L3′–L13 if
   M1a has not absorbed them. Then the §5 native gate.

## 8. Evidence and unknowns

**Measured or read (this session):**

- Spec text: ECMA-262 draft of 2026-11-03, clauses 16.2.1.3–16.2.1.13 and
  9.4.1.
- Pinned Test262 at `91c7075…`: `instn-star-equality` and its fixture, both
  `namespace-unambiguous-*` tests and their fixtures, `instn-star-iee-cycle`,
  `eval-rqstd-abrupt`, `eval-self-abrupt`, `instn-once`, `eval-rqstd-once` and
  `eval-gtbndng-indirect-update`.
- Node 24.12 probes: star ambiguity for the namespace re-export graph
  (against the spec); one link-error object reused across `import()` calls
  (host caching); one cached evaluation error, failing dependency run once
  (as specified).
- Source read: `environments/records/index.ts`, the in-progress
  `modules/records.ts` and `resolve.ts`, `objects/jobs.ts`,
  `promise-capability.ts`, `promises.ts`, `promises/index.ts`,
  `disposal-resources.ts`, `errors.ts` and
  `tools/verify-hosted-module-import-bindings.ts`.
- Census baseline: `module-import-binding-surface-census-v1.json` (182
  records, 166 signatures, 43 ABIs).

**Unknowns:** M1b census deltas and image-size cost; retained-export needs
in hosted builds; native code-unit string ordering (open since M1a);
multi-realm error realms with asynchronous hosts; M2 handling of module-level
`using`; M3 storage of dynamic `[[LoadedModules]]`. No native execution was
run, and no pass rates are predicted.
