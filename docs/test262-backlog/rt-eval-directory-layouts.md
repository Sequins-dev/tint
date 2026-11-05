# RT-EVAL S1 D4: physical layouts, semantic classes and the canonical directory

Status: **D4a physical facts and D4b directory encoding have native validation
and frozen self-builds. D4c anchors and table composition pass native validation;
compiler-request publication and D4d AOT agreement pass Node and native fixtures. Their frozen self-build failed at an allocation-result guard; the corrected empty-request fast path needs a new fixed point.**
Evidence: [final-pass compiler](../results/native-managed-surface-materialization-compiler-v1.json),
[shared-state/GC execution](../results/native-managed-surface-materialization-runtime-v1.json),
[physical facts](../results/surface-physical-facts-checkpoint-v1.json),
[directory](../results/managed-directory-data-checkpoint-v1.json),
[retention](../results/retained-node-ownership-checkpoint-v1.json). Parent: [surface directory](rt-eval-surface-directory.md)
§5.4 and slice D4. This document answers one question with measurements:
how the compiler derives every function-alias ABI and every record-alias
layout of the real Script vocabulary through the same lowering an
application uses, and how those facts become exact semantic classes and a
canonical, digested directory. Reader logic (D5), JIT consumption (D6) and other
RT-EVAL families are out of scope. They appear only where D4 must leave them a
contract.

Captured 2026-11-04 against working-tree source identity `59ffc7f2…` (524 files),
which includes D3 and `canonicalizeManagedSurfaceTypes`. The probes are read-only
Node scripts in `/tmp/tint-directory-layout-plan` (`p0`–`p8`). They import only
public `dist` entry points plus `tools/workspace-sources.ts`. They emitted no
image, ran no native code and changed nothing in the workspace. **No native
conformance, native equality or performance claim follows from them.** Times are single Node runs.

## 1. Answer in brief

1. **One layout program, not the closed entry.** Lower a _metadata-only_
   program: the canonical declarations, one inert witness per function alias, and
   one `identity` stub per object alias. Link it with the application's collection
   runtimes, then run `prepareNativeGlobals` → `specializeModule` →
   `checkClosureModule` → `prepareCollectionRuntimes` → `lowerModuleEntries`
   (`recordBindings: identity`, `recordTypes: true`), with no pruning. Every alias
   lowers. The closed path (`prepareNativeFunctionEntry`, no collection runtimes)
   cannot lower 25 function aliases or 32 record aliases (§3.2).
2. **Read physical facts from operands, not from opt-in maps.** A record layout
   is `module.records[stub.record-descriptor-address.record]`. A function ABI is
   the witness's lowered `parameters`/`slots`/`returnType`. `recordTypes` is
   filled lazily, only for types that lowering demanded (`records.ts` `forType`),
   so it cannot enumerate a surface.
3. **The layouts are the application's layouts.** Lowering the closed raw aliases
   inside the real application graph reproduces all **189/189** record layouts and
   **198/198** witness ABIs. It also reproduces all **100/100** helper ABIs: 73
   nongeneric helpers, including every default and optional parameter, and 27
   generic instances (§3.3).
4. **Exact classes are consistent with physical facts.** The 178 object classes
   map to 164 physical records and the 159 function classes to 109 physical ABIs.
   No class is split across two physical identities. Seven records and 22 ABIs
   carry several semantic labels, so labels share pointers and **address equality
   never implies membership**.
5. **The directory must exist before AOT checking.** The bind stub embeds the
   directory literal, so the layout program runs **before** the application's
   final check and lowering. AOT lowering then _proves_ agreement and stays
   physically interned: no `managedABI` and no `localSignatures`.
6. **Two integration blockers for D2/D4 were found** (§3.4):
   `prepareCollectionRuntimes` re-specializes from the unspecialized module, which
   loses roots and table names. Zero-span generated statements also break
   `prepareModuleInstance`'s retention check. Both have measured fixes that use
   existing contracts.

## 2. Probe method

`common.mts` reproduces `compileArm64Program` up to the checked table: link the
three `@tint/js-runtime` entries, the nine collection/encoding runtimes from
`runtimeSources()` and an import-only entry (344 modules). It then runs
`bindModule`, `prepareNativeGlobals` (TextEncoder/TextDecoder factories),
`resolveManagedSurfaceSelections` over `scriptRuntimeSurface()` (100 values, 18
types, 27 roots), and `specializeModule(normalized, rebound, {roots})`, which
gives **157** specializations. `prepareManagedSurfaceTable(…, "$ScriptSurface",
"$ScriptTable")` gives 100 fields, 18 type exports and 919 aliases, and
`canonicalizeManagedSurfaceTypes` follows.

| Probe | Question                                         | Mechanism                                                                                             |
| ----- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| p1    | Alias census, exact classes, canonical stability | `checkClosureModule` over canonical declarations, `createManagedTypeContractIndex`                    |
| p2/p8 | Closed lowering without collection runtimes      | Strategy A: `lowerModuleEntries` on the closed canonical module, all entries then one entry at a time |
| p3    | Layout program; application-graph agreement      | Strategy B (§1.1); strategy C: the same lowering inside the real application graph                    |
| p4    | Where default and optional parameters live       | Declarations of the 100 linked helpers                                                                |
| p5    | Digest input determinism; lone surrogates        | Prototype UTF-16LE length-prefixed encoding plus `@tint/foundation/binary/sha256`                     |
| p7    | Witness demand; class representatives            | Classes over the canonical graph versus table entry aliases                                           |

## 3. Measured results

### 3.1 Census and classes (p1, p7)

- 919 canonical aliases: 198 `function`, 189 `object`, 252 `union`, 174
  `literal`, 71 `array`, 6 `map`, 1 `set`, 20 `undefined`, plus single primitives
  and typed arrays. The syntax kinds are 450 `group`, 189 `object`, 174 `literal`,
  71 `array` and 35 `named`. The old 919/198/189 counts reproduce.
- Exact equality gives **159 function classes and 178 object classes**, as
  before. Every class representative is its lowest `$Tn`, so first-discovery
  order is also class order. Partitioning takes 16,618 `matches` calls and about
  8 ms.
- Function aliases have no receivers, are never async and have no optional
  parameter _nodes_. Nine function types have `minimumArguments` below their
  arity.
- The canonical text is 50,557 ASCII code units (`printReifiedTypes` escapes)
  and is identical across repeated canonicalization. The table is `$T0`; entry 0
  is `{name:"registerAsyncLexicalDisposable", local:"$helper0", type:"$T1"}`.
- The 100 helpers have 100 distinct aliases spread over **95** function classes,
  and 5 classes contain more than one helper alias. Only **64** classes have no
  helper, so the AOT image needs 64 witnesses, not 159 or 198.

### 3.2 Closed lowering is not enough (p2, p8)

Strategy A lowers the closed canonical module directly. All entries together fail
at once with `type requires an unsupported native representation (type 1339)`,
which is `$T130 = unknown[]`. One entry at a time:

| Entry kind                         | OK      | Failure                                                       |
| ---------------------------------- | ------- | ------------------------------------------------------------- |
| witnesses (one per function alias) | 173/198 | 25 × `unsupported native representation` (arrays, maps, sets) |
| identity stubs (one per object)    | 157/189 | 32 × `record witness has no managed record layout`            |

`entryType` encodes `array`, `set` and `map` as `reference` only when matching
list, set or map runtime bindings exist (`records.ts`). Collection-runtime
preparation is therefore required **even for layout-only signatures**.
`prepareNativeFunctionEntry` also prunes to a single entry, which drops records
the entry does not reach. It cannot be the directory's layout authority.

### 3.3 Layout program and application agreement (p3, p4)

**Strategy B** links the canonical declarations, the 198 witnesses (marked
`exported`, so the linker's `exports` map their linked names) and 189 identity
stubs with the nine collection runtimes. `prepareCollectionRuntimes` returns 79
list, 1 set and 17 map bindings. One `lowerModuleEntries` call with all 189
`identity` bindings succeeds in about 1.0–1.1 s, producing 470 records (most are
runtime environment records) and 1,788 functions.

| Fact                                    | Value                                                                                                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| distinct alias records / object classes | 164 / 178; 0 classes split across records                                                                                                                        |
| records shared by several classes       | 7; at most 7 classes on one record (`{readonly error: X}` for different reference types `X`)                                                                     |
| distinct ABIs / function classes        | 109 / 159; 0 classes split across ABIs                                                                                                                           |
| ABIs shared by several classes          | 22; at most 8 classes share `reference->reference`                                                                                                               |
| alias-record fields                     | 857: 337 `reference`, 141 `string`, 117 `optional-reference`, 102 `number`, 86 `boolean`, 53 `general`, 12 `optional-string`, 8 `optional-number`, 1 `primitive` |
| alias-record field metadata             | 147 mutable, 16 with `presenceOffset`, **0 with `stateOffset`**; largest record is the table, `$T0` (100 fields, 816 bytes)                                      |
| ABI slot encodings                      | `reference`, `general`, `number`, `string`, `boolean`, `void`, `optional-{reference,string,number}`, `Uint32Array`                                               |

**Strategy C** (variant C2) is the real application graph: the normalized
module, the closed raw aliases, raw witnesses, raw identity stubs, 27
non-generic _demand anchors_ (§5.2) and a trivial selected export. It goes
through the application's `specializeModule`, `prepareCollectionRuntimes` (with
a `prepareModuleInstance` transform that retains the runtime closure as
`compileArm64Program` does) and `lowerModuleEntries` (about 7 s; 223/3/39
list/set/map bindings, 4,458 records, 6,504 functions). Matching raw aliases to
canonical aliases by restored declaration spans gives these comparisons with B:

| Comparison                                                   | Result      |
| ------------------------------------------------------------ | ----------- |
| identity-stub record layout, application = layout program    | **189/189** |
| witness ABI, application = layout program                    | **198/198** |
| nongeneric helper ABI (nested closure) = canonical witness   | **73/73**   |
| generic instance ABI (callee found via its anchor) = witness | **27/27**   |

All 16 default parameters and all 3 `source?: string` parameters belong to
nongeneric helpers (`createBaseClass`, `createDerivedClass`, `createClassMethod`,
`defineClassMethod`, `defineClassAccessor`, and the four `createSource*Function`
helpers). Each default lowers through `defaultInput` (`optional-number`,
`optional-string`, `optional-boolean`, `optional-reference`). Its alias, rechecked
as `T | undefined` without an initializer, lowers to the identical slot. The
default/optional mapping therefore needs **no translation table**: the witness ABI
of the canonical alias is the helper's ABI. In Node this verifies old item
§10.2; per-image native proof stays with `resolveManagedPointers`.

### 3.4 Integration blockers (p3)

| Attempt                                                                  | Exact failure                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| C1: pass the specialized module and table to `prepareCollectionRuntimes` | `missing specialization function: @6:value:10`                            |
| C0: append the table factory to `normalized`                             | `unknown value name: __tint_specialized_0`                                |
| C2 with zero-span retained stubs                                         | `retained declaration depends on instance state: __tint_specialized_1133` |

- **Re-specialization.** `prepareCollectionPass` calls
  `specializeCheckedRoots(module=normalized, …)`, which runs a fresh
  `specializeModule` that receives no application roots. Templates are gone from
  a specialized module (C1), and instance names do not exist in `normalized` (C0).
  `compileArm64Program` passes `normalized` today, so D2's roots never reach the
  final pass. **Fix (measured, existing contracts):** append demand anchors to
  `normalized` (§5.2). Both specialization passes then key the instances
  syntactically, exactly like the application's own calls.
- **Declaration ownership (implemented correction).** The probe exposed a
  source-span containment bug. `prepareModuleInstance` now tracks retained
  references by AST identity. Native tests cover colliding zero spans and genuine
  instance-state captures. Do not assign artificial source extents to work around
  ownership; witnesses and identity stubs may keep zero spans.

### 3.5 Digest inputs (p5)

The prototype encoding covers the version, name, canonical declarations, table,
entries and types. It is 110,074 bytes and yields the same SHA-256 (`7268b20e…`)
in three separate processes, and again after rebuilding the table under a
different reification prefix (`$Renamed`/`$OtherTable`). `"\uD800"` and
`"\uD801"` hash differently under UTF-16LE, but both become `EF BF BD` under
`TextEncoder` and would collide. The canonical declarations are pure ASCII, so
lone surrogates can come only from request-supplied names (`text()` rejects only
empty strings and NUL).

## 4. Discrepancies with the surface-directory plan

| #   | Old text (rt-eval-surface-directory.md)                                                                    | Measured correction                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | §5.4.4: layout-only lowering via `prepareNativeFunctionEntry` is "the same lowering a JIT module performs" | It fails 25 functions and 32 records (§3.2) and prunes. Use the linked layout program with collection runtimes (§5.1)                                                                                                         |
| X2  | §5.2 step 4: `prepareCollectionRuntimes` runs unchanged and nests the generated functions                  | It re-specializes `normalized` (§3.4). Add demand anchors; generate the factory/bind body inside `transform`                                                                                                                  |
| X3  | §5.2 step 5: compare against `lowered.module.records[recordTypes[aliasType]]`                              | `recordTypes` is lazy. Compare each identity stub's `record` operand                                                                                                                                                          |
| X4  | §5.5/§9: "159 witness" functions                                                                           | 64 witnesses (classes without a helper); 178 identity stubs (one per record class)                                                                                                                                            |
| X5  | §10.1: object classes may be unrepresentable                                                               | Node: 178/178 representable **with** runtimes; 32 aliases are not without them                                                                                                                                                |
| X6  | §10.2: default encodings unverified                                                                        | Node: 73/73 nongeneric (all defaults/optionals) and 27/27 generic match; native proof per image remains                                                                                                                       |
| X7  | §5.5: `$surface_record_k` unbound stubs nest in the initializer                                            | `record` bindings require **top-level** functions (`parent === undefined`). Identity stubs must be retained top-level, with AST-identity ownership (§3.4); callback witnesses are hoisted once in the application initializer |
| X8  | §5.5: unrepresentable error `surface: no managed layout for <alias>`                                       | Lowering reports `record witness has no managed record layout`. Map it to `surface: no managed layout for $Tn` in the layout program                                                                                          |
| X9  | §3: application specialization adds 16 keys (156 vs 140)                                                   | Now 157 with the nine runtimes linked and D1 instantiations. Re-measure the key delta in D2, not D4                                                                                                                           |
| X10 | §5.4 table: `RecordLayout` has names                                                                       | `RecordLayout` carries no field names. Names live only in the declarations, which the digest also covers                                                                                                                      |

## 5. Design

### 5.1 Layout program (new `compiler/src/native/managed-directory.ts`)

```ts
export interface ManagedSurfaceLayoutRuntime {
  readonly modules: readonly SourceModule[]; // request.modules (same snapshot)
  readonly runtimes: readonly RuntimeSource[]; // request.runtimes with retainedExports === undefined
  readonly globals: readonly string[]; // compileArm64Program's list
}
export interface ManagedSurfacePhysicalFacts {
  readonly records: readonly {
    readonly alias: string;
    readonly layout: RecordLayout;
  }[]; // every object alias, canonical order
  readonly signatures: readonly {
    readonly alias: string;
    readonly parameters: readonly ScalarType[];
    readonly returnType: ScalarType | "void";
  }[]; // every function alias, canonical order
}
export function deriveManagedSurfacePhysicalFacts(
  canonical: ManagedSurfaceTypeDescription, // output of canonicalizeManagedSurfaceTypes
  runtime: ManagedSurfaceLayoutRuntime,
):
  | { ok: true; value: ManagedSurfacePhysicalFacts }
  | { ok: false; error: string };
```

1. Classify aliases with `checkClosureModule` over the canonical declarations.
   Build the witnesses from `createManagedSurfaceWitnessFactory`, dropping its
   factory and marking each witness `exported`. Reuse the `recordIdentities`
   returned by `createManagedSurfaceReflectors`; each object alias has one
   explicitly bindable optional-witness stub.
2. Link this module with the runtime sources under the same namespace rules as
   `compileArm64Program` (`helpers` = `namespace:export → linkedName`). Run
   `prepareNativeGlobals`, `specializeModule` (no roots: the program has no
   generics), `checkClosureModule` and `prepareCollectionRuntimes(…, transform =
undefined)`.
3. Run `lowerModuleEntries` over all top-level functions with
   `recordBindings: identity` for every stub (resolved through `linked.exports`).
   **No pruning, no optimization, no emission.**
4. Read the facts. A record layout is `module.records[op.record]`, where `op` is
   the stub's single `record-descriptor-address`. A signature is
   `fn.parameters.map(p ⇒ fn.slots[p])` plus `fn.returnType`, where `fn` is the
   witness at `entries.indexOf(source)`. Reject any field carrying `stateOffset`
   as `surface: environment record cannot be a surface layout`.

The synthetic module contains only types, throwing witnesses and operand-free
stubs. Its linked program includes the collection providers needed by lowering;
no application helper implementation is copied. Nothing is emitted or executed,
so it creates no module state and is not the separate application-helper
`specializeCheckedRoots` path the parent plan rejects. It reuses
the application's exact representation functions, so it adds no second
representation algorithm. Linking repeats work over the nine runtimes; measure
the real cost in D4's report (Node: about 1 s).

### 5.2 Demand anchors and generated AOT code (prerequisite shared with D2)

For each generic value `v` with plan root `r`, append to `normalized` (before the
application's `specializeModule`) a non-exported, non-retained anchor:

```ts
function $surface_anchor_i(p0: P0, …): R { return v.local<r.arguments…>(p0, …); }
```

`P*` and `R` come from the canonical function alias. A `void` return uses an
expression statement. Both specialization passes now key `v<args>` by the same
syntactic text, so no extra key appears (test this). Keep `plan.roots` only for
the first pass that feeds `prepareManagedSurfaceTable`; the anchors make them
redundant for the final pass.

Generation splits by dependency:

- **In `normalized`, before specialization** (independent of instance names):
  the canonical declarations `$T*` (reject a pre-existing `$T<digits>` name), the
  64 witnesses for helper-free classes, the 178 identity stubs (one per object
  class representative) and the anchors. Identity stubs are added to `retained` in the transform; ownership uses AST identity. Callback witnesses remain in the application initializer so ordinary managed hoisted initialization creates their function values once.
- **Inside `compileArm64Program`'s `transform`**, which receives each pass's
  specialized module: read each anchor's callee (the instance name), then
  generate `$surface_table(): $T0 { return {f: instance, …}; }`. Rewrite the
  `bind` stub body to
  `return {directory: <literal>, table: $surface_table(), functions: [...], records}`.
  Delete the anchors, then call `prepareModuleInstance`. The transform is pure
  and rebuilt per pass, so `prepareCollectionRuntimes` retries are safe.

AOT code is typed by **canonical** names throughout. The compiler therefore never
needs a raw→canonical alias map (the probe recovered it from spans; production
must not). The raw reification is only the input to canonicalization.

### 5.3 Exact classes

Use the implemented `planManagedSurfaceContracts(surface)` rather than a second
partitioner. It canonicalizes and checks the graph; for each alias in canonical
order, compare it with every existing representative using
`createManagedTypeContractIndex(graph.types).matches`. The first match joins that
class; no match opens a new class. Exact equality is an equivalence relation, so
the result does not depend on comparison order. The representative is the first
member, which p7 confirms is always the lowest `$Tn`. Then require
`physical(member) === physical(representative)` for every member. A failure is
an internal invariant error (`surface: class physical skew $Tn`), never a
reclassification. Classes are never merged across physical identity in either
direction.

### 5.4 Directory content and canonical encoding

Refines parent §5.4. `functions` is the 100 table fields in table order, then
the 64 witnesses in class order. For a class with a helper, `function` is the
lowest table index whose alias is in the class.

| Field                 | Encoding (all integers u32 LE; reject values ≥ 2³²)                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| header                | `str("tint.surface.directory")`, `u32(2)`                                                                                             |
| `name`, `frame`       | `str`; `frame` as `u32(0)` or `u32(1)` + `str`                                                                                        |
| `abi`                 | `u32(nativeSignatureVersion)`, then `u32` count + function-brand words                                                                |
| `types` (v1 envelope) | `u32(version)`, `str(declarations)`, `str(table)`, counted `entries {name, local, type}`, counted `types {name, type}`                |
| `signatures[k]`       | `str(alias)`, counted `aliases`, `u32(function)`, counted `str(parameter)`, `str(returnType)`                                         |
| `records[k]`          | `str(alias)`, counted `aliases`, `u32(byteLength)`, counted fields `{u32 offset, str type, u32 mutable, u32 presence+1 (0 = absent)}` |
| `str(s)`              | `u32(s.length)`, then each UTF-16 code unit as u16 LE. Lone surrogates are preserved                                                  |

`digest` is lowercase hex of `sha256(encoding)` and is excluded from its own
input. Contracts (`tint.surface.v1/<name>/<digest>/fn/<k>`, `…/record/<k>`) are
derived from it and not hashed. The directory contains **no** `$helperN`→linked
name map, no checker type IDs, no record or function indexes of any image, and no
addresses. Physical words appear only as the `ScalarType` strings and layout
numbers above. Encode with a single portable `encodeManagedSurfaceDirectory`,
which the reader (D5) reuses unchanged.

**Dependency.** Import `sha256` from `@tint/foundation/binary/sha256`. Add
`@tint/foundation` to the compiler manifest, its tsconfig project references and
`workspace-contracts.json` (`@tint/compiler` currently lacks it). Regenerate the
catalog, then run `pnpm boundaries`.

### 5.5 Ordered pipeline in `compileArm64Program` (non-empty `managedSurfaces`)

1. Link and resolve selections (D2, unchanged).
2. Run the first application specialization (with roots), then
   `prepareManagedSurfaceTable` (raw reification), then
   `canonicalizeManagedSurfaceTypes`.
3. Compute `deriveManagedSurfacePhysicalFacts` (§5.1), then classes (§5.3), then
   the directory object, encoding and digest (§5.4).
4. Append the canonical declarations, witnesses, stubs and anchors to
   `normalized`. Run the application `specializeModule` and the existing check.
5. Run `prepareCollectionRuntimes(normalized′, checked, helpers, globals,
transform)`. The transform generates the table factory and bind body with the
   directory literal (§5.2).
6. Run `lowerModuleEntries` with `{...options, recordBindings: [...request,
...identity stubs]}`. Do **not** enable `signatureTypes`.
7. **AOT agreement, before pruning.** For each stub, check that
   `lowered.module.records[op.record]` deep-equals the directory layout
   (`byteLength`, then each field's `offset`, `type`, `mutable`, `presenceOffset`,
   `stateOffset`). For each signature class, check that the lowered ABI of its
   `functions[function]` source (`entries.indexOf`) equals the directory ABI. Any
   mismatch fails `surface: AOT layout skew $Tn` or `surface: AOT ABI skew $Tn`.
   No pruning maps are needed: pruning remaps the stub operands and live function
   values itself.
8. Emit as today. Physical signature interning is untouched; several semantic
   labels may resolve to one descriptor or signature pointer.

With `managedSurfaces` absent or empty, steps 2–7 are skipped and `native.code`
stays byte-identical.

### 5.6 Reader preflight contract left for D5

D5 consumes `ManagedSurfaceExport.directory`, so D4 fixes the checks it must be
able to perform **before any leaf call or memory read** (implementation plan:
[D5 directory reader](rt-eval-directory-reader.md)):

1. Check the version and ABI words, then re-encode and compare the digest.
2. Run `restoreManagedSurfaceTypes`, then repartition the classes over the
   restored graph (§5.3, about 8 ms in Node). The partition must equal
   `signatures[*]`/`records[*]` exactly: each function or object alias appears
   once, representatives come first, and the order is canonical.
3. Check counts: `functions.length = entries + witness classes`, every `function`
   index is in range, and `records` (Float64Array) has `records.length` entries.
4. Only then read the domain and issue bindings. Layouts are **not recomputed**
   natively, because that needs collection runtimes. The digest binds them to the
   declarations, and `resolveManagedPointers` verifies the physical words.

## 6. Implementation slices (test-first)

**D4a. Physical facts** (`managed-directory.ts`) — implemented. The public
runtime input also accepts optional `target` and `maxSpecializations` policies.
Node tests, in
`packages/compiler/test/managed-directory.test.ts` for fixtures and
`tools/script-runtime-surface.test.ts` for the real vocabulary:

- A fixture with `unknown[]`, `Map`, `Set`, a recursive `Link`, an optional
  field, and default and optional parameters derives layouts and ABIs. The same
  fixture without runtime sources fails with the X8 error naming `$Tn`.
- Real vocabulary: 189 records, 198 signatures, 164 distinct layouts and 109
  distinct ABIs. No layout carries `stateOffset`.
- The result does not depend on alias-unrelated declarations: shifting checker
  IDs leaves the facts unchanged.

**D4b. Classes and directory** — implemented in `managed-directory-data.ts`. Tests:

- 159/178 classes with lowest-`$Tn` representatives, and zero physical skew.
- An object pair with equal layout but a different field name or mutability is
  two classes on one physical record. A function pair that differs only in
  `minimumArguments` is two classes on one ABI.
- The digest is stable across runs and table prefixes. It changes with one
  mutability, one field name, one alias order, one type-export name or one
  layout offset.
- `"\uD800"` and `"\uD801"` names produce different digests. Encode/decode is
  byte-exact, and values ≥ 2³² are rejected.

**D4c. Anchors and declaration ownership** (`index.ts` internals). Tests:

- An application with generic helpers and a `let` counter compiles with
  `managedSurfaces`. The specialization key set equals the application's demand
  plus the selected instantiations, with no duplicate keys.
- Retained stubs survive `prepareModuleInstance` beside anchors that call
  instance helpers. Zero-span and non-containing-span variants now pass, while
  genuine retained-to-instance captures remain rejected.
- An empty surface leaves `native.code` byte-identical.

**D4d. AOT agreement** (`index.ts`) — wired before pruning; Node tests pass, native validation in progress. Tests:

- The real-vocabulary request lowers with 178 stubs and 64 witnesses, and every
  layout and ABI equals the directory.
- An injected skew (directory layout with one `mutable` flipped) fails with
  `AOT layout skew`, and an ABI skew fails likewise.
- No `managedABI` or `localSignatures` are present in the emit options.

**D4e. Native gates** (`TINT_BUILD_ONLY=1`, serial, after the D2/D3 queues
drain):

- The `verify-hosted-managed-surface-directory.ts --table` fixture extends to
  `--directory`: the stub-returned digest equals the compile-time digest, and
  `records[k]` addresses are positive and stable across GC.
- Run a frozen self-build with byte-identical stages, then the parent §7
  regressions.

## 7. Risks and open points

1. **D6 lowering.** A JIT module whose code calls a surface helper with a
   collection-typed parameter needs collection-runtime bindings that
   `prepareNativeFunctionEntry` lacks (25 function and 32 record aliases, §3.2).
   D6 must either supply them or reject those calls with a clear profile error.
   That is not D4's decision. Planned in [D6 managed entry](rt-eval-managed-entry.md):
   imported AOT runtime entries plus a directory `runtimes` section.
2. **Cost.** The layout program adds about 1 s in Node per surface compile. AOT
   additionally carries 178 stubs, 64 witnesses, 27 deleted anchors and roughly
   50 KB of declaration text plus encoded layouts. Measure the native and
   self-build effect in the D4 report; do not optimize first.
3. **Determinism.** The digest depends on checker union order and interning for a
   fixed source. Stage-identical self-builds prove determinism across Node and
   native; the digest may change across source revisions.
4. **Shared labels.** Seven physical records carry several record contracts. The
   reader must issue one binding per class even when addresses repeat.
   `resolveManagedPointers` keys bindings by contract string, never by address.

**Next:** implement D4a–D4d in order behind the Node gates. Run the D4e native gates
only after the D2 and D3 queues finish.
