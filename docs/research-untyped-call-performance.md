# Untyped JavaScript call and loop performance in Tint

## Measurements and target

Tint needs to match or beat V8 on the JavaScript control, closure, method,
property, array, string equality, rest and recursive kernels. Test short
runs and steady state separately. Long runs let V8 enter optimized code
through OSR inside a single invocation. A short run measures a different
mix of tiers. The pinned macOS arm64 comparison binary is Node 26.13.1,
V8 `14.6.202.34-node.40`. The V8 source links below point to that exact Node
release's vendored source. The other engine links identify the revisions
read for this report. [Node 26.13.1 revision][node] · [Benchmark sources](../tools/general-call-bench/kernels.ts)

The original estimate of roughly 175 ns for the remaining Tint control loop
was borne out by a 16-round, locked experiment at 25 million iterations.
The previously retained untyped build measured 180.05 ns per iteration
(IQR 175.65–184.17), the direct-leaf trial 50.51 ns (48.27–54.05), and typed
Tint 1.85 ns (1.77–1.91). The direct-leaf trial improved the paired median
by 128.85 ns (IQR 121.74–132.71). Node measured **0.60 ns** (0.59–0.63).
The earlier approximately 2.4 ns Node figure should not serve as the
steady-state acceptance threshold. At 25 million iterations, the newer
guarded Tint loop took 1.97 ns during an instruction-trace run. The paired
timing experiment for that build is separate. [Tint instruction accounting](results/general-call-instructions-darwin-arm64-ac299b208.md)

| One full control iteration                                  | Retained general build | Direct leaf | Guarded scalar loop | Typed |
| ----------------------------------------------------------- | ---------------------: | ----------: | ------------------: | ----: |
| Dynamically executed instructions                           |                  2,484 |         946 |                  10 |    10 |
| Managed allocations                                         |                      8 |           1 |                   0 |     0 |
| Managed bytes                                               |                    352 |          48 |                   0 |     0 |
| Dynamic calls, including the source arrow                   |                     20 |           8 |                   0 |     0 |
| Distinct call return PCs with stack maps                    |                     19 |           7 |                   0 |     0 |
| Dynamic crossings of those PCs                              |                     20 |           8 |                   0 |     0 |
| Inline managed write-barrier checks                         |                     13 |           0 |                   0 |     0 |
| Barrier slow paths and collections in the sampled iteration |                      0 |           0 |                   0 |     0 |

The 2,484 instructions break down into **1,435** for the call chain,
**365** for identifier resolution of the loop bound, **148** for generic
increment, **128** for truthiness, and **408** in the caller for argument
list construction, spills, guards, result checks and loop control. The
eight cursor increments were 32 B for mutable captured call state, 32 B
for a thunk capture, 40 B for the thunk, 32 B for the generic call result,
104 B for an empty callee environment, 40 B for its scope, 48 B for the
increment result, and 24 B for the empty argument list. Numeric scalars
did not individually allocate and the arrow did not create an
`arguments` object. See the instruction report for every call edge and
allocation address. Instruction counts establish the executed work.
They cannot assign nanoseconds independently to nested calls, predict
throughput from instruction count alone, or measure the allocation
pressure from other iterations. [Tint instruction accounting](results/general-call-instructions-darwin-arm64-ac299b208.md)

### What the pinned V8 binary actually emitted

I ran the control source through Node with `--trace-opt --trace-deopt
--print-opt-code --print-opt-code-filter=control`. The 20,000- and
25,000,000-iteration checksums were 840,000 and 1,050,000,000. The trace
showed Maglev OSR followed by TurboFan OSR. The TurboFan code checked the
OSR inputs and the closure's many-closures feedback cell before entering
the repeated body. It inlined the literal 42, carried the index and
accumulator in 32-bit integer registers, and unrolled four source
iterations. The repeated block used integer additions with overflow exits
and tested the bound between iterations. An interrupt poll ran once per
unrolled group. There was no JavaScript call in that block. Each
implementation inlined the leaf. Tint's 10-instruction loop materializes
floating constants, moves double results back into their loop homes and
takes an unconditional backedge. Eliminating another runtime call cannot
close that gap on this control. [Tint machine trace](results/general-call-instructions-darwin-arm64-ac299b208.md) · [V8 OSR compiler entry][v8-osr]

## V8

**Choosing a target and inlining.** TurboFan's `JSCallReducer::ReduceJSCall`
uses a constant target or creation node when it has one. With feedback,
it can check reference identity and use the known function, or check a
feedback cell and use the shared function while loading the actual
closure's context. A feedback cell describes a shared target across
closures and does not imply identical captured values. Bound callees
also have reductions that preserve the bound receiver and leading
arguments. `JSInliningHeuristic` considers small polymorphic candidates,
call frequency, bytecode size, depth/recursion and cumulative budget.
Maglev's `BuildCallWithFeedback` emits the corresponding function or
cell guard, loads the context when necessary, and tries a known-function
call. `CanInlineCall` checks recursion, inlineability, site frequency and
size. Small calls can be inlined eagerly and eligible larger candidates
can use separate inlining budgets. [TurboFan call reduction][v8-reducer] · [TurboFan inlining][v8-inlining] · [Maglev feedback lowering][v8-maglev-call] · [Maglev inlining][v8-maglev-inline]

**Calls and arity on AArch64.** In the ordinary V8 JS ABI, `x0` carries
the actual argument count, `x1` the function, `x3` the new target and
`cp` the lexical context. The receiver and JS argument values are stack
slots. The generic function builtin loads the callee context before any
sloppy receiver conversion. It can replace a nullish receiver with the
callee realm's global proxy or box a primitive. Calling optimized,
inlined code can eliminate that ABI boundary. A register for the count
does not imply all JS arguments are passed unboxed in registers. [Register definitions][v8-regs] · [CallFunction builtin][v8-builtin-call] · [Compiler linkage][v8-linkage]

V8 removed the arguments adaptor **frame** in 2021 by putting the actual
count in the regular frame and changing the stack argument order. At
equal or greater arity, the invoke prologue skips the padding path.
Extra supplied slots are available to code that observes them and the
return sequence drops the larger of actual and formal spans, accounting
for the receiver and alignment. For under-application, the current
AArch64 implementation claims stack space, may **move the existing
receiver and arguments within the stack** to preserve alignment, and
writes `undefined` into the missing slots. It builds neither an adaptor
frame nor a managed argument array for the ordinary call. `arguments`
and rest are distinct source operations with their own lowering and
sometimes allocation. [2021 adaptor-frame design][v8-adaptor] · [Current invoke prologue][v8-prologue] · [Return teardown][v8-return] · [Arguments object and rest lowering][v8-arguments]

**Feedback, shapes and numeric representation.** A feedback vector
records call-target information and call counts. Property ICs associate
receiver maps and handlers and can move from monomorphic through
polymorphic to megamorphic behavior. The compiler consumes these
observations to specialize loads or calls and retains the required
guards or dependency checks. A Smi is an immediate tagged signed
integer. `HeapNumber` contains the binary64 payload for numbers needing
that representation at a tagged boundary. Smi width depends on build
configuration. The pinned Node binary reports pointer compression
disabled and its observed Smi untag shifts by 32 bits. Optimized nodes
and phis can use int32, Float64 and hole-aware representations with
typed registers/spills. Unboxed float computation need not allocate a
`HeapNumber` per iteration. [Feedback slots and call counts][v8-feedback] · [Load IC cache updates][v8-property] · [Smi configurations][v8-smi] · [HeapNumber][v8-heapnumber] · [Maglev phi representation selection][v8-phi] · [Maglev design][v8-maglev-design]

**Moving work out of loops.** Tiering can install optimized loop code at
an active bytecode offset. Guard failure can exit eagerly to reconstructed
frames. Dependency invalidations can produce lazy deopt where an optimized
activation is already in flight. Frame translation and materialization
carry the live values needed to resume. TurboFan specializes context loads
to known slots and can use context-cell dependencies. Inlining and escape
analysis can expose nonescaping contexts, closure records and other
allocations. Scalar replacement treats them as virtual objects and emits
materialization information for deopt, while escaping or observed
allocations remain real. Merely sharing a function body across closures
does not allow constant-folding its mutable captured slots. [Tiering and OSR][v8-osr] · [Deoptimizer][v8-deopt] · [Context specialization][v8-context] · [Closure creation][v8-create] · [Escape analysis][v8-escape] · [Escape reducer][v8-escape-reducer]

## JavaScriptCore

LLInt and Baseline collect call, value and heap feedback. The DFG combines
predictions with abstract interpretation and effect/alias analysis.
It can check a callee, inline known variants and use typed operations.
FTL uses DFG SSA, performs stronger optimization and lowers through B3
to Air. OSR entry can bring a hot loop into optimized code. Check failures
or invalidated watchpoints use OSR exit to reconstruct the lower-tier
state. The DFG/FTL allocation-sinking pass virtualizes nonescaping
allocations and tracks where they would need to be materialized. [JSC tier design][jsc-design] · [Inlining plan and variants][jsc-dfg] · [OSR entry][jsc-osr] · [Allocation sinking][jsc-sinking]

On the 64-bit `JSValue` configuration, JSC uses a single NaN-encoded
word. Int32 payloads occupy an integer-tag pattern, double bit patterns
are offset on encoding, and cells and other immediates occupy other
patterns. Int32/double machine registers in optimized computations are
still distinct from this boundary representation. A call site's
`CallLinkInfo` can hold a monomorphic callee and entry point or a
polymorphic stub. Repatching builds a bounded set of call variants,
can collapse closure variants to executable identity plus a dynamic
environment, and chooses a virtual call for cases beyond that limit.
Weak visitation and unlinking keep cached code and cells valid.
FTL's patchpoints describe operands, clobbers and stack-map needs.
B3 selects Air instructions and Air allocates integer and FP live
ranges, spills and adjusts stack locations. At the audited revision
the optimizing allocator is greedy, with live-range splitting and
coalescing. Historical B3 descriptions discuss graph coloring and
should not be read as the current allocator. [JSValue representation][jsc-value] · [CallLinkInfo][jsc-link] · [Polymorphic link construction][jsc-repatch] · [FTL lowering][jsc-ftl] · [B3 and Air design][jsc-b3] · [Air pipeline][jsc-air] · [Greedy register allocation][jsc-reg] · [Allocator update][jsc-modern]

## SpiderMonkey

Baseline's interpreter and compiler share IC entries and a fallback.
A miss runs the language operation and may attach a CacheIR stub. CacheIR
expresses a sequence of shape, callee and value guards, simple loads and
a final result operation. A scripted call stub can guard function
identity or script entry data and record a same-realm fast case.
Own/property-chain loads and other operations have corresponding stub
generators. Warp's main-thread oracle snapshots applicable Baseline
stubs and call-site data. Warp transpiles eligible CacheIR guards and
results into MIR off-thread, can use trial-inlining information, then
lowers through Ion's optimizing backend. A bailout reconstructs
Baseline state. [Optimization design][sm-design] · [Baseline ICs][sm-baseline] · [Scripted call stub][sm-call] · [Trial inlining][sm-trial] · [Warp snapshots][sm-warp] · [CacheIR transpiler][sm-transpiler] · [Bailout implementation][sm-bailout]

The JS frame has a callee token, an actual-argument count in the frame
descriptor, a receiver slot and adjacent argument values. At the native
entry bridge there are separate machine registers for count, vector
and token. The specialized call's same-realm flag can skip realm
switching. The arm64 under-arity rectifier still builds a frame,
moves input values and pads with `undefined`. It preserves the actual
count and a constructor's new target. This is useful evidence that
removing a managed argument list and removing all argument movement
are separate design choices. [Frame layout][sm-frame] · [Native entry and rectifier][sm-rectifier] · [Baseline stub codegen][sm-compiler]

## Ahead-of-time approaches

| System                    | Where specialization comes from                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | What transfers to Tint                                                                                                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hermes bytecode AOT       | Legacy Hermes analyzes and optimizes register bytecode at application build time. Statically recognized calls can be lowered to builtin IDs under the explicit static-builtins policy. The compiler also propagates types through known operations and known calls. The legacy architecture used a bytecode interpreter.                                                                                                                                                                                                      | Resolve a builtin from binder facts or explicit assumptions. In open JS, verify identity or preserve the generic property/call operation. Avoid a compiler option that silently freezes the meaning of mutable globals.                     |
| Static Hermes native path | `shermes` emits native code via generated C. Its typed mode obtains exact layout and representation facts from a sound typed dialect, checks casts crossing from untyped code and supports ordinary untyped functions alongside it. The C backend and static passes are relevant. Modern Hermes also has an optional JIT, so the native mode is the comparison here.                                                                                                                                                          | Share typed and untyped execution machinery, take scalar layouts where proved, keep a catch-all entry. An unsuccessful optimization guard on untyped Tint code must run JavaScript, while a written type contract still throws on mismatch. |
| QuickJS                   | The compiler emits stack bytecode, computes maximum operand-stack depth and assigns local or closure slots. `qjsc` packages precompiled bytecode with the interpreter. The runtime uses tagged arithmetic fast paths and a `this, argc, argv` boundary. Calls can reuse argv where flags and arity allow. Under-arity or copied-argv paths allocate stack slots and pad. Captures use variable references that can initially refer to live frame storage.                                                                     | Use cheap fixed slots and pass a borrowed argument span or register values, with lazy heap materialization for escaping observations. This demonstrates low general-call overhead without PGO, native clone generation or a JIT.            |
| Porffor                   | The audited compiler lowers JS to a C backend through its own IR. Code generation uses known node types where available, direct calls for resolved targets and typed/tagged dispatch for dynamic cases. A historical, pre-rewrite Wasm backend had offline PGO that instrumented local writes, executed a training build and used observations to select integer layouts or constants. That historical mechanism is not evidence of a production PGO path in the current branch, or of guarded correctness for unseen values. | Infer from local operations and closed call edges. A profile can choose a candidate and its budget. It cannot prove a JS restriction. Emit a guard and general continuation when the analysis cannot prove the assumption.                  |
| AssemblyScript            | Source and contextual static types determine numeric modes and Wasm signatures. Generic instantiation generates typed functions, and call lowering chooses the resolved direct or indirect typed route. This works by restricting the source language and changing its dynamic semantics.                                                                                                                                                                                                                                     | Reuse monomorphization and typed scalar signatures inside a proven or guarded region. Dynamic values crossing into the region need the open JS path.                                                                                        |
| GraalJS and Native Image  | Truffle call nodes can cache object identity or function data and fall back to indirect calls. The optimizing runtime splits ASTs at selected call sites and partially evaluates stable interpreter/AST state with dependencies. Native Image AOT compiles the Java host and can apply closed-world analysis and offline host PGO. A Native Image with an optimizing Truffle runtime can still compile hot **guest** JS at run time. Its interpreter-only configuration has no such guest optimization.                       | Reuse the idea of bounded site-specific clones and specializing away an interpreter or runtime layer with known inputs. Separate host PGO from guest target/type data. Runtime Truffle splitting itself is not an AOT guest parity result.  |

Hermes sources and design. [Legacy Hermes architecture][hermes-2019] · [Native and typed modes][hermes-readme] · [Typed boundaries][hermes-types] · [Builtin lowering][hermes-builtins] · [Type inference][hermes-inference] · [Static C emitter driver][hermes-driver]

QuickJS and ahead-of-time code generation sources. [QuickJS internals][quick-doc] · [QuickJS call and arguments code][quick-call] · [QuickJS value representation][quick-value] · [Porffor frontend][porffor-code] · [Current Porffor backend description][porffor-readme] · [Historical Porffor PGO][porffor-pgo] · [AssemblyScript language status][as-status] · [AssemblyScript call lowering][as-call]

Truffle and Native Image sources. [GraalJS function call caches][graaljs-call] · [Truffle splitting][graal-split] · [Truffle partial evaluator source][graal-pe] · [Partial evaluation design][graal-pe-doc] · [Native Image host compilation][graal-host] · [Interpreter-only engine mode][graal-fallback] · [Native Image PGO][graal-pgo]

Two research results speak directly to this design. Serrano's Hopc
uses operation-derived type hints, guarded versions, range and
representation analysis to optimize open JS ahead of time. Chandra and
colleagues show what stronger type inference can obtain for an explicitly
restricted JavaScript subset. Chevalier-Boisvert and Feeley's
interprocedural basic-block versioning demonstrates the value of shared
call-boundary representation facts in a JIT. Tint can choose a finite
set of the same representations from static facts without reproducing
their runtime compiler. The PIC paper is the prior art for short
target sets with a generic miss. [Hopc design][hopc] · [Hopc performance study][hopc-study] · [Static JS type inference][static-js] · [Interprocedural versioning][bbv] · [Polymorphic inline caches][pics]

## Ranked implementation plan

The first item closes the measured **current control** gap. The next two
target the largest remaining costs across the **suite**. All change sizes
are hypotheses until paired runs confirm them. Keep each experiment
separate and compare it with its immediate predecessor and pinned Node.

| Rank and change                                                               | Expected gain                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Implementation cost and semantic risk                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Prove bounded integer induction and accumulation, then tune the loop body  | About 1.25 ns per iteration separates the typed-sized Tint loop from the 0.60 ns steady V8 reference. The initial opportunity is to replace double additions, constant materializations and loop-home moves with int32 operations. Counted-loop inversion and bounded unroll are separate candidates. A once-guarded reduction closed form can remove the loop entirely where the proof establishes every intermediate result is exact and no iteration can expose effects. | Medium. Reuse scalar IR and the counted-loop pass. Prove initial/test/update and reduction ranges, direction, exit and intermediate exactness. Guard before observable work on fractional inputs, NaN, infinities, signed zero where relevant and potential overflow. Preserve the current binary64/general path on miss. Avoid changing existing typed code absent a separate measured improvement.                    |
| 2. Analyze closed call and capture graphs, then reuse direct native entries   | The historic control saved 128.85 ns through this class of optimization. It already has the win. Known closures with captures and recursive calls are the next targets. Expect elimination of the call-chain class of costs at proven sites. Profile those kernels before assigning a nanosecond estimate to them.                                                                                                                                                          | High. Summarize function observation, capture values and effects, and solve recursive call components conservatively. Permit a scalar capture only when alias/escape analysis proves its value or when the actual captured slot is read with a guard. Preserve TDZ, lexical identities, realm, function object identity and abrupt completion. Escaping closures retain their JS object and storage.                    |
| 3. Add shape/element proofs and small guarded property/call paths             | Zero on the control. Candidates remove repeated lookup/descriptor dispatch in the method and property kernels and dense element lookup in the array kernel. Capture the allocation and runtime-call counts for those loops first. Test string equality separately using pointer identity and the existing content equality on miss.                                                                                                                                         | High for shared object shapes, medium for closed nonescaping literals. Preserve getter/proxy ordering, the receiver, holes, indexed prototype fallback, layout transitions, writable/contract checks and GC barriers. Check the shape/epoch and necessary prototype conditions before direct accesses. A shape hit cannot assume an independently replaced method value.                                                |
| 4. Remove heap argument transport and unnecessary realm work on general calls | Up to the allocation and runtime work observed in the original 1,435-instruction call chain, with strong overlap with item 2. A list-only or realm-only improvement was previously inconclusive. The direct/loop control has zero incremental saving here. The rest and genuinely polymorphic kernels determine this item's value.                                                                                                                                          | High for ABI and GC correctness. Start from a fixed-small-arity entry carrying the receiver/context and an actual count, with a rooted spill span beyond register capacity. Keep a managed-list adapter at general escapes. Preserve mapped arguments, rest semantics, default initializers, spread/iterator ordering, exceptions, tail calls and correct cross-realm state. Verify moving-GC maps and recursion depth. |
| 5. Budget polyvariant clones and add optional offline profiles to choose them | Zero additional work to remove on the scalar control unless a newly selected integer clone changes its loop. Useful for callers with stable distinct argument/capture representations and for density/branch layout. Profile data buys coverage and prioritization, not correctness.                                                                                                                                                                                        | Medium to high. Key and deduplicate clones by target and proven representation/effect summary. Retain the single general entry, track refusal and code-size/compile-time growth, and use representative training and held-out data. Stop expanding polymorphism before code size or instruction-cache cost overwhelms savings.                                                                                          |

### Tint implementation points

These are the first files and entry points each experiment would touch.
More general collector, ABI or representation changes need their own
measured justification.

1. **Integer and loop code.** In
   [general lowering](../packages/js-engine/src/lowering/index.ts), extend
   `numericLoopImplementation`, `numericWrite` and the numeric entry
   guard in `callable` with a proven integer range path. Preserve its
   existing binary64 body. In [scalar lowering](../packages/ts-native/src/scalar.ts),
   use `lowerFunction` and its `for` lowering to retain integer phis and
   immediate increments. Reuse [`boundCountedLoops` and `countedLoop`](../packages/ir/src/optimization/counted-loops.ts)
   to validate trip bounds and [`naturalLoops`](../packages/ir/src/scalar/loops.ts)
   for the loop region. Inspect [`slotHomes`](../packages/codegen/src/aarch64/scalar/slot-registers.ts)
   and [`forwardRegisterRoundTrips`](../packages/codegen/src/aarch64/scalar/register-moves.ts)
   if the trace still has loop-home copies. Put diagnostics and unit
   boundaries in the existing general-call fixture and lowering tests.
2. **Closed targets and captures.** Use
   [binder `reference`, `Binding.captured` and `FunctionBinding`](../packages/typescript/src/binding/index.ts)
   as the identity/effect inputs. Extend the
   [`planFunctionFallback` and its `numericCalls` construction](../packages/js-engine/src/program/function-fallback.ts)
   and [`numericLeaf`, `localizeInitialized`, `invokeNumericLeaf` and `callable`](../packages/js-engine/src/lowering/index.ts)
   to share callable summaries and generated native entries for local
   declarations and captured closures. Reuse [`inlineSmallFunctions`](../packages/ir/src/optimization/inline.ts)
   and [`lowerFunction` and `callArguments`](../packages/ts-native/src/scalar.ts)
   for existing register signatures. Retain [`createSourceFunction`](../packages/js-runtime/src/objects/functions.ts)
   where the source closure escapes or needs general invocation.
3. **Properties, arrays and methods.** Start in
   [`propertyValue` and `callTarget`](../packages/js-engine/src/lowering/index.ts)
   and the existing [`getObjectValuePropertyWithReceiver`,
   `setObjectValuePropertyWithReceiver` and `scriptStrictEqual`](../packages/js-runtime/src/objects/values.ts)
   fallback interfaces. Anchor the layout and invalidation proof at
   [`ordinaryGetOwnProperty`, `ordinaryDefineOwnProperty`,
   `ordinaryDeleteProperty`, `getProperty` and `setProperty`](../packages/js-runtime/src/objects/operations.ts).
   Use [`createArrayObject`](../packages/js-runtime/src/objects/arrays.ts)
   and its [packed element storage](../packages/js-runtime/src/objects/array-elements.ts)
   for the dense case. Preserve prototype and exotic fallbacks.
4. **Call transport and context.** Change
   [`argumentList`, `invokePrepared`, `invokeList`, `callable`](../packages/js-engine/src/lowering/index.ts),
   [`callArguments`](../packages/ts-native/src/scalar.ts),
   [`callObjectValue`](../packages/js-runtime/src/objects/values.ts),
   [`callObject`](../packages/js-runtime/src/objects/call.ts) and the
   source-call adapter in [`createSourceFunction`](../packages/js-runtime/src/objects/functions.ts).
   Feed the view to [`instantiateScriptArguments`](../packages/js-runtime/src/environments/global/arguments.ts)
   when it must become observable. Preserve
   [`runScriptContext`, `enterSourceCall` and `exitSourceCall`](../packages/js-runtime/src/objects/jobs.ts)
   effects where the callee may observe them. Separate the ABI and realm
   experiments so their gains and failures are attributable.
5. **Clone selection.** Keep call-site selection in the
   [`planFunctionFallback` and `planTypedCompanions`](../packages/js-engine/src/program/function-fallback.ts),
   representation lowering at [`lowerFunction`](../packages/ts-native/src/scalar.ts)
   and final budgets near [`inlineSmallFunctions`](../packages/ir/src/optimization/inline.ts).
   Put offline collection in [the benchmark driver](../tools/general-call-bench/benchmark.ts)
   first. No profile may turn an unproven target into an unguarded call.

### Which VM techniques pay for which Tint costs

| Technique                                                      | AOT treatment in Tint                                                                                                                                                                             | Share of the historical control cost                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target IC, identity check or known edge                        | Prove the binding or emit a dominating guard on the already evaluated callee. Consider a small data cache for open sites only after static candidates.                                            | Part of the 1,435-instruction call path and caller setup. The direct-leaf experiment measured the combined 128.85 ns saving.                                                                                                                                                                                                                                            |
| Inlining, cloned call versions and scalar parameter passing    | Use static summaries, existing scalar ABI and bounded inlining first. Guard each speculation.                                                                                                     | Same call bucket. Cloning alone has no measured separate saving.                                                                                                                                                                                                                                                                                                        |
| Arity, receiver and lexical context                            | Keep actual count, reuse stack/register values, materialize observations and preserve realm transitions on misses.                                                                                | Empty list 24 B, thunk/capture/state/result 136 B, and empty callee scope/environment 144 B before the direct leaf eliminated them. No isolated wall-time saving established.                                                                                                                                                                                           |
| Context specialization and escape analysis                     | Statically resolve local slots, prove closed captures and virtualize only nonescaping state.                                                                                                      | Loop-bound lookup accounted for 365 instructions. The callee's empty environment/scope was 144 B in the overlapping call bucket.                                                                                                                                                                                                                                        |
| Representation selection and guard hoisting                    | Propagate number and range facts to loop phis. Preserve ToPrimitive and wider number semantics at the boundary.                                                                                   | The post-direct path still retired 946 instructions, allocated the 48 B increment result and made eight runtime calls. The guarded body removed 936 instructions. The 50.51 ns direct-leaf median and 1.97 ns trace timing suggest another roughly 49 ns opportunity, pending paired confirmation. The remaining current-control budget is around 1.25 ns to steady V8. |
| Shapes, polymorphic property ICs, compact boxed general values | Use direct closed-layout access or guarded offsets. A tagged-value redesign affects GC, the ABI and every fallback, so defer it pending profiles showing a separate win.                          | The control had no property load. A single-word encoding cannot eliminate an allocation of its numeric primitives since there were none.                                                                                                                                                                                                                                |
| OSR, bailout and invalidation                                  | Use entry/region versioning and explicit side exits. At crossed side effects, resume with the exact current values and continuation. Use ordinary guards or dependencies when open state changes. | OSR itself removes no per-iteration work. The measured benefits come from specialization it permits. The current control can choose its version at entry, before any loop effect.                                                                                                                                                                                       |
| Offline profiles and static interprocedural inference          | Use facts to discharge guards, use training to budget clones, and test held-out cases.                                                                                                            | Neither independently removes nanoseconds. They choose or prove the applicable entries above.                                                                                                                                                                                                                                                                           |

For each candidate, require a heavy and a short workload with the original
inputs and checksums, at least 15 rotated paired rounds under
`tint-timing.lock` without an acquisition timeout, an exact native hot-path
trace, and per-case median and IQR. Parity requires a nonpositive paired
Tint-minus-Node median with an IQR supporting the claim in the adopted
steady-state comparison. Report inconclusive cases. Retain the typed-image
check, frozen v7 wall-time/RSS, native self-build fixpoint, full 758-loop
selection, 200-form ledger and focused boundary tests. Test the guard
misses even when they are rare. Use fresh array, class, proxy, realm and
operand-mutation cases where relevant to the change.

[node]: https://github.com/nodejs/node/commit/e9c277643b0249c50f6e6de5413be8a88ea11b6a
[v8-osr]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/runtime/runtime-compiler.cc#L623-L717
[v8-reducer]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/compiler/js-call-reducer.cc#L4834-L4949
[v8-inlining]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/compiler/js-inlining-heuristic.cc#L219-L375
[v8-maglev-call]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/maglev/maglev-graph-builder.cc#L12106-L12167
[v8-maglev-inline]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/maglev/maglev-graph-builder.cc#L8398-L8559
[v8-regs]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/codegen/arm64/register-arm64.h#L600-L617
[v8-builtin-call]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/builtins/arm64/builtins-arm64.cc#L2875-L2958
[v8-linkage]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/compiler/linkage.cc
[v8-adaptor]: https://v8.dev/blog/adaptor-frame
[v8-prologue]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/codegen/arm64/macro-assembler-arm64.cc#L2692-L2768
[v8-return]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/compiler/backend/arm64/code-generator-arm64.cc#L4390-L4425
[v8-arguments]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/compiler/js-create-lowering.cc#L155-L258
[v8-feedback]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/objects/feedback-vector.cc#L1035-L1095
[v8-property]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/ic/ic.cc#L632-L715
[v8-smi]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/include/v8-internal.h#L78-L195
[v8-heapnumber]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/objects/heap-number.h#L21-L72
[v8-phi]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/maglev/maglev-phi-representation-selector.cc#L148-L242
[v8-maglev-design]: https://v8.dev/blog/maglev
[v8-deopt]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/deoptimizer/deoptimizer.cc
[v8-context]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/compiler/js-context-specialization.cc#L185-L337
[v8-create]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/compiler/js-create-lowering.cc#L943-L1012
[v8-escape]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/compiler/escape-analysis.cc#L631-L720
[v8-escape-reducer]: https://github.com/nodejs/node/blob/e9c277643b0249c50f6e6de5413be8a88ea11b6a/deps/v8/src/compiler/escape-analysis-reducer.cc
[jsc-design]: https://webkit.org/blog/10308/speculation-in-javascriptcore/
[jsc-dfg]: https://github.com/WebKit/WebKit/blob/0eef7560baac704b60f3f118665f47a7711cd335/Source/JavaScriptCore/dfg/DFGByteCodeParser.cpp#L202-L387
[jsc-osr]: https://github.com/WebKit/WebKit/blob/0eef7560baac704b60f3f118665f47a7711cd335/Source/JavaScriptCore/dfg/DFGOSREntry.cpp
[jsc-sinking]: https://github.com/WebKit/WebKit/blob/0eef7560baac704b60f3f118665f47a7711cd335/Source/JavaScriptCore/dfg/DFGObjectAllocationSinkingPhase.cpp
[jsc-value]: https://github.com/WebKit/WebKit/blob/0eef7560baac704b60f3f118665f47a7711cd335/Source/JavaScriptCore/runtime/JSCJSValue.h#L344-L409
[jsc-link]: https://github.com/WebKit/WebKit/blob/0eef7560baac704b60f3f118665f47a7711cd335/Source/JavaScriptCore/bytecode/CallLinkInfo.cpp#L137-L318
[jsc-repatch]: https://github.com/WebKit/WebKit/blob/0eef7560baac704b60f3f118665f47a7711cd335/Source/JavaScriptCore/bytecode/Repatch.cpp#L125-L232
[jsc-ftl]: https://github.com/WebKit/WebKit/blob/0eef7560baac704b60f3f118665f47a7711cd335/Source/JavaScriptCore/ftl/FTLLowerDFGToB3.cpp
[jsc-b3]: https://webkit.org/blog/5852/introducing-the-b3-jit-compiler/
[jsc-air]: https://github.com/WebKit/WebKit/blob/0eef7560baac704b60f3f118665f47a7711cd335/Source/JavaScriptCore/b3/air/AirGenerate.cpp#L78-L137
[jsc-reg]: https://github.com/WebKit/WebKit/blob/0eef7560baac704b60f3f118665f47a7711cd335/Source/JavaScriptCore/b3/air/AirAllocateRegistersByGreedy.cpp#L3751-L3779
[jsc-modern]: https://webkit.org/blog/17899/introducing-the-jetstream-3-benchmark-suite/
[sm-design]: https://firefox-source-docs.mozilla.org/js/how-we-optimize.html
[sm-baseline]: https://github.com/mozilla/gecko-dev/blob/5836a062726f715fda621338a17b51aff30d0a8c/js/src/jit/BaselineIC.cpp
[sm-call]: https://github.com/mozilla/gecko-dev/blob/5836a062726f715fda621338a17b51aff30d0a8c/js/src/jit/CacheIR.cpp#L12814-L12880
[sm-trial]: https://github.com/mozilla/gecko-dev/blob/5836a062726f715fda621338a17b51aff30d0a8c/js/src/jit/TrialInlining.cpp
[sm-warp]: https://github.com/mozilla/gecko-dev/blob/5836a062726f715fda621338a17b51aff30d0a8c/js/src/jit/WarpOracle.cpp#L802-L1010
[sm-transpiler]: https://github.com/mozilla/gecko-dev/blob/5836a062726f715fda621338a17b51aff30d0a8c/js/src/jit/WarpCacheIRTranspiler.cpp#L6268-L6310
[sm-bailout]: https://github.com/mozilla/gecko-dev/blob/5836a062726f715fda621338a17b51aff30d0a8c/js/src/jit/Bailouts.cpp
[sm-frame]: https://github.com/mozilla/gecko-dev/blob/5836a062726f715fda621338a17b51aff30d0a8c/js/src/jit/JitFrames.h#L280-L312
[sm-rectifier]: https://github.com/mozilla/gecko-dev/blob/5836a062726f715fda621338a17b51aff30d0a8c/js/src/jit/arm64/Trampoline-arm64.cpp#L409-L506
[sm-compiler]: https://github.com/mozilla/gecko-dev/blob/5836a062726f715fda621338a17b51aff30d0a8c/js/src/jit/BaselineCacheIRCompiler.cpp
[hermes-2019]: https://engineering.fb.com/2019/07/12/android/hermes/
[hermes-readme]: https://github.com/facebook/hermes/blob/310f6090bcddc297d8cc6510ad8670d2fe954aec/README.md
[hermes-types]: https://github.com/facebook/hermes/blob/310f6090bcddc297d8cc6510ad8670d2fe954aec/doc/TypedLanguage.md
[hermes-builtins]: https://github.com/facebook/hermes/blob/310f6090bcddc297d8cc6510ad8670d2fe954aec/lib/Optimizer/Scalar/LowerBuiltinCalls.cpp#L120-L196
[hermes-inference]: https://github.com/facebook/hermes/blob/310f6090bcddc297d8cc6510ad8670d2fe954aec/lib/Optimizer/Scalar/TypeInference.cpp#L745-L821
[hermes-driver]: https://github.com/facebook/hermes/blob/310f6090bcddc297d8cc6510ad8670d2fe954aec/tools/shermes/shermes.cpp#L985-L1063
[quick-doc]: https://bellard.org/quickjs/quickjs.html#Internals
[quick-call]: https://github.com/bellard/quickjs/blob/e585640ffa2cf88ce7c2d587583c6fe15928ec2f/quickjs.c
[quick-value]: https://github.com/bellard/quickjs/blob/e585640ffa2cf88ce7c2d587583c6fe15928ec2f/quickjs.h#L59-L115
[porffor-code]: https://github.com/CanadaHonk/porffor/blob/c9af40c8c6913e04d491412ae9fe0f34b97b51df/compiler/codegen.js#L1575-L1800
[porffor-readme]: https://github.com/CanadaHonk/porffor/blob/c9af40c8c6913e04d491412ae9fe0f34b97b51df/README.md
[porffor-pgo]: https://github.com/CanadaHonk/porffor/blob/c1a5ec21c3a6514c2069cb678b7116842e7056b5/compiler/pgo.js#L65-L214
[as-status]: https://www.assemblyscript.org/status.html
[as-call]: https://github.com/AssemblyScript/assemblyscript/blob/b6bda05c29c9eb7d07d7f6cb2703508483b30493/src/compiler.ts#L6086-L6215
[graaljs-call]: https://github.com/oracle/graaljs/blob/0ec2d96983ac886150e79ab611e895506faa8c3d/graal-js/src/com.oracle.truffle.js/src/com/oracle/truffle/js/nodes/function/JSFunctionCallNode.java#L342-L399
[graal-split]: https://github.com/oracle/graal/blob/67fd788e9a49ac5bb3edb5a819329dab02bdd16e/truffle/src/com.oracle.truffle.runtime/src/com/oracle/truffle/runtime/TruffleSplittingStrategy.java#L68-L163
[graal-pe]: https://github.com/oracle/graal/blob/67fd788e9a49ac5bb3edb5a819329dab02bdd16e/compiler/src/jdk.graal.compiler/src/jdk/graal/compiler/truffle/PartialEvaluator.java
[graal-pe-doc]: https://www.graalvm.org/dev/graalvm-as-a-platform/language-implementation-framework/PartialEvaluation/
[graal-host]: https://www.graalvm.org/dev/graalvm-as-a-platform/language-implementation-framework/HostOptimization/
[graal-fallback]: https://www.graalvm.org/dev/reference-manual/embed-languages/#switching-to-the-fallback-engine
[graal-pgo]: https://www.graalvm.org/reference-manual/native-image/PGO/
[hopc]: https://www-sop.inria.fr/members/Manuel.Serrano/publi/serrano-dls18.pdf
[hopc-study]: https://www.cs.tufts.edu/~nr/cs257/archive/manuel-serrano/aot-js.pdf
[static-js]: https://arxiv.org/abs/1608.07261
[bbv]: https://arxiv.org/abs/1511.02956
[pics]: https://research.google/pubs/optimizing-dynamically-typed-object-oriented-languages-with-polymorphic-inline-caches/
