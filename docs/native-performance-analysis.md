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

| Change                                                                                                                                 | Instructions | Cycles | Outcome                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ | ---------------------------------------------------------------------------------------- |
| Constants from nonzero 16-bit parts; FMOV immediate; zero register                                                                     | -7.6%        | -4.4%  | kept (`505793aac`)                                                                       |
| Inline multi-block callees across crossing temporaries                                                                                 | +0.0%        | +0.0%  | reverted: the call sites removed (`lengthList`, number-list length) were not hot         |
| d8..d15 promotion without `closedRoots`                                                                                                | +0.4%        | +1.1%  | reverted                                                                                 |
| Loop-weighted d8..d15 selection                                                                                                        | +0.7%        | +0.6%  | reverted                                                                                 |
| Reference locals in x19..x28, spilled around safepoints                                                                                | +1.4%        | -0.3%  | reverted                                                                                 |
| Same, loop-weighted selection                                                                                                          | +2.4%        | +0.1%  | reverted                                                                                 |
| Integer slots, also converting loads for floating-point uses                                                                           | +4.5%        | +5.0%  | narrowed: every such load paid an `scvtf` the double slot never needed                   |
| Integer slots with integer-only loads; `??` and induction facts                                                                        | +1.2%        | +0.0%  | kept, with the next row                                                                  |
| Immediate shifts by constant counts (UBFM/SBFM)                                                                                        | +0.0%        | -2.2%  | kept (cumulative with the row above)                                                     |
| Collector hot paths as module functions over explicit state                                                                            | -3.8%        | -2.3%  | kept; byte-identical compiler output                                                     |
| Inline raw memory word writes (two calls per collector write)                                                                          | -1.7%        | -1.3%  | kept                                                                                     |
| Branch-free `x ?? constant` (`optional-value-or` + coalesce pass)                                                                      | -0.6%        | -0.5%  | kept; also merges the join so block-local temporaries survive                            |
| Optional-vs-constant equality without materializing the wrap                                                                           | -0.4%        | +0.0%  | reverted                                                                                 |
| 16-byte pair stage in the memory mover (GC and typed-array copies)                                                                     | -0.4%        | -0.3%  | kept                                                                                     |
| Inline allocating callees, block merging, post-inline scalar replacement with dominators                                               | -0.9%        | -1.3%  | kept; peak RSS -208 MB                                                                   |
| Map with direct bucket chains; number/string key maps; one-instruction `Math.imul`                                                     | -3.4%        | -6.5%  | kept; image -880 KB                                                                      |
| Inline callees containing calls; typed spills of crossing values                                                                       | +26%         | +24%   | reverted                                                                                 |
| Dense number lists, presence-test `=== undefined`, int64 comparisons and indexes                                                       | -2.1%        | -2.0%  | kept (`ec09850ed`)                                                                       |
| `lowerSSA` skips stores of parameters passed through unchanged                                                                         | -1.4%        | -2.3%  | kept (`230de94ea`); also unblocked induction proofs                                      |
| AOT optimization budget 200M (was 20M, exhausted before post-inline phases)                                                            | +1.8%        | -3.0%  | kept (`134ae77be`); peak RSS -6%; the compile now finishes its optimization              |
| Temporary candidates sized by raw value ID (sparse IDs disabled allocation)                                                            | +0.0%        | -0.5%  | kept (`134ae77be`)                                                                       |
| Allocating callers may inline reference-using callees                                                                                  | +3.1%        | +3.1%  | reverted; peak RSS +15%                                                                  |
| Leaf functions split d16..d31 between temporaries and whole-function homes                                                             | +0.0%        | +28%\* | reverted (\*sha256 pattern cycles)                                                       |
| String `===` compares the first four units inline before the helper                                                                    | +0.5%        | +2.0%  | reverted: same-length comparisons were rare or cheap in the helper                       |
| Record and cell terminators fall through to their next-block consequent                                                                | -0.4%        | -0.3%  | kept                                                                                     |
| `typedArray[i] ?? 0` as one read                                                                                                       | -0.8%        | -      | kept with the row above (`e9b3bec46`, -1.2% combined)                                    |
| Devirtualize indirect calls to non-capturing `function-new` callees                                                                    | +0.8%        | +0.0%  | reverted; peak RSS +3%: most callbacks capture, so few calls qualified                   |
| `map` resizes its output after the loop (dense sources stay dense)                                                                     | -0.1%        | +0.0%  | kept for map-heavy code (pattern 7.6x -> 7.1x instructions)                              |
| Callee-saved FP registers saved/restored in pairs                                                                                      | -            | -      | kept (`7d8fc9cd2`): about 9,900 fewer instructions, image -33 KB                         |
| Forward/clean up after `??` coalescing in rewritten functions                                                                          | -            | -      | shelved: typedSum 51 -> 38 instructions, compressWords +29 (longer live ranges)          |
| Inline callees with cold fallback calls (list accessors) into allocating callers                                                       | +2.7%        | +4.7%  | reverted; peak RSS +12%, image +860 KB, 2,264 accessor calls inlined                     |
| Lazy root-frame publication (first may-collect block; must-published analysis)                                                         | +0.6%        | -      | reverted: most calls reach a safepoint; image +150 KB (host load: no cycle read)         |
| ROR for 32-bit rotate idioms                                                                                                           | -0.4%        | -0.4%  | kept (`f5a41a718`); sha256 pattern -25% cycles                                           |
| Dispatch family words for union membership tests                                                                                       | -1.3%        | -0.3%  | kept                                                                                     |
| Membership facts across fused union reads (second guard dataflow per function)                                                         | +3.3%        | +3.2%  | reverted: analysis churn (peak RSS +13%) outweighed the skipped tests                    |
| Same facts folded into the single guard dataflow (plan from chain-local proofs)                                                        | +1.7%        | +1.5%  | reverted; peak RSS +13% again: the chain-aware analysis itself is the cost               |
| HIR pipeline fusion: filter/map chains, counted `.length`, short-circuit sinks                                                         | +0.0%        | +0.0%  | kept (`1fc159d86`); feature pipelines 7.1x -> 5.3x Node cycles                           |
| Closure devirtualization (environment-passing twins), closed programs only                                                             | +0.4%        | +0.1%  | kept (`1fc159d86`); pipelines -12% once fused callbacks inline; peak RSS +3%             |
| Values crossing an inlined CFG carried in fresh slots                                                                                  | -            | -      | kept (`1fc159d86`); enables callback inlining at fused call sites                        |
| Interval facts select unchecked typed-array accesses (`array-element`/`array-store`)                                                   | +0.0%        | +0.0%  | kept (`d46b55f7d`); feature numeric 6.5x -> 4.6x Node cycles                             |
| Late sweep after LICM/bounds (fold, forward, dead stores); pure ops removable; sparse IDs forwarded                                    | -            | -      | kept; feature numeric 4.8x -> 3.6x Node cycles                                           |
| Interval facts publish `integerSlots`; integer `*`; integer slots in x24..x28                                                          | -            | -      | kept; numeric 3.6x -> 1.7x (induction and hoisted index products stay int64)             |
| Operands and results in their home registers; register-offset element loads/stores                                                     | -            | -      | kept; numeric 1.7x -> 1.15x, fewer instructions than V8 (31.5G vs 32.2G)                 |
| Dense list reads inline in codegen (vector fast path, accessor call for the rest)                                                      | -            | -      | kept; records 3.7x -> 2.6x, pipelines 4.6x -> 3.9x, collections 9.1x -> 8.6x             |
| `uint32` range assumption on array `.length`; interval facts without typed arrays                                                      | -            | -      | kept; list-indexed loop counters become int64 (optionals 2.9x -> 2.7x)                   |
| Inline `charCodeAt` for exact integer indexes; slice bounds and optional wraps accept int64                                            | -            | -      | kept; strings 1.97x -> 1.88x                                                             |
| String length interval below 2^31 (allocation contract), so `i <= s.length` stays 32-bit                                               | -            | -      | kept; strings 1.88x -> 1.74x                                                             |
| Direct calls for nested functions capturing only direct functions (self/mutual recursion)                                              | -0.4%        | -0.3%  | kept (frozen workload; image -680 KB); interpreter 2.8x -> 1.7x, recursion 3.1x -> 2.5x  |
| Fused collect sinks append (push fast path); dense list `has` inline like reads                                                        | -0.35%       | +0.0%  | kept; pipelines 3.95x -> 3.1x                                                            |
| Root-word zeroing pairs beyond STP reach through an x16 base                                                                           | -0.5%        | -1.6%  | kept (frozen workload)                                                                   |
| Frame slot sharing for frames above 64 bytes (was 4096): fewer root words to zero                                                      | -2.0%        | -4.8%  | kept (frozen workload; image -740 KB); feature total 3.0x -> 2.9x                        |
| Callee-saved pairs beyond STP reach through an x16 base                                                                                | -0.2%        | -0.5%  | kept (frozen workload)                                                                   |
| Emitter forwards frame words still held in a register (straight-line, cleared at joins)                                                | -1.3%        | -1.3%  | kept (frozen workload; image -230 KB)                                                    |
| Equality with a folded `reference-none`/`string-none` tests the other word against zero                                                | -0.6%        | -0.2%  | kept (frozen workload)                                                                   |
| Dense list writes inline (element store, length extension, barrier; accessor otherwise)                                                | -1.75%       | -1.5%  | kept (frozen workload); collections 8.2x -> 7.45x                                        |
| Memory word guards: int64 arguments skip the exactness test; CBZ/UBFX checks; int64 results                                            | -0.6%        | -0.1%  | kept (frozen workload): the collector is load-latency bound                              |
| Slot register allocation by sharing group, loop-depth weighted (numbers d8..d15, words x22..x28)                                       | -0.6%        | -3.2%  | kept (frozen workload): replaces top-8-slots-by-use homes                                |
| Reference slots in GP homes, spilled to frame words around safepoints (clean homes skip stores)                                        | +1.1%        | -1.4%  | kept (frozen workload); output byte-identical                                            |
| Spill cost factor 1 (was 2); eight GP homes (was seven)                                                                                | -            | +0.0%  | reverted: neutral                                                                        |
| Rematerialize rarely loaded closure captures from the environment at use                                                               | +0.8%        | +0.9%  | reverted: captures passed along are loaded often enough that two loads per use lose      |
| Late sweep also covers record-read lowering; `o === wrap(v)` folds to `(o ?? NaN) === v`                                               | -0.85%       | -0.3%  | kept (frozen workload)                                                                   |
| Reference temporaries crossing calls but no safepoint live in callee-saved word registers                                              | -0.2%        | -2.9%  | kept (frozen workload); allocation operands count as crossing (read after allocating)    |
| Fast-path twins: inline a callee's call-free prefix, cold fallback restarts the original                                               | -0.2%        | +0.75% | reverted: pipelines 3.1x -> 2.8x, but frozen image +2.4 MB; a 40-op cap loses pipelines  |
| Inline typed-array and scalar record writes in callees                                                                                 | -0.4%        | +0.15% | reverted: neutral on the frozen workload and feature kernels                             |
| LICM: invariant scalars and checked immutable reads to unique preheaders                                                               | -0.5%        | -0.2%  | kept; peak RSS -117 MB; strings -6%, pipelines -2% instructions                          |
| Slot register homes in open modules (runtime and collector), every call a safepoint there                                              | -0.4%        | -2.6%  | kept (frozen workload); collector loop variables leave the stack                         |
| Inline memory words: LSR/EXTR range and alignment checks, folded constant windows, results in temporaries                              | -2.1%        | -2.6%  | kept (frozen workload); collector reads about 25 -> 12 instructions                      |
| Leaf integer and boolean words in callee-saved GP homes (x19..x28, three or more accesses)                                             | +0.1%        | -1.3%  | kept (frozen workload); a two-access threshold measured +0.35%                           |
| Integer slots kept when integer-use loads outweigh double-use loads (loop weighted); others convert                                    | +0.0%        | -1.3%  | kept (frozen workload); e.g. hash accumulators returned as doubles                       |
| Operands read from their register homes (branches, conversions, unary FP, comparisons, CSET targets)                                   | -2.3%        | -1.4%  | kept (frozen workload); scratch copies before use removed                                |
| Record reads and terminators address through the object's GP home and load into the result's home                                      | -2.3%        | -1.1%  | kept (frozen workload); closure capture unpacking halves                                 |
| Fold proven record reads' constant success branches before the late sweep (conditions die)                                             | -1.5%        | -1.9%  | kept (frozen workload); every lowered read had emitted a dead `true`                     |
| Bitwise operations read word operands from GP homes and compute into the result's home                                                 | -1.1%        | -0.8%  | kept (frozen workload); sha256 rounds lose their x9/x13 shuffles                         |
| Typed-array accesses index through the index's and array's GP homes                                                                    | -1.0%        | -0.8%  | kept (frozen workload)                                                                   |
| Function-local cleanup allowance 1M (was 50k; 16 large functions skipped the late sweep)                                               | -0.06%       | +0.15% | reverted: neutral                                                                        |
| Word temporaries overflow into x4..x8 when their lifetime crosses no opaque operation                                                  | +0.0%        | -0.0%  | reverted: neutral (rarely applies)                                                       |
| String and typed-array lengths as exact int64 for integer uses                                                                         | -0.25%       | -0.15% | kept (frozen workload); no double round trip for loop bounds                             |
| Unguarded inlining limits 24 blocks / 128 expansion (was 12 / 64)                                                                      | -0.05%       | +0.25% | reverted                                                                                 |
| Equality with string literals up to eight units inline (length and units; branch-free up to four)                                      | -0.8%        | -1.1%  | kept (frozen workload); discriminant `kind` tests skip the string-equal helper           |
| Record fields placed `kind` first, then single words, then wider fields                                                                | +0.8%        | +0.15% | reverted                                                                                 |
| Record fields placed `kind` first, otherwise source order                                                                              | +0.4%        | -0.3%  | reverted: mixed, image +130 KB; needs union-aware layout                                 |
| Repeated union field reads of an unchanged object reuse an earlier read over a superset of layouts                                     | -1.4%        | -0.3%  | kept (frozen workload); instructionResult IR 1094 -> 484 lines                           |
| String literals used only by inline equality tests are not materialized                                                                | -0.8%        | -0.4%  | kept (frozen workload)                                                                   |
| Union field reads: variants needing the same conversion share one transfer slot and block (chains fuse)                                | -1.0%        | -0.8%  | kept (frozen workload)                                                                   |
| Fused `typedArray[i] ?? d` for any fallback (all-ones absence word on integer arrays)                                                  | -0.0%        | -0.0%  | reverted: the hot reads reach `??` through a slot, not in one block                      |
| Two-word optional slots (number, boolean) in GP register pairs; their loads stop aliasing                                              | +0.4%        | -0.0%  | reverted: two-word temporaries stay in memory, so slots alone gain nothing               |
| Cell accesses after a successful access to the same cell skip the state test (`initialized`)                                           | -0.9%        | -0.1%  | kept (frozen workload): instructions; captured counters in closures                      |
| Fused `typedArray[i] ?? constant` for any element type (the read selects the final number)                                             | -0.25%       | -0.4%  | kept (frozen workload): `(a[i] ?? NaN) === x` from equality folding                      |
| Devirtualize closures read from environment fields written only with one closure                                                       | -0.0%        | -0.0%  | reverted: siblings live in cell boxes one level down; box records need exposure analysis |
| Stack check `cmp sp, x16` (SUBS extended) instead of `mov x17, sp; cmp x17, x16`                                                       | -0.23%       | +0.35% | reverted: fewer instructions, more cycles                                                |
| Devirtualize closures read from record fields (cell boxes) written only with one closure (closed records); twins from rewritten bodies | -0.4%        | -1.2%  | kept (frozen workload); image +36% (27.2 -> 37.0 MB), RSS +0.1%                          |
| Same, closure entries forward to their twins instead of duplicating bodies                                                             | +0.8%        | -0.3%  | reverted: image 26.4 MB, but the extra call on indirect paths costs cycles               |
| Unguarded inlining limits 24 / 128 after closure devirtualization                                                                      | -0.1%        | -0.05% | reverted: neutral, limits rarely bind                                                    |
| FMOV immediates for small integer constants in float comparisons (was SCVTF of the int64)                                              | -0.0%        | -0.0%  | reverted: neutral                                                                        |
| Optional integer-array reads in slots as numbers with NaN for absence (presence `v === v`)                                             | -0.05%       | -0.05% | reverted: neutral                                                                        |
| Loads alias reference-homed slots when no safepoint falls within the loaded value's lifetime                                           | -1.4%        | -0.4%  | kept (frozen workload): environment unpacking loses its register copies                  |
| Frame-word forwarding kept across single-predecessor fallthrough blocks                                                                | -0.0%        | +0.0%  | reverted: neutral (a forwarded load becomes a move)                                      |
| Leaf functions share value frame words by block-local lifetime (per size and class); word-only values are integer words                | -0.3%        | -0.3%  | kept (frozen workload): sha256 rounds stop spilling                                      |
| Word-only values as GP temporary candidates in non-leaf functions; word temporaries overflow into x4..x8                               | -0.0%        | -0.0%  | reverted: neutral                                                                        |

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

Feature benchmark (`tools/feature-bench`, tint/Node cycles, 2026-11-12, after
the layered pipeline and bounds work): interpreter 2.8x, records 4.1x,
closures 3.5x, pipelines 4.7x, collections 8.7x, strings 2.1x, numeric 4.8x,
recursion 3.3x, exceptions 0.7x, optionals 3.0x, sorting 2.0x,
serialization 2.8x; total wall 3.8x (was 4.2x). After integer slot facts,
GP slot homes and direct register operands: numeric 1.15x, total wall 3.4x.
With inline dense list reads and length range facts: total wall 3.2x. With
direct calls between module functions: total 3.0x.

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
