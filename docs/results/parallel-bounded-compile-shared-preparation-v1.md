# Shared AArch64 preparation and the Object checker's resident set

On November 21, 2026, the AArch64 replay used the same 7,111 optimized
function bodies from the frozen 821-file compiler as the earlier
ordered-fragment trial. The capture SHA-256 was
`5115e42db0c942900e33cac5d03c82939fa2c7b03d68719445bfb260d7b5fce4`.

## Shared AArch64 preparation

The earlier fragments repeated module preparation in each isolate. This
prototype computed signatures, shape facts, record flow and safepoint
summaries once, then distributed the relevant per-function results and
the shared tables. Record-flow queries crossed the worker boundary as
integer facts. The first two attempts failed when a worker lacked a
local-signature table and when the payload retained a record-flow
callback. Both failures preceded fragment verification.

Workers assigned provisional dispatch families. The ordered placement
pass assigned the final 123 family IDs in first-use order and patched
each fragment. Branch forms came from shard results. Each replay matched
the full serial emission result, including code, symbols, relocations and
metadata. All counts emitted 48,799,664 code bytes, SHA-256
`ed326c4353628ea079f6e765cbcd2bfb2a89d2b37eb2077d88103c39aab36c75`.

| Workers | Serial wall (s) | Worker wall (s) | Shared preparation (s) | Serial CPU (s) | Worker CPU (s) | Serial sampled RSS (KiB) | Replay peak RSS (KiB) |
| ------: | --------------: | --------------: | ---------------------: | -------------: | -------------: | -----------------------: | --------------------: |
|       1 |          93.601 |         105.274 |                 17.057 |        112.582 |        122.565 |                3,502,512 |             5,255,072 |
|       2 |         101.615 |          89.564 |                 19.054 |        117.125 |        124.712 |                3,609,600 |             7,526,208 |
|       6 |         101.473 |          51.231 |                 17.065 |        119.154 |        156.924 |                3,577,504 |             9,449,680 |

Worker wall and CPU include preparation, dispatch and placement. The
same Node 24 process ran the control first, followed by the worker replay.
The replay peak therefore includes any pages retained from the control.
The macOS whole-process counters for the three invocations recorded
641.711, 643.427 and 721.064 billion cycles, respectively. The clock
scope included both paths, so these counters provide no per-path cycle
comparison. The replay establishes a stage-level result. Live native
compiler performance still needs its own test. The typed extraction of
the preparation interface compiled as a native Linux arm64 executable.

## Object selection's collection-runtime retry

The complete typed streaming Object image had peak RSS of 4,798,824,448
bytes. Its successful run passed through the whole-program instance check
in collection-runtime preparation at the following process sample.

| Quantity                     |         Bytes |
| ---------------------------- | ------------: |
| Process RSS                  | 4,043,046,912 |
| Committed JavaScript heap    | 3,035,136,000 |
| JavaScript heap in use       | 2,996,480,488 |
| External memory              |   188,470,163 |
| ArrayBuffer memory within it |   178,360,726 |

The instance check validates helper demands across the instantiated
module. It uses the transformed syntax and its bound declarations and
type graph while the linked input is still available for retry. Type and
binding relationships have whole-program scope here. The measurements
give the exact process resident set at the check boundary. They give no
lower bound on a compact representation of those relationships. At
2,176 MiB old space, letting go of the prior checker observation earlier
still exhausted the heap before lowering, at 3,133,784,064 bytes peak
RSS. Moving one more optimizer rewrite to the function store cannot
change these pre-IR lifetimes.

A separate Linux arm64 emitter capture with an 8 MiB decoded cache was
stopped after 2:04:38 wall and 2:09:49 CPU during selected optimizer
cleanup. The process had read 448,814,697,472 bytes through 7,569,796
read calls. These are cumulative process I/O counters. At termination
RSS was 3,509,316 KiB and the high-water mark was 3,635,668 KiB. The
trial yielded no image.

Raw evidence is in `arm64-fragment-shared-preparation-{1,2,6}.log`,
`arm64-fragment-shared-preparation-2-r{0,1}.log`,
`typed-codegen-preparation-compiler-build.log`,
`object-packed-typed-4096.log`, `object-emitter-profile-linux-r1.log`
and `object-emitter-low-cache-stop.log`.
