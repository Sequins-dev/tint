# Parallel and bounded-memory AOT compilation

Approved for experimentation. The stage and ownership model below guides
the prototypes. Measured native wall time decides which changes to retain.

## Outcome

PR #9 shipped reuse of LICM record proofs and skipping settled SSA joins. This PR
records the worker and storage experiments. The measurements used frozen
compiler and program snapshots, including the serial optimizer from PR #9.
[Serial optimizer measurements](results/optimizer-serial-v1.md)

The integrated worker prototype prelaunched a native Worker host and
published packed function packets for selected late array-access jobs.
Workers returned instruction positions and interval facts. The
coordinator applied them to the original functions in pass order and ran
the full inline analysis when a plan was unavailable. The prototype
reproduced the reference images at requested widths 1, 2 and 6. Both arm64
hosts reached the stage 2 and stage 3 fixed point.
[Native fixed point and Object fallback](results/parallel-bounded-compile-array-plan-verification-v1.md)

The worker variants stayed experimental. The full codegen pools raised
peak RSS or had mixed throughput. The late array-access worker kept
aggregate RSS within 18 MiB of the control in the same-compiler trials.
The Linux rotation lost wall time in both orders. The macOS pair saved
wall time and spent longer in the affected pass. The complete Object image
matched with the worker result absent. Reducing Object peak memory
continues as follow-up work.
[Same-compiler Linux rotation](results/parallel-bounded-compile-array-plan-isolated-linux-v1.md) ·
[Same-compiler macOS pair](results/parallel-bounded-compile-array-plan-isolated-macos-v1.md)

The live register-home trace places most of the critical path in frame
discovery and worker computation. Host entry and isolate launch took
about 16 ms after process spawn. The coordinator spent 0.51 s scanning,
encoding, copying and publishing 44.8 MB of inputs, and then waited
9.76 s after the last publication. Two batches accounted for 54% of the
worker kernel time. The captured direct-call graph also puts 96.7% of
emission operations in one closed component, so independent module
groups would need cross-group summaries to distribute the bulk of the work.
[Native transport timeline and granularity census](results/parallel-bounded-compile-native-transport-timeline-v1.md)

Starting the register-home pool before parsing and caching its tables
removed startup and repeated table setup from later requests. Read-only
file mappings avoided the worker input copy. Mapped mode used all
5,910 plans and reproduced the serial ELF. Its peak was 4.94 GiB,
compared with 2.00 GiB for the inline control. The coordinator's
decoded module and the workers' analysis heaps were resident together.
[Early and mapped register-home variants](results/parallel-bounded-compile-mapped-register-homes-v1.md)

Early mapped SSA workers returned only changed bodies. Keeping the
original references for unchanged bodies reproduced the full serial
ELF. The first sidecar attempt had a `.text` section 32 bytes larger.
The two-worker run used 21.4 MiB more peak RSS. The pass took 14.66 s
versus 9.17 s inline, with 10.94 s of handoff and wait after packing.
[Mapped SSA and unchanged body identity](results/parallel-bounded-compile-mapped-ssa-v1.md)

Shared packed codegen ranges with compact liveness took 62.67 s versus
100.09 s in Node stage replays using the same liveness representation.
The merged output matched and peak RSS rose from 2.30 GiB to 3.30 GiB.
A 384 MiB old-generation allowance per worker left peak RSS 40.0%
above the compact serial control.
[Packed codegen and compact liveness](results/parallel-bounded-compile-packed-fragment-workers-v1.md)

The measured pools remain experimental and this PR stays in draft. A
native backend candidate needs packed bodies as the stage's primary
representation, with the coordinator releasing the decoded module before
worker scratch grows. Workers would use shared prepared facts, fuse
function frame planning and emission, and return ordered fragments for
canonical placement. The Worker runtime now supports typed shared
buffers and separate generational heaps. The prototype keeps detached
execution behind the fragment plan's optional executor.

The November 22 experiments estimated a 14.7% upper bound for their
backend split. Their arm64 Workers used the copying heap. With the same
typed executable and heap, the main thread and a Worker retired
essentially the same number of instructions in each measured kernel.
Dense register-home and record-guard liveness rows landed separately in
PR #13.
[Worker split bound](results/parallel-bounded-compile-worker-bound-v1.md) ·
[macOS kernel parity](results/parallel-bounded-compile-native-kernel-parity-darwin-v2.md) ·
[Deferred safepoint liveness and kernel probe](results/parallel-bounded-compile-deferred-liveness-whole-build-v1.md)

The November 27 recheck uses main at `d119763b9`. Workers now use the
generational collector and their host operations preserve closed-world
analysis. Inline detached actor execution took 40.53 s against 38.79 s
for the serial function loop. The longest emitter function alone took
18.99 s, leaving a modeled whole-build saving of about 10.6% at four
lanes and above. PR #4 remains draft pending the native acceptance
rotation for a qualifying design.
[Recheck on current main](results/parallel-bounded-compile-recheck-v2.md)

A native emitter outline reduced the largest job from 17.62 s to 2.04 s
and emission from 41.65 s to 30.73 s when the outlined sources became
the input. The block-outline compiler reproduced the original signed
image when given the original sources. These changes to input shape
also reduce the serial work available to parallelize. The final local
constant-folding sweep still has roughly the same time share as
emission and can send just the rewritten functions back across the
pass barrier.
[Emitter outlining screen](results/parallel-bounded-compile-emitter-outline-v1.md)

The next profile attributed 35.73 s of a 45.34 s folding sweep to one
body. Its sparse load IDs made the native optimizer grow a fresh
array-length fact list even when a load supplied no length. Skipping
those writes dropped the replay from 49.71 s to 77 ms on macOS and
66.47 s to 113 ms on Linux, with identical packed output. This serial
change is being qualified separately. The worker budget will use the
faster serial baseline.
[Native constant-folding hot-body replay](results/parallel-bounded-compile-folding-hot-body-v1.md)

Two persistent native Workers each opened the same typed shared
preparation once and served repeat requests for packed bodies. The
separate full-emission fixture still needs validation before the
newer pool can be measured through image placement.
[Generational Worker shared preparation](results/parallel-bounded-compile-generational-shared-preparation-v1.md)

Importing Worker bindings from the shared fragment engine sent the
native replay through general guest lowering. The checker spent 95.6%
of sampled CPU merging and refining facts in the resulting emitter.
Passing the lane ID as data restored typed Worker preparation. The
profile and remaining stage budget guide the next replay.
[Worker composition and checker profile](results/parallel-bounded-compile-worker-checker-cliff-v1.md)

## Compiler actor candidates

Native Worker microbenchmarks isolated two substrate costs. One mapped
byte snapshot replaced per-byte text transport for cloned ArrayBuffers.
Bounding scans to occupied waiter rows removed the full registry scan
from the ordinary wait/notify path. PR #11 shipped those changes and
their tests. The small-packet mailbox and shared metadata
cache had mixed results across hosts.
[Native Worker runtime PR](https://github.com/Sequins-dev/tint/pull/11)

The latest native stage profiles put the frame-and-instruction loop at
34.59% of macOS and 40.07% of Linux arm64 wall time. A two-lane worker
needs most of its ideal speedup to clear the macOS threshold. One
closed direct-call component consumes 98.61% of the measured Linux
function-loop time. An ordered fragment merger needs shared call and
layout facts so it can split that component.

The current optimizer has zero work after the final reachability and ID
barrier. Its preceding function-local counted-loop rewrite takes
2.55–3.18 seconds. Starting emission while that rewrite runs requires
both stable reachability and preparation of the emitter's shared facts.
Source graph and timed reloads take under 2.2 s per build. Image
construction, stack maps, image publication and statistics have about
one percent of wall time combined. The actor report records the
message and ownership boundaries of those subsystems.
[Native actor timeline](results/parallel-bounded-compile-actor-timeline-v1.md)

The packed backend replay now releases the preparation process before
starting worker computation, shares packed bodies and per-function
facts, and seals fragments for ordered placement. Two persistent
Node workers improved the paired stage wall times by 45.0% and 42.9%
with about one-third lower peak RSS. One and two workers produced
identical emission payloads. Six-worker screens crossed the RSS
guard, including a run with two concurrent jobs.

Packing after native module-wide preparation avoided repeated
decoding in the Linux screen. One full collection at that handoff
returned 959 MiB of resident pages in 135 ms. The 17 jobs the Node
scheduler ran one at a time consumed 60.92% of the measured native
macOS function loop and 63.82% on Linux. The measured macOS costs
leave about 0.21 s of overhead allowance under the 15% bar.
[Backend actor lifetimes and replay](results/parallel-bounded-compile-actor-lifetimes-v1.md)

The backend prototype now uses typed packets for normalized bodies,
common preparation and emitted fragments. Each actor opens the
preparation once and decodes one body at a time. The coordinator
rebases relocations and assigns record dispatch IDs in function order.
It can seal completed fragments to the existing spill backend and
release each segment after placement. The prototype exposes a hook
after packing and dropping the coordinator's decoded bodies.

The frozen backend capture produces identical emitted code and metadata
through the typed packet path. The generational full compiler uses that
path inline and reproduces each platform's complete frozen image. On
both arm64 hosts a copying-heap fixture reproduces its packets at 1, 2
and 3 actual Workers. The dense two-worker backend replay overlaps its
two largest jobs at about 1.42 GiB peak actor RSS. Function 5,648
fails in slot sharing at a 704 MiB worker heap setting. Its owner
hash arrays alone reserve 192 MiB. Packing occupancy and live-in rows
makes that job fit the smaller heap. On the PR #11 runtime, two Workers
reproduce all 35 frozen backend packets at 1,524,692 KiB peak stage RSS.
The full-word coloring variant takes 205.73 s in the standalone actor
stage. A live Linux compiler test starts the native companion during
startup and signals it after packing and collection. It builds the
same whole ELF at 2,159,444 KiB combined peak RSS. The actor stage
accounts for 158.52 s of the functional run. Occupied-word slot sharing
finishes the standalone replay in 123.66 s, with 0.20 s between the
lanes' finish times. A native CPU profile of a single heavy range
locates the main work in liveness, register homes, and record facts.
The same typed executable on Linux produces nearly identical kernel
allocation counts on the main thread and in a Worker with the same
copying heap extent. Deferring safepoint liveness until register
assignment and packing large record guard membership rows reduce
CPU in the standalone Worker replay. The stage remains above the
replacement budget for the acceptance rotation. The default compiler
uses the serial path.
[Typed backend packet experiments](results/parallel-bounded-compile-typed-fragments-v1.md)
[Native handoff and scratch screens](results/parallel-bounded-compile-native-fragment-scratch-v1.md)
[Packed frame-slot sharing](results/parallel-bounded-compile-packed-frame-sharing-v1.md)
[Live native actor handoff](results/parallel-bounded-compile-live-native-actors-v1.md)
[Native actor compute](results/parallel-bounded-compile-actor-compute-v1.md)
[Native kernel parity and serial candidates](results/parallel-bounded-compile-native-kernel-parity-v1.md)

## Baseline and priorities

On the frozen 796-file self-build, native took **181.3 s** and peaked at
**2,081 MiB RSS**. The Node-hosted build took **306.4 s** and peaked at
**4,001 MiB RSS**. Both produced the same signed image. Optimization and
codegen accounted for 88% of native wall time, with optimization alone
taking 107.9 s. Codegen had the highest RSS on both hosts. Both compilers
completed collection preparation in one pass. Use the Object suite to
measure the retry improvement and the self-build to retain native throughput
and image identity. [Frozen per-stage baseline](results/parallel-bounded-compile-baseline-2026-11-21.md)

The Object Test262 suite exhausted V8 old space at 2,848 MiB during retry
helper specialization and reached emission at 2,880 MiB. The minimum cap
for a complete build remains unknown. These are old-space limits for that
suite.
Prioritize native self-compile wall time. Use the current serial optimizer
as the control for function-local optimizer and codegen workers. Retain a
pool only after at least six rotated pairs per host under
`tools/gate/with-lock.sh both`. The frozen native self-compile must improve
by at least 15% at the paired median, with its entire paired interquartile
range below zero, on both macOS arm64 and Linux arm64. Require no material
peak-RSS regression, byte-identical images at one, two and N workers, and
stage 2 identical to stage 3. Record peak RSS on the self-
compile and Object workloads for each change, independently of V8's
old-space setting. The 2.8 GiB Object suite target belongs to follow-up
memory work after this PR. Start storage policies as opt-in and validate
admission estimates on both hosts before enabling them automatically.
[Object suite cap trials](results/compiler-check-memory-instances-2026-11-20.md)

After the Worker API landed, the revised 821-file control spent 81.6 s in LICM,
31.0 s in SSA constants and 84.9 s in codegen. The first LICM experiment
reused one record-proof summary across the loops of an immutable round.
Its first native comparison returned the same signed image 57.2 s sooner.
A four-worker SSA transport screen on Node showed lower wall time and
higher CPU and RSS. A cheaper serial join changes that tradeoff, so
evaluate the pool against the improved kernel before integration.
[Merged-main screen](results/parallel-bounded-compile-screening-v1.md) ·
[Native profile and cap trials](results/parallel-bounded-compile-hot-passes-v1.md)

## Serial optimizer changes on main

LICM computes the record proof summary on the first eligible loop in a round.
All loops in that round read the same function version. A subsequent round
computes its own summary after the rewrites from the preceding round.

SSA constant propagation skips the incoming edges of block parameters that
have reached the unknown state in an unbounded run. Further joins leave
those parameters unknown. Bounded runs retain their existing work accounting.
Both changes use the existing serial pass order and function IDs. The native
candidate reaches a fixed point on macOS arm64 and Linux arm64. Linux
x86-64 passes the CI fixed-point gate. On the matched 821-file input, the
combined compiler took 137.8 s and 91.5 s. The controls took 263.9 s and
291.7 s. Median wall time fell 58.7% and median cycles fell 39.5%. All eight
measured native builds produced the same signed image. Both changes landed
on main in PR #9.
[Serial optimizer measurements](results/optimizer-serial-v1.md)

With settled SSA joins skipped, the four-worker spill prototype saved
1.21–1.26 s of pass wall time on Node and raised whole-process peak RSS
by 1.20–1.36 GiB. Structured clone took longer than the improved serial
kernel in both orders. The branch uses the serial kernels for the whole
compiler. The worker entry probe exercised typed SSA in a native isolate.

A follow-up Linux arm64 screen ran the same settled-SSA kernel over the
frozen compiler's full pass input. Two workers reduced median pass wall
time from 25.20 s to 13.01 s, and six to 7.69 s. All result batches matched
across worker counts. Peak RSS was about 1.02 GiB with two workers and
2.97 GiB with six. The new self-compile profile put native code emission
at 53.1% of reported pass time. A second profile attributed 103.73 of
120.16 emitter seconds to the function emission loop. That loop is the
next worker integration target.
[Native SSA worker screen and self-compile profile](results/parallel-bounded-compile-native-worker-screen-v1.md)

The end-to-end SSA sidecar screen took 308.106 s with two workers versus
302.077 s serial. Packing, handoff and merge exceeded the entire 11.986 s
serial pass. The final image differed even though all decoded SSA bodies
matched the serial reference, so the experiment was discarded. The macOS
profile also put AArch64 emission first, at 53.6% of reported pass time.
[End-to-end SSA sidecar](results/parallel-bounded-compile-ssa-sidecar-v1.md) ·
[Native macOS profile](results/parallel-bounded-compile-packed-delta-v1.md#native-self-compile-profile-on-macos)

Within function emission, the Linux profile attributed 68.49 s to
frame planning and 21.51 s to instruction emission. The frame work
includes slot sharing, register allocation, and liveness. It is a
candidate for workers even when final instruction placement stays serial.
[Native AArch64 function emission profile](results/parallel-bounded-compile-frame-plan-v1.md)

The Node replay of ordered AArch64 fragments produced identical
emission at one, two, and six workers. Two workers lowered emission
and merge wall time in that screen. The replay needed the serial
control's first-use dispatch numbering. The refined native profile
put 52.94 s into register-home analysis, which can run with frozen
call summaries and function-local frame inputs.
[Ordered AArch64 worker fragments](results/parallel-bounded-compile-codegen-fragments-v1.md)

Native register-home workers reproduced all 31 result batches at one,
two, and six workers. The two-worker kernel replay saved 38.16 s in
median wall time. Its live compiler integration produced the same ELF
but spent 65.83 s more end to end, so that sidecar stays experimental.
[Native register-home workers and self-compile integration](results/parallel-bounded-compile-native-register-homes-v1.md)

Releasing frame plans after each function made six-worker emission
faster in both orders of a native comparison. Whole-build wall time
improved in one order and regressed in the other. All ELF images
from the native sidecar rotation matched at one, two, and six workers.
The six-worker run peaked at about 6.1 GiB RSS. A separate kernel
profile found 87.5% of the measured kernel time in 234 of the 5,910 requests.
That identifies a smaller candidate set for worker admission.
[Native register-home rotation](results/parallel-bounded-compile-register-home-lifetimes-v1.md)

Publishing finished batches while the compiler prepared later ones cut
wall time in both orders on the Linux VM. CPU and emission time moved
in opposite directions across the pairs. Both six-worker runs exceeded
7 GiB peak RSS. The same-process launcher with eager worker startup
timed out before it published a batch. These remain prototypes.
[Overlapping native register-home batches](results/parallel-bounded-compile-register-home-overlap-v1.md)

Preparing the module's emission facts once made the AArch64 fragment
replay faster at two and six workers. Ordered placement assigned
dispatch IDs and selected branch forms without a serial seed. At six
workers the Node replay took 51.23 s versus 101.47 s serial and
raised process peak RSS to 9,449,680 KiB. This is a stage replay.
[Shared AArch64 preparation](results/parallel-bounded-compile-shared-preparation-v1.md)

In a separate Object compilation pair with a 4,096 MiB V8 old-space setting,
the optimizer candidate built the same signed image in 524.22 s versus
899.40 s. Its observed peak RSS was 5,195.6 MiB versus 4,760.7 MiB.
Packing function bodies during lowering removed the full decoded IR from
that frame. The optimizer still exhausted memory after those bodies were
rehydrated. Moving the first reachability scan onto stored bodies deferred
the same pressure to the retained result. Keeping the first optimizer
generations packed reduced live heap before module-wide work. A subsequent
prototype completed loop-cell promotion by collecting call and cell-layout
summaries, then decoding and rewriting each body in order. It finished the
pass with 488,519,672 bytes of JS heap in use. The following bulk-list pass
still entered a driver that decoded every function, even before checking
for helper names. Subsequent prototypes removed that hydration and
reached AArch64 emission with roughly 390 MB of JS heap in use. Both ran
out of heap inside the emitter and exceeded the process RSS target. Use
the complete Object selection to evaluate the follow-up whole-build budget
and to track RSS when evaluating worker changes.
[Streaming and fixed-point probes](results/parallel-bounded-compile-streaming-probes-v1.md) ·
[Full timing rotation and further streaming probes](results/parallel-bounded-compile-rotation-v1.md) ·
[Loop-cell promotion and the next hydration boundary](results/parallel-bounded-compile-streaming-cells-v1.md) ·
[Packed Object emission](results/parallel-bounded-compile-object-emission-v1.md) ·
[Object compilation with staged IR changes](results/parallel-bounded-compile-packed-delta-v1.md) ·
[Typed streaming compiler at a 2,176 MiB heap setting](results/parallel-bounded-compile-typed-cap-v1.md)

The typed streaming prototype completed the whole Object image at a
4,096 MiB old-space setting, byte-identical to the earlier control.
Its peak RSS was 4,798,824,448 bytes. Lower heap settings failed in
collection-runtime preparation before packed lowering could help.
At the whole-program instance check, RSS was 4,043,046,912 bytes and
JavaScript heap in use was 2,996,480,488 bytes. The check validates
helper demands on the instantiated syntax and its binding and type
graph. The linked input is available for retry. Reducing this peak
requires changes to the checker's data representation or lifetimes.
[Typed streaming Object image comparison](results/parallel-bounded-compile-typed-object-image-v1.md)
[Resident set at the instance check](results/parallel-bounded-compile-shared-preparation-v1.md#object-selections-collection-runtime-retry)

Compact bitsets lowered the footprint of the largest register-home jobs.
A two-worker native kernel replay reproduced both plans in 3.65 s,
compared with 7.14 s inline. In the complete compile, the pool raised
peak RSS by 13–20% and the paired wall times moved in opposite directions.
Moving frame sharing onto the sidecar still added about 342 MiB of
aggregate RSS. The in-process variant using the compiler's generational
collector stopped at its managed-write check. These worker variants
remain experimental.
[Compact register-home workers](results/parallel-bounded-compile-compact-worker-v1.md) ·
[Frame-plan worker rotation](results/parallel-bounded-compile-frame-plan-worker-v1.md) ·
[Targeted liveness and worker collector](results/parallel-bounded-compile-ranked-register-homes-v1.md) ·
[Native timing rotations](results/parallel-bounded-compile-native-late-rotation-v1.md)

The array-access planner sent only proven instruction positions and
integer-slot facts back from workers. The live compiler preserved the
frozen image, with about 24 MiB more peak RSS. Both whole-build pairs
took longer. The first selected function waited 2.37–2.94 s for its
plan, motivating a later dispatch target.
[Function-local array-access plans](results/parallel-bounded-compile-array-plan-workers-v1.md)

A late-plan variant used the original body inline when the worker result
was absent. Both delivery paths reproduced the same image. The full
native Linux rotation had mixed wall time and used 16–17 MiB more peak
RSS when the worker ran.
[Array-access plans without blocking](results/parallel-bounded-compile-array-plan-fallback-v1.md)

Sending only the later of the two largest jobs reduced the Linux wait
to about 10 ms and saved up to 0.49 s in the pass. On macOS the deferred
worker startup took longer than the available overlap in both pairs.
The pass took over four seconds longer in both worker cells and the
whole-build wall result changed direction. All eight images matched
their platform references.
[Single late-job rotation](results/parallel-bounded-compile-array-plan-late-v1.md)

Prelaunching the native worker before the request reduced the macOS
handoff wait to 1–6 ms. Array-access selection took 1.07 s and 1.38 s less
in the paired runs, with 16–17 MiB more peak aggregate RSS. Both signed
images matched each control.
[Prelaunching the array-access worker](results/parallel-bounded-compile-array-plan-prelaunch-v1.md)

The integrated launcher reused the late plan in both Linux and both
macOS worker cells. The Linux pairs saved 0.43–0.55 s in array-access
selection. The macOS selection and total wall results changed direction
across the pairs. The signed or linked images matched on each platform.
[Integrated native rotation](results/parallel-bounded-compile-array-plan-integration-v1.md)

Running the integrated Linux compiler with both settings isolated the
worker option from the planner refactor. Worker mode added 3.71 s
and 4.34 s of whole-build wall time and 15–18 MiB peak combined RSS.
Both pairs produced the same ELF. The affected pass's timing moved
in opposite directions across the pairs.
[Worker option on an identical compiler](results/parallel-bounded-compile-array-plan-isolated-linux-v1.md)

The candidate produced the same images at requested widths 1, 2 and 6
and reached its native fixed point on both arm64 hosts. The complete
Object image also matched with an absent worker result. That fallback
run peaked 97.2 MiB below its serial control, with one packed job published
and analyzed inline.
[Native fixed point and Object fallback](results/parallel-bounded-compile-array-plan-verification-v1.md)

A smaller frame-plan queue picked 25 medium-sized functions and
added about 36 MiB of aggregate RSS. It raised CPU in both paired
runs and had mixed wall-time results.
[Medium-sized frame-plan jobs](results/parallel-bounded-compile-medium-frame-workers-v1.md)

The dense liveness representation also saved about 55 MiB on a
serial native self-compile. The matched Object build used the
same runtime sources and produced the same image. It reached
151.1 MiB higher peak RSS with dense rows. That representation
stays experimental.
[Dense register-home liveness](results/parallel-bounded-compile-compact-liveness-v1.md)

Resolving local branches before leaving a function removed most
deferred branch fixups. With repeated stack maps interned, an isolated
replay of all 29,636 Object function records emitted the same machine
code at 2.68 GiB peak RSS. The full pipeline still reaches the earlier
whole-program instance check.
[Object emission with function-local fixups](results/parallel-bounded-compile-object-local-fixups-v1.md)

## Work and dependencies

| Stage                      | Work that can run independently                                                                                                                                                                                                                                                                | Global state and ordering                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source intake and parse    | Decode and parse one module at a time. A worker returns import/export and position records and a handle to syntax. Link can re-read that syntax, or reparse immutable source if replay is cheaper. Generated foreign binding inputs use the same interface.                                    | Coordinator expands foreign inputs, resolves specifiers against the catalog and discovers reachability in the existing root and import order. Assign module ordinals on that walk. Preserve graph failure precedence even when workers finish out of order.                                                                                                                                                                                                                                                                                              |
| Source link and bind       | Bind one module's local scopes and compute its export summary and rename plan before merging. Rewrite module fragments after the global tables are frozen.                                                                                                                                     | Resolve re-exports, namespace imports, type/value namespaces and cyclic dependencies from the complete reachable summaries. The instance initializer must preserve the existing module evaluation order, including cycles. Keep the current merge/bind/normalize path serial until fragment boundaries and name resolution have been verified.                                                                                                                                                                                                           |
| Bind, specialize and check | Specialize helper declarations in batches once their canonical requests and lookup snapshot are known. Check function bodies against published type and capture facts when dependencies are complete. Recursive or mutually inferred declarations form one strongly connected component (SCC). | The checker currently uses identity-keyed indexes on a merged AST. Freeze declaration and class layouts, imports, type interning, contextual and inferred signatures, capture ownership and global initialization facts before extracting body work. Keep the current checker serial initially. Each collection retry consumes the prior observation, extends the demand plan, specializes helper roots, builds the instance, hashes syntax, then checks and validates demand against the new instance. Publish the next round only after that decision. |
| Lower                      | A checked top-level function and its nested closures are a natural unit. Use per-body expression/representation facts, closure environments, and approved host/helper/foreign bindings to produce packed IR. Partition by function only once shared capture and identity inputs are explicit.  | Freeze ABI signatures, entry and export roots, environment/cell layouts, function identities and record-layout keys. Allocate global record/dispatch IDs in the existing discovery order, including slots first requested during lowering. Keep the initializer and invocation tied to the same checked instance.                                                                                                                                                                                                                                        |
| Optimize                   | Apply function-local passes to numbered bodies. For cross-function passes, extract per-body contributions and rewrite against immutable summaries. Use bounded on-demand reads for inline candidates.                                                                                          | Keep the current pass order and barriers. Dense list eligibility, reachability and ID remaps, effects, call/record flow, devirtualization and inlining require global facts. Preserve the current update order and heuristics for passes whose decisions depend on earlier rewrites. A pass stays serial until a summary/rewrite split reproduces its output.                                                                                                                                                                                            |
| Codegen                    | Emit a function's words, local fixups, frame and stack-map records, and debug ranges from frozen codegen facts. Use function-local scratch for register allocation and local branch retries.                                                                                                   | Freeze verified headers, signatures, list shapes, word argument/return and record-flow facts, direct returns and no-safepoint summaries. Canonical placement assigns text offsets and deduplicates descriptors, literals and imports. Retry compact branches/calls or near/far forms with a coordinator decision against that layout. Start with AArch64's store-aware path and prove equivalent boundaries for the separate x86-64 emitter.                                                                                                             |
| Native link                | Validate and prepare service-unit records independently. Apply independent, non-overlapping fixup pages after layout and ownership are known.                                                                                                                                                  | Coordinator selects entry/startup and service order, creates the symbol and relocation index, assigns placement, and resolves reach constraints. A near/far rebuild rolls back the old generation. Preserve stack map PCs, trace identity and unwind offsets.                                                                                                                                                                                                                                                                                            |
| Image emission             | Place immutable code and metadata extents into disjoint output windows. Hash independent Mach-O code-signature pages once their patches are complete.                                                                                                                                          | Header/load-command, metadata and section layout precede writes. UUID/build-ID hashes retain the existing byte stream and block order. Resolve patches that span windows under one owner. Assemble signing records in page order, finalize the image, then publish atomically. Use the existing single-copy placement plan.                                                                                                                                                                                                                              |

The source graph loader already drops temporary discovery ASTs. Application
linking reparses them into a merged graph. Parsing can gain parallelism before
the checker is decomposed. Streaming source linking needs stable declaration
and dependency records so discarding syntax cannot break a re-export, binding,
position lookup or typed-to-general retry. A fallback uses the same frozen
source descriptors and existing lowering/diagnostic decisions. Typing and
explicit runtime contracts stay as specified by the unified pipeline.
[Source loader](../packages/typescript/src/modules/index.ts) ·
[Source link](../packages/ts-native/src/modules/index.ts) ·
[Typed pipeline](unified-pipeline.md)

## Ownership and data flow

The coordinator owns the build's catalog, ID allocation, layout decisions,
summary versions, and temporary-file namespace. The only mutator of a compiler
heap is its isolate's thread. Run the same worker entry and pool protocol
through the approved `node:worker_threads` surface in Node and native Tint.
Both compiler entry paths need the native subset. A one-worker baseline uses
the same numbered work and commit operations inline. Library/embedding
entrypoints keep their synchronous behavior until the pool can be integrated
without changing that contract. Decide CLI entry and worker module admission
with PR #2 before enabling the pool.
[Worker design, sections 6 and 12](https://github.com/Sequins-dev/tint/blob/8e63b50212ee0214459c56053b2b336a11608794/docs/design-event-loop.md) ·
[Lifetime contract](memory-and-lifetimes.md)

1. A stage receives stable IDs and read-only inputs for a generation. Source
   and checked fragments use separate records from packed IR. Reuse
   `TIRS` and the existing `FunctionStore` for IR. Keep versioned headers and
   indexes resident. Encode references by ID, including file-segment
   references and the codec's foreign descriptor IDs. A worker needs the
   same descriptor table for that generation. Register file segments under
   the coordinator's build directory and pass the path and logical handle
   needed to open them. The existing spill backend's integer handles are
   local to its owning instance.
2. Dispatch generation, stage/pass, ordinal or ID range, input handles, and
   reserved bytes. Workers decode only the inputs they lease. Each worker
   owns its scratch and output until it has completed and sealed the result.
   A completion carries its status, small counters and a handle. Transfer a
   uniquely owned, standalone `ArrayBuffer` when the receiver needs the
   packed bytes immediately. A transferred sender view is detached. Use read-only shared bytes by convention in a
   `SharedArrayBuffer` for hot tables or chunks with multiple readers,
   publishing after writes with synchronized handoff. Bound per-isolate views
   and cache residency. Use spill for cold results and ordered merges when
   retaining a buffer would exceed the allowance.
3. On completion the coordinator commits an ordered range to the stage's
   next version, registers its store records, and releases the prior
   generation when readers and rollback obligations are gone. Use unchanged
   chunk references across versions. Backpressure includes completed results
   waiting for their predecessors. Spill them before returning producer
   credit. Reserve progress for the oldest task so a later result queue
   cannot deadlock it. Replace reference-identity change detection with
   explicit changed IDs. Keep pass-level counters and diagnostic output
   ordered. Stream observability by ID and avoid holding whole debug or IR
   snapshot graphs in the ordinary build.
4. Worker failures or cancellation stop new dispatch. Join or quiesce
   workers, discard uncommitted generations, and release leases and files
   from their owning scope. A short write or disk-full error fails the build
   and leaves the prior published output intact. Retry a task only from its
   immutable input once the failed attempt has surrendered all ownership.
   Use separate generations for a failed emission attempt. Crash recovery
   may delete abandoned files only after establishing the build no longer
   owns them. Store I/O and output are cleared outside GC finalization.

For helper retry, the first seam is the transition from the observed checker
graph to helper requests. Extract the equivalence, demand and runtime binding
facts used by `prepareObservedCollectionRuntimes`, then release the prior
checker graph before the new helper body set grows. Preserve the original
declaration order and specialized root order, replay source fragments as
needed, and stream specialized fragments through instance transformation.
The current preparation already clears the observation owner. Its helper frame
still needs the checker for specialization, runtime binding and BigInt facts.
Extract and validate those facts before processing the full helper set.
Maintain the existing convergence and runtime binding validation. A helper
needed by later requests can be reloaded by ID. Validate lifetimes across
success and retry, including a helper whose body discovers a new contract.
For optimizer streaming, move `rewriteFunctions` and module-version adoption
onto generations of the store first. Keep each converted pass's rollback
boundary and avoid packing a whole decoded module at the end of lowering.
[Function store and spill](compiler-memory.md#function-store-tintirstorage) ·
[Compiler observability](compiler-observability.md)

For file-backed output, open the atomic-publication temporary file only after
layout succeeds. The initial writer can materialize and patch windows in
canonical order through the existing file host. Parallel writes to the same
file require a positioned-write capability through the platform adapter and
page ownership that excludes overlaps.

## Determinism

The coordinator reproduces the current serial traversal. Canonical orders
are root and import discovery order for modules, existing lexical binder and
statement order within each module, existing specialization discovery order for
generated declarations, and the current function/record order at every pass.
A worker can emit locally numbered temporaries and discovery records in that
order. The coordinator consumes those records by serial ordinal, with their
local sequence as a tie-breaker, and issues global IDs or remap tables. Avoid
sorting by name as a substitute for the current traversal. Where specialization
or inlining assigns an ID in response to a newly discovered request, commit
that request before dispatching dependent work. Keep interning serial where
it cannot yet be split faithfully. Store addresses, disk paths, capacity and
worker IDs never enter output.

At optimizer barriers, commit body versions and ID remaps in current visit
order. Use the same root seeding and traversal when a fixpoint's update order
affects the decision. Merge emitted fragments in existing module and function
order, with locals relative to the function. Replay first-use interning,
alignment, fixup application and retry decisions at canonical positions.
Keep separate orders where the current writer distinguishes module, import,
symbol, diagnostic and debug records. Errors are reported in the same logical
order as the serial build. Count statistics in that order and treat measured
timings as observations outside image identity.

For each slice, run the frozen inputs twice on different schedules and compare
entire images across inline execution, pool widths 1/2/available, forced
spill versus budget and memory, and deliberate completion reordering where
applicable. Compare release and debug images separately, including signature
bytes and debug information. Check the result against the pre-change
compiler's output for the same fixture input and platform. Self-build the
candidate against one frozen source graph and verify stage 2 equals stage 3
under LLDB with different worker counts and memory settings as applicable.
Include module cycles, specialization recursion/retry, large branch reach,
pruning, foreign bindings, spill failures and a single oversized body.
Keep Test262 evidence and bootstrap identity separate.

## Memory budget and admission

For each stage \(s\), budget **fixed bytes + shared bytes + transient task
reservations + pending output + headroom** under one build cap. The fixed
budget includes coordinator and worker runtimes (private heap commitment,
descriptor metadata, touched stack pages and collector workspace), with
separate measurement on each host. Count shared backing once and private
decodes per recipient. Credit buffers until even a transferred backing or
evicted GC page is confirmed reusable or released. Include source/input
buffers, packed segments, byte-array capacity, spill buffers and output
windows separately from heap-object estimates.

| Stage                | Fixed/shared charge before dispatch                                                                            | Per-task and pending-output charge                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Parse and discovery  | Catalog, dependency offsets, generated input bytes, source/position index                                      | Largest admitted source and decode, tokens and AST, packed fragment plus read/write overlap                                        |
| Source link and bind | Reachability/export/SCC records, deterministic rename and span tables, retained merged graph where required    | Per-module symbols and rewrite scratch plus packed rewritten syntax. Charge aggregate merged AST until streamed.                   |
| Check and retry      | Canonical declarations, type and relation summaries, live instance/observation facts and active global checker | Per-SCC or helper batch old/new syntax, local bindings, expression facts and caches, including live prior versions at retry seams  |
| Lower                | Checked facts still required plus layouts, ABI and function headers                                            | Decode/check-fact window, closure-family plans, body and encoder scratch, open packed chunks                                       |
| Optimize             | IR index, headers and pass summaries, with both generation indexes until commit                                | Active input and rewritten body, per-function analysis and inline-candidate cache, packed result and spill I/O                     |
| Codegen              | ABI/analysis summaries, symbol, offset and fixup indexes                                                       | Decoded body, register/branch scratch, emitted chunks and metadata, including overlapping retry buffers                            |
| Link                 | Placement and relocation tables plus retained startup and service descriptors                                  | Bounded patch/read windows and scratch at cross-window fixups                                                                      |
| Image                | Section/signing layout and atomic publication metadata                                                         | Bounded file/patch/hash windows, plus a separate full output buffer reserve for callers that require the current byte-array result |

For each stage, require `G_s + H_s + K_s + R_s + sum(W_i + T_si) <= C`.
Here `G_s` is the coordinator and global tables in the stage's row,
`H_s` is runtime and collector headroom, `K_s` is shared cache,
`R_s` is reserved output and ordered-merge space, `W_i` is a worker's
private runtime commitment, and `T_si` is the admitted task's workspace
and result overlap. At equal task sizes, peak budget grows by `W + T_s`
per active worker. For illustration, with a 4 GiB cap, 3 GiB reserved
for fixed/shared costs and 128 MiB per active worker, the stage can admit
eight workers even on a larger machine. If one task needs 512 MiB, it
consumes four of those reservations. Use actual reservations for admission.

Compute stage reservations from actual input extents and typed-table capacity
before opening work. Calibrate per-unit temporary allowances from measured
allocations and working-set tails. Each worker can hold at most one admitted
task plus charged scratch retained for reuse. Admit a task only if its
workspace, maximum overlapping input/output, queue slot and necessary progress
credit fit. Limit active workers by available CPUs after accounting for the
coordinator, collector helpers and I/O. Select the largest fitting work set
using byte credits as well as task count. Reduce width or evict packed and
decoded caches first. Drain and resize isolate pools at barriers if idle
worker heap commitment blocks useful work. Shared compaction, chunk buffers
and the largest pending record must also fit the cap.

For the initial file-backed path, use the store's 1 MiB maximum target for
ordinary chunks, and give every reader, writer and prefetch buffer its own
credit. An oversized record needs an exclusive reservation or incremental
encoding/decoding. A stage that cannot admit its necessary serial unit
either uses a finer bounded representation or reports the cap and requested
bytes. Spilled optimization runs all passes to completion under the
existing AOT work policy. Public byte-array calls reserve their output extent. CLI file-backed
emission, once available, reserves windows instead of that extent.

Enforce reserved capacity at allocation and growth boundaries. An estimated body cost can drive scheduling, but
allocation must still hold sufficient capacity or spill and retry that unit.
Teach the native runtime to supply committed heap, stack, collector and
external-buffer accounting before advertising a strict build-wide cap.
V8 `resourceLimits` constrain isolate heap/stack resources while external
backings, allocator residency and runtime overhead require their own budget.
Specify a hard cap for compiler-owned reservations on both hosts. An exact OS
RSS limit requires host enforcement and must be documented separately.
Report charged bytes, measured RSS, live/committed memory where available,
spilled bytes, disk peak, queue wait, active workers and cap-related failures.
[Collector contract](memory-and-lifetimes.md#collection-points-and-triggers)

## Sequence and estimates

Evaluate workers first against the improved serial compiler. Use the
post-optimizer profile to choose the first function-local pass or codegen
kernel. A whole native build must show a repeatable wall-time gain with
stable memory before the pool is retained. Continue the helper and storage
work after this PR lands.

The original estimates below assume one implementer familiar with Tint
and exclude external dependency and gate queues. Compare each measured
change to the frozen baseline and its immediate control.

| Step | Scope and exit evidence                                                                                                                                                                                                                                                                                                                                                                             | Estimate  | PR #2 dependency                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------ |
| 1    | Bound retry helper specialization. Retain only required observation facts, materialize helpers in stable order with bounded staging, verify all retries and remeasure the Object suite with a cap bracket. First win is completing that input at 2,848 MiB old space with identical output, or measuring a lower retry peak and identifying the next blocker. Report the two as different outcomes. | 1–2 weeks | Can start before workers                                                 |
| 2    | Lower directly into the store, stream local optimizer passes, then split global passes one by one. Verify in-memory/budget/forced-spill identity and quantify packing, cache and replay cost.                                                                                                                                                                                                       | 3–5 weeks | Can start before workers                                                 |
| 3    | File-backed emitted fragments and CLI image publication via existing placement plans. Preserve the byte-array result where callers require it. Exercise size and failure boundaries, both image formats, and x86-64 store parity.                                                                                                                                                                   | 2–4 weeks | Can start before workers                                                 |
| 4    | Integrate the pool over proven store seams. Measure isolate startup, worker residency and transfer costs on both hosts. Enable a measured function-local optimizer pass first, then per-function codegen, with deterministic result commit and memory credits.                                                                                                                                      | 3–5 weeks | Worker API and compiler-subset worker entry                              |
| 5    | Parallel module parsing, linking preparation and checked/lowered units with frozen summary contracts. Measure any remaining serial costs before extracting more of the checker.                                                                                                                                                                                                                     | 4–8 weeks | Parallel execution requires workers. Serial seam work can start earlier. |

After each step, record one fresh immutable result with both hosts' wall time,
CPU, cycles where available, and peak RSS on matched inputs. Use repeated
interleaved runs for throughput acceptance. Attribute regressions to serial
work, collection, spill I/O or scheduling where measurements permit. At
the end run the macOS gate, the Linux gate on the shared `dev` machine,
and the Linux x86-64 self-build in CI before marking the PR ready.
[Workspace validation](validation-gate.md)

## Review questions and risks

- Should the first bounded-build interface be an opt-in CLI memory cap with a
  conservative default worker width, or should all CLI AOT builds use the
  measured automatic policy once it is validated on both hosts? Start with
  an opt-in policy while deriving reliable admission reservations.
- What cap and spill-directory policy should embedders expose? Disk quotas,
  cache amplification and repeated decode can dominate a low-memory build.
  Compare memory-only, budget and all-spill modes on fast and constrained
  scratch storage before choosing defaults.
- The monolithic checker may keep more resident data than any worker budget
  can absorb, especially a large cyclic instance with inference across
  declarations. Keep it serial until compact type, closure and relation facts
  reproduce results, and measure the remaining minimum on both hosts.
- A single oversized function, transitive inlining set or fixup batch can
  exceed a stage's normal work unit. Exercise the largest observed examples
  before relying on a per-worker estimate. Preserve explicit reporting for any
  stage that still needs a whole-program allocation.
- The worker API from PR #2 is available. The compiler needs a typed worker
  entrypoint and a way to join results from its synchronous compile path. Test transfer
  detachment, read-only summary publication, shutdown and collector CPU
  contention before raising the default pool width.
- Codegen fragment placement is a correctness dependency for branch relaxation,
  stack maps, trace, unwind and signing. Keep global placement serial until
  fixed-point and signed-image comparisons prove independent writers correct.
