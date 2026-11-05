# Shared optimization pipeline

The optimizer is shared by AOT and live compilation. Timing and budgets differ;
semantic rules and transformation implementations do not. Its immediate acceptance
target is a complete native same-source compiler build within 60 seconds on the
current macOS host. Measure compiler work as well as the
speed of generated code: an expensive pass can make self-hosting slower overall.

The backend scalar IR has explicit basic blocks, immutable block-local results,
and mutable slots. The optimizer now promotes eligible locals into a separate
whole-function SSA view with block parameters, performs conditional constant
propagation, and lowers back to the backend contract. Shared effect analysis
supports safe local forwarding and safepoint decisions. Proven record reads become
ordinary value-producing loads, followed by constant-branch cleanup. See
[IR analysis and lowering contracts](ir-evolution.md) for implementation boundaries
and the remaining live-runtime work.

## Phases and contracts

| Phase | Initial work | Required evidence |
| --- | --- | --- |
| Semantic specialization | Known targets, concrete generic instances, fixed record layouts, builtin specialization | Strict contracts or explicit checked assumptions; distinguish declared types from proved facts |
| Scalar simplification | Constant folding, local value propagation, unreachable control flow, dead pure values | Exact JavaScript numeric behavior; explicit effects and exceptional edges |
| Value and representation analysis | Local-slot promotion to SSA, integer ranges, tag and bounds checks, representation selection | Sound joins and loop convergence; overflow, NaN, infinities and signed zero preserved |
| Calls and allocations | Bounded inlining, escape analysis, scalar replacement of records, closures and iterator state | Identity and alias analysis; observable allocation behavior, exceptions and GC safepoints respected |
| Loops and memory | Redundant-load elimination, invariant motion, induction variables, bounds-check elimination | Read/write effects, allocation effects, aliasing and invalidation tracked across calls |
| Machine lowering | Register allocation, move elimination, instruction patterns, branch/layout cleanup | ABI clobbers, live GC references, relocations and source mappings regenerated correctly |

Each pass has a narrow input contract, output invariants, work budget and change
statistics. Keep architecture-neutral passes outside AArch64 emission. Verify the
IR at publication boundaries; allow verification after every pass for debugging.
Use deterministic pass order and bounded work. Start with linear/local passes;
apply expensive global transforms only where measurements justify them.

The initial implementation in `@tint/scalar-optimization` performs scalar constant
folding and propagation through local slots inside a basic block, followed by
removal of stores to unread private slots and worklist removal of unused pure
scalar results. It retains IDs and source spans for surviving instructions, calls,
allocations, exceptional edges and control flow. It does not need
new phi nodes, speculative assumptions, alias-sensitive load elimination, or a
large generic pass scheduler. The operand visitor in `@tint/scalar-ir` covers every instruction and terminator;
it distinguishes value uses from numeric literals and slot/function/record IDs.
Only constants, local loads, scalar unary/binary results, and stores to unread
private slots are currently removable. Slot addresses cannot escape through this
IR, and cell/record terminator slots are conservatively treated as read.
Further copy propagation and effect analysis should reuse this contract.

## Bounded direct-call inlining

The basic pipeline now ends with a bounded direct-call inliner. It accepts small
nonallocating scalar-return functions, including branches and checked array reads.
Straight-line parameters alias caller values. Multi-block bodies use local slots
for arguments and results, preserving the IR's block-local value rule. Call sites
whose existing temporaries would cross the new blocks remain calls. Environments,
nested calls, heap writes, callee exception handlers and managed results are not
eligible yet. Caller exception edges are preserved. Per-function growth and a
shared instruction-work budget bound expansion. Budget exhaustion discards the
unfinished phase while preserving every previously completed phase. Typed-array
local aliases are eligible; their slots retain ordinary root-liveness handling.

The pass exposes operations to later representation analysis and removes private
call overhead. It does not itself prove bounds or eliminate checks. Cloned
instructions currently carry the call-site span; distinct inlined-frame DWARF
provenance remains future work. Native benchmark execution, host differential IR tests and the complete
`inline-v4` self-build passed. Stage1 and stage2 were byte-identical; stage2
compiled and ran the independent smoke project. The full profile captured
444.52 seconds, still above the 60-second target.

An inline scalar-cell read experiment retained initialization checks and exact
payload bits, and passed native environment, moving-GC and self-build checks.
Its complete capture was 418.73 seconds, versus 406.39 for the preceding candidate.
It did not establish a whole-build speedup and was reverted. Cell reads therefore
continue to use the shared helper; the frozen `inline-cells-v1` snapshot preserves
the experiment for later analysis.

## Allocation placement and return lifetimes

See [allocation placement](allocation-placement.md) for function summaries,
caller-owned results without inlining, and collector integration gates.

Prefer scalar replacement, then proved stack storage, then managed heap storage.
Object size alone does not establish a lifetime. A small object retained by a
closure can escape; a graph of objects may remain stack-local when all its
reachable aliases have a bounded enclosing lifetime. Do not optimistically put
unknown-lifetime objects on the stack without a safe promotion mechanism.

The first implemented allocation pass scalar-replaces fixed numeric/boolean
records constructed in a dominating straight-line entry prefix. It follows unique
local aliases, proves initialization precedes uses, and replaces supported field
reads/writes with private scalar slots. Identity-observing operations, calls that
receive the object, stores into other objects, ambiguous assignments, optional
fields, and managed fields remain conservative. Returned objects are classified
separately from other escapes but are still allocated on the heap in this pass.
Allocation argument side effects remain. Eliminated allocations no longer consume
heap quota; allocation counters and exhaustion thresholds are implementation
details, not preserved allocation events.

Return-only escape does not imply heap escape. The next interprocedural layer
should summarize returned aliases, retained argument/object aliases, closure
captures, and unknown calls. A caller that proves a bounded lifetime may reserve
result storage in its own frame and pass it as a hidden argument to the callee.
Forwarding functions may forward the same destination through multiple calls.
Inlining is optional. The callee must never return an address in its own expired
frame, and aliases retained elsewhere must remain coherent. Multiple results,
recursion, exceptions, identity, suspension, and FFI boundaries need explicit
contracts; a heap fallback remains available at unproved call sites. Managed
fields in stack objects also require tracing descriptions for every safepoint.

A nursery is complementary and remains future work. It is heap storage with
cheap allocation and collection, not stack storage. Generational collection needs
old-to-young write barriers and remembered roots; a moving nursery also needs
pointer updates for roots, fields, interior views, and host references. Implement
those contracts before promotion or relocation. Both strict and live profiles
should share the placement analysis, with live speculation additionally requiring
guards and materialization metadata.

## What TypeScript can prove

Under the strict profile, verified shapes can permit direct field offsets,
unboxed arguments and fields, closed-union representations, direct calls and
specialized generic instances without repeated shape checks. These are language
and boundary guarantees, not permission to trust arbitrary annotations.

Whole-application compilation gives us a closed set of implementations and
representations, provided every external entry validates its inputs and the
strict profile excludes untracked dynamic code and mutation. This makes
interprocedural argument, result, shape and effect summaries possible. A closed
union still needs dispatch where control-flow analysis cannot select one member;
knowing every possible member is different from knowing which one is present.
Recursive summaries must converge conservatively, and uncertainty retains the
check. Mutable aliases and host callbacks must be included in the proof.

The first whole-module effect proof now classifies host operations before native
emission. If no operation can overwrite raw object storage, release mappings or
replace the allocator state, fixed record layouts survive ordinary direct and
closure calls. The descriptor-proof analysis may then retain established layout
facts across those calls, including allocating calls whose collection relocates
objects without changing their layouts. Joins, exception ingress and receiver
reassignment still require their own proofs. Unknown host operations disable the
optimization by default. This contract applies to the current closed managed ABI;
future foreign callbacks or dynamically linked code must supply an equivalent
effect contract or invalidate the proof. Source type annotations alone do not
enable it.

The backend now preserves word-conversion facts through stores and loads within
a block, and recognizes typed-array lengths as unsigned words. Unknown stores
replace those facts; block joins and exception entries conservatively start with
unknown local values. This avoids generic ToUint32 conversion after inlined
bitwise operations without trusting numeric annotations. Seven native fixtures
cover large, fractional, non-finite and signed-zero inputs, each executed twice.

A TypeScript `number` still means JavaScript Number. It does not prove integer
range, exclude NaN/infinity/negative zero, or permit reassociating floating-point
expressions. Typed-array element kinds, constants, dominating checks and induction
analysis can provide stronger facts. For example, a proven Uint32 value need not
repeat a general ToUint32 conversion; an arithmetic result needs its own range and
overflow proof. `readonly` is not by itself proof that all aliases are immutable.

In live mode, declarations can seed expected representations, but observations and
guards establish usable facts. A shape/type guard or dependency invalidation must
protect every speculative assumption. Failed assumptions transfer to generalized
native code with correct state; warnings alone cannot make stale code safe.
Inlining and scalar replacement will need recovery descriptions for values,
frames and materialized objects. No interpreter is required as the fallback.
Deoptimization infrastructure remains future work, so initial passes use proved
facts and preserve baseline native execution.

## Preserving layout proofs through lowering

The frontend computes compatible receiver shapes in `closure-lowering/records.ts`,
but `scalar-lowering` currently turns property access into a chain of descriptor
checks and a terminal trap. The backend's plain reference representation does not
retain that source-level set. Closed-world knowledge is available upstream but
has not yet become a reusable IR proof.

The next representation contract should carry allowed layouts on parameters,
results and local values. Joins take the union; constructors establish exact
layouts; assignments and call summaries transfer facts. External inputs need
validation before acquiring a restricted layout, and live-mode assumptions need
guards and invalidation. A single surviving layout permits direct field access;
multiple layouts can still share an access when field offset, encoding, presence
and initialization semantics agree. Otherwise retain dispatch. This is deferred
until the IR verifier can check the proof contract; simply disabling descriptor
checks on an unconstrained reference would lose the invariant.

An initial, narrower implementation now lives in `scalar-ir/record-facts.ts`.
It derives exact layouts from constructors and follows successful descriptor
guards through local aliases and bounded unique-predecessor chains. It stops at
joins, exception entries, opaque calls and unknown assignments. The backend omits
only descriptor tests covered by these facts, retaining cell initialization and
mutability checks. Work exhaustion retains all tests. This does not yet propagate
source-level parameter layout contracts or eliminate the first check on an
unknown incoming reference.

Immutable GC descriptor counts and field offsets are a compile-time proof:
the emitter derives them from verified record layouts and root frames. A separate
scanner capability now omits their repeated validation. The native generational
runtime supplies this capability under the emitter's managed-mutator gate, which
rejects raw-memory writes and borrowed reference environments. General scanners
remain checked. Runtime reference tracing, mutable general-value tags, authorized
reads, object containment and collection-capacity checks remain dynamic. Node
scanner/relocation tests and native moving/remembered-overflow gates pass. The
verified-descriptors-v1 full self-build and frozen stage2 smoke also pass; the
full capture is recorded in benchmarking.md and remains above the target.

## Lessons from JavaScript VMs

V8's [Maglev design](https://v8.dev/blog/maglev) describes a compact CFG/SSA pipeline,
known-value information, representation selection and liveness-based register
allocation, explicitly balancing compile latency with generated-code quality.
That balance is particularly relevant to Tint's self-build target. We can use
strict-profile proofs where a VM often needs feedback and guards, while sharing
analyses with future guarded live specialization.

V8's [TurboFan documentation](https://v8.dev/docs/turbofan) links its inlining,
bounds-check elimination and register-allocation designs. These are useful pass
families, not a requirement to reproduce its internal IR or tier structure. Its
[deoptimization documentation](https://chromium.googlesource.com/v8/v8/+/main/docs/runtime/deoptimization.md)
illustrates why optimized state needs explicit recovery metadata when assumptions
fail, especially after partially executed inlined operations.

## Validation and profiling

Keep an optimization-disabled path for differential comparisons. Exercise IEEE
754 edge cases, side effects, throws, mutation, GC pressure and source locations.
For representative modules, compare baseline and optimized native behavior and
measure machine-code size, frame/root counts, allocations and compile work.
Retain function/line identity across rewriting; removed instructions do not acquire
invented locations. Inlining will require richer source provenance than the current
single-span records.

Profile both the compiler and generated runtime. Algorithmic problems such as
quadratic set iteration or repeated whole-module scans should still be fixed in
the reusable modules that own them. The optimizer can then reduce their remaining
representation, call, allocation and memory-access costs across all callers.

Current validation includes 605 source-to-native scalar fixtures,
each executed twice with the basic pipeline under LLDB.
The native compiler also runs the scalar passes when compiling the runtime smoke target;
its debug-enabled binary matches the Node build byte for byte. These establish
initial pass correctness, not completion of the full self-hosting or timing goals.
The optimization budget covers instruction visits across folding and dead-value
analysis/removal and scalar replacement; it is a deterministic work limit, not a wall-clock deadline.
The scalar-replacement native gate preserves mutations through branches and loops,
while exact allocator accounting confirms that the local record disappears and a
separate returned record remains allocated. Normal and exhaustion variants run twice.

The AArch64 backend now uses the block-local value contract for GC root layout.
Managed temporary results share separate pointer and tagged-general pools across
blocks. Entry cleanup clears the largest prefix any predecessor can leave,
including exception edges. Persistent locals and closure environments are separate;
exception payloads are published to handler locals before temporary cleanup. This
bounds root storage by the largest block and cleanup code by incoming edges. It is
complemented by bounded backwards local-slot liveness in `@tint/scalar-ir`.
The analysis preserves uses across loops, both branches and exceptional edges;
normal-path stores cannot kill values needed before a throw. At block entry the
backend clears only dead slots that a predecessor could retain, leaving closure
environments separate. Exhausting the work budget retains conservative roots.
A native 4 KiB-heap gate checks successive 3,000-byte arrays, a once-read array
that becomes dead, and a heap string retained through an exception handler and
collection. Register allocation and reclamation within a block remain future work.

A bounded semantic specialization recognizes the strict native `includes` builtin
on nonempty arrays of at most 32 string literals with one proven string argument.
It evaluates the argument once and emits string comparisons without allocating
the temporary list. Computed elements, spreads, optional strings and `fromIndex`
retain normal lowering. This belongs to builtin lowering, before scalar passes;
`optimization: "none"` only disables the scalar optimization package. Live mode
will require builtin-identity guards before using the same rewrite.

The AArch64 remainder leaf also recognizes normal power-of-two divisors at runtime.
Exact binary scaling permits truncation and subtraction without changing JavaScript
Number semantics; quotient overflow in this guarded case produces signed zero.
Other divisors retain the general reduction algorithm. A deterministic leaf test
bounds the guarded path below 40 instructions (an address-sized baseline needed
334); native remainder fixtures cover sign, fractions, subnormals and extreme
exponents. This is instruction selection, independent of speculative type feedback.

Compiler construction costs are optimized alongside generated code. Structural
relations use reusable numeric scratch, completed subrelation caches, and direct
false-dependency propagation. Record dispatch indexes required properties and
combines cached union-member candidates in stable type order. Scalar lowering
uses indexed value, slot, and block metadata. Verification and emission use numeric
interning for arbitrary safe-integer value IDs, preserving sparse-ID contracts.
Verifier initialization analysis uses three contiguous block-by-word matrices and
three scratch vectors, avoiding both per-block vector objects and allocations
during fixed-point iteration. The emitter retains validated
instruction words and re-encodes only local replacements; serialization does not
encode the original instructions a second time. None of these changes depend on
speculative assumptions or change the intended emitted instruction sequence.

Measure the full native self-build separately from Node bootstrap time, stage
latencies, and smoke compilation. A superseded or unfinished native run provides
only a lower bound, never a completed build-time result. Same-source stage2 and
stage3 artifact comparisons remain the correctness gate for self-hosting.

GC-local liveness can project its bit vectors onto an explicit unique set of slot
IDs. The backend supplies managed/reference and general-value locals; unrelated
numeric temporaries do not consume the liveness work budget or vector space.
Unfiltered callers retain the general analysis. Tests compare projected results
with filtering the full analysis, including loops and exceptional edges. A minimum
output-work bound rejects exhausted analyses before allocating their scratch.


### Native profiling, October 30

The first successful fully profiled native self-build, `extent-index`, took
770.28 seconds including profiling and symbolication, with 768.86 seconds of
profile coverage and 51,430 samples. Stage2 was byte-identical to stage1 and
passed an independent smoke compilation. Stage3 execution remains outstanding.
Allocator search accounted for 25.23% of samples, collection for 30.59%, and
snapshotting for 13.89% within collection. Lowering and emission contained
37.73% and 34.16% respectively; these nested costs must not be added.

The following records describe the earlier investigations. Node bootstrap timings
do not establish native build-time progress. The preserved `scalar-ids` and
`root-liveness` runs both exposed pathological allocator search. Fifteen-second
and repeated thirty-second pprofessor captures attributed about 91% of samples
to `region-allocator.allocate`, specifically following undersized free extents.
A separate fifteen-second `root-liveness` window was entirely within GC marking.
These are sampled windows, not whole-build percentages.

The distinct-size regression performs 512 allocations after creating 4,096 small
holes. Exact-size hints required 4,196,864 metadata reads. Reusing undersized-prefix
proofs across larger request sizes reduces this below 100,000 reads, preserving
first-fit placement. A native full-build comparison is required before attributing
an end-to-end speedup to this change.

The next priorities are bounded allocation search under mixed sizes, reducing
pointer-bearing compiler metadata allocations, and measuring GC frequency and
live-object counts. Dense object arrays currently use sparse AVL nodes, so even
sequential append workloads create an additional managed node per element.
Contiguous verifier matrices remove one such workload. A broader dense storage
representation must preserve holes, undefined values, reference tracing and
mutation semantics. A segregated or indexed allocator should be evaluated if
prefix proofs still leave long scans; simply increasing heap size does not remove
that algorithmic cost. Nursery allocation and escape-based placement remain
separate future work, requiring explicit lifetime and write-barrier correctness.


The earlier measurement wrapped `stage1-flat-matrix` with `pprofessor run` without a
`--duration` limit, producing `profiles/flat-matrix-full-run.pb.gz` after process
exit. It builds the frozen `source-flat-matrix` snapshot into `stage2-flat-matrix`.
This captures startup, all compiler stages and output serialization in one profile.
Report profile coverage and wall time along with artifact comparison results;
do not extrapolate total-stage shares from short attach windows. The first attempt was interrupted by the user at 133.50 seconds while clearing
CPU-heavy processes; it produced no output binary. Its profile is retained as
`profiles/flat-matrix-interrupted-134s.pb.gz`, not a complete build measurement.
The replacement full capture runs alone, with other builds and native test loops
stopped, to avoid both machine contention and unnecessary CPU use.

Additional source-review candidates, pending the complete profile:

- `snapshotRegionAllocations` validates and copies by scanning the complete
  descriptor capacity, even when the allocator has used only a small prefix.
  An allocator-owned snapshot could use its private descriptor high-water mark;
  the public snapshot API should retain its full validation contract for caller
  supplied metadata. Preserve recycled slots and descriptor identity rules.
- Collector workspaces can be much larger than the current live inventory.
  Measure full-capacity clearing separately from graph traversal before changing
  initialization rules; invalid-input behavior and stale mark bits need tests.
- Native heap placement needs stable live addresses, but need not necessarily
  require first-fit placement. Keep the generic allocator's documented first-fit
  contract explicit when evaluating a separate next-fit or segregated policy.
  Allocation failure, fragmentation and reclamation behavior need adversarial
  tests; a faster happy path alone is insufficient.


The uninterrupted `flat-matrix` process lifetime was 1,139.46 seconds of profiling
(1,140.96 seconds including wrapper/symbolication). It ended without an output
binary and the profiler CLI did not report the child exit status. This is not a
successful self-build result. Its 77,007 samples attribute 59.91% cumulatively to
allocator search, 15.97% to collection, and 7.02% to allocation snapshotting (within
collection). Emission contains 55.37% of total samples, lowering 27.58%, and scalar
optimization 9.90%; nested costs must not be added together.

The indexed allocator change uses a segment maximum tree over ordered free extents. It keeps
first-fit addresses, updates split/exact-fit leaves, and uses the same tree to find
the predecessor when unlinking. Native GC borrows pending/offset scratch between
collections; index invalidation precedes any scratch reuse. No extra backing
memory or managed allocation is required. A post-GC regression previously needed
1,067,520 metadata reads for 512 mixed-size allocations and now stays below
20,000. This produced the successful `extent-index` measurement above. Later
indexed-leaf caching and bounded inventory scans require a fresh complete run.
Failure investigation of the superseded `flat-matrix` build was deferred at the
user's request while performance improved.

The subsequent frozen `bounded-snapshot` build completed in 731.67 seconds,
including profiling/symbolication, with byte-identical stage2 output. Its complete
730.15-second profile contains 55,789 samples: allocator search 18.61%, collection
36.09%, inventory snapshotting 18.15% within collection, and radix sorting 11.84%
within snapshotting. The aggregate improvement is about 5%; percentages across
runs do not by themselves establish absolute speedups for individual functions.
Short portable checks and source editing occurred during this run; no competing
native test loop, benchmark or full compiler build was launched. Its frozen input
and generated compiler exclude the later cell-copy and bitwise-word changes.

### Native instruction costs exposed by comparative benchmarks

The first shared Node/native workloads show similar large gaps across several
numeric allocator operations, in addition to a larger transient-record gap. See
[benchmarking](benchmarking.md) for saved measurements and noise caveats. This
motivates improving generated code as well as changing compiler algorithms.

Two local emitter improvements are under validation:

- Small lexical-cell payloads (up to 32 bytes) use unrolled 64-bit copies with
  exact byte tails, retaining state/immutability guards. The cell ABI already
  requires disjoint normal-memory ranges and allows unaligned addresses. Larger
  payloads keep the bounded byte loop. This targets the byte-copy loop in captured
  variable access visible in the complete self-build profile.
- Bitwise operand lowering distinguishes unknown numbers, known constant words,
  and results of bitwise IR operations. Constants use their exact JavaScript
  `ToUint32` value; bitwise results fit signed 64-bit conversion before the
  consuming 32-bit instruction. Unknown inputs retain the generic modulo helper.
  These facts come from executed IR semantics, not source type assertions. They
  currently do not propagate through slots, calls or control-flow joins.

Typed-array index checks also use hardware conversion followed by the existing
unsigned round-trip and bounds tests. This passed native edge-case checks but did
not demonstrate an overall microbenchmark speedup by itself. It must not be used
to replace arbitrary JavaScript numeric-to-word conversions.


The complete `bounded-snapshot` call graph charges substantial collection time to
allocations of verifier matrices and small instruction-encoding result records.
This is time charged to allocation sites, not an allocation-count or retained-size
profile: a matrix allocation can trigger collection of unrelated objects. The
verifier therefore has a two-matrix candidate under validation. It retains normal
and exceptional output facts, then recomputes incoming facts in a final checking
pass. This reduces the matrix storage by one third, at the cost of another meet
pass, so end-to-end timing must decide the tradeoff. A 1,000-case cyclic CFG
comparison matches the previous verifier's results and diagnostics.

Loop-local scalar replacement now considers allocations outside the entry prefix.
It still requires unique alias assignments with proven dominance for every load,
and excludes unknown uses, returned objects, parameter identity and exception
regions. Native tests permit only 32 bytes of heap storage: four loop records are
eliminated while one returned record remains. Both successful and exhausted
variants pass twice. The `loop-records` full profile measures this with the cell
and bitwise changes; it excludes the subsequent verifier matrix candidate.


The first `loop-records` profiled process ended after 491.44 seconds including
symbolication (490.27 seconds of sampling) without writing stage2 or a compiler
diagnostic. The profiler exited successfully but did not expose the compiler's
termination status. This is a complete capture of a failed process lifetime, not
a successful full-build timing or a speedup. The last verified full-build result
remains 731.67 seconds. A diagnostic rerun uses LLDB, with pprofessor attached
while stopped at process entry and left running for the entire execution, to
retain the stop reason without macOS crash-report windows.

The diagnostic replay reproduced the stop in `number-list.reserve`, reached from
`scalar-aarch64.emit`. Growing its Float64Array-backed instruction list requested
67,108,896 bytes (8,388,608 words plus the native header). The allocator reported
503,134,672 live bytes in a 3,221,225,472-byte region, but its search-tree maximum
free extent was only 33,011,984 bytes. This is fragmentation, not total live-byte
exhaustion. The observed stack and memory values are retained in
`.tint-bootstrap/loop-records-allocation-failure.txt`.

Instruction accumulation now uses `@tint/word-buffer`: lazy 16,384-word Uint32Array
pages, with append and patch operations. This halves word payload width, eliminates
presence bytes for this dense use case, and avoids copying/growing a monolithic
word buffer. The final code/image serialization still requires contiguous output;
this change does not claim to solve every large-object allocation. A 387,024-byte
multi-function emission, including cross-page fixups and budget failures, matches
the preceding emitter byte-for-byte. The next complete build measures paged words
and two-matrix verification together after a native smoke comparison.

The paged-word full attempt passed instruction accumulation but stopped allocating
the final contiguous code buffer: 28,434,000 bytes requested, 562,393,408 bytes
used in the same 3 GiB region, and only 7,956,096 bytes in its largest free extent.
No stage2 was produced, so this is another fragmentation failure, not a speedup.

The next candidate places requests of at least 64 KiB from the highest suitable
free extent, leaving small objects to low-end first-fit. Both directions share
the existing metadata, search tree and collector; the heap size is unchanged.
Mixed-direction bitmap-oracle tests, metadata-exhaustion tests, and 100,000
ordinary-allocation differential operations validate placement. Native allocator
fixtures match Node returns and metadata after every call, and hosted collection
fixtures exercise indexed high-end placement with tracing. The frozen
`high-placement` candidate also includes the word-buffer tail cursor and pagewise
serialization. Only a successful full self-build can establish its overall timing.

The `high-placement` attempt also failed at final code allocation: 28,441,328 bytes
requested, 562,737,952 used, and a largest extent of 8,143,040 bytes. Its complete
failed-run profile has 40,181 samples over 590.51 seconds including debugger stop
time. It is not a successful timing result. A full descriptor dump confirms small
objects occupy every 256 MiB band, despite large objects clustering at the high end.
The next frozen candidate reserves the top quarter against small allocations while
allowing large buffers to borrow unused low space. See `gc-relocation.md` for the
longer-term compaction direction and independently validated implementation slices.

The `large-reserve` candidate completed its full profiled self-build with 717.62
seconds of capture (55,464 samples), producing a byte-identical 41,470,954-byte
stage2. Stage2 also produced a smoke binary identical to Node. This is approximately
11m58s, still near the previous twelve-minute baseline; capture duration includes
attach/start overhead and is not the same measurement as an unprofiled wall time.
Its Node bootstrap took 13.1 seconds. The complete profile attributes 60.58% of
samples to allocation, including 36.34% in collection and 19.78% in allocator
placement. Memory-management work remains the priority. The frozen snapshot
precedes the reference-slot and relocation-planning additions.


## Closed-world type proofs and runtime facts

The strict profile compiles a closed application. Its optimizer should propagate
proven sets of layouts, primitive kinds, and call targets rather than erase those
facts into generic values and recover them with repeated guards. Source annotations
alone are not proofs: assignments, aliases, closure writes and imported/foreign effects
must respect the same contracts. Live-mode and foreign boundaries establish guards
before entering code that relies on strict facts.

Current examples include stable record-layout proofs across verified module calls,
constant extent/offset proofs for native memory operations, integer-predicate folding
for proven signed/unsigned word results, and omission of generational
barriers for numeric-only record and cell fields. Managed-cell reads also need no
barrier. Reference-bearing stores retain a generation check because generation changes
with allocation and collection; closed-world type knowledge does not determine it.
A future freshness/escape analysis can remove those checks when an object is proved
young and no intervening safepoint can promote it.

Collection still computes runtime reachability. Static type layouts determine which
fields need scanning; current values, control flow, aliasing and object lifetimes
determine which objects remain live. Bounds checks similarly require range and mutation
proofs, beyond knowing that an index has type number. Any proof lost at a join or opaque
boundary must retain its check or use a guarded specialization.

Implemented layout reasoning extends beyond local predecessor chains.
A finite constraint graph propagates actual constructor layouts through direct-call
parameters and returns, slots, record fields and owned closure environments. Every
mutation participates, so a conflicting later write invalidates the global single-layout
fact. The solver handles cycles without enumerating runtime paths and publishes only
converged results. Unknown and escaping values retain checks. The backend removes only
the descriptor comparison for these proofs. The later non-null origin lattice
also removes null handling when independently established.

Executable roots are supplied explicitly from the native invocation entry. Source
functions emitted as visible symbols are not all external entry points. This contract
must not be applied to reusable FFI libraries or live code without corresponding boundary
guards. Reusable-module analysis conservatively handles exception escape; executable
startup consumes completion and exits. Native moving-GC fixtures and recursive/alias/
mutation/escape regressions pass. Both hash-indexed and dense-indexed variants pass
full self-build binary identity and stage2 smoke validation; the dense variant
reduces analysis lookup overhead. Full timing evidence is in benchmarking.md.

Integer typed-array reads now carry a bounded-integer payload fact separately
from optional presence. Optional unwrap preserves the possibility of NaN. The
AArch64 backend uses direct integer conversion for the bounded-integer-or-NaN
case, presence for an optional integer predicate, and a NaN test after unwrap.
Float64Array and unknown values retain general conversions. Native IR fixtures
exercise present and missing reads of each unsigned integer array type and
verify both predicates and bitwise conversions; source-level Number fixtures
also pass. The field-word-proofs-v1 full self-build and frozen stage2 smoke pass;
full-run measurements are recorded in benchmarking.md.


Closed-world reachability is a separate proof from type propagation. The compiler
starts with the initializer and executable invocation, follows direct calls,
closure construction and indirect-call signature targets, and retains every
referenced record descriptor. Function and record indices are remapped together.
Unknown raw-memory capabilities or analysis-budget exhaustion retain the original
module. Exported debug symbols alone do not create external entry points.
Pruning now runs before scalar optimization to avoid work on dead bodies, then
after optimization to remove helpers made unreachable by inlining. Reusable
library builds keep their existing entry-point contract.

Knowing the whole program permits a conservative set of possible types; it does
not make exact runtime behavior statically decidable. A known finite union still
requires dispatch where control flow has not narrowed it. A monomorphic array
may eliminate element-layout tests while retaining bounds checks for an external
index. Escape, range, non-null and freshness proofs are separate from type-set
proofs. Analysis should retain and reuse each established fact rather than repeat
its check, while declining an optimization when the necessary proof is unavailable.

Optimization phases now publish checkpoints independently. An exhausted inliner
keeps completed constant folding, store/value elimination and scalar replacement.
An exhausted scalar-replacement phase keeps the preceding scalar passes, without
publishing partial replacements from earlier functions in the same phase. Work
and rewrite statistics describe exactly the retained passes; the input remains
immutable. This prevents a large module from paying for completed analyses and
then losing all their generated-code benefits when a later phase reaches its bound.


### Guarded numeric readers and bounded inlining rounds

The complete `dense-values-v1` run exposes `readNumberList` validation as a hot
path after removing most sparse array lookup. The inliner now accepts read-only
record guards, remapping object values, destination slots and both successor
edges; record writes and record-cell access remain excluded. Managed reference
locals use ordinary traced slots. Failure paths and caller exception handlers
remain intact.

Inlining runs at most twice, allowing a first round to inline small predicates
inside a reader before a second round considers the reader in its callers.
Candidate bounds are 32 blocks and 128 instructions; per-caller expansion and the
shared optimization work budget remain bounded. Each round is a checkpoint:
exhausting the second retains the complete first round. This exposes caller
facts to native analysis without declaring arbitrary runtime indices valid.
Performance remains subject to a new complete profile.


The broader inlining policy completed a verified full self-build but increased
capture duration to 314.27 seconds versus the dense-cell candidate's 280.98.
The profile shows increased verification, bit-vector and GC work despite fewer
numeric-reader calls. `OptimizationOptions.inlining: "guarded"` now opts into
32-block/128-instruction candidates and two rounds; the default retains
12-block/64-instruction candidates and one round. Guarded read cloning remains
available with the smaller budget. No broad inlining speedup is claimed.

### Transitive safepoint effects

Closed native builds run `provenNoSafepoints` over verified scalar IR before
frame layout. A bounded reverse call-graph worklist propagates allocating or
unknown effects to every caller, including recursive components. Instructions
have an explicit non-safepointing allowlist; new instructions, host calls and
indirect calls conservatively retain protection. Exhaustion publishes no proof.

For proven functions, emission omits shadow-root registration, root clearing,
root descriptors and root liveness analysis. Managed values still occupy ordinary
stack slots. Closure environment storage remains distinct from locals even when
the shadow-frame header is absent. Callers that can allocate retain their own
roots. This relies on synchronous cooperative collection: neither an asynchronous
collector nor an unmodelled callback may relocate these values mid-function.
Record, cell and vector mutation barriers do not collect; remembered queue
overflow requests a later full remembered scan rather than collecting inline.

Validation includes recursive effect propagation, conservative unknown calls,
code-size/root-descriptor assertions and native moving-GC tests with closures,
reference arrays and remembered-queue overflow. Full-build performance must be
measured separately; a static proof alone is not evidence of a speedup.

### Compact initialization facts

The verifier first proves which slots need predecessor information. Parameters
are initialized on entry; a slot used only after a store in the same block needs
no global initialization bit. The remaining slots receive dense indices in the
existing greatest-fixed-point matrices. Guarded transfer reads, writes and
exception edges use the same mapping. This changes analysis size, not acceptance
rules: reads before a local store still require predecessor facts. Existing
set-based cyclic-graph differential tests exercise the resulting verifier.

### Leaf register storage

Closed functions with a no-safepoint proof and no ordinary, indirect or host calls
can retain up to 16 frequently used single-word slots in d16..d31. Transfers use
bit-preserving moves, including reference and numeric payloads. Private generated
leaf helpers preserve this bank; tests check that contract. Cell/record-cell
transfer operations expose slot addresses, so their functions retain stack
storage. General and optional numeric/boolean two-word slots remain on the stack.
This first bounded allocator leaves temporary values and frame sizes unchanged.

The `leaf-registers-v1` frozen self-build, byte equality and stage2 smoke passed.
Its full capture was 220.11 seconds (15,534 samples), versus 222.15 seconds for
`init-slots-v1`; this small timing difference does not establish a robust speedup.
It provides infrastructure for broader register allocation without changing GC
root discovery or the public calling convention.

The next leaf-storage revision counts actual generated stack-word accesses and
promotes frequently accessed locals and temporaries together. It rewrites only
64-bit stack loads/stores to bit-preserving moves and keeps every code offset
unchanged. Context/result/header storage, large-offset accesses, partial-width
aliases, and exhausted analysis budgets remain in memory. Calls and escaped
cell-transfer addresses retain the same conservative eligibility gate.

SHA-256 compression now uses caller-owned state/scratch buffers and typed round
constants in a separate allocation-free kernel. Standard vectors, padding/view
boundaries, the million-a vector, native benchmark checks and the frozen native
self-build pass. The full `sha-compression-v1` capture was 227.73 seconds; its
correctness is established, but this run did not establish an overall speedup.

### Bitwise intermediate representation

`wordOnlyValues` proves when a bitwise result is observed solely by other bitwise
operations. Such intermediates retain modulo-2^32 bits and avoid double/word
conversion round trips. Any ordinary numeric use, slot store, boxing, call or
return keeps the established double representation. Sparse IDs, exhaustion and
functions without bitwise candidates use the existing path. Native tests include
negative zero, NaN, infinities, signed boundaries and mixed observed uses.

The `word-uses-v2` frozen self-build and stage2 smoke pass, but its complete capture
was 251.63 seconds (18,692 samples), not a demonstrated improvement. Other host
CPU activity was observed during this run; its impact has not been isolated.

### Scalars across calls

Closed builds can keep repeatedly used number/boolean locals in d8..d15, with
explicit saves at entry and restores on every normal or exceptional exit. Managed
references, general/tagged values and address-exposed cell transfer slots remain
in memory. Leaf functions use the separate volatile-bank pass instead. This
follows the lower-64-bit preservation rule in the [Arm AAPCS64 specification](https://github.com/ARM-software/abi-aa/blob/main/aapcs64/aapcs64.rst#simd-and-floating-point-registers).
Native moving-GC, remembered overflow and numeric edge-case fixtures pass; full
self-build performance remains under evaluation.

### Guarded induction words

The native backend can certify local unit-step counters initialized with word
constants. Every write must preserve the proof; each increment must be dominated
by a strict upper-bound comparison against a word constant or typed-array
length. Unique predecessor chains provide the initial bounded implementation.
Joins, exceptional entry, intervening writes, fractional initialization, larger
steps and exhausted analysis budgets retain the generic checks. This requires
verified IR and stable local slots with no opaque alias mutation.

The certificate refines numeric facts before instruction generation, removing
integer round-trip checks for array indexing while preserving bounds checks.
Knowing the complete type graph alone does not prove numeric ranges or bounds.
The analysis uses actual assignments and control flow, not unchecked source
annotations. Native validation includes fractional indices, the uint32 boundary
and mutation of a counter after its guard. The complete induction-word capture took 222.63 seconds (15,609 samples);
both 33,203,258-byte compiler stages matched and stage2 reproduced the frozen
smoke binary, which exited 42. This did not establish a full-build speedup.

### Closed-call numeric arguments

Whole-module argument analysis joins numeric facts from every direct call,
including unreachable functions. Only a complete bounded sweep publishes
parameter summaries. Declared exports are not automatically external when an
explicit closed root set is supplied; actual roots and functions materialized
as callable values retain unknown parameters. Borrowed environments and opaque
layout mutation disable the proof. Recursive parameter dependencies remain
conservative in this initial single-sweep implementation.

The backend consumes these summaries through the existing numeric fact solver,
so integer predicates and conversions benefit without changing the call ABI.
External libraries and dynamically supplied callable values retain validation.

### Bounded additive conversions

Local addition and subtraction of bounded integer values retain an absolute
magnitude bound, up to the safe-integer limit. Such results can convert to
modulo uint32 using signed 64-bit truncation followed by the existing 32-bit
operation. Optional-derived NaN remains possible and converts to zero; integer
predicates retain a NaN check in that case. Fractions, infinity and sums outside
the proven range retain general conversion. These facts never authorize removal
of array bounds checks.

### Scalar temporary registers

Functions outside the existing leaf-promotion path use a bounded linear scan to assign eligible
block-local scalar temporaries to d16..d31. Live intervals determine reuse;
register pressure falls back to stack storage. Candidates are one-word numbers
and booleans with directly stored definitions. Opaque operations, values consumed
by calls, and values live across calls retain memory. Managed references remain
in their traced storage. Existing private numeric helpers preserve this register
bank. Leaf frame promotion continues to own the same bank in leaf functions,
so the two allocation paths cannot overlap.

### Dense relation-solver scratch

The relation solver uses geometrically grown Float64Array storage for dense
node, clause, edge and pending-work tables. Query counts delimit initialized
prefixes, and each new node/clause/edge is explicitly initialized. A -1 edge
sentinel is preserved exactly. Queries retain storage for reuse; growth copies
existing entries and rejects unsupported capacities before allocation. This
avoids generic array presence metadata in tables that never contain holes.

The internal growth primitive is isolated in value-types/relation-storage.ts.
Solver semantics, coinductive convergence and completed-result cache publication
remain unchanged. Standard relation tests and native moving-GC fixtures cover
the changed storage path; full self-build measurement is pending.

For `temporary-registers-v1`, an unprofiled LLDB-wrapped complete self-build took
213.04 seconds and reproduced its 33,154,346-byte stage1 exactly. The matching
full profile captured 242.45 seconds with 17,834 samples. The one-minute target
remains unmet. Profiling adds overhead but does not account for most latency.

### Pooled traced temporaries

The shared `valueLifetimes` analysis computes last uses for verified block-local
SSA. `planTemporarySlots` keeps separate pointer and tagged-general pools and
reuses a slot only strictly after its previous value's last use. An allocating
instruction's result therefore cannot alias an operand needed during that
allocation. Existing block-entry cleanup uses the new peak counts. Locals and
closure environments retain their existing layouts. Budget exhaustion keeps
the original unpooled layout.

### Non-null record origins

Whole-module record flow now propagates nullability alongside descriptors in
the same bounded fixed-point worklist. Constructors establish non-null origins;
null values contribute nullable origins; external/opaque inputs remain unknown.
Checked reference bridges filter null only on their successful continuation.
Proof bit 1 identifies an exact descriptor and bit 2 a non-null origin; the
backend removes the corresponding field-access checks independently. Cast
validation itself is retained.

### Local copy propagation

`forwardLocalLoads` substitutes block-local loads with canonical SSA values from
preceding stores or loads. Calls, host effects, throwing operations and block
boundaries invalidate slot knowledge. Already captured SSA snapshots remain
immutable; stores are left for the existing unread-store pass so exceptional
consumers remain visible. The following dead-scalar and scalar-replacement
passes can then remove newly exposed redundant work.

Operand substitution is a separate scalar-IR primitive. It rewrites value uses
without changing definitions, slot identities, control labels, descriptors or
source spans, and preserves unchanged instruction objects. The pass bounds its
work and declines pathological sparse-ID layouts rather than allocating an
unbounded table.

### Cleanup after inlining

Inlining now reruns constant folding, local load forwarding, unread-store removal
and dead-scalar removal on changed functions. This exposes constants and removes
result-slot traffic introduced by the inliner. Unchanged functions are skipped;
all phases share the original work budget and publish only complete checkpoints.
A regression checks that an inlined scalar multiplication reduces to its constant
result, and budget tests retain the last completed inlining round.

The `post-inline-v1` full native self-build profile captured 116.43 seconds
(8,213 samples), compared with 146.49 seconds for `forward-loads-v1`. Both snapshots
reproduced their bootstrap binaries byte for byte and passed the stage2 smoke test.
These captures include profiling overhead and host scheduling effects; the
one-minute goal is not yet met.

The direct union-relation shortcut now shares the recursive solver's discriminant
index. It filters only unions whose every variant has a required literal string
property; unknown tags/shapes fall back, and duplicate-tag alternatives retain
order. `union-filter-v2` reproduced its compiler and smoke executable, but its
116.75-second full profile showed no meaningful overall latency improvement.

### Inline captured-cell reads

Scalar code generation emits small aligned cell reads directly: state must equal
one, otherwise control reaches the existing failure edge without changing the
transfer slot. Successful reads copy the complete scalar payload. Initialization
and mutation retain their guarded helper path. The native fixture
`tools/verify-inline-cells.ts` exercises states 0, 1, 2 and 255 and checks source
preservation and the failure destination twice under LLDB.

### Source locations and generic hash storage

Linked module ranges are ordered and disjoint. Source-location lookup now uses
binary search instead of allocating a capturing predicate and scanning ranges.
The regression covers endpoints, gaps, invalid spans and a logarithmic lookup
bound over 1,024 ranges. `source-lookup-v1` reproduced its compiler and smoke
executable; its full profile captured 112.79 seconds (8,105 samples).

The first generic flat hash experiment (`flat-index-v1`) regressed to 291.63
seconds. Its full profile attributed 61.57% of samples to sparse-list lookup:
random writes into empty reference arrays triggered the sparse representation.
The replacement uses numeric bucket IDs and contiguous managed entry storage.
Its native performance must be measured independently; Node correctness alone
cannot establish the native storage or allocation behavior.

Verified direct calls no longer clear the completion buffer before calling.
Every field the caller consumes is written by its verified callee, including the
throw payload; padding is unobserved and this buffer is not a GC root. Completion
checks still precede payload access. Indirect calls and allocator callbacks retain
buffer initialization. The generated-code regression checks the removed stores.
