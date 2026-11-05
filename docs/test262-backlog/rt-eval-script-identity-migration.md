# RT-EVAL S2-id2: Script identity migration (edit list)

Status: **Runtime records, lowering and host migration implemented.**
Fresh identities and realm/host-data retention pass the
[native jobs fixture](../results/native-script-record-jobs-v1.json).
The [lowering fixture](../results/native-script-record-lowering-v1.json) and
[complete Script host fixture](../results/native-script-record-host-v1.json) pass.
The historical edit list below describes the pre-migration source; managed Script
publication and eval remain separate slices.

Parent: [Script frame plan](rt-eval-script-frame.md)
§8 S2-id2. S2-id1 (the runtime record) is implemented; the first slice below records its contract. The scope is: replace `lowerScript`'s
`scriptOrModule: execute` closure value with a host-created `ScriptRecord`
(one per ParseScript), change the entry to `execute($global, $script)`, add one
registry vocabulary type, and update every host call site. Out of scope: the
`$imports: unknown` view (S2-id4), D6f escape acceptance wiring (S2-id3),
`$262.evalScript`, eval code (S3/S5), HOST-ESM and HOST-AGENT.

Captured 2026-11-04 on live source of 541 files (identity drifted during the
probes: `4dc892bf…`, `99bdc2a5…`, `8e6a9083…`; counts stayed stable), with
`dist` newer than `src` for `js-runtime`, `js-engine`, `compiler`, `ts-native`,
`typescript` and `codegen` (`p0`). Probes `p0`, `q1`-`q3` and `common.mts` live in
`/tmp/tint-script-identity-plan`. They import public `dist` entry points and
`tools/workspace-sources.ts`, overlay source **in in-memory snapshot bytes
only**, write nothing in the workspace and emit no image. **All probe results
are Node-only and non-native; no native, ABI, GC or conformance claim follows.**
The frozen self-build (`d09e0bdf…`, 538 files) and its pause marker were not
touched. Spec: current ECMA-262 draft ("ECMAScript 2027"), re-read for this plan.

## 1. Answer in brief

1. **Four package files and four host files change.** `js-runtime`:
   `objects/jobs.ts` (`ScriptRecord`, `createScriptRecord`) and
   `objects/index.ts` (exports). `js-engine`: `lowering/index.ts` (entry) and
   `lowering/runtime-imports.ts` (one type-only name). Hosts:
   `tools/test262-native.ts`, `verify-hosted-test262-harness.ts`,
   `verify-hosted-script.ts`, `build-native-agent-policy-fixture.ts`. Nothing
   else in `src` or `tools` calls a lowered entry (§3).
2. **The value escape goes away and the direct call is proven.** Probe q2
   lowers four Scripts, applies the planned edit in memory, then runs
   `normalizeManagedSurfaceApplications` → `adaptManagedSurfaceEntry` →
   `checkClosureModule` → `managedDirectCallDeclarations`. Today `execute` has
   **1** self-reference and the proof returns **none**; planned, **0** and the
   proof returns **`execute`** for every sample. Erasure counts (35/36/24/4)
   are unchanged and the `ScriptRecord`-typed parameter checks.
3. **Census delta: one type, one record class** (q1 overlay): vocabulary
   118 → 119; type exports, table and canonical types 18 → 19; record classes
   178 → 179 (aliases 189 → 190). Values 100, roots 27, signature classes 159,
   anchors 78, collections 39/332, providers 41, slots 355 and witnesses 64 do
   not change, with or without the `kind` literal and in either vocabulary
   position. Canonical `$T` aliases **are renumbered** (q3, §8).
4. **Realms, jobs, generators, async code and dynamic `Function` need no
   change.** They copy `activeContext.scriptOrModule` (frame plan §4), which
   stays `unknown` (D2). `createDynamicFunctionCompiler` builds functions with
   `createSource*Function` inside the `Function` built-in's inheriting context
   (`errors.ts:236-249`, `functions.ts:165`), so they capture the caller's
   record, as CreateDynamicFunction requires.
5. **Decided framing stays.** `$imports: unknown` plus a checked record `view`
   remains the S2-id4 contract. This slice does not touch
   `adaptManagedSurfaceEntry` and adds no typed private table aliases.

## 2. Specification points this slice implements

Verified against the current draft text:

- **16.1.4, Table 35.** Script Record fields are `[[Realm]]`,
  `[[ECMAScriptCode]]`, `[[LoadedModules]]` and `[[HostDefined]]` ("anything").
- **16.1.5 ParseScript.** On success it returns a **new** record with
  `[[LoadedModules]]: « »`, so identity is per parse, never per compiled code.
- **16.1.6 ScriptEvaluation.** It pushes a context with Function null, Realm
  `scriptRecord.[[Realm]]` and ScriptOrModule `scriptRecord`, runs GDI and the
  body, and removes the context for every completion. In tint,
  `runScriptContext`'s `finally` does the removal, and the record's `realm`
  is the pushed context's realm.
- **10.2.1.1/10.2.3, 19.2.1.1, 20.2.1.1.1, 9.5** (functions, PerformEval,
  CreateDynamicFunction, jobs) already hold for any token (frame plan §2, §4).
  Only the token's origin changes.

## 3. Complete call-site inventory (current source)

**Producer.** There is exactly one: `packages/js-engine/src/lowering/index.ts`.

- `execute` is emitted at `:4279-4300`, with parameters `$global` (`:4287`)
  and `$errors: ErrorRealm` (`:4295`).
- The context literal `{realm: $errors, scriptOrModule: execute}` is at
  `:4262-4265`.
- `$errors` is referenced 52 times in generated code inside `execute`. Template
  sites are module-level `const`s that do not reference `$errors`
  (`:1958-1990`).

**Hosts that call a lowered entry.** These must change.

| File                                         | Site                                                                                                                                    | Edit                                                                                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/test262-native.ts`                    | `:247` runtime-module `"object"` import; `:262` `type NativeScript=(global,realm:ErrorRealm)=>…`; `:473`, `:479` `script(global,realm)` | Import `createScriptRecord,type ScriptRecord`; retype as `(global,script:ScriptRecord)`; pass `createScriptRecord(realm,undefined)` per call |
| `tools/verify-hosted-test262-harness.ts`     | `:65` `"object"` import; `:77-79` three `(global,realm)` calls                                                                          | Import `createScriptRecord`; create three records; pass them                                                                                 |
| `tools/verify-hosted-script.ts`              | `:4844` import; `:4875` `invoke(entry:(global,errors:ErrorRealm)=>…)`; `:4892` `active.scriptOrModule!==entry`; `:4896` call            | Retype to `ScriptRecord`; `const script=createScriptRecord(errors,undefined)` before the probe install; check `!==script`                    |
| `tools/build-native-agent-policy-fixture.ts` | `:21` hand-written `execute(global,realm:ErrorRealm)`                                                                                   | `execute(global,script:ScriptRecord)`; check `script.realm.agent.canSuspend`                                                                 |

**Unchanged, but check during review:**

- `test262-native.ts:532` (`import {execute as scriptN}`) and the
  `test262-native-batch.test.ts:92` sharing test. Identical Script text still
  shares one module. That test is the concrete case where the closure identity
  was wrong: two Script entries had one ScriptOrModule. A record per call fixes
  it with no change to the batch builder.
- `$262.evalScript` (`test262-native.ts:408-412`) stays
  `rejectUnsupportedExecution`.
- `installEvalIntrinsic` (`global-properties.ts:21-39`) still rejects string
  source.
- `js-engine/src/dynamic-function.ts` has no Script entry.
- Six hosted job and async tools (`verify-hosted-{script-jobs,await,promise-objects,async-functions,async-generator-objects}.ts`)
  and `js-runtime/test/ordinary-object-{jobs,array-realm}.test.ts` call
  `runScriptContext` directly with tokens. They still type-check while the
  field type stays `unknown`.
- `verify-hosted-managed-closure-uses.ts` and `managed-closure-uses.test.ts` use
  the literal `scriptOrModule:execute` as a **negative** pattern. Keep them.

**Tests that change** (they assert the shape or counts this slice changes):

| File                                           | Assertion today                                                                   | New expectation                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `js-engine/test/lowering.test.ts:752-771`      | `body.statements[0]` is `return`; context mentions `"name":"execute"`             | `[0]` is `const $errors: ErrorRealm = $script.realm`; `[1]` is the `return`; the context value is the identifier `$script` |
| `js-engine/test/lowering.test.ts:80-95`        | parameter 0 `$global`                                                             | also parameter 1 `$script`, typed `named ScriptRecord` with no type arguments                                              |
| `js-engine/test/runtime-imports.test.ts:56-80` | `ScriptCompletionRecord` is type-only                                             | also `ScriptRecord` is type-only                                                                                           |
| `js-engine/test/runtime-surface.test.ts:50-56` | 118 names, 37 generic                                                             | 119 names, 37 generic. All eight corpus SHA-256 values change (lowered JSON). Recompute them, change nothing else          |
| `tools/script-runtime-surface.test.ts:198,242` | `types: 18`; table types 18                                                       | `types: 19`; table types 19. Keep 100/27/10, erasure `[35,36,24]`, 78/39/332, 41/43/355 unchanged                          |
| `tools/verify-hosted-script-lowering.ts:17,49` | native: `body.statements[0]` is `return` (status 25); `surface.length!==118` (33) | read `[1]`, require `[0]` to be the `$errors` const (new status 37); 119                                                   |

`verify-hosted-managed-surface-directory.ts` (the v3 Script-mode publication)
is driven by the vocabulary and has no hard-coded counts. Its next run publishes
179 records automatically. Do not edit it while queued runs depend on it.

## 4. Exact edit list

### 4.1 `packages/js-runtime/src/objects/jobs.ts`

Add these after `ScriptExecutionContext`:

```ts
/** ECMA-262 16.1.4 Script Record: one per ParseScript, never per compiled code.
 * [[ECMAScriptCode]] is the host-held entry; [[LoadedModules]] arrives with
 * HOST-ESM. Identity is reference equality and survives moving collection. */
export interface ScriptRecord {
  readonly kind: "script";
  readonly realm: ErrorRealm;
  readonly hostDefined: unknown;
}
/** ParseScript's record step. Only hosts call this, after a successful parse;
 * JIT code forwards records and never creates them. */
export function createScriptRecord(
  realm: ErrorRealm,
  hostDefined: unknown,
): ScriptRecord {
  return { kind: "script", realm, hostDefined };
}
```

Keep `ScriptExecutionContext.scriptOrModule: unknown` (D2). Do not change
`drainScriptJobs`. It runs a job as `{realm: callback realm, scriptOrModule:
queued}`. The record's own `realm` now keeps 9.5's "topmost context with
`scriptOrModule.[[Realm]]`" fact available to HOST-ESM without any change here.

### 4.2 `packages/js-runtime/src/objects/index.ts`

In the existing `./jobs.ts` export block (`:12-20`), add
`createScriptRecord` and `type ScriptRecord`. This needs no package-manifest,
project-reference or `workspace-contracts.json` change, and no catalog
regeneration, because no file or package is added.

### 4.3 `packages/js-engine/src/lowering/runtime-imports.ts`

- In the `@tint/js-runtime/objects` list, insert `"ScriptRecord"` right after
  `"ScriptCompletionRecord"`. This keeps the entry types together. The census
  does not depend on the position (q1).
- Add `name === "ScriptRecord"` to the type-only predicate.
- `scriptRuntimeTypeArguments` needs no change, because the default `[]` is
  correct for a non-generic record.

### 4.4 `packages/js-engine/src/lowering/index.ts` (`lowerScript` tail only)

1. **Context literal** (`:4262-4265`). Change the values to
   `[id("$errors"), id("$script")]`. The `realm` value stays `$errors`, so the
   52 body references are not rewritten.
2. **Entry body.** Prepend a `const` declaration to `contextualBody.statements`:
   - name `$errors`;
   - type `named("ErrorRealm")`;
   - initializer `member(id("$script"), "realm")`, using the `generated` span.

   This gives one source for the realm (D1). `ErrorRealm` is already imported
   as a type.

3. **Parameters** (`:4295`). Replace the second parameter with
   `{ ...generated, name: "$script", type: named("ScriptRecord") }`.
4. **Comment.** Replace the stale comment at `:4246-4247` with: "The host
   creates one ScriptRecord per ParseScript and passes it in. `execute` is never
   a value, so managed entries can prove it as a direct-call declaration."

Leave the body, the `try`/`$thrown` handler, GDI, the imports apart from §4.3,
and the template sites unchanged. The arity stays at 2. Stale hosts that pass a
realm fail type checking (`ErrorRealm` is not assignable to `ScriptRecord`) and
are not silently accepted.

### 4.5 Hosts and records

Apply the §3 host edits with one fresh record per _Script evaluation_
(`hostDefined: undefined`, D6): per `runNativeScripts` loop iteration and for
the final test Script, never cached beside the shared code modules. In
`verify-hosted-script.ts`, create the record before the `nativeIdentity`
closure and also assert `script.realm===errors`. Bump the adapter identity at
`test262-native-run.ts:279` from `native-script-v4-shared-image` to
`native-script-v5-script-records`, because the host entry contract changed.
In the same commit, mark S2-id1/S2-id2 implemented in frame plan §3; leave
backlog tables and status records until native evidence exists.

## 5. Why `execute` no longer escapes

D6f's managed escape rule rejects a JIT-local closure that has no exact surface
callback class. `managedDirectCallDeclarations`
(`compiler/src/native/managed-closure-uses.ts`) grants the exception only when
the proof below holds:

- The checker's binder finds the function declaration nested under the
  adapter wrapper.
- **Every** reference to that binding is a `read` whose node is the callee
  identifier of a call.

The current entry has two references: the wrapper's call and the context
literal's value. The second is a stored value, and
`managed-closure-uses.test.ts:49-63` pins exactly that shape as rejected.

After §4.4, `execute`'s body has no `execute` identifier. The only remaining
reference is the call `execute($frame.$argument0, $frame.$argument1)`, which
`adaptManagedSurfaceEntry` emits (`managed-entry.ts:216-229`). That is a direct
callee. q2 confirms this on lowered output: the proof moves from `(none)` to
`execute`.

The record reaches `runScriptContext` as data, an opaque traced reference
typed `ScriptRecord`. No function value goes through the AOT boundary. The
remaining JIT-internal `call-indirect` of the nested closure (frame plan §1.4)
is admitted by the binder proof, not by ABI matching.

## 6. Test-first slices

Each slice: write red tests → implement → `pnpm build` → run focused tests →
run `pnpm check`. Keep each command's exit status. Native steps go to main's
serial queue (§7).

### Slice A (S2-id1): runtime record

Red tests in `js-runtime/test/ordinary-object-jobs.test.ts`. Import
`createScriptRecord` from `../src/objects/jobs.ts`.

1. `createScriptRecord(r, h)` twice gives `!==` records, each with
   `kind === "script"`, `realm === r` and `hostDefined === h`.
2. A `createSourceExecutionContext(r)` made under `{realm: r, scriptOrModule:
rec}` still sees `rec` when run after that context exits (definition site).
3. A job enqueued under `rec` runs with `rec` and the callback realm, even when
   drained after a second context for `rec2` has finished.
4. A generator created under `rec` and resumed under `rec2` sees `rec` (reuse
   the existing `createGeneratorObject` test shape).
5. **Dynamic-function inheritance.** Install the realm's `Function` intrinsic
   with a stub `realm.dynamicFunctionCompiler` that returns
   `createSourceFunction(impl, …, realm, …)`. Call `Function` under `rec` via
   `callObject`. Then call the returned function outside any context, and check
   that `impl` sees `rec`.
6. Nested abrupt completion: record B inside record A restores A, and
   `undefined` at the end.

Existing string-token tests stay as they are.

### Slice B (S2-id2): lowering, vocabulary and hosts

Red tests:

- `lowering.test.ts:752`. Rename it "Script entries enter the host record's
  realm and never use the entry as identity". Assert:
  - parameter names `["$global", "$script"]`, and the second type is `named`
    `ScriptRecord` with no `arguments`;
  - `body.statements[0]` is a `const` named `$errors` whose initializer is
    `member($script, "realm")`;
  - `statements[1]` is `return runScriptContext<ScriptCompletionRecord>(…)`;
  - context properties `realm`/`scriptOrModule` hold identifiers
    `$errors`/`$script`;
  - a walk of `entry.body` finds **zero** identifiers named `execute`;
  - `action.body.statements[0]` is still a `try`.
- `runtime-imports.test.ts`: `ScriptRecord` binding exists, is type-only and
  has `local === imported`.
- `runtime-surface.test.ts`: 119/119/37, `names.get("ScriptRecord")` has
  `typeArguments` `[]`, and the recomputed corpus digests.
- `script-runtime-surface.test.ts`: 19 types and 19 table types;
  `canonical.value.types` contains `ScriptRecord`; `contracts.value.records`
  has 179 entries.
- `test262-native.test.ts`: the generated `test262-runtime` module's import
  bindings include `createScriptRecord` (same walk as its disposal test).

Green: apply §4.1-§4.5. In the same change, update the native fixture source in
`verify-hosted-script-lowering.ts` (status 37), `verify-hosted-script.ts`,
`verify-hosted-test262-harness.ts` and `build-native-agent-policy-fixture.ts`.

### Slice C (native): new focused fixture `tools/verify-hosted-script-records.ts`

Model this on `verify-hosted-script.ts`: the same `make()`/intrinsic install
set, the same lowered-module dependencies, and `verifyHostedFixture`. Lower
these sloppy Scripts with `lowerScript`:

| #   | Source                                                                                                                                                                               | Realm                       | Expect                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ------------------------------------------- |
| S0  | `var f0=function(){return nativeActive();};var g0=function*(){yield nativeActive();};var it0=g0();var job=0;Promise.resolve().then(function(){job=nativeActive();});nativeActive();` | A                           | value 1                                     |
| S1  | `nativeActive()*100+f0()*10+it0.next().value;`                                                                                                                                       | A                           | 211                                         |
| S2  | `job*100+f0()*10+nativeActive();` (after drain and churn)                                                                                                                            | A                           | 113                                         |
| S3  | `nativeActive();`                                                                                                                                                                    | B (child realm, same agent) | 4                                           |
| S4  | `nativeActive();throw 42;`                                                                                                                                                           | A                           | `throw`, 42                                 |
| S5  | `let f0;nativeActive();`                                                                                                                                                             | A                           | `throw` SyntaxError (GDI), probe not called |

Host:

1. Create `r[i] = createScriptRecord(realm_i, undefined)` per Script, fresh
   for each evaluation; check every `r[i] !== r[j]`.
2. `nativeActive` returns `1 + indexOf(active.scriptOrModule)` in `r` (0 with
   no context), and throws `"FIXTURE_SCRIPT_REALM"` if `active.realm` is not
   that record's `realm`.
3. After each entry, require `agent.activeContext === undefined`.
4. Between S1 and S2, `drainScriptJobs(agent, e => { throw e; })` (the job
   reports 1: it was enqueued under S0), then allocate and drop 32 MiB of
   `Uint32Array`s. `r[0]`, reachable only through `f0`'s context, must survive
   moves and stay `===`.
5. Child realm B: `createErrorRealm(proto, hooks, A.symbolRegistry, A.agent)`
   with its own global.

Statuses: 1-6 wrong result per Script, 7 context leak, 8 records not distinct,
9 S5 reached the probe, 42 success. Leave dynamic `Function` out: it needs the
Test262 host's code storage, and Slice A item 5 covers it in Node.

## 7. Native recipes (serial lane, manifests)

Queue these after main's runtime-link fixture and the running frozen
self-build. Inspect the live inferior and the pause marker first, and never
copy an old PID.

1. Build: run `TINT_BUILD_ONLY=1 node tools/verify-hosted-script-records.ts`
   with output to `.tint-bootstrap/script-records-native-build-v1.log`. The last
   line is the binary, and `<binary>.manifest.json` holds the source snapshot.
2. Record: write a runner modeled on
   `.tint-bootstrap/run-managed-closure-uses-validation-v1.mjs`:
   - wait for the log and manifest;
   - take the cooperative pause (`wx`, then wait for an `.ack` in
     `between-variants`, matching the live PID);
   - `recordNativeFixture` → `docs/results/native-script-records-v1.json`,
     `timeoutMs: 120000`, related report
     `native-script-runtime-directory-v3-direct-v2.json`;
   - release the pause in `finally`.

   Assert stop-at-entry and exit 42. Keep failures, and do not retry.

3. Rebuild and record the changed fixtures the same way, one report each
   (`native-<name>-records-v1`): `verify-hosted-script-lowering`,
   `verify-hosted-script`, `verify-hosted-test262-harness`,
   `build-native-agent-policy-fixture`, plus the unchanged
   `verify-hosted-script-jobs` as a job-runtime regression check.
4. Focused unchanged Test262 rerun, with the snapshot captured at launch:

   ```sh
   TINT_TEST262_CAPTURE_SOURCES=.tint-bootstrap/script-records-test262-source-v1.json \
     node tools/test262-native-run.ts .tint-bootstrap/test262 language/global-code 8
   ```

   Then run the same command for `built-ins/Promise/prototype/then`,
   `built-ins/Function` and `language/statements/generators`.
   - Store each run as a new immutable report.
   - Compare per file against the same files in the latest full-suite native
     report, and treat any pass → fail change as blocking.
   - Do not update dashboard totals: these are focused rechecks.

5. Frozen self-build with stage comparison, because lowering and the runtime
   are compiler sources. Use the current self-build runner pattern
   (`run-runtime-directory-v3-selfbuild-*.mjs`) against a new frozen snapshot,
   and require byte-identical stages. Code emission changes only for lowered
   Scripts, and the compiler's own sources are TypeScript modules, so stage
   images should match. If they do not, that is a finding.
6. Re-publish directory v3 Script mode
   (`verify-hosted-managed-surface-directory.ts`) only after D6d2/D6e settle. It
   should show 179 records and 355 slots. Use a new report name, and never
   overwrite `native-script-runtime-directory-v3-direct-v2.json`.

## 8. Compatibility fallout

- **Hosts.** Four tool files change (§3). Embedders outside the workspace do
  not exist yet.
- **Digests.** All eight `runtime-surface.test.ts` corpus hashes change. The
  directory digest changes when v3 republishes, and any digest pinned in
  pending D6d/D6e fixtures must be re-derived on the landing commit.
- **Alias renumbering.** Probe q3 serialized the canonical declarations with
  and without `ScriptRecord`. Either position renumbers almost every `$T`
  alias (for example, baseline `$T472`, a `{name, constant}` record, becomes an
  unrelated record); the table stays `$T0` and the entry list is identical. Unit tests use only synthetic `$T` names, but any
  fixture or plan that pins real names (the runtime-link handoff cites
  `$T472`/`$T475`) must resolve them by lookup, or record before this lands.
- **Managed runtime link (main, in progress).** Providers, slots and signature
  classes are unchanged (41/355/159), but keys name aliases (above) and the
  digest changes. Never land this between that fixture's build and its run.
- **Test262.** No pass-rate change is expected, because the identity is
  observable only through `import()` and `[[HostDefined]]`. The adapter bump
  (§4.5) keeps observation identity honest.
- **Self-hosting.** No new language feature is needed for the compiler. The
  record is an ordinary object literal with a string-literal field.

## 9. Recommended defaults (main may take them without asking)

1. **D1:** derive the realm in the entry
   (`const $errors: ErrorRealm = $script.realm`) and keep the 52 references.
   Rewriting them to `$script.realm` only adds load chains.
2. **D2:** keep `scriptOrModule: unknown` until HOST-ESM.
3. **D4:** record fields `{kind, realm, hostDefined}`. Keep `kind`, because
   the HOST-ESM union needs a discriminant and it costs nothing in the census
   (q1).
4. **D6:** `hostDefined: undefined` in every Test262 and fixture host.
5. **Vocabulary position:** after `ScriptCompletionRecord`.
6. **`createScriptRecord` stays out of the vocabulary** (host-only).
7. **Adapter label** `native-script-v5-script-records`; fixture
   `verify-hosted-script-records.ts`, report `native-script-records-v1`.

## 10. Risks

1. **Native GC through contexts.** The record is reachable only from
   `activeContext`, closure contexts and jobs; Slice C's churn step is the first
   native evidence. Record a fault there as a root defect; do not mask it.
2. **Concurrent source edits.** The probe identities drifted during capture.
   Re-run `/tmp/tint-script-identity-plan/q1-census.mts baseline` and `overlay`
   on the landing commit before you pin 19/179.
3. **Template sites.** Lowered Scripts with tagged templates emit module-level
   `const`s, and `adaptManagedSurfaceEntry` rejects them ("module
   initialization"). That is unrelated to identity, but it limits which Scripts
   S2-id3 can accept (frame plan D5).

## 11. Next planning recommendation

**S2-e1, one lowered Script through the managed entry.** This is the smallest
useful general-Script integration slice. Scope:

1. Lower a template-free Script and normalize it.
2. Adapt it with `$imports: unknown` plus a checked `view` (S2-id4, frame plan
   §6.3), and require the `managedDirectCallDeclarations` proof (S2-id3) as a
   gate.
3. Link it through main's runtime-link handoff, publish it, and invoke it once
   from an AOT hosted fixture that creates `ScriptEntryFrame{$imports:
bound.table, $argument0: global, $argument1: createScriptRecord(…)}`.

Acceptance: correct completion value and GDI `throw` completion, the context
restored, and a foreign-record frame rejected with `MANAGED_SURFACE_TABLE`
before any import is read.

Wiring `$262.evalScript` comes after S2-e1. All 31 pinned files that call it
(18 `annexB/language`, 13 `language/global-code`; none use `import(`) need
successful execution and GDI, not just parsing. So the evalScript service has
no pass-rate value until S2-e1 works.

That pass is [S2-e1, the first managed Script](rt-eval-first-managed-script.md).
