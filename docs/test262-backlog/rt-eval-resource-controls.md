# RT-EVAL EV5c: resource-sensitivity controls, resources-only isolation and containment

Status: **plan only.** I edited no code, tests, manifests or data, ran nothing natively, and
touched no queue, pause marker, journal, report, snapshot or process. Parent:
[host integration](rt-eval-test262-host-integration.md) §7–§8 and §11. Where the two disagree on
control selections, run order or containment, **this plan replaces §8 there**. The acceptance
population ([S2-ev1](rt-eval-host-evalscript.md) §3) is unchanged.

Captured 2026-11-05. Inputs, each read once with bounded Node one-shot scans:

- [v9 survey journal](../results/test262-full-suite-native-v9.jsonl) (11,112 rows, still being
  written by PID 28307; the `.json` report is empty because the run is not finished);
- the v1–v8 survey journals (for timeouts and coverage only);
- [frozen baseline toolchain](../results/frozen-node-toolchain-evalscript-baseline-v1.json)
  (`3de2c0f4…`, snapshot `55e4007c…`/549, Node v24.12.0) and its two reports,
  [global-code](../results/test262-global-code-evalscript-baseline-native-v1.json) and
  [annexB global-code](../results/test262-annexb-global-code-evalscript-baseline-native-v1.json);
- the [EV5b fixture validation](../results/native-test262-script-service-validation-v1.json)
  (image `644cfc20…`, 7 cases). It appeared while I was working, and I read it once;
- `tools/test262-native.ts`, `tools/test262-native-run.ts`, `tools/test262-native-process.ts`,
  `tools/frozen-node-toolchain.ts`, `tools/native-run-journal.ts`, the
  `packages/codegen/src/aarch64/startup.ts` stack mapping, and the Test262 sources named below.

## 1. Answer in brief

1. **v9 has no direct recursion or GC evidence.** It covers `annexB/` and `built-ins/` only as far
   as `built-ins/Date`. It has not reached `language/` or `built-ins/Function`. None of the
   surveys v1–v9 shows a stack or heap failure. All 31 v9 crashes are LLDB attach failures, and
   every earlier timeout hit a trivial test. v9 supplies one heap-heavy control and the noise
   floor. The recursion controls come from source inspection and have no prior native
   observation.
2. **Controls (§4).** Recursion: `language/statements/return` (31 variants, including the
   100,000-frame `tco.js`) and `language/expressions/call/tco-non-eval-global.js` (1 variant, a
   100,000-frame recursion through a callee _named_ `eval`; it is also the direct-eval guard's
   ordinary-call fixture). GC/heap: `Array.prototype.concat_large-typed-array.js` (2 variants),
   the only case that is consistently heavy in v9, at 13.0 s and 13.3 s against a 2.26 s median.
   Comparative population: `built-ins/Function` (893 variants; none uses `evalScript`, 13 use
   `createRealm`).
3. **Three toolchains, one matrix (§3).** **B** is the existing frozen baseline. **R** is a new
   frozen copy of B whose only change is the five §7 resource literals. **V** is the EV5 (v6)
   tools, frozen from the live tree. B→R is the resource effect, R→V is the v6 effect, and B→V is
   reported but never attributed.
4. **Exact baseline.** B = `.tint-bootstrap/node-toolchain-evalscript-baseline-v1`, used read-only
   through its own entry. The two global-code B reports already exist (60 s containment, which is
   harmless: no variant ran longer than 0.26 s). The other seven selections need new B reports.
5. **Containment (§6).** Use one value, **300,000 ms**, for every B, R and V run. Derivation:
   C = max(300,000, ⌈3 × M⌉ rounded up to a whole minute), where M is the largest EV5b case
   elapsed (62,469 ms). That gives 187.4 s, rounded up to 188 s, so C stays at 300,000 ms. This
   is a run budget, not a compile time and not a minimum.
6. **Failing fast instead of risking dozens of timeouts.** Run order puts single files first. A
   stop rule after the first two `evalScript` variants under V bounds the worst case to 2 × C
   instead of about 51 × C.
7. **After EV5, guard direct eval first (§8).** IE2 and IE3 come first. A new slice, G3, routes
   the guard through the in-image compiler, so `$262.evalScript('eval("1")?.y')` is guarded too.
   Only after that does work on the indirect string `%eval%` (IE4–IE7) begin.

## 2. What the saved evidence says

### 2.1 v9 (read-only; frozen v4 toolchain, old resources)

| Item                    | Value                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Header                  | `native-script-v4-shared-image`, batch 64, `lldb-local-stdio`, tracing on, 64 MiB / 1 Mi / 4,096 / 1 MiB stack / 60 s |
| Rows                    | 1 start, 174 compilations, 10,793 observations, 144 diagnostic pauses                                                 |
| Coverage                | `annexB/**` then `built-ins/` A… through `built-ins/Date/TimeClip_negative_zero.js`                                   |
| Statuses                | pass 9,832; unsupported 705; harness-error 224; crash 31; fail 1                                                      |
| Crashes                 | All 31 are "LLDB did not produce a result … attach failed". These are infrastructure failures, not resource failures  |
| Harness errors          | All 224 are `built-ins/Atomics/{notify,wait,waitAsync}`                                                               |
| Compile                 | median 47.2 s, max 344.2 s per batch                                                                                  |
| Per-variant increment   | n 10,520; p50 2,256 ms; p90 2,271; p99 5,679; p99.9 30,271; max 34,052                                                |
| Stack/heap/limit faults | none in v1–v9                                                                                                         |

`elapsedMs` in the journal is **not** a per-variant run time. It runs from the moment the variant
was enqueued (`test262-native-run.ts:130`), so it includes the batch compile and every earlier run
in the batch. Every timing in this plan therefore uses the **increment** between consecutive rows
of the same batch, skipping any row that follows a `diagnostic-pause`.

The ≈30 s increments are attach failures and their neighbours. The 5.5–7 s increments are
batch-wide slowdowns: whole runs of trivial files such as `toString/name.js` show them in both
variants, which points to contention rather than to the tests. Only one file is heavy in both
variants and also in isolation: `built-ins/Array/prototype/concat/Array.prototype.concat_large-typed-array.js`
at 12,985 ms (sloppy) and 13,275 ms (strict). That is ≈5.8× the median, and both variants pass.

The timeouts in v1 (2), v2 (3), v4 (15) and v5 (22) are all trivial files (`length.js`,
`prop-desc.js`, `not-a-constructor.js`) that pass in v9. They show that 60 s can be exceeded by
contention alone, and they set the contention factor in §6. They are not resource evidence.

### 2.2 Frozen baselines (toolchain B)

Header: `native-script-v5-script-records`, batch 64, `debugserver-direct`, tracing on, the same
old resources as v9, 60 s.

| Report             | Variants | Statuses                 | Execution compiles             | Increment p50 / max |
| ------------------ | -------- | ------------------------ | ------------------------------ | ------------------- |
| global-code        | 75       | 50 pass, 25 unsupported  | 59.1, 60.8, 53.2 s (+3 syntax) | 223 / 245 ms        |
| annexB global-code | 153      | 136 pass, 17 unsupported | 62.4, 60.4, 58.6 s             | 228 / 261 ms        |

With `debugserver-direct`, a variant costs about 0.22 s, roughly a tenth of v9's 2.26 s under
`lldb-local-stdio`. **Launch mode dominates per-variant cost.** All B, R and V runs must use the
same mode.

### 2.3 EV5b fixture (image `644cfc20…`, default `debugserver-connected`, tracing off, C = 300 s)

| Case | Content                                     | Outcome     | Elapsed (ms) |
| ---- | ------------------------------------------- | ----------- | ------------ |
| 0    | 3 calls: value, `let`, read-back            | completed   | **62,469**   |
| 1    | SyntaxError + restricted-function TypeError | completed   | 22,189       |
| 2    | child realm, 2 calls                        | completed   | 22,073       |
| 3    | tagged template, then `"42"`                | unsupported | 4,040        |
| 4    | Promise job from eval code                  | completed   | 22,590       |
| 5    | lone surrogate                              | completed   | 21,414       |
| 6    | `Function` + `evalScript` sharing the arena | completed   | 21,602       |

Here `elapsedMs` really is per process, because the fixture times `image.run` directly.
Readings:

- Case 3 (4.0 s) is the process floor without the evaluator's lazy build. The profile rejection
  appears to come before `scriptCompiler()`. That is inferred from the time, not traced.
- In the warm cases (1, 2, 4–6), an `evalScript` process costs **≈17.4–18.6 s above that floor**.
  This is the per-process lazy build (22 module parses, the directory read and the compiler) plus
  1–3 compiles. Extra calls add at most about 1 s, which is not isolated. **It is not a compile
  time.**
- Case 0 is about 40 s slower than the warm cases for comparable work. It was the first process
  of a new binary. Candidates are page-in, signature validation and debugger symbol load; none
  was measured. In Test262 images, every batch is a new binary, so the first `evalScript`
  variant per batch may pay this cost.
- Every Test262 variant is its own process (`NativeImageRunner.run` spawns once per variant).
  **Every `evalScript` variant therefore pays the lazy build.** Variants that do not use the
  evaluator pay nothing extra, by design.

## 3. Attribution design: B, R, V

| Toolchain | Tools                             | Resources (§7 of parent)                               | Adapter label                     | Directory                                            |
| --------- | --------------------------------- | ------------------------------------------------------ | --------------------------------- | ---------------------------------------------------- |
| **B**     | frozen baseline, unchanged        | 64 MiB / 1 Mi / 4,096 / 1 MiB / exec 1 MiB             | `native-script-v5-script-records` | `node-toolchain-evalscript-baseline-v1` (exists)     |
| **R**     | B plus five literal edits (§5)    | 256 MiB / 8 Mi / 16,384 / 16 MiB / exec 4 MiB          | unchanged v5                      | `node-toolchain-evalscript-resources-v1` (new)       |
| **V**     | live EV5a tree, frozen after EV5b | same as R, plus `maxScriptCodeBytes` 262,144 (v6 only) | `native-script-v6-eval-script`    | `node-toolchain-evalscript-v6-v1` (new; recommended) |

- **B→R** is the resource effect. The `evalScript` rows stay `unsupported` in R, because B's tools
  reject `evalScript`.
- **R→V** is the v6 effect: evaluator wiring, lazy embedded runtime texts, the realm-local
  evaluator construction and the `maxScriptCodeBytes` literal. Resources are identical between R
  and V.
- R keeps the v5 label on purpose. Changing it would be a non-resource edit. R and B are told
  apart by the header's `executionResources` and `frozenToolchainSha256`.
- V is frozen for the same reason v9 is: so that the live tree cannot drift under a long run.
  The fixture shows that the snapshot identity is still `55e4007c…`. EV5a changed `tools/` only.
- Never sum or average across B, R and V. Never compare against v9 statuses; v9 is only used to
  choose controls.

## 4. Control selection

### 4.1 Recursion (stack 1 MiB → 16 MiB)

There are 35 Test262 files with `tail-call-optimization`. Each recurses `$MAX_ITERATIONS = 100000`
(`harness/tcoHelper.js:14`). Without TCO, they need 100,000 live frames. 1 MiB allows ~10 bytes
per frame, so they **must** exhaust the stack under B. 16 MiB allows ~168 bytes per frame, so R
could plausibly go either way.

The stack has `PROT_NONE` guard pages at both ends (`startup.ts:164-381`, two `mprotect` calls). I
found no stack-limit check or RangeError conversion in `packages/`. The expected B outcome is
therefore `crash` from the guard-page fault, but that is unverified. Every TCO file lives in its
own directory, so each one costs about one compile (≈60 s) per toolchain. I take two:

- **R1: `language/statements/return`** (16 files, 31 variants, one execution batch). `tco.js`
  (`onlyStrict`) is pure self-recursion. Its 30 sibling variants are cheap non-recursive controls
  in the same image.
- **R2: `language/expressions/call/tco-non-eval-global.js`** (`noStrict`, 1 variant). It sets
  `eval = f`, then recurses with `return eval(n - 1)`. This is a syntactic direct-eval candidate
  whose callee is not `%eval%`, so it must take the ordinary call path. Its status must not
  change when the guard lands (§8 G4).

`built-ins/Proxy/revocable/tco-fn-realm.js` is already in the acceptance set. It throws before
any recursion, so it is a realm control, not a recursion control.

### 4.2 GC/heap (64 → 256 MiB, 1 Mi → 8 Mi allocations, 4,096 → 16,384 roots)

- **G1: `built-ins/Array/prototype/concat/Array.prototype.concat_large-typed-array.js`**
  (2 variants). It is v9's only stable heavy case (§2.1), and it passes under the old heap, so a
  pass→fail here is unambiguous. Its increment is also the clearest signal that copying-collector
  timing changed (B→R).
- `built-ins/Function` (§4.3) is the broad allocation population. Closures, `bind` and dynamic
  `Function` all allocate.

### 4.3 Comparative population: `built-ins/Function`

There are 509 files and **893 variants**. None calls `evalScript`. 13 call `createRealm`, which
under V builds a realm-local evaluator that is never used. It is the shared-arena regression
(1 → 4 MiB `executableMemoryBytes`; dynamic `Function` and Script code share the arena under V)
and the inertness proof for v6 (**any** R→V status change is a defect). At ~14 execution batches it
costs about 15–20 min per toolchain. Run it last.

### 4.4 Rejected candidates

| Candidate                                                   | Why not                                                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| All 35 TCO files                                            | Spread over 19 directories (≈35 compiles per toolchain, ≈1 h 45 min for B+R+V). Two give the same signal |
| `decodeURI*`/`encodeURI*` 65,536-iteration files            | Plausibly GC-heavy, but never observed natively; dozens of files risk dozens of containment hits         |
| `RegExp/property-escapes/generated`                         | Very large, slow and dominated by Unicode tables rather than GC                                          |
| `length-near-integer-limit`, `ArrayBuffer/allocation-limit` | They test limits, not capacity. `arrayBufferBytes` does not change                                       |
| The 5.5–7 s v9 plateau files                                | Contention, not the tests (§2.1)                                                                         |

## 5. Building R without mutating B (instructions; not executed)

`freezeNodeToolchain(snapshot, dir, { workspaceRoot })` (`frozen-node-toolchain.ts:29-33`)
can freeze from any root that contains `tools/`, `package.json`, `pnpm-lock.yaml` and
`packages/<id>/{package.json,dist,src}`. B contains exactly those, because freezing writes
`src` from the snapshot. So:

```sh
B=.tint-bootstrap/node-toolchain-evalscript-baseline-v1
W=.tint-bootstrap/evalscript-resources-root-v1      # scratch root, never run
cp -Rp "$B" "$W"                                     # keeps relative @tint symlinks
# Edit exactly five literals in $W/tools/test262-native.ts, nativeTestResources:
#   executableMemoryBytes 1048576 -> 4194304     managedBytes 67108864 -> 268435456
#   allocationCapacity   1048576 -> 8388608      rootCapacity 4096 -> 16384
#   stackBytes           1048576 -> 16777216
# Do not add maxScriptCodeBytes (nothing in B reads it). Do not change the label.
node --input-type=module -e '
import {writeFileSync} from "node:fs";
import {readWorkspaceSourceSnapshot,workspaceSourceIdentity} from "./'"$B"'/tools/workspace-sources.ts";
import {freezeNodeToolchain} from "./'"$B"'/tools/frozen-node-toolchain.ts";
const s=readWorkspaceSourceSnapshot("'"$B"'/source-snapshot.json");
const t=freezeNodeToolchain(s,".tint-bootstrap/node-toolchain-evalscript-resources-v1",{workspaceRoot:"'"$W"'"});
writeFileSync("docs/results/frozen-node-toolchain-evalscript-resources-v1.json",JSON.stringify({kind:"frozen-node-toolchain",sourceSnapshot:workspaceSourceIdentity(s),toolchain:t,derivedFrom:"'"$B"'",change:"nativeTestResources: five literals"},null,2)+"\n",{flag:"wx"});'
```

Use B's own `freezeNodeToolchain` so that live-tool drift cannot enter R. Before any native run,
check all of the following in Node only:

1. `diff -r $B/tools $R/tools` shows one hunk in `test262-native.ts` and nothing else.
2. `diff -r $B/packages $R/packages` is empty.
3. The manifest's `sourceSnapshot` is `55e4007c…`/549 and its `nodeVersion` is v24.12.0.
4. Importing `$R/tools/test262-native.ts` prints the five new values.

Then delete `$W`, which is scratch. V is frozen the same way from the live root (no
`workspaceRoot`) after EV5b is green, and is recorded as
`frozen-node-toolchain-evalscript-v6-v1.json`.

## 6. Containment

**Policy.** Use one value per matrix, the same for B, R and V, set through
`TINT_TEST262_CONTAINMENT_MS`. Never set it per test, per directory or per retry.

**Formula.** Let M be the largest per-case elapsed in the EV5b validation report (62,469 ms,
case 0, cold). Then C = max(300,000, ⌈3·M / 60,000⌉ · 60,000) ms.

- The factor 3 covers contention. v9's batch-wide slowdowns run at ≈2.5× the median (5.7 s
  against 2.26 s), and v1–v5 show trivial files beyond 60 s. 3 is a judgment, not a measurement.
- The 300,000 ms floor is the value main already uses for integration. It keeps B, R and V
  comparable with the fixture's own budget.
- Result: 3 × 62,469 = 187,407 ms, rounded up to 188,000 ms, so **C = 300,000 ms**.
- Recompute only if a later EV5b-style report replaces the validation (for example after a guard
  slice) and its M exceeds 100,000 ms.

**What C is not.** It is not a compile time and not a minimum. It says nothing about the 8-call
`var-collision` file beyond the observation that extra calls added at most about 1 s in the
fixture.

**Coupling.** The runner records `debuggerStartupTimeoutMs: nativeTestResources.timeoutMs`
(`test262-native-run.ts:100`), so raising C also raises the debugger startup allowance to
300 s. v9's attach failures failed in about 30 s regardless, so I expect no effect. The header
records the coupling, so no edit is needed.

**Expected V cost.** `evalScript` variants (the 44 gating, 3 child-realm and 4 must-stay rows)
cost about 18 s to 63 s each on top of the ≈0.22 s floor. Everything else costs the floor.

**Stop rule (V only).** Run the controller's first `evalScript` selection, S3 (2 variants), before
anything else. If either variant reaches C, stop the V matrix and report. The containment or
per-process assumption is then wrong, and continuing would risk about 51 × 300 s ≈ 4.25 h of
timeouts.

## 7. The run matrix (serial, scheduled by main)

| #   | Selection                                                                      | Var. | Role                         | Label                        |
| --- | ------------------------------------------------------------------------------ | ---- | ---------------------------- | ---------------------------- |
| S3  | `annexB/language/eval-code/direct/script-decl-lex-no-collision.js`             | 2    | gating / must-stay canary    | `annexb-direct-no-collision` |
| S4  | `built-ins/Proxy/revocable/tco-fn-realm.js`                                    | 1    | child realm                  | `proxy-tco-fn-realm`         |
| S5  | `intl402/FallbackSymbol/per-realm.js`                                          | 2    | child realm (completion)     | `fallback-symbol-per-realm`  |
| S8  | `language/expressions/call/tco-non-eval-global.js`                             | 1    | recursion R2 / guard fixture | `tco-non-eval-global`        |
| S9  | `built-ins/Array/prototype/concat/Array.prototype.concat_large-typed-array.js` | 2    | GC/heap G1                   | `concat-large-typed-array`   |
| S7  | `language/statements/return`                                                   | 31   | recursion R1                 | `statements-return`          |
| S1  | `language/global-code`                                                         | 75   | acceptance                   | `global-code`                |
| S2  | `annexB/language/global-code`                                                  | 153  | acceptance                   | `annexb-global-code`         |
| S6  | `built-ins/Function`                                                           | 893  | comparative                  | `function`                   |

Rows run top to bottom: S3 first, because it carries the V stop rule.

Per toolchain T, with `<entry>` and `<sources>` taken from T's `frozen-node-toolchain-*.json`:

```sh
TINT_TEST262_SOURCES=<sources> \
TINT_TEST262_JOURNAL=docs/results/test262-<label>-<suffix>.jsonl \
TINT_TEST262_CONTAINMENT_MS=300000 \
TINT_TEST262_DEBUGGER_LAUNCH=debugserver-direct TINT_TEST262_DEBUGGER_TRACE=1 \
TINT_TEST262_PAUSE=.tint-bootstrap/evalscript-controls.pause \
  node <entry> .tint-bootstrap/test262 <selection> 64 > docs/results/test262-<label>-<suffix>.json
```

- The suffix is `evalscript-baseline-native-v1` for B, `evalscript-resources-native-v1` for R
  and `evalscript-native-v1` for V. B already has S1 and S2; do not rerun them.
- Every path is new and opened with `wx`. Nothing is written under any toolchain directory or
  under v9's paths. Use `TINT_TEST262_RESUME` only to continue the same interrupted journal.
- Batch 64, `debugserver-direct` and tracing match the existing B reports. Parent §8's `8` is
  superseded here for comparability.
- Pause v9 exactly as the existing controllers do: write `native-behavior-v9.pause` with `wx`,
  wait for an `.ack` with pid 28307 and state `between-variants`, run, and remove the marker in
  `finally`. Use one pause per toolchain sweep, never a signal.
- Use one controller per toolchain. Write a `…-controller-v1.json` per selection, as the baseline
  controller does.
- Order the toolchains B, then R, then V. When B and R finish, the resource answer is known
  before any v6 cost is paid.

## 8. Diff and reporting rules

Compare per variant (path plus variant) in two pairs.

| Pair | Change                                       | Meaning                                               | Blocks                        |
| ---- | -------------------------------------------- | ----------------------------------------------------- | ----------------------------- |
| B→R  | pass → fail/crash/timeout/unsupported        | Regression caused by the resources                    | Adopting the §7 set uniformly |
| B→R  | fail/crash → pass (expected for TCO)         | Gain caused by the resources; reported in its own row | No; never credited to EV5     |
| R→V  | any change on a variant without `evalScript` | v6 is not inert (S4 excluded: it uses `evalScript`)   | EV5                           |
| R→V  | `evalScript` variant unsupported → pass      | v6 effect (the goal)                                  | —                             |
| R→V  | `evalScript` variant → fail/crash/timeout    | v6 defect; crash 13–17 with the reason                | Gating rows only              |
| R→V  | must-stay row → pass/completed               | Unsound direct-eval path                              | EV5                           |

- A crash whose detail is an LLDB attach failure is **infrastructure**. Mark that variant
  _inconclusive_ in both pairs, do not retry it, and list it. Two or more on control variants make
  that control inconclusive.
- **Timing.** Report per-selection increment medians for B, R and V. List each variant whose
  increment exceeds 3× its selection median, and compare G1's increment across all three. Report
  `compileMs` per batch, because V embeds the runtime texts. Never use raw `elapsedMs` (§2.1).
- Do not update totals, dashboards or status tables, and give no pass forecast. Inventory
  changes wait for the post-v9 full survey (parent §7).

## 9. Source-inspection notes on the new host (no edits made)

1. **Setup failures look like compile failures.** `scriptCompiler()` throws strings
   (`SCRIPT_COMPILER_POISONED`, `SCRIPT_SURFACE_READ`, `SCRIPT_RUNTIME_PARSE`, …,
   `test262-native.ts:313-324`) inside the `compile` callback given to `createScriptEvaluator`
   (`:447`), so they surface as exit 13 `compile-threw`. A heap or allocation exhaustion while
   parsing the 22 modules, which is the most resource-sensitive step under V, is therefore
   indistinguishable from a real compile throw. **Report:** for each crash 13, note whether it
   was the first `evalScript` call in its process. A distinct setup exit would be a later and
   separate change.
2. **The poisoned compiler is per process.** Every variant is a fresh process, so poisoning
   cannot cascade across variants. The flip side is that every `evalScript` variant pays the
   ≈18 s build (§2.3). That is a cost, not a bug.
3. **Exit codes are disjoint.** 10, 11, 12 and 13–17, the failure bases 20–28 and 30–38, 40, 42
   and 50–59 do not collide. Faults are checked before sticky `unsupported` after each harness
   script, after the test script and after the job drain (`:532-547`), which matches the
   parent's §1.6.
4. **Realm pairing.** `evaluateScript` closes over `host` from `installRealmHost(child, …)`, so
   `other.evalScript` evaluates in `other` (`:465-470`). This matches §1.4. S4, S5 and the
   fixture's case 2 cover it.
5. **Reporting trap.** Under V, the first row of each batch absorbs a larger `compileMs`, because
   the runtime texts are embedded. Only increments are comparable (§8).

I found no correctness bug.

## 10. After EV5: guard direct eval before enabling indirect string eval

The [indirect-eval plan](rt-eval-indirect-eval.md) §5.1 and §7 stand. Only the order and one new
slice change.

- **G1 = IE2 (Node).** `realm.evalFunction` and `callEvalCandidate`. A string reaches sticky
  `unsupported` with 0 compiler calls. A non-`%eval%` callee, including another realm's `eval`,
  takes the ordinary call with the receiver preserved.
- **G2 = IE3 (Node, lowering).** Candidates are `eval(s)`, `(eval)(s)`, `eval(s)`,
  `eval(...a)` and `with({eval}) eval(s)`. **`eval(x)?.y` is guarded** at the innermost
  `optionalChainValue` step. None of these is a candidate: `eval?.(s)`, `(0,eval)(s)`,
  `globalThis.eval(s)` and ``eval`s` ``. In `eval(s)(t)`, only the inner call is. Scripts without
  `eval` produce byte-identical output. Then do one frozen self-build, because lowering changed.
- **G3 (new; Node + EV5b-style native).** This routes the guard through the in-image compiler.
  `$262.evalScript` text is lowered by the image's AOT-compiled lowering, so after G2 it emits
  `callEvalCandidate` too. That export must be on the `scriptRuntime` surface directory and in
  the captured runtime closure. Update the surface census, the 22-module capture test and the
  AST-hash pins in the same change. Red Node test: the evaluator's compile of
  `eval("1")?.y` imports `callEvalCandidate`. Native cases (one image, C = 300 s):
  - `$262.evalScript('eval("1")')` → exit 10, never 13 and never `completed`;
  - `$262.evalScript('eval("1")?.y')` → exit 10;
  - `$262.evalScript('globalThis.eval=function(n){return n+1};eval(4)')` → `completed`, with a
    value of 5 through the ordinary path.
- **G4 (native, unchanged selections).** Rerun S3, S1 and S8 with a fresh frozen toolchain. The
  must-stay rows stay `unsupported`, and S8's status must equal V's.
- **Then IE1 and IE4–IE7** (EDI, `lowerEvalScript`, `createIndirectEvaluator`, wiring under
  `native-script-v7-indirect-eval`). After the indirect string path is enabled, S1's
  `script-decl-lex-var-declared-via-eval.js` and S3 are **the canaries**. A global-level direct
  eval behaves almost like an indirect eval there, so an unguarded path would _pass_ them
  unsoundly (indirect-eval plan D2).
- **Budget.** Indirect eval in Test262 images will reuse the same lazy compiler in each process,
  so C needs no new value. Each eval-using variant still pays the ≈18 s build.

## 11. Risks and unknowns

1. **TCO outcome under B and R is unverified.** The guard-page fault is expected to show as
   `crash`. If R passes, that is a resource gain that hides TCO absence. Report it as a gain,
   never as a TCO feature.
2. **Case 0's ≈40 s cold surcharge** is unexplained. If every batch's first `evalScript` variant
   pays it, S1 and S2 under V each cost up to a few extra minutes. That stays far below C.
3. **Heap reservation.** 256 MiB managed (plus the copying semi-space, if any) per process, with
   serial processes only. I saw no host-memory evidence either way.
4. **Contention with v9.** The pause protocol removes CPU contention from the paused survey, but
   not from other machine load. A changed `elapsedMs` is never evidence on its own.
5. **Unobserved controls.** R1 and R2 have no native observation on any toolchain until B records
   one. If B shows them as `unsupported` (for example, a prepare-profile gap), they are not
   recursion controls. Report that and do not substitute ad hoc.
6. **S5 `per-realm.js`** also needs a per-realm Intl fallback symbol (parent §10.6), so its V
   status does not isolate the wiring.

## 12. Next planning task

**"G3: direct-eval guard through the in-image Script compiler."** From the post-EV5 tree
(read-only): list the exact surface-directory, runtime-closure and pin deltas that adding
`callEvalCandidate` to `scriptRuntime` causes; say whether the 22-module closure grows; and write
the G3 red tests and the three native cases precisely enough for main to implement right after
G2.
