# Node FFI budgets at a45f40e41 on Darwin arm64

The baseline was main `3d10cb5c0`. The candidate was `a45f40e41`, the
branch with that main merged.

## Leaf-call microbenchmark

`tools/ffi-microbench.ts` built its image (direct `getpid`, a host
operation and 64-byte CommonCrypto calls) from both trees. The images were
byte-identical, with SHA-256
`fc4d135e95e3f01ead3cc9463670f38557b9253663f10091513197a09fc3fb63`. Their
build manifests recorded different source snapshots
(`73b18fe3…` and `90c86e66…`). The leaf-call cost is unchanged by
construction.

## Frozen v7 workload

Both trees built the frozen v7 program with
`node tools/frozen-workload.ts build v7 <label> --runtime-tree --tree packages/abi/src/host.ts`.
The two compiler images have identical `__TEXT,__text` (33,919,888
bytes, SHA-256 `bba7c099…`), `__TEXT,__eh_frame`, `__TEXT,__unwind_info`
and `__DATA,__data` sections. The files differ only in path data. The
comparison of the images both compilers emit from the frozen source, under
LLDB, was still waiting for the shared timing lock when this report was
written.

## Typed-only output

The compiler changes on the branch affect only modules that use the realm
typeof classifier, and the generated static FFI module. Neither appears
in typed-only programs, so the leaf-call image and the frozen compiler's
code are identical.
