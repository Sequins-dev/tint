# Cached native service units

Status: design for coordinator review; no service-unit implementation has started.

## Problem and evidence

The reviewed DateTimeFormat engine adds 21.2 MB to a non-Intl native batch image.
Lossless CLDR packing reduces that to 5.4 MB (2.9% for the 64-variant control), but
checking and compiling the always-installed formatter implementation still costs
CPU. On the same frozen compiler basis, the latest completed-tree hash variant
uses 267.8 CPU-seconds versus main's 218.2 seconds (+22.7%). The unchanged language
inputs, cold-process measurements and intermediate failures are retained.

The requested separation must remove service implementation bodies and data from
per-batch checking/lowering/emission. Moving imports between TypeScript files or
initializing a cache lazily does not accomplish that: the installed constructor
still makes the implementation reachable.

## Proposed ABI and lifecycle decision

Use position-independent **native service units**, compiled once, then composed
into the final executable by Tint's own AOT image builder. Bind their managed
imports during final image composition. Instantiate their module state through an
explicit factory in the current heap/context. Keep shared record and callback
identities owned by the host, described by declaration-only contracts.

The resulting executable contains the linked unit. It needs no service sidecar,
platform dynamic loader or new runtime executable-memory capability. Service
instantiation occurs on the first request in a context; DateTimeFormat's existing
installer runs at the same point in each realm's Intl initialization. Its public
constructor, methods, descriptors and function identities are present immediately.
CLDR decoding remains deferred until formatting needs the data.

This is a new AOT composition path using the existing managed entry-frame ABI;
it is not a new raw-call ABI. Approval is requested for this host-owned-contract,
AOT-prelink and per-context-factory model before implementation.

## Existing pieces to reuse

- `prepareModuleInstance` packages resolved function/constant modules into an
  initializer that returns typed exports and retains module state in closures.
- `adaptManagedSurfaceEntry` and managed JIT program preparation adapt an entry
  through a traced frame. The adapter currently rejects top-level initialization;
  the module-instance factory makes initialization explicit inside the entry.
- Managed declaration interchange supplies exact recursive types independently
  of implementation bodies and carries no pointer authority.
- Directory v3, managed record imports, callback witnesses and
  `resolveManagedPointers` validate semantic membership, physical layouts and
  pointer bindings before publication.
- Tint's scalar emitter and image composer own code/data layout, relocation,
  signing and DWARF composition. No C or system linker is involved.

The initial unit profile supports the function/constant modules accepted by the
module-instance transformation. Unsupported class initialization or captured
factory entries receive explicit diagnostics. DateTimeFormat uses this profile.

## Unit specification and artifact

A portable compiler request identifies the captured source modules, selected
factory/exports, concrete generic arguments, declaration-only host imports,
required record/callback classes, permanent data and normalized target/options.
The compiler derives contracts and physical facts from checked types.

The artifact contains:

- Native code and permanent data, with no host addresses or movable references.
- Named factory/export entries and their checked semantic/physical contracts.
- Symbolic managed imports and code/data/descriptor relocation records.
- Record layouts, root maps, callback membership and effect information.
- Source mappings and format/compiler ABI versions.

Internal references are relative to the unit. Host record/signature identities and
other imports remain symbolic until composition. An artifact's claimed exports do
not grant authority; the linker rechecks them against the current checked request
and the host's compiler-owned directory.

## Cache identity and stale-entry rejection

The key is a canonical hash of all output-affecting inputs:

1. Frozen compiled compiler/tooling identity and pinned tool versions.
2. Captured source bytes, logical module identities, resolution mappings,
   dependency grants and public-entry availability.
3. Data bytes/hashes, generated declaration text, selected roots/exports and
   concrete type arguments.
4. Exact semantic import/export/callback contracts and physical ABI requirements.
5. Target OS/architecture, ABI/format versions, collector and resolved compiler,
   optimization, literal, effect, debug and runtime-layout options.
6. Initialization policy, source mapping inputs and generated adapter source.

Accept only a normalized, versioned request. Reject unknown or unkeyable options;
progress callbacks are explicitly non-output inputs. The compiler/tooling digest
also invalidates entries when defaults or transformations change.

Write immutable code/manifest objects through private temporary files and atomic
publication. Validate length, content digest, key and manifest consistency on
lookup. The frozen run's service-unit index pins the accepted artifact digests;
keep derived units outside the base toolchain fingerprint to avoid a circular key.
Record that unit-index digest and linking mode in journals and resume identity.
A mismatched/corrupt entry is never linked. Cache miss/build time is reported
separately from a warm per-batch hit.

Tests mutate every key component, including data, an ABI field, compiler options,
resolution authority and generated adapters. Each mutation must miss/reject the
old artifact. Include truncated data, unknown versions, reordered fields, wrong
callback membership and late-import failures.

## Linking and ownership

Composition first checks the entire import set without modifying executable
bytes. It resolves names through the host directory, preserving AOT physical
signature interning while validating explicit semantic membership. It verifies
record field order, types, offsets, mutability, presence, initialization and tracing.

After preflight, copy the unit into private image bytes, apply internal and host
relocations, and incorporate its permanent metadata and root maps into the final
image. Resolve image-relative addresses and ASLR fixups through Tint's composer.
Only a completely resolved image is signed/published.

The cache never contains a context token, live closure or heap pointer. Factories
receive the current traced import/frame values. Their instances belong to that
permanent context/heap domain and are retained through traced handles. Reusing
code across contexts does not reuse an instance. Invocation follows the existing
managed completion and root-chain handoff rules, including abrupt completion and
callbacks. No cross-context pointer/signature checks are relaxed.

## DateTimeFormat migration

Move shared formatter state/types into declaration-only contracts so the core
`OrdinaryObject` slot keeps its checked type without importing formatter bodies.
The core retains the existing physical field representation; it does not gain an
unchecked opaque cast. Retain the required host-owned record/callback identities
explicitly in the service contract.

The service factory owns the formatter modules and packed CLDR data. Its typed
export installs the existing DateTimeFormat adapter into the supplied realm using
host helper imports. Preserve the installer and all option/brand/error ordering.
Instantiate shared module caches once per context, and run realm installation
for every realm. Preserve constructor/method realm behavior, callback membership,
legacy chaining, bound format identity and Temporal paths.

A compiler-owned service facade selects the cached binding during native
composition. The monolithic implementation remains an explicit validation mode
using the same service source, contracts and installer. Ordinary JavaScript cannot
select or forge the binding.

## Reviewable slices and evidence

1. **Mechanism:** unit request/artifact, complete cache key and atomic cache,
   managed preflight/composition and factory lifecycle. Unit tests plus a native
   counter service with independent instances, moving GC, nested callbacks and
   thrown completion. Prove rejection before metadata reads for invalid ownership,
   and include two simultaneously live context instances. Run the workspace gate
   and frozen self-build/stage comparison for compiler-graph changes.
2. **DateTimeFormat:** contract/body separation and service composition. Re-run
   existing native formatter fixtures and current workspace gates. Compare all
   490 unchanged DateTimeFormat variants in monolithic and cached modes on one
   frozen source/toolchain; preserve every outcome and compare per variant.
3. **Coverage and cost:** measure a small non-Intl selection and a 64-variant
   non-Intl batch on main and the linked branch. Report warm compile CPU, image
   bytes, runner peak RSS, cache hits and one-time preparation cost. Target compile
   CPU within about 5% of main. Repeat Temporal/Intl selections as required.

Post each completed slice independently. Keep the existing packed-data and
compiler-hash observations as immutable evidence; they are not a claim that the
compile regression is already fixed.
