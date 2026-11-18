# Test262 suite program: one whole-program image (v1)

Date: 2026-11-18. Host: macOS arm64, 18 cores, 128 GB, shared with other
agents (load average 10–48 during these runs). Node 24.12, `TZ=UTC`, pinned
Test262 `91c70759`. Branch `test262/suite-program`.

## What was built

`TINT_TEST262_LINKING=suite` (see [the runner contract](../test262-runner.md#suite-images))
compiles the engine and every selected variant as **one whole program**, in
program mode, and runs each variant in a fresh process selected by its index.

- Execution variants keep program-mode case hosts; identical lowered Scripts
  (the shared harness files) are one module.
- Parse/early-negative variants are embedded as source text and checked at
  run time by the engine's own front end (the parse and lowering that
  `$262.evalScript` applies: syntax, binding, early errors), with their goal
  and strictness. Nothing is compiled or evaluated.
- Build failures are attributed per variant with the compiler error, kept
  apart from run outcomes (`compilation.suite` in each report).
- The image is admitted once (first launch) before any case's budget starts;
  variants then run six at a time.

## Results

Every slice reproduces the deduplicated per-variant ledger (all passes); no
variant failed to build, and no variant needed the dynamic path other than the
parse/early negatives.

| Report                                                                                | Variants |  Pass |             Dynamic early errors | Build failures |
| ------------------------------------------------------------------------------------- | -------: | ----: | -------------------------------: | -------------: |
| [built-ins/Map](test262-suite-program-map-v1.json)                                    |      405 |   405 |                                0 |              0 |
| [built-ins/Set](test262-suite-program-set-v1.json)                                    |      764 |   764 |                                0 |              0 |
| [built-ins/WeakRef](test262-suite-program-weak-ref-v1.json)                           |       58 |    58 |                                0 |              0 |
| [built-ins/FinalizationRegistry](test262-suite-program-finalization-registry-v1.json) |       94 |    94 |                                0 |              0 |
| [built-ins/WeakMap](test262-suite-program-weak-map-v1.json)                           |      281 |   281 |                                0 |              0 |
| [built-ins/WeakSet](test262-suite-program-weak-set-v1.json)                           |      170 |   170 |                                0 |              0 |
| [language/expressions/object](test262-suite-program-expressions-object-v1.json)       |    2,252 | 2,252 |                   300 (all pass) |              0 |
| [language/module-code](test262-suite-program-module-code-v1.json)                     |      602 |   602 | 166 module-goal parse (all pass) |              0 |
| [built-ins/Array](test262-suite-program-array-v1.json) (earlier toolchain, see below) |    6,119 | 6,119 |                                0 |              0 |

All but Array use toolchain `tc-final` with `TINT_TEST262_MODULES=1`.
`language/module-code` includes 31 resolution-phase negatives; they build as
ordinary module cases and their loader reports the resolution error at run
time. The Array report comes from an earlier frozen toolchain of this branch
(before the merge of launch admission and the `compilation.suite` summary; its
first launches therefore include admission in their budget). An earlier
`language/expressions/object` run without `TINT_TEST262_MODULES=1` recorded the
one module variant as a preparation build failure ("native module execution is
not implemented"): a run configuration, not a compiler failure.

## Wall time against the batch modes (built-ins/Map, 405 variants)

Same frozen toolchain (baselines: [program](test262-suite-program-map-baseline-program-v1.json), [units](test262-suite-program-map-baseline-units-v1.json); the suite range spans this toolchain and `tc-final`), concurrent load from other agents:

| Mode                    | Images | Compile                                 | Admission | Wall      |
| ----------------------- | -----: | --------------------------------------- | --------- | --------- |
| program, batch 128      |      4 | 2,148 s (330–705 s each)                | 1.4–761 s | 2,941 s   |
| units, batch 128 (cold) |      4 | host 1,068 s + units 119 s + links 16 s | 1.4–3.0 s | 1,243 s   |
| suite                   |      1 | 486–758 s                               | 1.7 s     | 500–791 s |

One 761 s admission in the program run is the host-wide first-launch queue the
load-timeout investigation describes; the suite pays one admission per run
(1.4–35 s here, except WeakRef and WeakSet, whose images waited 1,132 s and
1,342 s in that queue behind other agents' binaries; no case budget included
it).
Execution: 10–15 ms per variant (p50), 12–24 ms p90, so a 6,119-variant image
runs in about 2 minutes at six processes.

## Scaling

Node-hosted compile (one process), image and peak resident memory against
compiled variants:

| Selection                   | Variants |     Compile |                    Peak RSS |    Image |
| --------------------------- | -------: | ----------: | --------------------------: | -------: |
| 1 file (2 variants)         |        2 |   414–556 s |                  4.4–6.4 GB |  92.5 MB |
| language/statements/break   |       40 |       476 s |                      6.0 GB |  94.8 MB |
| built-ins/Map               |      405 |   486–758 s |                  5.5–8.8 GB | 135.0 MB |
| built-ins/Set               |      764 |   429–974 s |                 6.7–10.5 GB | 164.2 MB |
| language/module-code        |      602 |       358 s |                      9.1 GB | 184.8 MB |
| language/expressions/object |    2,252 | 551–1,278 s |                     16.0 GB | 339.3 MB |
| built-ins/Array             |    6,119 |     3,961 s | 42.2 GB (63.4 GB footprint) | 1,231 MB |

Compile time is dominated by the engine (about 400 s alone) and by host load;
the marginal cost is 0.09 s/variant uncontended (object) to 0.58 s/variant under
load average 40 (Array). Memory and image size grow linearly:

- **Memory:** about 5–6 MB of Node heap per variant (object 4.9 MB, Array
  6.2 MB). The whole program's IR stays resident through optimization and
  emission.
- **Image:** 104–186 KB per variant. Native module statistics (Map, object) put
  40 KB of that in code and 62–67 KB in safepoint tables; Array's tables are
  larger (~146 KB per variant). Program-module tables average 73 live
  references per distinct map (8 bytes each) and 26 KB frames; test262 entry
  closures have large frames with many live temporaries at every call.
- `__tint_initialize` grows about 1.5–2.2 KB per variant (13.7 MB for Array):
  the program initializer is one function holding every module's top-level
  initialization.
- Calls beyond BL's 128 MiB reach take the long (x16) form, which suite
  images above Map's size need; execution time per variant did not change
  measurably.

## The whole `language` + `built-ins` selection

92,100 variants: 8,672 parse/early negatives (dynamic path, source text only)
and 83,428 compiled variants. The first hard limit, the linker's 4,096-module
bound (the Array image links 12,350 modules), is fixed: the bound is now 2^20.
Extrapolating the measured per-variant costs to 83,428 compiled variants:

| Resource         | Projection  | Limit                                                                                                                                                                                            |
| ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node-hosted heap | 410–520 GB  | 128 GB host (shared)                                                                                                                                                                             |
| Image            | 8.8–15.6 GB | 4 GiB Mach-O file (32-bit `LC_SYMTAB`, `LC_DYLD_CHAINED_FIXUPS` and `LC_CODE_SIGNATURE` offsets into `__LINKEDIT`, which must follow `__TEXT`; 32-bit code-signature limits in the image writer) |
| Compile time     | 2.5–13.5 h  | none                                                                                                                                                                                             |

So the full binary cannot be built today; nothing short of compiler work gets
past either limit, and both exceed it by 2–4x:

1. **Compiler memory (3.2–4x over).** Whole-program compilation keeps every
   function's IR alive until emission. Options: emit and drop functions as
   soon as whole-program analyses no longer need their bodies (streaming
   emission), or host the build in the native self-hosted compiler (not yet
   able to build Test262 programs; generated modules are in-memory sources).
2. **Image size (2.2–3.9x over).** Safepoint tables are 60–80% of the bytes per
   variant. A packed map encoding (16-bit word indexes, four per word, or
   runs) would cut them about 4x and needs a new table version in codegen and
   the collector's stack walk (`native-runtime/src/tracing/scan.ts`). That
   alone brings the projection to 4.8–6.5 GB; code (40 KB/variant, 3.3 GB) also
   has to shrink, or the image must be split below the format limit.

## Recommendation

The run-time model works: one admission, 10–15 ms launches, results identical
to batch modes, with build failures and dynamic early errors reported
separately. The compile-once economics also hold: for Map the suite took
500–790 s against 2,941 s for program batches of 128, and Array's 6,119
variants compiled in one 66-minute build (48 program batches would recompile
the engine 48 times).

One image for all of `language` + `built-ins` needs the two compiler changes
above first (memory before size: size only matters for a build that
completes). Within today's limits, the largest buildable image on this host is
about 15,000–20,000 compiled variants (memory) and 22,000–39,000 (format).
