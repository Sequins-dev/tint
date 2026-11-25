# One-byte strings: one-bit flat tests and V8's slice layout (s8, v1)

Recorded 2026-11-23 on macOS arm64 (Apple M5 Max), using the
[slice 3 protocol](string-slice3-ab-v1.md): `tools/string-bench`, 15 paired
rotated rounds, LLDB-asserted native runs and Node 26.13.1.

## Candidates

The base is s6, the images of `db26717a6` (typed `6ca5f8e812efe16b…`), as
in [s7](string-s7-ab-v1.md). Both candidates are uncommitted patches on
`a7a318658` (s7 committed):

- **s8** (patch `a4a22fab3256…`; typed image `456b99aec64a6dac…`) changes
  s7's sliced strings as the orchestrator's conditions require:
  - **Layout.** A slice holds the byte offset of its first unit in its
    parent's units and the parent, as V8's sliced strings do, instead of
    the first unit's address. The parent is an ordinary reference slot,
    and collectors copy slices verbatim.
  - **Flat tests.** Every reader tests the sliced flag with one `tbz` on a
    header it loads anyway (new AArch64 `tbz`/`tbnz` encodings), with the
    slice path out of the way.
  - **Equality.** The inline prelude compares lengths first; equal header
    high words go to the helper, otherwise only a pair including a slice
    does. The helper takes the prelude's loaded words and tests both
    headers once.
  - **Slicing.** Results shorter than 13 units are copied after one length
    test. One-byte sources skip the kind scan helper. The sliced string is
    initialized inline (two pair stores), so a slice costs the bounds
    helper call and the allocation.
- **s8b** (patch `b800ad842f10…`; typed image `f61603201c53bc91…`) adds to
  s8 a fixed layout for the private helpers: each starts on a 64-byte
  boundary, and the string helpers' loop heads (the targets of backward
  branches) are padded to 32-byte boundaries, so loops of up to eight
  instructions never straddle a 64-byte fetch block.

## Run 1: s8

One-minute load at round starts was 2.8–4.8 (typed) and 3.4–4.4 (general).
Raw rounds: [typed](string-s8-ab-v1-typed.json) and
[general](string-s8-ab-v1-general.json). Steady medians, and paired ratios
with interquartile ranges:

| Kernel        | Node |   s6 |   s8 | s8/s6               | s8/Node |
| ------------- | ---: | ---: | ---: | ------------------- | ------: |
| slice         |  2.5 | 19.5 |  4.4 | 0.224 (0.217–0.228) |    1.74 |
| sliceTwoByte  |  2.5 | 33.0 |  6.6 | 0.201 (0.189–0.209) |    2.55 |
| utf8          |  1.1 |  0.9 |  0.7 | 0.794 (0.776–0.819) |    0.62 |
| clone1MiB     |  2.9 |  3.3 |  2.6 | 0.801 (0.780–0.809) |    0.88 |
| clone1KiB     | 10.7 |  6.5 |  6.1 | 0.931 (0.903–0.941) |    0.56 |
| equality      |  8.3 | 23.1 | 22.3 | 0.974 (0.945–0.993) |    2.72 |
| create        |  8.3 | 16.8 | 16.4 | 0.984 (0.975–0.994) |    1.97 |
| splitJoin     | 17.9 | 14.8 | 15.1 | 1.019 (1.007–1.039) |    0.86 |
| numberString  |  0.7 |  1.7 |  1.8 | 1.042 (1.005–1.079) |    2.38 |
| concatTwoByte | 13.1 | 27.4 | 28.8 | 1.055 (1.026–1.077) |    2.20 |
| searchTwoByte | 14.2 | 10.4 | 11.0 | 1.069 (1.059–1.090) |    0.78 |
| concat        | 13.2 | 18.1 | 19.7 | 1.089 (1.071–1.099) |    1.50 |

The other kernels, and general `upperCase` (0.990) and `json` (1.010),
were within ±2%. Stage 2 equalled stage 3.

## Run 2: s8 and s8b

s6, s8 and s8b measured together ([raw](string-s8-ab-v1-layout.json)).
One-minute load at round starts was 5.3–8.0, so ranges are wider than in
run 1. Paired against s6:

| Kernel        | s8/s6 | s8b/s6 | s8b/s8 | s8b/Node |
| ------------- | ----: | -----: | -----: | -------: |
| concat        | 1.116 |  1.069 |  0.960 |     1.40 |
| concatTwoByte | 1.079 |  1.049 |  1.006 |     2.16 |
| equality      | 1.048 |  1.010 |  1.016 |     2.75 |
| searchTwoByte | 1.097 |  1.094 |  0.989 |     0.78 |
| splitJoin     | 1.090 |  1.114 |  0.983 |     0.88 |
| slice         | 0.242 |  0.232 |  0.958 |     1.72 |
| sliceTwoByte  | 0.208 |  0.205 |  0.964 |     2.69 |
| numberString  | 1.081 |  1.068 |  1.014 |     2.48 |
| template      | 1.055 |  1.041 |  0.960 |     1.00 |
| codeUnits     | 1.039 |  1.000 |  0.970 |     1.41 |

s8b against s8 was within ±1.6% on the other kernels.

## Reading

- **Equality** no longer pays for slices (0.974 in run 1).
- **Code placement moves several kernels by 3–9%.** In s6, the concat
  helper's one-byte copy loop happened to start on a 64-byte boundary; in
  s8 it straddles one, as a two-byte loop did in s6. s8 changes the
  index-of helper only by its two flat tests, and its loops are
  byte-identical, yet `searchTwoByte` moved by 7%. s8b removes that
  dependence for the string helpers' loops and gains 3–4% on `concat`,
  `slice`, `template` and `codeUnits`. It is kept. The committed form pads
  only the string helpers, which hold the aligned loops; the other
  helpers' placement is unchanged.
- **Still slower than s6:** `searchTwoByte`, `splitJoin`, `numberString`,
  `concat` and `concatTwoByte`. They are not explained by their helpers'
  instructions. They need profiles of both images, which come next.
- **`numberString`** slices its digits several times per conversion
  (`decimal-format.ts`, `number-text/index.ts`), all below 13 units. s7
  ran the whole slice decision before every such copy; s8 tests the length
  first and skips the kind scan for one-byte sources. The remaining 4–7%
  is in the same group as above.
