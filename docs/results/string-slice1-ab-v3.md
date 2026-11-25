# One-byte strings, slice 1 complete: A/B against main (v3)

Recorded 2026-11-23 on macOS arm64, with the same protocol and base images
as [v1](string-slice1-ab-v1.md) and [v2](string-slice1-ab-v2.md).

## Builds

| Label | Code                                                                        | Images                                                                                         |
| ----- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| ob3   | `400488f41`                                                                 | Frozen v7 only (`native-ob3`, 76,777,906 bytes)                                                |
| ob5   | `aefe7ff27` (prepared at `d430e1a6d` plus that patch, hash `06cb93d26703…`) | typed `4576f24d410960bb…`, general `08451959f2a164c7…`, frozen `native-ob5` (76,612,786 bytes) |

ob3 adds to v2's ob2:

- loop-free copies of 2–16 bytes;
- `String(n)` built with one `String.fromCharCode` per four digits.

ob5 then adds:

- the `charCodeAt` in-bounds proof through stored and copied lengths
  (`e637608ab`);
- kind and length checked with one 32-bit pair load (`aefe7ff27`).

The ob3 typed and general runs completed but wrote no report: their output
names collided with v2's files, which the harness refuses to overwrite. Only
ob3's frozen run is recorded.

One-minute load at round starts was 2.1–4.4 (typed) and 1.8–3.4 (general).
Raw rounds: [typed](string-slice1-ab-v3-typed.json),
[general](string-slice1-ab-v3-general.json), [frozen ob5](string-slice1-ab-v3-frozen.log)
and [frozen ob3](string-slice1-ab-v3-frozen-ob3.log).

## Kernels (ob5)

Steady milliseconds; paired ratios as medians with interquartile ranges.

| Kernel              | Node |  base |   ob5 | ob5/base         | ob5/Node |
| ------------------- | ---: | ----: | ----: | ---------------- | -------: |
| create              |  8.3 |  18.1 |  16.9 | 0.93 (0.91–0.94) |     2.07 |
| concat              | 13.1 |  38.3 |  17.9 | 0.47 (0.46–0.47) |     1.37 |
| concatTwoByte       | 13.0 |  38.1 |  27.0 | 0.71 (0.69–0.72) |     2.08 |
| equality            |  8.0 |  23.1 |  22.6 | 0.97 (0.97–0.99) |     2.79 |
| search              | 14.4 |  53.7 |  11.6 | 0.22 (0.21–0.22) | **0.81** |
| searchTwoByte       | 14.1 |  50.9 |  10.3 | 0.20 (0.19–0.21) | **0.73** |
| codeUnits           | 10.3 |  41.6 |  13.9 | 0.33 (0.33–0.33) |     1.35 |
| codeUnitsTwoByte    |  9.2 |  38.4 |  12.8 | 0.33 (0.33–0.33) |     1.40 |
| splitJoin           | 17.4 |  22.7 |  15.5 | 0.68 (0.67–0.69) | **0.89** |
| slice               |  2.4 |  48.5 |  19.4 | 0.40 (0.40–0.40) |     7.91 |
| sliceTwoByte        |  2.4 |  45.9 |  32.4 | 0.71 (0.69–0.71) |    13.22 |
| numberString        |  0.7 | 221.5 | 222.2 | 1.00 (1.00–1.00) |   314.71 |
| template            | 16.0 |  24.3 |  20.0 | 0.82 (0.80–0.83) |     1.25 |
| mapKeys             | 13.1 |  20.4 |  20.0 | 0.98 (0.95–0.98) |     1.52 |
| utf8                |  1.1 | 130.9 | 131.2 | 1.00 (0.99–1.00) |   122.15 |
| utf8TwoByte         |  4.6 | 135.4 | 137.9 | 1.02 (1.01–1.02) |    30.79 |
| clone1KiB           | 10.7 |  30.0 |  27.8 | 0.93 (0.92–0.93) |     2.59 |
| clone1MiB           |  2.5 |   9.3 |   4.0 | 0.44 (0.43–0.45) |     1.60 |
| upperCase (general) |  0.2 | 280.6 | 285.5 | 1.02 (1.01–1.03) |  1573.32 |
| json (general)      |  8.2 | 214.0 | 214.3 | 1.00 (0.99–1.01) |    26.05 |

## Frozen v7 self-compile

Each run was `run v7 base <label> --rounds 5`, interleaved. Cells are
medians. Both outputs are byte-identical to the reference
(`68c11052966f…d17846`).

| Run | base cycles | candidate cycles | Paired cycles | base wall | candidate wall | Paired wall | Instructions | Peak RSS |
| --- | ----------: | ---------------: | ------------- | --------: | -------------: | ----------- | ------------ | -------- |
| ob3 |     313.5 G |          317.2 G | +1.4%         |   64.88 s |        65.73 s | +1.4%       | +2.0%        | −1.7 MB  |
| ob5 |     315.8 G |          316.0 G | **+0.05%**    |   65.32 s |        65.46 s | **+0.2%**   | +1.0%        | −2.1 MB  |

## Reading

- **Slice 1 is complete.** The frozen self-compile is no slower in cycles
  or wall time. Every typed kernel is as fast as main or faster, except
  `utf8TwoByte` and general `upperCase`, which are each about 2% slower.
- **Three kernels now beat Node:** `search`, `searchTwoByte` and
  `splitJoin`.
- **Remaining gaps to Node:**
  - `slice`: 8–13×, which needs sliced strings;
  - `numberString`: about 315×, which needs a shortest formatter;
  - `utf8`: 31–122×, which needs ASCII and Latin-1 fast paths;
  - `equality`: 2.8×, mostly general typed codegen (list reads and double
    accumulators);
  - concatenation and `create`: 1.4–2.1×;
  - general `upperCase` and JSON.
- **Peak RSS** drops only about 2 MB in the self-compile. Strings are about
  2% of its live heap, as the design predicted.
