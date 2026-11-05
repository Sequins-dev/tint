# HOST-ESM M2b: the native Test262 module host

Plan for the M2b handoff in the [M2 lowering plan](host-esm-module-lowering.md)
§4. Research only: no source, test, manifest, catalog, data, result, queue or
snapshot was changed; nothing was built or run natively; no process or marker
was touched.

**Baseline (historical planning snapshot).** Source snapshot `08c97ee7…ce08` (562 files); the
[Node checkpoint](../results/module-source-factory-node-checkpoint-v1.json)
records 4,207/4,207 workspace tests (`conformance: false`). The
[surface census](../results/module-source-surface-census-v1.json) records 191
records, 167 signatures, 49 providers and 421 slots; the managed vocabulary is 128. Native M1b/M2a are **not** accepted: the unchanged, previously passing
image also failed to reach a confirmed stopped-at-entry
([analysis](../results/module-launch-control-analysis-v1.json)).
`stage1-module-loading-v1` builds and has valid DWARF, but the frozen fixed
point is withheld. The direct-eval conformance line runs on a frozen older
toolchain and must not move. Full survey and compile-performance work are
deferred and are **not** prerequisites here.

**Implementation refresh:** M0–M2b pass the
[4,237-test workspace gate](../results/module-host-routing-node-checkpoint-v1.json),
[seven native host cases](../results/module-host-native-validation-v1.json),
[the byte-identical frozen fixed point](../results/bootstrap-module-source-v1.json)
and [artifact verification](../results/module-source-selfbuild-artifact-validation-v1.json).
Resume-safe routing is enabled with `TINT_TEST262_MODULES=1`.
The unchanged [first module selection](../results/test262-module-eval-this-native-v1.json)
passes (1/1), and the [Script compatibility control](../results/test262-module-host-script-guard-v1.json)
passes both variants. The [ambiguous-export group](../results/test262-module-ambiguous-export-bindings-native-v1.json)
passes 9/10; source-phase imports remain unsupported. The [routing plan](host-esm-module-host-routing.md) and
[ambiguous-export selection plan](host-esm-ambiguous-export-selection.md) cover
widening beyond this first test. Template sites live inside each module factory,
so separate records retain separate identity even when factory code is shared.

**Authorities.** ECMA-262 editor's draft ("ECMAScript® 2027"), fetched
2026-11-05 from `tc39.es/ecma262/multipage`: 16.2.1.6.1.1.1 InnerModuleLoading,
16.2.1.6.1.1.2 ContinueModuleLoading, 16.2.1.6.1.3 Evaluate, 16.2.1.7.1
ParseModule (export normalization), 16.2.1.10 HostLoadImportedModule, 16.2.1.11
FinishLoadingImportedModule, 16.2.1.12 AllImportAttributesSupported. Pinned
Test262 `91c70759363c46557b694792bf34a2551a7af5ba`: `INTERPRETING.md`
"Modules", "`negative`" and `module` flag; `CONTRIBUTING.md` "Rules For Module
`_FIXTURE` Files". Node is **not** an authority here (§2.4).

## 1. What exists vs what is planned (verified in source)

| API                                                                               | State       | Where                                                     |
| --------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------- |
| `collectModuleDeclarations`                                                       | exists      | `packages/typescript/src/binding/script.ts`, `index.ts`   |
| `sourceModuleShape(module)`                                                       | exists      | `js-engine/src/lowering/module-shape.ts:23`               |
| `canonicalModuleRequest`, `moduleRequestsEqual`                                   | exist       | `foundation/src/modules.ts`                               |
| `createLoweredSourceModule(global, realm, hostDefined, shape, decls, inst, exec)` | exists      | `modules/source.ts:35`                                    |
| `ModuleRecord.executionFault`                                                     | exists      | `modules/records.ts:58-59`, set at `source.ts:120-124`    |
| `loadRequestedModules`, `finishLoadingImportedModule`, `ModuleLoader`             | exist       | `modules/loading.ts:115,134,33`                           |
| `linkModule` → `ModuleLinkResult`                                                 | exists      | `modules/linking.ts:142`                                  |
| `evaluateModule`, `settledModulePromise`                                          | exist       | `modules/evaluation.ts:90,127`                            |
| `realm.moduleLoader` (mutable), `supportedImportAttributes` (readonly, `[]`)      | exist       | `objects/errors.ts:79-80,334-335`                         |
| `rejectUnsupportedExecution(realm)` (sets flag, `throw undefined`)                | exists      | `objects/errors.ts:580-583`                               |
| `discoverModuleGraph(filename, source, goal)`                                     | exists      | `tools/test262-module-graph.ts:22`; caller: its test only |
| `lowerSourceTextModule(module, sourceText?)` → `create($global,$errors,$hd)`      | exists      | M2a shared lowering; native acceptance linked below       |
| `prepareNativeModuleProgram`, `runNativeModuleTest`, module host template         | **PLANNED** | this document                                             |
| `nativeModuleCapability(snapshot)`, adapter `native-script-v10-modules`           | **PLANNED** | this document                                             |
| exits 60–69, `fixtures` in `NativeObservationInput`                               | **PLANNED** | this document                                             |

`@tint/js-runtime/modules` is public (`packages/js-runtime/package.json:47`) and
re-exports everything above from `modules/index.ts:1-39`.

## 2. Protocol facts the host must respect (read from code)

### 2.1 Which failures are JavaScript outcomes

- **Load.** `loadRequestedModules` returns a promise. A loader that calls
  `finishLoadingImportedModule` synchronously settles it before return:
  `continueLoading` rejects (`loading.ts:62-65`) or `innerLoading` resolves
  (`:104-113`). A missing loader calls `rejectUnsupportedExecution`
  (`:95-96`); that throw, and every `MODULE_*_INVARIANT`, escapes
  `loadRequestedModules` **synchronously** (no catch in `loading.ts`).
- **Link.** Resolution SyntaxErrors are a typed `{ok: false, error}`
  (`linking.ts:24-33,154-157`); everything thrown is rethrown after the stack
  reset (`:160-163`). Linking runs no user code: `instantiate` only creates
  hoisted function objects (`source.ts:91-108`).
- **Evaluate.** Only the body's abrupt completion becomes a rejection
  (`evaluation.ts:65-75`). `executionFault` (embedding-owned, set only by
  `createLoweredSourceModule` for a malformed completion kind) is rethrown
  outside that path (`:72-73`). Preflight TLA/`evaluating-async`
  (`:23-28`) and status invariants throw before a capability exists
  (`:94-104`).
- **Unsupported inside a body.** A `"unsupported"` completion calls
  `rejectUnsupportedExecution(realm)` inside `execute` (`source.ts:117`); the
  resulting `throw undefined` **is** caught by `innerEvaluation`, cached as
  `evaluationError: {error: undefined}` and rejects the promise. The flag is the
  only authority, so the host must test `realm.unsupported` on every realm
  **before** reading any settled value, exactly as `runNativeScripts` does
  (`test262-native.ts:552-557`).

**Host rule (no new slot, no content inspection).** A synchronous throw out of
`loadRequestedModules`, `linkModule` or `evaluateModule` is never a JS outcome:
exit 10 if any realm is `unsupported`, else exit 69 (§4). A settled rejection
or `{ok: false}` is a JS outcome, read only after the unsupported check. An
identical user-thrown string stays a rejection (the K6 resolution), because
classification depends on _where_ the value surfaced, never on its contents.

### 2.2 Loader contract (16.2.1.10, 16.2.1.11)

The host must call FinishLoadingImportedModule "either synchronously or
asynchronously", and for an equal (referrer, ModuleRequestsEqual request) pair
with a normal result it must return the **same** record each time.
`finishLoadingImportedModule` enforces the second as
`MODULE_LOAD_IDENTITY_INVARIANT` (`loading.ts:154-158`). InnerModuleLoading
throws a SyntaxError for any attribute key outside
HostGetSupportedImportAttributes before calling the host; the runtime does the
same (`loading.ts:79-89`) with `supportedImportAttributes = []`. That
SyntaxError would be a _conforming_ outcome for an attribute-less host, so it
could accidentally "pass" attribute tests; M2b therefore reports every request
with attributes `unsupported` during preparation (M5 owns attributes).

### 2.3 Test262 module rules (pinned `INTERPRETING.md`)

- Every specifier starts with `./`; the remainder names a file in the test's
  directory, parsed by ParseModule. `.json` files are JSON modules.
- `_FIXTURE` files are never standalone tests (`test262-checkout.ts:14`
  already excludes them) and receive no realm modifications. CONTRIBUTING
  turns this into an author rule (fixtures **must not** use Test262 or host
  bindings), so one shared realm for harness, root and fixtures is correct.
- `negative.phase: resolution` means "occurs during module resolution"; the
  pinned example is a fixture parse error surfacing at resolution. Harness
  Scripts still run first (`executionPlan` keeps the harness for non-parse
  negatives, `test262-execution.ts:41-50`), and `$DONOTEVALUATE`
  (`harness/sta.js:26-28`) throws a string, which maps to exit 30 → `fail`.
  Raw tests use a literal `throw "Test262: …"` instead
  (`module-code/import-attributes/allow-nlt-before-with.js`).
- The `module` flag forbids the strict-prefix transform; `executionPlan`
  already passes the source unchanged (`:39-40`).

### 2.4 Namespace re-export normalization

Current ParseModule step 10 rewrites **every** local export of an imported
name, namespace imports included, to an indirect entry with the import's
`[[ImportName]]`, so duplicates through `export *` are not ambiguous.
`createSourceTextModule` rejects the non-normalized form (`records.ts:85-88`).
Pinned `ambiguous-export-bindings/namespace-unambiguous-if-import-star-as-and-export.js`
tests exactly this; Node 24.12 still reports ambiguity (M1b §1.1) and is not a
reference. No compatibility shim.

## 3. Preparation (`tools/test262-native.ts`)

### 3.1 Capability gate preserving frozen v9 hosts

Add `nativeModuleCapability(snapshot): boolean`, modeled on
`capturedNativeRuntimeCapabilities` (`:802-884`):
`capturedPublicEntry(snapshot.publicEntries ?? snapshot.mappings,
"@tint/js-runtime/modules")`; `undefined` → `false` (the older frozen snapshot
cannot throw here). Otherwise require captured exports
`createLoweredSourceModule`, `loadRequestedModules`,
`finishLoadingImportedModule`, `linkModule`, `evaluateModule` and
`settledModulePromise`; a partial set throws "incomplete captured module host
contract", like `capturedScriptEvaluation` (`:921-972`).

When the gate is `false`, every byte the adapter emits stays as today:
`prepareNativeScripts` returns the identical
`unsupported("native module execution is not implemented")` (`:190-191`), the
runtime text, host template, batch output, adapter string (`:910-920`), report
`scope` (`test262-native-run.ts:297`) and observation inputs are unchanged, and
`discoverModuleGraph` is not called. The gate is computed once next to
`engine` (`run.ts:79`) and passed to the builder and preparation.

**Adapter.** `nativeScriptAdapter(evaluation, modules)` returns
`native-script-v10-modules` only when `modules && evaluation?.directEval`;
modules without direct eval throw "module host requires the v9 Script
contract" (no new combinations). The journal header carries `engine`, so a v9
journal can never resume into v10 (`native-run-journal.ts:112-114`).

### 3.2 `prepareNativeModuleProgram(plan, harness, filename, discover)`

Called from `run.ts:242` instead of `prepareNativeScripts` only when
`variant === "module"`, the gate is on and the test is not a parse/early
negative (those stay on native syntax validation, `run.ts:234-240`). Order:

1. **Harness** lowers exactly as in `prepareNativeScripts` (`:194-222`),
   factored into a shared helper so the Script path is byte-identical. The
   harness may be empty (`raw`).
2. **Root screen before discovery:** decode, `parseModule`; failure →
   `unsupported` (a partial grammar is not proof, as at `:204-206`).
   `sourceModuleShape`; `ok: false` (`import defer`/`source`) → `unsupported`
   with its message. Any request with attributes → `unsupported("import
attributes require HOST-ESM M5")`. Screening first also keeps
   `import/import-bytes/bytes-from-png.js` (attribute `type: 'bytes'`) away
   from discovery, which throws on its PNG fixture under the fatal UTF-8
   decoder (non-native probe, §8). A discovery throw on any other test stays an
   adapter crash; it is not reclassified.
3. **Discovery:** `discoverModuleGraph(filename, plan.source, "module")`.
4. **Node screen:** any `kind: "json"` node → `unsupported` (M5); any
   `parsed: false` node → `unsupported("fixture syntax verdict requires native
re-parse (M2c)")`. Never a fabricated SyntaxError, and never a resolution
   outcome.
5. **Lowering:** the root, then each non-root node in `nodes` order, with
   `lowerSourceTextModule`. A node whose lowering fails (`UNSUPPORTED` _or_
   `EARLY_ERROR`) → `unsupported`: a fixture early error is a resolution-phase
   SyntaxError only with M2c's native proof. Root `EARLY_ERROR` on a
   non-negative test → `unsupported`, as for Scripts. M2a's `UNSUPPORTED`
   messages keep TLA, `for await`, `await using`, `import.meta`, `import()` and
   direct eval explicitly unsupported.
6. **Entries:** `[{name: root, module}, ...nodes.filter(n => n.name !== root)]`.
   A self-importing root appears once. Dependencies: the Script map plus
   `["@tint/js-runtime/modules", "packages/js-runtime/src/modules/index.ts"]`.

Result: `{ok: true, harness: SourceModule[], entries: {name, module}[],
fixtures: {name, sha256}[]}` where `fixtures` are the non-root nodes, sorted by
name (discovery already sorts, `test262-module-graph.ts:74`).

Discovery is deliberately over-inclusive (comment paths, `:62-65`). Unreached
nodes are still lowered and hashed: a lowering failure there makes the test
`unsupported` (conservative, never a pass), and the identity stays stable when
M3 makes `import()` targets reachable.

### 3.3 Identity invariants

- **Records by name, per process.** The loader caches one record per entry
  _name_ (§4.2), and the root is that cache's entry 0. A root self-import, and
  a fixture self-import such as `import-attributes/ensure-linking-error_FIXTURE.js`,
  therefore return the same record, satisfying 16.2.1.10.
- **Templates by file.** Tagged-template sites are module-level `const`s of
  the lowered output (`lowering/index.ts:2327-2345,4741-4743`), so two records
  created from one `SourceModule` share template objects. Distinct files are
  distinct Parse Nodes and must not share. `prepareNativeBatch` shares by
  content key (`:719-724`); for module entries the key becomes
  `JSON.stringify([name, module, dependencies])`. Same-named fixtures are
  still shared across cases (each case is a separate process); two different
  names never share within a case. The root and its self-import are one
  name, one record, one site set, which is correct.
- **Hooks and globals.** Records are created with the case's real
  `host.global`, `host.realm` and `hostDefined = undefined`, from
  `createRealmHost` (`:391-460`); `$262`, `print` and the job queue are the
  Script host's.

## 4. Execution (generated runtime text)

### 4.1 Reuse, not a parallel host

`runNativeScripts` is generated text (`:486-561`). Factor its realm setup,
`print`, `captureTestErrorPrototype`, `failure`, harness loop and post-drain
checks into TypeScript **string fragments** interpolated verbatim back into
`runNativeScripts`. The v9 text digest (test T2) proves this. Behind the gate,
emit `runNativeModuleTest` from the same fragments plus the module import
`{type ModuleRecord, type ModuleRequest, type GraphLoadingState,
loadRequestedModules, finishLoadingImportedModule, linkModule, evaluateModule,
settledModulePromise} from "modules"`, mapped to
`packages/js-runtime/src/modules/index.ts` in `nativeTestRuntime` (`:563-641`)
only when gated. The verified split, the review of the landed runner, the
closure check and the T7 tests are in
[host-esm-module-host-runner.md](host-esm-module-host-runner.md).

### 4.2 `runNativeModuleTest(harness, names, creates, asynchronous, canSuspend)`

1. Realm host, `print` and `$262` as today; run the harness Scripts with the
   existing 20–28/10 mapping and `captureTestErrorPrototype`.
2. `records: (ModuleRecord | undefined)[]`; `records[0] = creates[0](global,
realm, undefined)`. Set `realm.moduleLoader = (referrer, request, _,
payload) => …`:
   `index = names.indexOf(request.specifier.slice(2))` only when the specifier
   starts with `./`; `index < 0` → `rejectUnsupportedExecution(realm)` (a
   request discovery did not see is a host gap, not a JS error); otherwise
   create once, then `finishLoadingImportedModule(referrer, request, payload,
{ok: true, module})`. The loader never produces a JS error in M2b.
3. **Load:** `try { p = loadRequestedModules(root, hooks, undefined) } catch
{ return anyUnsupported() ? 10 : 69 }`; then `anyUnsupported()` → 10;
   `settledModulePromise(p, realm)`: `pending` → 69; `rejected` →
   `failure(error, 60)`.
4. **Link:** same `try` shape around `linkModule(root)`; unsupported → 10;
   `{ok: false}` → `failure(error, 60)`. No body has run.
5. **Evaluate:** same `try` around `evaluateModule(root, hooks)`; unsupported →
   10 (this is where the cached `undefined` from §2.1 is discarded);
   `pending` → 69 (M2a has no TLA); `rejected` → `failure(error, 30)`.
6. **Jobs:** `drainScriptJobs` with the existing `jobFailure`; unsupported → 10;
   then `asynchronous ? completion : 42`, as in Scripts.

Only step 5 can run module bodies, so a resolution-negative test's root and
fixtures never execute: link/load failures return before `evaluateModule`.
`print`'s `$DONE` handling, 11/12 and 50–59 are unchanged.

### 4.3 Exit codes (collision-checked)

Producers today: runtime host 10, 11, 12, 13–17 (`scriptFaultExit`, `:332`),
20–28, 30–38, 42, 50–59; native syntax batch 10, 40, 42
(`test262-native-syntax.ts:27-36`); selector 99 (`:766-786`). Tests pin 18 and
99 as `crash` (`test262-script-service.test.ts:25`,
`test262-native.test.ts:43`). Nothing produces or asserts 60–69.

| Exit  | `nativeExitOutcome`                                                                                         |
| ----- | ----------------------------------------------------------------------------------------------------------- |
| 60–68 | `{kind: "error", phase: "resolution", type: <the 20/30 table>, message: "native module resolution failed"}` |
| 69    | `{kind: "crash", detail: "native module host invariant"}`                                                   |
| 70+   | unchanged `unexpected native exit status`                                                                   |

60 itself is a non-Error throw (type `""`), as for 20 and 30. `judgeExecution`
already compares `phase: "resolution"` (`test262-execution.ts:69-73`).

## 5. Journal and report identity

- `NativeObservationInput` (`native-run-journal.ts:19-29`) gains optional
  `fixtures?: readonly {name: string; sha256: string}[]`, present **only** for
  module-host-routed variants with at least one non-root node; Script, syntax
  and ungated observations serialize byte-identically.
  `sameNativeObservationInput` (`:237-253`) copies `prior.fixtures` into
  `before`.
- `NativeTestCase` (`:226-230`) gains optional `moduleNames`, absent for
  Scripts. `nativeTestHost` (`:646-674`) emits `import {create as moduleN}` for
  module entries and calls `runNativeModuleTest`.
- Report `scope` (`run.ts:297`) appends, only when gated: "Module variants load
  sibling fixtures through a synchronous table loader; unparsed fixtures, JSON,
  attributes, top-level await, import() and import.meta are unsupported."
- `variantPolicy` still says fixtures are excluded as standalone tests; their
  hashes now enter identity through `fixtures`.

## 6. Red-first tests (each seen failing first)

Record the T2 digests **before** editing `test262-native.ts`. The measured
T1/T2 plan, which includes the gate's lowered-factory marker rule for
historical partial contracts, is in
[host-esm-module-host-pins.md](host-esm-module-host-pins.md).

`tools/test262-module-host.test.ts` (new):

- **T1 gate:** the current snapshot → `true`; a copy with the
  `@tint/js-runtime/modules` mapping removed → `false`, no throw; one required
  export missing → "incomplete captured module host contract".
- **T2 v9 byte identity:** SHA-256 of `nativeTestRuntimeSource(...)` for the
  direct-eval capability set, and of `JSON.stringify(prepareNativeBatch(cases))`
  for a fixed sync, async and harness-failing Script corpus, equal the recorded
  values with the gate off; `nativeScriptAdapter` without modules still returns
  `native-script-v9-direct-eval`; a module plan with the gate off returns the
  exact current `unsupported` outcome.
- **T3 preparation:** with temp-directory fixtures (as in
  `test262-module-graph.test.ts:12-20`): self-import → one entry; a
  self-importing fixture → one entry; `with {type: "json"}` → unsupported before
  discovery; a `.json` node, a `parsed: false` node, `import defer`, top-level
  `await`, `import.meta`, `import()` → each `unsupported` with its reason; a
  fixture with a duplicate export → `unsupported`, never `kind: "error"`; root
  parse failure → `unsupported`; empty harness accepted.
- **T4 batch identity:** two distinct names with identical template-bearing
  text in one case → two `SourceModule` ids; the same name in two cases → one
  shared id; root and self-import → one id.
- **T5 exits:** 60…68 map to the resolution table; 69 → `crash`; 18, 70 and 99
  unchanged; 13–17 unchanged.
- **T6 journal:** `fixtures` absent for Scripts and root-only modules, present
  and sorted otherwise; a changed fixture hash makes
  `sameNativeObservationInput` false; ungated observation JSON unchanged.
- **T7 generated text:** the gated runtime contains the loader, and its
  load/link/evaluate blocks each test `anyUnsupported()` before
  `settledModulePromise` or `failure`, so the order cannot regress unseen.

Then `pnpm check`. No catalog change unless a new tools file is catalogued; no
managed-surface change (the prelude is test-image code, so 128 stays).

## 7. Native and unchanged Test262 gates

All native steps stay **blocked** until the M1b launch-control finding is
understood and M2a's hosted fixture reaches stopped-at-entry and exit 42.
Never run them while `stage1-module-loading-v1` or any other build is running.
No fixed-point claim.

1. **Hosted fixture** (`tools/verify-hosted-module-host.ts`, new): build one
   gated batch of three generated cases from temp graphs — a link SyntaxError
   (expects 63, with a `$DONOTEVALUATE`-style string throw that would give 30),
   a body `throw new TypeError` (expects 31) and a self-importing pass (42).
   Serial LLDB, pre-entry failures recorded separately, as in M2a gate 2.
2. **Unchanged guard:** rerun `language/arguments-object` **with the gate
   off**, i.e. with the frozen v9 snapshot restored through
   `TINT_TEST262_SOURCES`, into a new immutable report whose statuses and
   adapter equal its last complete report. Do not touch the frozen
   direct-eval conformance run.
3. **First module selection:** `language/module-code/eval-this.js` (single-file
   selections are supported, `test262-checkout.ts:12-16`). It is root-only, has
   no fixtures, imports nothing, and asserts `this === undefined` through the
   standard harness: one record, all three phases, one report.
4. **Graph selection:** `language/module-code/ambiguous-export-bindings` (10
   module variants; all have fixtures, 3 self-import, 4 resolution SyntaxError
   negatives, plus the §2.4 namespace case).
5. **Full selections**, each a separate immutable report: `language/module-code`
   (recursive: it **contains** `namespace`, `ambiguous-export-bindings`,
   `top-level-await`, `import-attributes` and `source-phase-import`; never add
   subdirectory counts to it), `language/import`, `language/export` and
   `language/expressions/import.meta`.

**Blocking rules between steps** (from reports, not forecasts):

- Any exit 69, `native adapter/compiler` crash or batch `outcome` other than
  `compiled` in a module batch blocks widening until explained; no automatic
  retry (`run.ts:313-314`).
- Any `pass` on a resolution-negative variant whose graph had a `parsed: false`
  node, or any module observation lacking `fixtures` while its graph had
  non-root nodes, is a host bug: block.
- Any status change in the step 2 guard blocks everything.
- `unsupported` and `fail` never block widening; they are the measurement.
  Group `unsupported` by reason string and `fail` by exit code in the report
  notes.

**Static composition of the full selections** (non-native census, §8; module
variants; a status forecast is intentionally not given):

| Selection                          | Module variants | Parse/early (native syntax) | Module host              | Static blockers on host route                                                       |
| ---------------------------------- | --------------- | --------------------------- | ------------------------ | ----------------------------------------------------------------------------------- |
| `language/module-code` (recursive) | 596             | 166                         | 430                      | TLA feature 241, attributes 8, `dynamic-import` 8, unparsed node 6                  |
| `language/import`                  | 123             | 4                           | 118 (+1 discovery throw) | phase screen 88, attributes 21, JSON node 14, TLA 8, unparsed 4, `dynamic-import` 2 |
| `language/export`                  | 3               | 3                           | 0                        | —                                                                                   |
| `language/expressions/import.meta` | 17              | 11                          | 6                        | `import.meta` 6                                                                     |

Blocker categories overlap within a row; do not sum them. Of the 31
resolution negatives in `module-code`, 6 have unparsed fixtures
(`instn-resolve-*`) and 8 have attributes, so they stay `unsupported` in M2b;
17 have no static blocker. `language/import` also has 6+6 Script variants
(dynamic import), unaffected by M2b.

## 8. Evidence

Read: every `file:line` above in the current tree; the spec clauses in the
header from a `/tmp` copy of the multipage chapter; pinned `INTERPRETING.md`
lines 142-171, 196-255 and 318-335; `CONTRIBUTING.md:306-311`;
`module-code/eval-this.js`, `ambiguous-export-bindings/*`,
`import-attributes/allow-nlt-before-with.js`,
`import-attributes/ensure-linking-error_FIXTURE.js`,
`import/import-bytes/bytes-from-png.js:11`.

Non-native probe (`/tmp/hostesm-m2b/census.ts`, Node v24.12.0, read-only): for
every non-`_FIXTURE` file it ran `testMetadata`, `syntaxVariants`,
`discoverModuleGraph`, `parseModule` and `sourceModuleShape` from the
workspace and counted features, negatives, graph shape and static blockers. It
lowered nothing (`lowerSourceTextModule` does not exist yet), so it says
nothing about lowering support or outcomes. It found the
`bytes-from-png.js` discovery throw (`ERR_ENCODING_INVALID_ENCODED_DATA` from
`test262Source`).

## 9. Decisions main can take

| ID  | Question                   | Default                                 | Alternative                                          |
| --- | -------------------------- | --------------------------------------- | ---------------------------------------------------- |
| B1  | Loader miss                | `rejectUnsupportedExecution` (exit 10)  | TypeError (plan §4): a fabricated JS outcome         |
| B2  | Phase sequencing location  | generated prelude from shared fragments | exported runtime helper (Node-testable, adds census) |
| B3  | Unreached discovered nodes | lower and hash; failure → `unsupported` | static-request closure only (identity moves with M3) |
| B4  | Template sharing key       | include entry name                      | never share module entries across cases              |
| B5  | Gate without direct eval   | throw                                   | a separate `v10` per Script contract                 |

## 10. Uncertainties

- `lowerSourceTextModule` output is unbuilt; T3/T4 need M2a first, and the
  generated `create` signature may still change.
- Whether `capturedModuleExports` resolves `modules/index.ts` re-exports was
  inferred from `resolveModuleExports` (`captured-module-exports.ts:1-55`), not
  tested; T1 is the proof.
- Native: an uncaught throw's exit status in the image was not checked, which
  is why every host-side throw is caught and mapped to 69 explicitly.
- M2c (native fixture re-parse), M3 (`import()`, `import.meta`), M4 (TLA) and
  M5 (attributes, JSON) are out of scope; their tests stay `unsupported` in the
  denominator.

## 11. Next focused planning task

After M2a lands, plan **M2b tests T1–T2 only**: pick the exact Script corpus
and capability tuple whose runtime-text and batch digests freeze the v9 host,
and say how to strip the module mapping from a captured snapshot copy. That
gate protects the frozen conformance line before any generator edit.
