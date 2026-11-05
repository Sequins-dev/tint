# HOST-ESM M2b: `test262-native-run.ts` module routing and first selection

This is the implementation plan for the last unwired piece of the
[M2b module host](host-esm-test262-module-host.md) (§3.2, §5, §7 steps 1–3).
It follows the [runner slice](host-esm-module-host-runner.md) §6. It covers
three things: routing in `tools/test262-native-run.ts`, the resume identity of
module observations, and the first gated `language/module-code/eval-this.js`
selection with its unchanged guards.

This is research only. No source, test, catalog, manifest, result, dashboard,
queue, marker or snapshot was changed. Nothing was built and no native binary
was run. Two read-only Node probes were run (`/tmp/m2b-route/probe.ts`,
`probe2.ts`, Node v24.12.0, current tree). The frozen self-build (LLDB PID
26730), the conformance controller 67383 and its child 64325, the module host
build log and the serial recorder were not touched.

## 0. State verified in the current tree

| Piece                                                                           | State                         | Where                                          |
| ------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------- |
| `nativeModuleCapability(snapshot)`: lowered-factory marker absent → `false`     | landed                        | `test262-native.ts:1169-1192`                  |
| `nativeScriptAdapter(evaluation, true)` → `native-script-v10-modules`           | landed (needs direct eval)    | `:1150-1167`                                   |
| `createNativeBatchBuilder(snapshot, true)` throws when the capability is absent | landed                        | `:1348-1352`                                   |
| `prepareNativeModuleProgram`, root screened before discovery, closure check     | landed                        | `:249-349`                                     |
| `fixtures` returned **only on `ok: true`**                                      | **gap** (§2)                  | `:337-348`                                     |
| `NativeObservationInput.fixtures?`, compared by `sameNativeObservationInput`    | landed                        | `native-run-journal.ts:25-28,241-257`          |
| `run.ts`: gate, engine, builder, routing, input, scope                          | **not wired** (this plan, §3) | `test262-native-run.ts:79,110,197-266,293-297` |
| `test262-script-service.test.ts:216-217` `engine =` regex                       | still pins the v9-only line   | changes with §3 (R5)                           |

Probe results (Node only, current `dist`):

- `nativeModuleCapability(workspaceSources())` → `true`. The adapters are
  `native-script-v9-direct-eval` (gate off) and `native-script-v10-modules`
  (gate on).
- `eval-this.js` [module] → `ok`, entries `["eval-this.js"]`, `fixtures: []`,
  harness `assert.js`, `sta.js`, preparation took 7 ms. Discovery finds no
  nodes, so the observation carries **no** `fixtures` key.
- `import/import-bytes/bytes-from-png.js` → `unsupported("import attributes
require HOST-ESM M5")`. That is correct **only because** the root screen
  runs first: calling `discoverModuleGraph` directly on the same file throws
  `TypeError: The encoded data was not valid for encoding utf-8`.
- `module-code/instn-resolve-empty-export.js` (resolution negative) →
  `unsupported("fixture syntax verdict requires native re-parse (M2c)")`.
  This verdict is caused by `instn-resolve-empty-export_FIXTURE.js`
  (`parsed: false`, `sha256 d019396c…`), yet today the outcome carries no
  fixture hash. See §2.

Pinned bytes for the first selection: `eval-this.js` `044874d0…98c2`,
`harness/assert.js` `206e274c…ed48`, `harness/sta.js` `1930c54a…3f35`.

## 1. Decisions

| ID  | Question                                    | Decision                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | How is the gate enabled?                    | Explicitly. `TINT_TEST262_MODULES=1` → require `nativeModuleCapability` (throw before the journal exists). Unset → `false`, and the capability is **not even computed**. Any other value throws. Capability alone never switches a run to v10, so a direct-eval run on the current tree stays v9.       |
| D2  | How often is the gate evaluated?            | Once, as `const moduleExecution`, before the source capture. The same binding feeds engine, builder, routing and scope. Nothing else reads the env var or calls `nativeModuleCapability`.                                                                                                               |
| D3  | When are module fixture hashes known?       | **Before** `sameNativeObservationInput`. Module-routed variants are prepared eagerly, before the input is built. Script variants stay lazy, as today, because re-lowering every restored Script on resume would be costly.                                                                              |
| D4  | Fixture identity on unsupported preparation | If discovery ran, `fixtures` = **every** non-root graph node (including JSON and `parsed: false` nodes), on **both** arms. If the root or harness screen failed before discovery, there is no `fixtures` key: that verdict depends only on bytes that are already in identity. Empty lists are omitted. |
| D5  | A thrown discovery or preparation           | Still an adapter crash, `native adapter/compiler: <error>`, with no `fixtures`. It is captured during eager preparation and recorded after the resume check. It is never reclassified as `unsupported`.                                                                                                 |
| D6  | Journal header                              | No new key. `engine` (v9 vs v10) already separates gated from ungated journals (`native-run-journal.ts:112-118`).                                                                                                                                                                                       |

**Why D4.** An unsupported verdict caused by a fixture must be invalidated
when that fixture changes. Example: `instn-resolve-*` with an unparsed
fixture. Once M2c lands, the same bytes may become supported. The fixture
list must be the whole graph, not the prefix accumulated before the failing
node. Otherwise the identity would depend on _which_ node failed, and a
change in a later node would go unnoticed.

Known limit: a request outside the graph (the closure check) names a file
that does not exist, so no hash can cover it. A sibling appearing later is
caught by the header's `revision`/`dirty`, not by `fixtures`.

## 2. Edit in `tools/test262-native.ts` (fixtures on the failure arm)

1. Widen the failure arm type of `prepareNativeModuleProgram` to
   `{ ok: false; outcome: ExecutionOutcome; fixtures?: readonly { name: string; sha256: string }[] }`.
2. Right after `const graph = discover(...)`, compute the full identity once:

   ```ts
   const fixtures = graph.nodes
     .filter((node) => node.name !== graph.root)
     .map(({ name, sha256 }) => ({ name, sha256 }));
   const late = (reason: string) => ({ ...unsupported(reason), fixtures });
   ```

3. In the node loop, use `late(...)` for the JSON and `parsed: false` returns.
   Lowering failure becomes `return { ...lowered, fixtures }`. The closure
   miss becomes `late("module request outside the discovered fixture graph: " + specifier)`.
   Delete `fixtures.push(...)` from the loop.
4. The success arm is unchanged. `graph.nodes` is sorted
   (`test262-module-graph.ts:74`) and the loop pushed in that order with the
   root skipped, so the `ok: true` value is equal.
5. Add the pure routing helper next to `prepareNativeScripts`:

   ```ts
   export type NativeVariantRoute = "syntax" | "module" | "script";
   export function nativeVariantRoute(
     metadata: TestMetadata,
     variant: SyntaxVariant,
     moduleExecution: boolean,
   ): NativeVariantRoute {
     if (
       metadata.negative?.phase === "parse" ||
       metadata.negative?.phase === "early"
     )
       return "syntax";
     return moduleExecution && variant === "module" ? "module" : "script";
   }
   ```

   Parse and early negatives are checked first, so they can never reach
   discovery or the module host, whatever the gate says. A gate-off module
   variant routes to `"script"`, which returns the exact current
   `unsupported("native module execution is not implemented")`.

No runtime text, host template, batch key or adapter string changes. The T2
digests (`9a544f16…`, batch `dba43513…`) must stay the same.

## 3. Edit list for `tools/test262-native-run.ts`

Line numbers refer to the current file.

**E1: imports.** Add `nativeModuleCapability`, `prepareNativeModuleProgram`
and `nativeVariantRoute` to the `./test262-native.ts` import.

**E2: the gate, after `const snapshot = …` (`:70-73`) and before the capture
(`:74`).**

```ts
const moduleSwitch = process.env.TINT_TEST262_MODULES;
if (moduleSwitch !== undefined && moduleSwitch !== "1")
  throw new Error("TINT_TEST262_MODULES must be 1 or unset");
const moduleExecution = moduleSwitch === "1";
if (moduleExecution && !nativeModuleCapability(snapshot))
  throw new Error(
    "module execution requires the captured module host capability",
  );
```

This placement does three things. A failed gate leaves no captured snapshot
and no journal. A frozen snapshot restored through `TINT_TEST262_SOURCES` is
the one that gets gated. The gate-off path only adds a comparison of an unset
variable.

**E3: engine (`:79`).**
`const engine = nativeScriptAdapter(capturedScriptEvaluation(snapshot), moduleExecution);`
With `false` this returns the same string as the one-argument call
(`:1154-1158`).

**E4: builder (`:110`).** `const build = createNativeBatchBuilder(snapshot, moduleExecution);`
The gate-off call equals the default parameter. The gate-on call re-checks the
capability (cheap and redundant, which is fine).

**E5: eager module preparation, inside the variant loop, after `harness` is
read and before `const input` (`:207`).**

```ts
const route = nativeVariantRoute(metadata, variant, moduleExecution);
let moduleProgram:
  | ReturnType<typeof prepareNativeModuleProgram>
  | { readonly thrown: unknown }
  | undefined;
if (route === "module")
  try {
    moduleProgram = prepareNativeModuleProgram(plan, harness, filename);
  } catch (error) {
    moduleProgram = { thrown: error };
  }
const fixtures =
  moduleProgram === undefined || "thrown" in moduleProgram
    ? undefined
    : moduleProgram.fixtures;
```

**E6: input.** Append to the `input` literal:
`...(fixtures !== undefined && fixtures.length > 0 ? { fixtures } : {}),`.
Script inputs, syntax inputs, gate-off inputs, root-only modules
(`eval-this.js`) and root-screen failures therefore serialize byte-identically
to today. The prefix check at `:218-229` is unchanged and now compares
fixtures for restored module observations. A restored variant's prepared
program is discarded and nothing is journaled.

**E7: dispatch (`:233-264`).** Replace the `if`/`else` with a branch on
`route`, keeping the surrounding `try`/`catch`:

```ts
if (route === "syntax") {
  /* unchanged :238-240 */
} else {
  const prepared =
    route === "script"
      ? prepareNativeScripts(plan, variant, harness)
      : moduleProgram!;
  if ("thrown" in prepared) throw prepared.thrown; // → existing catch: flush(); adapterCrash
  if (prepared.ok) {
    if (pending.length > 0 && pending[0]!.prepared === undefined) flush();
    pending.push({
      plan,
      input,
      prepared:
        route === "script"
          ? {
              scripts: prepared.modules,
              asynchronous: plan.asynchronous,
              canSuspend: plan.canSuspend,
            }
          : {
              scripts: prepared.harness,
              modules: prepared.entries,
              asynchronous: plan.asynchronous,
              canSuspend: plan.canSuspend,
            },
      started,
    });
    if (pending.length === batchSize) flush();
  } else {
    flush();
    record(input, prepared.outcome, started); // precise reason retained verbatim
  }
}
```

Use real narrowing in place of the illustrative `route === "script"`
conditional on `prepared`: two local branches, or a small discriminated
`{ kind }` wrapper. Do not use casts. The behavior must be:

- **Gate-off and Script paths.** Statement order and call arguments are
  identical to `:242-259`.
- **Thrown preparation.** It goes through the existing `catch` (`:260-263`):
  `flush()`, then `record(input, adapterCrash(error), started)`. `input` has
  no `fixtures` because the throw left `fixtures` undefined. Rethrowing
  `prepared.thrown` keeps the crash detail byte-identical to an in-line
  throw.
- **Mixed batches.** Module cases are execution items
  (`prepared !== undefined`), so the existing syntax/execution switch at
  `:238` and `:244` flushes on every kind change. Script and module cases
  share execution batches, which is sound only because the builder is gated
  (`prepareNativeBatch` throws `module case requires the module host
capability` otherwise). Acceptance case 0 proves a Script runs unchanged
  in a gated batch. Unsupported and crash records still flush first, so
  observation order equals suite order.

**E8: scope (`:293-297`).** Concatenate after the existing string:

```ts
+(moduleExecution
  ? " Module variants load sibling fixtures through a synchronous table loader; unparsed fixtures, JSON, attributes, top-level await, import() and import.meta are unsupported."
  : "");
```

The gate-off scope stays byte-identical. `variantPolicy`, `compilation.failurePolicy`
and the journal header do not change.

**E9: usage.** The usage error string stays the same. Document
`TINT_TEST262_MODULES=1` in `docs/test262-runner.md` in the same commit (one
paragraph next to `TINT_TEST262_SOURCES`).

## 4. Red-first Node tests

Run each new assertion against the current tree first and record the red. No
test runs a native binary.

**R1 (`test262-module-preparation.test.ts`, extend "preserves partial-parser
limits and unsupported fixtures"). Red today.** For the `parsed: false` JS
node and the `.json` node, assert
`result.fixtures` deep-equals `[{ name: node.name, sha256: "hash" }]`. Add a
two-node graph (`a.js` lowers, `b.js` has `parsed: false`, root imports both).
Expect `unsupported`, with `fixtures` equal to **both** nodes in sorted order.
That checks the whole graph, not a prefix. Add a lowering-failure node
(`export const x = await 1;`) and expect `fixtures` present.

**R2 (same file, extend "screens attributes … before discovery"). Green on
arrival; characterizes D4.** For each root-screen failure, assert
`!("fixtures" in result)` alongside the existing `calls === 0`.

**R3 (same file, extend the closure test).** The `./missing.js` case returns
the existing reason string **and** `fixtures` (empty for a root-only graph,
listed nodes otherwise). Red today for the non-empty case.

**R4 (`test262-native.test.ts` or the preparation test). Red: the export is
missing.**

| metadata.negative.phase | variant  | gate  | route      |
| ----------------------- | -------- | ----- | ---------- |
| `parse`                 | `module` | true  | `"syntax"` |
| `early`                 | `module` | true  | `"syntax"` |
| `resolution`            | `module` | true  | `"module"` |
| `runtime` / none        | `module` | true  | `"module"` |
| none                    | `module` | false | `"script"` |
| none                    | `strict` | true  | `"script"` |

Also assert that `prepareNativeScripts(plan, "module", [])` still returns the
exact gate-off reason `native module execution is not implemented`.

**R5 (`test262-script-service.test.ts:211-218`). The expected regex change;
red against the current `run.ts`.** Replace the `engine =` regex with
`/engine = nativeScriptAdapter\(\s*capturedScriptEvaluation\(snapshot\),\s*moduleExecution,?\s*\)/`
so that Prettier wrapping is allowed. Keep `/adapter: engine/`. Then add
source-shape assertions on the same `source` string:

- `source.split("process.env.TINT_TEST262_MODULES").length === 2`, and
  `source.split("nativeModuleCapability(").length === 2`. The gate is read
  once.
- `/createNativeBatchBuilder\(snapshot, moduleExecution\)/`, and
  `/nativeVariantRoute\(metadata, variant, moduleExecution\)/`.
- `source.indexOf("prepareNativeModuleProgram(") < source.indexOf("sameNativeObservationInput(prior, input)")`,
  so fixtures are known before the resume check.
- `source.indexOf("prepareNativeScripts(") > source.indexOf("sameNativeObservationInput(prior, input)")`,
  so Scripts stay lazy.
- `/moduleExecution\s*\?\s*" Module variants load sibling fixtures/`, so the
  scope append is conditional.
- The `createNativeRunJournal` header literal contains no `moduleExecution`
  or `modules` key (D6).

**R6 (`native-run-journal.test.ts:205-235`). Already present; re-run only.**
A changed fixture hash → `false`. A prior without fixtures versus an input
with fixtures → `false`. Script prior/input → `true`.

Then run `pnpm check`. The expected total is 4,234 plus the new `test()`
blocks, so count the added blocks rather than assertions. There is no catalog
or manifest change and managed-surface stays at 128. Re-measure the T2
digests. Record a new Node checkpoint only under a new `-v2` name; never
overwrite `module-host-preparation-node-checkpoint-v1.json`.

## 5. First selection: commands and gates

### 5.1 Preconditions (all must hold, checked from files, not forecasts)

1. The frozen self-build PID 26730 has exited, and the fixed point
   `docs/results/bootstrap-module-source-v1.json` exists.
2. The serial recorder has written its acceptance report, and **all seven**
   cases (Script 42, cycle 42, link SyntaxError 63, runtime TypeError 31,
   backstop unsupported 10, async 42, harness RangeError 24) match. Any 69,
   unexpected exit, pre-entry failure or checker rejection blocks this
   section.
3. §2–§4 are implemented, `pnpm check` is green, and `pnpm build` has
   refreshed `dist`.
4. `workspaceSourceIdentity(workspaceSources())` equals `2c72f4c9…810c` with
   562 files. That is the snapshot the acceptance image was built from.
   Routing touches only `tools/`, so the identity must not move. If it does,
   stop: the acceptance evidence does not cover the new sources.
5. No native build, conformance runner or recorder is active. The paused
   controller 67383/64325 is not resumed, signalled or re-marked by this step.
   If main cannot confirm that a separate serial LLDB session is acceptable
   while that controller is paused, wait.

### 5.2 Freeze (once, exclusive)

```sh
T=.tint-bootstrap/node-toolchain-module-host-v1
test ! -e "$T" || exit 1
node --input-type=module -e '
import {writeFileSync} from "node:fs";
import assert from "node:assert/strict";
import {freezeNodeToolchain} from "./tools/frozen-node-toolchain.ts";
import {workspaceSources,workspaceSourceIdentity} from "./tools/workspace-sources.ts";
const s=workspaceSources(),id=workspaceSourceIdentity(s);
assert.equal(id.sha256,"2c72f4c9259c030517ee80d1c06ebcd820ab05b7f08287f9b103b39d86ec810c");
const f=freezeNodeToolchain(s,process.argv[1]);
writeFileSync("docs/results/frozen-node-toolchain-module-host-v1.json",
  JSON.stringify({sourceSnapshot:id,toolchain:f},null,2)+"\n",{flag:"wx"});' "$T"
```

From here on, every run uses `$T/tools/test262-native-run.ts` and
`TINT_TEST262_SOURCES=$T/source-snapshot.json`. That makes the runner, the
Node compiler artifacts and the source graph immutable, and
`frozenNativeRunIdentity` verifies them on every start.

### 5.3 Three runs, strictly serial, each to new files under `set -o noclobber`

```sh
set -o noclobber
R="node $T/tools/test262-native-run.ts .tint-bootstrap/test262"
export TINT_TEST262_SOURCES="$T/source-snapshot.json"
# G0 — gate off, module file, Node-only (no image is built or launched)
TINT_TEST262_JOURNAL=.tint-bootstrap/test262-eval-this-gate-off-v1.jsonl \
  $R language/module-code/eval-this.js 1 > .tint-bootstrap/test262-eval-this-gate-off-v1.json
# G1 — gate off, Script guard (native; 2 variants)
TINT_TEST262_JOURNAL=.tint-bootstrap/test262-module-host-script-guard-v1.jsonl \
  $R language/global-code/script-decl-lex-var-declared-via-eval.js 64 \
  > .tint-bootstrap/test262-module-host-script-guard-v1.json
# G2 — gate on, first module selection (native; 1 variant)
TINT_TEST262_MODULES=1 TINT_TEST262_JOURNAL=.tint-bootstrap/test262-eval-this-native-v1.jsonl \
  $R language/module-code/eval-this.js 1 > .tint-bootstrap/test262-eval-this-native-v1.json
```

Do not set `TINT_TEST262_RESUME`, `TINT_TEST262_PAUSE`,
`TINT_TEST262_CAPTURE_SOURCES` or any debugger experiment variable. Run each
command only after the previous one has exited and its report has been
checked.

| Run | Must equal                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G0  | adapter `native-script-v9-direct-eval`; 1 observation `[module]`, `unsupported`, reason `native module execution is not implemented`; `batches: []`; no `fixtures`; scope byte-equal to the pre-routing string                       |
| G1  | adapter v9; 2 `pass`, the same statuses as `docs/results/test262-direct-eval-global-canary-native-v1.json`; 1 execution batch `compiled`                                                                                             |
| G2  | adapter `native-script-v10-modules`; 1 observation `[module]`, `pass`, no `fixtures`, `sha256 044874d0…`, harness hashes as in §0; 1 execution batch `compiled`; scope ends with the module sentence; the journal ends in `complete` |

Only after review does main copy the reports to `docs/results/`, each with
`COPYFILE_EXCL`: `test262-module-eval-this-gate-off-v1.json`,
`test262-module-host-script-guard-v1.json` and
`test262-module-eval-this-native-v1.json`. The `.tint-bootstrap` originals
are never edited.

### 5.4 Blocking rules (no automatic retries)

- **A failure in G0 or G1 blocks G2 and every module selection.** That means
  any difference in adapter, status, reason or scope. It is a gate-off
  regression. Do not rerun it to make it go away.
- **G2 blocks widening** if it is anything other than `pass`. That includes
  exit 69, a `native adapter/compiler` crash, a batch outcome other than
  `compiled`, `timeout`, or `fail`. `eval-this.js` is the smoke test, so even
  `unsupported` must be explained before the graph selection runs. Diagnose
  with an explicitly recorded single-case run into **new** files. Never
  overwrite or resume over a failed attempt (`run.ts` failure policy:
  "no automatic retry").
- **Launch failures block.** A debugger launch failure (`failed to catch stop
after launch`) is recorded as is. It does not trigger a relaunch, and it
  blocks until the M1b launch-control analysis explains it.
- **An interrupted run is not resumed by default.** Resuming needs main's
  explicit decision and the same frozen `$T`, journal, selection and batch
  size. If the prior observation came from a module route, its `fixtures`
  must match. That is what §3 E5–E6 guarantee.
- **Never delete or reuse a path.** Each attempt gets the next `-vN`.

## 6. Out of scope

- Widening beyond `eval-this.js`: graph, ambiguous-export and full module
  selections.
- Grouping the report notes by unsupported reason or fail exit.
- M2c native fixture re-parse, M3, M4 and M5.
- Batch-size tuning, compile performance, and any full survey.
- Editing the frozen direct-eval conformance line, its reports or its
  markers.

## 7. Evidence and limits

- `probe.ts`: gate, the two adapter strings, and `prepareNativeModuleProgram`
  on four pinned files with the real harness. `probe2.ts`: direct
  `discoverModuleGraph` on three files (the PNG throw, the unparsed fixture,
  the empty graph). Both are read-only and ran with the repo root as the
  working directory.
- The G1 reference report used toolchain `155baaa1…` and snapshot
  `5d196757…`. G1 compares **statuses and adapter**, not snapshot identity.
- Exact line numbers in §3 refer to the current `run.ts` (324 lines). Re-read
  `:197-266` before editing if the file has moved.
- Nothing here establishes native behavior. G2 is the first conformance
  observation of the module host.

## 8. Next focused planning slice

Plan the **first graph selection** (planned in
[host-esm-ambiguous-export-selection.md](host-esm-ambiguous-export-selection.md)), `language/module-code/ambiguous-export-bindings`
(10 module variants: fixtures, self-imports, resolution negatives and the §2.4
namespace case). It needs four things:

- a Node-only route census using gated preparation, with the expected
  `fixtures` per variant;
- a deliberate interrupt-and-resume drill on a gated journal that proves a
  changed fixture hash is rejected;
- the report-note grouping (unsupported by reason, fail by exit);
- the blocking checks for missing `fixtures` and for resolution-negative
  passes over unparsed graphs.
