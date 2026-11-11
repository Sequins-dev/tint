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

| Change                                                             | Instructions | Cycles | Outcome                                                                          |
| ------------------------------------------------------------------ | ------------ | ------ | -------------------------------------------------------------------------------- |
| Constants from nonzero 16-bit parts; FMOV immediate; zero register | -7.6%        | -4.4%  | kept (`505793aac`)                                                               |
| Inline multi-block callees across crossing temporaries             | +0.0%        | +0.0%  | reverted: the call sites removed (`lengthList`, number-list length) were not hot |
| d8..d15 promotion without `closedRoots`                            | +0.4%        | +1.1%  | reverted                                                                         |
| Loop-weighted d8..d15 selection                                    | +0.7%        | +0.6%  | reverted                                                                         |
| Reference locals in x19..x28, spilled around safepoints            | +1.4%        | -0.3%  | reverted                                                                         |
| Same, loop-weighted selection                                      | +2.4%        | +0.1%  | reverted                                                                         |

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
