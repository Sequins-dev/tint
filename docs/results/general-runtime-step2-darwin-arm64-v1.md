# General runtime step 2 · shapes, inline property caches and block layout on Darwin arm64

Step 2 of the [general runtime re-architecture](../design-general-runtime-rearchitecture.md) gives ordinary objects shared shapes with their first cells in place, reads cached properties inline and lays blocks out for fallthrough. A warm `p.x` read function executes 115 instructions (2,889 at origin/main) and a warm `this.x + this.y` method 200 (475). In paired rounds against step 1, Richards drops from 10.5 to 4.4 ms/op, DeltaBlue from 34.0 to 23.7 and RayTrace from 353 to 284. The frozen self-compile uses 5 to 7% fewer cycles than at step 1. Tint remains 41× (NavierStokes) to 470× (RayTrace) slower than Node 26.13.1.

## Changes

- **Shapes on the object.** An ordinary object's first field is its shape, a node of a per-prototype transition tree keyed by key and kind (accessor, writable data, read-only data). Its first eight descriptor cells are in place (`internalSlot0..7`), later ones in `internalCells`. A matching shape proves the prototype, the keys and each cached cell's kind. A redefinition that changes a kind, a deletion or a prototype change discards the shape for a rebuild. Cells enter the in-place slots only after a layout test (`propertyCellLayout`, bound to a header comparison), so structurally typed descriptors of another layout never reach the inline path.
- **Inline caches.** A new IR instruction, `property-cell`, tests the object tag, compares the receiver's first word with the site's shape and loads the cell at the site's word index. Its inherited form then compares the receiver's prototype's shape with the site's holder shape and loads from the prototype. AArch64 and x86-64 emit it inline; the own form uses x9..x12 only. The runtime's `cachedOwnPropertyCell` and `cachedInheritedPropertyCell` are bound to it, and a present cell's `value` is read without a header check. Each site holds an own entry and an immediate-prototype entry, each refreshed from the newest miss-path entry of its kind. A method call (`o.m()`) tries the prototype's cell, then the receiver's; other reads and writes use the receiver's. Deeper prototypes and cells past the in-place slots take the existing miss path.
- **Megamorphic sites.** After a site's four entries, lookups use the per-agent 256-bucket `(shape, name)` stub cache, whose hits allocate nothing. The native cache fixture now drives one site through twelve shapes with mutations.
- **Inline global reads and sloppy receivers** (earlier step 2 commits): a warm cached global binding reads its cell inline, and an object receiver of a sloppy function skips `sloppyCallReceiver`.
- **Block layout.** A final IR pass orders each function's blocks in chains so a block is followed by its jump target, the success edge of a record or cell access, or a branch's earlier non-cold successor; trap and throw blocks go last. The `x != null` loop test from step 1 is now `ldr; cmp; ccmp; b.ne` with no unconditional branch on either edge.
- **`[[IsHTMLDDA]]` capability.** The skipped brand check in `x == null` is the named `htmlDDAObjects` lowering option. The Test262 host declares it, and general programs and the benchmark host do not. A native fixture shows the refusal when they are mismatched ([details](../test262-runner.md#the-ishtmldda-host-capability)).

## Instruction budgets

Instructions are counted on the hit path with the receiver's general value and the site in registers.

| Operation | Sequence | Count | Budget |
| --- | --- | ---: | ---: |
| Own read `o.x` | `cmp tag, #5` · `b.ne` · `ldp shape, index, [site]` · `ldr [obj]` · `cmp` · `b.ne` · `ldr cell, [obj, index, lsl #3]` · `ldp value, [cell]` | 8 | 8 |
| Inherited method `o.m` | the own sequence's first six, then `ldr proto` · `ldr holder shape, [site]` · `ldr [proto]` · `cmp` · `b.ne` · `ldr cell, [proto, index, lsl #3]` · `ldp value, [cell]` | 13 | 12 |
| Own method `o.m` | the inherited sequence's first six (receiver shape mismatch), then the own read | 14 | — |

The inherited lookup is one instruction over budget. The receiver's shape and prototype are adjacent fields, so one `ldp` could load both, but only if every record a tag-5 value can hold has two payload words. Caching the holder object beside its shape in the site would also save the load, at the cost of sites retaining prototypes. Neither is in this step.

The emitted code also loads the receiver's two words and the site from the frame when they are not in registers (up to three loads), branches over the one-instruction miss path (`b`), and still materializes the presence test and the optional unwrap of the cell around the instruction (three to six instructions). In `readX` the whole property read, from loading the receiver's tag to storing the value in its frame slot, executes 23 instructions. Fusing the presence branch into `property-cell` and keeping values in the object rather than in descriptors would remove that glue and the descriptor load; the object constructor path (below) needs the latter anyway.

## Warm calls

Each row counts the instructions one warm call (the 501st) executes from entry to return, callees included, single-stepped under LLDB with `tools/general-call-bench/count_call.py`. The images are untyped general programs built with the same options.

| Probe function (source) | origin/main | Step 1 | Step 2 |
| --- | ---: | ---: | ---: |
| `readX(p)`: `return p.x` | 2,889 | — | 115 |
| `Point.prototype.sum`: `return this.x + this.y` | 475 | — | 200 |
| `Point(x, y)`: `this.x = x; this.y = y` | 12,259 | — | 11,549 |
| `probeNull(x)`: `if (x == null) n = 1` | 1,274 | 63 | 63 |
| `probeNe(x)`: `while (x != null) { n++; x = x.next }`, three steps | 3,461 | 532 | 259 |
| `probeLt(a, b)`: `if (a < b)` on numbers | 144 | 101 | 98 |
| `probeAnd(s, m)`: `(s & m) != 0` on numbers | 713 | 157 | 154 |
| `probeSum(values, n)`: four elements | 1,611 | 1,306 | 1,194 |

A constructor that adds two properties still takes 11,549 instructions. The adds go through `setProperty`, `ordinaryGetOwnProperty`, `applyDescriptor` and the property map's hashing, about 3,300 of them in `LinkedMap` lookups and string hashing, which read caches cannot reach. In-object values with a transition store cache are the step that removes them.
[Warm-call traces](general-runtime-step2-traces-darwin-arm64-v1.json)

## Octane against Node 26.13.1

Sixteen rotated fresh-process rounds under the shared timing and launch locks on an Apple M5 Max (one-minute load median 6.3, maximum 14.7). Every native inferior reached its entry stop and exited 42. The step 1 image is the one measured for the step 1 report.

| Program | Node ms/op | origin/main | Step 1 | Step 2 | Step 2 Δ vs step 1, median [IQR] | Step 2 Δ vs origin/main |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Richards | 0.072 | 14.099 | 10.500 | 4.425 | −6.052 [−6.857, −5.659] | −9.418 [−10.229, −8.435] |
| DeltaBlue | 0.077 | 35.247 | 33.954 | 23.748 | −9.407 [−11.862, −8.311] | −11.042 [−13.747, −9.023] |
| NavierStokes | 2.027 | 111.557 | 84.164 | 82.683 | −3.354 [−10.671, +1.131] | −27.620 [−34.274, −21.942] |
| RayTrace | 0.604 | 360.090 | 353.316 | 284.172 | −53.566 [−80.156, −27.028] | −62.649 [−76.224, −56.754] |

Ratios of medians to Node after step 2: Richards 61×, DeltaBlue 308×, NavierStokes 41×, RayTrace 470×. NavierStokes reads arrays and numbers rather than named properties, so step 2 leaves it within noise.
[Paired rounds](general-runtime-step2-octane-darwin-arm64-v1.json)

## Call, loop and generality kernels

- Call and loop kernels, 21 rotated rounds (seven engines: Node and the three trees' typed and untyped images; load median 5.6): the `array` kernel improves in both forms against step 1 (untyped −0.131 ns [−0.238, −0.047], typed −0.261 [−0.316, −0.149]), and every other kernel's paired IQR spans zero. Typed images change deliberately with the block layout.
  [Paired rounds](general-runtime-step2-kernels-darwin-arm64-v1.json)
- Generality kernels, 16 rotated rounds (load median 5.1). Receiver-polymorphic calls, object arrays and allocation improve most. `catchInLoop`, `mixedCall` and `mutableCapture` regress against step 1 by 1.9, 5.0 and 1.1 ns, with IQRs above zero, while staying 5 to 24 ns faster than origin/main. They read no named properties. Their callees execute fewer instructions than at step 1 (`score` 86 against 88, `mayThrow` 191 against 195). Two paired 15-round checks against the step 2 images find no difference beyond noise for any kernel: one without the block layout pass (load median 13.1, so its IQRs are wide), and one with the in-place cells moved to the end of the object record so the call path's fields keep their step 1 offsets (load median 7.5). ([Without layout](general-runtime-step2-generality-without-layout-darwin-arm64-v1.json), [cells last](general-runtime-step2-generality-cells-last-darwin-arm64-v1.json); neither change is kept.) The cause is still open.

| Kernel (ns per iteration) | Node | origin/main | Step 1 | Step 2 | Step 2 Δ vs step 1, median [IQR] |
| --- | ---: | ---: | ---: | ---: | --- |
| allocateObjects | 6.272 | 306.725 | 296.346 | 259.737 | −40.245 [−45.725, −29.449] |
| arguments3 | 2.189 | 66.710 | 53.870 | 51.784 | −3.123 [−3.826, −1.454] |
| arguments4 | 2.470 | 74.425 | 59.804 | 58.660 | −1.466 [−2.288, −0.386] |
| arguments5 | 2.459 | 81.839 | 65.781 | 65.406 | −0.845 [−2.498, +0.493] |
| arguments6 | 2.517 | 92.223 | 73.125 | 71.730 | −2.319 [−5.076, +0.375] |
| buildString | 9.592 | 31.549 | 23.215 | 22.738 | −0.366 [−1.104, +0.332] |
| catchInLoop | 3.478 | 47.033 | 39.721 | 41.576 | +1.912 [+1.050, +3.064] |
| concatenateStrings | 6.748 | 26.671 | 17.383 | 16.749 | −0.592 [−1.052, −0.195] |
| mixedCall | 3.712 | 74.428 | 45.679 | 50.396 | +5.017 [+3.746, +7.950] |
| mutableCapture | 5.351 | 44.759 | 35.407 | 36.332 | +1.080 [+0.460, +2.458] |
| objectArray | 2.349 | 40.662 | 34.337 | 22.885 | −10.959 [−11.785, −9.506] |
| objectRoundTrip | 2.112 | 60.448 | 52.846 | 51.581 | −0.703 [−2.606, +0.542] |
| receivers2 | 4.696 | 89.505 | 81.213 | 65.191 | −16.970 [−19.111, −13.609] |
| receivers4 | 4.617 | 114.756 | 108.158 | 71.882 | −34.897 [−36.984, −33.870] |
| receivers8 | 5.771 | 121.781 | 115.472 | 82.035 | −32.267 [−34.771, −30.803] |

[Paired rounds](general-runtime-step2-generality-darwin-arm64-v1.json)

## Native self-compile

The workload frozen at origin/main `3d10cb5c0` (`gr8`) compiled itself with images built by each toolchain with the same options, in three interleaved rounds under the timing lock. The final head's image is byte-identical to the `5c0304f4b` image measured here (the later change is confined to the untyped lowering).

| Image | Cycles (G) | Wall (s) | Instructions (T, median) | Peak RSS |
| --- | --- | --- | ---: | --- |
| origin/main | 493.7, 493.2, 472.8 | 103.5, 102.3, 94.4 | 2.422 | 2.228 GB |
| Step 1 | 473.2, 486.3, 475.1 | 95.2, 105.5, 98.2 | 2.374 | 2.226–2.228 GB |
| Step 2 | 438.8, 450.5, 449.4 | 86.0, 94.6, 90.6 | 2.291 | 2.226–2.227 GB |

Per round, step 2 uses 7.3%, 7.4% and 5.4% fewer cycles than step 1 and retires 3.5% fewer instructions (5.4% fewer than origin/main); peak RSS is unchanged. The compiler is typed code, so the gain comes from the block layout.
[Self-compile rows](general-runtime-step2-self-compile-darwin-arm64-v1.json)

## Validation

- Unified pipeline ledger on the Linux dev machine with `TINT_FUNCTION_FALLBACK=1 TINT_SOURCE_REPLAY=1`: no regressions against step 1 (typed forms: 47 typed, 10 mixed, 37 general; untyped: 97 general, 2 run-failed as before). [Ledger](unified-pipeline-ledger-general-runtime-step2-5c0304f4b-dev-v1.json)
- Native fixtures under LLDB: property caches across shared and diverging shapes, offsets past the in-place slots, inherited methods, redefinitions, accessors, prototype changes and a megamorphic site; general numbers; counted loops; early exits; list reads; captured loop values; the `[[IsHTMLDDA]]` capability.
- CI runs the macOS arm64, Linux x86-64 and Linux arm64 gates on each pushed head: `459fb30bb` passed all three (including the macOS bootstrap, stage 2 = stage 3 and Test262 smoke). The final head adds the method-site change.
