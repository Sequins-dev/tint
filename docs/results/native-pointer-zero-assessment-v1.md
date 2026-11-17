# Hold literal pointer-zero branch emission

> Status 2026-11-17: rejected, not merged. The candidate branch
> `perf/test262-pointer-zero-branches` (implementation 4a29da4c0) was deleted;
> only this evidence is kept, without its compressed raw artifacts. "This
> unmerged held branch" below refers to it.

The candidate emits CBZ/CBNZ directly for adjacent literal absent-reference or
absent-string comparisons. It retains dynamic optional comparisons, all descriptor
checks and non-leaf root initialization. The code and reports remain together on
this unmerged held branch; no READY line or main-coverage claim is made.

| Matched native workload | Before | After | Assessment |
| --- | ---: | ---: | --- |
| Compiler CPU, one pair | 244.084 s | 254.977 s | 4.46% slower |
| Compiler instructions | 3.181T | 3.162T | 0.61% fewer |
| Compiler cycles | 852.767B | 875.223B | 2.63% more |
| 16M production list reads CPU, four pairs | 397.760 ms | 405.263 ms | No CPU gain |
| Same list instructions | 7.699B | 7.396B | 3.94% fewer |
| Same list cycles | 1.276B | 1.308B | 2.50% more |

All loads, per-run CPU lower bounds and final missing-CPU bounds are in
[the evidence](native-pointer-zero-assessment-v1.json). Both native compiler
executions exit 0, produce identical stage-2 images equal to candidate stage 1,
and pass signature/DWARF validation. Eight semantic fixtures and eight primary
benchmarks exit 42 under LLDB. All 313 focused codegen tests pass. The unchanged
nine-variant canonical after-selection passes 9/9, with fresh processes and the
same 300-second limits. The before-control adapter rejects its nonunique marker
before entry; this failure is retained and no canonical equivalence is claimed.

Three diagnostic instruction encodings were each run through twelve alternating
benchmark pairs (72 further LLDB exits 42). Scratch-register CBZ has median paired
CPU +3.46% and cycles +4.51%. CMP-zero/B.cond has CPU +1.37% and cycles +2.95%.
Using the existing resident register for CBZ gives CPU -2.55% and cycles -0.96%,
with overlapping spreads; it has no full compiler or semantic validation and is
not a production result. These adapters are separately hashed diagnostic inputs,
not frozen canonical toolchains. No hardware fusion explanation is asserted.

The initial unsupported mixed-primitive bespoke fixture and the failed control
marker are retained as preparation failures, not semantic outcomes. Nothing is
projected into whole-suite hours. A lower instruction count alone did not earn
this slice a full gate or merge-readiness claim.
