# Native code loading

Runtime source compilation reuses Tint's parser, checker, IR and AArch64 emitter.
Node remains an AOT build host; generated-code execution happens inside native
Tint. This is an incremental implementation of JavaScript execution, not a
restriction on the eventual live language profile.

The [production Script evaluator](results/script-evaluator-service-checkpoint-v1.json)
compiles and invokes Scripts natively using image-owned helper contracts, preserving
persistent globals, fresh Script records and GC roots. The Test262
`native-script-v6-eval-script` host integration is implemented; its seven-case [native fixture](results/native-test262-script-service-validation-v1.json) passes,
and unchanged selection reruns are running. This does not enable direct or indirect
string `eval`, whose environment rules require separate work.

## Current executable slice

The native host constructs all four dynamic function kinds. Normal functions,
nonsuspending async functions, ordinary generators and nonsuspending async
generator bodies share the closed-function compiler. It preserves receiver
binding, base construction, constructor-selected prototypes, canonical source and
metadata. [Receiver/argument regressions](results/native-dynamic-constants-v1.json),
[cross-realm checks](results/native-dynamic-realms-v1.json) and
[async/generator adapters](results/native-dynamic-kinds-connected-launch-v2.json)
have native evidence separate from conformance percentages.

The executable profile supports simple formals, one borrowed receiver or argument,
scalar/identity returns and environment-free expressions and control flow. Unused
formals are omitted internally while arity and duplicate-name resolution remain
observable. `undefined`, `NaN` and `Infinity` are folded only after resolving formals.
Constant numeric `arguments[index]` reads can borrow that actual argument when
it was supplied. The publisher checks `minimumArguments` before execution;
missing indices remain unsupported because lookup can reach inherited properties.
Arguments-object escape/mutation, nonnumeric or variable keys and a formal named `arguments`
are outside this optimization. [Four native cases](results/native-indexed-arguments-v1.json)
cover strict functions, duplicate formals, primitive/object identity and all four
function kinds; the fifth case preserves the missing-index restriction.
An additional managed profile supports ordinary functions returning an unbound
global identifier followed by static property accesses, with simple unused formals
and optional directives/grouping. Dot properties and string-literal computed keys
are supported; optional access and dynamic keys remain unsupported.
Each realm owns one persistent global environment. A captured reader resolves the
name afresh on each call, preserving mutation, lexical TDZ, missing-name errors,
getter throws and constructor-realm selection. Each property Get compiles to an
explicit native indirect call; a realm-owned callback applies the existing object
semantics without interpreting an AST or walking an access path at runtime.
[Eight native access regressions](results/native-managed-global-access-validation-v1.json)
cover getter ordering, primitive receivers, cross-realm errors and moving GC.
[Nine earlier native fixtures](results/native-managed-globals-validation-v1.json)
and four unchanged Test262 variants pass. Broader global-dependent bodies,
declarations, nested functions, `new.target`, parameter initializers/patterns/rest
and multiple input dependencies are outside these narrow optimization profiles.
The general fallback described below handles broader source bodies. String literals
can use explicitly registered permanent code/data mappings; other code-owned
managed references remain unsupported. Borrowed BigInt, Symbol and callable wrappers also require
realm-aware coercion; raw native truthiness/typeof is explicitly rejected.

Async-generator pre-start return/throw uses the existing queued protocol,
including Await of injected return values; [four lifecycle cases](results/native-dynamic-async-generator-green-v1.json)
pass. Compiled body results distinguish direct completion (fallthrough/bare
return) from return-expression Await. Mixed direct/Await paths require a native
completion discriminator and remain outside that closed profile.
The [latest six-case fixture](results/native-async-generator-completion-green-v2.json)
records two body-execution passes and four pre-entry debugger failures. Its
[Node reference](results/node-async-generator-completion-reference-v2.json) agrees
with the corrected job-order expectations. The earlier
[incorrect bare-return expectation](results/native-async-generator-completion-test-correction-v1.json)
is retained separately.

String `eval` and `$262.evalScript` are not implemented. Non-string `eval` preserves
identity and intrinsic metadata.

## Frontend and compiler contracts

`parseDynamicFunction` parses parameter and body fragments independently, then
checks the combined grammar, preserving raw UTF-16 through `SourceTextView`.
Binding validation follows. `anonymous` is metadata, not a lexical self binding.
All four constructor kinds perform argument conversions left to right before
compilation, following [CreateDynamicFunction](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-createdynamicfunction).
Invalid source raises intrinsic SyntaxError before prototype lookup. Valid functions
retain their parsed source and arity independently of body compilation. Native code
is compiled and cached on first execution; constructing or inspecting a function
does not require its body to fit the executable slice. Generator calls initialize
parameters and bind the receiver before returning a suspended iterator.
Unsupported default/rest/pattern parameters fail on invocation rather than being
skipped. A never-started generator can complete through return/throw without
compiling its body. The [five lazy-compilation regressions](results/native-dynamic-lazy-green-v1.json)
pass natively; the [earlier eager failures](results/native-dynamic-lazy-red-v1.json) remain recorded. The
[76-case validation regression](results/native-dynamic-functions-v1.json) covers
fragment boundaries, early errors, conversion ordering and abrupt completion.

The realm-owned `DynamicFunctionCompiler` callback separates runtime objects from
parsing and compilation. `compileClosedDynamicFunction` adapts the supported
JavaScript body to an explicit borrowed-input ABI and supplies implicit return
completion. Its result identifies the bound receiver or actual argument needed
by the entry, independently of the public function length. It rejects environment-dependent syntax before typed lowering can
assign it different semantics.

`compileClosedFunction` runs closure checking, lowering, reachability, scalar
optimization, effect analysis and emission. Its result describes native bytes,
entry, parameter/result encodings and effects. It rejects module initialization,
captured entry environments, receiver-slot ABI, allocation, throwing, managed
writes, opaque calls, unresolved imports and record layouts. Code-backed strings
require the explicit `literals: "permanent"` option; the default rejects them.
The result reports `requiresPermanentLiterals` so a publisher can enforce that
lifetime contract.
The [native frontend probe](results/native-closed-dynamic-v1.json) compiles and
executes dynamic function bodies through this entry. The earlier
[borrowed-value probe](results/native-closed-functions-v2.json) preserves tagged
primitive and managed object identities.

`compileManagedGlobalAccessDynamicFunction` classifies the original AST with Script
binding analysis, then lowers explicit typed reader calls through the same
checking, lowering, optimization and emission stages. Its explicit managed
contract `tint.global-access.v1` uses a `(unknown, number) => unknown` callback,
with one call per global/property Get. The managed linker validates the complete
48-byte signature window using the shared ABI constants. The closed compiler's
borrowed contract is unchanged. Imported witness IDs come from the final IR.

## Publication and lifetime

`native-memory` exposes explicitly granted mapping, publication and call
capabilities. macOS images require `BuildRequest.allowJit`; ordinary AOT builds do
not receive JIT entitlements. Tint emits and signs both XML and DER entitlements.

Each target's host ABI names its publication strategy (`executableMemory`).
On macOS one caller-owned `MAP_JIT` arena holds generated code. A trusted AOT
leaf checks bounds, enters thread-local write mode, copies aligned instructions,
invalidates the instruction cache and restores execution mode. The owner
excludes concurrent writes/execution of the replaced region; publication is not
atomic code patching. `unmapExecutableMemory(address, byteLength)` (capability
`executable-unmap`) releases a whole unregistered arena; `unmapMemory` must not
be used for executable arenas.

### Linux

Linux arenas are W^X dual mappings (`linux-dual-mapping`). `mapExecutableMemory`
reserves one address range and replaces it with a read-only header page, the
read/execute view (the returned address) and a read/write view, each the request
rounded up to 16 KiB, the largest supported kernel page. Both views map one
`memfd_create("tint-jit", MFD_CLOEXEC)` file, whose descriptor is closed once
mapped. No page is ever writable and executable, so the arena works where
`PROT_WRITE|PROT_EXEC` mappings are refused (PaX MPROTECT, SELinux
`deny_execmem`, which checks anonymous executable memory; an executable file
mapping instead needs the policy's `execute` permission on the tmpfs file).
Any failure undoes the partial mapping and reports `-errno`; there is
deliberately no RWX fallback. The header names the views, so a write or
release whose window is not a whole arena (starting at its executable address,
no longer than the view) is rejected with -1 or `-EINVAL` instead of writing
through an unrelated alias. `unmapExecutableMemory` releases the header and
both views together.

The writable view is a shared mapping; the executable view is private. Until a
page is copied on write a private file mapping shows the file's page, so writes
through the writable view are visible at the executable address. The private
view lets debuggers plant software breakpoints (ptrace cannot write a read-only
shared mapping). Such a page is the debugger's copy and stops seeing the file,
so after copying, the write leaf compares the executable view with the source
bytes; on a mismatch it makes the affected 16 KiB granules read/write (not
executable), copies again and restores read/execute, preserving the debugger's
breakpoints elsewhere in the page.

The leaf then makes the range visible to instruction fetch inline, as libgcc's
`__aarch64_sync_cache_range` does (glibc exports no such routine): it reads
line sizes from `CTR_EL0`, cleans each data line to the point of unification
(`DC CVAU`) unless `CTR_EL0.IDC`, `DSB ISH`, invalidates each instruction line
(`IC IVAU`) and `DSB ISH` unless `CTR_EL0.DIC`, then `ISB`. Data caches behave as
physically indexed, so both loops use the executable addresses. The `ISB`
synchronizes only the publishing thread, consistent with the rule that the
owner excludes concurrent execution of the written range.

Calls use Tint's completion ABI and runtime context with an empty environment.
Adapters support zero-argument numeric entries and `(unknown) => unknown` entries
without allocation or exceptions. Both tagged words survive the boundary;
borrowed references retain caller-owned lifetimes, and generated literal references
retain their registered mapping lifetime. This is not a foreign ABI.

The Test262 host lazily maps a bounded arena, aligns each publication and
registers the entire arena before publication and retains it until process exit.
It never recycles a live entry.
Arena exhaustion reports unsupported. The copying collector is used because the
generational write-proof gate still rejects raw code capabilities; that gate has
not been weakened.

A collector-owned, set-once registrar grants readable external leaf ranges through
`registerExternalMemory`. Its bounded interval table lives in permanent control
storage. Registration rejects invalid ranges and overlaps with managed heap,
control storage, image and stack windows; exact duplicate grants are idempotent.
These grants permit reads and tracing of permanent strings, not managed writes or
embedded managed references. Copying, mark/sweep and generational collectors share
this policy; raw code publication still uses the copying profile.

The trusted mapping owner must guarantee readable, permanent storage without
managed edges. Registration does not inspect OS mappings. The hosted context is
80 bytes, with the registrar function reference at offset 64; native callers and
allocator bridges use the shared ABI constants.

The [native GC regression](results/native-permanent-literals-v1.json) compiles and
publishes a string containing NUL and an unpaired UTF-16 surrogate, retains it in
an object through 32 MiB of temporary allocation in a 16 MiB copying heap, and
checks its contents afterward. This is lifetime evidence, separate from Test262.
The [registration regression](results/native-external-registration-v1.json) also
checks overlap rejection, set-once policy and state retention under allocation
pressure. Full runtime-import and generated-root integration remain pending.

## Managed-module boundary

The emitter already serializes record/root descriptors into its code image and
patches their relative addresses. Permanent arena registration makes those bytes
readable by the collector; it does not prove that managed JIT frames, allocations
or returned records are integrated correctly. Those need native GC regressions
before relaxing the closed profile.

Cross-module calls also need semantic identity. Record guards compare descriptor
addresses. Function records now carry permanent image-private signature descriptor
addresses at offset 32, and indirect calls compare those identities. Descriptors
record versioned, ordered scalar parameter/result encodings; equivalent referenced
signatures share one descriptor within an image. Environment offset 24 remains
the only traced function field. This [compiler slice](results/native-local-signature-pointer-validation-v1.json)
passes seven native regressions, including captured-closure calls across moving
generational GC. Its [native self-build](results/bootstrap-signature-pointer-v1.json) produces byte-identical stage images. A separately compiled module cannot assume its identities
match the AOT host. Import bindings must carry compatible descriptor and signature
identities as well as code/environment pointers. Matching GC field offsets alone
does not establish a compatible TypeScript shape. Managed environments need traced
handles; embedding a movable heap pointer in permanent machine code is invalid.

Trusted native bindings can inspect a function's permanent brand and signature
identity through `nativeFunctionDescriptor` and `nativeFunctionSignature`. They
validate the local function brand and reject unrepresentable addresses; they do
not expose entry or environment pointers. A [native regression](results/native-managed-function-identities-v1.json)
checks captured functions and stable metadata through repeated moving collections.
These bindings are unavailable to ordinary JavaScript and do not authorize
cross-image calls or managed source compilation.

The emitter can now request symbolic canonical function-brand and per-witness
signature imports through `EmissionOptions.managedABI`. It emits zeroed aligned
pointer slots and explicit unresolved linkage; the ordinary AOT composer rejects
those modules. `resolveManagedPointers` validates trusted named capabilities and
wire descriptors before patching a fresh unpublished image. Neither step grants
managed invocation. The [native relocation fixture](results/native-managed-import-resolution-v2.json)
passes; its earlier initialization-budget failure remains recorded.

The separate trusted `callExecutableManaged` capability enters a resolved
`(reference) -> general` function in the same heap/context. It roots the callback,
propagates normal/throw completions and preserves conservative allocation effects.
Its [native proof](results/native-managed-invocation-validation-v1.json) covers moving GC,
fresh object returns, thrown values, nested calls and root-chain restoration.
Copying GC is supported; generational mutator proofs remain pending. This capability
has a separately typed indexed-callback facade, `callExecutableManagedWithIndex`,
used by managed global/property compilation. Both use the same IR host operation;
zero-argument callers retain their existing contract. Neither exposes a raw-pointer
API to JavaScript.

## Remaining integration

- Link runtime imports, record layouts, root descriptors and module initialization
  before permitting generated code to allocate or throw.
- Track code/metadata ownership across functions, closures and suspended frames;
  register generated source mappings for debugger/profiler visibility.
- Add general argument adapters and JavaScript scope/environment compilation.
- Compile eval, generators and async bodies while preserving their distinct
  source goals, environment rules and completion protocols.

`tools/verify-native-code.ts` builds probes without executing them in Node. Earlier
pointer-limit, completion-ABI and frontend build failures remain recorded
separately; infrastructure probes do not count as Test262 conformance passes.

## Engine ownership and embedding authority

`@tint/js-engine/native/code-storage` owns the bounded process-lifetime executable
arena. Embedders provide mapping, external-memory registration and code-write
callbacks explicitly. Publication reserves aligned offsets, registers memory before
exposing code, and preserves consumed identities after failed writes. There is no
recycling while returned functions can retain addresses. The [publication checkpoint](results/engine-code-publication-workspace-v1.json)
records native state-machine and dynamic-access/GC validation.

Frozen workspace snapshots capture public entrypoint availability separately from
import grants. Schema 2 fingerprints both; schema 1 retains its original identity.
Availability does not authorize imports or host calls. Native image builders resolve
the captured engine exports rather than inspecting current private source paths.

`@tint/js-engine/dynamic-function` now owns the typed realm-local compiler factory.
The composition root supplies realm/global/object/hooks, shared code storage,
borrowed and managed invocation, and authorized descriptor/signature reads. The
factory does not install globals or create realms. Eager validation, lazy native
compilation, source retention and asynchronous wrappers remain engine-owned.
The [original workspace checkpoint](results/typed-engine-workspace-v1.json) retains earlier pre-entry failures. The restructured pipeline now passes [eight native managed-access/GC regressions](results/framework-managed-access-native-validation-v1.json) and a [native self-build fixed point](results/bootstrap-framework-boundaries-v1.json).

The bounded receiver-write profile has its own `tint.receiver-write.v1` contract.
It emits explicit callback operations for receiver acquisition and ordinary Set;
a fresh callback retains each invocation's receiver across recursive setters.
Its admission is one static `this` property assignment of literal `true`, followed
by an optional `return this`. Other bodies remain explicitly unsupported by this
profile. The [eight native receiver-write regressions](results/framework-receiver-write-native-validation-v1.json) pass, including boxing, strict writes, construction, setter reentry/throws, proxies and GC. Unchanged Test262 selections remain separate.

[Managed-runtime linking](managed-runtime-linking.md) now provides typed helper
imports and canonical record/frame authority for native Script, indirect-eval
and ordinary Function compilation. Direct eval and Module lifecycle still
require their own semantic boundaries.

## General dynamic bodies

Bodies outside the closed, global-access and receiver-write profiles use the
same Script lowering, managed surface contracts, imported AOT runtime helpers and
code publisher as runtime-compiled Scripts. All four function kinds now have a
general fallback. Compilation is lazy and cached per constructed function; for
generators it occurs during the call, before the visible generator is returned.
An uncalled body does not compile.

Runtime-compiled entries share one per-entry code budget (`maxScriptCodeBytes`),
which rejects oversized entries as unsupported. Direct and indirect eval, dynamic
function bodies and runtime-evaluated Scripts (`ScriptLoweringOptions.runtimeCompiled`)
therefore use a compact entry shape. AOT Script and module lowering is unchanged.

- **Fused results.** Each generic operation calls a fused `<operation>OrThrow`
  helper (js-runtime `objects/fused-results.ts`). The helper completes the result
  exactly like `throwIfRuntimeError` and returns the value. Identifiers are read
  through `getIdentifierValue` (ResolveBinding followed immediately by GetValue).
- **Inline body.** The body runs inline in `execute`, between `enterScriptContext`
  and `leaveScriptContext`; this is equivalent to `runScriptContext`. The
  global-environment and realm fields it reads are loaded once into
  execute-level constants.
- **Few named temporaries.** Single-use temporaries are forwarded into their
  consumers (`lowering/forward-temporaries.ts`). Scalar literals and copies are
  never named. String literals stay named, because shared entries abstract them
  into literal tables.
- **One-call function creation.** Functions are created by
  `createRetainedSourceFunction`. Sloppy functions that cannot observe their
  receiver skip its conversion. Functions that bind nothing skip their
  environments.

The code generator shares frame offsets between slots whose live ranges never
meet, so large entries keep small frames. It also clears only the
temporary-pool words a collection could observe. The 1000-entry computed
literal in staging/sm/class/compPropNames.js fell from 10.1 MB to 0.84 MB, and
the 1000-method literal in methDefn.js from 17.2 MB to 1.97 MB. Both now fit
the 2 MiB budget, and both tests pass natively
([evidence](results/eval-site-size-v1.json)). The
[unsupported classification](results/annexb-closure-unsupported-classification-v1.json)
records the 56 Annex B direct-eval variants that exceeded the budget before the
compact shape.

Ordinary functions dispatch through a hidden source-function carrier. Async
functions return the carrier's promise directly to avoid extra adoption jobs.
Generator and async-generator calls transfer only an unstarted continuation;
the visible outer object owns its prototype and request protocol. Async-generator
transfer rejects any carrier with queued requests or pending resumption state.
No callback-class or record-layout checks are relaxed.

The [GeneratorFunction](results/generator-function-node-checkpoint-v1.json) and
[AsyncGeneratorFunction](results/async-generator-function-node-checkpoint-v1.json)
Node gates pass. Native regression fixtures and unchanged constructor groups run
separately; these checkpoints do not establish native conformance gains.
