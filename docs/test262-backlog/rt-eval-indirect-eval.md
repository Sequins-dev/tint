# RT-EVAL S3-ie1: indirect string `eval`

Status: **IE1 implemented and natively validated.**
[Eval declaration instantiation](../results/native-eval-declarations-v1.json) passes
its native fixture and seven semantic tests. The production Script evaluator and
[seven-case Test262 host integration](../results/native-test262-script-service-validation-v1.json)
are also implemented; unchanged `$262.evalScript` conformance selections are running.
IE2/IE3 direct-call guards [pass natively](../results/native-test262-eval-guard-validation-v1.json),
including code compiled through `$262.evalScript`. Indirect string `eval` remains disabled until
those guards and eval-specific environment/Script identity handling are complete.

The research below was captured before those prerequisites landed. Parent:
[RT-EVAL](rt-eval.md) S3. This plan covers indirect string eval and the call-site guard;
direct eval and general `Function` bodies remain separate work.

**Capture.** 2026-11-04, live source of 542 `packages/*/src` files. `dist` is newer than `src`
for `typescript`, `source`, `js-runtime`, `js-engine` and `compiler`. The Test262 checkout is at
`91c70759…`. The S2-e1 header now reports that preparation and lowering are implemented
(`prepareManagedJitProgram`, `lowerManagedJitProgram` and `verifyManagedJitFrame` in
`compiler/src/native/managed-jit-program.ts`). Emission, publication, `createScriptEvaluator` and
`compileScriptEntry` **do not exist** (searched). The newest fixed point
([checkpoint](../results/runtime-link-budget-selfhost-checkpoint-v1.json): identical 69,795,666-byte
stages, source `f712b107…` with 541 files) predates this plan and S2.

**Probes** (read-only Node scripts in `/tmp/tint-indirect-eval-plan`): `i1` population (tint
parser plus `syntaxVariants`), `i2` text-match scan outside the selections, `i3` class-element
files, `i4` Script parse/bind/lower outcomes, `i5` V8 reference (Node v24.12.0 through
`tools/test262-run.ts`), `i6` call-site AST shapes, and `spec/` (ECMA-262 2027 draft pages). They
import `dist` or `tools/` by absolute path and write only to `/tmp`. **No result here is native
evidence.** I ran no build, emission, native process or queue action, and touched no pause
marker, journal, snapshot or report.

## 1. Answer in brief

1. **The acceptance population is three unchanged selections: 296 Script variants plus 2 module
   variants** (§3). Four variants also depend on direct string eval and must stay `unsupported`.
   **That leaves 292 indirect-only variants. No pass count is forecast.**
2. **Indirect eval is ScriptEvaluation-shaped work on the S2 entry, with three differences:**
   EvalDeclarationInstantiation (EDI) replaces GDI; a fresh declarative lexical environment sits
   over the global environment; and ScriptOrModule is **inherited**, not fresh. Realm, global,
   `this` and strictness come from the **eval function's realm** and the eval text's own
   directive prologue. The caller contributes its effective active ScriptOrModule identity; the spec's indirect-eval context field itself is null.
3. **Blocking hazard found: Tint lowers every `eval(...)` as an ordinary call** (`index.ts:2311-2337`;
   no direct-eval detection exists in `packages/`, searched). If the intrinsic's string path were
   simply enabled, every syntactic direct eval would silently run with indirect semantics. S3
   must therefore first lower direct-eval candidates to `callEvalCandidate` (§5.1):
   - non-string and no-argument direct calls follow the spec exactly;
   - string direct calls stay `rejectUnsupportedExecution` until S5.

   One extra shape matters: `eval(x)?.y` is a direct eval at the base of an optional chain
   (probe `i6`), and `optionalChainValue` would also call it ordinarily.

4. **The existing frame and surface can carry inherited ScriptOrModule without a second
   directory** (default D1). The eval entry keeps `execute($global,$script:ScriptRecord)`. The
   evaluator passes a per-call carrier `createScriptRecord(evalRealm, inherited)`. The eval
   lowering reads `$errors=$script.realm` and `scriptOrModule=$script.hostDefined`. A directory
   has exactly one `frame` (`managed-directory-data.ts:38,380-402`), so a separate eval frame
   would need a second surface (Q1).
5. **First slice: IE1** (§7), `instantiateEvalDeclarations` with Node tests. It needs only
   landed runtime code and is independent of S2.

## 2. Specification (primary text, ECMA-262 2027 draft, re-read for this plan)

| Clause                        | Rule S3 keeps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19.2.1 `eval(source)`         | `PerformEval(source, false, indirect-eval)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 19.2.1.1 PerformEval          | (2) For an Object, `HostGetCodeForEval` (default: no-code). A non-String result returns `source` unchanged, without ToString. (3) `evalRealm` = current Realm, which is the eval function's realm. (5) `HostEnsureCanCompileStrings`. (11) ParseText as Script; errors → SyntaxError. Empty body → `undefined`. Indirect: `inFunc`/`inMethod`/`inDerivedCtor`/`inClassFieldInitializer` are all false. `strictEval` = ScriptIsStrict. `lexicalEnv` = NewDeclarativeEnvironment(evalRealm.[[GlobalEnv]]). `variableEnv` = GlobalEnv, or `lexicalEnv` if strict. `privateEnv` null. evalContext: Realm = evalRealm, ScriptOrModule = **runningContext's**. Run EDI, then the body. Empty completion → `undefined`. Pop the context on every completion |
| 10.3.3 BuiltinCallOrConstruct | The callee context has ScriptOrModule **null**. 9.4.1 GetActiveScriptOrModule returns the topmost non-null one, so code created by indirect eval observes the **caller's** Script/Module, even cross-realm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 19.2.1.4 EDI (global var env) | Sloppy: for each VarDeclaredName, `HasLexicalDeclaration(global)` → SyntaxError. The intermediate-env loop is empty for indirect eval (`lexicalEnv.[[OuterEnv]]` is the global env). Functions in reverse with dedupe: `CanDeclareGlobalFunction` false → TypeError. Vars: `CanDeclareGlobalVar` false → TypeError. **All checks precede mutation.** Then lexicals (const immutable strict, let mutable) go into `lexicalEnv`. Functions are instantiated over **`lexicalEnv`**, then `CreateGlobalFunctionBinding(…, true)`. Vars use `CreateGlobalVarBinding(…, true)`. Strict: no global checks; vars and functions become **deletable** bindings in `lexicalEnv`                                                                                 |
| B.3.2.3 (inside EDI)          | Sloppy only. A block function is admitted if the var replacement causes no early error, `HasLexicalDeclaration` is false, and `CanDeclareGlobalVar` is true. Then `CreateGlobalVarBinding(F, true)` runs **before** lexical instantiation. At evaluation, `SetMutableBinding` on the var env (the global env)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 13.3.6.1 call evaluation      | Only `MemberExpression Arguments` (CoverCallExpressionAndAsyncArrowHead) can be direct. `ref` must be a non-property Reference named `"eval"` (StringValue, so `\u0065val` counts; parentheses keep the Reference; `with`-object refs are environment refs). `func` is read **before** the arguments. If SameValue(`func`, %eval% of the **running** realm) holds, ArgumentListEvaluation runs; an empty list → `undefined`; otherwise PerformEval(first, IsStrict, direct). Anything else is EvaluateCall. `(0,eval)()`, `x.eval()`, `eval?.()`, `` eval`x` `` and aliases are never direct                                                                                                                                                         |

Host choices the Test262 host may make: `HostEnsureCanCompileStrings` always permits, and
`HostGetCodeForEval` is the default (no-code). Both are therefore no-ops, and S3 adds no hook (D6).

## 3. Acceptance population (probes `i1`, `i3`, `i5`; Node-only)

Variants follow the existing `syntaxVariants` policy (`tools/test262.ts:71-77`). A strict
variant prefixes only the test file. Indirect eval text is sloppy unless it has its own
directive.

| Selection                            | Files | Variants                                                       | Mixed direct dependency (stays `unsupported`)                         | Notes                                                                                                                     |
| ------------------------------------ | ----- | -------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `language/eval-code/indirect`        | 61    | 118: 57 both modes, 1 `onlyStrict`, 1 `noStrict`, **2 module** | `global-env-rec-eval.js` (2): a direct eval contains the indirect one | `parse-failure-2.js` is runtime-negative SyntaxError (2). `realm.js` uses `createRealm` (2). Module rows stay unsupported |
| `annexB/language/eval-code/indirect` | 160   | 160 sloppy (`generated,noStrict`)                              | none                                                                  | B.3.2.3 global shapes. Each eval string calls the harness through the global                                              |
| `built-ins/eval`                     | 10    | 20                                                             | `private-identifiers-not-empty.js` (2): direct `eval("o.#f")`         | 8 files test only intrinsic properties                                                                                    |
| **Gating total**                     | 231   | **296 Script + 2 module**                                      | **4**                                                                 | 292 indirect-only Script variants                                                                                         |

**Baselines.**

- `built-ins/eval`: [eval-family v1](../results/test262-eval-family-native-v1.json) (adapter v4)
  has **18 pass and 2 unsupported** (the direct file).
- `annexB/…/indirect`: the v9 prefix has **158 unsupported and 2 crash**. Both crashes are
  pre-entry LLDB attach failures (`global-switch-dflt-eval-global-skip-early-err-{for,switch}`),
  which is INFRA, not evaluation.
- `language/eval-code/indirect`: **no native report exists**, so IE7 records a baseline first.
- Context, not a forecast: v9 passes 133 `annexB/language/global-code` variants. Those exercise
  the same Script Annex-B binder and `setGlobalBinding` path that sloppy eval reuses.

**V8 reference (`i5`; not Tint).** 108/118, 160/160 and 20/20; the 2 module rows are
unsupported in that adapter. The 8 failing variants are V8 vm-context discrepancies, checked
against the spec text: `non-definable-function-with-{function,variable}` (all checks precede
mutation, so nothing is defined; §5.3), `var-env-func-init-global-update-configurable` (an
existing configurable property becomes `{w,e,c:true}`; `createGlobalFunctionBinding`,
`environments/global/record.ts:175-210`) and `var-env-var-init-global-exstng` (an existing
property is unchanged; `createGlobalVarBinding`, `record.ts:149-173`).

**Observed, non-gating.** `language/{statements,expressions}/class/elements/*indirect-eval*` has
80 files and 152 variants with no direct sites (`i3`); they need class fields and are observed
only in the next complete class-elements rerun. About 226 other files match coarse text patterns
(`i2`, a dependency signal only). `tagged-template/cache-*-eval*` and `language/eval-code/direct`
use **direct** eval and belong to S5.

## 4. Present versus planned

| Piece                                                                                                 | State                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `installEvalIntrinsic`: non-strings returned, strings rejected (`objects/global-properties.ts:21-39`) | Present; [native fixture](../results/native-eval-intrinsic-v1.json) passes (direct non-string)                                                             |
| Builtins push a realm context with the effective active identity                                      | Present. During the eval call, the active realm is the builtin's and the effective Script identity is inherited; the spec field is null                    |
| `instantiateGlobalDeclarations` and the GDI plan shape (`environments/global/declarations.ts`)        | Present. Reused **plan shape** only                                                                                                                        |
| `createDeclarativeEnvironment`/`createDeclarativeScope`/`createGlobalScope` in the vocabulary         | Present (`runtime-imports.ts`)                                                                                                                             |
| Script early errors equal to indirect-eval early errors (`i4`)                                        | Present: `new.target`, `super`, `return`, `continue` and `x\n++` give parse `SYNTAX_ERROR`; `#f` and duplicates give `EARLY_ERROR`; `arguments` is allowed |
| `import()` in eval code                                                                               | `lowerScript` UNSUPPORTED (`i4`) → unsupported                                                                                                             |
| Direct-eval call-site detection, `realm.evalFunction`, `realm.evalCompiler`, EDI, `lowerEvalScript`   | **Planned (this plan)**                                                                                                                                    |
| `createScriptEvaluator`, `compileScriptEntry`, Test262 evaluator wiring                               | **Planned (S2-ev1, main)**                                                                                                                                 |

## 5. Contracts and file edits (planned)

### 5.1 Direct-eval candidate guard (`js-runtime` and lowering)

`packages/js-runtime/src/objects/global-properties.ts` (exported from `objects/index.ts:228`):

```ts
/** 13.3.6.1 step 6 at a syntactic direct-eval site; callee and arguments already
 * evaluated in source order. Non-%eval% callees take the ordinary call path. */
export function callEvalCandidate(
  callee: unknown,
  receiver: unknown,
  args: readonly unknown[],
  realm: ErrorRealm, // running realm: the caller's $errors
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): { readonly error: "none" | "type"; readonly value: unknown } {
  if (realm.evalFunction === undefined || callee !== realm.evalFunction)
    return callObjectValue(callee, receiver, args, witness);
  if (args.length === 0) return { error: "none", value: undefined };
  const source = args[0];
  if (typeof source !== "string") return { error: "none", value: source }; // HostGetCodeForEval default
  return rejectUnsupportedExecution(realm); // S5 seam: PerformEval(source, strictCaller, direct)
}
```

`callee !== realm.evalFunction` is SameValue for objects. Lowering
(`packages/js-engine/src/lowering/index.ts`) uses one predicate:
`isDirectEvalCandidate(call)` = `call.kind==="call"`, `call.optional!==true`, and the callee with
groups stripped is `identifier "eval"`.

- In `case "call"` (`:2311-2337`), after `callTarget`, a candidate emits
  `objectRuntime("callEvalCandidate", [callee, receiver, args, id("$errors")])` and the usual
  `check`.
- In `optionalChainValue` (`:681-760`), the **innermost** step gets the same treatment when it is
  a non-optional call whose stripped `base` is `identifier "eval"`.
- Set a `usesDirectEval` flag and pass it to `scriptRuntimeImports`.

A Script without direct-eval sites gets byte-identical output.

### 5.2 Realm slots and the intrinsic (`objects/errors.ts`, `global-properties.ts`)

```ts
/** Embedding-owned indirect PerformEval (string already checked); JS cannot replace it. */
export type EvalCompiler = (source: string) => unknown;
// ErrorRealm, next to dynamicFunctionCompiler (errors.ts:70; initialized undefined at :319)
evalFunction: OrdinaryObject<ScriptPropertyKey, unknown> | undefined; // %eval%, set by installEvalIntrinsic
evalCompiler: EvalCompiler | undefined;
```

`installEvalIntrinsic` makes two changes:

- It sets `realm.evalFunction = evaluate`.
- Its string branch becomes
  `const run = realm.evalCompiler; return run === undefined ? rejectUnsupportedExecution(realm) : run(source);`.

`realm` is the closure's realm, which is the eval function's realm (19.2.1.1 step 3).
Non-string behavior is unchanged.

### 5.3 `packages/js-runtime/src/environments/global/eval-declarations.ts` (new; exported from `index.ts`)

```ts
/** EvalDeclarationInstantiation for a Global Environment variable env (indirect eval,
 * S5 at global level). `lexical` is the fresh eval LexicalEnvironment; the plan is the
 * Script plan shape. Admission precedes mutation; factories run after lexicals exist. */
export function instantiateEvalDeclarations<Key, Value>(
  record: GlobalEnvironment<Key, Value>,
  lexical: DeclarativeEnvironment<Value>,
  plan: GlobalDeclarations<Value>,
  strict: boolean,
): "none" | "syntax" | "type";
```

**Sloppy:**

1. Any `variables`/`functions` name with `hasBinding(record.lexical)` gives `"syntax"`.
2. Functions in reverse, deduped: `canDeclareGlobalFunction` false gives `"type"`.
3. Variables not in the function set: `canDeclareGlobalVar` false gives `"type"`; then dedupe.
4. Annex functions: set `admitted=false`; skip if there is a global lexical or `!canDeclareGlobalVar`;
   otherwise `createGlobalVarBinding(record,name,true)` if the name is undeclared, and
   `admitted=true`.
5. Lexicals go into **`lexical`**: `createImmutableBinding(…,true)` or `createMutableBinding(…,false)`.
6. Functions: `instantiate()`, then `createGlobalFunctionBinding(…,true)`; a non-`none` result gives `"type"`.
7. Variables: `createGlobalVarBinding(…,true)`.

**Strict:** steps 5–7 only, into `lexical`. Functions use `createMutableBinding(…,true)` plus
`initializeBinding`, or `setMutableBinding` if the binding already exists. Variables are created
only when absent and initialized to `undefined`. Annex functions must be empty in strict mode
(`throw "DECLARATION_INVARIANT"`).

There are no lexical-versus-global checks and no `hasRestrictedGlobalProperty`, unlike GDI.
**S5 handoff:** S5 adds the intermediate-scope loop (B.3.4 catch exemption) and non-global
variable environments as a new parameter. It does not fork the algorithm.

### 5.4 `lowerEvalScript` (`lowering/index.ts`; exported beside `lowerScript`)

```ts
export function lowerEvalScript(
  script: Module,
  sourceText: string | undefined,
  options: { readonly mode: "indirect" }, // S5 adds "direct" with a site
): ScriptLoweringResult;
```

Factor `lowerScript` into a private body lowering with a `mode: "script" | "indirect-eval"`.
Indirect mode changes exactly four points and nothing else:

| Point                   | Script                                         | Indirect eval                                                                                                                                   |
| ----------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `lexical` (`:128`)      | `$global.lexical`                              | `$evalLexical`                                                                                                                                  |
| `$scope` (`:4087`)      | `createGlobalScope($global)`                   | `const $evalLexical = createDeclarativeEnvironment(undefined); const $scope = createDeclarativeScope(createGlobalScope($global), $evalLexical)` |
| Instantiation (`:4157`) | `instantiateGlobalDeclarations($global, plan)` | `instantiateEvalDeclarations($global, $evalLexical, plan, <script.strict literal>)`                                                             |
| Entry (`:4262,4278`)    | `scriptOrModule: $script`                      | `$errors=$script.realm`, `scriptOrModule: $script.hostDefined` (D1)                                                                             |

Unchanged: the `execute($global:GlobalEnvironment, $script:ScriptRecord)` signature (so S2-e1
assembly and `ScriptEntryFrame` apply as they are), `receiver = $global.thisValue`, Annex copies
through `setGlobalBinding` (`:3946`; for sloppy eval the var env is the global env), `$completion`,
and template sites (a tagged template still yields "module initialization", so unsupported, D4).
Strictness is `script.strict` only; the caller is never consulted.

### 5.5 Indirect evaluator (`js-engine/src/script-evaluation.ts`, the S2-ev1 file)

```ts
export function createIndirectEvaluator(
  context: ScriptEvaluationContext, // {realm, global}; the eval function's realm
  host: ScriptEvaluationHost, // unchanged S2-ev1 host
): EvalCompiler;
```

It shares S2-ev1 steps 2–9 through one private `evaluateSource(context, host, source, kind)`,
with `kind` either `"script"` or `"indirect-eval"`. Exact algorithm:

1. The intrinsic has already returned non-strings.
2. Domain check, raw UTF-16 `createSourceTextView`, `parseScript` (never `parseStrictScript`). `SYNTAX_ERROR` or
   `LEXICAL_ERROR` → `throw createRuntimeError(realm,"syntax")` (eval realm); `LIMIT` or
   `UNSUPPORTED_SYNTAX` → unsupported.
3. `lowerEvalScript(module, source, {mode:"indirect"})`. `EARLY_ERROR` → realm SyntaxError;
   anything else → unsupported.
4. `host.compile(lowered)`. Failure → unsupported; nothing is published.
5. `inherited = realm.agent.activeContext?.scriptOrModule` (`undefined` if none);
   `carrier = createScriptRecord(realm, inherited)`, fresh per call; frame
   `{$imports: host.table(), $argument0: global, $argument1: carrier}`.
6. `host.invoke`, then `host.completion`: `none` → value; `throw` → rethrow the identical value;
   `unsupported` → `rejectUnsupportedExecution(realm)`; an anomaly → `fault()` plus unsupported.
7. No `drainScriptJobs` or `clearKeptObjects`.

Installation (`tools/test262-native.ts`, `createRealmHost`, right after `installEvalIntrinsic`
at `:359`):

```ts
realm.evalCompiler = createIndirectEvaluator({ realm, global }, scriptService);
```

This runs for every realm, including `createRealm` children, behind the S2-ev1 D7 capability.
Without the capability the slot stays `undefined`, so today's behavior is unchanged.

### 5.6 Vocabulary and surface impact

| Entry                         | Specifier                  | Type arguments              | Import condition |
| ----------------------------- | -------------------------- | --------------------------- | ---------------- |
| `callEvalCandidate`           | `@tint/js-runtime/objects` | `[]`                        | `usesDirectEval` |
| `instantiateEvalDeclarations` | `…/environments/global`    | `ScriptPropertyKey,unknown` | eval mode        |

`scriptRuntimeSurface()` (complete vocabulary) grows by exactly these 2 entries, the two
`ErrorRealm` fields change its reified record layout, and `evalCompiler` adds a
`(string)->unknown` field type. **Consequence:** the `scriptRuntime` directory digest and census (types, records, providers,
signature classes) change. Any test or fixture pinning S2-e1 or S2-ev1 census numbers must be
re-pinned in the same commit. The tests resolve aliases by export (S2-e1 risk 6), so no `$T`
literals move. This is main's coordination point (Q2).

### 5.7 Ownership, caching and lifetime

The `ScriptEntryFrame`, table, storage, arena, directory memo and fault flag are S2-ev1's,
unchanged: one evaluator closure per realm, one carrier per call, and permanently published code
(the arena is never recycled). **There is no code cache (D3).** Each PerformEval is a new parse and a new compile, so template
objects can never alias across evaluations. Tagged templates stay unsupported until per-parse
instance state exists (frame plan D5). A later cache keyed by `(kind, strict, source)` is sound
only for template-free entries, or with that instance state.

## 6. Semantic corner cases, order and abrupt completions

| #   | Input                                                                                                     | Required result                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `(0,eval)(o)`, `new String("1+1")`, a Symbol, `{toString(){throw}}`                                       | The identical value. No ToString call, no parse, compile count unchanged                                                                                                                                              |
| 2   | `(0,eval)()`                                                                                              | `undefined`                                                                                                                                                                                                           |
| 3   | `x.eval(s)`, `(0,eval)(s)`, `eval?.(s)`, `(eval)?.(s)`, `var e=eval; e(s)`                                | Indirect                                                                                                                                                                                                              |
| 4   | `eval(s)`, `(eval)(s)`, `((eval))(s)`, `\u0065val(s)`, `eval(...a)`, `eval(s)?.y`, `with({eval}) eval(s)` | Direct: guard → unsupported for a string; spec result for a non-string or empty list. `eval(s)(t)`: only the inner call is a candidate                                                                                |
| 5   | Realm-B `eval` reached through identifier `eval` in realm A                                               | Not SameValue to A's `%eval%` → ordinary call → **indirect in B**                                                                                                                                                     |
| 6   | Parse error or early error (`x\n++`, `continue;`, `new.target`, `super()`, `o.#f`, `let a; let a`)        | SyntaxError from the eval function's realm. No carrier, no context push, no publish. Runtime-negative `parse-failure-2`                                                                                               |
| 7   | Global `let L`, then `(0,eval)("var M; var L")`                                                           | SyntaxError before mutation; `M` is absent                                                                                                                                                                            |
| 8   | `"function p(){} function NaN(){} function q(){}"`                                                        | TypeError; `p` and `q` are absent (all checks first)                                                                                                                                                                  |
| 9   | Non-extensible global, `"var u"`                                                                          | TypeError                                                                                                                                                                                                             |
| 10  | `"let b=1; function f(){return b}"`, then `typeof b`                                                      | `b` does not persist; `f` stays a deletable global and closes over the eval lexical environment                                                                                                                       |
| 11  | `"typeof x; let x"`                                                                                       | ReferenceError from the eval-local TDZ                                                                                                                                                                                |
| 12  | `{let x='in'; (0,eval)('x')}`                                                                             | Reads the **global** `x` (`lex-env-heritage`)                                                                                                                                                                         |
| 13  | `'use strict'; var s; function g(){}`                                                                     | Neither appears on the global. Strict-variant callers do not make eval strict (`always-non-strict`)                                                                                                                   |
| 14  | `var v` / `function v(){}` when `v` is new, existing configurable, or existing non-configurable           | New: `{w,e,c:true}`. Configurable: a function replaces it with `{w,e,c:true}`, a var keeps it. Non-configurable: a function sets only the value (TypeError unless writable and enumerable), a var leaves it unchanged |
| 15  | Annex B `{ function f(){} }` sloppy                                                                       | Var created before body with `c:true`, value `undefined`, then set at block evaluation. Skipped when a global lexical exists, the global is not definable, or replacement would cause an early error                  |
| 16  | Completions `{}` `;` `var x=1` `if(false);` `do;while(0)` `switch(1){}`                                   | `undefined`. `1;{}` → 1; `x=1` → 1                                                                                                                                                                                    |
| 17  | `this`, from global or function callers                                                                   | The eval realm's `$global.thisValue`                                                                                                                                                                                  |
| 18  | A body throw                                                                                              | The identical value propagates. The context is popped (`runScriptContext` finally)                                                                                                                                    |
| 19  | Unsupported inside eval code, or a compile limit                                                          | Sticky `unsupported` on the **eval** realm, then `throw undefined`. Host realm checks keep `try/catch` tests from passing                                                                                             |
| 20  | Promise job or closure created by eval code                                                               | Observes the caller's ScriptOrModule (the carrier's `hostDefined`), with realm = eval realm                                                                                                                           |
| 21  | `(0,eval)("(0,eval)('1+1')")`                                                                             | 2. The evaluator is re-entrant, and nested contexts are restored                                                                                                                                                      |
| 22  | `import('x')` or a tagged template in eval code                                                           | Unsupported (lowering, or module initialization)                                                                                                                                                                      |

## 7. Red-first slices

Each slice: red tests → implementation → `pnpm build` → focused `node --test …` → `pnpm check`.
Slices touching only `js-runtime` or tests need no native step.

**IE1 (Node; independent now): EDI runtime.** New
`packages/js-runtime/test/global-environment-eval-declarations.test.ts` over a real
`createGlobalEnvironment`: §6 #7–#9 with the property map unchanged afterwards; deletable
descriptors and the #14 update rules; lexicals in `lexical`, absent from `record.lexical`; a
function factory reading a lexical created before it; strict (no global property, function/var
name sharing, annex invariant); annex admission and its three skips. Edits: the new file and the
`environments/global/index.ts` export.

**IE2 (Node): realm slots, routing, `callEvalCandidate`.** Extend
`ordinary-object-global-properties.test.ts` with a real `createErrorRealm`: `realm.evalFunction`
is the installed function; a string without a compiler gives sticky unsupported; a spy compiler
receives the identical string and its result is returned; non-string, object and empty inputs
never reach it. `callEvalCandidate`: a foreign callee and another realm's eval take the ordinary
call with the receiver preserved; a non-callable gives `{error:"type"}`; non-string and empty
lists return per spec; a string gives sticky unsupported with 0 spy calls. Edits: §5.2 plus the
`objects/index.ts` export. Re-pin any surface census test this moves (§5.6).
Refined against the landed production code in the
[direct-call guard plan](rt-eval-direct-call-guard.md) (G1–G3). That plan takes precedence for
the exact `callEvalCandidate` signature, the deferral of `evalCompiler`, the pins and the native
cases.

**IE3 (Node, lowering): candidate emission.** `lowering.test.ts`: each §6 #3/#4 shape; exactly
one `callEvalCandidate` per candidate and none for indirect shapes; `eval(s)?.y` guarded; a
Script without `eval` deep-equal to the pre-change output. `runtime-imports.test.ts` and
`runtime-surface.test.ts`: the conditional import, and the complete surface +2. Edits:
`lowering/index.ts` (§5.1) and `runtime-imports.ts`. Native (main's queue): rerun
`tools/verify-test262-native-eval-intrinsic.ts` unchanged (direct non-string cases), then a
frozen self-build with byte-identical stages, because a lowering file changed.

**IE4 (Node, lowering): `lowerEvalScript`.** Structural tests: only the four §5.4 points differ
from `lowerScript` on the same source (compare statement lists after normalizing them); the
strict literal follows the directive, including `i4`'s escaped-directive sloppy case; a tagged
template still emits a module-level site; `lowerScript` output is unchanged. Share IE3's
self-build when both land together.
Refined against landed code in the [eval lexical entry plan](rt-eval-lexical-entry.md), which
takes precedence for the four points, the ScriptOrModule carrier and the IE5 evaluator core.

**IE5 (Node; after S2-ev1 EV1): `createIndirectEvaluator`.** Extend EV1's spy host: §6 #6
SyntaxError from the **context** realm while a different realm is active, with 0 compiles;
`LIMIT` → unsupported; with an outer context, `frame.$argument1.hostDefined` is the active
`scriptOrModule` and `.realm === context.realm`; with none, `hostDefined` is `undefined`; fresh
carriers per call; EV1's completion mapping and fault seam; no job drain; `activeContext`
restored after a throwing invoke.

**IE6 (native; after EV4 passes): `tools/verify-hosted-indirect-eval.ts`.** Modeled on EV4 at
exact Test262 resources and the D3 arena; the fixture installs intrinsic plus evaluator per realm
and calls `%eval%` as a value. Statuses: (1) surface read, frame `ScriptEntryFrame`;
(2) `"var a=40; let b=2; function f(){return a+b} f()"` → 42, `a` configurable, `b` absent;
(3) #7/#8 with property-map snapshots; (4) strict #13; (5) parse and early errors give A's
SyntaxError with an unchanged publish count; (6) the #16 table; (7) `this` from a host function
frame; (8) non-string identity, 0 compiles; (9) realm B's eval under A's context: var on B's
global, B's errors, `nativeActive` sees realm B and scriptOrModule `r_A`; (10) a Promise job from
eval code sees `r_A` after the host drain; (11) nested #21; (12) `f()` → 42 after 32 MiB churn;
(13) tagged template → unsupported on realm C only; (14) wrong table → fault flag; (15) bytes per
compile and arena totals. Distinct statuses 20 context leak, 21 carrier reuse, 22 publish drift;
final 42; no retries.

**IE7 (Node + build; after EV5): wiring and Script-level guard proof.** `test262-native.ts` §5.5
install behind the capability; adapter label `native-script-v7-indirect-eval`
(`test262-native-run.ts:95,279`); red tests in `test262-native.test.ts` (the generated runtime
contains `createIndirectEvaluator` with the capability and is byte-identical without it). New
`tools/verify-test262-native-indirect-eval.ts` (`verifyNativeScriptCases`, real AOT-lowered
host): `(0,eval)` #10/#12/#17; direct `eval(7)===7` and `eval()===undefined`; separate cases
asserting `eval("1")`, `eval("1")?.y` and `with({eval}) eval("1")` end **unsupported**, never
completed. Update `docs/test262-runner.md` and `docs/native-code-loading.md`. Status and backlog
tables change only after the complete reruns (§8).

## 8. Unchanged native selections (main's serial queue; new immutable reports)

```sh
# baseline on the pre-IE7 snapshot (no saved report covers it)
node tools/test262-native-run.ts .tint-bootstrap/test262 language/eval-code/indirect 8
# after IE7, fresh capture
node tools/test262-native-run.ts .tint-bootstrap/test262 language/eval-code/indirect 8
node tools/test262-native-run.ts .tint-bootstrap/test262 annexB/language/eval-code/indirect 8
node tools/test262-native-run.ts .tint-bootstrap/test262 built-ins/eval 8
node tools/test262-native-run.ts .tint-bootstrap/test262 built-ins/Function 8   # shared-arena regression
```

Compare each variant with its §3 baseline and report the 292 indirect-only variants as pass /
fail / unsupported with reasons. **Blocking:** any pass → fail; any pass in the 4 mixed-direct
variants; `built-ins/eval` losing any of its 18 passes. Keep pre-entry INFRA crashes separate.
Observation only, not dashboard data: the class-elements files (next complete rerun) and
`language/eval-code/direct` (S5's baseline). The unchanged
[GeneratorPrototype.next v3 selection](../results/test262-generator-next-script-records-native-v3.json)
(27/28, one pre-entry timeout) does not use eval, so S3 does not rerun it.

## 9. Decisions, open questions and risks

**Defaults (main may take them without asking)**

| ID  | Default                                                                                                    | Rejected alternative                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| D1  | ScriptOrModule carrier (`hostDefined` = inherited value) through the unchanged `ScriptEntryFrame`          | A fresh record breaks 9.4.1 inheritance (the `jobs.ts:13-14` contract). A second frame needs a second surface            |
| D2  | Guard direct sites in S3; direct strings stay unsupported until S5                                         | Treating global-level direct eval as indirect is right only in some contexts, and a pass would come from an unsound path |
| D3  | No code cache; memoize only process inputs (S2-ev1 D5)                                                     | A source cache aliases template sites                                                                                    |
| D4  | Tagged templates in eval code are unsupported                                                              | Per-parse instance state is frame plan D5                                                                                |
| D5  | Errors come from the eval function's realm; the S2-ev1 taxonomy applies unchanged                          | —                                                                                                                        |
| D6  | No `HostEnsureCanCompileStrings`/`HostGetCodeForEval` hook; the Test262 host permits and uses the defaults | An unused hook                                                                                                           |
| D7  | Install the evaluator in `createRealmHost` beside `dynamicFunctionCompiler`, behind the S2-ev1 capability  | —                                                                                                                        |
| D8  | No separate eval arena or code budget; reuse S2-ev1 D3                                                     | —                                                                                                                        |

**Genuinely unresolved (owner: main)**

- **Q1.** Does main accept the D1 carrier pun on `ScriptRecord.hostDefined`? The alternative is a
  realm+ScriptOrModule entry frame, either as a second managed surface or as a directory with
  several frames. HOST-ESM needs one of these anyway once Module records exist, because
  `import()` in eval code resolves against the inherited Module record.
- **Q2.** Landing order of the §5.6 surface-shape changes relative to S2-e1/S2-ev1 census pins.
- **Q3.** Compile time and bytes per eval entry at Test262 resources. These are unmeasured: the
  only measured size is S2-e1's Node-only 103,872 B for a 12-function Script, and most eval
  strings are much smaller but carry the same import table. IE6 status 15 measures this.
- **Q4.** Should `realm.unsupported` carry a subreason (rt-eval §6.6) before IE7? Without one,
  reports cannot separate guard rows from compile limits. IE7's fixture is the guard proof in
  the meantime.

**Risks.** (1) Completion values become natively observable for the first time (rt-eval risk 5);
`$completion` UpdateEmpty is unverified natively. (2) Per-call compile latency, with up to 5
textual eval calls per file (`i1`), inside 60 s containment. (3) The shared arena can turn a
`built-ins/Function` pass into unsupported (§8). (4) IE3/IE4 need a frozen self-build, and
Scripts without eval must stay byte-identical. (5) Line anchors drift while main lands S2; re-run
`i4` and `i6` on the landing commit.

**rt-eval.md §5 correction.** Its "scriptOrModule = a fresh per-evaluation record" sentence is
superseded for eval by 10.3.3/9.4.1 and D1. That edit belongs to main.

## 10. Next planning task

Plan **S4-fn1: the general ordinary `Function` fallback.** It factors `callable()` into
`lowerDynamicFunctionImplementation`, adds the per-function lazy compile cache, and routes
`ensureCompiled` after the profiles. It reuses this plan's realm/frame/carrier decision (D1),
since CreateDynamicFunction also inherits ScriptOrModule, as well as S2-ev1's compile service.
Its acceptance comes from the 147 unsupported `built-ins/Function` rows. S5 direct eval follows
and takes over §5.1's string branch, §5.3's S5 parameter and the tagged-template cache tests.
