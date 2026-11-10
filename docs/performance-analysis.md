# Performance analysis: static cost profiles and PGO

Status: design (2026-11-11); step 1 in progress.

## Goal

Estimate where an executable spends its time without running it, with
outputs that agents can explore. The same data model later drives
profile-guided optimization (PGO), using either static estimates or measured
profiles.

## Model

- **Block frequency:** relative execution count of each IR block. Static
  estimates use Wu–Larus-style branch probabilities: loop back edges are
  likely, edges to traps, throws and descriptor-guard failures are very
  unlikely, other branches are even. They are propagated within each function
  and then through the call graph (entry function = 1). Measured profiles
  (sampled or instrumented) replace the estimate where present.
- **Block cost:** cycles per execution of a block's machine code, from a
  resource model of the target core. For Apple M1 Firestorm (per Dougall
  Johnson's measurements):
  - 8-wide rename;
  - 6 integer units, 2 of them branch units, at most 1 taken branch per
    cycle;
  - 4 load/store units (2 store-capable, 3 load-capable);
  - 4 FP/SIMD units;
  - zero-cost moves (`mov x, x`, `mov #0`, some immediates);
  - compare-and-branch fusion;
  - load-to-load latency 3c, load-to-ALU latency 4c.

  The first version uses resource bounds plus simple latency penalties.
  Block-throughput predictors such as uiCA reach under 1% error on Intel;
  llvm-mca and OSACA are around 10–30%. A coarse model is enough for ranking.
- **Estimated cycles** of a function: the sum over its blocks of frequency ×
  cost × function entry frequency. Reports rank functions and break cost
  down by instruction class: memory traffic, frame spills, conversions,
  dispatch, calls and branches.

## Artifacts

- `CompileRequest.analysis` returns the final IR and per-block machine
  offsets with the compiled program; builds forward them to an
  `onAnalysis` callback per module. Off by default.
- `tools/perf-estimate.ts` writes a JSON report (per function: estimated
  cycles, frequency, size, class breakdown, hottest blocks with source spans)
  plus a short text ranking.
- Validation: compare against a sampled profile of the same build (rank
  correlation of per-function self time) and record the agreement in each
  report, so the model's accuracy is always visible.

## PGO roadmap

1. Static estimates feed codegen decisions that need frequencies: block
   layout (cold paths out of line), inlining budgets, which slots get
   registers, where spills go.
2. Measured profiles: map samples back to IR blocks through the same block
   offsets, and use them in place of static estimates.
3. AOT can afford whole-program decisions with this data: heavy work on hot
   code, size-oriented code for cold code.

References: [uiCA](https://arxiv.org/abs/2107.14210);
[Wu, Larus, "Static branch frequency and program profile analysis" (1994)](https://klasses.cs.uchicago.edu/archive/2017/fall/32001-1/papers/wu-larus-profiling.pdf);
[Firestorm microarchitecture](https://dougallj.github.io/applecpu/firestorm.html).
