# Linux arm64 target contract

Implementation status: hosted native programs, including the generational
runtime with mark-compact and parallel majors, threads and futex parking, compile
for `linux-aarch64` and run on Linux arm64 (Debian 13, glibc 2.41, kernel 6.1,
4 KiB pages). The compiler self-builds natively on Linux: a Node-built
`linux-aarch64` compiler rebuilds itself there and the second native generation
is byte-identical (stage1 = stage2 = stage3, about 85 s and 2.2 GB peak RSS
per generation in the container). The native FFI works as on macOS: leaf
calls into glibc, libm and libz, `tint:ffi` external storage, `node:zlib` and
`node:crypto`'s SHA-256. Live code publication (JIT) uses W^X dual mappings
with inline instruction-cache maintenance, and JIT code registers with GDB and
LLDB as in-memory ELF objects. Runtime signposts are USDT probes
([runtime diagnostics](runtime-diagnostics.md#linux-usdt-probes)).

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

| Service   | Linux mapping                                                                                                                                                                                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files     | `open` (exclusive create `O_WRONLY\|O_CREAT\|O_EXCL` = 0xc1; the variadic mode is passed in `w2`, AAPCS64 having no stack rule for variadics), `read`, `write`, `readlink`, `close`, `fchmod`, `rename`, `unlink`                                                                       |
| Memory    | `mmap`/`munmap`/`mprotect`; anonymous private `MAP_PRIVATE\|MAP_ANONYMOUS` = 0x22, `MAP_FIXED` = 0x10 (memory release maps fresh zero pages over a range)                                                                                                                               |
| Clocks    | `clock_gettime(id, &timespec)`: `CLOCK_MONOTONIC` = 1, `CLOCK_REALTIME` = 0; nanoseconds = seconds × 10⁹ + nsec (`clock.kind: "timespec"`)                                                                                                                                              |
| Entropy   | `getrandom(&word, 4, 0)`, trapping on a short result (`random.kind: "fill"`)                                                                                                                                                                                                            |
| Threads   | `pthread_create`/`pthread_join` (error numbers returned directly)                                                                                                                                                                                                                       |
| Parking   | `syscall(SYS_futex = 98, cell, FUTEX_WAIT_PRIVATE = 128, expected, &timespec \| NULL)` and `FUTEX_WAKE_PRIVATE = 129` with 1 or `INT_MAX` waiters; failures return -errno like the Darwin ulock statuses. Cells are shared only between threads of one process.                         |
| Live code | `memfd_create`, `ftruncate`, `mmap` (`MAP_SHARED` read/write and `MAP_PRIVATE` read/execute views over a `MAP_NORESERVE` reservation), `mprotect`, `memcmp`; `CTR_EL0`-sized `DC CVAU`/`DSB ISH`/`IC IVAU`/`DSB ISH`/`ISB` inline ([native code loading](native-code-loading.md#linux)) |
| CPU       | `getpagesize()` (page size), `sched_getaffinity(0, 128, mask)` (available CPUs), `getauxval(AT_HWCAP = 16) & HWCAP_SHA2 (64)` (SHA-256 instructions)                                                                                                                                    |
| Errors    | `linuxErrorCode` (`@tint/platform/linux/fs`): numbers 1–34 match Darwin; `ENAMETOOLONG` 36, `ENOTEMPTY` 39, `ELOOP` 40 differ                                                                                                                                                           |

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
pointer and link register (the outermost frame), then calls
`__libc_start_main(main, argc, argv, NULL, NULL, rtld_fini, stack_end)`, which
initializes libc, calls the hosted entry and exits with its status. `_start`'s
FDE leaves the return address undefined (the `outermost` unwind rule), so
DWARF unwinders (GDB, LLDB, perf) stop there; the zero frame record ends
frame-pointer walks.

### Libraries

ELF has no optional `DT_NEEDED`: a missing library fails the launch, and a weak
import of a library that is not loaded always reads 0. Required libraries
(glibc, libm, zlib) are `DT_NEEDED`. Optional C libraries load through
`dlopen`/`dlsym` at first use (the FFI's dynamic layer): their symbols are
never imported, each call resolves (once) and goes through the resolved
address, an absent library or symbol makes `Available<"x">` false and a call
throw TypeError, and nothing jumps to 0 ([native FFI](native-ffi.md#optional-libraries-on-elf)).

## Known limitations

No Linux feature is missing relative to macOS: a target-specific gap fails
once, before compilation, with a message naming the target, and none is
currently known. These limits are recorded instead:

- **Kernels 6.3+** are untested here (the development kernel is 6.1). Live
  code requests `MFD_EXEC` explicitly and falls back to a single
  `mprotect`-flipped mapping under `vm.memfd_noexec=2`
  ([native code loading](native-code-loading.md#linux)); the fallback is
  exercised on 6.1 by a seccomp filter that refuses executable memory files
  the same way, not by a real 6.3+ kernel. Under PaX MPROTECT (or SELinux
  `deny_execmem`) with `vm.memfd_noexec=2`, live code fails explicitly.
- **Collector parallelism** stays capped at six workers: on the 9-CPU
  development VM, 8 and 9 workers measured no faster than 6 (wall time only,
  on a shared VM; see
  [the measurement](native-performance-analysis.md#collector-worker-cap-on-linux)).
  Larger, quiet Linux hosts have not been measured.
- **Page sizes:** 4 KiB and 16 KiB kernels were run natively; 64 KiB kernels
  only under QEMU, because Apple silicon has no 64 KiB translation granule.
- **Live USDT tracing** (`perf probe`/`perf record -e sdt_tint:*`,
  bpftrace `usdt:` probes) has not been run: the development VM's kernel has
  no uprobes or tracefs. `tools/linux/verify-usdt-live.ts` is ready for a
  kernel that has them: it checks perf's and bpftrace's counts and `gc__end`
  metrics against GDB's ([how to run it](runtime-diagnostics.md#live-tracing-check)).
  On the development VM its static half passes (the notes, `readelf`,
  `perf list sdt` and `bpftrace -l` agree on the 21 probes) and the probe
  hits are verified under GDB.
- **Performance counters:** the development VM exposes none, so Linux timings
  are wall time and RSS only.
- **Test262 on Linux** is in progress; see the [dashboard](test262.md).

## Collector parallelism

The parallel collector uses at most six threads (the mutator's included,
tuned on six performance cores and re-measured on Linux; see
[Known limitations](#known-limitations)), fewer
when the process may use fewer CPUs:
the minimum of the calling thread's affinity mask (`processor-count`:
`sched_getaffinity` with a 1024-CPU mask, counted in place; cpusets and
`taskset` restrict it) and the tightest CPU bandwidth limit (quota / period,
rounded up, at least one) on the process's cgroup and its ancestors, read
when the runtime initializes (`native-runtime/src/processors.ts`):

- cgroup v2: `cpu.max` below `/sys/fs/cgroup`, at the `0::` path of
  `/proc/self/cgroup`.
- cgroup v1: `cpu.cfs_quota_us` and `cpu.cfs_period_us` (a quota of `-1` is
  no limit) of the cpu controller's cgroup (its `/proc/self/cgroup` line).
  The controller's mount comes from `/proc/self/mountinfo` (type `cgroup`,
  super option `cpu`), and the path is taken relative to the mount's root, so
  a container that sees its own cgroup as the root reads the files at the
  mount point; ancestors are read up to the mount point.

A hybrid hierarchy takes the tighter of the two. One CPU keeps collections
serial. libuv (Node's `os.availableParallelism()`) bounds its count by the same
facts, though it reads only the process's own cgroup, not its ancestors.
`tools/native-host-facts.test.ts` compares the native result with Node's on
the host (cgroup v2 on the development VM) and parses v1 and hybrid hierarchies
natively from fixture files.
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
hand-assembled image and skips off Linux. Live code: `verify-native-code`
(which also checks `/proc/self/maps` for two views per arena and no `rwx` page,
and the window rejections), `verify-hosted-function-addresses`,
`verify-hosted-managed-runtime-link`, `verify-native-permanent-literals`,
`build-isolated-thread-fixture` (eight threads publishing concurrently) and
`verify-hosted-jit-debug` (LLDB and GDB breakpoints, backtrace and lines in
JIT code, including a publication into a page holding a breakpoint) run on
Linux, both as dual mappings and as single mappings under
`tools/linux/refuse-executable-memfd.py` (with `TINT_EXPECT_JIT_MAPPING=single`
for `verify-native-code`, which then requires one anonymous read/execute view
per arena). The native FFI fixtures run on Linux too (only the Mach-O weak-library
probe skips). The clang oracles (`packages/abi/test/c-abi-oracle.test.ts`, the
`z_stream` header layout and the zlib deflate oracle) need `clang`,
`libc6-dev` and `zlib1g-dev` in the container; without clang they skip with
the reason.

Kernel page sizes are exercised on 4 KiB (the development container), 16 KiB
and 64 KiB kernels. The 16 KiB kernel is Linux 6.1 built from the
containerization project's arm64 config with `CONFIG_ARM64_16K_PAGES`, booted
per container with `container run -k` (never as the system default kernel).
Apple silicon has no 64 KiB translation granule, so the 64 KiB kernel (the
same config with 64 KiB pages) runs under QEMU's TCG (`-cpu max`) with a
busybox initramfs that launches prebuilt fixture images. Both test kernels
also drop memory.high throttling, which vminitd's larger 16 KiB-page
footprint otherwise triggers during boot.

Observability uses the distribution's tools (Debian: `gdb`, `lldb`,
`python3-lldb`, `lldb-dap-19`, `llvm`, `clang`, `linux-perf`, `time`; plus
`bpftrace` for USDT tracing on kernels with uprobes): DWARF from Linux
builds passes `llvm-dwarfdump --verify` and reads in GDB and LLDB
(`tools/verify-hosted-debug-variables.ts` drives both), the heap tools run
under LLDB and GDB (`tools/verify-heap-tools.ts --debugger lldb|gdb`), the
DevTools bridge runs unchanged ([native heap profiling](native-heap-profiling.md#linux),
[DevTools](native-devtools.md#linux)), `perf record` call graphs convert to
pprof and `.cpuprofile` (`tools/heap-snapshot/cli.ts perf`), and the
benchmark tools measure with GNU time and `perf stat`, reporting cycles and
instructions as unavailable on hosts without a PMU (`tools/host-tools.ts`).

## Linux development environment

`tools/linux/Containerfile` describes the reproducible Linux arm64 image:
Debian 13 (trixie), Node 24.12, pnpm through corepack, GDB, LLDB with its
Python module and `lldb-dap`, binutils, `linux-perf`, LLVM tools, clang (C
programs for the DevTools tests), `bpftrace` (USDT probes), strace and GNU time. Build
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

## Large images

ELF uses 64-bit layout coordinates and widens unwind fields when code
exceeds signed 32-bit reach. See the
[large-image contract and verifier](large-images.md#elf-and-diagnostics).
