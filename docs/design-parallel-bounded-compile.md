# Parallel and bounded-memory AOT compilation

Approved for experimentation. The stage and ownership model below guides
the prototypes. Measured native wall time decides which changes to retain.

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
The current priority is the fastest native self-compile on a matched input.
The memory target is a complete Object suite build within 2.8 GiB. Record
RSS independently of the V8 old-space setting. Keep storage opt-in until
admission estimates have been validated on both hosts.
[Object suite cap trials](results/compiler-check-memory-instances-2026-11-20.md)

After workers landed, the revised 821-file control spent 81.6 s in LICM,
31.0 s in SSA constants and 84.9 s in codegen. The first LICM experiment
reused one record-proof summary across the loops of an immutable round.
Its first native comparison returned the same signed image 57.2 s sooner.
A four-worker SSA transport screen on Node showed lower wall time and
higher CPU and RSS. A cheaper serial join changes that tradeoff, so
evaluate the pool against the improved kernel before integration.
[Merged-main screen](results/parallel-bounded-compile-screening-v1.md) ·
[Native profile and cap trials](results/parallel-bounded-compile-hot-passes-v1.md)

## Implemented optimizer changes

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
measured native builds produced the same signed image.

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
out of heap inside the emitter and exceeded the process RSS target. The
full Object selection remains the acceptance workload for the opt-in
whole-build budget.
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

Engineering estimates assume one implementer familiar with Tint and exclude
external dependency and gate queues. Each implementation step includes
comparison to the frozen baseline and to its immediately preceding step.

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
