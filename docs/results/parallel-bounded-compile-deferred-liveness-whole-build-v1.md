# Deferred safepoint liveness in the native whole build

November 22, 2026. These cells compare the native compiler built from
main `3d10cb5c0577477384bf2ecee8a368af781ceff7` with the same tree plus
`b871e9595` (branch `perf/backend-dataflow`), which analyzes precise
safepoint roots only for references that received a register home. Both
compilers compiled the frozen 821-file input under `tools/gate/with-lock.sh
both`, launched under LLDB with a stopped-at-entry assertion and a verified
exit 0. Every image matched the frozen reference by `cmp`: the signed
Mach-O `334b7160…9613` and the ELF `30c2dcb3…b440`. Pair _i_ ran base then
candidate when _i_ was even and the reverse when odd.
[Node replay of the change](parallel-bounded-compile-native-kernel-parity-v1.md)

## macOS arm64, six pairs

| Pair | Base wall (s) | Candidate wall (s) | Base cycles (G) | Candidate cycles (G) | Base instructions (G) | Candidate instructions (G) |
| ---: | ------------: | -----------------: | --------------: | -------------------: | --------------------: | -------------------------: |
|    0 |        114.57 |              88.62 |           463.4 |                443.6 |               2,336.2 |                    2,314.3 |
|    1 |         97.52 |              95.26 |           455.0 |                450.7 |               2,334.3 |                    2,314.6 |
|    2 |         97.42 |             106.31 |           455.6 |                460.3 |               2,336.3 |                    2,315.5 |
|    3 |         89.16 |              91.93 |           443.0 |                448.3 |               2,333.2 |                    2,314.8 |
|    4 |         96.08 |             108.02 |           465.3 |                493.1 |               2,336.6 |                    2,321.3 |
|    5 |        126.78 |             106.41 |           485.6 |                460.9 |               2,337.2 |                    2,315.6 |

Paired candidate-minus-base medians, with interquartile ranges:

| Metric       |             Median |               IQR |
| ------------ | -----------------: | ----------------: |
| Wall         |             +0.39% | −12.63% to +7.63% |
| Cycles       |             +0.05% |  −3.44% to +1.16% |
| Instructions |             −0.87% |  −0.91% to −0.80% |
| Peak RSS     | −14.6 MiB (−0.68%) |  −0.69% to −0.66% |

The host's one-minute load average ranged from 3.9 to 7.6 during the
cells. Pair 2 overlapped a 52-second Node emitter replay and a TypeScript
build started by this experiment, so its candidate cell carried extra
load.

## Linux arm64 (`dev`), six pairs

| Pair | Base wall (s) | Candidate wall (s) | Base CPU (s) | Candidate CPU (s) |
| ---: | ------------: | -----------------: | -----------: | ----------------: |
|    0 |         95.88 |              96.22 |        115.2 |             115.5 |
|    1 |        121.95 |             103.53 |        145.8 |             124.3 |
|    2 |        128.41 |             118.48 |        151.9 |             141.4 |
|    3 |        140.19 |             138.83 |        166.5 |             165.2 |
|    4 |        154.86 |             135.95 |        181.4 |             159.3 |
|    5 |         92.78 |              98.31 |        111.0 |             118.2 |

Paired medians: wall −4.35% (IQR −11.09% to +0.02%), CPU −3.88% (IQR
−10.88% to −0.00%), peak RSS −13.1 MiB (−0.61%). The guest load stayed
between 1.0 and 4.0, yet the same compiler's CPU time ranged from 111 to
181 s. The guest has no hardware counters, so cycles are unavailable.

## Reading

The instruction saving reproduces in the whole native build at 18–22
billion instructions per build, close to the 13.5 billion of the Node
kernel replay. It is 0.87% of the build. Cycles did not move on macOS,
and the Linux wall and CPU spread is wider than the effect. The change
lowers peak RSS by 13–15 MiB on both hosts. It is not a measurable time
win on its own.

## Native backend kernel profile

A probe compiler built from main added wall-clock accumulators around
each backend analysis and printed per-function totals above 200 ms. Its
images matched the references. One run per host, under both locks:

| Kernel                       | macOS (s) | Linux (s) |
| ---------------------------- | --------: | --------: |
| Function loop total          |     32.44 |     33.69 |
| Register homes (`slotHomes`) |      9.56 |     10.46 |
| Frame slot sharing           |      3.51 |      3.60 |
| Join record guards           |      2.55 |      2.74 |
| Integer facts                |      1.21 |      1.21 |
| Entry liveness of homes      |      0.98 |      0.99 |
| Integer uses                 |      0.81 |      0.79 |
| Temporary registers          |      0.60 |      0.61 |
| Safepoint liveness           |      0.55 |      0.59 |
| Loop forest                  |      0.54 |      0.53 |

The two copies of the emitter's per-function closure (functions 5,648
and 1,524: 21,235 blocks, 13,645 slots, 72,931 instructions) took 7.13 s
and 6.13 s on macOS and 7.63 s and 6.90 s on Linux. Register homes took
2.70–3.19 s of each. Under Node the same emitter took 5.80 s and 4.54 s
for them and 43.1 s for the whole loop. On that function the
conservative liveness behind register homes tracks 12,353 slots and
produces 37.2 million live-in entries; interference tracks 10,568 of
them. Under Node that liveness is 58% of `slotHomes` and interference
26%.

Optimizer passes took 33.5 s in the macOS probe and emission 38.8 s.

Raw logs are under `.tint-bootstrap/kernels.HF3kUV`:
`deferred-liveness-{darwin,linux}/results.jsonl`,
`deferred-liveness-{darwin,linux}-0.log`, `probe-{darwin,linux}-out.log`,
`probe-darwin-out.pass-stats.json`, `emit-probe-node.log` and the probe
patch `apply-kernel-probe.py`. The probe compilers have SHA-256
`e36d7ab1…4a6a` (macOS) and `a43cea4c…9f57` (Linux).
