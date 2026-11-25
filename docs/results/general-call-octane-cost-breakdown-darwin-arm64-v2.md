# Octane cost breakdown · instruction and cache diagnostics

This follow-up extends the [main-thread sample report](general-call-octane-cost-breakdown-darwin-arm64-v1.md). It measures the work retired per operation, follows the generated Richards code through a property read and method call, and counts shape and cache events in a separate diagnostic build.

## Hardware counters

Tint retires **163×** as many instructions as Node in Richards and **358×** in RayTrace. Tint also spends fewer cycles per instruction in both captures. The difference in retired work is large enough to account for the cycle gap without an explanation based on stalls.

| Program  | Operations per window | Node instructions/op | Tint instructions/op | Paired instruction ratio, median [IQR] | Node cycles/op | Tint cycles/op | Paired cycle ratio, median [IQR] |
| -------- | --------------------: | -------------------: | -------------------: | -------------------------------------: | -------------: | -------------: | -------------------------------: |
| Richards |                    48 |               1.69 M |             275.30 M |                      163× [103×, 171×] |        0.408 M |        51.81 M |                 126× [62×, 149×] |
| RayTrace |                    12 |              18.16 M |           6,500.73 M |                      358× [353×, 360×] |         5.02 M |     1,374.70 M |                275× [256×, 290×] |

Median cycles per instruction were 0.188 for Tint versus 0.256 for Node in Richards and 0.211 versus 0.275 in RayTrace. The ratios above are medians of paired ratios. Raw medians are computed per engine. The earlier wall-clock trials used a different measurement wrapper and gave 266× and 610× for these workloads.

- Sixteen fresh-process pairs on the same Apple M5 Max, macOS 26.6.2, with alternating order under the shared timing and launch locks. Warm-ups and operation counts match the earlier benchmark. The Octane source and the Tint image are byte-identical to those runs. All windows reported their expected operation counts. All Tint inferiors exited 42 and Node processes exited 0.
- Used the macOS kernel's process-wide `proc_pid_rusage` counters (`RUSAGE_INFO_V4`). Tint stops at the two entry PCs of the benchmark clock closure under LLDB. Node stops itself at the two calls to the clock hook with SIGSTOP and its parent reads the counters before resuming it. The differences include each engine's benchmark-loop and boundary overhead and any in-window GC or JIT work on process threads. They exclude launch and warm-up. The Node stop calls and Tint breakpoint handling differ, so these runs provide hardware totals and a cycles-per-instruction comparison. [XNU process counter fields](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/sys/resource.h#L295-L333), [XNU task counter assignment](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/kern/bsd_kern.c#L1250-L1265)
- Node 26.13.1 and the selected Tint image were rehashed before aggregation. The [companion data](general-call-octane-cost-breakdown-darwin-arm64-v2.json) records all counter snapshots, ratios and checksums. Division by 48 or 12 gives work per operation without letting startup dominate the smaller Node runs.

Matching Node's instruction count would require eliminating roughly **99.4%** of Richards instructions and **99.7%** of RayTrace instructions under these runs. Removing 90% would still leave about **16×** and **36×** the instruction counts. This is the scale of reduction that a re-architecture needs to address.

## Richards generated code, one execution at a time

The original image was single-stepped at the first timed call of `Scheduler.schedule`, then in a fresh process at its 128th loop-condition visit. The first trace covers entry through the next iteration and contains 16,105 AArch64 instruction steps, including 1,735 for function entry and initialization. The warm trace contains 6,251 steps, 6,246 through the returned predicate's branch. Both inferiors exited 42. Counts are inclusive of helpers and follow the executed PCs. The companion JSON records the disjoint segment boundaries and leaf counts.

| Source operation                                        | First iteration | Warm iteration | Warm generated body |
| ------------------------------------------------------- | --------------: | -------------: | ------------------: |
| Loop condition currentTcb read                          |             377 |            377 |                 222 |
| Loose null comparison                                   |           1,264 |          1,264 |                 202 |
| Loop condition Boolean test and branch                  |              12 |             12 |                  12 |
| Method receiver currentTcb read                         |             391 |            391 |                 309 |
| Inherited isHeldOrSuspended lookup                      |           7,788 |            542 |                 207 |
| Caller closure and context checks, call                 |             253 |            253 |                 212 |
| Predicate entry, source-frame state and sloppy receiver |             898 |            898 |                 270 |
| First state read                                        |             397 |            397 |                 283 |
| Resolve STATE_HELD                                      |             221 |            221 |                  58 |
| Bitwise AND and tagged result                           |              54 |             54 |                  54 |
| Loose inequality with zero and OR branch                |             383 |            383 |                 124 |
| Second state read                                       |             389 |            389 |                 275 |
| Resolve STATE_SUSPENDED                                 |             222 |            222 |                  59 |
| Loose equality and Boolean result                       |             346 |            615 |                  87 |
| Predicate frame exit and native return                  |             204 |            204 |                  43 |
| Call-result check and branch                            |              24 |             24 |                  24 |
| Taken branch reads link and stores currentTcb           |           1,147 |              — |                   — |

**Single own data read.** The warm first read of `this.state` takes 397 instructions. Reloading the saved receiver and setting up the call takes 33. Calling `viewObjectValue` and projecting the receiver takes 42. The emitted code follows the cached layout, checks shape and index/list representation, and dispatches to the sparse-list leaf lookup in the next 151. The `findLeaf` call and body take 74. The last 97 resolve the cell, check its descriptor/type and copy its two-word value to the frame. Of the 397 instructions, 283 are in the generated function. There is no cache refill or dictionary scan on this read. The static entry reserves 736 bytes of local stack and a separate frame/link pair. [Octane predicate](https://github.com/chromium/octane/blob/570ad1ccfe86e3eecba0636c8f932ac08edec517/richards.js#L309-L312), [Tint inline cell](https://github.com/Sequins-dev/tint/blob/84873b2b78e370983969e81b89c896e69c3af5b9/packages/js-engine/src/lowering/index.ts#L2764-L2891)

**Single method call.** The warm call at line 191 takes 4,569 instructions from reading the receiver through returning the value, followed by 24 for the result check and branch. It reads `currentTcb` in 391 steps and resolves the inherited method in 542, including a successful prototype check and 294 steps inside `readList`. It then takes 253 steps to project the function, load its entry, verify Script and realm and make the indirect native call. The actual activation takes 3,383 instructions. Entry and exit together account for 1,102 of them, including sloppy receiver normalization and source-call state. The first iteration instead spends 7,788 on the method lookup, with 7,574 from the runtime read call through its return. That path builds the receiver layout and walks the property map. The remaining first-iteration call overhead uses the same direct native entry. [Octane schedule loop](https://github.com/chromium/octane/blob/570ad1ccfe86e3eecba0636c8f932ac08edec517/richards.js#L185-L198), [Tint call guard](https://github.com/Sequins-dev/tint/blob/84873b2b78e370983969e81b89c896e69c3af5b9/packages/js-engine/src/lowering/index.ts#L3556-L3668), [Tint source-frame bookkeeping](https://github.com/Sequins-dev/tint/blob/84873b2b78e370983969e81b89c896e69c3af5b9/packages/js-runtime/src/objects/jobs.ts#L182-L258)

**Compare and branch.** The loop's loose null comparison takes 1,264 instructions, including 930 from calling through `looselyEqual` and returning. The emitted code materializes null, checks the result record and builds a tagged Boolean. The branch itself consumes 12 instructions after the Boolean is ready. In the predicate, the bitwise AND uses 54 including tag checks and conversion to integers and back. Each state constant is fetched through `getIdentifierValue`, and both source comparisons use the loose-equality helper. This is why strengthening IC hit rates leaves most of the measured warm slice intact.

## Constructor shapes and hot named ICs

The census comes from fresh scratch builds of the pinned production source with diagnostic counters only. Each run counted one operation after three warm-ups. Both repeat runs reached LLDB entry, finished the benchmark's built-in correctness checks and exited 42. Timing and instruction totals above use the original image. The diagnostic images use increased object sizes and extra managed state for the counters.

A layout installation builds the receiver's descriptor-cell list. A shape ID counts the identity of its shape metadata, which can be shared between separate layout records. Stable numeric IDs survive moving GC. The distinct key-order count is based on the observed ordered own property names. An installation counted as a rebuild already had a layout earlier in that receiver's lifetime. A shape is newly created exactly when the site fails to reuse its expected shape. These measurements cover the registered constructor receivers. Layouts of other objects, including RayTrace's materialized arguments objects, are outside the constructor table. [Tint layout builder](https://github.com/Sequins-dev/tint/blob/84873b2b78e370983969e81b89c896e69c3af5b9/packages/js-runtime/src/objects/operations.ts#L1064-L1096)

The IC denominator includes generated named reads and stores reaching the inline or runtime cache. The hit numerator includes the generated inline branch, the per-site runtime probe and the shared megamorphic probe. A refill finds the property after cache probes fail. A fallback enters ordinary lookup or write. The cold-receiver column counts runtime visits that had to construct a receiver layout before probing. It can overlap either a probe hit or a refill. Counts exclude computed indexing and primitive length reads resolved before the cache. The companion JSON records every site, including its source offset and all outcomes. [Tint cache stub](https://github.com/Sequins-dev/tint/blob/84873b2b78e370983969e81b89c896e69c3af5b9/packages/js-runtime/src/objects/operations.ts#L1147-L1224)

### Richards

| Constructor      | Receivers | Layout builds | Rebuilds | New shape IDs | Distinct shape IDs | Key orders |
| ---------------- | --------: | ------------: | -------: | ------------: | -----------------: | ---------: |
| Scheduler        |         1 |             7 |        6 |             6 |                  7 |          7 |
| TaskControlBlock |         6 |            42 |       36 |            36 |                 38 |          7 |
| Packet           |         8 |            48 |       40 |            40 |                 41 |          6 |
| IdleTask         |         1 |             4 |        3 |             4 |                  4 |          4 |
| WorkerTask       |         1 |             4 |        3 |             3 |                  4 |          4 |
| HandlerTask      |         2 |             8 |        6 |             6 |                  7 |          4 |
| DeviceTask       |         2 |             6 |        4 |             6 |                  6 |          3 |

| Site                                                  | Accesses | Inline hits | Stub hits | Refills | Fallbacks | Cold receivers | Hit rate |
| ----------------------------------------------------- | -------: | ----------: | --------: | ------: | --------: | -------------: | -------: |
| All named sites                                       |  252,559 |     227,260 |    23,715 |   1,486 |        98 |            119 |   99.37% |
| Schedule loop condition, currentTcb at line 190       |   10,672 |      10,672 |         0 |       0 |         0 |              0 |  100.00% |
| Schedule receiver read, currentTcb at line 191        |   10,671 |      10,671 |         0 |       0 |         0 |              0 |  100.00% |
| Schedule method lookup, isHeldOrSuspended at line 191 |   10,671 |       9,666 |     1,005 |       0 |         0 |              5 |  100.00% |
| Held test, state at line 310                          |   10,671 |       9,671 |     1,000 |       0 |         0 |              0 |  100.00% |
| Suspended test, state at line 310                     |   10,115 |       9,115 |     1,000 |       0 |         0 |              0 |  100.00% |
| Task method lookup, run at line 337                   |    6,573 |       2,793 |     3,288 |     492 |         0 |              6 |   92.51% |

The constructor census counts 119 layout installations across 21 receivers. Shape identity does fragment during construction, but the hot scheduling reads and method lookup are all hits after warm-up. Their cost is the work performed on a hit. The 119 installations are small relative to 252,559 named accesses.

### RayTrace

| Constructor         | Receivers | Layout builds | Rebuilds | New shape IDs | Distinct shape IDs | Key orders |
| ------------------- | --------: | ------------: | -------: | ------------: | -----------------: | ---------: |
| Color               |    25,042 |        86,855 |   61,813 |        50,084 |             50,090 |          4 |
| Vector              |    26,298 |       105,042 |   78,744 |        52,596 |             52,618 |          4 |
| Ray                 |     3,328 |         9,984 |    6,656 |         3,328 |              3,330 |          3 |
| IntersectionInfo    |    11,912 |        44,602 |   32,690 |        27,252 |             27,261 |         14 |
| Light               |         2 |             8 |        6 |             4 |                  6 |          4 |
| Scene               |         1 |             5 |        4 |             3 |                  5 |          5 |
| Camera              |         2 |            11 |        9 |             4 |                  8 |          6 |
| Background          |         2 |             5 |        3 |             2 |                  4 |          3 |
| Engine              |         1 |             3 |        2 |             0 |                  3 |          3 |
| Shape.Sphere        |         2 |             8 |        6 |             6 |                  7 |          4 |
| Shape.Plane         |         1 |             4 |        3 |             2 |                  4 |          4 |
| Material.Solid      |         2 |            12 |       10 |             8 |                 10 |          6 |
| Material.Chessboard |         1 |             8 |        7 |             6 |                  8 |          8 |

| Site                                               |  Accesses | Inline hits | Stub hits | Refills | Fallbacks | Cold receivers | Hit rate |
| -------------------------------------------------- | --------: | ----------: | --------: | ------: | --------: | -------------: | -------: |
| All named sites                                    | 1,208,651 |     533,489 |   293,188 |  94,193 |   287,781 |        246,548 |   68.40% |
| Constructor method lookup, initialize at line 36   |    66,594 |           0 |    39,425 |  27,169 |         0 |         66,594 |   59.20% |
| Constructor forwarding, apply at line 36           |    66,594 |           0 |         0 |       0 |    66,594 |              0 |    0.00% |
| Vector initialization, x at line 224               |    26,298 |           0 |         0 |       0 |    26,298 |              0 |    0.00% |
| Vector initialization, y at line 225               |    26,298 |           0 |         0 |       0 |    26,298 |         26,298 |    0.00% |
| Vector initialization, z at line 226               |    26,298 |           0 |         0 |       0 |    26,298 |         26,298 |    0.00% |
| Color initialization, red at line 89               |    25,042 |           0 |         0 |       0 |    25,042 |              0 |    0.00% |
| Color initialization, green at line 90             |    25,042 |           0 |         0 |       0 |    25,042 |         25,042 |    0.00% |
| Color initialization, blue at line 91              |    25,042 |           0 |         0 |       0 |    25,042 |         25,042 |    0.00% |
| Vector.dot receiver read, x at line 252            |    19,596 |       4,476 |    14,426 |     694 |         0 |              0 |   96.46% |
| Vector.dot argument read, x at line 252            |    19,596 |       3,850 |    11,702 |   4,044 |         0 |          4,022 |   79.36% |
| Intersection loop array length, length at line 685 |    13,312 |           0 |         0 |       0 |    13,312 |              0 |    0.00% |

A single scene produced 246,547 layout installations on 66,594 registered receivers, including 179,953 reinstalls and 133,295 shape creations. Color alone used 50,090 shape identities for four observed key orders. Vector used 52,618 for four. This confirms shape identity churn on instances of the same constructor. It also exposes a separate cost that persists when shape identity is reused. Each fresh receiver still builds a descriptor-cell layout, and adding the next field can invalidate and rebuild it. The 66,594 cold receiver builds at the initialize lookup include 39,425 stub hits. The successful probe happened after the layout build.

The initializer stores are adding properties, which the current existing-cell store handler cannot do. All 66,594 reads of apply fall back even with zero receiver-layout builds at that site. The general call and argument-forwarding changes therefore remain a separate priority.

## Revised Phase 1 estimate

RayTrace's repeated shape identities and layouts make shape transitions and in-object storage a larger opportunity than the first estimate allowed. The first estimate credited a 45–70% reduction over RayTrace's 3,643 non-arguments property samples, corresponding to **20.2–31.5%** of baseline time. Use a **60–85%** removal scenario for this bucket, reflecting the opportunity to avoid layout construction, reinstallation and dictionary-backed field creation on default constructor fields while retaining expensive cases in the fallback. With the same sample-to-time assumption, that models **27.0–38.2%** of baseline time, or **1.37–1.62×** speedup from Phase 1 alone. The removal percentages are planning assumptions. The census measured event counts, and an implementation would still need to measure the cycles those events account for.

This budget credits the existing non-arguments Property bucket once. It gives no extra credit for generated guards or for argument descriptors, and the latter remain in Phase 2. With all other assumptions held fixed, the combined RayTrace wall-time scenario moves from **254–383×** to **213–342×** Node. The instruction counters explain why both estimates remain so far from parity.

For Richards, budget an additional instruction-count acceptance test for the successful path. The five traced read sites account for 49,795 inline hits per benchmark operation. If their observed instruction paths repeat and a guarded offset read takes 16–40 instructions, replacing just those hits saves **18.8–20.0 million instructions per operation**, **6.8–7.3%** of Richards's full instruction count. This includes generated guard, copy and address work absent from the Property sample bucket. The estimate is an instruction budget for named sites and can overlap the earlier wall-time estimate. The 99.37% observed hit rate puts compact guarded loads ahead of additional cache states for Richards.

Keep the Phase 1 storage and IC work first. Evaluate the binding/equality lowering alongside the native call-frame work for Richards as soon as field loads are compact. The measured 1,355 instructions of caller dispatch and activation overhead for the selected direct call give the ABI change a concrete local budget. The trace also supplies a 1,264-instruction loose-null comparison target. Whole-program speed depends on eliminating all three classes of work, then accounting for the remaining instructions with fresh counter runs. [Revised proposal](../design-general-runtime-rearchitecture.md)
