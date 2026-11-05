# RT-EVAL IE4/IE5: indirect-eval lexical entry and evaluator core

Status: **IE4/IE5 implemented and Node-validated; native acceptance pending.**
All 4,006 workspace tests, types, dependency boundaries and formatting pass.
The normalized eval-lowering corpus verifies exactly the lexical/declaration/context
changes; the ordinary Script hashes remain unchanged. The shared evaluator passes
cross-realm builtin, source-function and queued-job identity checks. The indirect
entry uses an explicit string-argument wrapper to preserve its native ABI.

`scriptRuntimeImports` now selects `"script"`, `"indirect-eval"` or `"all"`
declaration imports: each entry imports only its own helper, and the complete
managed vocabulary includes both. It has 121 entries/102 helpers and 28 generic
roots; collection aliases/providers/targets/slots/stubs stay 79/41/323/355/366.
No intrinsic or Test262 indirect-eval host wiring is enabled yet. A repeated
Annex B property-check trap in the frozen v6 conformance run is being diagnosed
before further execution paths are enabled.

Original research follows. This plan refines IE4 and IE5 of the
[indirect-eval plan](rt-eval-indirect-eval.md) against landed code. Where they disagree, this
plan takes precedence for: the `lowerEvalScript` API and its four lowering points, the
ScriptOrModule carrier, the shared evaluator core and its failure taxonomy, and the IE4/IE5
tests. IE6 (native) and IE7 (Test262) are hand-offs only (§8). Direct string eval stays
blocked, and the `evalCompiler` realm slot is **not** added here.

**Capture.** 2026-11-05, live source of 550 portable files. Landed and relied on:

- IE1 `instantiateEvalDeclarations`
  ([native fixture](../results/native-eval-declarations-v1.json));
- the S2-ev1 `createScriptEvaluator`;
- G1/G2/G3 `callEvalCandidate` and lowering.

The vocabulary has 120 entries (101 helpers). The census pins are anchors 79, collection keys
39, providers 41, targets 323, slots 355 and stubs 366. They are measured in
`tools/script-runtime-surface.test.ts:202-385` and `packages/js-engine/test/runtime-surface.test.ts:54`.

**Probes.** These are read-only Node scripts in `/tmp/tint-lexentry-probe`. `surf.mts` counts
the surface (120 entries, 114 plain Script imports). `parse.mts` runs `parseScript` on raw
UTF-16: `""` and comment-only text give 0 statements; a directive is a statement; an escaped
directive is sloppy. `sec.mjs` extracts clauses from the ECMA-262 draft of **2026-11-03**,
downloaded today to `/tmp/tint-lexentry-spec`. I ran no build, emission, native process, queue
action or edit outside this file and one cross-link.

## 1. Answer in brief

1. **Correction to the earlier plan.** The previous plan said indirect eval "inherits the
   caller's Script Record through the builtin". The current spec text is more precise:
   - `BuiltinCallOrConstruct` sets the builtin context's ScriptOrModule **field to null**.
   - PerformEval copies **that null** into `evalContext`.
   - Only `GetActiveScriptOrModule` (the topmost **non-null** field) yields the caller's
     record.

   The behavior anyone can observe is unchanged: functions, jobs and `import()` referrers see
   the caller's record. The field itself is not inherited, though (§2).

2. **Tint already stores the effective value, not the spec field.** `ScriptExecutionContext.scriptOrModule`
   holds what `GetActiveScriptOrModule` would return at that point. Every builtin call pushes
   `{realm: builtin realm, scriptOrModule: caller's effective value}` (`objects/errors.ts:240-252`).
   Inside `%eval%`, `agent.activeContext` is therefore `{evalRealm, caller's effective record}`.
   Copying that value into the eval entry context matches the spec with no stack walk (§3).
3. **Carrier.** The `ScriptEntryFrame` and `execute($global,$script:ScriptRecord)` stay
   unchanged. The carrier is `createScriptRecord(evalRealm, inherited)`, fresh per call. The
   eval entry pushes `scriptOrModule: $script.hostDefined`. The carrier itself is never a
   ScriptOrModule, and a test pins this. This adds no new type, field or frame (§4).
4. **IE4.** Add `lowerEvalScript(script, sourceText?)`, a second entry kind of the single
   existing lowering body. Exactly four points differ, plus one conditional import (§5). The
   vocabulary grows to 121 entries (102 helpers). The other census numbers must be **measured
   and re-pinned**, not predicted.
5. **IE5.** Add `createIndirectEvaluator(context, host)`. Script and indirect evaluation share
   one private core that differs only in the lowering, the empty-body rule and the carrier
   (§6). The taxonomy, limits, domain checks and publication stay as they are: no new fault
   reasons, stages, limits or hooks.
6. **Next task:** IE6/IE7 native acceptance plus the `evalCompiler` host wiring (§10), not
   general `Function`.

## 2. Primary specification (draft 2026-11-03, read today)

| Clause                                | Text that matters here                                                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10.3.3 BuiltinCallOrConstruct, step 7 | "Set the ScriptOrModule of calleeContext to **null**." The Realm is `func.[[Realm]]`                                                                                                |
| 19.2.1.1 PerformEval                  | "Let runningContext be the running execution context." NOTE: for indirect eval it is "the execution context for the invocation of the eval function"                                |
| 19.2.1.1, evalContext steps           | "Set evalContext's ScriptOrModule to runningContext's ScriptOrModule": a **field copy**, so null for indirect eval. Realm = evalRealm (the current Realm, i.e. the eval function's) |
| 9.4.1 GetActiveScriptOrModule         | "the topmost execution context … whose ScriptOrModule component is **not null**"; null if there is none                                                                             |
| 10.2.3 OrdinaryFunctionCreate         | `F.[[ScriptOrModule]]` = `GetActiveScriptOrModule()` at creation                                                                                                                    |
| 10.2.1.1 PrepareForOrdinaryCall       | The callee context's ScriptOrModule = `F.[[ScriptOrModule]]`                                                                                                                        |
| 9.5.5 HostEnqueuePromiseJob           | `scriptOrModule` = `GetActiveScriptOrModule()` at enqueue; it must be the active one when the job runs                                                                              |
| 20.2.1.1.1 CreateDynamicFunction      | Pushes no context. It calls `OrdinaryFunctionCreate` inside the `Function` builtin's null context                                                                                   |

**Consequence.** Nothing in the specification reads a ScriptOrModule field directly except
PerformEval's copy. Everything observable goes through `GetActiveScriptOrModule`. Take
indirect eval called by Script `rA`. The stack is:

> `[…, rA-context(rA), %eval% builtin(null), evalContext(null)]`

`GetActiveScriptOrModule()` inside the eval code is therefore `rA`. This holds:

- **cross-realm** (realm B's `%eval%` called from realm A code): the result is `rA`, while the
  Realm is B;
- **nested**: an indirect eval inside eval code adds two more null fields;
- **with an empty stack** below the builtin: the result is null.

A direct eval inside eval code (S5) copies `evalContext`'s null field. The nearest non-null
field is again `rA`. **Dynamic `Function` gives the same answer.** The created function's
`[[ScriptOrModule]]` is the caller's effective record. It is captured at creation, not through
any entry context.

## 3. The runtime context stack as implemented

| Push site                                                                                                  | Spec field             | Tint stores                                                             |
| ---------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------- |
| Script entry (`lowering/index.ts:4313-4317`)                                                               | the Script Record      | `$script` (fresh per parse; `script-evaluation.ts:99`)                  |
| Builtin call: `callObject` → `internalExecutionContext.run` (`call.ts:21-25`)                              | null                   | `active?.scriptOrModule` with the builtin's realm (`errors.ts:240-252`) |
| `builtinFunction` (`intrinsics.ts:57-70`) inherits `functionPrototype`'s context (`operations.ts:281-287`) | —                      | Hence `%eval%` and `Function` use the realm context above               |
| Source function call (`createSourceExecutionContext`, `jobs.ts:127-140`; `functions.ts:165`)               | `F.[[ScriptOrModule]]` | The active value **at creation**                                        |
| Generators/async (`generators.ts:124-128`, `async-functions.ts:68-72`)                                     | the function's         | The active value at creation                                            |
| Job enqueue/drain (`jobs.ts:70-80, 88-110`)                                                                | active at enqueue      | Captured at enqueue, restored at drain                                  |
| **Indirect eval entry (planned)**                                                                          | null (field copy)      | **`active?.scriptOrModule` read inside `%eval%`** = effective `rA`      |

`undefined` represents null. `runScriptContext` saves and restores a single
`agent.activeContext` slot (`jobs.ts:57-69`). Bound functions (`bound-functions.ts:36,46`),
Proxy `apply` and `Reflect.apply` all reach `callObject`, so each hop preserves the effective
value.

**Invariant E.** Every push stores either its own non-null record or the active value. Under
E, the stored value equals `GetActiveScriptOrModule()` for every context, so the stack never
needs a walk.

Pushing a fresh record (as `createScriptEvaluator` does for `$262.evalScript`) is correct only
for ScriptEvaluation. **The carrier exists to keep eval from breaking E.**

**Dynamic `Function`.** `createSourceFunction` runs inside the `Function` builtin's realm
context, so the function captures the caller's effective value. That is already
spec-equivalent. S4's compiled path must keep this property:

- function creation happens synchronously inside the builtin;
- any managed "create" entry pushes **no** fresh Script record. Either it pushes no context at
  all, or it pushes the same `$script.hostDefined` carrier shape described here.

## 4. Carrier and frame reuse

```ts
// Unchanged: native/script-entry.ts
interface ScriptEntryFrame {
  $imports: unknown;
  $argument0: GlobalEnvironment<ScriptPropertyKey, unknown>;
  $argument1: ScriptRecord;
}
// Indirect eval, per call, inside %eval%:
const active = realm.agent.activeContext; // {realm: evalRealm, scriptOrModule: caller's effective}
const carrier = createScriptRecord(
  realm,
  active === undefined ? undefined : active.scriptOrModule,
);
```

The lowered eval entry keeps `const $errors = $script.realm` and pushes
`{realm: $errors, scriptOrModule: $script.hostDefined}`.

- **Cross-realm:** `carrier.realm` is B and `hostDefined` is `rA`.
- **No caller:** `hostDefined` is `undefined`.

`ScriptRecord.hostDefined: unknown` is already part of the reified record layout. The only
census change is therefore the EDI helper (§5.3).

**Rejected alternatives:**

1. **Pass `rA` itself as `$argument1`.** `$errors` would become A's realm, which is wrong
   cross-realm, and it does not exist when there is no caller.
2. **Read `$errors.agent.activeContext` in managed code.** This adds a nullable field-read path
   to the surface. It couples compiled code to the caller stack, and the IE5 spy cannot
   observe it.
3. **A second frame or surface** (old Q1). This is unnecessary for Script-shaped eval.
   HOST-ESM revisits it when Module records exist.

**What the pun costs.** `carrier.kind === "script"` but it is not a parse identity. The rules:

- Nothing may store the carrier as a ScriptOrModule.
- IE5 and IE6 assert that functions and jobs created by eval code see `rA`, never the carrier.

## 5. IE4: `lowerEvalScript` (Node, lowering)

### 5.1 API and factoring

```ts
// lowering/index.ts, exported beside lowerScript; js-engine index re-export as for lowerScript
export function lowerEvalScript(
  script: Module,
  sourceText?: string,
): ScriptLoweringResult;
```

**Factoring.** Rename the existing body to a private
`lowerScriptEntry(script, sourceText, kind: "script" | "indirect-eval")`.
`lowerScript(script, sourceText)` becomes `lowerScriptEntry(…, "script")`. Nothing else in the
4,352-line body is copied or moved.

**No `options` parameter.** S5 needs a site and scope description, so it will add its own
kind; adding a parameter now would be speculative. Compute
`const scriptStrict = script.strict !== false` once, beside `strict` (`:130`). The
EDI literal uses `scriptStrict` because `strict` is mutated and restored around nested
functions (`:958,1400,1540,1941`).

### 5.2 The exact four points

| #   | Site (today)                             | `"script"`                                     | `"indirect-eval"`                                                                                                                                      |
| --- | ---------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | `let lexical` (`:128`)                   | `member(id("$global"),"lexical")`              | `id("$evalLexical")`                                                                                                                                   |
| P2  | `const $scope` statement (`:4112-4125`)  | `$scope = createGlobalScope($global)`          | `const $evalLexical = createDeclarativeEnvironment(undefined)`, then `const $scope = createDeclarativeScope(createGlobalScope($global), $evalLexical)` |
| P3  | instantiation (`:4192-4197`)             | `instantiateGlobalDeclarations($global, plan)` | `instantiateEvalDeclarations($global, $evalLexical, plan, <scriptStrict literal>)`, under the same `check(temporary(…))`                               |
| P4  | entry context object (`:4313-4317`)      | `[id("$errors"), id("$script")]`               | `[id("$errors"), member(id("$script"),"hostDefined")]`                                                                                                 |
| I   | `scriptRuntimeImports(…)` (`:4228-4233`) | unchanged                                      | 5th parameter `usesEvalDeclarations=true` adds `instantiateEvalDeclarations` to `@tint/js-runtime/environments/global`                                 |

`createDeclarativeEnvironment`, `createDeclarativeScope` and `createGlobalScope` are already
plain imports, so P2 adds nothing to the vocabulary.

**Why nothing else moves (verified against the source):**

- Top-level `var` writes go through `resolveBinding($scope…)` (`:335-345, 4070-4076`). Sloppy
  eval therefore reaches the global var env. Strict eval reaches `$evalLexical`, where IE1
  creates the vars (`eval-declarations.ts:130-137`).
- Annex copies call `setGlobalBinding($global,…)` behind the admission flag (`:3976-4015`).
  This is the B.3.2.3 `SetMutableBinding` on the global var env. Strict sources have no annex
  copies, and IE1 throws `DECLARATION_INVARIANT` if one appears.
- Function factories in the plan close over `$scope`, so they read eval-local lexicals. This
  is why P2 must precede the plan.
- `receiver = $global.thisValue` is correct: GetThisEnvironment passes the declarative env and
  reaches the global env.
- The `$global.object` witness, `$errors` and `$completion` are unchanged.
- Direct-eval candidates inside eval code still emit `callEvalCandidate`, so string direct eval
  stays unsupported.
- `import()` stays UNSUPPORTED, and tagged templates keep old D4.

### 5.3 Vocabulary and census

`scriptRuntimeTypeArguments("instantiateEvalDeclarations")` returns
`["ScriptPropertyKey","unknown"]`. `scriptRuntimeSurface()` passes `true` for the new
parameter. Expected exact deltas:

- `runtime-surface.test.ts:54,56`: 120 → 121.
- `tools/script-runtime-surface.test.ts:202`: functions 101 → 102, genericFunctions 27 → 28;
  types stay 19.
- `:245`: table entries 101 → 102.

The signature uses only types that already exist (`GlobalEnvironment`, `DeclarativeEnvironment`,
`GlobalDeclarations`, `boolean`, and the same result union as GDI). Anchors 79, collections 39
(`[32,1,6]`, 332 operations), providers 41, 43 distinct signatures and 355 operations may still
shift through the new provider operation. **Measure them; do not edit them by assumption.**

The directory digest changes. Scripts without eval must lower **byte-identically**: reuse G2's
pre-change hash test.

### 5.4 IE4 tests (red first)

New file `packages/js-engine/test/eval-lowering.test.ts`. Re-pin the two surface tests named
above.

1. **Stable Script lowering.** A corpus of `lowerScript` outputs (functions, classes,
   generators, annex blocks, guarded `eval(x)?.y`, templates) hash equal to the pre-change
   output.
2. **Exactly four differences.** For the same corpus, `lowerEvalScript` and `lowerScript`
   deep-equal after the P1–P4 nodes and import I are normalized. A count of 1 P2 pair, 1 P3
   call and 1 P4 member fails on any extra difference.
3. **Strict literal.** It follows the directive: `'use strict'` gives true, `'use\x20strict'`
   gives false (probe), and a nested function's `'use strict'` leaves it false.
4. **Annex.** Sloppy eval still gates `setGlobalBinding` on admission; strict eval has an empty
   `annexFunctions` and no copies.
5. **Plan order.** A function factory is emitted after `$evalLexical` and `$scope`.
6. **User names.** Source `var $evalLexical = 1; $evalLexical` still resolves by environment
   name; generated locals cannot capture it.
7. **Nested direct eval.** `eval(s)` inside eval source emits exactly one `callEvalCandidate`.
   `import('x')` gives UNSUPPORTED; `x\n++` gives a parse error before lowering; duplicate
   `let` gives EARLY_ERROR.
8. **Managed compile.** Extend `script-compile.test.ts`. The `lowerEvalScript` output links
   and compiles through the managed Script compiler, with an unchanged frame selection
   (`ScriptEntryFrame`).

**Owner files:** `lowering/index.ts`, `lowering/runtime-imports.ts`, the js-engine index export
and the tests. `js-runtime` is unchanged.

## 6. IE5: shared evaluator core and `createIndirectEvaluator` (Node)

### 6.1 API

```ts
// script-evaluation.ts (package export "./script-evaluation" already exists)
export type IndirectEvaluator = (source: string) => unknown; // the future EvalCompiler shape
export function createIndirectEvaluator(
  context: ScriptEvaluationContext,
  host: ScriptEvaluationHost,
): IndirectEvaluator;
```

`createScriptEvaluator` keeps its exported signature and behavior. Both evaluators wrap one
private `createEntryEvaluator(context, host, kind)`, which holds the existing `ensureDomain`,
`fault`, parse, compile, invoke and completion code (`:52-120`). The kinds differ only here:

| Step                                   | `"script"`                                                                  | `"indirect-eval"`                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Admission                              | `realm.unsupported` or non-string → reject                                  | Same. Non-strings never arrive: the intrinsic returns them first (§2 of the parent plan)                             |
| Parse                                  | `parseScript(createSourceTextView(source))`, raw UTF-16, **no TextEncoder** | Same                                                                                                                 |
| Empty body (`statements.length === 0`) | Compiled as today                                                           | Returns `undefined` before lowering. This is PerformEval's "Contains ScriptBody is false" step; there are 0 compiles |
| Lower                                  | `lowerScript`                                                               | `lowerEvalScript`                                                                                                    |
| Carrier                                | `createScriptRecord(realm, undefined)`                                      | `createScriptRecord(realm, active?.scriptOrModule)`, read once after `ensureDomain` and before building the frame    |
| Invoke, leak check, completion         | Shared                                                                      | Shared                                                                                                               |

No user code runs between `%eval%` entry and the carrier read, so reading it after compiling is
the same as reading at PerformEval's step. `strictCaller` is always false for indirect eval
(the parent plan's assertion), and the caller's strictness is never consulted.

### 6.2 Failure taxonomy (existing primitives only)

| Condition                                                 | Result                                                                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Parse `SYNTAX_ERROR` / `LEXICAL_ERROR`                    | `throw createRuntimeError(realm,"syntax")`: the **evaluator's** realm (eval realm), not the active caller's |
| Parse `LIMIT` or any other code                           | `rejectUnsupportedExecution(realm)` (sticky on the eval realm)                                              |
| Lower `EARLY_ERROR`                                       | SyntaxError from the eval realm. Lower `LIMIT`/`UNSUPPORTED` → unsupported                                  |
| `compile` returns `{ok:false, stage}` (8 existing stages) | Unsupported; nothing is published                                                                           |
| `compile` throws                                          | `fault("compile-threw")`, then unsupported                                                                  |
| Domain drift before parse or after compile                | Unsupported                                                                                                 |
| `invoke` throws / context leak / bad view / bad kind      | `invoke-threw` / `context-leak` / `completion-view` / `completion-kind`                                     |
| Completion `throw`                                        | Rethrow the identical value                                                                                 |
| Completion `unsupported`                                  | Reject on the eval realm                                                                                    |
| IE1 `"syntax"` or `"type"` inside the entry               | The lowered `check` throws the eval realm's error as a `throw` completion                                   |

There are no new limits, budgets, publication paths, hooks or `ScriptEvaluationFault` members.
The evaluator never calls `drainScriptJobs`/`clearKeptObjects`; the host checkpoint owns jobs.

### 6.3 IE5 tests (extend `script-evaluation.test.ts`)

Build two realms with the existing `fixture()`. Install `%eval%` in neither realm, because the
slot comes later. To get the production stack shape, call the evaluator through
`createCallableObject(realmB.functionPrototype, (r,a) => indirectB(a[0]))`. Invoke it with
`callObjectValue` inside `runScriptContext(agent, {realm: A, scriptOrModule: rA})`.

1. **Cross-realm carrier.** `frame.$argument1.realm === B`, `.hostDefined === rA`,
   `frame.$argument1 !== rA`, and the carrier is distinct on every call.
2. **Ordering.** Inside the spy `invoke`, `activeContext` is `{realm: B, scriptOrModule: rA}`.
   This is the builtin context, observed before the entry pushes its own.
3. **No caller.** With no outer context, `hostDefined === undefined`.
4. **SyntaxError realm.** A syntax error while A is active yields an error whose prototype is
   **B's** `SyntaxError.prototype`, with 0 compiles and 0 invokes. A lowering EARLY_ERROR
   behaves the same.
5. **Sticky unsupported.** Parser LIMIT gives sticky unsupported on B; A stays clean.
6. **Empty bodies.** `""`, whitespace and comment-only text return `undefined` with 0 compiles;
   `"'use strict'"` compiles once.
7. **Right lowering.** The spy `compile` receives a module importing
   `instantiateEvalDeclarations` and not `instantiateGlobalDeclarations`. The same source sent
   through `createScriptEvaluator` gets the opposite.
8. **Raw UTF-16.** The lone-surrogate test runs against both kinds.
9. **Shared core.** The existing compile-failure-stage, completion, fault, domain-drift,
   context-leak and no-job-drain tests are parameterized over both kinds. The Script record's
   `hostDefined` stays `undefined`.

**Owner file:** `script-evaluation.ts` only. No `js-runtime`, `tools/` or realm-slot edit.

## 7. Node commands (IE4, then IE5)

```sh
pnpm build
node --test packages/js-engine/test/eval-lowering.test.ts packages/js-engine/test/lowering.test.ts \
  packages/js-engine/test/eval-guard.test.ts packages/js-engine/test/runtime-imports.test.ts \
  packages/js-engine/test/runtime-surface.test.ts packages/js-engine/test/script-compile.test.ts
node --test tools/script-runtime-surface.test.ts tools/managed-jit-entry.test.ts
node --test packages/js-engine/test/script-evaluation.test.ts          # IE5
pnpm check                                                              # all workspace tests, types, format
```

There is no native step in IE4/IE5. Because a lowering file changes, IE6 needs a frozen
self-build with byte-identical stages. That build belongs to main's queue.

## 8. Hand-off: IE6 native and IE7 Test262 (main's serial queue)

**Pre-guard frozen inputs (do not touch).** The v6 `native-script-v6-eval-script` global-code,
annexB and child runs use the frozen 549-file toolchain `node-toolchain-evalscript-host-v1`.
PID 73383 is the current global-code run. Its SIGKILL observation stays its own record, with no
retry.

**Guard gate.** `docs/results/native-test262-eval-guard-validation-v1.json` (01:23, 550 files,
source `10864e90…`, image `076890c5…`) and `direct-eval-guard-checkpoint-v1.json` (01:25)
existed when I read them, and the guard plan reports nine expected outcomes. I did not verify
the controller's final state. **IE6 starts only after main confirms**:

- 6 completed plus 3 sticky unsupported;
- the frozen self-build is identical.

If either fails, IE6 waits.

**Post-guard inputs.** Use a new snapshot that contains IE4 and IE5 plus the next task's slot
wiring. Record a fresh frozen self-build, then the
`language/eval-code/indirect` **baseline on the post-guard, pre-IE7 snapshot**, before wiring
is enabled:

```sh
node tools/verify-hosted-indirect-eval.ts            # IE6, new; parent §7 statuses 1-15, 20-22, plus:
#  23 a function/job created by eval code sees rA (never the carrier); 24 nested eval keeps rA
node tools/verify-test262-native-indirect-eval.ts    # IE7 guard proof, parent §7
node tools/test262-native-run.ts .tint-bootstrap/test262 language/eval-code/indirect 8      # baseline, then after IE7
node tools/test262-native-run.ts .tint-bootstrap/test262 annexB/language/eval-code/indirect 8
node tools/test262-native-run.ts .tint-bootstrap/test262 built-ins/eval 8
node tools/test262-native-run.ts .tint-bootstrap/test262 built-ins/Function 8
```

Comparison rules, blocking conditions and the four mixed-direct variants are unchanged from
parent §8. Every report is a new immutable file, and no command is retried silently.

## 9. Decisions, risks, open questions

| ID  | Default                                                                      | Rejected                                                                                                       |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| L1  | The effective-value model (invariant E) stands in for the spec's null fields | A spec-shaped stack with a `GetActiveScriptOrModule` walk: a runtime-wide change with no observable difference |
| L2  | The `$script.hostDefined` carrier through the unchanged frame                | §4 alternatives 1–3                                                                                            |
| L3  | `lowerEvalScript(script, sourceText?)` without options                       | `{mode:"indirect"}`: S5's needs are not yet known                                                              |
| L4  | Indirect eval returns early for an empty body; Script is unchanged           | Compiling empty eval code: unobservable, but costs a publish                                                   |
| L5  | No new fault reasons or stages                                               | A `non-string` fault: unreachable behind the intrinsic                                                         |

**Risks.**

1. A future runtime push that stores a fresh or null record would silently break E. Add a
   comment at `runScriptContext` naming E, and test it in IE5 #2.
2. IE1 covers only the global variable environment. Direct eval's intervening scopes (the B.3.4
   catch exemption, function var envs) stay S5, and string direct eval stays blocked.
3. Line anchors drift as main lands work. Re-grep P1–P4 when the slice starts.
4. The census re-pin can collide with other surface work landing in the same window (parent Q2).
5. The parent plan's §1.2 and §5.5 wording ("ScriptOrModule is inherited") should read:
   "the effective ScriptOrModule is inherited; the spec field is null". That edit belongs to
   main.

**Open (owner: main).** Should the `ScriptRecord` doc comment (`jobs.ts:13-14`) mention the
eval carrier, or should a type alias `EvalCarrier = ScriptRecord` document it in
`script-evaluation.ts` only? Either choice is census-neutral.

## 10. Next planning task

Plan **IE6/IE7: native indirect-eval acceptance and `evalCompiler` host wiring.** Not general
`Function`. Now planned in [indirect-eval host integration](rt-eval-indirect-host-integration.md). Its scope:

1. The `ErrorRealm.evalCompiler` slot and the intrinsic's string routing (parent §5.2). This
   changes the record layout, so re-measure and re-pin the census.
2. `createRealmHost` installation behind the S2-ev1 capability for every realm, including
   `createRealm` children.
3. Generator red tests (byte-identical without the capability).
4. The exact IE6 fixture statuses, resources and arena accounting.
5. Adapter `native-script-v7-indirect-eval`.
6. The pre/post snapshot and toolchain freeze sequence in §8, gated on the confirmed guard
   validation.
