# RT-EVAL S6-gf: general `GeneratorFunction` constructor body fallback

Implementation status: **research plan only. Nothing here is implemented.**

Parent: [rt-eval.md](rt-eval.md) §7 S6. Sibling: the AsyncFunction plan
[rt-eval-async-function-fallback.md](rt-eval-async-function-fallback.md) (AF0–AF2). Builds on
the ordinary fallback in [rt-eval-function-fallback.md](rt-eval-function-fallback.md).
Scope is `kind === "generator"` only. Async-generator constructor bodies are a later task (§12).

**Capture.** 2026-11-05. The research began at source identity `cbdc9ed…` (552 files, AF0,
[checkpoint](../results/managed-suspension-node-checkpoint-v1.json)). While it ran, main landed
AF1/AF2 at `9005cc1…` (552 files, 4,122 workspace tests,
[checkpoint](../results/async-function-body-node-checkpoint-v1.json)). The census is unchanged
at 128/183/166/41. Line numbers and probes below use that later tree and its rebuilt `dist` (07:40).

**Not established. Do not cite any of these as passing.**

- AF0 (7 managed cases, 112 AOT controls) and AF2 (16 cases) native images are built, not run.
- The only `built-ins/GeneratorFunction` report
  ([v4](../results/test262-generator-function-native-v4.json), adapter
  `native-script-v4-shared-image`, snapshot `4205fdf…` with 446 files, 2026-11-03) predates
  FN0–FN2, DE\*, AF0 and everything here. It is a **stale baseline**: 36 pass, 9 unsupported and
  1 pre-entry LLDB crash out of 46.

**Method.** I read the live source, the ECMA-262 draft (tc39.es, fetched today) and the pinned
Test262 files (`91c7075…`). Node v24.12.0 probes ran in `/tmp/tint-gf-probe` against the workspace
`dist`. One probe used an in-memory module load hook that patched the dist lowering guard (§5).
No file on disk was patched. I ran no build, emission, native process, queue action or agent. I
edited only this file and one cross-link in `rt-eval.md`.

## 1. Answer in brief

1. **Read order: follow the spec, not V8.** `EvaluateGeneratorBody` runs
   FunctionDeclarationInstantiation first, then `OrdinaryCreateFromConstructor(functionObject,
"%GeneratorPrototype%")`. That second step is the `prototype` read. Node reads `prototype`
   **before** parameter initialization. No pinned Test262 file observes the difference. Tint's
   `createSourceGeneratorFunction` already follows the spec order (§2).
2. **Design: carrier start plus continuation transfer.** The outer stays the existing AOT
   `createSourceGeneratorFunction`. Its initializer selects the general carrier, calls it (the
   carrier performs FDI and returns its own hidden, suspended-start generator), then takes that
   generator's typed start continuation through one new AOT-only runtime helper. The outer then
   reads `Get(outer, "prototype")` and creates the only script-visible generator object. This
   needs no prototype mutation, new frame, record, vocabulary entry or compiler.
3. **The managed side already accepts this shape.** With the guard patched in memory, the dynamic
   generator lowering emits `createSourceGeneratorFunction` with a callback
   `($receiver, $packed, $ignoredCallee) => GeneratorContinuation`. That is exactly
   `GeneratorInitializer`. Six of eight probe bodies prepare `ok` through the real surface (§5).
4. **New shared gap found: a suspension inside `try … finally`.** This fails managed prepare with
   `profile: JIT closure without an exact surface callback class`. It fails for plain **Script**
   generators and async functions today, and for the AF dynamic async body
   `try{await 0}finally{…}` (AF §10 case 9). It is not GF-specific. GF fixtures pin it as
   `unsupported`. Its fix is a separate prerequisite (§11).
5. **Dependency.** GF needs AF0 and reuses AF2's `selectGeneral` and `callCarrier`. Both landed
   with Node gates green; their native runs are pending. GF native runs only after them. GF never
   edits the async branch or `createSourceAsyncDispatchFunction`.

## 2. Prototype read order: spec, Node and the pinned test

**Spec (ECMA-262 draft, §15.5.2 EvaluateGeneratorBody):**

1. Perform ? FunctionDeclarationInstantiation(funcObj, argList).
2. Let gen be ? OrdinaryCreateFromConstructor(funcObj, "%GeneratorPrototype%", …).
3. Set gen.[[GeneratorBrand]] to empty, and set [[GeneratorState]] to suspended-start.
4. Perform GeneratorStart(gen, FunctionBody). Return ReturnCompletion(gen).

`EvaluateAsyncGeneratorBody` (§15.6.2) has the same order. GetPrototypeFromConstructor does
`? Get(constructor, "prototype")`. If the result is not an Object, it falls back to the
intrinsic from `? GetFunctionRealm(constructor)`.

**Observability.** A generator function's own `prototype` is a non-configurable, writable data
property. A getter cannot be installed (Node: `TypeError: Cannot redefine property`). Read order is
visible in only two ways:

- a parameter initializer assigns `f.prototype`;
- a parameter initializer throws after doing that, so the read is never reached.

**Node v24.12.0** (`/tmp/tint-gf-probe/order.mjs`). With `function* s(a=(s.prototype=P2)){}`,
`Object.getPrototypeOf(s()) === P2` is **false**. It is also false for `GeneratorFunction`
bodies and for async generators. With `a=(t.prototype=1)`, the result is the **old** object
rather than `%GeneratorPrototype%`. So V8 reads before FDI. This is a V8 deviation. Do not copy it.

**Pinned `built-ins/GeneratorFunction/proto-from-ctor-realm-prototype.js`** does not observe
order. Its body is `calls += 1;` with no parameters. It checks three things:

- the function's `[[Prototype]]` comes from the newTarget realm (B);
- `fn.prototype` inherits from realm A's `%GeneratorPrototype%`;
- `gen instanceof realmA.Object`, and `calls` becomes 1 after `next()`.

Both orders pass it. The info block cites CreateDynamicFunction steps only. A search of
`language/{statements,expressions}/{generators,async-generator}`, `built-ins/Generator*` and
`staging` found no test with a parameter initializer that mutates `prototype`.
`language/statements/generators/default-proto.js` only checks the `null` fallback.

**Resolution.** Tint reads after FDI, as the spec says. The AF doc's `gen.mjs` observation is
correct about Node and is not evidence against the spec. Tint already does this:
`createSourceGeneratorFunction` (`js-runtime/src/objects/generators.ts:71-104`) calls
`initialize(…)` and only then `constructorPrototype(identity.value, "generator", …)`. GF keeps
that order unchanged for dynamic bodies. Fixtures and tests use the **spec** expectation and
record Node's divergence explicitly.

## 3. Live state (`9005cc1…`)

| Piece                           | Location                                      | State                                                                                     |
| ------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Lowering entry                  | `js-engine/src/lowering/index.ts:4537-4550`   | `fn.generator` → UNSUPPORTED; calls `callable(…, {packed, async: fn.async, codeStrict})`  |
| Packed prologue                 | `:1159-1251`                                  | `$callee = packed[0]`, `$newTarget = packed[1]`, rest copied                              |
| `new.target`                    | `:1252-1255`                                  | `generator ? undefined`                                                                   |
| Callback params                 | `:1742-1787`                                  | Generators get no newTarget param, so `(receiver, $packed, $ignoredCallee)`               |
| Carrier wrapper                 | `:1801-1830`                                  | `createSourceGeneratorFunction(cb, $errors, hooks, name, 0, undefined)`                   |
| Continuation                    | `:1675-1712`                                  | AF0 transfer record, then `runGeneratorSteps`                                             |
| Suspending finally              | `lowering/generators.ts:453-484`              | Binds `cleanup: (pending: GeneratorStep) => GeneratorStep`                                |
| Outer generator                 | `js-engine/src/dynamic-function.ts:466-490`   | `!simple` → reject; profile continuation compiles at **first `next`**                     |
| `ensureGeneral`                 | `:234-244`                                    | Admits `normal` and `async` only                                                          |
| `selectGeneral` / `callCarrier` | `:392-401`, `:245-257`                        | AF2 (landed), shared                                                                      |
| Runtime factory                 | `js-runtime/src/objects/generators.ts:71-104` | Initializer, then prototype read, then `createGeneratorObject`                            |
| Generator object                | `:108-138`                                    | Captures `activeContext.scriptOrModule` at creation; resumes under `runScriptContext`     |
| Record                          | `iterators/generator.ts:36-104`               | `{state, continuation}`. `return`/`throw` at suspended-start never enter the continuation |
| Slot type                       | `objects/operations.ts:116`                   | `internalGeneratorData: GeneratorRecord<Value> \| undefined`                              |

## 4. Design

### 4.1 Why continuation transfer, not prototype reparent

The carrier is a hidden JIT `createSourceGeneratorFunction` object. Its `internalCall` returns
`unknown`. The AOT side cannot obtain a typed `GeneratorContinuation` from `unknown` without a
cast or a widened ABI. It **can** view the result as an ordinary object
(`viewObjectValue`) and read its typed `internalGeneratorData` slot. That slot is the only typed
channel needed, and the slot already exists.

A reparent design would `setPrototype` the carrier's generator. It would also need a new outer
dispatch factory, because `createSourceGeneratorFunction` always allocates the visible object. The
transfer design keeps the outer factory unchanged and adds only a narrow helper. I recommend
transfer.

### 4.2 New runtime helper (GF2)

Put it in `js-runtime/src/objects/generators.ts` and re-export it from `objects/index.ts` beside
`createGeneratorObject`. It is **not** added to `scriptRuntimeImports`, so the census stays at
128/183/166/41.

```ts
/** CreateDynamicFunction generator bodies only. A hidden carrier call has already
 * run FunctionDeclarationInstantiation and returned its own suspended-start
 * generator, which no script can reach. Transfer its start continuation (already
 * bound to the call's realm and Script identity) and retire the carrier record so it
 * retains no frame. Anything else is a host invariant failure. */
export function takeGeneratorStart(
  value: unknown,
  realm: ErrorRealm,
): GeneratorContinuation;
```

The steps are:

1. `object = viewObjectValue(value, realm.objectPrototype)`.
2. `record = object?.internalGeneratorData`.
3. Require `record.state === "suspended-start"` and `continuation !== undefined`. Otherwise throw
   `"DYNAMIC_GENERATOR_CARRIER_INVARIANT"`.
4. Set `record.state = "completed"` and `record.continuation = undefined`. Return the continuation.

The return type is identical to `GeneratorRecord<unknown>["continuation"]` minus `undefined`.
There is no assertion.

### 4.3 Lowering (GF1)

Edit `lowering/index.ts:4544-4550`:

```ts
if (fn.kind !== "function-expression" || (fn.async && fn.generator))
  return fail(
    fn,
    "dynamic body requires an ordinary, async or generator function",
  );
const carrier = callable(fn.parameters, fn.body, false, fn, {
  packed: true,
  generator: fn.generator,
  async: fn.async,
  codeStrict: fn.strict ?? false,
});
```

Update the doc comment at `:132` to say "ordinary, async or generator". Nothing else in
`callable()` changes. Async generators stay rejected.

### 4.4 Outer dispatch (GF2, `dynamic-function.ts`)

1. `ensureGeneral`: admit `kind === "generator"` as well. Async-generator stays rejected.
2. Replace the generator initializer (`:466-490`) with:

   ```ts
   (receiver, args, callee): GeneratorContinuation => {
     const carrier = selectGeneral(args);
     if (carrier !== undefined)
       return takeGeneratorStart(
         callCarrier(carrier, receiver, args, callee, undefined),
         realm,
       );
     const boundReceiver = bindReceiver(receiver);
     return; /* existing profile continuation, unchanged */
   };
   ```

   The receiver is passed **unbound**. The carrier's lowering performs `sloppyCallReceiver` with
   the constructor realm's `$global.thisValue`.

3. Keep `createSourceGeneratorFunction(…, realm, hooks, "anonymous", length)` and the trailing
   `setPrototype`/`retainFunctionSource` unchanged.

**Behavior change (intentional).** `selectGeneral` runs `ensureCompiled()` at **call** time.
Today the profile compiles at the first `next()`. FDI must run at call, so the choice of profile
or general must also happen at call. This matches the normal and async kinds. Compilation itself
is not observable. Only the timing of sticky unsupported for hosts without `general` moves, from
the first `next` to the call.

### 4.5 Semantics walkthrough (one call `F(…args)`)

| Step | Who                    | Effect                                                                                                                                                                                              |
| ---- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `callObject`           | Pushes F's `internalExecutionContext`: constructor realm plus the construction-time Script identity (`createSourceExecutionContext` at F's creation)                                                |
| 2    | Outer initializer      | `selectGeneral`. First call compiles lazily under the identity captured at construction (`dynamic-function.ts:198-199`)                                                                             |
| 3    | Carrier `internalCall` | No push. The packed prologue gives `callee = F` and `newTarget = undefined`                                                                                                                         |
| 4    | Carrier callback       | FDI: `this` binding, mapped/unmapped `arguments` with `callee = F`, formals and initializers, hoisting. A throw propagates **synchronously** to F's caller, before step 6                           |
| 5    | Carrier factory        | Reads the hidden carrier's own data `prototype` (unobservable) and creates G0. G0 captures context {constructor realm, active identity = step 1's}                                                  |
| 6    | Outer factory          | `takeGeneratorStart(G0)` retires G0, then `constructorPrototype(F, "generator")` performs `Get(F,"prototype")`, **after FDI**                                                                       |
| 7    | Outer factory          | `createGeneratorObject(cont, realm, proto)`: the only visible generator, `suspended-start`                                                                                                          |
| —    | `next/return/throw`    | `resumeGenerator` on the outer record. `return`/`throw` before the first `next` complete without entering the body. Reentrancy is rejected by the outer record. G0's state is never consulted again |

Each resume runs `runScriptContext` twice with equal contexts (outer, then G0's wrapper). That is
a save/restore of `activeContext` (`jobs.ts:59-71`). It changes nothing observable.

## 5. Managed representation evidence (real surface)

Probe: `prepareManagedSurfaceEntry({...createManagedScriptFixture(), module, entry:"execute"})`.
The lowering came from dist, with the §4.3 guard and `generator: fn.generator` patched in memory.

| Dynamic `generator` body                                                                            | Result      | Code / counts                                    |
| --------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------ |
| `yield 1; return 2`                                                                                 | ok          | 60,720 B; sig 19, rec 14                         |
| `("a","a")` `yield this; yield new.target; yield arguments[0]`                                      | ok          | 108,552 B; sig 26, rec 21                        |
| `("a=(f.prototype=P2)")` `yield a`                                                                  | ok          | 103,216 B; sig 25, rec 19                        |
| nested `function*` + `yield*` + `async()=>1`                                                        | ok          | 126,488 B; sig 28, rec 17                        |
| `yield eval('1')`                                                                                   | ok          | 94,608 B (direct eval stays blocked at run time) |
| `("...rest")` `yield* rest`; `("a=1")` `var x=yield a; return arguments.length`                     | ok          | sig 25 / 26                                      |
| `("{x}","[y]=[2]")` `for(let i…) yield x+y+i`; strict `yield this`; `try{yield 1}catch(e){yield e}` | ok          | sig 36 / 16 / 23                                 |
| `try{yield 1}finally{}` (with or without `yield` in finally)                                        | **profile** | no exact surface callback class                  |
| Control: normal `("a=1")` `return a`                                                                | ok          | 57,824 B (same as AF §4)                         |

Unpatched dist: Script `function* g(){try{yield 1}finally{}}` and
`async function h(){try{await 1}finally{}}` fail the same way. Dynamic async
`try{await 0}finally{…}` (AF1 in dist) fails too. Shape check: the carrier is exactly one
`createSourceGeneratorFunction` call. Its callback is
`($receiver: unknown, $packed: array, $ignoredCallee: unknown) -> GeneratorContinuation`, with
length literal 0. It uses `sloppyCallReceiver`, `instantiateScriptArguments`,
`instantiateFunctionBody` and `runGeneratorSteps`. No new vocabulary was needed. Each prepare took
about 0.8 s in Node. That is not a performance claim.

## 6. Red tests (each fails before its slice)

**GF1. `packages/js-engine/test/dynamic-function-lowering.test.ts`**

1. `GeneratorFunction("a=1","...r","yield a")` lowers to `execute` with exactly one
   `createSourceGeneratorFunction` at entry depth. It has a length literal of 0 and three
   callback parameters, the last two being `$packed…` and `$ignoredCallee…`. The return type is
   `GeneratorContinuation`. There is no `createSourceFunction` or
   `createSourceAsyncContinuationFunction` carrier, no `instantiateGlobalDeclarations` /
   `instantiateEvalDeclarations`, and no `anonymous` binding.
2. The continuation arrow uses the AF0 transfer shape (`runGeneratorSteps` over
   `{kind:"transfer",…}`).
3. Imports are a subset of `scriptRuntimeSurface()`. No new name appears.
4. Change "rejects non-ordinary bodies explicitly" to use `async-generator` (`yield 1`), still
   UNSUPPORTED.
5. Byte stability: the ordinary, async and Script corpus outputs are deep-equal to the pre-GF1
   output.

**GF1. `tools/managed-dynamic-function.test.ts`:** add "general generator dynamic bodies retain
exact managed callback contracts". Use the §5 `ok` rows, which must prepare `ok`. Add one case that
**pins the gap**: `try{yield 1}finally{}` must fail with `stage: "profile"`. Flip it when §11 lands.

**GF2. `packages/js-runtime/test/ordinary-object-generators.test.ts`**

1. `takeGeneratorStart` returns the identical continuation passed to `createGeneratorObject`'s
   record wrapper. After the call, G0's record is `completed` with `continuation === undefined`.
2. It throws `"DYNAMIC_GENERATOR_CARRIER_INVARIANT"` in each of these cases:
   - a primitive;
   - a plain object;
   - a generator after its first `next`;
   - a second take.
3. Order guard (may already pass; keep as a pin): an initializer that sets `callee.prototype = P2`
   yields an object whose prototype is `P2`. An initializer that sets it to `1` gets the
   function-realm `%GeneratorPrototype%`.

**GF2. `packages/js-engine/test/dynamic-function.test.ts`.** These use Node fakes. `general`
returns a carrier built with `runtime.createSourceGeneratorFunction` and a hand-written
initializer that records `(receiver, packed)` and returns a two-yield continuation.

1. `generator("a=1","yield a")` constructed under identity A and called twice under B: one service
   compile, zero at construction, `seen[0].identity === A`. Two distinct outer generators, neither
   of which is the carrier's G0.
2. Packing: `packed[0] === fn`, `packed[1] === undefined`, receiver unbound.
3. FDI timing: the carrier initializer runs during `fn()`, before any `next`, and its throw
   propagates synchronously. One that sets `fn.prototype = P2` yields a generator with proto `P2`.
4. `return(5)`/`throw(3)` before the first `next` → `{value:5,done:true}` / throws 3. The fake
   continuation is never entered, and a later `next()` → `{done:true}`.
5. After a `yield`, the continuation sees `activeContext.scriptOrModule === A` and the
   constructor realm, even when resumed under B.
6. Profile priority: `generator("")` and `generator("return 1")` use zero service compiles.
7. Without `general`, `generator("yield 1")()` is sticky unsupported **at the call**. This new
   timing is asserted.
8. Adapt "simple fast paths and generators stay separate" (`:253`). The `generator` `a=1` case
   now calls `general` once. Add `async-generator` `a=1`, which still rejects with zero `general`
   calls.

**Census.** `tools/script-runtime-surface.test.ts` and `runtime-surface.test.ts` stay at
128/183/166/41 with **no re-pin**.

## 7. Source edits and public contracts

| Slice | File                                                       | Change                                                                            |
| ----- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| GF1   | `js-engine/src/lowering/index.ts`                          | §4.3 guard and option; `:132` comment                                             |
| GF2   | `js-runtime/src/objects/generators.ts`, `objects/index.ts` | `takeGeneratorStart` (§4.2), AOT-only export                                      |
| GF2   | `js-engine/src/dynamic-function.ts`                        | `ensureGeneral` admits `generator`; §4.4 initializer; import `takeGeneratorStart` |
| —     | `rt-eval.md` S6, `rt-eval-generator-function-fallback.md`  | Status line updates only                                                          |

Do **not** change any of these:

- `managed-jit-signatures.ts`, E4a flows, `classOf`;
- `iterators/*`, `createSourceGeneratorFunction`, `createGeneratorObject`;
- `scriptRuntimeImports`, `script-evaluation.ts`, `tools/test262-native.ts`;
- the async or async-generator branches.

Each slice is one commit. Run `pnpm build`, then the focused `node --test` files, then
`pnpm check`. Check every exit status.

## 8. Native fixture (main's serial lane)

Run it after the AF0 native gates and AF2's native run, and never alongside a self-build. Add a
new `tools/verify-test262-native-generator-function-fallback.ts`, modeled on
`verify-test262-native-function-fallback.ts`. Use `functionFallback` and `indirectEval` hosts,
build with `TINT_BUILD_ONLY=1`, and run serially under LLDB. Assert stopped-at-entry and the final
exit state. Record per-case code bytes and the arena total in
`native-generator-function-fallback-v1.json`. The cases are synchronous. Expected values are from
the Node reference (`cases.mjs`) unless marked **spec**.

1. `GF("x","y","yield x + y;")(2,3)`: `next()` → `{value:5,done:false}`, then `{done:true}`.
2. `GF("a=1","...rest","var x = yield a; yield* rest; return x + arguments.length")(undefined,7,8)`
   → 1, then `next(10)` → 7, 8, then `{value:13,done:true}`.
3. Mapped: `GF("a","arguments[0]=2; yield a; a=3; yield arguments[0]")(1)` → 2, 3. Strict
   variant `yield a` → 1.
4. `GF("a","a","yield a")(1,2)` → 2. `GF("a","b=1","").length === 1`.
5. `GF("yield arguments.callee === F; yield new.target")` → `true`, `undefined`.
6. `GF("a=(()=>{throw 7})()","")()` throws 7 **synchronously**.
7. Before start: `return(5)` → `{value:5,done:true}`, then `next()` → `{done:true}`. `throw(3)`
   throws 3, then `{done:true}`. After start, `return(9)` → `{value:9,done:true}`.
8. `GF("throw 8")()` does not throw. The first `next()` throws 8, then `{done:true}`.
9. `new F()` → TypeError. The result's prototype is `F.prototype`. `F.prototype` inherits
   `%GeneratorPrototype%`. With `F.prototype = 1`, the intrinsic is used.
10. **Spec order:** `var F = GF("a=(F.prototype=P2)","yield a")`. Then
    `Object.getPrototypeOf(F()) === P2` is **true**. Node prints `false`. Record this case as a
    reviewed Node divergence, never as a Node-match failure.
11. Cross-realm: `other.GeneratorFunction("yield this; yield new TypeError('t')")`. It yields
    `other` (global `this`), then an `other.TypeError`. The generator is `instanceof
other.Object`.
12. `this`: strict `.call(5)` → 5. Sloppy `.call(1)` → `typeof` `"object"`, boxed with the
    function realm's `Number.prototype`.
13. `try{yield i++}catch(e){yield 'caught '+e}` loop: `throw('x')` → `{value:'caught x'}`, then
    `next()` → `{value:1}`.
14. Lazy: an uncalled `GF("try{yield 1}finally{}")` leaves the realm supported. Calling it →
    expected `unsupported` (§11 gap) at the **call**.
15. `GF("yield eval('1')")()`: the call succeeds. The first `next` gives sticky `unsupported`,
    because direct eval in dynamic bodies is unwired.
16. A closure created after a `yield` survives 32 MiB of churn between resumes.
17. Profile: `GF()().next()` → `{done:true}`, with zero service compiles.

Resources stay at heap 256 MiB, stack 16 MiB, 300,000 ms, a 256 KiB per-entry cap and a 4 MiB
arena. The largest probe body is about 126 KB. **No tuning is proposed.**

## 9. Test262 acceptance (pinned `91c7075…`; no forecast)

The stale v4 report covers `built-ins/GeneratorFunction`: 23 files, 46 variants. Group the non-pass
variants by what they wait on. Run every listed directory **unchanged** and store each run in a new
immutable report.

**Owned, dependent on GF (calls a constructed general body):**

- `invoked-as-function-multiple-arguments.js` ×2 (`yield x + y`);
- `invoked-as-function-single-argument.js` ×2 (`yield 1`).

**Owned, dependent on AF0 only (any managed suspension), not GF:**

- `is-a-constructor.js` ×2, through `wellKnownIntrinsicObjects.js`. In v4, sloppy was a pre-entry
  LLDB crash (infrastructure) and strict was unsupported.
- `proto-from-ctor-realm.js` ×2, through `other.eval('(0, function* () {})')`.

**Owned, dependent on both AF0 and GF:**

- `proto-from-ctor-realm-prototype.js` ×2. Its `realmA.eval("(function* () {})")` needs AF0. Its
  body `calls += 1;` (compound global write, no profile) needs GF.

**Owned, construction-only (unaffected):** the remaining 18 files. No owned file observes the §2
read order.

**Dependent elsewhere (signals only):**

- `staging/sm/generators/iteration.js`: `GeneratorFunction('x','y','yield x + y;')(1,2)`.
- `staging/sm/generators/runtime.js`: construction and `toString` only.
- `built-ins/Function/prototype/toString/GeneratorFunction.js`: construction only.
- Any test whose generator body contains `finally` around a `yield` stays blocked by §11 whatever
  GF does.

**Reruns after GF2 native:** a frozen self-build, then complete `built-ins/GeneratorFunction`,
`built-ins/Function` and `staging/sm/generators`. After that, regression reruns of
`language/{statements,expressions}/generators`. Older reports stay untouched. The dashboard updates
only after complete selection reruns.

## 10. Phases of errors (generator kind)

| Phase        | Condition                                                  | Result                                              |
| ------------ | ---------------------------------------------------------- | --------------------------------------------------- |
| Construction | ToString, parse, early error, newTarget `prototype` getter | Unchanged (eager; SyntaxError in constructor realm) |
| Call         | Lowering, compile, publish or completion view fails        | Sticky unsupported, thrown synchronously            |
| Call         | Parameter initializer throws                               | Thrown synchronously; `F.prototype` is not read     |
| First `next` | Body throws                                                | Thrown from `next`; the generator is completed      |
| Never called | Any body                                                   | No lowering, compile or publication                 |

## 11. Shared gap: suspension inside `try … finally` (separate prerequisite, not GF)

`lowering/generators.ts:466-484` binds `cleanup` as an arrow of type
`(pending: GeneratorStep) => GeneratorStep`. That function type maps to no surface callback
class, so the managed gate rejects it. That is correct fail-closed behavior and must not be
relaxed. The gap affects:

- Scripts, indirect eval and dynamic bodies of every suspending kind;
- AF §10 case 9 ("`finally` runs after an await"), which should expect `unsupported` until the gap
  is fixed.

Plan it as its own slice, "MS-F". The likely shape keeps the pending step as data: pass it through
an existing transfer record, or bind the finalizer as a `GeneratorStep` closed over a `let` slot.
Either way the JIT never creates a step-to-step closure. Verify the chosen shape the same way as §5
before committing. The fix may touch `generators.ts` only, with no new class.

## 12. Hazards, non-goals and next recommendation

- Do not relax, special-case or name-match the variance or flow gates. Do not add an assertion, an
  `unknown`-to-callable view, a frame field, a record slot or a second compiler.
- Do not copy V8's read-before-FDI order. Do not read `prototype` in the outer before the carrier
  call.
- Do not expose G0. Do not reuse a carrier generator. Do not re-read `scriptOrModule` at call time.
  Do not add a source-keyed cache.
- No performance, timing or pass-rate claims.

**Next: async-generator constructors ("AGF").** The same transfer applies, with three differences.

- **Typed slot.** The typed slot is `internalAsyncGeneratorData = {record, hooks, context}`
  (`objects/async-generators.ts:142`). The record owns a **request queue**. A
  `takeAsyncGeneratorStart` must require an empty queue and state `suspended-start`. It must
  return the start continuation **and** keep the outer's own queue and promise realm.
- **Lowering.** Lowering admits `async && generator` with
  `{generator: true, async: true}`. Prove with the §5 method that
  `createSourceAsyncGeneratorFunction`'s callback is exactly `AsyncGeneratorInitializer` and
  prepares `ok`.
- **Spec order to pin.** EvaluateAsyncGeneratorBody also reads `prototype` after FDI. Parameter
  errors throw synchronously; they are not rejections. The first `next()` request is enqueued on
  the outer. Then pin AsyncGeneratorStart/`AsyncGeneratorDrainQueue` ordering against a Node
  trace, and read the 8 owned AsyncGeneratorFunction files that call bodies before planning.

Do AGF after GF2 and MS-F, so `finally` in async-generator bodies does not obscure its gates.

Implementation note: the separate MS-F cleanup gap is now fixed in the main
workspace using a named local factory admitted by the existing direct-call proof.
All 4,124 workspace tests pass; native acceptance remains queued. See the
[finally checkpoint](../results/managed-finally-node-checkpoint-v1.json).

Implementation checkpoint: GF1/GF2 pass all 4,128 workspace tests in
[the Node checkpoint](../results/generator-function-node-checkpoint-v1.json)
and all 17 [native feature cases](../results/generator-function-native-checkpoint-v1.json).
The unchanged constructor-group rerun is queued separately; no complete-family
conformance gain is claimed before it finishes. The private-binder compiler fixed
point passed, and the execution-only source changes leave the standalone compiler
graph unchanged.
