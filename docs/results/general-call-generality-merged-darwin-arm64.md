# Generality on the merged Darwin arm64 build

Node 26.13.1 was faster on all 15 generality kernels. All paired IQRs
were above zero. Tint took **3.4× to 54.4×** as long by the ratio of
medians in this run.

The exact merged head was `c35d67e77ec168427c0e2dfca88bfb7706ef021e`.
Sixteen rotated pairs ran under the shared timing and launch lock wrapper.
Each fresh process verified warmup and measured checksums at 20,000 and
100,000 iterations respectively. The timings cover the kernel body.
The separate LLDB instruction pass used the same debug image
(`7616d96973868eab1a11058e6b0e97a89943730471cbec7de893e42465a1be00`).
It stepped 32 windows and verified exit 42. Each window began at the loop
comparison and ended at the next visit to that PC at the same stack pointer.
The raw rows show every executed call and managed bump allocation by site.
Each allocation row gives the size per allocation and its execution count.

| Kernel               | Node ns | Tint ns |  Paired Δ IQR ns | Retired instructions | Allocations |  Bytes |
| -------------------- | ------: | ------: | ---------------: | -------------------: | ----------: | -----: |
| `allocateObjects`    |    9.66 |  525.33 | 366.62 to 583.47 |                 9365 |          18 |   1368 |
| `arguments3`         |    3.15 |  101.50 |  73.56 to 115.98 |                 1759 |           0 |      0 |
| `arguments4`         |    3.15 |  113.85 |  81.46 to 123.80 |                 1865 |           0 |      0 |
| `arguments5`         |    3.35 |  124.30 |  89.17 to 140.94 |                 1971 |           0 |      0 |
| `arguments6`         |    3.82 |  135.50 |  98.72 to 149.86 |                 2077 |           0 |      0 |
| `buildString`        |   12.81 |   43.96 |   20.82 to 31.54 |             503–4260 |        1–12 | 64–384 |
| `catchInLoop`        |    4.51 |   68.61 |   45.48 to 72.32 |            1304–1859 |           0 |      0 |
| `concatenateStrings` |   10.32 |   36.60 |   20.29 to 27.90 |              643–669 |           1 |     32 |
| `mixedCall`          |    4.68 |  111.52 |  72.14 to 112.17 |            1626–2876 |           0 |      0 |
| `mutableCapture`     |    8.55 |   65.74 |   39.54 to 61.95 |            1234–1235 |           0 |      0 |
| `objectArray`        |    3.18 |   82.16 |   55.11 to 85.75 |                 1509 |           0 |      0 |
| `objectRoundTrip`    |    2.95 |  119.13 |  81.90 to 131.81 |                 2479 |           0 |      0 |
| `receivers2`         |    7.78 |  161.32 | 109.40 to 172.05 |            3193–3251 |           2 |     56 |
| `receivers4`         |    7.06 |  177.65 | 118.62 to 186.30 |            3137–3251 |           2 |     56 |
| `receivers8`         |    8.63 |  176.64 | 122.06 to 197.38 |            3130–3242 |           2 |     56 |

- The six-argument window executes 15 calls with no list or result record.
  It still retires 246 instructions in the wide dispatch helper, 165 in the
  source wrapper, and 192 in the method lookup cache. The callee and loop
  retire another 962 instructions while moving and checking general values.
- The receiver-shape workloads still miss their monomorphic method cache.
  In the first eight-shape lane the two property lookups retire 677
  instructions in the cache helper. The iteration allocates two shape
  chain lists totaling 56 B. The packed numeric array read skips key
  formatting, and the positional method call hits its guard.
- Object allocation retains a 600 B ordinary object and separate property,
  descriptor, and layout storage. The two-field construction and subsequent
  reads used 18 allocations and 9,365 instructions. The corresponding
  baseline was 30 allocations and 13,646 instructions. The existing-object
  round trip uses zero allocations and still pays for calls, property
  checks, and the managed stores.
- A concatenation now needs one 32 B string allocation. A string builder's
  append-only iteration takes one native copy call. The flush iteration
  falls through the intrinsic method path for `charAt` and accounts for
  the higher instruction and allocation count.
- The ordinary and throwing catch-loop lanes now allocate nothing. Their
  difference is 555 instructions. The call wrapper, named execution
  frame, and abrupt-result test account for work in this path.
- The mixed site uses positional dispatch for each value tag. Source
  `typeof`, string property handling, and residual dynamic checks still
  differentiate the three lanes. The captured string mutation is also
  allocation-free. The object array still executes two shape-cache hits
  per element, with 384 instructions in the cache helper alone.

[Exact paired rounds](general-call-generality-merged-darwin-arm64.json),
[32 native traces](general-call-generality-merged-traces-darwin-arm64.jsonl),
[baseline trace and timings](general-call-generality-baseline-darwin-arm64.md).
