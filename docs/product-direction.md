# Product direction: native tooling authored in TypeScript

Status: long-term direction, not a claim of implemented performance or compatibility.

## Motivation

Tint should make it practical to build performant developer tools in TypeScript
and keep their implementation accessible to the people who use them. Moving a
tool's implementation to another language can introduce an additional barrier for
contributors familiar with JavaScript and TypeScript. Tint aims to offer native
deployment and performance while preserving a TypeScript development workflow.

Self-hosting is both an architectural requirement and a demanding real workload.
It is not the only product: developers should be able to use Tint without adopting
a new runtime for their entire application or understanding compiler internals.

## Three durable uses of one compiler

1. A Node module AOT-compiles TypeScript into native shared libraries. Node loads
   and calls those finished artifacts through its built-in FFI where supported.
   Existing applications can move a substantial compute operation behind an ESM
   export boundary without replacing their orchestration or surrounding ecosystem.
2. The same compiler builds standalone executables for developer tools, with the
   runtime support their features require. Runtime compilation machinery is included
   when needed; ordinary AOT tools should not inherently require the whole compiler.
3. Native Tint includes the compiler/runtime for self-hosting, dynamic evaluation,
   and adaptive optimization independently of Node.

The Node module remains a supported product after bootstrap. It is not scheduled
for removal once native Tint can rebuild itself. All three uses share compiler,
representation, linking, and ABI machinery; host adapters supply services.

A deferred future [Wasm output target](webassembly.md) could offer portable compiled
libraries for Node and other compatible hosts alongside platform-native FFI
libraries. It would reuse the export model with a different ABI/host adapter;
it does not replace the self-contained native compiler or change bootstrap hosting.

## Node library workflow

An intended workflow is: choose an ESM library entrypoint, compile it for a target,
produce a shared library and ABI metadata, then load it from Node. A generated
JavaScript/TypeScript binding layer can project that ABI back into familiar typed
functions and handle ownership, error translation, and library lifetime.

Generate C declarations, ABI manifests, and Node bindings from one validated
export model so argument representations cannot drift between independently
maintained signatures. Keep any Node-version-specific FFI calls in a thin adapter.
Use actual load/call/lifetime integration tests, not just generated declarations.

This does not reverse the bootstrap plan. Node can consume a finished AOT library
without being Tint's live compiler host. No arbitrary executable-buffer bridge is
required to bootstrap; dynamic compilation remains hosted by native Tint code.

As checked on 2026-10-26, Node's published documentation describes `node:ffi` as
experimental, added in v26.1.0, and available only in builds with FFI support.
Loading also depends on runtime configuration and permissions. Generated bindings
must check/document supported capabilities rather than assume every Node version
can load the library. The AOT compiler itself need not require FFI merely to emit
artifacts. Exact supported Node versions remain a release decision.

Reference: [Node FFI documentation](https://nodejs.org/api/ffi.html).

## Adoption and performance

Prefer incremental adoption through useful coarse-grained operations: parsing a
file, analyzing a module, transforming a buffer, or processing a batch. Avoid an
API that requires repeated foreign calls for every token or AST field. Crossings,
marshalling, copying, callbacks, and allocations can outweigh native computation
gains; they belong in end-to-end measurements.

The two heaps do not automatically share object graphs. Plain values and buffers
can cross under explicit contracts; larger state may remain behind handles or be
copied in batches. Do not imply zero-copy arbitrary JavaScript object interop.

The strict profile should support a recognizably TypeScript implementation style.
Restrictions need specific diagnostics and practical TypeScript-shaped repairs.
Requiring most code to be rewritten around unsafe intrinsics would undermine the
contributor-accessibility goal even if source files retain a `.ts` extension.

Preserve a straightforward Node development/test path where the implementation's
host and language requirements permit it. Document native-only intrinsics and host
APIs explicitly. Standalone deployment does not promise complete Node API or npm
package compatibility; the supported host surface must grow deliberately.

## Evidence of success

- Real tools can share their TypeScript implementation across supported Node and
  native workflows without separate hand-maintained native kernels.
- Contributors can make ordinary fixes and run meaningful tests with a familiar
  TypeScript workflow. Native correctness remains covered by native integration CI.
- Diagnostics, source locations, stack traces, and debug information connect native
  failures to TypeScript source rather than only instruction addresses.
- Packaging defines targets, artifact/ABI versions, library discovery, and failure
  behavior when no matching artifact or FFI capability is available.
- Benchmarks include cold start, total task time, memory, binary size, compilation
  cost, FFI overhead, and sustained performance on representative tooling workloads.
- Comparisons with Node and existing tools use equivalent functionality, inputs,
  outputs, and correctness checks. Native output alone is not evidence of a speedup.

The product thesis is to reduce the tradeoff between native performance and an
accessible TypeScript contribution model. Its performance and adoption benefits
remain hypotheses to validate through real tools.
