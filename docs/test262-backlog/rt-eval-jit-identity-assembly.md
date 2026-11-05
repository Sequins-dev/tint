# RT-EVAL S2-e1/E3b: callback identity and `prepareManagedSurfaceEntry` assembly

Status: **implemented; native Script execution remains E4.**
Callback identity binding [passes natively](../results/native-managed-jit-signatures-v2.json).
The earlier [fixture assertion](../results/native-managed-jit-signatures-v1-analysis.json)
is retained separately. `prepareManagedSurfaceEntry` now composes preparation,
frame/record/callback checks, opaque runtime imports, emission and selection.
Three template-free Scripts pass Node emission/selection with a real AOT-selected
frame; [native typed-entry emission passes](../results/native-managed-jit-entry-v1.json). The shared frame fixture replaces
the previous test overlay. Workspace gates pass **3,899 tests**.

Parent: [first managed Script](rt-eval-first-managed-script.md) §5.3, §5.5, §5.6
and E3. The captured research below describes the pre-implementation snapshot;
its Script execution, descriptor census and allocation questions remain E4.

Captured 2026-11-04, about 21:35 PST. Live `packages/*/src` has 543 `.ts` files. The probe's
own hash of the sorted sources is `704a0981d2a3…`. That hash is a local label, not
`workspaceSourceIdentity`. `dist` is as new as `src` or newer for `compiler`, `js-engine`,
`ts-native`, `typescript`, `codegen`, `ir` and `js-runtime`. Like the existing tests, the
probes import `managed-jit-program.ts`, `managed-jit-records.ts`,
`managed-runtime-selection.ts` and `managed-contracts.ts` from `src`, and everything else
from public `dist`. The probes live in `/tmp/tint-jit-identity-plan` (`common.mts`, `p1.mts`,
`p2.mts`). They run with the repository as cwd through a `node_modules` symlink, write nothing
in the workspace and run no native code. **Every number below is Node-only, non-native
evidence.** None of it shows native compilation, linking, GC, calls or conformance. The
newest fixed point, `f712541`, predates the E3 slices. No conformance gain is claimed.

## 1. Answer in brief

1. **The whole Script chain already emits in Node, with a real frame.** It builds the
   directory with a fixture-owned `ScriptEntryFrame` selected through the ordinary
   `resolveManagedSurfaceSelections` path (not a fake alias). It then uses the restored
   `read.contracts.surface` and runs normalize → adapt(frame) → `prepareManagedJitProgram` →
   `verifyManagedJitFrame` → `lowerManagedJitProgram` → `bindManagedJitRecords` with
   `[table, frame]` required → keys → `bindManagedRuntimeImports` → the prototype signature
   binder (§4) → `emitModule` → `selectManagedIdentityBindings`. All three template-free
   Scripts emit and select (`p1`). For `var v=40;let y=2;function f(a){return a+v;}f(y);` the
   managed imports are 25 signatures (3 member-only), 15 records and 12 function entries, plus
   the brand: **53 imports, 93,864 B, 53 selected**. That matches E3's predicted
   12/15/25/53.
2. **`lowerManagedSignatureGroups` cannot be used as a binding list.** It returns
   `LocalSignatureBinding[]{name,contract,functions}` (`managed-contracts.ts:337-400`).
   `functions` mixes surviving members with the final IDs of semantic witnesses whose source
   type is one of the group's `sourceTypes`. It has no `witness` field. Codegen needs exactly
   one call-indirect `witness` per binding, and members in `localFunctions` that **exclude**
   every witness (`codegen/.../index.ts:718-834`). The binder must partition by the
   witness map, not by ABI.
3. **`planManagedSignatureGroups` cannot express witness-only classes.** It rejects
   `functions.length === 0` (`managed-contracts.ts:254`). Witnesses must therefore be
   classified separately from `signatureTypes`. In the probes, every classed witness (22 of
   23, 27 of 28 and 27 of 28) is in a class with no JIT member. They are presumably the
   import-constant helper calls, which is inferred and not traced. No lowered group contains
   a witness.
4. **One class can need two witnesses.** Lowering interns one witness per checked type ID
   (`ts-native/.../lowering/index.ts:456-476`). Two type IDs that exactly match one class
   give two witnesses: Script 3 has one such class, and so does the typed `witnessAndMember`
   case. `ManagedSignatureBinding` has one `witness`, so the binder emits **one binding per
   witness under the same contract**, with members only on the first. Codegen checks only
   that names are unique (`index.ts:688-694`). The reader's pool rejects duplicate
   _directory_ contracts, but imports may repeat a contract under distinct names
   (`managed-directory-reader.ts:350-401`). Script 3 selects 50 of 50.
5. **Correction to §5.3: the direct-call proof must not hide a class match.** In typed
   fixtures, `execute(x:number):number` exactly matches the surface class `Inc`. The adapter's
   own call to it lowers to a `call-indirect` whose witness also matches `Inc`. If `execute`
   is excluded from membership because it is in the proof set, the witness imports the AOT
   `Inc` descriptor, but `execute` gets a private one. `emitModule` accepts that pairing. At
   run time it would `brk #3` (`p2`, first version). **Rule:** every final `function-new` target
   with exactly one class is a member of that class. The proof set exempts only _classless_
   targets. For the real Script, `execute` is classless, so the counts do not change.
6. **The escape gate is necessary; codegen does not enforce it.** With the gate skipped, an
   escaping classless arrow and a helper declaration used as a value both still emit, with a
   private descriptor (`p2`). Only the compile-time rule turns them into profile errors.
7. **Variance is a second trap path, so add a JIT-local gate.** An `Inc` arrow assigned to a
   `Wide=(v:number)=>number|undefined` binding and called through it emits a class-`Wide`
   witness while the arrow carries `Inc` (`p2`, `variance` and `varianceTs`). The binder must
   reject any non-proof JIT target that is assignable to the witness type of a different class
   (§4.5). The real Scripts have **0** such JIT pairs. AOT classes assignable to other classes'
   witness types (9, 13 and 6 per sample, some with different ABIs) are an inherited AOT-wide
   limitation (§9.2). They are not new JIT authority.
8. **Equal ABI never merges classes.** The typed surface has 5 ABI-duplicate classes. Two
   equal-ABI arrows, `(Box)=>number` and `(Tag)=>number`, become two member-only bindings with
   distinct contracts and equal `parameters`/`returnType`.
9. **The frame needs no new mechanism.** `verify-hosted-managed-surface-directory.ts --script-frame` already reifies the fixture-owned `ScriptEntryFrame` in an AOT image
   ([native report](../results/native-script-frame-directory-v1.json), completed, 543-file
   snapshot `92defb09…`). The Node test's `$ManagedScriptFrame` overlay is the only fake. It
   must use the same helper text through selection (§5).

## 2. Current primitives (read from source)

| Primitive                                                                                   | Contract relied on                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepareManagedJitProgram(module,entry,view,aliases,runtime)`                               | `{checked,options,linked,entry,view,aliasTypes}`. IDs belong to the final collection graph. It rejects retained runtimes and bad namespaces                                                                                  |
| `verifyManagedJitFrame(program,frameAlias)`                                                 | Frame fields `$imports:unknown`, `$argument<i>` exact-`matches` the callee resolved from the wrapper's final return call. Returns `{type,callee}`                                                                            |
| `lowerManagedJitProgram(program,target?)`                                                   | Roots wrapper+view, view binding, opaque runtimes, prune→optimize→prune, root `(reference)->general`, no runtime body. Returns `module,entry,sources,entries,recordTypes,signatureTypes,functionMaps,recordMaps`             |
| `bindManagedJitRecords(program,lowered,surface,required)`                                   | Exact classes and layout agreement. Multi-class records stay private only when unobserved                                                                                                                                    |
| `managedRuntimeKeysForOptions` → `describeManagedRuntimeUses` → `bindManagedRuntimeImports` | Exact element keys. One slot per import. ABI skew is an error                                                                                                                                                                |
| `managedDirectCallDeclarations(checked,wrapper)`                                            | Nested declarations whose every binder reference is a direct callee                                                                                                                                                          |
| `planManagedSignatureGroups(checked,requests)`                                              | Exact membership. Rejects empty `functions`, equivalent classes, a function or type in two groups and inexact members                                                                                                        |
| `lowerManagedSignatureGroups(groups,entries,signatureTypes,maps)`                           | Final `functions` = retained members ∪ retained witnesses of `sourceTypes`. Rejects a source absent from `entries` or a final ID in two groups                                                                               |
| `emitModule(…,{managedABI})`                                                                | Witness: one per binding, used by `call-indirect`, never a `function-new` target. `localFunctions`: non-import, not a witness, unique, ABI equal to the binding. Ungrouped functions share descriptors by ABI (`:1015-1040`) |
| `selectManagedIdentityBindings(read,imports)`                                               | Match by contract, role, domain, ABI and layout. No reads or patches                                                                                                                                                         |
| `linkManagedSurfaceModule(read,native,readWord,domain)`                                     | Domain recheck, selection, then `resolveManagedPointers`. Mapping and publication belong to the caller                                                                                                                       |

## 3. Probe results (Node only)

| Probe       | Case                                                                          | Result                                                                                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p1 surface  | Script vocabulary + fixture `ScriptEntryFrame` via selection                  | 3.2 s; `frame:"ScriptEntryFrame"`; types 20, records 180, classes 159, providers 41; frame alias restores as `$T120` (do not pin)                                                                     |
| p1 Script 1 | `var v=40;let y=2;function f(a){return a+v;}f(y);`                            | 41 functions (12 imports); `function-new` 4 = proof `execute` (classless) + 3 single-class arrows; 23 `call-indirect` targets, all witnesses, 1 classless; 25/15/12 + brand = 53; 93,864 B; select 53 |
| p1 Script 2 | `function f(a,b){return [a,b,function(){return a;}];}…`                       | 52 (17); 5 targets (one class with 2 members); 28 witnesses (1 classless); 30/13/17 = 61; 171,656 B; select 61                                                                                        |
| p1 Script 3 | `var g=(x)=>x*2;var arr=[1,2,3].map(g);…`                                     | 43 (10); 3 targets; 28 witnesses (1 classless, **one class with 2 witnesses**); 29 sig (2 member-only)/10/10 = 50; 123,952 B; select 50                                                               |
| p1 hazards  | Witness type τ versus types assignable to it with another class               | JIT targets: 0/0/0. AOT classes: 9/13/6 (equal and different ABIs)                                                                                                                                    |
| p2          | Typed surface (12 classes, 4 records, 5 ABI-duplicate classes), frame `Frame` | Rows below; ~0.1 s per case                                                                                                                                                                           |
| p2          | `member`: arrow passed to `apply(f:Inc)`; `execute:(number)=>number`          | Targets `D[Inc]`, `[Inc]`. Binding `Inc`: witness + 2 members (includes `execute`). Emits, 0 private descriptors                                                                                      |
| p2          | `equalAbiDifferentClasses`                                                    | Two member-only bindings, `Left` and `Right`, distinct contracts, equal ABI                                                                                                                           |
| p2          | `witnessAndMember`: `getInc()(x)` + arrow to `apply`                          | Two `Inc` witnesses → 2 bindings, same contract, members on the first only. Members on both give `invalid or duplicate local signature member`                                                        |
| p2          | `escapingUnknownArrow`: `keep((v:string):string=>v)`                          | Gate rejects. Without the gate: emits with 1 private descriptor                                                                                                                                       |
| p2          | `helperAsValue`: `function h(v:boolean)`, `keep(h)`                           | Gate rejects (h is not in the proof set and has no class)                                                                                                                                             |
| p2          | `helperDirect`: `h(true)+h(false)`                                            | Proof 2, one classless target, one classless witness, 0 bindings; emits                                                                                                                               |
| p2          | `executeAsValue`: `keep(execute)`                                             | Proof 0. `execute` is a member of `Inc`, so it is accepted. With a classless signature such as `(x:boolean)` it is rejected                                                                           |
| p2          | `variance`/`varianceTs`: `Inc` arrow stored in `Wide`, called                 | Witness `Wide`, target `Inc`, assignable. Emits **without** any error, which is a latent trap → new gate                                                                                              |

## 4. Callback identity: new `compiler/src/native/managed-jit-signatures.ts`

### 4.1 API

```ts
export interface ManagedJitSignatureSurface {
  readonly name: string;
  readonly digest: string;
  readonly signatures: readonly {
    readonly alias: string;
    readonly aliases: readonly string[];
    readonly parameters: readonly ScalarType[];
    readonly returnType: ReturnType;
  }[];
} // SerializedManagedSurfaceDirectory satisfies this structurally
export interface ManagedJitSignatures {
  readonly brand: ManagedIdentityImport | undefined; // present iff signatures.length > 0
  readonly signatures: readonly ManagedSignatureBinding[];
  readonly privateWitnesses: readonly number[]; // classless final witness IDs, for tests
}
export function bindManagedJitSignatures(
  program: ManagedJitRecordTypes, // {checked, aliasTypes}: reuse the records input type
  lowered: LoweredManagedJitProgram,
  surface: ManagedJitSignatureSurface,
  direct: readonly number[], // managedDirectCallDeclarations(program.checked, program.entry)
):
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: ManagedJitSignatures };
```

Every error string starts with `profile: `. The function never inspects addresses and never
treats ABI words as authority. ABI appears only as codegen's own validation.

### 4.2 Algorithm (deterministic)

1. **Class types.** For class `k`, `ids[k]` = `aliasTypes` of `alias` and every
   `aliases[i]`. A missing alias gives `surface signature alias is missing: <alias>`.
   `classOf(type)` = every `k` with `matches(type, ids[k][j])` for some `j`, using
   `createManagedTypeContractIndex(checked.types)`. More than one match gives
   `callback type matches several surface classes`. Canonical classes are pairwise
   inequivalent, so this is an invariant check.
2. **Witness map.** For each type `t` with `lowered.signatureTypes[t] = w+1`, retain `w`
   through both `functionMaps`. If it survives, set `witnessType[w_final] = t`. Then scan
   the final module: every `call-indirect` target must be in `witnessType`, otherwise
   `call-indirect without a semantic witness` (probes: 0). Every `function-new` target must
   **not** be in it, otherwise `witness used as a closure`. Codegen already forbids that too,
   but this fails earlier with a profile message.
3. **Targets.** `T` = final `function-new` targets. Each needs `src = lowered.sources[t]`,
   otherwise `JIT closure has no source identity`. Its checked function type is found the way
   `planManagedSignatureGroups.functionType` finds it. Export that lookup as
   `managedFunctionType(checked,id)` from `managed-contracts.ts` instead of copying it.
   - one class `k` → member candidate of `k` (**including proof-set sources**, §1.5);
   - no class and `src ∈ direct` → private (direct-call proof exception);
   - otherwise → `JIT closure without an exact surface callback class`.
4. **Plan exact membership.** Send one request per class with at least one candidate:
   `{name:"$signature"+k, contract: managedSurfaceContract(name,digest,"fn",k), type: ids[k][0], aliases: rest (deduplicated), functions: candidate sources}`.
   Order by `k`. `planManagedSignatureGroups` re-proves exactness on the checked graph, so
   that graph is the authority. Then call
   `lowerManagedSignatureGroups(plan, lowered.entries, lowered.signatureTypes, lowered.functionMaps)`.
   Candidates come from surviving targets, so the lowering cannot report an absent member.
5. **Partition, don't trust the merge.** For each lowered group of class `k`, every `f` in
   `functions` with `witnessType.has(f)` is a witness. Require `classOf(witnessType[f]) = [k]`,
   otherwise `witness class differs from member class`. Every other `f` must be a final ID in
   `T` with candidate class `k`, otherwise `unexpected lowered signature member`.
6. **Witness-only classes.** Each remaining witness with `classOf = [k]` joins class `k`
   once (deduplicate by final ID). A witness with no class goes to `privateWitnesses`. It
   receives an ABI-keyed image-local descriptor. The variance gate is what makes that safe
   (§4.5).
7. **Emit.** For each class `k` in ascending order, sort its witnesses ascending. Then:
   - one binding per witness: `{name: i===0 ? "$signature"+k : "$signature"+k+"$"+i, contract, witness, parameters, returnType}` from `surface.signatures[k]`;
   - members (ascending) go only on the first binding as `localFunctions`;
   - a class with members and no witness gets one member-only binding (B8);
   - a class with neither gets no binding.

   Set `brand = {name:"tint.function.v1", contract:"tint.function.v1"}` when any binding
   exists. That is the reader's `read.brand` contract (`managed-directory-reader.ts:331-336`).

### 4.3 Escape-proof exceptions, exactly

| Final `function-new` source      | Class | Decision                                                      |
| -------------------------------- | ----- | ------------------------------------------------------------- |
| in `direct` (proof)              | none  | private; only its own direct call sites can reach it          |
| in `direct`                      | one   | **member** (so its own witness, also class `k`, agrees)       |
| not in `direct` (arrow or value) | one   | member                                                        |
| not in `direct`                  | none  | reject: `JIT closure without an exact surface callback class` |
| any                              | ≥2    | reject: `callback type matches several surface classes`       |
| no source (synthetic)            | —     | reject: `JIT closure has no source identity`                  |

No exception uses names, spans, ABI equality or the wrapper's position. The proof is the
binder's reference set (`managed-closure-uses.ts`).

### 4.4 Call-indirect witness contracts

| Witness type τ | Decision                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| one class `k`  | imported `fn/k`; one binding per witness; same contract for several                                                 |
| no class       | private (ABI-keyed local descriptor). Allowed only if the variance gate finds no classed JIT target assignable to τ |
| ≥2 classes     | reject (invariant)                                                                                                  |
| inside a group | must classify to that group's class (§4.2 step 5)                                                                   |

### 4.5 Variance gate (new; JIT-local, fail-closed)

Build `createTypeSystem(checked.types)` once. Then, for every non-proof target `F` (class
`kF`) and every final witness `W` (type τ, class `kW` or none): if `kF !== kW` and
`assignable(type(F), τ)`, reject with `profile: callback variance crosses surface classes`.
Proof-set targets are skipped, because they are never values. This is quadratic in
targets × witnesses (≤5 × 28 in the probes). It rejects `variance`/`varianceTs` and accepts
all three Scripts. It does not try to reason about AOT-origin values (§9.2).

## 5. The fixture-owned `ScriptEntryFrame`, reified and not faked

The AOT side already exists. `tools/verify-hosted-managed-surface-directory.ts:107-124`
(`--script-frame`) adds `{module:"surface-helpers",name:"ScriptEntryFrame"}` to `types`. It
sets the request's `frame` and declares, in the helper module:

```ts
import type { GlobalEnvironment } from "script-global";
import type { ScriptPropertyKey, ScriptRecord } from "script-objects";
export interface ScriptEntryFrame {
  readonly $imports: unknown;
  readonly $argument0: GlobalEnvironment<ScriptPropertyKey, unknown>;
  readonly $argument1: ScriptRecord;
}
```

`createManagedSurfaceDirectory(…, "ScriptEntryFrame")` validates it. The image publishes it
(native report above). The JIT must consume **that** declaration through the directory read.

**Plan (no new compiler API):**

1. New `tools/script-entry-frame-fixture.ts` exports `scriptEntryFrameSource` (the text above)
   and `scriptEntryFrameDependencies` (`script-global` → `packages/js-runtime/src/environments/global/index.ts`,
   `script-objects` → `packages/js-runtime/src/objects/index.ts`). The native directory
   fixture and the Node tests import this one constant, so the AOT image and the Node
   directory reify byte-identical declarations.
2. `tools/script-runtime-surface.test.ts`: add the helper module to `modules` and the root
   imports. Push the `types` selection and pass `"ScriptEntryFrame"` to
   `createManagedSurfaceDirectory`. Delete the `$ManagedScriptFrame` overlay and its
   hand-built `extended` description. Adapt and prepare from `read.contracts.surface` with
   `{frame: "ScriptEntryFrame"}`. Resolve the alias as
   `surface.types.find(t => t.name === read.directory.frame).type.name`, and require
   `[surface.table.name, frameAlias]` in `bindManagedJitRecords`. Census: 20 types, 180
   records, providers, slots and classes unchanged (41/355/159). `p1` reproduces this.
3. The AOT fixture keeps its inline text until it imports the constant. That is a separate
   one-line refactor in the same slice. Its report is not re-recorded unless main rebuilds it.
4. Promotion into `js-engine/native` stays in S2-ev1. It is a file move.

## 6. `prepareManagedSurfaceEntry`: new thin `compiler/src/native/managed-jit-entry.ts`

```ts
export interface ManagedSurfaceEntryRequest {
  readonly module: Module; // lowerScript output or a typed entry
  readonly entry: string; // "execute"
  readonly specifiers: ReadonlySet<string>;
  readonly instantiations: ReadonlyMap<string, readonly string[]>;
  readonly read: ManagedSurfaceDirectoryRead; // image-issued, already validated
  readonly runtime: ManagedSurfaceLayoutRuntime; // the image's own runtime sources
  readonly target?: TargetDataLayout;
}
export interface PreparedManagedSurfaceEntry {
  readonly native: NativeModule; // linkage "unresolved-managed"; never published here
  readonly entryOffset: number; // native.functions[lowered.entry].offset
  readonly counts: {
    readonly signatures: number;
    readonly memberOnly: number;
    readonly records: number;
    readonly functions: number;
  };
}
export function prepareManagedSurfaceEntry(
  request: ManagedSurfaceEntryRequest,
):
  | { readonly ok: true; readonly value: PreparedManagedSurfaceEntry }
  | {
      readonly ok: false;
      readonly error: {
        readonly stage: "profile" | "prepare" | "lower" | "emit" | "select";
        readonly message: string;
      };
    };
```

Steps. Each stops at its first error and allocates nothing outside the compiler:

1. `frame = read.directory.frame`. If it is undefined, fail with
   `profile: surface has no entry frame` before normalization.
   `surface = read.contracts.surface`.
2. `normalizeManagedSurfaceApplications(module, specifiers, instantiations, surface)`.
3. `adaptManagedSurfaceEntry(normalized, entry, [...specifiers], surface, {frame})`. Its
   result must carry `view`.
4. `aliases` = names of the `type-alias`/`interface` declarations in `surface.declarations`.
   Then `prepareManagedJitProgram(adapted.module, adapted.entry, adapted.view, aliases, runtime)`.
5. `frameAlias` = the `named` type of `surface.types[frame]`. Run
   `verifyManagedJitFrame(program, frameAlias)`.
6. `direct = managedDirectCallDeclarations(program.checked, program.entry)`. A non-`ok`
   result fails closed.
7. `lowered = lowerManagedJitProgram(program, target)`. It covers the root ABI, the opaque
   runtimes and the no-runtime-body check.
8. `bindManagedJitRecords(program, lowered, read.directory, [surface.table.name, frameAlias])`.
9. Keys → uses → `bindManagedRuntimeImports(read.directory, lowered.module, lowered.sources, uses)`.
   Opaque runtimes become `function-entry` imports with `runtime/<slot>` contracts. There is
   no body and no address.
10. `bindManagedJitSignatures(program, lowered, read.directory, direct)`.
11. `emitModule(lowered.module, {closedRoots:[lowered.entry], managedABI:{version:1, functionBrand, signatures, records, functions}})`.
12. **Selection preflight:** run `selectManagedIdentityBindings(read, native.managedImports)`
    and discard the result. A failure is `stage:"select"`. This reads no words and patches
    nothing. It proves before return that every contract resolves in this read's pool.
13. Return `{native, entryOffset, counts}`. The caller runs
    `linkManagedSurfaceModule(read, native, readWord, currentDomain)`, then
    `storage.publish(code)` once. Nothing is mapped or published on any failure, and none
    of steps 1–12 can publish.

The function stays internal: not exported from `native/index.ts`, tests import `src`, as for
the other `managed-jit-*` modules. Export it in S2-ev1 when `js-engine` calls it.

## 7. Exact edit list

| File                                                           | Change                                                                                          |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `packages/compiler/src/native/managed-contracts.ts`            | Export `managedFunctionType(checked,id)`, extracted unchanged from `planManagedSignatureGroups` |
| `packages/compiler/src/native/managed-jit-signatures.ts` (new) | §4 (about 200 lines)                                                                            |
| `packages/compiler/src/native/managed-jit-entry.ts` (new)      | §6 (about 120 lines; composition only)                                                          |
| `packages/compiler/test/managed-jit-signatures.test.ts` (new)  | §8.1 typed fixtures                                                                             |
| `tools/script-entry-frame-fixture.ts` (new)                    | §5 shared helper text                                                                           |
| `tools/script-runtime-surface.test.ts`                         | §5 step 2: real frame, both required records; delete the overlay                                |
| `tools/managed-jit-entry.test.ts` (new)                        | §8.2 real-Script assembly                                                                       |
| `tools/verify-hosted-managed-surface-directory.ts`             | Import the shared frame text (same bytes)                                                       |

There are no edits to codegen, lowering, the checker, the adapter, the reader,
`managed-jit-program.ts`, `managed-jit-records.ts` or the selection modules.

## 8. Red-first tests

### 8.1 `managed-jit-signatures.test.ts` (typed, about 1 s total)

Fixture: the `p2` declarations (`Box`, `Tag`, `Left`, `Right`, `Inc`, `Wide`, `Frame`;
helpers `apply`, `useLeft`, `useRight`, `keep`, `box`, `tag`, `getInc`, `getWide`). Then
`reifyManagedSurfaceTypes` → canonicalize → facts (no runtimes) →
`createManagedSurfaceDirectory("typed",…,"Frame")` → adapt(frame) → prepare → lower. Assert
on the bindings, then `emitModule` succeeds:

1. `member`: class `Inc` has one binding with a witness and `localFunctions` of 2, one of
   which is the proof-set `execute`. `privateWitnesses = []`. Red today: no module.
2. **Regression for §1.5:** a variant that excludes proof sources must be impossible. Assert
   that `execute`'s final ID is in `localFunctions` and that no emitted
   `signatures[].identity === undefined` descriptor contains it.
3. `equalAbiDifferentClasses`: two member-only bindings with distinct contracts and
   deep-equal ABI. Emission has two distinct managed signature slots.
4. `witnessAndMember`: two bindings with the same contract and names `$signature<k>`,
   `$signature<k>$1`. Members appear once. Emission succeeds.
5. `helperDirect`: zero bindings, `brand` undefined, one private witness.
6. Rejections, each with an exact message: `escapingUnknownArrow` and `helperAsValue` →
   `JIT closure without an exact surface callback class`; `execute(x:boolean)` with
   `keep(execute)` → the same message; `variance` and `varianceTs` →
   `callback variance crosses surface classes`; a class alias deleted from `aliasTypes` →
   `surface signature alias is missing`.
7. A tampered witness: copy `signatureTypes` and point a group type's witness at a
   different-class witness. Expect `witness class differs from member class`.

### 8.2 `tools/managed-jit-entry.test.ts` (one slow real-surface test, about 6 s)

Build the frame-carrying directory once, as in §5, and read it with a spy host
(`domain 17`). Then:

1. Script 1 → `prepareManagedSurfaceEntry` ok. Counts are signatures 25 (memberOnly 3),
   records 15, functions 12. Managed imports by role: 1/25/15/12. The entry function's ABI is
   `(reference)->general` and `entryOffset === native.functions[…].offset`. Pin the counts
   only on the landing commit (§9.5).
2. Spy `linkManagedSurfaceModule(read, native, readWord, 17)` patches every import, and input
   `native.code` is unchanged. With domain `18` it fails, with 0 reads.
3. Script 3: one class has two witness bindings with an equal contract, and selection
   succeeds.
4. Negatives, all before emission, with nothing returned:
   - a frame-less directory read → `surface has no entry frame`;
   - a directory whose frame is typed `$imports: <table>` → adapter error
     `surface frame imports must be unknown`;
   - a tagged template → `managed entry does not support module initialization`;
   - a re-digested directory with one record layout tampered → `record layout skew`;
   - a provider row deleted (re-digested) → `runtime import has no surface use`.

### 8.3 Gates

`pnpm build` → focused tests → `pnpm check`. A native fixture is not part of this slice
(E4/§7 of the parent remains next). Compiler sources change, so the next native campaign needs
a frozen self-build with byte-identical stages.

## 9. Risks and unknowns

1. **AOT descriptor identity is ABI-keyed.** That is an inference from source:
   `compileArm64Program` passes no `localSignatures`, so ungrouped AOT functions share
   descriptors by ABI (`codegen index.ts:1015-1040`). The reader then gives the same pointer
   to equal-ABI classes. JIT bindings stay distinct by contract either way. Not verified
   natively; E4 should record the pointer census.
2. **AOT-origin variance.** Surface classes assignable to other classes' witness types exist
   (9/13/6). A value from AOT that is widened inside the JIT and called through a
   different-class witness traps if the ABIs differ. This is the exact-group limitation
   already recorded in [rt-eval.md](rt-eval.md) (S1, "safe variance"). The JIT gate covers
   only JIT-created closures. A runtime guard or variance-aware membership is S2 or later.
3. **Private witnesses.** They rely on the variance gate plus the direct proof. A classless
   witness reached by an AOT value would need an AOT value with a classless static type. No
   such value is observed, and nothing proves it impossible in general.
4. **Selection preflight duplicates link work.** It is cheap and pure. Keep it for the
   "no publication before validation" guarantee.
5. **Counts drift.** These figures differ from the earlier r7 snapshot (103,872 B there,
   93,864 B here) because sources changed. Re-measure on the landing commit, and resolve
   aliases by export, never by `$T` literals.
6. **Native cost.** It is still unmeasured: the surface build takes 3.2 s and each Script
   0.5–0.6 s in Node. The image path is E4.

## 10. Next

**Concrete next implementation slice (E3b):** export `managedFunctionType`, then add
`managed-jit-signatures.ts` with §8.1 red-first, and `managed-jit-entry.ts` with §8.2. Also
add the shared frame fixture and the `script-runtime-surface.test.ts` frame migration (§5).
There are no other source edits.

**Remaining unknowns:** native descriptor pointer equality for equal-ABI classes (§9.1);
AOT-origin variance (§9.2); native compile time and allocation for about 100–170 KB of
emission in the image.

**Next useful planning task:** after E3b lands, plan the **E4 native fixture**
(`verify-hosted-managed-script.ts`, parent §7). Refresh its statuses against
`prepareManagedSurfaceEntry`'s real error stages. Add a descriptor-pointer census for
equal-ABI classes, and a status that calls a JIT member callback from AOT after GC churn.
