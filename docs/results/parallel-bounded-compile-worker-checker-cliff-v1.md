# Worker composition and the checker cost of a general emitter

November 27, 2026. This diagnoses the long Node-hosted build of the
[native fragment replay](parallel-bounded-compile-generational-shared-preparation-v1.md).
It used PR #4's `2912951cf` source and the 33 cost-ordered ranges from
the outlined frozen compiler input.

## Typed Worker preparation

The R7 shared fragment helper imported `threadId` from
`node:worker_threads`. Both the coordinator and Worker imported that
helper. `planTypedGuests` in `packages/js-engine/src/program/index.ts`
places modules that depend on Worker bindings in an entry's evaluation
scope. The helper was claimed by both entry graphs. Exposing the typed
preparation result with `strict-worker-prepare.mjs` returned this error:

> module ./fragment-engine.ts uses the Worker bindings in the graphs of fixture and ./fragment-peer.ts

In `compileWithTypedWorkerEntry` in `packages/compiler/src/native/index.ts`,
`composeTypedWorkers` returned `undefined` for this declined preparation.
The compilation proceeded through the general guest path with
`requireTyped: true`. Inspecting the active build showed that the path
had general-lowered 145 application modules.

The R8 fixture passes the thread ID into the shared engine as a number.
Only the coordinator and Worker entry import Worker bindings. The
strict preflight reported `typed Worker preparation selected`.

## Checker profile of the R7 build

An 11.464-second Node Inspector profile, sampled after the build spent
about seven minutes in its `program` phase, attributed 64.92% of self CPU
to `alternateFacts` and 30.72% to `refine` in
`packages/typescript/src/checker/closures.ts`. `composeTypedWorkers` and
`checkTypedProgram` were on the stack in 99.56% of sampled time.

The paused checker mapped the hot function to source offsets
102,274–1,312,243 of
`$general:packages/codegen/src/aarch64/scalar/index.ts`. The checker had
705,662 bindings. Sampled merges carried 585–588 facts in each set, with
310–312 narrowed facts. `alternateFacts` scans the entire right set for
each narrowed left fact. Some individual merges therefore examine more
than 180,000 right-side tokens. The profile captures a repeated
short-circuit narrowing cost in the general guest graph.

## Native trap and remaining critical path

In a separate main-thread fixture, the typed emitter opened the tiny
shared input, reproduced all three Node reference packets and exited 42. Two persistent Workers also passed the preparation-only fixture.
The combined emitter fixture printed `actor compute 0` and
`actor compute 1` and then stopped both Worker threads at the same
`EXC_BREAKPOINT`. This narrows the failing case to emission after the
Workers receive and open preparation.

On the post-fold-fix native macOS self-build screen, the largest
remaining stages were:

| Stage                          | Wall time | Share of 167.71 s build |
| ------------------------------ | --------: | ----------------------: |
| Emit native code               |   52.16 s |                   31.1% |
| SSA constants, both runs       |   14.27 s |                    8.5% |
| Select array access, both runs |   10.53 s |                    6.3% |
| Hoist loop invariants          |    4.68 s |                    2.8% |
| Cache list vectors             |    4.22 s |                    2.5% |

The screen reproduced the signed image and includes host load from
other exploratory builds. A 15% whole-build saving would need 25.16 s
at that control size. With two lanes, halving all 52.16 s of emission
would save 26.08 s. If the earlier 4.4 s of serial preparation carries
over, the ideal saving from two emission lanes drops to 23.88 s before
placement, publication and scheduling. That puts the two SSA sweeps
next in the timeline for a combined design.

Raw evidence is in `.tint-bootstrap/outline-v2.CaPaRsha`, including
`stage-replay-r7-typed-only.log`, `replay-r7-host-profile.cpuprofile`,
`replay-r7-checker-source.json`, `replay-r7-worker-route.json`,
`actor-emission-{main,worker}.log`, and the preliminary `serial-fold-matrix-0.log`.
