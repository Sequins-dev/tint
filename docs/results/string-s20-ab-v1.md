# One-byte strings: s14 to s20 on macOS arm64 (v1)

Recorded 2026-11-24 on macOS arm64 (Apple M5 Max), using the
[slice 3 protocol](string-slice3-ab-v1.md): `tools/string-bench`, 15 paired
rotated rounds, LLDB-asserted native runs and Node 26.13.1, in one run
under both gate locks (#19's fair queue), so every stage pairs with every
other in the same rounds.

## Candidates

The base is s13 (`758248782`, typed image `ee9a1f654883…`), as in
[s13](string-s13-ab-v1.md). Each later stage adds to the one before:

- **s14** (`efec21899`): code-unit loops entered through a copy for each
  flat string kind (`version-string-loops`).
- **s15** (`400d058e0`): exact integer remainders as int64 `sdiv`/`msub`.
- **s16** (`1c6c3ed41`): the number-string cache (`1c48d378d`) and the
  JSON string paths (`407fc2cfb`).
- **s17** (`1f84400e7`):
  - one-pass decimal parsing and division-free digit formatting
    (`fde35a819`);
  - ToInt32 without the integrality round trip (`6cb3577d0`);
  - the cache indexed by truncation (`07dff2efc`);
  - non-negative counter remainders kept in integers (`1f84400e7`).
- **s19** (`3863ed868`):
  - short one-byte joins in one data word (`2bb05ba9f`);
  - short one-byte writes as one word (`c617fd5a6`);
  - `x | 0` as one sign extension (`e9a0dfbc1`);
  - truncated sums of products (`3863ed868`).
- **s20** (`eee4d9b42`): inline number-string lookups with
  `numberToStringMissed`.

## Results

One-minute load was 4.3 at the start and rose to 5.7 by the end of the typed run, after a 10.6 five-minute peak from other streams. Raw rounds: [typed](string-s20-ab-v1-typed.json) and
[general](string-s20-ab-v1-general.json). Steady medians over Node, and
paired per-round ratios of each stage over the one before (median,
interquartile range):

| Kernel           | s13 / Node | s14 / Node | s15 / Node | s16 / Node | s17 / Node | s19 / Node | s20 / Node | s14 / s13           | s15 / s14           | s16 / s15           | s17 / s16           | s19 / s17           | s20 / s19           |
| ---------------- | ---------: | ---------: | ---------: | ---------: | ---------: | ---------: | ---------: | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| create           |       1.92 |       1.82 |       1.84 |       1.57 |       1.25 |       1.21 |       0.95 | 0.972 (0.937–0.992) | 1.000 (0.975–1.020) | 0.858 (0.849–0.872) | 0.787 (0.769–0.812) | 0.985 (0.958–1.103) | 0.771 (0.730–0.841) |
| concat           |       0.91 |       0.92 |       0.91 |       0.91 |       0.94 |       0.65 |       0.65 | 1.007 (0.962–1.028) | 1.015 (0.959–1.058) | 1.003 (0.964–1.023) | 1.003 (0.964–1.086) | 0.709 (0.663–0.768) | 1.001 (0.900–1.030) |
| concatTwoByte    |       1.02 |       1.04 |       1.02 |       1.00 |       1.05 |       1.09 |       1.08 | 1.002 (0.952–1.016) | 1.000 (0.978–1.029) | 1.006 (0.991–1.025) | 1.013 (0.961–1.047) | 1.041 (1.031–1.063) | 1.009 (0.905–1.059) |
| equality         |       2.68 |       2.68 |       2.65 |       2.67 |       2.72 |       2.73 |       2.75 | 0.984 (0.949–1.016) | 0.997 (0.959–1.004) | 1.003 (0.979–1.031) | 1.007 (0.983–1.037) | 1.011 (0.994–1.036) | 1.009 (0.972–1.062) |
| search           |       0.80 |       0.79 |       0.80 |       0.79 |       0.80 |       0.81 |       0.79 | 0.985 (0.962–1.009) | 0.990 (0.948–1.014) | 1.000 (0.986–1.025) | 1.011 (0.988–1.025) | 0.997 (0.988–1.003) | 0.989 (0.967–1.072) |
| searchTwoByte    |       0.75 |       0.74 |       0.74 |       0.74 |       0.74 |       0.75 |       0.74 | 0.971 (0.939–1.009) | 0.995 (0.958–1.011) | 0.982 (0.976–1.039) | 0.996 (0.977–1.043) | 1.009 (0.999–1.046) | 0.990 (0.923–1.031) |
| codeUnits        |       1.32 |       1.33 |       1.33 |       1.37 |       1.38 |       1.00 |       0.96 | 0.991 (0.977–0.999) | 0.995 (0.961–1.007) | 1.000 (0.988–1.044) | 1.002 (0.992–1.023) | 0.714 (0.696–0.726) | 1.006 (0.979–1.053) |
| codeUnitsTwoByte |       1.36 |       1.34 |       1.38 |       1.38 |       1.41 |       1.00 |       1.00 | 0.980 (0.964–1.000) | 0.995 (0.968–1.001) | 0.999 (0.994–1.034) | 1.001 (0.993–1.059) | 0.717 (0.696–0.733) | 0.985 (0.944–1.019) |
| splitJoin        |       0.85 |       0.83 |       0.85 |       0.84 |       0.85 |       0.81 |       0.79 | 0.990 (0.972–1.020) | 0.977 (0.961–1.014) | 1.011 (0.984–1.026) | 1.005 (0.993–1.081) | 0.956 (0.939–1.041) | 0.983 (0.781–1.003) |
| slice            |       1.59 |       1.57 |       1.60 |       1.59 |       1.62 |       1.53 |       1.51 | 0.998 (0.976–1.022) | 0.981 (0.965–1.019) | 0.993 (0.987–1.021) | 1.011 (0.977–1.071) | 0.936 (0.921–1.031) | 0.982 (0.933–1.089) |
| sliceTwoByte     |       2.24 |       2.20 |       2.22 |       2.22 |       2.18 |       2.21 |       2.13 | 0.980 (0.948–1.042) | 0.975 (0.948–1.012) | 1.018 (0.999–1.083) | 0.988 (0.951–1.024) | 0.990 (0.963–1.059) | 0.987 (0.969–1.029) |
| numberString     |       2.41 |       2.51 |       2.40 |       2.51 |       1.31 |       1.32 |       1.31 | 1.003 (0.982–1.057) | 1.012 (0.949–1.039) | 1.000 (0.984–1.054) | 0.513 (0.492–0.600) | 1.003 (0.961–1.057) | 1.012 (0.941–1.065) |
| template         |       0.95 |       0.94 |       0.92 |       0.61 |       0.63 |       0.64 |       0.55 | 0.988 (0.971–1.012) | 0.990 (0.953–1.000) | 0.670 (0.656–0.716) | 0.996 (0.968–1.119) | 1.022 (0.961–1.079) | 0.853 (0.614–0.880) |
| mapKeys          |       1.48 |       1.47 |       1.45 |       1.46 |       1.46 |       1.45 |       1.40 | 0.976 (0.943–1.005) | 0.994 (0.959–1.001) | 1.027 (1.013–1.067) | 0.957 (0.944–1.073) | 0.992 (0.967–1.070) | 0.989 (0.926–1.007) |
| utf8             |       0.56 |       0.58 |       0.57 |       0.56 |       0.59 |       0.59 |       0.58 | 1.028 (0.992–1.100) | 0.983 (0.952–1.037) | 0.973 (0.951–1.030) | 1.029 (1.003–1.231) | 0.971 (0.934–1.044) | 0.974 (0.883–1.069) |
| utf8TwoByte      |       1.09 |       1.10 |       1.09 |       1.07 |       1.10 |       1.10 |       1.09 | 0.983 (0.969–1.004) | 0.997 (0.922–1.034) | 0.993 (0.970–1.036) | 1.046 (0.993–1.083) | 1.005 (0.973–1.057) | 1.002 (0.986–1.048) |
| clone1KiB        |       0.54 |       0.54 |       0.54 |       0.46 |       0.46 |       0.44 |       0.43 | 0.994 (0.978–1.028) | 0.985 (0.934–1.004) | 0.863 (0.852–0.903) | 0.954 (0.913–1.005) | 0.970 (0.931–0.991) | 0.988 (0.934–1.002) |
| clone1MiB        |       0.87 |       0.88 |       0.85 |       0.90 |       0.97 |       0.94 |       0.86 | 0.990 (0.980–1.027) | 0.983 (0.933–1.017) | 1.066 (1.031–1.117) | 0.999 (0.914–1.051) | 0.930 (0.870–1.000) | 0.959 (0.929–1.028) |
| strings          |       1.43 |       1.46 |       1.45 |       1.17 |       1.19 |       1.11 |       1.01 | 1.007 (0.995–1.035) | 0.992 (0.901–1.009) | 0.817 (0.807–0.856) | 1.034 (0.962–1.090) | 0.953 (0.916–1.008) | 0.883 (0.831–0.905) |
| stringBuild      |       1.80 |       1.81 |       1.78 |       1.36 |       1.42 |       1.24 |       1.02 | 0.989 (0.977–1.015) | 0.987 (0.924–1.030) | 0.792 (0.773–0.818) | 1.026 (0.975–1.070) | 0.919 (0.882–1.060) | 0.808 (0.750–0.854) |
| upperCase (gen.) |      14.71 |      14.75 |      14.77 |      14.80 |      14.73 |      14.64 |      14.81 | 0.996 (0.993–1.016) | 1.009 (0.991–1.013) | 0.992 (0.985–1.002) | 0.994 (0.989–1.001) | 1.002 (0.986–1.012) | 1.009 (0.992–1.016) |
| json (gen.)      |      16.82 |      16.85 |      16.86 |      12.94 |      12.76 |      12.74 |      12.72 | 1.003 (0.997–1.005) | 1.001 (0.999–1.003) | 0.765 (0.764–0.767) | 0.988 (0.984–0.991) | 1.001 (0.997–1.005) | 0.998 (0.995–1.002) |

## Reading

- **At or under Node on macOS at s20:**
  - create (0.95), concat (0.65), template (0.55);
  - codeUnits (0.96) and codeUnitsTwoByte (1.00);
  - search (0.79), searchTwoByte (0.74), splitJoin (0.79);
  - utf8 (0.58), clone1KiB (0.43) and clone1MiB (0.86).
  - strings (1.01) and stringBuild (1.02) are at Node within the noise.
- **s14 and s15** change no kernel measurably here. The `codeUnits`
  kernel's text is a slice, which `version-string-loops` leaves to the
  general loop, and no kernel's remainder had an exact divisor and
  dividend.
- **s16** is the cache and JSON step:
  - json (general) 0.765 of s15;
  - stringBuild 0.792, strings 0.817, create 0.858, template 0.670,
    clone1KiB 0.863;
  - mapKeys rose 2.7% and clone1MiB 6.6% (clone1MiB is noisy at
    0.86–0.97x Node across stages).
- **s17** halves numberString (0.513) and takes create to 0.787 of s16.
- **s19:**
  - codeUnits 0.714 of s17, concat 0.709, stringBuild 0.919, slice
    0.936;
  - concatTwoByte rose 4.1% (1.08x Node). The widening tail
    (`568d400b5`) addresses it: on Linux it is 0.915 of the image before.
- **s20:** create 0.771 of s19, stringBuild 0.808, template 0.853,
  strings 0.883.
- **Remaining over Node on macOS:**
  - numberString (1.31), mapKeys (1.40, mostly #12's map lookup);
  - slice (1.51), sliceTwoByte (2.13), equality (2.75);
  - utf8TwoByte (1.09, 0.92 on Linux), concatTwoByte (1.08);
  - the general upperCase (14.8) and json (12.7), which are #12's.
