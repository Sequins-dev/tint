# One-byte strings: minimum sliced-string length (v1)

Recorded 2026-11-24 on macOS arm64 (Apple M5 Max), using the
[slice 3 protocol](string-slice3-ab-v1.md): `tools/string-bench`, 15 paired
rotated rounds, LLDB-asserted native runs and Node 26.13.1. This sets
`nativeStringSlicedMinimumLength`, as the orchestrator's condition 2
requires.

## Candidates

Typed images of the kernels that slice (`slice`, `sliceTwoByte`,
`splitJoin`, `numberString`, `strings`, `stringBuild`, `clone1MiB`), all
built from `4bb0e7f3e` with only the minimum changed: 13 (V8's
`SlicedString::kMinLength`, the base, image `05b03fe433f4…`), 9 (the
smallest allowed: inline literal compares read up to eight data bytes of
flat strings, so a slice needs more; `97c606e4d20f…`), 16 (`c4488b1b2bea…`),
24 (`ece3dd830a0b…`) and 32 (`221388344710…`). Shorter results are copied
flat.

Object sizes, for reference: a slice is 32 bytes. A flat copy of n units
is align8(16 + max(n, 8)) bytes one-byte and align8(16 + max(2n, 8))
two-byte, so a one-byte copy is no larger than a slice up to 16 units and
a two-byte copy only up to 8.

## Results

One-minute load was 4.7 at the start. Raw rounds:
[JSON](string-slice-minimum-v1.json). Paired per-round ratios against the
13 image (median, interquartile range):

| Kernel       | 9 / 13              | 16 / 13             | 24 / 13             | 32 / 13             |
| ------------ | ------------------- | ------------------- | ------------------- | ------------------- |
| slice        | 0.916 (0.904–0.945) | 1.050 (1.033–1.061) | 1.085 (1.050–1.109) | 1.129 (1.108–1.158) |
| sliceTwoByte | 1.011 (0.974–1.021) | 0.987 (0.965–1.010) | 1.020 (0.996–1.063) | 1.067 (1.051–1.113) |
| splitJoin    | 0.993 (0.982–1.004) | 0.995 (0.976–1.005) | 1.008 (0.993–1.021) | 0.993 (0.983–1.008) |
| numberString | 1.009 (1.003–1.038) | 1.016 (0.999–1.042) | 1.014 (0.991–1.037) | 0.992 (0.984–1.033) |
| clone1MiB    | 0.998 (0.977–1.006) | 1.005 (0.988–1.029) | 0.992 (0.969–1.021) | 1.004 (0.991–1.016) |
| strings      | 1.003 (0.994–1.010) | 0.993 (0.984–1.005) | 1.005 (0.997–1.021) | 1.003 (0.988–1.011) |
| stringBuild  | 0.996 (0.979–1.007) | 0.983 (0.966–1.005) | 0.994 (0.978–0.999) | 0.986 (0.978–1.003) |

Against Node (steady medians): `slice` is 1.84× at 13 and 1.71× at 9;
`sliceTwoByte` is 2.29–2.31× from 9 to 16.

## Decision

The minimum is **9**. `slice` gets faster with every step down (−8.4% from
13 to 9) and slower with every step up. `sliceTwoByte` is flat from 9 to 16
and slower above. Nothing else moves. At 9–12 units, a one-byte slice is
the same size as the copy it replaces, and a two-byte slice is 8–16 bytes
smaller.

Smaller slices could pin parents more often. The
[retention report](string-slice-retention-v1.md) found none at 13. The
frozen v7 run of the change that sets 9 records peak RSS again.
