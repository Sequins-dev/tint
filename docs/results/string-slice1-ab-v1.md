# One-byte strings, slice 1: A/B against main (v1)

Recorded 2026-11-23 on macOS arm64 (Apple M5 Max, macOS 26.6.2). The
benchmark protocol is [the baseline's](string-baseline-v1.md):
`tools/string-bench` with 15 paired, rotated rounds under
`tools/gate/with-lock.sh both`, and every native run under LLDB.

## Builds

| Label | Packages         | Notes                                                                                      |
| ----- | ---------------- | ------------------------------------------------------------------------------------------ |
| base  | main `183ec7044` | Checked out into this worktree, then built; patch hash `55ed948438a7…` against `f59e4c218` |
| ob1   | `f59e4c218`      | Slice 1: flat one-byte and two-byte kinds                                                  |

All images were built in this worktree with the same tools (`f59e4c218`) and
Node 26.13.1.

| Suite | base image          | ob1 image           |
| ----- | ------------------- | ------------------- |
| typed | `1172f0835b2292a1…` | `f4dcfbac4cc7a913…` |

One-minute load at round starts was 1.8–3.3.

Raw rounds: [typed](string-slice1-ab-v1-typed.json),
[general](string-slice1-ab-v1-general.json) and
[frozen v7](string-slice1-ab-v1-frozen.log).

## Kernels

Cells are steady milliseconds. The last column is the paired ob1/base
ratio, median with interquartile range.

| Kernel              | Node |  base |   ob1 | ob1/base         |
| ------------------- | ---: | ----: | ----: | ---------------- |
| create              |  8.2 |  18.0 |  26.1 | 1.44 (1.44–1.47) |
| concat              | 12.8 |  38.1 |  26.2 | 0.69 (0.69–0.69) |
| concatTwoByte       | 12.6 |  37.9 |  42.4 | 1.13 (1.12–1.14) |
| equality            |  8.1 |  23.0 |  22.6 | 0.98 (0.97–0.99) |
| search              | 14.4 |  52.8 |  64.4 | 1.21 (1.17–1.25) |
| searchTwoByte       | 14.1 |  49.1 |  69.2 | 1.39 (1.37–1.42) |
| codeUnits           |  9.9 |  41.6 |  41.6 | 1.00 (1.00–1.00) |
| codeUnitsTwoByte    |  9.2 |  38.4 |  38.4 | 1.00 (1.00–1.00) |
| splitJoin           | 17.1 |  22.6 |  27.2 | 1.19 (1.17–1.21) |
| slice               |  2.4 |  48.6 |  30.6 | 0.63 (0.62–0.63) |
| sliceTwoByte        |  2.4 |  45.4 |  49.5 | 1.09 (1.08–1.10) |
| numberString        |  0.7 | 221.4 | 224.8 | 1.02 (1.01–1.02) |
| template            | 15.8 |  24.1 |  34.8 | 1.44 (1.44–1.45) |
| mapKeys             | 13.0 |  20.4 |  23.1 | 1.14 (1.13–1.15) |
| utf8                |  1.1 | 130.4 | 133.6 | 1.03 (1.02–1.03) |
| utf8TwoByte         |  4.5 | 135.1 | 146.1 | 1.08 (1.08–1.09) |
| clone1KiB           | 10.6 |  29.9 |  29.4 | 0.98 (0.97–0.99) |
| clone1MiB           |  2.9 |   9.2 |   6.5 | 0.71 (0.70–0.72) |
| upperCase (general) |  0.2 | 280.4 | 290.5 | 1.03 (1.03–1.05) |
| json (general)      |  8.2 | 213.8 | 220.0 | 1.03 (1.03–1.03) |

## Frozen v7 self-compile

Built as `frozen-workload.ts build v7 <label> --runtime-tree`:

| Image         |                                              Bytes |
| ------------- | -------------------------------------------------: |
| `native-base` |                                         77,206,898 |
| `native-ob1`  | 76,761,298 (−445,600, from one-byte literal pools) |

`frozen-workload.ts run v7 base ob1 --rounds 5` (interleaved):

| Image | Wall (median) | Cycles (median) | Instructions | Peak RSS |
| ----- | ------------: | --------------: | -----------: | -------: |
| base  |       66.10 s |         316.4 G |    1,621.8 G | 2.227 GB |
| ob1   |       67.87 s |         322.9 G |    1,655.4 G | 2.225 GB |

Both outputs are byte-identical (`68c11052966f…d17846`).

## Reading

Slice 1 is **not acceptable as measured**:

- the frozen self-compile is 2% slower in cycles;
- several kernels regress.

The causes:

- `startsWith` was called once per position from `indexOf`, `includes` and
  `split`, now with a kind test on every call.
- Byte-at-a-time loops widened, narrowed and scanned strings.
- Small strings (`String.fromCharCode`, `String(n)` digits, concatenation)
  cost more per allocation.

Slice 1b (`string-index-of`, vector loops, loop-free small copies, one
allocation per four digits of `String(n)`) is measured in v2 and v3.
