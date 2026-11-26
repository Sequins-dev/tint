# Native register-home sidecar with per-function release

On November 21, 2026, the Linux arm64 `dev` VM compiled the frozen
821-file compiler with a native register-home sidecar. The coordinator
released each precomputed plan and its slot-sharing groups after emitting
the owning function. It still discovered and packed every request before
launching the sidecar. Workers consumed 31 file-backed batches through
the typed `node:worker_threads` API.

The instrumented compiler consumed all 5,910 worker plans in each pool
run. The controls computed the same number in the coordinator. All six
output images matched by `cmp`. Each was 49,771,592 bytes, with SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.
The fixture accepted the packed vocabulary and batch counts of this frozen
input.

| Run order | Workers | Wall (s) | CPU (s) | Peak sampled RSS (KiB) | AArch64 emission (s) |
| --------: | ------: | -------: | ------: | ---------------------: | -------------------: |
|         1 |  Serial |  320.474 |  312.51 |              2,096,480 |              148.557 |
|         2 |       6 |  296.282 |  306.36 |              6,358,284 |              144.616 |
|         3 |       6 |  259.350 |  267.78 |              6,361,676 |              113.725 |
|         4 |  Serial |  251.597 |  189.28 |              2,094,872 |              124.960 |
|         5 |       1 |  325.840 |  234.11 |              3,387,192 |              197.961 |
|         6 |       2 |  361.127 |  294.04 |              4,972,520 |              172.803 |

CPU sums the compiler and sidecar process times. RSS is their maximum
contemporaneous sum sampled every 25 ms. Hardware cycles were
unavailable in the VM. The six-worker compiler packed requests for
17.41–24.50 s, then spent 27.11–36.80 s waiting and 0.18–0.24 s decoding
results. The two-worker compiler waited 61.72 s.

Six workers saved 24.19 s in the control-first comparison and took
7.75 s longer in the opposite order. Emission itself was faster with six
workers in both orders. Whole-build wall time varied substantially on
this shared host. The inconsistent end-to-end result and threefold
peak RSS kept the sidecar experimental.

An early overlap attempt launched the sidecar as soon as the first
batch appeared. Its workers retried an unopened future batch. The
native sidecar trapped, and the coordinator rejected the run. Neither
released an image from that attempt.

## Choosing which functions to send to workers

An independent Node replay timed the same 5,910 requests individually.
Two functions, IDs 1,524 and 5,648, accounted for 53.3% of the 13.86 s
total measured inside the calls. A threshold of 524,288 for slot count
times instruction-and-block count selected 234 functions accounting for
87.5% of that time. This measures workload concentration on Node. It
suggests a way to avoid expensive request preparation for thousands of
short functions. The same register-home analysis would run inline for
every function the pool did not take.

Raw evidence is in `register-home-release-control-{a,b}`,
`register-home-release-pool-barrier-{a,b}`,
`register-home-release-pool-width{1,2}`,
`register-home-release-pool-a` and
`register-home-admission-profile-r2.log`.
