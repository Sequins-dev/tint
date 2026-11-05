# HOST-ESM M3a: dynamic import host contract (tools)

This is the tools handoff for M3a. It follows the
[M3a lowering plan](host-esm-dynamic-import-lowering.md) §8 item 4 and the
[M3a runtime plan](host-esm-dynamic-import-runtime.md) §9. It settles the
`tools/test262-native.ts` capability contract, the exact edits, the red-first
tests, the native gates on existing fixtures, the 24-variant selection handoff
and the combined frozen fixed point. It does not plan Script-root routing or
any M3b work.

This is research only. Apart from this document and one cross-link in lowering
plan §8 item 4, nothing was edited, built or run, and the pending
`run-dynamic-import-runtime-final-gates-v2.mjs` and the DirectEval pause were
left alone. **Probes are Node v24.12.0 only and non-native:**
`/tmp/m3a-tools/probe.mts` (captured exports and adapters), `hash.mts` (host
text) and `script.mts` (preparation routes). They import the workspace
`tools/*.ts` through type stripping and write nothing.

## 1. Probe facts

| Snapshot                              | Identity         | Modules entry | Dynamic contract names                          |
| ------------------------------------- | ---------------- | ------------- | ----------------------------------------------- |
| Live                                  | `6e3ecc6a…`, 565 | `index.ts`    | All 4 values and both types                     |
| `…-module-fixture-syntax-v1` (frozen) | `2c72f4c9…`, 562 | `index.ts`    | None (`ModuleLoader`, `GraphLoadingState` only) |
| `…-direct-eval-site-plumbing-v3`      | `09a4ced6…`, 552 | none          | `nativeModuleCapability` is `false`             |

The values are `evaluateImportCall`, `getActiveImportMeta`, `viewModuleRecord`
and `viewScriptRecord`; the types are `ModuleReferrer` and `ModuleLoadPayload`.
Re-export capture already works (`viewModuleRecord` resolves to
`referrer.ts:value:2`). The 563 (`9e32a4c1…`, `getImportMeta` only) and 564 (`275805a2…`,
`dc495f4e…`) checkpoints exist only as identities. No snapshot file was
retained for them.

**Generated host text is snapshot-independent today.** With the v9 arguments
from `test262-module-host.test.ts`, the Script runtime text (`off`) is
`9a544f16fb7a75b06d5883b1a60077fd302dc55e6ac77e5b53f21343486ca564` (19,322
characters, the existing pin). The module-gated text (`on`) is
`02212bf4e5190be770eb9035055bce2fc2f290da4e97fcd4481fd066738cebb1` (25,868
characters). Both are the same for live and 562 capabilities. Both snapshots
give `native-script-v11-module-fixture-syntax` and `native-script-v9-direct-eval`.

**Live lowering already has the M3a arms.** This contradicts the handoff note.
`lowering/index.ts` sets `usesImportCall` and `usesImportMeta` (lines 273–274
and 3062–3081), and `.tint-bootstrap/import-call-lowering-green-v2.log`
passes. Through `prepareNativeScripts`:

- `import('./x.js');` as a strict Script **prepares** and imports
  `@tint/js-runtime/modules` `{evaluateImportCall}`. The Script dependency map
  has no such specifier, so the failure would surface only at image link and
  would sink every case in the batch.
- `import.defer('./x.js');` fails in lowering with the P-DEFER message, at
  span `[14,36]` after the 14-byte strict prefix.
- A module root using `import()` and `import.meta` prepares. Its modules import
  is the existing four bindings followed by `evaluateImportCall` and
  `getActiveImportMeta`.

## 2. Current tools facts

- `nativeModuleCapability` (`test262-native.ts:1229`) is unchanged here. The
  host prefix and loader are fixed text (`:543`), typed `ModuleRecord` and
  `GraphLoadingState`, while live `ErrorRealm.moduleLoader` is widened.
- `capturedModuleExports` returns value names only, so type-only exports
  cannot enable capabilities (`captured-module-exports.test.ts`).
- `directEvalSiteImageContract(enabled)` adds one runtime with
  `retainedExports` and one `operation:"view"` binding, both naming the public
  entry `global/index.ts`, which re-exports the view. The compiler resolves
  bindings through `linked.value.exports` by module and name
  (`compiler/src/native/index.ts:533-572`). It requires a declared runtime
  module and rejects duplicate modules and namespaces. `runtimeSources()`
  declares no modules runtime.
- The module host's runtime dependency map already adds `modules` only under
  `moduleExecution`. Every lowered module's map already has
  `@tint/js-runtime/modules`. Lowered Scripts have only global, records and
  objects.
- `test262-native-run.ts:88` derives the journal adapter from the snapshot.
  The module scope text (`:351`) calls `import()` and `import.meta`
  unsupported.
- `verify-hosted-module-lowering.ts:65,77` still types the loader graph-only.
  `verify-hosted-module-evaluation.ts` and `verify-hosted-dynamic-import.ts`
  are already widened.

## 3. Decisions

**H1. One all-or-none contract, with `evaluateImportCall` as the marker.**
`nativeDynamicImportCapability(snapshot)` returns the captured modules entry
path when all four values and both types are captured. It returns `undefined`
when none is captured, and it throws `incomplete captured dynamic import
contract` for any subset. So 562 and 563 stay off, and the 564 checkpoints (views and
types without the marker, never used for module selections) throw. Only
module-enabled builders and runs evaluate it, so Script-only runs are
unaffected.

**H2. Types come from a sibling helper,** `capturedModuleTypeExports`, sharing
one private resolver. Value output is unchanged.

**H3. The generated text changes only under the capability.** A 14th
positional parameter, `dynamicImport = false`, follows `moduleExecution`.
Exactly two fragments change when it is set. The import prefix replaces
`type GraphLoadingState` with `type ModuleReferrer,type ModuleLoadPayload`.
The loader is typed `referrer:ModuleReferrer` and `payload:ModuleLoadPayload`,
and it gains one first statement:
`if(referrer.kind!=="module")rejectUnsupportedExecution(realm);`. Script and
realm referrers are unreachable in M3a (lowering L5 and L8, and the H6 check),
so this guard makes any leak sticky-unsupported, and M3b deletes it. The rest
of the loader serves both payloads unchanged. The host imports no views or
helpers. `dynamicImport` without `moduleExecution` throws
`dynamic import host requires the module host`.

**H4. Views are retained through the public entry.**
`moduleDynamicImportImageContract(module?: string)` mirrors
`directEvalSiteImageContract`. It declares runtime
`{module, namespace:"module-referrer-views", retainedExports:[viewModuleRecord, viewScriptRecord]}`
and two `operation:"view"` bindings, all naming the captured entry path
(`index.ts`), not the private `referrer.ts`. With `undefined` it adds nothing,
so old requests are identical. G1 bound `referrer.ts`, and G8 proves the
re-exported path first (§6).

**H5. Builder wiring.** `createNativeBatchBuilder` computes
`dynamicImport = moduleExecution ? nativeDynamicImportCapability(snapshot) : undefined`
once. It passes the path to `createNativeImageBuilder` (new last parameter)
and `dynamicImport !== undefined` to `prepareNativeBatch` and
`nativeTestRuntime` (new last parameters). `createNativeTestBuilder` and the
image module list are unchanged, because `modules/index.ts` is already listed
under `moduleExecution`. No dependency map changes.

**H6. Script `import()` is unsupported before image compile.** In
`prepareNativeScriptInputs`, right after a successful `lowerScript`, any
declaration whose specifier is `@tint/js-runtime/modules` returns
`unsupported(input.filename + ": Script dynamic import requires HOST-ESM M3b")`.
This covers test Scripts and module-host harness Scripts, never reaches the
builder, and cannot fire with a pre-M3a lowerer. Phase failures keep their
lowering messages because lowering fails first. M3b deletes this check.

**H7. No module preparation gate.** A restored snapshot runs with its own
frozen toolchain, as every controller does, and frozen controllers call
`prepareNativeModuleProgram` with three arguments. Add no parameter.

**H8. New adapter label.** Add a third parameter to `nativeScriptAdapter`, so
that a module run under the capability reports
`native-script-v12-module-dynamic-import`. v11 journals must not resume under the widened
host. Modules-off runs keep v9, because their host text is unchanged. H6 is
toolchain behaviour, identified by `frozenToolchainSha256` and
`sourceSnapshot`.

**H9. Scope text.** In `test262-native-run.ts`, only under the capability,
replace `; JSON, attributes, top-level await, import() and import.meta are
unsupported.` with `; JSON, attributes and top-level await are unsupported;
module-code import() and import.meta use the same table loader, and Script
import() is unsupported until HOST-ESM M3b.` Off-gate text is byte-identical.

**H10. Fixed source identity.** One `snapshot` feeds each builder and run;
hosted builds record it, and controllers check it and pass
`TINT_TEST262_SOURCES` before starting.

## 4. Minimal edits (in order, each red first)

1. **`tools/captured-module-exports.ts`.** Extract the body into
   `function capturedNamespaceExports(modules, namespace: "value" | "type")`.
   `capturedModuleExports(modules)` returns the `"value"` call, and the new
   `capturedModuleTypeExports(modules)` returns the `"type"` call.
2. **`tools/test262-native.ts`.**
   - Cleanup: lift `const modulesSpecifier = "@tint/js-runtime/modules"` and
     `const modulesModule = "packages/js-runtime/src/modules/index.ts"`. The
     path literal appears at `:334`, `:841` and `:1513`, and the specifier at
     `:333` and `:1234`. Strings and generated text are unchanged.
   - Add H6 in `prepareNativeScriptInputs` after the `lowered.ok` check.
   - Add `nativeDynamicImportCapability` after `nativeModuleCapability`:

     ```ts
     const dynamicImportValues = [
       "evaluateImportCall",
       "getActiveImportMeta",
       "viewModuleRecord",
       "viewScriptRecord",
     ];
     const dynamicImportTypes = ["ModuleReferrer", "ModuleLoadPayload"];
     /** `evaluateImportCall` marks the M3a host; its helpers, both record views and
      * the widened loader types are one captured contract, all or none. */
     export function nativeDynamicImportCapability(
       snapshot: WorkspaceSourceSnapshot,
     ): string | undefined {
       const module = capturedPublicEntry(
         snapshot.publicEntries ?? snapshot.mappings,
         modulesSpecifier,
       );
       if (module === undefined) return undefined;
       const sources = workspaceModules([module], snapshot);
       const values = capturedModuleExports(sources).get(module),
         types = capturedModuleTypeExports(sources).get(module);
       const present = [
         ...dynamicImportValues.map((name) => values?.has(name) === true),
         ...dynamicImportTypes.map((name) => types?.has(name) === true),
       ];
       if (!present.includes(true)) return undefined;
       if (present.includes(false))
         throw Error("incomplete captured dynamic import contract");
       return module;
     }
     ```

   - `nativeScriptAdapter(evaluation?, moduleExecution = false, dynamicImport = false)`.
     It first throws H3's message when `dynamicImport && !moduleExecution`.
     The module branch returns v12 when `dynamicImport` is set, otherwise v11.
   - `nativeTestRuntimeSource(…, moduleExecution = false, dynamicImport = false)`
     applies H3. The prefix becomes
     `` `import {${dynamicImport ? "type ModuleRecord,type ModuleRequest,type ModuleReferrer,type ModuleLoadPayload,type ModuleCompletion" : "type ModuleRecord,type ModuleRequest,type GraphLoadingState,type ModuleCompletion"},loadRequestedModules,…} from "modules";` ``.
     The loader becomes
     `` `realm.moduleLoader=(${dynamicImport ? "referrer:ModuleReferrer" : "referrer:ModuleRecord"},request:ModuleRequest,hostDefined:unknown,${dynamicImport ? "payload:ModuleLoadPayload" : "payload:GraphLoadingState"}):void=>{${dynamicImport ? '\n   if(referrer.kind!=="module")rejectUnsupportedExecution(realm);' : ""}` ``,
     followed by the unchanged lines.
   - Thread `dynamicImport` through `nativeTestRuntime` and `prepareNativeBatch`
     as their last parameters. `prepareNativeBatch` throws H3's message when it
     is set without `moduleExecution`.
   - Add `moduleDynamicImportImageContract` (H4). `createNativeImageBuilder`
     gets a last parameter `dynamicImport?: string` and spreads the contract
     right after the direct-eval spreads. Wire `createNativeBatchBuilder` per
     H5.
3. **`tools/test262-native-run.ts`.** Compute
   `const dynamicImport = moduleExecution && nativeDynamicImportCapability(snapshot) !== undefined;`
   after the module check. Pass it to `nativeScriptAdapter`, and apply H9.
4. **`tools/verify-hosted-module-lowering.ts`.** Widen line 65 to import
   `type ModuleReferrer,type ModuleLoadPayload` in place of
   `type GraphLoadingState`. Widen line 77's callback to
   `(referrer:ModuleReferrer,…,payload:ModuleLoadPayload)`, with the body
   unchanged. Then add G8 (§6).
5. **`tools/verify-test262-native-modules.ts`.** Append the G7 cases (§6) after
   the existing cases, so existing case indices are stable.

No package, manifest, `workspace-contracts.json` or catalog change. Run
`pnpm format` on touched tools files.

## 5. Red-first unit tests (`tools/test262-module-host.test.ts` unless named)

**First red test (exact, written before any edit):**

```ts
test("dynamic import host capability is all or none over the captured contract", () => {
  const snapshot = workspaceSources();
  assert.equal(
    native.nativeDynamicImportCapability(snapshot),
    "packages/js-runtime/src/modules/index.ts",
  );
  const names = [
    "evaluateImportCall",
    "getActiveImportMeta",
    "viewModuleRecord",
    "viewScriptRecord",
    "ModuleReferrer",
    "ModuleLoadPayload",
  ];
  const hide = (hidden: readonly string[]) => ({
    ...snapshot,
    inputs: snapshot.inputs.map((input) =>
      input.id !== "packages/js-runtime/src/modules/index.ts"
        ? input
        : {
            ...input,
            bytes: new TextEncoder().encode(
              hidden.reduce(
                (text, name) =>
                  text.replace(
                    new RegExp("\\b" + name + "\\b"),
                    name + " as hidden" + name,
                  ),
                new TextDecoder().decode(input.bytes),
              ),
            ),
          },
    ),
  });
  for (const name of names)
    assert.throws(
      () => native.nativeDynamicImportCapability(hide([name])),
      /incomplete captured dynamic import contract/,
      name,
    );
  assert.equal(native.nativeDynamicImportCapability(hide(names)), undefined);
  const none = { ...snapshot, publicEntries: [], mappings: [] };
  assert.equal(native.nativeDynamicImportCapability(none), undefined);
});
```

It fails with `native.nativeDynamicImportCapability is not a function`. Each
hidden name gets a distinct alias, because `index.ts` exports each name once.
`hide(names)` is the 563 shape.

**Then, in order:**

- **U2 (`captured-module-exports.test.ts`).** `export type {X} from "p"` with
  `p` declaring `export interface X {}` appears in
  `capturedModuleTypeExports(...).get("public")` and never in
  `capturedModuleExports`. The existing type-only test is unchanged.
- **U3. Off-gate text is byte-identical.** Using the v9 tuple already in the
  file, `nativeTestRuntimeSource(evaluation, ...v9)` still hashes to
  `9a544f16…ca564`. `(…v9, true)` and `(…v9, true, false)` both hash to
  `02212bf4e5190be770eb9035055bce2fc2f290da4e97fcd4481fd066738cebb1`. The
  existing batch pin `dba43513…` holds.
- **U4. On-gate text has exactly the two H3 substitutions.** Take
  `dyn = (…v9, true, true)`. Replacing the new prefix with the old and the new
  loader head (including the guard line) with the old gives back the `on`
  text exactly. `dyn` contains `ModuleReferrer` only in those two places, and
  has no `GraphLoadingState`, `viewModuleRecord` or `evaluateImportCall`.
  `(…v9, false, true)` throws `dynamic import host requires the module host`.
- **U5. Image contract.** `moduleDynamicImportImageContract(undefined)`
  deep-equals `{runtimes:[],recordBindings:[]}`. With the `index.ts` path, it
  deep-equals the H4 runtime and the two view bindings in that order.
- **U6. Adapter.** `nativeScriptAdapter(evaluation, true, true)` is
  `native-script-v12-module-dynamic-import`. `(evaluation, true, false)` stays
  v11. `(evaluation, false, true)` throws H3's message, and the v9 expectations
  are unchanged.
- **U7. Script route (`test262-module-preparation.test.ts`).**
  `prepareNativeScripts(executionPlan("import('./x.js');", "strict", meta), "strict", harness)`
  deep-equals
  `{ok:false,outcome:{kind:"unsupported",reason:"test: Script dynamic import requires HOST-ESM M3b"}}`.
  So does `var p=import('./x.js');` in sloppy mode. `import.defer('./x.js');`
  keeps its lowering reason, and `42;` prepares. A module case whose harness
  `h.js` contains `import('./x.js')` gives
  `h.js: Script dynamic import requires HOST-ESM M3b`, while a module root
  using `import()` prepares.
- **U8. Batch threading.** `prepareNativeBatch(cases, ...v9, evaluation, true, true)`
  emits a `test262-runtime` module whose source has the H3 loader.
  `prepareNativeBatch(..., false, true)` throws.

Run the three changed test files with `node --test` after `pnpm build`, then
`pnpm check`.

## 6. Native gates on existing fixtures

All gates use `TINT_BUILD_ONLY=1`, run under LLDB through the recorder, and
assert stop-at-entry and the final exit. Each records its build manifest.

| Gate | Existing fixture                        | Owner   | Content                                                                      |
| ---- | --------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| G1   | `verify-hosted-dynamic-import.ts` 60–64 | runtime | Exact views (passed on 564)                                                  |
| G2   | same file, new exits                    | runtime | Module referrer, job-3 settlement, self import, namespace identity           |
| G3   | same file, 80–83                        | runtime | Script referrer through the runtime API (build v2 passed; run pending)       |
| G4   | same file                               | runtime | Option rejections and getter order                                           |
| G5   | same file                               | runtime | Link-error realm, cached error, retry after `{ok:false}`, absent loader      |
| G6   | `verify-hosted-module-import-meta.ts`   | runtime | `getActiveImportMeta` under `runScriptContext`, plus the passed object cases |
| G7   | `verify-test262-native-modules.ts`      | tools   | Existing N1/N2/M2c cases plus D1–D6 through the real test262 host            |
| G8   | `verify-hosted-module-lowering.ts`      | tools   | Lowered `import()`/`import.meta` and views bound through `index.ts`          |

Run G8 first among the tools gates, because it is the smallest image that
proves H4's re-exported binding path.

**G8 additions.** Lower the four lowering plan §9 programs as `dynRoot`,
`dynDep`, `dynChain` and `dynOpt`, with specifiers `./dynDep` and `./dynRoot`.
`dynRoot` also calls `log("R")`. Add `drainScriptJobs`, `getPrototype` and
`type ModuleReferrer`. The loader pushes `referrer` for every dynamic payload.
Add the H4 runtime and bindings, with `modules/index.ts` as the module. After
exit 77:

| Exit | Meaning                                                                     |
| ---- | --------------------------------------------------------------------------- |
| 78   | `dynRoot` loads, links and evaluates fulfilled synchronously                |
| 79   | `meta === f()`, and its prototype is `undefined` (null)                     |
| 80   | `p !== q`, and both are pending before the drain                            |
| 81   | After the drain, with no job failure, `seen === getModuleNamespace(dynDep)` |
| 82   | `g()` fulfils with `dynRoot`'s namespace, and `log.text === "bardR"`        |
| 83   | `t1` and `t2` have the realm's TypeError prototype                          |
| 84   | `k === 0`                                                                   |
| 85   | Every recorded referrer is `dynRoot` or `dynChain`, never a Script or realm |
| 42   | Pass                                                                        |

**G7 additions** (`moduleCase`; `C` means it prints
`Test262:AsyncTestComplete`; the expected value is the recorder outcome):

- **D1, async, completed.** `root.js`: `import("./dep.js").then(ns=>{if(ns.value!==42)throw 1;C})`.
  `dep.js`: `export const value=42;`.
- **D2, async, completed.** `export let count=0;count++;import("./root.js").then(ns=>{if(ns.count!==1)throw 1;C});`
- **D3, sync, completed.** `const m=import.meta;function f(){return import.meta;}if(Object.getPrototypeOf(m)!==null||f()!==m)throw 1;`
- **D4, async, completed.** `import("./dep.js").then(()=>{},e=>{if(!(e instanceof SyntaxError))throw 1;C});`.
  `dep.js` is `0++;`, so the native verdict is 40.
- **D5, sync, unsupported.** `import("./absent.js");`. A specifier outside the
  graph is sticky-unsupported (missing-file policy is M3b).
- **D6, async, completed.** `import("./dep.js",1).then(()=>{},e=>{if(!(e instanceof TypeError))throw 1;C});`

The existing cases keep their expected outcomes. Any change blocks.

## 7. 24-variant census and serial selection handoff

The population is census §10: class 10 (22), `verify-dfs` and the staging
`optional-chain-first-expression-module`, re-derived from the census rows and
asserted to be 24 single-file selections. No outcome is predicted.

`.tint-bootstrap/run-dynamic-import-selections-v1.mjs` is modelled on
`run-module-fixture-syntax-selections-v2.mjs`. It is one serial process with no
retries, and every output uses `{flag:'wx'}` or `COPYFILE_EXCL`.

1. **Preflight.** Check that no other `run-*.mjs` controller is live
   (`ps`). Leave `.tint-bootstrap/direct-eval-conformance.pause` untouched,
   and refuse to start if it is unacknowledged. Assert the workspace identity
   equals the frozen manifest, and assert `frozenNativeRunIdentity`. Require
   accepted G1–G8 reports.
2. **Node census (frozen tools).** For each selection, `testMetadata`,
   `syntaxVariants`, `executionPlan`, and then
   `prepareNativeModuleProgram(plan, harness, filename)` with three arguments.
   Record `ok`, the fixtures, the entries and verdict flags, or the
   unsupported reason, in `docs/results/dynamic-import-census-node-v1.json`.
   Any unexpected reason blocks before native work. Separately, re-run the
   Script-row census (lowering plan §10.2) and report the exact split.
3. **Gate-off controls.** With modules unset, each selection gives
   `native module execution is not implemented` and no batches.
4. **Gate-on runs.** One run per selection with `TINT_TEST262_MODULES=1`,
   `TINT_TEST262_SOURCES` set to the frozen snapshot,
   `debugserver-direct` launch, tracing, a 300,000 ms containment and a new
   pause file. Assert the adapter is `native-script-v12-module-dynamic-import`,
   the snapshot and run identity, `restoredVariants === 0`, and a complete
   journal. Write a controller record per selection **before** asserting the
   exit code.
5. **Regressions.** Re-run `namespace`, `ambiguous-export-bindings` and the
   six fixture-syntax files, and compare each observation with the v1/v2
   reports. A difference is retained and blocks the dashboard.
6. **Report.** Write an immutable acceptance JSON and update
   `docs/test262.md` in place.

## 8. Combined frozen fixed point (after portable and tools land)

1. Run `pnpm check`, then G1–G8, on the live workspace. Fix failures at their
   source and rerun everything after them.
2. Run `pnpm build`, then `freezeNodeToolchain` into
   `.tint-bootstrap/node-toolchain-dynamic-import-v1`, with its
   `source-snapshot.json` and `docs/results/frozen-node-toolchain-dynamic-import-v1.json`.
   This is the only freeze: the 563 and 564 checkpoints are never frozen.
3. Run the native self-build, the stage-image fixed-point comparison and the
   debug-information check from that snapshot. Record them like
   `bootstrap-module-source-v1.json`.
4. Then run §7. M3b, class 09 and the missing-file policy stay separate.

## 9. Probe facts versus native unknowns

**Probe facts (Node only).** Everything in §1. Graph discovery also reads raw
text, so literal dynamic specifiers become graph nodes
(`test262-module-graph.ts:59`).

**Native unknowns.**

- Whether the test262 host's widened arrow assigns to `realm.moduleLoader`.
  Main's typed callback compiled in build v2, but this host text has not.
- Whether views bind through the `index.ts` re-export (G8), and whether the
  modules entry can be a retained runtime and an application dependency at
  once. `global/index.ts` is the precedent.
- Layout and digest changes, image size and compile time, and job settlement
  for D1–D6. The 563/564 shapes are shown only through the synthetic `hide`.

## 10. Next runnable step

After the final-gates controller records its result and `pnpm check` is green,
add the §5 first red test and run `node --test tools/test262-module-host.test.ts`;
only it should fail, with `not a function`. Then apply §4 items 1–3, U2–U8, items 4–5 and the
G8 build.

M3b (Script-root `import()`) is planned in the
[Script-root dynamic import host](host-esm-script-dynamic-import-host.md).
