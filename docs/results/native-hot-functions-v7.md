# Numeric register operands and capture-entry attribution

The next codegen candidate uses existing FP homes directly for numeric
arithmetic and comparisons. Stack-backed operands retain scratch loads.
Verified IR representation supplies the register choice; source type assertions
do not remove a check. The candidate is committed but **not merge-ready**:
native numerical fixtures, repeated CPU measurements, stage-image comparison
and the full workspace gate remain pending.

Emission from identical historical compiler IR gives these **function-range**
totals, excluding module data and helpers:

| Static metric                  |     Before |      After |
| ------------------------------ | ---------: | ---------: |
| FP register moves              |    170,828 |    115,095 |
| Numeric arithmetic/comparisons |     52,389 |     52,389 |
| Instructions                   | 10,976,635 | 10,920,902 |
| Function bytes                 | 43,906,540 | 43,683,608 |

Exactly 55,733 register moves disappear. The full code blob, including its
non-function regions, shrinks from 45,619,224 to 45,396,296 bytes. These are
static counts, not executed instruction counts or native speedups.

A matched fixed-work operation benchmark is prepared from identical IR and
the same optimizer output: its loop shrinks from 344 to 296 bytes, with the same
128-byte frame. Both frozen compiler hosts also build their stage-1 images from
the same 569-file candidate source snapshot. These preparatory images have not
been executed while Developer Tools authorization is disabled. Node preparation
wall times are retained for provenance; the recorded parent CPU excludes the
bootstrap child and is not compiler CPU evidence.

The workspace builds, 543 focused IR/codegen/compiler tests pass, and three
encoding tests cover arithmetic, all numeric comparisons and register pressure
with stack-backed operands. Native semantic equivalence remains required.

The next ranked lead comes from existing A1 samples and disassembly. At least
479 of 1,162 baseline `copying.read` samples lie entirely in the entry range
through offset 652: **41.22% of that callback's samples / 5.95% of the selected
workload samples**. The cleanup prototype independently gives 447/1,095,
40.82% / 5.61%. Truncated or mixed PC groups remain ambiguous, and the analysis
asserts that preserving PCs does not change the original exclusive counts.

That range includes necessary ABI/root setup and eager loading of captured
cell pointers. The lowering currently extracts every incoming capture before
the source body, including region bounds needed only by fallback branches.
Some entry work is required; no 6% removable-cost claim follows. A future change
must preserve environment validation, TDZ timing, aliasing and moving-GC roots.
No capture-lowering change is included here.

[The JSON](native-hot-functions-v7.json) retains exact source/image identities,
function-range counts, sampling groups, analysis code, prepared benchmark inputs,
stage-1 provenance and focused-test evidence. Existing full native hot-function
tables remain in v2–v6; these new static counts do not replace their workload
denominators or establish a whole-suite projection.
