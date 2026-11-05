# RT-EVAL G1–G3: direct-eval call-site guard (before indirect string eval)

Status: **G1/G2/G3 implemented and natively validated.**
All nine [native cases](../results/native-test262-eval-guard-validation-v1.json)
produce the expected outcomes (six completed, three sticky unsupported); all 3,978
workspace tests, type checks, dependency checks and formatting pass.
Runtime spies distinguish intrinsic interception from ordinary calls. Both lowering
paths and managed compilation pass, including `eval(x)?.y`; indirect-only lowering
retains its pre-change hash. The complete vocabulary now has 120 entries (101
helpers); collection anchors increase 78→79 while collection keys/providers/targets/
slots/stubs remain 39/41/323/355/366. The native fixture also covers runtime-compiled guarded calls. This
slice keeps direct and indirect string eval unsupported.

Original research status follows.
emission or native process, and touched no queue, pause marker, journal, report, snapshot or
process. Parents: [indirect eval](rt-eval-indirect-eval.md) §5.1/§7 (IE2, IE3) and
[resource controls](rt-eval-resource-controls.md) §10 (G1–G4). This plan **refines** those
sections against the production code that has since landed. It does not replan indirect eval.
Naming: **G1 = IE2** (runtime), **G2 = IE3** (lowering), **G3** (one compiler, two callers), and
**G4** (unchanged native selections).

**Capture.** 2026-11-05, live tree with 550 `packages/*/src` files. `dist` matches `src` for
`js-engine` lowering: probe `p2` reproduces the pinned corpus hash `3e87673d…`
(`runtime-surface.test.ts:15`). Spec text comes from the live ECMA-262 2027 draft (tc39.es,
fetched today), quoted below, and was not copied from the older plans. Probes are read-only Node
scripts in `/tmp/tint-eval-guard-plan`: `p1` (parser shapes) and `p2` (pre-change lowering hashes).
They import `dist` by absolute path and write nothing in the repo. **No result here is native
evidence. This plan makes no conformance forecast.**

## 1. Answer in brief

1. **One lowering covers every compiled Script, so G3 needs no new compiler code.** The AOT Test262 path
   (`tools/test262-native.ts:207`) and `createScriptEvaluator` (`js-engine/src/script-evaluation.ts:84`)
   both call the same `lowerScript`. The in-image evaluator is that same source, AOT-compiled from the
   captured snapshot. Nothing else lowers a call: the dynamic `Function` profiles reject free
   identifiers and every call (`compiler/src/native/closed-functions.ts:486,526`; the global-access
   profile returns an identifier read, not a call). **G3 is therefore surface plumbing plus proof**:
   the runtime-compiled entry must be able to select `callEvalCandidate` through the
   `scriptRuntime` directory.
2. **Two emission points, one predicate.** These are `case "call"` (`lowering/index.ts:2311-2337`)
   and the call step inside `optionalChainValue` (`:681-760`, step loop `:719-737`). The predicate:
   the call is not `optional`, and its callee with groups stripped is `identifier` named `"eval"`.
   The parser cooks escapes (`eval` and `eval` both give `name:"eval"`, probe `p1`), as
   the spec's `[[ReferencedName]]` (a StringValue) requires.
3. **The runtime guard is `callEvalCandidate`, with an explicit realm slot.**
   `ErrorRealm.evalFunction` records `%eval%` for the realm. The guard runs after the callee and
   all arguments have been evaluated in source order. Its behavior:
   - a callee that is not SameValue to the running realm's `%eval%` takes the existing
     `callObjectValue` path unchanged;
   - an empty list gives `undefined`;
   - a non-string first argument is returned as-is, with no coercion;
   - a string is a sticky unsupported operation.
4. **Today this is not observable natively, by design.** The current intrinsic already rejects
   strings and returns non-strings, so guarded and unguarded `%eval%` calls have identical native
   results. **Only Node tests can tell the two apart** (a spy `evalFunction` must never be invoked). The native cases
   prove linking, ordinary-path preservation and stickiness. This is the safest order: the guard
   lands while it is still behavior-neutral, and indirect strings are enabled later (IE7).
5. **Byte identity.** A Script without candidates lowers to identical output, including imports.
   `callEvalCandidate` is imported only under a new `usesDirectEval` flag. The surface grows by
   1 value entry (119 → 120) and `ErrorRealm` by 1 field. **The 22-module captured runtime closure
   does not grow** (it is `runtimeSources()`, `compiler/src/project.ts:4`, the foundation
   collections and values, not `js-runtime`).

## 2. Primary specification (ECMA-262 2027 draft, re-read today)

- **13.3.6.1, `CallExpression : CoverCallExpressionAndAsyncArrowHead`.** The steps are:
  1. "Let ref be ? Evaluation of memberExpr. Let func be ? GetValue(ref)."
  2. "If ref is a Reference Record, IsPropertyReference(ref) is false, and
     ref.[[ReferencedName]] is "eval", then If SameValue(func, %eval%) is true, then Let argList
     be ? ArgumentListEvaluation of args. If argList has no elements, return undefined. Let
     evalArg be the first element of argList. …strictCaller… Return ? PerformEval(evalArg,
     strictCaller, direct-eval)."
  3. Otherwise "Return ? EvaluateCall(func, ref, args, tailCall)."

  `%eval%` means the intrinsic of the **current** realm (the running context's realm).

- **`CallExpression : CallExpression Arguments`** and the **OptionalChain `?. Arguments`** forms
  go straight to EvaluateCall and are never direct. In `eval(x)?.y` the base `eval(x)` is a
  CoverCallExpression evaluated first, so it **is** direct. In `eval(x)(y)` only the inner call is.
- **EvaluateCall (13.3.6.2)** computes `thisValue` (for an environment reference,
  `refEnv.WithBaseObject()`), then ArgumentListEvaluation, then TypeError if `func` is not
  callable, then `Call`. Both branches therefore evaluate arguments after `func` and before any
  callability or SameValue-dependent effect.
- **PerformEval (19.2.1.1) step 2.** "If source is an Object, let sourceString be
  HostGetCodeForEval(source); else let sourceString be source. If sourceString is not a String,
  return source." Under the default **HostGetCodeForEval** (19.2.1.3: "return no-code"), every
  non-String value is returned unchanged, with no ToString or ToPrimitive. Tint keeps the
  default (no hook; indirect plan D6). This holds even though the current draft defines the hook.
  If a host ever supplies one, the hook belongs in the guard's non-string branch **and** in the
  intrinsic, never in lowering.
- **Realm.** For a direct eval, evalRealm is both the caller's realm and eval's realm. A different
  realm's `eval` reached through the identifier `eval` fails SameValue and becomes an ordinary
  call. That makes it an **indirect** eval in its own realm.

## 3. Production surface as it stands (read today)

| Piece                          | Location                                                   | Relevance                                                                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lowerScript(script, source?)` | `js-engine/src/lowering/index.ts:103`                      | Sole Script lowering. `$errors = $script.realm` is the running realm for the Script and all its closures (`:4255-4263`)                                                                                                   |
| `callTarget`                   | `:591-608`                                                 | Groups stripped. An identifier gives `resolveBinding` → `getBindingReference` (func), then `getBindingThisValue` (receiver, no side effects). Chains are delegated                                                        |
| `invoke` / `argumentList`      | `:614-680`                                                 | Arguments are evaluated in order into an array (spread through `appendScriptArguments`), then `callObjectValue(callee, receiver, list, $global.object)` and `check`                                                       |
| Tagged template                | `:1990-2010` (`invokePrepared`)                            | Never a candidate (`` eval`x` `` parses as `tagged-template`)                                                                                                                                                             |
| Annex B call target            | `:439-448`                                                 | `eval(x) = 1` evaluates the call through `value()` → `case "call"`, so it is guarded automatically                                                                                                                        |
| `createScriptEvaluator`        | `js-engine/src/script-evaluation.ts:53-120`                | Rejects non-strings (the `$262` API contract), then parse → `lowerScript` → `host.compile` → invoke                                                                                                                       |
| `createScriptEntryCompiler`    | `js-engine/src/native/script-compile.ts:28-88`             | `specifiers` and `instantiations` come from `scriptRuntimeSurface()` (`:45-50`). Any lowered import outside it fails at `prepareManagedSurfaceEntry` with a stage, so the evaluator reports **unsupported** (not a fault) |
| In-image compiler              | `tools/test262-native.ts:311-324`                          | `readManagedSurfaceDirectory(exported,"scriptRuntime",…)`. The directory is generated from the live vocabulary at image build time                                                                                        |
| Vocabulary                     | `js-engine/src/lowering/runtime-imports.ts:18-259`         | `scriptRuntimeImports(generated, usesDisposal, usesAsyncDisposal)`. Completeness callers pass `true,true`. 119 entries                                                                                                    |
| `%eval%`                       | `js-runtime/src/objects/global-properties.ts:21-39`        | `builtinFunction`: non-string → returned, string → `rejectUnsupportedExecution(realm)`                                                                                                                                    |
| `ErrorRealm`                   | `js-runtime/src/objects/errors.ts:69…`, initializer `:319` | Mutable embedder slots (`dynamicFunctionCompiler`, …). `createErrorRealm` is the **only** constructor (searched)                                                                                                          |

## 4. Candidate shapes (probe `p1`, live parser)

| Source                                        | AST (spans dropped)                                                | Candidate?                           | Emission point                           |
| --------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------- |
| `eval(x)`, `eval(x)`, `eval(x)`               | `call{callee:identifier eval}`                                     | yes                                  | `case "call"`                            |
| `(eval)(x)`, `((eval))(x)`                    | `call{callee:group(group(identifier))}`                            | yes (parentheses keep the Reference) | `case "call"`                            |
| `eval(...a)`, `eval\n(x)`                     | `call`; argument `spread`                                          | yes                                  | `case "call"`                            |
| `with(o) eval(x)`                             | same call; `resolveBinding` finds the object env                   | yes; receiver = `o` (WithBaseObject) | `case "call"`                            |
| `(eval(x))?.y`                                | `member?{object:group(call)}`; the chain loop stops at the group   | yes                                  | `case "call"` via `callTarget` → `value` |
| `eval(x)?.y`, `eval(x)?.(y)`, `eval(x)(y)?.z` | chain; innermost step `call{callee:identifier eval}`, not optional | **innermost step only**              | `optionalChainValue`                     |
| `eval?.(x)`, `(eval)?.(x)`, `eval?.(x)(y)`    | innermost call `optional:true`                                     | no                                   | —                                        |
| `eval(x)(y)`                                  | `call{callee:call{…eval}}`                                         | inner yes, outer no                  | `case "call"` (inner)                    |
| `(0,eval)(x)`, `a.eval(x)`, `(eval?.y)(x)`    | callee is `binary`/`member`                                        | no                                   | —                                        |
| `` eval`x` ``, `new eval(x)`                  | `tagged-template`, `new`                                           | no                                   | —                                        |
| `eval<T>(x)`                                  | `binary(>)` of `binary(<)` (Script parsing has no type args)       | no (not a call)                      | —                                        |

Only the innermost chain step can have a group or identifier callee: the step loop
(`:697-708`) stops at a group, and every outer step's callee is a member, index or call. So the
same predicate is applied to every call step with no index test.

## 5. G1 runtime contract (`js-runtime`)

### 5.1 Realm slot (`objects/errors.ts`)

```ts
// ErrorRealm, directly after dynamicFunctionCompiler (:70)
/** %eval% of this realm, set once by installEvalIntrinsic; identity for direct-eval candidates. */
evalFunction: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
// createErrorRealm initializer, next to `dynamicFunctionCompiler: undefined` (:319)
evalFunction: undefined,
```

**Only this slot.** The IE2 sketch's `evalCompiler` is deferred to IE5/IE7, where its installer
and tests exist. Adding it now would be an unused hook. The cost is a second `ErrorRealm` layout
change later, which is accepted (§7).

### 5.2 Intrinsic (`objects/global-properties.ts`)

`installEvalIntrinsic` keeps its signature, return value and string/non-string behavior. It adds:

1. Before `builtinFunction`: `if (realm.evalFunction !== undefined) throw "EVAL_INTRINSIC_INVARIANT";`.
   One `%eval%` per realm; nothing is allocated on failure.
2. After `builtinProperty`: `realm.evalFunction = evaluate;`.

### 5.3 `callEvalCandidate` (`objects/global-properties.ts`; exported from `objects/index.ts:228` block)

```ts
import { callObjectValue } from "./values.ts";
/** 13.3.6.1 step 6 at a syntactic direct-eval site. The callee, receiver and arguments
 * were already evaluated in source order. Only SameValue with the running realm's %eval%
 * selects PerformEval; every other callee keeps the ordinary call, including its receiver. */
export function callEvalCandidate(
  callee: unknown,
  receiver: unknown,
  arguments_: readonly unknown[],
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
): { readonly error: "none" | "type"; readonly value: unknown } {
  const intrinsic = realm.evalFunction;
  if (intrinsic === undefined || callee !== intrinsic)
    return callObjectValue(callee, receiver, arguments_, witness);
  if (arguments_.length === 0) return { error: "none", value: undefined };
  const source = arguments_[0];
  // PerformEval step 2 with default HostGetCodeForEval: no coercion of any kind.
  if (typeof source !== "string") return { error: "none", value: source };
  // Direct string eval (S5): caller environments are not implemented.
  return rejectUnsupportedExecution(realm);
}
```

**Failure protocol.**

- The return shape is identical to `callObjectValue`, so the lowering reuses `check(result.error)`.
- `"type"` comes only from the ordinary path (non-callable callee).
- Unsupported is the **existing sticky protocol**: `realm.unsupported = true; throw undefined`,
  on the running realm. The current unguarded path throws exactly this today, through the
  intrinsic, so both catches and host realm checks behave as before.
- The guard never returns `"unsupported"`.

**Points to keep exact:**

- The `intrinsic === undefined` test must come first. Otherwise `eval = undefined; eval(1)`
  would compare `undefined === undefined` and wrongly take the eval branch, when the spec requires
  a TypeError.
- `!==` is SameValue for objects. Primitive callees can never equal an object.
- Arguments are not re-read and no getter runs in the guard. The guard receives the array that
  `argumentList` built.
- For the `%eval%` branch the receiver is ignored, as PerformEval ignores `thisValue`.

**Placement.** The guard lives beside `installEvalIntrinsic`. `values.ts` imports nothing from
`global-properties.ts`, so the new import adds no cycle; `pnpm boundaries` confirms this. The
guard is not generic and its type arguments are `[]` (the `scriptRuntimeTypeArguments` default),
so no instantiation table changes.

## 6. G2 lowering (`js-engine/src/lowering`)

### 6.1 `runtime-imports.ts`

- New signature: `scriptRuntimeImports(generated, usesDisposal = false, usesAsyncDisposal = false, usesDirectEval = false)`.
- In the `@tint/js-runtime/objects` binding list, insert `...(usesDirectEval ? ["callEvalCandidate"] : [])`
  **immediately after the `usesDisposal` spread**. The name is not type-only.
- `scriptRuntimeSurface()` calls it with `true, true, true`.

Callers that request the **complete** vocabulary must pass the new `true`; otherwise linked roots
and the vocabulary disagree. There are three outside the package:

- `tools/script-runtime-request.ts:56`;
- `tools/managed-script-fixture.ts:51`;
- `tools/script-runtime-surface.test.ts:91`.

Also update `js-engine/test/runtime-imports.test.ts:31,50` and add the flag column to its `:9-25`
loop.

### 6.2 `index.ts`

```ts
let usesDirectEval = false; // beside usesDisposal (:141)
function directEvalCandidate(node: Expression): boolean {
  if (node.kind !== "call" || node.optional === true) return false;
  let callee = node.callee;
  while (callee.kind === "group") callee = callee.expression;
  return callee.kind === "identifier" && callee.name === "eval";
}
function invokeEvalCandidate(
  callee: Expression,
  receiver: Expression,
  args: readonly Expression[],
  span: Span,
): Expression {
  usesDirectEval = true;
  const list = argumentList(args, span); // same order and spread semantics as invoke()
  const result = temporary(
    runtimeCall(
      "callEvalCandidate",
      [
        callee,
        receiver,
        list,
        member(id("$global"), "object", span),
        id("$errors"),
      ],
      span,
    ),
  );
  check(member(result, "error", span), span);
  return member(result, "value", span);
}
```

- **`case "call"` (`:2331-2337`).** Keep `const evaluated = callTarget(node.callee)` and
  `temporary(evaluated.value, true)`. Dispatch on `directEvalCandidate(node)` to
  `invokeEvalCandidate`, otherwise to `invoke`.
- **`optionalChainValue` (`:730-733`).** Make the same dispatch for `step.kind === "call"`, using
  `previous` and `receiver`.
- **Imports (`:4192`).** Pass `usesDirectEval` as the fourth argument.
- `objectRuntime` is **not** used for the guard: it appends only the witness, and the guard needs
  both the witness and `$errors`.

**Order (unchanged from today).** Read the callee (a TDZ or unresolvable reference throws here),
then the receiver (side-effect free), then each argument left to right (spread runs its iterator
here), then the guard. This matches 13.3.6.1/13.3.6.2: the reference and GetValue come before
ArgumentListEvaluation, and callability is checked after it.

**Strictness.** No strictness literal is passed. The only strict-dependent branch, the string
branch, is unsupported, and S5 will need more than a boolean. S5 replaces the string branch with
`strictCaller`, the caller environments, private environment and function-context flags (§10).

## 7. Surface, census, digest and pins

| Pin                                                                         | Today                                    | After G1+G2                                         | Why                                                          |
| --------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------ |
| `runtime-surface.test.ts:54,56` entries/names                               | 119/119                                  | **120/120**                                         | +`callEvalCandidate`                                         |
| `runtime-surface.test.ts:57-60` typed entries; `:116` seen                  | 37; 27                                   | unchanged                                           | `[]` type arguments                                          |
| `runtime-surface.test.ts` 8 corpus sha256                                   | pinned                                   | **unchanged** (byte identity; none has a candidate) | no `eval` call                                               |
| `script-runtime-surface.test.ts:197-200`                                    | functions 100, types 19, generic 27/10   | **functions 101**, rest unchanged                   | +1 value export                                              |
| `:243` table entries; `:626` final values                                   | 100; 100                                 | **101; 101**                                        | +1 value                                                     |
| `:229` roots                                                                | 27                                       | measure (expected 27)                               | equals generic functions                                     |
| `:324-325,366,526,564-573,627,632` census, providers, targets, slots, stubs | 78/39/41/78/41/323/355/366/78/300        | **measure, do not predict**                         | the `ErrorRealm` layout gains a field; one new provider path |
| `test262-script-service.test.ts:86` no-capability host AST                  | `5a4f83fd…`                              | unchanged                                           | host text is not edited                                      |
| `test262-script-service.test.ts:145` captured texts                         | 22                                       | **unchanged**                                       | `runtimeSources()` is foundation-only                        |
| `scriptRuntime` directory digest                                            | computed at build, not pinned (searched) | changes                                             | new entry plus `ErrorRealm` layout                           |

**Rule:** re-pin a measured count only in the G1/G2 commit, and only when its diff can be
explained by the one value export or the one `ErrorRealm` field. A count that moves for any other
reason is a stop signal. No `$T` alias literals move, because the tests resolve them by export.
The canonical directory census is **not** a policy change: the vocabulary is the single source,
and only the counts follow from it.

## 8. Semantics the tests must pin

| #   | Input (sloppy unless noted)                                                                                  | Required                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 1   | `eval(o)` for `undefined,null,false,42,Symbol(),{},new String("s")`; `eval()`; `eval(...[])`                 | the identical value / `undefined`; for `{toString,Symbol.toPrimitive}` spies, 0 calls    |
| 2   | `(eval)(o)`, `((eval))(o)`, `eval(o)`, `eval(o)?.y` with `o={y:3}`, `(eval(o))?.y`                           | `o` / 3 / 3                                                                              |
| 3   | `eval(function(){return 9})()`                                                                               | 9: the inner call is guarded, the outer is ordinary                                      |
| 4   | `globalThis.eval=function(n){return n+1}; eval(4)`                                                           | 5 (ordinary path)                                                                        |
| 5   | `var log=""; globalThis.eval=function(){"use strict";log+="c";return this}; eval((log+="a",1),(log+="b",2))` | `log==="abc"`, value `undefined` (strict callee, global env base)                        |
| 6   | `var w={eval:function(){"use strict";return this}}; with(w) eval(1)`                                         | `w` (WithBaseObject receiver preserved)                                                  |
| 7   | `var log=""; try{ {eval(log+="a"); let eval;} }catch(e){…}`                                                  | ReferenceError and `log===""`: func is read before any argument                          |
| 8   | `eval(missing)`                                                                                              | ReferenceError (argument evaluated before the guard; Test262 `call/eval-err-args.js`)    |
| 9   | `eval = undefined; eval(1)` / `eval = 3; eval(1)`                                                            | TypeError (ordinary), never `undefined`/`1`                                              |
| 10  | `(function(){var eval=$262.createRealm().global.eval; return eval(5)})()`                                    | 5 via the other realm's intrinsic (ordinary call)                                        |
| 11  | `eval("1")`, `eval("1")?.y`, `with({eval}) eval("1")`, `(eval)("1")`                                         | sticky unsupported on the running realm; the `%eval%` function object is **not** invoked |
| 12  | `(0,eval)("1")`, `eval?.("1")`, `globalThis.eval("1")`                                                       | unchanged: the intrinsic string branch rejects (until IE7)                               |

## 9. Red-first slices and commands

Each slice runs: red tests → implementation → `pnpm build` → focused `node --test …` → `pnpm check`.

**G1 (Node only).**

- `js-runtime/test/ordinary-object-global-properties.test.ts`, with a real `createErrorRealm`:
  - `realm.evalFunction` is `undefined` before install and is the returned function after it;
  - a second install throws `"EVAL_INTRINSIC_INVARIANT"` and leaves the global property identical.
- `callEvalCandidate`, with a **spy** `evalFunction` (a callable object, set on the realm) to
  discriminate the guard from the ordinary path:
  - a string sets `realm.unsupported` and throws `undefined`, with **0 spy calls**;
  - `[]` gives `undefined` and every §8 #1 value is identical, each with 0 spy calls and 0
    coercion calls;
  - a different callable takes the ordinary path, with its receiver and the identical argument
    array observed (#5/#6);
  - `undefined` and `3` as callee give `{error:"type"}`, both with the slot set and with
    `undefined` (#9);
  - another realm's installed eval with a string gives sticky unsupported on **that** realm only;
    the running realm stays clean.

```sh
pnpm build && node --test packages/js-runtime/test/ordinary-object-global-properties.test.ts
```

**G2 (Node, lowering).**

- `js-engine/test/lowering.test.ts`: walk the lowered module with `rewriteModule` and count
  `callEvalCandidate` and `callObjectValue` calls.
  - Every "yes" row in §4 gives exactly one guard call per candidate. In `eval(x)(y)` and
    `eval(x)(y)?.z`, the guard covers the inner call and an ordinary call covers the outer.
  - Every "no" row gives 0 guard calls and no `callEvalCandidate` import.
  - In a candidate module, the guard's arguments are, in order: callee temporary, receiver, list,
    `$global.object`, `$errors`. The argument temporaries are pushed **before** the guard.
- `js-engine/test/runtime-surface.test.ts`:
  - surface counts per §7;
  - a new corpus entry
    `"(0,eval)(1);eval?.(1);(eval)?.(1);this.eval(1);var e=eval;e(1);eval`x`;new eval(1);"`
    pinned at **`c2bdda8d52eb31d7f363df74740167b204bf6a1143da1e877dc64923ee03bc9b`**
    (pre-change hash from probe `p2`, 6 `callObjectValue` calls). It must stay green before and
    after, which proves byte identity for indirect-only shapes;
  - the pre-change candidate sample
    `"var log='';var o={y:3};eval(o);(eval)(o);eval(o)?.y;eval(...[]);"` hashes to
    `fd5a762b…`. It must **change** after G2 (red until then) and then be re-pinned.
- `js-engine/test/runtime-imports.test.ts`: `"eval(1);"` imports equal
  `scriptRuntimeImports(span,false,false,true)`; `"42;"` imports are unchanged.
- `tools/script-runtime-surface.test.ts`: the §7 counts.

```sh
pnpm build && node --test packages/js-engine/test/lowering.test.ts packages/js-engine/test/runtime-surface.test.ts packages/js-engine/test/runtime-imports.test.ts tools/script-runtime-surface.test.ts
```

**G3 (Node first; this is the runtime-compiled proof).**

- `js-engine/test/script-compile.test.ts`, using the existing `createManagedScriptFixture()` (it
  builds its directory from the live vocabulary through `createScriptRuntimeRequest`). For
  `lower("eval(7);")` and `lower('eval("1")?.y;')`:
  - assert the module imports `callEvalCandidate` (this makes the test red before G2 rather than
    vacuously green);
  - then `createScriptEntryCompiler(fixture, h.authority, {maxScriptCodeBytes:262144})(module)` is
    `ok` and equals manual `prepareManagedSurfaceEntry` + `linkManagedSurfaceModule` bytes, as in
    the `:71-99` test. A missing directory entry fails here with a `select`/`prepare` stage.
- `js-engine/test/script-evaluation.test.ts`: with the existing spy host, evaluating `"eval(7)"`
  hands `compile` a module whose imports contain `callEvalCandidate`. This proves the evaluator
  uses the same `lowerScript` and has no separate path.

```sh
pnpm build && node --test packages/js-engine/test/script-compile.test.ts packages/js-engine/test/script-evaluation.test.ts tools/test262-script-service.test.ts
pnpm check
```

**G2/G3 native (main's serial queue, after `pnpm check`).**

1. Rerun `node tools/verify-test262-native-eval-intrinsic.ts` unchanged: 4 cases, all
   `completed`. Case 1 already exercises direct non-string `eval(value)` through the guard.
2. A frozen self-build with byte-identical stages, because lowering changed (indirect plan
   risk 4).
3. A new `tools/verify-test262-native-eval-guard.ts`, modeled on
   `verify-test262-native-eval-script.ts`:
   - raw `executionPlan`, one image built with the Script capability, and `NativeImageRunner` at
     `nativeTestResources`;
   - per-case expected outcomes and a `node:vm` reference for the completed cases;
   - `TINT_BUILD_ONLY=1` supported.
     (`verifyNativeScriptCases` cannot be used, because it requires `completed` and has no `$262`.)

   | Case | Source                                                                                                                                                                                           | Expected                                                              |
   | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
   | 0    | §8 #1–#3 as `throw N` assertions                                                                                                                                                                 | `completed`                                                           |
   | 1    | §8 #4–#9 (AOT ordinary path, order, receivers, TDZ, TypeError)                                                                                                                                   | `completed`                                                           |
   | 2    | §8 #10 (cross-realm non-string)                                                                                                                                                                  | `completed`                                                           |
   | 3    | `eval("1");`                                                                                                                                                                                     | `unsupported` (never a 13–17 fault)                                   |
   | 4    | `eval("1")?.y;`                                                                                                                                                                                  | `unsupported`                                                         |
   | 5    | `with({eval}) eval("1");`                                                                                                                                                                        | `unsupported`                                                         |
   | 6    | `if($262.evalScript("eval(7)")!==7)throw 1;const c=$262.createRealm();if(c.evalScript("eval(3)")!==3)throw 2;if($262.evalScript("globalThis.eval=function(n){return n+1};eval(4)")!==5)throw 3;` | `completed`: the runtime-compiled guard links through `scriptRuntime` |
   | 7    | `$262.evalScript('eval("1")');`                                                                                                                                                                  | `unsupported`                                                         |
   | 8    | `$262.evalScript('eval("1")?.y');`                                                                                                                                                               | `unsupported`                                                         |

   No retries. Any `crash` (statuses 13–17) or `timeout` is a stop, not a re-run. Write an
   immutable result `docs/results/native-eval-guard-v1.json` in the shape of
   `native-test262-script-service-validation-v1.json`. The pass condition is exactly 6
   `completed` and 3 `unsupported`.

## 10. G4 (unchanged selections, fresh frozen toolchain after G3; main's queue)

The [resource-controls](rt-eval-resource-controls.md) §10 G4 list stands. Add one selection that
has **no native baseline in v1–v9** (searched): `language/expressions/call` (92 files, including
`eval-{err-args,first-arg,no-args,realm-indirect,spread*,strictness-inherit-*}.js` and
`tco-non-eval-{global,function,function-dynamic,with}.js`). Record its baseline on the
pre-G1 frozen toolchain first, then after G3:

```sh
node tools/test262-native-run.ts .tint-bootstrap/test262 language/expressions/call 8
node tools/test262-native-run.ts .tint-bootstrap/test262 built-ins/eval 8
```

**Blocking:**

- any pass → fail;
- `built-ins/eval` losing any of its 18 passes;
- `eval-err-args`/`eval-no-args` changing status;
- any `eval("…")` string row reaching `completed`. String rows must stay `unsupported`, and the
  direct-only checker is the guard.

Keep pre-entry INFRA crashes separate. The frozen global-code runs already in flight, and the
SIGKILL observation, are main's and are not inputs here.

## 11. Decisions, risks, non-goals

**Decisions (main may take them without asking).**

| ID  | Decision                                                                                        | Rejected                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GD1 | Realm slot `evalFunction` set by the intrinsic installer                                        | A brand on the function object, or a module-level registry (`WeakMap`/`Map` state in native images), both unproven natively |
| GD2 | Guard inside the runtime after argument evaluation; lowering emits only the syntactic predicate | Resolving `eval` at lower time (wrong under `with`, shadowing and global reassignment)                                      |
| GD3 | Conditional import (`usesDirectEval`)                                                           | Always importing it, which changes every Script's bytes and all 8 corpus hashes                                             |
| GD4 | Sticky `rejectUnsupportedExecution` for string direct eval                                      | Returning `"unsupported"`, a new protocol for one site                                                                      |
| GD5 | No `evalCompiler` slot in this slice                                                            | A dormant hook before its installer and tests                                                                               |
| GD6 | No `HostGetCodeForEval` hook; non-strings are returned as-is                                    | Coercing, which contradicts PerformEval step 2 under the default                                                            |

**Risks.**

1. **No native discrimination** before IE7 (§1.4). Correctness rests on the G1 spy tests and the
   G2 structure tests, so they must be in the same commit as the code.
2. **Census counts beyond surface/table may move** (§7). Measure them; never pre-pin.
3. The self-build must stay byte-identical. Runtime and compiler sources contain no `eval(` call
   (searched in `packages/*/src`), so stages change only through the new export.
4. Line anchors drift. Re-run `p1`/`p2` on the landing commit.
5. `harness/sm/non262-{strict,expressions}-shell.js` contain direct `eval(` and change their
   lowered bytes. The common Test262 harness files contain none (searched), so other images keep
   their Script modules.

**Non-goals.** No indirect string path; the intrinsic's string branch is unchanged. No direct
string eval (S5). No dynamic-`Function` change: S4's general fallback must reuse `lowerScript`'s
call lowering, and then inherits the guard.

## 12. Next planning task (not implemented here)

**IE4 + IE5: eval lexical-entry adaptation and inherited ScriptRecord handoff.**

- Specify `lowerEvalScript` as a mode of `lowerScript`, with exactly the four §5.4 points of the
  indirect plan. The IE1 `instantiateEvalDeclarations` that has now landed joins the vocabulary
  there (one more surface entry and pin set).
- Specify the `$script.hostDefined` carrier handoff in `createScriptEvaluator`'s private body,
  including the `ScriptEntryFrame` reuse.
- Write the red tests for both, so that the guard from this plan is already in place when IE7
  enables the intrinsic's string branch.
