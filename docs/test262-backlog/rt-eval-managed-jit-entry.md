# RT-EVAL D6f: managed-surface JIT entry preparation

Status: **D6f0 callback signatures and D6f1 registry normalization pass native validation.**
[Callback/GC execution](../results/native-member-signature-v2.json) and
[normalization](../results/native-managed-applications-v1.json) pass. The earlier
[callback preflight failure](../results/native-member-signature-v1-analysis.json)
is retained with its fix. Registry normalization covers exact counts 35/36/24
and idempotence. Runtime function enumeration, a binder-based proof for internal
direct-call declarations, and multiple approved import specifiers are implemented
and pass native fixtures for [enumeration](../results/native-runtime-function-ids-v1.json)
and [entry adaptation/source uses](../results/native-managed-closure-uses-v1.json). The checker now narrows `typeof` unions containing collections,
buffers and functions; regression tests cover both accepted and rejected uses.
General managed Script execution is not yet available.

Parent: [managed-entry lowering](rt-eval-managed-entry.md)
slice D6f, which this document replaces in detail. It depends on the
[directory v3 plan](rt-eval-runtime-directory-v3.md) (D6d, in progress on main) and
on the [runtime entry address contracts](rt-eval-runtime-entry-addresses.md) (D6c).
The S2 Script frame and global environment, general eval/`Function` scoping, ESM
and agents are out of scope.

Captured 2026-11-04 against live source identity `13690cda…` (537 files,
`workspaceSourceIdentity`), while main was landing D6d1. The compiler `dist`
(17:55) already exports `planManagedSurfaceRuntimes`. The probes are read-only Node
scripts in `/tmp/tint-managed-jit-entry-plan` (`q1`–`q8`). They import public `dist`
entry points, `tools/workspace-sources.ts` and the earlier `/tmp` harnesses
(`tint-managed-entry-plan`, `tint-runtime-binding-context-plan`). They emit no
binary or image, execute no native code and write nothing in the workspace.
**All results are Node-only. No native, ABI-equality, performance or conformance
claim follows from them.** Times are single Node runs.

## 1. Answer in brief

1. **ABI-only JIT lowering works on real Script output today.** The §3 Script of the
   parent is linked with the nine runtime sources and lowered with _only the
   adapter entry_ as the root and all 371 option functions as `importedFunctions`.
   Lowering then succeeds and `verify` passes. Prune → optimize → prune leaves
   **17 imports, 34 JIT bodies and 0 runtime bodies** (q2). Rooting lowering at
   "JIT-origin" top-level functions chosen by source span fails instead. Span
   classification puts 76 functions on the JIT side, mostly runtime dependency
   modules and zero-span specializations, and lowering stops with
   `named function values require managed hoisted initialization`.
2. **Registry normalization is exact and fail-closed.** Real `lowerScript` output
   writes 35, 36 and 24 type applications for three Scripts. Every one is on an
   imported registry name, and its argument list equals the registry's (q1). The
   restored surface (serialize → restore) is structurally identical to the
   canonical one (919 declarations).
3. **Exact provider selection is unambiguous on the census.** The 17 imports serve
   18 binding uses. Each selects exactly one v3 provider by exact alias set, with
   0 misses and 0 ABI skews against modeled directory ABIs (q6). Two uses have two
   candidates (`$T472`/`$T475`, structurally equal), and directory order resolves
   them. No import needs two slots.
4. **Callback membership survives imports.** `$T159:[21,22]`, `$T165:[19]` and
   `$T360:[20]`, with no function in two classes (q3). None of the three classes
   has a JIT `call-indirect` witness (q5), so returning them to AOT needs the
   **B8 member-only signature import, which codegen does not implement yet**
   (`index.ts:745-766` still fails with `no indirect-call witness`).
5. **Correction: the parent's only non-member closure is the Script itself.**
   Parent §3.7 called `@1:value:97` a copied runtime function. It is the JIT
   `execute`, which the adapter nests inside its wrapper, so it becomes a
   `function-new` target (q3, q4). Lowered Scripts also store `execute` as a value
   (`scriptOrModule: execute`, field type `$T120 = unknown`), and its ABI
   `(reference,reference)→reference` equals that of 4 surface classes (q8). Both
   the strict D6 rule and the original physical B7 rule therefore **reject every
   lowered Script**. Script identity is S2 work. D6f accepts typed entries and must
   allow nested declarations that are only called (§4.6).
6. **A mismatch at an AOT `call-indirect` is a process trap, not a guarded
   throw.** Codegen emits `brk #3` when signature descriptors differ
   (`codegen/.../index.ts:5390-5402`). Rejecting escaping non-members at compile
   time is a liveness requirement, not only a matter of clearer diagnostics.

## 2. Current capabilities and pending dependencies

| Capability                                                                  | State                                                                                                                                          |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `FunctionIR.import`, `ModuleEntryOptions.importedFunctions` (D6b)           | Implemented, Node-tested                                                                                                                       |
| Static `function-address` export, `function-entry` slot call (D6c1–D6c4)    | Implemented; [call](../results/native-function-entry-call-v1.json) and [throw](../results/native-function-entry-throw-v2.json) passed natively |
| `createRuntimeEntryStubs`/`resolveRuntimeEntryBindings` (D6c5)              | Implemented; [native fixture](../results/native-runtime-entry-stubs-v1.json) passes; directory wiring pending                                  |
| `ManagedIdentityShape.role: "function-entry"`, `resolveManagedPointers`     | Implemented (`managed-imports.ts`)                                                                                                             |
| `ManagedABIRequest.functions` (`ManagedFunctionEntryBinding`)               | Implemented in codegen                                                                                                                         |
| `planManagedSurfaceRuntimes` (keys only, 39 collection providers)           | Landed during capture (`managed-runtimes.ts`, red-first test present)                                                                          |
| v3 `runtimes` section, provider ABIs, `entries`, reader `runtimes` bindings | **Planned (D6d1/D6d2/D6e)**                                                                                                                    |
| Sparse-only surface images, AOT stubs/bind body (D6d3)                      | **Planned**                                                                                                                                    |
| B8 witness-less member signature imports                                    | Node gates pass; native callback/GC validation queued                                                                                          |
| `adaptManagedSurfaceEntry`                                                  | One specifier, JIT-private frame alias, nests every body function                                                                              |

Trust boundary (unchanged): the image's permanent executable storage is a
trusted-owner fact, and no image-load base exists before publication. The JIT
resolver checks structure, domain, contract and the signature window words. It
does not prove where code will be loaded.

## 3. Probe results (Node only)

| Probe | Question                                                    | Result                                                                                                                  |
| ----- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| q1    | Type applications in `lowerScript` output; restore equality | §3 Script: 1 type reference + 34 calls = 35; two other Scripts 36 and 24; non-registry 0; non-imported 0; restore equal |
| q1    | Import classification                                       | 3 specifiers, 113 bindings: 95 values, 18 types, 0 neither. Only 6 of the 18 types carry `typeOnly`                     |
| q2    | Entry-root lowering with all option functions imported      | 371 imports → lowered 405 functions (34 bodies) → final 51 functions: 17 imports, 0 runtime bodies; verify ok           |
| q2    | Cost                                                        | JIT `prepareCollectionRuntimes` 416 ms, lowering 34 ms (Node)                                                           |
| q3    | Membership under imports                                    | 159 classes; 3 requested; groups as §1.4; one non-member target (`execute`)                                             |
| q4    | How `execute` is used                                       | `function-new` with an environment, stored to an environment slot and called by `call-indirect`; also a value           |
| q5    | Witnesses                                                   | 28 distinct `call-indirect` witnesses (27 map to surface aliases); 0 for `$T159`/`$T165`/`$T360`                        |
| q6    | Provider selection and ABI agreement                        | 39 providers (32 list, 6 map, 1 set) from 78 anchors; 18 uses → 18 selected, 0 missing, 2 multi-candidate, 0 skew       |
| q8    | Directory signature ABIs                                    | `deriveManagedSurfacePhysicalFacts` ok (1.2 s); 159 classes, 109 distinct ABIs; 4 equal `execute`'s ABI                 |

Final imports after pruning (q2, q6). Slots refer to the v3 provider order.

| Import ABI                                                                | Use (JIT binding element → provider)                                    |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| create/read/push/length on `list<unknown>`                                | `$T120` (provider 0)                                                    |
| create, push `(reference,optional-string)→number`                         | `list<string>` → `$T131` (provider 8)                                   |
| create `(number)→reference`                                               | `list<$T471>` 13; `<$T472>` 14 (two bindings, one import); `<$T474>` 16 |
| create, push `(reference,optional-reference)→number`                      | `list<$T473>` 15                                                        |
| primitive `fromNull`, `readNumber`, `readBoolean`, `readString`, `kindOf` | primitive provider                                                      |
| `(number)→string`                                                         | number-text `toString`                                                  |

The parent's frontier had 15 imports. The difference is `readNumber`/`readBoolean`
(the current lowering) and one shared create for two equal list bindings.

Assumptions: q6 models v3 provider ABIs by lowering a layout-style program (the
restored declarations plus one anchor per collection alias, through
`prepareCollectionRuntimes` with the D6a context). That is the planned D6d2
derivation, not the implemented one. JIT alias type IDs were found by linked-name
suffix (`…type:$Tn`). §4.2 replaces this with exported-name lookup.

## 4. Design: `prepareManagedSurfaceEntry`

New in `compiler/src/native/managed-entry.ts`, beside the adapter.
`prepareNativeFunctionEntry` keeps its closed-profile restrictions.

```ts
export interface ManagedSurfaceEntryRequest {
  readonly module: Module; // typed source, or lowerScript output once S2 lands
  readonly entry: string;
  readonly specifiers: ReadonlySet<string>; // all resolve to this one surface
  /** Registry: export name -> type argument export names ("unknown" keyword). */
  readonly instantiations: ReadonlyMap<string, readonly string[]>;
  readonly read: ManagedSurfaceDirectoryRead; // D5/D6e reader output
  readonly runtime: ManagedSurfaceLayoutRuntime; // the image's own runtime sources
}
export interface PreparedManagedSurfaceEntry {
  readonly module: ModuleIR;
  readonly entryId: number;
  readonly abi: ManagedABIRequest; // brand, signatures (B8), records, functions
  readonly runtimeSlots: readonly {
    readonly function: number;
    readonly slot: number;
  }[];
}
export function prepareManagedSurfaceEntry(
  request: ManagedSurfaceEntryRequest,
):
  | { readonly ok: true; readonly value: PreparedManagedSurfaceEntry }
  | {
      readonly ok: false;
      readonly error: {
        readonly stage: "profile" | "check" | "lower" | "emit";
        readonly message: string;
      };
    };
```

The registry stays an input. The compiler does not depend on `@tint/js-engine`,
and the engine passes `scriptRuntimeSurface()`.

### 4.1 Normalize registry type applications only

`normalizeManagedSurfaceApplications(module, specifiers, instantiations, surface)`:

- Every import must use an approved specifier, have named bindings, no namespace,
  no phase and no attributes. Classify each binding by membership: `entries` gives
  a value and `types` gives a type. The `typeOnly` flag is not the authority,
  since 12 of 18 type bindings lack it. Errors:
  `profile: managed surface export is missing: <name>` and
  `profile: managed surface binding kind differs: <name>` (a binding flagged
  `typeOnly` that names an entry).
- Erase a type application only if its head is an _imported_ binding and its
  arguments, mapped through the import map, equal the registry list exactly. The
  heads are `named` type nodes (`arguments`) and identifier-callee `call`s
  (`typeArguments`). Any other list on an imported name fails with
  `profile: instantiation not in surface <name>`. Applications on local names
  (generic helpers in typed entries) are untouched. Registry-free heads
  (non-generic entries given arguments) fail the same way.
- Erasure is checked by the closure checker against the exact canonical alias. A
  wrong registry entry therefore yields a check error, never a widened call.

### 4.2 Restore declarations from the directory read

The adapter consumes `read.contracts.surface`, the canonical description restored
from directory text. It never uses an AOT-side or recomputed surface. Declarations,
table, entries and types come from there, the signature classes from
`read.contracts.signatures`, and the record classes from `read.contracts.records`.
Runtime providers come from `read.directory.runtimes` (v3). Until v3 lands, tests
build providers with `planManagedSurfaceRuntimes(read.contracts)` and an explicit
ABI table.

`adaptManagedSurfaceEntry` changes (one function, not a second adapter):

1. Accept several specifiers (§4.1) and the normalized module.
2. Mark surface alias declarations `exported: true` inside the JIT source module,
   so `linked.exports` (`namespace: "type"`) maps each alias to its linked name.
   JIT alias type IDs are `checked.typeNames.get(linkedName)`. A missing alias fails
   with `profile: surface alias missing from JIT graph <alias>`, with no name-suffix
   matching.
3. Use `read.directory.frame` as the frame type instead of the private
   `$tint$managed$Frame`. Field names stay `$imports` and `$argument<i>`, and each
   entry parameter type must exactly match its frame field (contract index), or
   `profile: entry parameter differs from surface frame`. A directory without a
   frame fails with `profile: surface has no entry frame`.
4. Keep body functions nested, because they capture the import constants. Report
   their checked function IDs to §4.6.

### 4.3 Link runtime declarations; lower ABI-only

1. Link the adapted module with `request.runtime.modules`/`runtimes` exactly as
   `deriveManagedSurfacePhysicalFacts` does. Then run `prepareNativeGlobals` →
   `specializeModule` → `checkClosureModule` → `prepareCollectionRuntimes` without
   a transform. These are the image's runtime declarations. JIT code never contains
   their bodies or module state. This is enforced by step 3, not assumed.
2. Run `lowerModuleEntries` with the wrapper as the only root and the prepared
   options plus `importedFunctions: optionFunctionIds(options)`, `recordBindings`,
   `recordTypes` and `signatureTypes`. `optionFunctionIds` walks lists, sets and
   maps (including the nested `iterator` and the optional `sort`/`clone`),
   primitives and number-text, and deduplicates.
3. Prune → `optimizeModule` → prune. Then every non-import final function must map,
   through `entries` and both pruning maps, to the wrapper or one of its checked
   descendants. Otherwise fail with
   `profile: runtime body entered the JIT module: <name>`.

### 4.4 Select contract-authorized runtime entries

For each final import `i`:

- Collect every option use (`kind`, element/key/value, operation) whose function
  equals `i`'s source ID.
- For a collection use, S(e) is the set of canonical aliases whose JIT type
  exactly `matches` e (`createManagedTypeContractIndex`). A keyword element (`"string"`,
  `"number"`) uses the JIT graph's keyword type. The candidates are the providers
  of the same kind whose key aliases are all in S (key and value for a Map).
  Take the first in directory order.
- Primitive and number-text uses select their single provider. The operation is
  found by name in the provider's vector, with `sort` absent by census.
- `slot = offset(provider) + operationIndex`, and the contract is
  `tint.surface.v1/<name>/<digest>/runtime/<slot>`.
- All uses of one import must select the same slot, otherwise
  `profile: runtime import selects two surface slots`.
- The import's lowered ABI must equal the directory operation ABI, otherwise
  `profile: runtime ABI skew <kind><<element>>.<op>`.
- No candidate fails with `profile: <kind><<element>>.<op> is not provided by the surface`.

Equal ABI words, equal entry addresses and assignability never select or authorize
a provider. `abi.functions` gets one `ManagedFunctionEntryBinding` per import
(`function: i`, the contract above, and the ABI). Codegen already rejects unbound
imports and ABI mismatches.

### 4.5 Preserve exact callback membership

For each `read.contracts.signatures` class whose alias resolves in the JIT graph,
request `planManagedSignatureGroups` with
`{type: aliasId, aliases: otherAliasIds, functions: JIT descendants whose checked
type matches exactly}`. Then call
`lowerManagedSignatureGroups(groups, entries, signatureTypes, [reach.functionIds, pruned.functionIds])`.
A function that matches two classes is an internal error. A class with members but
no surviving `call-indirect` witness needs B8 (§5, D6f0). Witnesses that the JIT
does call map to the same classes as signature bindings, as today.

### 4.6 Escape rule (refined)

Every final `function-new` target is JIT code, because verify forbids imports as
targets. It is accepted if either holds:

- (a) it is a member of exactly one class (§4.5);
- (b) its source is a function **declaration** nested in the wrapper, and every
  binder reference to it is the callee of a direct call. Such a value can only be
  invoked inside JIT code, and the reference sets are on the checked graph's
  bindings.

Anything else fails with
`profile: JIT closure without an exact surface callback class`, which includes an
arrow returned to AOT without a class and a declaration used as a value. This keeps
the strict default for values and admits the adapter's own nesting: the entry
function and helpers such as `other` in `verify-hosted-managed-surface-entry.ts`.
The §3 Script's `execute` fails (a), because it is not a member, and fails (b),
because of the `scriptOrModule` value reference. This is the expected profile
error until S2 supplies Script identity. Physical ABI equality never grants
acceptance.

### 4.7 Records, emission and link handoff

Surface records map through `recordTypes` and both pruning maps to
`ManagedRecordBinding`s. The final layout must equal the directory layout
(`sameManagedRecordLayout`), otherwise `profile: record layout skew <alias>`.
Then run `emitModule(module, {closedRoots: [entryId], managedABI})`, then
`selectManagedIdentityBindings(read, native.managedImports)` (with v3 runtimes in
the pool), then `resolveManagedPointers`, then publish. Any failure publishes
nothing. Node tests stop at `emitModule` plus selection with spy readers.

## 5. Implementation slices (red-first)

Each slice starts with failing tests in `compiler/test/` (new
`managed-jit-entry.test.ts` unless named), then the implementation, `pnpm build`
and focused tests. The real-surface cases go in one slow test.

**D6f0, B8 in codegen** (`codegen/src/aarch64/scalar/index.ts`,
`codegen/test/scalar-managed-imports.test.ts`; independent of v3).
`ManagedSignatureBinding.witness` becomes optional exactly when `localFunctions`
is non-empty, and the import slot is created from the members' ABI. Tests: a
member-only binding emits a `signature` import used by its members; a binding with
neither witness nor members is still `INVALID_IR`; `function-new` of a witness is
still rejected; existing emission stays byte-identical.

**D6f1, registry normalization** (§4.1; independent of v3). Tests: 35/36/24
erasures on the three q1 Scripts, after which the checker accepts the module; one
changed argument, an argument on a non-generic entry, an unknown binding and a
`typeOnly` binding naming an entry each give their error; a local generic
application is untouched; normalization is idempotent.

**D6f2, adapter over restored declarations** (§4.2, extend `managed-entry.test.ts`;
`directory.frame` already exists in v2). Tests: three specifiers accepted and an
unapproved fourth rejected; all 919 exported aliases resolve to JIT type IDs; the
directory frame is used, and a parameter/field mismatch or a missing frame is
rejected; the existing single-specifier fixture still adapts.

**D6f3, ABI-only lowering** (§4.3; independent of v3). Tests: the §3 module yields
371 import IDs, 17 final imports, 0 runtime bodies and `verify` ok; import ABIs
equal the §3 table; a module lowered without `importedFunctions` fails with
`runtime body entered the JIT module`.

**D6f4, provider selection** (§4.4; new `managed-runtime-selection.ts` if it
exceeds ~150 lines). Tests use a provider table from `planManagedSurfaceRuntimes`
plus modeled ABIs, switched to `read.directory.runtimes` once D6d1 lands: the 18
uses select the q6 providers and slots; `$T472` wins over `$T475`; primitive and
number-text offsets follow the 39 collection providers. Negatives: a JIT-private
element type, an operation outside the vector (`sort`), a tampered operation ABI,
two uses of one import with different alias sets, and an assignable but not
exactly equal element (`string | undefined` against `$T131`).

**D6f5, membership and escape** (§4.5, §4.6; emission needs D6f0, these tests do
not). Tests: the §3 groups equal q3; the entry and a callee-only helper are
accepted; `execute` (value reference), an arrow returned without a class and a
declaration passed as an argument are rejected with the profile error; a forced
two-class match is an internal error.

**D6f6, assembly** (§4.7; needs D6d1/D6e reader `runtimes` and D6f0).
`prepareManagedSurfaceEntry` over a typed fixture module, not the §3 Script.
Tests: one `abi.functions` binding per final import with `runtime/<slot>`
contracts; `emitModule` lists `function-entry` imports; with a v3 read and a spy
host, `selectManagedIdentityBindings` selects them, and role crossing and a foreign
domain are rejected with zero reads.

## 6. Negative cases and errors

| Case                                                     | Stage   | Error                                                                       |
| -------------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| Unapproved specifier, namespace, phase, attributes       | profile | `managed entry requires named imports from its approved surface` (existing) |
| Imported name absent from entries and types              | profile | `managed surface export is missing: <name>`                                 |
| `typeOnly` binding naming an entry                       | profile | `managed surface binding kind differs: <name>`                              |
| Application other than the registry's                    | profile | `instantiation not in surface <name>`                                       |
| Surface alias not found in the JIT graph                 | profile | `surface alias missing from JIT graph <alias>`                              |
| Entry parameter differs from the frame field; no frame   | profile | `entry parameter differs from surface frame` / `surface has no entry frame` |
| Runtime body survives into the JIT module                | profile | `runtime body entered the JIT module: <name>`                               |
| Element not exactly equal to any provider key            | profile | `<kind><<element>>.<op> is not provided by the surface`                     |
| One import selecting two slots                           | profile | `runtime import selects two surface slots`                                  |
| Directory ABI differs from the import ABI                | profile | `runtime ABI skew <kind><<element>>.<op>`                                   |
| Escaping non-member closure (including Script `execute`) | profile | `JIT closure without an exact surface callback class`                       |
| Record layout differs                                    | profile | `record layout skew <alias>`                                                |
| Unbound import; binding ABI mismatch                     | emit    | existing codegen errors                                                     |
| Signature window words; foreign domain; role crossing    | link    | existing `resolveManagedPointers`/selection errors, before any patch        |

## 7. Native acceptance fixtures for main (D6g, serial queue)

Run them only after D6d3 (stubs and the `entries` bind body), D6e and D6f0–D6f6.
Use `TINT_BUILD_ONLY=1` under LLDB (direct debugserver), assert stop-at-entry and
the exit status, and record each run in a new immutable report. Extend
`tools/verify-hosted-managed-surface-directory.ts` with `--entry`. The AOT image
exposes a sparse surface whose frame is an exported record. The fixture compiler
runs `prepareManagedSurfaceEntry` **natively**, as the function-entry fixtures do
with `emitModule` and `resolveManagedPointers`.

Accept (one status per check, final 42):

1. JIT builds `[a, b]` (`unknown[]`) and passes it to an AOT helper. The helper
   returns an `unknown[]`, which the JIT reads by index and `length`.
2. A `list<$T131>` (string) push, and a record-element list create and push,
   through imported entries.
3. A JIT member closure is returned to AOT and called by an AOT helper after
   32 MiB of copying-GC churn. This needs B8.
4. A callee-only nested JIT helper runs inside the entry.
5. An imported runtime entry throws (out-of-range resize), and the exception is
   caught in the JIT with roots restored. A helper throw is caught the same way.
6. Shared state: an AOT helper counter reaches the expected count across JIT calls.

Reject (distinct statuses; the foreign pointer is never invoked; nothing is
published): a JIT-private element type; a tampered provider ABI (digest or
canonicality); an `entries` word of 0; a foreign domain; an escaping non-member
closure with an ABI equal to a class; a frame/parameter mismatch. Then the parent
§7 regressions and a frozen self-build with byte-identical stages, because D6f0
touches codegen.

## 8. Dependencies on pending v3

| D6f step               | Needs                                                                  |
| ---------------------- | ---------------------------------------------------------------------- |
| D6f1–D6f3, D6f5 (Node) | Nothing pending                                                        |
| D6f4 final form        | D6d1 `ManagedSurfaceRuntimeProvider` (operation ABIs) in the directory |
| D6f6                   | D6e reader `runtimes: ManagedIdentityBinding[]` in the selection pool  |
| D6g natively           | D6d3 AOT stubs, `entries` bind body, sparse policy (§4.6 of v3)        |

D6f must not recompute providers from the JIT graph. The directory, restored and
canonicality-checked by the reader, is the only key order. Provider grouping inside
the AOT stays private (v3 §3).

## 9. Corrections to the parent plan

- §3.7: `@1:value:97` is the JIT `execute`, not a copied runtime function, and it
  survives under imports. §3.3/§3.5: the frontier is now 17 imports, not 15.
- §4.6: the strict rule rejects every adapted entry, because the adapter nests
  body functions. Allowance (b) in §4.6 refines it.
- §4.5: classify bindings by membership (step 1); lower from the wrapper alone,
  not from "JIT top-level functions" (step 6); select per final import and require
  that bindings sharing an import agree (step 4).

## 10. Integration decisions

1. **Frame `$imports` typing: `unknown` plus a checked record view.** The
   [Script-frame research](rt-eval-script-frame.md) found that no exported AOT
   type names the table alias, so a typed table field would require an additional
   stub or layout. Keep one imported frame layout and check the table once at
   entry using the existing `view` binding and `MANAGED_SURFACE_TABLE` failure.
   This supersedes this plan's original typed-table recommendation.
2. **Script identity (S2).** `scriptOrModule: execute` needs either a frame-supplied
   identity token or a vocabulary class for the Script function. Until then, the §3
   Script is a negative fixture for D6f. Owner: the S2 plan
   ([Script identity and frame](rt-eval-script-frame.md)).

## 11. Risks

1. **Compile cost.** The JIT links and checks the nine runtime sources for every
   compile (about 0.4 s in Node). Native cost is unmeasured. A cached declaration
   graph per runtime-source identity is the later optimization, keyed by the same
   sources the image used.
2. **Runtime source drift.** The JIT trusts `request.runtime` to be the image's
   sources. Per-slot ABI checks catch encoding drift but not semantic drift under
   an equal ABI. This is the same trusted-owner contract as the layout runtime.
3. **Binder references.** Allowance (b) relies on complete references after
   specialization. A missed reference kind would admit a value use. Test
   `arguments` and destructuring aliases explicitly, and fall back to rejection on
   unknown reference shapes.
4. **Node only.** Every count here comes from Node probes. ABI equality, slot
   order and trap-freedom are proved only by D6g and `resolveManagedPointers` per
   image.

**Next:** D6f0 (B8) and D6f1 in parallel, then D6f3 and D6f5. D6f4 and D6f6 follow
D6d1/D6e on main.
