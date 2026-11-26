# Typed code generation against Node: baseline and fix plan

23 November 2026. Phase 1 of the typed code-generation stream (PR #17): how
much slower typed TypeScript compiled by Tint is than the same text under Node
26.13.1, why, and in what order to fix it.

**Setup.**

- Benchmark sources: [`tools/typed-bench/`](../../tools/typed-bench/) at
  `1c17f171c` (main `183ec7044` plus the benchmark). The compiler and runtime
  are main's.
- Hosts:
  - macOS: Apple M5 Max (18 cores), macOS 26.6.2, Node 26.13.1
    (`/opt/homebrew/bin/node`).
  - Linux: the shared `dev` machine (Debian 12, kernel 6.1, 9 CPUs, arm64) on
    the same Apple host, with the official Node 26.13.1 linux-arm64 build.
    Images were built inside `dev` (Linux target, `TMPDIR` under the worktree).
- Images: typed suite `f6973077284f391c…` (macOS) and `eb800351f38b8d47…`
  (Linux); class suite `7a8e4527a4ec60b6…` and `7176923b0d494d59…`. Debug
  symbols off.

**Protocol.**

- `bench.ts measure`, 15 rounds per suite, `TZ=UTC`. macOS ran under
  `tools/gate/with-lock.sh both` (timing and launch locks); Linux took no macOS
  lock.
- Each round ran Node and Tint once. Round r starts at engine r mod 2, and odd
  rounds run in reverse.
- Native runs went under LLDB, which had to report the stop at entry and exit
  42, and every one did. Node had to exit 0, and every run did.
- Each run executes every kernel once cold and then five times warm. A run's
  steady value is the median of its warm iterations. Cells are medians across
  rounds with the interquartile range; ratios are paired within each round.
- One-minute load at round starts: macOS 2.7–3.5 (typed) and 2.8–6.3
  (classes); Linux 0.1–0.9 and 0.8–2.5. Some Linux rounds overlapped the macOS
  profiling runs below (single-threaded, on the shared host).

Raw rounds: macOS [typed](typed-codegen-baseline-v1-darwin-typed.json),
[classes](typed-codegen-baseline-v1-darwin-classes.json); Linux
[typed](typed-codegen-baseline-v1-linux-typed.json),
[classes](typed-codegen-baseline-v1-linux-classes.json). Profile summaries:
[profiles](typed-codegen-baseline-v1-profiles.json).

## Kernels

The suite is plain typed TypeScript in erasable syntax. Node runs the stripped
text; Tint compiles the same text with `TINT_GENERAL_FALLBACK=0` and
`requireTyped`, so every typed measurement is of typed code.

| Kernel | What it does |
| --- | --- |
| `allocation`, `numeric`, `calls`, `strings`, `compiler` | PR #15's Worker kernels, unchanged and at the same scales |
| `typedArrays` | `Uint32Array`, `Uint8Array` and `Float64Array` read/modify/write loops |
| `stringEquality` | Fresh (split) strings against literals, a `switch` and a list |
| `stringBuild` | `+=`, template literals, `String(n)`, `String.fromCharCode`, `charCodeAt` |
| `mapSet` | `Map<string, number>`, `Map<number, number>` and `Set<number>` |
| `closures` | Captured counters, function values, `map`/`filter` callbacks |
| `arrays` | `number[]` push/pop, indexed and `for…of` loops; record arrays |
| `escape` | Short-lived records from a small function, some kept |
| `classes` | Fields, methods and a polymorphic method call (separate image; see below) |

**Typed-only gaps met while writing the suite.** Each is a construct the
TypeScript text uses naturally and Tint rejects under `TINT_GENERAL_FALLBACK=0`.
The suite uses the noted replacement; the gaps belong in the
[gap table](../unified-pipeline.md#known-typed-only-gaps-and-the-slice-that-removes-them):

| Construct | Rejection | Suite uses |
| --- | --- | --- |
| Any class (fields, constructor, methods) | `module instance classes require scoped contract and construction lowering` (runtime stage) | a separate `classes` image that falls back to general semantics |
| Class `extends` | `class inheritance contracts require heritage checking` | (same) |
| Class instance assigned to a structural interface | `value does not match its declared type` | (same) |
| Method call on a class union, even after `instanceof` or discriminant narrowing | `invalid method call` | (same) |
| `new Int32Array(n)` | `Realm constructor Int32Array requires library overload lowering` | `Uint32Array` |
| `number[]#reduce` | `invalid method call` | `for…of` sum |

## Results

Steady state is the stricter comparison (V8 at its optimizing tier); cold is
the first iteration, which includes V8's tier-up.

**macOS arm64**, ms per iteration:

| Kernel | Node steady | Tint steady | Tint / Node steady | Node cold | Tint cold | Tint / Node cold |
|---|---:|---:|---:|---:|---:|---:|
| `allocation` | 4.1 (4.0–4.2) | 13.9 (13.8–14.0) | 3.44 (3.38–3.48)× | 16.9 (13.8–17.4) | 14.8 (14.7–15.1) | 0.90 (0.86–1.12)× |
| `numeric` | 10.0 (9.9–10.5) | 45.2 (44.8–46.8) | 4.50 (4.37–4.56)× | 11.1 (10.9–11.5) | 46.7 (46.0–47.2) | 4.18 (4.06–4.25)× |
| `calls` | 18.5 (18.4–19.6) | 51.6 (51.1–52.2) | 2.77 (2.65–2.83)× | 20.1 (19.9–20.9) | 53.0 (52.2–53.9) | 2.62 (2.55–2.68)× |
| `strings` | 12.0 (11.9–12.5) | 25.0 (24.9–25.2) | 2.08 (2.06–2.10)× | 12.9 (12.7–13.1) | 25.6 (25.3–26.2) | 2.01 (1.97–2.05)× |
| `compiler` | 8.7 (8.7–8.9) | 36.9 (36.6–39.3) | 4.30 (4.21–4.48)× | 11.2 (10.8–11.6) | 37.1 (36.9–38.2) | 3.40 (3.22–3.50)× |
| `typedArrays` | 18.3 (18.0–18.9) | 48.1 (47.9–48.8) | 2.65 (2.61–2.69)× | 21.8 (21.0–22.3) | 48.3 (47.8–49.6) | 2.28 (2.23–2.33)× |
| `stringEquality` | 11.9 (11.7–12.3) | 12.3 (12.3–12.4) | 1.04 (1.00–1.08)× | 12.5 (12.2–12.9) | 12.5 (12.2–13.0) | 1.01 (0.98–1.03)× |
| `stringBuild` | 18.1 (17.6–18.3) | 53.2 (52.8–54.5) | 2.94 (2.91–3.03)× | 19.1 (18.4–19.4) | 53.7 (53.0–55.5) | 2.90 (2.75–2.94)× |
| `mapSet` | 19.6 (19.5–20.2) | 47.0 (46.5–47.0) | 2.37 (2.34–2.40)× | 21.0 (20.8–21.5) | 48.0 (47.4–48.9) | 2.30 (2.20–2.31)× |
| `closures` | 3.4 (3.3–3.5) | 12.7 (12.4–12.8) | 3.74 (3.66–3.86)× | 9.0 (8.9–9.6) | 12.7 (12.6–13.2) | 1.41 (1.35–1.43)× |
| `arrays` | 19.8 (19.6–20.5) | 80.7 (79.6–82.7) | 4.12 (3.97–4.15)× | 23.3 (22.4–23.5) | 81.0 (80.1–82.3) | 3.47 (3.44–3.63)× |
| `escape` | 10.6 (10.5–11.1) | 28.3 (28.2–28.5) | 2.66 (2.58–2.69)× | 12.3 (12.1–12.6) | 28.2 (28.0–28.4) | 2.31 (2.27–2.33)× |
| `classes` (fallback) | 15.7 (15.3–17.2) | 1,547.6 (1,499.2–1,621.1) | 97.9 (94.3–99.8)× | 20.1 (18.3–20.4) | 1,579.4 (1,512.4–1,675.9) | 81.5 (75.4–88.9)× |

**Linux arm64** (`dev`), ms per iteration:

| Kernel | Node steady | Tint steady | Tint / Node steady | Node cold | Tint cold | Tint / Node cold |
|---|---:|---:|---:|---:|---:|---:|
| `allocation` | 5.6 (5.0–5.7) | 14.5 (14.4–15.0) | 2.75 (2.63–2.88)× | 18.8 (17.6–19.5) | 20.6 (20.4–21.5) | 1.10 (1.08–1.17)× |
| `numeric` | 10.5 (10.0–11.3) | 47.7 (45.7–48.6) | 4.53 (4.11–4.69)× | 12.4 (11.7–12.7) | 48.2 (46.4–49.5) | 3.98 (3.75–4.05)× |
| `calls` | 19.6 (19.3–20.6) | 53.2 (52.2–55.8) | 2.72 (2.66–2.77)× | 21.8 (21.5–22.7) | 55.4 (53.6–56.3) | 2.48 (2.44–2.59)× |
| `strings` | 14.0 (13.5–14.4) | 27.5 (26.4–28.2) | 1.96 (1.95–2.02)× | 15.7 (15.1–15.9) | 28.2 (26.6–29.3) | 1.82 (1.79–1.86)× |
| `compiler` | 10.0 (9.6–10.2) | 40.2 (38.4–41.2) | 4.01 (3.94–4.05)× | 13.2 (12.7–14.0) | 40.7 (39.1–42.2) | 3.05 (2.98–3.17)× |
| `typedArrays` | 19.3 (18.7–19.8) | 50.2 (48.8–51.1) | 2.60 (2.56–2.68)× | 24.2 (23.6–26.1) | 49.6 (48.9–51.1) | 2.03 (1.97–2.07)× |
| `stringEquality` | 12.6 (12.3–13.3) | 12.8 (12.5–13.5) | 1.02 (0.99–1.04)× | 13.8 (13.2–14.5) | 13.2 (12.7–13.5) | 0.94 (0.89–0.99)× |
| `stringBuild` | 21.1 (20.2–21.5) | 58.6 (57.3–60.7) | 2.82 (2.74–2.94)× | 21.7 (20.6–22.0) | 58.5 (56.5–60.9) | 2.71 (2.67–2.76)× |
| `mapSet` | 20.4 (19.9–21.2) | 51.3 (49.7–52.1) | 2.55 (2.44–2.58)× | 21.8 (21.2–22.6) | 51.6 (49.6–53.2) | 2.37 (2.29–2.40)× |
| `closures` | 3.8 (3.7–3.9) | 13.3 (13.1–13.7) | 3.57 (3.48–3.67)× | 10.8 (10.5–11.2) | 13.6 (13.3–14.4) | 1.25 (1.23–1.31)× |
| `arrays` | 21.9 (21.2–22.6) | 86.1 (82.8–88.4) | 3.89 (3.77–4.03)× | 25.9 (25.3–26.4) | 89.2 (84.9–89.5) | 3.40 (3.28–3.45)× |
| `escape` | 11.8 (11.4–12.1) | 29.6 (28.8–30.4) | 2.53 (2.45–2.68)× | 14.2 (13.1–14.5) | 29.7 (28.6–30.7) | 2.14 (2.04–2.23)× |
| `classes` (fallback) | 17.0 (16.1–18.4) | 1,679.7 (1,636.2–1,713.1) | 99.9 (91.4–102.0)× | 20.9 (20.3–24.5) | 1,640.4 (1,611.1–1,696.2) | 77.9 (71.8–79.2)× |

**Tint loses every typed kernel at steady state, on both hosts**, from parity
(`stringEquality`, 1.02–1.04×) to 4.5× (`numeric`). The two hosts agree within
about 0.3× per kernel, so the causes are in generated code, not the platform.
The Worker report's ratios under load (1.9–4.1×) hold on a quiet host.

**Classes are 98–100× slower**: they are not typed code today (see "Decision
needed").

## Where the time goes

Profiles: one image per kernel with debug symbols and operation ranges, run for
41 iterations under `pprofessor run --main-thread --freq 999`, after an LLDB
smoke run of the same image. Attribution uses `pprofessor analyze` (by
function, inlined frames keeping their source function) and
`tools/op-cost/analyze.ts` (by IR operation and operand representation).

V8's code: `node tools/typed-bench/bench.ts v8-script <kernel> k.mjs`, then
`node --print-opt-code --code-comments k.mjs` (Node 26.13.1, no other flags;
`--print-opt-code-filter=numeric` for the first dump). Instruction counts below
are static instructions of one loop iteration.

| Kernel | Share of Tint samples | Instruction-level cause | V8 instead |
| --- | --- | --- | --- |
| `numeric` | stencil loop ~90% | 91 instructions per stencil element vs V8's 28: the `field[i-1]`/`field[i+1]` reads are not proven in bounds, so each is a checked `array-read` (11 instructions: header length and data pointer reloaded, bounds test materialized with `cset`/`cbz`, the result NaN-boxed as an optional number) followed by a 5-instruction `?? 0` unbox and a dead frame store; the write spills its value to the frame and reloads the header again; each `+ 1` materializes the constant through two moves. The hash step is 21 instructions vs 6: constants rebuilt every iteration, `\| 0` as `mov xzr; orr; sxtw`, results moved into their homes | Bounds checked per access but proven reads are plain `ldr d`, values stay unboxed doubles; hash loop unrolled 4×, `eor w, w, w, lsr #15` folds the shift |
| `typedArrays` | 99% in the kernel | Bounds are proven here (`array-element`), yet the `Uint32Array` loop is 37 instructions per element vs V8's 9, and the byte loop 33 vs 11: element values are carried as doubles (`ucvtf`) and converted back (`fcvtzs`) for every integer operation, on the loop-carried chain; `(x * 3 + round) \| 0` runs in double arithmetic and then a 7-instruction checked ToInt32; data pointers reload per access; dead spills before stores | Truncation analysis: `(x*3 + round)\|0` is two `add w` instructions (`add w, w, w, lsl #1`); int32 element values in GP registers; unrolled 4× |
| `compiler` | `stringToNumber` 68% | `Number(token.text)` on short decimal integers always builds two 150-word bignums and runs `roundedRatio` (`shift`, `natural`, `compare`); `array-initialize` (zeroing those bignums) 2.7% | Direct integer accumulation for short decimal strings |
| `strings` | `decimalInteger` + `numberToString` 29%, `string-concat-copy` 21%, `string-starts-with` 11% | `String(n)` prepends one `String.fromCharCode` per digit (one allocation and copy per digit, `% 10` and `Math.floor` in doubles); `+=` copies both operands as UTF-16, 8 bytes per loop iteration | Smi-to-string with a number-string cache; one-byte strings; ropes for `+=` |
| `stringBuild` | `string-concat-copy` 47%, number→string 26% | As `strings`: `text += \`${i}:…\`` copies the whole accumulated text every step | Rope append, flattened once at `charCodeAt` |
| `arrays` | `readNumberList` 21%, `resizeNumberList` 17%, `pushNumberList` 12% | `number[]` operations are runtime TypeScript inlined by size: push inlines as 16 blocks; `pop` (cost 144 > 128) and reads beyond the inliner's "reference allowance" stay calls; the list length is a double field converted on every `i < stack.length` | Inline fast-elements push/pop: capacity test, store, length bump |
| `allocation` | number lists 40% (`pushNumberList` 25%, `createNumberList` 11%), `array-initialize` 8% | Each `[a, b, c]` literal creates a NumberList and its `Float64Array` through runtime calls and pushes; `>>> 16` of a double product calls `to-uint32` | Inline literal allocation with its elements |
| `closures` | number lists 31%, closure bodies 17% | `map`/`filter` results are NumberLists filled by `pushNumberList`; reads through `readNumberList` | Inlined callbacks, fast elements |
| `escape` | the inner loop | Both engines scalar-replace `delta` and allocate the result once per iteration. Tint's inline allocation is about 22 instructions: the allocation context is reloaded from the frame (`ldr [sp]` → `ldr [x, #0x38]`, a dependent chain that takes the most samples), then an object-start bitmap read-modify-write; the record reads of `total` re-check its descriptor | Bump allocation in about 4 instructions from a register-relative top, no side bitmap |
| `calls` | the loop | `points[i-1]` reloads the list header per read; `points.length` is a double reloaded and converted (`fcvtzs`) every iteration; `Vector` reads check two descriptors because every `{x, y}` literal in the program (here also `escape`'s `Point`) shares the structural type; `\| 0` of the double sum is the 11-instruction checked conversion (11% of samples); stores of references into slot homes 14% | One map check per object, Smi field arithmetic, `\| 0` folded into int32 adds |
| `mapSet` | `findMap` 29%, `findSet` 16%, `hashString` 7%, `valueHash` 6%, `pushList` 8% | Every `get`/`set` rehashes the string key and walks linked entries through generic runtime code; number keys go through the generic `valueHash` | String hash cached in the string header; inline OrderedHashMap probe |
| `stringEquality` | kernel 91% | At parity. Remaining costs: `k` is a double (from `%`), so `k < reservedWords.length` and the `reservedWords[k]` call each convert | — |

**Cross-cutting patterns**, in every kernel:

1. **Integer values carried as doubles.** A number gets integer storage only if
   every use accepts integers (`findIntegerUses`); one double use (`+ round`
   with a double loop counter, a call argument, a record field) keeps it a
   double, and each integer use then pays `fcvtzs`/`scvtf`. Loop counters
   bounded by a `number` parameter (`round < scale`) are always doubles.
2. **No int32 truncation.** `\| 0`, `>>> 0`, `&`, `^`, `Math.imul` and integer
   typed-array stores consume ToInt32/ToUint32, but their operands are computed
   in doubles first. V8 propagates the truncation and computes in `w`
   registers when the exact value fits 2^53.
3. **Instruction selection.** Constants are materialized into a temporary
   through a scratch register at every use (`mov x9, #k; mov x19, x9`) instead
   of immediate operands; results go to a temporary and then `mov` to their
   slot home; values are spilled to the frame before typed-array stores.
4. **Loop-invariant headers reloaded.** Typed-array data pointers and lengths,
   list headers and list lengths are reloaded per access.
5. **Runtime-library hot paths** (number↔string, `number[]`, Map/Set) are
   general TypeScript that V8 replaces with specialized inline code.

## Fix plan, ranked

Ranked by expected gain across the suite per unit of risk. Gains are estimates
from the sampled shares above (removing a share s at most divides time by
1/(1 − s)); every change is measured with candidate images in the same rotated
protocol and reverted if it does not help.

| # | Fix | Where | Kernels (expected steady ratio after) |
| --- | --- | --- | --- |
| 1 | **Decimal string→number fast path**: integers and ≤ 15 significant digits with \|exponent\| ≤ 22 converted exactly with one double multiply or divide (Clinger); the bignum path only beyond | `foundation/numeric/number-text` | `compiler` 4.3× → ~1.5× |
| 2 | **Integer number→string fast path**: digits written into one fresh string (two digits per step), no per-digit allocation | `foundation/numeric/number-text` | `strings` 2.1× → ~1.5×, `stringBuild` 2.9× → ~2.2× |
| 3 | **Typed-array access**: bounds proofs for affine indexes (`i ± c` under `c ≤ i < length − d`), so reads are unchecked and `?? 0` folds; element values in integer registers; data pointer and length hoisted out of safepoint-free loops; Float64 stores straight from `d` registers | `ir/optimization/bounds.ts`, `licm.ts`, codegen | `numeric` 4.5× → ~1.3×, `typedArrays` 2.65× → ~1.5× |
| 4 | **Instruction selection**: immediate operands (add/sub/cmp/logical/shift), results computed into slot homes, no dead pre-store spills | codegen | every loop: about 10–25% of loop instructions |
| 5 | **Int32 truncation and integer storage**: compute truncated expressions in 32-bit integer arithmetic when intervals prove the exact result fits 2^53; keep integer storage when integer uses dominate; `FJCVTZS` for the remaining double→int32 (an Apple-target property; Linux needs an explicit JSCVT target contract); induction variables bounded by a `number` stay int64 under a `bound ≤ 2^53` preheader guard | IR representation pass, codegen | `typedArrays` → ~1.1×, `calls` −15%, `numeric` hash loop, `allocation`, `closures` |
| 6 | **`number[]` fast paths**: inline push/pop/read/write/length for dense NumberLists (vector fast path, runtime call otherwise), as dense reference lists already are; integer length | codegen, `foundation/collections/number-list.ts` | `arrays` 4.1× → ~1.8×, `allocation` 3.4× → ~2×, `closures` 3.7× → ~2.5× |
| 7 | **String append**: a loop-local `s += t` whose value is not read in the loop builds into a growable buffer, materialized once; wider (16-byte) copies elsewhere | IR transform, string helpers | `stringBuild` → ~1.2× with #2, `strings` −20% |
| 8 | **Allocation fast path**: allocation context kept in a register or loaded once per function instead of per allocation; the object-start bitmap update out of the inline path if the collector allows (needs a collector review) | codegen, runtime | `escape` 2.7× → ~1.6×; also `allocation`, `compiler`, `mapSet` |
| 9 | **Map/Set**: cached string hashes, number-key hashing and probe inline | `foundation/collections` | `mapSet` 2.4× → ~1.4× |
| 10 | **Record reads on shared structural types**: layout facts through list elements and inlined arguments, one descriptor check per object per iteration | `ir/optimization` | `calls` −10%, `escape` |

Items 1–3 are independent and low risk. Items 4 and 5 change code for every
program, so each also needs the frozen v7 and self-compile timings. Item 8
touches the allocation/collector contract and is coordinated with the GC
owners; PR #12 owns object shapes and calls for untyped code, so item 10 checks
its branch first.

**Reaching parity on every kernel will take more than this list.** V8 also
unrolls hot loops (4× here) and specializes small integers in records (Smi
fields), which these items do not cover. After items 1–8 the expected
remaining gaps are `calls`, `mapSet` and `closures`; the stream re-profiles
after each item and re-ranks.

## Decision needed: typed classes

The `classes` kernel is 98–100× Node because classes do not compile as typed
code at all: the whole module falls back to the general path, which PR #12 is
re-architecting. Making classes typed is native class lowering (scoped
construction, a class ABI, heritage, structural assignability and method calls
on class unions). That is feature work beyond this stream's performance scope,
and class-heavy TypeScript cannot be faster than Node until it exists. Phase 2
proceeds with the ranked items; the orchestrator should decide who owns typed
class lowering.
