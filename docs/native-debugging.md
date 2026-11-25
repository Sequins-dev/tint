# Native debugging

Debug builds (`--debug-symbols`, `BuildRequest.debugSymbols`,
`CompileRequest.debugSymbols`, or `TINT_DEBUG_SYMBOLS=1` for hosted fixtures)
describe source variables, record types and inlined calls in DWARF v4, so LLDB
can stop on a TypeScript line, print parameters and locals, walk objects field
by field and show inlined frames in backtraces. Default builds are unchanged:
none of this metadata exists unless debug symbols are requested, and the
default image of the same sources is byte-identical with and without this
support (see [verification](#verification)).

Debug builds also include heap introspection: the `__tint_heap_descriptor`,
DWARF types for every heap object kind, LLDB data formatters and the dormant
allocation-sampling hook, used by external heap snapshot and allocation
profiling tools. See [native heap profiling](native-heap-profiling.md).
`--no-heap-introspection` keeps a debug build's code identical to the
default build's.

To use Chrome DevTools instead of the LLDB command line, see
[Chrome DevTools for native programs](native-devtools.md). It provides
Sources, breakpoints, stepping, inlined call frames, scopes with
JavaScript-like values, console output, CPU profiles and the Memory
panel, through `lldb-dap`.

## Using it

```sh
TINT_KEEP_NATIVE=1 node tools/verify-hosted-debug-variables.ts   # prints the image path
lldb <image path>
```

Any hosted fixture accepts `TINT_DEBUG_SYMBOLS=1 TINT_BUILD_ONLY=1` in the same
way; the fixture source is the `fixture` file in breakpoints.

```text
(lldb) breakpoint set --file fixture --line 4
(lldb) process launch
* thread #1, stop reason = breakpoint 1.1
    frame #0: fixture:weight [...](value=<unavailable>) at fixture:4:20 [inlined]
(lldb) bt 3
  * frame #0: fixture:weight [...] at fixture:4:20 [inlined]
    frame #1: program:fixture:scale [...](point=0x0000000104f3c050, factor=1) at fixture:8:14
    frame #2: program:fixture:run [...] at fixture:15:40
(lldb) frame variable
(double) value = <variable not available>
(double) doubled = 8
(lldb) up
(lldb) frame variable *point
({x, y, label}) *point = {
  __header = 4295453536
  x = 3
  y = 4
  label = 0x0000000100076ac0
}
```

`tools/verify-hosted-debug-variables.ts` builds that fixture and asserts this
session (inlined frames, numbers, an int64 loop counter, a record and its
fields, a string's contents and the normal exit status) under LLDB.

For the compiler itself, build a debug bootstrap compiler as in
[profiling](profiling.md) and stop on any compiler source line, for example
`breakpoint set --file packages/ir/src/optimization/slots.ts --line 50`.

## What is described

- **Parameters and locals** of the function and of every inlined callee, by
  their source names, with declaration file and line.
- **Values**: numbers are `double` (binary64), or `long` where the emitter
  keeps an integer as int64; booleans are `bool`; `T | undefined` numbers and
  booleans are `{ value, present }` pairs; general values are a tagged
  `general` structure (`tag` enumerates undefined, number, boolean, string,
  null, object, symbol and bigint; `payload` is a union).
- **Strings** are pointers to a `string` structure: `__header`, `length` in
  UTF-16 code units, then the data. `units` (`char16_t[]`) describes a
  two-byte string's data and `bytes` (`latin1[]`) a one-byte string's (kind
  flag 1 in the header, docs/design-one-byte-strings.md); both overlay the
  same storage. A fixed DWARF element type cannot describe both kinds, so
  the Tint LLDB and GDB formatters (`tools/lldb/tint.py`, `tools/gdb/tint.py`)
  read the header and show the text.
- **Objects** whose type statically selects one record layout are pointers to
  a structure named after the class (or `{field, ...}` for object types), with
  the header words and one member per field at its realized offset. Other
  references (unions with several layouts, typed arrays, primitive wrappers)
  point to opaque structures with their headers.
- **Inlined calls**: each copied call is a `DW_TAG_inlined_subroutine` with
  its callee's abstract origin, call file/line/column and exact code ranges,
  nested for inlining within inlined code. Line rows inside keep the callee's
  own positions, so LLDB and symbolicators show the callee line under the
  caller's call site.

A variable is described only where its current value is known to be in the
described storage. Elsewhere LLDB reports it as unavailable; it never shows a
stale word, a slot shared with another variable, or a register the collector
may have invalidated. Concretely:

- A slot-held variable is described while the slot is live (the instruction-
  precise liveness of its slot, including exception edges), using the frame
  word (fp-relative) or the callee-saved register home in force in each block,
  and the d16–d31 registers leaf frames promote frame words into.
- Register-homed references are described through their frame word between
  the spill and reload around a safepoint, and not at all inside a safepoint
  where they are not spilled: the collector updates frame words only.
- When optimization removes a variable's stores, the removing pass records a
  value binding (variable, SSA value, position). Such a variable is described
  by the value's home from that position (once the emitter has stored the
  value) until the value's last use or the variable's next assignment. At the
  last use only the operation's first instruction is covered, since the
  operation may reuse the home for its result. Values the emitter does not
  materialize (folded constants, flag-only comparisons, fused reads, raw
  32-bit words) are not described.
- A load of a named slot also holds the variable until the slot is stored
  again, which keeps variables visible after their slot's last use.
- Everything is clipped to the frame-valid ranges (after the prologue and
  before return teardown).

## How the metadata flows

1. **Lowering** (`@tint/ts-native/closure/lowering`, `ModuleEntryOptions.debug`)
   attaches `FunctionIR.debug` to each function: source variables (name,
   declaration span, parameter flag, statically known record layout), slot
   bindings for the slots holding them, and empty value bindings and inline
   sites. Captured and environment-owned bindings live in cells and are not
   described. Record layouts receive `RecordLayout.debug` (type and field
   names) from the record planner.
2. **Optimization** (`@tint/ir`) treats the metadata as inert: no pass reads it
   to make a decision, and default builds never contain it.
   - `compactSlots` and `lowerSSA` remap slot bindings; SSA promotion binds
     promoted variables to block parameters and removed stores' values, and
     its lowered parameter storage to the variable.
   - `removeUnreadStores` binds the values of removed stores;
     `forwardLocalLoads` and `removeDeadScalars` keep bindings attached to
     surviving values (`retainDebugValues` moves anchors back over removed
     instructions, which emit no code).
   - The inliner records an `InlineSite` (callee, call span, enclosing site)
     per expansion, marks copied instructions with `inline`, keeps their
     callee spans (default builds keep the call span), and adopts the
     callee's variables and bindings. Straight-line callee parameters are
     bound to the argument values.
   - Pruning remaps record references; `verify` checks all indices.
3. **Emission** (`@tint/codegen/aarch64/scalar/debug-variables.ts`) observes
   emission without changing it: operation code ranges, the register homes in
   force per block, where bound values are saved, spill intervals and leaf
   promotions. After the function is emitted it computes each variable's
   location ranges (`NativeFunction.debug`).
4. **Composition** (`@tint/compiler`) resolves spans to files, lines and source
   names (the linker renames bindings), nests inline sites into scopes, and
   converts storage to DWARF types and locations (`debug-types.ts`).
5. **Encoding** (`@tint/image/dwarf`) writes `.debug_info` with interned types,
   abstract origins, location lists in `.debug_loc` and scope ranges in
   `.debug_ranges`; the Mach-O writer adds both sections to `__DWARF`.

## Limitations

- A variable whose storage encoding differs between ranges (for example an
  int64 slot whose loaded value the emitter keeps as a double) is described
  only where the first-seen encoding holds.
- Bindings whose anchor instruction moves to another block (loop-invariant
  hoisting, inliner continuations) are dropped rather than guessed.
- Captured variables (closure cells), scalar-replaced records and 16-byte
  values held only as SSA values are not described.
- Nested object fields point to opaque `object` structures: field record types
  are not propagated. The LLDB formatters in `tools/lldb/tint.py` and the
  GDB pretty-printers in `tools/gdb/tint.py` retype them from the object
  header at display time (see
  [native heap profiling](native-heap-profiling.md)).
- There are no lexical blocks: shadowed names appear once per declaration,
  and only the live one has a location.

## Verification

- `packages/image/test/dwarf-variables.test.ts` decodes types, location
  lists, pieces, variable-length views and inline scopes, and runs
  `llvm-dwarfdump --verify` on an executable when `xcrun` provides it.
- `packages/ir/test/debug-metadata.test.ts` covers inlining (sites, spans,
  nesting, adopted variables, unchanged default output), compaction, value
  bindings after store removal, SSA promotion and verifier checks.
- `tools/verify-hosted-debug-variables.ts` is the scripted LLDB check above
  (`llvm-dwarfdump --verify` first, from Xcode or the Linux llvm package).
  On Linux it also drives GDB through the same stops: line breakpoints, the
  inlined `weight` frame, record fields, UTF-16 strings and a backtrace
  ending at `tint:process-start` (`_start`, whose FDE marks the outermost
  frame) without an unwind error.
- `tools/verify-hosted-dwarf.ts` compiles the encoder natively and checks
  that all five sections (including `.debug_loc` and `.debug_ranges` for
  variables, pieces, views and an inline scope) equal Node's bytes.

Native evidence for the initial implementation (worktree `t3/2cb4cce2`):

- Default output: the base commit's toolchain and this one built the same
  frozen base sources with no flags to byte-identical compilers (31,307,210
  bytes). With `--debug-symbols`, their `__TEXT,__text` sections were
  identical as well (debug metadata never changes code), and the build time
  stayed at about one minute.
- The self-build fixpoint held (stage2 = stage3), and the native stage2
  compiler's `--debug-symbols` build of its own snapshot was byte-identical to
  the Node-hosted debug build and passed `llvm-dwarfdump --verify`
  (16,868 inlined subroutines).
- LLDB on that native debug compiler stopped at `slots.ts:52`
  (`compactSlots(fn=0x…, budget=46929)`), printed `visited = 1246`, `*fn`
  field by field and `*fn->name` (`length = 10`), and a stop at
  `liveness.ts:220` showed `analyzeLiveSlots … [inlined]` between
  `analyzeSlots` and `promoteSlots`, with `liveResult = true` and
  `slotCount = 8`.
