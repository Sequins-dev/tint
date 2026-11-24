# One-byte strings: ASCII UTF-8 and the one-unit table (s13, v1)

Recorded 2026-11-24 on macOS arm64 (Apple M5 Max), using the
[slice 3 protocol](string-slice3-ab-v1.md): `tools/string-bench`, 15 paired
rotated rounds, LLDB-asserted native runs and Node 26.13.1.

## Candidates

The base is s6, the images of `db26717a6` (typed `6ca5f8e812ef…`), as in
[s12](string-s12-ab-v1.md).

- **s12** (`354623df5`; typed image `f73155851c7f…`), as in
  [s12](string-s12-ab-v1.md).
- **s13** (`758248782`, committed; typed image `ee9a1f654883…`) adds to
  s12:
  - ASCII text and input back on the Latin-1 primitives, sixteen bytes a
    step, and valid UTF-8 decoded in one call without measuring it again;
  - one-unit strings below 256 taken from a pooled table instead of
    allocated.

## Results

One-minute load was 3.8 at the start. The typed run waited for the timing
lock past the background-job limit and was requeued; the requeued run
is the one reported. Raw rounds: [typed](string-s13-ab-v1-typed.json) and
[general](string-s13-ab-v1-general.json). Steady medians over Node, and
paired per-round ratios (median, interquartile range):

| Kernel           | s6 / Node | s12 / Node | s13 / Node | s13 / s6            | s13 / s12           |
| ---------------- | --------: | ---------: | ---------: | ------------------- | ------------------- |
| create           |      2.00 |       1.97 |       1.97 | 0.977 (0.971–0.984) | 0.993 (0.987–1.000) |
| concat           |      1.40 |       0.94 |       0.93 | 0.674 (0.656–0.699) | 0.973 (0.956–1.021) |
| concatTwoByte    |      2.10 |       1.04 |       1.05 | 0.495 (0.492–0.500) | 0.986 (0.973–1.012) |
| equality         |      2.79 |       2.74 |       2.78 | 0.991 (0.980–1.003) | 1.023 (0.988–1.034) |
| search           |      0.81 |       0.82 |       0.81 | 1.007 (0.999–1.020) | 0.998 (0.972–1.008) |
| searchTwoByte    |      0.73 |       0.75 |       0.75 | 1.031 (1.027–1.036) | 0.997 (0.994–1.001) |
| codeUnits        |      1.39 |       1.40 |       1.40 | 1.003 (1.001–1.004) | 0.999 (0.997–1.001) |
| codeUnitsTwoByte |      1.40 |       1.40 |       1.40 | 1.001 (0.999–1.003) | 1.001 (1.000–1.002) |
| splitJoin        |      0.85 |       0.85 |       0.85 | 1.003 (0.982–1.010) | 1.006 (0.981–1.015) |
| slice            |      7.94 |       1.69 |       1.72 | 0.215 (0.215–0.217) | 1.003 (0.999–1.006) |
| sliceTwoByte     |     13.49 |       2.23 |       2.25 | 0.169 (0.165–0.171) | 1.006 (0.991–1.022) |
| numberString     |      2.35 |       2.41 |       2.42 | 1.019 (0.998–1.027) | 1.007 (0.988–1.018) |
| template         |      0.97 |       0.98 |       0.96 | 0.989 (0.982–1.001) | 0.987 (0.985–0.990) |
| mapKeys          |      1.51 |       1.52 |       1.52 | 1.001 (0.996–1.011) | 1.001 (0.998–1.005) |
| utf8             |      0.78 |       1.03 |       0.58 | 0.747 (0.738–0.754) | 0.561 (0.554–0.571) |
| utf8TwoByte      |      4.52 |       1.24 |       1.10 | 0.244 (0.242–0.245) | 0.888 (0.880–0.899) |
| clone1KiB        |      0.61 |       0.56 |       0.56 | 0.929 (0.919–0.937) | 1.005 (0.996–1.015) |
| clone1MiB        |      1.29 |       1.09 |       1.02 | 0.807 (0.798–0.814) | 0.993 (0.967–1.009) |
| strings          |      1.58 |       1.56 |       1.49 | 0.945 (0.937–0.956) | 0.963 (0.948–0.967) |
| stringBuild      |      2.39 |       1.91 |       1.81 | 0.762 (0.744–0.772) | 0.952 (0.939–0.966) |
| upperCase (gen.) |     14.21 |      14.07 |      14.23 | 1.003 (0.989–1.022) | 1.004 (0.994–1.025) |
| json (gen.)      |     16.76 |      16.89 |      16.77 | 1.004 (0.997–1.008) | 0.998 (0.992–1.004) |

## Reading

- **UTF-8.** ASCII `utf8` fell from 1.03× to 0.58× Node (0.561× of s12),
  so the s12 regression is gone and the kernel now beats Node.
  `utf8TwoByte` fell from 1.24× to 1.10× (0.888× of s12).
- **One-unit strings.** `strings` (0.963× of s12) and `stringBuild`
  (0.952×) build many one-character strings, and both gained. Neither
  reaches Node yet (1.49× and 1.81×).
- **Everything else** is within ±2.5% of s12. The remaining gaps over
  Node are `create`, `equality`, `codeUnits`, `slice`, `sliceTwoByte`,
  `numberString`, `mapKeys`, `utf8TwoByte`, `strings`, `stringBuild`
  and the two general kernels, which #12 owns.
