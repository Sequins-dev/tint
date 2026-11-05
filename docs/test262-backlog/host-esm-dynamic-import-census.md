# HOST-ESM: dynamic import and import.meta census (after M2c)

This census answers the "next focused planning task" in the
[M2c fixture syntax proof](host-esm-fixture-syntax-proof.md) §11. It counts the
pinned `language/expressions/dynamic-import` and `language/expressions/import.meta`
populations, plus the rest of the suite that uses `import()` or `import.meta`,
under the unchanged variant policy. Each variant gets one first blocker and one
dependency class, and the classes do not overlap. From that it recommends the
smallest next HOST-ESM slice and compares it with M4.

This is research only. It is **not** an M3 implementation plan. No source,
test, manifest, catalog, result, dashboard, queue, journal, marker or snapshot
was changed. Nothing was built, and no image, native binary, debugger,
controller or agent was run. The running fixture-syntax selections controller
(`run-module-fixture-syntax-selections-v2.mjs`) and the DirectEval
controller/pause were left alone.

## 0. Identities and probe status

| Item             | Value                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Test262          | `91c70759…5ba`, `dirty: false`                                                                                                     |
| Source snapshot  | `2c72f4c9…810c`, 562 files                                                                                                         |
| Frozen toolchain | `.tint-bootstrap/node-toolchain-module-fixture-syntax-v1`, `0ca7cfed…0942` (`frozen-node-toolchain-module-fixture-syntax-v1.json`) |
| M2c state        | Implemented, 11 bespoke native cases matched. The unchanged selections are still running on main                                   |
| Node             | v24.12.0                                                                                                                           |

**All probes are Node-only and non-native.** Three scripts in `/tmp/m3-census/`
import only the frozen toolchain's `tools/*.ts` and its `packages/*/dist`. They
read the pinned bytes and write only to `/tmp`:

- **`probe.mjs`** runs the production routing and preparation for each variant:
  `testMetadata`, `syntaxVariants`, `nativeVariantRoute(…, true)`,
  `executionPlan`, then `prepareNativeModuleProgram` or `prepareNativeScripts`.
  It also runs `discoverModuleGraph`. This is the same path as
  `inventory-module-preparation-v1.mjs`, extended to Script variants.
- **`mask.mjs`** is **hypothetical**. It replaces each `import-call` node with an
  ordinary call and each `import-meta` node with an identifier, then lowers again
  to find any _second_ lowering blocker.
- **`fixtures.mjs`** is **hypothetical** too. It runs `parseModule`, applies the
  same masking, then runs `lowerSourceTextModule` on every discovered fixture.

None of this is conformance evidence. "Prepares" or "lowers" means only that
bootstrap preparation accepted the variant. It is never a native pass, a native
syntax verdict or a forecast. Runtime blockers past lowering were not measured.

## 1. Where `import()` and `import.meta` stop today (verified in source)

The workspace files below are byte-identical to the frozen copies.

| Layer                     | State                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parser                    | Implemented. `import(…)` covers the `evaluation`, `defer` and `source` phases, an optional options argument and a trailing comma. `import.meta` is module-goal only, with literal spelling (`packages/typescript/src/syntax/parser.ts:2010-2059`; `test/syntax-import-expressions.test.ts`)                 |
| Binder                    | Visits the specifier and options. It fails only in _typed_ mode (`binding/index.ts:809-821`)                                                                                                                                                                                                                |
| Lowering                  | An explicit default arm: `import.meta requires HOST-ESM M3` and `dynamic import requires HOST-ESM M3` for modules, and `Script expression lowering is not implemented: import-call` for Scripts (`js-engine/src/lowering/index.ts:3046-3053`)                                                               |
| Script identity           | Script code already runs in `runScriptContext` with `scriptOrModule: $script` (`lowering/index.ts:288-297`, `:5243-5250`). Jobs, generators and async functions propagate `scriptOrModule` (`js-runtime/src/objects/jobs.ts:80,136`, `async-functions.ts:99`)                                               |
| Loading                   | `loadRequestedModules` and `finishLoadingImportedModule` exist. The referrer must be a `ModuleRecord`, the request must be one of its **static** `shape.requests` (otherwise `MODULE_REQUEST_INVARIANT`), and the payload is `GraphLoadingState` only (`modules/loading.ts:33-38,115-161`; `records.ts:32`) |
| Link, evaluate, namespace | `linkModule`, synchronous `evaluateModule` and `settledModulePromise` (`evaluation.ts:90-140`), plus `getModuleNamespace`. Natively accepted through N1 and N2. There is no async evaluation, so TLA is M4                                                                                                  |
| Attributes                | `realm.supportedImportAttributes` exists and is empty (`objects/errors.ts:80,335`). Static requests with unsupported keys are rejected in `innerLoading`                                                                                                                                                    |
| Runner routing            | `nativeVariantRoute` sends parse/early negatives to `syntax`, `module` variants to `module`, and everything else to `script` (`tools/test262-native.ts:194-205`). The Script route (`prepareNativeScripts`, `:207`) never builds module entries                                                             |
| Module host               | `prepareNativeModuleProgram` (`:268-391`) requires the module goal. The generated loader treats non-`./` and undiscovered specifiers as `rejectUnsupportedExecution` (`:543-547`). M2c verdict entries cover only `parsed: false` fixtures (`:358`)                                                         |
| Graph discovery           | `discoverModuleGraph(…, "script")` already collects `./…` names from the raw text, comments included, for dynamic-import roots (`tools/test262-module-graph.ts:19-22`)                                                                                                                                      |

The plan in [HOST-ESM](host-esm.md) §6 put `import.meta` in M2. The frozen
lowering defers it to M3, so this census counts it with M3.

## 2. Population (unchanged variant policy)

`language/expressions/dynamic-import` has 1,005 test files (plus 62 fixtures),
and `language/expressions/import.meta` has 22 (plus 1 fixture). Under
`syntaxVariants` they give **1,927 variants**: 963 sloppy, 909 strict and 55
module, from 1,027 files.

The rest of the suite holds **27 files and 34 variants** that are tagged
`dynamic-import` or `import.meta`, or whose body text contains `import(` or
`import.meta`. They are listed in §5. Four of them are textual false positives.

Production routing with the module gate on:

| Directory      | `syntax` |  `script` | `module` |     Total |
| -------------- | -------: | --------: | -------: | --------: |
| dynamic-import |      717 |     1,145 |       38 |     1,900 |
| import.meta    |       13 |         8 |        6 |        27 |
| **Both**       |  **730** | **1,153** |   **44** | **1,927** |

All 730 `syntax` variants are `negative: {phase: parse, type: SyntaxError}`.
There are no resolution or runtime negatives in these two directories.

Production preparation first blockers, for the 1,197 non-syntax variants:

| First blocker (normalized)                                         | Variants |
| ------------------------------------------------------------------ | -------: |
| `test: Script expression lowering is not implemented: import-call` |    1,143 |
| `<root>: dynamic import requires HOST-ESM M3`                      |       38 |
| `<root>: import.meta requires HOST-ESM M3`                         |        5 |
| `<root>: direct eval in modules requires HOST-ESM M7`              |        1 |
| prepares today (no lowering blocker)                               |       10 |

**Hypothetical second blocker (masking).** For 1,186 of the 1,187 blocked
variants, the masked root lowers. The remaining one is the M7 direct-eval case,
which has no import expression. So in these two directories, `import()` and
`import.meta` are the **only root lowering blockers**. The fixtures are a
separate matter (§3, classes 06, 07 and 09).

## 3. Nonoverlapping classification (1,927 variants, 1,027 files)

Rules are applied in this order: route, then prepared, then M7, then the
`import-defer`/`source-phase-imports` features, then TLA in a fixture, then
JSON/text nodes, then `import-attributes`, then fixture lowering, then referrer
kind. Each variant lands in exactly one class.

| #   | Class                                                              |  Variants |     Files | Sync / async | Dependencies beyond the M3 core                                                  |
| --- | ------------------------------------------------------------------ | --------: | --------: | -----------: | -------------------------------------------------------------------------------- |
| 01  | Parse negatives, syntax lane                                       |       730 |       388 |            — | **None from M3.** Already routed to the native syntax gate                       |
| 02  | `import.meta/syntax/goal-*` Scripts that prepare today             |         8 |         4 |        8 / 0 | **None from M3.** `Function`/generator/async constructors must throw SyntaxError |
| 03  | `usage-from-eval` (Script, prepares today)                         |         2 |         1 |        0 / 2 | M3 plus direct eval: the `import()` sits inside the eval string                  |
| 04  | `import.meta/not-accessible-from-direct-eval`                      |         1 |         1 |        1 / 0 | M7 (direct eval in modules)                                                      |
| 05  | Proposal phases (`import.defer`/`import.source`)                   |       293 |       153 |    160 / 133 | P-DEFER / P-SOURCE. Four also have TLA fixtures                                  |
| 06  | Standard, TLA fixture (`import-fulfilled-member-of-errored-cycle`) |         2 |         1 |        0 / 2 | M4                                                                               |
| 07  | JSON/text module nodes (`import-attributes`)                       |         4 |         2 |        0 / 4 | M5 (`2nd-param_FIXTURE.json`), or P-TEXT                                         |
| 08a | `syntax/valid/*import-attributes-trailing-comma-*`                 |        80 |        42 |       80 / 0 | Options of `undefined` or `{}`. No attributes are processed                      |
| 08b | `import-attributes/*` (non-JSON)                                   |        39 |        20 |       6 / 33 | EvaluateImportCall options and `with` validation. No new module kind             |
| 09  | `catch/*eval-script-code-target` (module)                          |        16 |        16 |       0 / 16 | A fixture early error found only by lowering/binding (§4.3)                      |
| 10  | Standard, **module referrer**, all fixtures lower                  |        22 |        22 |       5 / 17 | None. Fits the existing module host                                              |
| 11  | Standard, **Script referrer**, all fixtures lower                  |       730 |       377 |    136 / 594 | Script-root module host shape (§4.2)                                             |
|     | **Total**                                                          | **1,927** | **1,027** |              |                                                                                  |

Class 05 splits into `syntax/valid` 160, `catch` 128 and `import-defer/*` main
modules 5. The proposal tier stays in the denominator as unsupported.

### 3.1 Class 10: the 22 module-referrer variants

| Group                                                                                                                                                               | Variants | Notes                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------: | ---------------------------------------------------------------------------------- |
| `import.meta/`: `distinct-for-each-module`, `import-meta-is-an-ordinary-object`, `same-object-returned`, `syntax/goal-module`, `syntax/goal-module-nested-function` |        5 | Synchronous. `import.meta` only, no `import()`. One fixture (`distinct-…_FIXTURE`) |
| `dynamic-import/eval-export-dflt-*` (11), `eval-self-once-module`, `imported-self-update`, `reuse-namespace-object-from-import`                                     |       14 | Async. Self-import: the graph node is the root itself                              |
| `namespace/{await,promise-then}-ns-get-nested-namespace-dflt-indirect`                                                                                              |        2 | Async. `export * as ns`, already proven by N2                                      |
| `assignment-expression/import-meta`                                                                                                                                 |        1 | Async. Uses both `import()` and `import.meta`                                      |

### 3.2 Class 11: the 730 Script-referrer variants

By directory: `usage` 216, `catch` 192, `syntax/valid` 126, `namespace` 114,
`assignment-expression` 52, and the directory root 30. Every one has the
`dynamic-import` feature. 56 include `asyncHelpers.js`, 42 `fnGlobalObject.js`
and 2 `compareArray.js`. The async Script route and `$DONE` are already enabled.

| Semantic need                                  | Variants | Cases                                                                                                                                         |
| ---------------------------------------------- | -------: | --------------------------------------------------------------------------------------------------------------------------------------------- |
| No fixture is reached (discovered graph empty) |      112 | `empty-str-is-valid-assign-expr` 40, `file-does-not-exist` 32, `specifier-tostring-abrupt-rejects` 32, 4 direct files × 2                     |
| Error propagation through the dynamic promise  |      130 | `eval-rqstd-abrupt-{typeerror,urierror}` 64 (evaluation), `instn-iee-err-{ambiguous-import,circular}` 64 (linking), `import-errored-module` 2 |
| Load → link → evaluate → namespace             |      488 | `usage/*`, `namespace/ns-*`, `nested-imports`, `script-code-valid`, the remaining `syntax/valid` and the direct files                         |

The 136 synchronous variants (`empty-str…` 40, `nested-imports` 40,
`script-code-valid` 40, and 16 direct-file variants) observe only that
`import()` returns without throwing synchronously. A native pass there is weak
evidence about loading, and their acceptance should say so.

Discovered graphs have 0–4 nodes, and every fixture lowers with masking. Four
class-11 variants (`indirect-resolution`, `update-to-dynamic-import`) and one
class-10 variant (`distinct-for-each-module`) have fixtures that themselves use
`import()` or `import.meta`.

## 4. Caveats that change counts

### 4.1 Missing-file policy

The current loader turns any undiscovered specifier into
`rejectUnsupportedExecution` (exit 10). `file-does-not-exist` (32 variants in
class 11) expects a _rejected promise_. [HOST-ESM](host-esm.md) D2 already
says: report unsupported only for a file that **exists** but was not discovered.
So a specifier that is absent from `graph.siblings` should become a host throw
completion. Until that host policy lands, those 32 variants stay unsupported.

### 4.2 Script roots have no module host

Class 11, 08a, 08b and 03 together need a host in which a **Script** root has
module fixtures available to `realm.moduleLoader`. The referrer is the Script
identity `$script`, or the realm. Today `prepareNativeModuleProgram` rejects a
non-module goal. Raw-text discovery for Script roots can over-include a name
that only appears in a comment or a computed specifier, for example
`specifier-tostring`. Fixtures should be compiled but only instantiated when
loaded, as `record(index)` already does lazily.

### 4.3 Class 09: an early error the bootstrap parser accepts

`catch/script-code_FIXTURE.js` (`var smoosh; function smoosh() {}`) parses, so
it is `parsed: true` and M2c does not route it to a verdict entry. Lowering
then rejects it with `duplicate value binding: smoosh`, which is a module early
error. After M3, the graph is `unsupported` with that reason. If the verdict
entry were also used for parsed fixtures that lowering rejects, then
`nativeSyntaxVerdictSource`'s `validateJavaScriptBindings` (`DUPLICATE_NAME` → 40) could judge it. That would be a tools-only extension of M2c, decided
separately. It is excluded from every M3 ceiling below.

### 4.4 Classes that need no M3 work

Class 01 (730) and class 02 (8) need nothing from M3. They are measurable now
through the existing syntax and Script lanes, yet no native report covers
either directory: neither group inventory v74 nor any `selections` row has
one. Running them is main's choice. It is listed only so that those
measurements are not later credited to M3.

### 4.5 Reconciliation with HOST-ESM §2

[HOST-ESM](host-esm.md) counted 1,145 Script-goal import-call variants in the
directory, and 859 standard ones suite-wide. This census gives 1,145 = 1,143
blocked + 2 class-03. The standard count is 1,145 − 288 Script proposal = 857 in
the directory, plus `module-code/top-level-await/dynamic-import-of-waiting-module`
(2) = 859. The figures agree.

## 5. Outside the two directories (34 variants, 27 files)

| Class                                                                                                                                     | Variants | Files                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------: | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Parse negatives (`assignmenttargettype/{direct,parenthesized}-{import.meta,importcall}`)                                                  |        6 | 4                                                                                                                                         |
| Textual false positives that prepare today (`reserved-words/ident-name-keyword-accessor`, `staging/sm/…/optional-chain-first-expression`) |        4 | 2                                                                                                                                         |
| Proposal (`import-defer`, `source-phase-imports`)                                                                                         |        8 | 6                                                                                                                                         |
| TLA in the root or a fixture (M4 first, or M4 after M3)                                                                                   |       13 | 12: `module-code/top-level-await/*` 11 (including `dynamic-import-of-waiting-module` ×2 Script), `staging/top-level-await/tla-hang-entry` |
| M5 (`import/import-attributes/json-idempotency`)                                                                                          |        1 | 1                                                                                                                                         |
| **M3 only, module referrer** (`module-code/verify-dfs`, `staging/sm/expressions/optional-chain-first-expression-module`)                  |    **2** | 2                                                                                                                                         |

These reproduce the M2c §11 inventory's nine `dynamic import requires HOST-ESM
M3` first-blocker hits: five TLA, three `import-defer` and `verify-dfs`. Masking
shows that only `verify-dfs` is M3-only among them. The staging
`optional-chain-first-expression-module` is first-blocked by `import.meta`, also
uses `import()`, and its single fixture lowers.

## 6. Already implemented prerequisites (reuse, do not rebuild)

- **Syntax.** The parser AST for all import-call phases and import.meta, with
  the module-only goal check, and the binder walk.
- **Execution contexts.** The Script identity (`$script`) as `scriptOrModule`,
  propagated through promise jobs, generators and async functions. This is
  the GetActiveScriptOrModule input.
- **Module machinery.** LoadRequestedModules, the graph-loading state,
  `linkModule`, synchronous `evaluateModule` with an errored-module cache
  (`evaluationError`), namespaces including `export * as ns`, module promise
  capabilities, and `realm.supportedImportAttributes`.
- **Runner.** The module host with lazy `record(index)`, self-import identity,
  the async `$DONE` harness, verdict entries (M2c), Script-goal raw-text graph
  discovery, and the `siblings` list.
- **Evidence.** N1 9/10, N2 38/38, and M2c's 11 bespoke native cases. The
  unchanged fixture-syntax selections are pending.

## 7. What every M3 slice must add (inventory, not a plan)

1. Lowering of `import-call` (evaluation phase) and `import-meta` for both
   goals. Proposal phases stay an explicit failure.
2. EvaluateImportCall: GetActiveScriptOrModule, then the referrer or the realm.
   Then a new capability, and ToString inside it. Then options and `with`
   validation. The supported keys stay empty until M5.
3. HostLoadImportedModule and FinishLoadingImportedModule generalized to a
   referrer that is a Script, a Module or a Realm. They also need a
   **dynamic** request that is not in `shape.requests`, and a capability
   payload (ContinueDynamicImport: load → link → evaluate → namespace).
   Today's `MODULE_REQUEST_INVARIANT` and `ModuleRecord`-only referrer block
   both.
4. GetImportMeta: one lazily created null-prototype object per module.
   HostGetImportMetaProperties is empty and Finalize is a no-op.
5. Tools: the missing-file policy (§4.1), and for Script roots, a Script-root
   host shape (§4.2).

Items 1–4 are **package** changes (`js-engine`, `js-runtime`). Unlike M2c,
they require a new source snapshot, a native compiler self-build and a
fixed-point comparison. Item 5 is tools-only.

## 8. Ceilings (lowering-level, never a forecast)

A ceiling counts variants whose **only** measured lowering blocker the slice
removes. Runtime defects, harness behaviour and native faults are unmeasured.

| Slice                                                                         | Ceiling (variants)                                    | Self-build |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- | ---------- |
| import.meta only, module host                                                 | 5 (class 10 subset) + 0 outside                       | yes        |
| **M3a: module-referrer `import()` + import.meta in the existing module host** | **22 (class 10) + 2 (§5) = 24**                       | yes        |
| M3b: Script-root host (tools), given M3a's runtime is referrer-agnostic       | 730 (class 11) + 80 (08a) + 39 (08b) = **849**        | no         |
| Class 11 without the missing-file policy                                      | 698                                                   | —          |
| M2c verdict extension for lowering-rejected fixtures (tools), after M3a       | 16 (class 09)                                         | no         |
| M4 (inventory v1 first blockers, `module-code` 236 + `import` 2)              | ≤ 238, plus class 06 (2) and §5 TLA (13) **after** M3 | yes        |

The rows overlap only where stated: M3b presumes M3a. Their sum is not a
coverage figure.

## 9. M3 versus M4 on the evidence

- **Population.** The standard M3 lowering-clean ceiling is 24 + 849 = 873
  variants. M4's first-blocker population is at most 238. The 15 TLA variants
  counted here (class 06 and §5) all sit in dynamic-import populations, so they
  benefit from M4 only _after_ M3.
- **Mechanism.** M3 reuses implemented load/link/evaluate/namespace code and
  adds a dynamic entry point. M4 needs new algorithms: async module evaluation
  (AsyncModuleExecutionFulfilled/Rejected, `[[PendingAsyncDependencies]]`) and
  TLA lowering through the shared continuation. `evaluation.ts` is synchronous
  today.
- **Risk locality.** M3a runs entirely inside the module host that N1, N2 and
  M2c exercised. M4 changes the evaluation order of every module graph.

So the evidence supports M3 before M4, consistent with [HOST-ESM](host-esm.md)
§6 "Order".

## 10. Recommendation

**Next slice: M3a, module-referrer `import()` plus `import.meta` in the
existing module host.**

- **Why this one.** It is the smallest slice that exercises the whole shared
  M3 kernel (§7 items 1–4) natively without a new host shape. Its native
  denominator is small and exact: 24 module variants (class 10, `verify-dfs`
  and the staging `optional-chain-first-expression-module`). It adds no routing
  change for the 1,153 Script variants.
- **Why not import.meta alone.** It costs the same self-build for 5 variants and
  leaves the loading generalization, which is the real risk, unproven.
- **Constraint to carry into planning.** Make the runtime half of M3a
  referrer-agnostic: Script, Module or Realm referrers, and Script-goal lowering
  of `import-call`. Then M3b (849) is a tools-only host change and needs no
  second self-build. If the Script half is left out of M3a, M3b needs its own
  package slice. Prove the Script referrer in M3a with Node tests only. Native
  Script evidence waits for M3b.
- **Selections to name when planning.** The 24-variant list from
  `/tmp/m3-census/rows-*.json`, re-pinned by a Node-only census under the M3a
  toolchain. Run them as single-file runs, because some files are spread
  across directories. Then run regressions of the unchanged `namespace`,
  `ambiguous-export-bindings` and fixture-syntax selections.
- **Keep separate.** The missing-file policy (§4.1) belongs to M3b. Decide the
  class-09 verdict extension independently. Proposal (293 + 8), M5 (5), M4
  (2 + 13) and M7 (1 + 2) variants stay unsupported in the denominators.
- **Independent of M3.** The 730 syntax-lane and 8 Script `goal-*` variants
  (§4.4) can be measured with the current toolchain whenever main chooses.
- **Runtime plan.** The [M3a runtime plan](host-esm-dynamic-import-runtime.md)
  settles referrers, loaded-module caches and the import-call contracts.

## 11. Open questions for the M3a plan

1. Where should a Script referrer's `[[LoadedModules]]` live? The options are
   a field on the `$script` object, or a runtime side table keyed by referrer
   identity. Check the `$script` shape before choosing.
2. Whether the module host can keep `settledModulePromise(evaluation)` as the
   last synchronous check while dynamic imports settle in later jobs, as the
   `async` runner jobs already do for `$DONE`.
3. Whether class 10's 5 synchronous `import.meta` cases need any `Object`
   integrity operations beyond those already native.
   `import-meta-is-an-ordinary-object` uses `setPrototypeOf`, `preventExtensions`,
   `seal` and `freeze`.
