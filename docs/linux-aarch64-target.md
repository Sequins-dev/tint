# Linux arm64 target contract

Implementation status: hosted native programs, including the generational
runtime with mark-compact and parallel majors, threads and futex parking, compile
for `linux-aarch64` and run on Linux arm64 (Debian 13, glibc 2.41, kernel 6.1,
4 KiB pages). The compiler self-builds natively on Linux: a Node-built
`linux-aarch64` compiler rebuilds itself there and the second native generation
is byte-identical (stage1 = stage2 = stage3, about 85 s and 2.2 GB peak RSS
per generation in the container). The native FFI works as on macOS: leaf
calls into glibc, libm and libz, `tint:ffi` external storage, `node:zlib` and
`node:crypto`'s SHA-256. Live code publication (JIT) and runtime signposts are
not provided yet and fail at compile time.

This is the second concrete mapping beneath the shared contracts of the
[platform roadmap](platform-roadmap.md); the [macOS arm64 contract](macos-arm64-target.md)
is the first. Everything below that depends on Linux, glibc or ELF is
target-specific. The Tint physical call ABI (registers, result areas, frames,
roots) is unchanged from the macOS contract: it is Tint's own convention, not
the platform's.

## Target and ownership

`linuxAArch64Target` (`@tint/platform/target`) describes the output target:
little-endian arm64, 64-bit pointers, ELF, glibc's dynamic loader
`/lib/ld-linux-aarch64.so.1`, the AAPCS64 C convention (`linuxArm64CTarget`) and
the host ABI `linuxHostABI()` (`@tint/platform/linux/host-abi`). Select it with
`BuildRequest.target`, `--target linux-aarch64` on the compiler CLI and
`tools/bootstrap-compiler.ts`, or `TINT_NATIVE_TARGET=linux-aarch64` for native
fixtures. Without an explicit choice each defaults to its host: the native
compiler to the target it was itself compiled for (`nativeHostTarget()`,
below), the bootstrap and native fixtures to the Node host's OS.

Tint emits the instructions, links them and writes the ELF image itself
(`@tint/image/linux/elf`, see the [image README](../packages/image/README.md)).
No C compiler, assembler or platform linker participates. The kernel and glibc's
loader load the image; glibc supplies OS services.

### Baseline

- glibc 2.34 or later: `__libc_start_main`, `pthread_create`/`pthread_join` in
  `libc.so.6` and `getrandom` (2.25) are bound without symbol versions, so each
  binds to the library's default version.
- Kernel pages of 4 KiB or 16 KiB. Images are laid out for 64 KiB (both
  `PT_LOAD` segments 64 KiB-aligned, hosted startup mappings and guard pages in
  64 KiB units), but the runtime releases and maps collector memory in 16 KiB
  granules. Startup therefore checks `getpagesize()` before entering libc and
  exits with status 70 and the message `tint: kernel pages larger than 16384
bytes are not supported` on 64 KiB-page kernels.
- ARMv8.0-A plus the SHA-256 crypto extension. `sha256-rounds` (the compiler's
  hashing intrinsic) emits SHA256H/SHA256SU0/1 unconditionally, as on macOS;
  every current arm64 server and Apple-virtualized core implements them. The
  baseline is recorded rather than probed (`getauxval(AT_HWCAP) & HWCAP_SHA2`)
  until a target without them is supported.

## Host services

Host operations are dynamic imports from `libc.so.6`, exactly as on Darwin; no
system call numbers are hardcoded except the futex call below. Symbols carry no
prefix (`symbolPrefix: ""`); errno is read through `__errno_location`.

| Service | Linux mapping                                                                                                                                                                                                                                                   |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files   | `open` (exclusive create `O_WRONLY\|O_CREAT\|O_EXCL` = 0xc1; the variadic mode is passed in `w2`, AAPCS64 having no stack rule for variadics), `read`, `write`, `readlink`, `close`, `fchmod`, `rename`, `unlink`                                               |
| Memory  | `mmap`/`munmap`/`mprotect`; anonymous private `MAP_PRIVATE\|MAP_ANONYMOUS` = 0x22, `MAP_FIXED` = 0x10 (memory release maps fresh zero pages over a range)                                                                                                       |
| Clocks  | `clock_gettime(id, &timespec)`: `CLOCK_MONOTONIC` = 1, `CLOCK_REALTIME` = 0; nanoseconds = seconds × 10⁹ + nsec (`clock.kind: "timespec"`)                                                                                                                      |
| Entropy | `getrandom(&word, 4, 0)`, trapping on a short result (`random.kind: "fill"`)                                                                                                                                                                                    |
| Threads | `pthread_create`/`pthread_join` (error numbers returned directly)                                                                                                                                                                                               |
| Parking | `syscall(SYS_futex = 98, cell, FUTEX_WAIT_PRIVATE = 128, expected, &timespec \| NULL)` and `FUTEX_WAKE_PRIVATE = 129` with 1 or `INT_MAX` waiters; failures return -errno like the Darwin ulock statuses. Cells are shared only between threads of one process. |
| Errors  | `linuxErrorCode` (`@tint/platform/linux/fs`): numbers 1–34 match Darwin; `ENAMETOOLONG` 36, `ENOTEMPTY` 39, `ELOOP` 40 differ                                                                                                                                   |

A native program reads the target it was compiled for with
`nativeHostTarget()` (`@tint/platform/host`). Its `targetOperatingSystem`
intrinsic (`@tint/native-runtime/intrinsics/process`) is bound to the
`target-os` host operation, which code generation fixes to the build target's
host ABI `os` (`nativeTargetOSLinux` here): a constant, not a run-time probe.
Builds that do not link it are unchanged. `targetFileHost(target)` returns the
file host whose errno names match the target; the compiler CLI uses both, so a
Linux-hosted compiler reports Linux errno names and builds Linux images by
default. `tools/verify-hosted-host-target.ts` checks both facts natively
(`ELOOP` is 40 here, 62 on Darwin).

`tint:c/libsystem` and `tint:c/memory` bind to glibc and `tint:c/zlib` to
`libz.so.1` (`cLibraryManifest`). Binding declarations of libraries the target
does not load (`tint:c/commoncrypto`) are left out of the source graph, so an
import of them fails to resolve. Where glibc's declarations differ from
Darwin's, the shared declaration says so with `ByTarget` ([native FFI](native-ffi.md),
"Vocabulary"): `fchmod` takes glibc's 32-bit `mode_t`, and external storage
maps with `MAP_ANONYMOUS` = 0x20 in whole pages of `getpagesize()`.
`node:crypto` hashes with Tint's own SHA-256 (the `sha256-rounds` intrinsic),
so no OpenSSL is needed.

## Executable image and startup

The ELF writer produces a PIE (`ET_DYN`) with `PT_INTERP`, `DT_NEEDED`
`libc.so.6` followed by the program's other libraries, `BIND_NOW`, a read/execute
segment holding the headers, dynamic tables, code, read-only tail sections and
`.eh_frame`/`.eh_frame_hdr`, and a read/write segment holding `.dynamic`, the GOT
(RELRO) and data. Imports are GOT slots bound by `R_AARCH64_GLOB_DAT`; all code
addressing is pc-relative. DWARF, symbols and unwind tables use the same shared
builders as Mach-O.

The hosted entry keeps its C `main(argc, argv)` shape. On ELF the image entry
is a separate `_start` (`processStart: glibc-start-main`): it clears the frame
pointer and link register (the outermost frame), checks the page size, then calls
`__libc_start_main(main, argc, argv, NULL, NULL, rtld_fini, stack_end)`, which
initializes libc, calls the hosted entry and exits with its status. `_start` has
no unwind entry; the zero frame record ends frame-pointer walks.

### Libraries

ELF has no optional `DT_NEEDED`: a missing library fails the launch, and a weak
import of a library that is not loaded always reads 0. Rather than silently
binding an optional library's symbols to zero, the image writer rejects optional
(weak) libraries for this target. Required libraries (glibc, libm, zlib) are
`DT_NEEDED`. No current binding is optional; the first that is will load
through `dlopen`/`dlsym` at first use (the FFI's dynamic layer, Phase 3), with
availability meaning that `dlopen` succeeded.

## Not yet supported

Each fails once, before compilation, with a message naming the target:

- **Executable memory** (live code publication, the embedded eval/JIT path):
  `linuxHostABI()` has no `executableMemory`. Builds binding any
  `executable-*` host operation fail with "linux-aarch64 has no
  executable-memory (live code) publication". Linux needs W^X through a dual
  (memfd) mapping and instruction-cache maintenance (CTR_EL0-sized
  `DC CVAU`/`DSB ISH`/`IC IVAU`/`DSB ISH`/`ISB`), which are new ISA operations.
  The compiler self-build does not use them.
- **Runtime signposts** have no Linux facility (`signposts` absent): requesting
  them fails in startup emission ("target has no signpost facility").

Collector parallelism stays at six threads (`parallelWorkers`), independent of
the online CPU count; workers park, so fewer cores only cost speed.

## Verification

Native fixtures build for the host's target and run under LLDB, which launches
locally on Linux (`process launch --stop-at-entry`, then the exit status is
asserted) exactly as on macOS. `packages/image/test/elf-linux.test.ts` runs a
hand-assembled image and skips off Linux. The native FFI fixtures run on Linux
too (only the Mach-O weak-library probe skips). The clang oracles
(`packages/abi/test/c-abi-oracle.test.ts`, the `z_stream` header layout and the
zlib deflate oracle) need `clang`, `libc6-dev` and `zlib1g-dev` in the
container; without clang they skip with the reason.

## Linux development environment

`tools/linux/Containerfile` describes the reproducible Linux arm64 image:
Debian 13 (trixie), Node 24.12, pnpm through corepack, GDB, LLDB with its
Python module, binutils, `linux-perf`, LLVM tools, strace and GNU time. Build
and start it with Apple's `container`, mounting the checkout at the same path
as on the host so absolute paths (build manifests, snapshots) agree:

```sh
container build -t tint-linux-dev:1 -f tools/linux/Containerfile tools/linux
container run -d --name tint-linux --cpus 8 --memory 24G \
  --volume "$PWD:$PWD" tint-linux-dev:1 sleep infinity
container exec tint-linux sh -c "cd $PWD && pnpm install --frozen-lockfile && pnpm build"
```

The VM's kernel uses 4 KiB pages. It exposes no hardware performance
counters, so `perf stat`/`perf record` fall back to software events (`cpu-clock`,
`task-clock`); measure cycles on macOS or bare-metal Linux.

### Self-build recipe

Inside the container, with `TZ=UTC`:

```sh
B=.tint-bootstrap/linux
node tools/bootstrap-compiler.ts $B/stage1 --snapshot $B/source   # Node: linux-aarch64 by default here
lldb --no-lldbinit --batch -o "process launch -- $B/source $B/stage2" $B/stage1
$B/stage2 $B/source $B/stage3
cmp $B/stage1 $B/stage2 && cmp $B/stage2 $B/stage3
```

On another host pass `--target linux-aarch64` to the bootstrap. The native
steps need no `--target`: each compiler targets the host it was built for.
Assert LLDB's reported exit status (0), not the debugger's own. All three
generations are byte-identical ELF images; each native generation takes about
85 s and 2.2 GB peak RSS in the container on an otherwise idle host (GNU
`time -v`).
