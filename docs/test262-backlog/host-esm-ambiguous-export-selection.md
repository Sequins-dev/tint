# HOST-ESM M2b: first graph selection, `language/module-code/ambiguous-export-bindings`

This is the implementation plan for the first module selection that has a
fixture graph. It follows [routing](host-esm-module-host-routing.md) §8. It
covers four things: a Node census of the selection with pinned fixture
identity, a Node-only journal resume drill, the native run with its blocking
rules, and the decision on whether a source fix is needed first (it is not,
see §4).

This is research only. No source, test, catalog, manifest, result, dashboard,
marker or snapshot was changed. Nothing was built and no native binary was
run. Three read-only Node probes ran from `/tmp/m2b-ambig/`. They imported the
**frozen** toolchain `.tint-bootstrap/node-toolchain-module-host-v1/tools/*`
and `source-snapshot.json`, and read the pinned checkout
`.tint-bootstrap/test262` (revision `91c70759…5ba`, `dirty: false`, Node
v24.12.0):

- `census.ts`: route, preparation and graph for every variant.
- `batch.ts`: `prepareNativeBatch` module lists, with no compile.
- `node24/`: a **copy** of the directory, run by Node 24 for information only.

Controller 67383, its child 64325, the G0–G2 controller
`.tint-bootstrap/run-first-module-selections-v1.mjs` and the DirectEval pause
files were not touched. Their state was read once, from files.

**Implementation result:** G1/G2 both pass. The frozen census and all
[resume controls](../results/module-ambiguous-export-resume-controls-v1.json)
pass, including rejection of changed in-graph fixtures for unsupported outcomes.
The [complete native selection](../results/test262-module-ambiguous-export-bindings-native-v1.json)
passes 9/10 with one unsupported source-phase import, no failures, crashes or
timeouts. [Acceptance checks](../results/test262-module-ambiguous-export-bindings-acceptance-v1.json)
report no deviations. The [namespace selection](../results/test262-module-namespace-native-v1.json) also passes 38/38.

## 0. State at planning time (files only, no forecast)

| Item                                              | State                                                                                                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routing (M2b) in the tree and in the frozen tools | landed. `tools/test262-native{,-run}.ts`, `test262-module-graph.ts` and `native-run-journal.ts` are byte-equal to the frozen copies                                               |
| Frozen toolchain                                  | `docs/results/frozen-node-toolchain-module-host-v1.json`. The snapshot is `2c72f4c9…810c`, 562 files. The reports carry `frozenToolchainSha256 c8838a92…4223` (the manifest hash) |
| G0 (gate off, `eval-this.js`)                     | recorded: `unsupported 1`, `docs/results/test262-module-eval-this-gate-off-v1.json`                                                                                               |
| G1 (Script guard) and G2 (gate-on `eval-this.js`) | **not recorded**. There is no `docs/results/test262-module-host-script-guard-v1.json` and no `…-eval-this-native-v1.json`                                                         |

Everything from §3 on waits for both G1 and G2 to be recorded as successes
(§3.1). This plan makes no assumption about how they turn out.

## 1. Node census (frozen tools, pinned checkout)

Selection: `language/module-code/ambiguous-export-bindings`. It has **10 test
files**, each with `flags: [module]`, so there are **exactly 10 variants**, all
`module`. The routing plan's "10 module variants" is confirmed. The harness
for every variant is `assert.js 206e274c…ed48` and `sta.js 1930c54a…3f35`.
None includes a file, none is async, and every variant has `canSuspend: true`.

Column key:

- "Neg" is `negative.phase`/`type`: `res/SE` means `resolution`/`SyntaxError`.
- "On" and "Off" are `nativeVariantRoute(…, true)` and `(…, false)`.
- "Prep" is the result of `prepareNativeModuleProgram`.
- "Fixtures" is the non-root graph, sorted, with the first 12 hex digits of
  each hash.

| #   | Test (`sha256`)                                                                                | Neg    | On/Off        | Prep                               | Fixtures (`name@sha`)                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------- | ------ | ------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `error-export-from-named-as.js` `c452c5a92118`                                                 | res/SE | module/script | ok, 4 entries                      | `error-export-from-named-1_FIXTURE.js@9aa5fa497acf`, `-2_FIXTURE.js@9aa5fa497acf`, `error-export-from-named_FIXTURE.js@345c8dd84312`                                                                                                                                                  |
| 2   | `error-export-from-named.js` `84dd88f3b876`                                                    | res/SE | module/script | ok, 4                              | same 3 as #1                                                                                                                                                                                                                                                                          |
| 3   | `error-import-named-as.js` `d11b12e97e19`                                                      | res/SE | module/script | ok, 4                              | `error-import-named-1_FIXTURE.js@9aa5fa497acf`, `-2_FIXTURE.js@9aa5fa497acf`, `error-import-named_FIXTURE.js@d11dfe21d5ae`                                                                                                                                                            |
| 4   | `error-import-named.js` `bc41cd042f5c`                                                         | res/SE | module/script | ok, 4                              | same 3 as #3                                                                                                                                                                                                                                                                          |
| 5   | `import-and-export-propagates-binding.js` `44d8ad8add93`                                       | none   | module/script | ok, 4 (self-import)                | `…_FIXTURE.js@f8c69435a315`, `…_export-from_FIXTURE.js@7d98214a7ae5`, `…_import-and-export_FIXTURE.js@b20ec8a71f43`                                                                                                                                                                   |
| 6   | `namespace-unambiguous-if-export-star-as-from-and-import-star-as-and-export.js` `f5782faf9546` | none   | module/script | ok, 6                              | `namespace-empty-module_FIXTURE.js@425ff42d9eaa`, `namespace-export-star-as-from-1_FIXTURE.js@c5a114cec1e8`, `namespace-import-star-as-and-export-1_FIXTURE.js@f559c4093e87`, `…-2_FIXTURE.js@f559c4093e87`, **`namespace-unambiguous-if-import-star-as-and-export.js@4d8292c64d37`** |
| 7   | `namespace-unambiguous-if-export-star-as-from.js` `6aa45c19ae57`                               | none   | module/script | ok, 4 (self-import)                | `namespace-empty-module_FIXTURE.js@425ff42d9eaa`, `namespace-export-star-as-from-1_FIXTURE.js@c5a114cec1e8`, `-2_FIXTURE.js@c5a114cec1e8`                                                                                                                                             |
| 8   | `namespace-unambiguous-if-import-source-and-export.js` `262a7f1476e6`                          | none   | module/script | **unsupported** (fixture lowering) | `namespace-import-source-and-export-1_FIXTURE.js@56a9c112c00e`, `-2_FIXTURE.js@56a9c112c00e`, `-reexport_FIXTURE.js@dae6a5e4580e`                                                                                                                                                     |
| 9   | `namespace-unambiguous-if-import-star-as-and-export.js` `4d8292c64d37`                         | none   | module/script | ok, 4 (self-import)                | `namespace-empty-module_FIXTURE.js@425ff42d9eaa`, `namespace-import-star-as-and-export-1_FIXTURE.js@f559c4093e87`, `-2_FIXTURE.js@f559c4093e87`                                                                                                                                       |
| 10  | `omitted-from-namespace.js` `47239d1ac289`                                                     | none   | module/script | ok, 4                              | `omitted-from-namespace-1_FIXTURE.js@da063d7cea6c`, `-2_FIXTURE.js@865336830a52`, `omitted-from-namespace_FIXTURE.js@dfdb499dcded`                                                                                                                                                    |

Exact reason for #8, verbatim:
`namespace-import-source-and-export-1_FIXTURE.js: {"start":128,"end":169,"message":"import phases require their proposal slice","code":"UNSUPPORTED"}`.
That fixture **parsed** during discovery (`parsed: true`) and then failed in
lowering, so the reason is not the M2c re-parse reason. `fixtures` is present
and lists all three nodes, including the `-2` and `-reexport` nodes that were
never reached. That is routing D4, verified in this checkout. The test also
carries `features: [source-phase-imports, source-phase-imports-module-source]`.
The runner has no feature filter, so it stays in the denominator as
`unsupported`.

Facts the census establishes:

- **No throw.** No thrown preparation and no `parsed: false` node. All 9
  prepared graphs pass the closure check.
- **Self-imports.** #5, #7 and #9 import themselves. Discovery lists the root
  as a graph node, `node.name !== graph.root` excludes it from `fixtures`, and
  `known` contains `./<root>`. The root's own hash is already in `sha256`.
- **#6 imports a sibling _test_, not itself.** Its `import { foo }` names
  `./namespace-unambiguous-if-import-star-as-and-export.js` (test #9), and
  that test's bytes are pinned as a fixture of #6. As a dependency, #9's body
  runs its own `assert.sameValue`. #6's own star exports are never resolved,
  because nothing imports `foo` from #6. So #6 exercises exactly what #9
  exercises. This is an upstream test quirk: record it, do not patch it.
- **Identical bytes, distinct records.** `-1`/`-2` fixtures with identical
  bytes (#1–#4, #6, #7, #9) must stay distinct Module Records, or the
  ambiguity disappears. `prepareNativeBatch` keys shared code by
  `[name, module, deps]`, so they stay distinct (§1.2).
- **Gate off.** All 10 route to `script` and are rejected as
  `native module execution is not implemented`, with no `fixtures`.

### 1.1 Expected outcomes are taken from the spec, not from Node

The tint shape and runtime follow the current ECMA-262 text that each test
quotes:

- `module-shape.ts` lowers `import * as foo; export { foo }` and
  `export * as foo from` alike, to an indirect entry with
  `importName: undefined`.
- `resolve.ts:75-76,91-95` resolves both to `{ module: empty, bindingName:
undefined }`, and two star results compare equal.
- `linking.ts:38-43` rejects an ambiguous or null indirect export before any
  import binding.
- `namespace.ts:43-46` skips ambiguous names.

So the Node-side expectation is: #1–#4 `error/resolution/SyntaxError` (exit
63), and #5, #6, #7, #9, #10 `completed`.

**Node 24.12 (V8) differs, and is not an oracle.** On a `/tmp` copy, with
`assert.js` and `sta.js` installed as globals:

| Test       | Node 24.12                                                                    | Spec (and tint expectation)                                     |
| ---------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| #1–#4      | `SyntaxError … conflicting star exports for name 'x'`                         | resolution SyntaxError: same                                    |
| #5, #10    | completes                                                                     | completes: same                                                 |
| #6, #7, #9 | **`SyntaxError … conflicting star exports for name 'foo'`**                   | **unambiguous**: two namespace re-exports of one module         |
| #8         | `ERR_MODULE_NOT_FOUND '<module source>'` (Node has no Test262 host specifier) | not comparable; tint reports `unsupported` before any host step |

A tint `SyntaxError` on #6, #7 or #9 therefore **fails**, even though it
matches Node. A tint pass on those three is not suspicious.

### 1.2 Batch composition (Node only, no compile)

The runner flushes before recording an unsupported variant, so batch
membership is fixed for a batch size of 64:

- **Batch 0** has 7 execution variants (#1–#7). `prepareNativeBatch` emits
  33 modules: 24 shared, 7 hosts, the runtime and the selector.
- **#8** has no batch.
- **Batch 1** has 2 variants (#9, #10) and emits 14 modules (10 shared).

The 24 shared modules are 2 harness, 7 roots and 15 distinct fixtures. Both
`error-*-1/-2` pairs are counted separately, so equal bytes under different
names were not merged. `namespace-empty-module_FIXTURE.js` and #9 (inside
#6's graph) are shared across cases in batch 0. That is sound because each
case runs in its own process (`image.run(index)`).

## 2. Native unknowns (none established by this plan)

The 7 accepted cases do not cover these, so N1 (§3.3) is their first
observation:

1. **Root self-import.** The root re-enters itself while `linking`. That is a
   one-node cycle; acceptance covered a two-module cycle.
2. **Indirect-export ambiguity at link** (#1, #2: `export { x } from`). It is
   unknown whether acceptance case 2 went through `indirectExports` or
   `imports`.
3. **Record identity per loader name**, for byte-identical fixtures (#1–#4).
4. **Namespace re-export equality.** Both sides have `bindingName ===
undefined` (#6, #7, #9).
5. **Namespace objects.** `GetModuleNamespace` omits the ambiguous `both`,
   and `in` on a namespace object works (#10).
6. **A sibling test body evaluated as a dependency** (#6).
7. **The size of batch 0** (33 modules, 7 hosts). Its compile time and
   success are unknown. No performance work is in scope.
8. **`$DONOTEVALUATE()` not being reached** in #1–#4. If it is reached, the
   outcome is a runtime `Test262Error` (exit 38) → `fail`.

## 3. Commands (main executes, strictly serial)

### 3.1 Preconditions (checked from files once, after the controller exits)

1. `.tint-bootstrap/first-module-selections-v1.mjs` has exited. Its log
   contains the `G1 …` and `G2 …` lines. These records exist, and each has
   `result: {code: 0, signal: null}`:
   - `docs/results/test262-module-host-script-guard-controller-v1.json`
   - `docs/results/test262-module-eval-this-native-controller-v1.json`
   - `docs/results/test262-module-host-script-guard-v1.json`
   - `docs/results/test262-module-eval-this-native-v1.json`

   G2's single observation is `pass` and its batch is `compiled`.

   **Any other state blocks this whole plan.** That includes a missing file, a
   failed assertion, `code ≠ 0`, or a debugger launch failure. There is no
   rerun.

2. `workspaceSourceIdentity(workspaceSources())` is still `2c72f4c9…810c`
   with 562 files, and `git -C .tint-bootstrap/test262 rev-parse HEAD` is
   `91c70759…`, clean.
3. No step here starts while the G0–G2 controller holds
   `.tint-bootstrap/direct-eval-conformance.pause`. N1 acquires that pause
   itself (§3.3). No step signals 67383 or 64325.

Common environment, the same mode as the first selection (do not copy it into
a global shell; pass it per process):

```sh
T=.tint-bootstrap/node-toolchain-module-host-v1
ENV="TINT_TEST262_SOURCES=$T/source-snapshot.json TINT_TEST262_DEBUGGER_LAUNCH=debugserver-direct TINT_TEST262_DEBUGGER_TRACE=1 TINT_TEST262_CONTAINMENT_MS=300000"
# never set: TINT_TEST262_RESUME (except drill S3–S6), TINT_TEST262_CAPTURE_SOURCES
```

### 3.2 Node-only phase: census pin, gate-off control, resume drill

These steps never build an image or launch a debugger. The report's
`compilation.batches` must be `[]` for every run in this phase. They may run
while native conformance is active.

**P1: census pin.** Write `.tint-bootstrap/census-ambiguous-export-v1.mjs`.
It is the `/tmp/m2b-ambig/census.ts` loop. It imports only from `$T/tools`
and reads `$T/source-snapshot.json`. For each variant it emits
`{path, sha256, variant, negative, route: {on, off}, preparation: "ok" | {reason}, fixtures}`
with full hashes. The script must:

- assert the totals: 10 variants, 9 `ok`, 1 unsupported (#8, with the exact
  reason), no throw;
- assert that every `ok` graph has only `parsed: true` nodes;
- write `docs/results/module-ambiguous-export-census-node-v1.json` (`wx`).

The script never compares against Node 24.

**P2: gate-off control (pinned checkout).**

```sh
set -o noclobber; mkdir .tint-bootstrap/module-ambiguous-export-v1   # must not exist
O=.tint-bootstrap/module-ambiguous-export-v1
env $ENV TINT_TEST262_JOURNAL=$O/p2-gate-off.jsonl \
  node $T/tools/test262-native-run.ts .tint-bootstrap/test262 \
  language/module-code/ambiguous-export-bindings 64 > $O/p2-gate-off.json 2> $O/p2-gate-off.log
```

The report must equal: adapter `native-script-v9-direct-eval`, 10
observations in census order, each `unsupported` with the reason
`native module execution is not implemented` and **no** `fixtures`, `batches:
[]`, and a scope byte-equal to the G0 scope.

**P3: resume drill (scratch copy, never the pinned checkout).** This proves
three things:

- a changed in-graph fixture rejects a restored prefix, including a fixture
  that is not the failing node;
- a change outside the graph does not;
- gated and ungated journals do not cross.

It uses #8, which is unsupported **because of a fixture**, so every run stays
Node-only.

```sh
C=.tint-bootstrap/test262-ambiguous-resume-drill-v1          # must not exist
S=language/module-code/ambiguous-export-bindings/namespace-unambiguous-if-import-source-and-export.js
F=$C/test/language/module-code/ambiguous-export-bindings
J=$O/drill.jsonl
cp -cR .tint-bootstrap/test262 "$C"                            # APFS clone; source untouched
test "$(git -C $C rev-parse HEAD)" = 91c70759363c46557b694792bf34a2551a7af5ba
test -z "$(git -C $C status --porcelain --untracked-files=no)"
printf '\n' >> "$C/README.md"          # dirty=true for every drill run → identical headers
R="node $T/tools/test262-native-run.ts $C $S 64"
env $ENV TINT_TEST262_MODULES=1 TINT_TEST262_JOURNAL=$J $R > $O/s2.json 2> $O/s2.log
shasum -a 256 $J > $O/drill.jsonl.sha256
env $ENV TINT_TEST262_MODULES=1 TINT_TEST262_RESUME=1 TINT_TEST262_JOURNAL=$J $R > $O/s3.json 2> $O/s3.log
printf '\n' >> "$F/namespace-empty-module_FIXTURE.js"      # outside #8's graph
env $ENV TINT_TEST262_MODULES=1 TINT_TEST262_RESUME=1 TINT_TEST262_JOURNAL=$J $R > $O/s4.json 2> $O/s4.log
printf '\n' >> "$F/namespace-import-source-and-export-2_FIXTURE.js"   # in graph, not the failing node
env $ENV TINT_TEST262_MODULES=1 TINT_TEST262_RESUME=1 TINT_TEST262_JOURNAL=$J $R > $O/s5.json 2> $O/s5.log; echo $? > $O/s5.exit
env $ENV TINT_TEST262_RESUME=1 TINT_TEST262_JOURNAL=$J $R > $O/s6.json 2> $O/s6.log; echo $? > $O/s6.exit
shasum -a 256 -c $O/drill.jsonl.sha256
```

Run S5 and S6 with `set +e` and every other step with `set -e`. Why a
completed journal works here: a resume over a sealed journal compares every
prior input (`run.ts:247-258`) **before** `checkpoint.complete` is
consulted, and appends nothing (`native-run-journal.ts:191,69`). The drill
therefore verifies identity read-only, with no interruption and no killed
process.

| Step | Must equal                                                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S2   | exit 0; adapter `native-script-v10-modules`; `dirty: true`; 1 observation, `unsupported` with #8's exact reason; `fixtures` deep-equal to the P1 pin for #8 (3 entries); `batches: []`; the journal ends in `complete` |
| S3   | exit 0; `resumption.restoredVariants: 1`; `events: []` (the journal was complete); observations deep-equal to S2                                                                                                       |
| S4   | exit 0, the same as S3 (the change is outside the graph, so it is not in identity)                                                                                                                                     |
| S5   | exit ≠ 0; stderr contains `native resume source/harness prefix differs at language/module-code/ambiguous-export-bindings/namespace-unambiguous-if-import-source-and-export.js [module]`; `s5.json` is empty            |
| S6   | exit ≠ 0; stderr contains `native journal resume identity differs` (the engine is v9 against v10)                                                                                                                      |
| end  | the journal sha256 is unchanged from after S2                                                                                                                                                                          |

A drill result that differs from this table **blocks N1**. Do not rerun the
drill to clear it. Leave `$C` in place as evidence and use `-v2` names for
any new attempt. The drill copy is never used for conformance.

### 3.3 Native phase: N1, one run, under the same DirectEval handshake

Write `.tint-bootstrap/run-ambiguous-export-selection-v1.mjs`. Copy the
module-level checks and `run()` of `run-first-module-selections-v1.mjs`
**unchanged**:

- the fixed-point and acceptance asserts;
- the `sourceSnapshot` equality;
- the `wx` report, log and controller record;
- `delete env.TINT_TEST262_RESUME` and `CAPTURE_SOURCES`;
- `TINT_TEST262_PAUSE=.tint-bootstrap/module-host-conformance.pause`.

Then make these changes:

- Do **not** call `freezeNodeToolchain`. Read `toolchain` from
  `docs/results/frozen-node-toolchain-module-host-v1.json` and assert that
  `$T/toolchain.json` still verifies. The runner's `frozenNativeRunIdentity`
  checks the files again on start.
- Before anything else, assert that all P1–P3 artifacts exist and satisfy
  §3.2.
- Acquire the handshake exactly as G1/G2 did:
  1. wait until neither `direct-eval-conformance.pause` nor `.ack` exists;
  2. write the pause with `wx`;
  3. wait up to 600 s for `.ack` with `state: "between-variants"`;
  4. run;
  5. `rmSync(pause)` in `finally`.

  Never write or delete the `.ack`.

- Make one call:
  `run('language/module-code/ambiguous-export-bindings','module-ambiguous-export-bindings',true,64)`.
  It writes `.tint-bootstrap/test262-module-ambiguous-export-bindings-v1.{json,jsonl,log}`
  and `docs/results/test262-module-ambiguous-export-bindings-controller-v1.json`.

**Structural assertions.** These decide whether the evidence is valid. If one
fails, nothing is copied to `docs/results`:

- adapter `native-script-v10-modules`; the scope equals G2's scope;
  `revision 91c70759…`, `dirty: false`; `sourceSnapshot` and
  `frozenToolchainSha256` equal G2's;
- 10 observations in census order. `path`, `sha256`, `variant`, `harness` and
  `fixtures` deep-equal the P1 pin. **Every observation has a non-empty
  `fixtures`.**
- batches are exactly `[{id 0, variants 7, kind execution}, {id 1, variants
2, kind execution}]`. #1–#7 carry `batch: 0`, #9 and #10 carry `batch: 1`,
  and #8 has no `batch`;
- #8 is `unsupported` with the exact P1 reason;
- the journal ends in `complete`, and the report has
  `resumption.restoredVariants: 0`.

When all of these hold, copy the report to
`docs/results/test262-module-ambiguous-export-bindings-native-v1.json` with
`COPYFILE_EXCL`. Copy it whatever the statuses are: it is the observation.

**Acceptance (spec-derived).** These decide whether widening may proceed:

| Variant             | Required outcome → status                                  |
| ------------------- | ---------------------------------------------------------- |
| #1–#4               | `error`, `phase: resolution`, `type: SyntaxError` → `pass` |
| #5, #6, #7, #9, #10 | `completed` → `pass`                                       |
| #8                  | `unsupported` (preparation) → `unsupported`                |

Expected totals: `total 10, passed 9, unsupported 1`. The controller writes
`accepted: true|false` and a per-variant `deviation` list into a separate
`docs/results/test262-module-ambiguous-export-bindings-acceptance-v1.json`
(`wx`). It exits nonzero when `accepted` is false.

### 3.4 Blocking rules (no automatic retry, no resume by default)

- **Structural failure blocks** (§3.3). That includes a missing `fixtures`, a
  batch layout other than 7 + 2, a reason other than the exact P1 string, or
  an identity mismatch. The report stays in `.tint-bootstrap` only. Diagnose
  from the journal and the log.
- **A resolution-negative `pass` is valid only with fixtures.** If any of
  #1–#4 is `pass` while `fixtures` is absent, or while its P1 graph has an
  unparsed node, treat it as structural. It would mean resolution was judged
  without graph identity.
- **A resolution negative that runs its body** (`$DONOTEVALUATE` reached:
  runtime `Test262Error`, exit 38) or that fails at `harness`/`runtime` phase
  blocks widening. That is unknown 2, a link-validation gap.
- **#6, #7 or #9 ending in a resolution `SyntaxError` fails.** It matches
  Node 24, but the spec says these bindings are unambiguous. Do not
  reclassify it, and do not cite Node as justification.
- **A batch outcome other than `compiled`, exit 69, timeout, an unexpected
  exit or a debugger launch failure blocks widening.** Diagnose with a
  single-case selection into **new** `-v2` files. A diagnosis run uses the
  same `$T`, the same env and batch size 1, and goes through the handshake.
  It never resumes or overwrites `-v1`.
- **Exit 10 (`native runtime reached an unsupported operation`)** is recorded
  as `unsupported`. It blocks widening until the operation is named.
- **An interrupted N1 is not resumed automatically.** If main decides to
  resume, it uses the same `$T`, env, selection, batch size 64 and journal,
  with `TINT_TEST262_RESUME=1`. A module-route prior is restored only if its
  `fixtures` still match, which is what P3 proved.
- **Never delete or reuse a path.** Each attempt gets the next `-vN`.

## 4. Decision: is a preparatory source fix needed? **No.**

| Possible gap                                                     | Evidence                                                                                            | Verdict           |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------- |
| Fixtures missing on fixture-caused unsupported                   | #8 carries all 3 nodes (§1)                                                                         | fixed (D4 landed) |
| Self-import breaks the closure check                             | #5, #7, #9 are `ok`; the root is in `known`                                                         | none              |
| Equal-byte fixtures merged inside a batch                        | `-1`/`-2` are counted separately (§1.2)                                                             | none              |
| `import * as x; export {x}` lowered as a local export (old spec) | `module-shape.ts` makes it indirect with `importName: undefined`; `records.ts:56-66` asserts it     | none              |
| Star resolution sharing `visited` across branches                | matches the spec's shared `resolveSet`. #5's second branch yields `null`, not ambiguity, under both | none              |
| Report-note grouping by reason or exit                           | 10 variants need none. Defer it to a wider selection                                                | defer             |

There are no source, test, catalog or manifest edits. The only new files are
the two `.mjs` controllers in `.tint-bootstrap/` and the `wx` results listed
above. `pnpm check` is not rerun because nothing under version control
changes. Native behaviour is still an open question (§2), not a source defect
found in advance.

## 5. Out of scope

- Any other directory, the whole-suite survey, compile performance and
  batch-size tuning.
- M2c fixture re-parse, source-phase imports (#8), M3, M4 and M5.
- Editing the G0–G2 controller, its pause, the frozen direct-eval
  conformance line, its reports, or the snapshot.

## 6. Next module slice (proposal only)

Planned in [namespace selection](host-esm-namespace-selection.md).

Plan `language/module-code/namespace` next: 2 top-level tests
(`Symbol.iterator.js`, `Symbol.toStringTag.js`) plus 36 in `internals/`. That
is 38 files; the variant count still needs the census. The plan would:

- cover namespace exotic-object internals (`own-property-keys-sort`, the
  `*-uninit` TDZ reads, `set`/`define-own-property`/`delete`);
- start with the same Node census for routes, fixtures and expected outcomes;
- separate TDZ (`ReferenceError`) expectations from Node 24 behaviour;
- reuse this plan's drill result instead of repeating it.

It should start only after N1 is accepted.
