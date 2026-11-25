# Frozen v7 with host-ABI `--runtime-tree` (v1)

Recorded 2026-11-23 on macOS arm64. The tree was branch `fix/frozen-runtime-tree`,
based on main `a85173493`, after `pnpm build`. Node v24.12.0, `TZ=UTC`. The v7
`source` and `toolchain` directories, frozen at `7e83194c1`, were copied into
this worktree's `.tint-bootstrap/workload-v7`. The shared workload was left
unchanged. Host load averages were 7.6–10.9 during the timed runs.

## Failure on main

`build v7 <label> --runtime-tree` failed at runtime link with
`missing export: nativeAllocatorShutdownRequest`. The tree's `generational.ts`
imports that export from `@tint/abi/host`, and the snapshot kept its older
`host.ts`.

## Substituted set

`tools/frozen-runtime-tree.ts` on v7 selects 59 runtime files plus four
host-ABI contract files: `packages/abi/src/{host,weak-slot,shared-block}.ts`
and `packages/abi/src/c/types.ts`. It reports these imported tree files as
missing from the snapshot:

- `ffi/dynamic.ts` → `node/errors.ts`
- `node/{crypto,os,zlib}.ts` → `node/errors.ts`

The frozen program never loads these modules.

The first version of the tool also followed `ffi/dynamic.ts`'s `@tint/abi/c`
imports, which added `c/{index,layout,classify,declarations,descriptor,libraries}.ts`.
That build ran correctly, with identical output, but the frozen compiler image
was 16,512 bytes larger. Imports are now followed only from files whose own
imports all resolve in the snapshot.

## Builds and output

| Image        | Built with                                                    | Image SHA-256   |      Bytes |
| ------------ | ------------------------------------------------------------- | --------------- | ---------: |
| `native-wa`  | main's tool, `--runtime-tree --tree packages/abi/src/host.ts` | `30430403…cd8f` | 77,206,898 |
| `native-wa`  | this tool, `--runtime-tree` (same label and path)             | `30430403…cd8f` | 77,206,898 |
| `native-rt2` | this tool, `--runtime-tree`                                   | `df5eb583…efb1` | 77,206,898 |

The two `wa` images are byte-identical, and their substituted source trees
match. `native-rt2` has the same sources, but its `source-rt2` root is embedded
in the image, so its bytes differ.

`native-rt2` ran under LLDB with `process launch --stop-at-entry`. The
stopped-at-entry assertion passed, the process exited with status 0, and it
wrote `68c11052…7846`.

The frozen program's output depends on the workload's absolute path.
`node v7 --rounds 1` from this worktree wrote `68c11052…7846` in 85.2 s. The
main checkout's `out-node` is `d2952ace…9933`. Every native output below matches
the local Node reference.

## Three-round run

`tools/gate/with-lock.sh both frozen-v7-runtime-tree node tools/frozen-workload.ts run v7 wa rt2 --rounds 3`
exited 0. All outputs were `68c11052…7846`.

| Round | `wa` wall | `wa` cycles | `rt2` wall | `rt2` cycles |
| ----- | --------: | ----------: | ---------: | -----------: |
| 1     |   83.88 s |      348.7G |    73.45 s |       332.6G |
| 2     |   69.24 s |      325.5G |    82.21 s |       347.3G |
| 3     |   69.26 s |      328.3G |    86.35 s |       341.5G |

Peak RSS was 2.23 GB for every run. Both images contain the same program, so
the spread is host noise, not a performance comparison.

## Older workloads

`v1`–`v6` are retired. The tool reports that `v1`–`v5` lack runtime modules the
current collector imports, such as `processors.ts` and
`tracing/transitions.ts`, so they cannot take `--runtime-tree`. `v6` selects
the same contract set as v7 but was not built.
