# Platform roadmap and portability contract

Status: agreed platform direction, with proposed architectural boundaries. No target
is implemented yet.

## Order and priority

1. **macOS arm64 is the first implementation and bootstrap target**, using the current
   development host to prove direct native output and compiler self-hosting.
2. **Linux is an intended supported platform and the long-term primary target.**
   Its implementation follows the first macOS path, but portability requirements
   constrain the architecture from the beginning.
3. **Windows is a likely later target.** Preserve the necessary architectural room
   without claiming committed implementation scope or a delivery date.

Implementation order is not product priority. Deferring Linux implementation does
not make Linux optional or permit macOS assumptions in the portable core. Neither
Linux CPU architectures nor a Windows architecture/support baseline has been selected.
The initial arm64 backend must not become an implicit architecture commitment for
all operating systems.

The [macOS arm64 contract](macos-arm64-target.md) is one concrete target mapping.
Its registers, foreign signatures, page alignment, startup, imports and signing
policy are not universal Tint contracts.

## Separate the dimensions

A compilation request identifies target architecture, OS, ABI, executable format,
minimum platform version and enabled capabilities. The compiler's execution host
is a separate input: a Node-hosted or native compiler may produce code for a different
target. Type layout must depend on target data, never accidentally on host pointer
width, host endianness or the OS running the compiler.

Keep the language profile and optimization policy independent of all of these.
Both strict and live execution are product goals on Linux as well as macOS; do not
reserve live compilation for the first host's memory-publication mechanism.

## Boundaries to preserve from the first implementation

- **Portable semantics and IR:** parsing, checking, ESM linking, control flow,
  normal/throw completion, logical calls and roots are shared. The logical ABI does
  not name Darwin registers or assume its foreign calling convention.
- **Target data layout:** widths, alignment and representation/descriptor layout are
  explicit inputs. Common descriptor logic can produce different physical layouts.
- **Architecture backend:** instruction selection/encoding, register constraints,
  branch ranges and relocations are separate from OS startup and executable writing.
- **ABI lowering:** private call placement and foreign adapters select target rules.
  Preserve shared ownership and completion obligations without requiring identical
  physical argument/result layouts on every platform.
- **Image publication:** a shared link graph feeds target-specific executable/library
  writers, import metadata and signing where required. ESM module semantics remain
  above the OS symbol/import layer.
- **Host services:** files, diagnostics, process arguments and raw memory have common
  logical operations, with per-host error, path, permission and resource handling.
  Do not assume every host resource is an integer file descriptor or uses errno.
- **Live publication:** code allocation, write/execute transitions, cache synchronization,
  registration and retirement are host/architecture adapters with shared lifetime
  rules. Do not equate executable memory with one macOS API or entitlement policy.
- **Debugging and foreign integration:** leave target hooks for unwind/debug metadata,
  callbacks, thread entry and library initialization. Explicit Tint exceptions do
  not eliminate platform integration obligations.

Build a small set of concrete interfaces, not a general plugin framework before
there is a second implementation. Each interface needs a clear owner and testable
contract; avoid scattering OS conditionals throughout the frontend or collector.

## Host differences that must stay expressible

The macOS contract's libSystem import strategy is local to that target. Linux's
system-library versus direct-syscall policy, deployment baseline and distribution
compatibility remain to be designed. Windows host imports and runtime dependencies
also remain open. None may introduce an external native compiler or platform linker
into Tint's production build pipeline.

The common file API must accommodate different path encodings, resource types,
replacement semantics and executable-permission models. The initial macOS UTF-8
adapter is not a universal path representation. Specify supported behavior and
explicit failure where a host cannot provide an operation's promised semantics;
do not silently weaken output publication guarantees.

Use runtime page/allocation information where necessary and target image parameters
for file layout. Neither macOS's image alignment nor its signing hash-page size is
a universal allocator constant. Keep machine address arithmetic separate from
ordinary Number semantics on every host.

The existing logical GC and root contract remains shared. OS memory allocation,
physical frame metadata and executable-code retirement can vary beneath it.

## Evidence and sequencing

First complete the macOS self-build path. Alongside it, review new IR/intrinsic/heap
contracts for leaked host assumptions. Portable compiler algorithms should have
host-independent byte/semantic fixtures; native execution requires target-specific
validation and cannot be claimed from successful cross-emission alone.

After that first path, define Linux's concrete target contract and validate its
startup, imports, calls, file operations, memory management and self-build on Linux.
Then validate live publication there. Linux becomes the primary product/validation
focus as support is established, while macOS remains supported. Windows gets its
own target contract and native validation when taken on.

Cross-compilation is an architectural capability to preserve, not a claim that every
host/target combination already works. Track build-host, output-target and execution
coverage separately. Target-specific failures must not be hidden by testing only
portable code under Node.
