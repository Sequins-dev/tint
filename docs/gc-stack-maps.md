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
  each as a stack-pointer-relative offset;
- the register word: bit i when the frame's prologue saves x(19 + i), bit
  10 + i when x(19 + i) holds a live reference during the call, followed by
  the save offsets (stack-pointer relative) of the saved registers in
  register order. Every map of a function repeats its saves, including maps
  of calls that cannot collect: walks pass those frames too.

A map lists the words holding references live while the call runs:

- managed and general slots live after the call, or live into the block's
  exception handler (block-level slot liveness, `analyzeLiveSlotsPrecisely`,
  refined per instruction). Record and cell terminators that write or
  initialize a field count as reads of their slot. One that reads a field
  writes its slot on the consequent edge only, so the slot is live before it
  only when the alternate edge needs the old value. Counting it as a read
  kept dead values alive until a later read overwrote their slot: on frozen
  v3, 56 slots were live across the compile driver's `emitModule` call
  instead of 12, and the peak live heap fell from 934 to 676 MiB once they
  were dropped (docs/results/native-space-precise-reads.md);
- block-local temporaries defined before the call and used by or after it
  (temporary pools, and slot words of loads that alias a frame-homed slot);
  folded constants are never stored, so never listed;
- the owned closure environment;

and, in its register word, the callee-saved registers of register-homed
reference slots live after the call (`SlotHomes.registerRoots`, from the
same precise liveness; register interference keeps the conservative one). Those
references stay in their registers across the call: there is no spill or
reload, and the slot-home cost model charges references nothing for the
safepoints they cross.

### Register roots

A callee-saved register's value during a call is wherever the nearest callee
that saved it put it; callees that do not use the register pass it through
unchanged. The walk visits frames innermost first and keeps, per register,
the save slot holding the current frame's value: after visiting a frame it
applies that frame's saves (they hold its caller's values), so each listed
register resolves to the save slot of the nearest frame below that saved it.
The collector updates that slot like any root word, and the saving frame's
epilogue restores the moved reference into the register.

Registers no frame between a safepoint and the collector saved are still
live in the machine registers while the collector runs, where its own
frames would save them out of reach. So the frame that starts a walk saves
all of x19..x28: a function that reads the root head inline, or calls the
root-head binding's own body, saves every callee-saved GP register in its
prologue. Registry word +24 tells the walk where: the inline reader's save
block address, or (from the binding, whose frame is gone by the walk) one
plus the return address into its caller, whose map at that call describes
the caller's saves. A listed register that resolves to no save slot fails
the walk. Transparent ranges (diagnostics thunks) never save x19..x28.

The soundness argument below carries over: the value the collector sees in
the save slot is the register's value at the call, the same value a spill
would have stored. Register homes live at entry are zeroed in the prologue.
Reference homes are still never live into an exception handler (register
lists cover what is live after each call, not handler liveness).

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
zeroed or listed (maps list the register instead).

When the liveness budget runs out (pass statistics report
`safepoint-liveness`), the function falls back to the conservative regime:
every frame root word (`NativeFunction.frameRoots`) is listed at each
collecting call and kept valid by entry zeroing and dead-slot and pool clears.
`EmissionOptions.preciseStackMaps: false` forces that regime for tests.

## Tables

Each emitted module ends with its safepoint table and a footer:

    table   magic 0x50414d53, version 2, entry count,
            entries: map word index * 2^32 + return offset (sorted),
            maps: frame bytes, reference count, offsets..., general count, offsets...,
                  register word, save offsets...
    footer  0x544f4f46, table byte offset

Equal maps are shared. `NativeModule.stackMaps` lists the module's tables with
the code range each covers; service-unit linking keeps each unit's table.
`decodeStackMaps` decodes them for tests and tools.

## Registry and walk

Hosted context word 0 holds the stack-map registry, in permanent control
memory: count, capacity, walk start, walk-start saves (see Register roots),
then (code start, length, table) entries.
Startup registers the allocator, runtime and program tables, and the
diagnostics thunks as a transparent range (table 0: signpost thunks hold no
references and their frames are passed over). JIT publication registers each
module's table through its footer (`registerStackMaps`, the
`stack-maps-register` host operation); code storage refuses to publish a module
with a table to a host that cannot register it.

Startup enters managed code with x29 = 0, so the chain ends at the entry frame
(unwinders still use the entry's call-frame rows). `currentRootHead()` (the
`root-head` operation) records the calling function's frame pointer as the walk
start, with its saves, and returns the registry; collectors pass it as their
root head. The calling frame must stay live while the collection runs: the
non-generational heap takes a `withRootHead(collect)` callback that reads the
root head and runs the collection inside it.

`walkNativeStack` (native-runtime `tracing/scan.ts`) starts at that frame and,
for each frame record, maps the return address to its registry range and
safepoint (binary search), checks that the caller's frame size agrees with the
chain (`caller - frameBytes = callee + 16`, except after a transparent frame),
visits the map relative to the caller's stack pointer, and passes the save
slot of each register the map lists to a word visitor. Unknown return
addresses, missing safepoints, malformed tables, chains that do not move toward
the stack base and frame-count overruns fail the collection; the walk never
guesses. The checked scanners additionally bound and validate every listed
offset against the frame size. The walk and the root scanners built on it
(`createNativeRootScan`, created with each collector) allocate nothing: they run
while the managed allocator refuses requests (a scan that allocated trapped the
region collector, `tools/native-region-collection.test.ts`).

The tests are `tools/native-gc-stack-maps.test.ts` (native, many collections in
a 4 MiB heap, with register-held references through chains of frames that
save all, some or none of the registers), `packages/codegen/test/scalar-stack-maps.test.ts`
and the runtime scan tests.
