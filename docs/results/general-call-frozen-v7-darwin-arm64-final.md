# Frozen v7 self-compile on Darwin arm64

All six inferiors stopped at entry under LLDB, ran the same frozen
v7 source and exited with status 0. Every output was 48,843,002 bytes with
SHA-256 `68c11052966f4a851b875c23b6a3413abc74262cec1460532dba09c624d17846`.
The samples span three adjacent pairs under the shared timing lock. Wall time
runs from the compiler's `sources` marker through entry into libc `exit`.
[Raw pair measurements and image digests](general-call-frozen-v7-darwin-arm64-final.json)

| Round | Order           | Baseline wall (s) | Candidate wall (s) | Baseline peak RSS (B) | Candidate peak RSS (B) |
| ----- | --------------- | ----------------: | -----------------: | --------------------: | ---------------------: |
| 1     | baseline first  |           139.285 |            111.804 |         2,230,403,072 |          2,230,960,128 |
| 2     | candidate first |           125.157 |            107.480 |         2,230,894,592 |          2,230,910,976 |
| 3     | baseline first  |           104.030 |            104.686 |         2,229,731,328 |          2,229,993,472 |

The paired median change was **−17.677 s** for wall time and **+262,144 B**
for peak RSS. Both images have byte-identical `__text`, `__data`,
`__eh_frame` and `__unwind_info` sections. The differences in full-file
hashes are in image identity, debug metadata and link-edit data. The earlier
scope-only image also matches those executable sections byte-for-byte.
The reported wall-time and RSS changes are variation across executions of the
same generated program. The scope-only observations remain in their original
report. [Scope-only comparison](general-call-frozen-v7-darwin-arm64-static-scopes.json)
