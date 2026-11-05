# RT-EVAL S2-ev1: the `$262.evalScript` service

Status: **planned (research only).** Parent: [S2-e1, the first managed Script](rt-eval-first-managed-script.md)
§11, which names this slice. It builds on [Script identity migration](rt-eval-script-identity-migration.md)
(S2-id2) and the [RT-EVAL plan](rt-eval.md) §5 and S2. Scope: the Test262 host function
`$262.evalScript` for the 31 pinned files that call it. It reuses the current realm creation
(`createRealmHost`), the shared `EngineCodeStorage` arena, the managed directory and entry
services, and `ScriptRecord`. Out of scope: direct and indirect `eval`, general `Function`, ESM,
agents, tagged-template instance state and code caching. Where one of these matters, this plan
leaves a handoff note and nothing more.

**Refreshed:** [evaluator integration](rt-eval-evaluator-integration.md) replaces EV1–EV4 names,
counts and the UTF-8 source step below with the implemented APIs.

Captured 2026-11-04, 20:20–20:30, on live source (541 `packages/*/src` files). `dist` is newer than
`src` for `js-runtime`, `js-engine`, `compiler`, `ts-native`, `typescript` and `codegen` (`v0`).
**During capture, main landed S2-id2 Slice B in source.** `lowerScript` now emits
`execute($global,$script)` (`lowering/index.ts:4242-4310`), and the host passes
`createScriptRecord(realm,undefined)` (`test262-native.ts:262,473,479`). The adapter label is now
`native-script-v5-script-records` (`test262-native-run.ts:95,279`). As instructed, this plan still
treats S2-id2 as a prerequisite that main owns, because no native evidence for it exists yet.
`prepareManagedSurfaceEntry`, `managedRuntimeKeysForOptions`, adapter frame mode and
`ScriptEntryFrame` **do not exist** in `packages/` or `tools/` (searched). They are S2-e1 work.
Every API named below as new is **planned**.

The probes are read-only Node scripts in `/tmp/tint-evalscript-plan` (`v0-drift.txt`,
`v1-variants.mts`/`.txt`). They import `tools/test262.ts` by absolute path, read the pinned
checkout and write nothing in the workspace. **Every probe result is Node-only and non-native.**
No build, emission or native execution was performed. The running frozen self-build, its pause
markers, the queues, snapshots and reports were not touched.

Primary sources: ECMA-262 current draft (tc39.es, multipage) clauses 9.4.1, 9.5, 10.3.1, 16.1.4–16.1.7
and 19.2.1, and Test262 `INTERPRETING.md` at the pinned revision `91c70759…` (lines 48–69).

## 1. Answer in brief

1. **Acceptance population: 31 files, 44 variants** under the existing `syntaxVariants` policy
   (`tools/test262.ts:71-77`, probe `v1`). The split is 16 + 1 variants in
   `annexB/language/global-code`, 25 in `language/global-code` and 2 in
   `annexB/language/eval-code/direct`. Two further files call `evalScript` on a **child** realm
   (`other.evalScript`, 3 variants). They are observed but not gating (§3.3).
2. **Four of the 44 variants cannot pass in S2-ev1, by construction.**
   `language/global-code/script-decl-lex-var-declared-via-eval.js` and
   `annexB/language/eval-code/direct/script-decl-lex-no-collision.js` first run a **direct
   string `eval`** (S5). They must stay `unsupported`. This plan makes no pass forecast for the
   other 40.
3. **Baseline evidence differs by directory.** The v9 full-suite prefix records all 17
   annexB/global-code variants and both annexB eval-code variants as `unsupported`. **No saved
   native report covers `language/global-code`**, so its 25 variants have no baseline (§3.2). The
   7 sibling `*-global-init.js` files, which use the same `fnGlobalObject.js` and
   `propertyHelper.js` harness without `evalScript`, pass in v9; 1 crashes.
4. **The service is ScriptEvaluation over the S2-e1 entry, not intrinsic eval.** The steps are:
   ParseScript in the **evalScript function's realm** (10.3.1 makes that the current Realm), a
   fresh `ScriptRecord` per successful parse, that realm's paired `GlobalEnvironment`, GDI inside
   the lowered entry, and the completion returned or rethrown. It uses no caller environment, no
   inherited strictness and no job checkpoint.
5. **Failure taxonomy (exact, §5.3).** Real `SyntaxError` comes only from a parser
   `SYNTAX_ERROR`/`LEXICAL_ERROR`, from `lowerScript` `EARLY_ERROR`, or from GDI at run time.
   `LIMIT`, `UNSUPPORTED_SYNTAX`, `UNSUPPORTED`, profile/emit/link failures, arena exhaustion and
   non-string input all call `rejectUnsupportedExecution(realm)`. A broken service invariant sets
   a host fault flag that becomes exit status 13, which is reported as a crash. Nothing synthesizes
   a JS exception.
6. **Concrete blockers.** (a) S2-e1 must pass natively (E1–E4). (b) The 1 MiB executable arena
   and 64 KiB per-code cap cannot hold one Script entry: S2-e1 measured 103,872 B in Node for a
   12-function Script. A test with 8 calls needs several hundred KiB (§6, D3). (c) In-image
   compile time and stack use at Test262 resources (1 MiB stack, 60 s containment) are unmeasured.
7. **First implementation slice: EV1** (§7). Add `createScriptEvaluator` in `js-engine` with an
   injected `compile`, plus Node tests for the taxonomy, record and frame identity, completion
   mapping and the absence of a job checkpoint. It needs only landed code (`ScriptRecord`,
   `lowerScript`, `parseScript`). It does not touch the Test262 host.

## 2. Specification: host embedding versus intrinsic eval

| Source                        | Rule S2-ev1 keeps                                                                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INTERPRETING.md` evalScript  | 1 hostDefined (host choice: `undefined`); 2 realm = **current Realm**; 3 `s = ParseScript(sourceText, realm, hostDefined)`; 4 on errors, return a throw completion of the **first** error; 5–6 return `ScriptEvaluation(s)` |
| 10.3.1 built-in `[[Call]]`    | The callee context's Realm is `F.[[Realm]]`, so "current Realm" is the realm that owns that `evalScript` function. `other.evalScript` evaluates in `other`                                                                  |
| 16.1.5 ParseScript            | Parse errors and early errors happen before any record exists. A success returns a **new** Script Record                                                                                                                    |
| 16.1.6 ScriptEvaluation       | Push a context (Function null, Realm and ScriptOrModule from the record), run GDI, then the body only on normal GDI. Empty becomes `undefined`. Pop the context on every completion. No job checkpoint is part of it        |
| 16.1.7 GDI                    | Lexical collisions and restricted globals give SyntaxError. A refused function or var gives TypeError. All checks run before any mutation. Errors come from the running context's realm (the record's realm)                |
| 9.4.1 / 9.5                   | Functions and jobs created by the evaluated code capture **its** record                                                                                                                                                     |
| 19.2.1 PerformEval (contrast) | Intrinsic eval uses the caller's strictness and environments (direct) or a fresh lexical env over the global (indirect), with EvalDeclarationInstantiation. **None of this applies to evalScript**                          |

These are host embedding choices, allowed by `INTERPRETING.md`:

- `hostDefined` is `undefined`.
- **Non-string input is unsupported.** The contract says the function "accepts a string value"
  and specifies nothing for other values (D2).
- Each realm's `$262.evalScript` closes over that realm's `RealmHost`.

The evaluated text has **its own** directive prologue. The Test262 `strict` variant prefixes only
the test file, so in every acceptance file the `evalScript` text is sloppy unless it contains its
own `"use strict"`.

## 3. Acceptance population (probe `v1`, Node-only)

### 3.1 The 31 pinned files

| Group                                                              | Files  | Flags                                                                   | Variants | `evalScript` calls per file                                                                  | Needs beyond S2-ev1       |
| ------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- | ------------------------- |
| `annexB/language/global-code/*-global-existing-*-global-init.js`   | 16     | `generated,noStrict`; includes `fnGlobalObject.js`, `propertyHelper.js` | 16       | 3 (untagged template sources that call harness `assert`/`verifyProperty` through the global) | none known                |
| `annexB/language/global-code/script-decl-lex-collision.js`         | 1      | `noStrict`                                                              | 1        | 1                                                                                            | none known                |
| `language/global-code/script-decl-*` (12 files)                    | 12     | none (both modes); `propertyHelper.js` in 2                             | 24       | 1–8 (`var-collision`: 8)                                                                     | none known                |
| `language/global-code/script-decl-lex-deletion.js`                 | 1      | `noStrict`                                                              | 1        | 3                                                                                            | none known                |
| — of which `script-decl-lex-var-declared-via-eval.js`              | (1)    | both                                                                    | (2)      | 2                                                                                            | **S5 direct string eval** |
| `annexB/language/eval-code/direct/script-decl-lex-no-collision.js` | 1      | none (both)                                                             | 2        | 1                                                                                            | **S5 direct string eval** |
| **Total**                                                          | **31** |                                                                         | **44**   |                                                                                              | 4 variants blocked by S5  |

The 13 `language/global-code` rows give 25 variants. What these tests observe:

- **GDI throw completions** from the main realm: SyntaxError (`lex-lex`, `lex-var`,
  `var-collision`, `lex-restricted-global`, annexB `lex-collision`) and TypeError
  (`func-err-non-configurable`, `func-err-non-extensible`, `var-err`).
- **No partial instantiation.** `x` stays a ReferenceError, and `executed` stays `false`.
- **Lexical persistence across Scripts**, including the `delete` no-op in `lex-deletion`.
- Function and var property attributes on an extensible or non-extensible global.
- The Annex B B.3.2.2 function-in-block admission across three Scripts.

**No acceptance file uses the returned completion value.**

### 3.2 Baselines

- **annexB:** `test262-full-suite-native-v9.jsonl` gives `unsupported` for all 17 annexB/global-code
  variants and both annexB eval-code variants. The reason is "native runtime reached an
  unsupported operation", which `evaluateScript` triggers (`test262-native.ts:408-412`).
- **`language/global-code`:** no `docs/results` report contains a `language/global-code` path
  (searched every `*.jsonl`). EV6 therefore records a baseline first (§8).

### 3.3 Observed, non-gating (child realm)

| File                                        | Variants | Uses                                                                                                       |
| ------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `built-ins/Proxy/revocable/tco-fn-realm.js` | 1 strict | `other.evalScript` returns a function. Asserts `other.global.TypeError` (feature `tail-call-optimization`) |
| `intl402/FallbackSymbol/per-realm.js`       | 2        | **Uses the completion value** (a Symbol) of `other.evalScript`. Needs a per-realm Intl fallback symbol     |

They are the only pinned observers of child-realm `evalScript` and of completion values, so the
native fixture covers both directly (§7, EV4).

## 4. Present versus planned

| Piece                                                                                          | State                                                                          |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `ScriptRecord`, `createScriptRecord`                                                           | Landed; [native fixture](../results/native-script-record-jobs-v1.json) passes  |
| `lowerScript` → `execute($global,$script)`, host records, adapter v5                           | Landed in source at capture; **no native evidence yet** (S2-id2 Slice C, main) |
| `createRealmHost`, `installRealmHost`, shared `executableStorage`                              | Present (`test262-native.ts:262-412`)                                          |
| `parseScript` error codes `LEXICAL_ERROR \| SYNTAX_ERROR \| UNSUPPORTED_SYNTAX \| LIMIT`       | Present (`typescript/src/syntax/model.ts:19`)                                  |
| `lowerScript` errors `EARLY_ERROR \| UNSUPPORTED \| LIMIT`                                     | Present (`lowering/index.ts:107-120`)                                          |
| Dynamic-Function classification precedent (LIMIT/UNSUPPORTED → unsupported, else SyntaxError)  | Present (`dynamic-function.ts:169-183`)                                        |
| `instantiateGlobalDeclarations` returning `none \| syntax \| type`, all checks before mutation | Present (`environments/global/declarations.ts:61-140`)                         |
| `finishScriptExecution`, which maps a sticky `realm.unsupported` to `"unsupported"`            | Present (`objects/errors.ts:560-577`)                                          |
| `readManagedSurfaceDirectory`, `linkManagedSurfaceModule`, `EngineCodeStorage.publish`         | Present                                                                        |
| Script surface request derivation                                                              | Present **only inside** `verify-hosted-managed-surface-directory.ts:27-111`    |
| Adapter frame mode, D6f4 keys, `prepareManagedSurfaceEntry`, `ScriptEntryFrame`                | **Planned (S2-e1 §5)**                                                         |
| `createScriptEvaluator`, `compileScriptEntry`, `script-entry.ts`, Test262 wiring               | **Planned (this plan)**                                                        |

## 5. Service contracts (planned)

### 5.1 `packages/js-engine/src/native/script-entry.ts` (new; promotes S2-e1 §5.1)

```ts
export interface ScriptEntryFrame {
  readonly $imports: unknown; // bound table; the JIT view checks it once per entry
  readonly $argument0: GlobalEnvironment<ScriptPropertyKey, unknown>;
  readonly $argument1: ScriptRecord;
}
/** Host-bound: executable-call-managed. */
export function invokeScriptEntry(
  address: number,
  frame: ScriptEntryFrame,
): unknown;
/** Host-bound: record operation "view". */
export function viewScriptCompletion(
  value: unknown,
): ScriptCompletionRecord | undefined;
/** Host-bound: managed surface bind for "scriptRuntime". */
export function bindScriptSurface(): ManagedSurfaceExport;
```

The bodies throw `"UNBOUND_*"`. These are build-bound declarations, the same pattern as
`native-runtime/intrinsics/memory.ts`, not stubs. The S2-e1 fixture switches to importing them;
the contract does not change. If S2-e1 lands its fixture-owned copy first, this is a file move.

### 5.2 `packages/js-engine/src/script-evaluation.ts` (new)

```ts
export interface ScriptEvaluationContext {
  // one per realm
  readonly realm: ErrorRealm;
  readonly global: GlobalEnvironment<ScriptPropertyKey, unknown>; // paired with realm (host invariant)
}
export type ScriptEntryCompilation =
  | { readonly ok: true; readonly address: number }
  | { readonly ok: false; readonly reason: "unsupported" };
export interface ScriptEvaluationHost {
  // process-wide; shared by all realms of one domain
  readonly domain: () => number;
  readonly storageDomain: number;
  readonly table: () => unknown; // bindScriptSurface().table, memoized
  readonly compile: (lowered: Module) => ScriptEntryCompilation;
  readonly invoke: (address: number, frame: ScriptEntryFrame) => unknown;
  readonly completion: (value: unknown) => ScriptCompletionRecord | undefined;
  readonly fault: () => void; // service invariant broken; host maps to exit 13
}
export function createScriptEvaluator(
  context: ScriptEvaluationContext,
  host: ScriptEvaluationHost,
): (source: unknown) => unknown;

/** Production `compile`: S2-e1 prepare → link → publish. Never publishes on failure. */
export function compileScriptEntry(
  lowered: Module,
  surface: ScriptEntrySurface,
  storage: EngineCodeStorage,
  readWord: (address: number, byteLength: number, offset: number) => number,
  limits: { readonly maxScriptCodeBytes: number },
): ScriptEntryCompilation;
```

`ScriptEntrySurface` is `{read, table, runtime}`. Here `read` is the memoized
`readManagedSurfaceDirectory(bindScriptSurface(), "scriptRuntime", host)` result. `runtime` is the
memoized parse of the nine collection-runtime sources that the host embeds (S2-e1 §7). Memoizing
these **inputs** is not a code cache: no compiled entry is ever reused (D5).

### 5.3 Evaluator algorithm (exact)

1. If `typeof source !== "string"`, call `rejectUnsupportedExecution(realm)` (D2).
2. If `host.domain() !== host.storageDomain`, the result is unsupported. Nothing is parsed.
3. Encode the string as UTF-8. A `createSourceText` failure is unsupported (a lone surrogate
   cannot be encoded).
4. `parseScript`. A `LIMIT` or `UNSUPPORTED_SYNTAX` failure is unsupported. `SYNTAX_ERROR` or
   `LEXICAL_ERROR` → `throw createRuntimeError(realm, "syntax")`. This is the first error
   (`INTERPRETING.md` step 4). No record exists yet.
5. `lowerScript(module, source)`. `EARLY_ERROR` → realm SyntaxError (still ParseScript, 16.1.5).
   `UNSUPPORTED` or `LIMIT` is unsupported.
6. `host.compile(lowered)`. Unsupported covers the tagged-template "module initialization"
   rejection, every profile/ABI/key/record error, arena exhaustion, `maxScriptCodeBytes` and link
   failure. No partial publication happens.
7. `record = createScriptRecord(realm, undefined)`, fresh per call. Build
   `frame = {$imports: host.table(), $argument0: global, $argument1: record}` as an AOT local.
8. `raw = host.invoke(address, frame)`. Any value thrown out of `invoke` is a fault. `execute`
   catches every Script throw into a completion, so only the JIT table guard can throw:
   call `fault()`, then `rejectUnsupportedExecution(realm)`.
9. `done = host.completion(raw)`. `undefined` is a fault.
   - `"none"`: return `done.value`. Empty was already lowered to `undefined`.
   - `"throw"`: `throw done.value`, with identity preserved.
   - `"unsupported"`: `rejectUnsupportedExecution(realm)`.
   - Any other value is a fault.
10. **Never** call `drainScriptJobs` or `clearKeptObjects`. Jobs carry `record` and drain at the
    host's existing post-test checkpoint (`test262-native.ts:483`).

`rejectUnsupportedExecution` sets the sticky `realm.unsupported` and throws `undefined`.
`runNativeScripts` checks every realm's flag **before** it reads the test result
(`test262-native.ts:480`), so an `assert.throws` that catches the `undefined` can never report a
pass.

### 5.4 Ownership, lifetime and context domain

| Object                          | Owner and code area                                        | Lifetime                                 | Domain                           |
| ------------------------------- | ---------------------------------------------------------- | ---------------------------------------- | -------------------------------- |
| Bound surface table             | Image (build-time `managedSurfaces` publication)           | Process                                  | Image                            |
| Directory read, parsed runtimes | Host prelude, lazy memo (like `namedZoneState`)            | Process                                  | Checked again at every link      |
| Prepared/linked bytes           | `compileScriptEntry`, transient                            | One call                                 | `currentContextDomain()` at link |
| Published entry code            | Existing `executableStorage`, shared with dynamic Function | **Permanent** (the arena never recycles) | `storage.domain`                 |
| `ScriptRecord`                  | Evaluator, one per successful parse                        | GC; kept by contexts, closures, jobs     | —                                |
| Frame                           | Evaluator AOT local                                        | One call (rooted)                        | —                                |
| Completion record               | Allocated by the JIT, viewed by AOT                        | One call                                 | —                                |
| Evaluator closure               | `installRealmHost`, one per realm                          | Realm                                    | —                                |

Realm isolation: every realm, including those from `createRealm`, gets its own evaluator over its
own `RealmHost.realm`/`global`. Storage, table and directory are shared per domain. Code is
realm-independent, because the realm arrives through `$argument1.realm`.

## 6. Unresolved decisions (recommended defaults)

- **D1 Parse-error class.** Follow the dynamic-Function precedent (§5.3 steps 4–5).
  `prepareNativeScripts` keeps treating test-file parse failures as unsupported
  (`test262-native.ts:180-182`). That path has no realm to throw into, and its partial-grammar
  caution applies to _test_ sources. No acceptance file has a parse error in `evalScript` text.
- **D2 Non-string argument.** Unsupported. No pinned test passes a non-string.
- **D3 Code budget (blocking).** Add `maxScriptCodeBytes: 262144` to `nativeTestResources`, and
  raise `executableMemoryBytes` from 1 MiB to 4 MiB. Both are uniform, recorded and chosen once,
  in the same commit as EV5. Main must sign off, because full-suite resource comparability
  changes. With the current 1 MiB arena and no code cache, one 8-call test does not fit.
  Alternative: keep 1 MiB and accept `unsupported` from arena exhaustion. EV4 measures real bytes
  first, and the default is re-checked against them.
- **D4 Stack.** Keep `stackBytes` at 1 MiB, and run EV4 at exactly the Test262 resources. A stack
  fault there is a finding to report, not something to tune per test.
- **D5 Memoization.** Memoize only process inputs: the directory read, the parsed runtime modules
  and the table. Never memoize compiled entries (code caching is out of scope).
- **D6 Fault status.** Exit 13. `nativeExitOutcome` already maps it to `crash` ("unexpected native
  exit status 13"), so it needs no change there.
- **D7 Capability gating.** Capture `scriptEvaluation` from the `js-engine` export
  `createScriptEvaluator`, as the existing `capturedNativeRuntimeCapabilities` pattern does.
  Without it, `evalScript` keeps `rejectUnsupportedExecution`, and older snapshots still build.
  The capability is uniform for all batches.
- **D8 Adapter label.** `native-script-v6-eval-script`.

## 7. Test-first slices

Each slice is: red tests, then implementation, then `pnpm build`, the focused tests and
`pnpm check` (3876 passing at capture). Keep every exit status. Native steps go to main's serial
queue only.

**EV1 (first; Node only): `createScriptEvaluator` with an injected `compile`.** Add a new
`js-engine/test/script-evaluation.test.ts`. Its spy host counts `compile`, `invoke` and `fault`,
and a real realm comes from `createErrorRealm`.

1. A non-string gives sticky unsupported plus a `throw undefined`, with 0 compiles.
2. `"var"` throws an object whose prototype is `realm.prototypes.get("syntax")`, with 0 compiles
   and 0 invokes.
3. `"let a; let a;"` (an early error) gives the same result.
4. A `LIMIT` source (one over the token budget) gives unsupported and is never a SyntaxError.
5. `compile` returning `{ok:false}` gives unsupported, with 0 invokes.
6. Two successful calls give distinct `$argument1` values, each with `.realm === realm`. Each
   frame has `$imports === host.table()` and `$argument0 === global`.
7. Completion `none` 7 returns 7. `throw` returns the identical thrown object. `unsupported`
   gives the sticky flag.
8. A completion view of `undefined`, an unknown `error`, or a throwing `invoke` calls `fault`
   once and gives unsupported.
9. A domain mismatch gives unsupported, with 0 parses (spy `compile` count 0).
10. With an outer context active, the call leaves `agent.activeContext` unchanged, and
    `agent.jobs` is not drained: a job enqueued by a fake `invoke` is still queued.

Edits: the new `script-evaluation.ts` (evaluator only), the `script-entry.ts` types (§5.1), and
`package.json` exports `./script-evaluation` and `./native/script-entry`. The js-engine
dependencies are unchanged (`workspace-contracts.json:3-8` already lists compiler and js-runtime).

**EV2 (Node): shared Script surface request.** Move `verify-hosted-managed-surface-directory.ts:27-111`
into a new `tools/script-surface-request.ts` export
`scriptRuntimeSurfaceRequest(snapshot, {frame, bind})`. The directory fixture must then emit a
byte-identical request without `frame`. Test: extend `tools/script-runtime-surface.test.ts` to
deep-equal the old and new requests, and to check that `frame:"ScriptEntryFrame"` validates
through `createManagedSurfaceDirectory` (types +1, records +1, per S2-e1 r6).

**EV3 (Node, after S2-e1 E3): `compileScriptEntry`.** Add one slow real-surface test that reuses
the S2-e1 E3 helper:

- A successful compile publishes exactly once.
- The tagged template and a forced profile error each give `{ok:false}` with 0 publishes.
- A spy storage whose `publish` returns `undefined` gives `{ok:false}`.
- `maxScriptCodeBytes` set 1 below the emitted size gives `{ok:false}`, with 0 publishes.

**EV4 (native): `tools/verify-hosted-eval-script.ts`.** Model it on `verify-hosted-script.ts`'s
`make()` and the S2-e1 §7 fixture. Use **Test262 resources exactly** (64 MiB managed, 1 Mi
allocation capacity, 1 MiB stack, and the D3 arena). Statuses, with a final 42:

1. The surface is read and `directory.frame === "ScriptEntryFrame"`.
2. Realm A: `"var v=40;let y=2;function f(){return v+y;}f();"` returns 42.
3. `"y+v"` returns 42, so lexical and var bindings persist.
4. `"var q; let y;"` throws A's SyntaxError, and `q` is absent from A's global.
5. `"var"` throws A's SyntaxError, and the publish count is unchanged.
6. `"throw 7"` rethrows 7, and the outer `activeContext` is restored.
7. Completions: `"var z;"` gives `undefined`, `"2;;"` gives 2, `"1; if(true){}"` gives `undefined`.
8. This and strictness: `"(function(){return this})()"` gives A's global this, and
   `"'use strict';(function(){return this})()"` gives `undefined`.
9. Nested: a Script function calls `evalScript`, which calls `evalScript`. Records are distinct,
   and each context is restored.
10. Jobs: `"Promise.resolve().then(function(){r=nativeActive();})"` is still pending after the
    call. After the host drain, it saw that call's record.
11. Child realm B (made through `createRealm`): its error is B's SyntaxError, and `w` from B is
    absent from A. The completion value of `"Symbol('s')"` is returned to A.
12. After 32 MiB of churn, A's `f()` from status 2 still returns 42 and sees record r1.
13. Realm C: a tagged template gives a sticky unsupported on C only.
14. Realm D: a non-string gives unsupported.
15. Fault seam: an evaluator with a wrong `table` sets the fault flag, and the call is unsupported.
16. Record the bytes per compile and the total arena use. Distinct statuses: 20 context leak,
    21 records not distinct, 22 publish count drift.

Do not retry failures. A stack or allocation fault is a finding (D4).

**EV5 (Node + build): Test262 wiring behind D7.** Edits to `tools/test262-native.ts`:

- `NativeRuntimeCapabilities.scriptEvaluation` is captured from the snapshot.
- The prelude imports `createScriptEvaluator` and `compileScriptEntry`, and holds one process
  `scriptService` memo plus `scriptFault`.
- At `:408-412`, `installRealmHost` builds `createScriptEvaluator({realm, global: host.global}, …)`
  per realm. Without the capability, it keeps the current rejection.
- `runNativeScripts` returns 13 if `scriptFault` is set, before the unsupported loops.
- In the builder (`:888-1123`): add the two js-engine modules to `runtimeModules`, embed the
  collection-runtime texts, add the host binding
  `{module: script-entry, name: "invokeScriptEntry", operation: "executable-call-managed"}`, the
  record binding `viewScriptCompletion` → `view`, and
  `managedSurfaces: [scriptRuntimeSurfaceRequest(snapshot, {frame: "ScriptEntryFrame", bind: {module: script-entry, name: "bindScriptSurface"}})]`.
- Apply the D3 resource fields.

`test262-native-run.ts:95,279` changes to the D8 label. Red tests in `tools/test262-native.test.ts`:

- With the capability, the generated runtime imports `createScriptEvaluator` and no longer calls
  `rejectUnsupportedExecution` in the `evalScript` callable.
- Without it, the generated text is byte-identical to today's.
- The request carries the `scriptRuntime` surface with its frame.
- `nativeExitOutcome(13)` is `crash`.
- The batch-sharing test (`test262-native-batch.test.ts:92`) is unchanged.

Update `docs/test262-runner.md:138-139`, `docs/native-code-loading.md:61` and
`docs/test262-inventory.md:10` in the same change. Status and backlog tables change only after
EV6.

## 8. Native Test262 commands (unchanged selection, serial queue)

Before EV5 lands, record the **baseline** on the pre-change snapshot. Each run is a new immutable
report:

```sh
TINT_TEST262_CAPTURE_SOURCES=.tint-bootstrap/evalscript-baseline-source-v1.json \
  node tools/test262-native-run.ts .tint-bootstrap/test262 language/global-code 8
```

After EV5, with a fresh capture (`evalscript-source-v1.json`), run:

```sh
node tools/test262-native-run.ts .tint-bootstrap/test262 language/global-code 8
node tools/test262-native-run.ts .tint-bootstrap/test262 annexB/language/global-code 8
node tools/test262-native-run.ts .tint-bootstrap/test262 annexB/language/eval-code/direct/script-decl-lex-no-collision.js 8
node tools/test262-native-run.ts .tint-bootstrap/test262 built-ins/Proxy/revocable/tco-fn-realm.js 8
node tools/test262-native-run.ts .tint-bootstrap/test262 intl402/FallbackSymbol/per-realm.js 8
node tools/test262-native-run.ts .tint-bootstrap/test262 built-ins/Function 8   # shared-arena regression
```

`test262Checkout` accepts file selections (`test262-checkout.ts:12-20`). Compare per variant
against the baseline and against v9 (annexB). Any pass → fail change is blocking. Report the 44
acceptance variants as pass / fail / unsupported with reasons. The 4 S5 variants must stay
`unsupported`; a pass there would be a defect. Do not update dashboard totals from focused runs.
Run a frozen self-build with byte-identical stages only if EV3 or EV5 changed compiler or
lowering sources (EV1, EV2 and EV5 do not).

## 9. Risks

1. **Compile cost per call.** Each `evalScript` runs the full S2-e1 pipeline in the image. An
   annexB test makes 3 calls and `var-collision` makes 8, all inside 60 s that also covers the
   build-time startup. EV4 timings decide this. If a call costs seconds, the remedy is the
   unpruned 95 import constants (S2-e1 risk 5), not a cache.
2. **GC with JIT frames active.** Compilation allocates under the outer test Script's frames.
   Dynamic Function already does this, but at about 64 KiB, not about 100 KiB.
3. **The 1 crash sibling** (`if-decl-else-decl-a-global-init.js`, v9) shares Annex B paths with
   its two `evalScript` siblings. Triage it separately and do not attribute it to S2-ev1.
4. **Image growth for every batch.** The surface publication and collection texts enter every
   Test262 image (D7). Measure batch compile time on one batch before a full run.
5. **Concurrent edits.** Main is landing S2-id2 and S2-e1. Re-run probe `v1` and re-check line
   anchors on the landing commit.

## 10. Next focused plan

**S3-ie1: indirect string `eval` on the same evaluator.** It reuses EV1's taxonomy and
`compileScriptEntry`, and adds `lowerEvalScript({mode:"indirect"})` with
EvalDeclarationInstantiation (non-persistent lexicals, configurable vars). It also routes
`installEvalIntrinsic`'s string path to the evaluator. Direct eval (S5) keeps the 4 blocked
variants here and comes after S3.
