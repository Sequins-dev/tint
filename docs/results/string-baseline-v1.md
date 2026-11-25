# String performance against Node: baseline (v1)

Recorded 2026-11-23 for the one-byte strings stream (PR #18,
[design](../design-one-byte-strings.md)). This baseline measures main's
compiler and runtime: every string is UTF-16, and Tint is compared with Node
26.13.1 on the same text.

## Setup

- **Benchmark:** [`tools/string-bench/`](../../tools/string-bench/) on
  `perf/one-byte-strings`.
  - The macOS typed and general runs used `c064ffe2c`.
  - The macOS clone rerun and both Linux runs used `896de1f2a`.
  - The packages are main's (`183ec7044`) in every run; recorded patch hash:
    empty.
- **Hosts:**
  - macOS: Apple M5 Max (18 cores), macOS 26.6.2, Node 26.13.1
    (`/opt/homebrew/bin/node`).
  - Linux: the shared `dev` machine (Debian 12, kernel 6.1, 9 CPUs, arm64) on
    the same host, with the official Node 26.13.1 linux-arm64 build. Images
    were built inside `dev`.
- **Images** (debug symbols off):

  | Platform | typed               | general             | clone               |
  | -------- | ------------------- | ------------------- | ------------------- |
  | macOS    | `386e1fc316c39ae1…` | `69ba4d0120a92f8d…` | `580c30747b16d14b…` |
  | Linux    | `ac9e6c416b0f7cfe…` | `a0079ec8ad58886d…` | —                   |

  On Linux the typed image already contains the corrected clone kernels.

- **Protocol:** `bench.ts measure`, 15 rounds per image, `TZ=UTC`.
  - macOS took `tools/gate/with-lock.sh both`; Linux took no macOS lock.
  - Each round runs Node and Tint once. Round r starts at engine r mod 2, and
    odd rounds run in reverse.
  - Every native run went under LLDB and reported the stop at entry and exit 42. Node exited 0 every time.
  - A run executes each kernel once cold and five times warm. The steady value
    is the median of the warm iterations. Cells are medians across rounds
    with the interquartile range. Ratios are paired within each round.
- **One-minute load at round starts:**
  - macOS: typed 4.1–10.9, general 2.9–4.4, clone 6.1–8.7.
  - Linux: typed 0.3–1.3, general 0.8–0.9.

Raw rounds: macOS [typed](string-baseline-v1-typed-darwin.json),
[general](string-baseline-v1-general-darwin.json) and
[clone](string-baseline-v1-clone-darwin.json); Linux
[typed](string-baseline-v1-typed-linux.json) and
[general](string-baseline-v1-general-linux.json).

### Kernels

**`typed`** is compiled with `TINT_GENERAL_FALLBACK=0` and `requireTyped`.
Kernels named `…TwoByte` repeat a kernel over text that contains units above
0xFF.

| Kernel                   | Work                                                                       |
| ------------------------ | -------------------------------------------------------------------------- |
| `create`                 | `String.fromCharCode` of three units and `"v" + String(i)`                 |
| `concat`                 | `+=` of 64 words (about 400 units), plus a three-part concatenation        |
| `equality`               | Fresh split words against literals and against each other                  |
| `search`                 | `indexOf`, `lastIndexOf`, `includes` and `startsWith` over 2.2 KiB of text |
| `codeUnits`              | A `charCodeAt` hash loop over 1.9 KiB                                      |
| `splitJoin`              | `split(",")` and `join(";")` of a 64-field line                            |
| `slice`                  | `slice` (8–39 units) and `substring` (the rest) of 1.9 KiB                 |
| `numberString`           | `String(integer)`, `String(x / 8)` and `Number` of both                    |
| `template`               | A five-part template literal                                               |
| `mapKeys`                | `Map<string, number>` with 512 keys, looked up with fresh keys             |
| `utf8`                   | UTF-8 encode and decode of 1.5 KiB                                         |
| `clone1KiB`, `clone1MiB` | A string's structured-clone round trip                                     |

The codec kernels compare each engine's own implementation:

- **UTF-8:** Node uses `TextEncoder` and `TextDecoder`. Tint has no such
  globals on main, so it calls their runtime core, foundation's `encodeUTF8`
  and `decodeUTF8`.
- **Clone:** Node uses `v8.serialize` and `v8.deserialize`, the serializer
  that Worker messages use. Tint uses its Worker serializer,
  `serializeWorkerValue` and `deserializeWorkerValue`.

**`general`** runs `toUpperCase` on 450 units and `JSON.stringify`/`parse` of
32 records. Neither lowers in typed code yet, so this image measures the
general runtime.

## Results: typed suite

Steady milliseconds per iteration and the paired Tint/Node ratio.

| Kernel           | macOS Node | macOS Tint | macOS Tint/Node      | Linux Node | Linux Tint | Linux Tint/Node      |
| ---------------- | ---------- | ---------- | -------------------- | ---------- | ---------- | -------------------- |
| create           | 9.9        | 19.5       | **2.06** (1.92–2.21) | 9.5        | 19.6       | **2.10** (1.95–2.21) |
| concat           | 15.9       | 41.7       | **2.73** (2.58–2.97) | 14.7       | 40.3       | **2.86** (2.66–2.92) |
| concatTwoByte    | 15.5       | 41.8       | **2.76** (2.68–2.99) | 14.6       | 42.0       | **2.79** (2.65–2.91) |
| equality         | 9.5        | 25.0       | **2.66** (2.63–2.81) | 9.0        | 25.4       | **2.73** (2.58–2.89) |
| search           | 17.0       | 60.0       | **3.85** (3.60–4.03) | 13.6       | 57.7       | **4.32** (4.00–4.42) |
| searchTwoByte    | 16.3       | 57.7       | **3.73** (3.64–3.83) | 12.1       | 52.0       | **4.36** (4.16–4.50) |
| codeUnits        | 11.1       | 43.5       | **3.96** (3.64–4.26) | 10.8       | 42.4       | **4.02** (3.63–4.42) |
| codeUnitsTwoByte | 10.3       | 40.9       | **4.01** (3.81–4.20) | 9.6        | 39.0       | **4.03** (3.62–4.15) |
| splitJoin        | 19.3       | 23.9       | **1.30** (1.24–1.32) | 19.1       | 23.4       | **1.19** (1.04–1.24) |
| slice            | 2.8        | 50.7       | **19.6** (18.2–20.2) | 2.8        | 51.8       | **18.5** (16.6–18.9) |
| sliceTwoByte     | 2.7        | 47.8       | **18.0** (17.4–19.1) | 2.8        | 49.1       | **17.2** (16.6–18.3) |
| numberString     | 0.8        | 239.3      | **328** (309–346)    | 0.9        | 238.5      | **267** (248–279)    |
| template         | 17.8       | 26.6       | **1.54** (1.50–1.58) | 21.7       | 27.1       | **1.24** (1.16–1.31) |
| mapKeys          | 14.8       | 22.0       | **1.48** (1.45–1.58) | 15.5       | 22.4       | **1.44** (1.37–1.48) |
| utf8             | 1.2        | 145.2      | **120** (115–122)    | 2.7        | 143.4      | **55.6** (50.7–59.7) |
| utf8TwoByte      | 5.2        | 148.8      | **29.5** (27.5–30.6) | 6.4        | 150.5      | **24.9** (22.3–26.0) |
| clone1KiB        | 13.6       | 34.4       | **2.64** (2.38–2.67) | 21.2       | 33.2       | **1.61** (1.40–1.75) |
| clone1MiB        | 2.6        | 10.8       | **3.97** (3.16–4.26) | 5.1        | 12.8       | **2.32** (2.11–3.37) |

The macOS clone rows come from the [clone rerun](string-baseline-v1-clone-darwin.json).

The clone rows in the first macOS typed report are invalid, for two
reasons. Their kernels grew the 1 MiB text with `+=`, which is quadratic in
Tint, so they measured that setup. And they called Node's `structuredClone`,
which returns a primitive string without copying it (about 4 ns).
`b974370d8` and `896de1f2a` fixed the kernels before the rerun and the Linux
runs.

## Results: general suite

| Kernel    | macOS Node | macOS Tint | macOS Tint/Node      | Linux Node | Linux Tint | Linux Tint/Node      |
| --------- | ---------- | ---------- | -------------------- | ---------- | ---------- | -------------------- |
| upperCase | 0.2        | 281.9      | **1562** (1429–1592) | 0.3        | 356.3      | **1097** (1047–1289) |
| json      | 8.4        | 216.1      | **25.6** (25.3–26.2) | 10.1       | 296.4      | **26.6** (25.7–29.7) |

## Self-compile (frozen v7, macOS)

The `native-base` image was built in this worktree with
`frozen-workload.ts build v7 base --runtime-tree`, from main's packages
(77,206,898 bytes). It ran once under LLDB, which reported the stop at entry
and exit status 0.

Five paired rounds followed, in alternating order, each under
`tools/gate/with-lock.sh both`:

- **Native:** `frozen-workload.ts run v7 base`, timed with `/usr/bin/time -l`.
- **Node:** Node 26.13.1 running the frozen toolchain (`frozen-workload.ts
node v7`).

The LLDB, native and Node outputs are byte-identical
(`68c11052966f…d17846`). [Log](string-baseline-v1-selfcompile-darwin.log).
Its output-hash lines are empty because the outputs are files, not
directories; the hashes above were taken afterwards.

| Round | Native wall | Native cycles | Node wall | Node cycles | Native/Node wall |
| ----: | ----------: | ------------: | --------: | ----------: | ---------------: |
|     1 |     69.16 s |       326.6 G |   73.44 s |     440.3 G |             0.94 |
|     2 |     70.57 s |       328.8 G |   77.55 s |     445.0 G |             0.91 |
|     3 |     71.06 s |       330.6 G |   81.05 s |     448.0 G |             0.88 |
|     4 |     70.80 s |       328.6 G |   76.74 s |     443.2 G |             0.92 |
|     5 |     69.53 s |       326.4 G |   72.10 s |     433.4 G |             0.96 |

- **Wall time:** median 70.57 s native and 76.74 s Node. The median paired
  ratio is 0.92.
- **Peak RSS:** 2.226–2.228 GB native and 3.86–3.94 GB Node.
- **Load:** one-minute load was 3.9–6.1.

## Findings

1. **The self-compile is not string-bound.** A frozen v3 census
   ([heap findings](native-heap-findings-v3-obs.md)) puts string bytes at
   about 2% of the live heap and 4% of allocation volume. One-byte storage
   can lower peak RSS by about 1% at most.
2. **The representation alone closes none of the large gaps.** Each needs its
   own work:
   - `numberString` (270–330×): fractional `numberToString` builds the exact
     decimal expansion and round-trips candidates through `stringToNumber`.
   - `utf8` (25–120×): `decodeUTF8` appends `String.fromCodePoint` once per
     code point.
   - `slice` (17–20×): every substring is a copy, where V8 shares the
     parent's characters.
   - `upperCase` (1100–1600×) and `json` (26×): per-character work in the
     general runtime.
3. **One-byte storage halves the bytes behind the 2–4× gaps.** Those kernels
   are `charCodeAt`, `equality`, `search`, `concat` and `create`. Closing the
   gaps also needs:
   - inline kind dispatch on `charCodeAt` with integer indices;
   - a single `indexOf` primitive (today it loops `string-starts-with` per
     position);
   - word-at-a-time compares and copies;
   - builders or ropes for `+=`.
4. **Linux and macOS agree within the noise** on every typed kernel except
   `utf8`, `clone` and `template`. On those, Node's own time differs between
   the two hosts.
