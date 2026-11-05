# RT-EVAL IE6/IE7: native indirect-eval acceptance and `evalCompiler` host wiring

Current status: the realm compiler slot and capture-gated host wiring are implemented.
The workspace gate passes (4,019 tests), and the extended managed Script fixture
(case 5) [passes natively](../results/native-indirect-evaluator-v1.json).
The [20-case host verification](../results/native-test262-indirect-eval-validation-v1.json)
passes: 14 completed and six expected unsupported outcomes. The frozen pre-host
[baseline](../results/test262-indirect-eval-baseline-native-v1.json) records 4/118 passes.
Unchanged capable-host conformance selections and the fresh slot-bearing self-build
remain pending. The original plan follows.

Research status at capture: **plan only.** Parent plans:
[indirect eval](rt-eval-indirect-eval.md) (population, §6 corner cases, §8 comparison rules) and
[eval lexical entry](rt-eval-lexical-entry.md) (IE4/IE5, the carrier, the evaluator core). Where
they disagree, this plan takes precedence for: the `evalCompiler` slot and its installer, the
intrinsic's string routing, capture-gated Test262 host wiring, adapter v7, the IE6 native fixture
and the IE7 Test262 guard proof. Direct string eval stays unsupported, including `eval(x)?.y`.

**Capture.** 2026-11-05, live source of 550 portable files. Before reading, I compared the newest
`src` and `dist` mtimes for `js-runtime`, `js-engine`, `compiler`, `typescript` and `source`, and
`dist` is fresh in all five. The `dist` files contain `createIndirectEvaluator` and
`lowerEvalScript`. Landed and relied on:

- IE1 `instantiateEvalDeclarations`, natively validated
  ([report](../results/native-eval-declarations-v1.json));
- IE4 `lowerEvalScript` (`js-engine/src/lowering/index.ts:110`) and IE5
  `createIndirectEvaluator` (`js-engine/src/script-evaluation.ts:62`), both Node-validated
  (`pnpm check`, 4,013 tests, `.tint-bootstrap/annex-record-guard-workspace-check-v1.log`);
- the G1–G3 `callEvalCandidate` (`js-runtime/src/objects/global-properties.ts:47-61`);
- the Annex B `AnnexGlobalFunction` annotation and fail-closed managed JIT record guard
  ([report](../results/native-managed-jit-record-mutability-v1.json)).

Surface today: 122 entries (102 helpers, 20 types), 28 generic roots, 41 providers, 355 slots and
323 targets (`tools/script-runtime-surface.test.ts:238-583`).

**Not yet established (do not cite as passing).** Main is running the complete Annex153/global75
reruns (`.tint-bootstrap/run-annex-admission-fix-selections-v1.mjs`). The frozen self-build
controller `.tint-bootstrap/build-eval-entry-contracts-selfbuild-v1.mjs` is building stage1, and
the native stage2 run waits for those reruns. I touched neither of them and read no result from
them.

**Method.** Read-only reads of the live source. I ran no probe, build, emission, native process,
queue, report, journal or snapshot action, and edited nothing except this file and one cross-link.
Every census number after the slot lands is **unknown until main measures it**.

## 1. Answer in brief

1. **Two runtime edits, no evaluator edit.** Add `ErrorRealm.evalCompiler` beside
   `evalFunction`, plus an exported install-once `installEvalCompiler(realm, compiler)`; the
   intrinsic's string branch calls the slot or rejects when it is `undefined`.
   `createIndirectEvaluator` already has the right shape and taxonomy, so
   `script-evaluation.ts` does not change (§4).
2. **Direct eval is structurally unaffected.** `callEvalCandidate` never calls the intrinsic
   closure, and it rejects a string itself (`global-properties.ts:58-60`). Installing a compiler
   therefore cannot make `eval("1")`, `eval("1")?.y` or `with({eval}) eval("1")` execute. A Node
   test pins this with a spy (§5).
3. **The capability comes from the frozen snapshot's exports, not from the live tree.** Indirect
   eval is enabled only if the captured `objects` module exports `installEvalCompiler`. If that
   export is present but the captured evaluator lacks `createIndirectEvaluator`, the build throws.
   This keeps today's frozen pre-slot snapshots byte-identical, including the stage1 snapshot now
   in flight. Those snapshots contain `createIndirectEvaluator` but no slot, so gating on the
   evaluator export alone would break them (§6.1).
4. **Each realm installs its compiler in `createRealmHost`.** The compiler shares that realm's
   `ScriptEvaluationHost` object with `$262.evalScript`: one table, one lazily bound compiler, one
   4 MiB arena and one fault flag for all realms. `createRealm` children get the same wiring. There
   are no new exit codes, limits, caches, schedulers or loaders (§6.2).
5. **IE6 has one new hosted fixture** with real native compilation, two realms and 24 statuses
   (§8). **IE7 has one new Test262-host verifier** with 14 completed and 6 unsupported cases (§9),
   plus adapter `native-script-v7-indirect-eval`.
6. **The acceptance selections are unchanged.** `language/eval-code/indirect` gets a pre-IE7
   baseline, followed by four post-IE7 runs. The parent §8 blocking rules apply. No pass count is
   forecast (§11).

## 2. Live state (read today)

| Piece                                    | Location                                                       | State                                                                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ErrorRealm.evalFunction`                | `objects/errors.ts:71`; literal `:322`                         | Present. `dynamicFunctionCompiler` sits at `:72`/`:321`, so the interface order and literal order already differ                                             |
| `installEvalIntrinsic`                   | `global-properties.ts:22-42`                                   | Non-string → identity; string → `rejectUnsupportedExecution(realm)`; once-only through `EVAL_INTRINSIC_INVARIANT`                                            |
| `callEvalCandidate`                      | `global-properties.ts:47-61`                                   | Compares against `realm.evalFunction`; a string → reject; **never calls `evaluate`**                                                                         |
| Builtin context push                     | `errors.ts:239-252`                                            | `{realm, scriptOrModule: active?.scriptOrModule}`: the effective identity                                                                                    |
| `createIndirectEvaluator`                | `script-evaluation.ts:62-70`                                   | Empty body → `undefined` before lowering; `lowerEvalScript`; carrier `createScriptRecord(realm, active?.scriptOrModule)` read after compile and domain check |
| Test262 realm host                       | `tools/test262-native.ts:384-449`                              | `installEvalIntrinsic` at `:417`; `createScriptEvaluator` at `:447` (only with `scriptEvaluation`)                                                           |
| Capability capture                       | `capturedScriptEvaluation` `:889-905`; runtime caps `:789-866` | Public-entry presence plus a required factory export                                                                                                         |
| Unsupported detection                    | `test262-native.ts:539-545`                                    | Loops over **all** realms after the test body and after the job drain                                                                                        |
| Fault exits                              | `scriptFaultExit` `:325`                                       | 13–17                                                                                                                                                        |
| Adapter label                            | `tools/test262-native-run.ts:95,279`                           | `native-script-v6-eval-script`                                                                                                                               |
| Script surface request                   | `tools/script-runtime-request.ts:56-62`                        | `scriptRuntimeImports(…, "all", …)`: a single table already serves both entry kinds                                                                          |
| Native resources (`nativeTestResources`) | `test262-native.ts:81-103`                                     | 256 MiB heap, 8 Mi allocations, 16,384 roots, 16 MiB stack, 4 MiB arena, 256 KiB Script cap; 300 s containment. **Reused unchanged**                         |

## 3. Specification points this slice must keep

From the lexical-entry plan §2 (draft 2026-11-03), not re-derived here:

- **Order.** `evalRealm` is the intrinsic's realm (step 3); `HostEnsureCanCompileStrings` is a
  no-op permit (parent D6); parse errors are `evalRealm` SyntaxErrors.
- **Identity.** The spec field is the builtin context's null; observers see the caller's
  effective identity. Tint stores that value directly (invariant E), through the existing builtin
  push at `errors.ts:240-252`. The intrinsic adds no push.
- **Strictness and environment.** The text alone decides strictness, never the caller. `this` is
  `evalRealm`'s global this-value; the variable environment is the global environment (sloppy)
  or the fresh lexical environment (strict).

## 4. IE6a runtime contract (`js-runtime`, Node first)

### 4.1 `objects/errors.ts`

```ts
/** Embedding-owned indirect PerformEval for an already-String source. It runs
 * in this realm's global environment, inherits the effective active Script
 * identity, and reports unsupported execution on this realm. JS cannot reach it. */
export type EvalCompiler = (source: string) => unknown;
// ErrorRealm, directly after evalFunction (:71):
evalCompiler: EvalCompiler | undefined;
// createErrorRealm literal, directly after evalFunction (:322):
evalCompiler: undefined,
```

The field is mutable, not `readonly`, matching `dynamicFunctionCompiler`. This keeps it out of the
readonly near-match class that the new managed JIT record guard rejects fail-closed. Export
`EvalCompiler` with `DynamicFunctionCompiler` from `objects/index.ts`.

### 4.2 `objects/global-properties.ts`

```ts
/** Install the realm's indirect-eval compiler once, after %eval% exists. */
export function installEvalCompiler(
  realm: ErrorRealm,
  compiler: EvalCompiler,
): void {
  if (realm.evalFunction === undefined || realm.evalCompiler !== undefined)
    throw "EVAL_COMPILER_INVARIANT";
  realm.evalCompiler = compiler;
}
```

Change the intrinsic's string branch (`:35`) to:

```ts
const compiler = realm.evalCompiler;
return compiler === undefined
  ? rejectUnsupportedExecution(realm)
  : compiler(source);
```

The `typeof` check at `:34` already sends non-strings back unchanged, so they never reach the
compiler. `realm` here is the closure's realm, which matches step 3. The slot is read on **every
call**, so an embedding that installs after realm creation is still observed. `callEvalCandidate`
does not change.

**Lifetime and installation.** The slot is written once, during host setup, before user code
runs in that realm, and is never cleared or replaced. It lives as long as the realm: the closure
retains `{realm, global}` and the shared host hooks, the same retention `dynamicFunctionCompiler`
has. Without a compiler, a realm behaves exactly as today. No JavaScript path reads or writes it.

**Why an installer, not a bare assignment.** It enforces "intrinsic before compiler" and
once-only, and it is the **export marker** that §6.1 gates on (a record field is not a
capturable export).

### 4.3 Census

The new field changes `ErrorRealm`'s record layout, and its function type may add a signature
class. The `scriptRuntime` directory digest and the counts listed in this plan's header may move.
**Measure them; do not predict them.** Run `tools/script-runtime-surface.test.ts` and
`packages/js-engine/test/runtime-surface.test.ts` after the edit, re-pin from the observed
failure values in the same commit, and record old → new in the commit message. The vocabulary
entry count (122) should not change, because neither new export is a lowering import. If it does
change, treat it as a bug.

## 5. Red-first Node tests for IE6a

Extend `packages/js-runtime/test/ordinary-object-global-properties.test.ts`, using a real
`createErrorRealm` and two realms:

1. `realm.evalCompiler === undefined` after `createErrorRealm`. With the intrinsic installed and
   no compiler, `eval("1")` gives sticky unsupported on **that** realm only.
2. `installEvalCompiler` before `installEvalIntrinsic` → `EVAL_COMPILER_INVARIANT`. A second
   install also throws, and the first compiler stays installed.
3. A spy compiler receives the **identical** string. A lone surrogate `"\uD800"` arrives
   unchanged. The spy's return value is returned, and a value the spy throws propagates by
   identity.
4. Non-strings (`undefined`, `{}`, `new String("1")`, a Symbol, `{toString(){throw 1}}`) and an
   empty argument list never reach the spy, which records 0 calls.
5. **Cross-realm routing.** Calling B's intrinsic under `runScriptContext(agent, {realm: A,
scriptOrModule: rA})` invokes B's spy, not A's. Inside the spy, `activeContext` is
   `{realm: B, scriptOrModule: rA}`.
6. **Direct guard isolation.** With a spy installed,
   `callEvalCandidate(realm.evalFunction, undefined, ["1"], witness, realm)` throws `undefined`,
   sets `realm.unsupported` and makes 0 spy calls. `[]` returns `undefined` and `[7]` returns 7.
   A foreign realm's intrinsic takes the ordinary call path and **does** reach that realm's spy.
   This is the parent §6 #5 shape: `eval` bound to another realm's function is indirect.

Then run `pnpm build`, the two surface tests (re-pin), `ordinary-object-global-properties`,
`eval-guard.test.ts`, `script-evaluation.test.ts`, and `pnpm check`.

## 6. IE7a Test262 host wiring (`tools/test262-native.ts`)

### 6.1 Capture from the frozen snapshot

Extend `NativeScriptEvaluation` with an optional marker so that existing literals stay valid:

```ts
export interface NativeScriptEvaluation {
  readonly evaluation: string;
  readonly compile: string;
  readonly indirectEval?: true;
}
```

In `capturedScriptEvaluation`, after the existing pair is resolved:

1. Read the `objects` exports from the snapshot (`capturedModuleExports(workspaceModules([objectModule], snapshot))`).
2. If `installEvalCompiler` is **absent**, return the pair unchanged. This covers every
   pre-slot snapshot, including the current stage1 one, whose evaluator already exports
   `createIndirectEvaluator`.
3. If it is **present**, require the evaluation provider to export `createIndirectEvaluator`.
   Otherwise throw `Error("incomplete captured indirect-eval contract")`.
4. Return `{ ...pair, indirectEval: true }`.

If the Script service is absent, `indirectEval` is never set. Indirect eval requires that service
and its table.

### 6.2 Generated runtime text (only when `scriptEvaluation?.indirectEval`)

| Location                        | Change                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The evaluator import (`:261`)   | Add `createIndirectEvaluator,type ScriptEvaluationHost`                                                                                                                                                                                                                                                  |
| The `"object"` import (`:283`)  | Prefix `installEvalCompiler,`                                                                                                                                                                                                                                                                            |
| The evaluator creation (`:447`) | Hoist the existing hook literal into `const service:ScriptEvaluationHost={…}` **only in the indirect variant**. Then emit `const evaluate=createScriptEvaluator({realm,global},service);installEvalCompiler(realm,createIndirectEvaluator({realm,global},service));`. The literal's text stays identical |

Without the marker, the `:447` template text stays exactly as it is today. This is what makes the
v6 output byte-identical. One `service` object per realm shares `scriptState` and
`executableStorage` with the Script evaluator: one lazy bind (`SCRIPT_COMPILER_POISONED` still
guards a failed first bind) and one arena. Child realms get the same wiring through the existing
`createRealmHost(realm, realms)` in `create`.

There are no new exit statuses: indirect faults reuse `scriptState.fault` and 13–17. Sticky
unsupported on a child realm is caught by the existing loops at `:540`/`:545`. Harness entries
(`:529-535`) still check only their own result; the harness never calls eval.

**Host configuration per realm.** `HostEnsureCanCompileStrings` permits, and `HostGetCodeForEval`
is the default (parent D6). There is no runtime toggle: the capability is decided at image build
time from the snapshot. Every realm in an image either has a compiler or does not.

### 6.3 Adapter v7

In `tools/test262-native-run.ts:95,279`, change the label to `native-script-v7-indirect-eval`.
Change it in the **same commit** as §6.2, so that every report produced by a capable image carries
the label.

A frozen pre-slot toolchain must keep running as `v6`. Derive the label from the captured
evaluation:

```ts
indirectEval === true
  ? "native-script-v7-indirect-eval"
  : "native-script-v6-eval-script";
```

Both label sites read it from the build manifest's capability, not from the live tree. If the run
tool cannot see the capture at `:95`, pass it through the existing builder result. Do not add a
second capture path.

### 6.4 Red-first generator tests (`tools/test262-script-service.test.ts`)

1. The live snapshot captures `{…evaluation, indirectEval: true}`.
2. Remove `installEvalCompiler` from the captured objects exports (an in-memory snapshot edit,
   like `remove()` at `:34`) → no marker. Keep it but remove `createIndirectEvaluator` → throws
   `/incomplete captured indirect-eval/`.
3. `nativeTestRuntimeSource({evaluation, compile})`, with no marker, is **byte-identical** to the
   pre-change output. Freeze its SHA-256 before the edit and assert it afterwards.
   `nativeTestRuntimeSource()` is unchanged, and the existing hash at `:76-78` still passes.
4. With the marker, `installEvalCompiler(realm,createIndirectEvaluator({realm,global},service))`
   occurs exactly once in `createRealmHost`, after `installEvalIntrinsic(` and after
   `installPromiseIntrinsics(`. `createScriptEvaluator({realm,global},service)` also occurs once.
   There is still one `executableStorage` and one `scriptState`.
5. The adapter label is v7 if and only if the marker is present.

## 7. Semantics the native work must observe

| #   | Behavior                                    | Required result                                                                                                                                                                                        | Evidence class                                                                 |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| S1  | Non-string, or no argument                  | Identity / `undefined`; 0 compiles                                                                                                                                                                     | Node (§5 #4); native IE6 #6, IE7 c6                                            |
| S2  | Empty, whitespace or comment-only text      | `undefined`; 0 compiles, 0 publishes                                                                                                                                                                   | Node (IE5); native IE6 #7                                                      |
| S3  | Sloppy EDI                                  | Var/function become configurable global properties; lexicals do not persist; a function closes over the eval lexical environment                                                                       | Native IE6 #2, IE7 c1                                                          |
| S4  | Strict text                                 | No global var or function; repeated evals do not see each other's bindings                                                                                                                             | IE6 #3, IE7 c2                                                                 |
| S5  | Strict caller, sloppy text                  | Sloppy (`always-non-strict`)                                                                                                                                                                           | IE7 c3 (strict test-file prefix)                                               |
| S6  | EDI admission                               | Global `let L` + `"var M; var L"` → SyntaxError, `M` absent. Non-definable function → TypeError, earlier names absent                                                                                  | IE6 #4, IE7 c4                                                                 |
| S7  | Parse or early error                        | SyntaxError from the **eval** realm; publish count unchanged; no context push                                                                                                                          | IE6 #8, #15; IE7 c5                                                            |
| S8  | Cross-realm `this`                          | `this` in B-eval code is B's global this-value, whatever the caller                                                                                                                                    | IE6 #12; IE7 c5, c7                                                            |
| S9  | Cross-realm errors                          | Runtime and EDI errors raised in B-eval code use B's prototypes                                                                                                                                        | IE6 #15–16; IE7 c5                                                             |
| S10 | Identity                                    | Inside eval code, `activeContext` = `{B, rA}`. A function or job created there and run later sees `rA`, never the carrier. Nested eval keeps `rA`. With no caller context, the identity is `undefined` | **IE6 only** #9–11, #13–14: Test262 cannot observe it (there is no `import()`) |
| S11 | Completion values                           | Parent §6 #16 table                                                                                                                                                                                    | IE6 #5, IE7 c7                                                                 |
| S12 | Re-entrancy                                 | `(0,eval)("(0,eval)('1+1')")` → 2; contexts restored                                                                                                                                                   | IE6 #14, IE7 c9                                                                |
| S13 | Annex B in eval                             | Parent §6 #15. Uses the annotation landed with the record-guard fix                                                                                                                                    | IE7 c13; `annexB/…/indirect` selection                                         |
| S14 | Direct string                               | `eval("1")`, `eval("1")?.y`, `(eval)("1")`, `with({eval}) eval("1")`, and `$262.evalScript('eval("1")')` → sticky unsupported, even when a compiler is installed                                       | Node §5 #6; IE7 u1–u4; unchanged guard verifier                                |
| S15 | Unsupported inside eval (a tagged template) | Sticky on the **eval** realm; the test outcome is `unsupported`, even if caught                                                                                                                        | IE6 #17; IE7 u5, u6                                                            |

## 8. IE6: `tools/verify-hosted-indirect-eval.ts` (new; native, real compile)

**Shape.** Copy `tools/verify-hosted-managed-script.ts` verbatim for the following parts:

- the embedded runtime sources and module list;
- `createScriptRuntimeRequest({module:"script-host",name:"bindScript"})`, which already selects
  `"all"`;
- the host bindings, view sets and options: `allowJit`, 256 MiB, 8 Mi allocations, 16,384 roots,
  16 MiB stack;
- the storage built on `mapExecutableMemory` with a 4 MiB arena;
- `createScriptEntryCompiler` with `maxScriptCodeBytes: 262144`.

Do **not** modify the managed-script fixture, so that its fixture hash stays comparable.
Extracting the shared option block is a later cleanup.

**Changes from that fixture.**

- `make()` builds realms A, B and C on one agent (`createErrorRealm(…, A.agent)`).
  Each realm gets `installEvalIntrinsic`, then
  `installEvalCompiler(realm, createIndirectEvaluator({realm,global}, service))`.
- The two realms share one counted `service`, with the same `invoke`/`completion`/`fault` hooks.
- `nativeActive` records `activeContext` (realm and identity) into `state.seen`.
- Calls go through `callObjectValue(B.realm.evalFunction, undefined, [text], A.object)`, inside
  `runScriptContext(agent, {realm: A.realm, scriptOrModule: rA})`, where `rA` is a fixed
  `createScriptRecord(A.realm, undefined)`.

**Statuses.** All are distinct; the final value is 42; nothing is retried:

| Status | Check                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 60     | Surface read OK, frame `ScriptEntryFrame`, storage domain = read domain                                                                                                  |
| 61     | `"var a=40; let b=2; function f(){return a+b} f()"` via B → 42                                                                                                           |
| 62     | B's global: `a` is `{w,e,c:true}`, `f` is a function, `b` is absent from the global object and from `record.lexical`                                                     |
| 63     | Strict `"'use strict'; var s=1; function g(){} s"` → 1; `s` and `g` absent from B                                                                                        |
| 64     | B global `let L` (declared on B's `global.lexical` record) + `"var M; var L"` → B SyntaxError, `M` absent. `"function p(){} function NaN(){}"` → B TypeError, `p` absent |
| 65     | Completion table: `"1;{}"` → 1, `"var x=1"` → `undefined`, `"if(false);"` → `undefined`, `"x=1"` → 1                                                                     |
| 66     | Non-strings (`{}`, a Symbol, `new String("1")`) are returned by identity; publish count unchanged                                                                        |
| 67     | `""`, `"  "` and `"/*c*/"` → `undefined`; publish count unchanged                                                                                                        |
| 68     | `"let a; let a"` and `"x\n++"` under A → B's SyntaxError (not A's); publish count unchanged; no root leak (`currentRootHead`)                                            |
| 69     | Inside eval code, `nativeActive()` sees realm **B** and identity **`rA`**                                                                                                |
| 70     | `"function h(){nativeActive()} h"` returns `h`. Calling `h` later, outside any context, sees `rA`, and `rA !== frame.$argument1` (the carrier)                           |
| 71     | With no outer context, a call sees identity `undefined`                                                                                                                  |
| 72     | `"this"` via B, called from A → B's global this-value; strict-text `"'use strict'; this"` is the same                                                                    |
| 73     | `"Promise.resolve().then(()=>nativeActive())"`; after `drainScriptJobs(agent)` the job saw `{B, rA}`                                                                     |
| 74     | Nested `"(0,eval)('nativeActive(); 1+1')"`, with B's `eval` reached through B's global, → 2, and the inner call also sees `rA`                                           |
| 75     | `"null.x"` via B → a TypeError whose prototype is B's `TypeError.prototype`                                                                                              |
| 76     | A body `throw 7` propagates by identity; `activeContext` restored                                                                                                        |
| 77     | A tagged template, sent to realm C: C is unsupported; A and B stay clean                                                                                                 |
| 78     | `f()` → 42 after 32 MiB of churn; code stays published (the arena is never recycled)                                                                                     |
| 79     | Wrong-table hook: completion fault → `state.fault` set, B unsupported                                                                                                    |
| 80     | `callEvalCandidate(B.evalFunction, undefined, ["1"], …, B)` → sticky unsupported, with B's invoke count unchanged                                                        |
| 81     | Bytes per compile, and arena totals before and after, written to the fixture output for the report. No threshold                                                         |
| 20     | Context leak (`activeContext` differs after any call)                                                                                                                    |
| 21     | Carrier reused across calls                                                                                                                                              |
| 22     | Publish-count drift on a no-compile path                                                                                                                                 |

**Main's serial queue, after the IE6a Node gates pass:** build with `TINT_BUILD_ONLY=1`; run
under LLDB, asserting stopped-at-entry and then exit 42; record a new immutable
`docs/results/native-indirect-evaluator-v1.json` with the fixture and image SHA-256, the build
manifest and the source snapshot.

S10 is proved **only** here; label it "bespoke native regression, not conformance".

## 9. IE7: `tools/verify-test262-native-indirect-eval.ts` (new)

Use the same skeleton as `verify-test262-native-eval-script.ts`: a reference `vm` realm with
`$262`, `prepareNativeScripts`, `createNativeBatchBuilder`, `NativeImageRunner` and
`TINT_BUILD_ONLY`. The completed cases are checked against the Node reference first, with the
parent §3 exceptions noted inline. Those exceptions are V8 vm discrepancies; the specification
text decides them, not V8.

| Case | Source (abbreviated)                                                                                                                                                                            | Expect      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| c1   | `(0,eval)("var a=40; let b=2; function f(){return a+b} f()")===42`; `typeof b`; `a` descriptor configurable                                                                                     | completed   |
| c2   | `(0,eval)("'use strict'; var s=1; s")===1 && !("s" in globalThis)`                                                                                                                              | completed   |
| c3   | c2-style sloppy text in an `onlyStrict`-prefixed file defines `t` globally                                                                                                                      | completed   |
| c4   | Global `let L`; `"var M; var L"` → SyntaxError, `M` absent; non-configurable `fixed` → TypeError (no vm check)                                                                                  | completed   |
| c5   | `const o=$262.createRealm().global`: `o.eval("var w=1; this")===o`; `w` not here; `o.eval("let a;let a")` throws `o.SyntaxError` and not `SyntaxError`; `o.eval("null.x")` throws `o.TypeError` | completed   |
| c6   | Non-string identity, `(0,eval)()===undefined`, `{toString(){throw 1}}` returned untouched                                                                                                       | completed   |
| c7   | Completion table; `function g(){"use strict";return (0,eval)("this")} g()===globalThis`                                                                                                         | completed   |
| c8   | Lone surrogate `"\uD800"` through `(0,eval)`                                                                                                                                                    | completed   |
| c9   | Nested `(0,eval)("(0,eval)('1+1')")===2`                                                                                                                                                        | completed   |
| c10  | A Promise job created in eval code runs after the drain (`asynchronous`)                                                                                                                        | completed   |
| c11  | `$262.evalScript("(0,eval)('1')")===1`                                                                                                                                                          | completed   |
| c12  | `Function("return 1")()===1 && (0,eval)("2")===2` (shared arena, one image)                                                                                                                     | completed   |
| c13  | Sloppy Annex B `(0,eval)("{ function fb(){} }"); typeof fb==="function"`                                                                                                                        | completed   |
| c14  | `var e=eval; e("1")===1 && eval?.("1")===1 && x.eval("1")` (indirect shapes)                                                                                                                    | completed   |
| u1   | `try{eval("1")}catch(e){}`                                                                                                                                                                      | unsupported |
| u2   | `try{eval("1")?.y}catch(e){}`                                                                                                                                                                   | unsupported |
| u3   | `try{with({eval}) eval("1")}catch(e){}`                                                                                                                                                         | unsupported |
| u4   | `try{$262.evalScript('eval("1")?.y')}catch(e){}`                                                                                                                                                | unsupported |
| u5   | ``try{(0,eval)("t`x`")}catch(e){}``                                                                                                                                                             | unsupported |
| u6   | ``try{$262.createRealm().global.eval("t`x`")}catch(e){}`` (child realm sticky)                                                                                                                  | unsupported |

Then rerun the **unchanged** `verify-test262-native-eval-guard.ts` (all 9 expectations; cases
6–8 stay `unsupported`), `verify-test262-native-eval-script.ts` (7) and
`verify-test262-native-eval-intrinsic.ts` on the same snapshot, each with a new report.

Docs to update in the IE7 commit: `docs/test262-runner.md` (the v7 label and capability) and
`docs/native-code-loading.md` (the eval entry shares the arena). The dashboard waits for §11.

## 10. Slices, commands and commit boundaries

| Slice | Edits                                                                                        | Gate (main runs it; fail-fast; inspect every exit status)                                                                                                                                                                                                                                                                      |
| ----- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IE6a  | `errors.ts`, `global-properties.ts`, `objects/index.ts`, §5 tests, census re-pin             | `pnpm build`; `node --test packages/js-runtime/test/ordinary-object-global-properties.test.ts packages/js-engine/test/eval-guard.test.ts packages/js-engine/test/script-evaluation.test.ts packages/js-engine/test/runtime-surface.test.ts tools/script-runtime-surface.test.ts tools/managed-jit-entry.test.ts`; `pnpm check` |
| IE6   | The §8 fixture only                                                                          | `TINT_BUILD_ONLY=1 node tools/verify-hosted-indirect-eval.ts`; LLDB run; report                                                                                                                                                                                                                                                |
| IE7a  | `test262-native.ts` §6.1–6.2, `test262-native-run.ts` §6.3, §6.4 tests, the §9 verifier file | `pnpm build`; `node --test tools/test262-script-service.test.ts tools/test262-native.test.ts`; `pnpm check`                                                                                                                                                                                                                    |
| IE7   | None                                                                                         | The §9 verifier and the three unchanged verifiers; new reports                                                                                                                                                                                                                                                                 |

IE6a changes portable runtime source. It therefore needs a **fresh frozen self-build** with
identical stages before any IE6/IE7 native evidence is attributed to that snapshot (AGENTS.md).
Main decides whether it shares the build with the IE7a snapshot. It must not reuse the in-flight
`build-eval-entry-contracts-selfbuild-v1` result, whose snapshot predates the slot.

## 11. Unchanged native selections and source-frozen baselines (main's queue)

**Preconditions, in order:** the active Annex153/global75 reruns are recorded; the
`build-eval-entry-contracts` self-build is identical; IE6 reaches 42; the IE7 verifier gives 14
completed and 6 unsupported. If any fails, stop and record it; do not retry silently.

**Baseline (pre-IE7a snapshot, v6 adapter).** Freeze a snapshot containing IE6a but not IE7a. Its
capture has no marker, so its images are byte-identical to v6 except for the realm layout. Run:

```sh
node tools/test262-native-run.ts .tint-bootstrap/test262 language/eval-code/indirect 8
```

No report covers this selection yet.

**After IE7a (new frozen snapshot, v7 adapter):**

```sh
node tools/test262-native-run.ts .tint-bootstrap/test262 language/eval-code/indirect 8
node tools/test262-native-run.ts .tint-bootstrap/test262 annexB/language/eval-code/indirect 8
node tools/test262-native-run.ts .tint-bootstrap/test262 built-ins/eval 8
node tools/test262-native-run.ts .tint-bootstrap/test262 built-ins/Function 8   # shared-arena regression
```

**Comparison.** Per variant, against the pre-IE7a baseline,
[eval-family v1](../results/test262-eval-family-native-v1.json) (18 pass, 2 unsupported), the
annexB v9 prefix (158 unsupported, 2 pre-entry INFRA crashes) and the latest `built-ins/Function`
report. Report the 292 indirect-only variants as pass, fail or unsupported, with reasons.

**Blocking:** any pass → fail; any pass among the 4 mixed-direct variants
(`global-env-rec-eval.js` ×2, `private-identifiers-not-empty.js` ×2); `built-ins/eval` or
`built-ins/Function` losing a pass; any fault exit 13–17.

Keep pre-entry INFRA crashes separate. Every run produces a new immutable report. Update the
dashboard only after the complete reruns. Do not merge focused checks into totals.

**Observation only.** The 80 class-elements `*indirect-eval*` files wait for the next complete
class-elements rerun, and `language/eval-code/direct` stays S5's baseline.

## 12. Decisions, risks and unknowns

| ID  | Default                                                                       | Rejected                                                                                   |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| H1  | `installEvalCompiler` both as the install-once API and as the capture marker  | A bare assignment: no ordering check, and nothing in the snapshot to capture               |
| H2  | Gate on the runtime export, and require the evaluator export as a consequence | Gating on `createIndirectEvaluator` alone: it breaks the in-flight pre-slot snapshots      |
| H3  | One `ScriptEvaluationHost` object per realm, shared by both evaluators        | Separate hook literals (duplicated text, and they can drift) or a second arena or compiler |
| H4  | No evaluator, lowering, exit-code or resource change                          | A `non-string` fault (unreachable), or per-eval budgets                                    |
| H5  | Derive the label from the capture, so frozen v6 toolchains keep v6            | A constant v7 label (it would mislabel frozen pre-slot runs)                               |
| H6  | Prove S10 only in the hosted fixture                                          | A Test262 proxy: there is no `import()`, so no Test262 test observes it                    |

**Risks.**

1. **Record layout.** The `ErrorRealm` record grows, so the managed JIT record guard sees a new
   layout. A stale reified view would be rejected fail-closed, not misread. Expect the census and
   digest to move, and treat any **guard trip** in IE6 as a blocker, not a re-pin.
2. **Per-call compile cost** inside 300 s containment, with up to 5 textual eval calls per file.
   This is unmeasured natively; IE6 #81 records it. The shared 4 MiB arena may turn late
   `built-ins/Function` rows into `unsupported` (blocking, see §11).
3. **Completion values** become natively observable for the first time. `$completion`
   UpdateEmpty is unverified natively; IE6 #65 and IE7 c7 cover it.
4. **Annex B interaction.** The descriptor fix was diagnosed through `$262.evalScript`, but EDI's
   B.3.2.3 path through `lowerEvalScript` is **natively unknown** until IE7 c13 and the annexB
   selection run.
5. **Line drift.** Re-grep every anchor at the start of each slice. Main is landing work on the
   same files.
6. **Native unknowns** (none observed): whether `callObjectValue` on B's intrinsic from an A
   Script entry pushes exactly `{B, rA}` natively. The Node IE5 test shows it does in Node, and
   IE6 #69 is its first native check.

**Open (owner: main).** Should the IE6a census re-pin share a commit with any other surface work
that is landing (parent Q2)? Should `realm.unsupported` gain a subreason before the v7 reruns
(parent Q4)? Without one, guard rows and compile limits look the same in reports. The IE7
verifier's u1–u6 provide that distinction in the meantime.

## 13. Next planning task

Plan **S4-fn1: the general `Function` fallback on the shared evaluator service.** It factors
`callable()` into `lowerDynamicFunctionImplementation`, adds the lazy per-function compile cache,
and reuses H3's per-realm `ScriptEvaluationHost`, the carrier/identity decision (D1, invariant E)
and the 4 MiB arena. Its acceptance comes from the 147 unsupported `built-ins/Function` rows. Its
regression baseline is the post-IE7 `built-ins/Function` report from §11. Start it only after the
IE7 reruns are recorded.
