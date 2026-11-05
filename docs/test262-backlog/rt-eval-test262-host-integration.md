# RT-EVAL S2-ev1 EV5: wiring the Script evaluator into the native Test262 host

Status: **EV5a/EV5b implemented and natively validated.** All seven
[host integration cases](../results/native-test262-script-service-validation-v1.json)
produce their expected outcomes (six complete, one intentionally sticky unsupported).
Nine focused tests and all 3,946 workspace tests pass; type and formatting checks pass.
Unchanged conformance reruns are running on the frozen v6 toolchain with one uniform
300,000 ms containment budget. Baselines are [global-code 50/75](../results/test262-global-code-evalscript-baseline-native-v1.json)
and [Annex B global-code 136/153](../results/test262-annexb-global-code-evalscript-baseline-native-v1.json),
with only unsupported nonpasses. These host fixtures are not conformance passes.
Parent: [evaluator integration](rt-eval-evaluator-integration.md)
§11–§12. That plan's EV5 section is refined here. Where the two disagree on names, edits or
resources, **this plan replaces it**. The scope, the 31-file / 44-variant acceptance population and
the specification table in [S2-ev1](rt-eval-host-evalscript.md) §2–§3 are unchanged.

Captured 2026-11-05 on the live tree (549 portable files). Inputs:
[E4 v4](../results/native-managed-script-v4.json) `completed` (25.3 s, `db20a344…`, 546 files);
[injected host hooks](../results/native-script-evaluator-host-hooks-v1.json) `completed` (1.1 s,
548 files); [evaluator service, case 4](../results/native-script-evaluator-service-v1.json)
**present and `completed`** (60.6 s total, `55e4007c…`, 549 files, debugger connected, tracing
off; read once), the real `createScriptEntryCompiler` → `createScriptEvaluator` → `invoke` path;
[small stack v3](../results/native-managed-script-small-stack-v3-analysis.json): 1 MiB faults in
the recursive TypeScript checker, 16 MiB passes, nothing measured in between.

Probe (`/tmp/tint-ev5/p.mts`, Node only, reads the live snapshot): `runtimeSources()` returns
**11 runtimes, closing over 22 modules and 104,522 bytes** of source text. I ran nothing natively.
I touched no queue, journal, pause marker, snapshot, report or running process.

## 1. Answer in brief

1. **Edits are all in `tools/`**, plus one optional snapshot parameter in
   `tools/script-runtime-request.ts`. There are no compiler, lowering, runtime or engine source
   changes, so no frozen self-build is needed. The frozen v9 survey is out of reach (§9).
2. **Capability-gated.** The host wires the evaluator only when the snapshot exposes both
   `@tint/js-engine/script-evaluation#createScriptEvaluator` and
   `@tint/js-engine/native/script-compile#createScriptEntryCompiler`. Otherwise the generated
   host is unchanged (red test T2).
3. **Lazy, process-wide, no cache framework.** Each image embeds the runtime texts as data. The
   first `compile` in a process binds the surface, reads the directory, parses the 22 modules and
   builds one compiler in one guarded memo. Code is never cached.
4. **Realm-local evaluators.** `createRealmHost` builds one evaluator over its own
   `{realm, global}`. `$262.createRealm` therefore gets its own automatically.
   `other.evalScript` evaluates in `other` (10.3.1).
5. **One shared arena.** `executableStorage` (the dynamic-`Function` arena) is the evaluator's
   `storage` and the compiler's publish target. Proposed size: 4 MiB. Per-call budgets stay
   separate: Script 256 KiB, Function 64 KiB.
6. **Exit mapping.** Host faults use new exits **13–17** (`crash`, with the reason) and take
   precedence over every other result, so JS that catches the thrown `undefined` cannot hide
   them. Compile failures, limits and non-strings remain sticky `unsupported` (exit 10).
7. **Adapter label:** `native-script-v6-eval-script`.
8. **Resources need one recorded decision from main (§7).** The only passing evidence is
   256 MiB heap / 8 Mi allocations / 16,384 roots / 16 MiB stack. That is an observed pass, not
   a minimum. The 1 MiB stack fails, and the 60 s containment is below the 60.6 s case-4
   elapsed.
9. **Acceptance (§8).** Baseline first, on unchanged tools. The 44 variants and the 3
   child-realm variants are reported separately; the 4 direct-eval variants must stay
   `unsupported`; `built-ins/Function` is the shared-arena regression. No pass forecast.

## 2. Exact semantics to preserve (per call)

For a call `R.$262.evalScript(x)`, where R is the realm owning that function object:

| #   | Step (in order)                                                                  | Result                                                                        |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 0   | Wrapper reads `args[0]` and ignores the receiver                                 | missing argument = `undefined`                                                |
| 1   | `R.unsupported` already set                                                      | throw `undefined` (sticky); **0 parses, 0 compiles**                          |
| 2   | `typeof x !== "string"`                                                          | sticky unsupported                                                            |
| 3   | domain check: captured = `currentContextDomain()` = `executableStorage.domain`   | unsupported                                                                   |
| 4   | `parseScript(createSourceTextView(x))` on **raw UTF-16** (no `TextEncoder`)      | `SYNTAX_ERROR`/`LEXICAL_ERROR` → R's SyntaxError; `LIMIT`/other → unsupported |
| 5   | `lowerScript(module, x)` (same string, for function source text)                 | `EARLY_ERROR` → R's SyntaxError; other → unsupported                          |
| 6   | `compile(module)`: lazy init on first use (§4), prepare, budget, link, publish   | throw → fault `compile-threw`; `{ok:false}` → unsupported; no record          |
| 7   | domain re-check                                                                  | unsupported                                                                   |
| 8   | **fresh** `createScriptRecord(R, undefined)`                                     | one per successful compile                                                    |
| 9   | `invoke(address, {$imports: table, $argument0: R's global, $argument1: record})` | GDI runs first, inside the entry; its errors are throw completions from R     |
| 10  | `activeContext` is the same as before the call                                   | otherwise fault `context-leak`                                                |
| 11  | `completion(raw)` returns `none`, `throw`, `unsupported`, or none of those       | return value / rethrow the **identical** value / sticky / fault               |
| 12  | no `drainScriptJobs` and no `clearKeptObjects`                                   | jobs stay queued for the host's single drain after the test Script            |

**Global environment.** R's `global` is the same `GlobalEnvironment` that `runNativeScripts`
passes to every harness and test Script (`RealmHost.global`). Lexical declarations therefore
persist across Scripts and across `evalScript` calls in both directions.

Steps 1–12 already exist in `packages/js-engine/src/script-evaluation.ts`; EV5 only supplies the
host authorities and re-implements none of them in generated text.

**Host fault versus ordinary JS.** After `host.fault(reason)`, the evaluator throws `undefined`
through `rejectUnsupportedExecution`, and JS can catch that. The authoritative signal is the
process-wide `scriptState.fault`. `runNativeScripts` checks it at each checkpoint, **before**
the realm-unsupported checks and the result checks (§5). A test that swallows the throw and
finishes with 42 or `Test262:AsyncTestComplete` still exits 13–17.

**Direct string eval stays unsupported.** EV5 does not touch `installEvalIntrinsic` or the
direct-eval rejection. This keeps the 4 S5 variants `unsupported`. Any future indirect `eval`
must reject the direct-eval candidate at the call site **before** it reaches this evaluator
([S3-ie1](rt-eval-indirect-eval.md) owns that guard). EV5 plans no indirect eval.

## 3. Edit list: `tools/test262-native.ts`

### 3.1 Capability capture (Node side)

Add next to `capturedEngineProvider` (`:753`):

```ts
const engineScriptEvaluationSpecifier = "@tint/js-engine/script-evaluation";
const engineScriptCompileSpecifier = "@tint/js-engine/native/script-compile";
export interface NativeScriptEvaluation {
  readonly evaluation: string; // captured provider module id
  readonly compile: string;
}
/** Both entries or neither; a half-captured contract is a toolchain error. */
export function capturedScriptEvaluation(
  snapshot: WorkspaceSourceSnapshot,
): NativeScriptEvaluation | undefined;
```

Resolve each entry with `capturedPublicEntry(snapshot.publicEntries ?? snapshot.mappings, …)`.
Neither resolved → `undefined` (older snapshots, including every frozen v9 input). Exactly one
resolved, or a factory missing (checked with the existing `capturedEngineProvider`) → throw.

`createNativeTestBuilder` and `createNativeBatchBuilder` call this once and thread the result
through `createNativeImageBuilder`, `prepareNativeBatch` and `nativeTestRuntime` as a new
trailing optional parameter `scriptEvaluation?: NativeScriptEvaluation`. That follows the
existing positional pattern for `weakProvider` and the others.

### 3.2 Split text from parse (testability)

Extract `nativeTestRuntimeSource(...same parameters...): string` and keep
`nativeTestRuntime(...)` as `parsedNativeHost(id, nativeTestRuntimeSource(...), deps)`. Byte
equality and ordering checks can then assert on text (T2, T5). This is a pure refactor; the
generated text does not change.

### 3.3 Two shared generated modules (emitted once per image)

`test262-script-host` is the same declaration text as E4's `script-host`
(`verify-hosted-managed-script.ts:50-58`). Its dependencies are `contracts` →
`nativeCompilerModule`, `objects` → `objectModule` and `frame` → `scriptEntryFrameModule`.

```text
export function bindScript():ManagedSurfaceExport{throw "MANAGED_SURFACE_UNBOUND";}
export function invoke(address:number,frame:ScriptEntryFrame):unknown{throw "UNBOUND_SCRIPT_INVOKE";}
export function completion(value:unknown):ScriptCompletionRecord|undefined{throw "UNBOUND_COMPLETION_VIEW";}
```

`test262-script-sources` has no dependencies:

```text
export const scriptRuntimeTexts:readonly {readonly id:string;readonly text:string;
  readonly dependencies:readonly (readonly string[])[]}[]=<JSON>;
export const scriptRuntimeSources:readonly RuntimeSource[]=<JSON runtimeSources()>;
export const scriptRuntimeGlobalNames:readonly string[]=<JSON scriptRuntimeGlobals>;
```

**The texts must come from the build snapshot.** Build them as E4 does (`:36-47`), but read
`snapshot.inputs` and `workspaceModules(…, snapshot)` from the builder's own snapshot, never from
live files. A run that restores `TINT_TEST262_SOURCES` must embed that snapshot's bytes.

Memoize it in the builder closure like `runtimeModules ??=` (`:887`): one computation per builder.

`prepareNativeBatch` pushes both modules once, right after `test262-runtime`;
`createNativeTestBuilder` adds them beside its runtime. Without `scriptEvaluation`, neither exists.

### 3.4 Generated runtime text (only when `scriptEvaluation` is set)

**Imports added.** The `memory` import gains `nativeValueFunctionDescriptor` and
`nativeValueFunctionSignature`.

```text
import {createScriptEvaluator,type ScriptEvaluator,type ScriptEvaluationFault,type ScriptEntryCompilation} from "@tint/js-engine/script-evaluation";
import {createScriptEntryCompiler} from "@tint/js-engine/native/script-compile";
import {bindScript,invoke as invokeScript,completion as viewScriptCompletion} from "script-host";
import {scriptRuntimeTexts,scriptRuntimeSources,scriptRuntimeGlobalNames} from "script-sources";
import {readManagedSurfaceDirectory,type ManagedSurfaceLayoutRuntime} from "contracts";
import {parseModule,type Module} from "syntax";
import {createSourceTextView} from "source";
import type {SourceModule} from "module-model";
```

**Prelude**, after `executableStorage`. Every name here is an existing API:

```text
const scriptState:{started:boolean;compile:((module:Module)=>ScriptEntryCompilation)|undefined;
  table:unknown;fault:ScriptEvaluationFault|undefined}={started:false,compile:undefined,table:undefined,fault:undefined};
function scriptCompiler():(module:Module)=>ScriptEntryCompilation {
 const existing=scriptState.compile;if(existing!==undefined)return existing;
 if(scriptState.started)throw "SCRIPT_COMPILER_POISONED"; // poison first, as code-storage does
 scriptState.started=true;
 const exported=bindScript();
 const read=readManagedSurfaceDirectory(exported,"scriptRuntime",{domain:():number=>currentContextDomain(),
   descriptor:(v:unknown):number=>nativeValueFunctionDescriptor(v),signature:(v:unknown):number=>nativeValueFunctionSignature(v)});
 if(!read.ok||read.value.domain!==executableStorage.domain)throw "SCRIPT_SURFACE_READ";
 const modules:SourceModule[]=[];
 for(const source of scriptRuntimeTexts){ /* E4 :128 loop verbatim; parse failure throws "SCRIPT_RUNTIME_PARSE" */ }
 const runtime:ManagedSurfaceLayoutRuntime={modules,runtimes:scriptRuntimeSources,globals:scriptRuntimeGlobalNames};
 const compile=createScriptEntryCompiler({read:read.value,runtime},{domain:():number=>currentContextDomain(),
   storage:executableStorage,readWord:(a:number,l:number,o:number):number=>readMemoryWord(a,l,o)},
   {maxScriptCodeBytes:${nativeTestResources.maxScriptCodeBytes}});
 scriptState.table=exported.table;scriptState.compile=compile;return compile;
}
function scriptFaultExit():number {
 const f=scriptState.fault;if(f===undefined)return 0;
 return f==="compile-threw"?13:f==="invoke-threw"?14:f==="completion-view"?15:f==="completion-kind"?16:17;
}
```

**Classification inside the memo.** Any throw during lazy initialisation (`bindScript` unbound,
directory read or domain mismatch, runtime parse failure, a configuration `RangeError` from
`createScriptEntryCompiler`) crosses `host.compile`, and the evaluator turns it into
`fault("compile-threw")`. That is deliberate: each is a broken image or host invariant and must
not look like an unsupported test. The poison flag stops a half-finished init from re-running.
Initialisation is per process (= per selected case) and serves every realm.

**`RealmHost` and `createRealmHost` (`:326-389`).** Add `readonly evaluate:ScriptEvaluator`;
after `realm.dynamicFunctionCompiler=…`, construct:

```text
const evaluate=createScriptEvaluator({realm,global},{
 domain:():number=>currentContextDomain(), storage:executableStorage,
 table:():unknown=>scriptState.table,
 compile:(module:Module):ScriptEntryCompilation=>scriptCompiler()(module),
 invoke:(address,frame):unknown=>invokeScript(address,frame),
 completion:(value)=>viewScriptCompletion(value),
 fault:(reason):void=>{if(scriptState.fault===undefined)scriptState.fault=reason;},
});
```

Return `{object,global,realm,hooks,evaluate}`. Construction only captures the domain; realms
that never call `evalScript` pay nothing. `table` is read only after a successful compile.

**`installRealmHost` (`:391-415`).** The `evalScript` callable body becomes
`return host.evaluate(args[0]);`. `createRealm` keeps calling `createRealmHost(realm,realms)`.
The child gets its own evaluator, shares `symbolRegistry`, `agent` and `executableStorage`, and is
pushed onto `realms`, so the existing sticky-unsupported sweep covers it.

**`runNativeScripts`.** Insert `const fe=scriptFaultExit();if(fe!==0)return fe;` at four points:

1. after each harness Script result, before `result.error==="unsupported"`;
2. after the test Script, before the `realms` unsupported sweep;
3. after `drainScriptJobs`, before the second sweep;
4. after `if(jobFailure!==0)`, immediately before the final `return`.

Point 4 duplicates point 3 today and guards against later reordering.

### 3.5 Exit mapping (`nativeExitOutcome`, Node side)

Add, before the `code === 10` branch, a mapping of `13..17` to `{kind:"crash", detail:"native
Script evaluator host fault: " + reason}`, with reasons in the order `compile-threw`,
`invoke-threw`, `completion-view`, `completion-kind`, `context-leak`.

Codes 13–19 are unused today (`:93-153`). Status 18 and 19 stay "unexpected native exit status".

| Situation                                                                                                   | Exit                       | Outcome                                |
| ----------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------- |
| parse/lex error, lowering early error, GDI error                                                            | none (JS throw completion) | ordinary test result                   |
| `LIMIT`/`UNSUPPORTED*`, compile `{ok:false}` (including `budget`, arena-full `publish`), non-string, domain | 10                         | `unsupported` (sticky, even if caught) |
| host fault (5 reasons)                                                                                      | 13–17                      | `crash`, reason in detail              |
| in-image trap, stack fault, heap exhaustion while compiling                                                 | debugger outcome as today  | `crash` / `timeout`                    |

### 3.6 Image builder (`createNativeImageBuilder`, `:870`)

Each item applies only when `scriptEvaluation` is set.

- **`runtimeModules` roots:** both providers, `packages/source/src/text.ts`,
  `scriptEntryFrameModule`, `packages/js-engine/src/lowering/index.ts` and
  `packages/typescript/src/modules/model.ts`.
- **`nativeTestRuntime` dependency map:** both engine specifiers; `script-host` →
  `test262-script-host`; `script-sources` → `test262-script-sources`; `contracts` →
  `nativeCompilerModule`; `syntax` → `syntaxModule`; `source`; `module-model`.
- **`hostBindings`:** add these three (`context-domain`, `memory-read-word`, the three executable
  bindings and `external-memory-register` already exist at `:924-1037`):
  - `nativeValueFunctionDescriptor` → `native-value-function-descriptor`;
  - `nativeValueFunctionSignature` → `native-value-function-signature`;
  - `{module:"test262-script-host",name:"invoke",operation:"executable-call-managed"}`.
- **`recordBindings`:** `{module:"test262-script-host",name:"completion",operation:"view"}`. The
  three object views already exist.
- **`runtimes`:**
  `{module:"test262-script-host",namespace:"script-host-view",retainedExports:["completion","invoke"]}`.
- **`managedSurfaces`:**
  `[createScriptRuntimeRequest({module:"test262-script-host",name:"bindScript"},true,snapshot)]`,
  memoized in the builder closure.

### 3.7 `tools/script-runtime-request.ts`

Add the optional parameter
`createScriptRuntimeRequest(bind, frame = true, snapshot?: WorkspaceSourceSnapshot)` and pass it
to `workspaceModules(…, snapshot)`. Existing callers are unchanged. Without it, a restored-snapshot
run would derive the surface from live files.

### 3.8 `tools/test262-native-run.ts` and resources

- Change `engine` and `adapter` at `:95` and `:279` to `native-script-v6-eval-script`.
- `nativeTestResources` gains `maxScriptCodeBytes: 262144`, which `executionResources` records
  automatically. The remaining values are decided in §7.

## 4. Lazily retained sources: why this shape

The image holds 104,522 B of source text as one data module shared by every case in the batch.
Parsing is paid at the first `compile` of a process and is zero for tests that never call
`evalScript`. The memo is module-level `scriptState`; one process runs one case, so it is per
image run. Failure is poison-first and never retried. There is **no** code cache: each successful
call compiles and publishes (`var-collision`: up to 8). Texts, the surface request and module
roots all come from the builder's snapshot.

The managed surface and directory publication still enter **every** image while the capability
is advertised. Their build-time cost per batch is unmeasured. Compare the `compilation.batches`
timings of the `built-ins/Function` baseline and the EV5 run (§8); do not estimate. Do not detect
`evalScript` in test text to drop the surface per batch. Text detection is brittle, for example
with computed property names, and it would make image content depend on test text.

## 5. Shared Function/Script code arena

- **One owner.** `executableStorage = createEngineCodeStorage(…, executableMemoryBytes)` already
  serves dynamic `Function`. It maps lazily on the first publish, aligns to 16 bytes, never
  recycles, and returns `undefined` when full. The Script compiler publishes through the same
  object, so both paths share the same domain checks and the same failure meaning.
- **Budgets stay per call:** Script ≤ 262,144 B (`budget` stage) and Function ≤ 65,536 B. Both
  are unsupported when exceeded.
- **Capacity.** Increase `executableMemoryBytes` from 1 MiB to **4 MiB** (16 maximum-size
  Scripts). The largest probe Script is about 116 KB in Node; the heaviest acceptance file makes
  8 calls; 8 × 256 KiB = 2 MiB, plus Function code. A full arena gives `publish` → unsupported,
  never a fault. Only the lazy virtual mapping grows, and only for tests that publish.
- **Invariant tests:** `maxScriptCodeBytes > maxDynamicCodeBytes`, and
  `executableMemoryBytes ≥ 8 × maxScriptCodeBytes` (T6).

## 6. Red-first tests (Node; write before any edit)

Extend `tools/test262-native.test.ts`. It already uses `executionPlan`, `prepareNativeScripts`,
`prepareNativeBatch`, `nativeExitOutcome` and `workspaceSources`. Copy the AST-inspection style of
`:278` and `:374`.

| #   | Test                                                                                                                                                                                                                                                                                                                                                                       | Fails today because                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| T1  | `nativeExitOutcome(13..17)` → `crash` with each reason; `18` → "unexpected native exit status 18"; existing 10/11/12/42 unchanged                                                                                                                                                                                                                                          | 13 is generic                            |
| T2  | Without `scriptEvaluation`: `nativeTestRuntimeSource(...)` is byte-identical to the default call, has no `script-evaluation` import, and the `evalScript` body still calls `rejectUnsupportedExecution`; no `test262-script-*` modules                                                                                                                                     | function missing                         |
| T3  | With `{evaluation,compile}`: imports resolve to the two engine files; `test262-script-host` exports `bindScript`/`invoke`/`completion` with throwing bodies; `test262-script-sources` is emitted **once** for a 2-case batch                                                                                                                                               | parameter missing                        |
| T4  | `capturedScriptEvaluation(workspaceSources())` returns both live providers; a snapshot with `publicEntries` filtered to drop one entry throws; drop both → `undefined`                                                                                                                                                                                                     | function missing                         |
| T5  | Generated text order: in `runNativeScripts`, every `scriptFaultExit()` comes before the matching `active.unsupported` / `result.error` check; `createRealmHost` calls `createScriptEvaluator` exactly once; the `evalScript` body is `host.evaluate(args[0])`; the evaluator is constructed with `storage:executableStorage` (the same identifier as the dynamic compiler) | no evaluator                             |
| T6  | `nativeTestResources.maxScriptCodeBytes === 262144`; the §5 invariants; the §7 values exactly as main records them                                                                                                                                                                                                                                                         | field missing                            |
| T7  | `createScriptRuntimeRequest(bind,true,snapshot)` deep-equals the live call on the live snapshot; the embedded texts byte-equal `snapshot.inputs` for 22 modules / 11 runtimes (counts asserted from `runtimeSources()`, not pinned)                                                                                                                                        | parameter missing                        |
| T8  | `createNativeBatchBuilder(workspaceSources())` does not throw (`:438` pattern)                                                                                                                                                                                                                                                                                             | stays green; a guard against regressions |
| T9  | Adapter label: the run tool's start record and report use `native-script-v6-eval-script` (text assertion on `test262-native-run.ts`)                                                                                                                                                                                                                                       | label is v5                              |

Then `pnpm build`, the focused tests and `pnpm check`; all 3,937 workspace tests stay green.

**Native verification fixture (EV5b, main runs it).** Add `tools/verify-test262-native-eval-script.ts`,
modelled on `verify-test262-native-realms.ts`. It uses `createNativeBatchBuilder`,
`NativeImageRunner` and `nativeTestResources`, with a `node:vm` reference whose
`$262.evalScript = s => new vm.Script(s).runInContext(ctx)`.

One case per row, each expected to exit 42 unless noted:

1. `$262.evalScript("1+2")===3`, then `let` persistence across two calls and the harness global.
2. `try{$262.evalScript("let a;let a;")}catch(e){e instanceof SyntaxError}`, plus GDI TypeError
   on a non-configurable global function.
3. A child realm: `r.evalScript("var w=1")` leaves `w` absent in the parent; its SyntaxError is
   `r.global.SyntaxError`.
4. ``$262.evalScript("t`x`")`` caught, then valid source → **exit 10** (sticky; the surrounding
   `try` cannot pass it).
5. `$262.evalScript("Promise.resolve().then(()=>{globalThis.j=1})"); j===undefined` inside the
   test, plus an async `$DONE` that sees `j===1`. This shows the jobs are drained only by the host.
6. A raw lone-surrogate literal: `.charCodeAt(0)===0xD800`.
7. `Function("return 1")()` followed by `evalScript("2")`, in one process (shared arena).

Status-only reporting: record the outcome of any unexpected exit; main owns the debugging.

## 7. Uniform resource policy (decision for main)

`nativeTestResources` is documented as "uniform … not tailored to tests" (`:67-68`). Build-time
fields (`managedBytes`, `allocationCapacity`, `rootCapacity`, `stackBytes`) are compiled into
**every** image.

| Field                   | Test262 today | Observed passing (E4 v4, service v1)        | Observed failing                                    | Proposal                                                      |
| ----------------------- | ------------- | ------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| `managedBytes`          | 64 MiB        | 256 MiB                                     | 64 MiB (E4 v1, v2: allocation / collection)         | 256 MiB                                                       |
| `allocationCapacity`    | 1 Mi          | 8 Mi                                        | 1 Mi (E4 v1); 4 Mi still stopped in collection (v2) | 8 Mi                                                          |
| `rootCapacity`          | 4,096         | 16,384                                      | none observed at 4,096; **never tested**            | 16,384 (the only evidence)                                    |
| `stackBytes`            | 1 MiB         | 16 MiB                                      | 1 MiB (small-stack v3: recursive checker prologue)  | 16 MiB                                                        |
| `executableMemoryBytes` | 1 MiB         | 1 MiB (fixture arena)                       | —                                                   | 4 MiB (§5)                                                    |
| `maxScriptCodeBytes`    | —             | 262,144                                     | —                                                   | 262,144                                                       |
| `timeoutMs`             | 60,000        | case 4 total 60.6 s; E4 case 0 total 25.3 s | —                                                   | **undecided**; set per run with `TINT_TEST262_CONTAINMENT_MS` |

**These are observed passes, not minimums.** Nothing was measured between 1 MiB and 16 MiB of
stack, or between 64 MiB and 256 MiB of heap. The 60.6 s covers launch with a connected
debugger, parsing 22 modules, the directory read, three successful compile/invoke pairs, a
SyntaxError, churn and an unsupported pair. It is **not** a compile time. The only firm conclusion is that the 60 s default is not
demonstrated to be enough. `annexB/language/global-code` files make 3 calls each, and
`var-collision` makes 8.

**Options.**

- **(A) Recommended.** Adopt the observed-passing set uniformly with EV5 and record it in one
  `nativeTestResources` change under the v6 label. Main picks one containment value for each
  acceptance run through the existing environment variable. Cost: 4× heap reservation per
  process. Risk: a 16× stack may change unrelated deep-recursion tests (slower exhaustion, more
  timeouts) and GC-sensitive tests; the `built-ins/Function` comparison plus one recursion-heavy
  control chosen by main detects this, and a pass → fail change there blocks.
- **(B)** Keep today's set. Every `evalScript` call is then expected to fault or crash
  in-image. That makes the wiring unobservable, so it is not useful.
- **(C)** Shrink the in-image compile first (prune imports, avoid re-parsing 22 modules), then
  measure. That is a separate compiler task and would need a self-build.

Never tune per test, per directory or per retry. Totals from runs under different resource sets
are not combined. A whole-suite total under (A) comes only from a new full survey after v9
retires.

## 8. Acceptance and regression runs (serial, scheduled by main)

**Population (unchanged, [S2-ev1 §3](rt-eval-host-evalscript.md)).**

- **Gating:** 31 files → 44 variants: 12 `language/global-code/script-decl-*` files plus
  `lex-deletion` (25); 16 annexB `*-global-init` plus annexB `lex-collision` (17); the annexB
  direct-eval `no-collision` file (2).
- **Must stay `unsupported`:** 4 variants from 2 files (`script-decl-lex-var-declared-via-eval.js`
  and annexB `direct/script-decl-lex-no-collision.js`), because they need direct string eval. A
  pass there is a defect.
- **Separately reported, non-gating:** 3 child-realm variants,
  `built-ins/Proxy/revocable/tco-fn-realm.js` (1) and `intl402/FallbackSymbol/per-realm.js` (2).
  The second uses the completion value.

**Baseline first, on unchanged tools.** The current tools still reject `evalScript`. Each
command writes a new immutable report under `docs/results/`, using its own new journal and
source-capture paths. Never reuse v9 paths.

```sh
TINT_TEST262_CAPTURE_SOURCES=.tint-bootstrap/evalscript-baseline-source-v1.json \
TINT_TEST262_JOURNAL=.tint-bootstrap/evalscript-baseline-<sel>-v1.jsonl \
  node tools/test262-native-run.ts .tint-bootstrap/test262 <sel> 8 > docs/results/test262-evalscript-baseline-<sel>-v1.json
```

Selections: `language/global-code`, `annexB/language/global-code`,
`annexB/language/eval-code/direct/script-decl-lex-no-collision.js`,
`built-ins/Proxy/revocable/tco-fn-realm.js`, `intl402/FallbackSymbol/per-realm.js`,
`built-ins/Function` and main's recursion control. Use the first capture for every baseline selection (`TINT_TEST262_SOURCES`).

**After EV5 (tests green, EV5b exits as expected).** Capture
`evalscript-source-v1.json` once, then run the same selections under the §7 set and one recorded
containment value, with outputs `test262-evalscript-<sel>-v1.json`.

**Reporting.** The 44 variants as pass / fail / unsupported / crash / timeout with reasons; the
3 child-realm variants in their own table; per-variant differences from the baseline for
`built-ins/Function` and the control (any pass → fail blocks); batch compilation elapsed before
and after (§4). No dashboard or total updates, no pass forecast. Changes attributable only to
resources are called out; if needed, isolate them with one resources-only run (tools unchanged
except §7).

## 9. Frozen survey isolation

- PID 28307 runs
  `.tint-bootstrap/node-toolchain-native-behavior-v9-collations-v1/tools/test262-native-run.ts`.
  That is its own frozen copy, verified file by file against its `toolchain.json` by
  `frozenNativeRunIdentity` (`native-run-journal.ts:201-233`). Live `tools/` edits cannot reach
  it.
- EV5 and EV5b write nothing under that directory, `test262-full-suite-native-v9.*`, its journal
  or pause marker, and never signal, resume or re-freeze it. A v10 toolchain is out of scope.
- `capturedScriptEvaluation` returns `undefined` for older snapshots, so even a hypothetical
  live-tool run over an old capture generates the old host text (T2).
- Native runs share the machine with the paused survey. Main schedules them serially. CPU
  contention changes `elapsedMs` and can change timeouts, so the containment value is chosen
  for the run, not per variant.
- The frozen self-host checkpoint (546 files, `db20a344…`, stages 69,977,810 B identical) and
  smoke 42 are unaffected. EV5 changes no compiler or lowering source.

## 10. Risks and unknowns

1. **The resource blast radius (§7)** is the dominant risk, detectable only by regression runs.
2. **Per-batch build cost** of the surface and directory is unmeasured (§4).
3. **Per-call native compile time is unmeasured**; 3-call and 8-call files may time out under any
   containment value. If so, report status only.
4. **Parser gaps** could surface valid text as SyntaxError
   ([integration](rt-eval-evaluator-integration.md) §5). Re-check that the 31 files' `evalScript`
   texts parse on the landing snapshot (Node).
5. **Prepare `profile` failures**, for example tagged templates or generators, are expected to
   appear as `unsupported`. The annexB global-init sources are untagged templates that call
   harness functions; their native prepare outcome is unknown.
6. **`per-realm.js`** also needs a per-realm Intl fallback symbol, unrelated to this wiring.
7. **The realm/global pairing** is a host invariant; EV5b case 3 observes it.

## 11. First implementation slice and next planning task

**Slice EV5a (Node only, red first).**

1. Write T1–T9. Confirm they fail.
2. Make the §3.1–§3.7 edits and the label change, plus `maxScriptCodeBytes` and the §7 values
   once main records the decision.
3. Run `pnpm build`, the focused tests and `pnpm check`.

Then EV5b (native fixture), then the §8 runs. Update `docs/test262-runner.md`,
`docs/native-code-loading.md` and `docs/test262-inventory.md` with the label in the same change.
Status tables change only after the acceptance runs.

**Next focused planning task: "EV5 resource-sensitivity control selection and containment
choice."** Planned in [resource controls](rt-eval-resource-controls.md), which supersedes §8's run list.

From existing v9 observations (read-only), pick the recursion- and GC-sensitive control selection
and its baseline, define the single resources-only isolation run, and specify how main derives one
containment value from EV5b per-case `elapsedMs`, without claiming compile time or minimum
resources.
