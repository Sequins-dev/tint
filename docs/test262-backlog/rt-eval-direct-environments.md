# RT-EVAL S5-de: direct string `eval` — caller environments and context handoff

Current implementation: DE0 caller environments, DE1 declaration instantiation,
DE2 typed sites and DE3 parser/binder contexts are implemented and natively
validated. The first DE4 slice, `lowerDirectEvalScript`, also passes
[actual native execution](../results/native-direct-eval-entry-v2.json), including
strict/sloppy storage, receiver/new-target transport and eval-closure GC retention.
All 4,083 workspace tests pass; see the [entry checkpoint](../results/direct-eval-entry-checkpoint-v1.json).
Direct string eval remains blocked until the evaluator service and intrinsic/host
routing land. Class/private/super capabilities remain the later DE5 slice.
Compiler reuse and complete-suite measurement are deferred by user direction.

Research status: **plan only.** Parent: [rt-eval.md](rt-eval.md) §5 and §7 S5. It refines S5 against
the code that has since landed:

- G1–G3 `callEvalCandidate` ([direct-call guard](rt-eval-direct-call-guard.md));
- IE1 `instantiateEvalDeclarations`;
- IE4/IE5 `lowerEvalScript` and the shared runner ([lexical entry](rt-eval-lexical-entry.md));
- IE6a/IE7 host wiring;
- FN0–FN2 `lowerDynamicFunctionImplementation` and the packed carrier
  ([function fallback](rt-eval-function-fallback.md)).

Where this plan disagrees with the S5 bullet in the parent, this plan wins for the environment
shapes, the site record and the handoff. It does **not** replan the guard or indirect eval.

**Capture.** 2026-11-05, live source. The vocabulary has 122 entries (102 helpers, 20 types,
`js-engine/test/runtime-surface.test.ts:53`). **Not established, so not cited as passing:**
native Function fallback (carrier v6, 16-case verifier), the post-host indirect-eval rerun, the
frozen self-builds and the running global-code 75 rerun. The complete Annex B global-code result
(153/153) is unrelated to direct eval.

**Evidence classes.** **[spec]** is ECMA-262 draft text read today from the cached tc39.es
pages in `/tmp/tint-lexentry-spec`; **[src]** is live source; **[node]** is V8 output from the
read-only probe `/tmp/tint-direct-eval-plan/ref.cjs`. Node is not authoritative (two V8
discrepancies in §3).

**Method.** I emitted nothing, ran no native process and touched no queue, journal, report,
snapshot or active process. The only files changed are this file and one cross-link.

## 1. Answer in brief

1. **The guard stays; only its string branch changes.** `callEvalCandidate`
   (`js-runtime/src/objects/global-properties.ts:63`) already implements every ordering rule:
   - the callee is evaluated first, then all arguments;
   - SameValue is tested against the running realm's `evalFunction`;
   - an empty argument list returns `undefined`, and a non-string returns unchanged.

   Only the string branch changes, from `rejectUnsupportedExecution` to direct PerformEval with
   a caller **site**. Non-intrinsic callees keep `callObjectValue`, and nothing here touches
   `eval?.()`, `(0,eval)` or shadowed `eval`.

2. **Tint's function environments do not match the spec in two places.** These differences are
   unobservable today but observable once eval runs strings:
   - **(a)** Sloppy functions keep body `let`/`const` in the **same** record as their vars
     (`instantiateFunctionBody`, `environments/global/function.ts:33`). The spec gives them a
     separate lexical record, and EvalDeclarationInstantiation's conflict walk depends on it.
   - **(b)** Sloppy functions with parameter expressions have no record **between** the closure
     scope and the parameter record. A direct eval in a default must put its vars there.

   Both are fixed by lowering-only changes that use existing helpers. They apply only to code
   that contains a syntactic candidate, so all other output stays byte-identical. That is the
   first slice, **DE0** (§7).

3. **The lowerer must track the VariableEnvironment.** It tracks `scope` and `lexical` but
   not the variable environment. Add a `variableScope` expression and a list of `catchRecords`
   active since that scope. Both are pure lowering state.
4. **Site record (proposed).** A `DirectEvalSite`, built eagerly at each candidate call,
   carries the caller's Lexical/Variable environments and Catch records, `this` state,
   `new.target`, home object, derived construction, active constructor, visible private names,
   strictness and the four PerformEval flags. Sloppy eval appends its parent site's Catch
   records, so nested evals see the whole chain.
5. **Handoff (§5).** `ScriptRecord.hostDefined: unknown` **cannot** carry a typed site: the
   portable contract bans casts (`tools/boundaries.ts:137-145`), and the only checked native
   view, `viewObjectValue`, yields `OrdinaryObject`. A second frame type needs a multi-frame managed directory (`directory.frame` is one string,
   and `native/script-compile.ts:38` requires `"ScriptEntryFrame"`). **Recommendation:** keep
   the single frame and add a typed `directEval: DirectEvalSite | undefined` field to the
   record already passed as `$argument1`. This depends on R1 (module-cycle admissibility). The
   fallback removes the ScriptRecord pun with a dedicated carrier type in the same frame slot.
6. **Context.** The lowered code calls the guard as a **plain helper**, so no builtin context is
   pushed and `realm.agent.activeContext` is the caller's own. Its effective `scriptOrModule`
   becomes the carrier's `hostDefined`, and the realm is the caller's (`$errors`), which is
   `evalRealm` by construction: the existing `runner.run(…, inheritActive = true)` path.
7. **Incomplete capabilities must be explicit.** The first enabling slice (DE4) supports Script,
   indirect-eval and function callers, including parameter defaults, blocks, `catch` and `with`.
   String eval at any site with a home object, derived construction, private names or field
   initializer stays **sticky unsupported** until DE5 adds `super`, `#x` and derived `this`.
   No path falls back to a global wrapper.

## 2. Primary specification [spec]

**PerformEval (19.2.1.1)**

- For `direct-eval`, `GetThisEnvironment()` sets `inFunction` (Function Environment Record),
  `inMethod` (`HasSuperBinding()`), `inDerivedConstructor` (`[[ConstructorKind]]` derived) and
  `inClassFieldInitializer` (`[[ClassFieldInitializerName]]` not empty).
- Early errors: NewTarget unless `inFunction`, SuperProperty unless `inMethod`, SuperCall unless
  `inDerivedCtor`, and `ContainsArguments` when `inClassFieldInitializer`.
- `strictEval` is `strictCaller` or ScriptIsStrict.
- Environments: `lexicalEnv = NewDeclarativeEnvironment(running.LexicalEnvironment)`,
  `variableEnv = running.VariableEnvironment` and `privateEnv = running.PrivateEnvironment`. If
  `strictEval`, then `variableEnv = lexicalEnv`.
- `evalContext`: Realm is `evalRealm`, the ScriptOrModule field is copied, Function is null.
- Result: EvalDeclarationInstantiation, then evaluation; an empty completion becomes
  `undefined`.

**EvalDeclarationInstantiation (19.2.1.4), sloppy steps**

- If `variableEnv` is global, any `HasLexicalDeclaration` hit is a SyntaxError.
- Then walk `thisEnv` from `lexicalEnv` until it is **the same record** as `variableEnv`:
  - skip Object records (`with`);
  - otherwise any `HasBinding(name)` is a SyntaxError, **unless** (Annex B, VariableStatements
    in Catch Blocks) `thisEnv` "is the Environment Record for a Catch clause".
- Next comes the PrivateEnvironment check (`AllPrivateIdentifiersValid`).
- Then the global TypeError checks: `CanDeclareGlobalFunction` and `CanDeclareGlobalVar`.
- Then the Annex B.3.2.3 block-function walk. It uses the same intervening walk, with the Catch
  exception.
- Then bindings are created:
  - lexical names in `lexicalEnv`, uninitialized;
  - for a non-global `variableEnv`, function names first (`CreateMutableBinding(name, true)`,
    which is **deletable**, or `SetMutableBinding` when the name exists), then vars, initialized
    to `undefined` if absent.

**FunctionDeclarationInstantiation (10.2.11)**

- Steps 19–20: if `!strict && hasParamExprs`, a new `envRecord` over `calleeEnv` holds the
  parameters. The VariableEnvironment stays `calleeEnv` while parameters evaluate. NOTE:
  "bindings created by direct eval calls in the formal parameter list are outside the
  environment where parameters are declared".
- Arguments: `argumentsObjNeeded` puts `arguments` into `envRecord`.
- Step 28: with parameter expressions, the body VariableEnvironment is a new record over
  `envRecord`.
- Step 30: when `!strict`, `lexicalEnv = NewDeclarativeEnvironment(variableEnv)`. NOTE: this is
  "so that a direct eval can determine whether any var scoped declarations introduced by the
  eval code conflict with pre-existing top-level lexically scoped declarations".

**Call (13.3.6.1).** The Reference is evaluated, then GetValue, then the arguments, then the
SameValue test against `%eval%` of the current realm. This is unchanged and already implemented.

## 3. Reference observations (V8, read-only probe) [node]

| Case                                                       | V8                    | Spec                                                                                                            |
| ---------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `function(){let x; eval("var x")}`                         | SyntaxError           | Same: the walk hits the separate lexical record                                                                 |
| `{let x; eval("var x")}` and `for (let i…){eval("var i")}` | SyntaxError           | Same                                                                                                            |
| `catch (x) { eval("var x=1") }`                            | allowed               | Same (Catch exception)                                                                                          |
| `catch ([x]) { eval("var x=1") }`                          | **SyntaxError**       | **Allowed**: the draft text names any Catch-clause record. Investigate the Test262 expectation; do not copy V8  |
| `function(a = eval("var a=1")){}`                          | SyntaxError           | Same: the parameter record is intervening                                                                       |
| `function(p = eval("var arguments")){}`                    | **no error**          | **SyntaxError**: `arguments` is in `envRecord` (`argumentsObjNeeded`). The arrow form gives `"param"`, as in V8 |
| `function(a = eval("var z=7"), b = () => z){ var z = 1 }`  | `[7, 1]`              | Same: `z` lives in `calleeEnv`, and the body `var z` lives in a separate record                                 |
| `eval("var d=1"); [delete d, typeof d]`                    | `[true, "undefined"]` | Same: eval-created function vars are deletable                                                                  |
| Derived constructor `eval("this")` before `super()`        | ReferenceError        | Same                                                                                                            |
| Class field `eval("arguments")`                            | SyntaxError           | Same                                                                                                            |
| Method `eval("this.#p")`                                   | value                 | Same                                                                                                            |

## 4. Current source contracts [src]

| Piece                  | Location                                                               | Fact relevant to S5                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope chain            | `environments/global/scope.ts:28`                                      | `EnvironmentScope {global, object, declarative, outer}`. A global node has both `object` and `declarative` undefined. Resolution is by name at run time, so eval-added bindings are visible to AOT and JIT closures without re-resolution                                                                                                                                                                        |
| Declarative record     | `environments/records/index.ts:17`                                     | `{bindings: Map, undefinedValue}`. There is **no kind tag**, so a Catch record is not identifiable at run time                                                                                                                                                                                                                                                                                                   |
| EDI (global only)      | `environments/global/eval-declarations.ts:28`                          | `(record: GlobalEnvironment, lexical, plan, strict)`. Its doc already says direct eval needs "a separate admission walk"                                                                                                                                                                                                                                                                                         |
| Function body          | `environments/global/function.ts:33`                                   | `instantiateFunctionBody(parameters, plan)`. `separate` creates a body record over the parameter scope; lexical declarations go into **that same record**                                                                                                                                                                                                                                                        |
| `callable()`           | `lowering/index.ts:945-1540`                                           | `parameterRecord = createDeclarativeEnvironment` sits directly over `capturedScope` (`:1114`). `separate = parameterHasExpressions` (`:1148`). `instantiateScriptArguments` runs on `parameterRecord`. The body calls `instantiateFunctionBody` (`:1332`). State saved and restored: `scope`, `lexical`, `receiver`, `home`, `derivedContext`, `activeConstructor`, `newTarget`, `strict`, `annexVariableRecord` |
| Lowering context state | `lowering/index.ts:155-172`                                            | `receiver` (sloppy: a `sloppyCallReceiver` temporary), `derivedContext` (`DerivedConstruction` receiver), `activeConstructor` (`$calleeN`), `newTarget`, `home`, `privateScopes` (lowering-time map from name to the `createPrivateName` temporary), `functionDepth`                                                                                                                                             |
| Class code             | `lowering/index.ts:1643-2000`                                          | Class bodies, field initializers (`callable([], init, false, …, {method, raw, codeStrict: true, homeObject})`) and static blocks are **strict**. Every eval reached through `super`, `#x` or a field is therefore strict, gets its own VariableEnvironment and never injects vars                                                                                                                                |
| Catch                  | `lowering/index.ts:3997-4045`                                          | Each catch binding gets a fresh `record` temporary and a declarative scope, as a static lowering-time expression                                                                                                                                                                                                                                                                                                 |
| Candidate guard        | `lowering/index.ts:642-670`, `objects/global-properties.ts:63`         | `directEvalCandidate(node)` (not optional; group-stripped `identifier` named `eval`). Arguments are `callee, receiver, list, $global.object, $errors`                                                                                                                                                                                                                                                            |
| Entry kinds            | `lowering/index.ts:125-170, 4232-4300`                                 | `"script" \| "indirect-eval" \| "dynamic-function"`. Indirect eval builds `$evalLexical` and `$scope = createDeclarativeScope(createGlobalScope($global), $evalLexical)`                                                                                                                                                                                                                                         |
| Frame and carrier      | `native/script-entry.ts`, `objects/jobs.ts:15`                         | `ScriptEntryFrame {$imports, $argument0: GlobalEnvironment, $argument1: ScriptRecord}`, where `ScriptRecord {kind, realm, hostDefined: unknown}`. The entry pushes `$script` (Script) or `$script.hostDefined` (eval and function)                                                                                                                                                                               |
| Runner                 | `script-evaluation.ts:118-170`                                         | `run(lowered, identity, inheritActive)`: compile, domain check, `createScriptRecord(realm, inherited)`, invoke, context-leak check, completion view. Its failure taxonomy is reused unchanged                                                                                                                                                                                                                    |
| Parser context         | `typescript/src/syntax/parser.ts:139,250-252`                          | `parseScript` exposes no context. `superProperty`, `superCall` and `newTargetAllowed` are local parser state that starts false                                                                                                                                                                                                                                                                                   |
| Binder context         | `typescript/src/binding/index.ts:154,526-527,740-745`                  | `bindScript(script)` exposes no context. `privateScopes` starts empty and `restrictedArguments` starts false. Unknown `#x` gives "undeclared private name"                                                                                                                                                                                                                                                       |
| Binder outputs         | `binding/index.ts:82-98`                                               | `AnnexFunctionCopy.owner: Span \| undefined` is the precedent for function ownership keyed by span                                                                                                                                                                                                                                                                                                               |
| Package boundary       | `tools/boundaries.ts:137-160`                                          | No `as`, `!` or `any`. The cycle check covers packages, not modules inside a package                                                                                                                                                                                                                                                                                                                             |
| Module direction       | `objects/derived-construction.ts:7`; `environments/global/scope.ts:10` | `objects` imports `environments/records`, and `environments/global` imports `objects`. An `objects` → `environments/global` import would be a **new intra-package cycle**                                                                                                                                                                                                                                        |

## 5. Handoff decision (caller site into the JIT entry)

| Option                                                                                                           | Verdict                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0: put the site in `hostDefined: unknown`                                                                       | **Rejected.** Managed code cannot recover `EnvironmentScope` or other records from `unknown` without a cast, and no checked view exists. Also, `hostDefined` must stay the effective ScriptOrModule pushed by the entry                                                                                                                        |
| H1: FN-style packed carrier (the entry returns a function; AOT calls it with `[site parts…]`)                    | **Rejected.** Arguments arrive as `unknown[]`, which is the same recovery problem. FN works only because its values are ordinary JS values                                                                                                                                                                                                     |
| H2: **typed `directEval: DirectEvalSite \| undefined` on the `$argument1` record** (recommended)                 | One frame. JIT code reads `$script.directEval` and narrows it once with `=== undefined` → `throw "DIRECT_EVAL_SITE_INVARIANT"`. No helper or ambient state is needed. Ordinary Scripts, indirect eval and FN lower byte-identically; only the record layout census changes. **Gated on R1**, because `ScriptRecord` lives in `objects/jobs.ts` |
| H2′: replace the pun with `ScriptEntryCarrier {realm, identity, directEval}` in `environments/global` (fallback) | Same frame name, `$argument1` retyped. This removes the documented pun and avoids the module cycle, but every entry's lowered text and the tool fixtures change. Choose it if R1 fails                                                                                                                                                         |
| H3: second frame type `DirectEvalEntryFrame`                                                                     | Rejected now. It needs the directory (`managed-directory-data.ts:38,143`), the compile service and the JIT entry to admit several frames                                                                                                                                                                                                       |
| H4: realm slot plus a `takeDirectEvalSite($script)` helper                                                       | Rejected. It is a mutable ambient channel with a reentrancy protocol. It grows the vocabulary and `ErrorRealm`, and the module cycle remains                                                                                                                                                                                                   |

The **AOT → engine** direction has the same typing problem. The guard needs a typed callback:
`directEvalCompiler(source, site, strictCaller)`. Under H2 that slot sits on `ErrorRealm`
(`objects/errors.ts:73-74`, beside `evalFunction`/`evalCompiler`), so it also depends on R1.
Under H2′, the slot and the direct guard live in a new `environments/global/eval-site.ts`, and
the slot is a write-once field installed like `installEvalCompiler`. The site record is reached
only through the frame field, never through `hostDefined`, a cast or a mutable side slot.

## 6. Proposed contracts (nothing below exists yet)

### 6.1 Site record (`js-runtime`, module per §5)

```ts
export interface DirectEvalSite {
  readonly lexical: EnvironmentScope<ScriptPropertyKey, unknown>; // running LexicalEnvironment
  readonly variables: EnvironmentScope<ScriptPropertyKey, unknown>; // running VariableEnvironment node
  readonly catches: readonly DeclarativeEnvironment<unknown>[]; // Catch records between them
  readonly thisValue: unknown; // undefined when derived is set
  readonly derived: DerivedConstruction | undefined; // getDerivedThis on use, never eagerly
  readonly activeConstructor: unknown; // same static type as callable's $calleeN
  readonly home: unknown; // home-object expression value; undefined if none
  readonly newTarget: unknown;
  readonly privateNames: readonly {
    readonly name: string;
    readonly value: PrivateName;
  }[];
  readonly flags: number; // strict | inFunction | inMethod | inDerived | inFieldInitializer
}
```

- **Variable identity.** The variable environment is compared by **record**, not node: a global
  `variables` node stops at the first global node, and a declarative one stops at the node
  whose `declarative` is the same record. `createGlobalScope` builds fresh nodes, so node
  identity is unsafe.
- **Catch list.** `catches` is static per site: the lowering keeps a list of Catch record
  temporaries since the current `variableScope`. In sloppy direct-eval code at its top level,
  that list is prefixed by `$site.catches`. Strict sites pass `[]`, because the walk is empty.
  **This adds no tag to `DeclarativeEnvironment`**, whose layout is hot and shared.
- **Private names** are listed innermost first, and eval-code sites append `$site.privateNames`.
  The parser and binder receive the names; the lowering resolves each through its index in the
  same site.
- **Open type checks.** `PrivateName`, `DerivedConstruction` and the home type must already be
  surface roots, and the exact types of `home` and `activeConstructor` must match the lowering's
  expressions. Verifying both is R2.

### 6.2 Runtime helpers

- `instantiateDirectEvalDeclarations(lexical: EnvironmentScope, site: DirectEvalSite, plan,
strict): "none" | "syntax" | "type"`, in `eval-declarations.ts` beside the global helper:
  1. If `!strict`, run the intervening walk (§2) from `lexical.outer` to `site.variables`. It
     skips object nodes and exempts `site.catches`. Any hit is `"syntax"`. Reaching `undefined`
     is an invariant throw.
  2. Run the walk for each Annex function and set `admitted = false` on each hit.
  3. Delegate:
     - if `variables` is global (or `strict`), call the existing `instantiateEvalDeclarations`
       with the filtered plan; its global lexical and TypeError checks keep their spec order
       after the walk;
     - otherwise run a declarative branch: create lexical bindings; then functions with
       `createMutableBinding(name, true)` and `initializeBinding`, or `setMutableBinding` when
       the name exists; then vars initialized to `undefined` if absent; then Annex vars. It
       never returns `"type"`.
- **Guard.** `callEvalCandidate` gains a trailing `site: DirectEvalSite` parameter. The string
  branch becomes `realm.directEvalCompiler?.(source, site, strictFlag)`, or rejects as
  unsupported when the slot is unset. The ordinary and non-string branches stay exactly as
  they are.

### 6.3 Parser and binder context entry (no grammar change)

- `parseEvalScript(source, {strict, newTarget, superProperty, superCall})` seeds the parser's
  existing flags (`parser.ts:250-252`). When `strict`, it starts in strict mode, which matches
  `strictCaller`.
- `bindEvalScript(script, {privateNames, fieldInitializer})` seeds `privateScopes` and
  `restrictedArguments` in `bindProgram`.
- **Early errors.** All four are SyntaxErrors in `evalRealm`, the caller's realm (`$errors`
  through the engine evaluator for that realm). Report them through the existing
  `EARLY_ERROR → createRuntimeError(realm, "syntax")` path.
- **Census.** These are exported entry points, so add them to the parser public-API census;
  they are not lowering vocabulary.

### 6.4 Lowering

**Caller side.** `invokeEvalCandidate` builds the site with `object([...], …,
named("DirectEvalSite"))` from current state: `scope`, `variableScope`, the Catch list,
`receiver` (`undefined` when `derivedContext` is set), `derivedContext`, `activeConstructor`,
`home`, `newTarget`, the private-name list and the flags.

Flags are static for function and Script code. In direct-eval code outside any nested function
they are `$site.flags`. `inFunction` is true when an enclosing non-arrow `callable` exists;
`inMethod` when `home !== undefined`; `inDerived` when `derivedContext !== undefined`. Field
initializers need a new `CallableOptions.fieldInitializer`, propagated to arrows.

**Eval side.** `lowerDirectEvalScript(script, sourceText, context)` is a fourth entry kind,
`"direct-eval"`. It differs from indirect eval in exactly these points:

- `const $site` is read from `$script.directEval` and narrowed;
- `$evalLexical` is created over `$site.lexical` instead of over the global scope;
- initial state: `variableScope` is `$site.variables` (sloppy) or `$scope` (strict);
  `receiver` and `newTarget` come from the site; `derivedContext`, `activeConstructor` and
  `home` are narrowed site fields only when the context says so; `privateScopes` is seeded from
  site indices; `functionDepth` stays 0, so `return` remains an early error;
- declarations call `instantiateDirectEvalDeclarations($scope, $site, plan, strict)`;
- B.3.2.3 runtime copies write to `variableScope`: the existing global write path, or
  `setMutableBinding` on the narrowed `variableScope.declarative`.

### 6.5 Engine service (`script-evaluation.ts`)

`createDirectEvaluator(context, host)` returns `(source, site, strictCaller) => unknown`. It
reuses `createEntryRunner`:

1. Run the sticky and domain checks.
2. Call `parseEvalScript` with the site flags; a syntax failure throws the realm's SyntaxError.
3. An empty body returns `undefined`.
4. Call `bindEvalScript`, then `lowerDirectEvalScript`.
5. Call `run(lowered, carrier)`, where the carrier is `createScriptRecord`-equivalent with
   `hostDefined` set to the active context's `scriptOrModule` and `directEval: site`.
6. Map the completion as the indirect path does: none → value, throw → rethrow,
   unsupported → sticky.

The context-leak check applies unchanged.

## 7. Slices (red first; one commit each; inspect every exit status)

**DE0: environment shape and variable tracking. This is the exact first slice: lowering only,
with no vocabulary, runtime or surface change.**

- **Binder** (`typescript/src/binding/index.ts`). Add an optional
  `BoundModule.directEvalOwners?: readonly {owner: Span | undefined; parameters: boolean}[]`.
  - At `case "call"` (`:896`), record the current function owner (`undefined` for Script) when
    the call is a direct-eval candidate. Use the same predicate as the lowering's
    `directEvalCandidate`, moved to a shared exported `isDirectEvalCandidate` in
    `typescript/syntax` so the two cannot drift.
  - Arrows are their own owners.
  - Set `parameters: true` when the call is inside that function's parameter list.
- **Lowering** (`callable()`). Set `evalBody` and `evalParameters` by matching the owner span,
  as annex copies do at `:1290-1300`.
  1. Add state `variableScope: Expression` and `catchRecords: Expression[]`. Save and restore
     them in `callable()`, class bodies and catch. Initialize from the entry:
     - Script: `$scope`;
     - indirect eval: a new `$globalScope` temporary when sloppy, `$scope` when strict;
     - dynamic function: `$scope`.
  2. **Parameter phase** (`!codeStrict && separate && evalParameters`). Create `$paramVar` with
     `createDeclarativeEnvironment` and set `capturedParamScope = createDeclarativeScope(
capturedScope, $paramVar)`. Put `parameterRecord` over it, and set
     `variableScope = capturedParamScope` while the parameters lower.
  3. Otherwise `variableScope` is the parameter scope, which matches spec `env = envRecord`
     when there are no parameter expressions.
  4. **Body split** (`!codeStrict && evalBody`). Pass `lexical: []` in `bodyPlan`, and set
     `variableScope` to the scope returned by `instantiateFunctionBody`. Then emit
     `createDeclarativeEnvironment` and `createDeclarativeScope`, and for each body lexical
     declaration call `createMutableBinding` or `createImmutableBinding`. All of these helpers
     exist today. Body function declarations then instantiate over the lexical scope, as
     FunctionDeclarationInstantiation requires; `annexVariableRecord` stays the var record.
  5. **Catch.** Push the catch `record` temporary onto `catchRecords` for the clause body and
     pop it afterwards.
- **Byte identity.** Code without candidates is unchanged. Pin all eight
  `runtime-surface.test.ts` corpus hashes and the eval-lowering normalized corpus unchanged.
  The surface stays at 122 entries.
- **Node structural tests** (`eval-lowering.test.ts`, red first). These are checks on lowering
  output:
  1. sloppy `function f(){let x; eval(s)}` has two body records and its lexical binding is
     outside the var record; the strict form has one;
  2. `function f(a = eval(s)){}` has the extra parameter-phase record (no candidate, or strict:
     absent);
  3. an arrow inside the body with a candidate splits only the arrow;
  4. there is no split when the only candidate is `eval?.(s)` or `(0,eval)(s)`;
  5. Annex B in a split function still assigns the var record.
- **Native.** Run one case added to `tools/verify-hosted-script-lowering.ts`, in main's serial
  queue, with an LLDB-contained build manifest. It must show that in candidate-bearing
  functions the closures, TDZ, `arguments` mapping and Annex B block functions are unchanged,
  while `eval(s)` stays sticky unsupported. **Native behavior of the extra records is
  unknown** until then.
- **Gate.** Rebuild with `pnpm build`, run the focused `node --test` files, then `pnpm check`.
  The frozen self-build is deferred to the DE4 batch, because DE0 alone has no conformance
  effect.

**DE1: runtime EDI generalization.** Add `DirectEvalSite` and
`instantiateDirectEvalDeclarations` (§6.1–6.2) after R1. Node tests in
`global-environment-eval-declarations.test.ts` cover:

- each intervening conflict and the Catch exemption (simple and pattern);
- parameter-record and `arguments` conflicts, and the object-scope skip;
- the global lexical check before CanDeclare TypeErrors, with no partial bindings on failure;
- deletable function vars and SetMutableBinding on existing names;
- strict-to-lexical behavior;
- Annex filtering across intervening `let`.

Then a native fixture of the helper, like `native-eval-declarations-v1`.

**DE2: site plumbing, behavior-neutral (the G1–G3 pattern).** The implementation-ready plan,
with the H5 view and N1, is [site plumbing](rt-eval-site-plumbing.md); it supersedes the bullets below.

- The lowering builds the site at every candidate.
- `callEvalCandidate` gains `site`, and its string branch stays sticky unsupported.
- The surface grows by `DirectEvalSite` (and `PrivateName` if R2 says so). Measure and re-pin
  the census; do not predict it.
- Node spies: a shadowed `eval` never sees the site, and site fields match the context
  (`this`, `new.target`, `catches` order, flags).
- Native: the site is built in sloppy, strict, parameter-default, catch, `with`, generator and
  async callers, all still sticky. Native is **unknown** for allocating this record in
  continuation closures.

**DE3: parser and binder context entries (§6.3).** The implementation-ready plan is
[context parsing](rt-eval-context-parsing.md); it supersedes the bullets below. Node tests:

- `new.target`, `super.x` and `super()` per flag;
- `arguments` in field initializers, including nested arrows but not nested functions;
- an outer `#x` that is accepted, versus an unknown `#y`;
- a strict caller that forces strict mode, including octal escapes and `with` as SyntaxErrors.

**DE4: enable sloppy and strict string eval without class capabilities.** Service and host-routing plan: [host integration](rt-eval-direct-host-integration.md).

- `lowerDirectEvalScript`, `createDirectEvaluator`, the `directEvalCompiler` slot and the
  frame field (H2, or H2′).
- Sites with `home`, `derived`, private names or a field initializer stay sticky unsupported.
- Test262 host wiring gated by a capture marker (`createDirectEvaluator`), following IE7 and
  FN2: a new adapter label, with older frozen images keeping their labels.
- Native acceptance, in a new verifier: a function-scope var visible to AOT and JIT closures
  after 32 MiB of churn; the parameter-default shapes (`fn-body-cntns-arguments-*`,
  `a = eval("var a")`); intervening `let`/block/`for`/`catch` conflicts; `with`-object `eval`
  direct, `(0,eval)` and `eval?.()` indirect; strict callers and directives; `cptn-*`
  completions and empty source; nested eval appending the Catch list; eval-created functions
  keeping their source slice and the caller's ScriptOrModule in a queued job; fresh template
  sites per call; caller-realm errors.

**DE5: class capabilities.** Implementation-ready DE5a plan and DE5b direction: [class capabilities](rt-eval-direct-class-capabilities.md). Enable `this` in derived constructors (TDZ before and after
`super()`), `super()` in eval (including a double-`super` ReferenceError), `super.x`, `#x`
and field initializers. Cover a static-block `eval("arguments")` per spec text (R5).

**DE6: conformance.** Run unchanged complete reruns of `language/eval-code/direct` (286 files)
and `annexB/language/eval-code/direct` (309), each against a fresh pre-change baseline. Then
re-run `language/arguments-object` (last 456/460) and the LANG-CORE clusters attributed to
eval. Store new immutable reports and update the dashboard only after complete reruns.

## 8. Semantics checklist (tests must pin each)

- **Ordering.** The callee is read, then the arguments (each abrupt), then the identity test,
  then the site, then the parse. A SyntaxError happens before any binding. Conflict
  SyntaxErrors come before global TypeErrors, and nothing is partially created on failure.
- **Sloppy var injection.** Vars go into the caller's var record (function body or parameter
  record, `$paramVar` in a parameter default, global for Script or indirect eval, the same
  record for nested direct eval). They are deletable; existing bindings are kept, with
  SetMutableBinding for functions.
- **Strict.** Either side being strict gives an own var record that does not leak. Strict
  callers include class code, modules (later) and directive prologues.
- **Environments.**
  - The eval lexical record is always fresh, so `let` never persists.
  - A function declared in eval closes over the eval lexical scope.
  - Arrows inside eval inherit `$site` state; nested ordinary functions reset it.
- **`arguments`.** It resolves by name and needs no site field. In parameters, `var arguments`
  is a SyntaxError when `argumentsObjNeeded` (non-arrow), which differs from V8.
- **GC and reflection.** The site and its scopes are reachable only through the carrier
  during the call and through closures afterwards. Eval-created functions report slices of the
  eval string; `Function.prototype.toString` and debug spans are otherwise unchanged.
- **Jobs.** Promise jobs and async continuations created by eval capture the caller's effective
  ScriptOrModule (the IE invariant) and the caller realm.
- **Cross-realm.** A realm-B `%eval%` called by name from realm A is not SameValue, so it takes
  the ordinary call: indirect eval in B. This is unchanged.

## 9. Native unknowns (do not claim until observed)

1. The record-layout cost of `DirectEvalSite` and the `ScriptRecord` field in the reified
   directory, and the compile-time growth of the surface.
2. Object-literal construction of a named record type with function-typed and union fields in
   **JIT-compiled** caller code. AOT is believed fine; JIT is unproven.
3. Whether the narrowing of `$script.directEval` survives `optimizeModule`/prune unchanged.
4. Whether sites built inside generator and async continuations retain the scope temporaries.
5. Per-eval compile latency and arena use under loops of direct eval (no code cache: instance
   records are per parse). Measure them; exhaustion stays unsupported.

## 10. Decisions, risks and non-goals

- **Decided here:**
  - the split is gated on a syntactic candidate owned by that function;
  - Catch membership is a static per-site list, not a record tag;
  - flags and capabilities are static at eval compile, read from the site;
  - class capabilities are explicitly unsupported until DE5.
- **Risks.**
  - DE0 changes AOT output for candidate-bearing functions in Test262 harness and test files,
    including existing passes in `arguments-object` and `function-code`. Re-run them in DE6.
  - The V8 discrepancies (§3) can mislead fixture authors.
  - H2 deepens the ScriptRecord pun until H2′ is done.
- **Non-goals:** an eval code cache, module-goal eval, `HostEnsureCanCompileStrings` beyond
  today's vacuous hook, and any change to indirect eval, Function or the guard ordering.

## 11. Focused follow-up research tasks

- **R1.** Can the native self-host compiler and checker admit a type-only intra-package cycle
  `objects/jobs.ts` ↔ `environments/global` (and `objects/errors.ts`)? Read the module graph
  ordering in `compiler/src/project.ts` and the checker. Run a `/tmp` Node probe using `dist`.
  Decide between H2 and H2′. Researched in [site carrier](rt-eval-direct-site-carrier.md): a checked `hostDefined` view (H5) avoids the cycle.
- **R2.** Exact static types of `home`, `activeConstructor` and `PrivateName` in lowered output.
  Are they current surface roots? What does adding `DirectEvalSite` do to the census?
- **R3.** How do class-scope envs (class name binding) and named function-expression envs sit
  relative to `variableScope` in current lowering? Confirm that only strict paths reach them.
- **R4.** Test262 expectations for the two V8 discrepancies (destructured catch,
  `var arguments` in non-arrow parameters). Settle them from unchanged test sources, and
  annotate the files without running anything.
- **R5.** Static-block `eval("arguments")` and `new.target` per current spec text
  (ClassStaticBlockDefinitionEvaluation), and Test262 `static-init-*` expectations.

## 12. Next focused planning task (not started)

**R1 + DE0 refinement.** Resolve the H2/H2′ module-cycle question with source reading and a
`/tmp` probe. Then turn DE0 into exact red-first test text and expected lowering diffs:

- which `callable()` lines move;
- the binder field name;
- the shared candidate predicate's home;
- the one native script-lowering case and its expected exit states.

Research only; no implementation.
