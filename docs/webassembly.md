# WebAssembly output and input

Status: deferred future possibility. No Wasm support is implemented or scheduled
as part of the current native pipeline/bootstrap work.

## Decision

Wasm may be supported through two separate, optional extensions: an alternative
output backend and, independently, an alternative input frontend. Neither is a
required intermediary stage. Keep Tint's typed semantic IR and representation-aware
IR as the primary compiler representations; native compilation does not pass
through Wasm.

Both extensions are deferred. The remaining material records design considerations
for a future revisit, not implementation tasks or prerequisites. Do not add Wasm
runtime machinery or reshape the core solely to anticipate these extensions now.

The intended relationship is:

- TypeScript frontend -> typed semantic IR -> representation-aware IR -> native
  backend -> executable, library, or executable memory.
- The same frontend and shared analyses -> Wasm-specific lowering -> Wasm module.
- Wasm decoder/validator -> Wasm semantic lowering -> shared lower-level IR ->
  native backend, with a Wasm runtime/host adapter.

If a Wasm frontend is added, the shared IR/lowering must represent both direct native memory operations and Wasm memory,
trap, and reference obligations explicitly. Do not erase Wasm semantics to fit
existing native instructions. Wasm frontend-specific operations can lower to shared
primitives and runtime calls without forcing every TypeScript operation through Wasm.

## Product value

Wasm can distribute portable compiled tooling kernels that Node loads through its
WebAssembly support, avoiding a separate native library for every CPU/OS combination
when the chosen feature set and host imports are available. Browser and other Wasm
host support are possible extensions, not automatic guarantees of an identical
environment. The same exported API model can generate target-specific bindings
for Wasm and C ABI libraries while keeping their layouts and ownership rules distinct.

Node's documentation, checked on 2026-10-26, supports instance-phase imports of
`.wasm` exports and source-phase imports yielding a `WebAssembly.Module` for custom
instantiation. The experimental Wasm modules flag was removed in v24.5.0 and
v22.19.0; support/stability still needs checking against the release range Tint
chooses. Do not assume all older Node versions or bundlers support these forms.

Importing a Wasm file does not supply arbitrary filesystem, network, or other host
services. Tint must emit explicit imports and provide/document the corresponding
host adapter. WASI is one possible host contract, not an automatic consequence of
Wasm output or ESM loading.

When Node loads Tint-generated Wasm, Node's Wasm engine owns its final machine-code
generation. That is an optional hosted output target, not the standalone bootstrap
path. Tint's native outputs and future native Wasm execution remain self-contained.

## Why Wasm is not the required IR

Wasm is a viable portable low-level representation with a defined validation and
execution model. Using it as a compulsory stage would also commit native Tint to
its constraints and introduce lowering work that native code does not inherently
need:

- Structured control flow and operand-stack form need conversion to/from the
  compiler's control-flow/SSA representations. An in-memory Wasm IR can avoid
  binary encoding overhead, but not the semantic conversion itself.
- Linear-memory operations require defined bounds and trap behavior; native heap
  references and platform addresses are different concepts.
- Rich TypeScript facts, specialization dependencies, object identities, and
  deoptimization state are not automatically preserved by a plain Wasm module.
- Native ABIs, GC safepoints, patchable calls, code-version replacement, and runtime
  compilation services need additional contracts or metadata.
- Choosing WasmGC or other feature families adds obligations to Tint's Wasm-native
  runtime as well as compatibility requirements for external hosts.

Custom sections can retain Tint metadata, but generic Wasm producers will not
provide it. Removing optional sections must not change the standard Wasm meaning
of a portable module. Semantics that depend on private runtime imports require an
explicit Tint host contract, not a claim of universal standalone Wasm portability.

Wasm could therefore be a useful optional low-level interchange/serialization
boundary while the optimizer retains a richer representation. The agreed design
keeps it outside the required native path.

## Runtime and representation choices

A provisional first output profile could use Wasm32 linear memory for Tint-owned
objects and runtime storage, numeric Wasm values for scalar computation, and
explicit imports/handles at the JavaScript boundary. This reuses runtime algorithms
but not native pointer sizes or ABIs. Strings, closures, dynamic objects, unions,
and GC still require Tint runtime support; Wasm output does not implement TypeScript
semantics on its own.

WasmGC is an alternative that can delegate supported allocations to the host's GC.
It deserves evaluation for interop and memory behavior, but would require Tint's
Wasm-native execution path to implement those same semantics. Neither linear-memory
GC nor WasmGC is selected yet. Host references do not make arbitrary JavaScript
properties directly accessible without a defined interop mechanism.

Runtime-generated machine bytes placed into Wasm linear memory are data, not
executable native code. A compiler hosted inside Wasm could emit another Wasm module
and ask a host to compile/instantiate it through an explicit API, but that is a
separate hosted dynamic-execution design. It is not a reason to change the agreed
Node-AOT-to-native-runtime bootstrap.

## External Wasm input is a separate capability

Supporting Tint-generated modules is narrower than supporting arbitrary producers.
The latter requires a declared feature/host profile and, at minimum:

- Binary decoding and validation before native lowering.
- Module instantiation, imports/exports, memories, tables, globals, and start behavior.
- Correct bounds checks, traps, integer operations/conversions, floating-point
  behavior, and indirect-call validation for supported instructions.
- Reference and lifetime handling, and the required exception/GC/thread behavior
  for any extensions accepted by that profile.
- A defined host environment. A valid module may depend on WASI, a JavaScript
  wrapper, or producer-specific imports that Tint does not implement.

Accept any conforming producer within an explicitly supported profile; reject
unsupported features and unresolved imports clearly. Do not claim arbitrary Wasm
compatibility based solely on running Tint's own output. Component-model support
is another layer, not implied by support for core Wasm modules.

Wasm validation and bounds semantics must survive compilation, but a broader secure
sandbox claim would need separate treatment of host imports and resource limits.

## Possible validation if work is resumed

This sequence is deferred and does not modify the active bootstrap milestones.

1. Preserve target-independent type/effect analysis and explicit target layout rules
   while building the native pipeline; avoid making pointer width an implicit constant.
2. Prototype a bounded Wasm output profile using numeric functions and control flow,
   then memory, strings, and a realistic tooling operation with required runtime code.
3. Generate a Node binding from the common export model and compare behavior and
   end-to-end performance with native FFI and source execution. Include compilation,
   startup, marshalling, copying, memory, and steady-state execution costs.
4. If justified, add Wasm validation and lowering into Tint's native backend for
   that profile, then test modules from independent producers and the specification
   tests. Triangulate Tint-native output, Node-hosted Wasm, and Tint-native execution
   of the same Wasm; agreement alone is not a substitute for specification checks.
5. Expand feature coverage based on real workloads. An experimental Wasm target
   should not silently become a prerequisite for completing the native bootstrap.

## References

- [Node Wasm module loading](https://nodejs.org/api/esm.html#wasm-modules)
- [WebAssembly core overview](https://webassembly.github.io/spec/core/intro/overview.html)
- [WebAssembly feature support](https://webassembly.org/features/)
