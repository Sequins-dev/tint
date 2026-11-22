# Frozen v7 paired profiles on Darwin arm64

Two rotated pprofessor pairs of the exact previously reported frozen v7
images did not reproduce the +25.604 s wall-time difference. The old
shared-tag candidate retired about 9.8 billion fewer instructions in each
pair. The scoped fix restores the baseline's executable sections for this
workload. The earlier timing difference has no reproducible hot function
in these profiles.
[Earlier timing and generated-code isolation](general-call-frozen-v7-code-isolation-darwin-arm64.md)

| Order               | Baseline wall s | Old candidate wall s | Paired wall Δ s | Paired cycles Δ | Paired instructions Δ |
| ------------------- | --------------: | -------------------: | --------------: | --------------: | --------------------: |
| Baseline, candidate |         138.210 |              107.051 |         −31.159 | −15,847,031,763 |        −9,758,863,180 |
| Candidate, baseline |          70.241 |               69.544 |          −0.697 |    −672,868,739 |        −9,914,825,079 |

Main-thread sampling ran at 499 Hz after the inferior printed its first
workload marker. LLDB verified entry and exit 0 in all four runs. Each run
compiled the same 760-file snapshot to the same output SHA-256
`68c11052966f4a851b875c23b6a3413abc74262cec1460532dba09c624d17846`.
The median paired peak RSS difference was −376,832 bytes.

The first pair's flat sampled weight fell from 87.686 to 71.448 seconds.
The largest relative change was in type relation checking. `relates`
occupied 8.330% of baseline samples and 3.696% of candidate samples. In the
reversed pair it occupied 3.257% and 3.474%, with total weights of 47.427
and 47.066 seconds. The generated sparse-list read and the LICM loop walk
also changed share in the first pair. Their absolute sampled times in
the reversed pair fell slightly. These flat profiles give no evidence
of recurring call dispatch or property-cache overhead in the typed frozen
compiler.

An initial profiler launch attached while LLDB held the inferior at entry.
The candidate stalled in dyld before its first workload marker and the
watchdog stopped that launch. Its retired counter did not change during
the stall. The two completed pairs above attach after the workload starts.

[Exact process counters, output hashes and grouped flat samples](general-call-frozen-v7-paired-profile-darwin-arm64.json)
