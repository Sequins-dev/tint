# One-byte strings, slice 3: A/B against main (v1)

Recorded 2026-11-23 on macOS arm64 (Apple M5 Max), with
`tools/string-bench` under the protocol of
[slice 1's reports](string-slice1-ab-v3.md): 15 paired, rotated rounds per
suite, native images under LLDB with stop-at-entry and exit status 42
asserted, and Node 26.13.1 (`/opt/homebrew/bin/node`).

## Builds

| Label | Code                                                               | Images                                                 |
| ----- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| base  | main as in [slice 1 v1](string-slice1-ab-v1.md)                    | typed `1172f0835b2292a1…`, general `69ba4d0120a92f8d…` |
| ob5   | slice 1 complete (`aefe7ff27`), as in [v3](string-slice1-ab-v3.md) | typed `4576f24d410960bb…`, general `08451959f2a164c7…` |
| s3    | slice 3 (`51c299cd7`)                                              | typed `147203d5c4d59c5f…`, general `1a3939a425f1a27a…` |

The s3 images were prepared from the working tree committed as
`95078cfd6`, `16adacd76` and `51c299cd7`. Their recorded patch hash
(`563e3783d8873472…`) equals the hash of those commits' modifications to
tracked files. Their new files were committed unchanged. Slice 3 adds:

- exact fast paths in `numberToString` and `stringToNumber` (short exact
  decimals and Clinger's fast path), and integers below 10^8 formatted with
  one allocation;
- the bound Latin-1 and ASCII primitives
  ([design](../design-one-byte-strings.md#bulk-text-primitives));
- the UTF-8 codec moving ASCII runs in bulk.

One-minute load at round starts was 2.9–5.8 (typed) and 3.4–6.4 (general).
Raw rounds: [typed](string-slice3-ab-v1-typed.json) and
[general](string-slice3-ab-v1-general.json).

## Kernels

Steady milliseconds (medians). The s3/base ratio is paired, as a median with
interquartile range.

| Kernel              | Node |  base |   ob5 |    s3 | s3/base          |  s3/Node |
| ------------------- | ---: | ----: | ----: | ----: | ---------------- | -------: |
| create              |  8.5 |  19.4 |  17.4 |  17.2 | 0.92 (0.88–0.95) |     2.04 |
| concat              | 13.3 |  38.9 |  18.6 |  18.6 | 0.47 (0.46–0.48) |     1.37 |
| concatTwoByte       | 13.4 |  38.7 |  28.3 |  27.5 | 0.70 (0.69–0.71) |     2.06 |
| equality            |  8.3 |  23.7 |  23.2 |  23.1 | 0.97 (0.95–0.99) |     2.74 |
| search              | 14.6 |  57.0 |  11.9 |  11.9 | 0.21 (0.20–0.22) | **0.81** |
| searchTwoByte       | 14.4 |  54.1 |  10.5 |  10.6 | 0.20 (0.18–0.21) | **0.74** |
| codeUnits           | 10.6 |  42.4 |  14.2 |  14.1 | 0.33 (0.33–0.34) |     1.34 |
| codeUnitsTwoByte    |  9.3 |  39.1 |  13.1 |  13.0 | 0.33 (0.33–0.34) |     1.39 |
| splitJoin           | 17.4 |  23.6 |  15.7 |  15.3 | 0.65 (0.63–0.67) | **0.87** |
| slice               |  2.5 |  49.8 |  20.0 |  19.9 | 0.41 (0.40–0.41) |     7.93 |
| sliceTwoByte        |  2.6 |  47.3 |  33.7 |  33.2 | 0.71 (0.69–0.73) |    13.07 |
| numberString        |  0.7 | 231.9 | 232.1 |   1.8 | 0.01 (0.01–0.01) |     2.43 |
| template            | 16.6 |  25.5 |  20.9 |  20.6 | 0.83 (0.80–0.84) |     1.25 |
| mapKeys             | 13.7 |  21.2 |  20.8 |  20.4 | 0.97 (0.95–0.99) |     1.53 |
| utf8                |  1.1 | 136.0 | 138.7 |   0.7 | 0.01 (0.00–0.01) | **0.59** |
| utf8TwoByte         |  4.6 | 140.4 | 145.1 |  21.0 | 0.15 (0.15–0.15) |     4.59 |
| clone1KiB           | 11.5 |  31.1 |  29.0 |   6.6 | 0.22 (0.21–0.22) | **0.59** |
| clone1MiB           |  2.9 |   9.7 |   4.3 |   3.5 | 0.36 (0.35–0.38) |     1.28 |
| upperCase (general) |  0.2 | 282.5 | 289.3 | 290.9 | 1.03 (1.00–1.04) |  1607.13 |
| json (general)      |  8.4 | 214.8 | 214.6 | 139.6 | 0.65 (0.64–0.65) |    16.97 |

## Frozen v7 self-compile

The frozen v7 image built by slice 3's code generator (`native-ob7`,
`--runtime-tree`) has a `__text` section byte-identical to slice 1's
`native-ob5`. The snapshot keeps its own foundation, so the codec and number
changes do not reach it. The 81 differing bytes are the Mach-O UUID, the code
signature, and one byte of the DWARF compilation directory (`source-ob5` to
`source-ob7`). Its timing is therefore [v3's](string-slice1-ab-v3.md#frozen-v7-self-compile).

## Reading

- **Five kernels now beat Node:** `utf8`, `clone1KiB`, `search`,
  `searchTwoByte` and `splitJoin`.
- **The codec and number changes** remove the two largest typed gaps:
  - `numberString` drops from 232 ms to 1.8 ms (from 330× to 2.4× Node);
  - `utf8` drops from 136 ms to 0.7 ms;
  - `utf8TwoByte` drops from 140 ms to 21 ms. It still decodes non-ASCII
    code points one at a time.
  - The clone and JSON kernels gain through the same number and text paths.
- **No kernel regressed against slice 1.** General `upperCase` is within
  noise.
- **Remaining gaps to Node** (landing bar: all at or below 1.0 on both hosts):
  - `slice` and `sliceTwoByte`: each `substring` copies about 1–2 KiB, and
    the copies alone exceed Node's time. These need sliced strings.
  - `upperCase` and `json`: general-runtime per-character work, plus
    general call overhead.
  - `utf8TwoByte` and `numberString`.
  - `equality`, `create`, `concatTwoByte`, `mapKeys`, `concat`,
    `codeUnits`, `template` and `clone1MiB`.
