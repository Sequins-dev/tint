# One-byte strings: sliced strings on AArch64 (s7, v1)

Recorded 2026-11-23 on macOS arm64 (Apple M5 Max), using the
[slice 3 protocol](string-slice3-ab-v1.md): `tools/string-bench`, 15 paired
rotated rounds, LLDB-asserted native runs and Node 26.13.1.

## Candidate

The base is s6, the images of `db26717a6` (code as at `2c162bd76`; typed
image `6ca5f8e812efe16b…`). s7 adds sliced strings
([design](../design-one-byte-strings.md#sliced-strings)) as an uncommitted
patch on `2c162bd76` (hash `5acd4ec9c298…`; typed image `832a02f43aa3e285…`).

On AArch64, `slice` and `substring` results of at least 13 units in their
source's kind view the source's units. Every string reader resolves them.

One-minute load at round starts was 3.7–6.5 (typed) and 3.6–4.5 (general).
Raw rounds: [typed](string-s7-ab-v1-typed.json) and
[general](string-s7-ab-v1-general.json).

## Results

Steady medians, and paired s7/s6 with interquartile range:

| Kernel        | Node |   s6 |   s7 | s7/s6               | s7/Node |
| ------------- | ---: | ---: | ---: | ------------------- | ------: |
| slice         |  2.6 | 19.8 |  5.2 | 0.267 (0.263–0.278) |    2.16 |
| sliceTwoByte  |  2.5 | 33.0 |  7.3 | 0.219 (0.215–0.224) |    2.93 |
| clone1MiB     |  2.4 |  3.3 |  2.7 | 0.820 (0.791–0.877) |    1.17 |
| utf8          |  1.1 |  0.9 |  0.7 | 0.795 (0.776–0.810) |    0.63 |
| clone1KiB     | 11.0 |  6.6 |  6.2 | 0.934 (0.912–0.951) |    0.57 |
| create        |  8.5 | 16.8 | 16.2 | 0.971 (0.952–0.980) |    1.95 |
| concat        | 13.3 | 18.6 | 19.9 | 1.070 (1.043–1.098) |    1.50 |
| equality      |  8.3 | 23.5 | 24.6 | 1.059 (1.013–1.065) |    2.91 |
| numberString  |  0.7 |  1.7 |  1.8 | 1.052 (1.031–1.085) |    2.44 |
| splitJoin     | 17.5 | 15.0 | 15.8 | 1.051 (1.011–1.068) |    0.90 |
| concatTwoByte | 13.2 | 28.2 | 29.3 | 1.050 (1.016–1.060) |    2.24 |

The other kernels, and general `upperCase` and `json`, were within ±2%.

## Reading

- **Slices cut `slice` and `sliceTwoByte` by 73–78%.** The remaining cost
  per slice is three helper calls (bounds, kind and view) and a 32-byte
  allocation.
- **Readers pay 5–7%** on `concat`, `concatTwoByte`, `equality` and
  `splitJoin`, from the slice tests added to the copy, equality and write
  helpers. Split parts of 13 units or more are now slices that `join`
  resolves.
- **The `numberString` change is unexplained** here.
- **Before landing**, flat strings must be no slower than s6. The
  orchestrator's conditions also require:
  - a minimum slice length chosen by measurement;
  - retention measured;
  - a flat-only extent interface for PR #15.
