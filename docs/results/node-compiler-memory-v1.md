# Node-hosted compiler memory, v1

Branch `perf/node-compiler-memory` (base `e30f71415`). Perf-only: every image
below is byte-identical between the base and the branch.

## Workload

The Node-hosted compiler builds the native Test262 engine image (the whole
engine, including the compiler it embeds for eval) for one trivial Script case.
A frozen copy of the base `packages/` tree is the source snapshot for both
compilers, so only the compiler that runs differs. Node 24.12.0, `TZ=UTC`,
`--max-old-space-size=14336`, `--trace-gc`, macOS arm64. The engine image is
89,578,831 bytes with SHA-256
`66eecbe61ed43d6cccfd3b4fc3ba4d599eac5624f43cfc1b9ad048afc976ac3a` in every
run listed here.

## Results

Sequential runs on a quiet host (load about 5):

| Measure | Base `e30f71415` | Branch |
| --- | ---: | ---: |
| Wall | 208.9 s | 180.4 s |
| Cycles | 1,099.9 G | 943.7 G |
| Instructions | 4,647.8 G | 4,407.0 G |
| Maximum RSS | 8.71 GB | 5.14 GB |
| Peak memory footprint | 8.49 GB | 4.66 GB |
| Highest live heap after a major GC | 3,103 MB | 1,473 MB |
| Node's default heap limit (4,288 MB) | out of memory after 180 s | completes |

By phase, attributing each major GC by a 20 ms CPU profile (separate runs on
a busier host; the boundary GCs are approximate):

| Phase | Base live after major GC | Branch live after major GC |
| --- | ---: | ---: |
| Front end (link, check, collection runtimes) | 1,612 MB | 1,342 MB |
| Lowering | 1,910 MB | 1,421 MB |
| Optimizer | 2,661 MB | 1,390 MB |
| Codegen | 3,091 MB | 1,178 MB |

The branch still needs more than 1,536 MB of old space: that limit fails at
83 s, where the checked program, its lowered IR and the optimizer's first
rewritten version overlap. Live heap after the build is unchanged (about 300 MB
until the driver drops its caches).

## Causes and changes

V8 keeps every local of an unoptimized frame alive until the frame returns.
The run-once stage functions are never optimized, so each stage result held in
a local outlived its use, and the native compiler's precise stack maps do not
hide this from Node.

1. `compileTypedProgram` is split into `linkTypedProgram` (linking, globals,
   managed surfaces), `checkTypedProgram` (specialization in its own frame,
   checking, collection runtimes), `lowerTypedProgram` (lowering and
   host/foreign/weak binding) and the optimization and emission stages. Each
   returns only what later stages use: the linker's source ranges instead of
   the linked program (`locateSourceRange`), generated function names when an
   observer or debug information needs them, and dense-list origins.
2. The optimizer runs in place on a `ModuleVersion` holder
   (`optimizeModuleVersion`; `optimizeModule` keeps its contract). Function
   passes run through drivers whose frames own the per-pass arrays, and the
   functions inlining or record-read lowering change are recorded as marks
   instead of keeping the earlier module versions to compare against.
3. The source text's UTF-8 width table run-length encodes same-width
   characters in a `Uint32Array` instead of one object per non-ASCII
   character (2.19 M objects for the generated CLDR data).
4. Record terminators are built with every field, so V8 keeps them in object;
   spreading a shared access object put them in property arrays that every IR
   copy cloned.

Step by step (single runs while other agents loaded the host, so the GC
sample points and RSS vary by about 100 MB and 1 GB):

| Step | Highest live after major GC | Maximum RSS |
| --- | ---: | ---: |
| Base | 3,103 MB | 8.89 GB |
| Front-end results released | 1,742 MB | 7.62 GB |
| Checking split, width runs | 1,594 MB | 7.61 GB |
| Optimizer in place | 1,431 MB | 5.88 GB |
| Record terminators | 1,497 MB | 6.11 GB |
| Linking split | 1,410 MB | 6.21 GB |

## Native compiler

The natively built compilers also run on identical work: stage 2 of the base
and of the branch each compiled the base's source snapshot, interleaved for
four rounds under the timing lock. Both outputs equal the base's stage image
(`770a62b3…6b60`).

| Measure (mean of 4) | Base stage 2 | Branch stage 2 |
| --- | ---: | ---: |
| Wall | 74.9 s | 70.8 s |
| Cycles | 361.6 G | 322.4 G |
| Instructions | 1,765.2 G | 1,610.8 G |
| Maximum RSS | 2.215 GB | 2.236 GB |

The frozen `v3` workload could not be timed as specified. With
`--runtime-tree --tree packages/abi/src/host.ts` the build fails to resolve
`./c/types.ts`, which FFI phase 1 added to `host.ts` but the snapshot lacks;
without `host.ts` the tree's runtime misses `nativeHeaderByteLength`; with the
snapshot's own runtime the program ends with status 70 (abrupt completion).
Built by both toolchains at one path, the `v3` program is byte-identical
(`dee0cdbf…f7f4`), so its run time cannot differ.

## Validation

- Engine image SHA-256 identical in every run above.
- Self-build: the Node bootstrap, stage 2 and stage 3 (both under LLDB, exit
  status 0) are byte-identical (`62575fdd…e882`). The first stage 2 launch
  failed to attach while new executables were stalled host-wide in
  `_dyld_start`; the separately recorded rerun passed.
- Workspace gates (`env -u TZ`, test concurrency 4): 5,967 pass, 1 skipped.
- Pre-merge host smoke (frozen toolchain `1d563e7c…`): 2/2 in units and in
  program linking. A first attempt during the same exec stall timed out in
  both modes and is retained separately.
- Native Test262 through the same frozen toolchain, units linking: WeakRef
  58/58, FinalizationRegistry 94/94, WeakMap 281/281, WeakSet 170/170, Map
  405/405, Set 764/764, Array 6,119/6,119, `language/expressions/object`
  2,251/2,252 (one module variant the runner classifies as unsupported before
  compilation: native module execution is not implemented).
- Width-table conversions are checked against a per-character reference at
  every offset of mixed ASCII, BMP and astral runs.
