# Worker runtime, Phase 2 (macOS arm64)

22 November 2026. This report measures the Phase 2 fixes of the
[Worker runtime design](../design-worker-runtime.md) against the
[baseline](worker-runtime-baseline-v1.md), one paired rotation per step:

| Step | Commits | Section |
| --- | --- | --- |
| Isolate operations in the closed world | `ebfb975be` | Kernel placements |
| Typed Worker entries and class-restricted inlining | `a830aaaf7` | Kernel placements |
| Fixed-width structured clone | `c368d3cd9` | Transport steps |
| Linear packet assembly | `370b46529` | Transport steps |
| Contended-only lock wakes, recycled packet blocks, coalesced port signals | `14147da7c`, `34a2fde64`, `8d112612d` | Fewer system calls per message |
| Stop polls at loop headers and calling entries | `72cbd43db` | Remaining poll cost |
| Loop-free runtime helpers inline into Worker code | `1f2302313` | Final placements |

The host, the Node 26.13.1 reference and the protocol match the baseline:

- 15 rotated rounds in one `both`-lock hold;
- `TZ=UTC`;
- LLDB, with the stop at entry and exit 42 asserted for every native run.

Each rotation records its load. Two rotations ran a build with a defect: every
one of their Tint observations failed. They are kept and described below. The
[Linux arm64 report](worker-runtime-linux-v1.md) covers the same steps on
Linux.

## Kernel placements

The first rotation ran images built at `4cd3156e4`. Its load average at round
starts had a median of 16.1 (IQR 15.1–16.9), and no observation failed.

[Raw rounds](worker-runtime-phase2-v1-placements.json)

**Images:**

| Image | SHA-256 |
| --- | --- |
| `plain` | `04845cd33e69bdcb3ed4e170f06abf345d209a9e2ef913479efd3c72d709997f` (byte-identical to the baseline) |
| `main` | `1a421daa36a3c542…` |
| `worker` | `feea6bd11ea91698…` |

The program without Workers is unchanged.

Steady state, in ms per iteration:

| Kernel | Tint plain | Tint main | Tint worker | Node plain | Node main | Node worker |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| allocation | 21.2 (20.2–22.9) | 27.0 (24.5–27.9) | 26.1 (25.4–28.6) | 7.8 (7.5–9.1) | 8.1 (7.5–10.0) | 15.4 (10.3–18.8) |
| numeric | 67.6 (63.4–70.5) | 67.1 (62.8–69.9) | 65.4 (63.9–69.0) | 16.2 (14.9–16.9) | 15.6 (15.0–17.5) | 15.8 (14.9–17.1) |
| calls | 70.6 (67.5–74.6) | 96.9 (90.2–102.2) | 99.9 (95.3–112.1) | 35.3 (32.3–37.5) | 34.0 (32.4–38.8) | 34.4 (32.2–38.9) |
| strings | 42.8 (41.1–45.1) | 45.9 (42.2–47.4) | 43.7 (42.7–46.3) | 21.1 (19.5–22.6) | 21.4 (20.8–23.5) | 20.5 (19.8–23.1) |
| compiler | 62.6 (59.7–66.5) | 68.6 (61.1–71.2) | 66.0 (64.5–70.6) | 16.8 (15.8–18.9) | 15.4 (14.7–16.8) | 15.5 (14.9–17.9) |

Paired ratios against the plain program, with the baseline's ratios for
comparison:

| Kernel | main / plain | baseline | worker / plain | baseline (unpaired) |
| --- | ---: | ---: | ---: | ---: |
| allocation | 1.23× (1.21–1.29) | 3.52× | 1.26× (1.21–1.30) | 227× |
| numeric | 1.02× (0.95–1.05) | 1.11× | 1.02× (0.98–1.06) | 114× |
| calls | 1.34× (1.31–1.42) | 13.46× | 1.47× (1.37–1.51) | 264× |
| strings | 1.05× (1.00–1.10) | 1.98× | 1.03× (1.00–1.12) | 44.9× |
| compiler | 1.05× (0.99–1.10) | 2.37× | 1.06× (1.02–1.16) | 49.3× |

**Inside a Worker:** the same typed kernels ran 44–207 times faster than in
the baseline, and now cost 1.02–1.47× the program without Workers.

**On the main thread:** a Worker program's own code is now within 1.02–1.34×
of the same program without Workers.

**Remaining gaps:** `calls` and `allocation` are still 1.23–1.47× slower. The
shared kernel module belongs to the Worker's graph, so its functions poll for
stop requests at every call and allocation safepoint, on both threads. The
next section tests that attribution.

## Transport steps

A second rotation paired three transport images with Node: 15 rounds, a load
median of 9.8 (IQR 9.4–10.4), and no failed observations. The transport
program is untyped on both sides, so typed Worker entries do not apply to it.

**Images:**

| Image | Built at | Changes |
| --- | --- | --- |
| a | `4cd3156e4` | Generational heaps and closed-world analyses |
| b | `c368d3cd9` | Plus fixed-width structured-clone counts and numbers |
| c | `370b46529` | Plus linear packet assembly |

[Raw rounds](worker-runtime-phase2-v1-transport-steps.json)

In µs per operation:

| Operation | a | b | c | Node | b / a | c / b | c / Node | Baseline Tint / Node |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| startup | 1,966 | 1,915 | 2,117 | 8,547 | 0.97× | 1.11× | 0.25× | 0.48× |
| terminate | 170 | 197 | 180 | 497 | 0.99× | 1.06× | 0.36× | 0.43× |
| startup, 8 Workers (per Worker) | 281 | 283 | 289 | 1,318 | 1.05× | 1.07× | 0.24× | 0.47× |
| round trip | 78.8 | 66.4 | 63.4 | 14.8 | 0.80× | 0.96× | 4.37× | 8.30× |
| clone records ×16 | 874 | 247 | 214 | 34.3 | 0.28× | 0.88× | 6.13× | 40.4× |
| clone records ×1,024 | 57,478 | 11,587 | 8,360 | 1,005 | 0.20× | 0.75× | 8.83× | 93.4× |
| clone numbers ×1,024 | 12,144 | 2,049 | 1,552 | 105 | 0.17× | 0.77× | 15.8× | 192× |
| clone numbers ×65,536 | 876,436 | 159,974 | 148,149 | 5,510 | 0.19× | 0.90× | 27.1× | 239× |
| clone string 1 KiB | 180 | 154 | 128 | 15.4 | 0.83× | 0.86× | 9.06× | 24.7× |
| clone string 1 MiB | 86,466 | 86,489 | 62,665 | 250 | 1.05× | 0.73× | 253× | 918× |
| clone tree depth 4 | 972 | 373 | 345 | 48.4 | 0.42× | 0.86× | 6.94× | 32.9× |
| clone tree depth 10 | 62,778 | 25,926 | 18,881 | 1,912 | 0.42× | 0.71× | 9.28× | 55.5× |
| transfer 64 KiB | 118 | 99.7 | 104 | 16.0 | 0.86× | 1.04× | 7.19× | 9.43× |
| transfer 8 MiB | 117 | 95.4 | 98.0 | 13.1 | 0.78× | 0.98× | 7.55× | 10.5× |
| batch (per message) | 22.4 | 16.7 | 17.3 | 0.71 | 0.78× | 0.99× | 23.8× | 35.9× |
| port round trip | 63.3 | 56.8 | 56.5 | 10.3 | 0.90× | 0.95× | 5.60× | 7.66× |
| wait/notify | 19.8 | 23.6 | 23.8 | 8.85 | 1.01× | 1.05× | 2.59× | 2.58× |
| waitAsync | 22.0 | 22.2 | 26.2 | 12.6 | 1.01× | 0.99× | 2.00× | 1.87× |
| counter, 1 Worker (per add) | 1.19 | 1.18 | 1.10 | 0.010 | 1.02× | 0.99× | 114× | 171× |
| counter, 4 Workers (per add) | 0.44 | 0.46 | 0.43 | 0.017 | 1.00× | 0.98× | 26.6× | 40.6× |

Cells are medians; the step ratios are paired, and their IQRs are in the raw
summary.

- **The fixed-width format** cut record, number and tree clones by 58–83%,
  round trips and batches by about 20%, and transfers by 14–22%. Transfer
  envelopes carry counts too.
- **Linear assembly** cut the 1 MiB string by 27% and the large record and tree
  clones by another 25–29%.
- **Not changed by these steps:** startup, wait/notify, waitAsync and the
  counters. The lifecycle cells against image a reflect the generational heap
  and closed world that a already includes.

A typed transport variant measured the runtime path without the untyped await
machinery: round trips about 60–80 µs, batches about 20–40 µs per message, and
1 KiB strings about 165 µs. Its system time matched its user time. That points
at the per-message system calls the next step removes:

- a fresh mapping and unmapping per packet;
- a wake on every lock release;
- a pipe write per message.

## Fewer system calls per message

These changes landed in `14147da7c`, `34a2fde64` and `8d112612d`:

- the registry locks wake only when contended;
- port mailboxes recycle up to 32 consumed 16 KiB packet blocks;
- port signals are coalesced;
- a recycled block's queue link is cleared before reuse.

A paired rotation compared image c above (`370b46529`) with image b, built at
`8d112612d`, against Node. A typed transport pair, built before the lock
change and at `8d112612d`, ran in its own rotation. Each ran 15 rounds with a
load median of 7.6 and no failed observations.
[Transport](worker-runtime-phase2-v1-transport-pair.json),
[typed transport](worker-runtime-phase2-v1-typed-transport-pair.json)

| Operation | Before (µs) | After (µs) | Node (µs) | After / before | After / Node |
| --- | ---: | ---: | ---: | ---: | ---: |
| round trip | 56.7 | 47.6 | 9.32 | 0.80× (0.76–0.86) | 5.21× |
| port round trip | 45.7 | 37.4 | 7.87 | 0.79× (0.72–0.86) | 4.68× |
| transfer 64 KiB | 83.6 | 73.3 | 10.8 | 0.88× (0.85–0.95) | 7.04× |
| transfer 8 MiB | 77.8 | 69.0 | 10.0 | 0.90× (0.82–0.95) | 7.05× |
| wait/notify | 17.0 | 14.1 | 6.40 | 0.74× (0.67–1.14) | 2.29× |
| batch (per message) | 13.3 | 13.6 | 0.67 | 0.98× (0.92–1.15) | 19.8× |
| typed round trip | 56.7 | 32.8 | 9.26 | 0.57× (0.51–0.69) | 3.37× |
| typed batch (per message) | 16.9 | 15.8 | 0.59 | 1.00× (0.88–1.05) | 26.7× |
| typed 1 KiB string | 89.6 | 91.5 | 10.1 | 0.97× (0.89–1.04) | 8.87× |

**Clones, lifecycle and counters did not move.** Their per-operation cost is
elsewhere.

**Batches did not move either.** A burst of 10,000 tiny packets outruns the
32-block recycle bound, so each extra packet still maps and unmaps its own
16 KiB block. Profiles put most of the remaining per-message user time in the
Script-realm layering that typed programs still pass through (design
section 5).

**A defect in the first build.** The first rotation used images built at
`34a2fde64`. A recycled block kept its free-stack link in the header word the
queue uses as `next`. When such a block was the last message in the queue,
the receiver followed the stale link, which corrupted the queue until blocks
were reused and unmapped twice. All 15 Tint observations of both the
transport and typed transport rotations crashed at Worker exit. They are kept
as evidence:
[transport](worker-runtime-phase2-v1-transport-pair-recycle-defect.json),
[typed transport](worker-runtime-phase2-v1-typed-transport-pair-recycle-defect.json).
The fix is `8d112612d`. Its mailbox test reuses several blocks in one burst and
fails without the fix.

## Remaining poll cost

**Experiment.** A diagnostic build made only Worker-exclusive modules
interruptible. The shared kernel module then had no stop polls on either
thread. Its placements rotation ran 15 rounds with a load median of 6.2 and no
failed observations.
[Raw rounds](worker-runtime-phase2-v1-no-poll-experiment.json)

| Kernel | main / plain | worker / plain |
| --- | ---: | ---: |
| allocation | 1.00× (0.97–1.02) | 1.00× (0.98–1.01) |
| numeric | 1.01× (0.99–1.02) | 1.00× (0.96–1.02) |
| calls | 0.94× (0.92–0.98) | 0.94× (0.93–0.99) |
| strings | 1.02× (0.97–1.04) | 0.99× (0.96–1.02) |
| compiler | 1.00× (0.93–1.05) | 0.99× (0.98–1.03) |

The 1.23–1.47× that remained on `allocation` and `calls` was entirely the
Worker stop polls.

**Why not keep the experiment's build.** Dropping polls from shared code would
leave `terminate()` unable to stop a Worker running in that code. Instead,
`72cbd43db` keeps every Worker function interruptible but moves its polls:

- each natural loop header gets a poll;
- a function that calls gets a poll on entry;
- straight-line code gets none.

The fast path is a plain load, where it used to be `ldar`. The safepoint
fixture gained a Worker that spins in an allocation-free, call-free loop.
Before this change that was a documented termination gap. It now exits 42 on
AArch64 (macOS) and on x86-64 (the Debian test VM under emulation). The
baseline compiler's image stalls on the same fixture and exits 70.

**Measured.** A placements rotation of the poll images (`72cbd43db`) ran 15
rounds with a load median of 11.5 (IQR 8.2–12.3), and no observation failed.
My own Test262 compile shared the host during it, so the IQRs are wide.
[Raw rounds](worker-runtime-phase2-v1-poll-placement.json)

| Kernel | main / plain | worker / plain |
| --- | ---: | ---: |
| allocation | 1.21× (1.09–1.28) | 1.16× (1.06–1.27) |
| numeric | 1.03× (0.96–1.14) | 1.02× (0.96–1.12) |
| calls | 1.24× (1.10–1.46) | 1.26× (1.14–1.35) |
| strings | 1.05× (0.86–1.33) | 1.10× (0.99–1.18) |
| compiler | 1.04× (0.97–1.29) | 1.11× (1.02–1.18) |

`calls` moved from 1.34–1.47× to 1.24–1.26×. Polls at loop headers did not
slow the allocation-free `numeric` loops. The cost that remained came from
the interruptibility class rule, not from the polls. Shared modules are now
Worker code, so small runtime helpers they call (list reads, accessors) could
not inline into them, which the experiment's build still allowed.

An inlined leaf helper without a loop brings no poll site. `1f2302313`
therefore lets loop-free runtime helpers inline into Worker code. Worker code
still never inlines into runtime code.

## Final placements

The images built at `1f2302313` ran a placements rotation of 15 rounds with a
load median of 3.9 (IQR 3.4–4.5), and no observation failed. The program
without Workers is still `04845cd33e69bdcb…`.
[Raw rounds](worker-runtime-phase2-v1-placements-final.json)

| Kernel | main / plain | worker / plain | Baseline main / plain | Baseline worker / plain |
| --- | ---: | ---: | ---: | ---: |
| allocation | 1.01× (1.00–1.02) | 0.98× (0.93–1.00) | 3.52× | 227× |
| numeric | 1.01× (1.00–1.02) | 1.01× (0.99–1.02) | 1.11× | 114× |
| calls | 1.02× (1.01–1.08) | 1.04× (1.01–1.06) | 13.46× | 264× |
| strings | 1.03× (0.98–1.10) | 1.01× (0.99–1.02) | 1.98× | 44.9× |
| compiler | 1.02× (1.01–1.05) | 1.02× (1.02–1.03) | 2.37× | 49.3× |

A Worker program's code now runs at the speed of the same program without
Workers, both on the main thread and inside the Worker. Against Node, Tint is
2.1–4.6× slower in every placement. That is the typed code-generation gap,
which other streams own.

## Validation

**Native Worker fixtures.** Nine fixtures were rebuilt after each runtime or
compiler step and run under LLDB: the Worker suite, messages, ports, clone,
backing, exit, safepoints, compiler and the new typed Worker entry fixture.
Every run reported the stop at entry and exit 42.

**Unit tests.**

- IR: 414.
- Codegen: 510.
- Linker, Worker and general-fallback tests.
- Mailbox recycling: the new test fails without `8d112612d`.
- Structured clone: the new tests cover numeric edge cases, counts above one
  16-bit unit, length-tracking views and every truncated packet prefix.

The native-subset check passed for every compiler change.

**Test262, pinned revision `91c70759`,** through a toolchain frozen at
`0cd1fa978`:

- Pre-merge host smoke: 2/2 in both `units` and `program` linking
  ([units](test262-host-smoke-worker-runtime-units-v1.json),
  [program](test262-host-smoke-worker-runtime-program-v1.json)).
- `built-ins/Atomics`, including the agent wait/notify and waitAsync tests:
  778/778 passed, with no failures, timeouts or crashes
  ([report](test262-atomics-worker-runtime-v1.json),
  [journal](test262-atomics-worker-runtime-v1.jsonl.gz)). The earlier cluster-K
  report on this selection had 772/778.

**Programs without Workers** produced byte-identical images through every step.
The `plain` benchmark image stayed `04845cd33e69bdcb…` on macOS and
`e67a410c6ce83cfe…` on Linux.

**x86-64.** The new poll placement ran the safepoint fixture, including the
allocation-free spin loop, to exit 42 in the Debian x86-64 test VM under
emulation.
