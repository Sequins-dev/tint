# HOST-ESM: native ECMAScript module execution

Implementation plan for the HOST-ESM row of the [backlog](README.md). Captured on
2026-11-04 from source and the pinned Test262 checkout
(`.tint-bootstrap/test262`, revision `91c70759363c46557b694792bf34a2551a7af5ba`,
clean). This plan contains planning facts, not run evidence. No native execution
was performed while writing it.

**Current implementation:** static module records, linking, loading, evaluation,
source lowering and the opt-in Test262 host pass
[workspace checks](../results/module-host-routing-node-checkpoint-v1.json),
[seven native host cases](../results/module-host-native-validation-v1.json) and
[the frozen fixed point](../results/bootstrap-module-source-v1.json).
The [first unchanged module selection](../results/test262-module-eval-this-native-v1.json)
passes (1/1); no broad native module pass rate is established. The [Node-only preparation inventory](../results/module-preparation-inventory-v1.json)
separates prepared variants from unsupported features. M2c records five resolution-test passes and one retained pre-entry debugger timeout.
M3a dynamic import and import.meta now pass [17 native host cases](../results/dynamic-import-host-native-validation-v1.json);
[24/24 targeted unchanged variants pass](../results/dynamic-import-module-selection-acceptance-v1.json),
with namespace 38/38, ambiguous exports 9/10 (one unsupported proposal), and fixture syntax 6/6 in the same frozen toolchain. The [combined frozen fixed point](../results/bootstrap-dynamic-import-v1.json) also passes.
M3b Script-root tooling passes 4,288 workspace tests; its [Node census](../results/script-root-preparation-census-node-v1.json) prepares 849 variants. [Native validation](../results/script-root-host-native-validation-v1.json) matches all 29 expected host outcomes and passes the lowered-Script proof; [12/12 unchanged-source canaries pass](../results/script-root-canary-acceptance-v1.json); complete-directory measurements are running. Sections below preserve the planning
baseline and slice design.

[Runtime-compiled import calls](host-esm-managed-imports.md) now pass the
4,389-test workspace gate. The helper is in the image-owned managed surface;
[all eight native cases pass](../results/managed-dynamic-import-feature-acceptance-v1.json). Both [unchanged eval-import variants pass](../results/test262-dynamic-import-eval-native-v1.json).

The tools-only fixture-binding extension now passes [4,290 workspace tests](../results/fixture-binding-verdict-node-checkpoint-v1.json). Its [Node census](../results/fixture-binding-verdict-census-node-v1.json) routes 16 previously blocked module variants to native syntax proofs. Only lowering `EARLY_ERROR` diagnostics select this path; unsupported syntax stays unsupported. The 31-case native verifier is built, with native validation and unchanged-source reruns queued after the active directory measurements. This is not yet conformance evidence.

## 1. Summary

- Tint parses and binds module syntax, but no module can run natively. Every
  module-goal variant that is not parse-negative is reported `unsupported`
  before compilation. Script-goal `import()` fails in lowering.
- Test262 module graphs are **static and closed**. Every specifier is `./name` in
  the test's own directory (INTERPRETING.md, "Modules"). So the **critical path
  is AOT**: the runner discovers the graph and lowers each module once, links
  the modules into the batch image (as it does for Scripts today) and hands the
  host a module map. Core HOST-ESM has **no dependency on RT-EVAL's runtime
  compilation**. RT-EVAL's surface, managed entry and publication are reused
  only by the late slice M7 (runtime-loaded source text modules, and eval
  inside modules).
- The module semantics are portable TypeScript in `@tint/js-runtime` and
  `@tint/js-engine/lowering`. They need no changes to the compiler, codegen or
  ABI.

## 2. Pinned populations

**Counting policy.** The script walks the whole pinned suite through Tint's own
`test262Checkout` (which excludes `_FIXTURE` files), `testMetadata` and
`syntaxVariants`. That gives 53,751 files and 103,264 variants, which matches
the dashboard. Each variant is counted once. Module-goal means the `module`
flag. "Proposal" means the file lists one of `import-defer`, `export-defer`,
`source-phase-imports[-module-source]`, `import-text`, `import-bytes` or
`ShadowRealm` in `features`. Otherwise it is "standard".

The Script `import()` population is a **text scan** of the test body with the
frontmatter removed, using `\bimport\s*(\.\s*(source|defer)\s*)?\(`. It
overcounts calls that never run (for example `syntax/valid` nesting) and has no
known undercount. The script lives outside the repository (`/tmp/hostesm-count/`)
and is not an artifact. These are populations, not expected gains. **No pass
rate is implied.**

**Module-goal variants: 843**

| Phase                          | Standard | Proposal                                                   | Total   | Current path                                     |
| ------------------------------ | -------- | ---------------------------------------------------------- | ------- | ------------------------------------------------ |
| parse/early negative           | 201      | 4 (defer 2, source 2)                                      | 205     | native syntax host; already routed, not HOST-ESM |
| resolution negative            | 33       | 1 (defer)                                                  | 34      | `unsupported` (adapter)                          |
| runtime negative               | 8        | 0                                                          | 8       | `unsupported` (adapter)                          |
| non-negative                   | 470      | 126 (defer 101, source 11, text 5, bytes 5, ShadowRealm 4) | 596     | `unsupported` (adapter)                          |
| **execution-blocked (≠parse)** | **511**  | **127**                                                    | **638** | matches the README's previous 638                |

Of the 596 non-negative variants: 263 have the `top-level-await` feature, 101
have the `async` flag and 22 use import attributes or JSON modules. By
directory, `language/module-code` has 596 module variants (391 non-negative,
166 parse, 31 resolution, 8 runtime), `language/import` 123,
`language/expressions/dynamic-import` 38, `import.meta` 17,
`built-ins/AbstractModuleSource` 8, and a long tail of 1 to 7 per directory.

**Script-goal variants containing an import call (not parse-negative): 1,155**

| Group                                                                                                                                                                   | Variants  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| standard dynamic import                                                                                                                                                 | 859       |
| proposal: `source-phase-imports`                                                                                                                                        | 182       |
| proposal: `import-defer`                                                                                                                                                | 112       |
| proposal: `import-text`                                                                                                                                                 | 2         |
| of which `async` flag / import attributes or JSON                                                                                                                       | 771 / 123 |
| of which in `language/expressions/dynamic-import` (syntax 366, catch 320, usage 216, namespace 114, assignment-expression 52, import-attributes 43, other direct files) | 1,145     |

The module-goal and Script-goal rows are disjoint variant sets. They describe
1,793 variants touched, which is **not** a coverage estimate. Feature tags span
both goals and include parse negatives: `dynamic-import` 1,907,
`source-phase-imports` 475, `import-defer` 388, `top-level-await` 279,
`import-attributes` 160, `import.meta` 28.

**Resolution negatives (all SyntaxError).** These cover:

- `instn-iee-err-*`, `instn-named-err-*` and `instn-star-err-*` (link-time
  ResolveExport failures);
- `instn-resolve-*` (fixture parse errors and their ordering);
- `ambiguous-export-bindings/error-*`;
- `import-attributes/*` and `import/import-attributes/json-*`. These use
  `ensure-linking-error_FIXTURE.js`, an invalid JSON fixture, or named imports
  from JSON.

**Runtime negatives.** `eval-rqstd-abrupt` (TypeError), `eval-self-abrupt`,
`eval-export-dflt-expr-err-*`, and four `top-level-await` rejection tests
(TypeError/RangeError).

## 3. Current implementation (verified by reading source)

- **Syntax** (`packages/typescript/src/syntax`):
  - `parseModule(source, "javascript")` produces `import`, `export` and
    `export-default` statements.
  - `ImportDeclaration` carries `phase` (`defer`/`source`), `attributes`
    (`{key, value}[]`) and `bindings` (`namespace`, `imported`, `local`).
  - Expressions include `import-meta`, which is rejected outside the module
    goal in `parser.ts:1994`, and `import-call {phase, specifier, options}`.
- **Binding:** `bindJavaScriptModule` and `validateJavaScriptBindings(…,
"module")` declare `import` bindings as immutable and run
  `checkModuleExports` (`binding/index.ts:1235`). Module early errors therefore
  already have a native path.
- **Lowering:** only Scripts are lowered (`lowerScript`,
  `js-engine/src/lowering/index.ts`).
  - `import-call` and `import-meta` reach the default branch: "Script
    expression lowering is not implemented" (`index.ts:2619`).
  - `import`/`export` statements reach "Script statement lowering…"
    (`index.ts:4095`).
  - A top-level `await` has no `suspensionInput` and fails at `index.ts:3171`.
  - The entry is `execute($global, $errors)` wrapped in `runScriptContext`, with
    `scriptOrModule: execute`. This is an opaque identity; the comment there
    defers richer records to module loading.
- **Runtime primitives that are reusable as they are:**
  - `ScriptAgent.activeContext.scriptOrModule` is already propagated through
    jobs (`enqueueScriptJob`), source function contexts
    (`createSourceExecutionContext`), generators and async continuations
    (`objects/jobs.ts`, `async-functions.ts`). That is
    GetActiveScriptOrModule.
  - `Binding<Value>` is a mutable record `{value, initialized, mutable, strict,
deletable}` held in `DeclarativeEnvironment.bindings: Map`
    (`environments/records/index.ts`). Sharing one record object between two
    environments gives a live binding and TDZ with no copy.
  - Scope chains (`createDeclarativeScope`, `resolveBinding`) resolve by name at
    runtime.
  - `createExoticObject` with `ObjectInternalMethods` (`objects/operations.ts`)
    is already used by arrays, typed arrays and Proxy.
  - Promise primitives: `newPromiseCapability`, `promiseResolve`,
    `awaitScriptValue`, and generator continuations driven by
    `createSourceAsyncContinuationFunction`.
  - `json-parse.ts` provides JSON parsing.
- **Runner** (`tools/`):
  - `prepareNativeScripts` returns `unsupported("native module execution is not
implemented")` for any `module` variant (`test262-native.ts:166`).
  - Parse/early negatives (including module-goal ones) go to
    `nativeSyntaxHost`, which uses native `parseModule` plus
    `validateJavaScriptBindings` and never evaluates.
  - `nativeExitOutcome` has no resolution-phase codes, but `ExecutionOutcome`
    and `judgeExecution` already model `phase: "resolution"`.
  - `ObservationInput` hashes the test and harness, not fixtures.
  - The Node reference adapter rejects modules (`test262-node.ts:8`).
  - The batch image already links `syntax` and `binding` into the runtime.
- **Not present:** module records, linking, namespace objects, a module map,
  HostLoadImportedModule, dynamic import, import.meta objects, JSON modules,
  `%AbstractModuleSource%` and deferred namespaces. No source match was found
  under `packages/*/src`.

**Boundaries.**

- `@tint/js-runtime` depends only on `@tint/foundation`
  (`workspace-contracts.json`). Module algorithms must take plain data, not
  syntax trees.
- `@tint/typescript/modules` is the **TypeScript compiler's static linker**:
  string identities and no runtime cycles. It must not be reused for
  ECMAScript Module Records, because their semantics differ (TDZ, evaluation
  order, cyclic evaluation, error caching).
- `js-runtime` and `js-engine/lowering` are in the compiler source catalog
  (`packages/compiler/src/catalog.ts`). New files need catalog regeneration,
  and every slice that touches them needs a frozen self-build.

## 4. Semantics: pinned standard vs proposals vs host policy

**Pinned standard semantics** (ECMA-262 features tested without proposal tags):

- Source Text Module Records with ImportEntries, LocalExportEntries,
  IndirectExportEntries and StarExportEntries, plus ModuleRequests with
  attributes.
- LoadRequestedModules / InnerModuleLoading / FinishLoadingImportedModule.
- Link / InnerModuleLinking / InitializeEnvironment, with import bindings
  created **before** declarations and function declarations instantiated at
  link time.
- GetExportedNames, ResolveExport (`ambiguous`/`null`, circular-import
  tolerance, `default` not re-exported through `export *`).
- Evaluate / InnerModuleEvaluation (Tarjan DFS, cycle root, cached
  `[[EvaluationError]]` rethrown on re-evaluation).
- **Top-level await:** `[[HasTLA]]`, ExecuteAsyncModule,
  GatherAvailableAncestors, AsyncModuleExecutionFulfilled/Rejected, ordering by
  the async-evaluation counter, `[[TopLevelCapability]]`.
- Module Namespace exotic objects:
  - sorted export names;
  - `[[Prototype]]` null;
  - non-extensible, with SetImmutablePrototype;
  - `@@toStringTag` "Module";
  - `[[Get]]` that throws ReferenceError in TDZ;
  - `[[DefineOwnProperty]]`/`[[Set]]`/`[[Delete]]` rules;
  - `export * as ns`;
  - arbitrary string export names.
- `this` is undefined, module code is strict, and `export default` anonymous
  function/class naming is `"default"`.
- Assigning to an import binding throws TypeError at **runtime**. That includes
  writes reached dynamically, for example through direct eval later.
- `import.meta`: one lazily created null-prototype object per module,
  HostGetImportMetaProperties and HostFinalizeImportMeta.
- **EvaluateImportCall:**
  - GetActiveScriptOrModule referrer, or the realm when there is none.
  - ToString of the specifier **inside** the capability, so an abrupt result
    rejects the promise rather than throwing.
  - Options validation: a non-object rejects with TypeError; `with`
    non-object rejects with TypeError; non-string values reject with
    TypeError.
  - ContinueDynamicImport does load → link → evaluate → namespace. A new
    promise is created on every call.
- **Import attributes and JSON modules** (ES2025):
  - `type: "json"` produces a synthetic module with a single `default` export
    from ParseJSON.
  - An invalid JSON fixture is a SyntaxError at load.
  - **Unverified:** the exact phase and error for unsupported attribute keys,
    static versus dynamic. The pinned tests expect resolution SyntaxError for
    static imports. Check the spec text before coding M5.

**Proposals** (in the pinned denominator but **not** assumed implemented; stage
labels unverified):

- **`import-defer`:** deferred namespace objects with evaluation on first
  property access, ReadyForSyncExecution, and `import.defer()`.
- **`source-phase-imports`:**
  - `import source x`, `import.source()`, `%AbstractModuleSource%`;
  - GetModuleSource of a source text module throws SyntaxError;
  - the `<module source>` specifier needs a host-provided non-JS module source.
- **`import-text`:** `type: "text"`.
- **`import-bytes`:** `type: "bytes"`. Its tests also tag
  `immutable-arraybuffer`, which is a separate prerequisite.
- **`export-defer`:** no pinned variants found.
- **`ShadowRealm`:** module variants belong to RT-SHADOWREALM.

**Host policy** (choose explicitly and report; do not present as spec):

| Hook                                           | Tint policy                                                                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Specifier resolution                           | Test262 host: `./name` resolves to a file in the test directory, with path containment (`within`). Any other specifier form fails loading with TypeError. |
| Module map identity                            | Per realm, keyed by `(resolved path, module type)`. The same record is returned for every referrer, which satisfies HostLoadImportedModule idempotence.   |
| Missing file                                   | Loading fails with TypeError. Tests only assert `typeof error !== "undefined"`.                                                                           |
| File exists but not preloaded                  | `unsupported` (exit 10), never a rejection. This prevents an AOT discovery gap from looking like a semantic result.                                       |
| Supported attributes                           | `type` only. `"json"` in M5; `"text"`/`"bytes"` only in their proposal slices.                                                                            |
| import.meta properties                         | None. Finalize is a no-op.                                                                                                                                |
| `$262.AbstractModuleSource`, `<module source>` | Exposed only after P-SOURCE. There is no WebAssembly or other non-JS source provider, so `<module source>` loads report `unsupported`.                    |
| HostLoadImportedModule timing                  | Synchronous completion from the preloaded map. This is allowed, but the Graph Loading promise is still observed through jobs.                             |
| Fixtures                                       | No harness and no `$262` prepended. Fixtures share the test realm's global, per INTERPRETING.md.                                                          |

## 5. Design

### 5.1 Pipeline (Test262, AOT)

```
runner (Node bootstrap, tools/)                       native image
──────────────────────────────                        ────────────
test file ─▶ discoverModuleGraph(dir, root)           harness Scripts run (existing)
  static requests + "./*_FIXTURE.(js|json)"           host builds ModuleMap from table
  string literals, transitively                        ─▶ root: LoadRequestedModules
  per node: source → parseModule → lowerModule          ─▶ Link ─▶ Evaluate (promise)
            json   → embedded text                     drain jobs ─▶ exit code by phase
            unparsed → embedded bytes (native re-parse proof at load)
            missing → table entry "missing"
```

**Unparsed fixtures.** A fixture that the bootstrap parser rejects is **not**
judged in Node. Its bytes are embedded, and at load time the image runs native
`parseModule` and `validateJavaScriptBindings(…, "module")`:

- `SYNTAX_ERROR`, `LEXICAL_ERROR`, `DUPLICATE_NAME` or `INVALID_CONTEXT` throws
  the realm's SyntaxError (the load fails);
- a native accept, `UNSUPPORTED_SYNTAX` or `LIMIT` gives `unsupported`.

This mirrors `nativeSyntaxHost`. It keeps the rule that a partial grammar's
rejection is never evidence of an early error.

**Root module.** The root is handled the same way. A non-negative root that the
bootstrap parser rejects stays `unsupported`, as for Scripts today.

### 5.2 Records and data (new `js-runtime/src/modules/`)

Add a package entrypoint, `@tint/js-runtime/modules`. It is not a new package.

```ts
export interface ModuleRequest {
  readonly specifier: string;
  readonly attributes: readonly {
    readonly key: string;
    readonly value: string;
  }[]; // sorted by key
  readonly phase: "evaluation" | "defer" | "source";
}
export interface ImportEntry {
  readonly request: number;
  readonly importName: string | undefined; // undefined = namespace
  readonly localName: string;
}
export interface ExportEntry {
  readonly exportName: string | undefined;
  readonly request: number; // -1 = local
  readonly importName: string | undefined | "*";
  readonly localName: string | undefined;
}
export interface SourceModuleShape {
  readonly requests: readonly ModuleRequest[];
  readonly imports: readonly ImportEntry[];
  readonly localExports: readonly ExportEntry[];
  readonly indirectExports: readonly ExportEntry[];
  readonly starExports: readonly ExportEntry[];
  readonly hasTLA: boolean;
}
export interface ModuleRecord {
  // cyclic + synthetic share status/DFS fields
  readonly kind: "source" | "synthetic";
  readonly realm: ErrorRealm;
  readonly hostDefined: unknown;
  environment: DeclarativeEnvironment<unknown> | undefined;
  namespace: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  status: ModuleStatus; // new … linking, linked, evaluating, evaluating-async, evaluated
  evaluationError: { readonly value: unknown } | undefined;
  dfsIndex: number;
  dfsAncestorIndex: number;
  cycleRoot: ModuleRecord | undefined;
  asyncEvaluationOrder: number; // 0 = unset, -1 = done
  topLevelCapability: ScriptPromiseCapability | undefined;
  asyncParents: ModuleRecord[];
  pendingAsyncDependencies: number;
  readonly loaded: (ModuleRecord | undefined)[]; // per request index
  importMeta: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  readonly shape: SourceModuleShape;
  readonly initialize: (record: ModuleRecord) => void; // lowered declaration instantiation
  readonly execute: (record: ModuleRecord) => ModuleExecution; // sync completion or async continuation
}
export interface ModuleHost {
  // embedding-owned, like dynamicFunctionCompiler; not JS-replaceable
  readonly load: (
    referrer: unknown,
    request: ModuleRequest,
    finish: (result: ModuleRecord | { readonly error: unknown }) => void,
  ) => void;
  readonly supportedAttributes: readonly string[];
}
```

`ErrorRealm` gains `moduleHost: ModuleHost | undefined`. When it is absent,
`import()` rejects with an `unsupported` mark (`rejectUnsupportedExecution`),
never with a fake TypeError.

**Import bindings (decision D1).** The importer's environment map holds the
**exporter's own `Binding` object**. That gives live values and TDZ for free.
`DeclarativeEnvironment` gains `importNames: Set<string> | undefined`, and
`setMutableBinding` returns `"type"` for those names. `getBindingValue` and
`hasBinding` are unchanged.

Rejected alternative: a `target` field on every `Binding`. That adds a word to
every binding and a branch to every read. Both options change a hot runtime
layout, so measure the image size and stage images.

**Namespace.** `createModuleNamespace(record, names)` uses `createExoticObject`
with all internal-method overrides. `[[Get]]` resolves through
`resolveExport` (cached per name) and reads the target binding, throwing a
realm ReferenceError in TDZ.

**Modules of the internal entrypoint** (one concern each):

- `records.ts`: shape and record types, plus creation;
- `resolve.ts`: GetExportedNames and ResolveExport;
- `loading.ts`: GraphLoadingState and FinishLoadingImportedModule;
- `linking.ts`: InnerModuleLinking and InitializeEnvironment imports;
- `evaluation.ts`: synchronous and asynchronous evaluation;
- `namespace.ts`;
- `dynamic-import.ts`: EvaluateImportCall and ContinueDynamicImport;
- `synthetic.ts`: JSON modules.

**Async driver.** Factor the continuation-resume loop out of
`createSourceAsyncContinuationFunction` into a shared driver. Async functions
and ExecuteAsyncModule then use one implementation. This is a cleanup that
must not change behavior.

### 5.3 Lowering (`js-engine/src/lowering`)

Add `lowerModule(module, sourceText): ScriptLoweringResult`. It reuses the
Script lowering closure. Factor `lowerScript`'s shared body into an internal
`lowerProgram(goal)`; Script output must stay byte-identical. The generated
module exports:

```ts
export function shape(): SourceModuleShape; // literal data from the AST (frontend facts only)
export function create(
  $global: GlobalEnvironment<ScriptPropertyKey, unknown>,
  $errors: ErrorRealm,
  $hostDefined: unknown,
): ModuleRecord;
```

`create` does the following:

1. Allocates the module `DeclarativeEnvironment`. `$scope` is
   `createDeclarativeScope(createGlobalScope($global), env)`, and the receiver
   is `undefined`.
2. Returns `createSourceTextModule(realm, shape(), initialize, execute,
hostDefined)`. The two closures share `$scope`:
   - `initialize` creates var, let, const, class and `*default*` bindings, and
     instantiates hoisted functions. The runtime has already created the import
     bindings.
   - `execute` runs the body under `runScriptContext({realm, scriptOrModule:
record})`.
3. When `hasTLA` is set, the body is lowered as an async continuation. It reuses
   `generators.ts` with a module-level `suspensionInput`, and `execute` returns
   the continuation. `hasTLA` covers top-level `await`, `for await` and
   `await using`.

Lowering also covers:

- `export default expr` writes `*default*` and applies anonymous function naming
  `"default"`;
- `import.meta` lowers to `getImportMeta(record)`;
- `import-call` lowers to `evaluateImportCall(realm, specifier, options,
phase)`, in both Scripts and modules. Phases other than `"evaluation"` lower
  to `rejectUnsupportedExecution` until their proposal slice lands.

The vocabulary additions go to the same binding list (`@tint/js-runtime/modules`
specifier). When RT-EVAL S2 lands, they move into its `scriptRuntimeVocabulary`
constant.

### 5.4 Runner and host integration (`tools/`, host capability wiring only)

- **`tools/test262-module-graph.ts`** (new, Node only): `discoverModuleGraph(dir,
rootSource, goal)` produces nodes `{name, kind: source|json|unparsed|missing,
sha256}`. It discovers through static `ImportDeclaration`/`ExportDeclaration`
  specifiers, plus the string literals `./…_FIXTURE.js` and `./…_FIXTURE.json`
  in Script and module bodies (for `import()` and computed specifiers). It
  follows edges transitively and rejects paths outside the directory.
- **`prepareNativeScripts` → `prepareNativeProgram`**:
  - The module goal produces lowered harness Scripts, lowered modules and a
    graph table.
  - The Script goal attaches a table only when the graph is non-empty.
  - Lowered fixtures share code modules by content key, as `test262-shared-
script-*` does today.
- **Prelude**:
  - `runNativeModuleTest(harness, table, root, asynchronous, canSuspend)`
    installs `realm.moduleHost` from the table. Unparsed nodes are natively
    re-parsed (§5.1).
  - It loads, links and evaluates the root, then drains jobs, and maps the
    outcome:
    - load or link error → **resolution** codes 60–68;
    - evaluation throw or rejection of the evaluation promise → runtime codes
      30–38;
    - async `$DONE` → existing codes.
  - The prelude only wires host capabilities; the algorithms live in
    `js-runtime`.
- **`nativeExitOutcome`**: add 60–68 as `phase: "resolution"` with the same
  type table as 30–38.
- **Observation identity**: add `fixtures: {name, sha256}[]` to
  `ObservationInput` when the graph is non-empty. Bump the adapter to
  `native-script-v5-modules` and extend the report `scope`/`variantPolicy`
  text.
- **Coordination constraint.** These runner edits change journal identity and
  outcomes. Land them only after the v9 survey completes, or confirm that v9 is
  bound to its frozen toolchain snapshot. Never resume a v9-era journal with
  the new adapter.

### 5.5 Negative phases

| Phase                | Path                                                                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| parse/early (module) | Unchanged `nativeSyntaxHost` with the `"module"` goal. Fixtures are not consulted, and nothing is evaluated.                                                                                                                                                                                     |
| resolution           | The execution host runs the harness Scripts (which INTERPRETING requires anyway). The root fails in load or link **before any module code runs**. `$DONOTEVALUATE` stays as a guard: reaching it is a runtime-phase failure, so it fails the test. Fixture syntax errors use native-parse proof. |
| runtime              | Normal execution. The error escapes Evaluate synchronously or through the rejected top-level promise, and is judged against the runtime phase.                                                                                                                                                   |

## 6. Slices

M0/M1 contracts were refreshed against current source in
[HOST-ESM static linking](host-esm-static-linking.md), which supersedes the M0
and M1 bullets below where they differ.

Every slice is test-first:

- Node tests cover portable algorithms, including ordering and abrupt
  completion.
- A hosted native fixture is built with `TINT_BUILD_ONLY=1` and run serially
  under LLDB. Assert the stopped-at-entry state and the exact final exit status,
  and keep pre-entry failures separate.
- Then run `pnpm check`.
- Because `js-runtime` and lowering are catalogued, run
  `node tools/generate-compiler-catalog.ts` when files are added, and run a
  frozen native self-build with stage-image comparison.
- Finally, rerun complete selections unchanged, each in a new immutable report.

"Unchanged guard" below means rerunning one previously reported complete Script
selection and showing identical statuses. Use `language/arguments-object`
(456/460).

**M0. Runner graph and resolution codes (tools only).**

- Files:
  - `tools/test262-module-graph.ts` (new) and its tests;
  - `tools/test262-native.ts` (`nativeExitOutcome` 60–68 and the table type,
    still returning `unsupported` for execution);
  - `tools/test262-native-run.ts` (fixture identity, adapter bump).
- Acceptance (Node):
  - discovery covers cycles, self-import, JSON, missing files, literal-only
    references, path escape and `.json` extension handling;
  - observation identity changes when a fixture byte changes;
  - Script-only variants produce identical journal inputs.
- Native: none, because there is no image change.

**M1. Module records: load, link, synchronous evaluation, namespaces.**

- Files: `js-runtime/src/modules/*` and the package `exports`;
  `environments/records/index.ts` (D1); `objects/errors.ts` (`moduleHost`
  slot); the async-driver refactor in `objects/async-functions.ts`.
- Acceptance (Node, with hand-built records whose `initialize`/`execute` are TS
  closures):
  - ResolveExport covers ambiguity, star-default exclusion and circular
    re-exports;
  - link errors are SyntaxError, in the specified order;
  - in a cycle, a function hoisted at link time can be called by a module that
    evaluates earlier;
  - live update through the importer;
  - an import assignment throws TypeError;
  - an evaluation error is cached and rethrown on re-import;
  - every namespace internal method;
  - TDZ through the namespace.
- Native: `tools/native-module-records-fixture.ts` exercises the same cases
  with status codes, plus copying-GC churn between link and evaluation, with
  namespace and binding identity preserved.

**M2. `lowerModule` and static module tests (no TLA, no `import()`).**
Refreshed against current source in [HOST-ESM module lowering](host-esm-module-lowering.md).

- Files: `js-engine/src/lowering/index.ts` (the `lowerProgram` factoring and
  `lowerModule`); the M0 runner files (execute the module goal and native
  re-parse of unparsed nodes); the prelude (`runNativeModuleTest`).
- Acceptance:
  - Node: lowered Script output stays byte-identical across the existing
    lowering tests; module-lowering snapshots cover hoisting, default naming,
    `this`, strictness and `import.meta` identity per module.
  - Native fixture: a three-module cycle with live bindings and a namespace,
    run from the runner's table form.
- Reruns:
  - complete `language/module-code` (596 module variants; TLA stays explicit
    `unsupported`), `language/import`, `language/export` and
    `language/expressions/import.meta`;
  - the unchanged guard.

**M3. Dynamic import (standard).**

- Files: `modules/dynamic-import.ts`; lowering of `import-call` for both goals;
  the runner attaches graphs to Scripts.
- Acceptance:
  - Node: ToString abrupt completion becomes a rejection; options and `with`
    validation order; a new promise per call; namespace reuse across Script and
    module referrers; an errored module rejects on every import; referrer
    propagation through jobs and closures.
  - Native fixture: `import()` from a nested async function after GC.
- Reruns: complete `language/expressions/dynamic-import`. Proposal
  subdirectories stay in its denominator as unsupported or fail.

**M4. Top-level await.**

- Files: `modules/evaluation.ts` (the async algorithms); TLA lowering through
  the shared continuation.
- Acceptance:
  - Node: sibling non-blocking order, async-evaluation ordering across a
    diamond, rejection propagating to all ancestors, a cycle with an async
    root, and `await using` at top level.
  - Native fixture: interleaved jobs and the order log.
- Reruns: complete `language/module-code/top-level-await` and
  `staging/top-level-await`, then `dynamic-import` again (its TLA fixtures).

**M5. Import attributes and JSON modules.**

The synthetic-module runtime passes its [native live-binding/context/GC gate](../results/native-synthetic-modules-v1.json), and JSON parsing/default exports pass a [separate native gate](../results/native-json-modules-v1.json). All eleven JSON host cases now pass, and [combined native compiler acceptance](../results/json-await-native-compiler-acceptance-v1.json) includes a byte-identical self-build with signature/DWARF checks. Complete unchanged selections remain pending. These bespoke gates add no Test262 passes.

- Files: `modules/synthetic.ts` (reusing `json-parse.ts`); attribute-key support
  in load and dynamic import; the runner's JSON nodes.
- Acceptance: Node and native tests for a default-only export, a named import
  link error, an invalid-JSON load error, and an unsupported key.
- Reruns: complete `language/import/import-attributes`,
  `language/module-code/import-attributes` and
  `dynamic-import/import-attributes`.

**P-DEFER, P-SOURCE, P-TEXT/BYTES (proposals, separate decisions).** Each slice
is independently gated and verified against the pinned proposal text.

- **P-DEFER:** the deferred namespace exotic object, and evaluation triggered
  on access through ReadyForSyncExecution (213 variants: 101 module plus 112
  Script, and 1 resolution).
- **P-SOURCE:** the `%AbstractModuleSource%` intrinsic plus the
  `$262.AbstractModuleSource` hook, and source-text GetModuleSource throwing
  SyntaxError. `<module source>` stays unsupported (11 module plus 182 Script).
- **P-TEXT:** `type: "text"` (7 variants).
- **P-BYTES:** blocked on `immutable-arraybuffer`. Check whether it exists;
  this plan does not assume it does.

**M7. Runtime-loaded modules and eval in module code (after RT-EVAL S1/S2/S5).**

The eval-only subset now passes 4,366 workspace checks and prepares the [three previously blocked module variants](../results/module-direct-eval-preparation-node-v1.json). The [native context/GC proof](../results/native-module-direct-eval-context-v1.json) and [in-image lowering](../results/native-module-direct-eval-lowering-v1.json) pass; all [eight native host cases](../results/module-direct-eval-native-validation-v1.json) also pass. The [implementation checkpoint](../results/module-direct-eval-implementation-checkpoint-v1.json) is followed by [accepted frozen native compiler validation](../results/module-direct-eval-native-compiler-acceptance-v1.json), including byte-identical images and signature/DWARF checks. The [three unchanged module variants](../results/module-direct-eval-selection-checkpoints-v1.json) pass 3/3. Sites reuse the module scope and the existing effective execution context, with no new frame or runtime vocabulary. Runtime compilation of loaded modules remains separate future work.


- `moduleHost.load` compiles source text at runtime: `parseModule` →
  `lowerModule` → `prepareManagedEntry` → publish → `create` through the
  managed frame. It reuses RT-EVAL's surface, frames and publication unchanged,
  with module vocabulary added to the surface.
- Direct eval inside modules needs RT-EVAL S5's `EvalSite` over the module
  scope. `import.meta` is a SyntaxError inside eval, and eval's referrer is the
  caller's ScriptOrModule.
- Test262 needs only the eval part: `eval-code/*` module variants (4),
  `import.meta/not-accessible-from-direct-eval`, and `usage-from-eval` (2
  Script variants). The loader part serves embedders, not Test262 coverage.

**R. Node reference adapter (optional, off the critical path).**
`vm.SourceTextModule` behind `--experimental-vm-modules`, with results kept
separate and discrepancies checked against the spec.

**Order.** M0 → M1 → M2 → M3 → M4 → M5. Proposals come after M5. M7 follows
RT-EVAL.

- M3 goes before M4 because it unblocks the largest standard population (859
  Script variants), and most of its fixtures have no TLA.
- M0 and M1 are **ready now** and independent of v9, except for M0's
  journal-identity landing constraint.

## 7. Decisions, risks and open questions

| ID  | Decision                      | Default                                                                                                                                                        |
| --- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Import binding representation | Share the exporter's `Binding` object, plus an `importNames` set on the record. The alternative is a per-binding indirection field.                            |
| D2  | Test262 loading               | Preload the AOT graph, and report unsupported for any file that exists but was not discovered. The alternative, runtime compilation, waits for M7 and RT-EVAL. |
| D3  | Lowered module form           | `shape()` + `create()` exports with shared closures. An exported `const` table is rejected because RT-EVAL managed entries reject module state.                |
| D4  | Proposal scope                | Each proposal slice needs explicit approval. None of them blocks M0–M5.                                                                                        |
| D5  | Host error for missing files  | TypeError. The spec leaves it host-defined.                                                                                                                    |

**Risks.**

1. **Batch image growth.** Fixtures add lowered modules, and `modules/` is linked
   into every batch host. Measure compile time and image size in M2.
2. **TLA continuation lowering at the program level.** No callable wraps the
   module body, so `generators.ts` may assume a function. Measure the
   factoring in M4 before you commit to it.
3. **D1 layout change.** It touches every declarative environment. Measure the
   native image size and keep the self-build stage images identical across
   stages.
4. **Discovery gaps** from computed specifiers that are not literal
   `_FIXTURE` strings surface as `unsupported`, by policy. The scan's coverage
   was not measured.

**Open questions.**

1. What error and phase does the pinned spec give for an unsupported attribute
   key on a dynamic import? Settle this before M5.
2. Should Script records get a host-defined referrer, so that non-Test262
   embedders can resolve relative to the Script? Test262 does not need it. The
   current default keeps the opaque `execute` identity.
3. Should `ErrorRealm.moduleHost` be per realm or per agent? `$262.createRealm`
   module tests appear only under ShadowRealm; the default is per realm.

**Not validated.** The following were not checked:

- no native or Node execution of any module test;
- no spec text fetched (algorithm names are from ECMA-262 memory);
- proposal stages;
- whether `immutable-arraybuffer` exists in source;
- whether every `import()` text match runs at runtime;
- whether the bootstrap parser accepts every pinned fixture;
- the cost of the v9 coordination.
