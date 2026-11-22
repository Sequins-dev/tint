# Untyped positional calls and primitive hot paths

The latest staged comparison still has **15 of 15 losses** against Node
26.13.1. The smallest ratio of medians is **2.9×** for string building.
The largest is **54.7×** for small object allocation. All paired IQRs
remain above zero.

| Kernel              | Node ns | Tint ns |  Paired Δ IQR ns |
| ------------------- | ------: | ------: | ---------------: |
| Allocate objects    |    7.35 |  401.95 | 365.65 to 414.68 |
| 3 arguments         |    2.60 |   80.32 |   74.70 to 81.98 |
| 4 arguments         |    2.74 |   89.55 |   84.63 to 92.53 |
| 5 arguments         |    2.83 |   97.02 |  91.69 to 100.10 |
| 6 arguments         |    3.16 |  108.36 | 100.82 to 110.58 |
| Build string        |   11.50 |   33.88 |   20.85 to 23.27 |
| Catch in loop       |    3.90 |   52.63 |   45.94 to 50.74 |
| Concatenate strings |    8.31 |   29.21 |   20.33 to 22.36 |
| Mixed call          |    4.20 |   80.71 |   72.47 to 80.88 |
| Mutable capture     |    7.19 |   49.06 |   40.50 to 44.66 |
| Object array        |    2.84 |   62.51 |   56.57 to 63.85 |
| Object round trip   |    2.50 |   88.10 |   81.86 to 91.57 |
| 2 receiver shapes   |    5.86 |  121.54 | 113.10 to 122.35 |
| 4 receiver shapes   |    5.74 |  131.21 | 120.64 to 131.15 |
| 8 receiver shapes   |    6.80 |  135.54 | 124.27 to 134.24 |

Each of two comparisons used 24 rotated rounds. The first measured the
string and wide positional changes against the earlier four-state cache
trial. The final comparison starts with fixed argument lists, packed array
reads, string guards and wide calls, without the four-state cache. Its four
candidates successively add own data descriptor creation, direct null tests,
direct `typeof` tests, and shared hidden caller barriers.

- A guarded string pair concatenates directly. The constant `length` read
  tests the String tag and reads UTF-16 length. These two changes saved
  65.86 ns on string building, 78.90 ns on concatenation, and 22.25 ns on
  mutable captures in the first comparison. Objects and other primitive
  combinations retain their coercion paths.
- Same-Script calls to eligible strict functions with three to six parameters
  use a positional entry. The wide path saved 57.81, 66.00, 77.40 and
  88.88 ns at arities three through six in the first comparison. Exotic
  targets and observable argument bindings use the general call path. The
  wide entry's wrapper still handles source context and errors.
- A fresh property on an extensible ordinary object can install one complete
  descriptor directly. The allocation kernel saved a paired median 98.0 ns
  [−108.9, −78.8]. The object header, property table and cache layout remain
  significant allocations.
- The instruction traces identify a 40 B `fromNull` allocation even in a
  steady-state object identity comparison and a string capture read. Each
  concatenation lane calls it five times, accounting for 200 B of its
  original 376 B. The scalar compiler now tests the tag of a general
  operand directly against a null literal. This saved 9.0 ns in the object
  round trip and 13.1 ns in the mixed call. Literal comparisons with
  `typeof` of a general value also use its tag for number, boolean, string
  and undefined when the native classifier applies. Those changes saved
  another 14.6 ns in the mixed call and 14.2 ns in string building.
- Adjacent hidden callers share their reflection barrier through normal
  and abrupt returns. This saved 8.6 ns in the catch loop, 8.3 ns in the
  mutable capture loop and 8.2 ns in the object round trip. The execution
  name stack remains available for error diagnostics. Visible callers
  and legacy argument reflection retain their individual frames.

[Positional and string comparison](general-call-generality-positional-and-string-darwin-arm64.json),
[runtime comparison](general-call-generality-runtime-trials-darwin-arm64.json),
[baseline instruction and allocation trace](general-call-generality-baseline-traces-darwin-arm64.jsonl).

## Original kernels

The 20-round comparison of the original workloads retains all eight
wins. Every candidate paired IQR versus Node stays below zero. The
typed image is byte-identical to the original typed image
(`247254d48165ba82726246b998d7d5f782887049e6f7733cfe0c7038099c7648`).
[Original-kernel paired rerun](general-call-original-kernels-regate-darwin-arm64.json).
