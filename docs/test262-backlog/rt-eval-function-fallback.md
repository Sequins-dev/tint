# RT-EVAL S4-fn1: general ordinary `Function` fallback through the managed Script service

Current implementation: FN0 lowering, FN1 service/routing and FN2 capture-gated
host wiring are implemented. The workspace gate passes 4,039 tests.
The [corrected native carrier fixture](../results/native-dynamic-function-carrier-v6.json)
passes; [the retained diagnostic](../results/native-dynamic-function-carrier-context-fix-v1.json)
explains why the earlier fixture lost its execution context. The [16-case native host verifier](../results/native-test262-function-fallback-validation-v1.json)
passes: 14 completed and two expected unsupported cases (tagged templates and
direct string eval). Full Function conformance and the frozen self-build remain
pending; no full-family gain is claimed. The original research plan follows.

Research status: **plan only.** Parent: [rt-eval.md](rt-eval.md) §7 S4. Builds on the indirect-eval
service in [rt-eval-indirect-host-integration.md](rt-eval-indirect-host-integration.md) (IE6a/IE7)
and [rt-eval-lexical-entry.md](rt-eval-lexical-entry.md). This plan replaces the S4 bullet's
"`execute(frame): SourceFunctionCall`" result shape. That shape cannot cross back into AOT code
(§4.1). The plan covers `kind === "normal"` only. Generator, async and async-generator bodies stay
on their profiles and are handed to S6 (§10).

**Capture.** 2026-11-05, live source of 550 portable files, identity
`aeca89d84f78cbb6ee8a5e42b2c6d5dc6f87a77eb71027d3751fb30e3cb0d4aa`. `dist` matches source. IE6a
(`installEvalCompiler`) and IE7 (captured host wiring) are in the live tree, and the workspace
`pnpm check` passes with 4,019 tests (`.tint-bootstrap/indirect-eval-host-workspace-check-v1.log`).

**Not established. Do not cite any of these as passing.**

- The native managed-Script case 5 (`tools/verify-hosted-managed-script.ts`, run by
  `.tint-bootstrap/run-indirect-evaluator-validation-v1.mjs`) is still running.
  `native-indirect-evaluator-v1.json` is being written by that run. I did not read it as evidence.
- The IE7 20-case verifier (`tools/verify-test262-native-indirect-eval.ts`) and the frozen pre-host
  indirect baseline (118 variants) are gated behind case 5.
- The Annex 153 and global 75 reruns are paused during native fixtures.
- Two frozen self-builds are pending:
  - eval-entry-contracts: stage1 is built (71.5 MB); native waits for the full reruns.
  - indirect-eval-host: stage1 is building; native waits for the first self-build and the 20-case
    acceptance.
- The last complete `built-ins/Function` report
  ([v1](../results/test262-function-managed-access-native-v1.json): 703/893, 147 unsupported, 16
  semantic failures, 27 pre-entry failures) is a **stale baseline**. The IE7 Function regression has
  not run. This design does not depend on either.

**Method.** I read the live source only. My Node probes used Node's own `Function` and `vm` as a
reference and executed nothing from Tint. Spec text was read from tc39.es on 2026-11-05 (ES2027
draft). I ran no build, emission, native process or queue action, and I edited nothing except this
file and one cross-link.

## 1. Answer in brief

1. **Where the fallback slots in.** `createDynamicFunctionCompiler` keeps eager parse and binding
   validation, eager object creation and lazy compilation. When none of the three profiles applies,
   the call goes to a new **optional** `general` compiler built from the realm's existing
   `ScriptEvaluationHost` (same `compile`, `invoke`, `completion`, `table` and arena).
2. **New lowering entry.** `lowerDynamicFunctionImplementation(syntax)` lowers the parsed
   function's own parameters and body with `callable()`. It uses a new `packed` invocation variant
   inside an ordinary `execute($global, $script)` entry. The entry returns a hidden,
   non-constructible **carrier** function object made by the existing `createSourceFunction`.
3. **No new imports, frame ABI or record layout.** The carrier's callback receives
   `[callee, newTarget, ...args]` as its argument list. That one choice keeps the vocabulary at 122
   entries and leaves the `ScriptEntryFrame` and the `OrdinaryObject` and `ScriptRecord` layouts
   alone. The census must still be **measured** (§5.4).
4. **Identity.** The `scriptOrModule` is captured **at construction**, as the spec's
   OrdinaryFunctionCreate does, and passed through the existing private carrier record (the
   indirect-eval pattern). No fresh identity is created. Realm, global environment and `this` come
   from the constructor's realm.
5. **Profiles keep priority.** The closed, global-access and receiver-write profiles still run
   first and unchanged. Lazy, per-function-object compilation is kept. No other cache is added.
6. **Errors by phase.** Creation-time errors stay SyntaxErrors. Every call-time lowering, compile
   or publication failure is `unsupported`, never a SyntaxError (§6).

## 2. Live state (read today)

| Piece                     | Location                                                            | State                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dynamic compiler          | `js-engine/src/dynamic-function.ts:91`                              | Parse → `validateJavaScriptBindings` → `constructorPrototype` → `createSourceFunction(execute,…,"anonymous",length)` → `setPrototype` → `retainFunctionSource`                                            |
| Lazy compile              | `:227` `ensureCompiled`                                             | closed → global-access → receiver-write; otherwise `rejectUnsupportedExecution`. Result cached in the closure-local `code`                                                                                |
| Non-simple formals        | `:362`, `:383`, `:407`                                              | `if (!simple) reject` on call, before compiling                                                                                                                                                           |
| Receiver                  | `:329` `bindReceiver`                                               | Sloppy `sloppyCallReceiver(receiver, object, …)`, applied before profile invocation                                                                                                                       |
| Closed-profile arity      | `compiler/src/native/closed-functions.ts:344,493`                   | `minimumArguments`. Calls with fewer arguments reject (`dynamic-function.ts` `executeBody`)                                                                                                               |
| Function intrinsic        | `js-runtime/src/objects/function-intrinsics.ts:57-80`               | ToString of every argument → `realm.dynamicFunctionCompiler(kind, params, body, target)`                                                                                                                  |
| Script service            | `js-engine/src/script-evaluation.ts:40-148`                         | `ScriptEvaluationHost`; `createEntryEvaluator` parse → lower → `host.compile` → carrier `createScriptRecord(realm, inherited)` (`:129`) → `host.invoke` → context-leak check → `host.completion`          |
| Entry compiler            | `js-engine/src/native/script-compile.ts`                            | `prepareManagedSurfaceEntry` → budget (`maxScriptCodeBytes`) → `linkManagedSurfaceModule` → `storage.publish`                                                                                             |
| Lowering entry            | `lowering/index.ts:116` `lowerScriptEntry`                          | `entryKind: "script" \| "indirect-eval"`. `$scope` at `:4150`. The entry wraps `runScriptContext({realm, scriptOrModule})` (`:4346-4400`); indirect eval reads `$script.hostDefined`                      |
| `callable()`              | `lowering/index.ts:936-1539`                                        | Arrow `(receiver, args, callee?, newTarget?)`. `raw` drops `callee` (and `newTarget` unless `baseConstructor`). Sloppy `this` uses `sloppyCallReceiver(r, $global.thisValue, $global.hooks, $errors)`     |
| Import vocabulary         | `lowering/runtime-imports.ts:18-198`                                | The `declarations` mode is `"script" \| "indirect-eval" \| "all"`. The surface is built from `"all"` (`:251-276`)                                                                                         |
| Dynamic syntax            | `typescript/src/syntax/dynamic-functions.ts:7-16,96-110`            | `{sourceText, parseText, module}`. Spans index **`parseText`** (leading `(`). `module.strict = false`; the expression is unnamed                                                                          |
| Source-function context   | `js-runtime/src/objects/jobs.ts:129-142`                            | `createSourceExecutionContext` captures `activeContext.scriptOrModule` **at creation**                                                                                                                    |
| Test262 realm host        | `tools/test262-native.ts:384-449`                                   | `realm.dynamicFunctionCompiler=…` at `:418`, **before** `const service:ScriptEvaluationHost` at `:447`. One `scriptState` (table, compiler, fault) per process; one 4 MiB arena (`executableMemoryBytes`) |
| Capture and adapter label | `capturedScriptEvaluation` `:898-923`; `nativeScriptAdapter` `:890` | Decided by export presence (`installEvalCompiler` + `createIndirectEvaluator` → `indirectEval: true` → `native-script-v7-indirect-eval`)                                                                  |
| Native boundary           | `native-runtime/src/intrinsics/memory.ts:142-149`                   | `nativeValueFunction{Descriptor,Signature}` are **inspection-only**. "No type assertion changes the value's callable signature"                                                                           |

`parseDynamicFunction`'s doc comment says "creation in the caller's global environment". The spec
says the **constructor realm's** global environment. Fix that comment in FN1 (continuous cleanup);
the code is already correct, because the compiler is realm-local.

## 3. Specification points (ES2027 draft, read 2026-11-05)

- **CreateDynamicFunction**:
  1. ToString of every parameter, then of the body.
  2. `HostEnsureCanCompileStrings(currentRealm, …)`. Tint has no embedding hook, so the step is
     vacuous for the Test262 host.
  3. Parse the parameters alone, then the body alone, then the whole expression. Any failure is a
     SyntaxError.
  4. `GetPrototypeFromConstructor(newTarget, fallbackProto)`.
  5. OrdinaryFunctionCreate with `env = currentRealm.[[GlobalEnv]]` and `privateEnv = null`.
  6. `SetFunctionName(F, "anonymous")`, then MakeConstructor.

  All of this already lives in `function-intrinsics.ts` and `dynamic-function.ts`. Keep the order.

- **OrdinaryFunctionCreate** sets `[[ScriptOrModule]]` to `GetActiveScriptOrModule()` and
  `[[Realm]]` to the current realm, both at **creation**. The Function builtin's own context has a
  null ScriptOrModule, so the active identity is the caller's. Tint's builtin-context push preserves
  that identity.
- **PrepareForOrdinaryCall** uses `F.[[ScriptOrModule]]` and `F.[[Realm]]` for the callee context.
  Nested functions created during the call therefore inherit the dynamic function's identity.
- **OrdinaryCallBindThis**: in sloppy mode, `undefined` or `null` → `calleeRealm.[[GlobalEnv]]
.[[GlobalThisValue]]`; otherwise `ToObject` "produces wrapper objects using calleeRealm". Strict
  mode passes the value through.
- `anonymous` is **not** a binding (an unnamed FunctionExpression with SetFunctionName). The
  template-object site is the Parse Node: each `Function(...)` parse is a new site, and repeated
  calls of one function share it.

## 4. Design

### 4.1 Why a carrier, and why the argument list is packed

The AOT `dynamic-function.ts` must call a JIT closure with the signature
`(receiver, args, callee, newTarget)`. The options:

| Option                                                           | Verdict                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Return the arrow as the completion `value: unknown`              | **Rejected.** No checked native view turns `unknown` into a typed callable (`memory.ts:142-144`). An assertion would be unsound across the ABI                                                                                                               |
| New surface helper or record slot (`implementation` field)       | Rejected for now. It changes the vocabulary or the `OrdinaryObject`/`ScriptRecord` layout, which affects every Script entry. Revisit only if packing is measured to be the problem                                                                           |
| New frame type (`$argument2`)                                    | Rejected. It changes the image-selected `ScriptEntryFrame` ABI (`script-compile.ts` requires `"ScriptEntryFrame"`)                                                                                                                                           |
| Eager compile at construction                                    | Rejected by the parent §9 decision. It would also fail creation for bodies that are never called                                                                                                                                                             |
| **Carrier made by `createSourceFunction`, packed argument list** | **Chosen.** The JIT arrow enters AOT through an **argument** of an imported helper. That is the same admission indirect-eval functions use. `viewObjectValue` (an existing checked view) recovers the object, and `internalCall` is typed `(receiver, args)` |

The carrier is `createSourceFunction(arrow, false, $errors, $global.hooks, "", 0, undefined)`. It
is not constructible, so no `prototype` is allocated. It is owned only by the per-function compile
slot and never reaches user code. The arrow ignores its third and fourth parameters (the carrier's
own identity and `undefined`). It reads the real values from `packed[0]` (callee) and `packed[1]`
(newTarget), then copies `packed[2..]` into a fresh `$args` list with an index loop and `push`.
Lowering already emits `push` (`index.ts:698,1904`). Keep the full four-parameter arrow so that it
matches the imported `SourceFunctionCall` signature exactly.

### 4.2 Lowering (`js-engine/src/lowering/index.ts`)

```ts
/** CreateDynamicFunction body: lowered once per function object, on first call. */
export function lowerDynamicFunctionImplementation(
  syntax: DynamicFunctionSyntax,
): ScriptLoweringResult; // module exporting execute($global, $script)
```

- Implement it as `lowerScriptEntry(syntax.module, syntax.parseText, "dynamic-function")`.
  **Pass `parseText`, not `sourceText`**: spans index `parseText`. Otherwise nested functions'
  `retainFunctionSource` slices are shifted by one.
- With `entryKind === "dynamic-function"`:
  - set `$scope = createGlobalScope($global)`, with no `$evalLexical` and no declaration
    instantiation;
  - take the single `function-expression` (otherwise fail with `UNSUPPORTED`) and call
    `callable(expr.parameters, expr.body, false, expr, {packed: true, codeStrict: expr.strict ??
false})`;
  - return `finish("none", carrier)`.

  Do **not** lower the statement as a function-expression value, because that would create a
  self-binding for `anonymous`.

- New `CallableOptions.packed`. The arrow's parameters stay the four `unknown` / `readonly
unknown[]` parameters. The prologue binds `$calleeN = packedArgs[0]`, `$newTargetN =
packedArgs[1]`, and `$argsN` by copy. Everything else in `callable()` is unchanged:
  `instantiateScriptArguments` receives the real callee (`arguments.callee`, mapped arguments), the
  sloppy receiver binds against `$global.thisValue` with `$errors` (the constructor realm), and
  `newTarget` flows to `new.target`. When `packed` is false the output must be **byte-identical**
  (§5.1 #3).
- The `runScriptContext` identity for `"dynamic-function"` reads `$script.hostDefined`, exactly as
  indirect eval does.
- `scriptRuntimeImports(…, declarations)` gains a `"function"` mode that omits both
  `instantiateGlobalDeclarations` and `instantiateEvalDeclarations`. The surface still uses
  `"all"`, so the vocabulary is unchanged.

### 4.3 Service (`js-engine/src/script-evaluation.ts`)

```ts
/** General CreateDynamicFunction body: one compile and one entry invocation per
 * function object. `identity` is the scriptOrModule captured at construction. */
export type DynamicFunctionBodyCompiler = (
  syntax: DynamicFunctionSyntax,
  identity: unknown,
) => OrdinaryObject<ScriptPropertyKey, unknown>; // the carrier; failures are unsupported
export function createDynamicFunctionBodyCompiler(
  context: ScriptEvaluationContext,
  host: ScriptEvaluationHost,
): DynamicFunctionBodyCompiler;
```

- Factor the tail of `createEntryEvaluator` (compile → domain check → carrier record → invoke →
  context-leak check → completion view) into one private `runEntry(lowered, inherited)`, shared by
  all three entry kinds. The fault classes (`ScriptEvaluationFault`) and exit codes 13–17 are
  unchanged.
- Body compiler steps:
  1. check `realm.unsupported` and the domain;
  2. `lowerDynamicFunctionImplementation`, where **any** failure → `rejectUnsupportedExecution` (§6);
  3. `runEntry(lowered, identity)`, using `createScriptRecord(realm, identity)` as the private
     carrier exactly as indirect eval does;
  4. a completion other than `"none"` → `fault("completion-kind")`;
  5. `viewObjectValue(done.value, realm.objectPrototype)` must have `internalCall`; otherwise
     `fault("completion-view")`.
- The export name `createDynamicFunctionBodyCompiler` is also the **capture marker** (§4.5).

### 4.4 Routing (`js-engine/src/dynamic-function.ts`)

`createDynamicFunctionCompiler(context, host, limits, general?: DynamicFunctionBodyCompiler)`. The
fourth parameter is optional, so existing callers and every test without it keep today's behavior.

- At construction, after the prototype lookup, capture
  `const identity = realm.agent.activeContext?.scriptOrModule`. This is the value
  `createSourceExecutionContext` captures for the outer object. Never read it at first call.
- Add one field to the existing `code` record: `carrier: OrdinaryObject | undefined`. Add
  `ensureGeneral()`: if `general` is undefined, reject; otherwise compile once and store. Do not
  retry after a failure: the realm is already sticky-unsupported.
- `execute(receiver, args, callee, newTarget)` for `kind === "normal"`:
  1. `!simple` → general.
  2. Otherwise try the profiles (unchanged order).
  3. If no profile compiles, or the published closed profile does not match its signature → general.
  4. A compiled closed profile with `args.length < minimumArguments` → general (it rejects today).
  5. The general path calls `carrier.internalCall(receiver, [callee, newTarget, ...args])` with the
     **unbound** receiver. `this` binding has one owner: the lowered code. Calling `internalCall`
     directly avoids a second context push, because the outer object's context is already active
     and has the same realm and identity.
- Profile paths keep `bindReceiver` and their readers unchanged. The generator, async and
  async-generator branches keep `if (!simple) reject` (S6).

### 4.5 Test262 host (`tools/test262-native.ts`, `tools/test262-native-run.ts`)

- **Capture.** `capturedScriptEvaluation` adds `functionFallback: true` only when `indirectEval` is
  true **and** the captured evaluation module exports `createDynamicFunctionBodyCompiler`. A marker
  without `indirectEval` throws `incomplete captured function-fallback contract`.
  `nativeScriptAdapter` then returns `native-script-v8-function-fallback`. Frozen images without
  the marker keep v7 or v6. The label comes from the manifest capture only, as IE7 §6.3 requires.
- **Generated realm text.** When `functionFallback` is captured, hoist `const service:
ScriptEvaluationHost` above `realm.dynamicFunctionCompiler=` and pass
  `createDynamicFunctionBodyCompiler({realm,global},service)` as the fourth argument. Each realm
  still has its own service closure over the single shared `scriptState` and arena.
  `$262.createRealm` therefore gets its own constructor-realm global with no new state.
- Unsupported detection, fault exits and resources (4 MiB arena, 256 KiB Script cap) are unchanged.

## 5. Red-first slices

Each slice is one commit. Gates: `pnpm build`, the focused `node --test` files listed, then
`pnpm check`. Inspect every exit status (fail-fast).

### 5.1 FN0: lowering only (`lowering/index.ts`, `runtime-imports.ts`)

Tests go in a new file, `packages/js-engine/test/dynamic-function-lowering.test.ts`:

1. `Function("a","b","return a+b")` lowers to an `execute` entry with exactly one
   `createSourceFunction` carrier call at entry depth. The carrier is non-constructible. There is no
   `instantiateGlobalDeclarations` or `instantiateEvalDeclarations`, and no self-binding for
   `anonymous` (no binding named `anonymous` is created).
2. The imports are a subset of `scriptRuntimeSurface()`, with no new names.
   `runtime-imports.test.ts` covers the `"function"` mode.
3. **Byte-stability.** Every existing `lowering.test.ts`, `eval-lowering.test.ts` and
   `annex-admission.test.ts` expectation passes unchanged. Add one assertion that
   `lowerScript`/`lowerEvalScript` output for a corpus with nested functions is deep-equal to the
   pre-change output (the `packed` default is false).
4. Spans use `parseText`: a nested `function g(){}` in the body retains exactly `"function g(){}"`.
5. Default, rest, destructured and duplicate sloppy parameters; `arguments`; `new.target`; and a
   body containing a direct `eval(...)` all lower. The last keeps `callEvalCandidate`, so direct
   strings stay blocked.
6. Validator/lowering agreement. For a corpus of bodies accepted by `parseDynamicFunction` and
   `validateJavaScriptBindings`, lowering never returns `EARLY_ERROR`. This pins the §6 invariant.
7. In Node, `prepareManagedSurfaceEntry` succeeds for the corpus against the real surface (pattern:
   `script-compile.test.ts:258`, `tools/managed-jit-entry.test.ts:9`). This proves the packed arrow
   is admitted into the imported `SourceFunctionCall` signature at the **compiler** level only.

### 5.2 FN1: service and routing (`script-evaluation.ts`, `dynamic-function.ts`)

Node fakes cannot execute lowered code. Their `invoke` returns a hand-built carrier made by
`runtime.createSourceFunction`, which records `(receiver, packed)`. These tests therefore prove
routing contracts, not body semantics.

1. Without `general`, all of today's `dynamic-function.test.ts` cases pass unchanged, including
   "unsupported parameter initialization is rejected on call before publication".
2. With `general`, `Function("value=19","return value")` compiles exactly once across two calls.
   Construction alone compiles nothing (no lower, compile or publish events).
3. `Function("return this")` and the other profile-eligible bodies still publish through the
   **profile** with zero service compiles. This protects the 130 `fnGlobalObject.js` includers.
4. Packing order. On a call: `packed[0] === fn`, `packed[1] === undefined`, the receiver is
   **unbound** (`undefined` stays `undefined`). On `new fn(1)` and on `Reflect.construct(fn, [],
G)`: the receiver is the instance created by the outer object, `packed[1]` is the newTarget, and
   the prototype getter on the newTarget is read once.
5. Identity. The frame's `$argument1` is a **fresh carrier record** whose `hostDefined` is
   SameValue to the `scriptOrModule` active at construction. It is neither a new identity nor the
   identity active at the first call. Construct under identity A, call under B, and assert A.
6. Realm. A function from realm B's `Function`, called from A, compiles with B's realm and global
   (`frame.$argument0 === B.global`).
7. Failures: a lowering `UNSUPPORTED`, each `ScriptCompileFailure` stage, a `"throw"` completion and
   a non-callable completion value all end sticky-unsupported, never as a SyntaxError. A domain
   change between construction and call rejects before compiling. A context leak is a fault (code
   17).
8. Closed-profile arity. `Function("a","return a")` called with zero arguments takes the general
   path when it is available, and stays unsupported when it is not.

### 5.3 FN2: host wiring (`test262-native.ts`, `test262-native-run.ts`)

In `tools/test262-script-service.test.ts`, red first:

- capture with and without the marker;
- the marker without `indirectEval` throws;
- the label is v8, v7 or v6 accordingly;
- the generated text puts `service` before `dynamicFunctionCompiler` only when captured;
- the fourth argument is present only when captured;
- the generated runtime still type-checks for each of the v6, v7 and v8 captures.

Update `docs/test262-runner.md` (the label) in the same commit.

### 5.4 Census (FN0 and FN2)

Run `tools/script-runtime-surface.test.ts` and `packages/js-engine/test/runtime-surface.test.ts`.
The expectation is **no re-pin**: 122 entries (102 helpers, 20 types) and an unchanged
`scriptRuntime` digest. A change means the design leaked an import or a layout. Investigate it;
do not re-pin.

Measure and record, without predicting:

- the Test262 batch image size before and after FN2;
- per-entry native code bytes for each native case in §7;
- first-call compile latency for each native case in §7.

## 6. Creation-time versus call-time errors

| Phase        | Condition                                                                  | Result                                                                                                       |
| ------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Construction | ToString throws                                                            | That error, before parsing (intrinsic, unchanged)                                                            |
| Construction | Parameter, body or combined parse error; binding early error               | SyntaxError in the **constructor realm**, before the prototype read (unchanged)                              |
| Construction | Parser `LIMIT` / `UNSUPPORTED_SYNTAX`; binding `LIMIT` / `UNSUPPORTED`     | Sticky unsupported (unchanged)                                                                               |
| Construction | `newTarget.prototype` getter throws                                        | That error, after syntax (unchanged)                                                                         |
| First call   | Lowering fails for any reason, **including `EARLY_ERROR`**                 | Unsupported. A post-construction SyntaxError would contradict the spec; FN0 #6 guards that this never arises |
| First call   | Compile stage failure (`prepare` / `emit` / `budget` / `link` / `publish`) | Unsupported. The stage is visible only in Node tests; no new diagnostics plumbing                            |
| First call   | Compile or invoke throws, completion view or kind is wrong, context leaks  | Host fault (13–17) plus unsupported                                                                          |
| Any call     | Body throws                                                                | Propagates unchanged; errors use the function realm's prototypes                                             |
| Never called | Any body                                                                   | No lowering, compile or publication, and no unsupported flag                                                 |

## 7. Native acceptance (new verifier; do not touch the IE verifiers)

Add `tools/verify-test262-native-function-fallback.ts`, modeled on
`tools/verify-test262-native-indirect-eval.ts` (batch builder plus a Node reference realm per case).
Its prerequisites are the IE7 20-case acceptance and case 5 passing; until both pass, every result
it produces is pending. Build with `TINT_BUILD_ONLY=1` and run serially under LLDB, asserting the
stopped-at-entry and final exit states. The cases (expected values from my Node probes, 2026-11-05):

1. `Function("a","b","return a+b")(40,2)===42` (general, simple formals, closed profile not
   applicable).
2. Mapped arguments: `Function("a","arguments[0]=2;return a")(1)===2`; strict → `1`; `a=0` formals
   → `1`.
3. Default, rest and destructuring: `Function("a=1","...r","{x}", …)`; `length` stays 1 (the
   existing `expectedArgumentCount`).
4. Duplicate sloppy formals: `Function("a","a","return a")(1,2)===2`.
5. `this`: sloppy `undefined` → `globalThis`; strict → `undefined`; `.call(1)` boxes with a
   `Number.prototype` from **the function realm** (`$262.createRealm`).
6. `arguments.callee===f`; `typeof anonymous==="undefined"`.
7. `new.target`: `new F()===F` for `F=Function("return new.target")`; `Reflect.construct(F,[],G)
===G`; `new (Function("this.x=1"))().x===1` with the right prototype.
8. Cross-realm: `other.Function("return this")()===other`; `other.Function("null.x")` throws
   `other.TypeError`.
9. Globals: a read of a global declared after construction; a sloppy implicit global write; a strict
   undeclared write → ReferenceError.
10. Closures and GC: `Function("var x=0;return function(){return ++x}")()` counts across a forced
    collection.
11. Annex B block function: `Function("{function q(){return 7}} return q()")()===7`.
12. Template sites: `F()===F()` and `Function(same)()!==F()`.
13. Profiles unchanged: `Function("return this")()` publishes through a profile. Record the service
    compile count as 0.
14. Lazy (unsupported): construct a body whose **lowering** is unsupported and never call it; the
    test completes and the realm is not unsupported.
15. Lazy (supported): call that body; outcome `unsupported`, not SyntaxError.
16. Direct eval stays blocked: `Function("return eval('1')")()` → sticky unsupported.

Also record per-case code bytes and the arena total. Exhaustion stays `publish` → unsupported; do
not resize the 4 MiB arena in this slice.

**Conformance.** Rerun the complete, unchanged `built-ins/Function` selection into a **new**
immutable report labeled v8. Compare it with the pending IE7-era Function regression from the same
toolchain lineage once that exists, not with the stale v1 report. Keep the 27 pre-entry rows
separate. Then rerun the IE7 indirect selections unchanged, since FN1 refactors the shared
`runEntry`. Update the dashboard only after the complete reruns.

**Self-hosting.** FN0 and FN1 change lowering and engine files. Run a frozen-source native self-build
with byte-identical stage images, plus the debug-information check. Schedule it after the two
pending frozen self-builds; never run it alongside them.

## 8. Findings by evidence class

**Code reading (live tree).** All of §2 and §4's anchors. In particular:

- the vocabulary already contains every helper the general body needs: `createSourceFunction`,
  `instantiateScriptArguments`, `instantiateFunctionBody`, `sloppyCallReceiver`,
  `createArrayFromList` and `createGlobalScope`;
- there is no checked unknown-to-callable view;
- source functions capture identity at creation.

**Node reference probes** (Node's own `Function`/`vm`, not Tint): every expected value in §7. One
note: a TypeError thrown by a foreign-realm Function body is `instanceof` the foreign `TypeError`,
not the local one.

**Primary spec (§3).** ToString → HostEnsureCanCompileStrings → three parses → prototype →
OrdinaryFunctionCreate (identity and realm captured at creation) → SetFunctionName → MakeConstructor.

**Native unknowns (no evidence yet):**

- whether a JIT arrow admitted into `createSourceFunction` and invoked from AOT works natively (case
  5 exercises the same shape and is pending);
- whether the packed-copy prologue compiles and runs inside managed entries;
- per-entry code size, first-call latency and arena pressure across a test;
- GC retention of the carrier and its closure through the AOT `code` slot;
- template sites in a JIT module that is invoked once per function object.

**Future capabilities (not in this plan):**

- a checked native callable view, which would remove packing;
- arena reclamation;
- a per-row unsupported reason (parent §6);
- generator and async general bodies (S6);
- direct eval (S5);
- HostEnsureCanCompileStrings embedding policy.

## 9. Hazards and non-goals

- **Do not** build a code cache keyed by source text. Two `Function` calls with the same text must
  have distinct template sites and distinct compiled entries. The only cache is the per-object
  `code` slot.
- **Do not** add loaders, schedulers, a prechecked surface or arena sizing here. Measure first
  (parent §9 risks 1–3).
- **Do not** route `!simple` generator or async kinds to the general path.
- **Do not** bind the receiver twice. The general path passes it raw, and the profiles keep
  `bindReceiver`.
- **Do not** create a fresh identity per call or per compile. Read `scriptOrModule` exactly once, at
  construction.
- A recursive first call cannot re-enter compilation: the entry runs no user code. Set the carrier
  only after `runEntry` succeeds.
- No performance claims. Every timing, size and pass-rate number is to be measured.

## 10. Handoff to S6 (generator and async dynamic bodies)

S6 can reuse `lowerDynamicFunctionImplementation`, `createDynamicFunctionBodyCompiler` and the
carrier pattern. The packed arrow must then return `GeneratorContinuation` or
`AsyncGeneratorContinuation`, so the carrier helper must accept those signatures. Today
`createSourceGeneratorFunction` and its siblings take three-parameter callbacks with no newTarget.
S6 must also remove the profile-only `completion` discriminator from the general path, and
reconsider `createSourceAsyncContinuationFunction` for async bodies. Plan this as its own slice once
FN3 passes natively.

## 11. Slices summary

| Slice | Files                                                                                                  | Gate                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FN0   | `lowering/index.ts`, `lowering/runtime-imports.ts`, §5.1 tests                                         | `node --test` for the new lowering test plus `runtime-imports`, `runtime-surface`, `script-compile`, `tools/script-runtime-surface`, `tools/managed-jit-entry`; `pnpm check` |
| FN1   | `script-evaluation.ts`, `dynamic-function.ts`, `dynamic-functions.ts` comment, §5.2 tests              | `dynamic-function.test.ts`, `script-evaluation.test.ts`, `tools/js-engine-dynamic-function.test.ts`; `pnpm check`                                                            |
| FN2   | `tools/test262-native.ts`, `tools/test262-native-run.ts`, `test262-script-service.test.ts`, runner doc | `node --test tools/test262-script-service.test.ts tools/test262-native.test.ts`; `pnpm check`                                                                                |
| FN3   | `tools/verify-test262-native-function-fallback.ts`                                                     | §7 serial native run (after IE7 acceptance), then a frozen self-build, then the `built-ins/Function` v8 rerun and the IE7 selection reruns                                   |

## 12. Next focused planning task

Plan **FN0's `packed` prologue against the managed compiler**, before writing code. The questions:

- Does `prepareManagedSurfaceEntry` accept an index-and-push copy loop over `readonly unknown[]`
  inside a callback?
- Does admitting a four-parameter arrow whose last two parameters are unused match
  `SourceFunctionCall`'s physical signature exactly?
- Which existing compiler test (`script-compile.test.ts`, `tools/managed-jit-entry.test.ts`) is the
  smallest place to pin both?

Answer these read-only, from the checker and specializer source. If either answer is no, the
fallback option is the record-slot alternative in §4.1, and its census cost must be planned
explicitly.
