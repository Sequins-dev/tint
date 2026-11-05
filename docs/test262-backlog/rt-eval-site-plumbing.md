# RT-EVAL S5-de H5 + DE2: checked site view and behavior-neutral call-site plumbing

Implementation status: typed sites, checked views, seven-argument guard plumbing,
static capability flags, and capture-gated image retention are implemented. All
4,070 workspace tests pass. The [carrier fixture](../results/native-direct-eval-site-v2.json)
passes descriptor rejection and 32 MiB GC churn. The initial plumbing batch passed
cases 0–11; case 12 exposed an unreachable catch in the planned test, documented in
[the fixture analysis](../results/native-test262-eval-site-v1-expectation-analysis.json).
The [corrected frozen batch](../results/native-test262-eval-site-validation-v2.json)
passes 12 completed and two expected unsupported cases; see the
[checkpoint](../results/direct-eval-site-plumbing-checkpoint-v1.json).
Direct string eval remains unsupported.

Measured surface: 124 imports (39 instantiated), 102 helpers and 22 exported types;
182 record classes, 162 signature classes and 41 runtime providers. The eight
existing non-candidate corpus hashes remain unchanged. Generator and async Scripts
with or without candidates hit the same pre-existing managed callback-variance
profile rejection; [Node-only analysis](../results/direct-eval-site-managed-suspension-analysis-v1.json).
Their AOT paths remain in the native batch; the plan's managed-suspension success
expectation in §7.4 is deferred rather than bypassing the contract gate.

Research status: **plan with partial implementation.** Parents: [direct environments](rt-eval-direct-environments.md) §7 DE2
and [site carrier](rt-eval-direct-site-carrier.md) §6 (H5) and §10 (N1). This plan turns both into
one implementation-ready slice of two commits. It narrows the carrier plan where §3 below
says so. It does not enable direct string eval, add a realm compiler slot, or change
`ScriptRecord`, `ScriptEntryFrame` or the managed directory frame. DE3 (parser/binder context) and
DE4 (`lowerDirectEvalScript`, `createDirectEvaluator`, `ErrorRealm.directEvalCompiler`) follow.

**Capture.** 2026-11-05, live source. DE0 and DE1 are implemented: `isDirectEvalCandidate`,
`directEvalOwners`, `variableScope`/`catchRecords` lowering state, and
`DirectEvalCatch<Value> { record; outer }` with `instantiateDirectEvalDeclarations`. Direct string
eval remains sticky unsupported. R7 is resolved (definition-Script identity is captured by
`createSourceExecutionContext`).

**Evidence classes.** **[src]** live source. **[probe]** read-only Node probes over the built
`dist` (last rebuilt 03:38, after DE1), in `/tmp/tint-site-plumbing/{real.ts,shape.mjs,census.ts}`.
They link, bind, check and lower. They emit no machine code and write no file in the repository.
**[unknown]** has not been observed. I ran no native process and touched no queue, journal,
report, snapshot, marker or active process. The only repository edits are this file and one
cross-link.

## 1. Answer in brief

1. **The view is safe to add to the real image as a narrow retained runtime export.**
   `{ module: globalModule, namespace: "global-environment", retainedExports:
["viewDirectEvalSite"] }` duplicates nothing and retains only that one function (§4).
   `globalModule` is already linked into the image, but it is not a declared runtime, so there is
   no `duplicate runtime module` failure.
2. **Annotate every constructed site and catch link.** [probe] With annotations, the bound view
   tests the same record descriptor that the construction allocates. Without them, the literal
   gets its own record, and the view tests a record that is never allocated. That view always
   returns `undefined`: this is the F1 mismatch, and it is silent (§3).
3. **DE2 builds sites only where every field is a pure read.** Derived constructors, methods,
   field initializers, static blocks and private-name scopes pass `site = undefined` with the
   static `unsupportedCapability` bit. They never call `getDerivedThis`, so `eval(7)` before
   `super()` cannot throw (§6.4).
4. **Flags live in a pure js-engine module.** The producer is the lowering. The DE4 consumer is
   `createDirectEvaluator`, also in js-engine. The runtime guard forwards them opaquely, so
   js-runtime never needs the constants (§6.1).
5. **R6 closes in DE2.** Sloppy indirect-eval top-level sites pass `createGlobalScope($global)` as
   `variables`. `variableScope` has no reader before DE2, so no-candidate output stays
   byte-identical (§6.4).
6. **First runnable step:** commit A's red test,
   `js-runtime/test/global-environment-direct-eval-site.test.ts` (§7.1).

## 2. Source facts this plan depends on [src]

| Fact                                                                                                                                                                                   | Location                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `direct-eval.ts` exports only `DirectEvalCatch<Value>`; `index.ts` re-exports it as `export type`                                                                                      | `js-runtime/src/environments/global/{direct-eval,index}.ts`                      |
| Guard: `callEvalCandidate(callee, receiver, arguments_, witness, realm)`; the string branch is `rejectUnsupportedExecution(realm)`                                                     | `js-runtime/src/objects/global-properties.ts:63-76`                              |
| Two lowering call sites (plain call and chain step) share `invokeEvalCandidate`, which emits five arguments after `argumentList`                                                       | `js-engine/src/lowering/index.ts:646-665, 787, 2547`                             |
| `variableScope` starts as `$scope` for **every** entry kind, and is only ever assigned (never read)                                                                                    | `index.ts:153, 977, 1149, 1363, 1571`                                            |
| `catchRecords` resets to `[]` in `callable()`, and a catch pushes its record onto a copy                                                                                               | `index.ts:978-979, 4068-4101`                                                    |
| `thisValue(span)` emits `getDerivedThis` (abrupt before `super()`) whenever `derivedContext` is set; arrows inherit `derivedContext` and `home`                                        | `index.ts:439-445, 997-1000, 1095-1108`                                          |
| Static blocks, fields and methods pass `homeObject`, so `home !== undefined` inside them                                                                                               | `index.ts:1852-1858, 2025-2038, 2410-2420`                                       |
| The sloppy receiver is a prologue temporary (`checkedRuntimeValue`), so reading `receiver` is pure                                                                                     | `index.ts:1110-1121, 845-853`                                                    |
| Entry identity is `$script` for Script code and `$script.hostDefined` otherwise                                                                                                        | `index.ts:4570-4578`                                                             |
| Imports gate `callEvalCandidate` on `usesDirectEval`. The surface is built with every flag on                                                                                          | `runtime-imports.ts:43, 255-275`                                                 |
| Census pins: 122 entries, 38 typed, 27 instantiated in the corpus, 8 corpus hashes (no candidate)                                                                                      | `js-engine/test/runtime-surface.test.ts:53-127`                                  |
| `script-compile.test.ts` JIT-compiles lowered modules against a live-source surface fixture (no generated data)                                                                        | `tools/managed-script-fixture.ts`; `script-compile.test.ts:237-256`              |
| Runtimes with `retainedExports` skip the dependency retention queue and the surface collection providers. Record bindings require a declared runtime module and resolve by linked name | `compiler/src/native/index.ts:199-279, 533-572`; `managed-directory.ts:131-134`  |
| `projectBuildRequest().runtimes` (`runtimeSources()`) does not contain `globalModule`; the Test262 host imports it as `"global"`                                                       | `compiler/src/project.ts:4-51`; `tools/test262-native.ts:591, 1114`              |
| The `helpers` namespace map is consulted only for fixed namespaces (`primitive-value`, `number-text`, `text-encoding`, collections)                                                    | `ts-native/src/runtime/{index,context}.ts`; `compiler/src/native/index.ts:295`   |
| Capture gating precedent: `capturedModuleExports(...).has(...)`, with historical-snapshot tests                                                                                        | `tools/test262-native.ts:796-840`; `tools/captured-module-exports.test.ts:60-86` |

## 3. Probe results [probe]

**P1** (`real.ts`) links the real `environments/global`, `objects` and `records` sources with a
stand-in module. The stand-in declares the §6.2 `DirectEvalSite` (with the real
`EnvironmentScope<ScriptPropertyKey, unknown>` and `DirectEvalCatch<unknown>`) and the unbound view.
It then runs `bindModule` → `prepareNativeGlobals` → `specializeModule` → `checkClosureModule` →
`lowerModuleEntries`, with and without `recordBindings: [{ operation: "view" }]`, and `verify`.

| Variant                                                                                                        | Unbound                                | Bound                                                                               |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| Annotated `const c1: DirectEvalCatch<unknown>`, `c0`, `const site: DirectEvalSite`                             | verify ok, allocates records `{0,1}`   | verify ok, one `general-record-is`, testing record **1** (the allocated site)       |
| Unannotated literals (`const site = {…}`)                                                                      | verify ok, allocates records `{0,1,2}` | verify ok, but `general-record-is` tests record **3**, which is **never allocated** |
| Rejection entries: `OrdinaryObject`, `ScriptRecord`, a number, a string, `undefined`, and `script.hostDefined` | all lower and verify                   | all lower; same single bound view                                                   |

**Reading.** Only annotated construction reaches the view's layout. Unannotated catch links even
split into two records (the `outer: undefined` link differs from the `outer: c1` link). The
lowering must therefore pass `named("DirectEvalSite")` and a `DirectEvalCatch<unknown>` type node
to `temporary(…, false, false, type)`. This is the same mechanism `TemplateSite` and `ClassField`
use. One probe artifact: a non-exported local helper outside the lowered entry set failed with
`named function values require managed hoisted initialization`. It is unrelated, and I removed it.

**P2** (`shape.mjs`) shows today's guard arguments are `callee, receiver, list, $global.object,
$errors` in every context: function with catch and `with`, derived constructor, object method,
generator, and sloppy and strict indirect eval. Census today: **122** entries, **38** typed.

**P3** (`census.ts`) measures the Node surface fixture directory today: **180** records,
**162** signatures, **41** runtimes. This is the baseline for the measured DE2 deltas (§7.5).

## 4. Image binding and retention (answers R1's open question)

The configuration below is the minimum, and each part was reasoned from source:

```ts
// tools/test262-native.ts, only when the captured global module exports viewDirectEvalSite
runtimes:       { module: globalModule, namespace: "global-environment", retainedExports: ["viewDirectEvalSite"] }
recordBindings: { module: globalModule, name: "viewDirectEvalSite", operation: "view" }
```

- **No duplicate module.** `runtimeNamespacesByModule` rejects only a second _runtime declaration_.
  `roots.push(globalModule)` resolves to the module the host already links, so `linkModules`
  merges by id. The namespace `global-environment` is unused and passes `validRuntimeNamespace`.
- **No over-retention.** With `retainedExports` present the module is excluded from
  `runtimeQueue`, so none of its functions or dependencies join `retainedRuntimeModules`; only the
  linked `viewDirectEvalSite` joins `retainedRuntimeExports`. Type-only state (`EnvironmentScope`,
  `DeclarativeEnvironment`, `ScriptPropertyKey`) retains no functions.
- **No surface or JIT runtime change.** `deriveManagedSurfacePhysicalFacts` skips
  `retainedExports` entries. `materializeManagedRuntimeProviders` uses surface names, not
  `request.runtimes`. The new `helpers` keys (`global-environment:*`) are never looked up.
- **Without retention the binding fails at build time.** Nothing in the DE2 image calls the view:
  JIT entries consume it only in DE4. Dead-function elimination would therefore drop it, and the
  binding would report `record binding requires a module function`. This is the
  `viewWeakRegistryOwner` precedent.
- **Gate.** Add `directEvalSiteView: boolean` to `NativeRuntimeCapabilities`. Compute it as
  `capturedModuleExports(workspaceModules([globalModule], snapshot)).get(globalModule)?.has(
"viewDirectEvalSite") === true` and thread it into `createNativeImageBuilder` as a trailing
  parameter (default `false`). An older frozen snapshot yields `false`, so its request stays
  byte-identical.
- **Adapter label unchanged.** DE2 changes no Test262-observable behavior; the source-snapshot
  identity distinguishes the images. DE4 adds the next label (`native-script-v9-direct-eval`), and
  the N4 throw for "`createDirectEvaluator` without the view".
- **Hosted fixtures** pass the same pair through `verifyHostedFixture`'s `recordBindings` and
  `additionalRuntimes` (`tools/hosted-fixture.ts:31-32, 81-82`).

The whole-image build is **[unknown]** until the first native queue slot. Its failure modes are
build-time `link`, `runtime` or `record-binding` errors, never a silent pass.

## 5. Ownership and identity contracts

- **One producer, one native consumer.** Only lowered caller code (and the N1 fixture) constructs
  a `DirectEvalSite`. Only the image-bound `viewDirectEvalSite` narrows one; its DE4 consumer is
  the JIT entry, through the vocabulary. In DE2 js-runtime never reads site fields: the guard gets
  `site: unknown` and must not inspect, forward or retain it.
- **Immutability.** Every field is `readonly`. Sites and links are never mutated after
  construction, and a nested eval (DE4) builds a new chain head over `$site.catches`. It never
  appends.
- **Identity.** A view returns the **same reference** it was given, or `undefined`. It never
  copies. Natively, the descriptor check alone decides; Node uses a structural substitute **only**
  through the test hook.
- **Lifetime.** A site is reachable from the caller temporary and the guard argument. From DE4 on,
  it is also reachable from `carrier.hostDefined` and `$site`. There is no registry and no release.
  N1 proves the scopes and catch records it references survive a collection.
- **Order.** The site is built **after** `argumentList` and **before** the guard call, from pure
  reads only. Callee evaluation, argument evaluation (including spread and abrupt completion), the
  absence of string coercion, and the receiver identity stay exactly as G1–G3 pinned them.

## 6. Contracts and exact edits

### 6.1 `packages/js-engine/src/lowering/direct-eval-flags.ts` (new, no imports)

```ts
/** Static PerformEval caller facts, passed beside the site. The lowering produces
 * them; createDirectEvaluator (DE4) consumes them; callEvalCandidate forwards them
 * opaquely. Bits are fixed: frozen DE4+ images decode them. */
export const directEvalStrict = 1;
export const directEvalInFunction = 2; // a non-arrow function encloses the call
export const directEvalInMethod = 4; // the this-environment has a home object
export const directEvalInDerivedConstructor = 8;
export const directEvalUnsupportedCapability = 16; // DE5 capability; site is undefined
```

`lowering/index.ts` imports them relatively and re-exports them for DE4's `script-evaluation.ts`.
The native precedent for module-level numeric constants is `js-runtime/src/descriptors/index.ts`.
There is no field-initializer bit until DE5 adds `CallableOptions.fieldInitializer`; field
initializers are already caught by `home`.

### 6.2 `js-runtime/src/environments/global/direct-eval.ts` (commit A)

```ts
import type { DeclarativeEnvironment } from "../records/index.ts";
import type { ScriptPropertyKey } from "../../objects/index.ts";
import type { EnvironmentScope } from "./scope.ts";
// DirectEvalCatch<Value> unchanged.
/** Caller state for one direct eval, immutable and built at the candidate call.
 * flags travel beside it. Class capabilities are absent until DE5. */
export interface DirectEvalSite {
  readonly scriptOrModule: unknown;
  readonly lexical: EnvironmentScope<ScriptPropertyKey, unknown>;
  readonly variables: EnvironmentScope<ScriptPropertyKey, unknown>;
  readonly catches: DirectEvalCatch<unknown> | undefined;
  readonly thisValue: unknown;
  readonly newTarget: unknown;
}
/** Native-only checked view, explicitly bound by the embedding build request.
 * Returns the same record or undefined; never a structural test natively. */
export function viewDirectEvalSite(value: unknown): DirectEvalSite | undefined {
  throw "UNBOUND_DIRECT_EVAL_SITE_VIEW";
}
```

`index.ts`: replace the type-only line with `export { viewDirectEvalSite, type DirectEvalCatch,
type DirectEvalSite } from "./direct-eval.ts";`.

**Node hook** (`js-runtime/test/ordinary-object-host-record-views.ts`):

- widen the URL test to
  `/\/js-runtime\/(src|dist)\/(objects\/(values|symbols|bigints)|environments\/global\/direct-eval)\.(ts|js)$/`;
- replace the stub with `return typeof value === "object" && value !== null && "scriptOrModule"
in value && "lexical" in value && "variables" in value && "catches" in value ? value :
undefined;`.

The hook is test-only; the native image always uses the descriptor check.

### 6.3 `objects/global-properties.ts`: guard ABI (commit B)

```ts
export function callEvalCandidate(
  callee: unknown,
  receiver: unknown,
  arguments_: readonly unknown[],
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  flags: number,
  site: unknown,
): { readonly error: "none" | "type"; readonly value: unknown };
```

The body is unchanged; `flags` and `site` are unread in DE2 (doc comment: "opaque until DE4;
never reach `callObjectValue`"). `DynamicFunctionCompiler` is the precedent for an `unknown`
surface parameter. **No** `ErrorRealm` field and **no** `installDirectEvalCompiler` in DE2.

### 6.4 Lowering (commit B)

New state: `let inFunction = false;`. In `callable()`, save it and set it `if (!arrow)`; restore it
beside `outerHome`.

**R6, initial `variableScope`:**

```ts
let variableScope: Expression =
  entryKind === "indirect-eval" && !scriptStrict
    ? call("createGlobalScope", [id("$global")], generated) // fresh global node per site
    : id("$scope");
```

The expression is emitted only inside sites. DE1 compares records, not nodes, so a fresh global
node is exact. No prologue temporary is added, so eval entries without candidates keep their
normalized corpus.

**`invokeEvalCandidate`:** after `const list = argumentList(args, span)`, set `unsupported =
home !== undefined || derivedContext !== undefined || privateScopes.length !== 0`, and OR into
`flags`: `directEvalStrict` if `strict`, `directEvalInFunction` if `inFunction`,
`directEvalInMethod` if `home !== undefined`, `directEvalInDerivedConstructor` if
`derivedContext !== undefined`, and `directEvalUnsupportedCapability` if `unsupported`.

Then build the site expression:

- **When `unsupported`:** pass `id("undefined")`. **Never call `thisValue()`.**
- **Otherwise,** start with `chain = id("undefined")`. When `!strict`, for each record in
  `catchRecords`, outermost first, set `chain = temporary(object(["record", "outer"], [record,
chain], span), false, false, T)`, where `T` is the named type `DirectEvalCatch` with
  `arguments: instantiation("DirectEvalCatch")`. Then build `site = temporary(object([...],
[...], span), false, false, named("DirectEvalSite"))` with fields, in order:
  `scriptOrModule` (`$script` for Script entries, else `$script.hostDefined`), `lexical` (`scope`),
  `variables` (`variableScope`), `catches` (`chain`), `thisValue` (`receiver`) and `newTarget`.

Append `{ kind: "number", value: flags, raw: String(flags) }` and the site to the five existing
arguments.

- **Strict sites pass `catches: undefined`.** The strict EDI path never walks, and this saves the
  allocations.
- **Why `site = undefined` and not lazy construction.** Passing `undefined` needs no thunk, no ABI
  growth and no cache. Laziness would buy nothing until DE5 defines the class fields. The pure
  reads (`scope`, `variableScope`, catch temporaries, prologue `receiver`, `newTarget`
  identifiers or members, `$script`) cannot complete abruptly or call user code. Eager
  construction is therefore unobservable. **Its cost is unmeasured:** one or more allocations per
  candidate call, including `eval(7)` and shadowed `eval`.
- **Function-local identity.** Nested callables capture `$script`, matching R7: the lexical
  definition Script is the function's `[[ScriptOrModule]]`.

**`runtime-imports.ts`:** add `...(usesDirectEval ? ["DirectEvalCatch", "DirectEvalSite"] : [])`
to the `environments/global` list, both type-only; `scriptRuntimeTypeArguments("DirectEvalCatch")`
is `["unknown"]` and `DirectEvalSite` falls to `[]`. `viewDirectEvalSite` and
`instantiateDirectEvalDeclarations` join the vocabulary only when DE4 imports them.

### 6.5 Harness (commit A)

In `tools/test262-native.ts`: the §4 capability; the conditional runtime and record binding,
spread like the `finalizationRegistry` pair; and an exported pure helper
`directEvalSiteImageContract(view: boolean): { runtimes; recordBindings }`, so the request shape
is testable in Node without a build.

## 7. Red-first tests

### 7.1 Commit A: `js-runtime/test/global-environment-direct-eval-site.test.ts` (new, no hook)

1. A `DirectEvalSite` built over `createGlobalScope` and `createDeclarativeScope` with a two-link
   chain **type-checks** under `tsc -p tsconfig.tests.json`. This is red until the export exists.
2. `viewDirectEvalSite(site)` and `viewDirectEvalSite(7)` both throw exactly
   `"UNBOUND_DIRECT_EVAL_SITE_VIEW"`. The unbound view is never silent in Node.

**`…-direct-eval-view-hook.test.ts`** (new; calls `bindHostRecordViews()` before a dynamic import):

1. The view returns the identical site, and `viewDirectEvalSite(createScriptRecord(realm,
site).hostDefined) === site`.
2. It returns `undefined` for `createObject(undefined)`, the carrier `createScriptRecord(realm,
site)` itself, `{ error: "none", value: 1 }`, a catch link, an `EnvironmentScope`, `7`, `"s"`,
   `true`, `null` and `undefined`.

**`tools/captured-module-exports.test.ts`:**

1. A historical snapshot without the `viewDirectEvalSite` export gives `directEvalSiteView ===
false`; the live snapshot gives `true`.
2. `directEvalSiteImageContract(false)` is empty; `(true)` deep-equals the §4 pair; and
   `runtimeSources()` contains no `globalModule` (the duplicate guard).

### 7.2 Commit B: runtime guard (`js-runtime/test/ordinary-object-global-properties.test.ts`)

- Update every existing call with `, 0, undefined`. **The red signal is the type check**: Node
  strips types, so extra arguments alone are not red.
- **New: "the guard never touches flags or site outside PerformEval".** The site is a `Proxy`
  whose every trap throws `"SITE_TOUCHED"`; `flags = 31`. Paths: shadowed callee (same `receiver`
  and `args` identity reach it); throwing shadowed callee (same thrown identity); foreign-realm
  intrinsic with `7`, then `"1"` (only the foreign realm becomes unsupported); no arguments; an
  uncoerced `{toString(){throw}}`; and the intrinsic with `"1"` (throws `undefined`,
  `realm.unsupported === true`). No path touches the proxy.
- **New: "a string is rejected without the unsupported bit".** Use `flags = 0` and a real site
  object. This keeps DE2 neutral.

### 7.3 Commit B: lowering structure (`js-engine/test/eval-site.test.ts`, new)

Helpers: find the `callEvalCandidate` call, resolve `args[6]` to its temporary declaration, and
read the object properties.

1. **Arity and order.** `args.length === 7`; `args[5]` is a numeric literal; the site's declaration
   type is `named DirectEvalSite`, its properties are exactly `scriptOrModule, lexical, variables,
catches, thisValue, newTarget`, and it is emitted after the last argument-list statement.
2. **Script top level, `eval(x)`.** Fields are `$script`, `$scope`, `$scope`, `undefined`,
   `$global.thisValue`, `undefined`; flags `0`. With `"use strict"`, flags `1`.
3. **Indirect entry** (`lowerEvalScript`). Sloppy: `scriptOrModule` is `$script.hostDefined` and
   `variables` is a `createGlobalScope($global)` call (R6). Strict: `variables` is `$scope`.
4. **Catch chain.** `try{}catch(a){try{}catch({b}){eval(x)}}` gives two `DirectEvalCatch<unknown>`
   temporaries. `catches` names the link whose `record` is the inner catch record and whose
   `outer` is the other link; that link's `outer` is `undefined`.
5. **Resets.** `try{}catch(a){function f(){eval(x)}}` gives `catches: undefined` (`callable()`
   resets the list); strict code inside a catch also gives `undefined`.
6. **Function flags.** Sloppy function `2`; top-level arrow `0`; arrow in a function `2`;
   generator `2`, built inside its step. In `function f(a=eval(x)){}`, `variables` is the DE0
   `parameterParent` temporary, not `scope`.
7. **Unsupported contexts.** The site argument is `undefined`, the flags include `16`, and no
   `DirectEvalSite` object exists:
   `var o={m(){eval(x)}}` (`2|4|16`); a class method (`1|2|4|16`); field `x=eval(y)`;
   `static{eval(y)}`; a `#p` scope; and `class D extends B{constructor(){eval(7);super()}}` and an
   arrow inside it (`31`: constructors also carry `homeObject: prototype`, `index.ts:1815`).

   **For the derived cases, the `getDerivedThis` count equals the same source with `void 7`.**
   The candidate adds none.

8. **Non-candidates.** `eval?.(x)`, `(0,eval)(x)`, `o.eval(x)` and `` eval`x` `` produce no site
   and no `DirectEvalSite` import, and the existing indirect-only hash is unchanged.

**Update existing tests:**

- `eval-guard.test.ts:84` expects `args.length` 5 → 7.
- `eval-lowering.test.ts` `normalize`: add one rule mapping a site object's `variables:
createGlobalScope($global)` to `$scope`, documented as the R6 declaration-scope difference.
  `eval(x)?.y;` stays in the corpus.

### 7.4 Commit B: managed compilation (`js-engine/test/script-compile.test.ts`)

Extend "links direct-eval guards through the image surface" so that each source below compiles
`ok`, with `maps === 1` and `writes === 1`:

- `function f(a=eval(7)){try{throw 1}catch(e){with({}){return eval(e)}}}`
- `function*g(){yield eval(yield 1)}`
- `async function h(){return eval(await 7)}`
- `"use strict";function s(){try{}catch(e){return eval(e)}}`
- `class D extends Object{constructor(){(()=>eval(7))();super()}}`
- `var o={m(){return eval(7)}}`

Also compile `lowerEvalScript("eval(7)")` and `lowerEvalScript("'use strict';eval(7)")`. This
proves the JIT surface accepts the annotated site and chain records. It is red until §6.4 adds
the vocabulary types.

### 7.5 Commit B: census (`runtime-surface.test.ts`), measured and never predicted

1. After the change, run `node -e` on `scriptRuntimeSurface()` and pin the observed entry, typed
   and `seen` counts.
   - The arithmetic expectation is 124 entries and 39 typed, with `seen` unchanged at 27, because
     no corpus source has a candidate.
   - **Pin what is measured.** If it differs, find out why before pinning.
2. Add one corpus source,
   `function f(a){try{throw 1}catch(e){with({}){eval(a)}}}class D extends Object{constructor(){eval(7);super()}}`.
   Pin its **measured** hash, and require all eight existing hashes unchanged.
3. Record the P3 fixture deltas (records 180 and signatures 162 today) in the slice log, not in a
   test.

## 8. Native gates

Both gates run in main's serial queue only **after** the active frozen self-builds and
conformance controllers. Each uses `TINT_BUILD_ONLY=1`, a build manifest, LLDB stop-at-entry,
and asserted per-check exit codes.

**N1: `tools/verify-hosted-direct-eval-site.ts`** (commit A), modeled on
`verify-hosted-eval-declarations.ts`: dependencies `objects`, `records`, `global`; the §4 runtime
and view binding (module `global`); `managedBytes` 64 MiB. It builds a real `ErrorRealm`
(`createErrorRealm(createObject(undefined), hooks)`) and a `<ScriptPropertyKey, unknown>` global.
**Phase A** builds annotated `inner`/`outer` links and a site, `const boxed: unknown = site` and
`createScriptRecord(realm, site)`. **Phase B** calls `make(realm, global): ScriptRecord`, whose
scopes, records and links survive only through `carrier.hostDefined`, with bindings `v=17`
(variables), `e=11` (inner catch), `f=13` (outer catch); then 1,024 `Uint32Array(8192)`
allocations (32 MiB churn) and a second view.

| Exit | Failed check                                                                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 80   | `viewDirectEvalSite(boxed)` is `undefined`                                                                                                                                              |
| 81   | the viewed reference `!== site`                                                                                                                                                         |
| 82   | field identities: `lexical`, `variables`, `catches.record === inner`, `catches.outer.record === outer`, `catches.outer.outer === undefined`, `thisValue`, `newTarget`, `scriptOrModule` |
| 83   | an `OrdinaryObject` is accepted                                                                                                                                                         |
| 84   | `createScriptRecord(realm, undefined)` is accepted                                                                                                                                      |
| 85   | a `ScriptCompletionRecord` is accepted                                                                                                                                                  |
| 86   | `7`, `"s"`, `true`, `null` or `undefined` is accepted                                                                                                                                   |
| 87   | a `DirectEvalCatch` link or an `EnvironmentScope` is accepted                                                                                                                           |
| 88   | phase B: the view of `carrier.hostDefined` is `undefined` after churn                                                                                                                   |
| 89   | phase B: the binding values (17/11/13), or the chain length (2), read wrong after churn                                                                                                 |
| 42   | success                                                                                                                                                                                 |

**N-DE2: `tools/verify-test262-native-eval-site.ts`** (commit B). Copy the
`verify-test262-native-eval-environments.ts` structure, and reference-check the completed cases
in a Node `vm` realm. Cases 0–11 are expected **completed**:

0. `class D extends Object{constructor(){eval(7);super()}}new D();` (no ReferenceError)
1. `class D extends Object{constructor(){(()=>eval(7))();super()}}new D();`
2. `var o={m(){return eval(7)}};if(o.m()!==7)throw 1;`
3. `class C{#p=1;x=eval(7);static y=eval(8);static{if(eval(9)!==9)throw 1}m(){return eval(this.#p)}}const c=new C();if(c.x!==7||C.y!==8||c.m()!==1)throw 1;`
4. `function*g(){return eval(yield 1)}const i=g();i.next();if(i.next(5).value!==5)throw 1;`
5. `function f(eval){return eval(1,2)}if(f((a,b)=>a+b)!==3)throw 1;var o={eval(){return this}};with(o){if(eval(1)!==o)throw 2}`
6. `function f(){var eval=$262.createRealm().global.eval;return [eval(7),eval("var z=1;z")]}const r=f();if(r[0]!==7||r[1]!==1)throw 1;`
7. `var o;o?.f(eval(7));var t={toString(){throw 1}};if(eval(t)!==t||eval()!==undefined)throw 2;`
8. `function f(a=eval(7)){try{throw 1}catch(e){try{throw{}}catch({x}){with({}){return eval(a)}}}}if(f()!==7)throw 1;`
9. `if((0,eval)("eval(7)")!==7||(0,eval)("'use strict';eval(8)")!==8)throw 1;`
10. `if($262.evalScript("function h(){return eval(7)}h()")!==7)throw 1;`
11. `function f(){let s=0;for(let i=0;i<20000;i++){try{throw i}catch(e){s+=eval(1)}}return s}if(f()!==20000)throw 1;`

Cases 12–13 are expected **unsupported** (sticky):

12. `function f(){try{}catch(e){eval("1")}}f();`
13. `class D extends Object{constructor(){eval("1");super()}}new D();` (unsupported, never a
    ReferenceError)

## 9. Commit plan and gates

**Commit A, H5 view (no lowering or ABI change):** §6.2, the hook, §6.5, the §7.1 tests and N1.
Gate: `pnpm build`, the focused `node --test` files, then `pnpm check`. The Test262 image gains one
retained, uncalled, bound function; the Script surface, lowered output and census are unchanged
(the view is not in the vocabulary).

**Commit B, DE2 plumbing:** §6.1, §6.3, §6.4, the §7.2–7.5 tests and N-DE2. Same gate. Then re-run,
each into a **new** report, the DE0 `verify-test262-native-eval-environments` (8 completed,
1 unsupported) and the G1–G3 `verify-test262-native-eval-guard`. Overwrite no earlier report.

**Not in this slice:** the frozen self-build. DE2 changes no Test262 outcome, so the self-build
joins the DE4 batch, as DE0 did.

**Dashboard and report rules:** DE2 changes no conformance number. Store N1 and N-DE2 as new
immutable bespoke reports, and do not touch `docs/test262.md`.

## 10. Unverified, and what would change the plan

| Id  | Unknown                                                                                                                                      | Resolved by                    | If it fails                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| U1  | Whole Test262 image accepts the `global-environment` runtime and view binding                                                                | first DE2 image build          | build-time error naming the stage; fix the request, not the view |
| U2  | AOT-allocated site descriptor survives `unknown` boxing and GC natively                                                                      | N1                             | H2′ fallback (carrier doc §4)                                    |
| U3  | Site and chain allocation inside generator and async continuations, and in JIT-compiled indirect-eval code                                   | N-DE2 cases 4, 9, 10           | inspect the continuation temporary capture; no ABI change        |
| U4  | JIT-built site descriptor equals the AOT view's descriptor (structural alias)                                                                | DE4's N2, plus N5 alias census | H2′                                                              |
| U5  | Exact census and surface record or signature deltas                                                                                          | §7.5 measurement               | investigate before pinning                                       |
| U6  | Per-candidate allocation cost (case 11 is a smoke test, not a benchmark)                                                                     | DE6 profiling                  | consider a per-site immutable cache only with measured evidence  |
| U7  | Async `eval(await 7)` execution natively. §7.4 covers compilation only; the async-flag harness form was not checked                          | DE4 acceptance                 | add an async case with the harness's async include               |
| U8  | Fixture details: `createErrorRealm`'s default parameters in hosted code, and `createGlobalEnvironment<ScriptPropertyKey, unknown>` arguments | writing N1                     | pass explicit `createSymbolRegistry()` and `createScriptAgent()` |

**Settled here:** no duplicate runtime and no type-only over-retention (§4); readonly annotation is
mandatory (§3); and `site = undefined` for class capabilities, never lazy `getDerivedThis` (§6.4).
The flags module placement and the R6 expression also hold.

## 11. Next focused planning task (not started)

**DE3 test-text plan.** Specify `parseEvalScript(source, flags)` and `bindEvalScript` seeding,
using exactly the §6.1 bits:

- `new.target`, `super.x` and `super()` per flag;
- strict-caller strictness, including octal escapes and `with`;
- `arguments` in field initializers, which needs the DE5 field bit, so decide whether DE3 adds it.

Give the exact red tests in the parser and binder suites and the public-API census delta. Name
the Test262 files each early error maps to. Research only; no implementation.
