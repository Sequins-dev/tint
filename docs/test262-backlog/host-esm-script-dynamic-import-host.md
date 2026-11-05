# HOST-ESM M3b: Script-root dynamic import host (tools)

This is the tools plan for M3b. It follows the
[M3a host contract](host-esm-dynamic-import-host-contract.md) and the
[dynamic import census](host-esm-dynamic-import-census.md) §3.2, §4.1, §4.2
and §8. It settles how a **Script** test root gets the sibling fixture
loader that module roots already have. It lists the exact edits, the
red-first tests, the bespoke native gates, the first canaries and the
regressions. It needs no package change, so it needs no new source snapshot
and no self-build.

This is research only. Apart from this document and one cross-link in the
host contract's §10, nothing was edited, built or run. The live controllers
`run-direct-eval-conformance-v1.mjs`, `run-dynamic-import-module-selections-v1.mjs`
and `run-dynamic-import-selfbuild-v1.mjs`, and the DirectEval pause, were
left alone. **Probes are Node v24.12.0 only and non-native.** They live in
`/tmp/m3b-host/`: `probe.mts` imports the live workspace `tools/*.ts` and
built `packages/*/dist`, `an.cjs` and `an2.cjs` classify its rows, and
`node/root.cjs` is a Node reference check. They write only to `/tmp`.

## 1. State this plan starts from

- **M3a portable and tools work is implemented** (565 files). Script-goal
  lowering of `import(…)` already calls
  `evaluateImportCall(specifier, options, $global.hooks, $errors)` inside
  `runScriptContext({realm, scriptOrModule: $script})`
  (`js-engine/src/lowering/index.ts:290-297`, `:3055-3075`, `:5278-5290`).
  `activeModuleReferrer` returns the active `ScriptRecord` through
  `viewScriptRecord`, or a realm referrer when there is none
  (`modules/referrer.ts`). A dynamic `finishLoadingImportedModule` records
  successful loads in `ScriptRecord.loadedRequests` (`loading.ts:147-160`).
- **The tools stop Script `import()` before compile.**
  `prepareNativeScriptInputs` returns
  `<file>: Script dynamic import requires HOST-ESM M3b`
  (`tools/test262-native.ts:252-262`). The module loader text begins with
  `if(referrer.kind!=="module")rejectUnsupportedExecution(realm);` under
  `dynamicImport` (`:559-560`).
- **Evidence.** `native-dynamic-import-runtime-v3.json` passed.
  `dynamic-import-host-native-validation-v1.json` records the G8 lowering
  proof and all 17 G7 cases matching on snapshot `651c28d2…`, 565 files. The
  combined M3a self-build and the 24 formal module variants are **still
  running**, so they are not accepted. M3b runs wait for both.

## 2. Node probe facts

**Population (live tools, pinned Test262 `91c70759…`).** Of 1,153
Script-route variants in the two directories:

| Live preparation result                       | Variants |
| --------------------------------------------- | -------: |
| `Script dynamic import requires HOST-ESM M3b` |      855 |
| `import.source requires P-SOURCE`             |      176 |
| `import.defer requires P-DEFER`               |      112 |
| Prepares today (class 02, 03 and so on)       |       10 |

Of the 855, discovered fixtures fail lowering in 6: 4 JSON
(`2nd-param_FIXTURE.json`, M5) and 2 top-level await (M4). **The other 849
match the census ceiling exactly:** 730 (class 11) + 80 (08a) + 39 (08b).
That is 439 files, 431 sloppy and 418 strict, 222 sync and 627 async.

- **No harness Script contains `import(`.** Harness files keep the H6
  rejection.
- **No test in the 849 uses `$262.createRealm`, `$262.evalScript` or
  `eval(`.** So only the root realm needs a loader.
- **122 have an empty graph.** These are `file-does-not-exist` (32),
  `specifier-tostring-abrupt-rejects` (32), `empty-str-is-valid-assign-expr`
  (40), and 18 direct/attribute files whose errors happen before loading.
- **32 name a missing literal sibling,** always `./THIS_FILE_DOES_NOT_EXIST.js`.
  They expect a rejected promise whose value is not `undefined`.
- **46 contain `import('')`.** In 42 of them it sits in a function that is
  never called. `top-level-empty-str-is-valid-assign-expr` and
  `new-covered-expression-is-valid` (2 each) evaluate it synchronously.
- **168 have a non-literal first argument.** Raw-text discovery still finds
  the targets that the comments name.
- **2 import their own file:** `eval-self-once-script.js` (sloppy and
  strict). The Script root appears as a graph **node**, which is parsed and
  lowered as a module. It lowers.
- **4 have fixtures that themselves use `import()`:** `indirect-resolution`
  and `update-to-dynamic-import`. All of their fixtures lower.
- **Graph size.** 0 to 5 nodes. All are JavaScript, `parsed: true` and lower,
  so no M2c verdict entry appears in the 849.

**Node reference** (`node/root.cjs`, CommonJS root importing `.mjs`):
repeated imports return distinct promises that share one namespace and one
evaluation, the namespace prototype is `null`, and `import()` never throws
synchronously. A `toString` throw rejects with the original value, and a
non-object options argument rejects with TypeError. Both `''` and a missing
file reject with a plain `Error` (`ERR_MODULE_NOT_FOUND`). Tint follows
[HOST-ESM](host-esm.md) D5 instead: missing files reject with TypeError,
which is host-defined and satisfies the tests' assertions.

## 3. Decisions

**S1. Same route, a Script-root preparation behind the gate.**
`nativeVariantRoute` is unchanged, so parse and early negatives still go to
the syntax lane first. Under `TINT_TEST262_MODULES=1` with the dynamic
capability, the `script` route calls a new
`prepareNativeScriptProgram(plan, variant, harness, filename, discover?)`.
It lowers the harness and test exactly as `prepareNativeScripts` does
(unchanged `plan.source`, strictness prefix and harness list). If the
**test** Script does not import `evaluateImportCall`, it returns the same
modules with no Script root, so plain Scripts are byte-identical. With the
gate off, the run keeps `prepareNativeScripts` and H6.

**S2. Root goal.** Call the existing
`discoverModuleGraph(filename, plan.source, "script")`. The root is never
parsed by `parseModule`, so a sloppy Script
cannot be misjudged by the module grammar (`test262-module-graph.ts:65`). Fixture nodes are still parsed as
modules, because they are loaded as modules. **No parser is copied.** Unlike
the module route, the root name is **not** skipped: a node named after the
root is the module reading of the same bytes, as `eval-self-once-script`
needs.

**S3. Shared fixture preparation.** Extract the node loop from
`prepareNativeModuleProgram` (`:367-400`, including `lower`, JSON and
attribute screening, the M2c verdict entries with their hash check, and the
closed-graph check) into
`prepareNativeFixtureEntries(nodes, skip: string | undefined, requested)`.
The module route passes `graph.root`, and the Script route passes
`undefined`. Lowering-detected fixture early errors stay `unsupported` with
the fixture's lowering reason. They never become a fabricated SyntaxError,
and the class-09 verdict extension stays separate (census §4.3).

**S4. Missing-file and unknown-specifier policy (D2 and D5).**
`discoverModuleGraph` gains `absent: readonly string[]`. It lists the
single-segment `./name` literals found in raw text (root or fixture, comments
included) whose name is not a sibling. The Script-root loader then behaves
as follows:

| Specifier at run time                                      | Completion                                     |
| ---------------------------------------------------------- | ---------------------------------------------- |
| `./name` with `name` an entry (discovered)                 | `loadEntry`, so it is lazy and cached          |
| `./name` with `name` in `absent`                           | `{ok:false, error: TypeError}` (D5)            |
| `""`                                                       | `{ok:false, error: TypeError}`. No file has it |
| Anything else (computed, undiscovered sibling, other dirs) | `rejectUnsupportedExecution` (sticky, D2)      |

A computed specifier that names a missing file stays unsupported, because
the host cannot prove absence without a directory listing. That is
conservative and never a false pass. Module roots keep their M3a loader
text, so a module root importing a missing file stays unsupported (G7 D5).

**S5. Realms and identities.** The loader is installed only on the root
realm. A referrer whose realm differs is sticky-unsupported. Child realms
have no loader, so the portable `evaluateImportCall` already reports
unsupported. Each harness and test Script keeps its own
`createScriptRecord(realm, undefined)`, so the per-Script `loadedRequests`
cache gives same-referrer identity. The host's `records` map (by name)
creates each fixture lazily on first load and shares it across every
referrer (Script, fixture module, realm referrer from a job).

**S6. Host text only where needed.** `nativeTestRuntimeSource` gets a 15th
parameter, `scriptRoots = false`. When it is set, it appends
`runNativeScriptRootTest` after the module runner, and it throws
`Script-root host requires dynamic import` without `dynamicImport`.
`prepareNativeBatch` derives `scriptRoots = cases.some(case => case.scriptRoot !== undefined)`.
So module-only and plain-Script batches keep **byte-identical** runtime text
and images. The record, verdict and `loadEntry` text is lifted into one
constant used by both runners, so the module text stays byte-identical (U3
pins it).

**S7. Case shape.** `NativeTestCase` gains
`scriptRoot?: { readonly absent: readonly string[] }`. With it, `modules` may
be empty. `nativeTestHost` then emits
`runNativeScriptRootTest([scripts…],names,[creates…],absent,asynchronous,canSuspend[,verdicts])`.
`prepareNativeBatch` throws `Script-root case requires the dynamic import host`
unless `moduleExecution && dynamicImport`.

**S8. Adapter label.** `nativeScriptAdapter(evaluation, true, true)` returns
`native-script-v13-script-dynamic-import`, replacing v12 in the live tools.
v12 journals record the 849 as unsupported and must not resume under this
host. The frozen M3a toolchain still reports v12 for the formal 24. Modules-
off runs keep v9, and gate-on runs without the capability keep v11.

**S9. Resume inputs.** For Script-root variants, `fixtures` (all nodes, with
the self node included) and a new optional `absent` are recorded in
`NativeObservationInput` only when non-empty. Script-route preparation runs
**before** the resume comparison (as the module route does), but only under
the gate and capability. Plain Script observations are unchanged. The cost
is one Script lowering per variant on resume.

**S10. Scope text.** Under v13 the scope says: Script-root dynamic imports
load sibling fixtures through the same lazy table, missing literal siblings
and `''` reject with TypeError, and other undiscovered specifiers are
unsupported. JSON, attributes beyond option validation, top-level await and
proposal phases remain unsupported.

**S11. H6 stays.** `prepareNativeScripts` keeps its message for modules-off
runs and all harness Scripts, so v9 reasons are unchanged. Only the test
input named by the Script-root path may import `evaluateImportCall`, and only
it gains the `@tint/js-runtime/modules` dependency.

**No portable change is needed.** Script lowering, Script referrers, dynamic
loads, `ScriptRecord.loadedRequests`, the views image contract and the
loader types are all M3a surface. If a native gate shows a portable defect
(for example lowered Script `import()` miscompiling), stop and report it as
a blocker for a package slice. Do not work around it in tools.

## 4. Generated Script-root runner (exact text, under `scriptRoots`)

```ts
export function runNativeScriptRootTest(scripts:readonly NativeScript[],names:readonly string[],creates:readonly (NativeModuleFactory|undefined)[],absent:readonly string[],asynchronous:boolean,canSuspend:boolean=true,verdicts:readonly ((()=>number)|undefined)[]=[]):number {
 if(scripts.length===0)throw "EMPTY_NATIVE_SCRIPT_LIST";
${runnerSetup} if(creates.length!==names.length)return 69;
 if(verdicts.length!==0&&verdicts.length!==names.length)return 69;
 for(let i=0;i<names.length;i++){if((creates[i]===undefined)===(verdicts[i]===undefined))return 69;}
${tableLoading} realm.moduleLoader=(referrer:ModuleReferrer,request:ModuleRequest,hostDefined:unknown,payload:ModuleLoadPayload):void=>{
   if(referrer.realm!==realm)rejectUnsupportedExecution(realm);
   const specifier=request.specifier,name=specifier.startsWith("./")?specifier.slice(2):undefined;
   const index=name===undefined?-1:names.indexOf(name);
   if(index>=0){finishLoadingImportedModule(referrer,request,payload,loadEntry(index));return;}
   if(specifier!==""&&(name===undefined||absent.indexOf(name)<0))rejectUnsupportedExecution(realm);
   finishLoadingImportedModule(referrer,request,payload,{ok:false,error:createRuntimeError(realm,"type")});
 };
${runnerHarness("index+1<scripts.length")} const script=scripts[scripts.length-1];if(script===undefined)throw "NATIVE_TEST_ENTRY_INVARIANT";
 const result=script(global,createScriptRecord(realm,undefined));
 …same root checks as runNativeScripts…
${runnerJobs}}
```

Here `tableLoading` is the lifted `records`, `record(index)`, `verdictCodes`
and `loadEntry` text. The module runner's
`creates[0]===undefined` root check stays in its own text. The loader is
installed before the harness. That is harmless, because harness Scripts
cannot import (H6).

## 5. Minimal edits (in order, each red first)

1. **`tools/test262-module-graph.ts`.** Add `absent` to `ModuleGraph`. In
   `request`, collect valid single-segment names that are not in `available`
   into a sorted, de-duplicated list. Nodes, siblings and order are
   unchanged.
2. **`tools/test262-native.ts`.**
   - Cleanup: lift `modulesSpecifier` and `modulesModule` (the literals at
     `:254`, `:346-347`, `:859`, `:1257`, `:1284`, `:1306`, `:1583`, `:1781`
     and `:1880`). Output strings are unchanged.
   - `prepareNativeScriptInputs(inputs, dynamicRoot?: string)`: the input
     whose filename equals `dynamicRoot` may import `evaluateImportCall`, and
     it then gets the modules dependency. Every other input keeps H6.
   - Extract `prepareNativeFixtureEntries` (S3), and make
     `prepareNativeModuleProgram` call it with no output change.
   - Add `prepareNativeScriptProgram` (S1, S2, S4) and export
     `NativeScriptRoot { entries, fixtures, absent }`.
   - `NativeTestCase.scriptRoot` (S7), `nativeTestHost` Script-root branch,
     `nativeTestRuntimeSource`/`nativeTestRuntime` 15th parameter, and
     `prepareNativeBatch` derivation (S6).
   - `nativeScriptAdapter` v13 (S8).
3. **`tools/native-run-journal.ts`.** Add optional `absent` to
   `NativeObservationInput`, and copy it in `sameNativeObservationInput`.
4. **`tools/test262-native-run.ts`.** Add
   `const dynamicImport = moduleExecution && nativeDynamicImportCapability(snapshot);`
   and reuse it for the adapter. For the `script` route under it, prepare
   before the resume check, record `fixtures`/`absent`, and build
   `{scripts, modules: root.entries, scriptRoot: {absent}, …}`. Apply S10.
5. **`tools/verify-hosted-module-lowering.ts`.** Add G9 (§7).
6. **`tools/verify-test262-native-modules.ts`.** Add `scriptRootCase` and
   append R1–R12 after the existing 17 cases, so their indices are stable.

There is no package, manifest, `workspace-contracts.json`, catalog,
dashboard or results change. Run `pnpm format` on the touched tools files.

## 6. Red-first tests

**First red test (exact, `tools/test262-dynamic-import-host.test.ts`):**

```ts
test("Script roots keep the Script goal and load discovered siblings lazily", async () => {
  const { executionPlan } = await import("./test262-execution.ts");
  const source =
    'import("./dep.js").then(() => {}, () => {}); import("./gone.js");';
  const plan = executionPlan(source, "sloppy", {
    flags: [],
    features: [],
    includes: [],
  });
  const harness = plan.harness.map((filename) => ({ filename, source: "" }));
  const goals: string[] = [];
  const result = native.prepareNativeScriptProgram(
    plan,
    "sloppy",
    harness,
    "/fixtures/root.js",
    (_filename, _text, goal) => {
      goals.push(goal);
      return {
        root: "root.js",
        siblings: ["dep.js", "root.js"],
        absent: ["gone.js"],
        nodes: [
          {
            name: "dep.js",
            kind: "javascript",
            source: "export const value = 42;",
            sha256: "dep-hash",
            parsed: true,
          },
        ],
      };
    },
  );
  assert.deepEqual(goals, ["script"]);
  assert.ok(result.ok && result.root !== undefined, JSON.stringify(result));
  assert.deepEqual(
    result.root.entries.map((entry) => entry.name),
    ["dep.js"],
  );
  assert.deepEqual(result.root.fixtures, [
    { name: "dep.js", sha256: "dep-hash" },
  ]);
  assert.deepEqual(result.root.absent, ["gone.js"]);
  assert.equal(result.scripts.length, harness.length + 1);
  assert.equal(
    result.scripts.at(-1)!.dependencies.get("@tint/js-runtime/modules"),
    "packages/js-runtime/src/modules/index.ts",
  );
});
```

After `pnpm build`, it fails only with
`native.prepareNativeScriptProgram is not a function`.

**Then, in order:**

- **T2 (graph).** In `test262-module-graph.test.ts`, extend
  "discovery includes comment paths but does not invent missing fixtures" to
  deep-equal `absent`. A JSON fixture contributes no `absent` names.
- **T3 (preparation).** `42;` returns the same `scripts` as
  `prepareNativeScripts`, with no `root` and no discovery call. A harness
  containing `import()` gives `<harness>: Script dynamic import requires HOST-ESM M3b`.
  `import.defer` keeps its lowering reason. The `module` variant is
  unsupported. An empty graph gives `entries: []`. A node named after the
  root is an entry. A JSON node gives
  `JSON modules require HOST-ESM M5` with fixtures. `var a;function a(){}`
  gives that fixture's lowering reason (not SyntaxError) with fixtures. A
  `parsed: false` node becomes a verdict entry, or is unsupported on a hash
  mismatch. A static request outside the graph gives the existing reason.
- **T4 (module route unchanged).** Every existing
  `test262-module-preparation.test.ts` test passes unedited.
- **T5 (text).** `(…v9, true, true)` keeps the existing on-gate hash, and
  `(…v9, true, true, true)` equals it plus exactly one
  `runNativeScriptRootTest` function. `(…v9, true, false, true)` throws.
  The off-gate pin `9a544f16…` holds.
- **T6 (batch).** Module-only and Script-only batches emit unchanged runtime
  sources. Adding one `scriptRoot` case appends the runner. A `scriptRoot`
  case without the dynamic host throws. A Script-root host with empty
  entries emits `runNativeScriptRootTest([script0,script1,script2],[],[],["gone.js"],…)`.
- **T7 (adapter).** `(evaluation, true, true)` is v13. v11 and v9 are
  unchanged. Rename the M3a "until the Script-root host lands" test to
  "outside the Script-root host" and keep its assertion.
- **T8 (journal).** In `native-run-journal.test.ts`, a changed or added
  `absent` fails `sameNativeObservationInput`, and its absence matches old
  inputs.
- **T9 (scope).** Update the `test262-script-service.test.ts` scope
  expectation for v13.

Run the changed files with `node --test`, then `pnpm check`. Check each exit
status.

## 7. Bespoke native gates (before any Test262 selection)

All gates use `TINT_BUILD_ONLY=1`, run under LLDB through the recorder,
assert stop-at-entry and the final exit, and record build manifests. One
new serial controller,
`.tint-bootstrap/run-script-dynamic-import-native-validation-v1.mjs`, is
modelled on `run-dynamic-import-host-native-validation-v1.mjs`. It uses the
pause protocol, `{flag:'wx'}` outputs and no retries. It runs G9 first, then
G10, and withholds G10 if G9 fails.

**G9 (`verify-hosted-module-lowering.ts`).** This is the smallest image that
proves a **lowered Script** `import()`, which no native run has exercised.
Lower the Script `var p=import("./a"),q=import("./a");` with `lowerScript`,
and run it with an explicit `createScriptRecord(realm,undefined)` after
exit 85.

| Exit | Meaning                                                                   |
| ---- | ------------------------------------------------------------------------- |
| 86   | The Script runs without a throw, and `p !== q`, both pending              |
| 87   | The loader saw `referrer` identical to that ScriptRecord, kind `"script"` |
| 88   | After the drain, with no job failure, both fulfil with `aNamespace`       |
| 89   | `record.loadedRequests.length === 1`, and its module is `a`               |
| 42   | Pass                                                                      |

**G10 (`verify-test262-native-modules.ts`, real test262 host).** Add
`scriptRootCase(name, sources, expected, asynchronous, variant)`, which
writes `root.js` and its siblings and calls `prepareNativeScriptProgram`. `C`
means it prints `Test262:AsyncTestComplete`.

- **R1, async, completed.** `import("./dep.js").then(ns=>{if(ns.value!==42)throw 1;C})`.
- **R2, async, completed.** Two imports give `p!==q` and the same namespace,
  and `dep.js` counts one evaluation through a global.
- **R3, async, completed.** `./absent.js` rejects with TypeError.
- **R4, sync, completed.** `import("");` at top level.
- **R5, async, completed.** `import("")` rejects with TypeError.
- **R6, sync, unsupported.** `other.js` exists, and
  `import("./oth"+"er.js")` is undiscovered.
- **R7, async, completed, sloppy.** The `eval-self-once` shape: a Script
  imports `./root.js`, and the module reading increments a global once.
- **R8, async, completed.** A fixture throws TypeError, and a re-import
  rejects with the same error object.
- **R9, async, completed.** A fixture's missing export rejects with
  SyntaxError (link).
- **R10, async, completed, sloppy.** A `with` statement in the root, so the
  module grammar never judges a Script root.
- **R11, async, completed.** The fixture is `0++;`, so the M2c verdict
  rejects with SyntaxError.
- **R12, async, completed.** `Promise.resolve().then(()=>import("./dep.js"))`,
  so a job referrer loads.

The existing 17 cases keep their outcomes, and the image now carries the
Script-root runner. Any difference blocks.

## 8. Canaries, broad runs and regressions

**Freeze.** After `pnpm check`, G9 and G10, freeze a new Node toolchain
(`node-toolchain-script-dynamic-import-v1`) against the **accepted M3a
source snapshot**. Packages are unchanged, so no self-build is needed.
Assert that the snapshot identity equals the M3a self-build manifest.

**Node census.** Re-run `/tmp/m3b-host/probe.mts` logic under the frozen
tools, and require exactly 849 Script-root preparations, 6 fixture
rejections and unchanged module-route results. Write
`docs/results/script-dynamic-import-census-node-v1.json`.

**Initial canaries** (single-file runs, gate on, v13, frozen snapshot, one
serial controller, controller record written before any assertion):

1. `reuse-namespace-object-from-script.js` (load and identity)
2. `catch/top-level-import-catch-file-does-not-exist.js` (D5)
3. `eval-self-once-script.js` (self node)
4. `syntax/valid/top-level-empty-str-is-valid-assign-expr.js` (`''`, sync)
5. `catch/top-level-import-catch-instn-iee-err-circular.js` (link error)
6. `catch/top-level-import-catch-eval-rqstd-abrupt-typeerror.js` (evaluation error)

These are 12 variants. No outcome is forecast.

**Broad.** Then run the complete `language/expressions/dynamic-import` and
`language/expressions/import.meta` directories as two selections. Their
denominators keep syntax, proposal, M4, M5 and M7 variants. Tabulate the 849
by joining with the census rows. The 222 sync variants are weak loading
evidence and are labelled so (census §3.2).

**Regressions** under the same frozen tools: the M3a 24 (compare with the
formal M3a reports once accepted), `namespace`, `ambiguous-export-bindings`,
the six fixture-syntax files and one plain Script directory. Module-only
batches must have unchanged runtime text. Any outcome difference is retained
and blocks the dashboard. Then write an immutable acceptance JSON and update
`docs/test262.md` in place.

## 9. Probe facts versus native unknowns

**Facts (Node only).** §2, and the live lowering and runtime sources cited in
§1. `discoverModuleGraph(…, "script")` never parses the root. The self node
and all 849-population fixtures lower.

**Native unknowns.**

- A lowered Script `import()` has never run natively (G9).
- Whether the test262 host's `ScriptRecord` objects pass the
  `viewScriptRecord` binding inside real Script code and promise jobs (G9,
  R12).
- Whether the generated runner compiles with empty `names`/`creates` arrays
  (R3–R6).
- Image size, compile time and batch layout when Script batches carry the
  modules package and fixtures. The `catch` directory has 186 entries.
- Job settlement and `$DONE` ordering for the 627 async variants.
- Whether `eval-self-once-script`'s module reading behaves when the same
  bytes also ran as a Script.

## 10. First runnable step

After the M3a self-build and formal 24 controllers record their results,
add the §6 first red test, run `pnpm build`, then
`node --test tools/test262-dynamic-import-host.test.ts`. Only it should fail,
with `not a function`. Then apply §5 items 1–4 with T2–T9, items 5–6, and the
G9 build.
