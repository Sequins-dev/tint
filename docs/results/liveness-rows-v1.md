# Dense live-in rows for register homes and guard dataflow

November 22, 2026. Base: native compiler from main
`3d10cb5c0577477384bf2ecee8a368af781ceff7`. Candidate: native compiler
from `perf/liveness-rows` at `c963ae69efe1b33623caa54065497e5a8aa5bc28`.
Both compiled the frozen 821-file self-compile input under
`tools/gate/with-lock.sh both`, launched under LLDB with a stopped-at-entry
assertion and a verified exit 0. Each image matched the frozen reference
by `cmp`: the signed Mach-O `334b7160…9613` on macOS and the ELF
`30c2dcb3…b440` on Linux. Pair _i_ ran base then candidate when _i_ was
even and the reverse when odd. The pairs ran in two lock acquisitions per
host (pairs 0–7, then 8–14).

## Results

| Host        | Metric       |      Paired median |              IQR |
| ----------- | ------------ | -----------------: | ---------------: |
| macOS arm64 | Wall         |             −3.58% | −5.26% to −0.59% |
| macOS arm64 | CPU          |             −5.83% | −9.21% to −3.49% |
| macOS arm64 | Cycles       |             −5.80% | −6.97% to −4.60% |
| macOS arm64 | Instructions |             −4.74% | −4.76% to −4.74% |
| macOS arm64 | Peak RSS     | −94.9 MiB (−4.42%) | −4.44% to −4.41% |
| Linux arm64 | Wall         |             −7.04% | −7.94% to −3.75% |
| Linux arm64 | CPU          |             −8.11% | −9.52% to −5.98% |
| Linux arm64 | Peak RSS     | −30.9 MiB (−1.45%) | −1.46% to −1.44% |

The Linux guest exposes no hardware counters. The macOS host's
one-minute load average ranged from about 3.5 to 20 during these cells,
because other work shared the host; pairs 0–5 ran during the highest load.

### macOS arm64 (wall seconds, cycles in billions)

| Pair | Base wall | Candidate wall | Base cycles | Candidate cycles |
| ---: | --------: | -------------: | ----------: | ---------------: |
|    0 |    165.49 |         159.00 |       542.2 |            500.3 |
|    1 |    148.32 |         159.20 |       525.5 |            503.0 |
|    2 |    146.65 |         137.36 |       532.2 |            495.1 |
|    3 |    137.59 |         136.71 |       518.4 |            495.0 |
|    4 |    133.97 |         122.49 |       511.2 |            472.0 |
|    5 |    127.42 |         127.35 |       505.3 |            476.0 |
|    6 |     96.71 |          88.31 |       451.3 |            421.9 |
|    7 |     88.53 |          87.76 |       444.9 |            421.0 |
|    8 |    148.95 |          91.80 |       489.9 |            425.3 |
|    9 |     85.30 |          85.37 |       432.5 |            420.9 |
|   10 |     85.86 |          84.44 |       437.0 |            416.5 |
|   11 |     85.39 |          84.92 |       433.3 |            419.0 |
|   12 |     85.76 |          82.17 |       436.3 |            405.9 |
|   13 |     84.99 |          81.69 |       429.8 |            403.5 |
|   14 |     84.88 |          81.84 |       429.1 |            404.2 |

### Linux arm64 on `dev` (wall and CPU seconds)

| Pair | Base wall | Candidate wall | Base CPU | Candidate CPU |
| ---: | --------: | -------------: | -------: | ------------: |
|    0 |     91.76 |          90.77 |    109.7 |         106.4 |
|    1 |     90.66 |          87.06 |    108.4 |         101.9 |
|    2 |     90.25 |          86.35 |    108.0 |         100.9 |
|    3 |     93.38 |          86.46 |    111.7 |         101.1 |
|    4 |    119.43 |          89.49 |    141.9 |         104.5 |
|    5 |     95.87 |          88.85 |    114.5 |         103.7 |
|    6 |     96.41 |          86.99 |    110.6 |         101.7 |
|    7 |     94.46 |          87.80 |    113.2 |         102.5 |
|    8 |    110.15 |          92.45 |    130.8 |         108.2 |
|    9 |     98.43 |          90.74 |    117.2 |         105.9 |
|   10 |     92.76 |          85.26 |    110.0 |          98.8 |
|   11 |     93.36 |          93.29 |    111.9 |         109.3 |
|   12 |     92.74 |          90.80 |    111.2 |         106.4 |
|   13 |     97.68 |          92.54 |    117.5 |         108.3 |
|   14 |     97.23 |          93.80 |    116.9 |         110.0 |

## Identity

- The macOS compiler built by Node (`54f6b3f2…`) reproduced itself at
  stage 2 and stage 3 under LLDB.
- Under Node, `slotHomes` over the 5,910 captured functions produced the
  same digests as main: `6103ad10…` unbounded and `82ec6308…` with a
  2,000,000 work budget.
- A Node replay of the whole AArch64 emitter on the captured module produced
  the same code as main, SHA-256 `ed326c43…6c75`.

## Kernel effect

A probe build of the candidate added per-kernel clocks to the emitter. It
ran once on macOS while the host was heavily loaded. Kernels this change
leaves untouched took 1.5–1.75 times their earlier unloaded probe times.
Register homes took 1.30 times and join record guards 1.15 times. The
separate entry-liveness query of 0.98 s no longer ran.
[Baseline kernel probe](https://github.com/Sequins-dev/tint/blob/feca4f80c24c7e8f3e6ee134faf3a84afb7db7db/docs/results/parallel-bounded-compile-deferred-liveness-whole-build-v1.md)

Raw records are `liveness-rows-final-{darwin,linux}/results.jsonl` with the
chunk logs and `rows-probe-darwin-out.log`, all under the PR #4 worktree's
`.tint-bootstrap/kernels.HF3kUV` directory.
