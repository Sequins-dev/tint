# General runtime step 2b · in-object values, store caches and fused misses on Darwin arm64

Step 2b completes step 2 of the [general runtime re-architecture](../design-general-runtime-rearchitecture.md): ordinary objects hold their property values in the object, named stores go through a site's store cache (including the transition that adds a property), and a cache miss branches straight to the slow path. A warm two-property constructor call executes 151 instructions (11,963 at step 2 in the same probe), `p.x` 99 (120) and `p.x = v` 109 (142). In paired rounds against step 2, RayTrace drops from 253.6 to 212.3 ms/op and DeltaBlue from 21.8 to 19.4. A method of a builtin-created object (`map.get`) takes 99.6 ns per call against 244.7 at step 2. Three measurements regress against step 2: `numberCall` (+8.5 ns), `mixedCall` (+7.0 ns) and NavierStokes (+2.6 ms/op, 3.4%); their causes are not yet found. The step 2 regressions in calls without property reads are explained below. Tint remains 43× (NavierStokes) to 414× (RayTrace) slower than Node 26.13.1.

## Changes

- **Values in the object.** A fast-mode object's shape records each key's attributes (writable, enumerable, configurable, accessor). Values live in `internalValue0..7`, then `internalValues`, in key order. An accessor keeps its descriptor in `properties`. Symbol keys and accessors stay in fast mode, so builtin prototypes and namespace objects (String.prototype, Math, Map.prototype) keep cacheable shapes. An object moves to dictionary mode (descriptors in `properties`, as before) when it is exotic, aliased or contracted, is the global object, deletes a property, prevents extensions, defines a canonical numeric key or passes 128 keys. Shapes past eight keys index their string keys' positions in a map built on first lookup, so slow-path lookups on large prototypes stay hashed.
- **Prototypes have private shapes.** An object that becomes a `[[Prototype]]` gets shapes no other object shares, so a receiver's shape implies its prototype, and its structural changes bump a global property epoch. A site's inherited entry records the prototype object beside its shape.
- **IR `property-load` and `property-store`.** `property-cell` (which loaded a descriptor) is replaced by `property-load`, which loads the general value at the site's word index, or returns the absent value (tag 0, payload 1) that the new `general-is "absent"` test recognizes. `property-store` stores to a cached writable property, or performs a cached transition when the site's epoch is current, with the generational write barrier. AArch64 and x86-64 emit both inline. The runtime binds `cachedOwnPropertyValue`, `cachedInheritedPropertyValue`, `absentPropertyValue` and `cachedPropertyStore` to them; straight-line callees with a general result now inline, so the bound bodies do.
- **Fused misses.** On AArch64, when a block's branch only tests whether a `property-load` missed (possibly through a following jump to a test block), the load's guard failures branch to the miss successor directly and the test is not emitted. Copies that only the skipped test would read are not emitted either; a liveness walk from the miss successor checks that the skipped stores are unobservable. A `property-store` whose result the branch reads is fused the same way.
- **Primitive receivers.** A string's own properties are its length and indices, and Number and Boolean wrappers have none, so the cached read's miss path looks other keys up on the primitive's prototype through the site's entries.
- **Codegen.** The receiver's two words load with one `ldp`, and general slot copies use `ldp`/`stp` when all four words are frame memory.

## Instruction budgets

From the emitted code of the probe below (AArch64, `d6e4162d9`). The core counts take the receiver's general value and the site in registers.

| Operation | Sequence | Core | As emitted |
| --- | --- | ---: | ---: |
| Own read `o.x` | `cmp tag, #5` · `b.ne miss` · `ldp shape, index, [site]` · `ldr [obj, #8]` · `cmp` · `b.ne miss` · `add` · `ldp value, [addr]` | 8 | 11 |
| Inherited method `o.m` | the own sequence's first six, then `ldp holder, holder shape, [site]` · `ldr [holder, #8]` · `cmp` · `b.ne miss` · `add` · `ldp value` | 12 | 15 |
| Store to an existing property | the own sequence's first six, then `ldp transition, epoch, [site]` · `cbz` · `add` · `ldp`/`stp` value | 11 | 13 + barrier |
| Transition store | as above, then `ldr epoch record` · `ldr epoch` · `cmp` · `b.ne miss` · `str shape` before the value store | 15 | 18 + barrier |

"As emitted" adds the frame traffic of frame-resident general values: one `ldp` for the receiver, one `ldr` for the site and one `stp` of the loaded value. A miss branch (`b.ne miss`) goes straight to the slow block, so the presence test and the branch over a miss stub are gone. Each property read still copies its value into the read's result slot (`ldp`/`stp`) and branches to the join (`b`), three more instructions on the hit path; values live in frame memory rather than registers, which steps 3 and 4 address. The barrier is nine instructions for a young object (the inline nursery test) and calls the remember helper for an old one.

## Warm calls

Each count is one warm call (the 501st), from entry to return, callees included, single-stepped under LLDB with `tools/general-call-bench/count_call.py`.

| Probe function (source) | origin/main | Step 1 | Step 2 | Step 2b |
| --- | ---: | ---: | ---: | ---: |
| `Point(x, y)`: `this.x = x; this.y = y` | 12,259 | — | 11,963 | 151 |
| `readX(p)`: `return p.x` | 249 | — | 120 | 99 |
| `setX(p, v)`: `p.x = v` | 2,906 | — | 142 | 109 |
| `callSum(p)`: `return p.sum()` | 746 | — | 549 | 500 |
| `Point.prototype.sum`: `return this.x + this.y` | 475 | — | 209 | 171 |
| `charAtStep(text)`: `text.charAt(10) === "b" ? 1 : 0` | — | 3,705 | 3,598 | 3,179 |
| `maxStep(i)`: `Math.max(i & 7, 3)` | — | 3,631 | 3,677 | 2,615 |
| `numberStep(i)`: `Number(i & 7)` | — | 1,618 | 1,644 | 1,661 |
| `mixedStep(i)`: one `mixedCall` iteration | — | 1,825 | 1,843 | 1,835 |

The constructor drops from 11,963 to 151 instructions. Its two transition stores take 27 instructions each, including the barrier; the call's entry and return are most of the rest, which the step 3 call ABI addresses. `callSum`'s 500 instructions are mostly the general call path (argument and result records), also step 3's scope.
[Warm-call traces](general-runtime-step2b-traces-darwin-arm64-v1.json)

## Octane against Node 26.13.1

Sixteen rotated fresh-process rounds under the shared timing and launch locks on an Apple M5 Max (one-minute load median 3.3, maximum 6.7). Every native inferior reached its entry stop and exited 42. The origin/main and step 2 images are those measured for the step 2 report.

| Program | Node ms/op | origin/main | Step 2 | Step 2b | Step 2b Δ vs step 2, median [IQR] | Step 2b Δ vs origin/main |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Richards | 0.046 | 12.262 | 4.110 | 4.130 | +0.022 [−0.027, +0.043] | −8.127 [−8.236, −8.076] |
| DeltaBlue | 0.065 | 30.536 | 21.779 | 19.411 | −2.423 [−2.603, −2.253] | −11.144 [−11.326, −10.970] |
| NavierStokes | 1.845 | 98.928 | 76.301 | 78.669 | +2.577 [+1.694, +3.477] | −20.319 [−20.902, −19.571] |
| RayTrace | 0.513 | 313.527 | 253.631 | 212.287 | −41.453 [−41.688, −40.641] | −100.917 [−104.679, −99.961] |

Ratios of medians to Node after step 2b: Richards 90×, DeltaBlue 299×, NavierStokes 43×, RayTrace 414×. An earlier run at `04619a2f4` (before the shape key index and primitive receivers; load median 1.8) gave the same picture: DeltaBlue −2.10, RayTrace −40.0, Richards +0.005, NavierStokes +1.71 ms/op against step 2.
[Paired rounds](general-runtime-step2b-octane-darwin-arm64-v1.json) · [Earlier run](general-runtime-step2b-octane-04619a2f4-darwin-arm64-v1.json)

## Generality kernels

Twenty rotated rounds, ns per iteration (one-minute load median 9.5, maximum 18.4; the paired deltas are per round). The kernel file gained three untyped builtin calls: `numberCall` (`Number(i & 7)`), `mathMax` (`Math.max(i & 7, 3)`) and `builtinMethod` (`map.get(i & 3)` on a `Map`). Every image was rebuilt from the same kernel file.

| Kernel | Node | origin/main | Step 1 | Step 2 | Step 2b | Step 2b Δ vs step 2 | Step 2 Δ vs step 1 |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `allocateObjects` | 5.7 | 300.7 | 292.6 | 251.9 | 188.2 | −64.2 [−66.6, −61.9] | −40.2 [−45.0, −39.1] |
| `arguments3` | 2.1 | 65.5 | 52.3 | 52.1 | 49.6 | −2.2 [−3.1, −1.2] | −0.2 [−1.7, +0.6] |
| `arguments4` | 2.3 | 73.2 | 58.4 | 57.4 | 53.9 | −3.9 [−4.4, −2.6] | −0.7 [−2.1, +0.0] |
| `arguments5` | 2.3 | 78.9 | 65.0 | 64.1 | 61.1 | −3.1 [−4.6, −1.9] | −0.7 [−1.5, +0.3] |
| `arguments6` | 2.5 | 86.6 | 69.4 | 70.0 | 67.1 | −3.2 [−4.3, −2.3] | +0.5 [−0.5, +1.5] |
| `buildString` | 9.4 | 29.6 | 22.4 | 22.4 | 19.9 | −2.6 [−3.1, −2.1] | −0.3 [−0.7, −0.0] |
| `builtinMethod` | 4.1 | 268.8 | 266.8 | 244.7 | 99.6 | −145.3 [−155.7, −144.1] | −23.9 [−25.3, −20.9] |
| `catchInLoop` | 3.2 | 46.4 | 39.2 | 40.3 | 39.9 | −0.6 [−1.1, +0.2] | +0.9 [+0.5, +1.1] |
| `concatenateStrings` | 6.6 | 25.4 | 17.1 | 18.4 | 15.6 | −3.0 [−3.4, −2.6] | +1.3 [+0.9, +1.7] |
| `mathMax` | 2.1 | 177.1 | 176.5 | 186.6 | 149.9 | −39.4 [−42.9, −35.5] | +8.9 [+5.5, +11.9] |
| `mixedCall` | 3.5 | 71.2 | 43.2 | 48.7 | 55.5 | +7.0 [+6.0, +7.4] | +5.3 [+4.7, +6.0] |
| `mutableCapture` | 5.0 | 42.9 | 34.8 | 35.8 | 35.5 | −0.2 [−1.1, +0.9] | +0.9 [+0.0, +1.5] |
| `numberCall` | 2.1 | 108.7 | 106.3 | 108.3 | 116.8 | +8.5 [+7.2, +9.5] | +1.7 [−0.3, +2.5] |
| `objectArray` | 2.3 | 38.5 | 33.9 | 21.6 | 20.4 | −1.5 [−2.1, −1.1] | −11.7 [−12.5, −10.7] |
| `objectRoundTrip` | 2.1 | 59.0 | 50.2 | 49.3 | 47.2 | −2.5 [−3.3, −1.4] | −1.2 [−2.4, −0.3] |
| `receivers2` | 4.4 | 85.7 | 79.1 | 61.6 | 59.4 | −2.8 [−3.7, −1.2] | −17.4 [−18.1, −16.1] |
| `receivers4` | 4.5 | 111.7 | 105.9 | 70.4 | 66.0 | −5.0 [−7.7, −3.4] | −35.0 [−36.2, −34.2] |
| `receivers8` | 5.5 | 117.4 | 111.6 | 81.0 | 73.9 | −7.4 [−9.5, −5.8] | −31.7 [−33.8, −29.6] |

The builtin calls remain far from Node: `Number(x)` costs 117 ns against 2.1, `Math.max` 150 against 2.1, `map.get` 100 against 4.1. The step 3 call ABI covers untyped calls of builtins.

An earlier 20-round run at `04619a2f4` on a quieter host (load median 2.4) measured `buildString` +10.4 ns and `charAt` costing ~7,400 instructions per lookup against step 2: fast-mode lookups scanned shape keys, and String.prototype has about fifty. The shape key index and primitive receivers fixed that (`buildString` −2.6 ns now).
[Paired rounds](general-runtime-step2b-generality-darwin-arm64-v1.json) · [Earlier run](general-runtime-step2b-generality-04619a2f4-darwin-arm64-v1.json)

### The step 2 regressions

The quiet run confirmed step 2's regressions against step 1 (`mixedCall` +4.9 ns [4.6, 5.1], `catchInLoop` +0.7 [0.4, 1.1], `mutableCapture` +0.6 [0.1, 1.2]) and added `mathMax` (+8.0). They come from the optimizer, not from the object layout. Step 2 inlines cached global reads (`score`, `mayThrow`, `Math`) as direct record reads in the kernels. `propagate-slot-copies` then refuses the whole function: rewriting a copy slot's loads to its source costs one of those reads its layout proof, and the pass keeps its input whenever any read loses its proof. With the copies kept, the numeric shadows of loop variables (`i % 3`, `i++`) can no longer be proven at their uses, so each iteration tests and unboxes them again. In a probe containing only `mixedCall`, the pass refuses the kernel's closure (439 blocks) at step 2 but not at step 1, and one call (three iterations) executes 106 `general-value` and 54 `general-is` instructions against 30 and 30. Retrying the pass without the copies that feed an unproven read rescued the copies but produced a function whose record read the emitter then rejected, so that change is not in this branch. The fix belongs with the call work: keep the cached global read's facts on its value rather than its slot, or let the copy pass exclude only the affected copies with the emitter's proof.

### Open: `numberCall`, `mixedCall` and NavierStokes

Against step 2, step 2b costs `numberCall` 8.5 ns, `mixedCall` 7.0 ns and NavierStokes 2.6 ms/op (3.4%), in both runs. Instruction counts do not explain the kernels: one `mixedCall` iteration executes 1,835 instructions against 1,843 at step 2, and `Number(i & 7)` 1,661 against 1,644. The straight-line general inlining is not the cause (a build without it executes the same counts). Code and data layout (the object record grew by 10 words; blocks moved) are the remaining candidates; a cycle profile of these kernels comes next.

## Call and loop kernels

Eighteen rotated rounds (load median 1.6). The typed-path kernels are unchanged between step 2 and step 2b (all deltas within ±0.02 µs except `recursive`, +0.25 [−1.21, +0.61]).
[Paired rounds](general-runtime-step2b-kernels-darwin-arm64-v1.json)

## Frozen self-compile

`gr8`, three rotated rounds under the timing lock (load about 2–3), built from `04619a2f4`. The compiler is typed code: step 2b uses 0.2% more, 0.9% fewer and 0.1% more cycles than step 2 per round, and 0.01% fewer instructions; peak RSS is unchanged (2.23 GB). Against step 1, both use 3–4% fewer cycles.

| Image | Cycles (G) | Wall (s) | Instructions (T, median) |
| --- | --- | --- | ---: |
| origin/main | 455.8 · 453.0 · 464.6 | 89.8 · 89.0 · 93.2 | 2.418 |
| Step 1 | 454.6 · 453.3 · 458.3 | 91.0 · 88.8 · 91.3 | 2.372 |
| Step 2 | 435.8 · 437.8 · 446.7 | 85.8 · 85.2 · 90.2 | 2.291 |
| Step 2b | 436.6 · 433.8 · 447.0 | 86.0 · 84.8 · 90.5 | 2.290 |

The `v7` workload was not run for this report; on this branch it still needs `--tree packages/abi/src/host.ts` (the frozen tool fix is routed separately).
[Rounds](general-runtime-step2b-self-compile-darwin-arm64-v1.json)

## Validation

- Unit tests of every package (5,653 passing), the typecheck, formatting, dependency boundaries and the native-subset check of the compiler pipeline.
- Native fixture under LLDB (`tools/native-general-property-caches.test.ts`): nine sections, adding cached stores and transitions (setters and read-only properties appearing on the prototype after caching, frozen and non-extensible receivers in strict code, objects past the in-place values and past 128 keys, prototype objects as receivers, symbols and accessors) and builtin objects (`Math.max`, `Number`, `Map.prototype.get`, `Date.prototype.getUTCFullYear`, `Array.prototype.push`), each compared with Node.
- Lowered-realm tests for cached stores and primitive receivers, checked against Node; runtime tests for storage modes, accessors, symbols, private prototype shapes, the epoch and the store cache.
- Script surface: 155 functions; the shape key index adds one map anchor, and generic specializations stay under the limit (8,145 of 8,192).
- Probe images under LLDB stop at entry and exit 42.
- Unified-pipeline ledger on `dev` (Linux arm64) with `TINT_SOURCE_REPLAY=1 TINT_FUNCTION_FALLBACK=1`: no regressions against step 2's ledger; 47 typed forms stay typed, 97 untyped forms run on the general path and the same two untyped forms fail to run as at step 2. The checkout's dependency install failed inside the container, so its workspace imports resolved to the enclosing worktree's build of the same commit. [Ledger](unified-pipeline-ledger-general-runtime-step2b-d6e4162d9-dev-v1.json)
