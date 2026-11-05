# RT-EVAL S6-af: general `AsyncFunction` constructor body fallback

Implementation status: **AF0 passes its Node and native gates.**
The continuation now enters the existing transfer-record driver in AOT and managed
compilation. Exact callback-variance rejection tests remain unchanged. The
[Node checkpoint](../results/managed-suspension-node-checkpoint-v1.json) records
managed preparation success and the unchanged surface census. All seven new managed cases and 112 existing AOT controls passed in the
[119-case native regression](../results/native-managed-suspension-validation-v1.json).
These are bespoke regressions, separate from unchanged Test262 selections.
AF1 and AF2 are also implemented and pass all 4,122 workspace tests; the
[async-body checkpoint](../results/async-function-body-node-checkpoint-v1.json)
records lazy compilation, packed state, definition-context preservation, carrier
promise identity and job ordering. All 16 native body cases and the combined control/finalizer run passed:
[156 expected native outcomes](../results/async-function-finally-native-checkpoint-v1.json),
including five finalizer cases. Expected negative/error, timeout and unsupported
controls remain explicit in the report. Unchanged Test262 constructor groups are
queued separately. A later review found the separate finally-cleanup
contract gap; it is now fixed using a named, proven direct-call local helper.
All 4,124 workspace tests pass; see the
[finally checkpoint](../results/managed-finally-node-checkpoint-v1.json).
The [complete 220-module bootstrap graph](../results/engine-only-compiler-graph-agreement-v2.json)
is unchanged since the private-binder snapshot. Its [native fixed point passed](../results/eval-private-selfhost-checkpoint-v1.json)
and provides the compiler gate; execution-framework changes require their native
engine fixtures.
The research sections below retain their original capture and proposed-slice descriptions.

Research capture below describes the pre-AF0 source. Parent: [rt-eval.md](rt-eval.md) §7 S6. Builds on the ordinary
fallback in [rt-eval-function-fallback.md](rt-eval-function-fallback.md) (FN0–FN2, implemented). Scope
is `kind === "async"` only. Generator and async-generator constructor bodies are later tasks (§11).

**Capture.** 2026-11-05, live source identity
`42be685a1a923d1db3aa083c29ae83472d3feae563819f9720248bf2945c1e60` (552 files). DE5b private-name
eval is implemented ([checkpoint](../results/eval-private-node-checkpoint-v1.json): 4,112 workspace
tests; census 128 vocabulary entries, 183 records, 166 signatures, 41 runtimes). `dist` timestamps
match `src` for every file probed: lowering 07:05, compiler 22:38 (Nov 4), and dynamic-function 02:50.

**Not established. Do not cite any of these as passing.**

- DE5b native private fixtures and the 41-case host are built but have not run.
- The DE5a frozen native self-build is running now. DE4 Test262 selections are paused.
- The only `built-ins/AsyncFunction` report ([v3](../results/test262-async-function-family-native-v3.json),
  adapter `native-script-v4-shared-image`, 2026-11-03) predates FN0–FN2 and DE*. It is a **stale
  baseline**: 31 pass, 4 unsupported and 1 pre-entry LLDB crash out of 36.

**Method.** I read the live source. Node probes ran in `/tmp/tint-afn-probe` against the
workspace `dist`. Two patched copies of dist files lived only in `/tmp`: one makes the variance gate
log every crossing pair, and the other lowers async dynamic bodies. Node's own
`AsyncFunction` served as the semantic reference. I ran no build, emission, native process, queue
action or agent. I edited only this file and one cross-link.

## 1. Answer in brief

1. **Not feasible as one slice.** Every managed (JIT) entry that contains _any_ suspending
   function fails `prepareManagedSurfaceEntry` with `profile: callback variance crosses surface
classes`. That includes `async()=>1`, `function*g(){}`, async generators and the dynamic body. I
   found the exact pair: a JIT closure of class `GeneratorContinuation` (`$T118`) is
   type-assignable to the JIT call-indirect witness of class `GeneratorStep` (`$T119`). The
   witness is `resume(kind, input)` inside the continuation arrow (`lowering/index.ts:1675-1700`).
   The gate is fail-closed by design, so it must not be relaxed.
2. **Smallest runnable prerequisite, AF0.** Lower the continuation as
   `runGeneratorSteps({kind:"transfer", next: resume, inputKind: kind, value: input})` instead of
   `runGeneratorSteps(resume(kind, input))`. By `runGeneratorSteps`'s definition
   (`iterators/generator.ts:23-35`) the semantics are identical, and the JIT no longer has a
   `GeneratorStep` witness. A Node probe applied this rewrite to the lowered AST. Every suspending
   Script and dynamic body then passes the whole prepare pipeline: the variance gate, E4a flows,
   emission and selection (§4).
3. **AF1, lowering.** `lowerDynamicFunctionImplementation` accepts `async && !generator` and
   calls `callable(…, {packed: true, async: true})`. The hidden carrier becomes a
   `createSourceAsyncContinuationFunction` object. There is no new import, record, frame or
   compiler.
4. **AF2, AOT dispatch.** The outer object must return the **carrier's own promise**. Resolving an
   outer promise with it adds observable ticks: the Node probe shows `t1,t2,settled` instead of
   `t1,settled`. Add one AOT-only runtime export, `createSourceAsyncDispatchFunction`. Profiles keep
   priority and current semantics.
5. **Service and host stay unchanged.** `createDynamicFunctionBodyCompiler` is already
   kind-agnostic (`script-evaluation.ts:136-157`). It still compiles lazily, once per function
   object, under the identity captured at construction. No job draining is added.

## 2. Live state (read today)

| Piece                     | Location                                                   | State                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dynamic compiler          | `js-engine/src/dynamic-function.ts:92`                     | Eager parse, validation and prototype; identity captured at `:198-199`                                                                                          |
| General gate              | `:233-243` `ensureGeneral`                                 | `general === undefined \|\| kind !== "normal"` → reject (`:237`). One carrier per object (`code.carrier`)                                                       |
| Packed call               | `:244-256` `executeGeneral`                                | `call(receiver, [callee, newTarget, ...args])`, unbound receiver                                                                                                |
| Shared `execute`          | `:391-405`                                                 | `!simple` → general; profiles; closed arity → general; else `executeBody(bindReceiver(…))`                                                                      |
| Async outer               | `:409-416`                                                 | `createSourceAsyncFunction(execute, …)`. Today an async body with `await` or non-simple formals reaches `:237` and becomes sticky unsupported, as a rejection   |
| Generator outers          | `:417-466`                                                 | `!simple` → reject; profile only. Unchanged here                                                                                                                |
| Async direct helper       | `js-runtime/src/objects/async-functions.ts:31-49`          | `functions.resolve(implementation(r, a, c, undefined))`. Used only by `dynamic-function.ts` and `tools/verify-hosted-async-functions.ts`                        |
| Async continuation helper | `:53-124`                                                  | Calls `initialize(r, a, c, undefined)`. `resume` captures `activeContext` **at call** and runs segments under `runScriptContext`; awaits use `awaitScriptValue` |
| Private factory           | `:126-162` `createAsyncFunction`                           | Promise (`realm.promisePrototype`) is created **before** the body; body throw → reject; `createSourceExecutionContext(realm)`                                   |
| Call context push         | `objects/call.ts:11-27`                                    | `callObject` runs `internalCall` inside the callee's `internalExecutionContext`                                                                                 |
| Lowering entry            | `lowering/index.ts:133-137`, `:4534-4552`                  | `"dynamic-function"`; `fn.async \|\| fn.generator` → `UNSUPPORTED` (`:4544-4545`)                                                                               |
| `callable()`              | `:1089`; packed prologue `:1159-1251`; params `:1739-1785` | Async non-generator: four callback parameters (`$ignoredCallee`, `$ignoredTarget` when packed); `new.target` = `$newTargetN` = `packed[1]` (`:1252-1261`)       |
| Async/generator wrapper   | `:1801-1830`                                               | `createSourceAsyncContinuationFunction(callback, $errors, $global.hooks, name, length, home)`; packed length 0                                                  |
| Continuation arrow        | `:1613-1700`                                               | `$resumeN: GeneratorStep` (`let`, `:1662`); arrow `(kind,input):GeneratorOutcome => runGeneratorSteps($resumeN(kind,input))`                                    |
| Transfer records          | `lowering/generators.ts:81-101`                            | `{kind:"transfer", next, inputKind, value}` are already emitted between segments                                                                                |
| Variance gate             | `compiler/src/native/managed-jit-signatures.ts:262-279`    | Rejects a non-proof JIT target of class kF that is `assignable` to any witness of class ≠ kF                                                                    |
| Body compiler             | `js-engine/src/script-evaluation.ts:136-157`, `:167-222`   | Lower → `runner.run(lowered, identity, false)` → `"none"` completion → carrier with `internalCall`                                                              |
| Host                      | `tools/test262-native.ts:83,85,430-438,555`                | 4 MiB arena; `maxScriptCodeBytes` 262,144; `general` passed only for `functionFallback`; one `drainScriptJobs`, after the scripts                               |

## 3. Specification points (ES2027 draft, as in the S4 plan)

- **CreateDynamicFunction(async)** uses the prefix `async function` and fallback prototype
  `%AsyncFunction.prototype%`, and performs no MakeConstructor. The environment is the
  constructor realm's global environment, and the PrivateEnvironment is null. Tint already
  implements this eagerly (`function-intrinsics.ts`, `dynamic-function.ts:171-205`).
- **OrdinaryFunctionCreate** fixes `[[ScriptOrModule]]` and `[[Realm]]` at creation.
- **EvaluateAsyncFunctionBody** runs these steps in order:
  1. NewPromiseCapability(%Promise%) of the **callee's** realm.
  2. FunctionDeclarationInstantiation. An abrupt completion rejects; it never throws to the
     caller.
  3. AsyncFunctionStart.

  `return v` performs Call(resolve, v). Await uses PerformPromiseThen on PromiseResolve(%Promise%,
  v), which queues jobs and drains none.

- Node reference (`/tmp/tint-afn-probe/order.mjs`, log `b0,b1,t1,settled,t2,…`): an
  `AsyncFunction` body orders exactly like a source async function. A parameter-initializer throw
  becomes a rejection. Strict `this` is passed through, and sloppy `undefined` becomes
  `globalThis`. `new.target` is `undefined`, `new f()` throws TypeError, and there is no own
  `prototype`. Duplicate sloppy formals take the last value, and the arguments object is mapped.

## 4. Probe evidence

Every result below comes from `prepareManagedSurfaceEntry` using `createManagedScriptFixture()`
(the real surface).

| Input                                                                        | Today (dist)           | With AF0 rewrite (+AF1 patch for dynamic)                    |
| ---------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------ |
| Script `async function h(){return await 7}`                                  | profile, `$T118→$T119` | ok; 59,400 B; signatures 20, records 16                      |
| Script `function*g(){yield 1;yield* [2]}`                                    | profile, same pair     | ok; 81,808 B                                                 |
| Script `async function*ag(){yield await 1}`                                  | profile, same pair     | ok; 67,296 B (uses `runAsyncGeneratorSteps` rewrite)         |
| Script `var f=async()=>1`, `function*g(){}`                                  | profile, same pair     | ok                                                           |
| Dynamic async `return await 7`                                               | lowering `UNSUPPORTED` | ok; 55,248 B                                                 |
| Dynamic async `a=1,...r`; try/await/catch; `this`, `new.target`, `arguments` | lowering `UNSUPPORTED` | ok; **210,032 B** (cap 262,144)                              |
| Dynamic async `a,a`; `{x}` + loop await; strict `this`                       | lowering `UNSUPPORTED` | ok; 47–131 KB                                                |
| Dynamic async with nested `eval('1')`; with `async()=>await this`            | lowering `UNSUPPORTED` | ok (the direct string eval itself stays blocked at run time) |
| Dynamic normal `a=1` (control)                                               | ok; 57,824 B           | unchanged                                                    |

Each prepare took about 0.5–0.6 s in Node. This is not a performance claim. With the rewrite, the
crossing-pair list is empty in every case. Prepare also needed no new record class,
vocabulary entry or frame field. The gate code was not changed: the copy only logged.

## 5. AF0: suspension continuation without a JIT `GeneratorStep` witness (prerequisite)

**Edit (one file):** `js-engine/src/lowering/index.ts:1675-1700`. Replace the argument of
`runGeneratorSteps` / `runAsyncGeneratorSteps` with an object literal. Reuse the `transfer` shape
from `generators.ts:81-101`, but with **expression** `inputKind` (`id(kindName)`), not a string
constant. Either export a small `transferRecord(next, kind, value)` helper from `generators.ts`
or build the node inline with the same property order (`kind`, `next`, `inputKind`, `value`).
The arrow keeps its parameters and return type.

- **Semantics.** `runGeneratorSteps(t)` with `t.kind === "transfer"` calls
  `t.next(t.inputKind, t.value)` and then loops. That is exactly
  `runGeneratorSteps(resume(kind, input))`. `$resumeN` is read once, immediately before the call,
  in both forms. Throws propagate
  unchanged, and stack depth is unchanged. The only extra work is one record allocation per
  resumption.
- **Scope decision: apply to AOT and JIT alike (recommended).** One lowering shape. Existing AOT
  native suspension coverage then exercises the new shape for free. A JIT-only flag would keep AOT
  byte-stable, but it would fork the lowering and leave the JIT shape with no native evidence
  except new fixtures. The cost is regression reruns (§9).
- **Do not** touch `managed-jit-signatures.ts`, the E4a flows check, `classOf`, or any type in
  `iterators/`.

**Red tests (fail today):**

1. `packages/js-engine/test/lowering.test.ts` (new case): for `function*g(){yield 1}`, `async
function h(){await 1}` and `async function*a(){yield 1}`, the continuation arrow's body is
   `runGeneratorSteps`/`runAsyncGeneratorSteps` over an `object` node with `kind:"transfer"`,
   `next: $resumeN`, `inputKind: $resumeKindN` and `value: $resumeValueN`. No `call` whose callee
   is a `$resume…` identifier remains in that arrow.
2. `tools/managed-jit-entry.test.ts` (new test, real surface): the four Scripts in §4 prepare
   `ok`. Today they fail with `variance crosses`.
3. `tools/managed-dynamic-function.test.ts` (new case): the **ordinary**
   `Function("return (async function(){}).constructor")` and
   `Function("return (async function* () {}).constructor")` bodies prepare `ok`. These are the
   `wellKnownIntrinsicObjects.js` shapes.
4. Unchanged and still green: every `tools/managed-jit-signatures.test.ts` case. The `variance` and
   `varianceTs` cases must still reject.
5. `packages/js-runtime/test/iterator-protocol-generator-steps.test.ts` pins the equivalence:
   `runGeneratorSteps({transfer, next: s, …})` and `runGeneratorSteps(s(k, v))` produce equal
   outcomes and the same thrown identity, for both resume kinds that throw.
6. Census: `tools/script-runtime-surface.test.ts` and `runtime-surface.test.ts` stay at 128/183/166/41
   with **no re-pin**.

**AF0 native gates.** These go to main's serial queue, after the active DE5a self-build and DE5b
fixtures.

- AOT: rerun `tools/verify-test262-native-async.ts`, `verify-test262-native-dynamic-kinds.ts` and
  `verify-test262-native-dynamic-async-generator.ts` unchanged. All must keep their recorded
  outcomes.
- JIT: add a new `tools/verify-test262-native-managed-suspension.ts`, modeled on
  `verify-test262-native-function-fallback.ts`, with a Node reference realm per case. Every case
  is asynchronous with expected outcome `completed`:
  1. `$262.evalScript("async function h(){return await 7}")`, then `h()` resolves to 7.
  2. `(0,eval)("(function*(){var x=yield 1;return x+1})")`: `next()` → `{value:1,done:false}`,
     then `next(41)` → `{value:42,done:true}`.
  3. `new Function("return (async function(){}).constructor")()` is SameValue to
     `Object.getPrototypeOf(async function(){}).constructor`. The realm stays supported.
  4. An async generator from indirect eval, `yield await 1`, then `return 2`.
  5. Inside an eval'd async function, `try{await Promise.reject(9)}catch(e){return e}` → 9.
  6. 32 MiB of churn between two awaits inside an eval'd async function; a captured closure
     survives.
  7. Ordering: interleave an eval'd async function with an AOT `Promise.resolve().then` chain.
     The log must equal the Node reference.

  Build with `TINT_BUILD_ONLY=1` and run serially under LLDB, asserting stopped-at-entry and the
  final exit state. Record per-case code bytes and the arena total. Store the results in
  `native-managed-suspension-v1.json`.

## 6. AF1: async dynamic body lowering

**Edit:** `lowering/index.ts:4544-4549`:

```ts
if (fn.kind !== "function-expression" || fn.generator)
  return fail(fn, "dynamic body requires an ordinary or async function");
const carrier = callable(fn.parameters, fn.body, false, fn, {
  packed: true,
  async: fn.async,
  codeStrict: fn.strict ?? false,
});
```

Update the doc comment at `:132` to read "ordinary or async CreateDynamicFunction body". Nothing
else in `callable()` changes. The async branch (`:1801`) already produces the carrier. Its
callback is `(receiver, $packed, $ignoredCallee, $ignoredTarget): GeneratorContinuation`, which is
exactly `createSourceAsyncContinuationFunction`'s `initialize` type. `instantiateScriptArguments`
receives the real callee (`packed[0]`), and `new.target` reads `packed[1]`. Sloppy `this` binds
through `sloppyCallReceiver(…, $global.thisValue, …, $errors)` in the constructor realm.

**Red tests** (`packages/js-engine/test/dynamic-function-lowering.test.ts`):

1. `AsyncFunction("a","await a")` lowers to an `execute` entry with exactly one
   `createSourceAsyncContinuationFunction` call at entry depth. It has no `createSourceFunction`
   carrier, a length literal of 0 and four callback parameters. There is no
   `instantiateGlobalDeclarations` or `instantiateEvalDeclarations`, and no `anonymous` binding.
2. Imports are a subset of `scriptRuntimeSurface()` and add no new name.
3. Spans use `parseText`: a nested `async function g(){}` retains `"async function g(){}"`.
4. The existing "rejects non-ordinary bodies explicitly" test (generator) is unchanged. Add the
   same assertion for `async-generator`.
5. Byte-stability: the ordinary dynamic and Script corpus outputs are deep-equal to the AF0 output.
6. `tools/managed-dynamic-function.test.ts`: the §4 dynamic corpus prepares `ok`. This needs AF0.

## 7. AF2: AOT dispatch that returns the carrier's promise

**New runtime export** (`js-runtime/src/objects/async-functions.ts`, re-exported from
`objects/index.ts:265-266`; **not** added to `scriptRuntimeImports`):

```ts
/** CreateDynamicFunction async objects. `delegate` runs before any promise exists.
 * A returned promise comes from a hidden carrier whose own call created, will settle
 * and is the only PromiseCapability; undefined selects the non-suspending profile
 * body, settled exactly as createSourceAsyncFunction. A delegate throw becomes a
 * rejection of a fresh promise, so the call never throws to its caller. */
export function createSourceAsyncDispatchFunction(
  delegate: (
    receiver: unknown,
    args: readonly unknown[],
    callee: unknown,
  ) => OrdinaryObject<ScriptPropertyKey, unknown> | undefined,
  implementation: (receiver: unknown, args: readonly unknown[]) => unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  name: string = "",
  length: number = 0,
): OrdinaryObject<ScriptPropertyKey, unknown>;
```

Implement it beside `createAsyncFunction`, sharing that function's protocol, prototype
(`realm.asyncFunctionPrototype`), `identity` cell, `createSourceExecutionContext(realm)`, `length`
and `name`. Factor the shared promise creation into one private helper; do not copy it.

**`dynamic-function.ts` edits:**

1. `ensureGeneral` (`:237`): reject unless `kind === "normal" || kind === "async"`.
2. Extract `selectGeneral(args): carrier | undefined` from `execute` (`:397-403`), keeping the same
   order: `!simple` → general; `ensureCompiled()`; carrier or closed arity → general; otherwise
   `undefined`. `execute` uses it, with identical behavior for `normal`.
3. Make `callCarrier(carrier, receiver, args, callee, newTarget)` the body of `executeGeneral`.
4. Build the async outer (`:409-416`) as
   `createSourceAsyncDispatchFunction(delegate, profileBody, realm, hooks, "anonymous", length)`,
   where `profileBody` is `(r, a) => executeBody(bindReceiver(r), a)`.
   - `delegate` = `selectGeneral(args)`, then `callCarrier(c, receiver, args, callee, undefined)`
     with the **unbound** receiver.
   - Then `viewObjectValue(result, realm.objectPrototype)`. If the view is `undefined`, throw
     `"DYNAMIC_ASYNC_CARRIER_INVARIANT"`.
5. Drop the `createSourceAsyncFunction` import from `dynamic-function.ts`. Keep the export: the
   hosted fixture uses it.

**Why this is exact.**

- One promise from the callee realm, created before FunctionDeclarationInstantiation. Parameter
  errors reject it (the carrier's `createAsyncFunction` try).
- `resume` captures the active context at call time. That is the outer object's source context:
  constructor realm plus construction-time identity. `callObject` pushes it, and `internalCall`
  on the carrier pushes nothing more.
- Awaits run through the existing AOT `awaitScriptValue` and `runScriptContext`, so job ordering
  equals that of AOT async functions.
- The first-call compile runs inside the outer context. `runner.run` checks for context leaks and
  never drains jobs.

**Red tests** (`packages/js-engine/test/dynamic-function.test.ts`, Node fakes whose `general` returns
a carrier built with `runtime.createSourceAsyncContinuationFunction` and a hand-written
continuation):

1. `AsyncFunction("a=1","return a")` is constructed under identity A and called twice under B. The
   service compiles once, and construction alone compiles nothing. `seen[0].identity === A`. Each
   call returns a **distinct promise that is the carrier's**. The outer object never resolves
   another promise: assert the returned object identity against a carrier-side record.
2. Packing: `packed[0] === fn`, `packed[1] === undefined`, and the receiver is unbound.
3. Ordering: drain `drainScriptJobs` after `p.then(log)` and a parallel `t1…t4` chain. The log
   equals `b0,b1,t1,settled,t2,t3,t4`, the Node reference.
4. After an await, the hand-written continuation records `activeContext.scriptOrModule === A`
   and `realm === constructor realm`, even though jobs drain under B.
5. Profile priority: `AsyncFunction("return 1")` and `AsyncFunction("")` use the closed profile
   with zero service compiles, and their results are unchanged.
6. Without `general`, `AsyncFunction("await 1")` called once gives a promise **rejected** with
   `undefined`, the realm is sticky unsupported, and the call does not throw synchronously.
   Today's observable shape is preserved.
7. A compile failure (lowering, `ScriptCompileFailure` or completion view) ends sticky unsupported
   as a rejection. It is never a SyntaxError and never a synchronous throw.
8. `generator`/`async-generator` with `a=1` still reject without calling `general`. Adapt the
   existing test at `:252`.
9. `packages/js-runtime/test/ordinary-object-async-functions.test.ts`: the dispatch helper has
   no `prototype`, is non-constructible, and has correct `name` and `length`. A delegate throw
   rejects.

## 8. Phases of errors (async kind)

| Phase        | Condition                                        | Result                                                                            |
| ------------ | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| Construction | ToString, parse, early error, `prototype` getter | Unchanged (eager; SyntaxError in constructor realm)                               |
| First call   | Lowering, compile, publish, completion-kind/view | Sticky unsupported, delivered as a rejected promise; fault 13–17 where applicable |
| Any call     | Parameter initializer throws                     | Carrier promise rejected with that value                                          |
| Any call     | Body throws / awaits a rejection                 | Carrier promise rejected; `try/catch` around `await` sees it                      |
| Never called | Any body                                         | No lowering, compile or publication                                               |

## 9. Slices, gates and order

Each slice is one commit. Run `pnpm build`, the listed focused `node --test` files, then
`pnpm check`. Check every exit status.

| Slice | Files                                                                         | Node gate                                                                                                                                                                                     | Native / conformance (main's serial queue, after active work)                                                                                                                                                                                                                                                             |
| ----- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AF0   | `lowering/index.ts` (and `generators.ts` if the helper is exported); §5 tests | `lowering`, `eval-lowering`, `direct-eval-lowering`, `tools/managed-jit-entry`, `tools/managed-dynamic-function`, `tools/managed-jit-signatures`, `iterator-protocol-generator-steps`, census | AOT verifier reruns, then the new managed-suspension verifier, then a frozen self-build. Then unchanged reruns of `built-ins/{GeneratorFunction,AsyncFunction,AsyncGeneratorFunction}` and `language/{statements,expressions}/{async-function,generators,async-generator}` as regressions, each in a new immutable report |
| AF1   | `lowering/index.ts`; §6 tests                                                 | `dynamic-function-lowering`, `tools/managed-dynamic-function`, census                                                                                                                         | Folded into AF2's native run                                                                                                                                                                                                                                                                                              |
| AF2   | `async-functions.ts`, `objects/index.ts`, `dynamic-function.ts`; §7 tests     | `dynamic-function`, `ordinary-object-async-functions`, `ordinary-object-dynamic-function-compiler`, `tools/js-engine-dynamic-function`, census                                                | New `tools/verify-test262-native-async-function-fallback.ts` (§10), then a frozen self-build, then complete `built-ins/AsyncFunction` and `built-ins/Function` reruns, then `staging/sm/async-functions`                                                                                                                  |

Do not interleave with the DE5a self-build, DE5b fixtures or paused DE4 selections. AF0 can land
and run its native gates before AF1/AF2 exist.

## 10. AF2 native acceptance cases

Use the dynamic-kinds async wrapper (`(async()=>{…})().then(print complete)`). Expected values come
from Node probes.

1. `AsyncFunction("a","b","return await a+b")(40,2)` → 42 (general path).
2. Ordering trace equals Node: `b0,b1,t1,settled,t2,t3,t4`.
3. `AsyncFunction("a=(()=>{throw 7})()","")()` rejects with 7 and does not throw synchronously.
4. Mapped arguments: `AsyncFunction("a","arguments[0]=2;await 0;return a")(1)` → 2. The strict
   variant → 1.
5. `AsyncFunction("a","a","return a")(1,2)` → 2. `{x}`, `...r` and defaults work, and `length` is
   1 for `("a","b=1","")`.
6. `this`: sloppy → `globalThis`; strict `.call(5)` → 5; sloppy `.call(1)` boxes with the
   function realm's `Number.prototype` (`$262.createRealm`).
7. `new.target` → `undefined`; `new f()` → TypeError; there is no own `prototype`.
8. Cross-realm: `other.AsyncFunction("return this")()` resolves to `other`. The promise is
   `instanceof other.Promise`. A body TypeError is `other.TypeError`.
9. `try{await Promise.reject(9)}catch(e){return e}` → 9. `finally` runs after an await.
10. Lazy: an uncalled body whose lowering is unsupported leaves the realm supported. Calling it
    gives `unsupported`.
11. Profiles: `AsyncFunction("return 1")()` → 1, with zero service compiles recorded.
12. A closure created after an await survives 32 MiB of churn and is called later.
13. Direct string eval stays blocked: `AsyncFunction("await 0;return eval('1')")()` → sticky
    unsupported. That holds until direct eval is wired for dynamic bodies.

Record code bytes per case and the arena total. Case 5's shape is near 210 KB, against the 256 KiB
per-entry cap and the 4 MiB arena. Exhaustion stays `publish` → unsupported. Resources stay at
heap 256 MiB, stack 16 MiB and 300,000 ms. **No tuning is proposed.**

## 11. Test262 inventory (pinned `91c7075…`; no forecast)

**Owned: `built-ins/AsyncFunction`.** 18 files, 36 variants. In stale v3:

- 31 pass;
- `is-a-constructor.js` ×2 and `proto-from-ctor-realm.js` ×2 are unsupported;
- `AsyncFunction-is-subclass.js` strict is a pre-entry LLDB crash.

**No owned file ever calls a constructed body.** `AsyncFunction-construct.js` and
`instance-construct-throws.js` only construct, so AF1/AF2 affect no owned variant directly. The two
unsupported files depend on **AF0** instead:

- `is-a-constructor.js` includes `wellKnownIntrinsicObjects.js`, which runs
  `new Function("return (async function() {}).constructor")()`. That is an ordinary general body
  with a nested async function, so the variance gate rejects it.
- `proto-from-ctor-realm.js` evaluates `other.eval('(0, async function() {})')`, an indirect eval
  of a suspending Script.

**Dependent on the constructor body (AF1/AF2).** These text-scan counts are signals only:

- `staging/sm/async-functions/constructor.js` constructs `AsyncFunction("await 1")`;
- `built-ins/Function/prototype/toString/AsyncFunction.js` constructs and calls `toString`;
- `language/expressions/import.meta/syntax/goal-async-function-params-or-body.js` expects
  construction-time SyntaxErrors;
- `staging/sm/expressions/exponentiation-unparenthesised-unary.js`;
- `staging/sm/async-functions/create-function-parse-before-getprototype.js`.

**Dependent on AF0 only (any managed suspension).**

- The 10 files including `wellKnownIntrinsicObjects.js`: AsyncFunction, AsyncGeneratorFunction
  and GeneratorFunction `is-a-constructor.js`; Function `prototype/{arguments,caller}/prop-desc.js`;
  Function `prototype/toString/built-in-function-object.js`; Iterator `zip`/`zipKeyed`
  `result-is-iterator.js`; `language/expressions/async-arrow-function/prototype.js`.
- About 13 files whose eval strings contain `async`, `function*`, `yield` or `await`.

Owned GeneratorFunction and AsyncGeneratorFunction files that _call_ bodies (7 and 8 files) stay
out of scope.

## 12. Hazards and non-goals

- Do not relax, special-case or name-match the variance or flow gates. Do not add an assertion,
  an `unknown`-to-callable view, a frame field, a record slot or a second compiler.
- Do not resolve the outer promise with the carrier's promise, and do not drain jobs on compile.
- Do not re-read `scriptOrModule` at call time. Do not add a source-keyed cache.
- Do not route generator kinds to `general`. `ensureGeneral` admits only `normal` and `async`.
- No performance, timing or pass-rate claims.

## 13. Next planning recommendation (generator and async-generator constructors)

AF0 removes the shared JIT blocker for all three kinds. AF1's lowering also generalizes. The
blocker that is left is the **outer object protocol**:

- Generator outers take a three-parameter `GeneratorInitializer`
  (`objects/generators.ts:38-42`), so the AOT side needs a _typed_ continuation that `unknown`
  cannot provide.
- The generator object's prototype must come from the **outer** function's `prototype`, not
  from the carrier's.

Plan next: **"GF: GeneratorFunction bodies via carrier start plus prototype reparent."** The
carrier's JIT `createSourceGeneratorFunction` performs FunctionDeclarationInstantiation and
returns its generator object. The AOT outer then sets that object's prototype from
`Get(outer, "prototype")` with the function-realm fallback.

Answer this first, from the spec text and the pinned
`built-ins/GeneratorFunction/proto-from-ctor-realm-prototype.js`: does the prototype read happen
before or after parameter initialization? My Node probe (`gen.mjs`) observed the read
**before** parameter initialization for both kinds. That disagrees with my reading of
EvaluateGeneratorBody, so resolve it before designing. Then plan async generators as a separate
slice: their request queue and `AsyncGeneratorStart` make the same reparent question harder.
