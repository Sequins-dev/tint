# One-byte strings: UTF-8 primitives, builder policy and slice minimum (s12, v1)

Recorded 2026-11-24 on macOS arm64 (Apple M5 Max), using the
[slice 3 protocol](string-slice3-ab-v1.md): `tools/string-bench`, 15 paired
rotated rounds, LLDB-asserted native runs and Node 26.13.1.

## Candidates

The base is s6, the images of `db26717a6` (typed `6ca5f8e812ef…`), as in
[s8](string-s8-ab-v1.md).

- **s11** (typed image `52e75c707213…`): sliced strings and the loop
  string builder, as in the [builder A/B](string-builder-ab-v1.md).
- **s12** (`354623df5`, committed; typed image `f73155851c7f…`) adds to
  s11:
  - the UTF-8 primitives `string-utf8-length`, `string-write-utf8` and
    `string-from-utf8`, with the codec built on them;
  - a minimum slice length of 9 ([sweep](string-slice-minimum-v1.md));
  - exact concatenation for the builder's first three growths;
  - appends that read the string after their pieces when that is
    unobservable, so loops with branching pieces use the builder.

## Results

One-minute load was 2.6 at the start. Raw rounds:
[typed](string-s12-ab-v1-typed.json) and
[general](string-s12-ab-v1-general.json). Steady medians over Node, and
paired per-round ratios (median, interquartile range):

| Kernel           | s6 / Node | s11 / Node | s12 / Node | s12 / s6            | s12 / s11           |
| ---------------- | --------: | ---------: | ---------: | ------------------- | ------------------- |
| create           |      2.01 |       2.01 |       1.98 | 0.972 (0.950–0.987) | 0.986 (0.968–1.006) |
| concat           |      1.39 |       1.50 |   **0.95** | 0.678 (0.661–0.697) | 0.630 (0.619–0.656) |
| concatTwoByte    |      2.14 |       2.28 |       1.07 | 0.497 (0.476–0.505) | 0.474 (0.461–0.481) |
| equality         |      2.82 |       2.71 |       2.74 | 0.964 (0.960–0.985) | 0.990 (0.978–1.021) |
| search           |      0.81 |       0.82 |       0.81 | 1.003 (0.998–1.015) | 0.999 (0.977–1.010) |
| searchTwoByte    |      0.73 |       0.75 |       0.75 | 1.033 (1.025–1.054) | 1.000 (0.989–1.012) |
| codeUnits        |      1.41 |       1.41 |       1.41 | 1.001 (0.984–1.002) | 1.002 (1.000–1.016) |
| codeUnitsTwoByte |      1.40 |       1.40 |       1.40 | 1.000 (0.991–1.004) | 1.001 (0.986–1.003) |
| splitJoin        |      0.86 |       0.84 |       0.86 | 0.998 (0.989–1.014) | 1.019 (1.006–1.054) |
| slice            |      8.09 |       1.90 |       1.76 | 0.216 (0.212–0.218) | 0.914 (0.896–0.945) |
| sliceTwoByte     |     13.50 |       2.31 |       2.29 | 0.167 (0.165–0.172) | 0.989 (0.977–1.020) |
| numberString     |      2.36 |       2.50 |       2.43 | 1.029 (0.988–1.059) | 0.995 (0.986–1.038) |
| template         |      0.98 |       0.98 |       0.99 | 0.995 (0.987–1.008) | 1.009 (0.987–1.027) |
| mapKeys          |      1.52 |       1.52 |       1.53 | 1.002 (0.975–1.019) | 0.999 (0.980–1.018) |
| utf8             |      0.81 |       0.63 |   **1.09** | 1.314 (1.288–1.362) | 1.692 (1.671–1.734) |
| utf8TwoByte      |      4.55 |       4.65 |       1.23 | 0.272 (0.269–0.274) | 0.267 (0.264–0.271) |
| clone1KiB        |      0.61 |       0.60 |       0.56 | 0.921 (0.899–0.927) | 0.944 (0.936–0.956) |
| clone1MiB        |      1.21 |       1.03 |       0.92 | 0.807 (0.797–0.827) | 0.997 (0.965–1.011) |
| strings          |      1.60 |       1.60 |       1.57 | 0.982 (0.966–0.999) | 0.998 (0.979–1.009) |
| stringBuild      |      2.49 |       1.90 |       1.95 | 0.795 (0.782–0.806) | 1.024 (0.992–1.033) |
| upperCase (gen.) |     14.48 |      14.38 |      14.41 | 1.010 (0.986–1.015) | 1.007 (0.990–1.016) |
| json (gen.)      |     16.72 |      17.18 |      16.86 | 1.009 (1.002–1.014) | 0.980 (0.964–0.987) |

### Frozen v7

Five interleaved runs ([log](string-s12-ab-v1-frozen.log)) of the frozen
self-compile, built with `--runtime-tree` from s6 (`2c162bd76`) and from
s12. Paired against s6:

| Measure      | Per round (%)                     | Median |
| ------------ | --------------------------------- | -----: |
| cycles       | +0.17, −1.38, +0.88, −0.42, −0.38 | −0.38% |
| instructions | +0.29, +0.29, +0.31, +0.28, +0.29 | +0.29% |
| peak RSS     | +0.37, +0.38, +0.38, +0.39, +0.39 | +0.38% |

## Reading

- **UTF-8.** `utf8TwoByte` fell from 4.65× to 1.23× Node. ASCII `utf8`
  rose from 0.63× to 1.09×. ASCII text and input had left the Latin-1
  primitives, which work sixteen bytes per step, for the UTF-8 loops at
  eight. The follow-up restores the Latin-1 path for ASCII and decodes
  valid input without re-measuring it.
- **Builder.** `concat` (0.95×) and `concatTwoByte` (1.07×) now use the
  builder. `clone1KiB` and `json` recovered their s11 losses (0.944× and
  0.980× of s11).
- **Slice minimum.** `slice` ran 0.914× of s11, as the sweep predicted.
  Peak RSS in the self-compile is unchanged from the minimum of 13
  (+0.38% against s6, as against +0.39% at 13).
- **Self-compile.** Neutral within the cycles' noise, and instructions
  +0.29% as before.
