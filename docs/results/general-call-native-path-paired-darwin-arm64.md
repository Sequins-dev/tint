# General native calls, property caches and integer element paths

The original eight kernels remain within Node's paired medians. All 15
generality kernels and all four Octane programs are still slower. The
general entry continues to be an ARM64 AOT experiment.

## Paired measurement

Node 26.13.1 and each native Tint image executed the same workload and
checksum in each rotated round, under the shared timing and launch lock.
The original kernels use release native images, and generality and Octane
use matching debug images within each comparison. Each interval brackets
the first and third quartiles of paired differences. Each comparison has
its own contemporaneous Node samples. The Octane manifest pins the
unmodified scripts, upstream revision, source hashes and licence hashes.

## Native entry

The early register-and-stack prototype removes two runtime calls and 51
retired instructions per traced six-argument iteration. That kernel's
paired median improved by 6.021 ns [−7.443, −3.795]. It still took 90.682 ns
against Node's 2.610 ns in that round set. Both native images made zero
managed allocations there. All four Octane intervals cross zero in
18 separate rounds on the later native-entry image. Three general register
arguments are passed in ARM64 register pairs and the rest in the caller's
native stack area. The callee fills missing arguments from the count.
Calls that observe rest or `arguments` materialize an argument list.
Legacy property reflection can read the rooted native argument area while
the frame is live. Foreign Script contexts, spread, proper tail calls,
constructors with special semantics and exotic callable objects retain
general dispatch.

## Named property caches

The generated first cache state checks the receiver and immediate holder
shapes and reads or stores the cached descriptor slot. Secondary states
and the fixed-size global table are probed by a miss stub. Cache misses
no longer allocate prototype shape-chain lists. Shape and descriptor
layouts are still materialized lazily for ordinary objects. Getter,
proxy, deeper prototype and other exotic accesses can use the generic
lookup. The numeric-indexed descriptor table is built lazily for ordinary
objects and invalidated on structural changes.

## Integer element keys

Packed-array reads test the numeric index and bounds before reading
the list. Numeric-key runtime reads and writes avoid string conversion
for integer-indexed ordinary data and dense elements where the runtime can
preserve the original property semantics. Integer-indexed typed arrays
bypass the string conversion and ordinary buffers skip the window record
on reads. Shared reads, wider element decoding and exceptional cases use
the runtime. Proxy and other observable property operations retain
general key conversion and dispatch.

## Frozen v7

The original +25.604 s wall-time estimate did not reproduce in two
rotated 499 Hz pprofessor pairs on the exact images. Their candidate
changes were −31.159 s and −0.697 s. Scoping the literal-tag lowering to
linked Script restored the typed compiler's baseline machine code.
The identical-code control varied by −3.270 s to +32.652 s across
three pairs. The native entry, cache and indexed trials keep
`__text`, `__eh_frame`, `__unwind_info` and `__data` byte-identical.
All verified produced images have SHA-256
`68c11052966f4a851b875c23b6a3413abc74262cec1460532dba09c624d17846`.
The separately paired wall and RSS observations remain in the raw report.

[Matched executable isolation](general-call-frozen-v7-code-isolation-darwin-arm64.md),
[original baseline and candidate profiles](general-call-frozen-v7-paired-profile-darwin-arm64.md)

## Dropped trials

The source-context wrapper bypass still built an argument list and
regressed NavierStokes by 7.972 ms in paired rounds. The native-prologue
hoist increased the six-argument kernel by 6.078 ns. The trial that inlined
the full polymorphic and global table reduced the two-, four- and
eight-receiver kernels by 17.070, 35.846 and 27.908 ns, while increasing
the five-argument and object round-trip kernels by 9.192 and 9.351 ns.
These comparisons used experimental builds. The current generated path
inlines the primary state.

[Source-context trial](general-call-source-context-trial-darwin-arm64.md)

## Whole-program tradeoffs

The primary property cache improved seven generality cases with paired
IQRs entirely below zero. The four- and
eight-shape sites regressed by 11.315 ns and 8.238 ns. The integer path
reduced the allocation-heavy kernel by 58.638 ns per iteration
[−101.923, −23.764]. Its largest whole-program gain was NavierStokes,
with a paired −158.834 ms per operation [−170.359, −108.823]. The
unpaired medians in those rotated rounds were 322.860 ms before the
integer path, 154.598 ms after, and 2.993 ms in Node.

The compact storage representation also restored the managed compiler
specialization budget. The first cache layout introduced additional
collection providers and hit the existing 8,192-specialization limit.
The selected representation reuses the descriptor records and numeric
storage already available in the managed runtime. The limit is unchanged.

## DeltaBlue prototype chains

The immediate-holder cache regressed DeltaBlue by a paired median of
19.179 ms per operation [12.116, 26.210]. The original runtime cached
arbitrary prototype depths and allocated a shape list at installation.
DeltaBlue's inherited methods can have three prototype links between
the receiver and holder. The immediate-holder replacement sends those
reads into the generic lookup.

Two rotated 997 Hz pprofessor captures isolated DeltaBlue's timed window
for each build. The table reports the flat share of sampled CPU in
named lookup, hash and map helpers, and in sparse-list helpers. The absolute
sampled CPU times varied across captures. The timings below come from
separate matched rounds.

| Build                                       | Generic property, hash and map helpers | Sparse-list helpers |
| ------------------------------------------- | -------------------------------------: | ------------------: |
| Before the generated cache                  |                           7.16%, 8.22% |      19.08%, 18.04% |
| With the immediate-holder cache             |                         11.53%, 13.90% |      21.19%, 22.31% |
| With the compact cache and integer elements |                         12.71%, 12.11% |      24.13%, 23.79% |

The inline three-link trial stored both intermediate shape guards in the
cache entry. It reduced DeltaBlue by 13.829 ms [−14.209, −13.681], and
increased Richards by 0.111 ms [0.027, 0.199]. All original kernel
comparisons with the preceding Tint build crossed zero. Four generality
kernels regressed with IQRs above zero. The four- and eight-shape sites
slowed by 11.993 and 14.181 ns. The native fixture verified shadowing,
intermediate prototype replacement and abrupt getters.

Keeping the three-link probe in the miss stub eliminated the measurable
object-array and object round-trip regressions in its 18-round comparison.
The two-, four- and eight-receiver sites still regressed by 5.278, 6.482
and 4.958 ns. Their respective intervals were [1.718, 6.256],
[4.547, 10.330] and [1.630, 7.700].

The miss-stub trial kept the DeltaBlue gain. A separate 18-round comparison
measured a paired −13.497 ms [−18.848, −12.771]. The other three Octane
intervals crossed zero. This is the selected prototype-cache layout.
Generated loads use the existing primary shape and offset check for own and
immediate-prototype properties. Deeper data properties are cached in the
stub with up to two intermediate shapes stored in the same fixed entry.
The three measured receiver regressions remain.

## Work remaining in the timed programs

These additional 997 Hz profiles capture each timed window in the compact
storage build immediately before the three-link miss stub. They identify
the largest sampled work in those images. Timing comparisons use the
separate unprofiled runs.

| Program      | Sampled CPU | Largest individual operations                                                                                                                                             |
| ------------ | ----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Richards     |      604 ms | Loose equality 14.27%, sparse-list read 10.29% and leaf search 7.47%, object projection 5.32%. Cache lookup and cell guards together account for 7.13%.                   |
| DeltaBlue    |     1329 ms | Cache lookup 9.58%, sparse-list leaf search 9.50%, read 7.24% and value access 5.05%. Generic property maps, hashing and descriptor reads also remain.                    |
| NavierStokes |      361 ms | Program closure at source offset 5037 38.08%, object projection 8.07%, indexed writes 7.50%, packed write helper 6.67%. Integer-to-decimal conversion accounts for 1.94%. |
| RayTrace     |     3721 ms | Sparse-list leaf search 6.44%, writes 5.39% and reads 5.09%, property map search 5.23%, cache lookup 4.82% and hashing 4.72%.                                             |

The inline packed write trial ran on the inline three-link build. It
saved 2.890 ms in NavierStokes [−3.922, −1.519] and the other intervals
crossed zero. This generated-store trial remains unselected. The
retained numeric write uses the runtime fast path.

## Selected build results

The selected prototype-cache source is commit `84873b2b7`. Its production
snapshot matches the timed manifests
(`b9773be9e6e0d000b3ca1613a9e36d0404c8d3aa840b808a9d4b42a155738bbc`,
821 files). Tests updated after image preparation affect the source
patch fingerprint in the prepared file. The production manifest identity
matches the recorded revision.

The final V7 pair measured 92.174 s for the baseline and 73.466 s for this
candidate, with candidate peak RSS 606,208 bytes higher. The four
non-debug Mach-O sections matched byte for byte and both compilers
produced the same frozen output. The sampled results are timed observations
of the same compiler machine code.

[Complete rotated samples, machine sections and grouped profiles](general-call-native-path-paired-darwin-arm64.json),
[compact-build instruction and allocation traces](general-call-compact-storage-traces-darwin-arm64.md),
[traces at preceding stages](general-call-native-path-traces-darwin-arm64.md)

### Original kernels

16 rounds, nanoseconds per iteration.

| Workload       |    Node | Prior Tint | Candidate Tint |     Paired Δ from prior |            Paired Δ from Node |
| -------------- | ------: | ---------: | -------------: | ----------------------: | ----------------------------: |
| array          |   2.301 |      2.093 |          1.975 | -0.064 [-0.220, -0.002] |       -0.254 [-0.388, -0.077] |
| closure        |   6.057 |      2.740 |          2.654 |  -0.108 [-0.251, 0.103] |       -3.140 [-4.112, -2.102] |
| control        |   5.005 |      0.201 |          0.202 |  -0.002 [-0.021, 0.018] |       -4.804 [-5.363, -3.558] |
| method         |   6.102 |      2.680 |          2.511 |  -0.135 [-0.217, 0.036] |       -3.381 [-3.752, -2.548] |
| property       |   2.221 |      1.369 |          1.332 |  -0.080 [-0.130, 0.040] |       -0.856 [-1.034, -0.743] |
| recursive      | 298.937 |    129.875 |        127.250 | -2.198 [-10.865, 5.781] | -161.156 [-184.057, -151.515] |
| rest           |  11.820 |      0.865 |          0.858 |  -0.036 [-0.075, 0.062] |     -10.893 [-11.819, -9.509] |
| stringEquality |   2.610 |      1.389 |          1.315 |  -0.048 [-0.189, 0.046] |       -1.273 [-1.454, -1.021] |

### Generality kernels

18 rounds, nanoseconds per iteration.

| Workload           |   Node | Prior Tint | Candidate Tint |     Paired Δ from prior |         Paired Δ from Node |
| ------------------ | -----: | ---------: | -------------: | ----------------------: | -------------------------: |
| allocateObjects    |  6.778 |    309.832 |        306.696 | 0.669 [-10.340, 12.880] | 300.099 [293.186, 313.569] |
| arguments3         |  2.552 |     60.708 |         58.996 |  -1.539 [-3.566, 1.068] |    56.755 [54.820, 57.407] |
| arguments4         |  2.493 |     70.654 |         70.098 |   0.780 [-3.045, 3.527] |    67.708 [65.688, 71.309] |
| arguments5         |  2.776 |     83.658 |         79.844 |  -1.823 [-4.889, 1.299] |    77.076 [75.970, 79.483] |
| arguments6         |  2.832 |     94.304 |         90.340 |  -1.094 [-6.786, 0.072] |    87.330 [84.578, 92.469] |
| buildString        | 10.539 |     36.623 |         36.818 |   0.165 [-0.747, 1.985] |    26.572 [24.981, 27.676] |
| catchInLoop        |  3.632 |     43.793 |         42.414 |  -1.020 [-1.887, 0.502] |    38.643 [37.470, 40.599] |
| concatenateStrings |  7.310 |     33.983 |         33.073 |  -0.534 [-1.435, 0.912] |    25.419 [24.788, 26.296] |
| mixedCall          |  3.991 |     72.216 |         73.628 |   0.761 [-0.420, 4.628] |    69.552 [66.979, 72.851] |
| mutableCapture     |  6.044 |     43.559 |         43.396 |  -0.117 [-1.246, 1.239] |    37.028 [36.348, 38.692] |
| objectArray        |  2.618 |     44.930 |         45.404 |   0.992 [-0.150, 1.736] |    42.869 [41.307, 44.472] |
| objectRoundTrip    |  2.295 |     56.523 |         55.934 |  -0.469 [-2.696, 2.590] |    53.459 [51.962, 56.447] |
| receivers2         |  5.271 |     80.286 |         83.928 |    5.278 [1.718, 6.256] |    78.374 [76.456, 80.265] |
| receivers4         |  5.150 |    114.623 |        120.369 |   6.482 [4.547, 10.330] | 115.398 [111.628, 119.894] |
| receivers8         |  6.181 |    124.216 |        127.623 |    4.958 [1.630, 7.700] | 121.399 [119.129, 125.505] |

### Unmodified Octane programs

18 rounds, milliseconds per operation.

| Workload     |  Node | Prior Tint | Candidate Tint |        Paired Δ from prior |         Paired Δ from Node |
| ------------ | ----: | ---------: | -------------: | -------------------------: | -------------------------: |
| Richards     | 0.048 |     12.802 |         12.852 |      0.087 [-0.545, 0.444] |    12.806 [12.080, 14.784] |
| DeltaBlue    | 0.071 |     45.106 |         31.315 | -13.497 [-18.848, -12.771] |    31.236 [29.135, 36.522] |
| NavierStokes | 1.878 |    103.155 |        105.063 |     -0.046 [-1.845, 2.401] |  103.248 [99.253, 119.389] |
| RayTrace     | 0.529 |    325.049 |        322.905 |      0.893 [-5.776, 2.802] | 322.404 [313.129, 370.157] |

## Validation

The selected source passed 95 focused tests. The concurrent workspace
gate passed 6,096 tests and skipped one. The managed Script surface
compiled within the existing specialization budget. The ARM64 native
boundary fixture reached entry under LLDB and exited 42 after testing
prototype-chain mutation, typed-array boundaries, bound and proxy calls,
and abrupt argument evaluation.

The cross-realm fixture records six completions and one intentional
proposal difference. The older fixture expects ES2025 to allow adding
private elements to a nonextensible receiver. The runtime implements
`nonextensible-applies-to-private` and throws a TypeError in that case.
The proposal implementation matches main.
[Native realm boundary outcomes](general-call-deep-prototype-boundaries-darwin-arm64.json)

The Linux arm64 gate on the selected production snapshot produced
byte-identical stages 1, 2 and 3. Both the earlier integer-element stage
and the selected prototype miss stub ran the full 200-form ledger.
Each matched the baseline path and outcome for all 200 forms. There were
193 passes, four build failures, one run failure and two unsupported
forms in each report.
[Integer-element ledger](unified-pipeline-ledger-general-calls-native-paths-4a27a57fd-dev-v1.json),
[selected source ledger](unified-pipeline-ledger-general-calls-deep-prototype-dev-v1.json)

The frozen opt-in native Test262 rerun used the preceding integer-element
snapshot `4a27a57fd`. The suite images passed 758/758 loop variants,
171/171 call-expression variants and 90/90 `Function.prototype.call`
variants. Every requested identity and harness hash matches the prior
full selection. Each journal ends with a terminal completion record.
[Loop report](test262-general-native-paths-for-darwin-arm64.json),
[call expression report](test262-general-native-paths-language-call-darwin-arm64.json),
[Function.prototype.call report](test262-general-native-paths-function-prototype-call-darwin-arm64.json),
[validation audit](general-call-native-path-validation-audit-darwin-arm64.json)
