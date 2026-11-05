# RT-EVAL S1 D5: directory reader, preflight and domain-stamped bindings

Status: **reader, selector and shared shape helpers implemented; native fixtures
and the frozen D5 fixed point pass.** Evidence:
[native compiler](../results/native-managed-directory-reader-compiler-v1.json),
[real identities and GC](../results/native-managed-directory-reader-runtime-v1.json),
[frozen-source checkpoint](../results/managed-directory-reader-capacity-checkpoint-v1.json).
The checkpoint includes the proven compiler heap-budget adjustment. Newer D6
source needs a separate fixed point.
U1 is resolved by explicit `native-value-function-descriptor/signature` leaves:
they check the general tag and native function brand, and return unavailable for
non-functions without asserting a callable signature. The research below records
the original source snapshot and design findings. Parent: [surface directory](rt-eval-surface-directory.md)
§5.6 and slice D5. Inputs: [D4 layouts and directory](rt-eval-directory-layouts.md)
§5.6, which fixes the preflight D5 must perform, and
[D6 managed entry](rt-eval-managed-entry.md), the first consumer, which extends the
reader with `runtimes` (§4.4, D6e). This document answers one question: what
exact portable function turns a retained `ManagedSurfaceExport` into
domain-stamped `ManagedIdentityBinding`s, in which order it may touch leaves, and
which tests prove that it fails before any leaf call or memory read. JIT entry
preparation, codegen imports, the Script frame (S2) and the engine-owned per-domain
cell are out of scope; they appear only as contracts.

Captured 2026-11-04 against live source identity `35ac5f1f…` (528 files,
`workspaceSourceIdentity`). Main is implementing D4c (automatic AOT surface export,
bind-stub integration) and D4d (`verifyManagedSurfacePhysicalAgreement` is already
in `managed-directory-data.ts`). No code in the tree defines `ManagedSurfaceExport`
or a reader yet. The probes are read-only Node scripts in
`/tmp/tint-directory-reader-plan` (`p1`–`p3`). They import public `dist` entry
points plus `tools/workspace-sources.ts`, rebuild the real 100-helper directory as
`tools/script-runtime-surface.test.ts` does, run with the workspace as the working
directory and write nothing there. **They are non-native evidence: no native
conformance, native equality or performance claim follows from them.** Times are
single Node runs.

## 1. Answer in brief

1. **Rebuild, then compare one digest.** After cheap explicit header checks, the
   reader restores the types, expands each directory class into physical facts and
   reruns the producer's own `createManagedSurfaceDirectory`. The rebuilt digest
   must equal the stored digest. One call re-derives the classes, representatives,
   alias coverage, canonical names, helper/witness `function` indexes, frame
   validity, version and ABI words without a second partitioner or comparator
   (§3.2, p3: 72 ms in Node for the real vocabulary).
2. **The reader dereferences nothing.** It calls only `domain()`, `descriptor(fn)`
   and `signature(fn)`, all after every structural check, and never `readWord`.
   Word reads stay inside `resolveManagedPointers`, after its own complete
   preflight and domain check. There is no second pointer-read abstraction.
3. **The digest is not an authenticator.** A coordinated edit of declarations or
   layouts with a recomputed digest passes every structural check (§3.3). Authority
   comes from provenance: the export is the image's own bind-stub result, held in
   an engine-owned rooted cell. Physical tampering of traced words or signature
   codes is still caught by `resolveManagedPointers`. A layout edit that disagrees
   with the declarations is caught when D6 lowers the restored declarations and
   compares layouts. Non-traced field facts carry no further proof.
4. **Bindings are pooled by contract and selected per module.**
   `resolveManagedPointers` requires exactly one binding per import, matched by
   `name`. The reader issues a complete pool with `name = contract`, and a small
   selector picks the subset that a JIT module imports.
5. **Stay at v2 for D5; D6d moves to v3 in one step.** Producer and reader share a
   single version constant. D6d bumps it, adds `runtimes` to the encoder, the facts
   and the reader together, and keeps no v2 decoder. The directory never leaves
   the image that produced it (§6).
6. **Missing primitives** (§7): the `ManagedSurfaceExport` type, a shared version
   constant, an exported identity-window helper in `managed-imports.ts`, the
   selector, and **a leaf profile that accepts `unknown` function values**. The
   last is the only open native question.

## 2. Current primitives (read in source)

| Primitive (file)                                                                                      | What D5 reuses                                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `encodeManagedSurfaceDirectory`, `digestManagedSurfaceDirectory` (`managed-directory-data.ts`)        | Byte-exact v2 encoding; rejects `stateOffset`, holes and values ≥ 2³²; lowercase hex SHA-256                                             |
| `createManagedSurfaceDirectory` (same)                                                                | Plans classes, checks per-class physical skew, frame record, alias coverage (`facts contain aliases outside the surface`), witness order |
| `restoreManagedSurfaceTypes` / `serializeManagedSurfaceTypes` (`managed-surface-text.ts`)             | Envelope v1 only; parse with no imports; recheck; table fields equal helper list; distinct helper and type-export names                  |
| `planManagedSurfaceContracts` (`managed-contracts.ts`)                                                | Canonicalize, check, exact partition with lowest-`$Tn` representatives                                                                   |
| `ManagedIdentityBinding`, `resolveManagedPointers` (`managed-imports.ts`)                             | Domain check before reads; complete structural preflight; `descriptorWords`; window = `8 · words`; private code patch                    |
| `DynamicFunctionCodeHost` (`js-engine/src/dynamic-function.ts`)                                       | Existing `domain`/`descriptor`/`signature`/`readWord` host shape and the `ensureDomain` before/after pattern                             |
| Host operations `native-function-descriptor`/`-signature`, `context-domain` (`ir/src/scalar/host.ts`) | Pure leaves. Reflection returns `-1` for zero or out-of-range words. `context-domain` returns `0` when unissued                          |

Facts that constrain the design:

- `resolveManagedPointers` rejects unless `bindings.length === native.managedImports.length`,
  and matches each binding to an import by `name` (`managed-imports.ts:315-357`). A
  reader therefore cannot hand it the whole directory.
- `descriptorWords` is private. The record window is `8 · (3 + references + generals)`
  = `24 + 8n`, the brand window is 32 bytes (object size 48) and the signature
  window is `nativeSignatureHeaderByteLength + 8 · parameters`. The traced-type set
  lives only there; D5 must not copy it.
- `bindHostOperations` requires each bound declaration's parameter slots to equal
  `hostParameters` exactly (`ir/src/scalar/host.ts:145-175`). Reflection takes
  `["reference"]`. A declaration parameter typed `unknown` lowers to `general` and is
  rejected. The existing native profiles are typed callbacks
  (`nativeFunctionDescriptorWithIndex(callback: (base, step) => unknown)`).
- `createManagedSurfaceDirectory` validates the name only as non-empty and NUL-free,
  but contract strings embed it between `/` separators.

## 3. Probe results (Node, non-native)

### 3.1 Real directory and preflight costs (p1)

| Fact                                                        | Value                                     |
| ----------------------------------------------------------- | ----------------------------------------- |
| version, signature classes, record classes                  | 2, **159**, **178**                       |
| helpers, type exports, witnesses, `functions.length`        | 100, 18, 64, **164**                      |
| function plus object aliases, each covered exactly once     | 387, 0 duplicates                         |
| encoding bytes; digest recompute                            | 162,244 bytes; equal; 3 ms                |
| `restoreManagedSurfaceTypes`; `planManagedSurfaceContracts` | ok, 11 ms; ok, 43 ms                      |
| canonical fixpoint `serialize(plan.surface)` = stored types | **true**                                  |
| partition and `function` indexes recomputed from restore    | equal; equal                              |
| record window min/max; table `byteLength`                   | 24 / 824 bytes; 816                       |
| largest signature arity; `frame`                            | 9; `undefined` (no frame in this request) |

The table record's readable descriptor window (824) and its object size (816)
differ, as do every other record's. D5 must never use `layout.byteLength` as a
window.

### 3.2 Rebuild and compare (p3)

Expanding each class into `{alias, layout}`/`{alias, parameters, returnType}` facts
for every member and calling `createManagedSurfaceDirectory(name, restored, facts, frame)`
reproduces the stored digest for the untampered directory (72 ms including
restore). Tampered inputs with a **recomputed** digest:

| Tamper (digest recomputed)                   | Rebuild outcome                                            |
| -------------------------------------------- | ---------------------------------------------------------- |
| two signature classes swapped                | rebuilt digest differs                                     |
| record alias moved into a new class          | rebuilt digest differs                                     |
| record alias removed                         | `class physical skew: $T128` (missing fact; remap message) |
| `function` index changed                     | rebuilt digest differs                                     |
| helper local `$helper0` → `$helper99`        | rebuilt digest differs (canonical fixpoint)                |
| ABI signature version, brand word, version 3 | rebuilt digest differs                                     |
| `frame` names an unknown export              | `frame must name an exported record`                       |
| field with `stateOffset`                     | encoder: `environment state is not a surface layout`       |
| `name` changed                               | **accepted**: check against the expected name              |
| number-field `mutable` flipped               | **accepted**                                               |
| parameter `reference` → `general`            | **accepted**                                               |
| first `readonly ` removed from declarations  | **accepted**                                               |

Digest-only tampering fails at the first comparison. Renaming `$T5` throughout the
declarations fails `restore` (`managed helper requires a declared function alias`).

### 3.3 What catches the accepted tampers

| Accepted tamper                                    | Later check                                                                                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| name                                               | Reader: `directory.name === expected` (§4.3 step 2)                                                                                            |
| signature code                                     | `resolveManagedPointers` compares signature words (when the module imports that class)                                                         |
| traced record offset/count                         | `resolveManagedPointers` descriptor words                                                                                                      |
| non-traced field type/mutability, `presenceOffset` | D6 step 8: the JIT lowering of the restored declarations must equal the directory layout (`sameRecordLayout`), when declarations are untouched |
| coordinated declarations + layouts                 | **None.** Provenance only: the export came from this image's bind stub                                                                         |

This boundary belongs in the tests (§5, R-12) so that no later document calls the
digest tamper-proof.

## 4. Design

### 4.1 Location and dependencies

New `packages/compiler/src/native/managed-directory-reader.ts`, re-exported from
`@tint/compiler/native`. It imports only `managed-directory-data.ts`,
`managed-surface-text.ts`, `managed-contracts.ts` (types), `managed-imports.ts` and
`@tint/abi/function`. It must **not** import `managed-directory.ts` (the layout
program), `ts-native` lowering or runtime sources: it runs inside the image beside
the existing dynamic-function compiler. No package, manifest or catalog changes.

### 4.2 Public contract

```ts
/** Returned by the compiler-bound stub. Values only; permanent code data. */
export interface ManagedSurfaceExport {
  readonly directory: SerializedManagedSurfaceDirectory;
  readonly table: unknown;
  readonly functions: readonly unknown[]; // table fields, then witnesses
  readonly records: Float64Array; // descriptor addresses, record-class order
}
/** Trusted pure leaves of the image that owns the export. */
export interface ManagedSurfaceDirectoryHost {
  readonly domain: () => number; // context-domain; 0 = unissued
  readonly descriptor: (fn: unknown) => number; // -1 = unavailable
  readonly signature: (fn: unknown) => number; // -1 = unavailable
}
export interface ManagedSurfaceDirectoryRead {
  readonly domain: number;
  readonly directory: SerializedManagedSurfaceDirectory; // rebuilt snapshot
  readonly contracts: ManagedSurfaceContractPlan; // reader-owned graph for D6
  readonly brand: ManagedIdentityBinding;
  readonly signatures: readonly ManagedIdentityBinding[]; // index = class k
  readonly records: readonly ManagedIdentityBinding[]; // index = class k
}
export function readManagedSurfaceDirectory(
  exported: ManagedSurfaceExport,
  expectedName: string,
  host: ManagedSurfaceDirectoryHost,
):
  | { ok: true; value: ManagedSurfaceDirectoryRead }
  | { ok: false; error: string };

export function managedSurfaceContract(
  name: string,
  digest: string,
  kind: "fn" | "record",
  index: number,
): string; // tint.surface.v1/<name>/<digest>/<kind>/<index>

export function selectManagedIdentityBindings(
  read: ManagedSurfaceDirectoryRead,
  imports: readonly NativeManagedPointerImport[],
):
  | { ok: true; value: readonly ManagedIdentityBinding[] }
  | { ok: false; error: string };
```

`expectedName` is the request name the embedding bound (`CompileRequest.managedSurfaces[i].name`).
The directory is self-describing, so its name is no authority (§3.2).
`readManagedSurfaceDirectory` never receives a domain or an address from its
caller. The bindings' `domain` is the value it read.

### 4.3 Ordered algorithm (fail before leaf, fail before memory)

All errors are `surface reader: <reason>`. Steps 1–7 call **no** host function.

1. **Shape.** `exported.records` is a `Float64Array`, and `functions` and the
   directory arrays have no holes.
2. **Header.** `version === managedSurfaceDirectoryVersion` (2) gives
   `unsupported directory version`. `abi.signature === nativeSignatureVersion` and
   `abi.functionBrand` equal to the four `@tint/abi/function` constants give
   `ABI mismatch`. `name === expectedName` gives `surface name mismatch`. The
   digest must be 64 lowercase hex digits.
3. **Digest.** `digestManagedSurfaceDirectory(directory)` must succeed and equal
   `digest` (`digest mismatch`; encoder errors pass through).
4. **Restore.** `restoreManagedSurfaceTypes(directory.types)` (`types: <error>`).
5. **Rebuild.** Expand every class into member facts, then
   `createManagedSurfaceDirectory(name, restored, facts, frame)`. The rebuilt
   digest must equal `digest` (`directory is not canonical`). Map
   `class physical skew` to `class partition differs`, because the reader's facts
   are uniform per class, so the message can only mean a missing or extra alias.
   Keep the rebuilt `directory`, `contracts` and `witnesses`; the input object is
   not used again.
6. **Counts and indexes.** `functions.length === entries.length + witnesses.length`
   (164), `records.length === directory.records.length` (178), every
   `signatures[k].function < functions.length`, and `functions.length ≥ 1`. The
   brand is read from `functions[0]`; a surface without helpers or callback
   classes has no use.
7. **Plan bindings and windows.** For each record class `k`, `records[k]` must be a
   safe integer, positive and a multiple of 8. Addresses **may repeat** across
   classes: seven physical records carry several labels, so uniqueness is never
   checked. Windows come from `managedIdentityByteLength` (§7, P3): brand 32,
   signature `32 + 8·n`, record `24 + 8·(references + generals)`. A layout that
   `verify` rejects fails here, before any leaf.
8. **Domain.** `d = host.domain()`. It must be a safe integer `> 0`
   (`unissued context domain`).
9. **Leaves.** `brand = descriptor(functions[0])`. For each signature class `k` in
   order, `descriptor(functions[f])` must equal `brand` (`foreign function brand`).
   `s = signature(functions[f])` must be a positive multiple of 8
   (`signature unavailable: fn/<k>`). Every leaf result is validated before the
   next call. The leaves are pure and non-allocating, and their results are
   permanent metadata addresses, so ordering against GC does not matter.
10. **Domain again.** `host.domain() === d` (`context domain changed`), following
    the `ensureDomain` pattern.
11. **Issue.** Brand `{domain: d, role: "function-brand", name: "tint.managed.function-brand",
contract: "tint.function.v1", byteLength: 32}`. Signatures
    `{role: "signature", name = contract = fn/<k>, parameters, returnType}`.
    Records `{role: "record", name = contract = record/<k>, recordLayout: copy}`.
    Return frozen arrays. **No `readWord` call exists in the reader.**

`selectManagedIdentityBindings` maps every import to the pool entry with the same
`contract` and `role`. A brand import uses `tint.function.v1`. It returns the
binding renamed to `import.name`, so D6 may choose import names freely, though
`name = contract` is the recommended default. It rejects an unknown or duplicate
contract (`profile: import not provided by the surface`) and never reads memory.
Physical, signature and layout equality stay the job of `resolveManagedPointers`.

### 4.4 Domain authority

- The reader stamps the domain it observed. The **linker** passes
  `expectedDomain = host.domain()` **at link time**, never `read.domain`.
  `resolveManagedPointers` then rejects a read from another context
  (`Managed identity belongs to a different context domain`) before any word read.
- The embedding keeps the export and its read result in an engine-owned rooted
  cell per domain, as in parent §5.6. A read result is never reused across
  domains, and a domain change between read and link is a link rejection, not a
  re-read.
- The reader cannot prove that `exported` came from this domain's bind stub; the
  embedding owns that provenance. Domain checks prevent cross-context
  **publication**. They do not authenticate data.

### 4.5 Readable window versus object size

| Binding   | Readable window (`byteLength`)                   | Object size (not a window)      |
| --------- | ------------------------------------------------ | ------------------------------- |
| brand     | 32 (4 words)                                     | 48 (`nativeFunctionByteLength`) |
| signature | `nativeSignatureHeaderByteLength + 8·parameters` | –                               |
| record    | `24 + 8·(references + generals)`; real 24–824    | `layout.byteLength`; table 816  |

`resolveManagedPointers` reads offsets `0 … window−8` only. The reader passes the
window and never interprets the address.

## 5. Tests (Node, test-first; spy host and spy `readWord`)

`packages/compiler/test/managed-directory-reader.test.ts` builds a fixture
directory with the D4b fixture (`Link`, `Frame`, `keep`, `visit`, frame `Frame`)
via `deriveManagedSurfacePhysicalFacts` and `createManagedSurfaceDirectory`. The
spy host counts calls and returns domain 17, brand 4096 and signatures at
`8192 + 64k`. Every negative case also asserts **zero leaf calls** (R-1…R-9) or
**zero `readWord` calls** (L-1…L-4).

| ID   | Case                                                                                                                                                                                                           | Expected error / assertion                                               |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A-1  | Fixture accept: brand, every class, `name = contract`, record windows `24+8n` ≠ `layout.byteLength`, brand 32 ≠ 48                                                                                             | exact binding list; leaf order `domain, descriptor…, signature…, domain` |
| A-2  | Shared physical record: two classes, equal `records[k]`                                                                                                                                                        | two bindings, distinct contracts                                         |
| R-1  | `version` 1 and 3, digest correct for each                                                                                                                                                                     | `unsupported directory version`                                          |
| R-2  | `abi.signature` and each brand word changed                                                                                                                                                                    | `ABI mismatch`                                                           |
| R-3  | `name` ≠ expected (digest recomputed)                                                                                                                                                                          | `surface name mismatch`                                                  |
| R-4  | Digest uppercase, 63 digits or one digit changed                                                                                                                                                               | `digest mismatch` / malformed                                            |
| R-5  | Declarations unparsable; helper not a function alias (digest recomputed)                                                                                                                                       | `types: …`                                                               |
| R-6  | Class swap, alias moved, alias removed, `function` changed, helper local renamed (digests recomputed)                                                                                                          | `directory is not canonical` / `class partition differs`                 |
| R-7  | `stateOffset` field; word ≥ 2³²                                                                                                                                                                                | encoder error                                                            |
| R-8  | `functions` one short/long; `records` one short/long; `functions` empty                                                                                                                                        | count errors                                                             |
| R-9  | `records[k]` = 0, −8, 12, NaN, 2⁵³                                                                                                                                                                             | `invalid record descriptor address`                                      |
| R-10 | `domain()` = 0, −1, 1.5                                                                                                                                                                                        | `unissued context domain`; zero descriptor/signature calls               |
| R-11 | `descriptor` −1 on call 1; a mismatching brand on call 3; `signature` −1 or 12 on class 2; domain changes before the final read                                                                                | the specific error; no result returned                                   |
| R-12 | **Boundary:** first `readonly` removed or number field `mutable` flipped, digest recomputed                                                                                                                    | **accepted** (pins §3.3; the digest is not an authenticator)             |
| L-1  | Fixture accept → `selectManagedIdentityBindings` for a native fixture module importing brand, one signature and one record (reuse `native-managed-records.test.ts` emission) → `resolveManagedPointers(…, 17)` | ok; every `readWord` offset `< window`                                   |
| L-2  | Same with `expectedDomain` 18                                                                                                                                                                                  | `different context domain`; **zero** `readWord`                          |
| L-3  | Import with a contract outside the pool; duplicate import contract                                                                                                                                             | selector error; zero `readWord`                                          |
| L-4  | R-12 `reference`→`general` signature tamper through L-1                                                                                                                                                        | `Managed identity contract differs` before reads                         |

The real vocabulary is covered in `tools/script-runtime-surface.test.ts`: 1 + 159 +
178 bindings, 164 functions, all 178 windows equal to `8 · descriptorWords`, and the
rebuild time recorded as an assertion-free measurement.

## 6. Version staging (v2 now, v3 with D6d)

- **Why no compatibility layer.** The directory is a permanent literal in the bind
  stub of the image that runs the reader. Both come from one source snapshot, and
  nothing persists or ships a directory across builds. A reader that accepts
  several versions would only accept inputs this image cannot produce.
- **D5.** Replace the literal `version: 2` in `createManagedSurfaceDirectory` with
  an exported `managedSurfaceDirectoryVersion = 2` that the reader also uses. The v2
  encoding stays byte-identical, so the
  [frozen checkpoint](../results/managed-directory-data-checkpoint-v1.json) still
  describes current bytes. The types envelope stays at its independent version 1.
- **D6d.** In one change, set the constant to 3, add `runtimes` to
  `ManagedSurfaceDirectoryData`, the encoder (after `records`), the physical facts,
  `verifyManagedSurfacePhysicalAgreement` and the reader's fact expansion. Add the
  `function-entry` binding role (D6e). Delete nothing for v2 compatibility and do
  not dual-encode. The v2 checkpoint becomes historical, and D6d records its own
  checkpoint and self-build.
- **Order.** Land D5 before D6d. If D6d lands first, D5 starts directly at v3 and
  its fixtures include an empty `runtimes` list. The plan does not change.

## 7. Missing primitives and source files

| #   | Primitive                                                                    | File                                                                                                  | Notes                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | `ManagedSurfaceExport`                                                       | `managed-directory-reader.ts` (or wherever D4c defines it first)                                      | D4c's bind validation ("return type resolves to `ManagedSurfaceExport`") needs the same declaration. Coordinate; define it once                          |
| P2  | `managedSurfaceDirectoryVersion`                                             | `managed-directory-data.ts`                                                                           | §6                                                                                                                                                       |
| P3  | `managedIdentityByteLength(binding)` = `8 · descriptorWords(binding).length` | `managed-imports.ts`                                                                                  | Export the existing private algorithm. Also export one `sameRecordLayout` and delete the duplicate `sameLayout` in `managed-directory-data.ts` (cleanup) |
| P4  | Brand constants `tint.managed.function-brand` / `tint.function.v1`           | `managed-imports.ts`                                                                                  | Currently literals in `dynamic-function.ts`; share them                                                                                                  |
| P5  | Contract/name validation                                                     | `createManagedSurfaceDirectory`                                                                       | Require `generatedIdentifier(name)` so `/` cannot enter contract strings. The rebuild then enforces it                                                   |
| P6  | Leaf profile for `unknown` function values                                   | `native-runtime/src/intrinsics/memory.ts`, host binding lists, `ir/src/scalar/host.ts` only if needed | Open (U1)                                                                                                                                                |

Read-only callers that need no change: `resolveManagedPointers`, `restoreManagedSurfaceTypes`,
`planManagedSurfaceContracts`, `encodeManagedSurfaceDirectory`.

## 8. Implementation slices

**D5a. Shared primitives** (P2–P5). This is behavior-preserving: the v2 digest of
the D4b fixtures and the real vocabulary stays unchanged (assert the existing
checkpoint digest where tests already pin it). `dynamic-function.ts` uses the
shared brand constants. Gates: `pnpm build`, focused compiler/js-engine tests, then
`pnpm check`.

**D5b. Reader and selector** (`managed-directory-reader.ts`, index re-export, §5
tests A-1…R-12, L-1…L-4, and the real-vocabulary assertions). Node only. Inspect
each exit status.

**D5c. Native reader fixture** (after D4c publishes the bind stub and D4e's
`--directory` gate passes). Add `--reader` to
`tools/verify-hosted-managed-surface-directory.ts`. The image calls its own bind
stub, runs `readManagedSurfaceDirectory` with the real `currentContextDomain` and
reflection leaves, and then `selectManagedIdentityBindings` plus
`resolveManagedPointers` over a codegen-emitted unresolved module that imports
the brand, one signature class and one record class (the existing
`verify-native-managed-imports.ts` shape). Use distinct exit statuses for:
accept; tampered digest; name mismatch; and a foreign `expectedDomain`, with
`readMemoryWord` never reached. Repeat after copying-GC churn. Use
`TINT_BUILD_ONLY=1`, run serially under LLDB, assert stopped-at-entry and final
status, and preserve failures. Record native read time. Then run a frozen
self-build with byte-identical stages, because the reader is compiler source in
the image. Run it behind the currently running frozen self-build; do not
interrupt it.

D6e then extends the same reader (runtime entries, `function-entry` role) rather
than adding a second one.

## 9. Unresolved decisions and recommended defaults

| #   | Decision                                                     | Recommended default                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | How `descriptor(fn: unknown)` reaches a `["reference"]` leaf | First try the host adapter as a typed assertion (`fn as (base: unknown, step: number) => unknown`) onto the existing `WithIndex` profile, in D5c. Whether that assertion lowers from `general` to a checked reference is **unverified**. If it does not, add one `unknown`-parameter profile per reflection leaf that unboxes `general` and then runs the same `guardDescriptor` path. Do not add new operations |
| U2  | Brand source                                                 | `functions[0]`, with every signature function's descriptor required to equal it                                                                                                                                                                                                                                                                                                                                  |
| U3  | Where `expectedName` comes from                              | The embedding's request constant beside the bind call; never `directory.name`                                                                                                                                                                                                                                                                                                                                    |
| U4  | Pool versus per-module reads                                 | Read once per export and domain; select per module. Re-reading per JIT compile repeats about 72 ms (Node) of restore/plan                                                                                                                                                                                                                                                                                        |
| U5  | `ManagedSurfaceExport` home                                  | Defined once, by whichever of D4c/D5 lands first, in the compiler's portable native entry                                                                                                                                                                                                                                                                                                                        |
| U6  | Return `contracts` (checked graph)                           | Yes. D6 needs alias type IDs of a restored graph; reuse the reader's instead of a third restore                                                                                                                                                                                                                                                                                                                  |
| U7  | Native preflight cost                                        | Unknown. Node restore+rebuild is 72 ms. Measure in D5c; do not optimize first (e.g. the double canonicalization inside `planManagedSurfaceContracts`)                                                                                                                                                                                                                                                            |

## 10. Risks

1. **Provenance is the only defense for semantic tampering** (§3.3). Keep the
   export in an engine-owned cell that JavaScript cannot reach. Never accept a
   directory from script values.
2. **D4c shape drift.** If D4c changes `functions` ordering or the `records`
   container, only steps 6–7 change. Pin them to the D4 directory doc §5.4 and to
   `witnesses` from the rebuild.
3. **Error remapping** (`class physical skew` → partition) depends on the reader's
   uniform per-class facts. Assert it in R-6.
4. **No conformance follows** from D5. It enables D6g fixtures only.

**Next:** D5a and D5b behind Node gates as soon as D4c/D4d settle the export
shape. Queue D5c after D4e and the running frozen self-build.
