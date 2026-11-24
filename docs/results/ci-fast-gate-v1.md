# CI gate restructure: measurements (v1, 2026-11-24)

Evidence for splitting the CI gate into parallel jobs per target
([validation gate](../validation-gate.md#ci)). Runs are GitHub Actions runs on
`Sequins-dev/tint`; local measurements are on an Apple M5 Max (18 cores,
128 GB).

## Before: main run 45351729932

One job per target ran its whole gate serially.

| Job          | Wall     | Phases (seconds)                                                                                                                                             |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS arm64  | 94.6 min | build 65, subset 13, check-concurrent 378, check-memory 569, check-native 1,623, bootstrap 335, stage2 256, stage3 257, smoke-units 1,307, smoke-program 800 |
| Linux x86-64 | 19.3 min | build 38, bootstrap 131, stage2 440, stage3 441                                                                                                              |
| Linux arm64  | 13.2 min | build 58, bootstrap 269, stage2 212, stage3 212                                                                                                              |

## Where the macOS time went

- **Test262 smokes (2,107 s, 38%).** Each smoke ran one file (strict and
  sloppy). `units` spent its time compiling the linked-unit host, `program`
  compiling one whole-program batch: both compile the whole JavaScript
  runtime. Locally, with all three linking modes running at once:

  | Linking   | End to end | Runtime compile      | Peak RSS | Peak footprint |
  | --------- | ---------: | -------------------- | -------: | -------------: |
  | `units`   |      327 s | ~320 s (host)        |  7.39 GB |        7.26 GB |
  | `program` |      243 s | 238 s (batch)        |  6.83 GB |        7.38 GB |
  | `suite`   |      242 s | ~238 s (suite image) |  7.19 GB |        7.77 GB |

  Every mode exceeds the 7 GiB of a macOS runner, which is why CI took
  1,307 s and 800 s (swapping) against 4–5.5 minutes locally. Cold, `program`
  and `suite` are fastest end to end; only the `units` host is independent of
  the selection, so it alone can be compiled once, elsewhere, and reused, and
  then the macOS smoke only links and runs (38 s to the first case in run
  45377270382).

- **Native fixtures (1,623 s).** One memory slot serialized every fixture
  build and the launch lock every launch; see
  [the native batch research](check-native-speedup-research-v1.md) (on
  `perf/faster-native-gate`) for the per-image journal. Its own work per test
  file (build, admission and execution, excluding waits) seeds the shard
  costs: `native-ffi` 546 s, `runtime-diagnostics` 225 s, `c-bindgen` 224 s,
  then 157 s and less.

- **Stage 3 (257 s).** See the fixpoint below.

- **Repeated work.** The selfhost subset (13 s) is one test of
  `selfhost-linked.test.ts`, which the memory group runs again; the storage
  tests run in the bootstrap job and again in the concurrent group. Both are
  kept as fast early failures and reported here as duplicates.

## Self-build fixpoint: stage1 == stage2

Stage 1 is the Node-hosted pipeline's build of the compiler; stage 2 is stage
1's build of the same snapshot. `cmp stage1 stage2` held in every observation:

- the Linux gate on main has asserted it on both Linux targets on every run;
- 7 of 7 local macOS gate evidence directories (stage1 49.7–51.5 MB);
- CI run 45377270382: macOS arm64, Linux x86-64 and Linux arm64.

Because stage 2 equals stage 1 byte for byte, stage 3 would be the same bytes
running on the same input; `stage1 == stage2` therefore implies
`stage2 == stage3`. The gate dropped stage 3 and compares stage 1 with stage 2.

## Cross-host identity

The precompiled units host and bundles move between runners, so identity
across hosts was checked rather than assumed:

| Artifact                                                   | Hosts compared                                                                   | Result                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| DateTimeFormat service unit                                | macOS (local), Linux arm64 (container)                                           | identical digest `485143e8…`; only the cache key differed |
| Units host (compiled program, 97,593,896 bytes serialized) | macOS (local), Linux arm64 (container)                                           | identical                                                 |
| Units host cache entry                                     | Linux x86-64, Linux arm64 (run 45388969499)                                      | identical `3d6505a3…`                                     |
| Frozen toolchain (workspace `tsc` output)                  | macOS bootstrap, Linux arm64 (run 45377270382)                                   | identical `b85983b3…`                                     |
| Darwin stage 1                                             | macOS bootstrap, Linux x86-64 cross build (`--target darwin-aarch64`), both runs | identical `c11dd130…`                                     |

The service-unit cache key recorded the compiling host's platform and
architecture, so a host compiled on Linux was not found on macOS (run
45377270382's `test262` job failed with "no precompiled unit host" after
38 s, as designed). The key now records only the Node version.

## Runner variance

GitHub's x86-64 pool mixes CPUs. In run 45388969499 the Node-hosted stage 1
took 123 s on an AMD EPYC 9V45 and 269 s (Darwin target) on an EPYC 7763; both
x86-64 fixpoint jobs of this work landed on EPYC 7763 runners, where stage 2
took 1,078–1,084 s against 413–530 s in ten earlier runs. Arm64 stage 2 was
unchanged (214 s against 212 s). macOS runners in run 45377270382 were also
15–30% slower than in the baseline (stage 1 389 s against 335 s).
