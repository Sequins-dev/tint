# RT-EVAL D6d4: runtime link handoff

Status: **D6d4 native handoff passes.**
Canonical export keys, operation-use enumeration, pruning identity maps,
function-entry contracts and the live-domain link wrapper are implemented.
The [native fixture](../results/native-runtime-link-handoff-v1.json) compiles a
string-list program inside the image, imports its AOT helpers, rejects invalid
links and executes repeated growth loops before and after GC pressure with
root-chain restoration. The Node integration test additionally checks one body,
three imports, 16 signature-word reads and unchanged input bytes.

Automatic exact JIT type matching is now implemented and passes the
[native key-selection fixture](../results/native-runtime-link-exact-keys-v1.json). These selectors are not a public language API; this
fixture does not enable general managed Scripts or establish Test262 passes.

Parent:
[directory v3 runtime providers](rt-eval-runtime-directory-v3.md), slice D6d4. This
plan connects the v3 reader's `runtimes` bindings to existing function-entry
patching for JIT-imported runtime operations. It does not reopen the census, the
v3 encoding, the AOT wiring ([D6d3](rt-eval-runtime-aot-export.md)) or the D6f
adapter ([managed JIT entry](rt-eval-managed-jit-entry.md)). Script frames,
eval/`Function` scoping and callback membership are out of scope.

Captured 2026-11-04 (about 19:40) against live source. Compiler, codegen, IR and
`typescript` `dist` files are newer than their sources. In `ts-native`, main's
in-flight `runtime/function-ids.ts` (`runtimeFunctionIds`) is not yet built, and
`runtime/index.ts`, `scalar.ts` and `modules/*.ts` have newer sources. The probes run
on `dist`, so they exclude those changes. They are read-only Node scripts in
`/tmp/tint-runtime-link-handoff-plan` (`p1.mts`, `p2.mts`, with results in
`p1-results.txt`, `p2-results.txt` and `p3-results.txt`). They import `dist` by
absolute path plus `tools/workspace-sources.ts`, emit no image, run no native code
and write nothing in the workspace. **Everything below is Node-only. None of it is
evidence of native linking, calls, GC or conformance.**

## 1. Answer in brief

1. **The chain already works in Node with no new host API.** A surface with one
   `readonly string[]` alias yields the provider `list<$T7>` (slots 0–7),
   `primitive` (8–28) and `number-text` (29–30). That is 31 slots. A JIT module
   `entry(callback:()=>unknown):unknown` builds a `string[]`, pushes twice and
   returns `length`. It is linked with `sparse-list.ts` only, then
   `prepareCollectionRuntimes` runs. `lowerModuleEntries` gets the 8 list option
   IDs as `importedFunctions`. After prune → `optimizeModule` → prune, the result
   is **4 functions: 1 body and 3 imports** (`create`, `push`, `length`). The body
   has the root ABI `(reference)->general`, which is the
   `callExecutableManaged` ABI. Each import's lowered ABI equals the directory
   ABI for slots 0, 3 and 4. `emitModule` with three `managedABI.functions`
   bindings produces three `function-entry` imports, with no brand, signature or
   record. `readManagedSurfaceDirectory` → `selectManagedIdentityBindings` →
   `resolveManagedPointers` (spy host and reader) patches the three entry words
   after 16 window reads. The input code stays zeroed.
2. **What is missing is the compiler step that turns option uses into contracts.**
   Nothing today maps a final import back to `(kind, key, operation)`, computes
   `slot = offset(provider) + operationIndex` or builds the
   `ManagedFunctionEntryBinding`s. The probe did this by hand. D6d4 adds these pure
   functions in one new module. D6f4 and D6f6 then reuse them unchanged.
3. **Authority comes from the key and the operation, never from the ABI.** List
   `has` and `delete` are both `(reference,number)->boolean`. Swapping their
   contracts would pass `selectManagedIdentityBindings` and the window check. So
   the contract must come only from the exact canonical key and the operation
   name. Tests must pin this (§6, L1).
4. **Fail-closed layers already exist below the new code.** Emission, selection
   and resolution each reject the probe's tampered cases before any patch (§3, §7).
5. **Key derivation in D6d4 is exact but caller-asserted.** The JIT names a surface
   type export (for example `Names`). D6d4 resolves that through
   `read.contracts.surface.types` → canonical alias → census anchor → provider. In
   the probe, `Names` → `$T3` → provider 0 = `list<$T7>`. Associating that key with
   a JIT list binding is the caller's statement. Deriving it from the JIT element
   type (S(e) under the contract index) is D6f4. The JIT never chooses by ABI or
   address.

## 2. Present versus planned (verified against source)

| API                                                                                                          | State                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `readManagedSurfaceDirectory` → `runtimes: ManagedIdentityBinding[]` (`managed-directory-reader.ts:185-317`) | Present. Entries are validated before `host.domain()`; `entry`/`address` per slot      |
| `managedSurfaceContract(name, digest, "runtime", slot)` (`:54`)                                              | Present                                                                                |
| `selectManagedIdentityBindings(read, imports)` pools brand, signatures, records and runtimes (`:344-394`)    | Present. Checks exact contract, role, domain, signature and layout; makes no reads     |
| `resolveManagedPointers(native, bindings, readWord, domain)` (`managed-imports.ts:206`)                      | Present. Entry `%4`, window words before any patch, patches `entry` for function-entry |
| `ManagedABIRequest.functions: ManagedFunctionEntryBinding[]` (`codegen/.../scalar/index.ts:306-314,863-911`) | Present. Rejects non-import, duplicate, ABI mismatch and unbound imports               |
| `ModuleEntryOptions.importedFunctions`; `lowerModuleEntries(...).entries`                                    | Present                                                                                |
| `pruneClosedModule` (`ir/optimization/reachable.ts:26`), `optimizeModule`                                    | Present. Returns `functionIds` (old → new+1)                                           |
| `planManagedSurfaceRuntimes(read.contracts)` (`managed-runtimes.ts:55`), `anchors`                           | Present. `read.contracts` has `{surface, checked}`                                     |
| `runtimeFunctionIds(options)` (`ts-native/src/runtime/function-ids.ts`)                                      | **In flight on main** (source and test present, `dist` absent)                         |
| `adaptManagedSurfaceEntry`                                                                                   | Present, single specifier. D6f2 is not landed and **not needed** here                  |
| `prepareManagedSurfaceEntry`, S(e) selection (D6f4), `managed-runtime-selection.ts`                          | **Planned (D6f)**                                                                      |
| `managed-link.ts`                                                                                            | **Does not exist.** No module of that name is proposed                                 |
| Key→slot, use description, binding builder and link wrapper                                                  | **Planned here (§4)**                                                                  |

## 3. Probe results (Node only)

| Probe | Question                                                                  | Result                                                                                           |
| ----- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| p1    | Directory for `names(readonly string[])`, `make():string[]`, type `Names` | 3 providers / 31 slots; anchors `$T3,$T4,$T6` → provider 0; `Names` → `$T3`; layout 220 ms       |
| p1    | JIT linked with all 11 runtime sources                                    | 39 option imports; prune/opt/prune leaves 3 imports (create/push/length), all ABIs agree         |
| p2    | JIT linked with `sparse-list` (+`number-list`) only                       | 8 option imports → the same 3 final imports; JIT link to lower 8 ms                              |
| p2    | `emitModule` with 3 bindings                                              | `unresolved-managed`; 3 `function-entry` imports at offsets 1008/1016/1024; no brand             |
| p2    | Emit with one binding's `returnType` changed, or one missing              | `imported function ABI mismatch` / `unbound imported function requires a function-entry binding` |
| p2    | Read (spy) → select → resolve                                             | 31 runtime bindings; contracts `runtime/0,3,4`; 16 reads; 3 entry words patched; input zeroed    |
| p2    | Last window word wrong                                                    | `Managed identity descriptor differs` after 15 reads; no code                                    |
| p2    | Push import carrying the length contract                                  | `surface reader: import shape differs`                                                           |
| p2    | Resolve with domain 18 against a read in domain 17                        | `Managed identity belongs to a different context domain`, 0 reads                                |
| p3    | `entry(callback:()=>unknown):unknown`, `sparse-list` only                 | root `(reference)->general`; 3 imports; returning a number as `unknown` adds no primitive import |

The list encoding is `optional-string` for `read`/`write`/`push`, as in the v3
census. The JIT list binding's `element` is the encoding `"string"`, not a type.
Several JIT array types with one encoding share one binding
(`runtime-requirements.ts:53-58`). That is why key association needs D6f4 for
exactness (§4.5).

## 4. Design

New module `packages/compiler/src/native/managed-runtime-selection.ts`, which is
the file D6f4 already planned. Every function is pure. Errors use the D6f
`profile: ` prefix, and a failing function returns before anything is emitted or
read.

### 4.1 Exact key → slot

```ts
export interface ManagedRuntimeKey {
  readonly kind: "list" | "set" | "map" | "primitive" | "number-text";
  readonly element: string; // canonical alias; "" for primitive/number-text
  readonly value: string; // map value alias; "" otherwise
}
export interface ManagedRuntimeSlot {
  readonly slot: number;
  readonly contract: string; // tint.surface.v1/<name>/<digest>/runtime/<slot>
  readonly parameters: readonly ScalarType[];
  readonly returnType: ReturnType;
}
export function selectManagedRuntimeSlot(
  directory: SerializedManagedSurfaceDirectory,
  key: ManagedRuntimeKey,
  operation: string,
): Result<ManagedRuntimeSlot>;
```

The function walks `directory.runtimes` in order and accumulates the slot offset.
It takes the **first** provider with equal `kind`, `element` and `value`. Keys are
deduplicated by the census, so this provider is unique today. The operation index
comes from `operations.findIndex(o => o.operation === operation)`. If there is no
provider or no operation, it fails with
`profile: <kind><<element>[,<value>]>.<op> is not provided by the surface`. This
covers list `sort`, which is absent from the vocabulary. The function never
consults ABI words, entries or other providers' ABIs.

### 4.2 Surface type export → key (D6d4 key source)

```ts
export function managedRuntimeKeyForSurfaceType(
  read: ManagedSurfaceDirectoryRead,
  exportName: string,
): Result<ManagedRuntimeKey>;
```

The export's `read.contracts.surface.types` entry must be an argument-free
`named` alias (else `profile: surface type export is missing: <name>`). The anchor
of that alias in `planManagedSurfaceRuntimes(read.contracts)` gives the provider
key (else `profile: surface type is not a runtime collection: <name>`). Primitive
and number-text keys are constants. Only the restored, canonicality-checked
directory is used: no AOT graph, JIT graph or linked names.

### 4.3 Final imports → option uses

```ts
export interface ManagedRuntimeUse {
  readonly key: ManagedRuntimeKey;
  readonly operation: string; // vocabulary name, e.g. "push", "iterator.read"
}
export interface ManagedRuntimeKeys {
  // aligned with options.lists/sets/maps; undefined = binding not on the surface
  readonly lists: readonly (ManagedRuntimeKey | undefined)[];
  readonly sets: readonly (ManagedRuntimeKey | undefined)[];
  readonly maps: readonly (ManagedRuntimeKey | undefined)[];
}
/** checked source function ID → every option use naming it. */
export function describeManagedRuntimeUses(
  options: ModuleEntryOptions,
  keys: ManagedRuntimeKeys,
): Result<ReadonlyMap<number, readonly ManagedRuntimeUse[]>>;
export function finalFunctionSources(
  entries: readonly number[], // lowerModuleEntries(...).entries
  prunings: readonly Uint32Array[], // pruneClosedModule(...).functionIds, in order
  count: number, // final module.functions.length
): readonly (number | undefined)[]; // final id → checked source id
```

- Field names map to vocabulary names exactly as `listOperations`,
  `setOperations` and `mapOperations` spell them. Iterator fields become
  `iterator.create`, `iterator.advance`, `iterator.read`, `iterator.key` and
  `iterator.value`. `options.numberToString` and `numberFromString` become
  `number-text` `toString` and `fromString`. Primitive fields keep their names. List
  `sort` is emitted as a use and then rejected by §4.1.
- A collection binding with `keys[i] === undefined` contributes no uses. If one of
  its functions survives as an import, §4.4 rejects it.
- `finalFunctionSources` composes `entries[old]` through each pruning
  (`ids[x] - 1`, where 0 means removed). It reuses the D6f3 §4.3 step 3 mapping, so
  that mapping exists once. Main's `runtimeFunctionIds(options)` supplies
  `importedFunctions`. With every binding keyed, a test asserts that the source IDs
  of `describeManagedRuntimeUses` equal `runtimeFunctionIds` as a set.

### 4.4 Uses → `ManagedFunctionEntryBinding[]`

```ts
export function bindManagedRuntimeImports(
  read: ManagedSurfaceDirectoryRead,
  module: ModuleIR, // final, pruned module that will be emitted
  sources: readonly (number | undefined)[],
  uses: ReadonlyMap<number, readonly ManagedRuntimeUse[]>,
): Result<readonly ManagedFunctionEntryBinding[]>;
```

For each `module.functions[i]` with `import === true`, in ID order:

1. Find `src = sources[i]` and its uses `u = uses.get(src)`. If either is missing,
   fail with `profile: runtime import has no surface use: <fn.name>`.
2. Call `selectManagedRuntimeSlot(read.directory, use.key, use.operation)` for each
   use. All uses must give one slot, otherwise
   `profile: runtime import selects two surface slots`. An ABI-equal pair of slots
   is not merged.
3. The lowered ABI (`fn.parameters.map(s => fn.slots[s])`, `fn.returnType`) must
   equal the slot ABI, otherwise
   `profile: runtime ABI skew <kind><<element>>.<op>`.
4. Emit `{function: i, name: "$runtime" + i, contract, parameters, returnType}`.
   The name is a local symbol only. Two imports may share a contract.

The function never reads `read.runtimes[slot].entry` or `address`. Those are link
inputs only.

### 4.5 Link wrapper (`managed-directory-reader.ts`)

```ts
export function linkManagedSurfaceModule(
  read: ManagedSurfaceDirectoryRead,
  native: NativeModule,
  readWord: ManagedIdentityReader,
  domain: number, // current host domain, re-read by the caller just now
): ManagedPointerResolution;
```

The order is fixed: (1) `domain !== read.domain` rejects with
`surface link: context domain changed`; (2) `selectManagedIdentityBindings(read,
native.managedImports)`; (3) `resolveManagedPointers(native, selected, readWord,
domain)`, which preflights structure, reads every window, then patches a copy.
Steps 1–2 never read memory.

There is no publication: the caller maps, registers and writes, as
`EngineCodeStorage.publish` does. The wrapper fixes one order and domain recheck
for the fixture, D6f6 and the engine. `dynamic-function.ts` keeps its direct
`resolveManagedPointers` call (no surface).

### 4.6 Out of scope here (D6f)

S(e), which fills `ManagedRuntimeKeys` from aliases that exactly `match` a JIT
element type (D6f4); adaptation, frames, normalization and callback membership
(D6f1/D6f2/D6f5); engine integration and Script execution. In D6d4 the caller
supplies keys, and the fixture asserts that its only `string` list binding is
`Names`.

## 5. File edits

| File                                                     | Edit                                                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `compiler/src/native/managed-runtime-selection.ts` (new) | §4.1–§4.4. Imports types only from `@tint/ts-native/closure/lowering`, `@tint/ir/scalar` and `@tint/codegen/aarch64/scalar`, which are existing dependencies |
| `compiler/src/native/managed-directory-reader.ts`        | add `linkManagedSurfaceModule` (§4.5); fix the stale `"surface record binding invariant"` text on the runtimes loop                                          |
| `compiler/src/native/index.ts`                           | export the new functions and types beside the reader/runtimes blocks (`:1199-1237`)                                                                          |
| `compiler/test/managed-runtime-selection.test.ts` (new)  | L1–L3                                                                                                                                                        |
| `compiler/test/managed-directory-reader.test.ts`         | L4 (link wrapper)                                                                                                                                            |
| `tools/verify-hosted-managed-runtime-link.ts` (new)      | native fixture (§8). **Do not** edit `verify-hosted-managed-surface-directory.ts` while its Script run and the self-build are queued                         |
| `compiler/src/catalog.ts`                                | regenerate with `node tools/generate-compiler-catalog.ts`, then format                                                                                       |

No package, manifest, codegen, IR, host operation or `CompiledProgram` change is
needed. Surface-free images are unaffected because no AOT path changes.

## 6. Test-first slices

Each slice starts red, then gets its implementation, `pnpm build` and focused
tests. Build fixtures with the existing helpers: `reifyManagedSurfaceTypes` →
`canonicalizeManagedSurfaceTypes` → `deriveManagedSurfacePhysicalFacts` (real
`runtimeSources()`) → `createManagedSurfaceDirectory`, then a fake export with
entries `0x800000+16s` / `0x900000+64s`, as `p2.mts` does.

**L1, slot selection** (pure, directory only):

- `list<$T7>`: `create` → 0, `push` → 3, `length` → 4.
- `primitive.fromNull` → 8 and `number-text.fromString` → 30.
- Each contract equals `managedSurfaceContract(name, digest, "runtime", s)`.
- **Equal ABI:** `has` → 5 and `delete` → 6 give different contracts with
  identical ABIs.
- With an inserted second list provider, keys still select by alias. The second
  provider's `create` gets offset 8.
- Negatives: an unknown element alias, list `sort`, a set operation on a list key,
  a map key with the wrong `value`, and an empty-string element on a list. Each
  gives `is not provided by the surface`.
- A directory whose provider ABI was edited and re-digested still selects the same
  slot. The returned ABI is the edited one, so skew is caught in L3.

**L2, key source and use description:**

- `managedRuntimeKeyForSurfaceType(read, "Names")` gives
  `{list, "$T7", ""}`.
- A missing export and a record or function export give their errors.
- `describeManagedRuntimeUses` over real `prepareCollectionRuntimes` options
  (`sparse-list` only) with `keys.lists = [Names]` gives 8 source IDs. Each maps to
  one use. They equal `runtimeFunctionIds(options)` as a set, so this test lands
  after main's helper.
- A synthetic options object where one function serves two fields gives two uses.
- `finalFunctionSources` over two synthetic prunings, including a removed ID,
  yields `undefined` for that ID.

**L3, bindings from a real JIT lowering** (the p2/p3 pipeline in a test helper):

- 3 bindings with contracts `runtime/0,3,4`, in final import ID order.
- `emitModule` accepts them and yields 3 `function-entry` imports whose
  contracts equal the bindings.
- Negatives, each before `emitModule`: `keys.lists = [undefined]` gives
  `runtime import has no surface use`; the edited-ABI directory from L1 gives
  `runtime ABI skew list<$T7>.push`; a synthetic import used as both `has` and
  `delete` gives `selects two surface slots`.

**L4, link wrapper** (spy host and spy reader, extending
`managed-directory-reader.test.ts`):

- Success patches exactly the selected `entry` words at the import offsets. The
  input `native.code` is unchanged, and the read count equals the sum of window
  words (16 for the three imports).
- Zero reads and no `code` for: a changed domain, an unknown contract, a role
  swap, a push import carrying the length contract (`import shape differs`), a
  read whose selected runtime binding has `entry + 2`, and a duplicate import name.
- A late window mismatch, on the last import's last word, reads up to the mismatch
  and returns no `code`.
- A has/delete contract swap on ABI-equal imports passes the wrapper by design.
  This documents that L1/L3 own semantic authority. Keep it as an explicit test
  with that comment.

## 7. Observable failure cases

| Case                                                                  | Stage         | Result                                                            |
| --------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| Element alias, kind, map value or operation not in directory          | select (§4.1) | `profile: <kind><<key>>.<op> is not provided by the surface`      |
| Surface export missing or not a collection                            | key (§4.2)    | `surface type export is missing` / `is not a runtime collection`  |
| Import without a key or use                                           | bind (§4.4)   | `profile: runtime import has no surface use: <name>`              |
| One import, two slots                                                 | bind          | `profile: runtime import selects two surface slots`               |
| Directory ABI ≠ lowered import ABI (incl. re-digested edit)           | bind          | `profile: runtime ABI skew <kind><<key>>.<op>`                    |
| Binding ABI ≠ import (bypassing bind)                                 | emit          | `imported function ABI mismatch`                                  |
| Import left unbound                                                   | emit          | `unbound imported function requires a function-entry binding`     |
| `entries` count/word bad (entry `%4`, window `%8`, ≤0, NaN, ≥2^53)    | read          | `runtime entry …`, before `host.domain()`                         |
| Unknown contract, role crossing, wrong signature words in the request | select (link) | `unknown import contract` / `import shape differs`, 0 reads       |
| Host domain changed since read                                        | link (§4.5)   | `surface link: context domain changed`, 0 reads                   |
| Binding domain ≠ expected                                             | resolve       | `different context domain`, 0 reads                               |
| Misaligned entry in binding                                           | resolve       | `Invalid permanent function entry`, 0 reads                       |
| Window words differ (any import)                                      | resolve       | `Managed identity descriptor differs`; no `code`, nothing patched |
| ABI-equal providers' pairs swapped inside the export                  | —             | not detectable by words; excluded by export provenance (v3 §4.5)  |

Every failure returns before `writeExecutableMemory`. `resolveManagedPointers`
patches only a fresh copy and only after every window has been read.

## 8. Native fixture recipe (planned; not run)

New `tools/verify-hosted-managed-runtime-link.ts`, which follows
`verify-hosted-function-addresses.ts` (JIT and executable memory) and the
`sharedRuntime` half of `verify-hosted-managed-surface-directory.ts` (surface and
reader).

- **Helpers module.** `export type Names = readonly string[]`, plus
  `names(values:readonly string[]):number`, `make():string[]` and the usual
  throwing `bind():ManagedSurfaceExport`. The surface request is
  `{name:"linkRuntime", values:[names, make], types:[Names], bind}`.

- **Embedded JIT sources.** `sparse-list.ts`, which has no imports and is 6 KB, is
  read on the Node side and inserted with `JSON.stringify`, as
  `verify-hosted-runtime-linking.ts` does. The JIT source is the p3 entry with a
  growth loop:
  `entry(callback:()=>unknown):unknown{const v:string[]=[];for(let i=0;i<100000;i++)v.push("a");return v.length;}`.
  List growth allocates in AOT runtime code while `v` lives only in the JIT frame.
- **Image modules.** `source`, `syntax`, `binding`, `linking`, `checker`,
  `runtime`, `lowering`, `optimization` (`ir/src/optimization`), `emitter`,
  `compiler` and `memory`.
- **Options.** `allowJit: true`, the copying runtime, 64 MiB managed and a 16 MiB
  stack. Host bindings: `native-value-function-descriptor`/`-signature`,
  `context-domain`, `memory-read-word`, `executable-map`, `executable-write`,
  `external-memory-register` and `executable-call-managed`.

`run()` statuses (final 42):

1. `bind()`, then `readManagedSurfaceDirectory(exported,"linkRuntime",host)`. Check
   `runtimes.length === entries.length/2` (status 1).
2. `managedRuntimeKeyForSurfaceType(read,"Names")` (2).
3. JIT link, bind, globals, specialize, check, `prepareCollectionRuntimes`,
   `lowerModuleEntries` (`importedFunctions: runtimeFunctionIds`), prune, optimize,
   prune (3–6). Assert exactly one list binding with element `"string"` before
   asserting its key (7). That is the D6d4 caller assertion.
4. `describeManagedRuntimeUses`, `finalFunctionSources`,
   `bindManagedRuntimeImports`, then 3 bindings (8). `emitModule` with
   `closedRoots:[root]` and `managedABI.functions` (9).
5. **Rejections, before any publish:**
   - a copy of the export with `entries[0]+=2` gives a read failure with no
     domain/descriptor leaf call, counted by wrapping `host` (10);
   - an import list with a foreign contract gives a link failure and 0 reads (11);
   - `linkManagedSurfaceModule` with `domain+1` gives 0 reads (12);
   - a binding set where the `length` import's window address is replaced by the
     `push` slot's signature word gives `descriptor differs`, reads > 0 and no
     `code` (13). Use `resolveManagedPointers` directly, because selection would
     reject it.
6. `linkManagedSurfaceModule(read, native, readMemoryWord, currentContextDomain())`
   succeeds (14).
7. Map, `registerExternalMemory` and write the linked code (15). Call
   `callExecutableManaged(arena+entry.offset, ()=>undefined)` and expect `100000`
   (16). Churn 32 MiB of `Uint32Array`, call again and expect `100000` (17).

**Build and record (main's serial queue).** Run this only after the current
Script-surface fixture and the queued frozen self-build finish. Inspect the live
processes first and do not disturb them.

1. Run `TINT_BUILD_ONLY=1 node tools/verify-hosted-managed-runtime-link.ts`
   with output to `.tint-bootstrap/runtime-link-native-build-v1.log`. The last line
   is the binary path, and `<binary>.manifest.json` captures the source snapshot
   and arguments.
2. Write a runner modeled on
   `.tint-bootstrap/run-runtime-directory-v3-validation-v1.mjs`:
   - wait for the build log and manifest;
   - take the cooperative pause (`.tint-bootstrap/native-behavior-v9.pause`, with
     `{flag:"wx"}`, then wait for `.ack` in state `between-variants`). Check the
     current pause name and the owning PID against the live process at that time.
     Do not copy the old PID;
   - call `recordNativeFixture` with the binary, `manifest.fixture`, report
     `docs/results/native-runtime-link-handoff-v1.json`, `timeoutMs: 120000` and
     related reports `native-runtime-directory-v3-v1.json` and
     `native-function-entry-call-v1.json`;
   - remove the pause in `finally`.
3. Assert stop-at-entry and exit 42 under LLDB. Keep failed observations, and
   distinguish launch failures from faults after execution begins. Do not retry.
4. New compiler sources call for a later frozen self-build with byte-identical
   stages. No codegen change is involved.

## 9. Fit with D6f

- **D6f3** (ABI-only lowering) provides `runtimeFunctionIds` and the
  entry-to-pruning composition, which D6d4 places in `finalFunctionSources`.
- **D6f4** replaces the caller-supplied `ManagedRuntimeKeys` with S(e). For each
  JIT requirement type, it takes the aliases whose JIT type exactly `matches`,
  then the first provider in directory order. It calls `selectManagedRuntimeSlot`
  and `bindManagedRuntimeImports` unchanged. Two keys for one JIT binding
  (`$T472`/`$T475`) are resolved inside D6f4 before `keys` is filled.
- **D6f6** `prepareManagedSurfaceEntry` returns `abi.functions` from
  `bindManagedRuntimeImports`, merged with B8 signatures and records. Its link step
  is `linkManagedSurfaceModule`. D6f §4.7's sequence becomes one call.
- **D6g** reuses the §8 fixture shape for its list cases (D6f §7 items 1–2). The
  D6f §7 reject case "tampered provider ABI" maps to L1/L3 skew plus the window
  check.

## 10. Blockers and risks

1. **`runtimeFunctionIds` is in flight.** L2's equality test and the fixture use
   it. L1, L3 (using the probe's local walk) and L4 do not need it.
2. **Native queue.** The fixture must wait for the Script-surface run and the frozen
   self-build. It does not depend on B8, D6f2 or a Script frame.
3. **Native unknowns.** Whether patched `function-entry` calls into AOT runtime
   code preserve JIT frame roots during runtime allocation is unproven for this
   pairing. The prior native evidence covers a number-only entry
   ([call](../results/native-function-entry-call-v1.json)), managed invocation and
   directory reads, but not a JIT-held reference across an AOT allocation. Statuses
   16/17 are the first evidence. A fault there is a root-map defect, not a link
   defect. Record it and do not mask it.
4. **Native compile cost.** Linking and checking `sparse-list` in the image is
   comparable to `verify-hosted-runtime-linking.ts`. Measure; set no target.
5. **Caller-asserted keys.** Until D6f4, a wrong association with an ABI-equal
   provider (for example a hypothetical second `optional-string` list key) would
   link to the wrong collection. Keep D6d4 APIs internal to tests and fixtures.
   No engine path may call them with keys it did not derive.
6. **Shared helpers.** A function serving two vocabulary names is rejected
   (`two surface slots`); q2 found none on the Script surface. Do not relax this.

## 11. Defaults main can take without asking

One new module (`managed-runtime-selection.ts`) plus the wrapper in the reader
file; first provider in directory order; local names `"$runtime" + functionId`;
`profile: …` errors on the compile side; fixture `Names = readonly string[]` with
`sparse-list` only; report `native-runtime-link-handoff-v1`.

**Next implementation slice:** L1 → L3 → L4 (pure, Node), then L2 once
`runtimeFunctionIds` builds, then the §8 fixture on the serial queue.
