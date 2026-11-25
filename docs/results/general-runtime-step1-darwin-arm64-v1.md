# General runtime step 1 · inline primitive operations on Darwin arm64

Step 1 of the [general runtime re-architecture](../design-general-runtime-rearchitecture.md) lowers primitive JavaScript operations inline. It shortens Richards by 4.6 ms/op and NavierStokes by 37.5 ms/op in paired rounds against origin/main. Tint remains 42× to 616× slower than Node 26.13.1 on these programs.

## Changes

- `x == null` and `x != null` test the general tag inline. Hosts that create no Annex B `[[IsHTMLDDA]]` objects lower without that check: Octane benchmark hosts and general programs opt in, and Test262 hosts keep `$262.IsHTMLDDA`. The runtime makes code lowered without the check and `markHTMLDDAObject` mutually exclusive, so a mismatched image fails instead of changing `==`.
- The `shadow-general-numbers` IR pass gives untyped slots tested as numbers a presence flag and an unboxed value. Every store keeps both, so number tests read a register, and reads proven by a forward analysis skip the tag check. The general slot itself is unchanged for every other reader and for stack maps.
- Darwin arm64 converts unproven ToInt32 operands with one `FJCVTZS` (every Apple silicon core implements FEAT_JSCVT). Linux arm64 keeps the portable sequence.
- General tag operations no longer evict FP and pointer temporaries, and `general-is` sets its result's home directly.

## Instructions on the warm path

Each row counts the instructions one warm call executes from entry to return, callees included, single-stepped under LLDB with `tools/general-call-bench/count_call.py` (the 501st call). The probe programs are untyped general programs; the images were built at origin/main `3d10cb5c0` and at `7e03decee` with the same options.

| Probe function (source)                                            | origin/main | Step 1 |
| ------------------------------------------------------------------ | ----------: | -----: |
| `probeNull(x)`: `if (x == null) n = 1`                             |       1,274 |     63 |
| `probeNe(x)`: `while (x != null) { n++; x = x.next }`, three steps |       3,461 |    532 |
| `probeLt(a, b)`: `if (a < b)` on numbers                           |         144 |    101 |
| `probeAnd(s, m)`: `(s & m) != 0` on numbers                        |         713 |    157 |
| `probeSum(values, n)`: `s = s + values[i]`, four elements          |       1,611 |  1,306 |

The operations themselves, from the step 1 disassembly:

- `x == null` and its branch: `ldr`, `cmp #4`, `ccmp #0`, `b.cond`, four instructions, in the probes and in Richards' `schedule` loop test (1,264 instructions before, from the [cost breakdown](general-call-octane-cost-breakdown-darwin-arm64-v2.md)). Richards' loop still executes one unconditional branch on its common edge because neither successor block follows the test; a fallthrough-aware block layout removes it.
- `a < b` on shadowed parameters: `cbnz`, `cbnz`, `fcmp d8, d9`, `b.mi`, with no tag checks.
- `s & m`: two `cbnz` guards, then `fjcvtzs`, `mov`, `fjcvtzs`, `and`, `scvtf`.
- `s + values[i]`: one `cbnz` on the element's presence, then `fadd`. The result is still re-boxed (8 instructions) into the general temporary that merges into `s`; box sinking will remove that.

## Octane against Node 26.13.1

Sixteen rotated fresh-process rounds under the shared timing and launch locks on an Apple M5 Max. Every native inferior reached its entry stop and exited 42. Host load was high (one-minute load median 13.9, maximum 30), so judge the paired differences; absolute times run above unloaded runs. `7db4ae2cf` is the first step 2 change (shared shapes), measured in the same rounds.

| Program      | Node ms/op | origin/main | Step 1 (`7162f95f8`) | Step 1 Δ, median [IQR]     | + shared shapes Δ, median [IQR] |
| ------------ | ---------: | ----------: | -------------------: | -------------------------- | ------------------------------- |
| Richards     |      0.087 |      22.217 |               16.825 | −4.632 [−5.941, −2.914]    | −3.060 [−4.365, −1.357]         |
| DeltaBlue    |      0.111 |      56.571 |               50.591 | −3.804 [−9.370, +2.191]    | −3.631 [−7.818, +0.349]         |
| NavierStokes |      2.971 |     159.774 |              124.248 | −37.517 [−41.220, −26.962] | −2.754 [−8.467, +4.260]         |
| RayTrace     |      0.904 |     559.767 |              556.787 | −33.366 [−47.862, −3.091]  | −28.281 [−58.278, −17.905]      |

Ratios of medians to Node after step 1: Richards 194×, DeltaBlue 457×, NavierStokes 42×, RayTrace 616×.
[Paired rounds](general-runtime-step1-octane-darwin-arm64-v1.json)

## Call, loop and generality kernels

Fifteen rotated rounds for each suite under the same locks (one-minute load median 9.6 and 6.0).

- The eight call and loop kernels were already faster than Node at origin/main in their untyped form, and step 1 leaves them unchanged: every paired IQR spans zero. The typed images, which step 1 changes deliberately (FJCVTZS and register homes), show no regression; `closure` improved by 0.148 ns [−0.348, −0.016].
  [Paired rounds](general-runtime-step1-kernels-darwin-arm64-v1.json)
- Every generality kernel improved, each paired IQR below zero. They remain 2.5× to 33× slower than Node.

| Kernel (ns per iteration) | Node | origin/main | Step 1 | Step 1 Δ, median [IQR]  |
| ------------------------- | ---: | ----------: | -----: | ----------------------- |
| allocateObjects           | 8.84 |      303.34 | 291.32 | -11.49 [-13.14, -4.22]  |
| arguments3                | 2.30 |       67.08 |  53.62 | -12.55 [-15.19, -10.71] |
| arguments4                | 2.52 |       72.86 |  58.51 | -14.35 [-16.54, -13.70] |
| arguments5                | 2.54 |       79.94 |  64.15 | -16.06 [-19.13, -14.55] |
| arguments6                | 2.84 |       91.79 |  71.39 | -19.31 [-22.74, -17.66] |
| buildString               | 9.22 |       31.35 |  23.28 | -8.34 [-8.91, -7.47]    |
| catchInLoop               | 3.49 |       46.91 |  39.27 | -7.78 [-9.51, -6.56]    |
| concatenateStrings        | 7.08 |       26.25 |  17.58 | -8.95 [-9.71, -8.10]    |
| mixedCall                 | 3.66 |       71.98 |  44.00 | -27.99 [-33.23, -26.98] |
| mutableCapture            | 5.58 |       43.16 |  34.87 | -8.71 [-10.87, -7.63]   |
| objectArray               | 2.33 |       40.20 |  33.85 | -6.63 [-10.33, -5.36]   |
| objectRoundTrip           | 2.14 |       60.48 |  52.58 | -9.93 [-15.42, -7.10]   |
| receivers2                | 4.88 |       90.17 |  80.51 | -7.87 [-15.07, -6.40]   |
| receivers4                | 4.82 |      119.27 | 106.20 | -10.40 [-16.55, -4.13]  |
| receivers8                | 5.77 |      120.58 | 114.77 | -9.45 [-15.04, -2.22]   |

[Paired rounds](general-runtime-step1-generality-darwin-arm64-v1.json)

## Native self-compile

A workload frozen at origin/main `3d10cb5c0` (`gr8`; v7 no longer builds against the runtime tree after #11) compiled itself with images built by each toolchain with the same options. Rounds interleave the images.

| Run | Load   | origin/main cycles    | Step 1 cycles         | Step 1 without FJCVTZS | Peak RSS (all) |
| --- | ------ | --------------------- | --------------------- | ---------------------- | -------------- |
| 1   | quiet  | 472.6, 462.8, 459.2 G | 475.5, 474.4, 460.9 G | —                      | 2.227–2.228 GB |
| 2   | loaded | 571.3, 562.7, 562.9 G | 570.2, 562.9, 551.4 G | 574.6, 572.7, 557.0 G  | 2.226–2.228 GB |

Step 1 retires 1.9% fewer instructions. Across the six paired rounds its cycles differ from origin/main by −2.0% to +2.5% (median +0.2%), within the run-to-run noise, and peak RSS is unchanged. FJCVTZS used fewer cycles than the same build without it in every paired round, so it stays.
[Self-compile rows](general-runtime-step1-self-compile-darwin-arm64-v1.json), [warm-call traces](general-runtime-step1-traces-darwin-arm64-v1.json)

## Validation

- Unified pipeline ledger on the Linux dev machine with `TINT_FUNCTION_FALLBACK=1 TINT_SOURCE_REPLAY=1`: no regressions against `general-calls-deep-prototype-dev-v1`. `explicit-binding-contract` (untyped) moved from build-failed to run-failed. [Ledger](unified-pipeline-ledger-general-runtime-step1-1a2e47097-dev-v1.json)
- The full macOS gate at `7e03decee` passed the type, test and boundary checks (6,554 tests), the storage tests, the bootstrap and stage 2 = stage 3, and found the Test262 smoke crashing: the linked-unit host called the then-generic `markHTMLDDAObject` without type arguments. `1232027b8` fixes that; CI runs the same gate scripts on macOS arm64, Linux x86-64 and Linux arm64 for the pushed head.
- New native fixtures compare category changes through shadowed locals, parameters, exceptions and closures, and bitwise operators on edge values, with Node; a deliberately broken shadow fails them.
