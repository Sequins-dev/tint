# General runtime step 3 · Octane and frozen self-compile on Darwin arm64

Completes the [step 3 report](general-runtime-step3-darwin-arm64-v1.md), whose Octane and frozen v7 sets could not run at the time. Base `67f70313a` (step 2b and the copy-chain fix); step 3 `cc8183536` (native entries by default, native construction with a cached `prototype` read, proper tail calls, `apply(thisArg, arguments)` forwarding). Apple M5 Max.

RayTrace runs 5× faster (158.2 → 32.0 ms/op): its class constructors are `this.initialize.apply(this, arguments)` wrappers, which now construct natively and forward their actuals without an arguments object. Richards drops from 4.05 to 2.54 ms/op and DeltaBlue from 19.9 to 16.2. NavierStokes is 0.7 ms/op (1.1%) slower; it calls few functions and spends its time in element reads and arithmetic, so the cause is not the call path itself and stays open with the step 2b NavierStokes regression. Tint remains 38× (NavierStokes) to 245× (DeltaBlue) slower than Node 26.13.1. The frozen self-compile is unchanged. Step 3 missed its warm-call budget (334 instructions for a warm method call against at most 60; [warm calls](general-runtime-step3-darwin-arm64-v1.md#warm-calls)), so these gains come with the call path still 5.6× over budget.

## Octane

15 paired rounds, ms/op, medians ([data](general-runtime-step3-octane-darwin-arm64-v1.json)).

| Program | Node | Base | Step 3 | Step 3 − base (median [q1, q3]) |
| --- | ---: | ---: | ---: | ---: |
| DeltaBlue | 0.066 | 19.913 | 16.175 | -3.747 [-3.975, -3.430] |
| NavierStokes | 1.849 | 67.776 | 69.472 | +0.729 [+0.173, +1.954] |
| RayTrace | 0.515 | 158.189 | 31.977 | -126.069 [-130.962, -123.664] |
| Richards | 0.046 | 4.051 | 2.540 | -1.496 [-1.599, -1.447] |

## Frozen v7 self-compile

`node tools/frozen-workload.ts run v7 base-67f70313a step3-cc8183536 --rounds 15`, both images built with `--runtime-tree`, under the timing lock ([data](general-runtime-step3-frozen-v7-darwin-arm64-v1.json)).

| | Base | Step 3 |
| --- | ---: | ---: |
| Wall (median) | 62.39 s | 62.56 s |
| Cycles (median) | 302.3 G | 302.4 G |
| Instructions (median) | 1517.3 G | 1517.3 G |
| RSS (median) | 2123 MiB | 2123 MiB |

Paired differences (step 3 − base): cycles -0.50 G [-1.17, +0.46], wall -0.14 s [-1.30, +0.16]. The self-compile is typed code; step 3 changes untyped entries, and the slot-copy fix leaves its instruction count unchanged.

## How the runs were taken

The first Octane request (00:37) used the combined timing-and-launch acquisition and never obtained both locks while other delegates' timed runs queued blocking waits on the launch lock; it was stopped with its driver after two hours (its empty log is kept). The run reported here waited on the launch lock with a blocking `lockf` and then on the timing lock (the order every gate step uses) and started within an hour.
