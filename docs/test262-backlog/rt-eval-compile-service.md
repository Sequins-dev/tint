# RT-EVAL EV3: the production Script compile helper

Status: **implemented; production native evaluator passed** ([EV4 report](../results/native-script-evaluator-service-v1.json)).
All 3,937 workspace tests and 33 focused evaluator/compiler tests pass. The native
fixture compiles, links, publishes and invokes three Scripts; Test262 host wiring
remains next. The design captured below refines EV3 of the
[evaluator integration plan](rt-eval-evaluator-integration.md) (§9 there) and adds the parts
that plan left open: where the helper lives, how its authority checks work, the fault guard
EV1 is missing, and how the Node test models issued windows. Where the two plans disagree,
**this one wins for EV3 and the EV4 case-4 wiring**. EV1 types, EV5 resources and the Test262
selection stay as written there.

Captured 2026-11-05, about 00:10 PST, on the live tree. During capture, EV2's frame promotion
landed in the working tree (00:04): `tools/script-entry-frame.ts` is gone, and
`tools/script-runtime-request.ts` now exports `scriptEntryFrameModule =
"packages/js-engine/src/native/script-entry.ts"`. Whoever owns that change still has to run its
tests and `pnpm check`; this plan does not verify them.

Read-only probes in `/tmp/tint-compile-service`: `proto.mts` → `proto.txt` (a probe-local
candidate helper with a synthetic reader and storage), and `fixture-promoted.mts` +
`digest.mts` → `digest.txt` (promoted versus fixture-owned frame). They import workspace `src`
by absolute path, with the repository root as cwd (`workspaceSources()` scans `packages/`
relative to cwd). **Every probe result is Node-only and non-native.** Address words are
synthetic fixture leaves; nothing was dereferenced, mapped, executed, granted or built. No
agent, commit, queue, pause or report was touched; PID 15612 and `msp-self-v2` were left alone.

## 1. Answer in brief

1. **Location: a new file, not `script-entry.ts`.** Add
   `packages/js-engine/src/native/script-compile.ts`, exported as `./native/script-compile`.
   Since EV2, `script-entry.ts` is the module the managed surface selects for
   `ScriptEntryFrame`. Fixtures and images link it into the surface graph (the fixture appends
   it as `script-frame`). A value export importing `@tint/compiler/native` (153 files) would
   pull the compiler into every surface link. The frame module stays type-only (§3).
2. **API: one factory** (§4), `createScriptEntryCompiler(surface, host, limits)`, returning
   EV1's existing `compile: (lowered: Module) => ScriptEntryCompilation`. It takes no new
   protocol, loader, scheduler or cache, and EV1's types stay as they are, apart from one new
   fault reason (point 6).
3. **Composition** (§5):
   - live-domain gate;
   - `prepareManagedSurfaceEntry`;
   - code budget;
   - `linkManagedSurfaceModule(read, native, readWord, domain())`;
   - `storage.publish(linked.code)`;
   - a live-domain recheck, then `base + entryOffset`.

   Nothing is published on any preflight, budget or link failure (probe-proven, §7). The input
   `native.code` is never mutated (linking patches a copy).

4. **No `table` in the compile surface.** Linking never reads the surface table: the fixture
   passes `table: undefined` to the directory reader, and the read result has no table field.
   The table is an invocation argument (`$imports`), which EV1 already takes through
   `host.table()`. Adding it to compile would widen the authority for no use.
5. **Compiler export: as the old plan proposed, re-verified.** Re-export
   `prepareManagedSurfaceEntry` and its three types from `compiler/src/native/index.ts`. Its
   only file dependencies are already in that index's closure, and `js-engine` already imports
   `@tint/compiler/native` (`dynamic-function.ts:15`). Add no narrow subpath (§6).
6. **Fault gap in EV1 (a small amendment).** `createScriptEvaluator` guards only `invoke`.
   Today any throw from `host.compile` escapes into the calling Script as an ordinary,
   catchable exception, disguising a host fault as a Script exception. Examples:
   - an invariant string such as `"surface record binding invariant"` (the probe reproduced
     this);
   - a storage `map` or `write` host throw;
   - a lazy-factory `RangeError`.

   Fix: wrap `host.compile` in the evaluator and add the fault `"compile-threw"` (§8). The
   helper itself does **not** catch, so that only one layer classifies faults.

7. **Frame promotion keeps the digest** (Node-modeled). The directory digest is `f8009ab6…461a`
   either way. The E4 Script emits 120,976 B with an identical FNV (1416700661), entry offset 0
   and 61 imports (§9).
8. **First slice (§13), Node only:** red tests, `script-compile.ts`, the compiler re-export,
   the EV1 fault amendment and the E4 tool importing via `@tint/compiler/native`. **Next
   planning task:** EV5 Test262 host integration (§14).

## 2. Inputs read (current source)

| Item                           | Location                                        | Relevant fact                                                                                                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScriptEvaluationHost`         | `js-engine/src/script-evaluation.ts:33-44`      | Has `domain`, `storage`, `table`, `compile`, `invoke`, `completion` and `fault`. `ensureDomain()` runs before compile and again after a successful compile                                                                                                        |
| `ScriptEntryCompilation`       | `:28-30`                                        | `{ok:true,address}` or `{ok:false,stage}`, with 8 stages including `link`, `budget` and `publish`                                                                                                                                                                 |
| `prepareManagedSurfaceEntry`   | `compiler/src/native/managed-jit-entry.ts`      | Internal. It already fails with `profile` on leftover `native.imports`, runs `selectManagedIdentityBindings` (`select`), and never reads, maps or publishes                                                                                                       |
| `linkManagedSurfaceModule`     | `managed-directory-reader.ts:405-419`           | Rejects `domain !== read.domain` before selecting. Then `resolveManagedPointers` does three things, in order: validates the whole authority set, reads every window, and patches a `slice()`                                                                      |
| `resolveManagedPointers`       | `managed-imports.ts:206-444`                    | A reader throw becomes `"descriptor is unreadable"`. Invariant violations elsewhere `throw` strings                                                                                                                                                               |
| `createEngineCodeStorage`      | `js-engine/src/native/code-storage.ts`          | Checks the domain before mapping and checks capacity before mapping. A failed map poisons the arena **permanently** (`address=-1`). A failed write still consumes its range. Host throws are not caught. Offsets are aligned to 16                                |
| Dynamic `Function`             | `js-engine/src/dynamic-function.ts:100-161`     | Has the same `ensureDomain` pattern. It builds its two bindings by hand and calls `resolveManagedPointers` directly                                                                                                                                               |
| Registry                       | `lowering` `scriptRuntimeSurface()`             | `specifiers`/`instantiations` derive from it in-package. The fixture derives them the same way                                                                                                                                                                    |
| E4 sequence                    | `tools/verify-hosted-managed-script.ts:110-121` | Calls prepare, then checks `imports.length` / the managed count, the `> 262144` budget, a foreign-domain link (0 reads), a missing-contract link (0 reads), then link and `publish`                                                                               |
| Typed tests reused for windows | see the next column                             | `compiler/test/native-managed-records.test.ts:63-90` (brand `[48,1,24,0]`, record); `managed-directory-reader.test.ts:369-460` (signature `[1,40,1,4,8]`); `tools/managed-runtime-link.test.ts:276-325` (runtime signatures built from `nativeSignatureTypeCode`) |

## 3. Why a separate module

- `script-entry.ts` is now a **surface-selected type module**. `createScriptRuntimeRequest`
  selects `{module: scriptEntryFrameModule, name: "ScriptEntryFrame"}`, the fixture appends it to
  its root import list, and E4 maps `"frame"` to it (`verify-hosted-managed-script.ts:148,169`).
  Every value import added there joins that graph; the helper's imports (§4) include the whole
  compiler index.
- With a new file, evaluation orchestration (`script-evaluation.ts`), the image ABI frame
  (`script-entry.ts`) and compilation/publication authority (`script-compile.ts`) each keep a
  single concern.
- TypeScript syntax and checking stay out of the engine. The evaluator owns the JS front end
  (`parseScript`, `lowerScript`). The compiler owns checking, lowering and emission inside
  `prepareManagedSurfaceEntry`. The helper parses nothing and checks nothing: it only composes.
  The host supplies the parsed runtime modules (`ManagedSurfaceLayoutRuntime`) as part of the
  surface.

## 4. Exact API

`packages/js-engine/src/native/script-compile.ts`:

```ts
import type { Module } from "@tint/typescript/syntax";
import {
  prepareManagedSurfaceEntry,
  linkManagedSurfaceModule,
  type ManagedSurfaceDirectoryRead,
  type ManagedSurfaceLayoutRuntime,
  type ManagedIdentityReader,
} from "@tint/compiler/native";
import { scriptRuntimeSurface } from "../lowering/index.ts";
import type { EngineCodeStorage } from "./code-storage.ts";
import type { ScriptEntryCompilation } from "../script-evaluation.ts";

/** Image-issued surface: a directory read in the owning context domain, plus the
 * runtime layout parsed from embedded module text. Inputs only, never code. */
export interface ScriptEntrySurface {
  readonly read: ManagedSurfaceDirectoryRead;
  readonly runtime: ManagedSurfaceLayoutRuntime;
}
/** Trusted authority. readWord reads only issued descriptor windows; storage is
 * the engine's permanent arena, shared with dynamic Function. */
export interface ScriptEntryCompilerHost {
  readonly domain: () => number;
  readonly storage: EngineCodeStorage;
  readonly readWord: ManagedIdentityReader;
}
export interface ScriptEntryCompilerLimits {
  readonly maxScriptCodeBytes: number;
}
export function createScriptEntryCompiler(
  surface: ScriptEntrySurface,
  host: ScriptEntryCompilerHost,
  limits: ScriptEntryCompilerLimits,
): (lowered: Module) => ScriptEntryCompilation;
```

**Factory preconditions.** These are host misconfiguration, so the factory throws
`RangeError`, like `createEngineCodeStorage`:

- `maxScriptCodeBytes` is a positive safe integer. The probe rejected 0, NaN, 1.5, −1 and
  Infinity at the factory.
- `surface.read.directory.frame === "ScriptEntryFrame"`.
- `surface.read.domain` is a positive safe integer.

The factory computes `specifiers` and `instantiations` once from `scriptRuntimeSurface()`. It
captures `issued = surface.read.domain` and does no other work: it makes no reads, maps or
parses.

Changes from the old §9 sketch: `readWord` and `domain` move into a `host` object (mirroring
`DynamicFunctionCodeHost`), the exported `ManagedIdentityReader` type replaces the inline
signature, and the result is EV1's `ScriptEntryCompilation`. The type import from
`script-evaluation.ts` is one-way, so no cycle forms.

## 5. Algorithm (exact)

```text
live() := host.domain() === issued && host.storage.domain === issued
1. if !live()                                    → {ok:false, stage:"link"}    // 0 prepare, 0 reads
2. p = prepareManagedSurfaceEntry({module:lowered, entry:"execute",
       specifiers, instantiations, read, runtime})
   if !p.ok                                      → {ok:false, stage:p.error.stage}
3. if p.native.code.length > maxScriptCodeBytes  → {ok:false, stage:"budget"}  // 0 reads
4. l = linkManagedSurfaceModule(read, p.native, host.readWord, host.domain())
   if !l.ok || !live()                           → {ok:false, stage:"link"}
5. base = host.storage.publish(l.value.code)
   if base === undefined || base % 16 !== 0 || !live()
                                                 → {ok:false, stage:"publish"}
6. address = base + p.entryOffset
   if !Number.isSafeInteger(address)             → {ok:false, stage:"publish"}
   return {ok:true, address}
```

Notes:

- **No duplicate `imports.length` check.** `prepareManagedSurfaceEntry` already returns
  `profile` when unresolved native imports remain. E4's managed-import count (`=== 61` today)
  stays a fixture assertion, not a helper rule.
- **Domain authority is rechecked three times:** at step 1 (a foreign or stale engine does no
  work), inside link (before selection or any read) and after publish. With EV1's
  `ensureDomain()` around compile, a stale realm never invokes. A native process has one
  constant domain, so the in-flight change is modeled (§7), not native (§10).
- **No publication on preflight, budget or link failure.** `publish` is reached only after a
  complete, verified, patched copy exists. A failure after `publish` returns (step 5 recheck,
  step 6) leaves bytes in the arena. They are unreachable, because no address escapes. Like
  every published range, they are never freed.
- **Equal ABI is not equal authority.** The helper never compares or reuses addresses across
  bindings. Matching shapes and descriptor words are necessary checks, not grants. Authority
  comes only from the image-issued `read`, whose leaves the image produced from its own bound
  functions and records.
- **Code arena.** It is the same `EngineCodeStorage` instance that dynamic `Function` uses. It
  is permanent, has no free list and is serialized by its single engine owner. Probe layout:
  Function's 40 B at offset 0, Script 1 at 48, Script 2 at 121,024 (`align16(48 + 120,976)`).
- **No copied runtime bodies.** The emitted code reaches runtimes only through `function-entry`
  imports, which resolve to issued permanent entries (`read.runtimes`). The helper adds no
  stubs, trampolines or copied body text.

## 6. Compiler export and manifest fallout

`compiler/src/native/index.ts` gains:

```ts
export {
  prepareManagedSurfaceEntry,
  type ManagedSurfaceEntryRequest,
  type PreparedManagedSurfaceEntry,
  type ManagedSurfaceEntryPreparation,
} from "./managed-jit-entry.ts";
```

- `managed-jit-entry.ts`'s own imports (`managed-directory`, `-reader`, `-applications`,
  `-entry`, `-jit-program`, `-jit-records`, `-jit-signatures`, `-closure-uses`,
  `-runtime-selection`, `@tint/codegen/aarch64/scalar`) are all already reachable from
  `index.ts`. The old `closure` probe found the narrow alternative saves one file out of 472 in
  the evaluator closure. Keep that conclusion.
- The E4 tool's path import (`verify-hosted-managed-script.ts:7`) and its `"entry"` dependency
  mapping (`managed-jit-entry.ts`) switch to `@tint/compiler/native` and `"contracts"`. The
  generated fixture text changes only at the import site.
- `js-engine/package.json` gains `"./native/script-compile"`. There is no new dependency:
  `@tint/compiler` is already listed, and `workspace-contracts.json` is unchanged.
- **Source snapshot:** +1 portable file (`script-compile.ts`). Import grants rise by that
  file's edges. Re-measure the file and grant counts; do not pin them.
- **Frozen capture:** PID 15612's `db20a344…` 546-file snapshot predates EV1, EV2 and this. As
  a builder it needs nothing new (a pure re-export and a portable module, compiled from the
  live graph); the next frozen capsule simply includes them. `frozen-source-exports.ts` maps
  compiler roles by file (`native/index`), so a new symbol changes no role. Re-run
  `boundaries.test.ts` and `compiler-catalog.test.ts`; update them only if red.

## 7. Node prototype (non-native)

`proto.mts` defines the candidate helper (as in §5, with the `RangeError` factory) **in /tmp
only**.

**Synthetic `ManagedIdentityReader`.** It reuses the vocabulary of existing tests. It does not
invent an encoding. For every issued binding in `read.brand`, `read.signatures`,
`read.records` and `read.runtimes`, it builds the window words:

| Role                         | Words                                                                                                                                                                                             | Constant source                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `function-brand`             | `[nativeFunctionByteLength, nativeFunctionReferenceCount, nativeFunctionEnvironmentOffset, nativeFunctionGeneralCount]` = `[48,1,24,0]`                                                           | `@tint/abi/function`; the same values as `native-managed-records.test.ts:88` |
| `signature`/`function-entry` | `[nativeSignatureVersion, 32 + 8·n, n, code(return), …code(param)]`                                                                                                                               | `nativeSignatureTypeCode`; see `managed-runtime-link.test.ts:276-289`        |
| `record`                     | `[byteLength, refs.length, …refOffsets, general.length, …generalOffsets]`. Reference types: `primitive`, `reference`, `optional-reference`, `optional-string`, `string` and the four typed arrays | `managed-imports.ts` `descriptorWords`                                       |

- Each window's `words.length·8` equals `binding.byteLength` and equals the exported
  `managedIdentityByteLength(binding)`. The probe asserted this for every issued binding.
- Shared addresses (equal-ABI signatures, if any) were asserted to carry identical words.
- The reader returns −1 for an unknown address, a wrong length or a misaligned offset.
- Storage is the **real** `createEngineCodeStorage`, over a host that counts `map` and `write`
  calls and copies the written bytes. `map` returns `0x7000000`, a synthetic model value.

**Results (`proto.txt`).**

| Case                                             | Result                                                                                                                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E4 Script                                        | 120,976 B, entry offset 0, **61** imports (25/3/23/12), 524 reads; helper bytes `deepEqual` the manual prepare→link output; address = base + entryOffset; 1 map, 1 write; input code unchanged |
| Lone surrogate `var s='\uD800';s.charCodeAt(0);` | 52,392 B, 38 imports, 381 reads, equal                                                                                                                                                         |
| `2;;` / `throw 7`                                | 24,712 B / 24,088 B, 18 imports, 265 reads each, equal                                                                                                                                         |
| `maxScriptCodeBytes` 0, NaN, 1.5, −1, Infinity   | factory `RangeError`                                                                                                                                                                           |
| size − 1                                         | `budget`, 0 reads, 0 maps, 0 writes                                                                                                                                                            |
| exact size                                       | `ok`, 1 map, 1 write                                                                                                                                                                           |
| `domain()` = 18 (foreign)                        | `link`, 0 reads, 0 writes                                                                                                                                                                      |
| `storage.domain` = 19 (stale arena)              | `link`, 0 reads, 0 maps                                                                                                                                                                        |
| domain changes after the gate                    | `link` (rejected by link's own check), 0 reads, 0 writes                                                                                                                                       |
| brand word 0 corrupted                           | `link`, reads > 0, 0 writes                                                                                                                                                                    |
| reader throws                                    | `link` (caught by `resolveManagedPointers`), 0 writes                                                                                                                                          |
| arena capacity = size − 1                        | `publish`, 0 maps (the capacity check precedes mapping)                                                                                                                                        |
| `write` returns 1                                | `publish`, 1 write (the range is consumed)                                                                                                                                                     |
| `map` returns 0                                  | `publish` twice; `map` called **once**, so the arena is poisoned for Function too                                                                                                              |
| tagged template / generator                      | `profile`, 0 reads, 0 maps, 0 writes                                                                                                                                                           |
| `read.records` with a hole                       | **throws** `"surface record binding invariant"` out of the helper (motivates §8)                                                                                                               |

Prepare takes 0.5–0.9 s per Script in Node, depending on load. That is not a native estimate.

## 8. Fault taxonomy and the EV1 amendment

| Origin                                                    | Helper result              | Evaluator outcome                                          |
| --------------------------------------------------------- | -------------------------- | ---------------------------------------------------------- |
| parse `SYNTAX_ERROR`/`LEXICAL_ERROR`, lower `EARLY_ERROR` | (never reaches the helper) | the realm's SyntaxError                                    |
| other parse/lower codes                                   | (never reaches the helper) | sticky unsupported                                         |
| prepare `profile`/`prepare`/`lower`/`emit`/`select`       | `{ok:false,stage}`         | sticky unsupported                                         |
| `budget`, `link` (including domain), `publish`            | `{ok:false,stage}`         | sticky unsupported                                         |
| a throw inside compile (invariant, host map/write throw)  | propagates                 | **new:** `fault("compile-threw")`, then sticky unsupported |
| `invoke` throws                                           | n/a                        | `fault("invoke-threw")` (existing)                         |
| context leak, bad completion view or kind                 | n/a                        | existing faults                                            |
| native trap (`brk`), OOM, guard page                      | n/a                        | process crash; Test262 records `crash` (correct)           |

**Amendment** (`script-evaluation.ts`): `ScriptEvaluationFault` gains `"compile-threw"`, and the
call becomes:

```ts
let compiled: ScriptEntryCompilation;
try {
  compiled = host.compile(lowered.value);
} catch {
  return fault("compile-threw");
}
```

- Compile runs no Script code, so anything it throws is by construction a host fault, never a
  Script exception. Catching it there is exact. Catching inside the helper would split
  classification across two layers and turn host bugs into silent `unsupported`.
- Out of scope, with the dynamic-`Function` precedent unchanged: throws from `parseScript` or
  `lowerScript`, and from `host.table()` or `host.completion()`. Record these as a follow-up
  only if EV4 observes one.

## 9. EV2 status and digest

- The working tree now selects `ScriptEntryFrame` from
  `packages/js-engine/src/native/script-entry.ts` (EV2.1). The bound `script-host` declarations
  stay tool-owned, as planned.
- `digest.mts` compares the old fixture-owned `surface-helpers` frame against the promoted
  frame:

  | Frame                     | Directory digest                                                   | E4 bytes | FNV        | Entry offset | Imports |
  | ------------------------- | ------------------------------------------------------------------ | -------- | ---------- | ------------ | ------- |
  | fixture `surface-helpers` | `f8009ab6a9901f5c19753f298964edee03a843988256dc97fcd6a659b330461a` | 120,976  | 1416700661 | 0            | 61      |
  | promoted `js-engine`      | identical                                                          | 120,976  | 1416700661 | 0            | 61      |

- Reification canonicalizes the frame to `$T120` and records no module identity.
- The digest is **Node-modeled**. The native image computes its own and E4 case 2 compares the
  two. Still regenerate the digest, never pin it.
- The EV2 checks to run after the change (owned by EV2, not by this plan) are
  `script-runtime-surface.test.ts`, `managed-jit-entry.test.ts` and `pnpm check`.

## 10. What Node cannot model or prove

The prototype proves composition order, the publish count, read gating and byte equality
against the manual pipeline. It cannot prove:

1. **That issued descriptors hold these words.** The windows come from the expected
   vocabulary, so this is circular by design; only the image's `readMemoryWord` over its own
   metadata tests it (E4 did, for 61 imports).
2. **That patched pointers are the right targets.** Address equality grants nothing
   semantically; E4's `invoke` → 42 is evidence for the E4 Script only.
3. **Executable mapping, registration, permissions and cache maintenance.**
4. **GC during a compile.** 256 MiB / 8 Mi / 16,384 / 16 MiB passed E4 v4; a 1 MiB stack failed
   in the checker prologue (small-stack v3).
5. **An in-flight domain change.** The domain is constant within a native process; the
   foreign and stale cases are modeled only.
6. **Compile-only time.** E4 v4's 25.26 s includes debugger launch, image load, the 22-module
   parse and invoke; there is no split yet.
7. **Real arena exhaustion and sharing with `Function` in an image.**

## 11. Test-first plan (files and edits)

**Red first, for slice A.**

1. `tools/script-entry-compiler.test.ts` (new; uses `createManagedScriptFixture`; slow, about
   15 prepares). The window reader and counting storage are written **in the test** and copied
   from §7, citing the three existing tests.
   - The E4 Script output equals manual `prepare → linkManagedSurfaceModule → publish`: equal
     bytes, `address = base + entryOffset`, 1 map, 1 write, input unchanged.
   - Lone-surrogate and `2;;` Scripts compile.
   - Factory `RangeError` for each of 0, NaN, 1.5, −1, Infinity, and for a `frame` name that
     is not `ScriptEntryFrame`.
   - size − 1 gives `budget` with 0 reads and 0 writes; the exact size gives `ok`.
   - A foreign domain or stale `storage.domain` gives `link` with 0 reads, 0 maps and no
     prepare (spy on a getter of the module object, or measure with the 0-read assertion).
   - A corrupted window or a throwing reader gives `link` with 0 writes.
   - A capacity overflow gives `publish` with 0 maps. A failed write gives `publish`. A failed
     map gives `publish`, and a second call does not remap.
   - Arena sharing: publish 40 B, then two Scripts; the offsets are 0, 48 and
     `align16(48 + size)`.
   - Tagged template or generator gives `profile` with zero side effects.
   - Use `"2;;"` for every failure case, to keep runtime down (about 0.5–0.9 s each in Node).
2. `packages/js-engine/test/script-evaluation.test.ts` (extend). If `compile` throws, the
   evaluator calls `fault("compile-threw")` exactly once, does not rethrow the value (the
   caller sees unsupported), and a second call on that realm makes **0** compiles (sticky).
3. `packages/compiler/test/managed-jit-entry.test.ts`, or a small new export test: import
   `prepareManagedSurfaceEntry` from the package index (`../src/native/index.ts`) and check
   that it is the same function as the internal one.

**Edits (slice A).**

1. Add `compiler/src/native/index.ts`: the §6 re-export.
2. Add `js-engine/src/native/script-compile.ts`: §4 and §5.
3. In `js-engine/src/script-evaluation.ts`, add the `"compile-threw"` member and the try/catch
   (§8).
4. `js-engine/package.json`: add `./native/script-compile`.
5. `tools/verify-hosted-managed-script.ts`:
   - import `prepareManagedSurfaceEntry` from `@tint/compiler/native`;
   - generated text: `from "contracts"`, dropping the `"entry"` mapping.

   Cases 0–3 stay byte-identical apart from the import site, and their status numbers are
   unchanged. Do not rebuild for this; rebuild when EV4 next runs natively.

6. Then run `pnpm build`, the focused tests and `pnpm check`. Run the native source audit with
   `--entry js-engine/src/native/script-compile.ts --specialize` to stage `checked`, as EV1 did
   for the evaluator. That is a portability check, not execution.

## 12. EV4 case 4: the native evaluator and helper in the existing fixture

Reuse `tools/verify-hosted-managed-script.ts`; add no new tool. After the `read`, `storage` and
22-module `runtime` already built for case 1 and later:

```text
if (selected===4) {
  compile = createScriptEntryCompiler({read:read.value, runtime},
             {domain:currentContextDomain, storage, readWord:counted readMemoryWord},
             {maxScriptCodeBytes:262144})
  host(A) = {domain:currentContextDomain, storage, table:()=>exported.table,
             compile:counted(compile), invoke, completion, fault:recordFault}
  evA = createScriptEvaluator({realm:a.realm, global:a.global}, host(A)) …
}
```

- New dependencies: `["evaluation","packages/js-engine/src/script-evaluation.ts"]` and
  `["script-compile","packages/js-engine/src/native/script-compile.ts"]`.
- Build options, `script-host` views, `retainedExports`, host bindings and resources are
  unchanged (256 MiB / 8,388,608 / 16,384 / 16 MiB).
- The case-4 statuses are 100–111. `nativeExitOutcome` maps only 10–12, 20–39, 40, 42 and
  50–59, and E4 uses 60–99, so 100–111 decode as `crash: unexpected native exit status N`.
  They therefore stay outside the Test262 mapping, and their meaning lives only in the
  fixture's analysis.
- Every step also checks two things: `activeContext` is restored, and `currentRootHead()` is
  unchanged.

| Status | Check                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| 100    | `evA(E4 Script)` → 42; `nativeActive` saw a fresh record in realm A; 1 compile, 1 publish                    |
| 101    | `evA("y+v")` → 42 (bindings persist across Scripts)                                                          |
| 102    | `evA("var q; let y;")` throws A's SyntaxError from GDI at run time (it compiles and publishes); `q` absent   |
| 103    | `evA("var")` throws A's SyntaxError before compile (0 compile calls)                                         |
| 104    | `evA("throw 7")` rethrows 7                                                                                  |
| 105    | completions: `"var z;"` → `undefined`, `"2;;"` → 2                                                           |
| 106    | lone `\uD800` literal → `charCodeAt(0)` = 55296                                                              |
| 107    | realm B: B's SyntaxError, and B's `w` is absent in A                                                         |
| 108    | tagged template on C: sticky unsupported; the next valid call makes 0 compiles                               |
| 109    | `compile` wrapper throws on D: `fault("compile-threw")` once; the Script catch does **not** see it           |
| 110    | 32 MiB churn, then A's `f(2)` → 42, still seeing the first record                                            |
| 111    | arena offsets after N Scripts equal the aligned sum (bytes per compile recorded); `Function` still publishes |

Run cases 0 and 4 under the same debugger launch policy. Record `elapsedMs` per case and keep
debugger launch separate from execution. Case 4 minus case 1 (parse and lowering only) gives
the first compile-plus-execution split.

## 13. First implementation slice

**Slice A (Node only, red first; no native run, no frozen build, no queue).**

1. Write the §11 tests 1–3 and confirm they fail (red): missing module, export and fault
   member.
2. Make edits 1–5 of §11.
3. Run `pnpm build`, `node --test tools/script-entry-compiler.test.ts
packages/js-engine/test/script-evaluation.test.ts`, then `pnpm check` and the native source
   audit. Record a Node checkpoint, `docs/results/script-compile-node-checkpoint-v1.json`, with
   `nativeExecution: false`.

**Slice B (native, separately approved):** EV4 case 4 (§12) on a fresh image at the E4 v4
resources, recording per-case elapsed time, bytes per compile and whether 109 classifies
correctly.

**Resources recorded, not decided here.** Proven: 16 MiB stack, 256 MiB heap, 8 Mi allocation
capacity, 16,384 roots; a 1 MiB stack failed. Test262 today: 64 MiB heap, 1 MiB stack, 1 MiB
executable memory, `maxDynamicCodeBytes` 65,536, 60 s. At 120,976 B per E4-size Script, 1 MiB of
arena holds about 8 compiles alongside `Function`. The whole-suite policy stays an EV5 decision.

## 14. Next planning task

**EV5 Test262 host integration.** Plan the `tools/test262-native.ts` capability gate; the lazy
process-wide `ScriptEntrySurface` memo (where the 22-module parse happens, and how a factory
throw maps to `scriptFault` and status 13); `RealmHost` wiring with one `executableStorage` for
`Function` and Script; builder copies of `script-host`, record views, retained exports and host
bindings; the resource decision from EV4 slice-B timings (compile-only versus launch); and the
baseline/after selections (unchanged from the integration plan, §12 there).
