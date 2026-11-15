# GC stack maps

Collectors find stack roots by walking native frames and visiting exactly the
frame words each frame's safepoint lists, as HotSpot oop maps, .NET GC info and
OCaml frame tables do. Frames carry no root header and prologues publish
nothing: the frame-pointer chain every prologue already keeps is the only link.

## Safepoints and maps

Every call that may reach Tint code is a safepoint: IR calls (direct, imported,
indirect), the allocation slow path, forced collections and executable-memory
entries. Its return address names one map:

- frame bytes (the frame's stack pointer is its frame pointer minus this);
- reference words, then tagged general words (two-word values, by tag word),
  each as a stack-pointer-relative offset.

A map lists the words holding references live while the call runs:

- managed and general slots live after the call, or live into the block's
  exception handler (block-level slot liveness, `analyzeLiveSlots`, refined
  per instruction; record and cell terminators count as reads);
- register-homed reference slots spilled around the call (their frame word is
  stored before it and reloaded after it, `SlotHomes.spills`);
- block-local temporaries defined before the call and used by or after it
  (temporary pools, and slot words of loads that alias a frame-homed slot);
  folded constants are never stored, so never listed;
- the owned closure environment.

Calls the closed-world proof shows cannot collect list nothing: a walk passes
such a site only in runtime frames, whose references are permanent control
memory.

### Soundness without clearing

A listed word must hold a valid reference or zero. Liveness is monotone along
store-free paths: if a word is live at a safepoint, it was live at every
safepoint since its last store, so every intervening collection updated it.
Paths from entry without a store make it live at entry, so exactly the slots
live into the entry block (that the prologue does not store) are zeroed.
Over-approximating liveness is therefore safe as long as the same analysis
decides entry zeroing; under-approximating reads would not be. No dead-slot or
temporary-pool clears remain, and register-homed slots' frame words are never
zeroed (only spills write them, right before the safepoints that list them).

When the liveness budget runs out (pass statistics report
`safepoint-liveness`), the function falls back to the conservative regime:
every frame root word (`NativeFunction.frameRoots`) is listed at each
collecting call and kept valid by entry zeroing and dead-slot and pool clears.
`EmissionOptions.preciseStackMaps: false` forces that regime for tests.

## Tables

Each emitted module ends with its safepoint table and a footer:

    table   magic 0x50414d53, version 1, entry count,
            entries: map word index * 2^32 + return offset (sorted),
            maps: frame bytes, reference count, offsets..., general count, offsets...
    footer  0x544f4f46, table byte offset

Equal maps are shared. `NativeModule.stackMaps` lists the module's tables with
the code range each covers; service-unit linking keeps each unit's table.
`decodeStackMaps` decodes them for tests and tools.

## Registry and walk

Hosted context word 0 holds the stack-map registry, in permanent control
memory: count, capacity, walk start, then (code start, length, table) entries.
Startup registers the allocator, runtime and program tables, and the
diagnostics thunks as a transparent range (table 0: signpost thunks hold no
references and their frames are passed over). JIT publication registers each
module's table through its footer (`registerStackMaps`, the
`stack-maps-register` host operation); code storage refuses to publish a module
with a table to a host that cannot register it.

Startup enters managed code with x29 = 0, so the chain ends at the entry frame
(unwinders still use the entry's call-frame rows). `currentRootHead()` (the
`root-head` operation) records the calling function's frame pointer as the walk
start and returns the registry; collectors pass it as their root head.

`walkNativeStack` (native-runtime `tracing/scan.ts`) starts at that frame and,
for each frame record, maps the return address to its registry range and
safepoint (binary search), checks that the caller's frame size agrees with the
chain (`caller - frameBytes = callee + 16`, except after a transparent frame),
and visits the map relative to the caller's stack pointer. Unknown return
addresses, missing safepoints, malformed tables, chains that do not move toward
the stack base and frame-count overruns fail the collection; the walk never
guesses. The checked scanners additionally bound and validate every listed
offset against the frame size.

The tests are `tools/native-gc-stack-maps.test.ts` (native, many collections in
a 4 MiB heap), `packages/codegen/test/scalar-stack-maps.test.ts` and the
runtime scan tests.
