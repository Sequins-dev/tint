# Shared managed-runtime linking

Runtime compilation reuses Script/function lowering and the TypeScript-to-native
pipeline. The closed, global-access and receiver-write profiles remain fast paths;
they do not define the eventual limits of `eval` or `Function`.

Script evaluation, indirect eval and ordinary `Function` bodies now execute through
image-owned helper directories and the shared managed-entry compiler. Native evidence:

| Path                         | Validation                                                                                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$262.evalScript`            | [Seven host cases](results/native-test262-script-service-validation-v1.json), including child realms, persistent globals, error realms and job checkpoints                                                                                     |
| Indirect eval                | [Evaluator fixture](results/native-indirect-evaluator-v1.json) and [20 host cases](results/native-test262-indirect-eval-validation-v1.json), including inherited effective Script identity                                                     |
| Ordinary `Function` fallback | [Carrier fixture](results/native-dynamic-function-carrier-v6.json) and [16 host cases](results/native-test262-function-fallback-validation-v1.json), including lazy compilation, arguments, constructors, realm behavior and retained closures |

These are bespoke native regressions, separate from the unchanged Test262 selection
counts in the [coverage dashboard](test262.md). Direct string eval still requires
caller-environment integration; tagged-template dynamic bodies remain unsupported.

## Required contracts

- **Semantic authority:** derive helper and callback contracts from checked types.
  Exact recursive equality preserves field order, mutability, optionality, unions,
  receivers and arity. Assignability and equal machine encodings do not establish
  membership. Variance-compatible callback flows need explicit adaptation.
- **Physical ABI:** verify function signatures, the function-object brand and full
  record storage/tracing layouts separately. AOT descriptors retain physical
  interning, so different semantic directory labels may share an address. Splitting
  existing AOT signature pointers would invalidate indirect-call guards.
- **Ownership:** every published entry and imported identity belongs to a permanent
  context/heap domain. The token occupies context word 72, is distinct from logical
  agent identity, and is not reused after teardown. Check ownership before foreign
  metadata reads, publication and cached invocation.
- **Invocation state:** pass the helper table, realm, scope, arguments, receiver and
  newTarget through traced frames. Code may embed permanent metadata addresses;
  movable objects and closures arrive through the frame.
- **Publication:** validate the complete import set in private bytes before patching
  or publishing code. Preserve root-chain handoff, exception completion, callbacks
  and code/metadata lifetime. Failed linking produces no callable entry.
- **Diagnostics:** distinguish language early errors, unsupported compilation,
  missing authority, resource exhaustion, debugger launch failures and runtime throws.

Record metadata includes ordered field types, offsets, mutability, presence and
initialization tags. Its readable descriptor window is distinct from the object's
allocation size. Matching tracing bytes alone never authorizes a record view.
The explicitly granted `identity` record binding lowers to pure
`record-descriptor-address`: it retains permanent metadata without reading or
requiring an allocated instance. Ordinary source declarations grant no capability.

## Current building block

| Capability                            | Contract and evidence                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import preflight and physical records | [Preflight](results/native-managed-preflight-v1.json) rejects later mismatches before earlier pointer reads. [Record imports](results/managed-record-import-checkpoint-v1.json) cover allocation and recognition across images and GC.                                                                                                                                                                          |
| Context ownership                     | [Checkpoint](results/managed-domain-checkpoint-v1.json), [publication](results/native-code-storage-domain-v1.json) and [cached invocation](results/native-dynamic-domain-v1.json) reject foreign tokens. Two independently live contexts/heaps remain an outstanding proof.                                                                                                                                     |
| Script vocabulary                     | [Checkpoint](results/runtime-surface-checkpoint-v1.json): 118 exports, including 100 helpers and 18 types; all 27 generic helpers use the shared concrete-argument registry. Captured lowering output is unchanged.                                                                                                                                                                                             |
| Application helper table              | [Checkpoint](results/managed-selections-checkpoint-v1.json): exported namespaces resolve through the application's own specialization pass. Tables capture existing closures; module initialization and helper state are shared across calls and GC. Compiler-request retention is covered by the automatic AOT export evidence below.                                                                          |
| Declaration interchange               | [Native evidence](results/managed-declaration-interchange-v1.json). Versioned declaration-only text preserves recursive types and UTF-16 data, rechecks roots and helper/table correspondence, and carries no pointer authority. This is not a general TS printer or transpiler.                                                                                                                                |
| Canonical metadata                    | [Native compiler check](results/native-record-identity-compiler-v2.json) covers stable alias names independent of temporary prefixes. First-discovery order starts at the table, helpers, then type exports. Metadata uses symbolic `$helperN` locals; executable factories retain actual application bindings.                                                                                                 |
| Semantic classes and signatures       | [Contract checkpoint](results/managed-contracts-checkpoint-v1.json) covers exact recursive comparisons and explicit membership. Function/type IDs map through lowering and both pruning passes. Full-surface class partitioning also passes [native validation](results/native-surface-contract-classes-compiler-v1.json); its [frozen self-build](results/surface-contract-classes-checkpoint-v1.json) passes. |
| Instance-free record identity         | [Compiler](results/native-record-identity-compiler-v2.json) and [GC execution](results/native-record-identity-runtime-v3.json) pass. Its [frozen self-build](results/record-identity-checkpoint-v2.json) is byte-identical. Generated per-alias identity stubs also pass [native GC validation](results/native-surface-contract-classes-runtime-v1.json).                                                       |
| Callback metadata witnesses           | [Native evidence](results/managed-signature-witnesses-v1.json). Inert typed functions expose physical signatures for abstract callbacks and always throw if called; they do not grant semantic membership.                                                                                                                                                                                                      |
| Managed entry adaptation              | [Compiler](results/native-managed-entry-adapter-compiler-v2.json) and [execution](results/native-managed-entry-adapter-runtime-v2.json) cover named imports, shared state, exceptions and captured imports across GC. The initial profile is synchronous and excludes module initialization and general Script publication.                                                                                     |

The latest [frozen self-build checkpoint](results/managed-script-pipeline-selfhost-checkpoint-v2.json)
produces byte-identical 69,977,810-byte stages, passes signing and DWARF checks,
and compiles and executes the matching smoke image. It covers directory v3,
ScriptRecord lowering, managed JIT entry assembly, retained forwarders and exact
surface-record partitioning. The evaluator service and public frame are newer.

[Member-only callbacks](results/native-member-signature-v2.json) now pass native
invocation and GC checks without a call witness. Exact registry type-argument
[normalization](results/native-managed-applications-v1.json) also passes natively.
Directory v3 [publication and reading](results/native-runtime-directory-v3-v1.json)
pass with shared AOT state and GC. The complete Script-surface directory
[passes natively](results/native-script-runtime-directory-v3-direct-v2.json), with
a separate [pre-entry launch failure](results/native-script-runtime-directory-v3-v1.json)
preserved. The subsequent frozen self-build [stopped during emission](results/bootstrap-runtime-directory-v3-direct-v2-analysis.json); [allocation diagnostics](results/bootstrap-directory-allocation-diagnostic-v2-analysis.json) confirm old-space exhaustion; the matched-budget [self-build now passes](results/runtime-link-budget-selfhost-checkpoint-v1.json).

Automatic compiler-request publication and AOT agreement pass [compiler](results/native-managed-aot-directory-compiler-v1.json)
and [directory/state/GC](results/native-managed-aot-directory-runtime-v1.json) fixtures.
The reader passes [compiler](results/native-managed-directory-reader-compiler-v1.json)
and [physical identity/GC](results/native-managed-directory-reader-runtime-v1.json) checks.
Newer [binding-context](results/native-runtime-binding-context-direct-v2.json),
[opaque import](results/native-imported-function-lowering-v2.json),
[address-IR](results/native-function-address-ir-compiler-v1.json) and
[explicit address-binding](results/native-function-address-bindings-compiler-v1.json)
compiler regressions also pass natively. These are compiler evidence, separate
from Test262 conformance. Those earlier version-2 records remain historical
evidence; the current directory uses version 3 for runtime entry bindings.

The backend's opt-in semantic signature groups can assign distinct descriptors to
JIT members and witnesses. Default AOT emission keeps physical interning.
Membership must be explicit and physically compatible; imported collisions and
conflicting authority are rejected. Directory integration must reject non-member
JIT closures before they flow into AOT callbacks, even when their ABI matches.

Retained record helpers use private forwarding closures initialized once in the
application instance. [Native validation](results/native-retained-surface-v1.json)
covers stable callable identity across repeated binds, checked views and GC.
The original helper remains the compiler-authorized record operation.

The first [in-image Script execution](results/native-managed-script-v4.json) passes
compilation, linking, publication, normal and throwing completions, table guards,
realm/ScriptRecord identity and AOT-to-JIT callbacks after GC. The
[record-identity correction](results/native-managed-script-v3-analysis.json) keeps
surface types distinct during lowering while preserving private storage sharing.
The production host uses the uniform resources documented in the
[Test262 runner](test262-runner.md); its evaluator service and host checks are
linked above.
These are bespoke compiler/runtime results, not additional Test262 passes.

## Incremental implementation

The [RT-EVAL plan](test262-backlog/rt-eval.md) and its
[surface-directory slice](test262-backlog/rt-eval-surface-directory.md) own the
implementation sequence. Current boundaries are:

| Milestone                                         | Status                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0: independent native function using AOT helpers | Automatic contracts, directory v3 and imported runtime entries are integrated. The real two-live-context isolation proof remains pending.                 |
| G1: synchronous Script and indirect eval          | Native evaluator and host regressions pass; unchanged selection reruns remain separate coverage evidence.                                                 |
| G2: ordinary Function fallback                    | Lazy compilation and the native carrier/host regressions pass. Tagged templates and direct string eval remain unsupported; full-family reruns are queued. |

The lower-level [function-entry call](results/native-function-entry-call-v1.json)
and [cross-module exception](results/native-function-entry-throw-v2.json)
regressions remain part of the ABI evidence. Earlier launch failures and their
[provenance correction](results/native-function-entry-throw-v2-provenance.json)
are retained separately.

Direct eval additionally needs call-site lexical/variable environments and intrinsic
identity; a global wrapper cannot substitute for it. Module execution has its own
loader, live bindings and instantiate/evaluate lifecycle; its ahead-of-time core
can progress independently of runtime compilation. Async/generator dynamic bodies
remain explicit later slices.

Preserve frozen self-builds and native semantic fixtures at each integration
boundary, then rerun unchanged Test262 selections in new immutable reports.
Earlier explicit fixture exits remain recorded with their
[composition](results/native-record-identity-compiler-v1-analysis.json) and
[mutability](results/native-record-identity-runtime-v2-analysis.json) diagnoses.

### Compiler heap budget

The [latest diagnostic](results/bootstrap-directory-allocation-diagnostic-v2-analysis.json)
confirms a successful major collection with **1,761,087,024 live bytes**, exceeding
old-space capacity by **16,256,560 bytes** during emission. The compiler request
now uses **4,294,966,272 bytes** (4 GiB minus 1 KiB), within the aligned uint32
extent supported by the current allocator. Node bootstrap and native CLI share
this setting. The [matched-budget checkpoint](results/runtime-link-budget-selfhost-checkpoint-v1.json)
passes its fixed point and smoke execution. Increasing only an output default cannot enlarge an
already running bootstrap image.

## Cached AOT service units

[Native service units](native-service-units.md) define separately compiled managed
factory units, complete cache identity and stale-entry rejection, and composition
with Tint's own image builder. The initial `managed-factory-v1` profile supports
concrete synchronous factory entries, named imports from an explicit managed
surface, type declarations, functions, initialized named module bindings and
expression statements. Each factory invocation creates independent traced module
state; movable imports arrive through the host-owned frame. Unit permanent data
is part of the final executable's existing permanent extent.

Classes, unspecialized generic factories, async/generator factory entries, binding
patterns, uninitialized module bindings, namespace/side-effect imports and new
platform imports are explicit unsupported cases in this profile. Unit and host
generational-barrier policy must agree; inline-allocation units require the host
context extension. A factory facade must match its exact checked surface frame.
Composition preflights all contracts, ownership, metadata windows and instruction
sites before creating output bytes. It rewrites managed loads to relative image
addresses and preserves default AOT physical signature interning. It does not
create a runtime loader or relax the managed context domain checks.
