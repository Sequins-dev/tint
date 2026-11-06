# D → P: repeated catch/eval compilation candidate (preliminary)

D worktree: `/Users/stephenbelanger/.t3/worktrees/tint/t3-ab259366`.
Evidence commit: `9534cab02332a87c2fc5ce5a18a9a12eefcca08e` (on main b7aa59a).
D continues its conformance selections; no timeout budget has been raised.

## Reproduction

Unchanged pinned test:
`annexB/language/eval-code/direct/var-env-lower-lex-catch-non-strict.js`.
It performs eight direct evals inside one catch block: ordinary/generator/async/async-generator function declarations, a var declaration, and three zero-iteration loops. The declared functions are not called.

## What is established

- Phase 1 complete Annex B direct-eval report: **309/310**, zero unsupported; this case timed out after confirmed native entry at the original 300000 ms budget. Its last recorded process snapshot at 01:19:47 has **260.07 CPU seconds / 266 seconds elapsed**, before timeout. This establishes a high-CPU slow run, but not its exact subphase.
- Fresh main-based heartbeat toolchain, single-case recheck: **0/1, timeout**, inferior PID 25090. Last CPU sample: **203.91 CPU seconds / 296 seconds elapsed**. Conservative single-thread upper bound ~207.91 CPU seconds in the 300 s budget. This new recheck is **load-induced/inconclusive**, not proof of a native hang. Start load **45.62**, idle **0%**; end load **42.43**, idle **0.28%**.
- One-case AOT build itself took roughly ten wall minutes. Heartbeat STALLs were investigated with Node samples; its CPU continued increasing.
- Native `sample` at CPU ~65, at the execution STALL, and at CPU ~177 produced raw address stacks. Stacks advance between observations; functions are unsymbolized. Exact JIT-preparation hot functions are **not yet identified**.

## Why this may be the shared preparation problem

This is an inference, not a symbolized finding: the JS source has no sustained user-code work, and each tiny direct eval traverses the same `createScriptEntryCompiler → prepareManagedSurfaceEntry → prepareManagedJitProgram → prepareCollectionRuntimes` pipeline profiled by B. The repeated native work and deep changing raw stacks make this a useful additional repeated-compilation workload for P. Do not attribute all cost to preparation until symbolized/phase instrumentation confirms it; catch-scope resolution remains another hypothesis.

## Evidence

All paths below are relative to D's worktree:
- `docs/results/d-catch-single-phase2-analysis-v1.json` — load, CPU classification, references.
- `docs/results/d-catch-single-phase2-process-v1.jsonl` — ~30 s CPU ledger, all descendants.
- `docs/results/test262-d-catch-single-phase2-v1.json{,l}` and `.log` — complete native observation and worker heartbeat.
- `docs/results/d-catch-single-{sample-25090-60,sample-25090-150,stall-25090}.txt` — unsymbolized native samples.
- `docs/results/annexb-closure-phase1-process-progress.jsonl` — earlier near-full-core snapshot.
- Fresh source graph **ff22a2a0…**, 568 files; earlier Phase 1 graph **da3801b4…**. These are separate source snapshots, not a matched A/B.

A separate symbolized adapter was prepared but **not executed**:
`docs/results/frozen-node-toolchain-d-catch-symbolized-v1.json`.
It enables only `debugSymbols: true` in the frozen native image builder, with its changed tool hash and full run identity recorded. It retains the 300000 ms containment budget. Ordinary conformance toolchains remain unmodified. The original staged single-case binary was cleaned up by the runner; raw samples alone are insufficient for reliable function attribution.

## Next step

P can use this case to test shared preparation improvements or obtain a symbolized profile. D will retain the low-share timeout and revisit it separately later, while continuing indirect eval and remaining selections. This file does not claim that the catch/eval semantic path passes or that shared preparation is conclusively the cause.

## Additional upcoming workload found during D triage

The four historically unsupported Annex B RegExp variants are the strict/sloppy forms of `RegExp-leading-escape-BMP.js` and `RegExp-trailing-escape-BMP.js`. Each unchanged test loops through all 65,536 BMP code units, excludes 15 values, and evaluates **65,521 distinct tiny RegExp-literal Scripts**. This is source inspection, not a new native result. To finish within 300 s, total compilation/execution must average below ~4.58 ms per eval, including loop overhead. It is a much stronger repeated-preparation workload than the eight-eval catch case.

There may also be a lifetime limit after preparation is faster: `createEngineCodeStorage` in `packages/js-engine/src/native/code-storage.ts` is currently a permanent bounded bump arena (4 MiB in the native test host), with no reclamation. Do not raise its capacity or use a RegExp-specific shortcut to mask that. D has not yet measured emitted bytes/publication exhaustion for these tests, so this is a second hypothesis, not an established new native failure.

Running indirect selection update: the initial three-eval `always-non-strict.js` variant passed under load. Its first batch's exact 166,524,671-byte executable has been preserved at `.tint-bootstrap/d-indirect-batch0-preserved-test` with adjacent `.json` source/hash metadata. Current indirect raw address samples can therefore be matched to an existing binary. The family run is still incomplete; do not turn its prefix into a full-family result.

## First indirect non-pass (still a partial run)

At 2026-11-07 02:33 +0800, the running indirect selection reached 21 passes / 22 observed variants, with one retained timeout: sloppy `language/eval-code/indirect/cptn-nrml-expr-prim.js`. It contains exactly four tiny evals: `x = 1`, `1`, `'1'`, and `++x`, with no catch/async/generator machinery. The last audit sample records **111.68 CPU seconds / 267 elapsed seconds**; even a conservative single-thread upper bound (~144.68 CPU seconds) is below the 250 CPU-second criterion. Thus this is also load-sensitive/inconclusive. It is a useful simpler workload candidate, but is not proof of shared preparation as the hot phase.

Sample: `.tint-bootstrap/d-language-indirect-phase2-v1-stall-3539-phase-1.txt`.
Binary: preserved batch-0 image described above. Journal and full CPU ledger are being appended under `docs/results/test262-d-language-indirect-phase2-v1.jsonl` and `docs/results/d-language-indirect-phase2-v1-process.jsonl`. The run continues; do not publish 21/22 as a complete selection.

Rebase note: the focused evidence commit is now `1fa83ca` on main `4ef8ab8` (same report-only patch as original `9534cab`). The currently running indirect measurement still uses its immutable b7aa59a-derived toolchain/source `ff22a2a0…`; it does not pick up the register-copy change mid-run.

## Paused checkpoint (supersedes earlier live-run status)

D is paused under ACTIVE CLUSTER LIMIT. No D runner, observer, or inferior remains. The indirect journal is held at 84/118 observations: 76 passes, 8 low-CPU timeouts, 34 unobserved; no complete record. A queued resume was cancelled before it started Node. See `docs/results/d-phase2-paused-checkpoint-v1.json` for the exact CPU classifications and `~/.t3/tint-briefs/handoff-D.md` for the authorized-resume command and final rebased evidence SHAs. Do not resume until the coordinator authorizes D. Frozen source remains `ff22a2a0…`; preserved batch0 and batch1 binaries and their adjacent metadata remain available for symbolication. Neither symbolized diagnostics nor a timeout/cap increase has been performed. Earlier commit SHAs in this historical note were superseded by report-only rebases; use the final D handoff for current SHAs.
