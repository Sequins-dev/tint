# Event loop native checkpoints

## Detached worker lifecycle

The [worker fixture](../../tools/build-worker-exit-fixture.ts) uses the POSIX
thread host and the typed path with `TINT_GENERAL_FALLBACK=0` and
`TINT_BUILD_ONLY=1`. It starts three native worker contexts from one image
and exercises a normal result, an uncaught worker error, and a stop request
after the third worker has entered an indefinite reactor poll. The owner
observes status 7 for the first worker and error followed by status 1 for the
second. The third reports status 1 through the exit pipe. The fixture also
checks `ref` and `unref`, repeated stop requests and a stop after exit.

All three LLDB inferiors stopped at entry and exited 42 with `TZ=UTC`.
The build manifest source snapshot is `a7b67b1311fbebc150c42b6c9f2624367b625a1a56506feb2beb4aaa49bfbcd0`
(807 files). All targets used fixture source
`3145b5fb54a392b391efa00f02f3f536c6df97a3badd7fe0a2f756588a3cd2ee`.

| Host | Collector | Image SHA-256 |
| --- | --- | --- |
| macOS arm64 | Copying | `465915226fa40f7fe3594a6a2f2e30089e635952f87bc648a6724d08a6fb7ab4` |
| Linux arm64 `dev` VM | Copying | `6b7112ab09240a0e1ca00020ccced3b2665c96bfb32f3f432f2c0e36b95f9b2e` |
| Linux x86-64 Debian VM | Generational | `8a12ff2a51a7da742357b747d0ab40e9e59672166dfd46b07cdad85f8857d786` |

The loop and reactor tests passed 11/11. The focused `complete native compiler
pipeline passes checking after specialization` test passed. Stop coverage in
this fixture is limited to the reactor and turn boundaries. Allocation and call
safepoints and blocking `Atomics.wait` are outside the fixture's coverage.

## Frozen v7 comparison on macOS arm64

The baseline `f3540ae62` and branch checkpoint `cfe36c5a0` each built v7 with
`--runtime-tree --tree packages/abi/src/host.ts`. The branch compiler image is
77,206,898 bytes with SHA-256
`4b5e8a1cb1e08f737b91047d43714aecd509e17bd61bd343c08cecd35db0a1ea`.
The [baseline report](event-loop-baseline-f3540ae62-v1.md) records the base
compiler image and the fixed 760-file workload. Both compilers read that exact
workload. The comparison alternated baseline and branch three times on the
same Apple M5 Max. Each launch held `tint-timing.lock` and asserted the LLDB
entry stop, exit breakpoint and final inferior status 0.

| Round | Base seconds | Branch seconds | Base cycles | Branch cycles |
| --- | ---: | ---: | ---: | ---: |
| 1 | 81.35 | 88.74 | 339,516,537,611 | 352,728,478,904 |
| 2 | 97.76 | 95.71 | 363,211,969,053 | 362,393,773,148 |
| 3 | 94.03 | 90.40 | 360,474,865,318 | 353,526,464,187 |

Median wall time was 3.9% lower and median cycles were 1.9% lower in the
branch checkpoint. Per-pair results varied, including higher cycles and wall
time for the branch in the first round. Other native dev work ran on the
machine during the measurements. All six output images matched the base
output byte for byte. The output SHA-256 was
`68c11052966f4a851b875c23b6a3413abc74262cec1460532dba09c624d17846`.
These measurements cover the frozen workload comparison at `cfe36c5a0`.
