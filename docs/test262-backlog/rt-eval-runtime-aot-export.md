# RT-EVAL D6d3: AOT runtime-entry export wiring

Status: **research only; ready to implement once directory v3 data and the reader
land.** Parent: [directory v3 runtime providers](rt-eval-runtime-directory-v3.md),
slice D6d3. This refines the parent's §4.3 and §4.4 against current source. It does
not reopen the provider census, key canonicalization, the sparse-only policy or the
v3 encoding. The S2 Script frame is already planned in
[rt-eval-script-frame.md](rt-eval-script-frame.md) and is out of scope here.

Captured 2026-11-04. The probes ran on Node against public `dist`, which was checked
for freshness. Compiler `dist` files are newer than their sources. Six `ts-native`
files and one `foundation` file have a newer source mtime, but transpiling each one
and comparing it, ignoring whitespace and comments, gives output identical to
`dist`. The probes live in `/tmp/tint-runtime-aot-export-plan`:

- `patch.mjs` writes `/tmp` copies of `compiler/dist/native/index.js` and
  `managed-aot.js` with the wiring proposed below.
- `p1-small.mts` runs a small application in five variants.
- `p2-script.mts` runs the real 100-helper, 18-type Script surface.

Each run stops just **before `emitModule`**, after lowering, host binding,
pruning, optimization and `verify`. No image is emitted, no native code runs, and
nothing is written in the workspace. Results are in `p1-results.txt` and
`p2-results.txt`. **Every number below comes from Node only. None of them shows
native correctness, image size, link behaviour or conformance.**

## 1. Answer in brief

1. **The proposed wiring lowers and verifies the whole Script surface.** It covers
   anchors before the check, per-pass name resolution, generated stubs, explicit
   retention, final checked-ID bindings, ABI agreement and host exclusion. Measured
   (`p2`):
   - 2 transform passes; 276 of 323 targets are renamed between pass 0 and the
     final pass.
   - 366 stubs (323 entry, 43 signature), 355 slots and 366 address bindings.
   - 0 ABI skew against the layout facts. All 323 targets are top-level and
     environment-free.
   - `verify` ok. 366 `function-address` ops each name the exact intended target
     (the target's source name plus its final checked ID), both open (6898
     functions) and closed or pruned (4232 functions).
   - 0 `function-new` ops on any target, and 0 stubs from earlier passes in the
     final graph.
2. **Namespaced aliases break the anchors as written.** `createManagedRuntimeAnchors`
   uses `anchor.alias` both as the census identity and as the parameter type. In the
   AOT application only `<prefix>_<alias>` exists. Fix: an optional `typeName`
   mapping (§3.1). The identity stays canonical, because
   `resolveManagedCollectionNames` compares `anchor.alias` with the census
   (`managed-runtimes.ts`, the "anchor identity differs" check).
3. **Zero-span origin is arbitrary, so it must not decide ownership.**
   `locateSource({0,0})` returns whichever linked module occupies offset 0:
   - `app` in the small fixture;
   - `foundation/collections/number-list.ts` (a retained runtime module) as soon as
     the application imports it (`p1 import`);
   - `js-runtime/objects/regexp-data.ts` for the Script surface.

   In the import case, every generated anchor, stub, identity, witness and table is
   classified as runtime code. Current code survives only because it skips the
   table and witnesses by name (`index.ts:351-360`). All 3,186 zero-span top-level
   statements in the Script run are surface-generated: 2,499 aliases, 178 identities,
   64 witnesses, 1 table, 78 anchors and 366 stubs. **Rule:** the transform keeps one
   explicit set of generated names. Names in it are retained or excluded by name and
   are never classified by origin (§3.4).

4. **Retention by name fails closed, and the tests must detect that.** With the
   anchors left out of `retained` (`p1 map`, app at offset 0), the run fails with
   `runtime binding subject is not a top-level function: $tint$surface0_runtime_collection_0`.
   With the stubs left out, it fails with
   `runtime entry stub is missing: __tint_specialized_8`. Under the import layout the
   same omission would be hidden by the origin rule, so the red test must use an
   application-first fixture.
5. **Retries happen for real, and the context is queried on every pass.** The bind
   body itself adds demands (the parent's D6a observation). `p1 map` takes 2 passes
   and renames 37 of 60 targets. Every pass re-asks all anchors, and the
   consult-on-retry guard stays silent. The final graph holds exactly the last
   pass's stubs.
6. **The bind export type must declare `entries`.** Without
   `readonly entries: Float64Array` in the declared result, the check fails with
   `unknown object property` (`p1-noentries`). D6d3 therefore follows the v3 type
   change to `ManagedSurfaceExport` and the hosted fixture's interface, and must
   not land before it.
7. **No new linker, host operation or boxing.** Signature stubs are shared per ABI
   only to form a word-check window (D6c). Authority still comes from the checked
   declaration identity of each slot's target. The census recheck costs 3 ms on the
   Script surface.

## 2. Probe matrix (Node only)

| Run                    | Passes | Targets / stubs / slots / sig. | Renamed | verify | Address ops wrong | Notes                                   |
| ---------------------- | ------ | ------------------------------ | ------- | ------ | ----------------- | --------------------------------------- |
| p1 base                | 1      | 39 / 66 / 39 / 27              | 0       | ok     | 0 / 66            | 2 keys + primitive + number-text        |
| p1 map (forced retry)  | 2      | 60 / 91 / 60 / 31              | 37      | ok     | 0 / 91            | adds `ReadonlyMap`, `ReadonlySet`       |
| p1 map, closed         | 2      | same                           | 37      | ok     | 0 / 91            | prune 542 → 291 functions               |
| p1 base + injected     | 2      | 39 / 66 / 39 / 27              | 16      | ok     | 0 / 66            | transform-only `readonly boolean[]`     |
| p1 import              | 1      | 39 / 66 / 39 / 27              | 0       | ok     | 0 / 66            | offset 0 = `number-list.ts`; see §1.3   |
| p1 map, anchors unret. | —      | —                              | —       | —      | —                 | `subject is not a top-level function`   |
| p1 map, stubs unret.   | —      | —                              | —       | —      | —                 | `runtime entry stub is missing`         |
| p1 without `entries`   | —      | —                              | —       | —      | —                 | `unknown object property`               |
| p2 Script, open        | 2      | 323 / 366 / 355 / 43           | 276     | ok     | 0 / 366           | 41 providers; census = layout keys      |
| p2 Script, closed      | 2      | same                           | 276     | ok     | 0 / 366           | 6898 → 4232 functions; 20 s / 32 s Node |

The p1 runs drop the `node-fs` and `node-process` runtimes, as the existing compile
test does. Neither has any host binding here, so the host-overlap count of 0 is
**vacuous**. A unit test must prove exclusion (§5).

## 3. Contracts

### 3.1 `managed-runtimes.ts`

```ts
export function createManagedRuntimeAnchors(
  census: ManagedSurfaceRuntimeCensus,
  prefix: string,
  typeName: (alias: string) => string = (alias) => alias,
): Result<ManagedRuntimeAnchorPlan>;
// anchors[k].alias stays canonical; the parameter type is typeName(alias).

export interface ManagedRuntimeEntrySlots {
  readonly stubs: RuntimeEntryPlan; // from createRuntimeEntryStubs
  readonly slots: readonly RuntimeEntryStub[]; // slot s → {target, entry, signature}
}
/** Per pass. ABIs come from the directory providers, never from lowered IR. */
export function prepareManagedRuntimeEntries(
  names: ManagedRuntimeNamePlan,
  providers: readonly ManagedRuntimeProvider[],
  prefix: string,
): Result<ManagedRuntimeEntrySlots>;
```

`prepareManagedRuntimeEntries`:

- Requires `providers.length === names.providers.length`. Provider `p` must equal
  `names.providers[p].key` in kind, element, value and operation names, otherwise
  `surface runtime: provider differs from directory: <kind><element,value>`.
- Assigns each distinct target the ABI of its first slot. A later slot with a
  different ABI fails with `surface runtime: target ABI differs across slots: <name>`.
  This can only happen if the AOT groups two keys that the layout gave different
  encodings. It never happened in p2, but keep it as a guard.
- Calls `createRuntimeEntryStubs(names.targets, prefix, abis)`, which already
  deduplicates signature stubs by ABI. It then maps slots through the target
  lookup.

The prefix is `<surface prefix>_runtime`. That gives
`<p>_runtime_collection_k` for anchors, `<p>_runtime_entry_t` and
`<p>_runtime_signature_g`. They cannot collide, because `prepareManagedSurfaceExports`
already reserves a `$tint$surfaceN` prefix that no occupied name starts with.

### 3.2 `managed-aot.ts`

`ManagedSurfaceAOTPlan` gains:

```ts
readonly runtimeCensus: ManagedSurfaceRuntimeCensus; // canonical aliases
readonly runtimeAnchors: ManagedRuntimeAnchorPlan;   // names <prefix>_runtime_collection_k
readonly runtimes: readonly ManagedRuntimeProvider[]; // = directory.runtimes (v3)
```

In `prepareManagedSurfaceExports`, after `createManagedSurfaceDirectory`
(currently `:252-265`):

1. Check `{start:0,end:0,imports:[],statements:canonical.value.declarations}` with
   `checkClosureModule`, then call `planManagedSurfaceRuntimes({surface: canonical.value, checked})`.
   This is the same pure function the v3 directory rebuild and the reader use.
2. The census collection keys must equal the leading `directory.runtimes` entries
   in order, otherwise `surface runtime: census differs from directory`. That
   catches drift between this path and the layout program, which builds its census
   from `witnesses.value.checked`. p2: equal.
3. Call `createManagedRuntimeAnchors(census, prefix + "_runtime", (a) => prefix + "_" + a)`.
   Factor the `prefix + "_" + alias` spelling out of `namespaceSurface` into one
   private helper so the two cannot diverge.
4. Append the anchor declarations to `statements` next to the identities and
   witnesses (`:326`). They are therefore bound, specialized and checked before
   `prepareCollectionRuntimes`. Collection anchors are never removed.

`materializeManagedSurfaceExports(module, plans, context: RuntimeBindingContext)`
extends its result:

```ts
readonly value: {
  readonly module: Module;
  readonly functions: readonly (readonly string[])[];
  readonly runtimes: readonly ManagedRuntimeEntrySlots[]; // per plan, this pass
  readonly generated: { readonly retain: readonly string[]; readonly exclude: readonly string[] };
};
```

Per plan, in order:

1. Resolve the D4 anchors (unchanged).
2. Call `resolveManagedRuntimeNames(context, plan.runtimeCensus, plan.runtimeAnchors)`.
3. Call `prepareManagedRuntimeEntries(names, plan.runtimes, plan.prefix + "_runtime")`.
4. Materialize the table (unchanged).
5. Call `materializeManagedSurfaceExport(..., slots)`.
6. Append the stub declarations.

`retain` lists the records, the anchors and every stub. `exclude` lists the table
and the witnesses. Steps 2 and 3 run on **every** call, so a pass never reuses
names from an earlier pass.

### 3.3 `managed-export-body.ts`

`materializeManagedSurfaceExport` gains a final parameter,
`entries: readonly { readonly entry: string; readonly signature: string }[]`, in
slot order. The changes:

- Validate that each name is an existing top-level function, as is already done
  for identities.
- Reserve `local("_entries")`.
- Emit `const <e> = new Float64Array(2·n)`, then for each slot
  `<e>[2s] = <entry>(); <e>[2s+1] = <signature>();`.
- Return `entries: <e>` as the last object field. The field is always present,
  including when `n = 0`.
- Have `directoryLiteral` emit v3 `runtimes`: per provider `kind`, `element`,
  `value` and `operations[{operation, parameters, returnType}]`.

No `unknown[]`, `function-new` or new array literal of function values is added.
D4's `functions` stays for the table helpers and witnesses.

### 3.4 `compiler/src/native/index.ts`

All edits sit between `prepareManagedSurfaceExports` and `emitModule`.

1. **Transform (`:331-416`).**
   - Reset a per-pass `surfaceRuntimes` array, then assign it from
     `materialized.value.runtimes`, mirroring `surfaceFunctions`.
   - Build `generated = new Set([...retain, ...exclude])` over all plans.
   - In the origin loop, skip every statement whose name is in `generated` before
     calling `locateSource`. Push `retain` to `retained` explicitly.
   - This replaces the current table/witness `continue` (`:351-360`) and the
     separate records loop (`:343-349`).
   - Non-generated declarations still use the origin rule, so the 323 targets and
     their dependencies stay top-level, as the parent's §1.4 requires.
2. **Bindings (after `:418`).** For each plan, call
   `resolveRuntimeEntryBindings(nativeChecked, surfaceRuntimes[i].stubs)` (already
   top-level only), concatenate the results, and pass them as
   `functionAddressBindings` in the `lowerModuleEntries` options (`:532`). The
   existing validator rejects:
   - imported, record-bound or stub targets;
   - async, generator or generic stubs and targets;
   - receivers;
   - targets missing from `entries`.
3. **ABI agreement (in the `:562-631` block).**
   - Build `actual.runtimes` with the existing
     `materializeManagedRuntimeProviders(names, lookup)` over this plan's final-pass names. The
     lookup resolves the name through a **top-level-only** checked map, then reads
     `lowered.entries.indexOf(id)` for the lowered `FunctionIR` parameters and
     result. Do not use `surfaceSources`: its `rewriteModule` scan also maps nested
     declarations, although p2 found 0 collisions.
   - Pass `runtimes` to the v3 `verifyManagedSurfacePhysicalAgreement`, whose
     errors are fixed by the parent's §4.1.
4. **Host exclusion (before `bindHostOperations`, `:692`).** Compute
   `excluded = new Set([...hostBindings, ...weakBindings].map(b => entries[b.function]))`,
   that is, checked source IDs. Any address binding whose `target` is in `excluded`
   fails with `surface: runtime entry targets a host operation`. Identity is the
   only input; ABI or address equality is never consulted.
5. **Summary.** Add `runtimeSlots`, `runtimeTargets` and `runtimeSignatures` to
   `CompiledProgram.managedSurfaces[i]`. This is public count data only, with no
   names or IDs.
6. **No change** to `prune`, `optimizeModule` or emission. Pruning remaps
   `function-address` through `remapReferencedFunction`. p2 closed shows correct
   identity after the remap, and no function-merging pass exists. The dense skip
   from the parent's §4.6 is independent and may land in the same slice.

## 4. Hazards resolved

| Hazard                                      | Resolution                                                                                                                                   | Evidence                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Canonical keys vs namespaced anchor types   | `typeName` mapping; identity stays canonical; census = directory check                                                                       | p1/p2 `keyEqual`, 0 identity errors        |
| Context requery on every pass               | names and stubs rebuilt per transform call; consult-on-retry guard unchanged                                                                 | p1 map 2 passes / 37 renamed; p2 276       |
| Zero-span generated declarations            | explicit `generated` set decides retention, never `locateSource`                                                                             | offset 0 = app / number-list / regexp-data |
| ABI-group signature getter dedup            | `createRuntimeEntryStubs` groups by directory ABI; `resolveRuntimeEntryBindings` binds each signature stub once; agreement covers every slot | 43 signature stubs, 366 bindings, 0 skew   |
| Final target identity after retention/prune | bindings use final checked IDs from the last pass; prune remaps                                                                              | 366/366 exact targets, open and closed     |
| Host/weak targets                           | source-identity exclusion before host binding                                                                                                | logic only; p1/p2 overlap vacuous          |
| Function-value boxing                       | entry words only; no `function-new`, no `unknown[]`                                                                                          | 0 boxed targets                            |
| Stale names after retry                     | final graph holds only last-pass stubs; bind body built in the same call                                                                     | `notFromLastPass` 0                        |

## 5. Red-first edit sequence (main)

Each step adds its failing test first. Steps 1–3 are pure. Step 4 needs v3
`ManagedSurfaceExport.entries` and `SerializedManagedSurfaceDirectory.runtimes`.

1. **`managed-runtimes.test.ts`**, anchor type mapping. Red:
   `createManagedRuntimeAnchors(census, "$p_runtime", a => "$p_" + a)` yields
   parameter types `$p_$T…` while `anchors[k].alias` stays `$T…`, and
   `resolveManagedCollectionNames` accepts the plan.
2. **`managed-runtimes.test.ts`**, `prepareManagedRuntimeEntries`. Red cases:
   - slot order across providers;
   - one entry stub per distinct target;
   - signature stubs equal to the number of distinct directory ABIs;
   - a repeated target across two keys reuses one entry stub;
   - a provider key mismatch fails;
   - a target with two ABIs fails;
   - a prefix that is not generated fails.
3. **`managed-export-body.test.ts`**. Red cases:
   - stores `2s`/`2s+1` in order, with `entries` last;
   - `n = 0` still emits the field;
   - a missing stub name fails with `surface export function is missing`;
   - a `<prefix>_entries` collision picks `$`;
   - exactly one `readonly unknown[]` variable before and after;
   - the v3 `runtimes` literal round-trips through `checkClosureModule` against
     the declared type;
   - a declared type without `entries` fails with `unknown object property`.
4. **`managed-aot` via `compileArm64Program`** (new `managed-runtime-export.test.ts`,
   fast). Use the p1 `map` fixture: app first, `ReadonlyMap`/`ReadonlySet`, natural
   retry. Request `exports: ["bind","main"]`; build open and also closed with
   `start: "main"`. Red until step 5 lands. `CompiledProgram` exposes no IR, so
   the compile test checks only the public results:
   - `ok`;
   - `managedSurfaces[0]` gains `runtimeSlots`, `runtimeTargets` and
     `runtimeSignatures`, with values 60, 60 and 31 for this fixture as probed;
   - the `symbols` list contains every `_runtime_entry_` and `_runtime_signature_`
     stub.

   The IR assertions go in the managed-aot retry test below. That test lowers the
   final graph with the bindings and checks four things:
   - the number of `function-address` ops equals the number of stubs;
   - each op's target `FunctionIR.name` is `<source name>$<final id>` for that
     slot;
   - no `function-new` targets a runtime target;
   - `verify` passes.

   Negative cases:
   - delete the anchor retention, giving `subject is not a top-level function`;
   - delete the stub retention, giving `runtime entry stub is missing`;
   - a host binding on a runtime target, giving
     `runtime entry targets a host operation`. Test this through the extracted pure
     helper `excludeRuntimeEntryHosts(bindings, excluded)` in
     `managed-runtime-entries.ts`, because no real host operation has a collection
     ABI;
   - corrupt `plan.runtimes[0].operations[0].returnType` in a unit call, giving
     `AOT runtime ABI skew`;
   - the import-first fixture gives the same result as app-first, which proves
     that origin does not decide generated names.

5. **`index.ts` wiring** (§3.4) turns step 4 green. Builds without a surface must
   stay byte-identical: the existing `managed-export-body` compile test already
   compares requests with no surface and with an empty surface list. Keep it.
6. **Slow Script test** (`tools/script-runtime-surface.test.ts` or a sibling
   file): the p2 request through `compileArm64Program`. Assert 41 providers, 355
   slots, 323 targets and 43 signatures in the public summary, open and closed.
   It also lowers the Script graph once through the managed-aot path and checks
   366 bindings, 0 skew, `verify` and 366 exact targets. About 20 to 35 s on Node.
7. **Catalog/format** if a test file or helper module is added (AGENTS). No new
   source module is needed: the helpers go into the existing
   `managed-runtimes.ts` and `managed-runtime-entries.ts`.

**Retry evidence without a production hook.** `compileArm64Program` does not
expose pass counts, and none should be added. Prove the retry in a
`managed-aot.test.ts` case instead:

1. Call `prepareManagedSurfaceExports` on the p1 `map` application.
2. Run `prepareCollectionRuntimes` with a counting transform that calls
   `materializeManagedSurfaceExports(module, plans, context)`. This is the same
   pattern `tools/script-runtime-surface.test.ts` uses.
3. Assert at least 2 calls and that the first and last target lists differ.
4. Run `resolveRuntimeEntryBindings` on the final graph and assert that it binds
   only last-call stubs.

## 6. Defaults main can choose without user input

- Entry stub per distinct target; signature stub per distinct directory ABI.
- Prefix `<surface>_runtime`. The census is recomputed on the canonical surface,
  in 3 ms.
- The `entries` field is always emitted and always last, and the `runtimes`
  literal follows `records` in the directory, as in the v3 encoding.
- The generated-name set replaces the table/witness `continue`.
- The ABI lookup uses a top-level-only map. Optionally replace `surfaceSources` by
  it as a behaviour-preserving cleanup in the touched block.
- Host exclusion goes through a pure helper over checked IDs.

Nothing here needs a user decision. The only ordering constraint is §1.6: v3 type
and reader first, then D6d3.

## 7. Failure cases (expected text)

| Case                                         | Stage     | Error                                                       |
| -------------------------------------------- | --------- | ----------------------------------------------------------- |
| Census ≠ directory keys                      | prepare   | `surface runtime: census differs from directory`            |
| Anchor retyped or deleted                    | transform | D6a `disappeared` / `names changed after transform`         |
| Anchor not retained                          | transform | `runtime binding subject is not a top-level function: …`    |
| One key, two instances                       | transform | `surface runtime: runtime key resolves to two instances: …` |
| Directory provider order/vocabulary mismatch | transform | `surface runtime: provider differs from directory: …`       |
| One target, two directory ABIs               | transform | `surface runtime: target ABI differs across slots: …`       |
| Export type lacks `entries`                  | check     | `unknown object property`                                   |
| Stub not retained                            | bindings  | `runtime entry stub is missing: …`                          |
| Target missing in final graph                | bindings  | `runtime entry target is missing: …`                        |
| Target imported/record-bound/async/receiver  | lowering  | existing `function address binding …` errors                |
| Lowered ABI ≠ directory                      | agreement | `AOT runtime ABI skew: <key>.<op>` (v3 agreement)           |
| Target host- or weak-bound                   | pre-host  | `surface: runtime entry targets a host operation`           |

## 8. Native acceptance fixtures for main

None of these has been run, and none may be claimed before main's serial queue
runs it under LLDB with stop-at-entry and final-exit assertions. Queue them after
the current frozen self-build and the B8 callback/GC run, without touching either.

1. **`native-runtime-aot-export-v1`**. Hosted, `TINT_BUILD_ONLY=1`, with the p1
   `map` application plus a `main` that calls `bind()` and checks the words in
   place. Exit 0 only if:
   - `entries.length === 2·slots`;
   - every even word is a safe integer `> 0` with `% 4 === 0`, and every odd word
     has `% 8 === 0`;
   - slots that share a target have equal entry words, and distinct targets have
     distinct entry words;
   - slots with equal directory ABI have equal signature words.

   Each check failure has its own exit code. This shows emission only. Calling
   through a word is D6d4.

2. **`native-script-runtime-aot-export-v1`**. The p2 Script surface image, under
   the same assertions: 710 words, 323 distinct entry words and 43 distinct
   signature words. Record the image byte delta against the same build without
   runtime entries. That delta is the parent's §9.2 measurement and has no target
   value here.
3. **Self-build gate.** A frozen self-build with byte-identical stages. Images
   without surfaces must be byte-identical to the pre-change compiler.
4. **Hosted directory verifier.** Move `tools/verify-hosted-managed-surface-directory.ts`
   to version 3 and add `entries` to its interface only after the queued native run
   of the current fixture finishes (parent §5).

## 9. Proven versus assumed

**Proven by the Node probes:**

- the anchor type mismatch and its fix;
- context requery and stub rebuild across 2 real passes;
- explicit retention is necessary and sufficient for anchors and stubs;
- zero-span origin is arbitrary;
- 0 ABI skew between AOT lowering and the layout facts on the full surface;
- exact target identity after pruning and optimization;
- no boxing;
- the `entries` type requirement;
- `verify` passes on the lowered and optimized module.

**Assumed, pending main's work or native runs:**

- the v3 directory shapes, taken from the parent's §4.1;
- that emitted entry and signature words have the right values (the D6c native
  evidence covers the mechanism, not this surface);
- that the image size is acceptable;
- that host exclusion works on a real overlap (unit-level only);
- D6d4 link use.

The probe stored `entries` as a bind-body post-pass rather than inside
`materializeManagedSurfaceExport`, and it skipped the v3 `runtimes` literal.
Both are syntax placement only, but step 3 must still test them.

**Next useful focused planning task:** D6d4 link handoff. Plan how
`readManagedSurfaceDirectory` v3 runtime bindings feed
`selectManagedIdentityBindings` and the D6c4 patch path for one JIT-imported list
operation, including the window check before any patch and the
`profile: runtime ABI skew` path.
