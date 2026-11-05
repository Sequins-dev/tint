# RT-EVAL S2-e1: first lowered Script through a managed entry

Status: **managed entry assembly implemented; native Script execution pending.**
The host-frame adapter passes [native view execution](../results/native-managed-host-frame-v1.json)
and [native adaptation](../results/native-managed-host-frame-compiler-v1.json).
Exact provider matching [passes natively](../results/native-runtime-link-exact-keys-v1.json),
as do [ScriptRecord lowering](../results/native-script-record-lowering-v1.json)
and the [Script host](../results/native-script-record-host-v1.json).
The internal preparation and lower/prune pipeline passes real-Script integration,
[native preparation](../results/native-managed-jit-program-v1.json) and
[native IR lowering](../results/native-managed-jit-lowering-v1.json).
Exact frame/callee contract agreement [passes natively](../results/native-managed-jit-frame-v1.json).
Record class binding passes the real-Script integration and
[native ambiguity/layout fixture](../results/native-managed-jit-records-v1.json).
The fixture-owned AOT `ScriptEntryFrame` also passes
[full Script-directory publication and reading](../results/native-script-frame-directory-v1.json)
(`verify-hosted-managed-surface-directory.ts --script-frame`). This validates its
three readonly fields without claiming execution of a managed Script.
Callback agreement [passes natively](../results/native-managed-jit-signatures-v2.json).
`prepareManagedSurfaceEntry` emits and selects all contracts for three real lowered
Scripts in Node tests. [Native typed-entry assembly passes](../results/native-managed-jit-entry-v1.json); native Script
compilation, publication and execution remain E4.
Counts and line references in the captured probes describe their original snapshot.

Parent: [Script identity migration](rt-eval-script-identity-migration.md)
§11, which names this slice. It reuses the [managed JIT entry plan](rt-eval-managed-jit-entry.md)
(D6f2, D6f4–D6f6), the [Script frame plan](rt-eval-script-frame.md) (§6.3–§6.5) and the
[runtime link handoff](rt-eval-runtime-link-handoff.md). Scope: compile **one** template-free
lowered Script once at run time, then call it several times from an AOT host. Each call gets a
fresh host-created `ScriptRecord` and a real `GlobalEnvironment`, and runs real global declaration
instantiation (GDI), completion and context semantics. Out of scope: `$262.evalScript`, a code
cache, tagged templates, general `Function`, eval code, ESM and agents.

Captured 2026-11-04 (about 20:20) against live source `9cfb67ae…` (541 files). `dist` is newer
than `src` for `js-runtime`, `js-engine`, `compiler`, `ts-native`, `typescript` and `codegen`
(`r0`). **Since the migration plan was written, main landed Slice A**: `ScriptRecord` and
`createScriptRecord` are in `js-runtime/src/objects/jobs.ts:13-25` and exported from
`objects/index.ts:14-15`. Slice B (the `lowerScript` entry) has **not** landed: `index.ts:4263`
still writes `scriptOrModule: execute`. The probes are read-only Node scripts in
`/tmp/tint-first-managed-script-plan` (`common.mts`, `r0`–`r8`, results in `*.txt`). They import
public `dist` by absolute path and `tools/workspace-sources.ts`. They add `ScriptRecord` to the
vocabulary **in memory**, apply the planned S2-id2 entry edit **to the AST in memory**, write
nothing in the workspace, emit no image and run no native code. **Every result below is
Node-only. None of it is evidence of native compilation, linking, GC, calls or conformance.**
Spec: current ECMA-262 draft ("ECMAScript 2027", tc39.es multipage, fetched for this plan).

## 1. Answer in brief

1. **The whole chain already emits in Node, with no new host operation and no second pipeline.**
   For `var v=40;let y=2;function f(a){return a+v;}nativeCount();f(y);` the chain is: the
   migrated entry, then `normalizeManagedSurfaceApplications`, then the adapter in planned frame
   mode, then a link with the nine collection runtimes, then lowering rooted at the wrapper and
   the view. After prune → optimize → prune it has **12 imports and 29 bodies**, `verify` passes
   and the root ABI is **`(reference)->general`**. A D6f6-style ABI request then emits
   **103,872 bytes with 53 managed imports**: 1 brand, 25 signatures (3 of them member-only),
   15 records and 12 function entries (`r7-fixture.txt`). The 0.46 s link-to-lower cost is
   Node-only.
2. **Minimal frame surface.** It is
   `ScriptEntryFrame{readonly $imports:unknown; readonly $argument0:GlobalEnvironment<ScriptPropertyKey,unknown>; readonly $argument1:ScriptRecord}`,
   added to the fixture's **surface request** (`types` plus `frame`). It is not added to the
   lowering vocabulary. `createManagedSurfaceDirectory(…, "ScriptEntryFrame")` validates it.
   Its fields restore as `$T122` (unknown), `$T118` (the `GlobalEnvironment` export alias) and
   `$T120` (the `ScriptRecord` alias). The census becomes types 20 and records 180, while
   providers, slots and signature classes stay at 41/355/159 (`r6`). That confirms the frame
   plan's S2-id5 prediction (18→20, 178→180) on live source.
3. **Checked record view of `$imports: unknown`.** It is one top-level function
   `$tint$managed$view(value:unknown): <table alias>|undefined`, bound as
   `RecordBinding{operation:"view"}`. The wrapper starts with
   `const $tint$managed$table=$tint$managed$view($frame.$imports); if($tint$managed$table===undefined) throw "MANAGED_SURFACE_TABLE";`.
   Every import constant then reads from that local (95 constants rewired). Lowering yields
   exactly one `general-record-is` against the **imported** `$T0` descriptor
   (`viewRecordBound: true`). **Constraint found:** lowering includes only roots, imports and
   their nested children. It does not follow calls to other top-level functions. So the view
   must be a second lowering root, otherwise lowering fails with
   `named function values require managed hoisted initialization` (`r2`).
4. **The wrapper must return `unknown`.** `callExecutableManaged`'s contract is
   `(reference)->general` (`memory.ts:38-46`), and codegen does not check a closed root's ABI
   (`codegen/.../index.ts:913-916`). The current adapter copies `execute`'s return type, which
   gives `(reference)->reference`. A JIT-allocated completion record would then be read as a
   general payload and tag. Frame mode returns `unknown`, and `prepareManagedSurfaceEntry` must
   reject any other root ABI. The AOT host recovers the record with its own `view` binding of
   `ScriptCompletionRecord`.
5. **The direct-call proof is the only allowance; callbacks need exact membership.** On the
   migrated entry, `managedDirectCallDeclarations` returns exactly `execute` for 5 of 5
   template-free Scripts (`r1`). After lowering there are 4 `function-new` targets. One is
   `execute` `(reference,reference)->reference` (non-member, proven direct). The other three
   are arrows, each a member of exactly one class: `$T160`, `$T166` and `$T362`. **All three
   are member-only**, because the JIT has no `call-indirect` witness for them, so they need B8
   `localFunctions` bindings. One witness type has no surface class: `execute`'s own type, used
   by the adapter-internal `call-indirect`. It is admitted only because its sole target is in
   the proof set.
6. **Real blocker: no current key source can key a real Script.**
   `managedRuntimeKeyForSurfaceType` (D6d4) resolves surface type exports, but **0 of 19
   exports** name a runtime collection (`r3`). The 7 list bindings behind the final imports
   (`unknown`, `string`, and five anonymous records) all have exact S(e) providers. One pair
   (`$T474`/`$T477`) has two candidates, and directory order resolves it. A minimal D6f4
   function is therefore a prerequisite (§5.4), not an option.
7. **Records need one explicit rule.** Of the final records, 15 bind to exactly one directory
   class, including the frame and `$T0`, with **0 layout skews**. 29 have no checked type
   (closure environments). 2 match several classes (`{error:<literal union>,value}`, six classes
   and two classes). Those two are **never allocated or tested in JIT** (`r4`), so they may stay
   private once layout equality is checked. Any allocation or descriptor test of a
   multi-class record must be rejected (§5.5).
8. **Compile once, call many.** The image compiles and publishes once. It then calls
   `invoke(address, frame)` four times, with fresh records and two globals. That covers a normal
   completion, a GDI `SyntaxError` throw completion on re-evaluation (16.1.7), a foreign
   `$imports` rejected before any import read, and a second global after 32 MiB of churn (§7).

## 2. Specification points (ECMA-262 draft, re-read)

| Clause                                | Rule this slice must keep                                                                                                                                                                                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16.1.4/16.1.5                         | One new Script Record per ParseScript (`[[Realm]]`, `[[HostDefined]]`); never per compiled code                                                                                                                                                                                     |
| 16.1.6 ScriptEvaluation               | `globalEnv` = `scriptRecord.[[Realm]].[[GlobalEnv]]`. Push a context (Function null, Realm and ScriptOrModule from the record), run GDI, then the body only if GDI completed normally; an empty value becomes `undefined`; remove the context for every completion, then `? result` |
| 16.1.7 GlobalDeclarationInstantiation | For each lexical name: `HasLexicalDeclaration` gives SyntaxError, then `HasRestrictedGlobalProperty` gives SyntaxError. For each var name: `HasLexicalDeclaration` gives SyntaxError. This runs before any statement                                                                |
| 9.4.1, 10.2.3                         | Functions capture `GetActiveScriptOrModule()`, the record, at creation                                                                                                                                                                                                              |

Tint has no `[[GlobalEnv]]` field on `ErrorRealm`. The host owns the pairing invariant: the
frame's `$argument0` is the global environment created with `$argument1.realm`. The fixture
asserts this pairing. It is not a new runtime field.

## 3. Present versus planned

| Piece                                                                                                                                                         | State                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ScriptRecord`, `createScriptRecord` (S2-id1)                                                                                                                 | **Landed** in source and `dist`                                                             |
| `lowerScript` entry `execute($global,$script)` (S2-id2 Slice B)                                                                                               | **Planned; assumed landed here.** Probes simulate it on the AST                             |
| `normalizeManagedSurfaceApplications` (D6f1), `managedDirectCallDeclarations`, multi-specifier adapter                                                        | Present, with native fixtures                                                               |
| `adaptManagedSurfaceEntry` frame mode (`$imports:unknown`, view, `unknown` result)                                                                            | **Planned (§5.2)**; the current one emits `$imports: <table>` and copies the return type    |
| `runtimeFunctionIds` / `visitRuntimeFunctions` (with `id,kind,bindingIndex,operation`)                                                                        | Present (`ts-native/src/runtime/function-ids.ts`)                                           |
| `selectManagedRuntimeSlot`, `describeManagedRuntimeUses`, `finalFunctionSources`, `bindManagedRuntimeImports`, `managedRuntimeKeyForSurfaceType(contracts,…)` | Present, **internal** (`managed-runtime-selection.ts`, not exported from `native/index.ts`) |
| `linkManagedSurfaceModule(read,native,readWord,domain)`                                                                                                       | Present (`managed-directory-reader.ts:405`)                                                 |
| `planManagedSignatureGroups`, `lowerManagedSignatureGroups`, B8 `localFunctions` in codegen                                                                   | Present; member-only callbacks [pass natively](../results/native-member-signature-v2.json)  |
| Exact S(e) keys (D6f4)                                                                                                                                        | **Planned (§5.4)**: a blocker                                                               |
| `prepareManagedSurfaceEntry` (D6f6 assembly)                                                                                                                  | **Planned (§5.6)**; no implementation exists                                                |
| Directory `frame` (`ManagedSurfaceRequest.frame`, `createManagedSurfaceDirectory(…,frame)`)                                                                   | Present; no surface sets it yet                                                             |
| Record-typed `executable-call-managed` profile (`invoke(address,frame:Frame)`)                                                                                | Present as a fixture-owned declaration in `verify-native-managed-frame.ts:321,479-482`      |
| `EngineCodeStorage.publish`                                                                                                                                   | Present (`js-engine/src/native/code-storage.ts`)                                            |
| Native runtime-link fixture (D6d4 §8)                                                                                                                         | **Main's next validation**: allocation and GC across imported entries are unproven          |

## 4. Probe results (Node only)

| Probe | Question                                                                    | Result                                                                                                                                               |
| ----- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| r0    | Identity, `dist` freshness                                                  | `9cfb67ae…`, 541 files; six packages' `dist` newer than `src`                                                                                        |
| r1    | Migrate, normalize, adapt and rewrite the frame for 5 template-free Scripts | All check. Erasures 18/7/4/4/10. Proof = `execute` for all. 95 import constants rewired. `var x=1;let x=2;` is a static early error in `lowerScript` |
| r2    | Lowering, view as entry only versus also as root                            | Entry only: `named function values require…`. Also a root: verify ok; 40 functions (11 imports); one `general-record-is`                             |
| r2    | Wrapper returning `unknown`                                                 | Root `(reference)->general`, otherwise `(reference)->reference`                                                                                      |
| r3    | Key source for the final imports                                            | 0 of 19 exports give a key. 7 list bindings, each with ≥1 exact provider: `0:$T121`, `8:$T132`, `13`, `14/17`, `15`, `16`                            |
| r4    | Records and witnesses (with the frame present)                              | 15 single-class, 29 untyped (environments), 2 multi-class (not allocated); frame and `$T0` bound; 23 witness types, 1 classless (`execute`)          |
| r6    | Directory with `ScriptEntryFrame`                                           | `frame` validates; types 20, records 180, signatures 159, providers 41, slots 355, anchors 78, collections 39                                        |
| r7    | ABI assembly and `emitModule` (fixture Script)                              | ok, 103,872 B; imports brand 1, signature 25 (3 member-only), record 15, function-entry 12; layout skew 0                                            |
| r8    | Tagged versus untagged template                                             | Tagged: `managed entry does not support module initialization`. Untagged: accepted                                                                   |

## 5. Design

### 5.1 Frame surface (S2-e1: fixture-owned)

The fixture's helper module declares the frame, the managed call profile and the result view:

```ts
import type { GlobalEnvironment } from "@tint/js-runtime/environments/global";
import type { ScriptPropertyKey, ScriptRecord, ScriptCompletionRecord, ManagedSurfaceExport } from …;
export interface ScriptEntryFrame {
  readonly $imports: unknown; // bind().table, checked once per entry by the JIT view
  readonly $argument0: GlobalEnvironment<ScriptPropertyKey, unknown>;
  readonly $argument1: ScriptRecord;
}
export function invoke(address: number, frame: ScriptEntryFrame): unknown { throw "UNBOUND_SCRIPT_CALL"; }
export function completion(value: unknown): ScriptCompletionRecord | undefined { throw "UNBOUND_COMPLETION_VIEW"; }
export function bindScript(): ManagedSurfaceExport { throw "MANAGED_SURFACE_UNBOUND"; }
```

Host bindings: `invoke` → `executable-call-managed`, the same operation as
`callExecutableManaged`. `completion` uses record operation `view`, and `bindScript` is the
surface bind. Surface request: `{name:"scriptRuntime", values, types:[…vocabulary, {module:helpers,name:"ScriptEntryFrame"}], frame:"ScriptEntryFrame", bind}`.
This adds no host operation, no `memory.ts` declaration and no vocabulary entry. Promote the
frame into `js-engine` (`native/`) only when the evalScript service needs it (S2 proper). The
promotion is a file move, not a contract change.

### 5.2 Adapter frame mode (`managed-entry.ts`)

Add an optional fifth parameter `options?: {readonly frame: string}`. Without it, the current
behaviour stays byte for byte, so `verify-hosted-managed-surface-entry.ts` is unaffected. With
it:

1. `frame` must name a `surface.types` export whose alias is an object type with exactly
   `$imports` plus `$argument0…$argument{n-1}`, all readonly and in that order. Otherwise fail
   with `profile: entry parameter differs from surface frame`. A `$imports` that is not
   `unknown` fails with `profile: surface frame imports must be unknown`.
2. The wrapper parameter has type `named(<frame alias>)`. There is no private frame alias.
3. Emit a top-level, unexported `$tint$managed$view(value:unknown):<surface.table>|undefined`
   with a throwing placeholder body, then the two guard statements before the import constants.
   Import constants read from `$tint$managed$table`.
4. Set the wrapper `returnType` to `unknown`.
5. Mark the copied surface alias declarations `exported: true`, so `linked.exports` gives exact
   alias → linked name. That provides alias type IDs without name-suffix matching (D6f §4.2
   step 2).
6. Return `{module, entry, frame, view}`. Use the same `$`-suffix collision loop for `view` and
   the table local as for the existing names.

Field-type exactness is not syntactic. §5.6 step 5 compares each `$argument<i>` field with the
`execute` parameter it feeds, using `createManagedTypeContractIndex.matches`. Mismatch fails
with the same profile error.

### 5.3 Proof gate and callback membership

On the prepared (post-`prepareCollectionRuntimes`) checked graph:

- `direct = managedDirectCallDeclarations(checked, wrapperId)`. A non-`ok` result fails closed.
- `groups = planManagedSignatureGroups(checked, requests)`. There is one request per directory
  signature class whose alias resolves in the JIT graph, with `functions` = wrapper descendants
  whose checked type exactly `matches`. Then use
  `lowerManagedSignatureGroups(groups, entries, signatureTypes, [first, second])`.
- **Escape rule:** each final `function-new` target must be in exactly one lowered group (a),
  or map through `finalFunctionSources` to an ID in `direct` (b). Otherwise fail with
  `profile: JIT closure without an exact surface callback class`. A group with members but no
  surviving witness becomes a **member-only** binding (`localFunctions`, no `witness`). A witness
  type with no class is allowed only if every final `function-new` target of that type is in
  (b). It then stays JIT-private.

This gate replaces nothing in codegen. It exists so that an ABI-equal non-member can never
reach an AOT `call-indirect`, which is a `brk #3` trap (D6f §1.6).

### 5.4 Exact runtime keys (minimal D6f4, `managed-runtime-selection.ts`)

```ts
export function managedRuntimeKeysForOptions(
  directory: SerializedManagedSurfaceDirectory,
  checked: CheckedClosures, // prepared JIT graph; options' type IDs refer to it
  aliasTypes: ReadonlyMap<string, number>, // exported surface alias → JIT type ID (§5.2 item 5)
  options: ModuleEntryOptions,
): Result<ManagedRuntimeKeys>;
```

For each list, set or map binding: get the element type, or the key and value types for a
map. A keyword element (`"string"`, `"number"`) uses the JIT graph's keyword type. Take the
first provider of the same kind, in directory order, whose `element` (and `value`) aliases
exactly `matches` it. If there is none, the key is `undefined`. Then
`bindManagedRuntimeImports` rejects any surviving import of that binding with
`runtime import has no surface use`. The function never uses ABI words, addresses or name
suffixes. Primitive and number-text uses keep their constant keys in
`describeManagedRuntimeUses`. The D6d4 caller-asserted path stays for tests.

### 5.5 Records and signatures (assembly rules)

- **Records.** Map each final record through `recordTypes` and both `recordIds` maps to its
  checked types. Use `matches` against every directory record class's aliases.
  - Exactly one class: bind `{witness, name:"$record"+id, contract: record/<k>}`, and require
    `sameManagedRecordLayout(final, directory)`, otherwise `profile: record layout skew <alias>`.
  - Several classes: stay private only if every class has an equal layout and the final module
    contains no `record-new`, `general-record-is` or descriptor operation on it. Otherwise fail
    with `profile: record serves several surface classes`.
  - No class: stay private. The frame and the table alias must bind, otherwise
    `profile: surface frame record is not bound`.
- **Signatures.** For witness types with a class, bind
  `{witness, contract: fn/<k>, parameters, returnType}` from `directory.signatures[k]`. Merge in
  group `localFunctions`. Add the brand `{name:"tint.function.v1", contract:"tint.function.v1"}`.
- **Functions.** `bindManagedRuntimeImports` with §5.4 keys.

### 5.6 `prepareManagedSurfaceEntry` (D6f6, Script-first)

Use the D6f §4 request unchanged:
`{module, entry, specifiers, instantiations, read, runtime}`. Steps, each stopping at its
first error:

1. `normalizeManagedSurfaceApplications`.
2. Adapt in frame mode with `read.directory.frame`. An undefined frame fails with
   `profile: surface has no entry frame`.
3. Link with `runtime.modules`/`runtimes`, then bind → `prepareNativeGlobals` → `specializeModule`
   → `checkClosureModule` → `prepareCollectionRuntimes`, as `deriveManagedSurfacePhysicalFacts`
   does.
4. Resolve `wrapperId`, `viewId` and `aliasTypes` from `linked.exports` of the JIT module.
5. Run the frame-field exactness check (§5.2), the proof (§5.3) and the groups.
6. `lowerModuleEntries(checked, [wrapperId, viewId], target, max, {...options, importedFunctions: runtimeFunctionIds(options), recordTypes:true, signatureTypes:true, recordBindings:[{function:viewId, operation:"view"}]})`.
7. Prune from the wrapper → optimize → prune, then `verify`. Root ABI must be
   `(reference)->general`, otherwise `profile: managed entry ABI differs`. Every non-import body
   must come from the wrapper subtree or the view, otherwise
   `profile: runtime body entered the JIT module`.
8. Escape rule, keys, records and signatures (§5.3–§5.5), then
   `emitModule(module, {closedRoots:[root], managedABI})`.
9. Return `{native, entryOffset}`. The caller runs `linkManagedSurfaceModule(read, native,
readWord, currentDomain)` and `storage.publish(code)`. Nothing is published on any failure.

This is one composition of existing functions. It adds no checker, lowering, IR, codegen,
interpreter or bytecode path.

### 5.7 Host sequence (compile once, call many)

```text
bound = bindScript(); read = readManagedSurfaceDirectory(bound, "scriptRuntime", host)
lowered = lowerScript(parseScript(text))             // ParseScript errors stop here: no record
prepared = prepareManagedSurfaceEntry({...})          // once
linked = linkManagedSurfaceModule(read, prepared.native, readMemoryWord, currentContextDomain())
address = storage.publish(linked.code) + prepared.entryOffset   // once
per evaluation: realm, global (paired); record = createScriptRecord(realm, undefined)
  frame: ScriptEntryFrame = {$imports: bound.table, $argument0: global, $argument1: record}
  done = completion(invoke(address, frame)); require agent.activeContext === undefined
```

The frame is an AOT local, so it is rooted across the call. The JIT `execute` runs
`runScriptContext` through the table. That call pushes and pops the context, runs GDI and the
body, and turns throws into `{error:"throw"}`. The host maps them as `invoke` does today in
`verify-hosted-script.ts:4875-4909`.

## 6. Staged edits and tests (red-first)

Each stage: red tests → implementation → `pnpm build` → focused tests → `pnpm check`. Land
them after S2-id2 Slice B and after main's D6d4 native fixture.

**E1, adapter frame mode** (`compiler/test/managed-entry.test.ts`):

- The real lowered fixture Script with a frame-carrying surface gives `$imports:unknown`, one
  top-level view, the guard as the wrapper's first two statements, 95 rewired constants, an
  `unknown` return and exported aliases.
- The existing call without `options` gives deep-equal output to today's.
- Negatives: frame missing from `types`; extra or missing or reordered field; `$imports` typed
  as the table; a non-object frame.

**E2, keys** (`managed-runtime-selection.test.ts`):

- Real Script options key to providers `0, 8, 13, 14, 15, 16` (r3). `$T474`/`$T477` choose 14.
- `string | undefined` against `$T132` gives `undefined`.
- A JIT-private element gives `undefined`, then `no surface use` at bind.
- The result equals the D6d4 key for `Names` on the link-test surface.

**E3, assembly** (new `managed-jit-entry.test.ts`, one slow real-surface test). Callback identity
and final assembly are refined in [E3b](rt-eval-jit-identity-assembly.md):

- Fixture Script: 12 function, 15 record and 25 signature bindings (3 member-only),
  `emitModule` ok, 53 managed imports by role, root ABI `(reference)->general`.
- Spy-host read plus `linkManagedSurfaceModule` patches every import with input code unchanged.
- Negatives, each before emission:
  - a frame-less directory;
  - a typed-`$imports` frame;
  - an unmigrated entry (`scriptOrModule: execute`), which gives the escape error;
  - a hand-added arrow returned as `unknown`, which has no class;
  - a forced multi-class allocation;
  - a tampered record layout, which gives skew;
  - a tagged template, which gives module initialization;
  - a typed entry returning `number` while the root check is bypassed. This last one asserts the
    ABI error.

**E4, native fixture** `tools/verify-hosted-managed-script.ts` (§7). The implementation-ready recipe is
[native Script execution](rt-eval-native-script-execution.md).

**E5, regressions.** Rebuild and record the unchanged `verify-hosted-managed-surface-entry`,
`verify-hosted-managed-closure-uses` and `verify-native-managed-frame` (member-callback) as
regression checks. Then run a frozen self-build with byte-identical stages, because compiler
sources change.

## 7. Native fixture recipe (planned; not run)

`tools/verify-hosted-managed-script.ts`. Model it on the D6d4 §8 fixture (JIT compile in the
image), on `verify-hosted-managed-surface-directory.ts` (Script surface request) and on
`verify-hosted-script.ts` `make()`/`invoke` (realm, intrinsics). **Strict native checker:**
declare every contextual callback parameter, even unused ones (`(receiver,args)`,
`(callee,receiver,args)`, `(error)`). Avoid `typeof` narrowing on `array|string` unions unless
the image includes main's recent checker fix. Compare `dist` and `src` timestamps first. Do not
rebuild to fix drift.

- **Embedded on the Node side** (`JSON.stringify`): the Script text, plus the source text of the
  nine `collectionRuntimes` modules (number-list, linked-map, sparse-list, linked-set,
  primitive values, number-text, indexed-sort, list-sort, text-encoding) as `runtime.modules`.
- **Image modules:** the Script dependency set, `syntax` (`parseScript`), `js-engine` lowering,
  `binding`, `linking`/ts-native modules, `checker`, ts-native `runtime` and closure lowering,
  `ir` optimization, the emitter, `compiler` native (including the internal selection module),
  `code-storage`, `memory` and the helpers module (§5.1).
- **Options:** `allowJit:true`, the copying runtime, 64 MiB managed, 1 Mi allocation capacity
  and a 16 MiB stack. Host bindings: `native-value-function-descriptor`/`-signature`,
  `context-domain`, `memory-read-word`, `executable-map`, `executable-write`,
  `external-memory-register`, plus `invoke` → `executable-call-managed`.

`run()` statuses (final 42):

1. `bindScript()` → read. `read.directory.frame === "ScriptEntryFrame"`, and runtimes count
   equals entries/2.
2. Parse and lower the Script, then `prepareManagedSurfaceEntry`. Assert 12/15/25 bindings.
3. **Rejects before publish:** the same request with a frame-less directory copy; a
   re-digested tampered record layout; `linkManagedSurfaceModule` with `domain+1` (0 reads).
4. Link and publish **once**. Record the `publish` call count = 1.
5. **Normal completion:** realm A, global A (with `nativeCount` and `nativeActive`), record
   `r1`. `nativeActive` checks `active.scriptOrModule===r1`, `active.realm===r1.realm` and
   `global===A` pairing. Result `{error:"none", value:42}`, count 1, no active context afterwards.
6. **GDI throw:** the same address, global A and a fresh `r2!==r1`. The completion is `throw`
   with a SyntaxError from realm A (`let y` exists, 16.1.7). Count is still 1, so no statement
   ran. No active context afterwards.
7. **Foreign table:** a frame with `$imports: r2`. `invoke` throws `"MANAGED_SURFACE_TABLE"`.
   Count unchanged, no context was pushed, and no runtime import was reached.
8. **Reuse after churn:** allocate and drop 32 MiB of `Uint32Array`s. Then use realm and
   global B with a fresh `r3`, expect `{none, 42}` and count 1 on B. Check `r1` is still `===`
   to the record held by `f`'s context on A: call A's `f` through
   `getProperty(A,"f")` and `callObjectValue`, and `nativeActive` inside it must see `r1`.
9. Final: `publish` count is still 1.

Distinct statuses: 1–9 per step; 10 completion view `undefined`; 11 context leak; 12 records not
distinct; 13 count drift. **Build and record on main's serial queue** only after the D6d4
runtime-link fixture passes. Leave the isolated `inferior3744`
`source-directory-allocation-diagnostic-v2` run, its pause markers and the queues untouched.

1. `TINT_BUILD_ONLY=1 node tools/verify-hosted-managed-script.ts`, with output to
   `.tint-bootstrap/managed-script-native-build-v1.log`. The last line is the binary, and
   `<binary>.manifest.json` holds the snapshot.
2. Write a runner modeled on `run-managed-closure-uses-validation-v1.mjs`. Take the live pause
   name and PID at run time (`wx`, then the `.ack` in `between-variants`). Call
   `recordNativeFixture` with report `docs/results/native-managed-script-v1.json`,
   `timeoutMs:180000`, and related reports `native-runtime-link-handoff-v1.json`,
   `native-member-signature-v2.json` and `native-managed-closure-uses-v1.json`. Release the
   pause in `finally`.
3. Assert stop-at-entry and exit 42. Separate launch failures from faults after start. Keep
   failures, and do not retry.
4. **Diagnostic split** (only if status 2 faults or exceeds the timeout): run the same fixture
   with `--precompiled`. Node runs §5.6 on the same snapshot and embeds the unresolved
   `NativeModule` (code bytes, `managedImports`, entry offset). The image then performs only
   steps 1 and 3–9. Because the directory digest is deterministic, selection fails closed on
   drift. This isolates native compile cost and allocation from link, GC and call evidence. It
   is the same pipeline, not a second one.

## 8. Observable failure cases

| Case                                                             | Stage   | Result                                                                                 |
| ---------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------- |
| Tagged template (module-level `const`)                           | adapt   | `managed entry does not support module initialization`                                 |
| No directory frame; field set or order differs; typed `$imports` | adapt   | `surface has no entry frame` / `entry parameter differs…` / `…imports must be unknown` |
| Parameter not exactly the frame field type                       | profile | `entry parameter differs from surface frame`                                           |
| Value use of `execute` (unmigrated) or a classless arrow         | profile | `JIT closure without an exact surface callback class`                                  |
| Root not `(reference)->general`                                  | profile | `managed entry ABI differs`                                                            |
| Element with no exact provider                                   | bind    | `runtime import has no surface use: <fn>`                                              |
| Multi-class record allocated or tested; layout skew              | profile | `record serves several surface classes` / `record layout skew`                         |
| Domain, contract, role or window mismatch                        | link    | existing D6d4/reader errors; nothing patched or published                              |
| `$imports` not the bound table                                   | run     | JIT throws `"MANAGED_SURFACE_TABLE"` before any import read                            |
| Lexical redeclaration or restricted global                       | run     | `{error:"throw"}` SyntaxError from GDI; context popped                                 |

## 9. Blockers and risks

1. **D6f4 keys (blocking).** §5.4 is required. Real Scripts have no exported collection type.
2. **Native allocation across imported entries is unproven.** D6d4 statuses 16/17 are its first
   evidence. S2-e1 waits for them. A fault there is a root-map defect, not a Script defect.
3. **Native compile cost and allocation.** The frozen v3 self-build stopped at allocation during
   emission. S2-e1 links nine runtime sources and emits about 100 KB in the image. Measure with
   status timestamps; use `--precompiled` only to split a failure, never as acceptance.
4. **Binder completeness** (frame plan R1). The proof falls back to rejection. E3's unmigrated
   negative pins it.
5. **95 eager table loads.** Every vocabulary value becomes one constant per entry call, whether
   used or not. This is correct but unmeasured. Pruning unused import constants is a later
   optimization; it is not needed here.
6. **Alias renumbering.** `$T` names in this document come from the overlay census (vocabulary
   119 or 120). Tests must resolve aliases by export or lookup, never by literal `$T` numbers.
7. **Concurrent edits.** Main is changing `managed-runtime-selection.ts` and `jobs.ts` (both
   touched during capture). Re-run `r1`, `r3`, `r6` and `r7` on the landing commit before
   pinning 12/15/25.

## 10. Defaults (main may take them without asking)

Fixture-owned frame and `invoke`/`completion` declarations; vocabulary unchanged; adapter
`options.frame`; view and table local names `$tint$managed$view`/`$tint$managed$table`; error
`"MANAGED_SURFACE_TABLE"`; first provider in directory order; multi-class records private only
when unallocated and untested; `hostDefined: undefined`; report `native-managed-script-v1`.

## 11. Next planning recommendation

After S2-e1 passes natively, plan **S2-ev1, the `$262.evalScript` service** on this entry. It
covers ParseScript errors as realm SyntaxErrors before any record exists, one record per call,
the current realm's paired global, and `rejectUnsupportedExecution` for tagged templates and
profile failures. It also removes `test262-native.ts:408-412`'s rejection and promotes
`ScriptEntryFrame` into `js-engine`. The 31 pinned files that call `evalScript` (18
`annexB/language`, 13 `language/global-code`) are the acceptance set. A code cache keyed by
source text, and tagged-template instance state as a further frame field (frame plan D5), come
after it.

That pass is [S2-ev1, the `$262.evalScript` service](rt-eval-host-evalscript.md).
