# Linux arm64 target contract

Implementation status: hosted native programs, including the generational
runtime with mark-compact and parallel majors, threads and futex parking, compile
for `linux-aarch64` and run on Linux arm64 (Debian 13, glibc 2.41, kernel 6.1,
4 KiB pages). The compiler self-builds natively on Linux: a Node-built
`linux-aarch64` compiler rebuilds itself there and the second native generation
is byte-identical (stage1 = stage2 = stage3, about 190 s and 2.1 GB peak RSS
per generation in the container). Live code publication (JIT), runtime
signposts and `tint:ffi` external storage are not provided yet and fail at
compile time.

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
fixtures (which default to the host's target).

Tint emits the instructions, links them and writes the ELF image itself
(`@tint/image/linux/elf`, see the [image README](../packages/image/README.md)).
No C compiler, assembler or platform linker participates. The kernel and glibc's
loader load the image; glibc supplies OS services.

### Baseline

- glibc 2.34 or later: `__libc_start_main`, `pthread_create`/`pthread_join` in
  `libc.so.6` and `getrandom` (2.25) are bound without symbol versions, so each
  binds to the library's default version.
- Kernel pages of 4, 16 or 64 KiB. Images are laid out for 64 KiB (both
  `PT_LOAD` segments 64 KiB-aligned, hosted startup mappings and guard pages in
  64 KiB units). The runtime asks the kernel for its page size
  (`memory-page-bytes`: `getpagesize()`) and releases collector memory in
  whole pages of that size; the other runtime mappings (agent mailboxes and
  registries, shared blocks) are mapped and unmapped whole, so the kernel's
  rounding to its page is harmless.
- ARMv8.0-A. The SHA-256 crypto extension is optional: `cpu-sha256` reads
  `getauxval(AT_HWCAP) & HWCAP_SHA2` once per process (foundation's
  `sha256-compression.ts` caches it at module initialization), and CPUs
  without it take the portable rounds instead of the `sha256-rounds`
  instructions (SHA256H/SHA256SU0/1). On Darwin the extension is baseline
  (every Apple silicon core) and `cpu-sha256` is the constant 1.

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
| CPU     | `getpagesize()` (page size), `sched_getaffinity(0, 128, mask)` (available CPUs), `getauxval(AT_HWCAP = 16) & HWCAP_SHA2 (64)` (SHA-256 instructions)                                                                                                            |
| Errors  | `linuxErrorCode` (`@tint/platform/linux/fs`): numbers 1–34 match Darwin; `ENAMETOOLONG` 36, `ENOTEMPTY` 39, `ELOOP` 40 differ                                                                                                                                   |

`tint:c/libsystem` and `tint:c/memory` bind to glibc and `tint:c/zlib` to
`libz.so.1` (`cLibraryManifest`). Binding declarations of libraries the target
does not load (`tint:c/commoncrypto`) are left out of the source graph, so an
import of them fails to resolve. The shared `tint:c/libsystem` declaration gives
`fchmod` Darwin's 16-bit `mode_t`; glibc's is 32-bit, and the lowering
zero-extends the converted mode, so the call is correct for every mode value.

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
pointer and link register (the outermost frame), then calls
`__libc_start_main(main, argc, argv, NULL, NULL, rtld_fini, stack_end)`, which
initializes libc, calls the hosted entry and exits with its status. `_start` has
no unwind entry; the zero frame record ends frame-pointer walks.

### Libraries

ELF has no optional `DT_NEEDED`: a missing library fails the launch, and a weak
import of a library that is not loaded always reads 0. Rather than silently
binding an optional library's symbols to zero, the image writer rejects optional
(weak) libraries for this target. Required libraries (glibc, zlib) are
`DT_NEEDED`. A later `dlopen`-based policy can add optional libraries.

## Not yet supported

Each fails once, before compilation, with a message naming the target:

- **Executable memory** (live code publication, the embedded eval/JIT path):
  `linuxHostABI()` has no `executableMemory`. Builds binding any
  `executable-*` host operation fail with "linux-aarch64 has no
  executable-memory (live code) publication". Linux needs W^X through a dual
  (memfd) mapping and instruction-cache maintenance (CTR_EL0-sized
  `DC CVAU`/`DSB ISH`/`IC IVAU`/`DSB ISH`/`ISB`), which are new ISA operations.
  The compiler self-build does not use them.
- **`tint:ffi` external storage** (and `node:zlib`, which uses it): its mapping
  flags are Darwin constants (`MAP_ANON` 0x1000). Builds containing
  `native-runtime/src/ffi/darwin.ts` fail with "tint:ffi external storage uses
  Darwin mapping flags". A per-target runtime module selection is needed.
- **Runtime signposts** have no Linux facility (`signposts` absent): requesting
  them fails in startup emission ("target has no signpost facility").

## Collector parallelism

The parallel collector uses at most six threads (the mutator's included,
tuned on six performance cores), fewer when the process may use fewer CPUs:
the minimum of the calling thread's affinity mask (`processor-count`:
`sched_getaffinity` with a 1024-CPU mask, counted in place; cpusets and
`taskset` restrict it) and the tightest cgroup v2 CPU bandwidth limit
(`cpu.max` quota / period, rounded up) on the process's cgroup and its
ancestors, read from `/proc/self/cgroup` and `/sys/fs/cgroup` when the
runtime initializes (`native-runtime/src/processors.ts`). One CPU keeps
collections serial. The legacy cgroup v1 hierarchy is not consulted. libuv
(Node's `os.availableParallelism()`) bounds its count by the same two facts.
On Darwin the count is `sysconf(_SC_NPROCESSORS_ONLN)`, which leaves every
current Mac at six workers.

## Time zones

Named time zones read the host's IANA database (`/usr/share/zoneinfo`).
Link structure is host data: macOS links `Atlantic/Reykjavik` to
`Africa/Abidjan`, while Debian (built with `backzone`) keeps Reykjavik a Zone
with its own pre-1970 history. ECMA-402 primary identifiers come from CLDR,
not from the links, so `Atlantic/Reykjavik` stays primary either way and only
the transitions differ, as they do between any two databases (Node uses
ICU's bundled copy). The named-time-zones fixture therefore picks its
link-sharing case from the host's database.

## Verification

Native fixtures build for the host's target and run under LLDB, which launches
locally on Linux (`process launch --stop-at-entry`, then the exit status is
asserted) exactly as on macOS. `packages/image/test/elf-linux.test.ts` runs a
hand-assembled image and skips off Linux. FFI fixtures that exercise Darwin
libraries skip on Linux with the reason.

Self-build on Linux: `node tools/bootstrap-compiler.ts <stage1> --target
linux-aarch64 --snapshot <source>` on any host, then on Linux
`<stage1> <source> <stage2> --target linux-aarch64` and the same with stage2;
compare the generations. The Linux-hosted compiler still uses the Darwin
`node:fs` binding (`@tint/platform/darwin/fs`): its file operations are the
target's host calls, and only errno names above 34 are Darwin's in its
diagnostics until the CLI selects `@tint/platform/linux/fs` per target.
