# Object compilation with staged IR changes

On November 21, 2026, the packed Object compilation experiment released
linked syntax and scoped the temporary origins used during template
instantiation. Optimizer transactions wrote only changed functions.
The build used Node 24.12.0 on macOS arm64 with a 2,250 MiB old-space
limit and 4 MiB semi-spaces. The input was the same 2,252-variant Object
selection as the previous packed runs.

| Observation                         |   RSS (bytes) | JS heap in use (bytes) |
| ----------------------------------- | ------------: | ---------------------: |
| Before initial reachability pruning | 3,267,002,368 |          1,425,960,000 |
| After selected function cleanup     | 2,887,057,408 |            435,342,808 |
| At packed AArch64 emission entry    | 2,860,875,776 |            393,645,624 |

The emitter exhausted the JavaScript heap before writing the image.
`/usr/bin/time -l` recorded a maximum RSS of 4,050,337,792 bytes,
2,746.75 s wall, 4,750.54 s user plus system CPU, and
12,328.62 billion cycles. The limit for the full process was
3,006,477,107 bytes. The earlier front end and the emitter allocation
failure both need separate measurements. The lower heap observation
after cleanup applies to this combined prototype. This run did not
establish a speed or peak-RSS improvement for any individual change.

The original logs are `object-packed-scopes-2250.log` and
`object-packed-scopes-2250.jsonl` in the experiment directory.

## Native self-compile profile on macOS

The native compiler with the settled SSA and LICM changes built the
frozen 821-file input under LLDB with the timing and native gate locks.
The inferior stopped at entry, exited zero, and wrote a signed image
identical to the frozen control by `cmp`. The image's SHA-256 is
`334b71602e62113f13c967a902a728df52e5445eacbe4eec1886bbf27eda9613`.

This profile took 204.193 s wall and 222.516 s CPU, with 2,052.4 MiB
peak sampled RSS and 571.403 billion cycles. The sample period was
at most 26 ms. It was run on the shared development machine as a
stage profile. The rotated comparison used separate unprofiled runs.

| Pass                   | Reported wall (s) |
| ---------------------- | ----------------: |
| AArch64 emission       |            89.263 |
| Loop-cell promotion    |            10.231 |
| Array access selection |             9.639 |
| List-vector caching    |             9.136 |
| SSA constants          |             8.141 |
| LICM                   |             7.370 |

AArch64 emission accounted for 53.6% of the 166.467 s attributed to
reported passes. The report and resource samples are
`optimizer-combined-profile.bin.pass-stats.json` and
`optimizer-combined-profile.samples`.
