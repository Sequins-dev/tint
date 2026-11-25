# One-byte strings: s21 and s22 on macOS arm64 (v1)

Recorded 2026-11-24 on macOS arm64 (Apple M5 Max), using the
[slice 3 protocol](string-slice3-ab-v1.md): `tools/string-bench`, 15 paired
rotated rounds, LLDB-asserted native runs and Node 26.13.1, in one run
under both gate locks (#19's fair queue), so every stage pairs with every
other in the same rounds.

## Candidates

The base is s20 (`eee4d9b42`, typed image `df4bde4b99da…`), the last stage
of [s14 to s20](string-s20-ab-v1.md). Each later stage adds to the one
before, and each image was built from a clean tree:

- **s21** (`cfa1fb8e0`, typed image `f7153a5f070d…`):
  - widening and narrowing tails of four, two and one units without a
    loop (`568d400b5`);
  - slice limits that are wrapped numbers skip the absence test
    (`cfa1fb8e0`).
- **s22** (`a3706b2c8`, typed image `c0d63b0fbbb4…`): cached array indices
  in the string header's index field.

Stage 2 equals stage 3 for both s21 and s22.

## Results

One-minute load was 3.1 at the start, 3.2 after the typed run and 4.0
after the general run. Raw rounds: [typed](string-s22-ab-v1-typed.json)
and [general](string-s22-ab-v1-general.json). Steady medians over Node,
and paired per-round ratios of each stage over the one before (median,
interquartile range):

| Kernel           | s20 / Node | s21 / Node | s22 / Node | s21 / s20           | s22 / s21           |
| ---------------- | ---------: | ---------: | ---------: | ------------------- | ------------------- |
| create           |       0.95 |       0.96 |       0.95 | 1.006 (0.994–1.024) | 0.998 (0.989–1.006) |
| concat           |       0.65 |       0.65 |       0.66 | 1.020 (0.983–1.025) | 0.995 (0.961–1.033) |
| concatTwoByte    |       1.08 |       0.99 |       0.98 | 0.909 (0.869–0.928) | 1.007 (0.983–1.016) |
| equality         |       2.84 |       2.78 |       2.78 | 0.982 (0.963–1.007) | 1.001 (0.988–1.012) |
| search           |       0.81 |       0.81 |       0.81 | 1.000 (0.964–1.004) | 1.006 (0.996–1.014) |
| searchTwoByte    |       0.75 |       0.75 |       0.75 | 0.995 (0.985–1.003) | 0.998 (0.985–1.013) |
| codeUnits        |       0.96 |       0.97 |       0.96 | 0.999 (0.994–1.009) | 0.998 (0.990–1.002) |
| codeUnitsTwoByte |       0.99 |       1.00 |       1.00 | 1.001 (0.996–1.006) | 0.998 (0.996–1.000) |
| splitJoin        |       0.79 |       0.78 |       0.80 | 0.987 (0.977–1.010) | 1.021 (1.003–1.026) |
| slice            |       1.51 |       1.46 |       1.45 | 0.965 (0.937–0.988) | 0.994 (0.987–1.044) |
| sliceTwoByte     |       2.15 |       2.10 |       2.12 | 0.971 (0.954–1.020) | 1.002 (0.983–1.011) |
| numberString     |       1.33 |       1.30 |       1.12 | 0.985 (0.967–1.000) | 0.865 (0.834–0.871) |
| template         |       0.56 |       0.54 |       0.53 | 0.976 (0.935–1.032) | 0.973 (0.945–1.044) |
| mapKeys          |       1.44 |       1.44 |       1.44 | 0.998 (0.979–1.006) | 1.006 (0.991–1.016) |
| utf8             |       0.57 |       0.58 |       0.57 | 1.020 (0.996–1.044) | 0.979 (0.947–1.012) |
| utf8TwoByte      |       1.09 |       1.11 |       1.11 | 1.009 (0.982–1.025) | 1.016 (0.981–1.023) |
| clone1KiB        |       0.44 |       0.44 |       0.45 | 0.996 (0.989–1.012) | 0.999 (0.975–1.028) |
| clone1MiB        |       0.88 |       0.85 |       0.85 | 0.988 (0.969–1.017) | 0.996 (0.950–1.033) |
| strings          |       1.01 |       1.01 |       1.00 | 1.003 (0.991–1.021) | 0.998 (0.971–1.014) |
| stringBuild      |       1.02 |       1.01 |       1.00 | 1.008 (0.973–1.023) | 0.995 (0.968–1.008) |
| upperCase (gen.) |      14.39 |      14.42 |      14.34 | 1.002 (0.993–1.021) | 0.994 (0.973–1.018) |
| json (gen.)      |      12.63 |      12.85 |      12.77 | 1.000 (0.993–1.008) | 1.006 (0.995–1.012) |

## Reading

- **s21:** concatTwoByte drops to 0.909 of s20 (0.98x Node), as it did on
  Linux; slice is 0.965 of s20. Nothing else moves beyond its
  interquartile range.
- **s22:** numberString drops to 0.865 of s21 (1.12x Node): `Number(s)`
  of formatted and literal array indices now reads the index field.
  splitJoin rose 2.1% (interquartile range 1.003–1.026); nothing else
  moves beyond its interquartile range.
- **At or under Node on macOS at s22:**
  - create (0.95), concat (0.66), concatTwoByte (0.98), template (0.53);
  - codeUnits (0.96) and codeUnitsTwoByte (1.00);
  - search (0.81), searchTwoByte (0.75), splitJoin (0.80);
  - utf8 (0.57), clone1KiB (0.45) and clone1MiB (0.85);
  - strings (1.00) and stringBuild (1.00) are at Node within the noise.
- **Remaining over Node on macOS:**
  - numberString (1.12), mapKeys (1.44, mostly #12's map lookup);
  - slice (1.45), sliceTwoByte (2.12), equality (2.78), whose number
    representation moves to `perf/integer-representation`;
  - utf8TwoByte (1.11; 0.86 on Linux);
  - the general upperCase (14.3) and json (12.8), which are #12's.
