# General runtime step 3 · native entries, construction, tail calls and forwarding on Darwin arm64

Step 3 of the [general runtime re-architecture](../design-general-runtime-rearchitecture.md) gives every ordinary compiled JavaScript function a native script entry on aarch64 targets and calls it directly: activation records in the frame replace per-call heap bookkeeping, `new` of an ordinary constructor runs the entry with a new object, strict tail calls replace the frame, and `f.apply(thisArg, arguments)` forwards the actuals. A two-argument call takes 383 instructions (928 at the base), a method call 334 (926), a strict tail call 371 (1,151) and `new` 1,203 (3,767). **Step 3 missed its warm-call budget:** the design set at most 60 instructions for a warm method call, and the measured 334 is 5.6× that (see "Warm calls" for where they go). Call-heavy generality kernels run in 40–55% less time; the call/loop kernels are unchanged. Tint remains 2–61× slower than Node 26.13.1 on the generality kernels (2× on the string kernels, 61× on `mathMax`). Octane and the frozen self-compile were not measured in this run (see "Not measured").

Base: `67f70313a` (step 2b and the copy-chain fix). Step 3: `cc8183536` for the timed runs; the warm-call traces use the `ce43707d5` tree (one active-context read per activation, otherwise identical).

## Changes

- **The step 2 regression** (`67f70313a`): slot copy propagation rewrote loads one hop at a time, so a descriptor check and the read it guards could end up on different slots of one copy chain; the read lost its proof and the whole function's rewrite was discarded. Copies are now processed before their sources and rewritten loads count as loads of their new slot, so chains resolve to their root. On the generality kernels the pass refuses 0 functions (269 before) and rewrites 39,317 loads (27,244).
- **Activation records** (`687508045`): a native entry links a 32-byte record (previous record, frame pointer and kind, callee) into its frame through a new hosted-context word, and unlinks it on every return. Stack traces and legacy `caller`/`arguments` merge records with the remaining heap frames by stack position ([design](../design-general-runtime-rearchitecture.md#activation-records)).
- **Native entries by default** (`cc8183536`, `ce43707d5`): on aarch64 targets (`TINT_NATIVE_SCRIPT_CALLS` overrides). Call sites compare the callee's execution context record with the active one, read once per activation; functions, modules and built-ins share records so identity usually decides. Ordinary constructors run their entry after creating the object from a cached `prototype` read. Strict tail calls jump to a native callee's entry (frame and record popped) when the caller was called with actual operands and the callee takes register actuals; other tail calls keep a bounded stack through the existing trampoline. A function whose `arguments` only feed `f.apply(thisArg, arguments)` forwards its actuals when `apply` is the intrinsic and creates the object only for other uses ([design](../design-general-runtime-rearchitecture.md#native-entry-calls-construction-and-tail-calls)).

## Warm calls

One warm call (the 501st), entry to return with callees, single-stepped under LLDB (`tools/general-call-bench/count_call.py`); probe and per-symbol counts in [the traces](general-runtime-step3-traces-darwin-arm64-v1.json).

| Probe function | Base | Step 3 |
| --- | ---: | ---: |
| `caller(a, b)`: `const r = add(a, b); return r` | 928 | 383 |
| `method(o)`: `const r = o.get(); return r` | 926 | 334 |
| `tail(a, b)`: `return add(a, b)` (strict) | 1,151 | 371 |
| `make(v)`: `const b = new Box(v); return b` | 3,767 | 1,203 |

At the base, a call ran through `callRegisterObjectValue`, the register entry's closure and four bookkeeping helpers (688 of `caller`'s 928 instructions). At step 3 `caller` executes no runtime call. Of the method call's 334 instructions, about 70 are the lowered entry guard (object view, optional unwraps, checked reads of the register entry), 35 the call sequence, 50 the callee's frame setup and return and 15 the caller's return. **Budget missed:** step 3's budget was at most 60 instructions for a warm method call; 334 is 5.6× over. The guard and the frames are the remaining distance, and the frames overlap step 4 (register allocation and inlining).

## Generality kernels

18 paired rounds, nanoseconds per iteration, medians; Apple M5 Max ([data](general-runtime-step3-generality-darwin-arm64-v1.json)).

| Kernel | Node | Base | Step 3 | Step 3 − base (median [q1, q3]) |
| --- | ---: | ---: | ---: | ---: |
| `allocateObjects` | 5.62 | 177.83 | 156.87 | -20.96 [-23.58, -19.43] |
| `arguments3` | 2.22 | 45.87 | 23.78 | -22.23 [-22.71, -21.41] |
| `arguments4` | 2.28 | 49.42 | 28.71 | -20.64 [-21.74, -20.08] |
| `arguments5` | 2.26 | 52.99 | 35.40 | -17.52 [-18.51, -16.87] |
| `arguments6` | 2.46 | 59.71 | 43.74 | -15.79 [-16.79, -14.79] |
| `buildString` | 9.21 | 18.08 | 18.16 | +0.06 [-0.07, +0.19] |
| `builtinMethod` | 4.07 | 94.73 | 84.33 | -10.24 [-11.31, -10.12] |
| `catchInLoop` | 3.24 | 37.56 | 21.20 | -16.60 [-16.92, -16.07] |
| `concatenateStrings` | 6.60 | 13.85 | 13.82 | -0.06 [-0.53, +0.23] |
| `mathMax` | 2.12 | 139.54 | 129.51 | -9.68 [-12.04, -8.92] |
| `mixedCall` | 3.52 | 41.37 | 21.17 | -20.10 [-20.68, -19.91] |
| `mutableCapture` | 5.05 | 33.99 | 15.85 | -18.10 [-18.78, -17.64] |
| `numberCall` | 1.88 | 111.17 | 99.97 | -11.28 [-12.17, -10.43] |
| `objectArray` | 2.18 | 16.54 | 15.43 | -1.13 [-1.28, -1.03] |
| `objectRoundTrip` | 2.01 | 38.87 | 18.66 | -20.28 [-20.52, -19.69] |
| `receivers2` | 4.44 | 55.31 | 34.13 | -22.40 [-23.28, -20.22] |
| `receivers4` | 4.44 | 61.63 | 40.72 | -21.29 [-21.85, -20.24] |
| `receivers8` | 5.53 | 68.42 | 48.25 | -20.16 [-21.22, -19.75] |

`numberCall`, `mathMax` and `builtinMethod` call builtins through the general path; their inline intrinsics are step 5a's (a separate stream), so builtin native entries wait for it. `allocateObjects` is dominated by allocation (step 4).

## Call/loop kernels

20 paired rounds, nanoseconds per iteration ([data](general-runtime-step3-kernels-darwin-arm64-v1.json)). These kernels already use specialized numeric paths; step 3 leaves them unchanged within noise, and untyped Tint stays ahead of Node on all eight.

| Kernel | Node | Base untyped | Step 3 untyped | Base typed | Step 3 typed | Step 3 − base (median [q1, q3]) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `array` | 2.02 | 1.60 | 1.60 | 1.24 | 1.26 | -0.01 [-0.02, +0.01] |
| `closure` | 4.73 | 2.41 | 2.39 | 2.10 | 2.10 | -0.03 [-0.06, +0.01] |
| `control` | 3.89 | 0.18 | 0.18 | 1.18 | 1.17 | +0.00 [+0.00, +0.01] |
| `method` | 4.32 | 2.29 | 2.31 | 2.23 | 2.25 | +0.02 [-0.03, +0.06] |
| `property` | 1.82 | 1.18 | 1.21 | 1.18 | 1.18 | +0.02 [+0.00, +0.07] |
| `recursive` | 231.89 | 113.97 | 114.86 | 114.02 | 113.60 | +0.52 [-0.17, +1.54] |
| `rest` | 8.85 | 0.77 | 0.77 | 19.64 | 19.44 | +0.00 [-0.00, +0.01] |
| `stringEquality` | 2.28 | 1.19 | 1.18 | 1.18 | 1.18 | -0.00 [-0.01, +0.00] |

## Not measured

The paired Octane set (15 rounds) and the frozen v7 self-compile (15 rounds, `--runtime-tree`) for `cc8183536` were queued on the shared timing-and-launch lock from 00:37 and did not start: other delegates' timed runs held the launch lock throughout, and the combined request did not acquire both locks. The first attempt was stopped with its driver after two hours (its empty log is kept as evidence); a second request is queued. Images: `prep3-octane-*.json` and `native-base-67f70313a` / `native-step3-cc8183536` in `.tint-bootstrap/workload-v7`. They will be a separate report.

## Validation

- Unit suites (IR, codegen, ts-native, typescript, js-engine, js-runtime): 4,376 pass. Native subset check and stage-1 bootstrap pass.
- Native fixtures: `native-script-cases` (activation records, 100,000-deep tail recursion through every path, forwarding against Node's observations, and the IsHTMLDDA cases, sharing one Script-runtime image), `general-call-loop-fixture`, `native-general-property-caches`, `native-general-numbers`.
- CI: Linux x86-64 and arm64 pass on `ce43707d5` and `e23f1142a`. On both, the macOS native batch exceeded its 3,600 s watchdog: the new call fixtures built Script-runtime images of their own (five, then one) beside the IsHTMLDDA fixture's, and each such build holds the gate's single memory slot for about 16 minutes on the runner. The call cases now run in the IsHTMLDDA fixture's image, so the batch builds as many Script-runtime images as before step 3.
