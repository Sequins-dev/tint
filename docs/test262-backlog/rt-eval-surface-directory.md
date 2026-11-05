# RT-EVAL S1 next slice: retained helper table and surface directory

Status: **D1 complete; D2 integration in progress**. Parent plan: [RT-EVAL](rt-eval.md) §4.2 and slice S1.
This refines only the next S1 integration step. It composes the existing
primitives into one compiler-owned path: a retained AOT helper table built from
the real Script vocabulary, a permanent identity directory (canonical contracts,
layouts, ABI words, digest), and runtime consumption by a JIT managed entry.
General Script, eval and `Function` execution stay in S2–S6.

Captured 2026-11-04 against source snapshot `918b4e8d…` (523 files), whose
[contract regressions](../results/managed-semantic-contracts-v1.json) pass
3,758 workspace tests plus native compiler/runtime fixtures. Its
[completed frozen self-build](../results/managed-contracts-checkpoint-v1.json)
produced byte-identical 64,031,426-byte stages with verified debug information.
Facts below come from source reading and read-only Node probes of the linker,
checker and reifier (`/tmp/tint-surface-directory-plan`). No image was emitted
or executed.

## 1. Outcome and boundary

For an explicit `managedSurfaces` request, `compileArm64Program` resolves the
requested exports through the application's own link, specialization, checking
and collection-runtime passes. It retains the helpers through a table factory
generated **inside the application instance**, emits inert callback witnesses
and per-record identity stubs, and generates plain typed directory data with a
SHA-256 digest, all exposed through one compiler-bound stub export. A portable
reader turns that export into domain-stamped `ManagedIdentityBinding`s. A native
fixture then compiles a typed module at runtime against that directory, links it
with `resolveManagedPointers`, publishes it and invokes it.

Out of scope: JIT module state/template sites (rt-eval §4.3 step 2), the Script
frame and `lowerScript` entry (S2), AOT whole-program semantic signature groups,
variance-based callback interchange, and the two-live-heap proof (S0/HOST-AGENT).
No C stage, platform linker or foreign VM fallback. TypeScript analysis and
printing stay in `@tint/typescript`; codegen gains only one record-identity
instruction and one member-only-import relaxation.

## 2. Current primitives

| Primitive (file)                                                                                    | Guarantees today                                                               | Missing for this slice                                                  |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `scriptRuntimeImports` (`js-engine/src/lowering/runtime-imports.ts`)                                | One name list shared with `lowerScript` (tested)                               | Instantiation data; type/value classification                           |
| `prepareManagedSurfaceTypes`/`reifyManagedSurfaceTypes` (`compiler/src/native/managed-surfaces.ts`) | Demands via `specializeCheckedRoots`, recheck, closed reification, table alias | A **separate** specialization pass; type exports take no type arguments |
| `createManagedSurfaceFactory` / `…WitnessFactory` / `…Reflectors`                                   | Fresh tables of existing bindings; inert witnesses; authorized metadata stubs  | Not retained in real images; record `descriptor` needs a live instance  |
| `serializeManagedSurfaceTypes`/`restore…`, `printReifiedTypes`                                      | Version-1 typed envelope; recheck on restore; ASCII-escaped UTF-16             | Alias names embed transient type IDs; no layouts, contracts or digest   |
| `createManagedTypeContractIndex`, `plan…`/`lowerManagedSignatureGroups` (`managed-contracts.ts`)    | Exact ordered recursive equality; explicit members; lowering/pruning remaps    | Not driven by a directory                                               |
| `adaptManagedSurfaceEntry` (`managed-entry.ts`)                                                     | Named imports become table reads; synchronous entry                            | Its frame alias is JIT-only, with no AOT identity                       |
| `resolveManagedPointers` (`managed-imports.ts`)                                                     | Complete preflight; domain check before reads; descriptor words; private patch | Unchanged: physical verification stays here                             |
| `emitModule` `managedABI`/`localSignatures` (`codegen/src/aarch64/scalar`)                          | Imported brand/signature/record slots; explicit local groups                   | Signature import requires a used `call-indirect` witness                |

## 3. Probe findings on the real vocabulary

The probe linked `js-runtime/{objects,environments/global,environments/records}`,
the text-encoding provider and a lowered `var x=1;` exactly as
`prepareNativeScripts` maps them, then ran `bindModule`, `prepareNativeGlobals`,
`specializeModule` (with and without roots) and `checkClosureModule`.

- **Vocabulary.** `scriptRuntimeImports(span,true,true)` has 118 bindings: 100
  values (all `function` declarations, 27 generic) and 18 types. Only 5 types
  carry `typeOnly`; `OrdinaryObject`, `ScriptPropertyKey`, `DerivedConstruction`
  and the generator step types are imported as values. **Classify by linked
  export namespace, never by `typeOnly`.**
- **Instantiations.** Every generic runtime call in a five-Script corpus
  (classes, generators, async, `with`, `for-in`) has explicit fixed arguments:
  `<ScriptPropertyKey, unknown>`, `<unknown>`, or
  `runScriptContext<ScriptCompletionRecord>`. Not exercised by the corpus:
  `deleteBindingReference`, `setGlobalBinding`, `setMutableBinding` and
  `getBindingValue`.
- **Same instances.** `specializeModule` keys instances on syntactic argument
  text over linked names. Passing the 27 roots as `named(linkedName)` arguments to
  the _application's_ `specializeModule` adds 16 instances (156 vs 140). Every
  added key is a helper this Script does not call, and no key is duplicated.
  `specializeCheckedRoots` would instead key on `__tint_contract_*` aliases,
  giving second copies with second module state. **Use the application pass.**
- **Generic type exports.** 10 of the 18 types are generic (`OrdinaryObject`,
  `GlobalEnvironment`, `DerivedConstruction`, generator/async-generator step
  types and others), so `reifyManagedSurfaceTypes` fails with "named type is
  missing". Checking a synthesized `type $tint$surface$X = X<…>` fixes it.
- **Reification succeeds** for the full vocabulary: 919 aliases (198 function,
  189 object, 252 union, 174 literal, 71 array, 35 named) and about 50 KB of
  ASCII declaration text. All 198 witnesses and 189 record reflectors generate.
  Node times: check 1.0 s, reify ~6 ms, print plus restore/recheck ~31 ms.
  Exact equality gives **159 function classes** and **178 object classes**.
- **Not blockers.** There are 16 default parameters (for example
  `createSourceFunction` `name`/`length`/`home`, and `defineClassAccessor`
  `length = setter ? 1 : 0`) and 3 `source?: string` parameters. The checker
  widens each to `T | undefined` with `minimumArguments`, so reify's "optional
  parameter excludes undefined" rule never fires; 9 aliases carry optional
  parameters. No helper has rest parameters (the checker rejects typed rest),
  and no alias has a receiver or is async. `home: T | undefined = undefined`
  reifies as `(T|undefined)|undefined`, a distinct exact contract: this
  fragments classes but stays correct.
- **Physical facts** (from source): `call-indirect` compares the callee's
  signature pointer with the witness's and executes `brk` on mismatch. Default
  emission interns signatures by physical key. Records share descriptors across
  semantic types with equal names, encodings, mutability and optionality
  (`records.ts`). Program images are pruned (`closedProgram: true`, `build.ts`).
  `js-runtime/objects` is instance-evaluated apart from its `retainedExports`
  views, so helper closures and their state live in the initializer's
  environment.

## 4. Blockers resolved by this slice

| #   | Blocker                                                                                                        | Resolution                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Generic type exports are not reifiable                                                                         | Type entries carry type arguments; the compiler appends checked instantiation aliases before reification                                                                     |
| B2  | `typeOnly` is not a classification                                                                             | Resolve each name to a linked `value` or `type` export; values must be top-level functions                                                                                   |
| B3  | No leaf yields a record descriptor without a live instance                                                     | New record-binding operation `identity` and IR `record-descriptor-address` (§5.5). It is not a `HostOperation`; an unbound stub grants nothing                               |
| B4  | A top-level factory cannot capture instance helpers                                                            | Generate ordinary module functions so `prepareModuleInstance` nests them beside the helpers, and expose them only by rewriting one declared stub                             |
| B5  | AOT semantic `localSignatures` would split descriptors that AOT `call-indirect` compares, trapping valid calls | AOT keeps physical interning. A contract is a directory **label** over the AOT physical descriptor (many contracts to one address). Address equality never grants membership |
| B6  | Alias names embed transient checker IDs                                                                        | Canonical first-reach renaming before printing and hashing                                                                                                                   |
| B7  | A non-member JIT closure flowing to AOT would carry a private descriptor and trap                              | Compile-time rejection (§5.7). Physical equality is used only to **reject**                                                                                                  |
| B8  | A member closure needs the imported address even with no JIT `call-indirect`                                   | Allow member-only signature imports when `localFunctions` is non-empty                                                                                                       |
| B9  | The adapter frame has no AOT descriptor                                                                        | The frame is an AOT-declared surface type with `imports: unknown`, narrowed by a JIT `view` binding against the table record                                                 |

## 5. Design

### 5.1 Configuration contracts

`@tint/js-engine/lowering` becomes the single source of instantiations:

```ts
export interface ScriptRuntimeSurfaceEntry {
  readonly specifier: string; // the three @tint/js-runtime entry specifiers
  readonly name: string; // export name; local === imported
  readonly typeArguments: readonly string[]; // [] | ["unknown"] | ["ScriptPropertyKey","unknown"] | ["ScriptCompletionRecord"]
}
export function scriptRuntimeSurface(): readonly ScriptRuntimeSurfaceEntry[];
// Complete vocabulary, including disposal. Existing import emission and all
// lowering call/type instantiations share the same concrete-argument registry.
```

`lowerScript` output stays **byte-identical**: names, order, spans and
`typeOnly` are unchanged. Arguments name only `unknown` or another surface entry.

`@tint/compiler/native` gains:

```ts
export type ManagedSurfaceTypeArgument =
  | {
      readonly kind: "keyword";
      readonly name: "unknown" | "string" | "number" | "boolean" | "undefined";
    }
  | { readonly kind: "export"; readonly name: string }; // nongeneric `types` entry
export interface ManagedSurfaceSelection {
  readonly module: string; // linked module ID; the caller resolved the specifier
  readonly name: string; // export name = table field / type export name
  readonly typeArguments: readonly ManagedSurfaceTypeArgument[];
}
export interface ManagedSurfaceRequest {
  readonly name: string; // generated identifier; contract namespace
  readonly values: readonly ManagedSurfaceSelection[]; // order = table field order
  readonly types: readonly ManagedSurfaceSelection[]; // includes the frame record
  readonly frame?: string; // name of the frame entry in `types`
  /** Instance-evaluated stub `(): ManagedSurfaceExport`; the body is replaced. */
  readonly bind: { readonly module: string; readonly name: string };
}
// CompileRequest.managedSurfaces?: readonly ManagedSurfaceRequest[]
// CompiledProgram.managedSurfaces?: readonly {name; digest; signatures: number; records: number}[]
```

A tools adapter (in S2, the Test262 host) maps `scriptRuntimeSurface()` through
the Script module's dependency map. **No signature is written by hand.**

### 5.2 Seams in `compileArm64Program` (exact order)

1. **After `linkModules`.** Resolve each selection in `linked.value.exports` by
   `{module, namespace, name}`. Reject a missing export, a value that is not a
   top-level `function`, a private (unexported) helper, a duplicate name, or a
   type-argument count that differs from the declaration's. Validate `bind`:
   it must be exported by a module **not** in `retainedRuntimeModules` (so the
   instance evaluates it), take no parameters, declare a return type that
   resolves to the linked `ManagedSurfaceExport`, and have the body
   `throw "MANAGED_SURFACE_UNBOUND"`.
2. **`specializeModule(normalized, rebound, …)`** receives
   `roots: [{function, arguments}]` for generic values, with arguments as
   `named(linkedName)` or keywords, so keys coincide with the lowered code's
   own calls (§3). `value.roots[i]` names the instance; nongeneric values use
   their linked name.
3. **After the existing check.** Append instantiation aliases (B1) and
   recheck. Run `reifyManagedSurfaceTypes`, then canonicalize, classify and lay
   out (§5.4). Append the reified declarations and generated functions (§5.5),
   rewrite the `bind` body, and **recheck**. Failures use stage `surface`.
4. **`prepareCollectionRuntimes`** runs unchanged, so lists, sets and maps
   demanded by surface types are collected normally. The transform nests the
   generated functions in the initializer.
5. **`lowerModuleEntries`** adds `recordTypes: true` (metadata only, no code)
   and internal `identity` record bindings for the stubs. After lowering,
   require each directory layout to equal
   `lowered.module.records[recordTypes[aliasType]]` (pre-pruning IDs); a
   mismatch fails compilation.
6. **Emission** is unchanged: no `managedABI` and no `localSignatures`.

With `managedSurfaces` absent or empty, every step is skipped and output is
byte-identical, so self-build stage images are unaffected.

### 5.3 ID conventions (both pruning mappings)

| Table                                             | Convention                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `lowered.entries`                                 | native index → **source** function ID (invert with `indexOf`)                                 |
| `lowered.signatureTypes[typeId]` (opt-in)         | native witness ID **+1**; 0 = absent                                                          |
| `lowered.recordTypes[typeId]` (opt-in)            | record ID or `undefined` (**no** +1)                                                          |
| `pruneClosedModule(…).functionIds` / `.recordIds` | old → new **+1**; 0 = removed. Compose `reachable`, then `pruned` (`retainedIdentity`)        |
| `planManagedSignatureGroups`                      | source function/type IDs of **one** checked graph                                             |
| `lowerManagedSignatureGroups`                     | members via `entries.indexOf(source)`, witnesses via `signatureTypes[type]-1`, then both maps |

The AOT directory needs **no** pruning maps. It reads addresses at run time
from live function values and identity stubs, whose IR operands pruning itself
remaps. The JIT side uses both maps: `PreparedNativeFunctionEntry` additionally
returns `entries`, raw `signatureTypes` and both `functionIds` maps.

### 5.4 Canonical contracts, layouts and digest

New `compiler/src/native/managed-directory.ts`:

1. **Names.** Rename aliases `$T0…` in deterministic first-discovery order from the
   table, value entries in table order, then type exports in request order,
   following fields and parameters in declared order. An iterative alias queue
   handles recursive graphs. Helper locals become symbolic `$helperN` labels in
   metadata; executable factories retain the real application bindings.
2. **Classes.** Use `createManagedTypeContractIndex` over the rechecked
   declarations. Partition function aliases (helper types and callbacks) and
   object aliases into **exact** classes. The representative is first in
   canonical order; the rest are `aliases`. Classes are never merged by
   assignability: exact equality is transitive, but overlapping compatible
   classes could admit an incompatible member.
3. **Contracts.** `tint.surface.v1/<name>/<digest>/fn/<i>` and `…/record/<i>`,
   in class order. The brand keeps `tint.function.v1`. Contracts derive from
   the digest and are not hashed.
4. **Physical expectations.** Layout-only lowering of the canonical declarations
   plus the generated stubs (`prepareNativeFunctionEntry` with `recordTypes` and
   `signatureTypes`) yields each record class's `RecordLayout` and each
   function class's `parameters`/`returnType`. This is the same lowering a JIT
   module performs. §5.2 step 5 proves the AOT record layouts agree; signature
   words are verified physically at link time (§5.6).
5. **Digest.** Use `sha256` from `@tint/foundation/binary/sha256`. This adds
   the `@tint/compiler` → `@tint/foundation` dependency: update the manifest,
   project references and `workspace-contracts.json`, and regenerate the
   catalog. The input is a canonical encoding of every field except `digest`:
   strings as a u32 length plus **UTF-16LE code units** (lone surrogates
   survive), numbers as little-endian u32/f64, arrays with a u32 count.
   Portable TypeScript gives identical bytes in Node and native bootstrap
   stages.

New portable exported types (`managed-directory.ts`):

| Type / field                                | Content                                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `SerializedManagedSurfaceDirectory.version` | `2`                                                                                                |
| `.name`, `.frame`                           | surface name; frame type-export name or `undefined`                                                |
| `.abi`                                      | `{signature: nativeSignatureVersion, functionBrand: [48, 1, 24, 0]}`                               |
| `.types`                                    | the v1 `SerializedManagedSurfaceTypes` envelope with canonical names                               |
| `.signatures[i]`                            | `{alias, aliases, function, parameters: ScalarType[], returnType}`; `function` indexes `functions` |
| `.records[k]`                               | `{alias, aliases, layout: RecordLayout}`; `k` indexes `records`                                    |
| `.digest`                                   | lowercase hex SHA-256                                                                              |
| `ManagedSurfaceExport.directory`            | the directory above                                                                                |
| `.table: unknown`                           | a fresh table of the instance's helper closures                                                    |
| `.functions: readonly unknown[]`            | table fields, then witness values                                                                  |
| `.records: Float64Array`                    | descriptor addresses in record-class order                                                         |

### 5.5 Generated AOT code and exactly-once state

All of this is generated syntax, typed by the canonical declarations and checked
like source:

- **`$surface_table()`.** `createManagedSurfaceFactory` returns
  `{field: specializedLocal, …}`. Those are the instance's existing closures; no
  helper body is copied and no initializer reruns.
- **`$surface_witnesses()`.** `createManagedSurfaceWitnessFactory` creates an
  inert value for each callback class representative that has no helper entry.
- **`$surface_record_k(witness: $Tn | undefined): number`.** One per record
  class, bound with internal operation `identity`, lowering to
  `record-descriptor-address {record: forType($Tn)}`. The instruction returns
  the permanent descriptor address and never reads its operand. Codegen reuses
  `descriptorPointer`. IR updates: `model.ts`, `operands.ts`, `effects.ts`
  (pure), `substitution.ts`, verification, and both reachability passes (the
  record stays live). An unrepresentable object alias fails as
  `surface: no managed layout for <alias>`.
- **The `bind` stub body:**
  `return {directory: <literal>, table: t, functions: [t.f0, …, w.c0, …], records}`.
  It fills `records` with one identity call per class. The directory literal
  is permanent code data.

**Exactly-once.** The image initializer runs once. The helper closures, and the
`let` state they capture, exist once in its environment. Each stub call
allocates a fresh table and directory value referencing those same closures;
neither specialization (§3) nor the instance creates a second copy. The fixture
proves it: a module `let created` incremented by a top-level `const` initializer
stays `1` after AOT direct calls, two stub calls and JIT calls through either
table; a shared counter advances across all paths;
`first.table.f === second.table.f` for every field; all of this holds after
copying-GC churn.

### 5.6 Runtime reader and physical verification

`readManagedSurfaceDirectory(exported: ManagedSurfaceExport, host)` returns
`{domain, types: ManagedSurfaceTypeDescription, bindings: ManagedIdentityBinding[]}`
or an error. `host` supplies three existing leaves: `domain()` (the
context-domain token, a heap/context identity distinct from any logical agent
ID), `descriptor(fn)` (`native-function-descriptor`) and `signature(fn)`
(`native-function-signature`).

The reader **dereferences nothing**. In order, it checks the version and ABI
words, recomputes and compares the digest, runs `restoreManagedSurfaceTypes`
(parse and recheck), checks array lengths, and reads the domain once (it must be
issued and positive). It then builds the bindings: the **brand** from
`descriptor(functions[0])` with a 32-byte window; **signatures** from
`signature(functions[i])` with window `nativeSignatureHeaderByteLength +
8·parameters`; **records** from `records[k]` with window
`24 + 8·(references + generals)`.

A record's **readable window** is distinct from its **object byteLength**
(`layout.byteLength`, the first descriptor word). The brand window is 32 bytes;
its object size is 48. Reads happen only inside `resolveManagedPointers`, after
its complete preflight and domain check. Physical ABI verification (descriptor
words, physical signature, full layout, version) stays there, separate from
semantic contracts. The contract string, never an address match, is the
semantic authority.

The consumer keeps the export in an **engine-owned rooted cell** per domain: a
traced module-instance `let`, never reachable from JavaScript. Frames reference
the table. Runtime-generated code embeds only permanent metadata slots (brand,
signatures, record descriptors); the table, realm, scope and objects always
arrive through the frame.

### 5.7 JIT managed entry against the directory

Add `prepareManagedSurfaceEntry(module, entry, restored, directory)` beside
`adaptManagedSurfaceEntry`; the closed entry is untouched.

- **Entry.** Synthesize `$entry($frame: <frame export>)`, which first runs
  `const $imports = $viewTable($frame.imports)` and throws
  `"MANAGED_SURFACE_TABLE"` when it is `undefined`. `$viewTable` is a
  JIT-internal `view` record binding (existing leaf) on the table record.
  Prepare with `prepareNativeFunctionEntry` (`recordTypes`, `signatureTypes`,
  that binding).
- **Records.** Each JIT record whose type name is a directory alias becomes a
  `ManagedRecordBinding` whose layout must equal the directory layout.
  Image-private records keep private descriptors in the registered arena.
- **Signatures.** One `planManagedSignatureGroups` request per class present in
  the JIT graph (`type`: canonical alias; `aliases`: other alias IDs;
  `functions`: JIT source functions whose checked type **exactly** matches),
  then `lowerManagedSignatureGroups` with both maps fills `localFunctions`.
  **B8:** codegen accepts a binding with no `call-indirect` witness when
  `localFunctions` is non-empty; `function-new` still cannot use the witness.
- **B7.** After grouping, any non-member JIT function whose final physical
  signature equals an imported binding's is rejected before emission
  (`profile: possible surface callback without an exact contract`).
  Variance-compatible callbacks need explicit guards later.
- **Linking.** `emitModule` with `managedABI`, then `resolveManagedPointers`
  with the reader's bindings and domain, then `EngineCodeStorage.publish`, then
  `callExecutableManaged(address + entryOffset, frame)`. Failures publish
  nothing.

## 6. Implementation slices (test-first, independently verifiable)

**D1. Vocabulary instantiations** (`js-engine/src/lowering/{runtime-imports,index}.ts`).
**Complete:** [native/self-build checkpoint](../results/runtime-surface-checkpoint-v1.json).
`scriptRuntimeSurface()` and lowering share concrete arguments. Node
tests: `lowerScript` output is deep-equal across the existing lowering tests;
every generic runtime call in a corpus (classes, generators, async, `with`,
`for-in`, templates, `delete`, global declarations) uses exactly its surface
instantiation; all 27 generic functions are covered, including the four missed
by the initial probes. Eight captured lowering outputs are unchanged.

**D2. Demand resolution and retained table** (`compiler/src/native/index.ts`,
new `managed-directory.ts`). Selection/table primitives now live in
`managed-selections.ts`; [native compiler](../results/native-managed-selections-compiler-v1.json)
and [shared-state/GC](../results/native-managed-selections-runtime-v1.json) fixtures
pass. Compiler-request integration and bound-stub retention remain pending.
Implement §5.1–§5.2 steps 1–4 and table/stub
generation, without records or digest. Node tests: the real surface yields 100
fields, 18 type exports and 27 roots, with no specialization key outside the
union of application demand and roots; every step 1 rejection; an empty surface
gives byte-identical `native.code` for an existing fixture program. Native
fixture `tools/verify-hosted-managed-surface-directory.ts --table` uses fixture
helpers with generic `identity<T>`, a recursive `Link`, `unknown[]`, a default
and an optional parameter, and module state, and asserts the §5.5 proofs.

**D3. Record identity leaf** — implemented with
[native compiler](../results/native-record-identity-compiler-v2.json) and
[GC execution](../results/native-record-identity-runtime-v3.json) proof; frozen
self-build pending. (`ir/src/scalar/*`,
`ir/src/optimization/{reachability,reachable}.ts`,
`ts-native/…/record-bindings.ts`, codegen). Add `identity` and
`record-descriptor-address`. Tests: IR verification, a codegen relocation-target
test, and pruning keeping the record live. Natively, `identity` equals
`descriptor(instance, witness)` for a live record, and an instance-free record
yields a stable positive address across GC.

**D4. Contracts, layouts and digest** (`managed-directory.ts`, foundation
dependency). Probe-verified refinement and corrections:
[D4 layouts plan](rt-eval-directory-layouts.md). Implement §5.4 and wire §5.2 step 5. Node tests: names are
unchanged when unrelated declarations shift type IDs; real-vocabulary class
counts; the digest is stable across runs and changes with one mutability, one
name or one alias order; lone surrogates round-trip; a skewed AOT layout is
rejected.

**D5. Reader** (portable, `managed-directory.ts`). Implement §5.6. Node tests
with spy `readWord` and spy leaves: a tampered declaration, layout or digest is
rejected before any leaf call or read; a foreign domain is rejected before
reads; record window `24+8n` versus object byteLength; brand window 32 versus
object size 48.

**D6. First vertical slice** (`managed-entry.ts`, codegen B8, fixture mode
`--entry`). A typed module compiled at runtime against the **retained real
directory of its own image** is published and invoked.

- Accept: recursive record identity; `unknown[]` in both directions; a JIT
  closure returned to AOT and called by an AOT helper after 32 MiB of copying-GC
  churn; a member callback with no JIT call site; throw propagation and root
  restoration; shared state with `created === 1`.
- Reject, each with a distinct status and without invoking the foreign pointer:
  a helper absent from the surface (unsupported **compilation**); a tampered
  digest; a foreign or unissued domain; a B7 non-member callback; a frame whose
  `imports` is not the table.

## 7. Validation

- **Gates.** `pnpm check` fail-fast with each exit status inspected. Native
  fixtures with `TINT_BUILD_ONLY=1`, serially under LLDB, asserting the
  stopped-at-entry state and exact exit statuses. Pre-entry launch failures
  stay separate.
- **Unchanged regressions** after D3/D6: `verify-native-managed-frame.ts`
  (default, `--source-entry`, `--local-callback`, `--reject`),
  `verify-native-managed-{invocation,imports}.ts`,
  `verify-hosted-managed-surface-{types,factory,entry}.ts`,
  `verify-hosted-managed-witnesses.ts`,
  `verify-hosted-{context-domain,dynamic-domain,descriptors}.ts`,
  `verify-hosted-script{,-declarations,-jobs,-lowering,-modes}.ts`,
  `verify-test262-native-dynamic-{execution,functions,kinds,lazy,realms,coercion,async-generator}.ts`,
  `verify-test262-native-managed-{access,globals}.ts` and
  `verify-test262-native-domain-functions.ts`.
- **Self-hosting.** D1–D4 and D6 touch lowering, compiler, IR or codegen. Each
  needs a frozen-source native self-build with byte-identical stages and debug
  verification. Schedule native execution through the survey’s cooperative
  between-variant checkpoint; preserve its frozen toolchain, configuration and
  journal. The `918b4e…` self-build is complete.
- **Conformance.** None is claimed. The first selections this enables are S2's
  complete reruns of `language/global-code` and `annexB/language/global-code`,
  then S3/S4 per [rt-eval](rt-eval.md) §7, each in a new immutable report.

## 8. Decisions (defaults)

| Decision               | Default                                                                                      | Rejected alternative                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Specialization pass    | Roots in the application `specializeModule`                                                  | `specializeCheckedRoots` (distinct keys duplicate helpers and state)         |
| Table exposure         | Instance-nested generated factory behind one rewritten stub                                  | New `managed-surface-table` `HostOperation` (rt-eval open question 1 closed) |
| Directory exposure     | Typed data plus live values through that stub; addresses from existing leaves and `identity` | A raw memory window or absolute data relocations                             |
| Record descriptors     | Compiler-issued, operand-free `identity` record binding                                      | Live-instance `descriptor` (incomplete) or a `HostOperation`                 |
| AOT signature identity | Physical interning; contracts label shared descriptors                                       | AOT `localSignatures` (traps valid AOT `call-indirect`)                      |
| Contract classes       | Exact ordered equality, representative plus aliases                                          | Assignability or transitive merging                                          |
| Layout authority       | Precomputed from declarations, proved equal to AOT lowering, covered by the digest           | Runtime-only recomputation                                                   |
| Digest encoding        | SHA-256 over length-prefixed UTF-16LE                                                        | UTF-8 `TextEncoder` (loses lone surrogates)                                  |
| Frame                  | AOT-declared surface record, `imports: unknown` narrowed by `view`                           | JIT-only frame alias (no AOT identity)                                       |
| Variance               | Reject non-member physical-key callbacks                                                     | Admit by physical equality                                                   |

## 9. Unmeasured costs

All unmeasured; record them in the D2/D6 reports and then in S2: AOT image
growth from retaining all 100 helpers (extra specializations Scripts do not
use), 159 witness and 178 identity functions, and about 50 KB of declarations
plus layouts; AOT build time; native restore/recheck of 919 aliases once per
process (Node: ~31 ms); per-module JIT check time over the full surface; arena
bytes. Optimizations (a precompiled declaration graph, vocabulary subsetting)
wait for these numbers.

## 10. Remaining unverified facts

1. All 178 object classes have representable layouts (unions of distinct
   record shapes or unsupported encodings would fail `identity`; D4 lists any).
2. Default-parameter encodings (`defaultInput`) equal the reified `T|undefined`
   encodings for every helper; only `resolveManagedPointers` proves this, per
   image.
3. Checker union order and interning are deterministic for fixed source across
   Node and native stages (expected; stage comparison proves it). Across
   revisions they may change the digest, which is acceptable.
4. The optimizer cannot drop or merge identity stubs and lose the record
   operand (D3 tests this).
5. S2 lowered-Script closures are exact members of vocabulary callback aliases,
   so B7 does not reject ordinary Scripts (measure in S2).
6. The 4 generics missing from the corpus use their declared instantiation
   (D1 tests this).
7. **Verified:** the full self-build for `918b4e…` passes (linked above).

**Next after this slice:** S2 (`lowerScript` entry with an AOT
`ManagedScriptFrame`, instance-state profile, Test262 host wiring). No further
broad planning until v9 completes.
