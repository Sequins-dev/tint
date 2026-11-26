# Scheduling a single array-access plan

The two largest array-access analysis jobs are the closure and direct
entries of the same source function. Each has 22,048 blocks and about
36,000 slots. Both versions changed in loop-invariant motion, so dispatching
their earlier bodies would use stale facts. They differ in 1,186
terminators and more than 3,800 instruction positions. The experiment
kept the earlier body inline and sent the later body after LICM so the
native helper could analyze it while the coordinator walked earlier bodies.

Each worker had a 192 MiB managed heap limit. Its roughly 1.13 MB input
contained one packed body and its operator vocabulary. It returned the
same 1,572-byte plan as the inline planner. The coordinator applied facts
to the original body in serial order, sharing the existing value-ID and
work accounting. A second fixture restricted the typed Worker startup
path to one explicitly declared guest module. The scoped helper returned
the two expected plans at requested widths 1, 2 and 6 on both arm64 hosts.
This replay contains two outstanding jobs.

## Linux arm64

Each full run produced the same 49,771,592-byte ELF, SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.
The two control cells and the two worker cells used the same executable.

| Order | Workers | Wall (s) | CPU (s) | Peak combined RSS (KiB) | Array-access selection (s) | Emission (s) |
| ----: | ------: | -------: | ------: | ----------------------: | -------------------------: | -----------: |
|     1 |  Inline |  145.577 | 172.170 |               2,149,316 |                      6.067 |       65.258 |
|     2 |       1 |  143.910 | 172.819 |               2,167,548 |                      5.957 |       69.504 |
|     3 |       1 |  118.271 | 144.232 |               2,167,856 |                      4.893 |       52.340 |
|     4 |  Inline |  122.030 | 145.178 |               2,148,620 |                      5.383 |       54.933 |

The coordinator waited about 10 ms for each result. The affected pass
saved 0.111 s and 0.490 s. Whole-build wall fell by 1.668 s and 3.760 s.
The other stages varied across the cells, so the complete wall differences
overstate the observed saving in the worker pass. Peak combined RSS rose
by 17.8–18.8 MiB. The VM did not expose hardware counters.

## macOS arm64

The native compiler and worker launched under LLDB and the runner asserted
their entry stops and expected exit statuses. Each complete signed image
matched the 50,163,978-byte reference by `cmp`, SHA-256
`334b71602e62113f13c967a902a728df52e5445eacbe4eec1886bbf27eda9613`.
Reported CPU and cycles sum the last samples of the compiler, worker and
broker. RSS is the maximum sampled concurrent process sum. Each original
rotation cell had its own launch and timing admission.

| Order | Workers | Wall (s) | CPU (s) | Cycles (billions) | Peak combined RSS (KiB) | Array-access selection (s) | Emission (s) |
| ----: | ------: | -------: | ------: | ----------------: | ----------------------: | -------------------------: | -----------: |
|     1 |  Inline |  138.887 | 146.034 |           500.607 |               2,158,432 |                      5.584 |       69.033 |
|     2 |       1 |  124.234 | 124.702 |           485.139 |               2,172,736 |                     10.172 |       42.619 |
|     3 |       1 |  166.759 | 186.711 |           549.686 |               2,174,336 |                     11.539 |       68.777 |
|     4 |  Inline |  155.910 | 174.160 |           544.124 |               2,157,584 |                      7.205 |       72.396 |

The pool saved 14.65 s of wall time in the first pair and added
10.85 s in reverse. Both worker runs spent over four more seconds in
array-access selection. The coordinator waited 6.143 s and 4.730 s
for the sidecar, including its startup under the debugger. Code
emission, which the pool leaves unchanged, moved by 26.41 s and
3.62 s between the paired cells. Peak combined RSS rose 14.0–16.4 MiB.
The one-worker variant with deferred sidecar launch stays experimental.

The Linux coordinator SHA-256 was
`e9adf7143f6fbc3e59058e4ede7f03b90675e59689c6ac59e81587ba179c47d7`
and its worker SHA-256 was
`1e53a603623e14dc385f5140b443c3908ffb7596b021d40852f2212346091527`.
The macOS coordinator SHA-256 was
`414c6de79a126987351c0dc062bbd55a6408867ae34ba56a78ba9434cc5ce84b`
and its worker SHA-256 was
`06608a166af4f946a49b30384b943a4d10083ff256e304f7c9be7222d4200f40`.

Raw logs are `bounds-late-rotation.log`, `bounds-late-darwin-rotation.log`,
`bounds-live-late-*/`, `bounds-late-darwin-*/`,
`bounds-worker-scoped-{linux,darwin}-check.log` and
`bounds-unchanged-r2.log`.
