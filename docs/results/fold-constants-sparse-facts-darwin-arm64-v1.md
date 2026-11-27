# `foldFunctionConstants` sparse fact storage — Darwin arm64 & Linux x86-64 validation (`v1`)

November 27, 2026. Base commit `97e337ba0471e24ce0a7bf71b5ea68241e458727` (`origin/main`), branch `perf/fold-constants-sparse-facts`.

## Change summary

`foldFunctionConstants` in `packages/ir/src/optimization/index.ts` previously allocated ten fresh dense arrays per basic block (`values`, `wraps`, `present`, `absent`, `texts`, `arrayLengths`, `slots`, `slotTexts`, `slotGeneralTags`, `slotArrayLengths`) and wrote `undefined` into `arrayLengths[op.id]` on every `load` and into all four slot tables on every `store`. After earlier optimization passes leave sparse value IDs above 2.6 million in large functions (notably function 8154 with 21,549 blocks and 35,119 instructions), each block grew dense backing arrays to the maximum sparse ID or slot index (~41.3 billion indexed elements in pass 62 alone).

This change:

1. Replaces all block-local value-indexed and slot-indexed fact arrays in `foldFunctionConstants` with function-scoped `Map`/`Set` instances (`NumberKeyMap` / `NumberNumberMap` / `NumberKeySet` natively), cleared in O(1) only when `.size > 0` at block boundaries and effect barriers, and released on function exit.
2. Never writes unknown/`undefined` facts on `load` or `store` (stores with unknown values delete only if the map is non-empty).
3. Lazily copies block `instructions` and function `blocks` only when a block actually rewrites an instruction, and merges the `hasGeneralIs` scan into the `fresh` ID scan (and hoists `wrappedInBlock` in the optional-number pre-scan).

## Byte-identical output & fixpoint verification (`TZ=UTC`, LLDB verified stop-at-entry + exit 0)

| Check | Binary / output | Bytes | SHA-256 | Result |
| --- | --- | ---: | --- | --- |
| Unmodified `origin/main` (`97e337ba0`) Darwin arm64 reference | `serial-fold-main-darwin-aarch64` | 45,623,178 | `61139651d9240168c66d1666ad2087d145fd3055c2d08ea98a213f2d27a70157` | Reference |
| Candidate Node-hosted compiling `origin/main` → Darwin arm64 | `main-from-candidate-darwin` | 45,623,178 | `61139651d9240168c66d1666ad2087d145fd3055c2d08ea98a213f2d27a70157` | **Byte-identical (`cmp` 0)** |
| Candidate native `stage1` compiling `origin/main` → Darwin arm64 (all 3 pairs) | `bench/pair-{1,2,3}/candidate-out` | 45,623,178 | `61139651d9240168c66d1666ad2087d145fd3055c2d08ea98a213f2d27a70157` | **Byte-identical (`cmp` 0)** |
| Candidate Darwin arm64 self-host fixpoint (`stage1 == stage2`) | `candidate-darwin-stage{1,2}` | 45,623,178 | `f208b4ff350542a1ebabcf908c652c2773fcb8be7023eedd44896d96da991403` | **Byte-identical (`cmp` 0)** |
| Unmodified `origin/main` native `stage1` compiling `origin/main` → Linux x86-64 | `main-from-main-x64` | 152,643,280 | `535be3ea3b677bc3c630a88fddd5295b6d9056324a99aa7e53d96da7eadc7818` | Reference |
| Candidate Node-hosted compiling `origin/main` → Linux x86-64 | `main-from-candidate-x64` | 152,643,280 | `535be3ea3b677bc3c630a88fddd5295b6d9056324a99aa7e53d96da7eadc7818` | **Byte-identical (`cmp` 0)** |
| Candidate Linux x86-64 fixpoint & 1.25 GiB `oldCapacity` headroom (`--managed-bytes 3221225472`) | `candidate-x64-stage1` vs `candidate-x64-stage2-headroom` | 152,667,976 | `d642560a23008f291955883081114b5e344a8be754f5e4c04daca95b72b8074f` | **Byte-identical (`cmp` 0)**, 91.18 s, 1,508,032 KiB peak RSS (1,447.72 MiB `phys_footprint`) |

## Paired native Darwin arm64 self-compile benchmark

3 interleaved pairs (`main/candidate`, `candidate/main`, `main/candidate`), each pair under its own `tools/gate/with-lock.sh both` ticket, `TZ=UTC`, compiling the identical frozen `origin/main` (`97e337ba0`) source snapshot with `--pass-stats` under LLDB (asserting stopped-at-entry and inferior exit 0) and `cmp`-verified byte-identical output on every run.

### Summary (3-pair medians)

| Metric | `origin/main` median (range) | Candidate median (range) | Delta (median) |
| --- | ---: | ---: | ---: |
| Whole-build wall time | 164.69 s (164.08–166.36 s) | **125.01 s** (124.69–125.25 s) | **−39.69 s (−24.1%)** |
| Whole-build CPU time | 251.25 s (250.37–254.70 s) | **150.04 s** (149.67–150.45 s) | **−101.21 s (−40.3%)** |
| Whole-build cycles (PMU) | 1,047.16 G (1,044.54–1,055.66 G) | **637.70 G** (635.70–638.84 G) | **−409.46 G (−39.1%)** |
| Whole-build instructions (PMU) | 5,283.60 G (5,283.43–5,283.85 G) | **3,408.90 G** (3,408.65–3,408.97 G) | **−1,874.70 G (−35.5%)** |
| All 4 `fold-constants` passes | 40,756.7 ms (40,460.4–41,323.3 ms) | **1,157.9 ms** (1,155.8–1,161.9 ms) | **−39,598.8 ms (−97.2%, 35.2× faster)** |
| Pass 2 (`3,464,915` visited / `137,560` rewritten) | 1,308.1 ms (1,307.8–1,351.5 ms) | **238.5 ms** (237.9–239.9 ms) | **−1,069.7 ms (−81.8%)** |
| Pass 19 (`3,191,669` visited / `34,334` rewritten) | 7,594.5 ms (7,594.2–7,625.4 ms) | **221.1 ms** (220.2–221.6 ms) | **−7,373.4 ms (−97.1%)** |
| Pass 42 (`1,114,254` visited / `1,403` rewritten) | 2,658.1 ms (2,646.2–2,907.7 ms) | **78.9 ms** (78.8–79.2 ms) | **−2,579.2 ms (−97.0%)** |
| Pass 62 (`2,898,028` visited / `5,687` rewritten) | 29,176.9 ms (28,856.3–29,513.6 ms) | **617.7 ms** (617.5–624.3 ms) | **−28,559.2 ms (−97.9%, 47.2× faster)** |
| Peak RSS (`ps rss`, 4 GiB heap) | 2,162,464 KiB (2,162,224–2,162,896 KiB) | 2,238,816 KiB (2,238,448–2,240,288 KiB) | +76,352 KiB (+3.5%, see GC phase note) |
| Peak `phys_footprint` (4 GiB heap) | 2,081.80 MiB (2,081.55–2,082.19 MiB) | 2,156.25 MiB (2,155.94–2,157.71 MiB) | +74.45 MiB (+3.6%, see GC phase note) |

### Per-pair observations

| Pair (order) | Variant | Wall (s) | CPU (s) | Cycles (G) | Instructions (G) | Fold total (ms) | Pass 62 (ms) | Peak RSS (KiB) | Peak time (s) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 (`main`, `cand`) | `origin/main` | 166.36 | 254.70 | 1,055.66 | 5,283.85 | 41,323.3 | 29,513.6 | 2,162,464 | — |
| 1 (`main`, `cand`) | candidate | 125.01 | 150.04 | 637.70 | 3,408.90 | 1,157.9 | 617.7 | 2,238,816 | — |
| 2 (`cand`, `main`) | `origin/main` | 164.69 | 251.25 | 1,047.16 | 5,283.43 | 40,460.4 | 28,856.3 | 2,162,224 | 142.55 |
| 2 (`cand`, `main`) | candidate | 125.25 | 150.45 | 638.84 | 3,408.97 | 1,161.9 | 624.3 | 2,238,448 | 97.99 |
| 3 (`main`, `cand`) | `origin/main` | 164.08 | 250.37 | 1,044.54 | 5,283.60 | 40,756.7 | 29,176.9 | 2,162,896 | 143.32 |
| 3 (`main`, `cand`) | candidate | 124.69 | 149.67 | 635.70 | 3,408.65 | 1,155.8 | 617.5 | 2,240,288 | 98.68 |

### Peak RSS audit (4 GiB vs 3 GiB heap)

In both `origin/main` and candidate, peak RSS does **not** occur during `fold-constants`; timestamped sampling in pairs 2–3 shows peak RSS and peak `phys_footprint` occur mid-`emit-native-code` (pass 75): at `142.55–143.32 s` in `origin/main` (~21 s into the 42.5 s emission pass) and at `97.99–98.68 s` in candidate (~15 s into the 41.6 s emission pass). Under the default 4 GiB self-host heap (`managedBytes = 4,294,966,272`, `oldCapacity = 1,792 MiB`, `youngCapacity = 256 MiB` in `packages/native-runtime/src/generational.ts`), major compaction triggers only when `youngTop > oldCapacity - oldTop`. Eliminating the ~330 GB of garbage allocations in pass 62 shifts which nursery evacuation crosses `oldCapacity` during `emit-native-code`, changing the transient `oldTop + youngTop` high-water mark within the 256 MiB nursery window by ~75 MiB. All temporary `Map`/`Set` fact tables in `foldFunctionConstants` are function-local and cleared on block boundaries; under the tighter 3 GiB heap (`--managed-bytes 3221225472`, `1.25 GiB` `oldCapacity`), native Linux x86-64 cross-emission completes in `91.18 s` at `1,508,032 KiB` peak RSS (`1,447.72 MiB` `phys_footprint`), confirming no retained memory regression.

## Workspace gates

- `pnpm typecheck` (`pnpm build && tsc -p tsconfig.tests.json && tsc -p tsconfig.host.json`): pass
- `pnpm boundaries`: pass
- `pnpm format:check` & `git diff --check`: pass
- `node --test packages/ir/test/optimization-*.test.ts`: pass (including new sparse `>= 2_500_000` value-ID test)
- `node tools/check-test-files.ts concurrent`: 6,471/6,472 pass (only failure is absent `.tint-bootstrap/test262` checkout)
- `node tools/check-test-files.ts memory`: 242/242 pass
- `node --test tools/selfhost-linked.test.ts`: 19/19 pass
