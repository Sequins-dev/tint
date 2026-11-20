# Linux x86-64 target design

Tint supports `linux-x86_64` with the 64-bit System V ABI, ELF PIE and
glibc. Tint emits and links the native image directly. The same scalar IR,
runtime contracts and x86-64 backend serve
strict and live code, including runtime compilation. Build host, output target
and execution runner are independent. This plan follows the
[Linux arm64 port](linux-aarch64-target.md) and the
[platform roadmap](platform-roadmap.md).

| Order | Target         | Scope                                                                                                                                                                                                                                                                                                                    |
| ----- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Linux x86-64   | Baseline glibc 2.34 and 4 KiB base pages. Reuse Linux libc service policy, ELF64 layout, loader binding, W^X, POSIX threading and USDT. Validate first on Debian 13, then on the declared glibc floor.                                                                                                                   |
| 2     | macOS x86-64   | Mach-O CPU subtype, load commands, fixups, deployment policy, signing, dyld entry and import stubs, Darwin x86-64 C ABI and system constants, VM and JIT policy, compact unwind or DWARF fallback, and debugger behavior. Rosetta provides translated testing and Intel hardware is needed to establish native behavior. |
| 3     | Windows x86-64 | PE32+ image layout, sections, imports and base relocations, Win64 C ABI with four register positions and 32-byte shadow space, SEH unwind metadata, process/CRT entry, Windows file, clock, memory and thread APIs, and publication including `FlushInstructionCache`.                                                   |

## Backend boundary and inventory

At `53963a945`, [the arm64 backend](../packages/codegen/src/aarch64/) has
32 TypeScript files and 29,306 physical lines. The scalar entry is 17,120 lines
with 149 named function declarations at module, emitter and per-function scope
by a line-prefix count. The ISA is 1,413 lines, startup 1,663, diagnostics
1,871 and the stack-map module 794. The three slot, temporary and leaf register
allocation files total 1,186 lines. These are inventory counts. Slice estimates
below measure expected new and edited lines.

Build a second emitter for the existing scalar IR. IR cases in
[`scalar/index.ts`](../packages/codegen/src/aarch64/scalar/index.ts) combine
instruction selection with physical register lifetimes, scaled immediates,
flag dependencies, spill placement, leaf helper conventions and instruction
sizing. A mechanical translation would inherit those assumptions, and
extracting a general machine selection layer now would couple the first x86
execution to a rewrite of the arm64 emitter. Share IR verification and storage,
CFG and liveness analysis, logical layouts, descriptor semantics and
format-neutral module/link contracts. Extract a narrow shared calculation when
both emitters can use it and the existing arm64 fixtures retain their bytes.
Keep machine IR as a later investment based on the two backends.

| Surface                               | Existing owners                                                                                                                                                                                                                                                                                                           | Shared contract and x86-64 work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target selection and host fingerprint | [target.ts](../packages/platform/src/target.ts), [host.ts](../packages/platform/src/host.ts), [host ABI](../packages/abi/src/host.ts), [process intrinsics](../packages/native-runtime/src/intrinsics/process.ts), [CLI](../packages/compiler/src/cli-arguments.ts), [Node target helper](../tools/native-host-target.ts) | Discriminated target descriptor with OS, arch, format, C target and page policy. Native compiler derives its own target from compile-time OS plus arch identity. Node maps the actual OS/arch pair. Freeze the output target separately.                                                                                                                                                                                                                                                                                                                    |
| Frontend, AOT, emission planning      | [build.ts](../packages/compiler/src/build.ts), [native/index.ts](../packages/compiler/src/native/index.ts), [scalar IR](../packages/ir/src/scalar/), [catalog](../packages/compiler/src/catalog.ts)                                                                                                                       | Keep checker, strict/live semantics, target layouts, optimizer, body store, spilling, streaming and emission sizing. Select backend through the native compiler's public entry. Move neutral module metadata and plan types out of arm64 imports, including closed-function, managed-contract and debug consumers. Preserve catalog order and regenerate the catalog and export boundaries for new modules. See [compiler memory](compiler-memory.md#streaming-emission-codegen) and [framework ownership](framework-consolidation.md#framework-ownership). |
| Machine emission                      | [ISA](../packages/codegen/src/aarch64/isa.ts), [scalar emitter and helpers](../packages/codegen/src/aarch64/scalar/), [cell leaves](../packages/codegen/src/aarch64/cell.ts)                                                                                                                                              | Shared scalar operations, proven bounds, stack-slot sharing, safepoint liveness and signature semantics. Per-arch selection, clobbers, argument moves, register homes, prologues and fixups. Port allocation, memory, numeric/string/array, cell, indirect-call, barrier and external-memory leaves as emitted paths require them.                                                                                                                                                                                                                          |
| Hosted entry and OS services          | [startup](../packages/codegen/src/aarch64/startup.ts), [Linux host policy](../packages/platform/src/linux/host-abi.ts), [runtime intrinsics](../packages/native-runtime/src/intrinsics/)                                                                                                                                  | Share context layout, stack limits, heap/control regions, registry setup, mapping policy and OS service names. Split out process and pthread entry sequences, calling convention, syscall facts and CPU features. Keep raw libc imports for the hosted manifest separate from public FFI.                                                                                                                                                                                                                                                                   |
| Link and relocations                  | [arm64 relocations](../packages/codegen/src/aarch64/image-relocations.ts), [executable contract](../packages/image/src/executable.ts), [service-unit linker](../packages/compiler/src/native/service-unit-link.ts), [managed surface reader](../packages/compiler/src/native/managed-directory-reader.ts)                 | Keep symbol identities, code/data placement and streaming plans. Use architecture-tagged fixups with byte offsets, width, addend and validated PC base. Apply through the selected backend to local, import, managed service, signature, descriptor and data sites. Audit every fixed instruction width and ADRP page-alignment assumption.                                                                                                                                                                                                                 |
| Executable and debugger image         | [ELF](../packages/image/src/linux/elf/), [Mach-O](../packages/image/src/darwin/macho/), [image dispatch](../packages/compiler/src/image-writer.ts)                                                                                                                                                                        | Reuse ELF64 little-endian sections, segments, dynamic strings and symbols, GOT, RELA, SysV hash and note layout. Supply machine ID, relocations, segment alignments, interpreter and CFI target. Keep Mach-O stubs, signing, dyld fixups and compact unwind in Darwin. Use `EM_X86_64` in executable and in-memory ELF objects.                                                                                                                                                                                                                             |
| Stack maps and GC                     | [encoder](../packages/codegen/src/aarch64/scalar/stack-maps.ts), [ABI constants](../packages/abi/src/host.ts), [scanner](../packages/native-runtime/src/tracing/scan.ts), [transitions](../packages/native-runtime/src/tracing/transitions.ts)                                                                            | Share liveness, table registry, word tracing and moving collector. Supply physical frame/save rules and byte-PC tables, including the initially stack-only roots. Preserve arm64 v2–v4 readers. Track transition offsets and saved-register order with FFI.                                                                                                                                                                                                                                                                                                 |
| Unwind and debug                      | [unwind contract](../packages/abi/src/unwind.ts), [arm64 unwind](../packages/codegen/src/aarch64/unwind.ts), [EH frame](../packages/image/src/eh-frame.ts), [DWARF](../packages/image/src/dwarf.ts), [debug functions](../packages/compiler/src/native/debug-functions.ts)                                                | Reuse byte ranges, type/line tables, call-frame writer and large PC extents. x86-64 DWARF RBP=6, RSP=7, RIP=16, XMM0–15=17–32. Use byte CFI advances and describe entry, frame build, epilogue and outermost state. Drop the return-address-register assumption. Route debug variable register locations through target maps.                                                                                                                                                                                                                               |
| Live linking and executable memory    | [managed JIT entry](../packages/compiler/src/native/managed-jit-entry.ts), [engine](../packages/js-engine/src/native/), [Linux mapping leaves](../packages/codegen/src/aarch64/scalar/executable-memory.ts), [JIT ELF](../packages/image/src/linux/elf/jit-object.ts)                                                     | Share binding/domain checks, code arena ownership, permissions, registration and debugger lifetimes. Select the backend for general and managed entry emission, apply fixups at the RX address and publish target-compatible code. Audit JIT object symbols, disassembly and breakpoint copying.                                                                                                                                                                                                                                                            |
| Fast paths and shared memory          | [shared-memory leaves](../packages/codegen/src/aarch64/scalar/shared-memory.ts), [remembered barrier](../packages/codegen/src/aarch64/scalar/barrier.ts), [atomic intrinsics](../packages/native-runtime/src/intrinsics/shared-atomics.ts), [SHA-256](../packages/foundation/src/binary/sha256-compression.ts)            | Keep GC and atomic contracts, alignment, word widths and waiter authority. Emit x86 lock/fence/pause and SIMD forms where required. Keep portable SHA-256 initially and provide a valid lowering for any retained optional intrinsic in the frozen compiler.                                                                                                                                                                                                                                                                                                |
| Diagnostics and USDT                  | [diagnostics](../packages/codegen/src/aarch64/diagnostics.ts), [ELF notes](../packages/image/src/linux/elf/index.ts), [profiler tooling](../tools/profiling/perf-script.ts)                                                                                                                                               | Share trace schema and note base/semaphore semantics. Emit x86 NOP probe sites and SysV register capture thunks, x86 operand strings such as `8@%rdi`, and byte-relative site offsets. Preserve flags and live state across transparent probes. Validate attach against a running process.                                                                                                                                                                                                                                                                  |
| C, callbacks and FFI                  | [C ABI](../packages/abi/src/c/), [foreign declarations](../packages/compiler/src/native/foreign/), [C facade](../packages/native-runtime/src/c/), [FFI](../packages/native-runtime/src/ffi/), [Node adapters](../packages/native-runtime/src/node/), [fixtures](../tools/native-ffi-fixtures.ts)                          | FFI/convergence owns the SysV classifier, type/struct layout, c-call lowering, dynamic and static symbol bindings, callbacks/thunks and foreign fixtures. The target team supplies the descriptor hook, encoder, import/fixup interface, managed frames and transition hooks. Coordinate `scalar/foreign-calls.ts` and equivalent x86 files through that owner.                                                                                                                                                                                             |
| Tools, tests and documentation        | [bootstrap](../tools/bootstrap-compiler.ts), [Test262](../tools/test262-native-run.ts), [trap handling](../tools/native-test-traps.ts), [arm64 verifier](../tools/verify-aarch64.ts), [large images](large-images.md#verification)                                                                                        | Audit hardcoded target names, `process.arch` guards, hosted fixture paths and manifests, ARM-only assembler/opcode and trap assertions, disassemblers, profiling registers, seccomp audit arch/syscall numbers, C bindgen, and Linux container rules. Keep arm64-specific verifiers and add x86 equivalents. Bind runner selection to the artifact's target.                                                                                                                                                                                                |

## Physical ABI and runtime

| Item                      | Initial x86-64 contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Managed calls             | `rdi` context, `rsi` environment, `rdx` receiver slot, `rcx` result area. Typed arguments use `r8,r9` for integer/reference/indirect and `xmm0–7` for Number. Overflow slots are 8 bytes in source order, with the outgoing area rounded to 16. General entry uses `r8` argc and `r9` argv. `eax` mirrors Normal/Throw. Preserve the caller-owned result, receiver and argv protocols from the [managed contract](macos-arm64-target.md#tint-physical-call-abi-version-0).                                                                                                                                                              |
| Registers and frames      | 16 GPRs and 16 XMM registers. Reserve `rsp,rbp` for the stack and chain, `r11` as call/address scratch, and keep `rbx,r12–15` preserved. Allocate `rax,rdx,rcx` with explicit fixed uses for division, CAS, variable shifts and calls. XMM registers are volatile across both managed and SysV calls initially. Align `rsp` to 16 before calls, giving `rsp % 16 = 8` on entry. `push rbp; mov rbp,rsp` places the chain at `[rbp]`, return PC at `[rbp+8]`, first overflow slot at `[rbp+16]`. Use fixed aligned frames and omit use of the 128-byte red zone.                                                                         |
| Host and FFI              | SysV integer/pointer args use `rdi,rsi,rdx,rcx,r8,r9`, scalar FP `xmm0–7`, results `rax` or `xmm0`. Variadic call sites set `al` to the vector-register count or a valid upper bound, including zero for `open` and `syscall`. Stage stack args before call and preserve live managed state. Leave aggregate classes, hidden sret, larger stack alignment, foreign callbacks and foreign result ownership to FFI/convergence.                                                                                                                                                                                                           |
| Representation            | Keep two-word tagged general values, raw binary64 Numbers, canonical booleans, integer lowering types, exact raw word halves, descriptors and completion areas. Defer NaN boxing. Preserve signed zero, unordered tests, NaN category semantics, JS integer conversion and overflow behavior. Keep the existing low-48-bit managed address contract. On LA57 systems validate mappings and registrations before encoding addresses into headers, with bounded low-address retry or explicit failure for an unusable range.                                                                                                              |
| Flags and addressing      | Select signed and unsigned Jcc separately. `ucomisd` makes unordered set ZF/PF/CF, so test PF or compose conditions for NaN-sensitive equality and order. Model EFLAGS as a clobberable dependency; keep compares near consumers. Use base + index × 1/2/4/8 + displacement for slots and arrays and `lea` for flag-preserving address arithmetic. Guard integer divide by zero and signed overflow before `idiv` where the source operation requires it.                                                                                                                                                                               |
| Safepoints and unwinding  | Key maps by the exact PC after each allocating call. Start with all live reference and tagged roots homed, including across runtime leaves, and zero held-register masks. Use the wide v3 byte-PC format initially, with the existing frame-chain geometry and frame size measured below RBP. Validate that the runtime's walk-start saves, transparent ranges and registry agree. If compression becomes material, add a version with byte distances and explicit register-save order. Keep arm64 v4's implicit /4 units unchanged. CFI at entry uses CFA=RSP+8 and RIP at CFA−8, then describes the pushed RBP and framed CFA=RBP+16. |
| Stack and heap protection | Preserve explicit stack-limit checks before reserving frames, C headroom, RangeError completion and guard mappings. Large frames need page probing or a proof the reservation remains within a committed stack window. Handle language errors through checked operations and completion propagation. Guard-page faults remain a last resort. Keep the remembered-set bitmap, queue overflow fallback and moving-GC publication order.                                                                                                                                                                                                   |
| Atomics                   | For aligned ordinary write-back memory, acquire loads and release stores use plain size-matched MOV and preserve compiler ordering. Drop the arm64 fences used only for those edges. TSO still allows Store→Load reorder: establish a coherent SC mapping across all access paths, for example MOV loads and XCHG stores, with locked CMPXCHG/XADD or CAS loops for RMW and MFENCE for an explicit full fence. CAS mismatch retains SC order. Preserve alignment and bounds checks, publication and futex wake/recheck semantics. Use PAUSE in spin loops.                                                                              |
| CPU profile               | Recommend x86-64-v2 as the deployment contract. It avoids AVX/OSXSAVE bring-up and is sufficient for mainstream Linux x86-64 environments. Keep initial emission within baseline integer/SSE2 where practical. A fixed profile needs no per-op detection. Verify the actual guest CPUID model and loader compatibility. If later dispatching AVX or BMI paths, use CPUID with OSXSAVE/XGETBV for AVX and include chosen ISA policy in JIT/compiled artifact identity.                                                                                                                                                                   |

Hosted x86-64 images register wide v3 tables at startup. Direct
managed calls record the byte offset immediately after the call, with
reference and tagged homes relative to the suspended stack pointer.
`root-head` publishes the frame chain for the shared walker. Callback thunks
use the same registry sentinel and transition record as arm64.

The physical SysV rules and relocation formulas come from the
[x86-64 psABI](https://gitlab.com/x86-psABIs/x86-64-ABI). Instruction encoding,
ordering and self-modifying code rules follow the
[Intel architecture manuals](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html).

## Executable image, startup and reach

- Emit ELF64 `ET_DYN`, little endian, `EM_X86_64` (62), with
  `/lib64/ld-linux-x86-64.so.2`. Keep RX and RW load segments, section and
  segment congruence, non-executable stack and GOT binding. Use
  `R_X86_64_GLOB_DAT` for dynamic GOT slots and reserve
  `R_X86_64_RELATIVE` for any future loader-rebased in-image data cells.
  Internal address patches stay in Tint. Their meanings correspond to
  `PC32` (`S + A - P`), `PLT32` for PLT calls if adopted, and
  `GOTPCREL` for RIP-relative GOT operands. Compute the addend so the
  displacement is relative to the end of the full instruction, including
  any trailing immediate. Default imports call indirectly through GOT.
- `_start` captures the loader finalizer from `rdx` before reusing it as
  argv, reads argc/argv from the initial stack, aligns RSP, clears RBP,
  and calls `__libc_start_main(main, argc, argv, 0, 0, rtld_fini, stack_end)`.
  SysV passes the finalizer in `r9` and stack_end as the seventh stack
  argument. Set up the normal hosted context, allocator and registry in
  main. Thread entry uses the SysV `void* -> void*` boundary and an
  isolated managed context. Linux futex via variadic libc `syscall` uses
  number 202 on x86-64. Raw kernel calls in freestanding fixtures use the
  kernel convention, including `r10` for arg four.
- Start with conservative fixed-size rel32 branches and RIP-relative data
  references. Use byte positions for labels, actual encoded lengths for
  fixups, deliberate NOP padding and optional function alignment. Add rel8
  shortening only with stable sizing/relaxation or independent local
  layout. The missing ADRP page window removes 4 GiB page-relative
  constraints. Near x86 branches, calls and RIP-relative references still
  have signed 32-bit reach, about ±2 GiB from next RIP.
- Use the [large-image plan](large-images.md#code-model) to size and place
  sites, detect overflow and re-emit once in far mode. A far site can use
  a nearby address island or a RIP anchor plus a full-width image-relative
  delta loaded into registers. Preserve PIE, flags, reserved scratch rules
  and GOT indirection. Far conditional branches invert the condition over
  an indirect jump. Keep load-time rebasing out of instruction bytes.
  Carry full-width code offsets through maps, trace tables and CFI. Exercise
  forced far sites and synthetic signed boundaries, then verify a large ELF
  with real code/data/GOT spans before claiming large-image support.

## Hosted typed subset

The hosted builder accepts `linux-x86_64` for closed typed programs
with a zero-argument entry returning a Number, Boolean, void or a tagged
general value. A general exit value may be an integer from 0 to 255, a
Boolean or undefined. Module
initializers run before the direct entry call. Hosted startup supplies a
guarded stack and uses the shared managed completion protocol. A request
that omits runtime selection gets a bounded, zero-filled arena for
standalone fixtures. A generational request initializes the shared Tint
collector and registers the application's and runtime's exact return-PC
maps before entering the program. Stack overflow yields a Throw
completion before allocating the frame. An uncaught Throw exits 1 and a
startup mapping failure exits 71.

Compiler-authorized libc leaves provide argument bytes, environment value
copies, file I/O including stdout and stderr, monotonic and wall clocks,
random words, and process and target facts. Startup binds
`__libc_start_main@GLIBC_2.34` through the GOT and declares the version
in the ELF dynamic table. The mapping and guard granule is 4 KiB.

The x86-64 generational collector uses the shared evacuation and
mark-compact worker pool. Affinity and cgroup limits select the number of
workers, and small collections use the serial path. Hosted threads have
independent contexts, stacks and heaps. Threaded entries stop and join their
collector workers before releasing context storage. Each heap has one
mutator, and its leaf C calls cannot start a collection.

Aligned acquire loads and release stores use MOV. Shared sequentially
consistent stores use XCHG, and read-modify-write operations use locked
CMPXCHG or XADD. The Linux waiter uses private futex operations and
rechecks its condition after every kernel return.

**Slice 7 and F1 are complete for hosted x86-64.** The managed emitter
supports strings, typed arrays and reference vectors, descriptor-backed
records, escaping function environments, and tagged completions. The
generational collector moves roots across managed call frames and uses
the shared transition-aware walker. [F1 and F2](native-ffi.md#linux-x86-64)
cover static and dynamic SysV calls, including aggregates, variadics,
optional libraries, FFI views, and scoped, registered and dynamic
callbacks. Callback thunks preserve the transition pointer at frame
offset +48 and use stack map sentinel 1 with the shared walker.

Run the hosted smoke from the project root after `pnpm build`.

```sh
TINT_X64_HOSTED_RUNNER=x64-qemu-dev node --test tools/x64-hosted.test.ts
TINT_X64_HOSTED_RUNNER=x64-ssh node --test tools/x64-hosted.test.ts
```

## Instruction encoder

Build a portable typed instruction model with explicit operand size,
register class, memory addressing, displacement and immediate kind.
Encode only forms used by the backend. Emit legacy prefixes before REX,
then opcode, ModRM/SIB, displacement and immediate in architectural order.
Test REX.W/R/X/B, SPL/BPL/SIL/DIL and extended byte registers. Exclude
AH–DH from the register model. Handle the RSP/R12 SIB case, RBP/R13
zero-displacement encoding, absent base/index, invalid index selections,
and RIP-relative addressing explicitly. Range-check sign-extended imm8
and imm32 forms, 64-bit constants, displacement and fixup fields. Use the
existing exact low/high word representation for bits beyond safe integers.
Keep SSE2 scalar moves, arithmetic, comparisons, conversions and bit
transfers in the first encoder. Add VEX forms when an AVX profile needs
them, with independent tests for inverted fields, two-/three-byte prefixes
and SSE/AVX transition policy.

Use deterministic byte goldens and generated operand matrices against
`llvm-mc`. Disassemble emitted bytes with `llvm-objdump` or GNU
`objdump` and compare canonical operands and decoded sizes, allowing
equivalent encodings where required. Cover every emitter-used form,
invalid forms, displacement/relocation limits and label-to-end-of-instruction
math. Cross-build a native fixture for the portable byte writer and
execute representative instruction groups. Keep assembler and disassembler
tools as test oracles.

## Far images and services

The default x86-64 code model uses rel32. An out-of-range image reference
retries with the far model. `forceFarReach` exercises that model at ordinary
image sizes. Far code computes addresses from RIP and signed 64-bit deltas,
preserves condition flags, and saves its scratch pair at SysV entry
boundaries. The ELF remains position independent. The writer selects wide
unwind pointers when the frame table crosses the signed 32-bit range.

Managed service units use the same semantic contract and witness validation
as arm64. They carry x86-64 relocation windows and place their code into the
final image through the hosted code plan. Their collector maps are rebased
with their code. The service fixture collects while an independent unit is
on the stack and rejects a changed address window. To build a sparse ELF
that places startup, the GOT and writable data more than 2 GiB away from
the managed entry, run `node tools/verify-x64-large-image.ts OUTPUT`.

## Live execution and observability

Reuse Linux memfd RX/RW aliases and the RW→RX fallback, including debugger
private-page repair and target page policy. Keep concurrent execution
excluded while a range is written. x86 instruction/data caches are coherent,
so the ARM DC/IC maintenance loops disappear. Follow the x86 instruction
stream synchronization rules for code reuse or cross-core publication.
Publish newly written immutable ranges through the existing synchronization
and registration contract, and require a verified quiescence and instruction
serialization protocol before allowing live replacement or reuse by other
cores. Register roots and the x86 ELF JIT object before making its entry
available according to the existing lifetime protocol. Cross-check W^X and
USDT on the guest kernel, including exec-memfd policy, since user-mode
emulation translates kernel interfaces. See [native code loading](native-code-loading.md#linux)
and [Linux diagnostics](runtime-diagnostics.md#linux-usdt-probes).

Published x86-64 modules place literals, managed identity slots and
safepoint tables in their retained arena. The linker checks the owning
context and descriptor bytes before filling any slot. Publication
registers the module's stack map before returning an entry address.
Executable writes and calls serialize the current instruction stream
with CPUID. Linux arenas keep distinct RX and RW views, or switch the
single view from RW back to RX when executable memory files are denied.
The writer repairs private RX pages dirtied by a debugger's breakpoint.
The GDB registration object carries the x86-64 ELF machine type.

Hosted ELF images carry indexed `.eh_frame` data for managed frames,
worker entries, the stack switch in `main`, and the outermost `_start`.
Debug builds add DWARF source lines and stable scalar parameter homes.
Signposted builds expose collector phases, worker intervals and
allocation slow paths through USDT.

## Bootstrap and validation

1. Pin an arm64-hosted build toolchain, compiler source snapshot, catalog,
   target and runner configuration. Cross-build and run the first ELF
   smoke, then hosted runtime fixtures through the same public target
   entry. Use [frozen manifest provenance](bootstrap.md#evidence-required).
2. Check the minimum compiler/runtime operation set from the frozen build
   and port incrementally. Use target diagnostics for missing operations.
   Cross-build a frozen stage 1 with the Node-hosted compiler on arm64,
   then repeat the cross-build with the native arm64 compiler once the x86
   emitter itself builds and runs in the native subset.
3. Run stage 1 on Linux x86-64 to build stage 2 from that exact snapshot.
   Run stage 2 there to build stage 3. Require successful stages, exact
   stage 2/3 byte equality and recorded hashes. Compare stage 1 as an
   additional diagnostic. Run the resulting compiler on fixtures and
   verify debug info when built with debug. Keep both arm64 targets
   working throughout with regression and frozen native self-build gates.

The native Linux arm64 cross-build produced the same x86-64 compiler as
the Node bootstrap from the 796-file frozen snapshot. That compiler ran
under QEMU user mode and in the Debian x86-64 VM. In Debian x86-64
userspace under Rosetta, stage 1 built stage 2 and stage 2 built stage 3.
All three compiler images are byte-identical. The full QEMU TCG
self-build reached optimization and hit its one-hour watchdog.
[Fixed-point manifest and logs](results/x64-native-fixed-point-v1.json).

| Tier             | Runner and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit             | Node on the existing arm64 host for differential encoding, relocation limits, register/stack assignment and malformed map tests. Use readelf/objdump to verify image headers, dynamic imports and CFI independently.                                                                                                                                                                                                                                |
| Per binary       | Use explicit `qemu-x86_64` in the shared arm64 Linux `dev` machine, with a pinned x86-64 sysroot via `-L` for interpreter, libc and fixture libraries. Copy binaries once and batch launches. Keep exit codes, signals, stdout, artifact manifests and executor identity. User emulation routes syscalls and cannot establish kernel, ptrace/USDT or exact memory-model behavior. [QEMU user mode](https://www.qemu.org/docs/master/user/main.html) |
| Guest end to end | Debian 13 x86-64 QEMU TCG VM via `~/.t3/vms/start-x64.sh`, SSH 2223, 8 emulated vCPUs. Batch transfers and tests. Verify the guest loader, page protections, threads, futex, USDT, GDB and JIT. Shut down with `~/.t3/vms/stop.sh`.                                                                                                                                                                                                                 |
| Darwin later     | Host Rosetta can run x86-64 Mach-O. Direct macOS execution requires Mach-O. Linux ELF translation through a virtualization service would require separate configuration and verification. Keep Linux x86-64 verification independent of the Darwin port.                                                                                                                                                                                            |
| Conformance      | Run unchanged pinned Test262 selections against both backends under the same variant/negative-phase policy. Start with calls, abrupt completion, numeric edges, object/array behavior, then live eval and shared/atomic behavior. Store immutable per-target reports with the actual denominator, unsupported and failed variants, heartbeat/stall records and no whole-suite extrapolation.                                                        |
| Support gate     | Run end-to-end checks in the Debian x86-64 VM and per-binary checks under QEMU user mode. The gate covers the pinned Test262 selection (22/22 in the VM), glibc 2.34, the collector, live code, and F1/F2. Native x86-64 CI and timing will follow on a GitHub Actions x64 runner after the repository is pushed.                                                                                                                                   |

## Running hosted fixtures and bootstrap images

`TINT_NATIVE_TARGET` selects the hosted fixture's build target.
`TINT_NATIVE_RUNNER` selects its executor. Darwin arm64 uses
`darwin-local`, with LLDB admission and a stop at entry. Linux arm64 uses
`linux-dev`, through the shared `dev` machine on macOS or directly when
the Node host is Linux arm64. Set `TINT_BUILD_ONLY=1` to keep the image and
its build manifest without executing the fixture.

Linux x86-64 requires an explicit runner.

- `x64-local` launches the image on a Linux x86-64 host and records each
  inferior's exit, signal, or timeout.
- `x64-qemu-dev` runs QEMU user mode on the arm64 Linux `dev` machine.
  From this checkout on macOS, install the pinned Debian glibc 2.36 sysroot
  and QEMU with
  `container machine run -n dev -w "$PWD" -- sh tools/setup-x64-sysroot.sh "$HOME/.t3"`.
  The command puts the runtime files in `~/.t3/tint-x64-sysroot` and the
  emulator in `~/.t3/tint-x64-qemu`. It downloads packages by immutable
  Debian Snapshot file ID and verifies their SHA-256 before extraction.
  Each launch batch verifies the three runtime files against
  [the sysroot manifest](../tools/x64-sysroot.sha256) and records its
  SHA-256. `TINT_X64_QEMU` can select another QEMU executable in `dev`.
- `x64-ssh` stages one archive per batch against the Debian 13 VM and
  executes in a temporary guest directory. Start the VM with
  `~/.t3/vms/start-x64.sh`. The default SSH destination is
  `tint@127.0.0.1:2223`, with key `~/.t3/vms/tint-vm-key`. OpenSSH must
  already trust the VM host key. Set `TINT_X64_SSH_HOST`,
  `TINT_X64_SSH_PORT`, or `TINT_X64_SSH_KEY` to override these settings.

Run the raw ELF and glibc acceptance probes with
`TINT_X64_RUNNER_TEST=x64-qemu-dev node --test tools/native-target-runner.test.ts`
or select `x64-ssh` or `x64-local`. The batch includes a trap, a timeout
and a subsequent successful run to check result recovery.

Keep hosted fixture execution records with `TINT_KEEP_NATIVE=1`.
`node tools/bootstrap-compiler.ts <output> --run -- <inferior arguments>`
opts into running the newly built compiler and writing matching build and
execution manifests. Bootstrap arguments that name files must resolve on
the executor. Stage the source snapshot separately when using SSH and
retrieve any compiled output from the guest path supplied to the compiler.
The execution records identify the executor, input image and build
manifest, and record exit status, signal, timeout or execution-unavailable.

### Conformance and release status

The initial matched Test262 selection passed all 22 variants on Darwin
arm64, Linux x86-64 under user-mode QEMU, and the Debian x86-64 VM. It
covers calls, abrupt completion, numeric behavior, arrays, parser rejection,
direct eval, `$262.evalScript`, the `Function` constructor, and shared
atomics and agent waiting. The complete journals record the pinned
revision, exact source and harness hashes, and frozen Node toolchain.
[Conformance report](results/x64-test262-v1.json).

Run the selection with `tools/test262-native-run.ts` using
`TINT_NATIVE_TARGET=linux-x86_64`, one of the x86-64 runners above, and
`TINT_TEST262_VARIANTS=docs/results/x64-test262-selection-v1.json`. Use
root selection `.` and program linking. For a matched Darwin run, set
`TINT_TEST262_NATIVE_SERVICES=monolithic` on both targets. The x86-64
adapter builds with the generational collector and stages one ELF per
batch. It records each case separately.

The glibc 2.34 loader check on the x86-64 guest exercised executable
publication, a moving collector with live code, and selected Test262 cases
for shared atomics, agent waiting, `Function` and direct eval.
[Loader results](results/x64-glibc-2.34-v1.json).

Linux x86-64 is supported. The Debian x86-64 VM and QEMU user-mode runs
pass the support gate, including Test262 (22/22 in the VM), glibc 2.34,
the collector, live code, and F1/F2. Native x86-64 CI and timing
comparisons for compiler self-builds and matched JavaScript workloads will
follow on a GitHub Actions x64 runner after the repository is pushed.

## Performance stance

Get correct frames, calls and guards first. With fewer registers than arm64,
prioritize reducing spills around calls and retaining the most reused values
in preserved GPRs. Reuse CFG and liveness information, then tune slot and
temporary allocation from spill counts and measured costs. x86 memory operands
can eliminate separate loads, LEA can avoid clobbering flags, and CMP/TEST plus
Jcc can fuse on many cores. Use CMOV for measured profitable cases, keeping
memory loads and language evaluation order safe. Favor 32-bit zero-extending
operations where semantics allow it, and consider BMI/BMI2 or VEX forms under
a measured feature profile. Base the runtime and compiler comparison on
native cycles and wall time with frozen inputs.

## Feasibility measurements

The same 132-byte static x86-64 ELF exited 42 in every run. It contains an
ELF header, a single RX load segment and a raw Linux exit syscall. SHA-256
`d93aa7e7fd49e17fb09ac7cd6b0cd0776dea9e40503595ae28b1abf7c71c48c7`.
Each sample times a guest-side Bash loop of 100 fresh processes, excluding
boot, SSH, copying and installation. Use these as launch-overhead observations.

| Environment                                              | Wall seconds per 100 launches | Median per launch |
| -------------------------------------------------------- | ----------------------------- | ----------------- |
| Debian 13 x86-64 VM, Linux 6.12.117, full-system TCG     | 0.508, 0.754, 0.479           | 5.08 ms           |
| Debian 12 arm64 `dev`, explicit `qemu-x86_64-static` 7.2 | 0.704, 0.776, 0.748           | 7.48 ms           |

User mode avoided boot and SSH but took longer per launch in this probe.
Choose it for convenient isolated fixture runs and use a representative
hosted workload before picking a throughput runner. The statically linked
emulator came from a scratch extraction of the Debian arm64 package.
Dynamic loader/sysroot and JIT execution were outside the probe. On macOS,
`arch -x86_64 /usr/bin/uname -m` returned `x86_64` under Rosetta. The guest
VM was stopped after the probe.

## Ordered slices

Sizes are rough estimates of changed production and test lines. Each row
is independently mergeable after its dependencies and keeps both arm64
targets operational. For implementation merges, run workspace checks,
relevant native fixtures and the arm64
regression gate. Keep new exports, workspace contracts and generated catalog
updates with their owning slices.

| Slice                                              | Scope and likely files                                                                                                                                                                                                                  | Size        | Depends on   | Acceptance                                                                                                                                                                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Architecture plumbing                           | `platform/src/target.ts`, `compiler/src/{build,native/index}.ts`, target/CLI tests. Centralize output arch dispatch, extract the neutral request/module seam and retain arm64 defaults.                                                 | 200–400     | —            | Both arm64 target paths preserve fixture bytes, target defaults and diagnostics. Unsupported target selection fails explicitly.                                                                                            |
| 2. Encoder                                         | `codegen/src/x86_64/isa.ts` and codegen tests. REX, ModRM/SIB, integer/memory forms, SSE2, byte labels and near fixups.                                                                                                                 | 900–1,500   | —            | Differential byte/disassembly matrices, invalid operands and exact signed-fit edge cases. Stable encoding lengths and no new dependency in the native source closure.                                                      |
| 3. ELF machine policy                              | `image/src/linux/elf/{format,index,jit-object}.ts`, ELF tests. Parameterize machine, relocs, alignments and interpreter through a writer-local descriptor.                                                                              | 250–500     | —            | Test bytes with readelf and a hand-encoded ELF with imports under the guest loader. Existing arm64 ELF and JIT object bytes match. Unwind payload support lands in slice 10.                                               |
| 4. Execution harness                               | `tools/native-host-target.ts`, hosted fixture runner, `tools/bootstrap-compiler.ts` host adapter. Add explicit emulation/SSH runner, sysroot, provenance and artifact checks.                                                           | 300–600     | —            | Launch a raw static ELF and a glibc fixture, recover exit/signal failures and mark execution unavailable when a target runner is absent. Preserve build-only mode and Darwin LLDB path.                                    |
| 5. Freestanding scalar emission                    | `codegen/src/x86_64/scalar/`, compiler backend dispatch and native fixture tests. Integer/FP, branches, frames, basic direct managed calls and near data/import fixup model.                                                            | 1,500–2,800 | 1–4          | Cross-build IR through Tint into an ELF. Run call/branch, register pressure, mixed overflow args, NaN and signed-zero fixtures. Stable unsupported-op diagnostics.                                                         |
| 6. Hosted entry and libc                           | `codegen/src/x86_64/startup.ts`, platform Linux host policy, native host identity/process intrinsics, `compiler/src/{build,image-writer}.ts` and bootstrap.                                                                             | 900–1,700   | 5            | Cross-build hosted CLI smoke, argv/env, file/time/entropy and runtime init. Verify loader finalizer/stack args, native host identity, fixed glibc floor, guard checks and AArch64 output parity for unchanged programs.    |
| 7. Managed runtime and roots (complete)            | x86 scalar helpers, `abi/src/host.ts`, tracing scanner, managed compiler/linker contracts and GC fixtures. Land numeric/string/array, record, closure and completion families in smaller merges with exact-PC maps and barrier support. | 4,000–8,000 | 6            | Root relocation through nested calls, tagged throws, GC under allocation pressure, safepoint faults and missing-map rejection. Pass managed call and typed-contract fixtures before enabling corresponding language paths. |
| 8. Parallel runtime (complete)                     | x86 atomics/thread leaves, Linux host policy, waiter, contention and collector fixtures.                                                                                                                                                | —           | 7            | Exact-width access, CAS failure and RMW tests, concurrent collection and futex park/wake under guest kernel.                                                                                                               |
| 9. Far image and service link (complete)           | x86 fixups, emission plans, service-unit linker and large-image verifier.                                                                                                                                                               | —           | 5            | Forced-far native execution at normal size, rel32 bounds, a real ELF spanning the signed limit, and collection through an independently compiled service.                                                                  |
| 10. Unwind, debug and diagnostics (complete)       | x86 frame/debug/USDT emission, `abi/src/unwind.ts`, DWARF/EH frame and ELF policies.                                                                                                                                                    | —           | 6            | Independent CFI and DWARF readers, GDB chain across startup and managed code, real guest USDT hits with correct operands. Large CFI offsets are covered by slice 9.                                                        |
| 11. Live publishing (complete)                     | x86 code-memory leaves and adapters, compiler managed JIT/linking, runtime registry, engine tests and ELF JIT registration.                                                                                                             | —           | 7, 9, 10     | In-image compilation, collection across published entries, cross-context rejection, kernel W^X fallback, and GDB line lookup and private-page repair.                                                                      |
| 12. Native fixed point (verified under Rosetta)    | Bootstrap catalog and closure, x86 lowering gaps for the compiler, frozen self-build tools and reports.                                                                                                                                 | —           | 7–9          | Native arm64 cross-build runs on x86-64, and x86-64 makes identical stage 2 and stage 3 images. Publish manifest and hashes. Debug variant uses slice 10.                                                                  |
| 13. Test262 and support gate (complete)            | `tools/test262-native-run.ts` and runner adapters, target docs and immutable reports.                                                                                                                                                   | —           | 8, 10–12     | Debian x86-64 VM and QEMU user-mode coverage for pinned AOT and live selections, glibc 2.34, the collector, live code, and F1/F2. VM Test262 passed 22/22.                                                                 |
| F1 part 1. SysV C leaf calls and layout (complete) | **FFI/convergence**. SysV classification and layouts, static leaf imports, raw aggregate stubs, leaf C memory operations and the C call-frame trampoline.                                                                               | —           | 2, 5, 6      | C oracle fixtures for scalars, variadics, mixed aggregates, sret, layout/padding and by-value copies. Verify static imports and the trusted trampoline under QEMU. Diagnose deferred FFI paths before emission.            |
| F1 part 2. Managed FFI wrappers (complete)         | Record-by-value argument and result wrappers, public `foreignFunction`, runtime library loading, string conversion, and managed FFI views and storage.                                                                                  | —           | F1 part 1, 7 | Public static and dynamic bindings pass the C oracle.                                                                                                                                                                      |
| F2. C callbacks and thunks (complete)              | SysV scoped, registered and dynamic callbacks, x86 thunk unwind rows, managed transitions and scanner integration.                                                                                                                      | —           | F1, 7, 10    | ABI preservation across may-callback, moving GC across foreign frames, failure/throw policy, nesting and stale-entry rejection.                                                                                            |

Slices 1–4 can start in parallel on distinct files, with catalog and
bootstrap edits coordinated at merge. After slice 5, the far linker can
proceed alongside hosted work. After slice 6, managed roots, CFI and F1
can proceed in parallel. After slice 7, thread support and live work can
advance independently as their dependencies clear. Start frozen bootstrap
closure checks during slice 7 and run the self-build as soon as its actual
closure is complete. If closure analysis needs an FFI-owned binding,
make F1 an explicit prerequisite for that build. FFI changes belong to
<t3-thread://v2/c549f3f5-0f49-4d5d-bb8b-d1030331591d/56f31528-4f32-45ff-a477-97f802cc50ce>.
Full public FFI parity requires F1 and F2 evidence in addition to the
core support gate.

## Coordinator decisions

- Confirm the public target spelling, the glibc floor and the x86-64-v2
  deployment profile. Choose whether to advertise baseline SSE2 compatibility
  separately if the finished emitted closure stays within it.
- Validate Linux x86-64 support with the Debian x86-64 VM and QEMU user mode,
  including F1 and F2. Add native x86-64 CI and timing on a GitHub Actions x64
  runner after the repository is pushed.
