# RT-EVAL S6-agf: general `AsyncGeneratorFunction` constructor body fallback

Implementation status: **research plan only. Nothing here is implemented.**

Parent: [rt-eval.md](rt-eval.md) §7 S6. Siblings:
[rt-eval-async-function-fallback.md](rt-eval-async-function-fallback.md) (AF0–AF2) and
[rt-eval-generator-function-fallback.md](rt-eval-generator-function-fallback.md) (GF1/GF2).
Scope is `kind === "async-generator"` only. This is the last S6 constructor kind.

**Capture.** 2026-11-05, 08:00–08:25. Baseline is the green source identity `5c5932b…` (552
files, 4,124 workspace tests, [finally checkpoint](../results/managed-finally-node-checkpoint-v1.json)).
That baseline has AF0/AF1/AF2 and the MS-F named cleanup factory. During capture, main began GF in the
working tree. At 08:24 `lowering/index.ts`, `dynamic-function.ts`, `objects/{generators,index}.ts`
and `tools/managed-dynamic-function.test.ts` had uncommitted, unformatted, **unvalidated** GF edits.
Line numbers below refer to the 07:40 tree, unless a line is marked "GF tree".

**Not established. Do not cite any of these as passing.**

- AF0 (119 cases) and AF2/finalizer (156 cases) native runs are queued. GF has no Node gate yet.
- The only `built-ins/AsyncGeneratorFunction` report
  ([v4](../results/test262-async-generator-function-family-native-v4.json)) is **stale**. It used
  adapter `native-script-v4-shared-image`, snapshot `e953d4a…` (449 files) and was written
  2026-11-03. It predates FN\*, DE\*, AF\*, MS-F and GF. Its result is 36 pass, 9 unsupported and
  1 pre-entry LLDB crash out of 46.

**Method.** I read the live source, the ECMA-262 multipage draft (fetched today into
`/tmp/tint-agf-spec`) and the pinned Test262 files (`91c7075…`). Node v24.12.0 probes ran in
`/tmp/tint-agf-probe` against the workspace `dist` (lowering 07:40, generators 07:58). One in-memory
module load hook patched the dist lowering guard to admit all kinds and pass `generator:
fn.generator`. I patched no file on disk. I ran no build, emission, executable write, native process,
queue action or agent. I edited only this file and one S6 cross-link in `rt-eval.md`.

## 1. Answer in brief

1. **Order: follow the spec, not V8.** `EvaluateAsyncGeneratorBody` runs
   FunctionDeclarationInstantiation first, then `OrdinaryCreateFromConstructor(funcObj,
"%AsyncGeneratorPrototype%")`, which reads `prototype`. A parameter error is a **synchronous
   throw**, not a rejection: steps 1 and 2 use `?`, and no promise exists yet. Node reads
   `prototype` before FDI, as it does for generators. Tint's `createSourceAsyncGeneratorFunction`
   (`objects/async-generators.ts:50-58`) already follows the spec order.
2. **Same transfer as GF, with one async-specific helper.** The outer stays the existing AOT
   `createSourceAsyncGeneratorFunction`. Its initializer selects the carrier and calls it. FDI runs,
   and the carrier returns a hidden suspended-start async generator G0. The new AOT-only
   `takeAsyncGeneratorStart` then takes G0's start continuation from the **typed**
   `internalAsyncGeneratorData` slot. It requires an empty request queue and an idle pump. The
   outer then reads `prototype` and creates the only visible async generator, which has its own
   queue.
3. **Callback arity differs from async functions. This was proved on the real surface.** The
   async-generator carrier's callback has **three** parameters:
   `($receiver: unknown, $packed: array, $ignoredCallee: unknown) -> AsyncGeneratorContinuation`.
   The callback for ordinary async bodies has four (`…, $ignoredTarget`).
   `callable()` drops the newTarget parameter whenever `generator` is set
   (`lowering/index.ts:1780-1787`). That matches `createSourceAsyncGeneratorFunction`'s
   `initialize` type exactly. All 18 probe bodies prepare `ok`, including `finally` (§4).
4. **`finally` is supported.** The MS-F named local cleanup helper covers async-generator bodies:
   `try{yield 1}finally{…}` and `try{await 1;yield 2}finally{yield 3}` prepare `ok`. Do not mark
   `finally` unsupported in fixtures or tests.
5. **Dependency: GF2 green first.** AGF reuses GF's guard and option edit, the `ensureGeneral`
   kind check, call-time `selectGeneral` and the take pattern. AGF adds one helper and replaces one
   initializer. It needs no new frame, record, vocabulary entry, cast, gate change or compiler
   mechanism.

## 2. Specification (ECMA-262 draft, fetched 2026-11-05)

**§15.6.2 EvaluateAsyncGeneratorBody:**

1. ? FunctionDeclarationInstantiation(funcObj, argList).
2. Let gen be ? OrdinaryCreateFromConstructor(funcObj, "%AsyncGeneratorPrototype%", …).
3. Set the brand to empty and the state to suspended-start.
4. AsyncGeneratorStart(gen, FunctionBody). Return ReturnCompletion(gen).

GetPrototypeFromConstructor does `? Get(F, "prototype")`. If the result is not an Object, it falls
back to `GetFunctionRealm(F)`'s intrinsic. AsyncGeneratorStart only records the body. Nothing runs
until a request resumes the generator.

**§27.9.1.2–4 next/return/throw.** Each method creates `NewPromiseCapability(%Promise%)` from the
**current realm**, which is the method's realm. AsyncGeneratorValidate failure rejects that promise.

- `next`: completed → resolve `{undefined, true}`. Otherwise enqueue; at suspended-start or
  suspended-yield, AsyncGeneratorResume runs the body **synchronously** inside the `next` call.
- `return`: enqueue. At suspended-start or completed, set draining-queue and run
  AsyncGeneratorAwaitReturn (`PromiseResolve` + `PerformPromiseThen`, so settlement takes jobs).
  At suspended-yield, resume the body with a return completion.
- `throw` at suspended-start sets completed and rejects immediately; the body is never entered.
- In the executing and draining-queue states, every method only enqueues.

**§27.9.3 queue.** AsyncGeneratorCompleteStep settles the head request. AsyncGeneratorDrainQueue
settles queued requests in FIFO order until a `return` request, which it awaits. Await inside the
body uses `%Promise%` of the running generator context's realm. That is the function realm.

**Tint mapping (unchanged by AGF).** `enqueueAsyncGenerator` (`iterators/async-generator.ts:242-269`)
closes suspended-start on `return`/`throw`; `drainAsyncGenerator` (`:174-239`) is one iterative FIFO
pump; `awaitValue` (`objects/async-generators.ts:112-140`) awaits in the generator context while
executing, else the caller's; method promises use the installing realm's `promisePrototype` (`:207`).

## 3. Node reference and divergences (`/tmp/tint-agf-probe/node-ref.mjs`, `trace.mjs`)

| Observation                                                                                          | Node v24.12.0                                                          | Spec / Tint expectation  |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------ |
| `var F=AGF("a=(F.prototype=P2)","yield a")`; `getPrototypeOf(F())===P2`                              | **false** (reads before FDI)                                           | **true**. Divergence: V8 |
| `a=(G.prototype=1)`                                                                                  | old prototype object                                                   | function-realm intrinsic |
| `AGF("a=(()=>{throw 7})()","yield 1")()`                                                             | throws 7 synchronously                                                 | same                     |
| `AGF("throw 8")()`                                                                                   | call ok; `next()` rejects 8                                            | same                     |
| Pre-start `throw(3)`, then `next()`                                                                  | rejects 3; `{done:true}`; body not entered                             | same                     |
| Pre-start `return(5)`; `return(Promise.resolve(6))`                                                  | `{5,true}`, `{6,true}`, settling after `throw`'s rejection             | same (AwaitReturn ticks) |
| Queued `next,next,return,next` on `log b0; x=yield await a; log b1; y=yield x+1; log b2; return 'r'` | `b0,sync,t1,b1 X,t2,p1 1 false,t3,p2 X1 false,t4,p3 R true,p4 true,t5` | same; dynamic == source  |
| `new F()`; `AGF("a","b=1","").length`; own `prototype`                                               | TypeError; 1; yes                                                      | same                     |
| `try{yield Promise.resolve(4)}finally{log('fin')}`; `return(9)`                                      | `{4,false}`; `fin`; `{9,true}`                                         | same                     |
| `try{yield 1}finally{yield 3}`, `return(9)` after start                                              | `{3,false}`, then `{9,true}`                                           | same                     |

The queued trace is identical for an `AsyncGeneratorFunction` body and the equivalent source
`async function*` (`trace.mjs` prints `dynamic === source`). Native fixtures compare **both**
forms inside the same Tint image as well as against the Node log. The read-order row is recorded as a
reviewed Node divergence, never as a Node-match failure. No pinned Test262 file observes it (§8).

## 4. Managed representation evidence (real surface)

Probe: `prepareManagedSurfaceEntry({...createManagedScriptFixture(), module, entry:"execute"})`, run
with the working directory set to the workspace. Lowering is from dist with the guard patched in
memory.

**Shape** (`shape.ts`). The async-generator carrier is exactly one
`createSourceAsyncGeneratorFunction` call with length literal 0. Its callback is
`($receiver:unknown, $packed:array, $ignoredCallee:unknown) -> AsyncGeneratorContinuation`. The body
uses `sloppyCallReceiver`, `instantiateScriptArguments`, `instantiateFunctionBody` and
`runAsyncGeneratorSteps` over the AF0 transfer record.

The same probe shows async with four parameters returning `GeneratorContinuation`, and generator
with three returning `GeneratorContinuation`. The lowered body never references the generator
object. Its runtime calls are only Script, iterator and step helpers (`ids.ts`).

| Dynamic `async-generator` body                                                          | Result | Code bytes / signatures                        |
| --------------------------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| `yield 1; return 2`                                                                     | ok     | 62,800 / 18                                    |
| `("a","b")` `yield await a; yield b`                                                    | ok     | 88,976 / 22                                    |
| `("a","a")` `yield this; yield new.target; yield arguments[0]`                          | ok     | 109,704 / 25                                   |
| `("a=(f.prototype=P2)")` `yield a`                                                      | ok     | 102,464 / 24                                   |
| `("...rest")` `yield* rest`                                                             | ok     | 78,952 / 25                                    |
| `("a=1")` `var x = yield a; return arguments.length + x`                                | ok     | 110,840 / 26                                   |
| `("{x}","[y]=[2]")` `for(let i…) yield x+y+i`                                           | ok     | 176,072 / 35                                   |
| strict `yield this`; `return await 7`; `calls += 1;`; `("x","y")` `yield x + y;`        | ok     | 52,960–86,984                                  |
| `try{yield 1}catch(e){yield e}`; `try{yield await Promise.reject(9)}catch(e){return e}` | ok     | 105,280 / 131,432                              |
| `try{yield 1}finally{log.push('f')}`                                                    | **ok** | 125,272 / 23                                   |
| `try{await 1;yield 2}finally{yield 3}`                                                  | **ok** | 113,240 / 18                                   |
| nested `function*`, `async function*`, `yield*` of both, `async()=>1`                   | ok     | 203,584 / 33                                   |
| `yield eval('1')`                                                                       | ok     | 88,560 (direct eval stays blocked at run time) |
| `for await (const v of [1, Promise.resolve(2)]) yield v`                                | ok     | **244,064** / 33                               |
| Controls: generator `a=1`, async `a=1`, normal `a=1`                                    | ok     | 74,664 / 68,456 / 57,824                       |

Each prepare took about 0.5–0.6 s in Node. That is not a performance claim. The `for await` row is
93% of the 262,144-byte per-entry cap. An exhausted entry stays `publish` → unsupported. **No
tuning is proposed.**

## 5. Design

### 5.1 Dependencies: present vs planned

| API / edit                                                                            | State at capture                                                                                        |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `selectGeneral`, `callCarrier` (`dynamic-function.ts:392-403, 245-257`)               | **Present** (AF2, green)                                                                                |
| `createSourceAsyncGeneratorFunction`, `createAsyncGeneratorObject`                    | **Present**, unchanged                                                                                  |
| Typed `internalAsyncGeneratorData {record, hooks, context}` (`operations.ts:123-129`) | **Present**                                                                                             |
| `viewObjectValue`, `enqueueAsyncGenerator`, `createAsyncReturnContinuation`           | **Present**                                                                                             |
| MS-F named cleanup factory (`lowering/generators.ts:456-491`)                         | **Present** (green)                                                                                     |
| GF1 guard `(fn.async && fn.generator)` and option `generator: fn.generator`           | **Planned dependency**. In the GF tree at `lowering/index.ts:4544-4551`, unvalidated                    |
| GF2 `ensureGeneral` admits `generator`; `takeGeneratorStart`                          | **Planned dependency**. In the GF tree at `dynamic-function.ts:239` and `generators.ts:72`, unvalidated |
| `takeAsyncGeneratorStart`                                                             | **New (AGF2)**                                                                                          |

Begin AGF only after GF1/GF2 are green in Node. If GF's final shape differs, rebase these edits
onto it; do not duplicate it.

### 5.2 Runtime helper (AGF2)

Put the helper in `js-runtime/src/objects/async-generators.ts`, beside
`createAsyncGeneratorObject`, and re-export it from `objects/index.ts` (`:271-272`). It is **not**
added to `scriptRuntimeImports`.

```ts
/** CreateDynamicFunction async-generator bodies only. A hidden carrier call has
 * run FunctionDeclarationInstantiation and returned its own unstarted generator,
 * which no script can reach. Take its start continuation (already bound to the
 * call's realm and Script identity) and retire the carrier so it retains no frame.
 * The caller's generator owns every request queue and promise. */
export function takeAsyncGeneratorStart(
  value: unknown,
  realm: ErrorRealm,
): AsyncGeneratorContinuation<unknown>;
```

The steps are:

1. `slot = viewObjectValue(value, realm.objectPrototype)?.internalAsyncGeneratorData`.
2. `record = slot?.record`. Require all of the following:
   - `state === "suspended-start"`;
   - `continuation !== undefined`;
   - `head === undefined && tail === undefined`;
   - `!running && !waiting && pending === undefined`.

   Otherwise throw `"DYNAMIC_ASYNC_GENERATOR_CARRIER_INVARIANT"`.

3. Set `record.state = "completed"` and `record.continuation = undefined`, then return the
   continuation.

All fields are typed and mutable (`AsyncGeneratorRecord`). There is no cast or assertion. The empty
queue is an invariant, not a branch, because no script ever holds G0.

G0's `hooks` and `context` are **not** transferred. The outer `createAsyncGeneratorObject` builds its
own `{record, hooks, context}`. Its `context` captures the same `{constructor realm, construction
identity}` that G0 captured: both objects are created inside the one `callObject` push of F's
`internalExecutionContext`, and the carrier's `internalCall` pushes nothing. The taken continuation
therefore runs under two equal `runScriptContext` wrappers (outer, then G0's), as in GF §4.5.

### 5.3 Lowering (AGF1)

Apply this on top of GF1 in `lowering/index.ts` (GF tree `:4544-4545`):

```ts
if (fn.kind !== "function-expression")
  return fail(fn, "dynamic body requires a function expression");
```

The `callable(…, {packed: true, generator: fn.generator, async: fn.async, codeStrict})` call from
GF1 is unchanged. Change the doc comment at `:132` to "Lower a CreateDynamicFunction body of any
kind". Nothing in `callable()` changes.

### 5.4 Outer dispatch (AGF2, `dynamic-function.ts`)

1. `ensureGeneral` (GF tree `:239`): with all four kinds admitted, simplify the predicate to
   `general === undefined`.
2. Replace the async-generator initializer (07:40 tree `:440-457`):

   ```ts
   (receiver, args, callee): AsyncGeneratorContinuation<unknown> => {
     const carrier = selectGeneral(args);
     if (carrier !== undefined)
       return takeAsyncGeneratorStart(
         callCarrier(carrier, receiver, args, callee, undefined),
         realm,
       );
     const boundReceiver = bindReceiver(receiver);
     return createAsyncReturnContinuation<unknown>(
       /* existing profile, unchanged */
     );
   };
   ```

   This drops `if (!simple) return rejectUnsupportedExecution(realm)`, because `selectGeneral`
   routes non-simple formals to the carrier. The receiver passes **unbound**. The carrier performs
   `sloppyCallReceiver` with the constructor realm's `$global.thisValue`.

3. Import `takeAsyncGeneratorStart`. Keep `createSourceAsyncGeneratorFunction(…, "anonymous",
length)`, `setPrototype` and `retainFunctionSource` unchanged.

**Profile safety.** Only `compileClosedDynamicFunction` accepts async-generator syntax. The managed
global-access and receiver-write profiles reject `fn.async || fn.generator`
(`closed-functions.ts:682, 1067`). So when `selectGeneral` returns `undefined`, `code.mode` is
`"closed"` and `code.completion` is `async-generator-direct` or `async-generator-await-return`. The
existing `DYNAMIC_ASYNC_GENERATOR_COMPLETION_INVARIANT` stays correct. Mixed-completion bodies, which
the profile already rejects, now reach the general path.

**Behavior change (intentional, as in GF).** Compilation and selection move from the first `next()`
to the call. For hosts without `general`, sticky unsupported is now **thrown synchronously from the
call**. Today it surfaces as a rejection of the first `next()`. A closed profile called with fewer
than `minimumArguments` arguments now uses the general carrier instead of being unsupported.

### 5.5 Walkthrough for one call `F(…args)`, then `next()`

| Step | Who                    | Effect                                                                                                                                           |
| ---- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `callObject`           | Pushes F's context: constructor realm and construction-time identity                                                                             |
| 2    | Outer initializer      | `selectGeneral`. The first call compiles under the identity captured at construction; `runner.run` drains no jobs                                |
| 3    | Carrier callback       | FDI with `callee = F` and `new.target = undefined`. A throw propagates **synchronously** to F's caller. No promise exists; `prototype` is unread |
| 4    | Carrier factory        | Reads the carrier's own `prototype` (unobservable) and creates G0 in suspended-start with an empty queue                                         |
| 5    | Outer                  | `takeAsyncGeneratorStart(G0)`, then `Get(F,"prototype")` **after FDI**, then `createAsyncGeneratorObject`, which creates the only queue          |
| 6    | `next()`               | Promise from the method realm; enqueue; the drain runs the body synchronously to its first `await`/`yield`                                       |
| —    | `return`/`throw` early | Pre-start `throw` rejects without entry. Pre-start `return` awaits its value. Queued requests settle FIFO through the outer record only          |

## 6. Red tests (each fails before its slice)

**AGF1. `packages/js-engine/test/dynamic-function-lowering.test.ts`**

1. `AsyncGeneratorFunction("a=1","...r","yield await a")` lowers to `execute` with exactly one
   `createSourceAsyncGeneratorFunction` at entry depth. It has length literal 0 and **three**
   callback parameters (`$receiver`, `$packed…`, `$ignoredCallee…`) with return type
   `AsyncGeneratorContinuation`. There is no `$ignoredTarget`, no `createSourceAsyncContinuationFunction`
   or `createSourceGeneratorFunction` carrier, and no `instantiateGlobalDeclarations` /
   `instantiateEvalDeclarations` call.
2. The continuation is `runAsyncGeneratorSteps` over `{kind:"transfer",…}`.
3. Imports are a subset of `scriptRuntimeSurface()`. No new name appears.
4. "rejects non-ordinary bodies explicitly" becomes "rejects non-function-expression dynamic
   bodies". Async generators are now accepted.
5. Byte stability: the normal, async, generator and Script corpus outputs deep-equal the GF output.

**AGF1. `tools/managed-dynamic-function.test.ts`:** add "general async generator bodies retain exact
managed callback contracts" over the §4 rows `("a","a")` `this`/`new.target`/`arguments`,
`("...rest")` `yield* rest`, `try{await 1;yield 2}finally{yield 3}` and `for await`, all `ok`.

**AGF2. `packages/js-runtime/test/ordinary-object-async-generators.test.ts`**

1. `takeAsyncGeneratorStart` returns the continuation that the carrier record holds. Afterwards
   G0's record is `completed`, with `continuation`, `head` and `tail` all `undefined`.
2. It throws `"DYNAMIC_ASYNC_GENERATOR_CARRIER_INVARIANT"` for a primitive, a plain object, a sync
   generator, a G0 after `next()` (request queued), a G0 after `return()`, and a second take.
3. An outer built with a taken continuation answers queued `next,next,return,next` in FIFO order.
   With `drainScriptJobs`, the log equals the §3 trace for a hand-written continuation.

**AGF2. `packages/js-engine/test/dynamic-function.test.ts`.** Use Node fakes. `general` returns a
carrier built with `runtime.createSourceAsyncGeneratorFunction` and a recording initializer.

1. `async-generator("a=1","yield a")` is constructed under identity A and called twice under B. The
   service compiles once, and construction compiles nothing. `seen[0].identity === A`. The test
   gets two distinct outer generators, neither of which is G0.
2. Packing: `packed[0] === fn`, `packed[1] === undefined`, and the receiver is unbound.
3. FDI timing: the initializer runs during `fn()`, and its throw is synchronous (no promise).
   `fn.prototype = P2` inside it gives prototype `P2`; `fn.prototype = 1` gives the function-realm
   `%AsyncGeneratorPrototype%`.
4. Pre-start `throw(3)` rejects 3 without entering the fake. Pre-start `return(5)` resolves
   `{5,true}` after jobs drain. A later `next()` resolves `{done:true}`.
5. After an `await`, the fake sees `activeContext.scriptOrModule === A` and the constructor realm
   while jobs drain under B.
6. Profile priority: `("")`, `("return 1")` and `("return")` make zero service compiles.
7. Without `general`, `async-generator("yield 1")()` is sticky unsupported, **thrown from the
   call**. Assert this new timing.
8. Adapt the GF version of "simple fast paths and generators stay separate" (`:253`). The
   `async-generator` `a=1` case now calls `general` once.

**Census.** `tools/script-runtime-surface.test.ts` and `runtime-surface.test.ts` keep their current
pins with **no re-pin**. Today that is 41 runtimes (`:376`).

## 7. Source edit list

| Slice | File                                                             | Change                                              |
| ----- | ---------------------------------------------------------------- | --------------------------------------------------- |
| AGF1  | `js-engine/src/lowering/index.ts`                                | §5.3 guard; `:132` comment                          |
| AGF2  | `js-runtime/src/objects/async-generators.ts`, `objects/index.ts` | `takeAsyncGeneratorStart` (§5.2), AOT-only export   |
| AGF2  | `js-engine/src/dynamic-function.ts`                              | `ensureGeneral` predicate; §5.4 initializer; import |
| —     | `rt-eval.md` S6, this file                                       | Status lines only                                   |

Do **not** change any of these:

- `managed-jit-signatures.ts`, E4a flows, `classOf`, `lowering/generators.ts`;
- `iterators/*`, `createSourceAsyncGeneratorFunction`, `createAsyncGeneratorObject`;
- `scriptRuntimeImports`, `script-evaluation.ts`, `tools/test262-native.ts`, resource limits.

Make each slice one commit. Run `pnpm build`, then the focused `node --test` files, then
`pnpm check`, inspecting every exit status. Format the GF tree edits before AGF starts.

## 8. Native fixture (main's serial lane, after current work)

Lane order: the queued AF0 (119) and AF2/finalizer (156) runs, then GF's native run, reusing the
pending fixed point (no redundant engine-only CLI self-build). Then add `tools/verify-test262-native-async-generator-function-fallback.ts`. Model it on the AF2
verifier, with `functionFallback` and `indirectEval` hosts and an async wrapper that prints
completion. Build with `TINT_BUILD_ONLY=1` and run serially under LLDB. Assert stopped-at-entry and
the final exit state. Record per-case code bytes and the arena total in
`native-async-generator-function-fallback-v1.json`. Expected values come from §3. **Spec** marks a
case where Tint must differ from Node.

1. `AGF("x","y","yield x + y;")(2,3)`: `{5,false}`, then `{undefined,true}`. This is the Test262
   shape.
2. `("a=1","...rest")` `var x = yield await a; yield* rest; return x + arguments.length` with
   `(undefined,7,8)`: values 1, then `next(10)` 7, 8, then `{13,true}`.
3. Mapped: `("a")` `arguments[0]=2; yield a`, with `(1)` → 2. The strict variant → 1. `("a","a")`
   with `(1,2)` → 2. `AGF("a","b=1","").length === 1`.
4. `yield arguments.callee === F; yield new.target` → `true`, `undefined`.
5. `AGF("a=(()=>{throw 7})()","")()` **throws 7 synchronously**. No promise exists.
6. `AGF("throw 8")()` returns normally. The first `next()` rejects 8, then `{done:true}`.
7. Pre-start `throw(3)` rejects 3 without entry. Pre-start `return(Promise.resolve(6))` →
   `{6,true}`, ordered after the rejection, as in Node.
8. Queued `next,next,return,next` trace. It must equal Node's log **and** the same body as a source
   `async function*` in the same image.
9. `try{yield Promise.resolve(4)}finally{log('fin')}`, then `return(9)` → `{4,false}`, `fin`,
   `{9,true}`. And `try{yield 1}finally{yield 3}`, then `return(9)` → `{3,false}`, `{9,true}`.
10. `try{yield await Promise.reject(9)}catch(e){return e}` → `{9,true}`.
11. `for await (const v of [1,Promise.resolve(2)]) yield v` → 1, 2. Record its bytes, which are
    near the cap.
12. **Spec order:** `var F=AGF("a=(F.prototype=P2)","yield a")` gives `getPrototypeOf(F())===P2`
    → **true**. Node prints `false`; record it as a reviewed divergence. `F.prototype=1` gives the
    intrinsic. `new F()` → TypeError.
13. Cross-realm: `other.AsyncGeneratorFunction("yield this; yield new TypeError('t')")`. The first
    value is `other`, then `other.TypeError`. The generator is `instanceof other.Object`, and the
    `next()` promise is `instanceof other.Promise`.
14. `this`: strict `.call(5)` → 5. Sloppy `.call(1)` boxes with the function realm's
    `Number.prototype`.
15. Lazy: an uncalled body leaves the realm supported. `AGF("yield eval('1')")()` succeeds, and
    the first `next` gives sticky `unsupported`, because direct eval in dynamic bodies is unwired.
16. A closure created after `await` survives 32 MiB of churn between requests.
17. Profiles: `AGF()().next()` and `AGF("return 1")().next()` → `{done:true}` and `{1,true}`, with
    zero service compiles.

Keep the existing `verify-test262-native-dynamic-async-generator.ts` as an unchanged profile
regression. Resources stay at heap 256 MiB, stack 16 MiB, 300,000 ms, a 256 KiB per-entry cap and a
4 MiB arena.

## 9. Test262 accounting (pinned `91c7075…`; no forecast)

`built-ins/AsyncGeneratorFunction` has 23 files and 46 variants. In the stale v4 report, 36 pass,
9 are unsupported and 1 crashed. Five owned files call a constructed body. The earlier "8" in
GF §12 and AF §11 also counted the two `instance-*-expr-in-param.js` files, which only construct.

**Owned, dependent on AGF:**

- `invoked-as-function-multiple-arguments.js` ×2 (`yield x + y;`): unsupported in v4.
- `invoked-as-function-single-argument.js` ×2 (`yield 1;`): sloppy was unsupported in v4, and
  strict was a **pre-entry LLDB crash** (INFRA-PREENTRY, not semantic).

**Owned, dependent on AGF and AF0:**

- `proto-from-ctor-realm-prototype.js` ×2. Its `realmA.eval("(async function* () {})")` needs
  AF0. Its body `calls += 1;` has no profile, so it needs AGF. It asserts `calls === 1`
  **synchronously** after `gen.next()`. §2 and the drain pump give that, with no job draining.

**Owned, dependent on AF0 only:** `is-a-constructor.js` ×2 (`wellKnownIntrinsicObjects.js`) and
`proto-from-ctor-realm.js` ×2 (`other.eval`).

**Owned, unaffected:** the 2 empty-body files already pass through the profile
(`invoked-as-{constructor,function}-no-arguments.js`), as do 16 construction-only files.

**Dependent elsewhere** (construction only; signals, not owned):
`built-ins/Object/seal/seal-asyncgeneratorfunction.js`,
`language/comments/hashbang/function-constructor.js` and
`built-ins/Function/prototype/toString/AsyncGenerator.js`. No owned file observes the §2 read order.

**Reruns after AGF2 native:** complete `built-ins/AsyncGeneratorFunction` and `built-ins/Function`.
Then run regressions over `language/{statements,expressions}/async-generator` and
`built-ins/AsyncGeneratorPrototype`, each in a new immutable report. Older reports stay
untouched. The dashboard updates only after complete selection reruns.

## 10. Phases of errors (async-generator kind)

| Phase        | Condition                                      | Result                                                 |
| ------------ | ---------------------------------------------- | ------------------------------------------------------ |
| Construction | ToString, parse, early error, newTarget getter | Unchanged (eager; SyntaxError in constructor realm)    |
| Call         | Lowering, compile, publish or view fails       | Sticky unsupported, thrown synchronously (new timing)  |
| Call         | Parameter initializer throws                   | Thrown synchronously; `F.prototype` unread             |
| `next`       | Body throws or awaits a rejection              | That request rejects; the queue drains; then completed |
| Never called | Any body                                       | No lowering, compile or publication                    |

## 11. Hazards and non-goals

- Do not relax, special-case or name-match the variance or flow gates. Add no assertion, no
  `unknown`-to-callable view, no frame field, no record slot and no second compiler.
- Do not copy V8's read-before-FDI order. Do not resolve or chain any outer promise to G0. Do not
  enqueue on G0. Do not expose or reuse G0. Do not drain jobs on compile.
- Do not re-read `scriptOrModule` at call time. Add no source-keyed cache.
- Make no performance, timing or pass-rate claims.

## 12. Next language gap (from existing evidence; no new survey)

After S6, the RT-EVAL residue is direct `eval` inside dynamic bodies, which every plan here pins as
sticky unsupported. Fold it into the S5 direct-eval follow-ups; it is not a new feature.

The next concrete **language** gap is **HOST-ESM M0–M1** ([host-esm.md](host-esm.md) §6): the
largest planned language population (638 adapter-blocked module-goal variants; 1,155 Script variants
contain `import(`), `plan ready` with M0/M1 ready now, and no RT-EVAL slice needed for M0–M5.

LANG-CORE's `with` (120/182) and `super` (67/184) unsupported clusters come from stale 2026-10-31
selections. Re-measure them only after the pending v9 rerun.

Implementation checkpoint: AGF1/AGF2 pass all 4,132 workspace tests in
[the Node checkpoint](../results/async-generator-function-node-checkpoint-v1.json)
and all 17 [native feature cases](../results/async-generator-function-native-checkpoint-v1.json).
The complete dynamic-function source graph passes Tint's checker (4,207 functions).
Unchanged constructor-group selections are queued separately; these bespoke
fixtures do not establish a complete-family Test262 rate.
