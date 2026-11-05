# RT-EVAL S5-de R1: direct-eval site handoff through the existing Script frame

Implementation status: the carrier-independent DE1 companion helper and linked
Catch type are implemented. All 4,059 workspace tests pass, including 19 declaration
tests and the R7 identity regression. The extended native helper fixture and both
indirect-eval controls pass; see the [checkpoint](../results/direct-eval-declarations-checkpoint-v1.json).
The typed H5 site/view passes the [native carrier fixture](../results/native-direct-eval-site-v2.json),
including descriptor rejection and GC retention.
Call-site plumbing passes the [14-case native batch](../results/native-test262-eval-site-validation-v2.json);
direct string eval remains unimplemented.

Research status: **plan only.** Parent: [direct environments](rt-eval-direct-environments.md) §5 and
§11 R1. This plan answers R1. It **replaces** the parent's §5 verdicts on H0 and H2/H2′. The
parent's site fields (§6.1) and slices (§7) stay valid except where §6–§7 below narrow them.

**Capture.** 2026-11-05, live source. DE0 is implemented: the shared `isDirectEvalCandidate`,
`BoundModule.directEvalOwners`, split body/parameter records, and `variableScope`/`catchRecords`
lowering state. The [checkpoint](../results/direct-eval-environments-checkpoint-v1.json) and the
[native verifier](../results/native-test262-direct-eval-environments-validation-v1.json) report
8 completed and 1 expected unsupported. Direct string eval stays sticky unsupported. No
`ScriptRecord`, frame or directory layout has changed.

**Evidence classes.**

- **[spec]** is draft ECMA-262 text, re-read today from `/tmp/tint-lexentry-spec/global-object.html`.
- **[src]** is live source, or unchanged Test262 sources under `.tint-bootstrap/test262`.
- **[probe]** is a read-only Node probe over built `dist` output. It runs parse, check and
  `lowerModuleEntries`, then `verify`. It emits no code and writes no file. The probes are in
  `/tmp/tint-direct-eval-site-view/{probe,bisect,chain}.mjs`. I did **not** rebuild `dist`, so the
  results reflect the last build.
- **[unknown]** has not been observed natively.

**Method.** I emitted no native code, ran no native process, and touched no queue, journal,
report, snapshot, manifest or active process. The only edits are this file and one cross-link.

## 1. Answer in brief

1. **The parent's H0 rejection was wrong.** `hostDefined: unknown` _can_ be narrowed to a
   concrete record. No cast is needed and no `objects` → `environments/global` import is needed.
   The compiler already authorizes single-argument record **views**: `bindRecordOperation(…,
"view")` replaces a stub body with `general-record-is` against the exact record descriptor.
   Two precedents ship in today's Test262 image:
   - `viewWeakRegistryOwner(value: unknown)`;
   - the host's `completion(value: unknown): ScriptCompletionRecord | undefined`. It already
     narrows a **JIT-allocated** record on the AOT side.
2. **Recommended carrier (H5):** the site record **is** the carrier's `hostDefined`.
   - `DirectEvalSite` and `viewDirectEvalSite(value: unknown): DirectEvalSite | undefined` live
     in `environments/global`. The view is a vocabulary helper and a compiler record binding.
   - The JIT direct-eval entry narrows `$script.hostDefined` once, **before** its `try`. It pushes
     `site.scriptOrModule` as the effective ScriptOrModule.
   - `ScriptRecord`, `ScriptEntryFrame` and the directory frame stay unchanged.
3. **Type flow (AOT → engine) needs no cycle.**
   - `callEvalCandidate` gains `flags: number, site: unknown`.
   - `ErrorRealm` gains `directEvalCompiler: ((source: string, flags: number, site: unknown) =>
unknown) | undefined`.
   - The engine passes `site` through `runner.run(lowered, site, false)`. Today's runner already
     stores its `identity` argument as `hostDefined` when `inheritActive` is false
     (`script-evaluation.ts:151-153`).
4. **Shape constraint [probe].** Array-typed site fields do not lower without a list runtime,
   and a standalone probe cannot supply one. Replace `catches: readonly DeclarativeEnvironment[]`
   with a linked `DirectEvalCatch` chain. Defer `privateNames`, `home`, `derived` and
   `activeConstructor` to DE5, behind an explicit capability flag.
5. **DE1 can land now, independent of the carrier.** Add a companion helper,
   `instantiateDirectEvalDeclarations(lexical, variables, catches, plan, strict)`. It takes
   scopes, not a site. Global and strict cases delegate to the unchanged
   `instantiateEvalDeclarations`, so the indirect ABI and its directory stay untouched.

## 2. What the existing view machinery guarantees [src]

| Fact                                                                                                                                                                                                                                   | Location                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `RecordOperation = "test" \| "view" \| "descriptor" \| "identity"`. A view lowers to `load` → `general-record-is(record)` → branch → `general-value(reference)` + `reference-wrap`, or `reference-none`                                | `ts-native/src/closure/lowering/record-bindings.ts:3,48-83`                                              |
| A binding requires: a top-level module function that is not imported, not a closure and has no receiver or parameter initializers; first slot `general`; result `optional-reference`; and a duplicate-free binding list                | `ts-native/src/closure/lowering/index.ts:2766-2810`                                                      |
| Single-parameter **result views** derive the record from the object member of the result union. Every present member must be mutually assignable with it and share `recordContracts.forType` layout; `undefined` is required           | same, `:2791`, `:2846-2872`                                                                              |
| Image builds bind views only for declared runtime modules (`"record bindings require a declared runtime module"`), and resolve them by linked export name                                                                              | `compiler/src/native/index.ts:533-572`                                                                   |
| Test262 image: `objectModule` is declared with `retainedExports: [viewObjectValue, viewSymbolValue, viewBigIntValue, viewWeakRegistryOwner?]`. The `test262-script-host` stub module declares `completion`. Both are bound as `"view"` | `tools/test262-native.ts:1306-1312,1358-1366,1396-1416,961-975`                                          |
| Gating precedent: the harness throws when a captured image exports the registry intrinsics but not its view                                                                                                                            | `tools/test262-native.ts:836-837`                                                                        |
| JIT code already calls a compiler-bound view (`viewObjectValue`) through the managed vocabulary                                                                                                                                        | `js-engine/src/lowering/runtime-imports.ts:81`                                                           |
| JIT record identity maps each JIT object type to a surface alias with `comparison.matches` (**structural**), so JIT-allocated vocabulary records carry the AOT descriptor                                                              | `compiler/src/native/managed-jit-program.ts:283-306`                                                     |
| Node tests replace `throw "UNBOUND_*"` view stubs with structural predicates through a module load hook                                                                                                                                | `js-runtime/test/ordinary-object-host-record-views.ts`; `js-engine/test/script-evaluation.test.ts:11-18` |

So the authority is the image's explicit `recordBindings` list, checked by the closure lowering
against the record contract. It is not a cast and not a structural JS object test. In native code
an ordinary JS object can never pass: it has the `OrdinaryObject` descriptor, not
`DirectEvalSite`'s.

## 3. Read-only probe results [probe]

These come from `lowerModuleEntries` with `{ recordBindings: [{ function: viewSite, operation:
"view" }] }`. The stand-ins `Scope`, `Rec` and `Derived` mirror the real types' representation
classes (records, optional records, `unknown`, `number`).

| Case                                                                                                                                                                                                                                             | Result                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| View-only, one field each: `unknown`, `Scope`, `Derived \| undefined`, `number`                                                                                                                                                                  | OK                                                                                                             |
| View-only, `readonly Rec[]`, `Rec[]` or `readonly Named[]` field                                                                                                                                                                                 | **REJECT** `record witness has no managed record layout`                                                       |
| Construct a record with an array field                                                                                                                                                                                                           | **REJECT** `object construction requires supported fixed field representations (type 26)`                      |
| Full parent §6.1 shape (arrays included)                                                                                                                                                                                                         | **REJECT** (type 28)                                                                                           |
| Chain shape `{scriptOrModule: unknown, lexical, variables: Scope, catches: CatchLink \| undefined, thisValue, newTarget: unknown, flags: number}`; construct it, box it into `Carrier.hostDefined: unknown`, view it, read `flags` and the chain | **OK**: `verify` passes; the bound build has exactly one `general-record-is`, with return `optional-reference` |
| View result `Carrier \| Site \| undefined`                                                                                                                                                                                                       | **REJECT** `record view result must match the witness type and layout`                                         |
| `for (let l = s.catches; l !== undefined; l = l.next)` in the probe module                                                                                                                                                                       | Checker **REJECT** `invalid property read`; write walks as `while` loops, as `scope.ts` does                   |

**Reading.** The array rejection comes from the standalone lowering, which has no `lists` runtime
bindings (`ts-native/src/scalar.ts:144`). In real images, lowered code already builds arrays of
records (the `instantiateFunctionBody` plans). So array fields are **not proven impossible**.
They do need a list-runtime element contract for `DeclarativeEnvironment<unknown>` in the managed
surface, which is a native unknown. The chain avoids that question entirely.

## 4. Handoff options compared

| Option                                                     | Layout changes                                                                                             | Cycle                                                           | Lowered-text churn                                | Verdict                                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| **H5: checked view of `hostDefined`**                      | `ErrorRealm` +1 slot (any option needs this); new surface records `DirectEvalSite` and `DirectEvalCatch`   | none; `objects` only gains `unknown`-typed slots                | candidate call sites (DE2) and the new entry kind | **Recommended**                                                          |
| H2: `ScriptRecord.directEval: DirectEvalSite \| undefined` | `ScriptRecord` for **every** carrier and Script identity                                                   | type-only `objects/jobs.ts` → `environments/global` → `objects` | none for existing entries                         | Superseded: pays a cycle and a global layout change for nothing H5 lacks |
| H2′: dedicated `ScriptEntryCarrier` in the frame slot      | frame `$argument1` type for all entries                                                                    | none                                                            | every entry and tool fixture                      | Fallback only if H5's native gates fail                                  |
| H3: second frame type                                      | directory `frame` becomes multi-valued (`managed-directory-data.ts:38,143`; `native/script-compile.ts:38`) | none                                                            | compile service and JIT entry                     | Rejected                                                                 |
| H4: realm side slot plus take-helper                       | `ErrorRealm`                                                                                               | none                                                            | small                                             | Rejected: mutable ambient channel with a reentrancy protocol             |

**The type-only cycle was not probed.** H5 removes the need, so R1's original cycle question is moot.

## 5. Identity semantics: carrier vs ScriptRecord

| Entry kind (static per lowered module) | `$argument1`                                                  | `$argument1.hostDefined` | Pushed `scriptOrModule`    |
| -------------------------------------- | ------------------------------------------------------------- | ------------------------ | -------------------------- |
| `script`                               | the fresh ScriptRecord (parse identity)                       | host data                | `$script`                  |
| `indirect-eval`                        | private carrier                                               | `active.scriptOrModule`  | `$script.hostDefined`      |
| `dynamic-function`                     | private carrier                                               | FN identity argument     | `$script.hostDefined`      |
| **`direct-eval` (H5)**                 | private carrier, `realm` = evalRealm (the caller's `$errors`) | **the site**             | **`$site.scriptOrModule`** |

- **The carrier never escapes.** It lives only in the AOT runner's frame. The pushed context
  holds `site.scriptOrModule`, so jobs, generators and errors inherit the caller's identity, never
  the site or the carrier. The site itself never becomes a JS value. It travels only through
  `unknown` helper parameters, the realm closure and `hostDefined`.
- **`site.scriptOrModule` is captured lexically by the caller's lowering**, using the entry's
  static identity expression: `$script` for Script code, `$script.hostDefined` for indirect eval
  and FN, `$site.scriptOrModule` for direct-eval code. [spec] PerformEval copies the running
  context's ScriptOrModule, and a function's context carries its own `[[ScriptOrModule]]`, so the
  lexical choice matches the spec.
- **R7 resolved.** Source functions capture their definition Script through
  `createSourceExecutionContext` (`objects/jobs.ts`) and restore it through the
  object-call protocol. Builtins preserve the effective active identity. The Node
  regression in `script-evaluation.test.ts` defines a function in Script A, calls it
  from Script B and then enters another realm's eval: the eval carrier correctly
  inherits A. No production fix is needed; the earlier grep missed this indirection.
- **The pun deepens.** `hostDefined` has a third per-kind meaning. Two things contain it: the
  meaning is fixed by the lowered entry kind, which is a compile-time constant, and only
  `createDirectEvaluator` produces direct-eval carriers.

## 6. Proposed contracts (nothing below exists)

### 6.1 `js-runtime/src/environments/global/direct-eval.ts` (new module, exported from `index.ts`)

```ts
/** Catch-clause records between a site's LexicalEnvironment and VariableEnvironment,
 * innermost first. Membership exempts a record from the EDI conflict walks (§8). */
export interface DirectEvalCatch<Value> {
  readonly record: DeclarativeEnvironment<Value>;
  readonly next: DirectEvalCatch<Value> | undefined;
}
/** Caller state for one direct eval call. Immutable; built eagerly at each candidate call. */
export interface DirectEvalSite {
  readonly scriptOrModule: unknown;
  readonly lexical: EnvironmentScope<ScriptPropertyKey, unknown>;
  readonly variables: EnvironmentScope<ScriptPropertyKey, unknown>;
  readonly catches: DirectEvalCatch<unknown> | undefined;
  readonly thisValue: unknown;
  readonly newTarget: unknown;
}
export function viewDirectEvalSite(value: unknown): DirectEvalSite | undefined {
  throw "UNBOUND_DIRECT_EVAL_SITE_VIEW";
}
```

- **`flags` is not a site field.** Its bits are strict, inFunction, inMethod, inDerived,
  inFieldInitializer and **unsupportedCapability**. The caller passes it separately, so the engine
  can parse without reading the site.
- **DE5 adds** `home`, `derived`, `activeConstructor` and a private-name chain as new fields, with
  a measured census re-pin. Until then, a site with any of them sets `unsupportedCapability`,
  which covers object-literal methods in sloppy code. Class code is strict anyway.
- **`environments/global` already imports `objects`**, so `ScriptPropertyKey` is legal there. The
  site is **non-generic**, so its `scriptRuntimeTypeArguments` entry is `[]`; `DirectEvalCatch`
  gets `["unknown"]`.

### 6.2 `objects` (no new import)

- `errors.ts`:
  - add `export type DirectEvalCompiler = (source: string, flags: number, site: unknown) =>
unknown;`;
  - add `ErrorRealm.directEvalCompiler: DirectEvalCompiler | undefined`, initialized to
    `undefined`.
- `global-properties.ts`:
  - add a write-once `installDirectEvalCompiler(realm, compiler)`, modeled on
    `installEvalCompiler` (`:51-58`);
  - `callEvalCandidate(callee, receiver, list, witness, realm, flags: number, site: unknown)`.
    Only its string branch changes: `realm.directEvalCompiler === undefined ?
rejectUnsupportedExecution(realm) : { error: "none", value: compiler(source, flags, site) }`.
- **Precedent and limits.** `DynamicFunctionCompiler` already takes an `unknown` parameter
  (`errors.ts:63-68`). Whether a JIT-originated record survives a **realm-slot closure call**
  boxed as `general` is [unknown] (§10, N2).

### 6.3 `js-engine`

- `script-evaluation.ts`: `createDirectEvaluator(context, host): DirectEvalCompiler`.
  1. Reject sticky when `realm.unsupported` or the `unsupportedCapability` bit is set.
  2. `ensureDomain`.
  3. `parseEvalScript(source, flags)` (DE3; until then only the non-class flag subset is accepted).
  4. Empty source → `undefined`.
  5. `lowerDirectEvalScript`.
  6. `runner.run(lowered, site, false)`.
  7. Map completions exactly as `createEntryEvaluator` does (`:198-208`).

  The engine **does not view the site**, so the view has one consumer.

- Lowering, kind `"direct-eval"`, emitted in `contextualBody` **before** `runScriptContext`:
  `const $site: DirectEvalSite | undefined = viewDirectEvalSite($script.hostDefined)`. When it is
  `undefined`, return the `"unsupported"` completion record.
  - **Why outside the `try`:** an unbound stub's thrown string then escapes `host.invoke` as the
    existing `invoke-threw` fault. Inside the `try` it would become a JS-visible `throw`
    completion.
  - Then `scriptOrModule: $site.scriptOrModule`.
- Caller side, in `invokeEvalCandidate` (`lowering/index.ts:647-670`): build the `catches` chain
  as nested `object(["record","next"], …, named("DirectEvalCatch"))`, innermost first. It ends in
  `undefined`, or `$site.catches` in sloppy direct-eval code. Then build the site with
  `named("DirectEvalSite")` and pass `flags` as a numeric literal, or `$flags` in eval code.
- Vocabulary adds `DirectEvalSite` and `DirectEvalCatch` (types), and `viewDirectEvalSite` and
  `instantiateDirectEvalDeclarations` (helpers). They are gated like `instantiateEvalDeclarations`
  under a `"direct-eval"` declarations mode. **Measure the census count; do not predict it.**

### 6.4 Image and harness (`tools/test262-native.ts`)

- Add a runtime `{ module: globalModule, namespace: "global-environment", retainedExports:
["viewDirectEvalSite"] }` and a record binding `{ module: globalModule, name:
"viewDirectEvalSite", operation: "view" }`.
- **Check first** that `request.runtimes` does not already declare `globalModule`. A duplicate
  fails at `compiler/src/native/index.ts:201`.
- Capture gate: wire `installDirectEvalCompiler` only when the snapshot exports
  `createDirectEvaluator` **and** `viewDirectEvalSite`. When the first is exported but the
  second is missing, throw at build time (the `:836` pattern). Older frozen images keep their
  adapter label and stay sticky unsupported.
- Node: extend `bindHostRecordViews` to replace `UNBOUND_DIRECT_EVAL_SITE_VIEW` with a structural
  predicate. This is **test-only**.

## 7. DE1: generalized EvalDeclarationInstantiation (carrier-independent)

**File.** `environments/global/eval-declarations.ts`, beside the unchanged
`instantiateEvalDeclarations`. `DirectEvalCatch` moves into DE1, because it is the helper's input
type.

```ts
export function instantiateDirectEvalDeclarations<Key, Value>(
  lexical: EnvironmentScope<Key, Value>, // node whose .declarative is the fresh eval lexical record
  variables: EnvironmentScope<Key, Value>, // running VariableEnvironment node (ignored when strict)
  catches: DirectEvalCatch<Value> | undefined,
  plan: GlobalDeclarations<Value>,
  strict: boolean,
): "none" | "syntax" | "type";
```

**Algorithm.** Steps 1–5 match [spec] EDI step by step; the Catch exemptions are the
Normative-Optional text, inline in the draft.

0. **Invariants.** `lexical.declarative` must be defined and `variables.object` must be
   `undefined`. `isGlobal(n)` means `n.declarative === undefined && n.object === undefined`.
   `same(n)` means `isGlobal(variables) ? isGlobal(n) : n.declarative === variables.declarative`.
   Records are compared, never nodes, because `createGlobalScope` creates fresh nodes.
1. **Strict.** Return `instantiateEvalDeclarations(lexical.global, lexical.declarative, plan,
true)`. The existing strict branch already uses `lexical` as the var environment. An Annex
   list here is an invariant violation, as it is today.
2. **Walk** from `lexical.outer` until `same(n)`. Reaching `undefined`, or a global node when
   `variables` is declarative, is an invariant throw.
   - Skip object nodes.
   - Otherwise, for each name in `plan.variables` and the `plan.functions` names: if
     `hasBinding(n.declarative, name)` holds and `n.declarative` is not in `catches` (identity
     scan), return `"syntax"`.
   - Starting at `lexical.outer` instead of `lexical` is equivalent, because the fresh record is
     still empty.
3. **Annex walk** (sloppy only). For each `plan.annexFunctions` entry, compute `bindingExists`
   with the same walk and the same Catch exemption. Set `admitted = false` on hits and keep the
   rest in a filtered list of the **same objects**, since lowering holds the references.
4. **Global `variables`.** Return `instantiateEvalDeclarations(variables.global,
lexical.declarative, { ...plan, annexFunctions: filtered }, false)`. Its `record.lexical`
   SyntaxError check, then its `CanDeclareGlobal*` TypeErrors, then its Annex
   `HasLexicalDeclaration`/`CanDeclareGlobalVar` gate, keep spec order.
   - The walk-before-global-lexical swap is unobservable: both outcomes are a SyntaxError from the
     same realm, with no side effects.
5. **Declarative `variables`** (`V = variables.declarative`). Nothing below can fail after
   mutation starts.
   1. Dedupe `functions` in reverse order and `variables` minus function names, as the global
      helper does, with no CanDeclare checks.
   2. Annex: for each filtered entry, if its name is not already declared and `!hasBinding(V, name)`,
      call `createMutableBinding(V, name, true)` and `initializeBinding(V, name, V.undefinedValue)`.
      Then set `admitted = true`. `funcDefinable` is always true for a non-global var
      environment.
   3. Lexical declarations go into `lexical.declarative`, uninitialized: const is
      `createImmutableBinding(…, true)` and let/class is `createMutableBinding(…, false)`.
   4. For each function in source order, call `value = instantiate()`. If `hasBinding(V)`, call
      `setMutableBinding(V, name, value, false)`; anything other than `"none"` is an invariant
      throw, because var records hold only initialized mutable bindings. Otherwise create a
      **deletable** binding and initialize it.
   5. For vars: if `!hasBinding(V)`, create a deletable binding and initialize it to
      `undefinedValue`.
   6. Return `"none"`.

- **The B.3.2.3 runtime copy** (`SetMutableBinding` on the running VariableEnvironment) is
  lowering work for DE4. It writes to `variableScope`, which is `$site.variables` in sloppy eval
  code.

**DE1 tests (red first).** Add them to `js-runtime/test/global-environment-eval-declarations.test.ts`:

- intervening `let`, `const`, class, block and for-head TDZ conflicts → `"syntax"`, with no
  partial bindings;
- a simple **and** a destructured catch, both exempt from both walks, while the catch _body's_
  `let` is not exempt;
- the object (`with`) scope skip;
- a parameter-record conflict;
- `arguments` in the parameter record → `"syntax"`;
- a global-lexical conflict ordered before a CanDeclare `"type"`;
- deletable eval vars and functions, and `setMutableBinding` on existing names;
- the strict path is identical to the existing helper;
- Annex filtering across an intervening `let` and a catch;
- the invariant throws for a wrong `variables` node.

Then one native helper fixture modeled on `native-eval-declarations-v1`, with LLDB and a build
manifest. The DE1 vocabulary stays unchanged until DE4 imports the helper.

## 8. Intervening-boundary semantics in current lowering [src] vs [spec]

| Boundary between eval lexical and VariableEnvironment | Lowering today                                                                                    | Spec                                                                                               | Status                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Block, switch and `for(let;;)` records                | declarative nodes                                                                                 | intervening                                                                                        | matches                                |
| `for (let/const x of/in E)` head TDZ                  | separate record while `E` lowers (`lowering/index.ts:3567-3579`)                                  | TDZ env is the running lexical env during `E`                                                      | matches                                |
| Catch parameter (simple **or** pattern)               | fresh record, pushed onto `catchRecords` before `initializePattern` (`:4068-4101`)                | "Environment Record for a Catch clause", any CatchParameter                                        | matches spec; V8 rejects pattern catch |
| Catch body block                                      | ordinary block record                                                                             | not a Catch-clause record                                                                          | matches (not exempt)                   |
| `with`                                                | object node                                                                                       | skipped                                                                                            | matches                                |
| DE0 body lexical record (sloppy candidate function)   | above the var record                                                                              | `lexEnv` over `varEnv`                                                                             | matches                                |
| Parameter record during a sloppy default with eval    | `parameterRecord` over `$paramVar` (`:1137-1149`)                                                 | `envRecord` over `calleeEnv`                                                                       | matches                                |
| `arguments`                                           | `instantiateScriptArguments` on `parameterRecord`, before parameter initialization (`:1215-1228`) | `argumentsObjectNeeded` stays true with parameter expressions even if the body has `let arguments` | **pin in DE4**                         |
| Class scope, heritage, computed keys, fields          | class code is strict                                                                              | strict eval, no walk                                                                               | n/a                                    |
| Named function-expression name record                 | outside the callee                                                                                | outside `varEnv`                                                                                   | never intervening                      |
| Indirect-eval entry `variableScope`                   | **provisional** `$scope` (the eval lexical node)                                                  | the global record                                                                                  | **must fix before DE2 emits sites**    |

**Test262 [src].**

- `func-decl-no-pre-existing-arguments-bindings-are-present-declare-arguments.js` and
  `func-decl-fn-body-cntns-arguments-lex-bind-declare-arguments.js` expect a SyntaxError for
  `f(p = eval("var arguments"))`, including when the body has `let arguments`. This confirms the
  spec over V8 and settles the second half of parent R4.
- A grep finds no destructured-catch test with a `var` from eval outside the parameter initializer
  (`scope-catch-param-var-none.js`). Tint therefore follows the spec text, with no Test262 pin.
- `var-env-lower-lex-catch-non-strict.js` requires `eval("function err(){}")` to be allowed in
  `catch (err)`.

**Spec discrepancies needing focused follow-ups:**

- **R6.** Pin the indirect-eval `variableScope` correction.
- **R7 resolved:** source-function definition identity is captured and restored (§5).

The parent's [spec] claim that B.3.2.3 uses the Catch exemption is **confirmed** in today's draft
text.

## 9. Ownership, GC and domain assumptions

- **Lifetime.** The caller allocates the site in the shared managed arena, in AOT or JIT code. It
  is reachable through:
  - the caller's temporary;
  - the guard and realm-closure arguments;
  - `carrier.hostDefined` while the runner's frame lives;
  - the JIT entry's `$site` local;
  - closures created by eval code that capture `$site`.

  There is no registry and no manual release.

- **Domain.** The site carries no domain of its own. `ensureDomain` runs before invocation,
  unchanged.
- **Realm.** The guard calls only the running realm's compiler (`$errors`). A site can never cross
  into another realm's evaluator, and cross-realm `%eval%` takes the ordinary call (parent §8).
- **Identity.** A view succeeds only on the exact `DirectEvalSite` descriptor. JIT-built sites get
  that descriptor through the structural alias match. A new vocabulary record that is
  **structurally identical** to `DirectEvalSite` or `DirectEvalCatch` would alias it, so a census
  test must forbid that (N5).

## 10. Failure modes and red-first native gates

| Failure                                           | Behavior under H5                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hostDefined` is not a site (runner bug)          | the entry returns the `"unsupported"` completion: sticky unsupported, not a JS throw                                                                   |
| View stub unbound in an image                     | the build fails through the capture gate; if bypassed, the thrown string surfaces as the `invoke-threw` fault, because the view runs outside the `try` |
| Node run without the hook                         | `UNBOUND_DIRECT_EVAL_SITE_VIEW` surfaces in tests, never silently                                                                                      |
| Older frozen image                                | `directEvalCompiler` is unset, so the guard stays sticky unsupported (today's behavior)                                                                |
| `unsupportedCapability` bit set                   | sticky unsupported before parsing                                                                                                                      |
| Site with an array or list field (DE5 temptation) | **[unknown]** list-runtime selection; use chains                                                                                                       |

**Gates.** Each is a new `tools/verify-hosted-*` fixture with `TINT_BUILD_ONLY=1`, a build
manifest, LLDB stop-at-entry, and asserted per-check exit codes. Run them in main's serial queue
**after** the active global-75, frozen self-build and conformance queues.

- **N1 (red until DE2 binds the view).** An AOT-built site in `createScriptRecord(realm,
site).hostDefined` views to the same identity and fields. `OrdinaryObject`, `ScriptRecord`,
  `ScriptCompletionRecord`, a string, a number and `undefined` all view to `undefined`.
- **N2.** Both directions across the JIT boundary:
  - a JIT entry builds a typed `DirectEvalSite`, returns it as `unknown`, and AOT views it;
  - an AOT site travels through the frame, and the JIT entry views it.
    Also pass a JIT site through an `ErrorRealm` closure slot whose parameter is `unknown`.
- **N3.** The site is reachable only through `carrier.hostDefined` across 32 MiB of churn inside
  the JIT entry. Then the chain, the scopes and `scriptOrModule` read correctly.
- **N4 (Node).** The harness refuses an image that exports `createDirectEvaluator` without the
  view.
- **N5 (Node).** No other surface alias structurally matches `DirectEvalSite` or `DirectEvalCatch`.

DE4's acceptance list (parent §7) follows once N1–N3 pass. If N2 or N3 fails, switch to H2′. Do
not add casts or side channels.

## 11. Decisions, risks and non-goals

- **Decided:**
  - H5 over H2;
  - linked `DirectEvalCatch` instead of arrays;
  - `flags` passed beside the site;
  - lexical `scriptOrModule`;
  - the view placed before the entry's `try`;
  - DE1 is scope-based and carrier-independent;
  - class, derived and private capabilities stay explicitly unsupported until DE5.
- **Risks:**
  - the third meaning of `hostDefined`;
  - structural alias matching;
  - the cost of an eager per-candidate site allocation, **unmeasured**;
  - the declaration of `globalModule` as a runtime.
- **Non-goals:**
  - changing indirect eval, FN, the frame or the directory;
  - an eval code cache;
  - module-goal eval.

## 12. Next focused planning task (not started)

**DE1 test-text plan plus R6.** Turn §7 into exact red-first test text for
`global-environment-eval-declarations.test.ts`: case names, input scopes and expected binding
maps. Specify the native helper fixture: its file name, its checks and its exit-code table. Also
give the exact lowering diff that makes indirect-eval `variableScope` the global node, with its
byte-identity impact on the eval-lowering corpus. Research only; no implementation.
