# RT-EVAL S2-e1/E4: native Script execution through an in-image managed entry

Status: **E4 passes** [native execution](../results/native-managed-script-v4.json).
The [1MiB-stack experiment](../results/native-managed-script-small-stack-v3-analysis.json)
fails at its guard; the passing build uses 16MiB. Parent: [first managed Script](rt-eval-first-managed-script.md)
§7 and E4, refined by [callback identity and assembly](rt-eval-jit-identity-assembly.md) §10. Consumer:
[S2-ev1 `$262.evalScript`](rt-eval-host-evalscript.md) EV4/D3.

Captured 2026-11-04, about 22:30 PST. `workspaceSourceIdentity` is `3fed367d375a…` over 545 files.
By mtime, 75 `src` files are newer than their `dist` output (foundation 65, ts-native 9,
js-runtime 1); contents were not compared. The probes import `compiler`, `js-engine`, `typescript`
and `source` from `src` by absolute path. `tools/managed-script-fixture.ts` imports `@tint/*`
from `dist`, as the existing tests do. The probes live in `/tmp/tint-e4-plan` (`flows.mts`,
`flows-lib.mts`, `scripts.mts`, `members.mts`, `arrows.mts`, `completion.mts`, `heap.mts`,
`gate-time.mts`, `embed.mts`, `ident.mts`). They write nothing in the workspace, emit no image and
run no native code. **Every number below is Node-only, non-native evidence.** None of it shows
native compilation, linking, GC, calls or conformance. The frozen self-build
`mje-self-v1` and survey PID 28307 were not touched.

Current implementation uses a 256MiB heap, allocation workspace 8,388,608 and a
16MiB stack. [Resource evidence](../results/native-managed-script-v2-analysis.json)
and the [record-identity correction](../results/native-managed-script-v3-analysis.json)
explain the differences from the original proposal below. Managed JIT lowering now
preserves exact surface record contracts; private storage interning stays enabled.
The simple Script imports 23 record descriptors, 61 managed identities in total.
These are bespoke compiler/runtime results, not Test262 passes. The newer evaluator
service still needs native integration.

## 1. Answer in brief

1. **E4 is one hosted fixture with no new host operation.** The image binds the `scriptRuntime`
   surface, parses embedded runtime sources, and parses and lowers the Script text itself. It then
   runs `prepareManagedSurfaceEntry`, links once with `linkManagedSurfaceModule` and
   `memory-read-word`, publishes once through `createEngineCodeStorage`, and calls the entry
   through a fixture-declared `invoke` bound to `executable-call-managed`. The completion is read
   through a record `view` binding of `ScriptCompletionRecord`. Every operation it needs already
   exists in `ir/scalar/host.ts`.
2. **The Script** is `var v=40;let y=2;function f(a){nativeActive();return a+v;}nativeCount();f(y);`.
   In Node it emits 115,864 B with counts 25/3/15/12 (53 imports, 3 member-only). Preparation
   takes about 0.59 s and allocates about 100 MB of V8 heap, of which 2.8 MB is retained (§3).
3. **Exit codes avoid every Test262 code.** `nativeExitOutcome` gives meaning to 10–12, 20–28,
   30–38, 40, 42 and 50–59, and EV plans 13. E4 uses 42 for a pass and 60–99 for bespoke failures.
   `recordNativeFixture` records any other code as `crash: unexpected native exit status N`, so
   the raw code survives (§6). The compile errors use one code per real stage (64–68).
4. **Inherited AOT-origin variance is real but fail-stop.** In Node,
   `const w:Wide=getInc();return w(x)??0;` passes `bindManagedJitSignatures` (`Inc` is
   `(number)->number`, `Wide` is `(number)->optional-number`). Codegen's `call-indirect` compares
   the callee's signature word with the witness pointer and executes `brk #3` on a mismatch
   (`codegen/aarch64/scalar/index.ts:5398-5418`). So the process stops; no ABI-incorrect call runs.
   That holds only while different ABIs never share a signature pointer. E4 asserts this invariant
   in the image (status 90).
5. **A whole-graph `typeFlows` gate is cheap and has no false positives on the probes. Land it
   first, as E4a (§4).** Across five real Scripts, the 2,274–2,282 recorded flows contain **0**
   cross-class function pairs. The walk takes about 13.5 ms. It must judge `(source,target)` type
   pairs, not flow nodes. `Span` has no module identity, and `flowTargets` keeps only the first
   node for each pair, which may sit in an opaque runtime body.
6. **The descriptor census is report-only.** The surface has 159 classes, 109 distinct ABIs, and 72
   classes that share an ABI. Of the 25 classes the JIT imports, 4 pairs share an ABI. The image
   asserts only the safety direction (different ABI ⇒ different pointer). Whether equal-ABI
   classes share a pointer is recorded by a separate case and never used as authority (§9).
7. **Allocation cannot be counted with existing primitives.** `allocation-state` configures the
   allocator; it is not a counter. Elapsed time comes from paired selected-case reports. Byte
   count and determinism come from comparing the in-image length and FNV-1a against values that
   Node embeds (§8). No new operation is added.
8. **`--precompiled` is a diagnostic split only.** It isolates a native compile fault from link,
   GC and call faults. It never counts as acceptance (§7).

## 2. Primitives used (read from source)

| Primitive                                                                                                                                             | Contract relied on                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepareManagedSurfaceEntry(request)` (`compiler/src/native/managed-jit-entry.ts`, internal)                                                          | `{native,entryOffset,counts}` or `{stage: profile\|prepare\|lower\|emit\|select, message}`. Never maps, reads words or publishes                         |
| `readManagedSurfaceDirectory(exported,name,host)`                                                                                                     | `{domain,directory,contracts,brand,signatures,records,runtimes}`; each binding has `address` and `domain`                                                |
| `linkManagedSurfaceModule(read,native,readWord,domain)`                                                                                               | Domain check before any read, then selection and `resolveManagedPointers`. The caller maps and publishes                                                 |
| `selectManagedIdentityBindings(read,imports)`                                                                                                         | Pure. Matches contract, role, domain, ABI and layout                                                                                                     |
| `createEngineCodeStorage(host,capacity)`                                                                                                              | One permanent arena. `publish` returns the 16-aligned address or `undefined`, rechecks the domain, and never remaps                                      |
| `executable-call-managed`                                                                                                                             | Trusted same-context entry. It may allocate, call callbacks and throw. `verify-native-managed-frame.ts:321,479` declares a record-typed second parameter |
| Record operation `view`                                                                                                                               | `completion(value)` returns the AOT `ScriptCompletionRecord` or `undefined`                                                                              |
| `root-head`, `context-domain`, `memory-read-word`, `executable-map/-write`, `external-memory-register`, `native-value-function-descriptor/-signature` | Existing operations, as used by `verify-hosted-managed-runtime-link.ts`                                                                                  |
| `argument-count`, `copy-argument`                                                                                                                     | Default `projectBuildRequest` bindings. They select diagnostic cases (§7)                                                                                |
| Codegen `call-indirect` guard                                                                                                                         | Checks the descriptor, then signature word = witness pointer, otherwise `brk #3` (`index.ts:5398`)                                                       |

## 3. Probe results (Node only)

| Probe                 | Result                                                                                                                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts` (5 Scripts) | The plain `f(y)` sample emits 93,864 B, 25/3/15/12, 53 imports. Adding a `nativeCount()` call gives 103,872 B. The sample with closures gives 171,656 B, 30/3/13/17, 61 imports. The `map(g)` sample gives 123,952 B, 29/2/10/10, 50 imports. `let y;` gives 26,960 B, 8/1/8/5, 22 imports. Each takes 480–570 ms |
| `heap` (E4 Script)    | 115,864 B, 25/3/15/12, 53 imports, `entryOffset` 0, FNV-1a32 `26ff2369`, identical on both runs. 586 ms. V8 heap grows about 100 MB before GC and keeps 2.8 MB after it (V8 object sizes, not native)                                                                                                             |
| `embed`               | `runtimeSources()` lists **11** runtimes (the nine collections plus `native-fs-host` and `native-process`). Their closure is 22 modules, 104,522 B of text and 20 dependency edges                                                                                                                                |
| `members`             | Directory: 159 signature classes, 109 distinct ABIs, 72 classes share an ABI. The JIT imports 25 classes; 12 of them share an ABI with some class, and 4 pairs share one with each other                                                                                                                          |
| `arrows`/`completion` | The lowered Script passes one arrow to `runScriptContext` and `f`'s body to `createSourceFunction`. It builds no object literal with an `error` key; the completion comes from the table's `finishScriptExecution`                                                                                                |
| `flows` (typed)       | `getInc()` stored in a `Wide` local and called: **binder ok**, 1 cross-class pair. Passing `getInc()` as a `Wide` argument: the binder rejects it for another reason (a classless arrow). The JIT `variance` case is rejected. `member`, `equalAbi`, `helperDirect`, `getWide` and exact `getInc` have 0 pairs    |
| `scripts`/`gate-time` | The E4 Script has 2,279 flows: union→union 1,668, object→union 510, array 60, fn→fn 27, fn→union 12, object→object 2. Of the 27 fn→fn flows, 8 join classed types (same class each time) and 19 join classless types. Cross-class pairs: **0** on all 5 Scripts. The walk takes 13.5 ms                           |

## 4. Inherited variance and gate E4a

**Hazard.** A function value with surface class `kS` flows to a different class `kT`, or to a
classless function type, and is then called through a witness of the target type. The JIT-local
gate (§4.5 of the parent) only inspects `function-new` targets. AOT-origin values, such as table
results like `getInc()`, are invisible to it. At run time the guard compares pointers. With
different ABIs the result is `brk #3`, a crash outcome with no profile error. With equal ABIs and
ABI-keyed AOT descriptors (unverified, §9), the call proceeds and is ABI-correct.

**Why flow nodes cannot be used.** `recordTypeFlow` (`checker/closures.ts:717-741`) skips a
`(source,target)` pair it has already seen, so only the first node is kept. Runtime modules are
checked in the same graph as the Script, so that first node may belong to an opaque runtime body.
`CheckedTypeFlow.node` is a bare `Span` without a module. The Script's spans (offsets 17–58 in the
probe) overlap runtime offsets. So the gate cannot attribute a flow to JIT-owned code. It must
reject the type pair wherever it occurs. That is conservative and fails closed.

**Gate (E4a; in `bindManagedJitSignatures`, after the existing JIT-local variance check so its
message does not change):**

1. For each `flow` in `program.checked.typeFlows`, walk `(flow.source, flow.target)`
   structurally, the way `incompatibleRepresentationView` does:
   - A union source checks every member.
   - A union target checks the members that the source is `assignable` to.
   - Object properties are matched by name.
   - Array, set and map walk their elements, keys and values.
   - For function→function, check the pair itself, then the results (covariant) and the
     parameters (contravariant, target to source).
   - Track visited pairs, and allow at most 100,000 steps. Exceeding the budget fails with
     `profile: function flow analysis budget exceeded`.
2. At each function→function pair, compute `kS = classOf(s)` and `kT = classOf(t)` with the
   binder's existing exact `matches` index. Reject with
   `profile: function flow crosses surface classes` when `kS !== kT` and at least one of them is
   defined. Pairs where both types are classless are allowed. A classless type is never a surface
   value. JIT targets of a classless type are already confined to the direct-call proof, and the
   only producers of such flows are AOT-compiled runtime bodies (19 per Script, all classless on
   both sides).
3. Add no new API. Export nothing. Make no change to codegen.

**Tests (red first, `tools/managed-jit-signatures.test.ts`).**

- `const w:Wide=getInc();return w(x)??0;` is rejected with `function flow crosses`. Today it is
  accepted.
- A `getInc()` value stored as `Inc|undefined`, narrowed and called stays accepted, because no
  cross-class pair exists.
- JIT `variance` still reports `variance crosses`.
- The other existing typed cases are unchanged.
- `managed-jit-entry.test.ts`: all three Scripts plus the tagged-template rejection are unchanged.
- A budget-exhaustion case runs the internal helper with a tiny budget.

**Is it needed before publication?** E4's own Script has no such pair, and the guard stops the
process rather than corrupting it. So E4 would be safe without the gate. Land E4a first anyway:

- it turns a latent trap into a `profile` error before anything is published;
- it costs about 1/40 of preparation time;
- the E4 image then runs the gate in-process;
- S2-ev1 compiles arbitrary Script text, and only a gate makes "no crash from typed flow" a
  compile-time property instead of a property of each snapshot.

**Residual limits.**

- Flows through `unknown` or keyword types are not recorded. A value that later comes back as a
  typed function would need a checked view; the checker is not known to offer one for function
  types (unverified).
- Runtime-body pairs are rejected even though they are AOT-internal (0 observed).
- The JIT-wide guard is still the last line of defense.

## 5. Fixture `tools/verify-hosted-managed-script.ts`

Model it on `verify-hosted-managed-runtime-link.ts` (in-image JIT, spy reads, churn and root
head), on `verify-hosted-managed-surface-directory.ts --script-frame` (the surface request) and on
`verify-hosted-script.ts:4846-4909` (realm, intrinsics, natives).

**Strict native checker.** Declare every contextual callback parameter (`(receiver,args)`).
Avoid `typeof` narrowing on `array|string`.

### 5.1 Generated modules

- `surface-helpers`: exactly `scriptEntryFrameSource`, with `scriptEntryFrameDependencies`.
  It is byte-identical to the Node fixture and the directory fixture.
- `script-host` (new text in the fixture file), with dependencies `contracts` →
  `compiler/src/native/index.ts`, `script-objects` → `js-runtime/src/objects/index.ts` and
  `surface-helpers`:

```ts
import type { ManagedSurfaceExport } from "contracts";
import type { ScriptCompletionRecord } from "script-objects";
import type { ScriptEntryFrame } from "surface-helpers";
export function bindScript(): ManagedSurfaceExport {
  throw "MANAGED_SURFACE_UNBOUND";
}
export function invoke(address: number, frame: ScriptEntryFrame): unknown {
  throw "UNBOUND_SCRIPT_CALL";
}
export function completion(value: unknown): ScriptCompletionRecord | undefined {
  throw "UNBOUND_COMPLETION_VIEW";
}
```

The bodies are build-bound declarations, the same pattern as `memory.ts`. They are not stubs.
Keeping them out of `surface-helpers` keeps the frame text, and so the directory digest, equal to
Node's for case 2 and `--precompiled`.

**Build assumption.** `bind` may name a module other than the one holding the selections.
**Fallback:** if the build requires the same module, put both in one module and drop the
digest-equality checks.

### 5.2 Build options

`verifyHostedFixture(text, "managed-script", deps, generated, recordBindings, runtimes, options)`:

- **Dependencies.**
  - `source`, `syntax` (`parseModule`, `parseScript`), and `lowering` →
    `js-engine/src/lowering/index.ts` (`lowerScript`, `scriptRuntimeSurface`).
  - `compiler` → `compiler/src/native/index.ts`, and `entry` →
    `compiler/src/native/managed-jit-entry.ts`.
  - `storage` → `js-engine/src/native/code-storage.ts`.
  - `object` → `js-runtime/src/objects/index.ts`, and `global` →
    `js-runtime/src/environments/global/index.ts`.
  - `memory`, `module-model`, `host` → `script-host`.
  - The three `scriptDependencies` from the directory fixture.
- **Record bindings:** `[{module:"script-host", name:"completion", operation:"view"}]`.
- **Additional runtimes:** `{module:"script-host", namespace:"script-host-view",
retainedExports:["completion"]}`, the same pattern as the directory fixture's `view`, plus
  `{module: memory, namespace: "script-memory"}`.
- **Options:**
  - `allowJit: true` and `runtimeEntry: "initializeCopyingRuntime"`;
  - `managedBytes: 67108864`, `allocationCapacity: 1048576`, `rootCapacity: 16384` and
    `stackBytes: 16777216`;
  - host bindings: `native-value-function-descriptor`, `native-value-function-signature`,
    `context-domain`, `memory-read-word`, `executable-map`, `executable-write`,
    `external-memory-register` and `root-head` from `memory.ts`, plus
    `{module:"script-host", name:"invoke", operation:"executable-call-managed"}`;
  - `managedSurfaces: [scriptRuntimeRequest]`.
- **`scriptRuntimeRequest`.** Use the `--script-frame` selections exactly: `name:"scriptRuntime"`,
  values and types from `scriptRuntimeSurface()`, plus `{module:"surface-helpers",
name:"ScriptEntryFrame"}` and `frame:"ScriptEntryFrame"`. Set
  `bind:{module:"script-host", name:"bindScript"}`. Move that selection code into a shared
  `tools/script-runtime-request.ts` that both fixtures import. That move is a refactor and does not
  change bytes.

### 5.3 Embedded from Node (via `JSON.stringify`, at generation time)

- `RUNTIMES`: the `runtimeSources()` entries `{module, namespace}` (11).
- `MODULES`: `workspaceModules(runtimes.map(r => r.module))` mapped to
  `{id, text, dependencies:[…]}`. That is 22 modules, about 105 KB of text. Read `text` from the
  captured snapshot so the image and the manifest agree.
- `GLOBALS`: `managedScriptGlobals`.
- `SCRIPT`: the Script text (§1.2).
- `EXPECT`, used **only** by case 2 and `--precompiled`: `createManagedScriptFixture()` and
  `prepareManagedSurfaceEntry` run on the same snapshot. It holds the directory digest, the
  counts, `code.length`, FNV-1a32 of `native.code`, and `entryOffset`.

### 5.4 `run()` (one flow, in order; each check has a distinct status from §6)

```text
case = argumentCount()===2 ? copied argument : 0                 // 0 = acceptance
exported = bindScript(); read = readManagedSurfaceDirectory(exported,"scriptRuntime",host)  [60]
storage = createEngineCodeStorage({domain,map,register,write}, 1 MiB); publishes = 0         [61]
runtime = {modules: MODULES parsed with parseModule, runtimes: RUNTIMES, globals: GLOBALS}    [62]
script = lowerScript(parseScript(SCRIPT))                                                    [62,63]
if case==1 return 42                                                                         // baseline
prepared = prepareManagedSurfaceEntry({module:script,entry:"execute",specifiers,instantiations,read,runtime}) [64-68]
structural: linkage "unresolved-managed", imports 0, memberOnly>=1, records>=2, functions>=1 [69]
code.length <= MAX_SCRIPT_CODE (262144)                                                      [70]
frameless = prepare with {...read, directory:{...read.directory, frame:undefined}}
  → !ok, stage "profile", "surface has no entry frame"                                       [71]
spy readWord counts reads: link(read,native,spy,domain+1) fails with 0 reads                 [72]
link with every contract renamed "missing" fails with 0 reads                                [73]
census: different ABI ⇒ different read.signatures[k].address over 159 classes                [90]
selection: each signature import's address equals read.signatures[k] for its contract k      [91]
linked = linkManagedSurfaceModule(read, native, spy, currentContextDomain())                 [74]
if case==2: digest/counts/length/FNV equal EXPECT [92,93]; return 42                         // compile split
if case==3: return census outcome (§9)
address = publish(linked.code) + entryOffset; publishes==1; address>0, (address-entryOffset)%16==0 [75]
A = realm(); r1 = createScriptRecord(A.realm, undefined); head = currentRootHead()
done = completion(invoke(address,{$imports:exported.table,$argument0:A.global,$argument1:r1}))      [77]
  done = {none, 42} [76]; no activeContext [78]; head restored [79]; A.count==1 [81]; A.seen===r1, realm ok [80]
fA = own "f" of A.object; vA = own "v"
r2 = record(A); done2 → error "throw", prototype === A.realm.prototypes.get("syntax")      [82]
  A.count still 1 [81]; own "f" === fA and "v" === 40 [83]; [78][79]
for bad of [r2, undefined]: try invoke(address,{$imports:bad,A.global,record(A)}) → must throw
  exactly "MANAGED_SURFACE_TABLE" [84]; A.count unchanged [81]; [78][79]
churn: 1024 × new Uint32Array(8192) dropped (32 MiB)
B = realm(); r3 = record(B); done3 = {none,42} [86]; B.count==1, B.seen===r3 [80,81]; [78][79]
A.seen = undefined; res = callObjectValue(fA, undefined, [2], A.object) → {none,42}          [87]
  A.seen===r1 (the closure's creation record survived churn)                                 [88]; [78][79]
r1, r2 and r3 are pairwise distinct, and each record's realm is its own realm's               [85]
publishes==1                                                                                  [89]
return 42                                                                                     // whole body in try/catch → 99
```

**Realm helper.** Do what `verify-hosted-script.ts` `make()`/`invoke` do, and nothing more:

- `createObject`, the hooks, `installGlobalProperties` and `createGlobalEnvironment`;
- `createErrorRealm` and the 12 `install*Intrinsics` calls;
- `nativeCount` (`(receiver,args)=>{state.count++;return undefined;}`) and `nativeActive`, which
  stores `realm.agent.activeContext.scriptOrModule`, flags a missing context, and checks
  `active.realm===realm`.

The host keeps the pairing invariant (`$argument0` belongs to `$argument1.realm`) itself. No
runtime field holds it.

**`AOT→JIT member` (status 87/88).** `f`'s `internalCall` is the AOT `invoke` closure that
`createSourceFunction` builds (`objects/functions.ts:151-186`). That closure calls the
JIT-created implementation through a `call-indirect` whose witness is the AOT class. So a
returned 42 proves the guard accepted a JIT member-only descriptor after a moving collection. A
mismatch would be `brk #3`, which the recorder reports as a crash and not as a status.

## 6. Exit-status protocol and failure taxonomy

**Reserved by `nativeExitOutcome`, never used for bespoke checks:** 10, 11, 12, 13 (EV plan),
20–28, 30–38, 40, 42 (pass), 50–59. Codes 60–99 map to
`{kind:"crash", detail:"unexpected native exit status N"}`, so the raw code can be recovered. The
report keeps `kind:"bespoke-native-regression", conformance:false`.

| Code | Stage           | Meaning                                                                                  |
| ---- | --------------- | ---------------------------------------------------------------------------------------- |
| 60   | surface         | `bindScript`/read failed, `frame !== "ScriptEntryFrame"` or runtimes·2 ≠ entries         |
| 61   | storage         | `storage.domain !== read.domain`, or the constructor threw                               |
| 62   | parse           | Embedded runtime module or Script failed `parseModule`/`parseScript`                     |
| 63   | lower           | `lowerScript` failed                                                                     |
| 64   | compile/profile | `prepareManagedSurfaceEntry` stage `profile`, including E4a's `function flow crosses`    |
| 65   | compile/prepare | stage `prepare`                                                                          |
| 66   | compile/lower   | stage `lower`                                                                            |
| 67   | compile/emit    | stage `emit`                                                                             |
| 68   | compile/select  | stage `select`                                                                           |
| 69   | compile/shape   | Unresolved imports, the wrong linkage, or no member-only/record/function binding         |
| 70   | budget          | `code.length` > 262,144                                                                  |
| 71   | negative        | A frame-less read was accepted, or rejected at the wrong stage or with the wrong message |
| 72   | negative        | A foreign-domain link was accepted, or read a word                                       |
| 73   | negative        | An unknown contract was linked, or read a word                                           |
| 74   | link            | The legitimate link failed                                                               |
| 75   | publish         | `publish` returned `undefined`, a misaligned address, or a count ≠ 1                     |
| 76   | run/normal      | The first completion is not `{none,42}`                                                  |
| 77   | run/view        | `completion(raw)` is `undefined`, after any invoke                                       |
| 78   | run/context     | `activeContext` is not `undefined` after an invoke or call                               |
| 79   | run/roots       | `currentRootHead()` changed across an invoke or call                                     |
| 80   | run/identity    | `nativeActive` saw the wrong record or realm, or was never called                        |
| 81   | run/effects     | A `nativeCount` mismatch at any step                                                     |
| 82   | run/GDI         | The re-evaluation is not a `throw` with A's SyntaxError                                  |
| 83   | run/GDI effects | A's `f` binding or `v` changed                                                           |
| 84   | run/table       | A wrong `$imports` did not throw exactly `"MANAGED_SURFACE_TABLE"`                       |
| 85   | run/records     | The records are not distinct, or a record's realm is wrong                               |
| 86   | run/second      | Global B after churn is not `{none,42}`                                                  |
| 87   | run/callback    | `callObjectValue(fA)` after churn is not `{none,42}`                                     |
| 88   | run/callback    | The call into `fA` did not see `r1`                                                      |
| 89   | publish         | The final publish count ≠ 1                                                              |
| 90   | census/safety   | Two classes with **different** ABIs share a signature pointer (guard unsound)            |
| 91   | census/select   | A selected signature address differs from the read binding for its contract              |
| 92   | case 2          | The image directory digest ≠ Node's                                                      |
| 93   | case 2          | Counts, `code.length`, FNV-1a or `entryOffset` ≠ Node's                                  |
| 94   | case 3          | Census: some equal-ABI classes have distinct pointers (informational)                    |
| 95   | precompiled     | The embedded module is malformed, or its digest ≠ the image directory's                  |
| 99   | any             | An unexpected AOT throw escaped `run()`                                                  |

A `brk`, `SIGSEGV` or stack overflow is a `crash`, and the containment limit is `timeout`. Neither
needs a status.

## 7. Diagnostic cases (separate reports, never acceptance)

| Case                  | Stops after                        | Report                                                 | Purpose                                                                                  |
| --------------------- | ---------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| none                  | the whole of §5.4                  | `native-managed-script-v1.json`                        | **Acceptance**                                                                           |
| `1`                   | read, runtime parse, Script lower  | `native-managed-script-baseline-v1.json`               | Elapsed-time baseline                                                                    |
| `2`                   | prepare, negatives, link, `EXPECT` | `native-managed-script-compile-v1.json`                | Compile time = elapsed(2) − elapsed(1); proves the image compiles the same bytes as Node |
| `3`                   | the census (§9)                    | `native-managed-script-census-v1.json`                 | Equal-ABI pointer sharing                                                                |
| build `--precompiled` | §5.4 with prepare replaced         | `native-managed-script-precompiled-diagnostic-v1.json` | Split a 64–69, crash or timeout                                                          |

**`--precompiled`.** Node embeds `EXPECT` plus `native.code` (as bytes), `managedImports`,
`linkage`, `functions[entry]` and `entryOffset`. The image rebuilds the `NativeModule` and checks
the embedded digest against `read.directory.digest` (95). It then runs §5.4 from status 72 on.
Selection fails closed on any drift. Run it **only** when the acceptance run ends with a code in
62–69, a crash before 74, or a timeout. It is the same link, publish and call pipeline. It is
never an interpreter, and it never stands in for in-image compilation.

## 8. Measurements and budgets

- **Elapsed.** `recordNativeFixture` already records `elapsedMs`, and paired cases 1 and 2 bound
  the in-image compile time with no clock binding. `monotonic-time` (`intrinsics/clock.ts`) exists
  if a finer split is needed later. It is not needed for E4.
- **Bytes.** Status 70 checks the bytes in the image. Case 2 asserts equality with Node's
  115,864 B and FNV `26ff2369`. Re-capture both on the landing snapshot; never pin these numbers
  by hand.
- **Allocation.** No counting primitive exists. Node allocates about 100 MB per compile, against
  a copying 32 MiB semispace, so in-image compilation will run through several collections. That
  makes the in-compiler rooting part of what E4 tests. The peak live set is unknown. Retained V8
  heap is 2.8 MB, which is not a native figure. If 64–67 crash, run one sensitivity build with
  `managedBytes` 128 MiB as a recorded diagnostic. Do not add a counter.
- **E4 budgets (initial).**
  - Heap: 64 MiB copying and allocation capacity 1 Mi, both equal to Test262.
  - Stack: 16 MiB, as for every in-image JIT fixture so far.
  - Roots: 16,384.
  - Code arena: 1 MiB (one publish of about 116 KB).
  - Code cap: `MAX_SCRIPT_CODE` 256 KiB.
  - Containment: 300,000 ms. No native prepare with runtime modules has been recorded yet; the
    typed native prepare took 5.1 s in all.
- **Test262 follow-up (after E4 passes).**
  - `maxDynamicCodeBytes` (64 KiB, dynamic `Function`) cannot hold 27–172 KB entries. Keep it,
    and add a separate `maxScriptCodeBytes: 262144` (EV D3).
  - Raise `executableMemoryBytes` from 1 MiB to 4 MiB: eight `evalScript` compiles of 100–170 KB
    do not fit in 1 MiB.
  - Test262 runs with a **1 MiB stack**. Add a case **E4b**: the same fixture built with
    `stackBytes: 1048576`. If it overflows, EV must either raise the uniform Test262 stack
    (recorded) or block. Never tailor per test.

## 9. Equal-ABI descriptor pointer census

- **Inputs.** `read.signatures[k].address` (from `native-value-function-signature` of the
  directory witness) and `directory.signatures[k].{parameters,returnType}` for all 159 classes.
  The census reads no other words.
- **Acceptance invariant (90).** For all k ≠ j, `abi(k) ≠ abi(j)` ⇒ `address(k) ≠ address(j)`.
  This is what keeps `brk #3` a sound fail-stop for cross-class flows (§4).
- **Informational (case 3).** Check H1, ABI-keyed descriptors: equal ABI ⇔ equal address.
  Exit 42 means H1 holds. Exit 94 means some equal-ABI classes have distinct addresses. The report
  records which case was observed. Node predicts at most 109 distinct pointers under H1, and the
  4 JIT-imported equal-ABI pairs would then share pointers.
- **Not authority.** No binder, selection or gate reads the census. JIT bindings stay
  per-contract (25 imports, 25 contracts) whatever it shows. Pointer equality never merges
  classes and never admits a callback.

## 10. Recording (serial queue; wait for the frozen self-build)

`build-managed-jit-entry-selfbuild-v1.mjs` (stage1/stage2 `managed-jit-entry-v1`, report
`bootstrap-managed-jit-entry-v1.json`) must finish and be recorded first. Leave the self-build,
survey PID 28307, pause markers and queues untouched.

1. `TINT_BUILD_ONLY=1 node tools/verify-hosted-managed-script.ts >
.tint-bootstrap/managed-script-native-build-v1.log`. The last line is the binary, and
   `<binary>.manifest.json` holds the snapshot. Build `--precompiled` only when §7 requires it.
2. Write a runner modeled on the existing `run-managed-*-v*.mjs`. Take the live pause name and PID
   at run time, create the pause with `wx`, wait for `.ack`, then call `recordNativeFixture` with:
   - report `docs/results/native-managed-script-v1.json` and `timeoutMs: 300000`;
   - `relatedReports`: `native-managed-jit-entry-v1.json`, `native-managed-jit-signatures-v2.json`,
     `native-runtime-link-exact-keys-v1.json` and `native-script-frame-directory-v1.json`.

   Then run cases 1, 2 and 3 into their own reports. Release the pause in `finally`.

3. Accept only `outcome.kind === "completed"` (exit 42) after a confirmed stop at entry. Record
   failures as they are, never retry, and decode 60–99 with §6.

## 11. Risks and honest limits

1. **No native evidence yet.** Nothing here shows that the image can compile 22 runtime modules
   plus a Script inside 64 MiB and 16 MiB of stack. The frozen v3 self-build once stopped during
   emission because of allocation.
2. **Directory equality (case 2, `--precompiled`)** assumes that the build's surface reification
   equals `createManagedScriptFixture`'s. If 92 fails, only acceptance is meaningful.
3. **"Before any import read" (status 84)** is shown by what can be observed: no context push, no
   count change, roots restored. The guard's position is pinned by E1 tests. The JIT's table
   loads are not instrumented.
4. **The AOT-origin variance gate is pair-based and conservative.** Flows through `unknown` are
   outside it (§4). The `brk` guard remains the backstop, and invariant 90 must hold.
5. **Classless AOT values.** The gate allows classless↔classless pairs (19 per Script, in runtime
   bodies). No AOT value with a classless static type is observed reaching the JIT. Nothing proves
   that this cannot happen.
6. **95 eager table loads per entry call** (parent §9.5) are still unmeasured. E4's three invokes
   do not stress them.
7. **Counts drift.** The 25/3/15/12 counts and 115,864 B come from this snapshot. Resolve the
   expected values from Node at generation time.

## 12. Next

**First implementation slice (E4a, Node only, red first).** Add the whole-graph function-flow
gate (§4) to `managed-jit-signatures.ts`, with the typed tests and the unchanged
`managed-jit-entry.test.ts` Script assertions. Then run `pnpm build`, the focused tests and
`pnpm check`. Compiler sources change, so this needs a new frozen self-build before the next
native campaign.

**Second slice (E4).** Add `tools/script-runtime-request.ts` (shared selection, a byte-neutral
refactor of the directory fixture), then `tools/verify-hosted-managed-script.ts` per §5–§7 with
Node-side generation tests for `EXPECT` and the embedded modules. Build and record per §10.

**Next useful planning task.** After E4 records, re-plan **S2-ev1 EV1–EV4** against E4's measured
compile elapsed time, bytes and stack outcome (E4b). Use them to fix D3 (`maxScriptCodeBytes`,
arena) and the stack decision, and to confirm that `compileScriptEntry` can reuse E4's run
sequence unchanged.
