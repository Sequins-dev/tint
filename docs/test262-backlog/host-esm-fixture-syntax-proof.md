# HOST-ESM M2c: native fixture syntax proof, six `instn-resolve-*` tests

This plan follows [namespace selection](host-esm-namespace-selection.md) §7. It
covers the census, the D-rule, a source review, the smallest representation with
an exact edit list, red-first tests, and the commands, blocking rules and
regressions. This is research only. No source, test, manifest, catalog, result, dashboard,
marker or snapshot was changed. Nothing was built, and no native binary, debugger,
controller or agent was run. The one read-only probe, `/tmp/m2c-probe/probe.mjs`,
imported the **frozen** `.tint-bootstrap/node-toolchain-module-host-v1/packages/*/dist`
modules under Node v24.12.0. It read the pinned fixture bytes and emitted nothing.
Its verdicts are **bootstrap** verdicts. They are recorded only to explain why
discovery marks the nodes `parsed: false`, and they are never evidence (§3.3).

67383, 64325, the DirectEval pause files and the conformance line were not touched.

## 0. State at planning time (files only)

- **G1/G2.** Script guard 2/2, eval-this 1/1.
- **Ambiguous N1.** 9/10, with one import-source proposal variant
  unsupported. Accepted, no deviations.
- **Namespace N2.** 38/38. Accepted, no deviations.
- **Frozen toolchain.** `frozen-node-toolchain-module-host-v1.json`:
  `8c039e42…9b9f`, snapshot `2c72f4c9…810c` (562 files), 4,237 workspace tests.
- **Compiler gate.** `bootstrap-module-source-v1.json`, a byte-identical fixed
  point. `module-host-native-validation-v1.json` has seven host cases.
- **Inventory.** `module-preparation-inventory-v1.json` records the six M2c
  reasons, with fixture hashes.

## 1. Census (pinned `91c70759…5ba`, `dirty: false`)

All six tests have `flags: [module]`, so there is one `module` variant each.
All have `negative: {phase: resolution, type: SyntaxError}`, no `includes` and
no `features`. Each root starts with `$DONOTEVALUATE();`. With the gate on, each
routes `module`, because `nativeVariantRoute` sends only `parse`/`early`
negatives to `syntax` (`tools/test262-native.ts:188-200`).

| #   | Test (`sha256` prefix)                      | Root requests, in source order                 | Fixture nodes (`name@sha` prefix, bytes)                                                                                |
| --- | ------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | `instn-resolve-empty-export.js` `bf31ec4c…` | `export {} from './…empty-export_F'`           | `empty-export_F@d019396c` (144 B, `0++;`)                                                                               |
| 2   | `instn-resolve-empty-import.js` `88161e79…` | `import {} from './…empty-import_F'`           | `empty-import_F@d019396c` (144 B, `0++;`)                                                                               |
| 3   | `instn-resolve-err-syntax-1.js` `f3140ef3…` | `import './…err-syntax-1_F'`                   | `err-syntax-1_F@622c5b04` (146 B, `break;`)                                                                             |
| 4   | `instn-resolve-err-syntax-2.js` `7bd714bc…` | `import './…err-syntax-2_F'`                   | `err-syntax-2_F@d019396c` (144 B, `0++;`)                                                                               |
| 5   | `instn-resolve-order-depth.js` `d6c9cdc8…`  | `child_F`, then `syntax_F`                     | `child_F@1d1c46a6` (198 B, `import './…-reference_F'`), `reference_F@d019396c` (`0++;`), `syntax_F@622c5b04` (`break;`) |
| 6   | `instn-resolve-order-src.js` `608ccd08…`    | `valid_F`, then `reference_F`, then `syntax_F` | `valid_F@2d326e77` (141 B, `;`), `reference_F@d019396c` (`0++;`), `syntax_F@622c5b04` (`break;`)                        |

`_F` abbreviates `_FIXTURE.js`. Every fixture starts with the same two-line
license comment. Full hashes are in the inventory (lines 1798–1895), re-pinned by P1.

What the census establishes:

- **Two bad bodies, both early errors.** `0++;` (`d019396c`) fails the
  UpdateExpression AssignmentTargetType rule. `break;` (`622c5b04`) at module top
  level fails ContainsUndefinedBreakTarget. The verdict needs parse plus the
  parser and binder early checks, but not lowering.
- **No graph imports a binding from a bad fixture.** In #1/#2, the empty clauses
  are still ModuleRequests.
- **Good nodes stay compiled.** `child_F` and `valid_F` lower today.
- **Shared bytes, distinct identities.** Five nodes share `d019396c` and three
  share `622c5b04`. Identity is by name (`records.get(name)`), never by hash.

## 2. Spec-derived rule (not Node, not a forecast)

**D-rule.** In each graph, `LoadRequestedModules` runs depth-first, in request
order (§16.2.1.5.1, InnerModuleLoading). The first request that reaches a bad
fixture calls `HostLoadImportedModule`. The host's ParseModule returns a list of
SyntaxError objects, so the host calls `FinishLoadingImportedModule` with a throw
completion. ContinueModuleLoading then rejects the graph promise. Link and
Evaluate never run, so `$DONOTEVALUATE()` is never reached. The outcome is
`error / resolution / SyntaxError` → `pass`.

The first bad node reached, by spec order:

| #   | Load sequence                                      | First bad node | Never loaded |
| --- | -------------------------------------------------- | -------------- | ------------ |
| 1–4 | root → fixture                                     | the fixture    | none         |
| 5   | root → `child_F` (ok, recurse) → `reference_F`     | `reference_F`  | `syntax_F`   |
| 6   | root → `valid_F` (ok, no requests) → `reference_F` | `reference_F`  | `syntax_F`   |

**Recorded limitation.** In the pinned bytes, `reference_F` and `syntax_F` are
**both** SyntaxErrors, so for #5/#6 a wrong load order gives the same exit code.
The native outcome cannot prove order. Order rests on the existing `loading.ts`
unit tests (§6). The acceptance file must say so.

The error must come from the test realm: `failure` compares against
`realm.prototypes.get("syntax")` (`tools/test262-native.ts:465-477`), giving
exit 63.

## 3. Source review

### 3.1 The short-circuit

`prepareNativeModuleProgram` (`tools/test262-native.ts:262-377`) walks
`graph.nodes` in name order. It returns
`unsupported("fixture syntax verdict requires native re-parse (M2c)")` at the
**first** node with `parsed === false` (`:355-357`), and keeps `fixtures` on the
rejection (`rejectedGraph`, `:347-350`). `parsed` comes from the bootstrap
`parseModule` in `discoverModuleGraph` (`tools/test262-module-graph.ts:49-61`),
documented as "never establishes a syntax verdict". M2c keeps that contract. The
short-circuit is a deliberate stop, not a stub: no native verdict path exists
for module fixtures yet.

### 3.2 Native primitives that already exist (reused, not duplicated)

| Primitive                                       | Where                                                                                                                                                                                       | Use in M2c                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| The native syntax verdict program               | `nativeSyntaxHost` (`tools/test262-native-syntax.ts:17-36`): bytes as data → `createSourceText` → `parseModule(…,"javascript")` → `validateJavaScriptBindings(…,"module")`, giving 40/42/10 | **the** verdict, byte-for-byte, as a fixture entry                |
| Its classification                              | 40 for `SYNTAX_ERROR`/`LEXICAL_ERROR` (parse) or `DUPLICATE_NAME`/`INVALID_CONTEXT` (binding). 42 for accepted. 10 for anything else (a LIMIT, an unsupported feature, internal)            | unchanged. Only 40 may become a SyntaxError                       |
| The same classes in the engine                  | `rejectSource` (`packages/js-engine/src/script-evaluation.ts:249-253`) maps the same two parse codes to SyntaxError, and everything else to unsupported                                     | confirms that the class split is the project's existing rule      |
| Syntax, binding and source modules in the image | The module-host image roots already include `syntaxModule`, `bindingModule` and `packages/source/src/text.ts` (`tools/test262-native.ts:1476-1502`)                                         | **no new image roots**                                            |
| The loader failure channel                      | `finishLoadingImportedModule(referrer, request, payload, {ok:false,error})` → `continueLoading` → reject (`packages/js-runtime/src/modules/loading.ts:56-66,134-159`)                       | the only error path. No C, platform, linker or interpreter change |
| `ModuleCompletion`                              | exported from `packages/js-runtime/src/modules/index.ts`                                                                                                                                    | a type-only import in the runtime text                            |
| Exit mapping                                    | `failure(loaded.error,60)` → 63 → `{kind:error, phase:resolution, type:SyntaxError}` (`:168-183`)                                                                                           | unchanged                                                         |
| Fixture identity and resume                     | `fixtures` on success **and** failure (`:347-376`). The runner drops an empty list (`test262-native-run.ts:231-241`)                                                                        | unchanged: the same names, hashes and order                       |

Because no package source changes, the source snapshot stays `2c72f4c9…810c`.
The compiler fixed point is not affected, so **no new compiler self-build is
required**. Tool bytes change, so a **new frozen Node toolchain** is required
(§7.1).

### 3.3 Bootstrap probe (explanation only)

Frozen dist `parseModule` gives `SYNTAX_ERROR` for `622c5b04` ("control
transfer outside loop or switch") and for `d019396c` ("invalid update target").
It accepts and lowers the good nodes and roots. This explains `parsed: false`,
and forecasts nothing native.

## 4. Design

### 4.1 Representation: a verdict-only entry replaces only unparsed nodes

```ts
export interface NativeModuleEntry {
  readonly name: string;
  readonly module: SourceModule;
  /** Present only for a discovered fixture that bootstrap could not parse.
   * `module` is then the native syntax verdict program for the pinned bytes,
   * not a compiled module, and it can never produce a ModuleRecord. */
  readonly verdict?: true;
}
```

One optional discriminant: graphs without an unparsed fixture are unchanged in
value and generated text. The verdict `module` is
`parsedNativeHost("test262-fixture-verdict-"+name, nativeSyntaxVerdictSource(bytes,"module"), nativeSyntaxDependencies)`.

### 4.2 Preparation (`prepareNativeModuleProgram`, `:355-357` only)

For a `javascript` node with `parsed === false`, in place of the early return:

1. Encode the bytes with `new TextEncoder().encode(node.source)`. This
   round-trips exactly, because `test262Source` decodes with
   `fatal: true, ignoreBOM: true`.
2. Assert that `createHash("sha256")` of the bytes equals `node.sha256`.
   `node:crypto` is not imported in this file yet, so add it. On a mismatch,
   return `rejectedGraph(unsupported("fixture bytes differ from discovery hash"))`.
3. Push `{name, module: verdictModule, verdict: true}`. Do not lower the node,
   add none of its requests, and continue the loop.

Everything else is unchanged:

- JSON stays M5, and an unparseable root stays unsupported;
- entry order is root first, then name order;
- `fixtures` is unchanged;
- the outside-graph check runs over compiled entries' requests, and verdict
  names are `known`.

### 4.3 Generated host (`nativeTestHost`)

A verdict entry emits `import {run as verdict<i>} from "<id>";` instead of
`import {create as module<i>}`. The call gains a sixth argument, `verdicts`
(`[undefined,…,verdict<i>,…]`), with `undefined` at that index in `creates`.
The sixth argument is emitted **only** when some entry has `verdict`, so every
existing host text stays byte-identical.

### 4.4 Runtime (`nativeTestRuntimeSource`, the `moduleRunner` fragment only)

Signature:
`runNativeModuleTest(scripts,names,creates:readonly (NativeModuleFactory|undefined)[],asynchronous,canSuspend=true,verdicts:readonly ((()=>number)|undefined)[]=[])`.

Before any phase, add a structural check: for every `i`, exactly one of
`creates[i]` and `verdicts[i]` is defined, and `creates[0]` is defined. Otherwise
return 69, as with the existing invariant at `if(names.length===0||…)return 69;`.

Next to `record`, add:

```ts
const verdictCodes = new Map<number, number>();
function loadEntry(index: number): ModuleCompletion {
  const verdict = verdicts[index];
  if (verdict === undefined) return { ok: true, module: record(index) };
  let code = verdictCodes.get(index);
  if (code === undefined) {
    code = verdict();
    verdictCodes.set(index, code);
  }
  if (code === 40)
    return { ok: false, error: createRuntimeError(realm, "syntax") };
  if (code === 42 || code === 10) return rejectUnsupportedExecution(realm);
  throw "NATIVE_FIXTURE_VERDICT_INVARIANT";
}
```

The loader body changes only its last call:
`finishLoadingImportedModule(referrer,request,payload,loadEntry(index));`.

Add `type ModuleCompletion` to the existing `"modules"` import.
`createRuntimeError` and `rejectUnsupportedExecution` are already imported from
`"object"` (`:566`).

What this preserves:

| Property            | How                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Phase order         | The verdict runs inside HostLoadImportedModule, lazily, only for a request that is reached. Link and evaluation are untouched            |
| Error realm         | `createRuntimeError(realm,"syntax")`, where `realm` is the test realm that `failure` checks                                              |
| No fake SyntaxError | 42 (native accepts, no compiled module) and 10 (a LIMIT, unsupported or internal) both give exit 10. Any other code gives 69             |
| Identity            | Verdict entries never enter `records`. The code is memoized, so a repeat is idempotent. Self-imports and compiled identity are unchanged |
| Lazy validation     | Unknown and non-`./` specifiers still reject inside the loader, when reached                                                             |

### 4.5 The shared verdict program (refactor, byte-identical)

Move the body of `nativeSyntaxHost` into
`export function nativeSyntaxVerdictSource(bytes: Uint8Array, goal: "script" | "module"): string`
in `tools/test262-native.ts`. Move `syntaxDependencies` there too, as
`nativeSyntaxDependencies`. `nativeSyntaxHost(plan)` becomes
`nativeSyntaxVerdictSource(new TextEncoder().encode(plan.source), plan.goal)`,
and must be **byte-identical**. This direction avoids a new import cycle,
because `test262-native-syntax.ts` already imports `test262-native.ts`.

### 4.6 Report text and adapter

The scope sentence at `test262-native-run.ts:351` ("unparsed fixtures … are
unsupported") becomes: "fixtures that bootstrap cannot parse are judged only by
the native syntax verdict at load; a native acceptance stays unsupported".

**Recommendation:** bump the module adapter to
`native-script-v11-module-fixture-syntax`. One class of `unsupported` outcomes
becomes measurable, and v6–v10 versioned each such contract change. Keeping v10
is acceptable: journals cannot cross anyway, because `frozenToolchainSha256`
differs.

## 5. Exact edit list (tools only)

| File                                                                                                                                                         | Edit                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/test262-native.ts`                                                                                                                                    | Add `nativeSyntaxVerdictSource` and `nativeSyntaxDependencies` (§4.5). Add `verdict?: true` (§4.1). Change the unparsed branch (§4.2). Change `nativeTestHost` (§4.3) and the `moduleRunner` text (§4.4). Optionally bump the adapter (§4.6) |
| `tools/test262-native-syntax.ts`                                                                                                                             | `nativeSyntaxHost` delegates (§4.5). Use the moved dependency map. No other change                                                                                                                                                           |
| `tools/test262-native-run.ts`                                                                                                                                | The scope sentence only (§4.6)                                                                                                                                                                                                               |
| `tools/test262-module-preparation.test.ts`, `tools/test262-module-host.test.ts`, `tools/test262-native-batch.test.ts`, `tools/test262-native-syntax.test.ts` | the tests in §6                                                                                                                                                                                                                              |
| `docs/test262-backlog/*`, `README.md`                                                                                                                        | The result links, after acceptance only                                                                                                                                                                                                      |

`prepareNativeBatch` and the image builder need **no** edit. Sharing is keyed by
`[name, module, deps]`, and verdict dependencies are non-local. No package, C,
platform, linker, interpreter, catalog or manifest file changes.

## 6. Red-first Node tests (write first, see them fail, then implement)

- **T1, preparation** (`test262-module-preparation.test.ts`). Move the first
  `parsed: false` case out of "…preserves partial-parser limits…" (`:84-90`).
  Given `dep.js`, `parsed: false`, `"0++;"` and its real sha256, the result is
  `ok: true`:
  - entries `[root.js, dep.js]`;
  - `entries[1].verdict === true`;
  - id `test262-fixture-verdict-dep.js`;
  - `fixtures` unchanged.

  JSON and attribute nodes stay unsupported. A wrong hash is unsupported and
  keeps `fixtures`. Today this test fails with the M2c reason.

- **T2, no Node verdict.** An unparsed node with `"export {"` also gets a
  verdict entry, because preparation never decides 40/42/10. The embedded bytes
  equal the source, and the text has no `create` export.
- **T3, byte identity** (`test262-native-syntax.test.ts`). Pin the SHA-256 of
  the existing `nativeSyntaxHost` output for the `:6`, `:26` and `:40` plans
  **before** the refactor, as literals, and assert them after.
- **T4, runtime text** (`test262-module-host.test.ts`, extending `:196` and
  `:247`). The `realm.moduleLoader=` slice still `doesNotMatch(/createRuntimeError|failure\(/)`
  and calls `loadEntry(index)`. In `loadEntry`, `createRuntimeError(realm,"syntax")`
  occurs once, only under `code===40`. 42 and 10 go to `rejectUnsupportedExecution`,
  and any other code throws. `loadEntry` is referenced only from the loader.
  All existing phase-order and `scriptFaultExit` assertions stay as they are.
- **Load order is already covered, not new.** `packages/js-runtime/test/modules-loading.test.ts`
  has "synchronous graph loading follows source-order DFS" (`:42`) and
  "synchronous failure stops requesting later siblings" (`:137`). Together they
  prove that #5/#6 never reach `syntax_F`. Re-run them, and add nothing.
- **T5, host text** (`test262-native-batch.test.ts`, near `:142`). One verdict
  entry gives `import {run as verdict1}`, a sixth argument `[undefined,verdict1]`
  and `undefined` in `creates`. With no verdict entry, the host text is
  byte-identical: pin a hash of today's "module batches retain named factories"
  host. Two names with the same bad bytes stay two entries.
- **T6, gate-off.** The `:85` "v9 … byte-identical without the module gate"
  test still passes, and the Script runtime text has no verdict reference.

The full workspace gate (`pnpm test`, `npm run typecheck`, `pnpm boundaries`,
lint and format) must pass. The new test count is recorded, not forecast.

## 7. Toolchain and commands (main executes, strictly serial)

### 7.1 A new frozen toolchain, not a self-build

After the gate, freeze with `freezeNodeToolchain(workspaceSources(),
".tint-bootstrap/node-toolchain-module-fixture-syntax-v1")` into **new** paths,
recorded in `docs/results/frozen-node-toolchain-module-fixture-syntax-v1.json`
(`wx`). Assert that `workspaceSourceIdentity` is still `2c72f4c9…810c` with 562
files. If it is not, stop: a package changed, and that needs a compiler
self-build and a fixed-point plan, which this plan does not cover. Reuse the v1
compiler gate (`bootstrap-module-source-v1.json`) and native gate by reference,
because the snapshot is identical. The v1 toolchain stays immutable.

```sh
T=.tint-bootstrap/node-toolchain-module-fixture-syntax-v1
ENV="TINT_TEST262_SOURCES=$T/source-snapshot.json TINT_TEST262_DEBUGGER_LAUNCH=debugserver-direct TINT_TEST262_DEBUGGER_TRACE=1 TINT_TEST262_CONTAINMENT_MS=300000"
# never set: TINT_TEST262_RESUME, TINT_TEST262_CAPTURE_SOURCES
O=.tint-bootstrap/module-fixture-syntax-v1
SIX="instn-resolve-empty-export instn-resolve-empty-import instn-resolve-err-syntax-1 instn-resolve-err-syntax-2 instn-resolve-order-depth instn-resolve-order-src"
```

### 7.2 Node-only phase (no image, no debugger)

**P1, census pin.** Write `.tint-bootstrap/census-fixture-syntax-v1.mjs` as a
copy of the namespace census with only the selection changed. It imports only
`$T/tools/*` and writes `docs/results/module-fixture-syntax-census-node-v1.json`
(`wx`). It asserts:

- 6 variants, all routed `module`, all `prepared`;
- `fixtures` byte-equal to the inventory;
- per test, `[1,1,1,1,2,2]` verdict entries and `[0,0,0,0,1,1]` compiled
  fixtures;
- every verdict module has no `create` export, and embeds bytes whose SHA-256 is
  the fixture hash;
- the R1 selections (§7.4) prepare with no verdict entry.

It never compiles, and never compares against Node 24.

**P2, gate-off.** First `mkdir .tint-bootstrap/module-fixture-syntax-v1`, which
must not already exist. Then, for each `f` in `$SIX`, without
`TINT_TEST262_MODULES`:

```sh
env $ENV TINT_TEST262_JOURNAL=$O/p2-$f.jsonl node $T/tools/test262-native-run.ts \
  .tint-bootstrap/test262 language/module-code/$f.js 1 > $O/p2-$f.json 2> $O/p2-$f.log
```

Each must exit 0 with one observation, `unsupported` with the reason
`native module execution is not implemented`, no `fixtures` and `batches: []`.

### 7.3 Native phase N3: six single-file runs, one controller

Write `.tint-bootstrap/run-fixture-syntax-selection-v1.mjs` as a copy of
`run-namespace-selection-v1.mjs`. Keep the frozen read, snapshot assert,
handshake, `wx` and `rmSync(pause)` in `finally`. Change only these:

- **Preconditions.** P1 and P2 hold. Both v1 acceptances are `accepted: true`.
  No pause or `.ack` exists. 67383 and 64325 are never signalled.
- **Pause text.** `M2c fixture syntax native proof`.
- **Runs.** Six serial spawns, in `$SIX` order:
  `[$T entry, '.tint-bootstrap/test262', 'language/module-code/'+f+'.js', '1']`,
  with `TINT_TEST262_MODULES=1`. Each writes
  `.tint-bootstrap/test262-module-fixture-syntax-$f-v1.{json,jsonl,log}`. The
  controller writes `docs/results/test262-module-fixture-syntax-controller-v1.json`.
  Batch size 1 is deliberate: a compile failure is then named per test.
- **Structural asserts, per run.**
  - The §4.6 adapter, `91c70759…` with `dirty: false`, snapshot `2c72f4c9…`,
    and the new freeze's `frozenToolchainSha256`.
  - One observation deep-equal to P1 in `path`, `sha256`, `variant`, `harness`
    and `fixtures`.
  - `batches` equal to `[[0,1,'execution','compiled']]`, `restoredVariants: 0`,
    and a journal ending in `complete`.
- **Copy.** Write the six reports, in order and whatever their statuses, to
  `docs/results/test262-module-fixture-syntax-native-v1.json` (`wx`).
- **Acceptance.** Write `docs/results/test262-module-fixture-syntax-acceptance-v1.json`
  (`wx`). Each test must be `error/resolution/SyntaxError` → `pass`. Anything
  else is a deviation (`path`, `status`, `outcome`, §2 row). Add
  `orderProvedNatively: false` with the §2 text.

### 7.4 Regression R1: unchanged namespace and ambiguous selections on `$T`

The runtime text changes for every module case, so the v1 passes do not carry
over. With the same controller pattern and `TINT_TEST262_MODULES=1`, run these
under `$T` into new `…-fixture-syntax-regression-v1` paths:

- `language/module-code/namespace`, batch 64;
- `language/module-code/ambiguous-export-bindings`, batch 64.

Acceptance requires, per variant, that `path`, `sha256`, `fixtures`, `status`
and the outcome's kind, phase and type deep-equal the accepted v1 reports. That
means 38/38, and 9/10 with the same proposal variant unsupported. `batches` must
also equal v1. Only `adapter`, `scope`, `frozenToolchainSha256` and timings may
differ.

An optional Node-only inventory refresh under `$T` should then show 0 M2c
reasons. That is evidence of routing, not conformance, and running it is main's
choice.

## 8. Blocking rules (no retry, no automatic resume)

| Observation                                 | Meaning and action                                                                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A structural assert fails                   | Nothing is copied. Diagnose from the journal and log                                                                                                                             |
| Exit 10 on one of the six                   | Recorded `unsupported`. The verdict was 42 (native accepted the bad bytes, a parser defect) or 10 (a LIMIT or internal error). Never turn 42 into SyntaxError. Diagnose in `-v2` |
| A runtime exit (30+x) or a pass of the body | Loading did not stop. A load or phase defect in `loadEntry` or `loading.ts`, not in the verdict                                                                                  |
| Exit 60, or 6x other than 63                | Wrong realm or type. Check the `createRuntimeError(realm,…)` realm                                                                                                               |
| Exit 69                                     | A host invariant (§4.4). Diagnose the generated host text                                                                                                                        |
| Not `compiled`                              | Blocks. Re-run that file alone, into `-v2`, under the same `$T`. Never change `$T`, overwrite or delete a path                                                                   |
| An R1 deviation                             | Blocks M2c acceptance, even with 6/6                                                                                                                                             |

Node 24 and bootstrap verdicts are never cited to accept or reject. Cite §2.

## 9. Uncertainties (stated, not forecast)

1. **U1.** Whether native `parseModule` and `validateJavaScriptBindings` give 40
   for `0++;` and `break;` is exactly what N3 measures.
2. **U2.** Module hosts newly reach the parse and bind path. Both are already
   image roots, but the compile time is unknown.
3. **U3.** No `(F|undefined)[]` array occurs in the runtime text or
   `packages/js-runtime/src`, so native compilation of `creates` with holes is
   unverified. If it fails, the fallback is a dense `verdictIndex:number[]`.
   That is a separate design with its own red-first test.
4. **U4.** The pinned bytes cannot show load order natively (§2).
5. **U5.** The adapter name (§4.6) is main's decision before freezing, because
   it enters the frozen bytes.

## 10. Out of scope

This plan does not cover:

- JSON fixtures and attributes (M5), TLA (M4), `import()` and `import.meta`
  (M3), proposal phases, and roots that bootstrap cannot parse;
- fixtures whose only early error is found by lowering (if native accepts them,
  they stay unsupported);
- package changes and self-builds;
- the DirectEval line, 67383 and 64325, and the frozen conformance line.

## 11. Next focused planning task: evidence for M3

The inventory gives M3 9 first-blocker hits: 5 under `top-level-await/` (M4),
3 `import-defer`, and only `language/module-code/verify-dfs.js` standalone. So,
in its scope, M3 unblocks at most one variant.

The pinned suite also has 1,005 non-fixture tests in
`language/expressions/dynamic-import` and 22 in `…/import.meta` (17 of them
`flags: [module]`). Those lie outside the inventory, and their blockers are
unmeasured.

**Recommendation.** After M2c and R1 are accepted, plan a Node-only **M3
census** of those two directories under `$T`, giving first blockers. Do not plan
M3 implementation yet. Choose it only if the census shows a population whose
**sole** blocker is M3. Otherwise M4, with 236 TLA first-blocker hits in
`module-code`, has the stronger evidence. The census is in
[dynamic import census](host-esm-dynamic-import-census.md).
