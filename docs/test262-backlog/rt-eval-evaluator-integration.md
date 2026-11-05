# RT-EVAL S2-ev1 refresh: integrating the Script evaluator with the implemented managed entry

Status: **EV1–EV3 implemented.** The evaluator's injected host-hook fixture
[passes natively](../results/native-script-evaluator-host-hooks-v1.json). The engine-owned
frame preserves the directory digest and emitted Script bytes; the production compile
helper and evaluator pass 33 focused Node tests, with all 3,937 workspace tests green.
EV4 [passed the real compile/link/publish/invoke path](../results/native-script-evaluator-service-v1.json);
EV5 Test262 wiring follows.
These are infrastructure checks, not new Test262 passes.

E4 [passed natively](../results/native-managed-script-v4.json) with the record-identity fix.
The research observations below retain their original capture date; the historical
121s includes launch and is not compile-only timing.

This refreshes EV1–EV4 of
[S2-ev1 `$262.evalScript`](rt-eval-host-evalscript.md) against the APIs that now exist. Inputs:
[native Script execution (E4)](rt-eval-native-script-execution.md), the
[managed JIT entry](rt-eval-managed-jit-entry.md) and current source. Wherever this plan and the
older one disagree on names, counts or the source-text step, **this plan replaces the older one**.
Scope, acceptance population and the specification table (§2 there) are unchanged.

Captured 2026-11-04, about 23:35 PST, on the live tree: 546 portable files (E4 v3 snapshot
`588736f8…`). The frozen [self-host checkpoint](../results/managed-jit-entry-selfhost-checkpoint-v1.json)
(545 files) **predates** the E4a gate and the retained forwarders.

Read-only probes are in `/tmp/tint-evalscript-int` (`taxonomy`, `fidelity`, `closure`, `.mts` with
`.txt` output). They read `src`, plus `dist` through `managed-script-fixture.ts`, as E4 does.
**Every probe number is Node-only and non-native.** Nothing was built, emitted or run natively,
and no queue, pause, snapshot or report was touched.

## 1. Answer in brief

1. **E4 has not passed.** The newest run, [native-managed-script-v3](../results/native-managed-script-v3.json),
   used 256 MiB heap, 8 Mi allocation capacity, 16,384 roots and 16 MiB stack. It **finished
   in-image parse, lowering, prepare, link and publish**, then trapped (`brk #0`) in JIT code
   during the first `invoke`. Outcome: `crash` after 121 s (§3). EV4 and EV5 wait on E4; EV1 does
   not.
2. **Most of the pipeline now exists.** It replaces the planned `bindScriptSurface`,
   `scriptRuntimeSurfaceRequest` and `script-entry.ts` stubs:
   - `prepareManagedSurfaceEntry` (internal, `compiler/src/native/managed-jit-entry.ts:55`);
   - `createScriptRuntimeRequest` (`tools/script-runtime-request.ts:46`);
   - the fixture-owned `ScriptEntryFrame` (`tools/script-entry-frame.ts:3`);
   - the E4 run sequence (`tools/verify-hosted-managed-script.ts:97-145`).
3. **Source fidelity: no UTF-8 step.** Parse `createSourceTextView(source)` on the raw JS string,
   as E4 and `parseDynamicFunction` already do. A lone U+D800 inside quotes survives parse,
   lowering and emission. Outside a literal it is a genuine `LEXICAL_ERROR`. `TextEncoder` would
   have produced U+FFFD (§4).
4. **Taxonomy (§5).**
   - SyntaxError only from: parse `SYNTAX_ERROR`/`LEXICAL_ERROR`; lowering `EARLY_ERROR`; GDI.
   - Unsupported: every `LIMIT`/`UNSUPPORTED*`, every compile stage, domain failures, non-strings.
   - A broken host invariant is a fault.
   - **New:** an already-unsupported realm short-circuits before parsing.
5. **EV1 contract (§6).** `createScriptEvaluator(context, host)` in `js-engine`. It reuses the
   `createDynamicFunctionCompiler` pattern: shared `EngineCodeStorage`, the same domain check and
   a `{realm,global}` context. It adds no scheduler, loader or cache.
6. **Compiler export: no narrow subpath.** A narrow subpath would save only `index.ts` itself, 1 of
   about 472 files (probe), and `dynamic-function` already brings `@tint/compiler/native` into every
   Test262 image. Export `prepareManagedSurfaceEntry` from `native/index.ts` instead (EV3).
7. **Resources need a decision from main.** The in-image compile failed at 64 MiB (v1, v2). At
   256 MiB it took 121 s, against Test262's 64 MiB, 1 MiB stack and 60 s containment.
   `maxScriptCodeBytes` = 262,144 stays separate from `maxDynamicCodeBytes` = 65,536 (§11).
8. **First slice: EV1** (Node only, red first, §7). **Next planning task:** E4 v3 trap triage and
   E4b/E4c sizing (§14).

## 2. Old names versus actual APIs

| S2-ev1 (planned)                                            | Actual today                                                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bindScriptSurface()` in `js-engine/native/script-entry.ts` | Build-bound `bindScript():ManagedSurfaceExport` in a generated `script-host` module; it is the `managedSurfaces[].bind` target (`verify-hosted-managed-script.ts:55-64,214`)    |
| `invokeScriptEntry`, `viewScriptCompletion`                 | `script-host` `invoke` (`executable-call-managed`) and `completion` (record `view`), both in `retainedExports` (`:190-194,249-252`)                                             |
| `ScriptEntryFrame` in `js-engine`                           | Fixture-owned text `scriptEntryFrameSource`, selected as `{module:"surface-helpers",name:"ScriptEntryFrame"}` (`script-runtime-request.ts:107-112`)                             |
| `scriptRuntimeSurfaceRequest(snapshot,{frame,bind})`        | `createScriptRuntimeRequest(bind, frame = true)`; values and types come from `scriptRuntimeSurface()`, classified by the linked export namespace                                |
| "nine collection runtimes"                                  | `runtimeSources()` returns **11** runtimes. Their closure is **22** embedded modules. `ManagedSurfaceLayoutRuntime = {modules, runtimes, globals}` (`managed-directory.ts:38`)  |
| `compileScriptEntry(...)`                                   | Not present. E4 inlines `prepareManagedSurfaceEntry` → `linkManagedSurfaceModule(read,native,readWord,currentContextDomain())` → `storage.publish(linked.code)` + `entryOffset` |
| Prepare failure stages                                      | `{ok:false,error:{stage:"profile"\|"prepare"\|"lower"\|"emit"\|"select",message}}` (`managed-jit-entry.ts:43-51`)                                                               |
| 53 imports, 115,864 B (E4 Script)                           | Re-measured: still 115,864 B, counts 25/3/15/12, 53 managed imports, about 0.53 s in Node                                                                                       |

Retained record views: E4 binds `viewObjectValue`, `viewSymbolValue` and `viewBigIntValue` as
`view` records retained in `ordinary-object` (`:195-204`). `managed-aot.ts:421-427` forwards each
retained surface target privately. The [retained-surface fixture](../results/native-retained-surface-v1.json)
completed in 59.5 s. EV5 must copy these bindings exactly.

## 3. E4 evidence (read once, near drafting)

| Report                                                | Resources (heap / alloc cap / roots / stack) | Elapsed | Outcome and stopping point                                                                                  |
| ----------------------------------------------------- | -------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `native-managed-script-v1` + allocation diagnostic v1 | 64 MiB / 1 Mi / 16,384 / 16 MiB              | 126.4 s | Allocation stop; fixups 532,480/532,480; 22.24 MiB discovered live                                          |
| `native-managed-script-v2` + allocation diagnostic v3 | 64 MiB / 4 Mi / 16,384 / 16 MiB              | 245.4 s | In syntax rewriting (`rewrite.ts:116`); collection committed with 33,554,416/33,554,432 live; request 144 B |
| `native-managed-script-v3` + execution diagnostic v3  | 256 MiB / 8 Mi / 16,384 / 16 MiB             | 121.1 s | `brk #0` at an unsymbolized arena address during the first `invoke`                                         |

The v3 backtrace (`.tint-bootstrap/e4-full-v3/debugger.log`) is: JIT → `jobs.ts:65 runScriptContext`
→ JIT → JIT → `script-host:invoke` → `fixture:run`, at generated-fixture line 64
(`const first=completion(invoke(address,frame))`). Every check before line 64 returns a status on failure, so in-image statuses 60–75 all passed under
v3 resources. That covers the read, storage, 22-module parse, Script lowering, prepare, 53
imports, the 256 KiB cap, both negative links, the link and the aligned publish.

The next instruction, `str xzr,[sp,#0x48]`, fits an IR `trap` terminator (`codegen/aarch64/scalar/index.ts:5481`).
The catch and throw-exit checks (`:5734`, `:5754`) are followed by loads instead. **This reading is
unconfirmed; main owns the analysis.** The root slots are zero, so no collector failure was
recorded. **E4 acceptance has not passed**, and the 1 MiB `--small-stack` build has never run.

## 4. Source fidelity (probes `taxonomy`, `fidelity`)

| Input                                     | Result                                                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `var s='<U+D800>';s.length;` (raw unit)   | AST and lowered literal are unit `d800`; prepare ok (44,408 B, 27 imports); code holds LE `00 d8` (heuristic byte search; codegen keeps UTF-16 pool units, `index.ts:5978`) |
| `'\uD800'` (escape)                       | Same: unit `d800` preserved                                                                                                                                                 |
| `<U+D800>` outside any literal            | `LEXICAL_ERROR "invalid character"` → SyntaxError. That is correct, because a lone surrogate code point is no token                                                         |
| `var a\uD800;`                            | `LEXICAL_ERROR "invalid escaped identifier character"` → SyntaxError                                                                                                        |
| `new TextEncoder().encode` of that source | `EF BF BD`. It is lossy, which is why the old step 3 (UTF-8, reject lone surrogates) is withdrawn                                                                           |

Rules:

- The evaluator passes the **same JS string** to `createSourceTextView` and as `lowerScript`'s
  `sourceText`.
- `retainFunctionSource` slices that string by the parser's UTF-16 spans
  (`lowering/index.ts:875-884`). So `Function.prototype.toString` sees exactly the original
  units.
- Never call `createSourceText` (bytes), `TextEncoder` or `TextDecoder` on evaluated text.
- Source size is bounded only by the parser's existing limits: a 1,000,000-token budget and a
  nesting depth of 128. Both report `LIMIT`. Add no new source-length limit.

## 5. Failure taxonomy (exact codes, current source)

| Origin                                         | Codes / stages                                                                  | Evaluator result                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `parseScript` (`syntax/model.ts:19`)           | `SYNTAX_ERROR`, `LEXICAL_ERROR`                                                 | `throw createRuntimeError(realm,"syntax")`                  |
|                                                | `LIMIT` (e.g. nesting > 128), `UNSUPPORTED_SYNTAX` (feature-tagged)             | unsupported                                                 |
| `lowerScript` (`lowering/index.ts:39,103-120`) | `EARLY_ERROR` (binder `UNKNOWN_NAME/DUPLICATE_NAME/IMMUTABLE/INVALID_CONTEXT`)  | SyntaxError                                                 |
|                                                | `UNSUPPORTED`, `LIMIT`                                                          | unsupported                                                 |
| `host.compile` (prepare/link/budget/publish)   | any `{ok:false}`                                                                | unsupported (no record is created and nothing is published) |
| domain                                         | `host.domain()` ≠ captured ≠ `storage.domain`, or not a positive safe integer   | unsupported, before parse                                   |
| entry                                          | completion `none` / `throw` / `unsupported`                                     | return value / rethrow the identical value / unsupported    |
| host invariant                                 | `invoke` threw, view `undefined`, unknown `error`, `activeContext` not restored | `host.fault(reason)`, then unsupported                      |

Probe observations (Node only):

- `SYNTAX_ERROR`: `var`, `return 1;`, `break;`, `new.target`, `'use strict';with({}){}` and
  `'use strict';010`.
- Lowering `EARLY_ERROR`: `let a; let a;` and `let a; var a;`.
- Parse `LIMIT`: 200 nested parentheses.
- Prepare `profile`: `` t`x` `` ("managed entry does not support module initialization") and
  `function*g(){}1` ("callback variance crosses surface classes").
- Prepare ok at 24–39 KB each: `class`, `with`, regexp, bigint, `""`, `throw 7` and `2;;`.

So valid Scripts the JIT cannot yet take arrive as **profile** failures, never as SyntaxError. That
is why every compile failure maps to unsupported.

**Sticky unsupported.**

- `rejectUnsupportedExecution` sets `realm.unsupported` and throws `undefined` (`errors.ts:560`).
- `finishScriptExecution` turns every later completion into `unsupported` (`:569-577`).
- `runNativeScripts` checks all realms before and after the job drain (`test262-native.ts:480,484`).
- EV1 adds the **pre-parse** check. If `realm.unsupported` is already set, reject at once. A test
  that catches the `undefined` can therefore never pass, and it never triggers another compile.

Residual risk: a parser gap would surface valid text as a false SyntaxError. This is the
dynamic-`Function` precedent (`dynamic-function.ts:170-183`). The old plan found that every
acceptance `evalScript` text parses; re-check that on the landing snapshot.

## 6. EV1 public contracts

### 6.1 `packages/js-engine/src/native/script-entry.ts` (new, type-only)

```ts
import type { GlobalEnvironment } from "@tint/js-runtime/environments/global";
import type { ScriptPropertyKey, ScriptRecord } from "@tint/js-runtime/objects";
/** Managed entry frame; field names are fixed by the lowered `execute($global,$script)`. */
export interface ScriptEntryFrame {
  readonly $imports: unknown;
  readonly $argument0: GlobalEnvironment<ScriptPropertyKey, unknown>;
  readonly $argument1: ScriptRecord;
}
```

This is the same declaration as `scriptEntryFrameSource`, but EV1 does **not** select it into a
surface. The fixture text stays the managed-surface selection until EV2, so E4's directory digest
does not change while E4 is in flight. The file has no build-bound bodies.

### 6.2 `packages/js-engine/src/script-evaluation.ts` (new)

```ts
import type { Module } from "@tint/typescript/syntax";
import type { GlobalEnvironment } from "@tint/js-runtime/environments/global";
import type {
  ErrorRealm,
  ScriptPropertyKey,
  ScriptCompletionRecord,
} from "@tint/js-runtime/objects";
import type { EngineCodeStorage } from "./native/code-storage.ts";
import type { ScriptEntryFrame } from "./native/script-entry.ts";

/** One per realm; the host guarantees `global` is `realm`'s paired environment. */
export interface ScriptEvaluationContext {
  readonly realm: ErrorRealm;
  readonly global: GlobalEnvironment<ScriptPropertyKey, unknown>;
}
export type ScriptCompileFailure =
  | "profile"
  | "prepare"
  | "lower"
  | "emit"
  | "select"
  | "link"
  | "budget"
  | "publish";
export type ScriptEntryCompilation =
  | { readonly ok: true; readonly address: number }
  | { readonly ok: false; readonly stage: ScriptCompileFailure };
export type ScriptEvaluationFault =
  "invoke-threw" | "completion-view" | "completion-kind" | "context-leak";
/** Explicit embedding authority, shared by every realm of one domain. */
export interface ScriptEvaluationHost {
  readonly domain: () => number;
  readonly storage: EngineCodeStorage; // the dynamic-Function arena; only `.domain` is read here
  readonly table: () => unknown; // memoized bound surface table
  readonly compile: (lowered: Module) => ScriptEntryCompilation;
  readonly invoke: (address: number, frame: ScriptEntryFrame) => unknown;
  readonly completion: (value: unknown) => ScriptCompletionRecord | undefined;
  readonly fault: (reason: ScriptEvaluationFault) => void;
}
export type ScriptEvaluator = (source: unknown) => unknown;
/** ParseScript + ScriptEvaluation for host embeddings ($262.evalScript). No caller
 * environment, no inherited strictness, no job checkpoint, no code cache. */
export function createScriptEvaluator(
  context: ScriptEvaluationContext,
  host: ScriptEvaluationHost,
): ScriptEvaluator;
```

**Why no `limits` argument.** `maxScriptCodeBytes` is owned by the production `compile` (EV3),
just as `maxDynamicCodeBytes` is owned by the dynamic compiler. The evaluator never sees code
bytes.

### 6.3 Algorithm (exact)

At construction, capture `domain = host.domain()`. Do not throw, unlike
`createDynamicFunctionCompiler`, which rejects at construction. A bad domain is reported per call.

1. If `realm.unsupported`, call `rejectUnsupportedExecution(realm)`.
2. If `typeof source !== "string"`, the result is unsupported (D2 unchanged).
3. Run `ensureDomain()`: `domain` must be a positive safe integer, and
   `host.domain() === domain === host.storage.domain`. Otherwise the result is unsupported.
4. `parsed = parseScript(createSourceTextView(source))`. Map the error by §5.
5. `lowered = lowerScript(parsed.value, source)`. Map the error by §5.
6. `compiled = host.compile(lowered.value)`. A failure is unsupported. Then run `ensureDomain()`
   again.
7. `record = createScriptRecord(realm, undefined)`. This is the fresh **per successful
   compilation** record; its realm is `context.realm`. Then build
   `frame = {$imports: host.table(), $argument0: global, $argument1: record}`.
8. Save `outer = realm.agent.activeContext`. Then `raw = host.invoke(compiled.address, frame)`:
   - if it throws: `fault("invoke-threw")`, then unsupported;
   - if `realm.agent.activeContext !== outer` afterwards: `fault("context-leak")`, then
     unsupported.
9. `done = host.completion(raw)`:
   - `undefined`: `fault("completion-view")`;
   - `"none"`: return `done.value`;
   - `"throw"`: `throw done.value`;
   - `"unsupported"`: `rejectUnsupportedExecution(realm)`;
   - anything else: `fault("completion-kind")`, then unsupported.
10. Never call `drainScriptJobs` or `clearKeptObjects`. Never cache `compiled`.

**Record creation after compile.** A compile failure is a host limitation, reported as
unsupported. Creating the record only after compile is unobservable, and failed attempts allocate
no record.

**Child realms.** Each realm's `$262` closes over its own evaluator, so `other.evalScript`
evaluates in `other` (10.3.1).

## 7. EV1 red-first tests: `packages/js-engine/test/script-evaluation.test.ts`

Use the `dynamic-function.test.ts` fixture style:

- `bindHostRecordViews()`, a real `createErrorRealm`/`createGlobalEnvironment` and the Function
  and Error intrinsics;
- a spy host that records the arguments of every `compile`, `invoke` and `fault` call;
- storage `{domain:17, publish: () => assert.fail()}`, because the evaluator must never publish.

| #   | Case                                                                                                           | Expect                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `7` (number), `undefined`, an object                                                                           | throws `undefined`; `realm.unsupported`; 0 compiles                                                                                                 |
| 2   | `"var"`                                                                                                        | a thrown object with `prototype === realm.prototypes.get("syntax")`; 0 compiles; flag stays false                                                   |
| 3   | `"let a; let a;"`, `"return 1;"`, `"\uD800"` (raw unit, outside a literal)                                     | SyntaxError each; 0 compiles                                                                                                                        |
| 4   | 200-deep parentheses                                                                                           | unsupported, never SyntaxError                                                                                                                      |
| 5   | `"var s='<raw D800>'"`                                                                                         | `compile` receives a module whose string literal is the unit `0xD800`; a spy on retained source shows the identical string                          |
| 6   | `compile → {ok:false,stage}` for each of the 8 stages                                                          | unsupported; 0 invokes (so no frame or record ever reaches the entry)                                                                               |
| 7   | two successes                                                                                                  | distinct `$argument1`; each `.realm === realm`, `.hostDefined === undefined`, `.kind === "script"`; `$argument0 === global`; `$imports === table()` |
| 8   | completions `{none,7}`, `{throw,o}`, `{unsupported}`                                                           | returns 7; throws identical `o`; sticky flag                                                                                                        |
| 9   | view `undefined`; error `"weird"`; `invoke` throws `"MANAGED_SURFACE_TABLE"`; `invoke` leaves a pushed context | `fault` called once with the matching reason; unsupported                                                                                           |
| 10  | domain 18 vs storage 17; domain 0; domain changes during `compile`                                             | unsupported; for the first two, 0 compiles                                                                                                          |
| 11  | after case 1 (flag set), a valid source                                                                        | unsupported; **0 compiles** (pre-parse sticky)                                                                                                      |
| 12  | fake `invoke` enqueues a job through `realm.agent`                                                             | the job is still queued after return                                                                                                                |
| 13  | evaluator built on a second realm B                                                                            | records carry B; errors use B's prototypes; A is untouched                                                                                          |

Also extend `runtime-surface.test.ts` with one assertion: the `js-engine` `ScriptEntryFrame`
declaration text equals `scriptEntryFrameSource` modulo import specifiers, so the two cannot drift
before EV2.

**EV1 manifest edits (planned).** `js-engine/package.json` gains the exports `./script-evaluation`
and `./native/script-entry` and the dependency `"@tint/source": "workspace:*"` (for
`createSourceTextView`). `workspace-contracts.json` gains `"@tint/source"` under `@tint/js-engine`.
`@tint/source` has no dependencies, so the graph stays acyclic.

## 8. EV2: promote the frame and the request (Node; **after E4 acceptance**)

1. In `createScriptRuntimeRequest`, select `{module:"packages/js-engine/src/native/script-entry.ts",
name:"ScriptEntryFrame"}`. Drop the generated `surface-helpers` module from the E4 tool and the
   Node fixture. Whether the digest changes (it would if reification records module identity) is
   unverified. Case-2 `EXPECT` is regenerated at build time, so nothing is pinned by hand.
2. Keep the bound declarations (`bindScript`, `invoke`, `completion`) **tool-owned** in generated
   host text, as `script-host` is today. Test262 generates its own copy (EV5). `js-engine` stays
   free of build-bound bodies, and evaluation orchestration stays separate from native binding.
3. Tests:
   - `script-runtime-surface.test.ts`: the request validates with `frame:"ScriptEntryFrame"`;
   - `managed-jit-entry.test.ts`: the three Scripts and the tagged-template rejection are
     unchanged;
   - the counts (25/3/15/12) and 115,864 B are re-measured, not pinned.

## 9. EV3: production compile helper and compiler export (Node, slow test)

> Refined by [the EV3 compile-service plan](rt-eval-compile-service.md): the helper lives in a new
> `native/script-compile.ts`, takes no table, and EV1 gains a `"compile-threw"` fault guard.

**Export** (`compiler/src/native/index.ts`):

```ts
export {
  prepareManagedSurfaceEntry,
  type ManagedSurfaceEntryRequest,
  type PreparedManagedSurfaceEntry,
  type ManagedSurfaceEntryPreparation,
} from "./managed-jit-entry.ts";
```

The E4 tool's import by path (`verify-hosted-managed-script.ts:7`) then becomes
`@tint/compiler/native`.

Rationale (probe `closure`):

| Closure                           | Files | Bytes     |
| --------------------------------- | ----- | --------- |
| `native/index.ts`                 | 153   | 2,270,041 |
| entry + reader                    | 152   | 2,186,887 |
| evaluator closure, narrow subpath | 471   | 5,817,414 |
| evaluator closure, via the index  | 472   | 5,900,568 |

A narrow subpath would add a package export without moving any boundary.
`ManagedSurfaceDirectoryRead` and `ManagedSurfaceLayoutRuntime` are already exported from there.

**Helper.** This adds a value export to `js-engine/src/native/script-entry.ts`. It is ordinary
code, not a build-bound body:

```ts
export interface ScriptEntrySurface {
  readonly read: ManagedSurfaceDirectoryRead; // memoized readManagedSurfaceDirectory(bind(),"scriptRuntime",…)
  readonly runtime: ManagedSurfaceLayoutRuntime; // memoized parse of the 22 embedded modules
}
export function createScriptEntryCompiler(
  surface: ScriptEntrySurface,
  storage: EngineCodeStorage,
  readWord: (address: number, byteLength: number, offset: number) => number,
  domain: () => number,
  limits: { readonly maxScriptCodeBytes: number },
): (lowered: Module) => ScriptEntryCompilation;
```

The body is the E4 sequence verbatim (`:115-127`):

1. `prepare({module, entry:"execute", …})`, mapping a failure to its stage.
2. Check `native.imports.length === 0`, else `profile`.
3. Check `code.length <= maxScriptCodeBytes`, else `budget`.
4. `linkManagedSurfaceModule(read, native, readWord, domain())`, else `link`.
5. `storage.publish(linked.code)`. `undefined` or `% 16 !== 0` gives `publish`.
6. Return `base + entryOffset`.

The fixed count `53` in E4 is a fixture assertion, not a helper rule.

The helper derives `specifiers` and `instantiations` once from `scriptRuntimeSurface()`, which is
in the same package (`js-engine/lowering`). The host passes only `read` and `runtime`.

**Tests** (`tools/script-entry-compiler.test.ts`, using `createManagedScriptFixture`):

- The E4 Script publishes once, at address + `entryOffset`.
- Tagged template gives `profile` with 0 publishes, and generator gives `profile`.
- `maxScriptCodeBytes` = size − 1 gives `budget` with 0 publishes.
- `domain()` + 1 gives `link` with 0 `readWord` calls.
- A `publish` that returns `undefined` gives `publish`.
- A lone-surrogate literal Script compiles.

E4 itself is then refactored to call this helper. That is a byte-neutral change to the generated
fixture apart from the call site; rebuild only when E4 next runs.

## 10. EV4: native evaluator fixture (after E4 acceptance)

**Reuse `tools/verify-hosted-managed-script.ts`.** Do not write a new tool. Add case `4` to
`selectedCase()`, which runs the **evaluator** over the same image:

- same build options, `script-host`, record views and retained exports;
- additional dependencies `script-evaluation` and `script-entry`;
- `createScriptEvaluator` wired exactly as EV5 will wire it, with `compile` from
  `createScriptEntryCompiler`.

Case 0, the E4 acceptance path, stays untouched.

Statuses 100–119 avoid both `nativeExitOutcome` and E4's 60–99. Codes ≥ 100 still record as
`crash: unexpected native exit status N`. Each step also checks that `activeContext` is restored
and the root head is unchanged.

| Status | Check                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------------- |
| 100    | `ev(E4 Script)` returns 42; `nativeActive` saw a record ≠ any earlier one, with realm A                  |
| 101    | `ev("y+v")` returns 42 (lexical and var bindings persist)                                                |
| 102    | `ev("var q; let y;")` throws A's SyntaxError, and `q` is absent                                          |
| 103    | `ev("var")` throws A's SyntaxError, and the publish count is unchanged                                   |
| 104    | `ev("throw 7")` rethrows 7                                                                               |
| 105    | completions: `"var z;"` → `undefined`, `"2;;"` → 2                                                       |
| 106    | `ev("var s='<raw D800>';s.charCodeAt(0)")` → 55296                                                       |
| 107    | B (second realm): its SyntaxError is B's; `w` from B is absent in A                                      |
| 108    | tagged template: realm C sticky unsupported, and a second valid call on C makes **0** compiles           |
| 109    | wrong `table` (a spy host): `fault("invoke-threw")` once, then unsupported                               |
| 110    | 32 MiB churn, then `fA()` → 42, which sees the first record                                              |
| 111    | the arena bytes used after N compiles equal the sum of the aligned sizes (records the bytes per compile) |

The old EV4 nested-evaluation, jobs and `this` cases move to EV6 Test262 evidence. Each costs a
native compile, and its time on its own has not been measured (v3's 121 s includes setup).

## 11. EV5: Test262 host wiring (after EV4) and resources

> Refined by [the EV5 Test262 host-integration plan](rt-eval-test262-host-integration.md): exact
> edit list, lazy surface memo, host-fault exits 13–17 and the uniform resource decision.

Edits to `tools/test262-native.ts`, all behind a captured capability (D7). The capability is
`capturedEngineProvider(snapshot,"@tint/js-engine/script-evaluation","createScriptEvaluator")`.
Without it, the generated text stays byte-identical.

- **Prelude, process-wide lazy memo** (like `lazyNamedTimeZones`): `scriptSurface = {read, runtime}`
  is filled on the first `evalScript` call (inputs only, never code), plus a `scriptFault` flag.
- **`createRealmHost` (`:326-389`).** Add a `scriptEvaluator` to `RealmHost`:
  `createScriptEvaluator({realm, global}, {domain, storage: executableStorage, table: () =>
bindScript().table, compile, invoke, completion, fault})`. It reuses the **same**
  `executableStorage` as dynamic `Function`.
- **`installRealmHost` (`:405-412`).** `evalScript` calls `host.scriptEvaluator(args[0])`.
- **`runNativeScripts`.** If `scriptFault`, return 13 first, both before reading results and after
  the drain. Add a red test that `nativeExitOutcome(13)` is `crash`; this was not re-verified.
- **Builder.** Copy from E4:
  - the generated `script-host` text;
  - the `completion`, `viewSymbolValue` and `viewBigIntValue` record views with their
    `retainedExports`;
  - `invoke` → `executable-call-managed`;
  - `managedSurfaces:[createScriptRuntimeRequest({module:"script-host",name:"bindScript"})]`;
  - any missing E4 memory bindings (`context-domain`, `memory-read-word`, descriptor and
    signature).
- **Label.** `native-script-v6-eval-script` (`test262-native-run.ts:95`).

**Resources (recorded in `executionResources`, uniform, chosen once):**

| Field                   | Today  | EV5 proposal                                                         | Evidence                                    |
| ----------------------- | ------ | -------------------------------------------------------------------- | ------------------------------------------- |
| `maxDynamicCodeBytes`   | 65,536 | unchanged                                                            | separate budget                             |
| `maxScriptCodeBytes`    | —      | **262,144**                                                          | Node sizes: 24–116 KB for the probe Scripts |
| `executableMemoryBytes` | 1 MiB  | 4 MiB (8 × about 116 KB, plus Function)                              | `var-collision` makes 8 calls               |
| `managedBytes`          | 64 MiB | **undecided**: E4 failed at 64; v3 reached publish at 256            | v1/v2/v3                                    |
| `allocationCapacity`    | 1 Mi   | **undecided**: E4 failed at 1 Mi and passed GC at 4 Mi               | v1, diagnostic v3                           |
| `stackBytes`            | 1 MiB  | **undecided**: E4b (`--small-stack`) not yet run                     | none                                        |
| `timeoutMs`             | 60,000 | **undecided**: v3 took 121 s to its first invoke, under the debugger | v3                                          |

The four undecided rows block EV5. Main must choose one recorded set for the whole suite. That
set would raise every batch's heap if it went to 256 MiB, so decide only from E4c case-1/case-2
elapsed splits. The alternative is to reduce the compile's live set (unpruned imports and the 22
module parses). Do not tune per test, and do not pin numbers before E4 passes.

## 12. Test262 acceptance (selection unchanged)

The pinned checkout `91c70759` has **31 files** with `$262.evalScript` (re-counted). They expand to
**44 variants**. **4 variants** (2 files: `language/global-code/script-decl-lex-var-declared-via-eval.js`
and `annexB/language/eval-code/direct/script-decl-lex-no-collision.js`) need direct eval and must
stay `unsupported`. Child-realm observers (`Proxy/revocable/tco-fn-realm.js`,
`intl402/FallbackSymbol/per-realm.js`) are non-gating.

The commands and their order are those of [S2-ev1 §8](rt-eval-host-evalscript.md), unchanged:

1. Before EV5, capture the baseline on the pre-change snapshot.
2. After EV5, run `node tools/test262-native-run.ts .tint-bootstrap/test262 <selection> 8` for:
   `language/global-code`, `annexB/language/global-code`, the direct-eval file, both child-realm
   files and `built-ins/Function` (shared-arena regression).

Any pass → fail change blocks. Never update dashboard totals from focused runs.

## 13. Limits, unknowns and risks

1. **E4 v3 trap (blocks EV4).** The cause is unknown. It is consistent with the Script body arrow
   that `runScriptContext` calls. A compiler fix would need a new frozen self-build.
2. **Compile cost.** About 121 s to the first invoke, under the debugger, against 0.5 s for prepare
   in Node. The split between parsing the 22 modules, prepare and link is unmeasured (E4c).
3. **Live set.** More than 32 MiB is live during the compile. That fixes `managedBytes` for every
   batch once evalScript enters the image.
4. **Image growth.** About 105 KB of module text plus the surface publication enter every
   Test262 image while D7 is advertised.
5. **EV2 digest drift** is unverified. Never pin a digest; regenerate it.
6. **False SyntaxError from parser gaps** (§5). Low risk for the 31 files.
7. **Realm–global pairing** is a host invariant the engine cannot check; EV4 status 107 observes it.
8. **No Node executor for lowered code exists.** EV1 tests orchestration only. GDI, completions
   and jobs can only be shown natively (EV4, EV6).

## 14. First implementation slice and next planning task

**First slice: EV1 (Node only, red first; independent of E4).**

1. Write `packages/js-engine/test/script-evaluation.test.ts` with cases 1–13 (§7). It fails (red)
   because the module does not exist yet.
2. Add `native/script-entry.ts` (type-only frame) and `script-evaluation.ts` (§6), the exports, the
   `@tint/source` dependency and the `workspace-contracts.json` entry.
3. Run `pnpm build`, the focused test and `pnpm check`.

No compiler, lowering, codegen or tool change, no self-build and no native run. The E4 tool, the
Test262 host and the frozen snapshot stay untouched.

**Next useful planning task: "E4 v3 trap triage and E4c sizing."** Once main records the v3
analysis:

- map the trap PC to its JIT function through `entryOffset`/symbol data;
- plan case-1 and case-2 timing runs at v3 resources, plus E4b (1 MiB stack);
- turn those numbers into the §11 resource decision and the go/no-go for EV3 → EV5.
