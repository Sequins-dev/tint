# HOST-ESM M2b T7: shared runner fragments and `runNativeModuleTest`

Implementation plan for the [M2b module host](host-esm-test262-module-host.md)
§4.1–§4.2 and test **T7**. It follows the measured
[T1–T2 pins](host-esm-module-host-pins.md). Research only. No source, test,
result, manifest, catalog, queue, marker or snapshot was changed. Nothing was
built, no native binary was run, and no process was touched. The frozen
self-build (PID 26730, `stage1-module-source-v1`, under LLDB) and the paused
direct-eval controller 67383 / child 64325 were left alone.

Evidence comes from read-only Node probes in `/tmp/m2b-t7/` (`probe.ts`–
`probe4.ts`, Node v24.12.0, current `dist`, `TZ` unset) and from
`node --test tools/test262-module-host.test.ts`, which passed 7/7 at
12:16. None of this is a native or conformance claim.

## 0. Tree state: most of this slice has already landed

Main implemented most of the slice while this plan was being researched
(`tools/test262-native.ts` mtime 12:16:30, `test262-module-host.test.ts`
12:15:37). This document therefore **verifies** the code that landed and
specifies only what is still **missing**. It does not re-plan finished work.

| Piece                                                                                       | State                       | Where (current tree)                              |
| ------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------- |
| `runnerSetup` / `runnerHarness(condition)` / `runnerJobs` fragments                         | landed                      | `test262-native.ts:388-458`                       |
| `runNativeScripts` rebuilt from the fragments                                               | landed, byte-identical (§1) | `:725-733`                                        |
| `moduleExecution` trailing parameter (text, runtime, batch)                                 | landed                      | `:377`, `nativeTestRuntime`, `prepareNativeBatch` |
| gated `import {…} from "modules"` as the first line, `["modules", …]` mapping               | landed                      | `:503`, `nativeTestRuntime` map                   |
| `NativeModuleFactory`, `runNativeModuleTest(scripts,names,creates,asynchronous,canSuspend)` | landed                      | `:463-501`                                        |
| per-phase `scriptFaultExit` → `anyUnsupported()` → result, `catch` → fault → 10/69          | landed                      | `:480-499`                                        |
| `NativeModuleEntry {name, module}`, `NativeTestCase.modules?`, module host emission         | landed                      | `:341-350`, `nativeTestHost`                      |
| batch sharing key `[name, module, deps]` for module entries                                 | landed                      | `prepareNativeBatch`                              |
| adapter `native-script-v10-modules`, exits 60–69, optional `fixtures` journal identity      | landed                      | per brief                                         |
| T7 smoke test (`module runner shares the realm protocol…`)                                  | landed (adjacency regexes)  | `test262-module-host.test.ts:196-209`             |
| **preparation closure check** for requests outside the discovered graph                     | **missing** (§3)            | `prepareNativeModuleProgram`                      |
| **T7 hardening**: composition, fragment counts, catch-arm order, loader purity              | **missing** (§4)            | `test262-module-host.test.ts`                     |
| `run.ts` routing, report `scope`, native acceptance fixture                                 | **next slice** (§6, §7)     | —                                                 |

The Script signature, `NativeScript`, `createScriptRecord` and the frame
contract are unchanged. The module runner uses them as they are.

## 1. Byte identity of the fragment split (verified)

`runNativeScripts` is now
`" if(scripts.length===0)throw …\n" + runnerSetup + runnerHarness("index+1<scripts.length") + <test-Script tail> + runnerJobs + "}"`.
The gate-off digests were measured against the current tree:

| `nativeTestRuntimeSource(…)` (gate off)        | chars  | SHA-256                                                              |
| ---------------------------------------------- | ------ | -------------------------------------------------------------------- |
| v9 evaluation, v9 tuple (**T2 pin**)           | 19,322 | `9a544f16fb7a75b06d5883b1a60077fd302dc55e6ac77e5b53f21343486ca564` ✔︎ |
| v8 (`indirectEval`, `functionFallback`), tuple | 19,195 | `fe7cf54f797ffe55b76c1096e0d4ad4f95f1b25afc50a7895122fa30ec01c89f`   |
| v7 (`indirectEval`), tuple                     | 19,101 | `15f08d88347257e2bf87ec085193dab1646363de8eb7700b4f9da4f5322ff43d`   |
| v6 (`evaluation`, `compile` only), tuple       | 18,913 | `efc2827fac8e84a8bb67d099d6aeb2bd30ec3e5b9b458a357ddcbdd2b0b67506`   |
| no evaluation, tuple                           | 15,559 | `9e45bdc671cbe15e04ed38388b8ebe30ef37866977c30611a7f5a0d57e211c47`   |
| no evaluation, all defaults                    | 13,910 | `ce1e7bd16a8f6c0f96e27e443a680ecf5fd38759ebb6c8ec923ce8fd10557f22`   |

- The **v9 row is proven**. It equals the T2 pin recorded before any
  generator edit, and the committed T2 test (batch `dba43513…` included) is
  green.
- The **other five rows are only consistent**. My first probe of them ran
  during main's edit window, and I cannot show that it predates the
  extraction. Both probes give the same values, but that proves only
  stability, not pre-edit equality. To close this, main can diff against
  the pre-edit file from its own history or editor buffer. If that is not
  available, accept the v9 proof: v6–v8 hosts belong to frozen toolchains
  that never run current tools (pins §1.1), so the current text for those
  tuples has no consumer.
- Each fragment is a single `${…}` interpolation inside the original template
  position. An empty `moduleExecution` branch contributes `""` at the head
  (`${moduleExecution ? import : ""}` before the leading `\n`) and at the
  tail (`}${moduleRunner}`). That is why the gate-off text cannot gain a
  byte.

**Gated composition (probe4).** `on = importLine + off + moduleRunner`
exactly: `on.startsWith(importLine + off)` is `true`, and the remainder starts
with `"\ntype NativeModuleFactory="`. So enabling the gate never alters
`runNativeScripts` or `createRealmHost`. Each shared anchor occurs exactly
twice in `on` (once per runner): `installRealmHost(host,realms);\n let
completionCount=0,…`, the harness `NATIVE_HARNESS_ENTRY_INVARIANT` line and
` drainScriptJobs(realm.agent,`. Gated v9 text is 24,961 chars,
`1640a750…773256b`. That value is **informational only**. Do not pin it until
§3 and §4 have settled.

## 2. Review of the landed `runNativeModuleTest`

### 2.1 Phase protocol: correct as written

| Step             | Normal path (inside `try`)                                                      | Synchronous throw (`catch`)                |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------------------------ |
| harness (shared) | `fe`; `unsupported`→10; error→`failure(v,20)`; capture `Test262Error.prototype` | uncaught, same as Scripts                  |
| entry check      | `names.length===0 ‖ creates.length!==names.length` → 69                         | —                                          |
| root `record(0)` | creation allocates cells only (`source.ts:56-90`)                               | `NATIVE_MODULE_ENTRY_INVARIANT`/shape → 69 |
| load             | `fe` → `anyUnsupported()`→10 → `settled`: pending→69, rejected→`failure(e,60)`  | `fe` → `anyUnsupported()?10:69`            |
| link             | `fe` → `anyUnsupported()`→10 → `{ok:false}`→`failure(e,60)`                     | same                                       |
| evaluate         | `fe` → `anyUnsupported()`→10 → pending→69, rejected→`failure(e,30)`             | same                                       |
| jobs (shared)    | `runnerJobs`, unchanged                                                         | uncaught, same as Scripts                  |

This matches every source fact from the parent plan §2.1, checked again in the
current runtime:

- **Loader miss / non-`./` specifier** → `rejectUnsupportedExecution(realm)`
  (`errors.ts:580-583`, returns `never`). The flag is set on the main realm,
  which is in `realms`. `throw undefined` escapes `innerLoading` with no
  catch (`loading.ts:95-96`), so the `catch` arm returns **10**. No JS error
  is fabricated, so a Test262 resolution negative can never "pass" through a
  host gap.
- **TLA preflight** (`evaluation.ts:23-28`) → synchronous throw with the flag
  set → **10**.
- **Body `"unsupported"` completion** → caught by `innerEvaluation`
  (`evaluation.ts:63-75`). The promise rejects with `undefined`. The
  per-phase `anyUnsupported()` runs **before** `settledModulePromise` → **10**.
  The sticky flag is the only authority. The rejected value is never read.
- **`executionFault`** (`source.ts:118-124`) → rethrown string
  `"MODULE_COMPLETION_INVARIANT"` (`evaluation.ts:71-73`) → **69**, unless a
  sticky Script fault (13–17) or the unsupported flag is already set. That
  precedence is the existing Script one (`fe` before `unsupported`,
  `runNativeScripts` tail). It is reused here, not invented.
- **Identity**: `records` is keyed by entry name, the root is `names[0]`, so a
  root self-import and a fixture self-import return the same record.
  `finishLoadingImportedModule`'s `MODULE_LOAD_IDENTITY_INVARIANT`
  (`loading.ts:154-158`) cannot fire. If it does, it is a host bug → 69.
- **Resolution negatives never execute bodies**: only `evaluateModule` runs
  `execute`. Link and load failures return first.

### 2.2 Residual risks in the landed text

1. **Native checker constructs not yet proven by a native build.** The
   gated text so far has only been parsed (`parsedNativeHost`, probe3 batch).
   Tint's checker has not seen it. Constructs that have a natively compiled
   precedent:
   - `new Map<string,…>()`: runtime text, `scriptRuntimeTexts` loop.
   - `.startsWith`/`.slice`: `print`.
   - `catch(error)`: `evaluation.ts:69`.
   - `never` narrowing after `rejectUnsupportedExecution`: `loading.ts:95-96`.
   - the `moduleLoader` arrow type: `verify-hosted-module-lowering.ts:77`.
   - `!x.ok` discriminant narrowing: `loading.ts:61`.

   **No precedent was found** for `Array.prototype.indexOf` on a
   `readonly string[]` in natively compiled code. If the acceptance build
   rejects it, replace it in place with
   `let index=-1;for(let i=0;i<names.length;i++){if(names[i]===name)index=i;}`.
   No other change is needed. Do not pre-emptively change it. The build is
   the authority.

2. **`catch(error)` binding is unused.** If the checker or linter rejects
   unused catch bindings, use `catch{}` (precedent:
   `objects/weak-collections.ts:136`).
3. **Requests outside the discovered graph reach native execution.** This is
   real (probe3): `prepareNativeModuleProgram` returns `ok: true`, with the
   root as the only entry, for `import {x} from "./missing.js"` and for
   `import "./sub/x.js"`. The runtime then exits 10 with the generic reason
   "native runtime reached an unsupported operation". That is **safe**: it is
   never a pass and never a JS outcome. But it costs a native process and
   loses the reason. §3 closes this at preparation time and keeps the runtime
   miss as a defensive check.

## 3. Closure check in `prepareNativeModuleProgram` (to add)

**Decision.** Do the closure check at preparation time **and** keep the
loader miss. Specifiers resolve directory-relative and flat:
`discoverModuleGraph` admits only `./name` with no `/` or `\` that names an
existing sibling (`test262-module-graph.ts:36-48`). The pinned
`INTERPRETING.md` puts every Test262 module in the test's directory. A
request outside the discovered set is therefore a host gap and never a
JavaScript resolution error. No Test262 test depends on a missing module,
which is host-defined. It becomes `unsupported` with a precise reason.

Edit `lower` so that it also returns the request specifiers it already
screens:

```ts
return {
  ok: true,
  module: {/* unchanged */},
  requests: parsed.value.imports.map((declaration) => declaration.specifier),
};
```

Type-only and phase imports never reach this point, because lowering fails
first through `sourceModuleShape` (`module-shape.ts:43-53`). Attribute
requests were screened earlier. `parsed.value.imports` is the list that
`sourceModuleShape` turns into `requests`, so the loader sees exactly these
specifiers. Collect `requests` for the root and for each lowered node. After
the node loop, before `return { ok: true, … }`:

```ts
const known = new Set(entries.map((entry) => "./" + entry.name));
for (const specifier of requested)
  if (!known.has(specifier))
    return unsupported(
      "module request outside the discovered fixture graph: " + specifier,
    );
```

- The root self-import resolves, because `entries[0].name === graph.root`.
- Return the **first** offending specifier in deterministic order: the
  root's requests first, then nodes in `graph.nodes` (sorted) order, each in
  source order.
- The returned `entries`, `fixtures` and `harness` are unchanged for every
  program that passes. Journal identity and batch bytes do not move.
- The runtime loader keeps `startsWith("./")`/`indexOf` → unsupported. It
  is now unreachable from prepared programs and is still reachable from
  hand-built cases (§5, case 4).

## 4. T7 tests to add (red first where possible)

Put these in `tools/test262-module-host.test.ts`, next to main's T7 smoke
test, and keep that test. Shared helpers: `evaluation`/`v9` from T2;
`off = nativeTestRuntimeSource(evaluation, ...v9)`;
`on = nativeTestRuntimeSource(evaluation, ...v9, true)`;
`importLine = on.slice(0, on.indexOf("\n"))`;
`runner = on.slice(importLine.length + off.length)`;
`F = "{const fe=scriptFaultExit();if(fe!==0)return fe;}"`;
`U = "if(anyUnsupported())return 10;"`.

**T7a: the gate only appends.**

```ts
assert.ok(on.startsWith(importLine + off));
assert.match(importLine, /^import \{.*\} from "modules";$/);
assert.ok(runner.startsWith("\ntype NativeModuleFactory="));
assert.equal(runner.split("export function runNativeModuleTest(").length, 2);
assert.ok(!off.includes("runNativeModuleTest") && !off.includes('"modules"'));
```

This is green on arrival, because it characterizes code that already
landed. To show it can fail, use a scratch-only mutation of
`createRealmHost` under `moduleExecution` (not committed); the `startsWith`
assertion fails. Record the log under `.tint-bootstrap/`.

**T7b: one realm protocol, not a parallel host.** For each anchor in
`[" installRealmHost(host,realms);\n let completionCount=0,completion=11,jobFailure=0;", 'const script=scripts[index];if(script===undefined)throw "NATIVE_HARNESS_ENTRY_INVARIANT";', " drainScriptJobs(realm.agent,"]`:
`assert.equal(on.split(a).length - 1, 2)` and
`assert.equal(runner.split(a).length - 1, 1)`. Also assert
`runner.includes(" for(let index=0;index<scripts.length;index++){")`. The
module harness runs **every** Script; the Script runner stops one before the
end.

**T7c: phase guards, ordered.** For each `[call, result]` in
`[["loadRequestedModules(root","settledModulePromise(loading"],["linkModule(root)","if(!linked.ok)"],["evaluateModule(root","settledModulePromise(evaluation"]]`:

```ts
const tail = runner.slice(runner.indexOf(call));
const f = tail.indexOf(F),
  u = tail.indexOf(U),
  r = tail.indexOf(result);
assert.ok(0 < f && f < u && u < r, call);
const between = tail.slice(u + U.length, r);
for (const banned of ["failure(", "settledModulePromise(", "return"])
  assert.ok(!between.includes(banned), call + ": " + banned);
```

The `between` check ensures that nothing reads a settled value or returns
between the guard and the result. Also assert call order:
`indexOf(load) < indexOf(link) < indexOf(evaluate) < indexOf(" drainScriptJobs")`.
The harness anchor must precede `realm.moduleLoader=`, because the harness
runs before any record exists.

**T7d: catch-arm order.** Let `c = runner.slice(runner.indexOf("}catch("))`.
Assert that `c.indexOf("const fe=scriptFaultExit();if(fe!==0)return fe;")`
is before `c.indexOf("return anyUnsupported()?10:69;")`, and that the `catch`
arm contains no `failure(`. A synchronous throw must never become a JS
outcome.

**T7e: loader purity.** Let
`l = runner.slice(runner.indexOf("realm.moduleLoader="), runner.indexOf("const loading="))`.
Then:

```ts
assert.equal(l.split("rejectUnsupportedExecution(realm)").length - 1, 2);
for (const banned of ["createRuntimeError", "ok:false", "failure("])
  assert.ok(!l.includes(banned), banned);
assert.match(l, /\{ok:true,module:record\(index\)\}/);
```

**T7f: closure check (red first, §3).** Use the injected `discover`, as in
`test262-module-preparation.test.ts`. Use a `raw` module plan, so no harness
is needed:
`executionPlan(src, "module", {flags:["module","raw"],features:[],includes:[]})`.

| Root source                                                         | Graph nodes                        | Expected                                                                           |
| ------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| `import {x} from "./missing.js";`                                   | none                               | `unsupported("module request outside the discovered fixture graph: ./missing.js")` |
| `import "./sub/x.js";`                                              | none                               | same reason, `./sub/x.js`                                                          |
| `import {v} from "./a_FIXTURE.js"; import * as self from "./t.js";` | `a_FIXTURE.js` (`export var v=1;`) | `ok: true`, entries `["t.js","a_FIXTURE.js"]`                                      |
| root `import "./a_FIXTURE.js";`, fixture `import "./gone.js";`      | `a_FIXTURE.js`                     | reason names `./gone.js`                                                           |

**Expected red today (probe3):** the first two rows return
`{ok:true, entries:["t.js"]}`. Rows 3–4 also lock that the check reads
fixture requests and accepts self-imports.

**T7g: batch handoff, gate-on (Node only).** Build
`prepareNativeBatch([scriptCaseA, moduleCase], ...v9, evaluation, true)`, where
`moduleCase = {scripts: prepared.harness, modules: prepared.entries, asynchronous: false}`
comes from row 3. Assert that the batch parses (construction succeeding is
the parse proof). Assert that `test262-runtime`'s dependency map has
`modules` → `packages/js-runtime/src/modules/index.ts`. Assert that
`test262-case-1-host` imports `create` from each module id and calls
`runNativeModuleTest([…],["t.js","a_FIXTURE.js"],[module0,module1],false,true)`.
Assert that the Script case's host text equals the text produced by a
gate-off batch of that case alone. Finally, assert that
`prepareNativeBatch([moduleCase], ...v9, evaluation)` throws
`/module case requires the module host capability/`.

Then run `pnpm check`. There should be no catalog or manifest change, and
managed-surface stays at 128. The prior gate was 4,227 tests. The expected
new total is that plus the T7 tests added (5–7, depending on how they are
grouped).

## 5. Native acceptance fixture (outline, next slice)

`tools/verify-hosted-module-host.ts` follows the M2a pattern
(`verify-hosted-module-lowering.ts`): one gated batch, serial cases under
LLDB, with pre-entry failures recorded separately. It writes
`docs/results/module-host-native-validation-v1.json`. Build cases from
temp-directory graphs through `prepareNativeModuleProgram`, using real
`discoverModuleGraph`. The harness is two tiny inline Scripts: a
`Test262Error` constructor and `$DONOTEVALUATE`, which throws a string.

| #   | Case                                                                                        | Proves                                                       | Exit |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---- |
| 0   | v9 **Script** case `42;` in the same batch                                                  | mixed batch; gated runtime leaves Scripts alone              | 42   |
| 1   | root self-import + fixture re-export; root asserts `self.v === fixture.v`                   | record identity, load/link/evaluate, jobs                    | 42   |
| 2   | root `$DONOTEVALUATE(); import {nope} from "./a_FIXTURE.js";` (fixture exports `v`)         | link SyntaxError is resolution (would be 30 if the body ran) | 63   |
| 3   | root `throw new TypeError();`                                                               | body rejection → runtime base                                | 31   |
| 4   | **hand-built** case: root imports `./a_FIXTURE.js` but `modules` omits it                   | loader miss → sticky unsupported, never JS error             | 10   |
| 5   | `asynchronous: true`; root `Promise.resolve().then(()=>print("Test262:AsyncTestComplete"))` | shared `print`/`$DONE` path and drain after evaluate         | 42   |
| 6   | harness Script `throw new RangeError();`, any module root                                   | shared harness fragment, records never created               | 24   |

Admission rule: every case must give its expected exit. Any 69 or
`unexpected native exit status` blocks Test262 wiring. A checker rejection
of a §2.2 construct gets the in-place fallback and a rebuild, and nothing
else. **Blocked** until the frozen self-build (PID 26730) has finished. Never
run it concurrently with that build or with the direct-eval runner, and do
not touch their markers or snapshots.

## 6. What stays out of this slice

- `tools/test262-native-run.ts` routing (gate computed once next to `engine`,
  `variant === "module"` → `prepareNativeModuleProgram`, `fixtures` into the
  observation, report `scope` sentence), and updating the
  `test262-script-service.test.ts:213-217` `engine =` regex in the same
  commit. Both belong with the acceptance slice, after case §5 passes.
- No Test262 selection is enabled. The first selection is still
  `language/module-code/eval-this.js` (parent §7 step 3).
- No change to Script lowering, the frame, `NativeScript`, exits 10–59, or
  the v9 adapter.
- The batch key keeps `name`. Templates are now per record (factory-local
  sites), so the name is no longer **needed** for template identity. It
  still only reduces sharing and is never wrong. Changing it would move the
  gated batch bytes for no behavioral gain.

## 7. Edit list (in order)

1. Add T7f (red), then the §3 closure check (green). Run
   `tools/test262-module-preparation.test.ts` and
   `tools/test262-module-host.test.ts`.
2. Add T7a–T7e and T7g. They are green on arrival, so record the
   scratch-mutation red for T7a.
3. Re-run the §1 digest probe. The v9 text must still be `9a544f16…`, and the
   batch `dba43513…`.
4. Run `pnpm check` (tests, lint, typecheck).
5. Hand off to the acceptance slice (§5 + §6). Do not edit `run.ts`
   here.

## 8. Evidence and limits

- Probes: `probe.ts` (six gate-off digests); `probe2.ts` (gate-on before the
  runner landed: `on = import + off`, runner absent); `probe3.ts` (closure
  gap; gated batch parses; gated digest); `probe4.ts` (composition, anchor
  counts, per-phase `fe`).
- Pre-extraction equality is proven only for v9 (§1).
- Native checker acceptance of the gated runtime is **unproven** until §5.
  The list in §2.2 is a risk list, not a result.
- The tree was moving during research. Re-read
  `test262-native.ts:388-501` before editing, and re-measure if it has
  changed.

## 9. Next focused planning task

Plan the **native module host acceptance slice** only: the exact §5 fixture
script (temp-graph builder, inline harness, LLDB serial driver, result
schema), the `run.ts` routing diff with its script-service regex update, and
the single-file `eval-this.js` selection with its unchanged-guard rerun
(parent §7 steps 1–3). Do not widen to graph or full selections.
