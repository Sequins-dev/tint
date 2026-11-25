# One-byte strings, slice 1b: A/B against main (v2)

Recorded 2026-11-23 on macOS arm64, with the same protocol, base images and
tools as [v1](string-slice1-ab-v1.md).

## Builds

`ob2` is the v1 candidate (`f59e4c218`) plus these changes (patch hash
`24cb70352f2d…`; typed image `e1987e961227e07c…`):

- **`string-index-of`:** an IR operation and a helper on both backends.
  `indexOf`, `lastIndexOf`, `includes` and `split` scan for the first
  search unit and then compare the rest. Before, they called `startsWith`
  at every position.
- **`String.fromCharCode`:** each value is converted once and kept packed in
  scratch words across the allocation.
- **Vector loops:** NEON `UXTL`, `XTN` and `SHRN` widen, narrow and scan
  eight units at a time. Copies move sixteen bytes at a time.

One-minute load at round starts was 3.0–6.3.

Raw rounds: [typed](string-slice1-ab-v2-typed.json),
[general](string-slice1-ab-v2-general.json) and
[frozen v7](string-slice1-ab-v2-frozen.log).

## Kernels

Steady milliseconds; paired ratios as medians with interquartile ranges.

| Kernel              | Node |  base |   ob2 | ob2/base         | ob2/Node |
| ------------------- | ---: | ----: | ----: | ---------------- | -------: |
| create              |  8.3 |  18.1 |  25.9 | 1.43 (1.42–1.44) |     3.12 |
| concat              | 12.9 |  38.0 |  22.4 | 0.59 (0.58–0.59) |     1.71 |
| concatTwoByte       | 12.8 |  37.8 |  30.4 | 0.81 (0.80–0.81) |     2.38 |
| equality            |  8.1 |  23.3 |  22.7 | 0.97 (0.97–1.00) |     2.80 |
| search              | 14.4 |  54.4 |  11.9 | 0.22 (0.22–0.22) | **0.82** |
| searchTwoByte       | 14.1 |  49.7 |  10.6 | 0.21 (0.21–0.22) | **0.75** |
| codeUnits           |  9.5 |  41.5 |  41.6 | 1.00 (1.00–1.00) |     4.44 |
| codeUnitsTwoByte    |  9.2 |  38.4 |  38.4 | 1.00 (1.00–1.00) |     4.19 |
| splitJoin           | 17.2 |  22.8 |  15.4 | 0.67 (0.66–0.68) | **0.89** |
| slice               |  2.5 |  48.3 |  23.7 | 0.49 (0.49–0.50) |     9.64 |
| sliceTwoByte        |  2.4 |  45.0 |  35.5 | 0.79 (0.79–0.80) |    14.89 |
| numberString        |  0.7 | 221.4 | 225.0 | 1.01 (1.01–1.02) |   314.89 |
| template            | 15.8 |  24.1 |  35.4 | 1.47 (1.46–1.48) |     2.24 |
| mapKeys             | 13.0 |  20.3 |  23.4 | 1.15 (1.14–1.16) |     1.80 |
| utf8                |  1.1 | 130.5 | 131.1 | 1.01 (1.00–1.01) |   122.14 |
| utf8TwoByte         |  4.5 | 135.7 | 141.6 | 1.05 (1.04–1.06) |    31.75 |
| clone1KiB           | 10.5 |  30.1 |  28.5 | 0.95 (0.94–0.96) |     2.72 |
| clone1MiB           |  2.5 |   9.2 |   6.1 | 0.67 (0.66–0.67) |     2.45 |
| upperCase (general) |  0.2 | 278.7 | 289.9 | 1.04 (1.03–1.05) |  1642.67 |
| json (general)      |  8.3 | 213.0 | 220.6 | 1.04 (1.03–1.04) |    26.47 |

## Frozen v7 self-compile

`native-ob2` is 76,744,882 bytes. `run v7 base ob2 --rounds 5`:

| Image | Wall (median) | Cycles (median) | Instructions | Peak RSS |
| ----- | ------------: | --------------: | -----------: | -------: |
| base  |       64.83 s |         313.0 G |    1,621.3 G | 2.227 GB |
| ob2   |       65.75 s |         316.6 G |    1,653.4 G | 2.225 GB |

Outputs are byte-identical. ob2 is still 1.2% slower in cycles.

## Small-string creation

`create` and `template` stayed 43–47% slower. Profiles of the two kernels
alone showed the same work at about 44% more cycles: retired instructions
rose 16% (54.1 to 62.5 G) while cycles rose 44% (7.6 to 10.9 G). Forcing
every heap string to two-byte gave 67.3 G instructions in 9.75 G cycles.
The cycle cost is therefore both instruction count and stalls on the
one-byte path. The stalls concentrated in the byte-at-a-time tails of
small copies and in `String(n)`, which built one string and one
concatenation per digit.

v3 replaces both:

- copies of 2–16 bytes become two overlapping loads and stores, with no loop;
- `String(n)` builds each group of up to four digits with one
  `String.fromCharCode`.
