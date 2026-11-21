# Frozen workload v7 with the generality changes

The candidate and baseline emitted SHA-256 `68c11052966f4a851b875c23b6a3413abc74262cec1460532dba09c624d17846` in all 12 runs. Every LLDB inferior reached entry and exited 0.

The comparison used the pinned 760-source workload, matched runtime overlays, and the atomic timing and launch lock wrapper. The baseline was built at `206530edd`. The candidate used the production sources merged in `c35d67e77`. This comparison uses distinct native code. The candidate text section is 33,885,264 bytes and the baseline text section is 33,919,888 bytes.

| Pair | Order               | Baseline s | Candidate s | Paired Δ s | Baseline peak RSS (B) | Candidate peak RSS (B) |
| ---: | :------------------ | ---------: | ----------: | ---------: | --------------------: | ---------------------: |
|    1 | base then candidate |    143.342 |      98.810 |    -44.532 |         2,225,815,552 |          2,230,829,056 |
|    2 | candidate then base |     71.618 |     110.177 |    +38.559 |         2,229,616,640 |          2,230,796,288 |
|    3 | base then candidate |     81.438 |     102.192 |    +20.754 |         2,230,468,608 |          2,230,190,080 |
|    4 | candidate then base |    114.496 |     144.949 |    +30.453 |         2,230,632,448 |          2,230,534,144 |
|    5 | base then candidate |    121.412 |     152.955 |    +31.543 |         2,229,714,944 |          2,230,042,624 |
|    6 | candidate then base |    148.271 |     138.842 |     -9.430 |         2,230,124,544 |          2,230,632,448 |

Paired changes are candidate minus baseline.

| Metric        | Median paired change |         Minimum |         Maximum |
| ------------- | -------------------: | --------------: | --------------: |
| Wall time (s) |              +25.604 |         -44.532 |         +38.559 |
| Peak RSS (B)  |             +417,792 |        -278,528 |      +5,013,504 |
| Cycles        |     +3,674,049,064.5 | -26,713,621,980 | +33,513,568,173 |
| Instructions  |     -9,322,571,216.5 | -10,426,690,774 |  -2,808,444,165 |

Wall time covers the sources marker through the stop at libc exit. RSS is the maximum sampled resident size. Cycles and instructions are the final sampled cumulative process counters. The two batches reverse order to expose order effects.
[Raw frozen workload measurements](general-call-generality-frozen-v7-darwin-arm64.json)
