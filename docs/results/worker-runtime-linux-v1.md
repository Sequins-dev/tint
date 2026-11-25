# Worker runtime on Linux arm64

22 November 2026. This report runs the [Worker benchmarks](worker-runtime-baseline-v1.md)
on Linux arm64, before and after the first Phase 2 fixes of the
[Worker runtime design](../design-worker-runtime.md).

**Setup.**

- Host: the shared `dev` machine (Debian 12, kernel 6.1, 9 CPUs, no hardware
  counters), on the same Apple host as the macOS runs.
- Images were cross-built with `TINT_NATIVE_TARGET=linux-aarch64` and run under
  LLDB 19, which had to report the stop at entry and exit 42.
- Node 26.13.1 is the official linux-arm64 build.
- Each set ran 15 rotated rounds. The dev machine's 1-minute load was 0.3–2.8.

**Images.** The baseline images come from `ae24161ab`, which is main at
`3d10cb5c0` plus the benchmarks. The after images come from two builds:

| Images | Built at | Contains |
| --- | --- | --- |
| Placements | `34a2fde64` | Everything up to recycled packet blocks; not the poll placement (`72cbd43db`) |
| Transport and typed transport | `8d112612d` | Adds the recycled-block fix |

**The program without Workers is byte-identical** before and after:
`e67a410c6ce83cfe…`.

Raw rounds:

- kernels: [baseline](worker-runtime-linux-v1-kernels-baseline.json)
- in-Worker kernels: [baseline](worker-runtime-linux-v1-worker-baseline.json)
- transport: [baseline](worker-runtime-linux-v1-transport-baseline.json), [after](worker-runtime-linux-v1-transport.json)
- placements: [after](worker-runtime-linux-v1-placements.json)
- typed transport: [after](worker-runtime-linux-v1-typed-transport.json)

## Kernels

Paired ratios against the program without Workers:

| Kernel | copying, baseline | raw memory, baseline | main, baseline | main, after | Worker, baseline (unpaired) | Worker, after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| allocation | 1.79× | 0.97× | 3.96× | 1.13× (1.08–1.18) | 178× | 1.12× (1.05–1.15) |
| numeric | 1.07× | 1.02× | 1.14× | 1.00× (0.96–1.02) | 74.2× | 1.00× (0.99–1.02) |
| calls | 0.97× | 0.92× | 10.37× | 1.44× (1.34–1.47) | 189× | 1.48× (1.42–1.50) |
| strings | 0.97× | 0.99× | 2.11× | 1.08× (1.05–1.10) | 31.5× | 1.07× (1.04–1.09) |
| compiler | 0.93× | 1.02× | 2.63× | 1.03× (1.03–1.06) | 38.5× | 1.04× (1.02–1.05) |

The baseline raw-memory (`node:zlib`) program is 2.32× Node on its `zlib`
kernel.

These after-images predate the poll placement. On macOS, the experiment in the
[Phase 2 report](worker-runtime-phase2-v1.md) attributes the remaining
`calls` and `allocation` cost to the stop polls.

## Transport

Tint / Node, paired:

| Operation | Baseline | After |
| --- | ---: | ---: |
| startup | 0.41× | 0.35× |
| terminate | 0.46× | 0.57× |
| startup, 8 Workers | 0.39× | 0.50× |
| round trip | 2.28× | 1.49× (1.38–1.62) |
| clone records ×16 | 17.9× | 4.00× |
| clone records ×1,024 | 93.7× | 11.8× |
| clone numbers ×1,024 | 131× | 15.8× |
| clone numbers ×65,536 | 224× | 35.3× |
| clone string 1 KiB | 7.94× | 2.83× |
| clone string 1 MiB | 459× | 143× |
| clone tree depth 4 | 21.3× | 4.97× |
| clone tree depth 10 | 60.7× | 11.7× |
| transfer 64 KiB | 2.81× | 2.14× |
| transfer 8 MiB | 2.75× | 2.36× |
| batch | 16.8× | 6.85× |
| port round trip | 1.89× | 1.25× (1.11–1.43) |
| wait/notify | 1.40× | 1.38× |
| waitAsync | 1.37× | 1.20× |
| counter, 1 Worker | 176× | 108× |
| counter, 4 Workers | 35.9× | 22.6× |

Typed transport, after (Tint / Node): round trip 1.23× (1.18–1.28), batch 7.67×
and 1 KiB strings 2.55×.

Node's messaging costs are higher on this host than on macOS, so Tint is closest
to parity here. A round trip in Node takes 31 µs, against 15 µs on macOS.

## Failed observations

The first after-run used images built at `34a2fde64`, which recycled packet
blocks without clearing their queue link. Every Tint observation in that run
crashed at Worker exit: 15 of 15 for transport and 15 of 15 for typed
transport. The same defect crashed the macOS runs, and `8d112612d` fixed it.
Both runs are kept as evidence:
[transport](worker-runtime-linux-v1-transport-recycle-defect.json) and
[typed transport](worker-runtime-linux-v1-typed-transport-recycle-defect.json).
