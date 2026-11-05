# Bootstrap, milestones, and validation

Native self-hosting is established on macOS arm64. The latest
[frozen checkpoint](results/managed-script-pipeline-selfhost-checkpoint-v2.json) produced
byte-identical **69,977,810-byte stage1/stage2 images**, verifies signing and
nonempty DWARF, and uses a matched **4,294,966,272-byte** bootstrap/output heap budget.
Stage2 built a smoke application matching Node's bytes and exiting 42.

The checkpoint covers directory v3, runtime layouts, ScriptRecord lowering,
managed JIT entry assembly, retained surface forwarders and surface-record identity
partitioning. The evaluator service and public engine frame are subsequent work.
Separate failed pre-entry observations remain preserved. See
[managed linking](managed-runtime-linking.md).
The preceding [table checkpoint](results/managed-surface-materialization-checkpoint-v1.json)
retains the 527-file table-construction and shared-state/GC evidence.
Managed Script compilation and publication remain in progress.

The [context-ownership checkpoint](results/managed-domain-checkpoint-v1.json)
retains import rejection, publication and cached-function domain guard evidence.
Two-live-context isolation remains a separate proof obligation. The earlier
[weak-API checkpoint](results/weak-apis-checkpoint-v1.json) retains its native
weak reachability, kept-object and finalization evidence.
Tint generates its development debugger entitlements itself.

The [ownership consolidation checkpoint](results/framework-consolidation-complete-v1.json)
covers TypeScript,
IR, codegen, image, compiler, engine, runtime, platform and foundation boundaries.
Concrete Darwin policy is supplied outside codegen; image serialization delegates
instruction patches through the shared relocation contract. Original helper
namespaces and the non-debug smoke image remain unchanged. The workspace gate
passes 3,694 tests at that checkpoint. Canonical record linking also passes native recognition across
independent generated images and copying GC. See the [framework ledger](framework-consolidation.md) for
individual ownership/parity evidence.

Native-prepared checking and its storage-oriented vocabulary remain later
frontend work. General dynamic Script/Function execution needs
[managed-runtime linking](managed-runtime-linking.md); see
[native code loading](native-code-loading.md) for implemented profiles.

The retained [shared-host snapshot attempt](results/bootstrap-shared-host-v1-attempt.json)
failed before an initial inferior stop was established; no stage2 was produced.
It remains separate from successful checkpoints.

Earlier [Temporal conversion](results/bootstrap-temporal-conversions-debugger-args-v2.json),
[JSON](results/bootstrap-json-family-v1.json) and
[joint-iteration/URI](results/bootstrap-joint-iteration-uri-v1.json) checkpoints
remain available. Failed attempts retain their observations, including the
[debugger argument-forwarding failure](results/bootstrap-temporal-conversions-v1-debugger-analysis.json)
and [signature integration check failure](results/bootstrap-debug-entitlements-incomplete-v1.json).
Debug-build validation requires nonempty debug-info and line sections in addition
to `dwarfdump --verify`, which also accepts an image with no DWARF.

The earlier build-time objective is complete. The active goal is language and
native Test262 coverage; see [implementation priorities](implementation-goal.md).
Historical performance measurements below are evidence, not current targets.
The generational runtime remains the compiler default.

## Bootstrap contract

Node.js initially executes Tint's TypeScript AOT compiler implementation through an
appropriate TypeScript execution/build setup. That compiler emits native machine
instructions, links them, and writes a standalone executable containing the runtime
and compiler machinery needed to generate and execute further code itself.
Node does not host Tint's dynamic compilation/execution service. Its bootstrap
responsibility ends at producing the file; executing generated code inside Node
is not a bootstrap prerequisite. Long-term, Node may load finished AOT libraries
through FFI as described in [Product direction](product-direction.md).
The upstream TypeScript compiler may serve development and differential-testing
roles; it is not a required frontend in the resulting Tint pipeline.

Write the compiler/runtime core in the strict profile from the beginning. Keep
host interaction behind a small interface so the AOT compiler core remains usable
as a Node module and can also run in the native host. The Node adapter provides
build-time services such as file I/O; executable-memory services belong to the
native adapter and are not required of the Node adapter.

There is one strict/native language profile, not a separate bootstrap dialect.
The feature inventory tracks implementation progress within that profile and the
features Tint's own source uses. Self-hosting drives their implementation order.

Self-hosting does not retire the Node module. It remains a supported AOT build
interface for libraries and executables alongside the native compiler.

The first native path uses macOS arm64 for bootstrap convenience. Linux is the
intended long-term primary platform; Windows is a likely later addition. Preserve
the [portability boundaries](platform-roadmap.md) during this first path rather than
planning to extract them after self-hosting.

## AOT bootstrap, then native dynamic hosting

First make the pipeline capable of producing complete executable files. Then use
it to compile Tint's runtime and compiler into a native executable. Inside that
executable, the same pipeline can accept new source, generate code, link it into
executable memory, and run it. Runtime code generation is an application of the
AOT-built compiler, not a service that must first be hosted in Node.

There is no need for an in-process Node native-code bridge, addon, FFI trampoline,
or Node-controlled runtime-compilation child-process protocol. Test tooling may
launch generated executables as ordinary programs; that does not make Node their
dynamic compilation host.

The first executable deliverable is the self-hosted compiler: it must contain its
own frontend, checking/lowering machinery, backend, file linker/writer, and runtime
support and be capable of rebuilding itself. Its source uses the implemented part
of the same strict/native profile. Merely packaging a runtime without its compiler
is insufficient. In-memory publication and broader live-mode execution follow on
this native foundation; they are not prerequisites for proving self-hosting.

File input/output is the principal application-level host requirement. Keep this
surface small. Native startup, memory management, diagnostics/process completion,
and executable permissions/signing still need platform support; these are runtime
mechanisms, not a reason to implement a broad host framework or Node API surface.

Tint emits startup, linking/loading metadata, host-call stubs, and required signing
data itself. Startup and host primitives may use explicit intrinsics and small
instruction templates; these do not become a second compiler/runtime. No external
native compiler or linker is introduced by the bootstrap.

Here an AOT-built or "static" binary means an executable generated before launch.
It does not require static linking of all OS services, and it does not prevent the
running executable from generating additional code. The OS dependency policy is
separate from Node independence and self-contained compilation.

The [macOS arm64 target contract](macos-arm64-target.md) specifies the proposed
libSystem host boundary, private calling convention, Mach-O layout and startup,
chained fixups, and TypeScript-owned ad-hoc signing for this path.

The [compiler feature inventory](bootstrap-feature-inventory.md) defines the initial
source and builtin budget; the [trusted intrinsic contract](trusted-intrinsics.md)
defines how runtime machinery bottoms out without a second implementation language.

The [build-input contract](build-inputs.md) specifies reproducible source snapshots
and module identity; the [conformance baseline](conformance-baseline.md) separates
reference checking from Tint coverage and strict rejections.

## Milestones

The [self-hosting runtime map](self-hosting-runtime-map.md) supplies the first
specification-to-mechanism mapping and proposed validation ledger for these stages.

1. Specify strict-profile counterexamples and runtime representations. Define IR
   invariants, the baseline call ABI, host primitives, and link-unit structure.
2. Use focused compiler fixtures to AOT-compile simple programs into runnable files.
   Validate instruction encoding, calls, branches, relocations, stack layout,
   startup, host imports, load-address handling, and required signing, without
   external native compilation or linking tools.
   These are validation fixtures, not separate product deliverables.
3. Expand strict compilation and runtime support enough to AOT-build the compiler
   and runtime themselves into a standalone executable. Include required objects,
   unions, closures, exceptions, GC roots, and module behavior. Do not substitute
   a Node-hosted frontend or optimizer for missing native components.
4. Use native Tint's file-output path to rebuild its complete compiler/runtime
   source, including the frontend, without Node or external native build tools.
   Compare successive generations. This is the first executable deliverable and
   takes priority over live execution and continuous optimization.
5. Within that native executable, compile runtime-provided source using the shared
   pipeline and publish/execute its machine code. Validate executable-memory
   management, cache synchronization, runtime integration, and mixed-profile calls.
6. Support replacing future calls with a newly compiled native code version while
   old active frames remain valid. Validate code and metadata lifetime rules.
   This is infrastructure for continuous optimization, not an optimizer benchmark.
7. Expand TypeScript/ECMAScript coverage and add shared optimization passes, first
   using proofs and guarded fast paths, then richer profile-guided speculation.

These milestones describe the current direct-native working proposal. Bytecode
as IR or a VM tier remains an open design option and could change the sequence.
If adopted, its translation into machine code must use the same TypeScript-owned
pipeline as AOT compilation; compiling only the VM implementation is insufficient.

## Evidence required

- Differential execution against Node and, where appropriate, QuickJS-NG.
- TypeScript syntax/checker conformance fixtures with intentional strict-profile
  differences recorded separately from bugs or unsupported capabilities.
- ECMAScript conformance tests for actual runtime semantics; syntax acceptance
  alone is not TypeScript capability coverage.
- Identical behavior for memory and file outputs under the same profile.
- A Node-produced executable compiles and executes previously unseen source with
  Node absent from its execution environment and no compiler-service connection.
- Native self-builds also succeed without Node or external native build tools.
- Baseline versus optimized code agreement, including thrown exceptions, mutation,
  getters, identity, async behavior, and GC interactions.
- Native profile rejection tests covering writable aliases, invalid downcasts,
  forged predicates, stale narrowing, missing indices, and unsafe imports.
- ESM tests for live bindings, cycles, initialization errors, namespaces,
  re-exports, top-level await, and dynamic import.
- Relocation tests at different addresses and branch distances; instruction/ABI
  checks against authoritative target specifications and independent disassembly.
- Active-frame and closure tests across code-version replacement and reclamation.
- Reproducible self-builds with unstable metadata normalized explicitly. Compare
  generated artifacts and behavior; a successful self-build alone is not proof.

Start with correctness and observability of generated code. Performance claims
must distinguish compile latency, runtime throughput, allocation, code size, and
profile collection/recompilation overhead. Do not require advanced optimization
to establish the first complete native pipeline.

## Reproducing the native self-build

From the workspace root on macOS ARM64, using the pinned Node/pnpm toolchain:

```sh
pnpm install --offline --ignore-scripts
pnpm check
node tools/bootstrap-compiler.ts .tint-bootstrap/stage1-current --snapshot .tint-bootstrap/source-current --debug-symbols
lldb --batch -o "run \"$PWD/.tint-bootstrap/source-current\" \"$PWD/.tint-bootstrap/stage2-current\" --debug-symbols" .tint-bootstrap/stage1-current
cmp .tint-bootstrap/stage1-current .tint-bootstrap/stage2-current
node tools/prepare-compiler-smoke.ts --debug-symbols
lldb --batch -o "run \"$PWD/.tint-bootstrap/smoke-project\" \"$PWD/.tint-bootstrap/smoke-stage2-current\" --debug-symbols" .tint-bootstrap/stage2-current
cmp .tint-bootstrap/smoke-node .tint-bootstrap/smoke-stage2-current
lldb --batch -o run .tint-bootstrap/smoke-stage2-current
```

Use a new snapshot/output suffix for each attempt; the snapshot command deliberately
rejects an existing directory. Omit `--offline` on a fresh machine whose package cache
has not been populated. Inspect LLDB's child status, not merely its own exit status:
both compiler invocations must exit zero and report writing their output. The final
smoke executable must exit 42. Both `cmp` commands must succeed. Keep debug settings
and the frozen input snapshot identical for the self-build comparison. Use absolute
source-directory paths as shown: debug information embeds those paths, so changing
their spelling can change the binary even when source contents match.

For performance measurements, capture the entire self-build. Start LLDB interactively
and use `process launch --stop-at-entry -- ABSOLUTE_SOURCE ABSOLUTE_OUTPUT --debug-symbols`.
Before continuing, attach `pprofessor attach --no-publish --output PROFILE CHILD_PID`
in another terminal, then `continue` in LLDB. Leave capture running through child
exit. This suppresses macOS crash-report windows while preserving a failure stop
for inspection. Record profile duration separately from debugger pauses and
symbolication. A failed child, truncated profile or missing output is not a successful
build timing. See [benchmarking](benchmarking.md) for current measured results.

## Best measured verified self-build

The `source-source-lookup-v1` snapshot contains 146 source files. Node produced
stage1 in 14.6 seconds. Native stage1 rebuilt it into a 30,248,650-byte stage2
identical byte-for-byte to stage1. Stage2 reproduced Node's frozen 1,517,082-byte
smoke executable, which returned status 42. Both compiler processes exited zero
under LLDB.

The complete profile is `.tint-bootstrap/profiles/source-lookup-v1-full-run.pb.gz`:
112.79 seconds of capture and 8,105 samples. Capture includes debugger startup
pause and profiling overhead. The earlier `post-inline-v1` unprofiled complete self-build took
114.70 seconds under LLDB and produced the same binary. An earlier
`temporary-registers-v1` unprofiled build took 213.04 seconds. These are different
compiler versions, not an isolated optimization speed ratio.
This historical snapshot preceded completion of the two-minute build objective. Artifact hashes and validation facts are
retained in `.tint-bootstrap/source-lookup-v1-verification.json`.

Recent completed captures include `relation-storage-v1` at 197.90 seconds,
`wide-integers-v1` at 247.31 seconds, and `word-arguments-v1` at 219.88 seconds.
The dense relation tables reduced the solver's sampled share; pooled temporary
roots reduced executable size without a substantial further timing improvement.
All completed candidates retain byte-equality and stage2 smoke checks. Unrelated
host CPU activity makes small differences inconclusive. Dominant costs still
include SHA-256, GC scanning, bit-vector operations, type relations and numeric
array access. Non-null origin analysis and local copy propagation are the next
candidates under validation.
