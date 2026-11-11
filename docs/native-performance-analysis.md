# Native self-compile performance analysis

Status: analysis and plan, 2026-11-11. Measurements use the self-compile on
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

1. **Exact integer representation.** Values proven to be safe integers
   (bitwise results, constants, lengths, induction slots, bounded sums) are
   held as int64 when every consumer can use them directly: bitwise
   operations, array indexes, integer comparisons, bounded `+`/`-` and
   stores to integer slots. Number slots proven to hold 32-bit integers
   become integer words, which may also live in x19..x28 because they are
   not traced. This removes the double conversions on every array index,
   counter update and hash step (the `compressWords` gap is about 10x).
2. **Collector.** About 18% of self-compile time, mostly survivor scanning;
   the nursery size is already tuned. Reduce scanning work in the collector
   itself and allocation volume in generated code.
3. **List fast paths.** Element reads and writes go through out-of-line
   accessors with a sparse fallback; a small inlinable fast path would remove
   call and frame overhead at about 3,000 read sites.
