# One-byte strings: loop string builders (s11, v1)

Recorded 2026-11-24 on macOS arm64 (Apple M5 Max), using the
[slice 3 protocol](string-slice3-ab-v1.md): `tools/string-bench`, 15 paired
rotated rounds, LLDB-asserted native runs and Node 26.13.1.

## Candidates

The base is s6, the images of `db26717a6` (typed `6ca5f8e812ef…`), as in
[s8](string-s8-ab-v1.md). Both candidates are patches on `4bb0e7f3e`:

- **s9** (patch `8119cec3676f…`; typed image `550cb1102870…`): `4bb0e7f3e`
  with the IR round-trip coverage of `b2b1d8406`, which does not change
  emitted code. It is the sliced-string state (s8b with inline slice bounds).
- **s11** (patch `537a24d2eb83…`; typed image `52e75c707213…`): s9 plus
  the `build-loop-strings` pass of `8c3e5b528`, which rewrites loops whose
  only uses of a string local are appends so they fill a buffer with spare
  capacity, and stores the written prefix at each exit.

## Results

One-minute load was 4.1 at the start. Raw rounds:
[typed](string-builder-ab-v1-typed.json) and
[general](string-builder-ab-v1-general.json). Steady medians over Node,
and paired per-round ratios (median, interquartile range):

| Kernel           | s6 / Node | s9 / Node | s11 / Node | s9 / s6             | s11 / s6            | s11 / s9            |
| ---------------- | --------: | --------: | ---------: | ------------------- | ------------------- | ------------------- |
| create           |      2.00 |      1.95 |       1.96 | 0.974 (0.966–0.984) | 0.982 (0.970–0.996) | 1.006 (0.997–1.016) |
| concat           |      1.40 |      1.49 |       1.49 | 1.058 (1.043–1.067) | 1.073 (1.057–1.077) | 1.008 (0.994–1.015) |
| concatTwoByte    |      2.16 |      2.26 |       2.22 | 1.047 (1.035–1.069) | 1.031 (1.018–1.060) | 0.985 (0.974–0.993) |
| equality         |      2.85 |      2.77 |       2.80 | 0.977 (0.960–0.984) | 0.993 (0.973–1.004) | 1.009 (1.001–1.029) |
| search           |      0.80 |      0.81 |       0.82 | 1.012 (1.004–1.022) | 1.012 (1.004–1.017) | 0.999 (0.993–1.005) |
| searchTwoByte    |      0.73 |      0.75 |       0.75 | 1.037 (1.028–1.044) | 1.035 (1.029–1.043) | 0.999 (0.994–1.005) |
| codeUnits        |      1.40 |      1.40 |       1.40 | 1.000 (0.995–1.005) | 1.000 (0.999–1.003) | 1.000 (0.998–1.004) |
| codeUnitsTwoByte |      1.40 |      1.41 |       1.40 | 1.004 (0.998–1.008) | 1.000 (0.999–1.006) | 0.999 (0.994–1.002) |
| splitJoin        |      0.86 |      0.85 |       0.84 | 0.984 (0.967–1.001) | 0.977 (0.964–0.988) | 0.997 (0.972–1.013) |
| slice            |      8.02 |      1.86 |       1.88 | 0.232 (0.230–0.235) | 0.238 (0.233–0.239) | 1.018 (1.010–1.043) |
| sliceTwoByte     |     13.38 |      2.30 |       2.31 | 0.173 (0.171–0.175) | 0.170 (0.169–0.173) | 0.988 (0.975–1.017) |
| numberString     |      2.32 |      2.48 |       2.47 | 1.068 (1.033–1.080) | 1.036 (1.020–1.069) | 0.985 (0.966–1.026) |
| template         |      0.97 |      0.98 |       0.97 | 1.001 (0.994–1.013) | 1.002 (0.994–1.011) | 0.995 (0.987–1.009) |
| mapKeys          |      1.49 |      1.51 |       1.50 | 1.007 (0.990–1.017) | 1.001 (0.997–1.016) | 0.999 (0.988–1.005) |
| utf8             |      0.79 |      0.61 |       0.61 | 0.778 (0.769–0.789) | 0.774 (0.757–0.794) | 1.008 (0.965–1.033) |
| utf8TwoByte      |      4.54 |      4.56 |       4.64 | 1.009 (0.997–1.016) | 1.028 (1.022–1.053) | 1.029 (1.013–1.039) |
| clone1KiB        |      0.60 |      0.56 |       0.59 | 0.938 (0.930–0.946) | 0.986 (0.973–0.992) | 1.050 (1.040–1.059) |
| clone1MiB        |      1.15 |      0.94 |       1.02 | 0.814 (0.802–0.828) | 0.825 (0.810–0.848) | 1.012 (0.986–1.045) |
| strings          |      1.59 |      1.58 |       1.58 | 0.990 (0.986–0.999) | 1.001 (0.986–1.007) | 1.005 (0.997–1.018) |
| stringBuild      |      2.44 |      2.44 |       1.92 | 1.008 (1.002–1.013) | 0.788 (0.779–0.796) | 0.785 (0.775–0.789) |
| upperCase (gen.) |     14.18 |     14.32 |      14.26 | 1.010 (0.997–1.030) | 1.011 (0.993–1.016) | 0.986 (0.978–1.025) |
| json (gen.)      |     16.75 |     16.87 |      17.14 | 1.011 (1.006–1.014) | 1.029 (1.021–1.041) | 1.027 (1.015–1.030) |

## Reading

- **The builder works where it applies.** `stringBuild` runs 21.5% faster
  than without it (2.44× → 1.92× Node).
- **Short loops pay for it.** `clone1KiB` (+5.0%), `utf8TwoByte` (+2.9%)
  and `json` (+2.7%) slow down. Build remarks (`TINT_REMARKS=pass=build-loop-strings`)
  show that of their loops only foundation's `finishString` is rewritten, a
  loop over a few large parts. Plain `+=` keeps the first part without a
  copy and copies exactly after that. The buffer copies every part into a
  buffer twice the needed size, and the exit returns a slice of it.
- **`concat` is not rewritten.** Its loop appends
  `(words[i] ?? "") + separator`. `+=` reads the string before evaluating
  that piece, whose `??` branches, so the read and the concatenation are in
  different blocks, and the pass needs them in one.
- The sliced-string regressions against s6 remain (`concat` +5.8%,
  `concatTwoByte` +4.7%, `searchTwoByte` +3.7%, `numberString` +6.8% for
  s9); they are not the builder's.

## Follow-up

The next change (s12) makes the builder's first three growths concatenate
exactly, so a loop of a few appends copies no more than plain `+=` and its
result stays flat. It also lowers `s += piece` and `s = s + a + b` to read
`s` after the pieces when that is unobservable (an uncaptured local the
pieces do not assign), so loops with branching pieces, such as `concat`'s,
are rewritten too.
