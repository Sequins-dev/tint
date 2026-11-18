# macOS arm64 target contract

Implementation status: the [Mach-O package](../packages/image/README.md) now emits
minimal signed arm64 PIE executables from supplied native code. Host verification
covers startup/return, argc, local calls, multi-page code, writable data and eager
libSystem imports. The file ABI gate also checks binary copies, variadic creation
mode, permissions, errno and temporary cleanup. Portable file-service modules run
through a development Node adapter; their native compilation is not implemented.
The scalar AArch64 backend now compiles a number/boolean subset through the typed
ABI below; `pnpm verify:scalar-native` verifies its source-to-native fixtures.
Runtime machinery and self-hosting remain unimplemented. The broader
contracts below remain the target design.

Status: concrete initial design proposed on 2026-10-26, beneath the accepted
macOS arm64 target and logical call/lifetime contracts. The publisher subset above has native execution evidence; the remaining runtime
and general/managed ABI contracts await implementation. These are internal implementation defaults,
not a permanent public ABI.

This is the **first target**, not the platform scope of Tint. Linux is the intended
long-term primary platform; Windows is a likely later target. Everything below that
depends on Darwin, arm64 or Mach-O is a target-specific mapping beneath the shared
contracts. See the [platform roadmap](platform-roadmap.md).

## Target and ownership

Target little-endian arm64, 64-bit pointers, ordinary arm64 rather than arm64e.
Initial execution support is the current host, observed as macOS 26.6.2, arm64.
Record deployment target and SDK reference version explicitly in the build manifest;
initially use 26.6.2 as the deployment floor. Lowering that floor requires testing,
not just changing the Mach-O version field. Do not infer required CPU extensions
from the developer machine; baseline instructions suffice initially.

Tint emits instructions, resolves its link graph, writes the executable and its
ad-hoc signature. No C intermediate, assembler, native compiler, platform linker,
or signing subprocess is required to build an artifact. The OS kernel and dyld
still load executables, and libSystem supplies OS services. Owning the build linker
does not mean replacing the operating system's loader.

Keep four interfaces separate: architecture instruction encoding; Tint call ABI;
Darwin foreign ABI; and Mach-O file publication. Live memory publication will be a
second consumer of the same code/data/fixup graph. Internal link units retain ESM
bindings, initialization dependencies and type metadata, not C object-file semantics.

## Minimal host services

Compiler-facing host operations are synchronous and instance-scoped:

- Read a file as bytes; write a complete file, with an executable-output option.
- Obtain process arguments and current directory; write diagnostic bytes to stderr
  and normal output bytes to stdout.
- Return a process exit status through the CLI entrypoint. Library compilation
  reports a result rather than terminating its host.

No directory enumeration, network, subprocess, environment-variable or Node API
compatibility is required unless the compiler's concrete source inventory needs it.
The Node adapter implements this same build interface. Native-only memory services
are not part of the interface that Node must execute.

Use `/usr/lib/libSystem.B.dylib` imports instead of hardcoded syscall numbers.
Initial native wrappers use `open`, `read`, `write`, `close`, `getcwd`, `rename`,
`unlink`, `fchmod`, and `__error`; runtime storage uses `mmap`, `munmap`, and
`getpagesize`. `_exit` is reserved for an unrecoverable runtime failure; normal
completion returns through startup. Keep an explicit import manifest containing
symbol spelling, fixed/variadic signature, widths, error rule and effects.
Mach-O symbol names add the leading underscore: for example `_read` and `___error`.

The wrappers are trusted TypeScript using narrowly scoped foreign-call and raw
memory intrinsics. The relevant initial signatures use 32-bit signed descriptors
and status codes, 64-bit pointers and sizes, signed 64-bit byte counts, signed
64-bit file offsets, and Darwin's 16-bit `mode_t`. Verify declarations, symbol
aliases and constants against the SDK when implementing; do not copy host C structs
into the compiler's public API. SDK headers are design/test references, not runtime
build dependencies. The checked local headers are in Xcode's macOS SDK.

`open` is variadic: its optional creation mode uses the Darwin variadic stack rule,
including integer promotion. A hardcoded `open` call adapter is sufficient before
supporting arbitrary foreign variadic calls. No `printf` dependency is needed.

Read until EOF, tolerate short reads, retry interrupted reads/writes where valid,
and write until all bytes have been transferred. Capture errno immediately on
failure, before other host calls. Do not blindly retry `close` after an error.
Keep file descriptors in explicit cleanup scopes; preserve an original operation
failure when cleanup also fails. Host errors become structured operation/path/errno
results before compiler-level error reporting.

Write outputs to an exclusively created temporary sibling, close successfully,
then rename to the requested destination. Apply output permissions before publishing.
Remove temporary files on failure. This protects a prior output from a failed build;
it does not promise crash durability. Use a counter with exclusive creation for
collisions, not a random-number host dependency.

File contents remain bytes. Source decoding is a separate compiler operation.
The initial text-path/argument adapter uses UTF-8 with explicit failure on invalid
input, embedded NUL, or an unencodable string; it must not silently replace filename
bytes. This is a host limitation, not a change to JavaScript string semantics.
A raw-byte path API can follow if needed.

Native storage mappings are read/write, non-executable. Query the runtime page size,
check arithmetic overflow and mapping failures, and keep collector metadata outside
the managed allocation path. OS calls in this initial manifest do not reenter Tint;
unknown future foreign calls must conservatively permit reentry and allocation.

## Tint physical call ABI, version 0

Use one baseline convention for strict and live code, with distinct typed and general
entry signatures. The following register allocation is a Tint design choice:

- `x0`: runtime-context pointer.
- `x1`: closure-environment managed pointer, or zero.
- `x2`: pointer to a caller-rooted general receiver slot, or zero when unused.
- `x3`: pointer to the caller-owned result area.
- Typed entry: integer, boolean, reference and indirect aggregate arguments use
  `x4` through `x7`; Number arguments use `d0` through `d7` independently.
- General entry: `x4` is the actual argument count and `x5` points to contiguous
  general-value slots. Zero arguments permits a null pointer. `x6`/`x7` are unused.
- Return: `w0` is completion state, 1 for Normal and 2 for Throw. Results themselves
  are written to the result area, including scalar results in this first version.

Every ordinary source Number is binary64, even if its current value is integral.
Machine integers are trusted lowering types, not a silent change to Number behavior.
A typed ABI represents booleans as canonical 0/1, references as one pointer, and
multiword values such as unions by pointers to caller-owned typed slots initially.
Those slots are borrowed for the call; retaining their address after return is
forbidden. Identity-bearing objects remain references rather than copied records.

Allocate each scalar class in source parameter order. Once its register bank is
exhausted, place subsequent arguments of that class into 8-byte stack slots;
interleave overflow slots in source order. Indirect aggregates consume one pointer
slot. The caller reserves the overflow area and rounds its size to 16 bytes. The
first overflow slot is at the callee's incoming SP. This is Tint's simple packing
rule, not Apple's foreign argument packing rule.

Initially keep all four hidden inputs even when zero. A signature that needs actual
count, extra arguments, or general receiver semantics uses the general entry or an
explicit adapter; it cannot lose information by selecting a narrower typed entry.
Known calls can use typed entries after preserving argument evaluation, missing
arguments and defaults as specified in the [logical contract](call-contract.md).
General argv storage can be a rooted stack region; no heap argument array is required.

### General values and result storage

Start with a 16-byte, 8-byte-aligned general value: a 64-bit category tag at offset 0
and a 64-bit payload at offset 8. Numbers carry their binary64 bits; references carry
managed pointers. Heap-backed representations accommodate larger values, including
BigInt. The tag distinguishes actual ECMAScript categories, not declared TypeScript
types. The initial category tags are 0 undefined, 1 number, 2 boolean, 3 string,
4 null, 5 object, 6 symbol and 7 bigint. Functions carry the object category.
String, object, symbol and bigint payloads are traced references; all other
payloads are untraced. The entire 64-bit tag must be valid, including zero upper
bits. Production lowering and emission implement this storage layout. Native typed
entries now transfer general slots through calls, records, returns and thrown
completions. Catch and finally lowering use the same completion protocol. Production
native tracing uses the actual category when scanning general-slot descriptors.
Strict typed slots and proven specializations do not require this wrapper.

A result area is 16-byte-aligned, with a 16-byte header and a payload large enough
for either the normal signature result or a 16-byte general thrown value, rounded
up to 16 bytes. Header offset 0 contains a 32-bit state: 0 Empty, 1 Normal, 2 Throw;
the remaining header bytes are reserved and zero. Payload begins at offset 16.
A static signature descriptor supplies normal size, alignment and trace strategy.
All current payload alignments are at most 16; unsupported alignments are rejected.

The caller initializes Empty and registers the area before calling. Empty is not
scanned; Normal uses the normal descriptor; Throw scans a general value. The callee
keeps source values rooted while writing payload, then sets state without an
intervening safepoint, then removes its own roots. `w0` mirrors the stored state.
A partially constructed normal result stays Empty and its references remain in
separate callee roots until publication. Resetting a reusable area also requires
preserving any still-live prior value elsewhere first.

General-entry Normal results are general values. Typed-entry Normal results use
their signature layout. This supports differently sized unions without reserving
a universal largest-union slot. A pending finally completion uses a separate result
area from the cleanup call. Register-only returns are a later verified optimization,
not a reason to have different ownership rules in each execution profile.

### Frames, roots and preserved registers

Keep SP 16-byte-aligned. Use `x29` for the frame chain and save `x30` in non-leaf
frames; initially emit a frame for every function. Do not allocate `x18`. Preserve
`x19`–`x28` and the low 64 bits of `v8`–`v15` when used; treat `x16`/`x17` as scratch
that branch veneers may clobber. Other allocatable caller-saved registers cannot
carry live values across a call without saving them. Avoid red-zone storage initially.
These platform constraints follow [Apple's ARM64 ABI](https://developer.apple.com/documentation/xcode/writing-arm64-code-for-apple-platforms)
and [AAPCS64](https://github.com/ARM-software/abi-aa/blob/main/aapcs64/aapcs64.rst).

Frame construction saves the frame record and used preserved registers, reserves
locals/outgoing arguments, initializes root slots, then links a shadow-root record
into the context before any allocating operation. Spill incoming reference values
into roots before allocation. Registers alone are never the collector's only source
of a live reference. Managed environments are roots; raw context/result/argv pointers
are not automatically managed references. Root descriptors explicitly describe the
slots they address. Both completion paths unlink roots and restore the frame.

Exceptions use explicit completion propagation, not native C++ unwinding or longjmp.
Do not let foreign exceptions or a callback's Tint Throw cross an unadapted boundary.
OS unwind metadata and richer debugging can follow; frame chains and explicit
language unwinding are required from the first version.

### Darwin adapters

Host calls use Apple's ABI, not the hidden inputs above. Adapters move arguments,
preserve Tint live state and roots, perform foreign calls, inspect errors, then
construct Tint results. Honor narrow-argument extension and variadic stack arguments.
Only implement the manifest's pointer/scalar signatures initially. Arbitrary structs,
homogeneous aggregates, foreign callbacks and public library ABI coverage follow
with independent ABI fixtures. Public exports must go through generated adapters;
private result-area layouts must never become an accidental C API.

## Executable image and startup

Emit a thin 64-bit arm64 PIE Mach-O executable. Use a preferred image base of
`0x100000000`, a page-zero guard below it, and 16-KiB segment alignment for this
target. Keep file offsets, preferred virtual addresses and runtime addresses as
separate quantities; never assume the preferred base is the actual load address.

Initial segments are `__PAGEZERO` (inaccessible, no file bytes), `__TEXT` (read/execute,
including headers and immutable constants), `__DATA` (read/write, imports and mutable
runtime globals), and `__LINKEDIT` (read-only metadata). No writable executable
segment. Defer splitting out `__DATA_CONST` until useful.

Write `LC_SEGMENT_64`, `LC_MAIN`, `LC_LOAD_DYLINKER` for `/usr/lib/dyld`, the libSystem
`LC_LOAD_DYLIB`, `LC_BUILD_VERSION`, `LC_DYLD_CHAINED_FIXUPS`, and `LC_CODE_SIGNATURE`.
`LC_MAIN.entryoff` addresses Tint's startup adapter in `__TEXT`, not a raw kernel
entrypoint. This schema comes from Apple's [Mach-O definitions](https://github.com/apple-oss-distributions/xnu/blob/main/EXTERNAL_HEADERS/mach-o/loader.h).
Symbol/debug tables are optional later additions; unsupported required load commands
must not be invented or silently ignored by Tint's own validators.

Startup receives the process arguments through the Darwin main convention, creates
a runtime context, installs host/root/module state, copies needed arguments into
managed storage, evaluates the entry module, runs the compiler CLI, cleans up and
returns an integer status. An uncaught Tint throw becomes diagnostics and failure.
The main-style handoff is illustrated by [Apple's dyld implementation](https://github.com/apple-oss-distributions/dyld/blob/main/dyld/dyldMain.cpp).
Module initialization is Tint-managed; C initializer lists do not replace ESM rules.

Use eager imported pointer slots and indirect calls. Choose chained fixups with
`DYLD_CHAINED_PTR_64_OFFSET`, uncompressed symbol names and the simplest import
entries that fit; reject unsupported encodings and overflow explicitly. Resolve
internal relative branches and page-relative references in Tint's linker; use dyld
fixups only for persisted pointers requiring rebasing/binding. Chains are page-bound
and may require multiple starts. See Apple's [chained-fixup definitions](https://github.com/apple-oss-distributions/dyld/blob/main/include/mach-o/fixup-chains.h).

The shared linker operates on typed relocations, not just patched byte offsets.
Check branch and addressing ranges. Insert architecture-owned veneers or literal
indirection where supported, otherwise diagnose the limit. Deterministic ordering
of code, constants, imports and fixups is required for self-build comparisons.
No text relocations and no runtime rewriting of signed AOT instructions.

## Signing and publication

Implement ad-hoc signing in TypeScript. Emit an embedded signature SuperBlob with a
SHA-256 CodeDirectory, deterministic identifier and ad-hoc flag, without a certificate
or CMS signing identity. Use 4-KiB signature hash slots initially; signing hash-page
size is distinct from the 16-KiB VM segment alignment. Encode signature metadata in
its specified byte order, not the image's implicit byte order. Structures are defined
in Apple's [code-signing header](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/cs_blobs.h).

Reserve the signature space, finalize all headers/load commands and pre-signature
padding, hash covered file bytes, then append the signature. No covered bytes may
change afterward. The signature is last in `__LINKEDIT`. Validate hash coverage,
partial final pages, executable-segment bounds and the chosen CodeDirectory version.
The serializer is implemented and passes macOS signature verification for the
current executable fixtures.

Initial artifacts are local development executables, without Hardened Runtime or
JIT entitlements. Ad-hoc signing is not Developer ID distribution/notarization.
Those distribution workflows are separate future product work. Development images
can explicitly request `com.apple.security.get-task-allow`; the publisher serializes
both XML and version-1 DER entitlements, and the signer hashes their complete blobs
through slots 5 and 7. Compiler debug builds and native test fixtures enable this
permission so LLDB can obtain the initial stop. It is independent of DWARF emission.

For later live mode, allocate and manage a JIT arena through the native host adapter,
apply the appropriate write-protection protocol, synchronize the instruction cache,
and publish entries only after code, relocations and root/deoptimization metadata
are ready. Keep policy dependent on the host's signing/hardening requirements;
Apple documents `MAP_JIT` and the JIT entitlement in its [JIT porting guide](https://developer.apple.com/documentation/apple-silicon/porting-just-in-time-compilers-to-apple-silicon).
File signing is not a substitute for that memory-publication protocol. Both use the
same linker graph, but different final publication operations. Live publication is
not required for the first compiler self-build.

## Verification gates

Before relying on this contract, implement focused fixtures for:

1. Directly executing a Tint-written, self-signed image, including relocated launches
   and validation of segment permissions, imports and signature hashes.
2. Typed/general calls with mixed arguments, register overflow, recursive frames,
   missing/extra arguments, receivers, unions and normal/throw results.
3. Forced GC at argument evaluation and callee allocation, with returned references,
   thrown values and nested finally completions surviving correctly.
4. Host partial I/O, interruption, error capture, cleanup, failed publication and
   executable output. Include the creation-mode variadic adapter.
5. Branch-range/fixup limits and malformed/overflowing layouts, all rejected rather
   than truncated; deterministic output from equivalent inputs.
6. Native compiler self-build and subsequent generation comparison against the
   Node-built generation. OS inspection tools may validate artifacts but must not
   generate, link, patch or sign them on Tint's behalf.

The [bootstrap feature inventory](bootstrap-feature-inventory.md) and
[trusted intrinsic contract](trusted-intrinsics.md) now define the proposed source
budget and kernel boundary. The [IR contract](ir-contract.md) and
[heap/root schemas](heap-descriptors.md) now specify portable operations and tracing
structures for this target mapping. Public library ABI and live publication follow
self-hosting.

## Native raw-region ABI verification

`pnpm verify:regions` now builds and signs two arm64 executables using Tint's own
encoder, import fixups and Mach-O publisher, then runs each eight times. Node only
writes and launches the files. No C compiler, assembler, platform linker or native
Node addon participates in their construction. `codesign --verify --strict` verifies
Tint's signatures; it does not produce them.

The verification-only fixture exercises these fixed-argument libSystem imports:

| Symbol         | Arguments                                                 | Result / error                             |
| -------------- | --------------------------------------------------------- | ------------------------------------------ |
| `_getpagesize` | none                                                      | signed int page size                       |
| `_mmap`        | pointer, size_t, int protection, int flags, int fd, off_t | 64-bit pointer; all-one bits is MAP_FAILED |
| `_munmap`      | pointer, size_t                                           | signed int; -1 is failure                  |
| `___error`     | none                                                      | pointer to thread-local int errno          |
| `_write`       | int fd, pointer, size_t                                   | signed 64-bit byte count                   |

Declarations and constants were checked in the local Xcode macOS SDK's
`usr/include/sys/mman.h`, `sys/errno.h`, and `unistd.h`. The fixture uses
PROT_READ=1, PROT_WRITE=2, MAP_PRIVATE=2, MAP_ANON=0x1000, fd=-1 and offset=0.
It requests no executable permission and no fixed virtual address.

Each successful mapping spans twice the runtime page size. Tests read zero-filled
first/last words, write/read the final word, report the page size and sentinel through
the first words, and require successful munmap before normal exit. A zero-length
mmap must return MAP_FAILED with EINVAL (22); a separate fixture rejects a deliberately
misaligned munmap with EINVAL, checks that the mapping remains accessible, then
releases the original range. Errno is read immediately after each expected failure.
Normal completion restores callee-saved registers and returns through startup.

This is real native OS/ABI evidence, **not** compiled TypeScript allocator execution.
The fixture hand-emits instructions and treats unexpected errors/short writes as test
failure. Production retry/ownership/OOM policy, checked arbitrary-size page rounding,
metadata placement and TypeScript intrinsic lowering remain separate work. On fixture
failure, process teardown reclaims mappings; this is not an embedding cleanup policy.

### Implemented literal-string throw slice

The current scalar backend implements Throw for literal strings with category tag 3
at result offset 16 and the string handle at offset 24. It checks and propagates Throw
through direct calls before consuming normal results. Literal handles currently refer
to module-owned immutable storage: eight-byte code-unit length followed by UTF-16LE
units. Module ownership must outlive references to those literals. This original bounded slice has since been extended with managed strings, general
thrown-value transfers, catch/rethrow and finally cleanup. Those extensions have
native construction fixtures; the self-hosted compiler executable remains unproven.

## Large images

Tint selects a high-base Mach-O layout with separately signed code chunks
when its compact VM extent reaches the shared-region guard. See the
[large-image contract and verifier](large-images.md#mach-o-layout-selection).
