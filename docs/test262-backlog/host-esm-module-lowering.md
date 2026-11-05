# HOST-ESM M2: source-module lowering and the Test262 host handoff

Plan for slice M2 of the [HOST-ESM plan](host-esm.md). It builds on M1a
([static linking](host-esm-static-linking.md)) and M1b
([loading and evaluation](host-esm-loading-evaluation.md)). Research only: no
source, test, manifest, catalog, result, queue or snapshot was changed, and
nothing was built or run natively.

**Baseline.** Source identity
`aad1b4bc276bc8f44c6017b0f28b2195f832615f73c6c9f7a9f898a1c49b03e8` (559
files). The [Node checkpoint](../results/module-loading-evaluation-node-checkpoint-v1.json)
records 4,189/4,189 workspace tests passing (`conformance: false`). Native M1b
is **not** accepted: its launch failed before a confirmed stopped-at-entry
([observation](../results/module-loading-preentry-observations-v1.json)), and the
frozen compiler fixed point is pending. Main is building
`stage1-module-loading-v1`; nothing here depends on or touches that build.

**Implementation update:** module declaration collection, shape building, the runtime
factory and shared body lowering pass the [4,218-test workspace gate](../results/module-source-lowering-node-checkpoint-v1.json).
The standalone lowerer remains independent of the execution runtime: pure module
metadata and request canonicalization live in `@tint/foundation/modules`.
Parser declaration spans stay unchanged; separate source-position metadata keeps
`Function.prototype.toString` text free of export wrappers. Template sites are
created inside each module factory, so distinct records get distinct sites.
[In-image lowering](../results/native-module-in-image-lowering-v1.json) and
[cumulative loading/evaluation](../results/native-module-cumulative-evaluation-v1.json)
pass natively. The [generated module source fixture](../results/native-module-source-lowering-v2.json)
also passes after its embedding bound the standard object, symbol and bigint
views. [Combined native evidence and retained failures](../results/module-source-native-validation-v1.json)
record the fixture correction. The [consolidated frozen fixed point](../results/bootstrap-module-source-v1.json)
passes with byte-identical 71,847,842-byte stage images;
[signature and DWARF verification](../results/module-source-selfbuild-artifact-validation-v1.json) also pass.
K6 uses an embedding-owned `ModuleRecord.executionFault`, never thrown-value classification.
The managed vocabulary stays at 128 entries. Test262 module host integration is
still pending, so no new module conformance passes are claimed.

**Spec source.** ECMA-262 editor's draft ("ECMAScript® 2027"), fetched
2026-11-05 from `tc39.es/ecma262/multipage`: 16.2.1.4 ModuleRequests, 16.2.1.7.1
ParseModule, 16.2.1.7.3.1 InitializeEnvironment, 16.2.1.7.3.2 ExecuteModule,
16.2.1.14 Evaluation, 16.2.2.4 WithClauseToAttributes and the `export default`
rules in 16.2.3.7. Every `file:line` below was read in the baseline tree.

**Naming.** `@tint/ts-native/scalar` already exports `lowerModule`
(`tools/verify-hosted-labels.ts:6`), so the new entry is `lowerSourceTextModule`.

## 1. What exists now (verified)

**Runtime records** (`@tint/js-runtime/modules`, `package.json:47`).
`createSourceTextModule` (`records.ts:76`) allocates the environment, calls
`declare(environment)` at once, and rejects a `localExports` entry naming an
import local (`:85-92`). `linkModule` (`linking.ts:142`) resolves every entry
before committing cells: namespace imports get a fresh immutable binding
(`:64-67`), named imports share the exporter's `Binding` (`createImportBinding`,
`environments/records/index.ts:75`), and `instantiate` runs once
(`environmentInitialized`, `:37`) under the module context (`:76-80`).
`evaluateModule` (`evaluation.ts:88`) runs `execute` under the module context
(`:66-70`), caches anything it throws (`:71-73`, `:111-116`), and reports
`hasTopLevelAwait` unsupported before any status change (`:23-28`). Loading uses
`realm.moduleLoader` and `supportedImportAttributes` (`objects/errors.ts:79-80`,
default `[]` at `:334-335`); `settledModulePromise` (`evaluation.ts:125`) reads
a promise without draining jobs. Import writes return `"type"`
(`environments/records/index.ts:114`); `resolveBinding` walks declarative scopes,
then the global (`environments/global/scope.ts:75-94`).

**Lowering** (`packages/js-engine/src/lowering/index.ts`, 4,903 lines).
`lowerScriptEntry(script, sourceText, entryKind, …)` (`:147`) serves four
entries, binding with `bindScript`/`bindEvalScript` (`:154-157`) and collecting
with `collectScriptDeclarations` (`:171`). Its state is already parameterized:
`scope` (`:180`), `variableScope` (`:181`), `lexical` (`:192-195`), `receiver`
(`:196-199`), `strict` (`:200-201`), `scriptIdentity()` (`:249`). Top-level
`let`/`const`/`class` use `initializeBinding(lexical, …)` (`:3480-3486`,
`:3887-3897`); `var` writes use `putBindingReference` (`:3477-3479`). The Script
entry calls `instantiateGlobalDeclarations` (`:4628-4636`), lowers statements in
top-level resource scopes (`:4675-4685`), wraps them in `try` →
`finishScriptExecution` (`:1066`, `:4710-4740`) and `runScriptContext`
(`:4852-4876`), and exports `execute($global, $script)` (`:4881-4902`). Module
forms fail today at the expression default (`import-meta`/`import-call`,
`:2993`), the statement default (`:4455`), `await` without `suspensionInput`
(`:2966-2968`) and `await using` (`:3008-3009`). `scriptRuntimeSurface()`
(`runtime-imports.ts:274`) feeds the managed surface, pinned at 128 entries by
`tools/verify-hosted-script-lowering.ts`.

**Frontend** (`packages/typescript/src`). `parseModule` appends every import and
`export … from` source to `Module.imports` in source order
(`syntax/parser.ts:2720`, `:2782-2785`); the module goal is strict (`:269`).
`export default` is `{kind: "export-default", declaration, value}`, with a
`function-expression` or `class-expression` value when `declaration` is true
(`:2908-2933`); other exports are ordinary statements with `exported: true`
(`syntax/model.ts:352`, `:389`, `:399`). `bindJavaScriptModule`
(`binding/index.ts:192`) predeclares named defaults (`:341-353`), checks exports
(`:1244`) and accepts `import-meta`/`import-call` (`:809-818`).
`collectScriptDeclarations` (`binding/script.ts:31`) lacks an `export-default`
case and throws `STRICT_SCRIPT_INPUT_INVARIANT` on `import`/`export`
(`:117-121`).

**Runner.** `prepareNativeScripts` reports every module variant unsupported
(`tools/test262-native.ts:190-191`). `discoverModuleGraph`
(`tools/test262-module-graph.ts:22`) has no caller but its test; its nodes
include a self-importing root, because the root name is never pre-queued
(`:30-48`). Parse/early negatives use native syntax validation for every variant
(`tools/test262-native-run.ts:234-240`). `nativeExitOutcome`
(`test262-native.ts:104`) has no resolution codes; the adapter is
`native-script-v9-direct-eval` (`:913`).

## 2. Semantics M2 must implement (spec-checked)

**ParseModule normalization (keep exactly, 16.2.1.7.1 step 10).** A local
export whose `[[LocalName]]` is an imported local becomes an **indirect** entry
with the import's request and `[[ImportName]]`. Namespace imports included:
`import * as ns from "m"; export {ns}` yields the same entry as `export * as ns
from "m"`. `createSourceTextModule` already rejects the alternative
(`records.ts:89-92`). Node 24.12 still reports ambiguity for this graph (M1b
§1.1); it is not the reference, and no compatibility shim is allowed.

**Requests.** ModuleRequests are deduplicated (first occurrence wins, by
ModuleRequestsEqual). WithClauseToAttributes sorts keys by UTF-16 code units.
Entry request indices refer to the deduplicated list, which matches
`finishLoadingImportedModule`'s first-equal search (`loading.ts:168-181`).

**Environment (InitializeEnvironment steps 7–24, ExecuteModule).**

| Name kind                                                         | Created                | Initialized                                    |
| ----------------------------------------------------------------- | ---------------------- | ---------------------------------------------- |
| imports                                                           | `linkModule` (exists)  | shared cell or namespace                       |
| `var` (deduplicated; nested and `export var`)                     | mutable, non-deletable | `undefined` at link                            |
| top-level functions, `export default function [f]`                | mutable                | function object at link, inside module context |
| `let`, `class`, `export default class [C]`, `export default expr` | mutable                | at evaluation (TDZ until then)                 |
| `const`, `using`                                                  | immutable, strict      | at evaluation                                  |

- Top-level module functions are **lexically** scoped (step 24), not var.
  Anonymous default functions and classes bind `*default*` and get `name`
  `"default"`. A default expression gets NamedEvaluation `"default"` only if it
  is an anonymous function definition; parenthesized forms count (Node probe,
  §7). The lowering's `group` case already forwards `inferredName`
  (`index.ts:2670-2671`).
- Top-level `this` is `undefined`; the outer scope is the global scope; code is
  always strict.
- ExecuteModule (HasTLA false) evaluates the body, then runs DisposeResources on
  the module environment, and returns any abrupt completion. The completion value
  is unobservable: Evaluate's promise resolves to `undefined`.
- Live imports need no lowering work. `resolveBinding` finds the importer's
  shared cell; writes return `"type"`, which lowering's `check` turns into a
  TypeError; TDZ is the shared cell's `initialized` flag.

## 3. M2a: the smallest implementable slice

**Scope.** Lower one source text module to a factory that creates an M1
`ModuleRecord`, verified with hand-made graphs. No runner, adapter, journal or
exit-code change, so Test262 identity cannot move.

### 3.1 `collectModuleDeclarations` (`packages/typescript/src/binding/script.ts`)

`collectModuleDeclarations(module): ModuleDeclarations`, where
`ModuleDeclarations extends ScriptDeclarations` with `defaultFunction: {name,
value: function-expression} | undefined` (name is the declared name or
`*default*`). Reuse the existing `visit` walker through a private goal
parameter, so the Script path still throws on `import`/`export`. `import` and
declaration-less `export` are skipped. A default class adds lexical `{name,
constant: false}` with its name or `*default*`; a default expression adds
`*default*`. Export it from `binding/index.ts:1373-1379`.

### 3.2 Shape builder (`packages/js-engine/src/lowering/module-shape.ts`, new)

`sourceModuleShape(module)` returns `{ok: true, value: SourceModuleShape}` (type
from `@tint/js-runtime/modules`) or `{ok: false, error: Span & {message}}`.

- **Requests:** from `module.imports`, attributes copied and sorted, deduplicated
  with the runtime's `moduleRequestsEqual` (not reimplemented). A `phase` of
  `defer`/`source` fails with "import phases require their proposal slice".
- **Imports:** `binding.namespace` → `importName: undefined`, otherwise
  `binding.imported` (including the literal string `"*"`). `typeOnly` is an
  invariant; JavaScript parsing never produces it.
- **Exports, source order:** exported `variable`/`function`/`class` → local
  (patterns via `bindingIdentifiers`); `export-default` → local `default` entry
  naming `f`, `C` or `*default*`; `export {a as b}` → local, or indirect when `a`
  is an import local; `export {a as b} from` and `export * as n from` (namespace,
  `importName: undefined`) → indirect; `export * from` → `starExports`.
- `hasTopLevelAwait` is always `false`, because M2a lowering rejects TLA (§3.4).
  No extra AST walker is needed.

### 3.3 Runtime factory (`packages/js-runtime/src/modules/source.ts`, new)

This keeps emitted code to data plus two arrows, and makes the
declare/instantiate/execute split testable in Node with hand-written closures.

```ts
export interface SourceModuleDeclarations {
  readonly variables: readonly string[]; // may repeat
  readonly lexical: readonly {
    readonly name: string;
    readonly constant: boolean;
  }[];
  readonly functions: readonly string[]; // hoisted, in instantiate() order
}
export function createLoweredSourceModule(
  global: GlobalEnvironment<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hostDefined: unknown,
  shape: SourceModuleShape,
  declarations: SourceModuleDeclarations,
  instantiate: (
    scope: EnvironmentScope<ScriptPropertyKey, unknown>,
    environment: DeclarativeEnvironment<unknown>,
  ) => readonly unknown[],
  execute: (
    scope: EnvironmentScope<ScriptPropertyKey, unknown>,
    environment: DeclarativeEnvironment<unknown>,
  ) => ScriptCompletionRecord,
): ModuleRecord;
```

- **declare** (inside `createSourceTextModule`): build
  `createDeclarativeScope(createGlobalScope(global), env)`; create the §2 cells,
  deduplicating `variables` (duplicate lexical or function names still throw
  `DUPLICATE_BINDING_INVARIANT`, since the binder rejects them); then require a
  cell for every `shape.localExports[].localName` or throw
  `"MODULE_SHAPE_INVARIANT"`, instead of a later `IMPORT_BINDING_INVARIANT` in
  a peer's link.
- **instantiate:** initialize `variables` to `undefined`, then `initializeBinding`
  each result of `instantiate(scope, env)`. A length mismatch throws
  `"MODULE_DECLARATION_INVARIANT"` out of `linkModule` as a host fault.
- **execute:** `"none"` → return; `"throw"` → throw `value`; `"unsupported"` →
  `rejectUnsupportedExecution(realm)`; anything else → throw
  `"MODULE_COMPLETION_INVARIANT"` (see K6).
- Export it and its types from `modules/index.ts`.

### 3.4 `lowerSourceTextModule` (`lowering/index.ts`, `runtime-imports.ts`)

`lowerSourceTextModule(module, sourceText?): ScriptLoweringResult` adds
`entryKind: "module"` to `lowerScriptEntry` (no fork).

- **Inputs:** bind with `bindJavaScriptModule`; collect with
  `collectModuleDeclarations` and `sourceModuleShape` (shape failure →
  `UNSUPPORTED`).
- **State:** `scope` = `variableScope` = `$scope`; `lexical` = `$environment`;
  `receiver` = `undefined`; `strict` = `true`.
- **No `instantiateGlobalDeclarations` and no `runScriptContext` wrapper:**
  linking and evaluation already establish the module context. The body arrow
  keeps the existing `$completion`, top-level resources and `try` →
  `finishScriptExecution` shape.
- **Statements:** `import` and declaration-less `export` are no-ops. A default
  function is hoisted with `callable(…)` and `functionName` `f` or `"default"`,
  not through the `function-expression` case, which creates a self-name scope
  (`:2631-2660`). A default class is `classValue(definition, name or
"default")`, then `initializeBinding($environment, C | "*default*")`. A
  default expression is `value(expr, text("default"))`, then
  `initializeBinding("*default*")`.
- **Explicitly `UNSUPPORTED`, with stable messages:** top-level `await`,
  `for await` and `await using` ("top-level await requires HOST-ESM M4"; test
  `functionDepth === 0` before the generic failures); `import.meta` (M3);
  `import()` (M3); direct eval (M7: it needs a module `EvalSite`, and
  `scriptIdentity()` at `:249` has no module value; reject when
  `directEvalOwners` is non-empty).
- **Output:** template sites as today, plus:

```ts
export function create(
  $global: GlobalEnvironment<ScriptPropertyKey, unknown>,
  $errors: ErrorRealm,
  $hostDefined: unknown,
): ModuleRecord {
  return createLoweredSourceModule($global, $errors, $hostDefined,
    /* SourceModuleShape literal */, /* declarations literal */,
    ($scope, $environment) => [/* hoisted function objects */],
    ($scope, $environment) => { /* existing try / $completion / finish body */ });
}
```

- **`runtime-imports.ts`:** a `"module"` declarations mode omits the global and
  eval helpers and adds one `@tint/js-runtime/modules` import
  (`createLoweredSourceModule`, plus types `ModuleRecord`, `SourceModuleShape`,
  `EnvironmentScope`). **Not in `"all"`:** the managed surface stays
  byte-identical (128) until M7.
- **Catalog:** two new catalogued files; run `node
tools/generate-compiler-catalog.ts`, then format.

### 3.5 Red-first tests (exact; each seen failing on the baseline)

`packages/typescript/test/binding-module-declarations.test.ts` (new):

- **D1:** nested and `for` vars and `export var` → `variables`, once each, in
  walk order; top-level `function`/`export function` → `functions`.
- **D2:** `export default function f(){}` → `defaultFunction.name === "f"`;
  anonymous, generator and async forms → `"*default*"`.
- **D3:** default classes and expressions give the §3.1 lexical entries;
  `const` is constant. **D4:** a module with `import`/`export` does not throw,
  while `collectScriptDeclarations` still throws on a Script AST with an import.

`packages/js-engine/test/module-shape.test.ts` (new):

- **H1:** `import "./a"; export * from "./a"; import x from "./a" with
{type:"json"}` → two requests; attribute keys `{b, a}` come out `a, b`.
- **H2:** default, namespace and `{"*" as s}` imports → `"default"`,
  `undefined`, `"*"`.
- **H3:** local exports for `let {a, b: [c]}`, `function`, `class` and the three
  default forms, with the §2 `localName` values.
- **H4:** `import {a as x} from "m"; export {x as y}` → indirect `{y, 0, "a"}`.
  `import * as ns from "m"; export {ns}` → indirect `{ns, 0, undefined}`, deep
  equal to `export * as ns from "m"`, and accepted by `createSourceTextModule`
  with a real realm.
- **H5:** `export * from` → `starExports: [i]`; names `""`, `"π"`,
  `"*default*"` stay exact. **H6:** `import defer`/`import source` → `ok: false`.

`packages/js-engine/test/module-lowering.test.ts` (new):

- **L1:** output exports only `create($global, $errors, $hostDefined)`, imports
  `@tint/js-runtime/modules`, and has no `execute`.
- **L2:** **Script byte identity.** Before editing `index.ts`, record a SHA-256
  of `JSON.stringify(lowerScript(…))` over the `lowering.test.ts`,
  `eval-lowering.test.ts` and `annex-admission.test.ts` corpora, and assert it.
  Also assert `scriptRuntimeSurface()` is unchanged (count and digest).
- **L3:** `UNSUPPORTED` with the §3.4 messages for top-level `await 0;`,
  `for await (x of y);`, `await using r = o;`, `import.meta;`,
  `import("./x");` and `eval("1");`. An `await` inside an `async function`
  lowers.
- **L4:** duplicate or unbound exports → `EARLY_ERROR`. **L5:** one module covering every §2 row plus `using r = …;` lowers `ok`.

`packages/js-runtime/test/modules-source.test.ts` (new; realms built as in
`modules-evaluation.test.ts`):

- **S1:** after creation every declared cell exists uninitialized, including
  `*default*`; a missing local-export cell → `"MODULE_SHAPE_INVARIANT"`.
- **S2:** in `A ↔ B`, linking calls A's hoisted factory with `scriptOrModule
=== A`; B's import is A's `Binding` object; after the link, a call through B
  works before A evaluates.
- **S3:** after the link, `let`, `const` and `*default*` read `"reference"`;
  vars read `undefined`.
- **S4:** a `"throw"` completion rejects Evaluate with the identical value and
  caches it; `"unsupported"` sets `realm.unsupported`.
- **S5:** a factory length mismatch throws out of `linkModule`, uncached.
  **S6:** a write to a `const` cell → `"type"`; an undeclared name resolves to
  the global; a module `var` creates no global property.

### 3.6 Native fixture (`tools/verify-hosted-module-lowering.ts`, new)

Follow `tools/verify-hosted-script.ts:4790-4817`: lower in Node, pass the
results as `generatedModules`, and map `@tint/js-runtime/modules` →
`packages/js-runtime/src/modules/index.ts`. The in-image `run()` installs a table
loader (specifier → `create` result, created once) and loads, links and
evaluates `root → a ↔ b`. It returns 42, or one distinct code per failed check:
order log `b,a,root`; b calls a's hoisted function before a runs; b's read of
a's `let` throws a caught ReferenceError; `inc()` updates root's imported
`count`; an import assignment throws a caught TypeError; `this === undefined`; a
module `var` is no global property; a default class and `(function(){})` are
named `"default"`; `ns` keys are sorted and the re-exported `ns.ns === ns2`; the
top-level `using` disposer runs after the last statement; namespace and binding
identities survive the allocation churn of `verify-hosted-module-evaluation.ts`.

### 3.7 Gates

1. Focused Node tests red then green; `pnpm check`; catalog regeneration and
   format. Measure the surface census delta against
   `module-loading-surface-census-v1.json` (its `budget` already records one
   exhausted budget); never relax checks.
2. **Native:** `TINT_BUILD_ONLY=1`, then a serial LLDB run asserting
   stopped-at-entry and exit 42, with pre-entry failures kept separate as in the
   M1b observation. **Blocked** until M1b's launcher failure is understood and
   its fixture runs; never while `stage1-module-loading-v1` builds. Then a
   frozen self-build with stage-image comparison, after M1b's fixed point.
3. **Unchanged Test262:** no adapter, runner or journal change. Rerun the
   parent's unchanged guard (`language/arguments-object`) into a new immutable
   report with statuses identical to its last complete report, showing natively
   that Script lowering did not move. Rerun no module selection; every module
   variant must still be `unsupported`.

## 4. M2b handoff: the minimal Test262 module host

M2b is a separate landing because it changes journal identity. The detailed
host plan (capability gate, phases, exits 60–69, identity, selections) is
[host-esm-test262-module-host.md](host-esm-test262-module-host.md).

**Preparation** (`tools/test262-native.ts`). Replace `:190-191` with
`prepareNativeModuleProgram(plan, variant, harness, graph)`. Harness files lower
as Scripts, as today; the root and each `javascript` node lower with
`lowerSourceTextModule`, shared by content key like `test262-shared-script-*`
(`:719-724`), and a self-importing root's node is the **same** record as the
root. Report `unsupported` before execution for any `json` node or request with
attributes (M5), any `parsed: false` node (M2c adds the native re-parse proof
that resolution-phase fixture SyntaxErrors need), and any `UNSUPPORTED`
lowering. Add `@tint/js-runtime/modules` to the dependency map.

**Prelude.** Add `runNativeModuleTest(harness, table, root, asynchronous,
canSuspend)` beside `runNativeScripts` (`:486`), reusing its realm host,
`print`, `failure()` and job drain:

1. Run the harness Scripts (failures map to 20–28, as today).
2. Set `realm.moduleLoader` to a synchronous table loader that always finishes
   through `finishLoadingImportedModule` (static-linking §5): `./name` in
   `nodes` → that record, created once per realm; not in `siblings` →
   TypeError; in `siblings` but not `nodes` → `rejectUnsupportedExecution`;
   anything else → TypeError.
3. Check `realm.unsupported` before reading each settled promise, then map:

| Step                                                     | Exit                                    |
| -------------------------------------------------------- | --------------------------------------- |
| `loadRequestedModules` rejected (`settledModulePromise`) | `failure(error, 60)`                    |
| `linkModule` → `{ok: false}`                             | `failure(error, 60)`                    |
| `evaluateModule` rejected                                | `failure(error, 30)`                    |
| after `drainScriptJobs`                                  | existing `jobFailure` and async `$DONE` |
| invariant string escaping load, link or evaluate         | new crash code; never a JS outcome      |

**Outcomes and identity.** `nativeExitOutcome` maps 60–68 to `{kind: "error",
phase: "resolution"}` with the 30–38 type table. Parse/early negatives stay on
native syntax validation (`run.ts:234-240`); `negative.phase ===
"resolution"` uses the module path, with `$DONOTEVALUATE` as a live guard. Add
`fixtures: {name, sha256}[]` (sorted, root excluded) to `NativeObservationInput`
(`native-run-journal.ts:19`) only when `nodes` is non-empty, and extend
`sameNativeObservationInput`. Bump the adapter to `native-script-v10-modules`,
extend the report `scope` text (`run.ts:297`), and never resume a v9 journal.

**M2b gates.** Node tests for preparation (sharing, root self-identity, every
unsupported reason) and codes 60–68; a hosted fixture running one table-form
graph (a resolution failure, a runtime throw, a pass); the unchanged guard; then
complete reruns of `language/module-code`, `language/import`, `language/export`
and `language/expressions/import.meta`. TLA, attributes, `import.meta`, unparsed
fixtures and `import()` stay in the denominator as `unsupported`.

**After M2b.** M2c: native re-parse proof for `parsed: false` fixtures
(`parseModule` plus `validateJavaScriptBindings(…, "module")` in the image,
parent §5.1). `import.meta`: pass the record to `instantiate`/`execute` and add a
lazy `importMeta` field, with M3, since hosts populate it. M3: dynamic import.
M4: TLA through the shared continuation.

## 5. Defaults main can choose

| ID  | Question                 | Default                                                | Alternative                                                    |
| --- | ------------------------ | ------------------------------------------------------ | -------------------------------------------------------------- |
| K1  | Entry name               | `lowerSourceTextModule`                                | `lowerJavaScriptModule`                                        |
| K2  | Shape builder location   | `js-engine/lowering/module-shape.ts`                   | inside `index.ts` (already 4,903 lines)                        |
| K3  | Record construction      | `createLoweredSourceModule` runtime factory            | emit `createSourceTextModule` closures (needs a `$scope` cell) |
| K4  | TLA detection            | lowering rejects; shape always `false`                 | a `Contains await` walker now, kept for M4                     |
| K5  | Direct eval in modules   | `UNSUPPORTED` until M7                                 | none (needs a module `EvalSite`)                               |
| K6  | Unknown completion kind  | invariant throw (cached by `evaluation.ts:71`, see §6) | a realm fault flag that the host checks first                  |
| K7  | Unparsed fixtures in M2b | `unsupported`                                          | land M2c with M2b                                              |

## 6. Uncertainties

- **Native acceptance of the generated form:** the typed `$scope`/`$environment`
  arrows and the `SourceModuleShape` literal (`importName: undefined` in a
  union) are unproven under the Tint compiler; test L5 and §3.6 are the first
  evidence.
- **Invariants inside `execute` are cached as JS errors:** `evaluation.ts:65-73`
  wraps the whole closure, so `"MODULE_COMPLETION_INVARIANT"` rejects Evaluate
  instead of crashing. Value-based separation is unsound (M1b §3.3); K6 is open.
- **Template sites are module-level** (`index.ts:4741-4743`), shared if two
  realms create one module, as for Scripts today; Test262 is single-realm here.
- **Census and image cost** are measured in gate 1, not predicted. **M1b native
  and fixed-point state** gates every native claim. Whether "Contains await"
  covers `await using` was not re-read; M2a rejects both anyway.
- **Not validated:** no execution of lowered modules, no Test262 module run, no
  pass-rate forecast.

## 7. Evidence

Read: the files and lines in §1 and §3, the spec clauses in the header, and
pinned Test262 `module-code/eval-this.js`, `instn-local-bndng-var.js`,
`instn-iee-bndng-fun.js`, `eval-export-dflt-cls-anon.js` and
`instn-named-bndng-dflt-fun-anon.js` (most self-import, so they need M2b's
table). Non-native Node v24.12.0 probe (`/tmp/hostesm-m2/probe`): anonymous
default function, `(function(){})` and `(class{})` exports are named
`"default"`; `Object.keys` on a namespace holding an uninitialized `let` throws
ReferenceError.

## 8. Next task

Implement M2a (§3) test-first: D1–D4 with `collectModuleDeclarations`; H1–H6
with `module-shape.ts`; S1–S6 with `modules/source.ts`; record the L2 digest
**before** touching `index.ts`, then L1–L5 with `lowerSourceTextModule`;
regenerate the catalog; run `pnpm check`. Then queue the §3.6 native fixture
behind the M1b launcher investigation.
