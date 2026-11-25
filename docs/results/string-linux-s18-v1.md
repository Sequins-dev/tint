# One-byte strings on Linux arm64: per-change A/Bs (s18, v1)

Recorded 2026-11-24 on the shared Linux arm64 `dev` machine (Apple
silicon host), with `tools/string-bench`: `prepare` against Node
26.13.1 (linux-arm64), then `measure` with 15 paired rotated rounds. Linux
runs take no macOS gate lock. The host was shared with other streams'
builds and timing runs, so absolute times drift between runs. Each change
is therefore measured against the image just before it, in the same run.

## Baseline

`2bb05ba9f` (clean tree) against Node. Raw rounds:
[typed](string-linux-s18-v1-typed.json) and
[general](string-linux-s18-v1-general.json). Steady medians over Node:

| Kernel           | s18 / Node |
| ---------------- | ---------: |
| create           |       1.17 |
| concat           |       0.73 |
| concatTwoByte    |       1.01 |
| equality         |       2.71 |
| search           |       0.93 |
| searchTwoByte    |       0.93 |
| codeUnits        |       1.40 |
| codeUnitsTwoByte |       1.39 |
| splitJoin        |       0.85 |
| slice            |       1.61 |
| sliceTwoByte     |       2.15 |
| numberString     |       1.18 |
| template         |       0.50 |
| mapKeys          |       1.32 |
| utf8             |       0.28 |
| utf8TwoByte      |       0.91 |
| clone1KiB        |       0.26 |
| clone1MiB        |       0.59 |
| strings          |       1.09 |
| stringBuild      |       1.31 |
| upperCase (gen.) |      14.92 |
| json (gen.)      |      14.02 |

## Changes

Each column is one paired run of a candidate against the image just
before it: steady time ratio, median of the 15 per-round ratios. Below 1
is faster. The candidate images were built from the working tree, so
their `patchSha256` records the uncommitted change; each later became
the named commit unchanged.

- **w1**: short one-byte `string-write` parts as one word (`c617fd5a6`),
  against `2bb05ba9f`.
- **w2**: `x | 0` as one sign extension (`e9a0dfbc1`).
- **w3**: truncated sums of products in 32 bits (`3863ed868`).
- **w8**: inline number-string lookups with `numberToStringMissed`
  (`eee4d9b42`), against w3.
- **w10**: the four/two/one widening tail (`568d400b5`), against w8.
- **w11**: the narrowing tail (`568d400b5`), against w10.
- **Dropped:**
  - **w4**: a 32-bit fast path for integral double addends, against w3;
  - **w6**: inline one- and two-word two-byte writes, against w3;
  - **w9**: `Math.imul` in `hashString`, against w8.

Raw rounds: [w1](string-linux-s18-v1-w1.json),
[w2](string-linux-s18-v1-w2.json), [w3](string-linux-s18-v1-w3.json),
[w8](string-linux-s18-v1-w8.json), [w10](string-linux-s18-v1-w10.json),
[w11](string-linux-s18-v1-w11.json), [w4](string-linux-s18-v1-w4.json),
[w6](string-linux-s18-v1-w6.json) and [w9](string-linux-s18-v1-w9.json).

| Kernel           |    w1 |    w2 |    w3 |    w8 |   w10 |   w11 |    w4 |    w6 |    w9 |
| ---------------- | ----: | ----: | ----: | ----: | ----: | ----: | ----: | ----: | ----: |
| create           | 0.992 | 1.022 | 1.004 | 0.769 | 1.004 | 1.023 | 1.036 | 1.005 | 1.006 |
| concat           | 0.891 | 1.016 | 0.987 | 0.999 | 1.001 | 0.995 | 0.991 | 1.006 | 1.010 |
| concatTwoByte    | 1.011 | 1.025 | 1.001 | 1.006 | 0.915 | 0.971 | 1.014 | 0.984 | 1.008 |
| equality         | 1.004 | 1.020 | 0.994 | 0.999 | 0.988 | 0.995 | 1.002 | 0.981 | 0.988 |
| search           | 0.997 | 0.992 | 0.986 | 1.003 | 0.991 | 0.996 | 1.018 | 1.014 | 1.000 |
| searchTwoByte    | 1.005 | 1.008 | 1.006 | 0.994 | 0.997 | 1.002 | 1.002 | 0.999 | 1.000 |
| codeUnits        | 1.003 | 0.846 | 0.848 | 1.001 | 0.999 | 0.987 | 0.987 | 0.997 | 1.001 |
| codeUnitsTwoByte | 1.004 | 0.868 | 0.846 | 1.002 | 1.001 | 1.001 | 1.009 | 1.000 | 0.999 |
| splitJoin        | 0.935 | 1.002 | 0.995 | 0.998 | 1.008 | 0.971 | 0.988 | 0.984 | 1.004 |
| slice            | 0.991 | 0.978 | 0.971 | 0.999 | 0.999 | 0.996 | 1.013 | 0.992 | 1.000 |
| sliceTwoByte     | 1.014 | 0.965 | 1.016 | 0.995 | 1.009 | 0.949 | 0.992 | 0.986 | 1.008 |
| numberString     | 1.014 | 0.978 | 0.996 | 0.997 | 1.008 | 0.970 | 1.011 | 0.999 | 0.995 |
| template         | 1.017 | 0.989 | 1.020 | 0.757 | 1.005 | 0.986 | 1.034 | 1.053 | 1.004 |
| mapKeys          | 1.009 | 1.007 | 1.009 | 0.996 | 0.999 | 0.985 | 1.001 | 1.003 | 1.045 |
| utf8             | 1.015 | 0.989 | 1.081 | 0.986 | 1.022 | 1.030 | 1.012 | 1.047 | 1.018 |
| utf8TwoByte      | 0.998 | 1.009 | 1.024 | 1.005 | 0.991 | 1.010 | 1.026 | 1.002 | 1.006 |
| clone1KiB        | 0.988 | 1.005 | 1.002 | 0.983 | 0.987 | 0.993 | 1.001 | 1.004 | 0.995 |
| clone1MiB        | 1.002 | 1.013 | 1.008 | 0.973 | 0.999 | 1.012 | 1.023 | 0.996 | 1.003 |
| strings          | 0.968 | 0.992 | 0.999 | 0.902 | 1.000 | 0.987 | 1.005 | 1.009 | 1.004 |
| stringBuild      | 0.904 | 0.957 | 0.997 | 0.832 | 0.996 | 0.987 | 1.001 | 1.012 | 0.994 |

## Against Node after w11

From the w11 run (typed suite; the general kernels are #12's):

| Kernel           | w10 / Node | w11 / Node | w11 / w10           |
| ---------------- | ---------: | ---------: | ------------------- |
| create           |       0.88 |       0.89 | 1.023 (0.991–1.038) |
| concat           |       0.68 |       0.66 | 0.995 (0.937–1.028) |
| concatTwoByte    |       0.97 |       0.96 | 0.971 (0.964–1.029) |
| equality         |       2.74 |       2.72 | 0.995 (0.971–1.036) |
| search           |       0.93 |       0.91 | 0.996 (0.973–1.012) |
| searchTwoByte    |       0.92 |       0.92 | 1.002 (0.953–1.045) |
| codeUnits        |       1.02 |       1.00 | 0.987 (0.953–1.034) |
| codeUnitsTwoByte |       0.97 |       0.98 | 1.001 (0.971–1.035) |
| splitJoin        |       0.82 |       0.78 | 0.971 (0.953–1.006) |
| slice            |       1.47 |       1.52 | 0.996 (0.965–1.028) |
| sliceTwoByte     |       2.16 |       2.01 | 0.949 (0.928–0.977) |
| numberString     |       1.22 |       1.17 | 0.970 (0.911–1.007) |
| template         |       0.40 |       0.39 | 0.986 (0.960–1.008) |
| mapKeys          |       1.32 |       1.30 | 0.985 (0.966–1.008) |
| utf8             |       0.26 |       0.29 | 1.030 (0.907–1.116) |
| utf8TwoByte      |       0.86 |       0.86 | 1.010 (0.966–1.038) |
| clone1KiB        |       0.25 |       0.26 | 0.993 (0.969–1.015) |
| clone1MiB        |       0.50 |       0.51 | 1.012 (0.954–1.053) |
| strings          |       0.96 |       0.95 | 0.987 (0.955–1.010) |
| stringBuild      |       0.99 |       0.97 | 0.987 (0.977–1.017) |

## Reading

- **Kept:**
  - w8 does most of the work: create (0.769), template (0.757),
    stringBuild (0.832) and strings (0.902).
  - w2 and w3 together take the code-unit hash loops from 1.36x to
    1.00x Node.
  - w10 brings concatTwoByte under Node, and w11 takes 5% off
    sliceTwoByte.
- **Dropped:**
  - w4 changed no kernel beyond noise.
  - w6 cost template 5% for concatTwoByte's 2%.
  - w9 slowed mapKeys by 4.5%.
- **Still over Node:**
  - numberString, mapKeys (#12's map lookup), slice, sliceTwoByte and
    equality;
  - the general `upperCase` and `json` (#12's runtime).
