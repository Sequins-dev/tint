# RT-EVAL S2: Script identity record and execution-frame contract

Status: **planned (research only).** Parent: [RT-EVAL](rt-eval.md) slice S2. This
plan covers one problem found by the [D6f plan](rt-eval-managed-jit-entry.md)
(§1.5, §4.6, §10.2). Lowered Scripts use their own `execute` closure as the
ECMAScript ScriptOrModule value, and so every lowered Script fails the managed
escape rule. The module loader (HOST-ESM), agents (HOST-AGENT), general
eval/`Function` scoping (S3–S6) and directory v3 integration (D6d2/D6e, in
progress on main) are out of scope. Their handoffs are listed in §7.

Captured 2026-11-04 against live source identity `1a302ac3…` (537 files,
`workspaceSourceIdentity`). The `dist` files for `compiler`, `js-engine`,
`js-runtime` and `codegen` were newer than their sources. The probes are read-only
Node scripts in `/tmp/tint-script-frame-plan` (`p0`, `q1`–`q4`). They import public
`dist` entry points, `tools/workspace-sources.ts` and the earlier `/tmp` harnesses
(`tint-managed-entry-plan`, `tint-managed-jit-entry-plan`). They emit no image or
executable, run no native code and write nothing in the workspace. **All probe
results are Node-only. No native, ABI, performance or conformance claim follows
from them.** The specification text was read from the current ECMA-262 draft
(tc39.es multipage, "ECMAScript 2027") and from the pinned Test262 `INTERPRETING.md`
(`91c70759`). Node was not consulted for semantics.

## 1. Answer in brief

1. **The identity is metadata with no behaviour.** No source file reads
   `scriptOrModule` except to copy it (§4). The one value that originates
   anywhere is `scriptOrModule: execute` in `lowerScript`. Nothing calls it or
   compares it, apart from one native fixture assertion
   (`verify-hosted-script.ts:4892`).
2. **The closure is the wrong identity.** ECMA-262 creates one Script Record per
   ParseScript, and that record carries `[[Realm]]` and `[[HostDefined]]`. A code
   value is per compilation. With the planned code cache (RT-EVAL §4), two
   `evalScript` calls on the same text would share one identity. In the JIT
   adapter, the value is also a fresh closure for each invocation (q3), so its
   identity is an accident of nesting.
3. **The fix is a host-created record passed in as a typed argument.** `execute`
   becomes `execute($global, $script: ScriptRecord)` and runs under
   `runScriptContext({realm: $script.realm, scriptOrModule: $script})`. The host
   (AOT) performs ParseScript and creates the record. JIT code only forwards it.
   With this change, the q3 simulation leaves **one value reference fewer** and no
   value reference to `execute` at all. It is then only a direct callee, which is
   D6f §4.6 allowance (b).
4. **Local-only closures are separate from escape.** Even when it is only a
   callee, the adapter's nesting keeps `execute` as a `function-new` target that
   is called by a JIT-internal `call-indirect` (q3: still 1 non-member out of 5
   targets). Codegen gives such a closure a JIT-private descriptor
   (`codegen/.../index.ts:3385-3410`), and it never reaches an AOT
   `call-indirect`. D6f must admit it through binder references (allowance (b)),
   not by ABI. The same `(reference,reference)→reference` ABI that matches four
   surface classes stays irrelevant once the function is not a value.
5. **`$imports` decision: `unknown` plus a checked JIT `view`, for every managed
   entry.** This reverses D6f §10.1. A directory frame must name an _exported_
   surface type (`managed-directory-data.ts:336-346`). The table alias `$T0` is
   synthesized after selection, and **no exported type or declaration references
   it** (q4: 0 of 18 exports, 0 of 919 declarations). An AOT-named frame therefore
   cannot have a `$T0`-typed field. The existing record `view` operation
   (`record-bindings.ts:67`, `general-record-is`), codegen's imported-descriptor
   path (`descriptorPointer`, `index.ts:1801-1810`) and `$T0` being a record class
   (q2) together give one frame convention with one descriptor check for each
   entry. They need no second layout and no new AOT materializer (§6.3).

## 2. Specification baseline (ECMA-262 draft, verified text)

| Algorithm                                 | Rule this plan depends on                                                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 9.4 Table 21                              | Each execution context has a ScriptOrModule component, "the Module Record or Script Record from which associated code originates", or null.                                                                                                                  |
| 9.4.1 GetActiveScriptOrModule             | Returns the ScriptOrModule of the topmost context whose ScriptOrModule is not null, otherwise null.                                                                                                                                                          |
| 16.1.4 Script Records                     | Fields `[[Realm]]`, `[[ECMAScriptCode]]`, `[[LoadedModules]]`, `[[HostDefined]]`.                                                                                                                                                                            |
| 16.1.5 ParseScript(sourceText, realm, hd) | Parse errors return a List of errors. Otherwise it returns a **new** Script Record `{[[Realm]]: realm, …, [[LoadedModules]]: « », [[HostDefined]]: hd}`.                                                                                                     |
| 16.1.6 ScriptEvaluation                   | Pushes scriptContext with Function null, Realm `scriptRecord.[[Realm]]` and ScriptOrModule `scriptRecord`. Then it runs GlobalDeclarationInstantiation and the body, pops the context **for every completion**, and returns `? result`.                      |
| 10.2.3 OrdinaryFunctionCreate             | `func.[[ScriptOrModule]]` = GetActiveScriptOrModule() and `func.[[Realm]]` = the current Realm, both at creation time.                                                                                                                                       |
| 10.2.1.1 PrepareForOrdinaryCall           | The callee context takes `func.[[ScriptOrModule]]` (the definition site, not the caller).                                                                                                                                                                    |
| 10.3.3 BuiltinCallOrConstruct             | Built-in contexts have a **null** ScriptOrModule, so the caller's record stays active.                                                                                                                                                                       |
| 19.2.1.1 PerformEval                      | evalContext's ScriptOrModule is the running context's. For indirect eval that is the built-in's null, which falls through to the caller. No new record is created.                                                                                           |
| 20.2.1.1.1 CreateDynamicFunction          | Runs OrdinaryFunctionCreate inside the `Function` built-in context, so the new function gets the **caller's** active record.                                                                                                                                 |
| 9.5 / 9.5.5 HostEnqueuePromiseJob         | The job runs with the enqueue-time GetActiveScriptOrModule() as the "active script or module". That condition also requires that the topmost context holding it has Realm `scriptOrModule.[[Realm]]`. Non-browser hosts use the default HostMakeJobCallback. |
| 13.3.10.2 EvaluateImportCall; 16.2.1.10   | The referrer is GetActiveScriptOrModule(), or the current Realm when there is none. HostLoadImportedModule must be idempotent per (referrer, request).                                                                                                       |
| `INTERPRETING.md` `evalScript`            | realm = current Realm. `s` = ParseScript(…, realm, hostDefined). Errors return a throw completion of the first error, and then the result is ScriptEvaluation(s).                                                                                            |

Consequences: identity is **per parse**, it carries its realm, and eval code and
dynamic functions **inherit** the active record instead of creating one. Today
the identity is observable only through `import()` referrers and
`[[HostDefined]]`, which belong to HOST-ESM. No pinned Test262 file combines
`evalScript` with `import(`. Correctness here protects later work and is not a
current pass-rate lever.

## 3. Implemented versus planned

| Item                                                                                                                                                                    | State                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ScriptExecutionContext {realm; scriptOrModule: unknown}`, `runScriptContext`                                                                                           | Implemented (`js-runtime/src/objects/jobs.ts:13-54`). `finally` restores on abrupt completion         |
| Capture and propagation (functions, generators, async, jobs, built-ins)                                                                                                 | Implemented (§4)                                                                                      |
| `lowerScript` entry `execute($global, $errors)`, `scriptOrModule: execute`                                                                                              | Implemented (`js-engine/src/lowering/index.ts:4242-4300`). GDI runs inside the context (`:4159`)      |
| AOT hosts calling `execute(global, realm)`                                                                                                                              | Implemented (`tools/test262-native.ts:262,473,479`; harness, hosted-script and agent-policy fixtures) |
| Managed adapter `$imports: surface.table`, `$argument<i>`                                                                                                               | Implemented (`compiler/src/native/managed-entry.ts:86-88,183`), JIT-private frame                     |
| Directory `frame` (exported record name), `ManagedSurfaceExport.table: unknown`                                                                                         | Implemented, v2 (`managed-directory-data.ts:33,56-60,336-346`)                                        |
| AOT record `view` operation, imported record descriptors in codegen                                                                                                     | Implemented (`ts-native/.../record-bindings.ts:67`; `codegen/.../index.ts:1801-1810`)                 |
| `planManagedSurfaceRuntimes`, `createManagedRuntimeAnchors`, `resolveManaged{Collection,Runtime}Names`, `materializeManagedRuntimeProviders`, `createRuntimeEntryStubs` | Implemented on main. Directory still v2. v3 data, AOT and reader wiring pending                       |
| `ScriptRecord`, `createScriptRecord`, frame `ScriptEntryFrame`, JIT `$imports` view                                                                                     | **Planned (this document)**                                                                           |
| `$262.evalScript` service, general eval success                                                                                                                         | **Planned (S2 proper, S3, S5)**. None exists                                                          |

## 4. Readers and writers of `scriptOrModule` (current source)

| Site                                                                  | Role                                                                  | Spec counterpart                                  |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| `lowering/index.ts:4261-4265`                                         | **Origin**: `{realm: $errors, scriptOrModule: execute}`               | ScriptEvaluation steps 2-5                        |
| `objects/jobs.ts:113-126` `createSourceExecutionContext`              | Captures the active record when a source function or class is created | OrdinaryFunctionCreate + PrepareForOrdinaryCall   |
| `objects/generators.ts:123-135`                                       | Captures at generator object creation, inside the callee context      | Generator context = callee context                |
| `objects/async-functions.ts:66-73`, `async-generators.ts:85-93`       | Same, for continuations                                               | Same                                              |
| `objects/errors.ts:236-249`                                           | The built-in realm context **inherits** active                        | BuiltinCallOrConstruct null + 9.4.1 walk          |
| `objects/jobs.ts:56-66` `enqueueScriptJob`                            | Records the enqueue-time active record                                | HostEnqueuePromiseJob                             |
| `objects/jobs.ts:74-110` `drainScriptJobs`                            | Runs the job as `{realm: callback realm, scriptOrModule: queued}`     | 9.5 job preparation                               |
| `objects/classes.ts:134`, `derived-classes.ts:91`, `functions.ts:165` | Callers of `createSourceExecutionContext`                             | ClassDefinitionEvaluation, OrdinaryFunctionCreate |

There is no semantic reader in `src`. Test readers: `js-runtime/test/ordinary-object-jobs.test.ts`
(string tokens), `js-engine/test/lowering.test.ts:752-770` (asserts the name
`execute` in the context literal), and six hosted tools that use tokens `42`,
`99` or strings (`verify-hosted-{async-functions,async-generator-objects,await,promise-objects,script-jobs}.ts`),
plus `verify-hosted-script.ts:4892` (`=== entry`).

Realm note. The single-context model conflates the job's callback realm with
the record. The spec's condition is that the topmost context holding the record
has the record's own realm. Once the record carries `realm`, that fact is
available wherever a referrer is needed, and the conflation becomes
unobservable. No change to `drainScriptJobs` is needed beyond typing.

## 5. Probe results (Node only)

| Probe | Question                                                   | Result                                                                                                                                                                              |
| ----- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p0    | Source identity and `dist` freshness                       | `1a302ac3…`, 537 files; four packages' `dist` newer than `src`                                                                                                                      |
| q1    | Uses of `execute` in `lowerScript` output (3 Scripts)      | Exactly 1 identifier reference each, the `scriptOrModule` value. 1 `runScriptContext` call. Params `$global`, `$errors`                                                             |
| q1    | Is `ScriptExecutionContext` a vocabulary export?           | No (118 entries). The literal is contextually typed by `runScriptContext`. `ErrorRealm` is exported                                                                                 |
| q2    | Is the table a record class?                               | `$T0` is a record class; 178 records, 159 signature classes; 18 type exports                                                                                                        |
| q3    | Replace the value with a frame argument `$script: unknown` | Refs: before 2 (value + callee), after 1 (callee). Frame gains `$argument2`. IR unchanged: 51 functions, 17 imports, 5 `function-new` targets, 1 non-member (`execute`, local only) |
| q4    | Can an exported type or declaration name `$T0`?            | 0 of 18 exports, 0 of 919 declarations                                                                                                                                              |

q3 shows that removing the value reference fixes the _escape_ question without
changing the lowered IR. `execute` stays a JIT-local closure, which is exactly the
case D6f §4.6(b) must admit by binder references. q3 used `unknown` for the
parameter because `ScriptRecord` does not exist yet. The typed form adds one
record class and changes no ABI word (both parameters are references).

## 6. Design

### 6.1 Runtime record (`js-runtime/src/objects/jobs.ts`)

```ts
/** ECMA-262 16.1.4. One per ParseScript, never per compiled code. */
export interface ScriptRecord {
  readonly kind: "script"; // discriminant for the HOST-ESM union
  readonly realm: ErrorRealm; // [[Realm]]
  readonly hostDefined: unknown; // [[HostDefined]]; the embedding owns it
}
export function createScriptRecord(
  realm: ErrorRealm,
  hostDefined: unknown,
): ScriptRecord;
```

`[[ECMAScriptCode]]` is the compiled entry, which the host holds, not the record.
`[[LoadedModules]]` is added by HOST-ESM (§7). `ScriptExecutionContext.scriptOrModule`
keeps the type `unknown` in S2 (decision D2), so job, generator and async code
and their tests are unchanged.

### 6.2 Lowering contract (`js-engine/src/lowering/index.ts`)

```ts
export function execute(
  $global: GlobalEnvironment<ScriptPropertyKey, unknown>,
  $script: ScriptRecord,
): ScriptCompletionRecord {
  const $errors = $script.realm; // single source of the realm
  return runScriptContext<ScriptCompletionRecord>(
    $errors.agent,
    { realm: $errors, scriptOrModule: $script },
    () => {
      /* unchanged try/GDI/body */
    },
  );
}
```

The vocabulary (`runtime-imports.ts`) gains the type `ScriptRecord`, with no
values. The body is unchanged, so S2's "lowered output identical except imports"
acceptance still applies. `execute` is no longer a value anywhere. The arity
stays at 2, but the second parameter's type changes, so stale hosts fail to type
check instead of silently passing a realm.

### 6.3 Frame contract and the `$imports` decision

One convention for all managed entries, typed entries included:

```ts
// js-engine runtime-compilation (AOT), selected as a surface type, `frame: "ScriptEntryFrame"`
export interface ScriptEntryFrame {
  readonly $imports: unknown; // the bound surface table, checked once per entry
  readonly $argument0: GlobalEnvironment<ScriptPropertyKey, unknown>;
  readonly $argument1: ScriptRecord;
}
```

`adaptManagedSurfaceEntry` declares `$imports: unknown` and binds a record `view`
of the table alias (record operation `"view"`, the existing `recordBindings`
path). It then emits `const $t = view($frame.$imports); if ($t === undefined)
throw "MANAGED_SURFACE_TABLE";` before the import constants, which read `$t.<entry>`.

Evidence and rejected alternatives:

- **Typed `$imports: $T0`** with a user-named frame is not expressible (q4). It
  would need either a compiler-synthesized frame type and a new AOT stub kind
  that builds the frame from `bind()`'s exact `_table`
  (`managed-export-body.ts:254-347`), or a structural copy of a 100-field table
  in AOT source. Both add machinery to save one descriptor compare.
- **A typed frame for typed entries and `unknown` for Scripts** would be two
  frame layouts (a `reference` slot against a `general` slot) and two adapter
  paths. That is the unnecessary second ABI.
- **`unknown` plus view** reuses `general-record-is` against the imported `$T0`
  descriptor. `$T0` must already be imported as a record binding for field loads,
  and it already appears in `ManagedSurfaceExport.records` because it is a record
  class. AOT code stores `bind().table` directly, with no narrowing. The existing
  hosted entry fixture keeps passing `{$imports: table, …}`.

### 6.4 Data flow (evalScript, S2 proper)

1. AOT `evaluateScript(realm, source)`: `parseScript`. A syntax error throws the
   current realm's SyntaxError. **No record and no context exist yet.**
2. `script = createScriptRecord(realm, hostDefined)`, which is fresh even on a
   code-cache hit.
3. Get code from the cache (keyed by source and flags, never by record), or run
   `lowerScript` → `prepareManagedSurfaceEntry` → publish.
4. AOT allocates `ScriptEntryFrame{$imports: bound.table, $argument0: global,
$argument1: script}` with the imported record descriptor, and keeps it as a
   rooted local across the call.
5. JIT wrapper: view check → `execute($argument0, $argument1)` →
   `runScriptContext` (imported runtime entry) pushes and pops the context. GDI
   errors and body throws become `{error: "throw"}` after the context is
   restored.
6. AOT rethrows `throw` completions, maps `unsupported` to
   `rejectUnsupportedExecution` and returns the value.

AOT-compiled Scripts follow the same order. `runNativeScripts` creates one record
per Script entry with `hostDefined: undefined` and calls `script(global, record)`.

### 6.5 Ownership, lifetime, GC and context domain

- **Owner.** The record is created only by AOT host code, from a realm the host
  already owns. JIT code never allocates or inspects it. It forwards an opaque
  traced reference into an AOT runtime entry.
- **Lifetime.** It is an ordinary managed object, reachable from active
  `runScriptContext` frames, from function, generator and async contexts, and
  from queued jobs. It moves under copying GC. Identity is reference equality,
  which survives moves. It is never stored in code, the code cache, directory
  data or permanent memory.
- **Domain.** `record.realm.agent` is the agent that runs the image. Realms of
  one agent share a domain (child `createRealm` realms share `parent.agent`). The
  record does not cross agents. HOST-AGENT creates records inside the target
  agent. Invariant check in the service: `script.realm === realm`, otherwise
  fail with `SCRIPT_REALM_INVARIANT`.
- **Not executable metadata.** Equal ABI, equal entry addresses or equal code
  never imply equal identity.

## 7. Handoffs (explicit, not designed here)

| Consumer         | Contract handed off                                                                                                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S3/S5 eval       | Eval entries create **no** record. They run as `{realm: evalRealm, scriptOrModule: activeContext?.scriptOrModule}` (PerformEval). The frame carries no record field.                                                                                                                                                      |
| S4/S6 `Function` | Unchanged. `createSourceFunction` inside the built-in context already captures the caller's record. JIT bodies never see it.                                                                                                                                                                                              |
| HOST-ESM         | `ModuleRecord` gets `kind: "module"`. `ScriptOrModuleRecord = ScriptRecord \| ModuleRecord`. Narrow `scriptOrModule` to `ScriptOrModuleRecord \| undefined`. Add `loadedModules` to both. `ModuleHost.load(referrer: ScriptOrModuleRecord \| ErrorRealm, …)`. `evaluateImportCall` reads the active record, or the realm. |
| HOST-AGENT       | `$262.agent.start` compiles with S2 and calls `createScriptRecord(agentRealm, hostDefined)` in the agent.                                                                                                                                                                                                                 |
| D6f              | §4.6(b) admits `execute` as callee-only. §10.1 is resolved here as `unknown` plus view (D6f2 adopts §6.3). §10.2 is resolved by §6.2.                                                                                                                                                                                     |

## 8. Implementation slices (red-first)

Each slice starts with failing tests, then the implementation, `pnpm build` and
focused tests. Native steps go to main's serial queue.

**S2-id1, runtime record** (`js-runtime`). Tests in `ordinary-object-jobs.test.ts`:
`createScriptRecord` returns distinct records for equal arguments; the realm and
`hostDefined` are retained; a record used as the context token is captured by
`createSourceExecutionContext`, by a generator and by a queued job, and is the
same reference after `drainScriptJobs`. Existing string-token tests stay as they
are.

**S2-id2, lowering and hosts** (`js-engine`, `tools`). Red: `lowering.test.ts:752`
expects the parameters `$global`/`$script`, a context literal
`{realm: $errors, scriptOrModule: $script}`, **zero** `execute` identifiers in
`execute`'s body, and `ScriptRecord` in the vocabulary with no type arguments.
`runtime-imports.test.ts` expects the vocabulary to grow by one type. Then update
`NativeScript`/`runNativeScripts`, `verify-hosted-test262-harness.ts`,
`verify-hosted-script.ts` (assert `=== record`), and
`build-native-agent-policy-fixture.ts`. Native: `verify-hosted-script` and
`verify-hosted-script-jobs` under LLDB, a focused unchanged Test262 rerun
(`language/global-code`, Promise jobs), and a frozen self-build with stage
comparison, because lowering is compiler source.

**S2-id3, D6f escape acceptance** (needs D6f5). The §3 Script, now lowered with
`$script`, passes the escape check. `execute` is accepted by (b), and the four
arrows by membership. A hand-made variant that keeps `scriptOrModule: execute`
is still rejected with `JIT closure without an exact surface callback class`.

**S2-id4, frame and view** (`managed-entry.ts`, with D6f2). Red: an adapted
module declares `$imports: unknown` and contains one `view` record binding for
the table alias. A frame that is not the table throws `MANAGED_SURFACE_TABLE`
before any import read. The directory `frame` `ScriptEntryFrame` validates. The
existing typed-entry hosted fixture passes unchanged at the AOT call site.

**S2-id5, census update** (directory v3 tests). Red: the full Script-surface
census adds `ScriptRecord` and `ScriptEntryFrame` (type exports 18 → 20, records
178 → 180) while the collection keys stay at 39 and providers, slots and targets
stay at 41/355/323. Recompute the digest fixtures. These figures are predictions
until the test runs.

## 9. Semantic, ordering and native fixtures

Node (`js-runtime`, `js-engine`):

- Abrupt GDI: a colliding global `let` throws before any statement, and
  `activeContext` is `undefined` afterwards.
- A body throw and a `return` from a nested function both restore the context.
- A nested `runScriptContext` for record B inside A restores A on throw (as
  today, but with records).

Native (`TINT_BUILD_ONLY=1`, LLDB, stop-at-entry plus exit assertions, one
immutable report per run):

1. Two AOT Scripts give two distinct records. `nativeIdentity` sees the record of
   the Script it runs in.
2. A function defined in Script 1 and called from Script 2 sees record 1. A
   `Function`-created function made in Script 2 sees record 2.
3. A Promise job enqueued in Script 1 and drained after Script 2 sees record 1.
   A generator created in Script 1 and resumed from Script 2 sees record 1.
4. A child realm Script gets a record whose `realm` is the child realm, and the
   functions it creates have the child `[[Realm]]`.
5. A record retained only through a closure survives 32 MiB of churn and is still
   `===` when the closure is called later.
6. Reject: a JIT entry given a frame whose `$imports` is a foreign record throws
   `MANAGED_SURFACE_TABLE`, and no import is invoked.

## 10. Compatibility fallout and directory changes

- **ABI and calls.** Every host of a lowered Script changes its second argument
  (four tool files, including the agent-policy fixture). The arity is unchanged and type checks
  catch stale callers.
- **Tests.** One lowering assertion, the vocabulary count, one native fixture
  assertion. Token-based job tests are unaffected while the field type stays
  `unknown`.
- **Directory (v3, D6d2/D6e).** The vocabulary type count grows, and so do the
  record classes and the digest. The frame becomes required for the Script
  surface. No new runtime providers. The D6f probe counts (q1 type applications,
  q6 selection) are unchanged because `ScriptRecord` is not generic. Re-run them
  with D6f1.
- **Docs.** RT-EVAL §4.4 `ManagedScriptFrame{imports, global, realm, instance,
site}` maps to `$imports`, `$argument0` (global) and `$argument1` (record),
  with realm derived. `instance` and `site` are added later as further
  `$argument` fields.
- **Self-build.** Lowering changes, so stage images must be compared. Code
  emission is unchanged for non-Script sources.

## 11. Remaining decisions (recommended defaults)

1. **D1, entry signature.** `execute($global, $script)` with the realm derived
   from the record (default). The alternative, a third parameter, needs a runtime
   check that the realm and the record agree.
2. **D2, context field type.** Keep `unknown` until HOST-ESM (default). Narrowing
   now forces six tool fixtures and the job tests onto records with no semantic
   gain.
3. **D3, `$imports`.** `unknown` plus a checked `view` for every entry (decided
   in §6.3). Revisit only if a synthesized frame stub is needed for other
   reasons.
4. **D4, record fields.** `{kind, realm, hostDefined}` only (default).
   `loadedModules` arrives with HOST-ESM and its census update.
5. **D5, template instance state.** Keep it as a separate frame field, not on
   the record (default). The record is per parse too, but coupling them would
   make every template change a record layout change.
6. **D6, Test262 `hostDefined`.** Use `undefined` until HOST-ESM needs the
   source path for referrer resolution (default).

## 12. Risks

1. **Binder completeness.** S2-id3 relies on D6f §4.6(b) seeing every reference.
   Keep the D6f fallback to rejection for unknown reference shapes.
2. **Per-entry view cost.** One descriptor compare per entry is expected to be
   negligible. It has not been measured natively.
3. **Prediction drift.** The §8 census figures and the q3 equivalence are
   Node-only and were taken before v3 wiring. Re-derive them on the landing
   commit.

**Next:** a focused planning pass for S2-id2 alone, an exact edit list for
`lowerScript`, the vocabulary and the four host files, plus the frozen
self-build and focused Test262 rerun commands. Run it once D6d2 settles the v3
census baseline, so that S2-id5's figures are measured rather than predicted.

That pass is [S2-id2 Script identity migration](rt-eval-script-identity-migration.md).
