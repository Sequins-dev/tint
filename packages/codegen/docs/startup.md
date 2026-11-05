# AArch64 process startup

`emitHostedEntry` composes a compiled control allocator, native runtime factory,
and application entry into relocatable code plus explicit import references. The
image writer handles executable format, import slots, and signing separately.

Startup preserves the platform main ABI, maps control/managed/stack regions,
protects both stack guards, constructs borrowed workspace headers, and initializes
the TypeScript control allocator. It then invokes the TypeScript runtime factory,
installs the returned managed allocation closure, and enters the application.
Normal completion restores the original stack and releases all three mappings.
The private context preserves argc/argv at offsets 40/48 after the existing root,
heap, allocator, environment, and region-length fields.

Memory capacities are explicit inputs. Control allocations are permanent collector
state outside the reclaimable managed region. The default POSIX policy is Darwin;
OS constants/symbols and page size are explicit seams for future Linux support.
Windows needs a different host policy and call boundary. This is not an OS-neutral
executable format or a claim that other hosts already work.

The application entry takes no parameters and returns a numeric process status.
The runtime factory has the checked fifteen-parameter window/workspace contract
in `@tint/native-runtime`. See `tools/verify-hosted-runtime.ts` for an executable
proof of repeated collection with a small heap, UTF-8 argv bytes, guarded stack,
and normal process return.

The context now reserves 64 bytes. Offset 56 holds an optional native pointer to
permanent linear-allocation control data; startup zeroes it before initializing
the runtime. Only the copying runtime publishes it. Code emitted with the explicit
linear-allocation capability uses the fast path when present and the existing
checked allocation closure otherwise. The runtime factory itself continues to use
the control allocator and cannot take the application fast path.
