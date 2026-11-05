# RT-EVAL: Annex B evalScript `brk #0` trap (global-existing / non-enumerable cases)

Current status: the [native diagnostic](../results/annex-eval-trap-diagnostic-v1.json)
confirms the AOT write site and descriptor mismatch; see the
[analysis](../results/annex-eval-trap-analysis-v1.json). F1 and F2 are implemented,
and the unchanged [first failing test](../results/test262-annex-admission-first-native-v1.json)
now passes natively. F3 rejects readonly near-matches in Node tests and its
[dedicated native fixture](../results/native-managed-jit-record-mutability-v1.json)
passes. Both focused failing tests pass, and the complete
[Annex B global-code selection](../results/test262-annexb-global-code-admission-native-v1.json)
passes 153/153. The [ordinary global-code rerun](../results/test262-global-code-admission-native-v1.json)
passes 73/75 with two direct-eval-dependent unsupported variants and no crashes. Original failures
remain in the frozen v6 reports.

Research status at capture: **static diagnosis; native proof was pending.**
The current implementation and native evidence are summarized above.
This is research only. No code, test, manifest, data, image, queue, journal, report,
snapshot or process was touched. All probes ran under Node in `/tmp/annex-trap-research`,
and no native code was executed. Every native claim below is either reconstructed from bytes
the frozen run already captured or labelled **hypothesis** with a proof step for main.

Parents: [host evalScript](rt-eval-host-evalscript.md),
[test262 host integration](rt-eval-test262-host-integration.md),
[surface directory](rt-eval-surface-directory.md), and the E4 record-identity fix
(`ts-native/src/closure/lowering/records.ts`, `compiler/src/native/managed-jit-program.ts`).

## 1. Answer in brief

1. **Where it traps.** The `brk #0` is in the **AOT** runtime function
   `instantiateGlobalDeclarations` (`packages/js-runtime/src/environments/global/declarations.ts`),
   at the store on **line 116**: `declaration.admitted = false;`. It is the fall-through of an
   exact-record-type switch on the `plan.annexFunctions[i]` element. The receiver's
   descriptor is none of the AOT-known `AnnexGlobalFunction` record types.
2. **Which chunk.** The **second** `$262.evalScript` (the Annex B block/if/switch function
   declaration). Chunks 1 and 3 lower to `annexFunctions: []`, so line 116 cannot execute
   for them. _(Reasoned; native confirmation in §9.)_
3. **Contract gap.** In the frozen 549 snapshot, js-engine lowering allocates the admission
   record as an untyped temporary `{name, admitted}`. Its checked type has a **mutable**
   `name`. The surface class for `AnnexGlobalFunction` (`$T474`) is
   `{readonly name, admitted}`. `createManagedTypeContractIndex().matches` is strict on
   `readonly`, so:
   - the E4 identity partition does not select the alias;
   - `bindManagedJitRecords` finds no class and silently `continue`s;
   - the record stays **JIT-local**, with a JIT-local descriptor.

   `prepareManagedSurfaceEntry` still succeeds. The enclosing plan record (`$T207`) _is_
   bound, so a JIT-local element enters an AOT array typed `readonly AnnexGlobalFunction[]`.
   The AOT write site checks the exact descriptor and traps.

4. **This is not the old E4 bug.** E4 was a record **read** whose alias matched but whose
   identity was interned away. Here the first touch is a **write**, and no alias matches at
   all. Both belong to the same family: a JIT record crosses the surface without a record
   contract.
5. **Live 550 already contains a lowering fix.** It adds a type-only `AnnexGlobalFunction`
   import and annotates the admission temporary. A live Node probe shows the admission record
   now **binds** to the surface record contract (`…/record/9`) for block, if and switch
   chunks. That fix was not in the frozen v6 run, which explains why those cases still trap.
   Three things remain: native proof, a binding-level regression test, and a fail-closed
   guard (§8).

## 2. Inputs (each read once)

| Input                                                                     | State at read time                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `docs/results/test262-annexb-global-code-evalscript-host-native-v1.jsonl` | 105 lines (partial); 90 pass, 12 crash, 3 non-observation                      |
| `docs/results/annex-eval-trap-diagnostic-v1.json`                         | **absent** (not polled again)                                                  |
| `docs/results/annex-eval-trap-debug-build-v1.json`                        | present; image `88bb352d…`, snapshot `55e4007c…`/549, `debugSymbols:true` only |
| `.tint-bootstrap/annex-eval-trap-debug-v1`                                | read statically: `nm`, `llvm-dwarfdump`, byte scan. **Not executed.**          |
| Frozen sources `.tint-bootstrap/node-toolchain-evalscript-host-v1`        | read and imported by probes; not mutated                                       |
| `.tint-bootstrap/test262/test/annexB/language/global-code/*.js`           | read                                                                           |

The 12 crashes in the journal so far:

| Test (suffix `-global-init.js`)                                             | Batch | Trap PC low 12 bits |
| --------------------------------------------------------------------------- | ----- | ------------------- |
| block-decl-global-existing / -existing-non-enumerable                       | 0     | `0x794`             |
| if-decl-else-decl-a-…, if-decl-else-decl-b-…, if-decl-else-stmt-… (×2 each) | 0     | `0x794`             |
| if-decl-no-else-…, if-stmt-else-decl-… (×2 each)                            | 1     | `0x70c`             |

**Correction to the brief.** Not every trap has PC suffix `…3794`. The batch-1 traps end in
`…070c`. Both captured 512-byte windows contain **identical instruction streams**: the same
slot offsets, the same two exact checks, and the same 32-slot clear before `brk #0`. Only the
page offset and descriptor displacements differ. It is the same function in two batch images.

The journal also lists `switch-case-global-existing-{global,non-enumerable}-init.js` as crashes
after the dump window. They were not disassembled, but they have the same `V|FB|V` chunk
structure.

## 3. Reconstructed trap site (batch 0, `0x1066d3600 + …`)

This is decoded from the `x1066d3600,200` packet in the first crash's LLDB log.
Offsets are relative to `0x…3600`. Comments are interpretation.

```
00c str  x9,[sp,#1808]          ; receiver  := plan.annexFunctions[i]
010 mov  x9,#0 ; fmov d16,x9 ; fmov x9,d16 ; str x9,[sp,#1824]   ; value := false (0 bits)
030 ldr  x9,[sp,#1808] ; …cbnz x9 → 044 else b 0cc            ; null → second test
044 ldr  x10,[x9]               ; header word = record descriptor
048 adr  x11,#0 ; mov/movk x17,#0x050618c8 ; add ; cmp x10,x11  ; exact type A?
05c b.eq 064 ; b 0cc
064 ldr  x10,[sp,#1824] ; str x10,[x9,#24]   ; A.admitted = false   (field @24)
06c b 070 → continue (line 118: hasBinding(record.lexical, declaration.name) …)
0cc …ldr x9,[sp,#1808] ; cbnz → 0e8 else b 114
0e8 ldr x10,[x9] ; adr/mov/movk #0x05061844 ; cmp           ; exact type B?
100 b.eq 108 ; b 114
108 ldr x10,[sp,#1824] ; str x10,[x9,#24] ; b 070            ; B.admitted = false
114 str xzr,[sp,#72] … str xzr,[sp,#2728]   (32 root-slot clears)
194 brk #0                       ; ← trap: receiver is neither A nor B (or null)
```

At the trap, `x9` holds the receiver and `x10` its descriptor word, because nothing
clobbers them after `0e8`. That makes the descriptor directly checkable (§9).

## 4. Symbol mapping via the debug image (static only)

The debug image's frame layout is **byte-identical** at this site. Its 35-slot clear list is
not, so an exact byte search fails. A normalized-shape search does work: mask the `sp`
immediates, the `x17` constants, and the branch displacements, then search for the 25-word
window `00c–070`. It returns three hits. Only one matches **70/128** words of the full
512-byte window (the next best matches 48):

```
0x104580f2c  program:packages/js-runtime/src/environments/global/declarations.ts:
             instantiateGlobalDeclarations [__tint_specialized_6690$20012]+0x4e98
llvm-dwarfdump --lookup=0x104580f88  →  declarations.ts line 116, column 5
llvm-dwarfdump --lookup=0x104580fa0  →  declarations.ts line 118, column 25
```

The debug-image differences are informative:

- **The one-case debug image accepts only one exact type (A).** Its fallback goes straight
  to the clear list and `brk #0` at **`0x104581070`**.
- **The frozen batch image accepts two (A, B).** **Hypothesis:** AOT whole-program typing
  adds a second `{name, admitted}` literal type in the batch image. Batch images AOT-compile
  other tests' top-level annex scripts, and the one-case image's main script has none. The
  JIT descriptor is in neither set.
- **Expected AOT `AnnexGlobalFunction` descriptor in the debug image:**
  `adr(0x104580f68) + 0x044f10c0 = 0x108a72028`, inside `__TEXT`.

## 5. Source path

AOT consumer (frozen = live), `declarations.ts:114-126`:

```ts
for (const declaration of plan.annexFunctions ?? []) {
  if (declaration === undefined) throw "DECLARATION_INVARIANT";
  declaration.admitted = false;                       // line 116 ← trap
  if (hasBinding<Value>(record.lexical, declaration.name) ||
      !canDeclareGlobalVar<Key, Value>(record, declaration.name)) continue;
  …
  declaration.admitted = true;
}
```

`AnnexGlobalFunction` is `{ readonly name: string; admitted: boolean }`. Field offsets are
name @16 and admitted @24, matching `str x10,[x9,#24]`.

JIT producer (**frozen 549**), `js-engine/src/lowering/index.ts` ≈4086-4100:

```ts
const admission = temporary(object(["name","admitted"], [text(copy.name), false]));
annexAdmissions.set(copy.name, admission);  annexDeclarations.push(admission);
… plan = object(["lexical","variables","functions","annexFunctions"], […, annexDeclarations])
```

`temporary()` with no annotation gives the variable the literal's own type, `{name; admitted}`,
where both fields are mutable. Lexical entries `{name, constant}` are built **inline** in the
plan array, so they are contextually typed to `$T475` and bind. The admission object is built
earlier, as a temporary, because the function-declaration site later reads it
(`if (admission.admitted) …`). It never gets contextual typing. That asymmetry is why
`script-decl-lex-collision.js` passes while every annex chunk traps.

Why chunk 2 and nothing else:

| Chunk                                         | `annexCopies` | `annexFunctions`              | reaches line 116 |
| --------------------------------------------- | ------------- | ----------------------------- | ---------------- |
| 1 `assert…; verifyProperty(… {restore:true})` | none          | `[]`                          | no               |
| 2 `{ function f(){…} }` / `if…` / `switch…`   | `f`           | `[{name:"f",admitted:false}]` | **yes**          |
| 3 `verifyProperty(…)`                         | none          | `[]`                          | no               |

Static probe (frozen fixture) for chunk 1 shows **no** JIT-local record with a surface-class
shape. Hypothesis: chunk 1 runs to completion. Main should confirm with the per-chunk
breakpoint in §9.

## 6. Compiler-side mechanics (frozen 549)

| Step                    | File                                                                 | Behaviour for checked type `{name, admitted}` (mutable `name`)                                                                               |
| ----------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity partition (E4) | `compiler/src/native/managed-jit-program.ts` `recordIdentity`        | Loops over the surface aliases with `comparison.matches`; `matches(7742,$T474)` → `{ok:true,value:false}`, so it returns `undefined`         |
| Layout interning        | `ts-native/src/closure/lowering/records.ts` ≈612-636                 | Without a key, the record is deduped only by storage. Field 0 has `mutable:true` vs the surface's `mutable:false`, so it gets its own layout |
| Record binding          | `compiler/src/native/managed-jit-records.ts` `bindManagedJitRecords` | No class matches. `if (matches.length === 0) continue;` leaves the record **unbound**, and nothing rejects it                                |
| Entry                   | `prepareManagedSurfaceEntry`                                         | `ok:true`, counts `{records:15}` (frozen). The record is emitted with a JIT-local descriptor                                                 |

Probe output (frozen fixture, chunk `{ function f(){…} }`):

```
rec 29 LOCAL {name,admitted}
rec 30 BOUND $T207{ro annexFunctions,ro lexical,ro variables,ro functions}
rec29 layout   {"byteLength":32,"fields":[{"type":"string","mutable":true,"offset":16},{"type":"boolean","mutable":true,"offset":24}]}
$T474 layout   {"byteLength":32,"fields":[{"offset":16,"type":"string","mutable":false},{"offset":24,"type":"boolean","mutable":true}]}
matches 7742 1819 {"ok":true,"value":false}   # JIT literal vs AnnexGlobalFunction
matches 1818/3158/3159 1819 → true            # AOT-side variants all match each other
```

The checker accepts the program because a mutable-`name` object is assignable to
`readonly AnnexGlobalFunction[]`. Assignability is not a record contract, and nothing
between the checker and the emitter enforces that difference.

## 7. Hypothesis test of the fix (Node only, in memory)

In `probe4.ts` (frozen), I annotated the admission temporaries in the lowered AST with
`{ readonly name: string; admitted: boolean }` before preparation. I did **not** edit
`index.ts`.

| Chunk                                    | Before                   | After annotation                           |
| ---------------------------------------- | ------------------------ | ------------------------------------------ |
| `{ function f(){…} }`                    | rec 29 LOCAL; records 15 | rec 29 **BOUND** `…/record/96`; records 16 |
| `if (true) function f() {} else ;`       | LOCAL                    | **BOUND** `…/record/96`                    |
| `switch (1) { case 1: function f(){…} }` | LOCAL                    | **BOUND** `…/record/96`                    |

**Live 550** already carries the equivalent fix: `index.ts` ≈4178-4189
`temporary(…, false, false, named("AnnexGlobalFunction"))`, plus a conditional type-only import
in `runtime-imports.ts:173-177`, both dated 2026-11-05 01:53. Running the same probe in a
separate live-only process (live `node_modules`, `cwd` = repo root, no frozen modules) gives:

```
{ function f(){…} }  → admission rec 29 BOUND tint.surface.v1/scriptRuntime/5a16f1a3…/record/9 ; records 16
if-decl / switch     → rec 30 BOUND …/record/9 ; records 16
guard sweep (8 chunks incl. verifyProperty chunk, class, for-in, label+try) → no JIT-local surface-shaped records
```

None of this is native evidence. It shows that the **compile-time** record contract is now
bound and the descriptor would be issued by the image. It does not show that the native write
at line 116 succeeds.

## 8. Implementation-ready plan

**F1. Lowering identity (DONE in live; keep).** The admission temporary is typed
`AnnexGlobalFunction`, imported type-only only when admissions exist. The vocabulary grows,
which accounts for the brief's 119/100 frozen vs 121/102 live counts together with
`instantiateEvalDeclarations`. The surface digest changes (frozen `f8009ab6…` → live
`5a16f1a3…`), so every image must be rebuilt. A frozen image cannot pick this up.

**F2. Binding-level regression test (missing).** The live `annex-admission.test.ts` asserts
only on AST/imports. Add a `tools/` test next to `managed-jit-entry.test.ts` that uses
`createManagedScriptFixture()` (run from the repo root):

- For each of `{function f(){}}`, `if (true) function f(){} else ;`, `switch(1){case 1:function f(){}}`,
  and `label:{function g(){}}`:
  - lower with `lowerScript`;
  - call `prepareManagedSurfaceEntry`;
  - assert `ok`;
  - assert that one `managedImports` entry with role `record` has the contract of the surface
    class whose alias resolves to `AnnexGlobalFunction`. Look the alias up through
    `read.directory.records` and `aliasTypes`; do not hard-code `/record/9`.
- Assert `counts.records` is 16 for the block chunk. This is the live probe value; re-derive
  it rather than trusting this doc.
- Repeat with `lowerEvalScript` (IE4) for the same sources once IE6/IE7 wires indirect eval.
  It shares the admission path, and the live AST test already covers `eval`.

**F3. Fail-closed guard in `bindManagedJitRecords` (missing; recommended).** After the class
loop, add a check for unmatched records. If any source type of an unmatched record matches a
surface class alias **modulo `readonly`/`mutable`**, reject with
`profile: record crosses surface without contract: <alias>`. Use the same property names and
field encodings with readonly ignored. Implement this as a relaxed variant inside
`createManagedTypeContractIndex` rather than by matching name sets.

- This turns any future gap of this kind into a deterministic `profile` compile failure
  instead of a native `brk #0`.
- Probe data: over 8 representative chunks, a name-set approximation of this predicate
  flagged **only** the annex admission record (frozen). It flagged **nothing** on live.
- Test it two ways:
  - **Unit:** a synthetic surface `interface R { readonly a: number; b: boolean }` and an
    entry that passes an un-annotated `{a:1,b:true}` to `f(x: readonly R[])` must be rejected.
    With the annotation, it must be bound.
  - **Fixture:** the frozen-style un-annotated admission (rebuild the AST as in `probe4`
    without the patch) must be rejected.
- Do **not** relax `matches` itself. Binding a mutable-`name` JIT layout to an immutable-`name`
  AOT class would hand the JIT write authority the AOT side never granted.

**F4. No AOT runtime change.** `declarations.ts` is correct. The exact-type switch trapping on
a foreign descriptor is the intended last line of defence. A runtime-side fallback (for
example a generic property write) would hide contract skew.

**F5. Re-freeze and validate (main, native).** Run these in order:

1. Workspace checks (tests, typecheck, boundaries, format) with F2/F3.
2. Build a new frozen snapshot.
3. Build the one-case image for `block-decl-global-existing-global-init.js` and run it.
   Expect `pass`.
4. Run the 14 annex `*-existing-*-init.js` cases.
5. Run the full `annexB/language/global-code` selection.
6. Re-run `language/global-code` and confirm 72/75 is unchanged. The two direct-eval
   unsupported cases and the separately retained SIGKILL are unrelated (§10).

Report pass counts only from the native journal.

## 9. Native proof requests for main (debug image already built)

These are against `.tint-bootstrap/annex-eval-trap-debug-v1` (`88bb352d…`, frozen 549). The
addresses come from static analysis of that file.

1. **Trap identity.** At the stop, run `image lookup -va $pc`. Expect
   `instantiateGlobalDeclarations … +0x4fdc`, PC `0x104581070`, `declarations.ts` (the
   nearest line entry is 116/118).
2. **Descriptor proof.** Run `register read x9 x10` and `memory read -s8 -c4 $x9`.
   - Expect `x10 != 0x108a72028` (the AOT `AnnexGlobalFunction` descriptor).
   - Expect `x10` to lie in the published JIT code-storage range rather than the image's
     `__TEXT`.
   - Expect the word at `x9+16` to be a string reference (`"f"`) and `x9+24` to be 0.
   - If `x10 == 0x108a72028`, this diagnosis is **wrong**: stop and re-examine.
3. **Chunk proof.**
   - Run `bt 4`. Frame #1 should resolve to no module, i.e. JIT code.
   - Set `breakpoint set -a 0x10457c094` (function entry) and count hits. Expect three
     entries, one per evalScript chunk, plus the AOT main script if it calls it; the trap
     follows the second chunk's entry.
   - An alternative is to check `plan.annexFunctions` length on each entry.
4. **Fix proof.** Do this only after F1–F3 are frozen: the same one-case run completes, with
   no stop at the corresponding site.

## 10. Do not conflate

- **The SIGKILL in `language/global-code`** (`evalscript-global-sigkill-observation-v1.json`)
  has an unknown cause and a different signature. Nothing here explains it.
- **The two direct-eval unsupported results** are expected sticky unsupported outcomes, not
  traps.
- **E4** (record read, alias matched, identity interned) is fixed in frozen v6 and is not
  re-implicated. This trap is a **write** with **no alias match**.
- **IE6/IE7** (native indirect-eval host wiring) remains the next planning task.
  `lowerEvalScript` uses the same admission path, so F2's eval variant and F3's guard protect
  it too. General `Function` is out of scope.

## 11. Probe appendix (`/tmp/annex-trap-research`, not in repo)

| File                           | Purpose                                                                  |
| ------------------------------ | ------------------------------------------------------------------------ |
| `mem0.hex`, `m0.txt`, `m1.txt` | Captured 512-byte trap windows (batch 0 / batch 1)                       |
| `shape.js`, `cmp.js`           | Normalized shape search and side-by-side compare against the debug image |
| `allsyms.txt`                  | `nm -n` of the debug image                                               |
| `probe/probe1-3.ts`            | Frozen fixture: surface classes, JIT record binding, `matches` verdicts  |
| `probe/probe4.ts`              | In-memory annotation hypothesis test (`patch` / `nopatch`)               |
| `probe/probe5.ts`              | Guard-predicate false-positive sweep                                     |
| `probe-live/`                  | The same probes against live 550, run in a separate process              |

How they were run:

- **Frozen:** `cd .tint-bootstrap/node-toolchain-evalscript-host-v1 && node /tmp/annex-trap-research/probe/probeN.ts '<chunk>'`.
  `/tmp/…/probe/node_modules` is a symlink to the frozen `node_modules`, so frozen
  `workspaceModules('.')` and frozen `dist` are used together.
- **Live:** from the repo root, using `probe-live/` (symlinked to the live `node_modules`).

No probe wrote inside the repo. No image was built and no native binary was run.
