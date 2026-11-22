# Node FFI budgets at ca6306f2d on Darwin arm64

The baseline was main `3d10cb5c0`. The candidate was `ca6306f2d`, the
branch with that main merged. The candidate includes the IR inliner change
for bound record views, the typed FFI entry changes and the realm typeof
tag tests.

## Leaf-call microbenchmark

`tools/ffi-microbench.ts` built its image (direct `getpid`, a host
operation and 64-byte CommonCrypto calls) from both trees. The images were
byte-identical, with SHA-256
`fc4d135e95e3f01ead3cc9463670f38557b9253663f10091513197a09fc3fb63`. The
leaf-call cost is unchanged by construction.

## Frozen v7 workload

Both trees built the frozen v7 program with
`node tools/frozen-workload.ts build v7 <label> --runtime-tree --tree packages/abi/src/host.ts`.

- **Compiler images:** identical `__TEXT,__text` (33,919,888 bytes),
  `__TEXT,__eh_frame`, `__TEXT,__unwind_info` and `__DATA,__data`
  sections. The files differ only in path data.
- **Emitted images:** each compiler compiled the frozen v7 source under LLDB,
  holding the shared timing and launch locks. Both reached entry and exited
  0. The emitted images were byte-identical, with SHA-256
  `68c11052966f4a851b875c23b6a3413abc74262cec1460532dba09c624d17846`, the
  value recorded for earlier baselines.

## Typed-only output

The inliner admits record tests and reference payload reads only in
callees that test a record. These exist only for realm record bindings,
so typed-only programs inline exactly as before. The realm typeof change
and the generated static FFI module also affect only programs with a
program realm.
