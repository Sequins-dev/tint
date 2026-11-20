# Slice 2b focused validation

Node 24.12.0 completed `pnpm build`, `pnpm exec tsc -p tsconfig.tests.json`,
the native compiler subset check and the native projection-runtime subset
check. The focused checker, runtime, shared-storage and Node corpus tests
passed 257 of 257.

The hosted fixtures built with `TZ=UTC`, `TINT_BUILD_ONLY=1`,
`TINT_GENERAL_FALLBACK=0`, `TINT_STACK_TRACES=1` and the linux-aarch64
target. Each launched on `dev` under LLDB, stopped at entry and exited 42.

| Fixture                       | Image SHA-256                                                      |
| ----------------------------- | ------------------------------------------------------------------ |
| `slice2b-callable-property`   | `1c55e4390152e91a66c238a2a4619fe7f8a6aab562cea4bd8a240c4517dd7e43` |
| `slice2b-callable-projection` | `08200c67c05126a9f73143e23814fe6b5caa9f50a4a823c309ac9dbdc7077df9` |
| `slice2b-storage-views`       | `191517a3fab42b78f0c2d1eeea7560f31fe7d5c13054e71fd0828d8d1bc6ab91` |
| `slice2b-byte-ranges`         | `f0fc08a3d7664616717214a34ab023eda01afbad4b22b69f015e75d1a7204754` |

The callable fixtures' manifests report source snapshot
`fa14910c5a19ea260c8dc2950d6e488e062731710e064367a0edf4104f8f21cf`.
The storage and byte-range manifests report
`c0bc12fa25088f585798a1ce11d9c2fffd1d4831168b57230a36004ed715112a`.
The Node shared-storage test exercised ordered reads, write aliasing and
growth with the real shared host service. The native byte fixture exercised
ordinary backing with aliased Uint16Array and DataView ranges.

Diagnostic iterations retained in the worktree's ignored evidence directory
include a retained classifier dependency error, a native exit 70 before the
projection site reached rewritten syntax, a missing dynamic helper in a
generated record accessor and a map callback layout error during realm
allocation replay.
