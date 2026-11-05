# Hosted compiler driver

`buildMacOSProgram` is pure artifact composition shared by the Node bootstrap and
native compiler. Given parsed modules, entry/runtime capabilities and memory
policy, it compiles the control allocator, native runtime factory and application,
composes process startup, and writes a signed Mach-O byte array. It performs no
filesystem I/O and does not execute generated code.

Source loading and publication belong to callers. Its report callback identifies
major build stages. macOS arm64 is the implemented artifact target; the source
compiler, startup code, and image writer remain distinct modules for future hosts.

The request's optional `maxSpecializations` is forwarded to both runtime and
application compilation. The default is 4,096 per specialization pass; project
adapters own larger budgets such as the compiler project's 16,384.

`debugSymbols: true` carries compiler function names through explicit host module
placements into the Mach-O symbol table, including allocator, runtime, program,
cell helpers, and process entry. The publisher owns final image relocation and
signing; no address-search heuristic or external linker is involved.

The build request's `optimization` policy accepts `"basic"` (the default) or
`"none"`. The policy applies consistently to allocator, runtime and application
compilation. Basic currently performs constant folding, block-local scalar
propagation and dead scalar removal before verified native emission.
