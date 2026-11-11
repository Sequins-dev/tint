# Native self-compile performance analysis

Status: analysis and plan, updated 2026-11-12. Measurements use the self-compile on
a fixed source snapshot (macOS arm64, quiet host, TZ=UTC); each comparison
runs both compilers on the same sources.

## Where the time goes

Baseline at `505793aac`: 35.4 s wall, 627G instructions, 152G cycles. The
Node-hosted bootstrap takes 12.9 s.

- **Cycle bottlenecks** (Instruments CPU Counters, bottleneck mode, user
  space): useful 42.1%, instruction processing 48.7%, discarded
  (mispredicted) work 6.0%, instruction delivery 3.1%. The compiler is
  back-end bound; front end and branch prediction are not the problem.
- **Instructions still matter:** removing 7.6% of instructions (constant
  materialization) removed 4.4% of cycles, consistent with the useful share.
- **Instruction mix:** 30% of static instructions are `sp`-relative loads and
  stores; in the 60 hottest functions, weighted by sampled time, 28% are
  stack loads/stores and 16% moves. Sampled program counters land on stack
  loads (31%), heap loads (21%), stack stores (16%) and moves/constants (16%),
  but sampling skid attributes stalls to the instruction after a long-latency
  one, so these are not cycle shares.
- **Locals by type** (IR loads/stores weighted by function time): reference
  slots in memory about 45%, number slots in d8..d15 25%, number slots in
  memory 17%, optional numbers 5%.
- **Against V8, by function** (self seconds native vs Node):
  `sha256-compression.ts:compressWords` 2.3 vs 0.2 (integer arithmetic held
  as doubles), the collector (`cheney.ts`) 4.6 vs about 1.5 (Node main-thread
  GC), `key-index.ts` hashing and lookup 2.3 vs 0.9, `relates` 2.1 vs 0.9,
  list helpers (`__tint_reference_list_*`, number lists, `memory-move`)
  about 2.5 vs inlined in V8.

## Experiments

| Change                                                                                   | Instructions | Cycles | Outcome                                                                          |
| ---------------------------------------------------------------------------------------- | ------------ | ------ | -------------------------------------------------------------------------------- |
| Constants from nonzero 16-bit parts; FMOV immediate; zero register                       | -7.6%        | -4.4%  | kept (`505793aac`)                                                               |
| Inline multi-block callees across crossing temporaries                                   | +0.0%        | +0.0%  | reverted: the call sites removed (`lengthList`, number-list length) were not hot |
| d8..d15 promotion without `closedRoots`                                                  | +0.4%        | +1.1%  | reverted                                                                         |
| Loop-weighted d8..d15 selection                                                          | +0.7%        | +0.6%  | reverted                                                                         |
| Reference locals in x19..x28, spilled around safepoints                                  | +1.4%        | -0.3%  | reverted                                                                         |
| Same, loop-weighted selection                                                            | +2.4%        | +0.1%  | reverted                                                                         |
| Integer slots, also converting loads for floating-point uses                             | +4.5%        | +5.0%  | narrowed: every such load paid an `scvtf` the double slot never needed           |
| Integer slots with integer-only loads; `??` and induction facts                          | +1.2%        | +0.0%  | kept, with the next row                                                          |
| Immediate shifts by constant counts (UBFM/SBFM)                                          | +0.0%        | -2.2%  | kept (cumulative with the row above)                                             |
| Collector hot paths as module functions over explicit state                              | -3.8%        | -2.3%  | kept; byte-identical compiler output                                             |
| Inline raw memory word writes (two calls per collector write)                            | -1.7%        | -1.3%  | kept                                                                             |
| Branch-free `x ?? constant` (`optional-value-or` + coalesce pass)                        | -0.6%        | -0.5%  | kept; also merges the join so block-local temporaries survive                    |
| Optional-vs-constant equality without materializing the wrap                             | -0.4%        | +0.0%  | reverted                                                                         |
| 16-byte pair stage in the memory mover (GC and typed-array copies)                       | -0.4%        | -0.3%  | kept                                                                             |
| Inline allocating callees, block merging, post-inline scalar replacement with dominators | -0.9%        | -1.3%  | kept; peak RSS -208 MB                                                           |
| Map with direct bucket chains; number/string key maps; one-instruction `Math.imul`       | -3.4%        | -6.5%  | kept; image -880 KB                                                              |
| Inline callees containing calls; typed spills of crossing values                         | +26%         | +24%   | reverted                                                                         |
| Dense number lists, presence-test `=== undefined`, int64 comparisons and indexes         | -2.1%        | -2.0%  | kept (`ec09850ed`)                                                               |
| `lowerSSA` skips stores of parameters passed through unchanged                           | -1.4%        | -2.3%  | kept (`230de94ea`); also unblocked induction proofs                              |
| AOT optimization budget 200M (was 20M, exhausted before post-inline phases)              | +1.8%        | -3.0%  | kept (`134ae77be`); peak RSS -6%; the compile now finishes its optimization      |
| Temporary candidates sized by raw value ID (sparse IDs disabled allocation)              | +0.0%        | -0.5%  | kept (`134ae77be`)                                                               |
| Allocating callers may inline reference-using callees                                    | +3.1%        | +3.1%  | reverted; peak RSS +15%                                                          |
| Leaf functions split d16..d31 between temporaries and whole-function homes               | +0.0%        | +28%\* | reverted (\*sha256 pattern cycles)                                               |
| String `===` compares the first four units inline before the helper                      | +0.5%        | +2.0%  | reverted: same-length comparisons were rare or cheap in the helper               |
| Record and cell terminators fall through to their next-block consequent                  | -0.4%        | -0.3%  | kept                                                                             |
| `typedArray[i] ?? 0` as one read                                                         | -0.8%        | -      | kept with the row above (`e9b3bec46`, -1.2% combined)                            |
| Devirtualize indirect calls to non-capturing `function-new` callees                      | +0.8%        | +0.0%  | reverted; peak RSS +3%: most callbacks capture, so few calls qualified           |
| `map` resizes its output after the loop (dense sources stay dense)                       | -0.1%        | +0.0%  | kept for map-heavy code (pattern 7.6x -> 7.1x instructions)                      |
| Callee-saved FP registers saved/restored in pairs                                        | -            | -      | kept (`7d8fc9cd2`): about 9,900 fewer instructions, image -33 KB                 |
| Forward/clean up after `??` coalescing in rewritten functions                            | -            | -      | shelved: typedSum 51 -> 38 instructions, compressWords +29 (longer live ranges)  |
| Inline callees with cold fallback calls (list accessors) into allocating callers         | +2.7%        | +4.7%  | reverted; peak RSS +12%, image +860 KB, 2,264 accessor calls inlined             |
| Lazy root-frame publication (first may-collect block; must-published analysis)           | +0.6%        | -      | reverted: most calls reach a safepoint; image +150 KB (host load: no cycle read) |
| ROR for 32-bit rotate idioms                                                             | -0.4%        | -0.4%  | kept (`f5a41a718`); sha256 pattern -25% cycles                                   |
| Dispatch family words for union membership tests                                         | -1.3%        | -0.3%  | kept                                                                             |
| Membership facts across fused union reads (second guard dataflow per function)           | +3.3%        | +3.2%  | reverted: analysis churn (peak RSS +13%) outweighed the skipped tests            |

The integer facts were narrower than they looked: a present-guarded `x ?? 0`
unwrap counted as possibly NaN, and induction certificates required a unique
predecessor chain, so any `if` or `??` in a loop body disqualified the
counter. Both are fixed in `@tint/ir/scalar`. Integer slots now pay their
cost only in leaf functions, where the leaf allocator still gives them FP
registers (an `fmov` per access); GPR homes for integer words are next.

Collection: the self-compile runs 136 minor collections and one major
(LLDB breakpoints on the two collect sites), allocating about 17 GB through
the 128 MiB nursery. V8 allocates 24.6 GB for the same compile (377
scavenges, 10 mark-compacts) with 1.06 s of main-thread GC pause, against
about 6 s here: allocation volume is not the deficit, scavenge cost is.
Reading the collector's result at each return (LLDB) gives 3.24 GB copied
over 142 collections: one major of 774 MB and minors with a median of
8.4 MB (about 6.5% nursery survival). Survivor aging would not reduce copying
(a survivor is copied once either way) and there is a single major to save,
so it is not pursued for this workload; scavenge throughput (about 0.5 GB/s,
single-threaded) is the remaining collector gap.

Pattern benchmarks (`tools/pattern-bench`) run identical TypeScript under
Node and tint and report instructions and cycles per operation net of each
engine's startup. Before the inlining work: Map get/set 18.7x (number keys)
and 22.7x (string keys) Node's cycles; array push and guarded read 3.6x;
escaping record allocation 2.8x; closure calls 2.3x; temporary records
2.1x; switch on kind 1.8x; typed-array loops 1.4x. Temporary records fell to
1.1x once helper calls inline and their records are scalar replaced, which is
how V8 avoids those allocations (inlining plus escape analysis). Several
patterns also include `%`, which lowers to a floating-point remainder helper.

Register-caching references does not pay on this core: stack loads hit L1
with store-to-load forwarding, and spills around safepoints add instructions.
Rank work by the dynamic profile, not by static call-site counts.

## Plan

Node reference: 12.9 s. Native self-compile at `134ae77be`: about 30 s
(quiet host), 129G cycles. The gap is broad, so the plan pairs measurement
tooling with progressively stronger optimization phases, from high-level
constructs (pipelines, loops) down to instruction selection.

### Tooling

- **Pattern benchmarks** (`tools/pattern-bench`): identical TypeScript under
  Node and tint; per-operation instructions and cycles net of startup.
- **V8 comparison** (`tools/pattern-bench/compare.ts`): one function's code
  under tint (DWARF lines) and V8 (`--print-opt-code` source positions),
  classified identically, per source line.
- **Operation cost analyzer** (`tools/op-cost`): codegen records the
  instruction range each IR operation lowered to and its operands'
  representations (int/i32/f64/const or type; register or memory). Joined
  with a pprofessor profile, it ranks operation signatures by samples beyond
  a register-resident lower bound (`lower-bounds.ts`). Excess over the
  bound marks where to look; every change still needs its own A/B (the
  inline string prefix had excess and lost 2%).
- **Next tooling:** per-loop views (trip counts, invariant operations,
  vectorizable shapes); V8-derived bounds per operation signature; a
  "beyond V8" report of operations whose static types prove more than V8
  can speculate (fixed layouts, integer ranges, non-aliasing fresh arrays).

Whole-program ranking (self-compile, before the fallthrough change): guarded
record reads 50K sites, 11.4 instructions each, 9.1% of samples (bound 2);
string `===` 14 instructions, 3.5%; optional numbers held as two memory
words (stores, `undefined`, equality, unwrap) about 5%; branches on booleans
in memory about 2%; typed-array reads with double indexes 18-19
instructions.

### Phase 1: representation and scalar simplification

1. **Exact integers.** Safe integers held as int64 wherever every consumer
   accepts them (bitwise, comparisons, typed-array indexes and elements,
   bounded `+`/`-`, integer slots); induction slots, lengths and `?? 0` reads
   proven integral. Remaining: GPR homes for integer words (leaf functions
   still pay an `fmov` per access), double indexes in typed-array reads, range
   analysis for bounded slots and loop versioning when a bound is unknown.
2. **Constant folding extensions.** Strings (literal concatenation and
   `length`); algebraic identities (`x | 0`, `x >>> 0` on proven integers,
   `x * 1`, `x - 0`, double negation, nested masks); strength reduction
   (power-of-two multiply to shift, `% 2^k` to a mask on non-negative
   integers; `%` is still 2x Node).
3. **Optional numbers and booleans in registers.** A value and presence pair
   as two register words (or a NaN-boxed single word where the payload
   excludes that NaN), so `undefined` stores, equality and unwraps stop
   round-tripping through the frame.
4. **Fused idioms.** `typedArray[i] ?? 0` as one checked load (done); `?? c`
   for other constants via a select; `x === undefined` as a presence test
   (done).

### Phase 2: guards and memory

1. **Record guard cost.** A necessary guard is null check, descriptor load,
   descriptor address and compare. Fall through to the success block (done);
   compare against a literal-pool descriptor (one load instead of ADRP+ADD);
   fold the field load into the success path.
2. **Guard elimination.** Codegen already drops guards proven by the
   join-crossing descriptor dataflow; extend it interprocedurally (parameters
   whose every caller passes one layout) and across calls when layouts are
   module-stable.
3. **Loop-invariant code motion.** Hoist pure operations and record/length
   reads whose object and field are not written in the loop (record write
   effects and calls kill), via loop analysis on dominators and preheaders.
4. **Bounds-check elimination.** Integer ranges plus induction facts prove
   `i < length` once per loop; loop versioning when the bound is unknown.

### Phase 3: calls and allocation

1. **Direct callback calls.** Array higher-order methods already lower to
   inline loops, but each element calls the statically known callback
   through `call-indirect`, which the inliner cannot see. Devirtualizing
   non-capturing callbacks alone did not pay (see Experiments): most
   callbacks capture loop or function locals. The next step is inlining with
   an explicit closure environment (the callee's environment reads become
   reads of the `function-new` environment operand), or lowering inline
   arrow callbacks directly into the pipeline loop (Phase 4).
2. **Inlining with cold paths.** Inlining every list-accessor call site
   (fast path inline, sparse fallback call kept cold) lost 4.7%: the
   self-compile also compiles the larger IR, so code growth costs about as
   much as the call overhead saved. Inline only profile-hot sites, or make
   the out-of-line fast path cheaper (call overhead below) instead.
3. **Call overhead.** Paired callee-saved saves/restores; callee-saved FP
   registers only for slots live across calls, caller-saved otherwise;
   shrink-wrapped root-frame publication for functions whose fast path has no
   safepoint.
4. **Leaf register allocation.** Leaf functions give d16..d31 to the 16 most
   used frame words for the whole function; every other temporary lives in
   memory. Replace with lifetime-based allocation over slots and values (a
   static split lost; see Experiments).

### Phase 4: iterator pipelines

Chains such as `xs.filter(f).map(g)`, `map(...).join`, `filter(...).length`
and `some`/`every`/`find` sinks become explicit pipelines (source, stages,
sink) before loop lowering, so each link is a narrow, analyzable step:

1. **Fusion** into one loop without intermediate arrays. Unfused, every `f`
   runs before any `g`; fusing interleaves them, so fusion requires callbacks
   proven free of observable effects (no writes beyond their locals, no
   effectful calls; a throwing `f` must not be preceded by an effectful `g`).
2. **Preallocation and representation:** `map` knows its output length;
   `filter` can bound it; element storage follows the static element type
   (typed or number lists instead of boxed references).
3. **Vectorization decisions** at the pipeline level (Phase 6), where element
   independence is explicit.

The compiler itself uses `.map` 251 times, `.find` 146, `.some` 137, `.every`
46 and `.filter` 23.

### Phase 5: loops

1. **Loop analysis infrastructure:** natural loops, preheaders, trip-count
   and induction descriptions shared by LICM, versioning, unrolling and
   vectorization.
2. **Unrolling** of small counted loops with constant or proven bounds,
   flattening static loops completely when the body is small.
3. **Induction variable integerization** and loop-carried value
   representation (counters, indexes and accumulators as integers).

### Phase 6: vectorization (NEON)

V8 does not auto-vectorize JavaScript (its SIMD is WebAssembly only); static
types make this a place to go beyond it.

1. **ISA:** NEON loads/stores, integer and floating-point lane arithmetic,
   comparisons, selects and reductions in `@tint/codegen`.
2. **Loop vectorizer** for counted loops over typed arrays with independent
   iterations: element types from the static types, non-aliasing proofs (a
   `map` output is a fresh array), scalar remainders, and reductions (sum,
   min/max, any/all for `some`/`every`).
3. **Targets in the self-compile:** bitset union/intersection over
   `Uint32Array` in `analyzeSlots` and `shareFrameSlots` (about 5% of
   samples combined), ASCII fast paths in `decodeUTF8`, fills and copies.
   For user programs: typed-array `map`/`forEach` with arithmetic callbacks.

### Phase 7: collector

About 11% of self-compile samples (scavenge throughput about 0.5 GB/s,
single-threaded). Reduce scanning work in the collector and allocation volume
in generated code (scalar replacement after inlining, fused pipelines).
